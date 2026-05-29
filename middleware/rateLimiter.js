/**
 * Rate Limiter Middleware (Skill §14 — Production API Architecture)
 *
 * Per-IP sliding window. Returns 429 when exceeded.
 * Periodically cleans up expired entries.
 */
const env = require("../config/env");

const WINDOW_MS = 60 * 1000;
const MAX = env.RATE_LIMIT_MAX;
let store = new Map();

function rateLimiter(req, res, next) {
  const ip = req.ip || req.connection?.remoteAddress || "unknown";
  const now = Date.now();
  const entry = store.get(ip);

  if (!entry || now - entry.windowStart > WINDOW_MS) {
    store.set(ip, { windowStart: now, count: 1 });
    return next();
  }

  entry.count++;

  if (entry.count > MAX) {
    return res.status(429).json({
      success: false,
      error: "Too many requests. Please try again later."
    });
  }

  return next();
}

// Cleanup expired entries every 2 windows.
const cleanup = setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of store) {
    if (now - entry.windowStart > WINDOW_MS * 2) store.delete(ip);
  }
}, WINDOW_MS * 2);
cleanup.unref?.();

// Persist / restore helpers (for single-instance file-based state)
function load(data = {}) {
  store.clear();
  const now = Date.now();
  for (const [ip, entry] of Object.entries(data)) {
    if (now - entry.windowStart <= WINDOW_MS * 2) {
      store.set(ip, entry);
    }
  }
}

function getState() {
  const state = {};
  for (const [ip, entry] of store) {
    state[ip] = entry;
  }
  return state;
}

rateLimiter.reset = () => store.clear();
rateLimiter.load = load;
rateLimiter.getState = getState;

module.exports = rateLimiter;
