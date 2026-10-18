/**
 * Embedding Service (Skill §4 — Embedding Models)
 *
 * Supports OpenRouter and direct OpenAI providers.
 * Batched embedding with configurable dimensions.
 */
const OpenAI = require("openai");
const env = require("../config/env");
const log = require("../config/logger");
const { withPrivacy, isDataPolicyError, privacyMode } = require("./openRouterPrivacy");

function looksLikeOpenRouterKey(v) { return String(v || "").startsWith("sk-or-"); }

const OPENROUTER_KEY = String(
  process.env.OPENROUTER_EMBEDDING_API_KEY || env.OPENROUTER_API_KEY ||
  (looksLikeOpenRouterKey(env.OPENAI_API_KEY) ? env.OPENAI_API_KEY : "")
).trim();
const OPENAI_KEY = looksLikeOpenRouterKey(env.OPENAI_API_KEY) ? "" : env.OPENAI_API_KEY;

function resolveProvider() {
  const p = env.EMBEDDING_PROVIDER;
  if (p === "openrouter" || p === "openai") return p;
  if (OPENROUTER_KEY) return "openrouter";
  if (OPENAI_KEY) return "openai";
  return "openrouter";
}

const PROVIDER = resolveProvider();
const MODEL = PROVIDER === "openrouter"
  ? env.OPENROUTER_EMBEDDING_MODEL
  : env.OPENAI_EMBEDDING_MODEL;
const DIMS = env.EMBEDDING_DIMENSIONS;
const BATCH = env.EMBEDDING_BATCH_SIZE;

const clients = new Map();

function isConfigured() {
  return PROVIDER === "openrouter" ? Boolean(OPENROUTER_KEY) : Boolean(OPENAI_KEY);
}

function getClient() {
  if (!isConfigured()) {
    throw new Error(`${PROVIDER} API key required for embeddings.`);
  }
  if (!clients.has(PROVIDER)) {
    if (PROVIDER === "openrouter") {
      clients.set(PROVIDER, new OpenAI({
        apiKey: OPENROUTER_KEY,
        baseURL: "https://openrouter.ai/api/v1",
        defaultHeaders: {
          ...(env.OPENROUTER_SITE_URL ? { "HTTP-Referer": env.OPENROUTER_SITE_URL } : {}),
          ...(env.OPENROUTER_SITE_NAME ? { "X-Title": env.OPENROUTER_SITE_NAME } : {})
        }
      }));
    } else {
      clients.set(PROVIDER, new OpenAI({ apiKey: OPENAI_KEY }));
    }
  }
  return clients.get(PROVIDER);
}

function normalizeEmbeddingInput(v = "") {
  return String(v || "").replace(/\s+/g, " ").trim().slice(0, 8000);
}

/**
 * Tijelo jednog embeddings poziva. Prema OpenRouteru ide s istim postavkama
 * privatnosti kao chat (openRouterPrivacy, OPENROUTER_PRIVACY): u embeddinge idu
 * kupčeva pitanja i baza znanja. Izravni OpenAI API `provider` ne poznaje.
 */
function buildEmbeddingRequest(batch, provider = PROVIDER) {
  const request = { model: MODEL, input: batch };
  if (/(^|\/)text-embedding-3/.test(MODEL) && DIMS > 0) {
    request.dimensions = DIMS;
  }
  return provider === "openrouter" ? withPrivacy(request) : request;
}

async function embedTexts(texts = []) {
  const normalised = texts.map(normalizeEmbeddingInput).filter(Boolean);
  const embeddings = [];

  for (let i = 0; i < normalised.length; i += BATCH) {
    const batch = normalised.slice(i, i + BATCH);
    const request = buildEmbeddingRequest(batch);

    let response;
    try {
      response = await getClient().embeddings.create(request);
    } catch (error) {
      // Embedding model se ne može zamijeniti drugim (vektori u bazi su iz ovog),
      // pa nema fallbacka: zabilježi jasno zašto, i pusti grešku dalje.
      if (isDataPolicyError(error)) {
        log.error("embedding_private_endpoint_unavailable", { model: MODEL, privacy: privacyMode(), message: error.message });
      }
      throw error;
    }
    const rows = Array.isArray(response?.data) ? response.data : [];
    rows.sort((a, b) => (a.index || 0) - (b.index || 0));
    embeddings.push(...rows.map((r) => r.embedding));
  }

  return embeddings;
}

async function embedText(text = "") {
  const [embedding] = await embedTexts([text]);
  return embedding || null;
}

function getEmbeddingConfigSummary() {
  return {
    enabled: isConfigured(),
    provider: PROVIDER,
    model: MODEL,
    dimensions: DIMS,
    batchSize: BATCH
  };
}

function ping() {
  return { ok: isConfigured(), provider: PROVIDER, model: MODEL };
}

module.exports = { embedText, embedTexts, buildEmbeddingRequest, getEmbeddingConfigSummary, isConfigured, normalizeEmbeddingInput, ping };
