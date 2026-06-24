/**
 * Ticket Analysis Service
 *
 * Orkestrira analizu stvarnih Zendesk ticketa: dohvati tickete od zadnjeg cursora
 * → sastavi razgovor → maskiraj PII → LLM analiza (tema, namjera, kvaliteta odgovora,
 * je li KB rupa) → upsert u Supabase (analyticsStore) → pomakni cursor.
 *
 * Sav LLM/mrežni rad je injektabilan preko `deps` radi determinističkih testova.
 * Koristi vlastiti, jeftiniji model (ANALYSIS_MODEL), izolirano od chat pipelinea.
 */
const OpenAI = require("openai");
const env = require("../config/env");
const log = require("../config/logger");
const piiService = require("./piiService");
const zendeskService = require("./zendeskService");
const analyticsStore = require("./analyticsStore");

const ANALYSIS_MODEL = env.ANALYSIS_MODEL || "google/gemini-2.5-flash";
const DEFAULT_MAX_TICKETS = env.ANALYSIS_MAX_TICKETS || 150;
const BACKFILL_DAYS = env.ANALYSIS_BACKFILL_DAYS || 90;
const MAX_CONVO_CHARS = 6000;

const QUALITY = new Set(["good", "partial", "bad", "na"]);
const HANDLED = new Set(["bot", "human", "mixed"]);

let _client = null;
function getLlmClient() {
  if (!_client) {
    _client = new OpenAI({ apiKey: env.OPENROUTER_API_KEY, baseURL: "https://openrouter.ai/api/v1" });
  }
  return _client;
}

async function defaultLlm(systemPrompt, userText) {
  const completion = await getLlmClient().chat.completions.create({
    model: ANALYSIS_MODEL,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userText }
    ]
  });
  return completion.choices?.[0]?.message?.content || "";
}

function buildAnalysisPrompt() {
  return [
    "Ti si analitičar korisničke podrške za Antikvarijat Libar.",
    "Dobivaš jedan razgovor s korisnikom (može biti email, web chat ili Messenger).",
    "Analiziraj ga i vrati ISKLJUČIVO JSON objekt s ovim poljima:",
    '- topic: kratka tema razgovora na hrvatskom (npr. "dostava", "povrat", "raspoloživost naslova")',
    "- intent: namjera korisnika u nekoliko riječi",
    "- handled_by: tko je odgovorio - 'bot' (samo AI asistent), 'human' (samo agent) ili 'mixed'",
    "- bot_answered: true/false - je li bot dao koristan odgovor",
    "- bot_quality: 'good' | 'partial' | 'bad' | 'na' (na = bot nije sudjelovao)",
    "- is_kb_gap: true/false - je li ovo rupa u bazi znanja (pitanje na koje bot nije imao dobar odgovor jer informacija ne postoji u bazi)",
    "- kb_gap_reason: ako je is_kb_gap true, kratko zašto; inače null",
    "- suggested_kb_topic: ako je is_kb_gap true, koji bi članak/temu trebalo dodati u bazu; inače null",
    "- summary: jedna rečenica sažetka razgovora",
    "- language: jezik razgovora (npr. 'hr', 'en')",
    "Vrati samo JSON, bez dodatnog teksta."
  ].join("\n");
}

// Izvuci JSON objekt iz LLM izlaza (tolerantno na okolni tekst).
function extractJson(raw = "") {
  if (!raw) return {};
  try { return JSON.parse(raw); } catch (_) { /* fallthrough */ }
  const match = String(raw).match(/\{[\s\S]*\}/);
  if (match) { try { return JSON.parse(match[0]); } catch (_) { /* ignore */ } }
  return {};
}

function asBool(v) { return v === true || v === "true" || v === 1; }

function parseAnalysis(raw) {
  const p = extractJson(raw);
  const quality = QUALITY.has(p.bot_quality) ? p.bot_quality : "na";
  const handled = HANDLED.has(p.handled_by) ? p.handled_by : "mixed";
  const isGap = asBool(p.is_kb_gap);
  return {
    topic: (p.topic && String(p.topic).trim()) || "ostalo",
    intent: p.intent ? String(p.intent).trim() : null,
    handled_by: handled,
    bot_answered: asBool(p.bot_answered),
    bot_quality: quality,
    is_kb_gap: isGap,
    kb_gap_reason: isGap && p.kb_gap_reason ? String(p.kb_gap_reason).trim() : null,
    suggested_kb_topic: isGap && p.suggested_kb_topic ? String(p.suggested_kb_topic).trim() : null,
    summary: p.summary ? String(p.summary).trim() : "",
    language: p.language ? String(p.language).trim() : "hr"
  };
}

