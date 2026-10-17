/**
 * Provjera tajnih tokena (ADMIN_TOKEN, MCP_TOKEN, ZENDESK_WEBHOOK_TOKEN) i
 * skrivanje tokena iz URL-a i logova.
 *
 * Usporedba je u konstantnom vremenu: obje strane se prvo hashiraju (SHA-256),
 * pa crypto.timingSafeEqual uvijek uspoređuje dva međuspremnika od 32 bajta.
 * Ni duljina poslanog tokena ni mjesto prvog različitog znaka ne utječu na
 * trajanje provjere (obični === staje na prvom različitom znaku).
 *
 * `?token=` u URL-u ostaje podržan (klijentska integracija ga koristi), ali se
 * odmah nakon čitanja zamjenjuje u req.url / req.originalUrl / req.query, da ga
 * ništa nizvodno (MCP transport, logovi, greške) ne vidi.
 */
const crypto = require("crypto");

function digest(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest();
}

/**
 * true samo ako je `expected` postavljen i `provided` mu je jednak.
 * Sve što nije string (undefined, niz iz ?token=a&token=b, broj) se odbija.
 */
function tokensMatch(provided, expected) {
  if (typeof expected !== "string" || expected === "") return false;
  const candidate = typeof provided === "string" ? provided : "";
  return crypto.timingSafeEqual(digest(candidate), digest(expected));
}

// token=… u query stringu (i u tekstu loga, npr. zalijepljen URL). Vrijednost staje
// i na \ da redakcija u JSON liniji loga ne pojede escape znak (\") i pokvari JSON.
const QUERY_TOKEN = /([?&](?:token|access_token)=)[^&#\s"'\\]*/gi;
const REDACTED = "REDACTED";

function redactTokens(text) {
  return String(text).replace(QUERY_TOKEN, `$1${REDACTED}`);
}

/** Token iz query stringa: pročitaj ga i odmah ga makni iz zahtjeva. */
function takeQueryToken(req) {
  const query = req.query && typeof req.query === "object" ? req.query : null;
  const token = query ? query.token : undefined;
  if (query && "token" in query) delete query.token;
  if (typeof req.url === "string") req.url = redactTokens(req.url);
  if (typeof req.originalUrl === "string") req.originalUrl = redactTokens(req.originalUrl);
  return token;
}

module.exports = { tokensMatch, redactTokens, takeQueryToken, REDACTED };
