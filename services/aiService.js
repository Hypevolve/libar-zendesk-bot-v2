/**
 * AI Service (Skill §6, §12, §14, §17.4)
 *
 * Centralises all LLM interactions:
 * - Model fallback chain (primary → secondary → graceful error)
 * - Token budget checks before every call
 * - Usage recording for metrics
 * - Structured JSON parsing with robust extraction
 * - Context relevance grading (Agentic RAG pattern)
 * - Standalone query rewriting (multi-turn support)
 * - Grounded answer generation
 * - Spam classification
 */
const OpenAI = require("openai");
const env = require("../config/env");
const log = require("../config/logger");
const tokenBudget = require("./tokenBudgetService");

// ─── Client ───────────────────────────────────────────────────

if (!env.OPENROUTER_API_KEY) {
  log.warn("openrouter_api_key_missing", "OPENROUTER_API_KEY not configured. LLM calls will fail.");
}

const client = new OpenAI({
  apiKey: env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
  timeout: 15000,
  defaultHeaders: {
    ...(env.OPENROUTER_SITE_URL ? { "HTTP-Referer": env.OPENROUTER_SITE_URL } : {}),
    ...(env.OPENROUTER_SITE_NAME ? { "X-Title": env.OPENROUTER_SITE_NAME } : {})
  }
});

// ─── Model Fallback ───────────────────────────────────────────

function getConfiguredModels() {
  const models = [
    env.OPENROUTER_MODEL,
    env.OPENROUTER_FALLBACK_MODEL
  ].filter(Boolean);
  if (models.length === 0) {
    log.warn("no_models_configured", "Using default fallback model. Set OPENROUTER_MODEL env var.");
    models.push("openai/gpt-4.1-mini");
  }
  return [...new Set(models)];
}

function getConfiguredModel() {
  return getConfiguredModels()[0];
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Run a function against each model with retry.
 * Records token usage from response.
 */
async function runWithModelFallback(execute, { purpose = "AI request", maxAttemptsPerModel = 1 } = {}) {
  let lastError = null;

  for (const model of getConfiguredModels()) {
    for (let attempt = 1; attempt <= maxAttemptsPerModel; attempt++) {
      try {
        const result = await execute(model);
        return result;
      } catch (error) {
        lastError = error;
        log.warn("model_attempt_failed", {
          purpose, model, attempt,
          message: error.message,
          status: error.status
        });
        if (attempt < maxAttemptsPerModel) await wait(1000 * attempt);
      }
    }
  }

  throw lastError || new Error(`${purpose} failed for all models.`);
}

/**
 * Wrapper that adds token budget check + usage recording.
 */
async function llmCall(systemPrompt, userMessage, { purpose, temperature = 0, maxTokens, extraMessages = [], jsonMode = false, maxAttemptsPerModel = 1 } = {}) {
  // Token budget gate (Skill §9)
  const budget = tokenBudget.checkBudget(systemPrompt, userMessage, extraMessages);
  if (!budget.withinBudget) {
    throw new Error(`Token budget exceeded: ${budget.estimatedTokens} > ${budget.limit}`);
  }

  return runWithModelFallback(async (model) => {
    const messages = [
      { role: "system", content: systemPrompt },
      ...extraMessages.map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: String(m.content || "").trim()
      })),
      { role: "user", content: String(userMessage || "").trim() }
    ];

    const request = { model, temperature, messages };
    if (maxTokens) request.max_tokens = maxTokens;

    let completion;
    if (jsonMode) {
      try {
        completion = await client.chat.completions.create({
          ...request,
          response_format: { type: "json_object" }
        });
      } catch (err) {
        if (err?.status === 400 || /response_format|json_object/i.test(err?.message || "")) {
          completion = await client.chat.completions.create(request);
        } else {
          throw err;
        }
      }
    } else {
      completion = await client.chat.completions.create(request);
    }

    // Record usage (Skill §9)
    const usage = completion.usage;
    if (usage) {
      tokenBudget.recordUsage(usage.prompt_tokens || 0, usage.completion_tokens || 0);
    }

    const content = completion.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error(`${purpose || "LLM"} returned empty response.`);

    return content;
  }, { purpose, maxAttemptsPerModel });
}

