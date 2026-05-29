/**
 * Tracing & Observability Service (Skill §12 — LangSmith-style tracing)
 *
 * Records full pipeline traces for every AI interaction:
 * input → retrieval → relevance check → LLM output → validation → decision.
 * Provides admin API for inspection and stats.
 */
const env = require("../config/env");

const MAX_BUFFER = env.MAX_TRACE_BUFFER;
const ENABLED = env.TRACE_LOG_ENABLED;
const traces = [];

/**
 * Create a new trace entry.
 */
function createTrace({
  sessionId = null,
  input = "",
  standaloneQuery = null,
  retrieval = null,
  relevanceGrade = null,
  llmOutput = null,
  decision = null,
  qualityCheck = null,
  cached = false,
  piiMasked = false,
  tokenBudget = null,
  latencyMs = 0
} = {}) {
  if (!ENABLED) return;

  const entry = {
    id: `tr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    ts: new Date().toISOString(),
    sessionId,
    input: String(input).slice(0, 200),
    standaloneQuery: standaloneQuery ? String(standaloneQuery).slice(0, 200) : null,
    retrieval: retrieval ? {
      source: retrieval.source || null,
      topScore: retrieval.topScore || 0,
      articleCount: retrieval.articleCount || 0,
      contextLength: retrieval.contextLength || 0
    } : null,
    relevanceGrade,
    llmOutput: llmOutput ? String(llmOutput).slice(0, 300) : null,
    decision,
    qualityCheck,
    cached,
    piiMasked,
    tokenBudget,
    latencyMs
  };

  traces.push(entry);

  if (traces.length > MAX_BUFFER) {
    traces.splice(0, traces.length - MAX_BUFFER);
  }

  if (!env.IS_TEST) {
    console.info(JSON.stringify({ level: "trace", event: "ai_trace", ...entry }));
  }
}

function getRecentTraces(limit = 50) {
  return traces.slice(-Math.min(limit, MAX_BUFFER)).reverse();
}

function getTraceStats() {
  if (traces.length === 0) {
    return { total: 0, decisions: {}, avgLatencyMs: 0, relevanceRejectRate: "0%" };
  }

  const decisions = {};
  let totalLatency = 0;
  let relevanceRejected = 0;

  for (const t of traces) {
    decisions[t.decision] = (decisions[t.decision] || 0) + 1;
    totalLatency += t.latencyMs || 0;
    if (t.relevanceGrade && !t.relevanceGrade.relevant) relevanceRejected++;
  }

  return {
    total: traces.length,
    decisions,
    avgLatencyMs: Math.round(totalLatency / traces.length),
    relevanceRejectRate: ((relevanceRejected / traces.length) * 100).toFixed(1) + "%",
    cachedResponses: traces.filter(t => t.cached).length
  };
}

function clear() {
  traces.length = 0;
}

module.exports = { createTrace, getRecentTraces, getTraceStats, clear };
