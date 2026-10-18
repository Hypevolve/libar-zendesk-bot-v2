/**
 * Test (P10): embeddings pozivi prema OpenRouteru nose iste postavke privatnosti
 * kao chat (openRouterPrivacy, OPENROUTER_PRIVACY). Provjerava pravo tijelo HTTP
 * zahtjeva koje OpenAI SDK šalje na /embeddings: presreće se fetchWithTimeout
 * SDK-a, mreža se ne dira.
 */
process.env.OPENROUTER_EMBEDDING_API_KEY = "sk-or-test-embeddings";

const test = require("node:test");
const assert = require("node:assert");
const OpenAI = require("openai");

const env = require("../config/env");
const { providerSettings } = require("../services/openRouterPrivacy");
const embeddingService = require("../services/embeddingService");

const MODEL = env.OPENROUTER_EMBEDDING_MODEL;

// OpenAI SDK traži base64 i sam ga dekodira u float32 niz.
function embeddingsResponse(inputs) {
  const vector = Buffer.from(new Float32Array([0.25, -0.5, 1]).buffer).toString("base64");
  return new Response(JSON.stringify({
    object: "list", model: MODEL,
    data: inputs.map((_, index) => ({ object: "embedding", index, embedding: vector })),
    usage: { prompt_tokens: 1, total_tokens: 1 }
  }), { status: 200, headers: { "content-type": "application/json" } });
}

function interceptOpenAI(t, respond = (body) => embeddingsResponse(body.input)) {
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

test("produkcijski embedding model nema EU ZDR endpoint: zdr + deny, bez order", () => {
  assert.strictEqual(MODEL, "openai/text-embedding-3-small");
  assert.deepStrictEqual(providerSettings(MODEL, "zdr"), { allow_fallbacks: true, data_collection: "deny", zdr: true });
});

test("embedText (upit kupca za RAG): /embeddings nosi provider s zdr i data_collection=deny", async (t) => {
  const calls = interceptOpenAI(t);
  const vector = await embeddingService.embedText("Koliko traje dostava na Krk?");
  assert.deepStrictEqual(vector, [0.25, -0.5, 1]);
  assert.strictEqual(calls.length, 1);
  assert.match(calls[0].url, /^https:\/\/openrouter\.ai\/api\/v1\/embeddings/);
  assert.strictEqual(calls[0].body.model, MODEL);
  assert.strictEqual(calls[0].body.dimensions, env.EMBEDDING_DIMENSIONS);
  assert.deepStrictEqual(calls[0].body.provider, providerSettings(MODEL, "zdr"));
  assert.strictEqual(calls[0].body.provider.zdr, true);
  assert.strictEqual(calls[0].body.provider.data_collection, "deny");
});

test("embedTexts (indeksiranje baze znanja): svaka serija nosi provider", async (t) => {
  const calls = interceptOpenAI(t);
  const texts = Array.from({ length: env.EMBEDDING_BATCH_SIZE + 1 }, (_, i) => `Dokument ${i}`);
  const vectors = await embeddingService.embedTexts(texts);
  assert.strictEqual(vectors.length, texts.length);
  assert.strictEqual(calls.length, 2, "dvije serije");
  for (const call of calls) assert.deepStrictEqual(call.body.provider, providerSettings(MODEL, "zdr"));
});

test("OPENROUTER_PRIVACY=deny šalje samo data_collection=deny; off bez provider", async (t) => {
  const calls = interceptOpenAI(t);
  await withPrivacyEnv("deny", () => embeddingService.embedText("x"));
  assert.strictEqual(calls[0].body.provider.data_collection, "deny");
  assert.ok(!("zdr" in calls[0].body.provider));
  await withPrivacyEnv("off", () => embeddingService.embedText("y"));
  assert.ok(!("provider" in calls[1].body));
});

test("izravni OpenAI API ne dobiva OpenRouterov provider", () => {
  const request = embeddingService.buildEmbeddingRequest(["x"], "openai");
  assert.ok(!("provider" in request));
  assert.deepStrictEqual(embeddingService.buildEmbeddingRequest(["x"], "openrouter").provider, providerSettings(MODEL, "zdr"));
});

test("bez ZDR endpointa: greška ide dalje (nema tihog slanja bez privatnosti)", async (t) => {
  const calls = interceptOpenAI(t, () => new Response(JSON.stringify({
    error: { code: 404, message: "No endpoints found matching your data policy (Zero data retention)." }
  }), { status: 404, headers: { "content-type": "application/json" } }));
  await assert.rejects(() => embeddingService.embedText("x"), /data policy/);
  assert.ok(calls.length >= 1);
  for (const call of calls) assert.strictEqual(call.body.provider.zdr, true, "ni ponovljeni pokušaj ne ide bez zdr");
});
