/**
 * Analytics Store (Supabase REST)
 *
 * Čita/piše analizu Zendesk ticketa u Supabase (tablice ticket_analysis i
 * analysis_sync_state). Koristi Supabase REST/PostgREST (axios), kao
 * supabaseMetricsService - bez dodatne klijent biblioteke.
 *
 * Sve funkcije su sigurne bez konfiguracije: čitanja vraćaju prazne podatke,
 * pisanja su no-op (isConfigured() === false).
 */
const axios = require("axios");
const env = require("../config/env");
const log = require("../config/logger");

const SUPABASE_URL = (env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

// Test hook: kad je postavljen, getClient() vraća ovaj mock umjesto pravog klijenta.
let _testClient = null;
function _setTestClient(client) { _testClient = client; }

function isConfigured() {
  return Boolean((env.SUPABASE_URL || "") && (env.SUPABASE_SERVICE_ROLE_KEY || ""));
}

function getClient() {
  if (_testClient) return _testClient;
  if (!isConfigured()) throw new Error("Supabase not configured.");
  return axios.create({
    baseURL: (env.SUPABASE_URL || "").replace(/\/+$/, ""),
    timeout: 15000,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json"
    }
  });
}

const UPSERT_HEADERS = { headers: { Prefer: "resolution=merge-duplicates,return=minimal" } };

// ─── Pisanje ───────────────────────────────────────────────────

async function upsertAnalysis(row) {
  if (!isConfigured()) return;
  try {
    await getClient().post("/rest/v1/ticket_analysis", row, UPSERT_HEADERS);
  } catch (error) {
    log.warn("analytics_upsert_failed", { ticketId: row?.ticket_id, message: error.message });
    throw error;
  }
}

async function getCursor() {
  if (!isConfigured()) return null;
  try {
    const res = await getClient().get("/rest/v1/analysis_sync_state?id=eq.1&select=last_cursor");
    return res.data?.[0]?.last_cursor || null;
  } catch (error) {
    log.warn("analytics_cursor_read_failed", { message: error.message });
    return null;
  }
}

async function setCursor(iso) {
  if (!isConfigured()) return;
  await getClient().post(
    "/rest/v1/analysis_sync_state",
    { id: 1, last_cursor: iso, updated_at: new Date().toISOString() },
    UPSERT_HEADERS
  );
}

// ─── Čitanje ───────────────────────────────────────────────────

// Zendesk via.channel je heterogen (email, facebook, web, api, web_service, chat…).
// Mapiramo sirove vrijednosti u 3 prikazna kanala + "ostalo".
// VAŽNO: provjeri stvarne vrijednosti u bazi (SELECT DISTINCT channel) i doradi.
function channelBuckets() {
  return {
    email: ["email"],
    facebook: ["facebook", "messenger", "facebook_page", "facebook_post"],
    web: ["web", "web_widget", "web_service", "chat", "messaging", "api"]
  };
}

// ─── Razdoblje ─────────────────────────────────────────────────

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Normalizira {from, to} u ISO timestampe za PostgREST filter.
 * Datum bez vremena ("2026-07-01") se širi na cijeli dan da rubni dani budu
 * uključivi u oba smjera — inače bi "do 31.7." odbacilo sve tog dana.
 * Vraća null za nezadanu granicu (= bez filtera).
 */
function normalizeRange({ from = null, to = null } = {}) {
  const parse = (value, endOfDay) => {
    if (value === null || value === undefined || value === "") return null;
    const raw = String(value).trim();
    const iso = DATE_ONLY_RE.test(raw)
      ? `${raw}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`
      : raw;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) throw new Error(`Neispravan datum: ${raw}`);
    // Datum-only smo već sami sastavili; pun ISO vraćamo doslovno kako ga je
    // pozivatelj poslao (bez preformatiranja u drugu vremensku zonu).
    return DATE_ONLY_RE.test(raw) ? iso : raw;
  };

  const fromIso = parse(from, false);
  const toIso = parse(to, true);
  if (fromIso && toIso && new Date(fromIso) > new Date(toIso)) {
    throw new Error("Neispravan raspon: 'from' je nakon 'to'.");
  }
  return { from: fromIso, to: toIso };
}

