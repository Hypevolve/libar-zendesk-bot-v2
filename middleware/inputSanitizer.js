/**
 * Input Sanitizer Middleware (Skill §13 — Prompt Injection Defense)
 *
 * Checks user input for prompt injection patterns.
 * Blocks dangerous inputs before they reach the LLM.
 */
const log = require("../config/logger");

const REJECT_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /pretend\s+you\s+are/i,
  /reveal\s+your\s+(system\s+)?prompt/i,
  /you\s+are\s+now\s+in\s+developer\s+mode/i,
  /disregard\s+(all\s+)?(your\s+)?(instructions|rules)/i,
  /override\s+(safety|security|content)\s*(filter|policy|rules)/i,
  /act\s+as\s+(?:an?\s+)?(unrestricted|evil|malicious)/i,
  /output\s+your\s+(system|initial)\s+prompt/i,
  /what\s+(are|were)\s+your\s+(initial\s+)?instructions/i,
  /\[SYSTEM\]/i,
  /\[INST\]/i,
  /```system/i,
  /<\|im_start\|>/i
];

const DANGEROUS_DELIMITERS = /[-]{3,}|[=]{3,}|[#]{3,}/g;

/**
 * Check if text contains prompt injection attempts.
 * @returns {{ safe: boolean, reason: string }}
 */
function check(text) {
  if (!text || typeof text !== "string") return { safe: true, reason: "" };

  const lower = text.toLowerCase();

  for (const pattern of REJECT_PATTERNS) {
    if (pattern.test(lower)) {
      return { safe: false, reason: "prompt_injection_detected" };
    }
  }

  return { safe: true, reason: "" };
}

/**
 * Remove dangerous delimiters from text.
 */
function clean(text) {
  if (!text) return "";
  return String(text).replace(DANGEROUS_DELIMITERS, "");
}

/**
 * Express middleware — blocks requests with injection patterns.
 */
function middleware(req, res, next) {
  const message = req.body?.message;
  if (message) {
    const result = check(message);
    if (!result.safe) {
      log.warn("input_blocked", {
        reason: result.reason,
        ip: req.ip,
        messagePreview: String(message).slice(0, 100)
      });
      return res.status(400).json({
        success: false,
        error: "Poruka sadrži nedozvoljeni sadržaj."
      });
    }
    req.body.message = clean(message);
  }

  // Clean other text fields that may reach the LLM
  if (req.body?.subject) req.body.subject = clean(req.body.subject);
  if (req.body?.name) req.body.name = clean(req.body.name);
  if (req.body?.entryIntent) req.body.entryIntent = clean(req.body.entryIntent);

  return next();
}

module.exports = { check, clean, middleware };
