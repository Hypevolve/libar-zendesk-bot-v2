/**
 * Centralised environment configuration.
 * Every env variable is read here once, validated, and exported.
 * Services import from this module instead of reading process.env directly.
 */
require("dotenv").config();

function envStr(key, fallback = "") {
  return String(process.env[key] ?? fallback).trim();
}

function envInt(key, fallback) {
  const v = Number(process.env[key]);
  return Number.isFinite(v) ? v : fallback;
}

function envBool(key, fallback = false) {
  const v = envStr(key).toLowerCase();
  if (v === "") return fallback;
  return v === "true" || v === "1";
}

module.exports = {
  NODE_ENV: envStr("NODE_ENV", "production"),
  IS_TEST: process.env.NODE_ENV === "test",
  PORT: envInt("PORT", 3000),

  // --- Zendesk ---
  ZENDESK_SUBDOMAIN: envStr("ZENDESK_SUBDOMAIN"),
  ZENDESK_EMAIL: envStr("ZENDESK_EMAIL"),
  ZENDESK_API_TOKEN: envStr("ZENDESK_API_TOKEN"),
  ZENDESK_WEBHOOK_TOKEN: envStr("ZENDESK_WEBHOOK_TOKEN"),

  // --- OpenRouter / LLM ---
  OPENROUTER_API_KEY: envStr("OPENROUTER_API_KEY"),
  OPENROUTER_MODEL: envStr("OPENROUTER_MODEL", "openai/gpt-4.1-mini"),
  OPENROUTER_FALLBACK_MODEL: envStr("OPENROUTER_FALLBACK_MODEL", "google/gemini-2.5-flash"),
  OPENROUTER_SITE_URL: envStr("OPENROUTER_SITE_URL"),
  OPENROUTER_SITE_NAME: envStr("OPENROUTER_SITE_NAME", "Antikvarijat Libar Bot"),

  // --- Embeddings ---
  EMBEDDING_PROVIDER: envStr("EMBEDDING_PROVIDER", "openrouter"),
  OPENROUTER_EMBEDDING_MODEL: envStr("OPENROUTER_EMBEDDING_MODEL", "openai/text-embedding-3-small"),
  OPENAI_API_KEY: envStr("OPENAI_API_KEY"),
  OPENAI_EMBEDDING_MODEL: envStr("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small"),
  EMBEDDING_DIMENSIONS: envInt("EMBEDDING_DIMENSIONS", 1536),
  EMBEDDING_BATCH_SIZE: envInt("EMBEDDING_BATCH_SIZE", 64),

  // --- Supabase / Vector ---
  SUPABASE_URL: envStr("SUPABASE_URL"),
  SUPABASE_SERVICE_ROLE_KEY: envStr("SUPABASE_SERVICE_ROLE_KEY"),
  VECTOR_MATCH_COUNT: envInt("VECTOR_MATCH_COUNT", 8),
  VECTOR_MIN_SCORE: parseFloat(process.env.VECTOR_MIN_SCORE || "0.68"),
  VECTOR_CONTEXT_ITEMS: envInt("VECTOR_CONTEXT_ITEMS", 5),
  VECTOR_CHUNK_MAX_CHARS: envInt("VECTOR_CHUNK_MAX_CHARS", 1200),
  VECTOR_CHUNK_OVERLAP_CHARS: envInt("VECTOR_CHUNK_OVERLAP_CHARS", 180),
  VECTOR_AUTO_SYNC_ENABLED: envBool("VECTOR_AUTO_SYNC_ENABLED", false),
  VECTOR_AUTO_SYNC_INTERVAL_MS: envInt("VECTOR_AUTO_SYNC_INTERVAL_MS", 86400000),

  // --- OneDrive / MS Graph ---
  ONEDRIVE_TENANT_ID: envStr("ONEDRIVE_TENANT_ID"),
  ONEDRIVE_CLIENT_ID: envStr("ONEDRIVE_CLIENT_ID"),
  ONEDRIVE_CLIENT_SECRET: envStr("ONEDRIVE_CLIENT_SECRET"),
  ONEDRIVE_DRIVE_ID: envStr("ONEDRIVE_DRIVE_ID"),
  ONEDRIVE_SITE_ID: envStr("ONEDRIVE_SITE_ID"),
  ONEDRIVE_FOLDER_ID: envStr("ONEDRIVE_FOLDER_ID"),
  ONEDRIVE_FOLDER_URL: envStr("ONEDRIVE_FOLDER_URL"),
  ONEDRIVE_CACHE_TTL_MS: envInt("ONEDRIVE_CACHE_TTL_MS", 300000),
  ONEDRIVE_CONTEXT_DOCUMENTS: envInt("ONEDRIVE_CONTEXT_DOCUMENTS", 3),
  ONEDRIVE_MAX_FILE_SIZE_BYTES: envInt("ONEDRIVE_MAX_FILE_SIZE_BYTES", 2097152),

  // --- Help Center ---
  HELP_CENTER_CACHE_TTL_MS: envInt("HELP_CENTER_CACHE_TTL_MS", 300000),
  HELP_CENTER_CONTEXT_ARTICLES: envInt("HELP_CENTER_CONTEXT_ARTICLES", 5),
  KNOWLEDGE_CONTEXT_ITEMS: envInt("KNOWLEDGE_CONTEXT_ITEMS", 5),
  KNOWLEDGE_MIN_TOP_SCORE: envInt("KNOWLEDGE_MIN_TOP_SCORE", 8),

  // --- Conversation memory ---
  CONVERSATION_MEMORY_MAX_MESSAGES: envInt("CONVERSATION_MEMORY_MAX_MESSAGES", 10),
  CONVERSATION_MEMORY_MAX_CHARS: envInt("CONVERSATION_MEMORY_MAX_CHARS", 3000),

  // --- Tracing / Observability ---
  TRACE_LOG_ENABLED: envBool("TRACE_LOG_ENABLED", true),
  MAX_TRACE_BUFFER: envInt("MAX_TRACE_BUFFER", 200),

  // --- Security ---
  ADMIN_TOKEN: envStr("ADMIN_TOKEN"),
  RATE_LIMIT_MAX: envInt("RATE_LIMIT_MAX", 30),
  EMBED_ALLOWED_ORIGINS: envStr("EMBED_ALLOWED_ORIGINS")
    .split(",").map(s => s.trim()).filter(Boolean),

  // --- Token budget ---
  TOKEN_BUDGET_MAX_INPUT: envInt("TOKEN_BUDGET_MAX_INPUT", 12000),
  TOKEN_BUDGET_MAX_OUTPUT: envInt("TOKEN_BUDGET_MAX_OUTPUT", 1500),

  // --- Response cache ---
  RESPONSE_CACHE_TTL_MS: envInt("RESPONSE_CACHE_TTL_MS", 300000),
  RESPONSE_CACHE_MAX_ENTRIES: envInt("RESPONSE_CACHE_MAX_ENTRIES", 200),

  // --- Spam ---
  ENABLE_EMAIL_SPAM_CLASSIFIER: envBool("ENABLE_EMAIL_SPAM_CLASSIFIER", true),
  EMAIL_SPAM_AI_MIN_CONFIDENCE: parseFloat(process.env.EMAIL_SPAM_AI_MIN_CONFIDENCE || "0.75"),
};