// Početak produkcijskog rada bota kao ISO timestamp (ili null ako nije zadan).
function startDateIso() {
  const raw = String(env.ANALYSIS_START_DATE || "").trim();
  return DATE_ONLY_RE.test(raw) ? `${raw}T00:00:00.000Z` : null;
}

/**
 * Razdoblje za statistiku: traženi raspon, ali nikad prije početka rada bota.
 * Ticketi iz vremena prije bota (npr. stara povijest Zendeska povučena
 * backfillom) inače bi se brojali kao da ih je bot vidio i rušili postotke.
 */
function effectiveRange(range = {}) {
  const r = normalizeRange(range);
  const start = startDateIso();
  if (start && (!r.from || new Date(r.from) < new Date(start))) r.from = start;
  return r;
}

// ─── Klasifikacija upita (čiste funkcije) ─────────────────────

// Skupine stvarnih upita kupaca. `fix` kaže tko/što zatvara rupu u toj skupini.
const CATEGORIES = {
  otkup: { label: "Otkup knjiga i udžbenika", fix: "Dopuniti bazu znanja pravilima otkupa" },
  dostupnost: { label: "Dostupnost naslova", fix: "Treba spojiti bota sa zalihom webshopa" },
  narudzba: { label: "Narudžbe, povrati i reklamacije", fix: "Traži radnju u sustavu — ostaje agentu" },
  kupnja: { label: "Kupnja, dostava i plaćanje", fix: "Dopuniti bazu znanja" },
  otkazani_otkup: { label: "Otkazani nalozi otkupa", fix: "Dodati razlog u automatski mail o otkazu" },
  ostalo: { label: "Ostalo", fix: null }
};

// Ticketi koji nisu upit kupca — ne ulaze u nazivnik postotaka.
const EXCLUDED = {
  sum: "Spam, reklame i sistemske poruke",
  bez_pitanja: "Poruke bez pitanja"
};

// Redoslijed je bitan: prvo pravilo koje pogodi temu određuje skupinu.
const TOPIC_RULES = [
  ["sum", /spam|promo|tiktok|edukacij|poslovna ponuda|poslovna surad|seo |seo$|pozivnica za testiranje|automatski odgovor|nepovezan|newsletter|specifikacija pouzeća|testiranje|ponuda usluga|marketing|oglašavanj|reklam(?!acij)|webinar|kapital|investic|ugovor/],
  ["bez_pitanja", /^potvrda (dostave|primitka|preuzimanja)|^potvrda primitka|zahval|zadovoljstvo|^pozdrav|nema teme|^nepoznat|^ostalo$|^općenito$|prosljeđivanje upita|razgovor s agentom/],
  ["otkazani_otkup", /otkaz\w* \w*\s?otkup|otkup\w*.*otkaz|otkazan\w* (nalog|otkup)|storn\w* otkup/],
  ["narudzba", /status|otkaz|storn|izmjen|spajanj|dodavanj|nadopun|korekcij|povrat|zamjen|reklamacij|pogrešn|nedostaj|oštećen|isplat|uplat|neisplat|račun|preuzimanje (paketa|pošiljke|narudžbe)|problem s|greška|kašnjenj|nije stigl|refund/],
  ["dostupnost", /raspoloživ|dostupnost|^udžbenici|ponuda udžbenika|ponuda za udžbenike|rezervacij|upit o dostupnosti|stanje udžbenika|traženje|potražnja|cijena udžbenika|udžbenici za/],
  ["otkup", /otkup|prodaja (knjiga|udžbenika)|prodaja knjiga|ponuda knjiga|ponuda za knjige|prikup|preuzimanje (knjiga|udžbenika)|skeniranje|barkod|bar kod|donacij/],
  ["kupnja", /kupnj|kupovin|narudžb|naruč|dostav|plaćanj|način|cijen|kontakt|radno vrijeme|lokacij|popust|popis udžbenika|radne bilježnice|webshop|poslovnic/]
];
// Sažetak analize otkriva šum i kad je tema dobila "normalno" ime.
const SUMMARY_NOISE_RE = /promotivn|nije relevant|neželjen|spam|reklamn/;
const SUMMARY_CUSTOMER_RE = /kupac|korisnica pita|korisnik pita/;