// ─── Channel Instructions ─────────────────────────────────────

function normalizeChannelType(channelType = "") {
  const n = String(channelType).trim().toLowerCase();
  if (["web_chat", "webchat", "web", "web_widget"].includes(n)) return "web_chat";
  if (["facebook", "messenger", "facebook_messenger", "facebook_post", "facebook_page"].includes(n)) return "facebook";
  if (["email", "mail"].includes(n)) return "email";
  return "unknown";
}

function buildChannelInstructions(channelType = "unknown") {
  const ct = normalizeChannelType(channelType);
  if (ct === "facebook") return [
    "KANAL: Facebook",
    "- Odgovor kratk i razgovoran, ali profesionalan. Najviše 3 kratke rečenice.",
    "- Ne koristi web-chat formulacije."
  ];
  if (ct === "email") return [
    "KANAL: Email",
    "- Piši kao prirodan support email. Pune, jasne rečenice.",
    "- Ne generiraj subject ni potpis."
  ];
  if (ct === "web_chat") return [
    "KANAL: Web chat",
    "- Odgovor kraći i direktniji kao u live chatu."
  ];
  return ["KANAL: Zendesk podrška", "- Prirodan i kratak odgovor."];
}

// ─── Reference Facts ──────────────────────────────────────────

const REFERENTNE_CINJENICE = [
  "REFERENTNE ČINJENICE (koristi samo ako su relevantne za korisnikov upit):",
  "- Dostava GLS na kućnu adresu: 5,97 EUR",
  "- Dostava u GLS paketomat: 3,75 EUR",
  "- Dostava u BoxNow paketomat: 3,25 EUR",
  "- Osobno preuzimanje u Osijeku: besplatno",
  "- Rok dostave: 1–2 radna dana (do 48 sati)",
  "- Radno vrijeme: ponedjeljak–petak 08:00–20:00, subota 08:00–13:00, nedjeljom i blagdanima ne rade",
  "- Adresa poslovnice: Županijska ulica 17, 31000 Osijek",
  "- Email: info@antikvarijat-libar.com",
  "- Telefon: 031/201-230",
  "- Online plaćanje: pouzeće putem GLS-a ili CorvusPay",
  "- Plaćanje u poslovnici: gotovina, MasterCard, Maestro, Visa",
  "- Plaćanje na rate (obročno/rate): Zaba i PBZ kartice do 6 rata u poslovnici",
  "- SJEDI 5 program vjernosti: 5 prodanih udžbenika = besplatna dostava za taj nalog otkupa, 8 = 5% popust na kupnju, 11 = 10% popust na cijelu kupnju",
  "- Otkup dostava: 4 ili više udžbenika besplatno, manje od 4 = 3,00 EUR (odbija se od iznosa otkupa)",
  "- Online otkup: zapakirajte knjige u kutiju ili vrećicu, GLS kurir dolazi po paket na kućnu adresu",
  "- Otkup putem GLS dostavne službe; korisnik upisuje OIB i IBAN za isplatu",
  "- Fizički otkup u poslovnici: donijeti udžbenike za srednju školu i osobnu iskaznicu",
  "- Naručivanje udžbenika: putem webshop tražilice na antikvarijat-libar.com ili emailom na info@antikvarijat-libar.com",
  "- Provjera dostupnosti knjiga: webshop tražilica i pretraživanje po naslovu, autoru ili ISBN, dostupnost na stranici artikla",
  "- Povrat knjige u poslovnici: 14 dana od kupnje, donijeti račun i knjigu, zamjena ili povrat novca odmah",
  "- Reklamacije oštećene knjige: podnijeti reklamaciju s fotografijom oštećenja i računom na email info@antikvarijat-libar.com ili donijeti u poslovnicu",
  "- Isplata putem Aircash nije dostupna",
  "- Jednostrani raskid online kupnje: 14 dana od primitka robe, trošak povrata snosi kupac",
  "- Odgovor na upite: najkasnije 24 sata / 1 radni dan",
  "- Trgovac: Dante d.o.o., OIB: 20816309823"
].join("\n");