function buildConversationText(comments = []) {
  const text = comments
    .map((c) => (c?.body || "").trim())
    .filter(Boolean)
    .join("\n---\n");
  return text.slice(0, MAX_CONVO_CHARS);
}

/**
 * Analiziraj jedan ticket → red za ticket_analysis. Maskira PII prije LLM-a i
 * prije spremanja (nema sirovih osobnih podataka ni u promptu ni u Supabaseu).
 */
async function analyzeOne(ticket, comments, deps = {}) {
  const llm = deps.llm || defaultLlm;
  const convo = buildConversationText(comments);
  const maskedConvo = piiService.maskPII(convo).masked;
  const maskedSubject = piiService.maskPII(ticket.subject || "").masked;
  const userText = `Subject: ${maskedSubject}\nKanal: ${ticket.channel}\nRazgovor:\n${maskedConvo}`;

  const analysis = parseAnalysis(await llm(buildAnalysisPrompt(), userText));

  return {
    ticket_id: ticket.id,
    channel: ticket.channel || null,
    created_at: ticket.created_at || null,
    subject: maskedSubject,
    requester_masked: ticket.requester_id ? `user_${ticket.requester_id}` : null,
    status: ticket.status || null,
    handled_by: analysis.handled_by,
    language: analysis.language,
    topic: analysis.topic,
    intent: analysis.intent,
    bot_answered: analysis.bot_answered,
    bot_quality: analysis.bot_quality,
    is_kb_gap: analysis.is_kb_gap,
    kb_gap_reason: analysis.kb_gap_reason,
    suggested_kb_topic: analysis.suggested_kb_topic,
    summary: piiService.maskPII(analysis.summary).masked,
    model_used: ANALYSIS_MODEL,
    analyzed_at: new Date().toISOString()
  };
}

function defaultCursorISO(sinceDays) {
  const days = Number(sinceDays) || BACKFILL_DAYS;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Pokreni analizu od zadnjeg cursora (ili backfill prozor ako cursora nema).
 * Vraća sažetak: { ok, analyzed, skipped, kbGaps, errors, fetched, cursor }.
 */
async function run({ sinceDays, maxTickets } = {}, deps = {}) {
  const store = deps.store || analyticsStore;
  const listTicketsSince = deps.listTicketsSince || zendeskService.listTicketsSince;
  const getComments = deps.getPublicTicketComments || zendeskService.getPublicTicketComments;

  if (!store.isConfigured()) {
    return { ok: false, reason: "supabase_not_configured", analyzed: 0, skipped: 0, kbGaps: 0, errors: 0 };
  }

  const max = Number(maxTickets) || DEFAULT_MAX_TICKETS;
  const cursor = (await store.getCursor()) || defaultCursorISO(sinceDays);

  const { tickets, nextCursorISO } = await listTicketsSince(cursor, { maxTickets: max });

  let analyzed = 0, skipped = 0, kbGaps = 0, errors = 0;
  for (const ticket of tickets) {
    // Incremental Export vraća i obrisane tickete - njima komentari ne postoje (404).
    if (ticket.status === "deleted") { skipped += 1; continue; }
    try {
      const comments = await getComments(ticket.id);
      const row = await analyzeOne(ticket, comments, deps);
      await store.upsertAnalysis(row);
      analyzed += 1;
      if (row.is_kb_gap) kbGaps += 1;
    } catch (error) {
      // 404 = ticket obrisan/nedostupan → preskoči, nije prava greška.
      if (/\(404\)/.test(error.message || "")) { skipped += 1; continue; }
      errors += 1;
      log.warn("ticket_analysis_failed", { ticketId: ticket.id, message: error.message });
    }
  }

  if (nextCursorISO) await store.setCursor(nextCursorISO);
  log.info("ticket_analysis_run", { analyzed, kbGaps, errors, fetched: tickets.length });
  return { ok: true, analyzed, skipped, kbGaps, errors, fetched: tickets.length, cursor: nextCursorISO };
}

module.exports = {
  run,
  analyzeOne,
  parseAnalysis,
  buildAnalysisPrompt,
  buildConversationText,
  ANALYSIS_MODEL
};