/** Skupina jednog analiziranog ticketa: ključ iz CATEGORIES ili EXCLUDED. */
function classifyRequest(row = {}) {
  const topic = String(row.topic || "").trim().toLowerCase();
  const summary = String(row.summary || "").toLowerCase();
  if (SUMMARY_NOISE_RE.test(summary) && !SUMMARY_CUSTOMER_RE.test(summary)) return "sum";
  for (const [key, re] of TOPIC_RULES) if (re.test(topic)) return key;
  return "ostalo";
}

function isCustomerQuery(category) {
  return !Object.prototype.hasOwnProperty.call(EXCLUDED, category);
}

/**
 * Ishod upita iz perspektive kupca:
 *   botSolved   — pisao je samo bot i odgovor je dobar (stvarna ušteda rada)
 *   botAssisted — bot je dao koristan dio odgovora, agent je dovršio
 *   botBad      — bot je sudjelovao, ali odgovor nije bio koristan
 *   humanOnly   — riješio je samo agent (bot nije pisao kupcu)
 * bot_quality 'na' znači da bot nije sudjelovao, pa mixed+na ide agentu.
 */
function outcomeOf(row = {}) {
  const handled = String(row.handled_by || "").trim().toLowerCase();
  const quality = String(row.bot_quality || "").trim().toLowerCase();
  if (handled === "bot") {
    if (quality === "good") return "botSolved";
    if (quality === "partial") return "botAssisted";
    return "botBad";
  }
  if (handled === "mixed") {
    if (quality === "good" || quality === "partial") return "botAssisted";
    if (quality === "bad") return "botBad";
  }
  return "humanOnly";
}

// ─── Agregacija (čista funkcija — bez mreže) ───────────────────

const QUALITIES = ["good", "partial", "bad", "na"];
const CHANNELS = ["web", "email", "facebook", "ostalo"];

function emptyQuality() {
  return { good: 0, partial: 0, bad: 0, na: 0 };
}

function emptyOutcomes() {
  return { botSolved: 0, botAssisted: 0, botBad: 0, humanOnly: 0 };
}

function emptySummary(range = { from: null, to: null }) {
  const byChannelOutcome = {}, byChannelQuality = {}, byChannel = {};
  for (const ch of CHANNELS) {
    byChannel[ch] = 0;
    byChannelOutcome[ch] = emptyOutcomes();
    byChannelQuality[ch] = emptyQuality();
  }
  const byCategory = {};
  for (const key of Object.keys(CATEGORIES)) byCategory[key] = { total: 0, botSolved: 0, kbGaps: 0 };
  return {
    total: 0,
    excluded: { sum: 0, bez_pitanja: 0 },
    customerQueries: 0,
    outcomes: emptyOutcomes(),
    botResolved: 0, humanHandled: 0, kbGaps: 0,
    byHandledBy: { bot: 0, human: 0, mixed: 0 },
    byQuality: emptyQuality(),
    byCategory,
    byChannel, byChannelOutcome, byChannelQuality,
    range,
    startDate: env.ANALYSIS_START_DATE || null
  };
}

// Mapira sirovi Zendesk via.channel u jedan od 4 prikazna kanala.
function bucketForChannel(raw) {
  const ch = String(raw || "").trim().toLowerCase();
  for (const [bucket, vias] of Object.entries(channelBuckets())) {
    if (vias.includes(ch)) return bucket;
  }
  return "ostalo";
}