// ─── Prompts ──────────────────────────────────────────────────

function buildGroundedAnswerPrompt(context, { channelType = "unknown", customerName = "", conversationSummary = "" } = {}) {
  return [
    "Ti si Libar Asistent, AI agent korisničke podrške Antikvarijata Libar.",
    "UVIJEK odgovaraj na hrvatskom jeziku, osim ako korisnik izričito traži drugi jezik.",
    "",
    "Zadatak ti je napisati kratak, koristan i prirodan odgovor korisniku isključivo na temelju dostavljenog konteksta.",
    "",
    "STIL KOMUNIKACIJE:",
    "- Koristi ljubazan, profesionalan i jasan ton.",
    "- Obraćaj se korisniku s Vi.",
    "- Budi sažet, ali ne štur.",
    "- Prvo daj odgovor, a zatim kratko pojašnjenje ili sljedeći korak.",
    "- Koristi puni naziv Antikvarijat Libar barem jednom u svakom odgovoru.",
    "",
    "IZVOR ISTINE — STROGA PRAVILA:",
    "- Tvoj JEDINI izvor istine je dostavljen kontekst ispod.",
    "- Ako postoji razlika između tvog općeg znanja i konteksta, UVIJEK vjeruj kontekstu.",
    "- Koristi samo informacije koje su izravno podržane kontekstom.",
    "- Ne izmišljaj dodatne informacije i ne popunjavaj praznine pretpostavkama.",
    "- Sve činjenice prepiši TOČNO kako pišu u kontekstu.",
    "- Ne spominji AI, kontekst, bazu znanja, OneDrive, SharePoint, Zendesk ni interne procese.",
    "- Ne generiraj subject ni potpis.",
    "- Ako odgovor nije potvrđen iz konteksta, reci: Ne mogu to pouzdano potvrditi iz dostupnih informacija. Mogu Vas uputiti na podršku.",
    "",
    "PRAVILA ZA KUPNJU I KATALOG:",
    "- Ako korisnik pita kako kupiti udžbenike, objasni korake i uputi ga na pretragu webshopa.",
    "- Ako korisnik pita za točno određeni naslov ili dostupnost, nemoj izmišljati stanje zalihe.",
    "",
    "PRAVILA ZA OTKUP:",
    "- Ako korisnik pita kako funkcionira otkup, objasni opći proces i uvjete iz konteksta.",
    "- Ako je upit izvan potvrđenih pravila otkupa, reci da je potrebna provjera podrške.",
    "",
    "PRAVILA ZA NARUDŽBE:",
    "- Nikada ne tvrdi da si provjerio status narudžbe.",
    "- Nikada ne tvrdi da si otkazao, izmijenio ili spojio narudžbu.",
    "- Možeš objasniti proces, ali ne smiješ glumiti pristup internom sustavu.",
    "",
    "PRAVILA ZA REKLAMACIJE:",
    "- Kod reklamacije, povrata ili problema, usmjeri na ljudsku podršku.",
    "",
    "PRAVILA ZA POPUSTE I AKCIJE:",
    "- Odgovaraj samo o popustima i loyalty pravilima potvrđenima u kontekstu.",
    "- Ne obećavaj popust ili akciju koja nije eksplicitno navedena.",
    "",
    "ZABRANE:",
    "- Ne izmišljaj raspoloživost artikala, cijene, statuse narudžbe ili operativne iznimke.",
    "- Ne traži broj kartice, CVV, lozinke ili osjetljive podatke.",
    "- Ne tvrdi da je radnja izvršena ako nemaš alat i potvrdu.",
    "",
    "KRITIČNO — RELEVANTNOST KONTEKSTA:",
    "- Ako korisnik pita o temi A, a kontekst govori o temi B, IGNORIRAJ kontekst.",
    "- U tom slučaju reci: Ne mogu to pouzdano potvrditi iz dostupnih informacija.",
    "- NE odgovaraj na temelju nerelevantnog konteksta pod bilo kojim uvjetima.",
    "",
    "FORMAT ODGOVORA:",
    "- Za jednostavna pitanja odgovori u jednom kratkom odlomku.",
    "- Za upute koristi kratke numerirane korake (1. 2. 3.).",
    "- Koristi podebljani tekst za ključne pojmove.",
    "- Piši kratke paragrafe od 1-2 rečenice.",
    "",
    customerName ? `KORISNIK: Korisnik se zove ${customerName}. Ime koristi samo ako zvuči prirodno.` : "",
    "- Vrati samo gotov odgovor za korisnika, bez JSON-a i bez dodatnih oznaka.",
    "",
    REFERENTNE_CINJENICE,
    "",
    ...buildChannelInstructions(channelType),
    "",
    conversationSummary ? `SAŽETAK RAZGOVORA:\n${conversationSummary}` : "",
    "",
    "KONTEKST:",
    context || "Nema pronađenog konteksta."
  ].filter(Boolean).join("\n");
}

