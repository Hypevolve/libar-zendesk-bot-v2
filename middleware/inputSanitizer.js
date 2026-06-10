/**
 * Input Sanitizer Middleware (Skill §13 — Prompt Injection Defense)
 *
 * Checks user input for prompt injection patterns.
 * Blocks dangerous inputs before they reach the LLM.
 */
const log = require("../config/logger");

// Maximum accepted lengths per field
const MAX_LENGTHS = {
  message: 4000,
  name: 120,
  subject: 200,
  entryIntent: 50,
};

// Valid values for entryIntent — anything else is stripped
const VALID_ENTRY_INTENTS = new Set(["buyback", "delivery", "order", "support_info"]);

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
  // DAN / jailbreak personas
  /\bDAN\b/,
  /do\s+anything\s+now/i,
  /jailbreak/i,
  /you\s+have\s+been\s+(freed|released|unlocked)/i,
  /act\s+as\s+(if\s+you\s+(are|were)\s+)?(a\s+)?different\s+(ai|model|assistant)/i,
  /new\s+(persona|personality|character|role)\s*:/i,
  /from\s+now\s+on\s+(you\s+are|act\s+as|respond\s+as)/i,
  /you\s+are\s+now\s+(called|named)\s+/i,
  // Token/context stuffing markers
  /\brepeat\s+(after|the\s+following|this)\b.{0,80}(prompt|instruction|system)/i,
  // --- Croatian (customers write in Croatian) ---
  /ignorira[jš]?\s+(sve\s+)?(prethodn|prijašnj|dosadašnj)/i,
  /zanemari\s+(sve\s+)?(prethodn|prijašnj|upute|instrukcij|pravila)/i,
  /zaboravi\s+(sve\s+)?(prethodn|upute|instrukcij|što\s+sam|pravila)/i,
  /(otkrij|pokaži|ispiši|reci\s+mi)\s+(?:\w+\s+){0,4}(svoj\s+|tvoj\s+)?(sistemski\s+|početni\s+)?prompt/i,
  /(koje|koji|kakve)\s+su\s+(tvoje|vaše)\s+(početne\s+)?(upute|instrukcij)/i,
  /(ti\s+si\s+sada|sada\s+si)\s+.{0,20}(mod|način\s+rada|developer)/i,
  /ponašaj\s+se\s+kao\s+(?:da\s+si\s+)?(?:neograničen|zao|zloban|haker)/i,
  /pretvaraj\s+se\s+da\s+si/i,
  /pre(s|đ)i\s+u\s+(developer|razvojni)\s+(mod|način)/i,
  /(zaobiđi|preskoči)\s+(sigurnosn[^\s]*|sve)\s+(filter[^\s]*|provjer[^\s]*|pravila)/i,
  // --- Structural injection markers (language-agnostic) ---
  /\[SYSTEM\]/i,
  /\[INST\]/i,
  /```system/i,
  /<\|im_start\|>/i,
  /<\|im_end\|>/i,
  /###\s*(system|instruction)/i,
  /<system>/i,
  /<\/?s>\s*system/i,
];

const DANGEROUS_DELIMITERS = /[-]{3,}|[=]{3,}|[#]{3,}/g;

/**
 * Check if text contains prompt injection attempts.
 * @returns {{ safe: boolean, reason: string }}
 */
function check(text) {
  if (!text || typeof text !== "string") return { safe: true, reason: "" };

  for (const pattern of REJECT_PATTERNS) {
    if (pattern.test(text)) {
      return { safe: false, reason: "prompt_injection_detected" };
    }
  }

  return { safe: true, reason: "" };
}

/**
 * Remove dangerous delimiters from text and truncate to max length.
 */
function clean(text, maxLength) {
  if (!text) return "";
  let out = String(text).replace(DANGEROUS_DELIMITERS, "");
  if (maxLength) out = out.slice(0, maxLength);
  return out;
}

/**
 * Check a single field value and return 400 if blocked.
 * Returns false if the request should be rejected, true if it passed.
 */
function checkField(res, fieldName, value, ip) {
  if (!value) return true;

  const str = String(value);

  if (MAX_LENGTHS[fieldName] && str.length > MAX_LENGTHS[fieldName]) {
    log.warn("input_too_long", { field: fieldName, length: str.length, max: MAX_LENGTHS[fieldName], ip });
    res.status(400).json({ success: false, error: `Polje '${fieldName}' je predugačko.` });
    return false;
  }

  const result = check(str);
  if (!result.safe) {
    log.warn("input_blocked", {
      field: fieldName,
      reason: result.reason,
      ip,
      preview: str.slice(0, 100)
    });
    res.status(400).json({ success: false, error: "Poruka sadrži nedozvoljeni sadržaj." });
    return false;
  }

  return true;
}

/**
 * Express middleware — blocks requests with injection patterns.
 */
function middleware(req, res, next) {
  const ip = req.ip;
  const body = req.body || {};

  // message — check + clean + length limit
  if (body.message !== undefined) {
    if (!checkField(res, "message", body.message, ip)) return;
    req.body.message = clean(body.message, MAX_LENGTHS.message);
  }

  // name — check + clean (was only cleaned before)
  if (body.name !== undefined) {
    if (!checkField(res, "name", body.name, ip)) return;
    req.body.name = clean(body.name, MAX_LENGTHS.name);
  }

  // subject — check + clean
  if (body.subject !== undefined) {
    if (!checkField(res, "subject", body.subject, ip)) return;
    req.body.subject = clean(body.subject, MAX_LENGTHS.subject);
  }

  // entryIntent — validate against allowlist only; unknown values are silently dropped
  if (body.entryIntent !== undefined) {
    const intent = String(body.entryIntent || "").trim().toLowerCase();
    req.body.entryIntent = VALID_ENTRY_INTENTS.has(intent) ? intent : null;
  }

  return next();
}

module.exports = { check, clean, middleware, VALID_ENTRY_INTENTS, MAX_LENGTHS };
