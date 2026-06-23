/**
 * Metrics Service (Skill §12 — Observability)
 *
 * Tracks request counts, response times, cache hits, decisions.
 * Persists counters to Supabase so they survive restarts / deploys.
 */
const tokenBudget = require("./tokenBudgetService");
const responseCache = require("./responseCacheService");
const supabaseMetrics = require("./supabaseMetricsService");
const log = require("../config/logger");

const counters = {
  totalRequests: 0,
  totalWebhooks: 0,
  totalChatStarts: 0,
  totalChatMessages: 0,
  decisions: {},
  errors: 0,
  handoffs: 0,
  botDisabledEscalations: 0,
  webhooksSkippedHumanHandled: 0,
  agentTakeoversSkipped: 0,
  latencies: []
};

// ─── Load persisted metrics on startup ──────────────────────────

(async function hydrateFromSupabase() {
  const persisted = await supabaseMetrics.load();
  if (persisted && typeof persisted === "object") {
    counters.totalRequests = persisted.totalRequests || 0;
    counters.totalWebhooks = persisted.totalWebhooks || 0;
    counters.totalChatStarts = persisted.totalChatStarts || 0;
    counters.totalChatMessages = persisted.totalChatMessages || 0;
    counters.decisions = persisted.decisions || {};
    counters.errors = persisted.errors || 0;
    counters.handoffs = persisted.handoffs || 0;
    counters.botDisabledEscalations = persisted.botDisabledEscalations || 0;
    counters.webhooksSkippedHumanHandled = persisted.webhooksSkippedHumanHandled || 0;
    counters.agentTakeoversSkipped = persisted.agentTakeoversSkipped || 0;
    counters.latencies = Array.isArray(persisted.latencies) ? persisted.latencies.slice(-1000) : [];
    log.info("metrics_hydrated", { totalRequests: counters.totalRequests, totalWebhooks: counters.totalWebhooks });
  }
})();

// ─── Auto-save every 30 seconds ────────────────────────────────

function serializeCounters() {
  return {
    totalRequests: counters.totalRequests,
    totalWebhooks: counters.totalWebhooks,
    totalChatStarts: counters.totalChatStarts,
    totalChatMessages: counters.totalChatMessages,
    decisions: counters.decisions,
    errors: counters.errors,
    handoffs: counters.handoffs,
    botDisabledEscalations: counters.botDisabledEscalations,
    webhooksSkippedHumanHandled: counters.webhooksSkippedHumanHandled,
    agentTakeoversSkipped: counters.agentTakeoversSkipped,
    latencies: counters.latencies
  };
}

// .unref() — timer i dalje okida dok app radi (server drži proces živim), ali
// ne sprječava uredan izlazak procesa kad ostane jedini handle (npr. u testovima).
setInterval(() => {
  supabaseMetrics.save(serializeCounters());
}, 30000).unref();

// ─── Public API ────────────────────────────────────────────────

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

async function reset() {
  counters.totalRequests = 0;
  counters.totalWebhooks = 0;
  counters.totalChatStarts = 0;
  counters.totalChatMessages = 0;
  counters.decisions = {};
  counters.errors = 0;
  counters.handoffs = 0;
  counters.botDisabledEscalations = 0;
  counters.webhooksSkippedHumanHandled = 0;
  counters.agentTakeoversSkipped = 0;
  counters.latencies = [];
  tokenBudget.resetUsage();
  responseCache.clear();
  await supabaseMetrics.save(serializeCounters());
}

module.exports = { increment, recordDecision, recordLatency, getMetrics, reset };