function buildSystemPrompt(context, { channelType = "unknown", conversationSummary = "", customerName = "", standaloneQuery = "" } = {}) {
  return [
    "Ti si Libar Asistent, AI agent korisničke podrške Antikvarijata Libar.",
    "UVIJEK odgovaraj na hrvatskom jeziku, osim ako korisnik izričito traži drugi jezik.",
    "",
    "TVOJA ULOGA:",
    "- Pomažeš korisnicima oko kupnje i otkupa rabljenih udžbenika.",
    "- Odgovaraš na pitanja o dostavi, plaćanju, preuzimanju, reklamacijama, povratima, rokovima, kontaktu, lokacijama, radnom vremenu, programu vjernosti i općim pravilima.",
    "- Vodiš korisnika do konkretnog sljedećeg koraka bez izmišljanja informacija.",
    "",
    "IZVOR ISTINE — STROGA PRAVILA:",
    "- Tvoj JEDINI izvor istine je dostavljen kontekst ispod.",
    "- Ne izmišljaj informacije i ne koristi opće znanje za popunjavanje praznina.",
    "- Sve činjenice prepiši TOČNO kako pišu u kontekstu.",
    "- Ne spominji AI, prompt, kontekst, bazu znanja, Zendesk, OneDrive ni interne procese.",
    "- Ako odgovor nije potvrđen iz konteksta, reci: Ne mogu to pouzdano potvrditi iz dostupnih informacija.",
    "",
    "KRITIČNO — RELEVANTNOST:",
    "- Ako kontekst ne pokriva korisnikovo pitanje, NE koristi kontekst za odgovor.",
    "",
    "ESKALACIJSKA PRAVILA:",
    "- Reklamacija, krive knjige, povrat novca, pravna prijetnja → hard_handoff.",
    "- Nedovoljno sigurno podržan kontekstom → soft_handoff.",
    "- Nedostaje ključan podatak → ask_clarifying_question.",
    "",
    "ZABRANE:",
    "- Ne izmišljaj raspoloživost, cijene, statuse narudžbe.",
    "- Ne traži osjetljive podatke.",
    "- Ne tvrdi da je radnja izvršena.",
    "",
    ...buildChannelInstructions(channelType),
    "",
    conversationSummary ? `SAŽETAK RAZGOVORA:\n${conversationSummary}` : "",
    customerName ? `KORISNIK: ${customerName}` : "",
    standaloneQuery ? `STANDALONE UPIT: ${standaloneQuery}` : "",
    "",
    REFERENTNE_CINJENICE,
    "",
    "FORMAT IZLAZA:",
    "Vrati isključivo valjani JSON objekt:",
    '{ "decision": "safe_answer"|"ask_clarifying_question"|"soft_handoff"|"hard_handoff",',
    '  "reply": "string", "clarifying_question": "string", "reason": "string" }',
    "",
    "KONTEKST:",
    context || "Nema pronađenog konteksta."
  ].filter(Boolean).join("\n");
}

