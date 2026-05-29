/**
 * Output Validation Service (Skill §13 — Output Validator, §26 — Guardrails)
 *
 * Layer 6-8 from the Layered Defense Model:
 * - PII leakage detection in output
 * - Harmful/fabricated content detection
 * - Hallucination check (token overlap with knowledge)
 * - Uncertainty detection
 */
const piiService = require("./piiService");
const log = require("../config/logger");

const UNCERTAINTY_PATTERNS = [
  /ne mogu/i,
  /nisam siguran/i,
  /nemam informacij/i,
  /pouzdano potvrditi/i,
  /ne mogu vam pomoći/i,
  /ne mogu potvrditi/i,
  /nisam u mogućnosti/i,
  /ne raspolažem/i,
  /ne mogu sa sigurnošću/i
];

const FABRICATED_ACTION_PATTERNS = [
  /provjerio sam/i,
  /provjerila sam/i,
  /otkazao sam/i,
  /otkazala sam/i,
  /izmijenio sam/i,
  /izmijenila sam/i,
  /spojio sam/i,
  /spojila sam/i,
  /potvrdio sam/i,
  /potvrdila sam/i
];

const INTERNAL_LEAK_PATTERNS = [
  /\bAI\b/,
  /\bprompt\b/i,
  /\bkontekst\b.*\bbaza\b/i,
  /\bOneDrive\b/i,
  /\bSharePoint\b/i,
  /\bZendesk\b/i,
  /\bOpenRouter\b/i,
  /\bOpenAI\b/i,
  /\bembedding\b/i,
  /\bvektor\b.*\bbaza\b/i
];

/**
 * Validate AI answer quality before sending to customer.
 * @returns {{ valid: boolean, reason: string }}
 */
function validateAnswerQuality(answer, { knowledgeContext = "", userMessage = "" } = {}) {
  if (!answer || typeof answer !== "string" || answer.trim().length < 5) {
    return { valid: false, reason: "empty_or_too_short" };
  }

  const normalised = answer.toLowerCase();

  // 1. Uncertainty check (full text)
  for (const pattern of UNCERTAINTY_PATTERNS) {
    if (pattern.test(answer)) {
      return { valid: false, reason: "uncertain_answer" };
    }
  }

  // 2. Fabricated action claims
  for (const pattern of FABRICATED_ACTION_PATTERNS) {
    if (pattern.test(answer)) {
      return { valid: false, reason: "fabricated_action_claim" };
    }
  }

  // 3. Internal process leaks
  for (const pattern of INTERNAL_LEAK_PATTERNS) {
    if (pattern.test(answer)) {
      return { valid: false, reason: "internal_process_leak" };
    }
  }

  // 4. Output PII check (Skill §13 Layer 6)
  const outputPII = piiService.detectPII(answer);
  if (outputPII.length > 0) {
    log.warn("pii_in_output", { types: outputPII.map((p) => p.type) });
    // Don't block — just warn. PII in answer may be from knowledge (e.g. business email).
  }

  // 5. Invented URL detection
  if (knowledgeContext) {
    const urlsInAnswer = answer.match(/https?:\/\/[^\s)>\]]+/gi) || [];
    const knowledgeLower = knowledgeContext.toLowerCase();

    for (const url of urlsInAnswer) {
      const domain = url.toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
      if (!knowledgeLower.includes(domain) && !domain.includes("antikvarijat-libar")) {
        return { valid: false, reason: "invented_url" };
      }
    }
  }

  // 6. Token overlap with knowledge (Skill §7.5 — Hallucination fix)
  if (knowledgeContext) {
    const answerTokens = new Set(normalised.split(/\s+/).filter((t) => t.length > 3));
    const knowledgeTokens = new Set(knowledgeContext.toLowerCase().split(/\s+/).filter((t) => t.length > 3));

    if (answerTokens.size > 0 && knowledgeTokens.size > 0) {
      let overlap = 0;
      for (const token of answerTokens) {
        if (knowledgeTokens.has(token)) overlap++;
      }
      const ratio = overlap / answerTokens.size;

      if (ratio < 0.15) {
        return { valid: false, reason: "low_knowledge_overlap" };
      }
    }
  }

  return { valid: true, reason: "passed" };
}

module.exports = { validateAnswerQuality };