/**
 * Zbraja redove ticket_analysis u brojke za dashboard.
 *
 * `total` su svi analizirani ticketi; postoci se računaju samo nad
 * `customerQueries` (bez spama, reklama i poruka bez pitanja). Invarijante:
 *   customerQueries + excluded.sum + excluded.bez_pitanja === total
 *   zbroj outcomes === customerQueries === zbroj byChannel
 *   botResolved + humanHandled === customerQueries
 *
 * "Bot riješio" je samo outcome botSolved — pisao je isključivo bot i odgovor
 * je dobar. Loš odgovor bota bez agenta nije ušteda rada.
 */
function tallySummary(rows = [], range = { from: null, to: null }) {
  const s = emptySummary(range);
  for (const r of rows || []) {
    s.total++;
    const category = classifyRequest(r);
    if (!isCustomerQuery(category)) { s.excluded[category]++; continue; }
    s.customerQueries++;

    const outcome = outcomeOf(r);
    s.outcomes[outcome]++;

    const handled = String(r?.handled_by || "").trim().toLowerCase();
    if (handled in s.byHandledBy) s.byHandledBy[handled]++;

    const quality = String(r?.bot_quality || "").trim().toLowerCase();
    const q = QUALITIES.includes(quality) ? quality : "na";
    s.byQuality[q]++;

    const bucket = bucketForChannel(r?.channel);
    s.byChannel[bucket]++;
    s.byChannelOutcome[bucket][outcome]++;
    s.byChannelQuality[bucket][q]++;

    const cat = s.byCategory[category];
    cat.total++;
    if (outcome === "botSolved") cat.botSolved++;
    if (r?.is_kb_gap === true) { s.kbGaps++; cat.kbGaps++; }
  }
  s.botResolved = s.outcomes.botSolved;
  s.humanHandled = s.customerQueries - s.botResolved;
  return s;
}

// Najčešća vrijednost u nizu stringova (prazne preskače).
function mostCommon(values) {
  const tally = new Map();
  for (const v of values) {
    const t = String(v || "").trim();
    if (t) tally.set(t, (tally.get(t) || 0) + 1);
  }
  let best = null, bestCount = 0;
  for (const [v, c] of tally) if (c > bestCount) { best = v; bestCount = c; }
  return best;
}

function clampLimit(limit, fallback, max) {
  return Math.min(Math.max(Number(limit) || fallback, 1), max);
}

