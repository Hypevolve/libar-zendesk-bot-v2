/**
 * Response Cache Service (Skill §9 — Response Caching)
 *
 * Caches LLM responses for identical queries.
 * In-memory with TTL; swap for Redis in multi-instance production.
 * Normalises queries before hashing to catch trivial variations.
 */
const crypto = require("crypto");
const env = require("../config/env");

const TTL = env.RESPONSE_CACHE_TTL_MS;
const MAX_ENTRIES = env.RESPONSE_CACHE_MAX_ENTRIES;

const cache = new Map();

let hits = 0;
let misses = 0;

function makeKey(query) {
  const normalised = String(query || "").toLowerCase().trim()
    .replace(/\s+/g, " ")
    .replace(/[?.!,;:]+$/g, "");
  return crypto.createHash("sha256").update(normalised).digest("hex");
}

/**
 * Get a cached response for the given query.
 * @returns {string|null}
 */
function get(query) {
  const key = makeKey(query);
  const entry = cache.get(key);

  if (!entry) {
    misses++;
    return null;
  }

  if (Date.now() - entry.createdAt > TTL) {
    cache.delete(key);
    misses++;
    return null;
  }

  hits++;
  return entry.response;
}

/**
 * Store a response in the cache.
 */
function set(query, response) {
  if (!query || !response) return;

  // Evict oldest entries if over capacity.
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }

  const key = makeKey(query);
  cache.set(key, { response, createdAt: Date.now() });
}

function getStats() {
  return {
    size: cache.size,
    maxEntries: MAX_ENTRIES,
    ttlMs: TTL,
    hits,
    misses,
    hitRate: hits + misses > 0 ? (hits / (hits + misses) * 100).toFixed(1) + "%" : "0%"
  };
}

function clear() {
  cache.clear();
  hits = 0;
  misses = 0;
}

module.exports = { get, set, getStats, clear, makeKey };