// ─── JSON Extraction ──────────────────────────────────────────

function extractJsonObject(rawText = "") {
  const trimmed = String(rawText).trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first === -1 || last <= first) return null;
  return trimmed.slice(first, last + 1);
}

function normalizeAiDecision(parsed) {
  const decision = String(parsed?.decision || "").trim();
  const reply = typeof parsed?.reply === "string" ? parsed.reply.trim() : "";
  const clarifyingQuestion = typeof parsed?.clarifying_question === "string" ? parsed.clarifying_question.trim() : "";
  const reason = typeof parsed?.reason === "string" ? parsed.reason.trim() : "";

  if (!["safe_answer", "ask_clarifying_question", "soft_handoff", "hard_handoff"].includes(decision)) {
    throw new Error("AI response used an unsupported decision.");
  }
  if (decision === "safe_answer" && !reply) throw new Error("AI safe_answer without reply.");
  if (decision === "ask_clarifying_question" && !clarifyingQuestion && !reply) {
    throw new Error("AI clarify without question.");
  }

  return { decision, reply, clarifyingQuestion: clarifyingQuestion || reply, reason: reason || "unspecified" };
}

function buildFallbackDecision(reason = "ai_generation_failed") {
  return { decision: "soft_handoff", reply: "", reason };
}

// ─── Public API ───────────────────────────────────────────────

/**
 * Context Relevance Grading (Skill §17.4 — Agentic RAG)
 * Lightweight LLM call to check if retrieved context matches the query.
 */
async function gradeContextRelevance(userMessage, context) {
  if (!context || !userMessage) return { relevant: false, reason: "missing_input" };

  try {
    const reply = await llmCall(
      [
        "Ti si sustav za ocjenu relevantnosti konteksta.",
        "Dobivši korisnikovo pitanje i dohvaćeni kontekst, odredi sadrži li kontekst informacije koje IZRAVNO odgovaraju na pitanje.",
        "Odgovori SAMO jednom riječju: DA ili NE.",
        "DA = kontekst sadrži relevantne informacije za odgovor.",
        "NE = kontekst govori o nečem drugom."
      ].join("\n"),
      `PITANJE: ${String(userMessage).slice(0, 300)}\n\nKONTEKST:\n${String(context).slice(0, 1500)}`,
      { purpose: "context_relevance_grading", maxTokens: 10, maxAttemptsPerModel: 1 }
    );

    const isRelevant = reply.toUpperCase().startsWith("DA");
    return { relevant: isRelevant, reason: isRelevant ? "context_matches" : "context_mismatch" };
  } catch (error) {
    log.error("context_relevance_grading_failed", { message: error.message });
    return { relevant: true, reason: "grading_error_default_pass" };
  }
}

/**
 * Standalone Query Rewriting (Skill §17.4 — Self-correction)
 */
async function rewriteStandaloneQuery(message, recentMessages = []) {
  if (!Array.isArray(recentMessages) || recentMessages.length === 0) {
    return String(message || "").trim();
  }

  try {
    const historyBlock = recentMessages
      .map((m) => `${m.role === "assistant" ? "Asistent" : "Korisnik"}: ${String(m.content || "").slice(0, 200)}`)
      .join("\n");

    return await llmCall(
      [
        "Ti si pomoćni sustav za prepisivanje upita.",
        "Na temelju prethodnog razgovora i najnovije korisnikove poruke, prepiši je u samostalan upit za pretraživanje baze znanja.",
        "Zadrži hrvatski jezik. Zadrži ključne pojmove, nazive, brojeve.",
        "Ako je poruka već samostalna, vrati je nepromijenjenu.",
        "Vrati SAMO prepisani upit, bez objašnjenja.",
        "",
        "PRETHODNI RAZGOVOR:",
        historyBlock || "Nema prethodnog razgovora."
      ].join("\n"),
      String(message || "").trim(),
      { purpose: "standalone_query_rewrite", maxAttemptsPerModel: 1 }
    );
  } catch (error) {
    log.error("standalone_query_rewrite_failed", { message: error.message });
    return String(message || "").trim();
  }
}

