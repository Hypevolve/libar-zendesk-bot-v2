/**
 * Token Budget Service (Skill §9 — Token Budgeting & Cost Optimization)
 *
 * Estimates token counts before LLM calls.
 * Rejects over-budget requests (no API call, $0).
 * Tracks cumulative usage for metrics.
 */
const env = require("../config/env");
const log = require("../config/logger");

const MAX_INPUT = env.TOKEN_BUDGET_MAX_INPUT;
const MAX_OUTPUT = env.TOKEN_BUDGET_MAX_OUTPUT;

// Cumulative counters (reset with resetUsage).
let totalInputTokens = 0;
let totalOutputTokens = 0;
let totalRequests = 0;
let rejectedRequests = 0;

/**
 * Rough token estimate — word count × 1.3 (standard heuristic).
 * Croatian text is slightly denser than English, so this is conservative.
 */
function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(String(text).split(/\s+/).length * 1.3);
}

/**
 * Check whether combined prompt fits within budget.
 * @param {string} systemPrompt
 * @param {string} userMessage
 * @param {Array} [extraMessages] - conversation history messages
 * @returns {{ withinBudget: boolean, estimatedTokens: number, limit: number }}
 */
function checkBudget(systemPrompt, userMessage, extraMessages = []) {
  let total = estimateTokens(systemPrompt) + estimateTokens(userMessage);
  for (const msg of extraMessages) {
    total += estimateTokens(msg.content || "");
  }

  const withinBudget = total <= MAX_INPUT;

  if (!withinBudget) {
    rejectedRequests++;
    log.warn("token_budget_exceeded", {
      estimatedTokens: total,
      limit: MAX_INPUT,
      systemLen: String(systemPrompt || "").length,
      userLen: String(userMessage || "").length,
      historyMessages: extraMessages.length
    });
  }

  return { withinBudget, estimatedTokens: total, limit: MAX_INPUT };
}

/**
 * Trim context to fit budget by removing lowest-priority chunks.
 * Preserves chunks from the start (highest relevance).
 */
function trimContextToBudget(context, reservedTokens = 0) {
  const available = MAX_INPUT - reservedTokens;
  if (estimateTokens(context) <= available) return context;

  const lines = String(context).split("\n");
  const kept = [];
  let running = 0;

  for (const line of lines) {
    const lineTokens = estimateTokens(line);
    if (running + lineTokens > available) break;
    kept.push(line);
    running += lineTokens;
  }

  return kept.join("\n");
}

/**
 * Record actual token usage from API response.
 */
function recordUsage(inputTokens, outputTokens) {
  totalInputTokens += inputTokens || 0;
  totalOutputTokens += outputTokens || 0;
  totalRequests++;
}

function getUsageStats() {
  return {
    totalInputTokens,
    totalOutputTokens,
    totalRequests,
    rejectedRequests,
    avgInputPerRequest: totalRequests > 0 ? Math.round(totalInputTokens / totalRequests) : 0,
    avgOutputPerRequest: totalRequests > 0 ? Math.round(totalOutputTokens / totalRequests) : 0
  };
}

function resetUsage() {
  totalInputTokens = 0;
  totalOutputTokens = 0;
  totalRequests = 0;
  rejectedRequests = 0;
}

module.exports = {
  estimateTokens,
  checkBudget,
  trimContextToBudget,
  recordUsage,
  getUsageStats,
  resetUsage,
  MAX_INPUT,
  MAX_OUTPUT
};
