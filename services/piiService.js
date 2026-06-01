/**
 * PII Detection & Masking Service (Skill §13 — Defense in Depth)
 *
 * Masks PII before text reaches the LLM.
 * Detects PII in LLM output before returning to customer.
 * GDPR-compliant data minimisation.
 */

const PII_PATTERNS = {
  oib: {
    regex: /\b(\d{11})\b/g,
    label: "OIB",
    placeholder: "[OIB_REDACTED]"
  },
  iban: {
    regex: /\b(HR\d{19})\b/gi,
    label: "IBAN",
    placeholder: "[IBAN_REDACTED]"
  },
  credit_card: {
    regex: /\b(\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4})\b/g,
    label: "CREDIT_CARD",
    placeholder: "[CARD_REDACTED]"
  },
  email: {
    regex: /\b([A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,})\b/gi,
    label: "EMAIL",
    placeholder: "[EMAIL_REDACTED]"
  },
  phone_hr: {
    regex: /\b(0\d{1,2}[-/\s]?\d{3}[-/\s]?\d{3,4})\b/g,
    label: "PHONE",
    placeholder: "[PHONE_REDACTED]"
  },
  phone_intl: {
    regex: /\b(\+385[-\s]?\d{1,2}[-\s]?\d{3}[-\s]?\d{3,4})\b/g,
    label: "PHONE",
    placeholder: "[PHONE_REDACTED]"
  }
};

// Business emails/phones that are public knowledge — never mask these.
const SAFE_EMAILS = new Set(["info@antikvarijat-libar.com", "info@antikvarijat-libar.hr"]);
const SAFE_PHONES = new Set(["031/201-230", "031 201 230", "031201230"]);

/**
 * ISO 7064 MOD 11,10 — Croatian OIB control-digit check.
 * Used to distinguish a real OIB from any random 11-digit number so we can log
 * detection confidence. We still mask all isolated 11-digit numbers (privacy-first),
 * but a valid checksum removes ambiguity in logs/metrics.
 */
function isValidOIB(digits) {
  if (!/^\d{11}$/.test(digits)) return false;
  let a = 10;
  for (let i = 0; i < 10; i++) {
    a = (a + Number(digits[i])) % 10;
    if (a === 0) a = 10;
    a = (a * 2) % 11;
  }
  const control = (11 - a) % 10;
  return control === Number(digits[10]);
}

/**
 * Luhn check for credit-card candidates — avoids masking arbitrary 16-digit
 * numbers (e.g. order references) that merely look like a card.
 */
function isLuhnValid(value) {
  const digits = String(value).replace(/[-\s]/g, "");
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function isSafe(value, type) {
  if (type === "email") return SAFE_EMAILS.has(String(value).toLowerCase());
  if (type === "phone_hr" || type === "phone_intl") {
    return SAFE_PHONES.has(String(value).replace(/[-/\s]/g, "")) || SAFE_PHONES.has(value);
  }
  // Credit card: only treat as PII when it passes the Luhn checksum, so random
  // 16-digit order numbers aren't redacted. (OIB is left permissive on purpose —
  // privacy-first — but its checksum is exposed via isValidOIB for logging.)
  if (type === "credit_card") {
    return !isLuhnValid(value);
  }
  return false;
}

/**
 * Mask PII in text.
 * @returns {{ masked: string, mappings: Array<{placeholder: string, original: string, type: string}> }}
 */
function maskPII(text) {
  if (!text || typeof text !== "string") return { masked: text || "", mappings: [] };

  let masked = text;
  const mappings = [];
  let counter = 0;

  for (const [type, cfg] of Object.entries(PII_PATTERNS)) {
    masked = masked.replace(cfg.regex, (match) => {
      if (isSafe(match, type)) return match;
      counter++;
      const indexed = `${cfg.placeholder.slice(0, -1)}_${counter}]`;
      mappings.push({ placeholder: indexed, original: match, type: cfg.label });
      return indexed;
    });
  }

  return { masked, mappings };
}

/**
 * Restore masked placeholders in LLM output.
 */
function unmaskPII(text, mappings) {
  if (!text || !Array.isArray(mappings) || mappings.length === 0) return text || "";
  let restored = text;
  for (const m of mappings) {
    if (restored.includes(m.placeholder)) {
      restored = restored.split(m.placeholder).join(m.original);
    }
  }
  return restored;
}

/**
 * Detect PII in text without masking (for output validation).
 * @returns {Array<{type: string, value: string}>}
 */
function detectPII(text) {
  if (!text || typeof text !== "string") return [];
  const found = [];
  for (const [type, cfg] of Object.entries(PII_PATTERNS)) {
    for (const match of text.matchAll(cfg.regex)) {
      if (!isSafe(match[0], type)) {
        found.push({ type: cfg.label, value: match[0] });
      }
    }
  }
  return found;
}

module.exports = { maskPII, unmaskPII, detectPII, isValidOIB, isLuhnValid, SAFE_EMAILS, SAFE_PHONES };
