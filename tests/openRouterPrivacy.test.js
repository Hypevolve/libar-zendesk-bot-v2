/**
 * Test: postavke privatnosti prema OpenRouteru (services/openRouterPrivacy.js).
 * Osim čistih funkcija provjerava i pravo tijelo HTTP zahtjeva koje OpenAI SDK
 * šalje na /chat/completions (aiService i analiza ticketa): presreće se
 * fetchWithTimeout SDK-a, mreža se ne dira.
 */
const test = require("node:test");
const assert = require("node:assert");
const OpenAI = require("openai");

const env = require("../config/env");
const {
  privacyMode, providerSettings, withPrivacy, isDataPolicyError, EU_ZDR_ENDPOINTS
} = require("../services/openRouterPrivacy");
const aiService = require("../services/aiService");
const ticketAnalysisService = require("../services/ticketAnalysisService");

const PRIMARY = env.OPENROUTER_MODEL;
const FALLBACK = env.OPENROUTER_FALLBACK_MODEL;

function completion(content, model) {
  return new Response(JSON.stringify({
    id: "cmpl-test", object: "chat.completion", created: 0, model,
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }],
    usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 }
  }), { status: 200, headers: { "content-type": "application/json" } });
}

// Presretni sve HTTP pozive OpenAI SDK-a; `respond(body)` vraća Response.
function interceptOpenAI(t, respond) {
  const calls = [];
  const proto = Object.getPrototypeOf(OpenAI.prototype);
  t.mock.method(proto, "fetchWithTimeout", async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url: String(url), body });
    return respond(body, calls.length);
  });
  return calls;
}

function withPrivacyEnv(value, fn) {
  const prev = env.OPENROUTER_PRIVACY;
  env.OPENROUTER_PRIVACY = value;
  return Promise.resolve().then(fn).finally(() => { env.OPENROUTER_PRIVACY = prev; });
}

// ─── Mod ───────────────────────────────────────────────────────

test("privacyMode: default zdr, deny/off po izboru, sve ostalo zdr", () => {
  assert.strictEqual(privacyMode(""), "zdr");
  assert.strictEqual(privacyMode(undefined), "zdr");
  assert.strictEqual(privacyMode("zdr"), "zdr");
  assert.strictEqual(privacyMode(" DENY "), "deny");
  assert.strictEqual(privacyMode("off"), "off");
  assert.strictEqual(privacyMode("on"), "zdr");
  assert.strictEqual(privacyMode("zrd"), "zdr", "tipfeler = najstrože");
  assert.strictEqual(env.OPENROUTER_PRIVACY, "zdr", "default u config/env.js");
});

test("providerSettings: zdr + deny, EU endpoint prvi gdje postoji", () => {
  assert.deepStrictEqual(providerSettings("google/gemini-3.5-flash-lite", "zdr"), {
    order: ["google-vertex/eu"], allow_fallbacks: true, data_collection: "deny", zdr: true
  });
  assert.deepStrictEqual(providerSettings("openai/gpt-4o-mini", "zdr").order, ["azure/swedencentral"]);
  // gpt-4o ima jedan ZDR endpoint (azure) bez EU regije → nema order, OpenRouter bira među ZDR.
  assert.deepStrictEqual(providerSettings("openai/gpt-4o", "zdr"), {
    allow_fallbacks: true, data_collection: "deny", zdr: true
  });
  assert.deepStrictEqual(providerSettings("google/gemini-3.5-flash-lite", "deny"), {
    order: ["google-vertex/eu"], allow_fallbacks: true, data_collection: "deny"
  });
  assert.strictEqual(providerSettings("openai/gpt-4o", "off"), undefined);
});

test("EU mapa pokriva fallback model", () => {
  assert.strictEqual(EU_ZDR_ENDPOINTS[FALLBACK], "google-vertex/eu");
});

test("withPrivacy: off ne dira zahtjev; vlastiti order ostaje, privatnost pobjeđuje", () => {
  const req = { model: "openai/gpt-4o", messages: [] };
  assert.strictEqual(withPrivacy(req, "off"), req);
  const own = withPrivacy({ model: "google/gemini-3.5-flash-lite", provider: { order: ["google-vertex"], data_collection: "allow", zdr: false } }, "zdr");
  assert.deepStrictEqual(own.provider, { order: ["google-vertex"], allow_fallbacks: true, data_collection: "deny", zdr: true });
});

