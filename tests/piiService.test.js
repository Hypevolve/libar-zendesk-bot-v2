const piiService = require("../services/piiService");

function assert(cond, msg) { if (!cond) throw new Error(`FAIL: ${msg}`); }

// detectPII
const oibResult = piiService.detectPII("Moj OIB je 12345678901");
assert(oibResult.length > 0, "detect OIB");
assert(oibResult[0].type === "OIB", "type is OIB");

const emailResult = piiService.detectPII("Pišite na korisnik@test.hr");
assert(emailResult.some((p) => p.type === "EMAIL"), "detect email");

const ibanResult = piiService.detectPII("IBAN: HR1234567890123456789");
assert(ibanResult.some((p) => p.type === "IBAN"), "detect IBAN");

const cardResult = piiService.detectPII("Kartica 4111111111111111");
assert(cardResult.some((p) => p.type === "CREDIT_CARD"), "detect credit card");

const phoneResult = piiService.detectPII("Nazovite 091 234 5678");
assert(phoneResult.some((p) => p.type === "PHONE"), "detect phone");

// maskPII
const { masked, mappings } = piiService.maskPII("OIB: 12345678901, email: test@test.com");
assert(!masked.includes("12345678901"), "OIB masked");
assert(!masked.includes("test@test.com"), "email masked");
assert(mappings.length >= 2, "mappings recorded");

// unmaskPII
const unmasked = piiService.unmaskPII(masked, mappings);
assert(unmasked.includes("12345678901"), "OIB restored");
assert(unmasked.includes("test@test.com"), "email restored");

// Clean text
const clean = piiService.detectPII("Dobar dan, imam pitanje o dostavi");
assert(clean.length === 0, "no PII in clean text");

console.log("piiService.test.js — all passed ✓");
