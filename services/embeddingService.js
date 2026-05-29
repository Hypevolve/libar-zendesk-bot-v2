/**
 * Embedding Service (Skill §4 — Embedding Models)
 *
 * Supports OpenRouter and direct OpenAI providers.
 * Batched embedding with configurable dimensions.
 */
const OpenAI = require("openai");
const env = require("../config/env");
const log = require("../config/logger");

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

async function embedTexts(texts = []) {
  const normalised = texts.map(normalizeEmbeddingInput).filter(Boolean);
  const embeddings = [];

  for (let i = 0; i < normalised.length; i += BATCH) {
    const batch = normalised.slice(i, i + BATCH);
    const request = { model: MODEL, input: batch };
    if (/(^|\/)text-embedding-3/.test(MODEL) && DIMS > 0) {
      request.dimensions = DIMS;
    }

    const response = await getClient().embeddings.create(request);
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

module.exports = { embedText, embedTexts, getEmbeddingConfigSummary, isConfigured, normalizeEmbeddingInput };