/** Najčešće skupine upita kupaca, s udjelom i koliko ih bot riješi sam. */
function tallyTopQuestions(rows = [], limit = 10) {
  const groups = new Map();
  let customer = 0;
  for (const r of rows || []) {
    const category = classifyRequest(r);
    if (!isCustomerQuery(category)) continue;
    customer++;
    const g = groups.get(category) || { category, topic: CATEGORIES[category].label, count: 0, botSolved: 0, topics: [] };
    g.count++;
    if (outcomeOf(r) === "botSolved") g.botSolved++;
    g.topics.push(r.topic);
    groups.set(category, g);
  }
  return [...groups.values()]
    .map((g) => {
      const tally = new Map();
      for (const t of g.topics) { const k = String(t || "").trim(); if (k) tally.set(k, (tally.get(k) || 0) + 1); }
      const topTopics = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([topic, count]) => ({ topic, count }));
      return {
        category: g.category,
        topic: g.topic,
        count: g.count,
        share: customer ? g.count / customer : 0,
        botSolved: g.botSolved,
        botSolvedRate: g.count ? g.botSolved / g.count : 0,
        topTopics
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, clampLimit(limit, 10, 50));
}

/**
 * Rupe u bazi znanja po skupini — samo stvarni upiti kupaca (spam i poruke bez
 * pitanja nisu rupe). Svaka skupina nosi `fix`: što je zatvara.
 * Redovi moraju biti sortirani od najnovijeg (primjeri su najsvježiji).
 */
function tallyKbGaps(rows = [], limit = 10) {
  const groups = new Map();
  for (const r of rows || []) {
    if (r?.is_kb_gap !== true) continue;
    const category = classifyRequest(r);
    if (!isCustomerQuery(category)) continue;
    const g = groups.get(category) || { category, topic: CATEGORIES[category].label, fix: CATEGORIES[category].fix, count: 0, suggestions: [], examples: [] };
    g.count++;
    g.suggestions.push(r.suggested_kb_topic);
    if (g.examples.length < 3) g.examples.push({ ticket_id: r.ticket_id, summary: r.summary || null });
    groups.set(category, g);
  }
  return [...groups.values()]
    .map(({ suggestions, ...g }) => ({ ...g, suggested: mostCommon(suggestions) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, clampLimit(limit, 10, 50));
}

// ─── Dohvat ────────────────────────────────────────────────────

const PAGE_SIZE = 1000; // = Supabase max-rows; veći limit server ionako reže na 1000
const MAX_PAGES = 50; // 50k redova — zaštita od runawaya, daleko iznad realnog volumena

function rangeFilter({ from, to }) {
  let qs = "";
  if (from) qs += `&created_at=gte.${encodeURIComponent(from)}`;
  if (to) qs += `&created_at=lte.${encodeURIComponent(to)}`;
  return qs;
}

/**
 * Dohvaća SVE redove za razdoblje u stranicama. Agregacije se uvijek rade nad
 * cijelim skupom — jedan limitirani upit vraćao je samo prvih 1000 (teme) ili
 * zadnjih 500 (rupe) redova i davao krivu sliku.
 */
async function fetchRowsInRange(range, select, extraFilter = "") {
  const client = getClient();
  const filter = rangeFilter(range) + extraFilter;
  const rows = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const offset = page * PAGE_SIZE;
    const res = await client.get(
      `/rest/v1/ticket_analysis?select=${select}${filter}` +
      `&order=created_at.desc,ticket_id.desc&offset=${offset}&limit=${PAGE_SIZE}`
    );
    const batch = res.data || [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return rows;
}

const SUMMARY_COLUMNS = "created_at,channel,handled_by,bot_quality,is_kb_gap,topic,summary";

async function getSummary({ from = null, to = null } = {}) {
  const range = effectiveRange({ from, to });
  if (!isConfigured()) return emptySummary(range);
  const rows = await fetchRowsInRange(range, SUMMARY_COLUMNS);
  return tallySummary(rows, range);
}

async function getConversations({ limit = 20, from = null, to = null } = {}) {
  if (!isConfigured()) return [];
  const n = Math.min(Math.max(Number(limit) || 20, 1), 200);
  const filter = rangeFilter(effectiveRange({ from, to }));
  const res = await getClient().get(
    `/rest/v1/ticket_analysis?select=*${filter}&order=created_at.desc&limit=${n}`
  );
  return res.data || [];
}

async function getTopQuestions({ limit = 10, from = null, to = null } = {}) {
  if (!isConfigured()) return [];
  const rows = await fetchRowsInRange(effectiveRange({ from, to }), "topic,summary,handled_by,bot_quality");
  return tallyTopQuestions(rows, limit);
}

async function getKbGaps({ limit = 10, from = null, to = null } = {}) {
  if (!isConfigured()) return [];
  const rows = await fetchRowsInRange(
    effectiveRange({ from, to }),
    "topic,suggested_kb_topic,ticket_id,summary,is_kb_gap",
    "&is_kb_gap=eq.true"
  );
  return tallyKbGaps(rows, limit);
}

module.exports = {
  isConfigured,
  upsertAnalysis,
  getCursor,
  setCursor,
  getSummary,
  getConversations,
  getTopQuestions,
  getKbGaps,
  CATEGORIES,
  EXCLUDED,
  bucketForChannel,
  // Čiste funkcije — izložene radi testiranja bez mreže.
  normalizeRange,
  effectiveRange,
  startDateIso,
  classifyRequest,
  outcomeOf,
  tallySummary,
  tallyTopQuestions,
  tallyKbGaps,
  _setTestClient
};
