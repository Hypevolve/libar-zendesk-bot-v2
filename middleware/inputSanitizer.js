/**
 * Input Sanitizer Middleware (Skill §13 — Prompt Injection Defense)
 *
 * Checks user input for prompt injection patterns.
 * Blocks dangerous inputs before they reach the LLM.
 */
const log = require("../config/logger");

const REJECT_PATTERNS = [
  // --- English ---
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /pretend\s+you\s+are/i,
  /reveal\s+your\s+(system\s+)?prompt/i,
  /you\s+are\s+now\s+in\s+developer\s+mode/i,
  /disregard\s+(all\s+)?(your\s+)?(instructions|rules)/i,
  /override\s+(safety|security|content)\s*(filter|policy|rules)/i,
  /act\s+as\s+(?:an?\s+)?(unrestricted|evil|malicious)/i,
  /output\s+your\s+(system|initial)\s+prompt/i,
  /what\s+(are|were)\s+your\s+(initial\s+)?instructions/i,
  // --- Croatian (customers write in Croatian) ---
  /ignorira[jš]?\s+(sve\s+)?(prethodn|prijašnj|dosadašnj)/i,
  /zanemari\s+(sve\s+)?(prethodn|prijašnj|upute|instrukcij|pravila)/i,
  /zaboravi\s+(sve\s+)?(prethodn|upute|instrukcij|što\s+sam|pravila)/i,
  /(otkrij|pokaži|ispiši|reci\s+mi)\s+(svoj\s+|tvoj\s+)?(sistemski\s+|početni\s+)?prompt/i,
  /(koje|koji|kakve)\s+su\s+(tvoje|vaše)\s+(početne\s+)?(upute|instrukcij)/i,
  /(ti\s+si\s+sada|sada\s+si)\s+.{0,20}(mod|način\s+rada|developer)/i,
  /ponašaj\s+se\s+kao\s+(?:da\s+si\s+)?(?:neograničen|zao|zloban|haker)/i,
  /pretvaraj\s+se\s+da\s+si/i,
  /pre(s|đ)i\s+u\s+(developer|razvojni)\s+(mod|način)/i,
  /(zaobiđi|preskoči)\s+(sigurnosn|sve)\s+(filter|provjer|pravila)/i,
  // --- Structural injection markers (language-agnostic) ---
  /\[SYSTEM\]/i,
  /\[INST\]/i,
  /```system/i,
  /<\|im_start\|>/i,
  /<\|im_end\|>/i,
  /###\s*(system|instruction)/i
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
