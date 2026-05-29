/**
 * Conversation Memory Service (Skill §21 — Short-term + Long-term Memory)
 *
 * Manages chat session state and conversation history.
 * Extracts recent messages for LLM context (sliding window).
 * Builds conversation summaries for grounded answer prompts.
 */
const env = require("../config/env");

const MAX_MESSAGES = env.CONVERSATION_MEMORY_MAX_MESSAGES;
const MAX_CHARS = env.CONVERSATION_MEMORY_MAX_CHARS;

/**
 * Extract the last N messages suitable for LLM multi-turn context.
 * @param {Array} messages - Full message history [{role, content, ts}]
 * @returns {Array} Trimmed to fit memory budget.
 */
function getRecentMessagesForAI(messages = []) {
  if (!Array.isArray(messages) || messages.length === 0) return [];

  const recent = messages.slice(-MAX_MESSAGES);
  const result = [];
  let totalChars = 0;

  for (let i = recent.length - 1; i >= 0; i--) {
    const msg = recent[i];
    const content = String(msg.content || "").trim();
    if (!content) continue;

    if (totalChars + content.length > MAX_CHARS) break;
    totalChars += content.length;
    result.unshift({ role: msg.role, content });
  }

  return result;
}

/**
 * Build a compact summary of the conversation for the system prompt.
 */
function buildConversationSummaryForAI(messages = []) {
  const recent = getRecentMessagesForAI(messages);
  if (recent.length === 0) return "";

  return recent.map((m) => {
    const label = m.role === "assistant" ? "Asistent" : "Korisnik";
    return `${label}: ${String(m.content).slice(0, 200)}`;
  }).join("\n");
}

/**
 * Extract conversation terms for knowledge search boosting.
 */
function extractConversationTerms(messages = []) {
  const terms = new Set();
  const recent = messages.slice(-5);

  for (const msg of recent) {
    const words = String(msg.content || "").toLowerCase().split(/\s+/);
    for (const w of words) {
      if (w.length > 4) terms.add(w);
    }
  }

  return [...terms].slice(0, 20);
}

module.exports = {
  getRecentMessagesForAI,
  buildConversationSummaryForAI,
  extractConversationTerms
};
