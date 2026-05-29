/**
 * Metrics Service (Skill §12 — Observability)
 *
 * Tracks request counts, response times, cache hits, decisions.
 * All in-memory — swap for Prometheus/Datadog in multi-instance.
 */
const tokenBudget = require("./tokenBudgetService");
const responseCache = require("./responseCacheService");

const counters = {
  totalRequests: 0,
  totalWebhooks: 0,
  totalChatStarts: 0,
  totalChatMessages: 0,
  decisions: {},
  errors: 0,
  handoffs: 0,
  latencies: []
};

function increment(key) {
  if (typeof counters[key] === "number") counters[key]++;
}

function recordDecision(decision) {
  counters.decisions[decision] = (counters.decisions[decision] || 0) + 1;
}

function recordLatency(ms) {
  counters.latencies.push(ms);
  if (counters.latencies.length > 1000) counters.latencies.splice(0, 500);
}

function getMetrics() {
  const lats = counters.latencies;
  const sorted = [...lats].sort((a, b) => a - b);

  return {
    ...counters,
    avgLatencyMs: lats.length ? Math.round(lats.reduce((s, v) => s + v, 0) / lats.length) : 0,
    p95LatencyMs: lats.length ? sorted[Math.floor(sorted.length * 0.95)] || 0 : 0,
    tokenUsage: tokenBudget.getUsageStats(),
    cache: responseCache.getStats()
  };
}

function reset() {
  counters.totalRequests = 0;
  counters.totalWebhooks = 0;
  counters.totalChatStarts = 0;
  counters.totalChatMessages = 0;
  counters.decisions = {};
  counters.errors = 0;
  counters.handoffs = 0;
  counters.latencies = [];
  tokenBudget.resetUsage();
  responseCache.clear();
}

module.exports = { increment, recordDecision, recordLatency, getMetrics, reset };