/**
 * Grounded Answer Generation (Skill §6 — Basic RAG Chain)
 */
async function generateGroundedAnswer(message, context, options = {}) {
  try {
    // Reserve tokens for: large system prompt (~1800 tok) + message + output margin (~200 tok)
    const reservedTokens = tokenBudget.estimateTokens(message) + 2000;
    const trimmedContext = tokenBudget.trimContextToBudget(context, reservedTokens);

    return await llmCall(
      buildGroundedAnswerPrompt(trimmedContext, options),
      String(message || "").trim(),
      {
        purpose: "grounded_answer",
        extraMessages: Array.isArray(options.messages) ? options.messages : []
      }
    );
  } catch (error) {
    log.error("grounded_answer_failed", { message: error.message });
    return "";
  }
}

/**
 * Structured Reply Generation (decision JSON)
 */
async function generateReply(message, context, options = {}) {
  try {
    const raw = await llmCall(
      buildSystemPrompt(context, options),
      message,
      { purpose: "structured_reply", jsonMode: true, maxAttemptsPerModel: 2 }
    );

    const jsonPayload = extractJsonObject(raw);
    if (!jsonPayload) throw new Error("AI response did not contain valid JSON.");
    return normalizeAiDecision(JSON.parse(jsonPayload));
  } catch (error) {
    if (/unsupported decision|without reply|without question|SyntaxError/.test(error.message)) {
      log.error("structured_reply_parse_error", { message: error.message });
      return buildFallbackDecision("invalid_structured_output");
    }
    log.error("structured_reply_failed", { message: error.message });
    return buildFallbackDecision("ai_generation_failed");
  }
}

/**
 * Spam Classification
 */
async function classifySpamCandidate(message, options = {}) {
  try {
    const raw = await llmCall(
      [
        "Ti si strogi klasifikator dolaznih poruka za korisničku podršku.",
        `Kanal: ${normalizeChannelType(options.channelType)}`,
        "Vrati isključivo JSON objekt:",
        '{ "label": "support_message"|"sales_outreach"|"marketing_spam"|"phishing_or_malicious"|"unknown",',
        '  "confidence": 0.0, "reason": "string" }'
      ].join("\n"),
      String(message || "").slice(0, 3500),
      { purpose: "spam_classification", jsonMode: true }
    );

    const jsonPayload = extractJsonObject(raw);
    if (!jsonPayload) throw new Error("Spam classification: no JSON.");
    const parsed = JSON.parse(jsonPayload);

    const label = String(parsed?.label || "unknown").trim();
    const confidence = Number(parsed?.confidence);
    return {
      label: ["support_message", "sales_outreach", "marketing_spam", "phishing_or_malicious", "unknown"].includes(label) ? label : "unknown",
      confidence: Number.isFinite(confidence) ? confidence : 0,
      reason: String(parsed?.reason || "unspecified").trim()
    };
  } catch (error) {
    log.error("spam_classification_failed", { message: error.message });
    return { label: "unknown", confidence: 0, reason: "classification_error" };
  }
}

module.exports = {
  buildFallbackDecision,
  buildGroundedAnswerPrompt,
  buildSystemPrompt,
  classifySpamCandidate,
  generateGroundedAnswer,
  generateReply,
  getConfiguredModel,
  getConfiguredModels,
  gradeContextRelevance,
  normalizeChannelType,
  rewriteStandaloneQuery,
  REFERENTNE_CINJENICE
};