test("isDataPolicyError prepoznaje OpenRouterovu grešku politike podataka", () => {
  assert.ok(isDataPolicyError(new Error("No endpoints found matching your data policy (Zero data retention).")));
  assert.ok(!isDataPolicyError(new Error("Rate limit exceeded")));
  assert.ok(!isDataPolicyError(undefined));
});

// ─── Pravo tijelo zahtjeva ─────────────────────────────────────

test("aiService: chat completion na OpenRouter nosi provider s zdr i data_collection=deny", async (t) => {
  const calls = interceptOpenAI(t, (body) => completion("DA", body.model));
  const res = await aiService.gradeContextRelevance("Koliko košta dostava?", "Dostava u GLS paketomat: 3,75 EUR");
  assert.strictEqual(res.relevant, true);
  assert.strictEqual(calls.length, 1);
  assert.match(calls[0].url, /^https:\/\/openrouter\.ai\/api\/v1\/chat\/completions/);
  assert.strictEqual(calls[0].body.model, PRIMARY);
  assert.deepStrictEqual(calls[0].body.provider, providerSettings(PRIMARY, "zdr"));
  assert.strictEqual(calls[0].body.provider.zdr, true);
  assert.strictEqual(calls[0].body.provider.data_collection, "deny");
});

test("aiService: model bez ZDR endpointa → odmah sljedeći model, s EU endpointom prvim", async (t) => {
  const calls = interceptOpenAI(t, (body, n) => n === 1
    ? new Response(JSON.stringify({ error: { code: 404, message: "No endpoints found matching your data policy (Zero data retention)." } }),
      { status: 404, headers: { "content-type": "application/json" } })
    : completion("DA", body.model));
  const res = await aiService.gradeContextRelevance("Radno vrijeme?", "Pon–pet 08–20");
  assert.strictEqual(res.relevant, true);
  assert.deepStrictEqual(calls.map((c) => c.body.model), [PRIMARY, FALLBACK]);
  assert.deepStrictEqual(calls[1].body.provider, {
    order: ["google-vertex/eu"], allow_fallbacks: true, data_collection: "deny", zdr: true
  });
});

test("aiService: OPENROUTER_PRIVACY=off šalje zahtjev bez provider", async (t) => {
  const calls = interceptOpenAI(t, (body) => completion("NE", body.model));
  await withPrivacyEnv("off", () => aiService.gradeContextRelevance("x", "y"));
  assert.strictEqual(calls.length, 1);
  assert.ok(!("provider" in calls[0].body));
});

test("aiService: OPENROUTER_PRIVACY=deny šalje samo data_collection=deny", async (t) => {
  const calls = interceptOpenAI(t, (body) => completion("NE", body.model));
  await withPrivacyEnv("deny", () => aiService.gradeContextRelevance("x", "y"));
  assert.strictEqual(calls[0].body.provider.data_collection, "deny");
  assert.ok(!("zdr" in calls[0].body.provider));
});

test("analiza ticketa: poziv nosi provider s zdr i EU endpointom za ANALYSIS_MODEL", async (t) => {
  const calls = interceptOpenAI(t, (body) => completion(JSON.stringify({ topic: "dostava", handled_by: "bot" }), body.model));
  const row = await ticketAnalysisService.analyzeOne(
    { id: 1, subject: "Dostava", channel: "email", requester_id: 7 },
    [{ author_id: 7, body: "Koliko košta dostava?", public: true }]
  );
  assert.strictEqual(row.topic, "dostava");
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].body.model, env.ANALYSIS_MODEL);
  assert.deepStrictEqual(calls[0].body.response_format, { type: "json_object" });
  assert.deepStrictEqual(calls[0].body.provider, providerSettings(env.ANALYSIS_MODEL, "zdr"));
  assert.deepStrictEqual(calls[0].body.provider.order, ["google-vertex/eu"]);
});
