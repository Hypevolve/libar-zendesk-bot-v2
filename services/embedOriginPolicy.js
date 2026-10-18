/**
 * Tko smije koristiti web chat iz preglednika (EMBED_ALLOWED_ORIGINS).
 *
 * Widget na klijentovom webu je iframe: public/embed.js učitava stranicu s botove
 * domene (https://libar-zendesk-bot-v2.onrender.com), pa /api/chat/* pozive šalje
 * botova domena sama sebi (same-origin), a ne antikvarijat-libar.com.
 *
 * 1. /api/chat/* (chatOriginGuard)
 *    - Origin botove domene prolazi uvijek, i bez popisa: to je živi widget.
 *    - Origin s popisa prolazi i dobiva CORS zaglavlja (i preflight 204).
 *    - Svaki drugi Origin (i "null") dobiva 403, bez CORS zaglavlja.
 *    - Zahtjev BEZ Origina prolazi. Preglednik Origin šalje na svaki POST, pa ga
 *      nemaju samo ne-preglednički klijenti (curl, skripte, e2e testovi), a oni ga
 *      ionako mogu napisati kakav hoće. Provjera origina štiti od tuđih web
 *      stranica koje bi kroz preglednike posjetitelja otvarale tikete i trošile
 *      LLM; nije autentikacija.
 *    Botova domena: Host zahtjeva, X-Forwarded-Host, RENDER_EXTERNAL_URL, ili
 *    Sec-Fetch-Site: same-origin (preglednik ga postavlja, JS ga ne može lažirati).
 *
 * 2. Stranica widgeta, / i /index.html (widgetFrameGuard)
 *    - Popis postavljen: CSP frame-ancestors 'self' + popis; preglednik odbija
 *      iframe na svakoj drugoj stranici.
 *    - Popis prazan: bez zaglavlja, widget radi svugdje kao i prije; stranica koja
 *      ga ugrađuje (iz Referera) jednom ide u log, da se vidi što treba na popis.
 */
const env = require("../config/env");
const log = require("../config/logger");

/** "https://Antikvarijat-Libar.com/" → "https://antikvarijat-libar.com"; neispravno → null. */
function normalizeOrigin(value) {
  const raw = String(value ?? "").trim();
  if (!raw || raw.toLowerCase() === "null") return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin.toLowerCase();
  } catch {
    return null;
  }
}

function allowedOrigins(list = env.EMBED_ALLOWED_ORIGINS) {
  return new Set((Array.isArray(list) ? list : []).map(normalizeOrigin).filter(Boolean));
}

/** Unosi koji nisu origin (npr. bez https://) — preskaču se, index.js ih logira pri startu. */
function invalidEntries(list = env.EMBED_ALLOWED_ORIGINS) {
  return (Array.isArray(list) ? list : []).filter((entry) => !normalizeOrigin(entry));
}

function hostOf(value) {
  try { return new URL(value).host.toLowerCase(); } catch { return null; }
}

/** Hostovi pod kojima ovaj server odgovara za ovaj zahtjev. */
function ownHosts(req) {
  const hosts = new Set();
  const host = String(req.headers.host || "").trim().toLowerCase();
  if (host) hosts.add(host);
  const forwarded = String(req.headers["x-forwarded-host"] || "").split(",")[0].trim().toLowerCase();
  if (forwarded) hosts.add(forwarded);
  const external = hostOf(env.RENDER_EXTERNAL_URL);
  if (external) hosts.add(external);
  return hosts;
}

/**
 * Odluka za zahtjev: "none" (bez Origina), "self" (botova domena), "listed"
 * (s popisa) ili "blocked".
 */
function classifyRequest(req, list = env.EMBED_ALLOWED_ORIGINS) {
  const header = req.headers.origin;
  if (header === undefined || header === "") return { decision: "none", origin: null };
  const origin = normalizeOrigin(header);
  if (!origin) return { decision: "blocked", origin: String(header).slice(0, 200) };
  if (String(req.headers["sec-fetch-site"] || "").toLowerCase() === "same-origin") return { decision: "self", origin };
  if (ownHosts(req).has(hostOf(origin))) return { decision: "self", origin };
  if (allowedOrigins(list).has(origin)) return { decision: "listed", origin };
  return { decision: "blocked", origin };
}

// Svaki origin jednom po procesu, da tuđa stranica ne može zatrpati log.
const LOGGED_MAX = 500;
const logged = new Set();
function warnOnce(event, origin, data) {
  const key = `${event}|${origin}`;
  if (logged.has(key) || logged.size >= LOGGED_MAX) return;
  logged.add(key);
  log.warn(event, { origin, ...data });
}

function setCorsHeaders(res, origin) {
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "600");
}

/** Express middleware za /api/chat/*. */
function chatOriginGuard(req, res, next) {
  res.vary("Origin");
  const { decision, origin } = classifyRequest(req);
  if (decision === "blocked") {
    warnOnce("chat_origin_blocked", origin, { path: req.path, method: req.method });
    return res.status(403).json({ success: false, error: "Origin not allowed." });
  }
  if (decision === "listed") setCorsHeaders(res, origin);
  if (req.method === "OPTIONS") return res.status(204).end();
  return next();
}

/** Odakle je stranica widgeta učitana u iframe (Referer roditeljske stranice). */
function embeddingOrigin(req) {
  if (String(req.headers["sec-fetch-dest"] || "").toLowerCase() !== "iframe") return null;
  const origin = normalizeOrigin(req.headers.referer);
  if (!origin || ownHosts(req).has(hostOf(origin))) return null;
  return origin;
}

/** Express middleware za stranicu widgeta (/ i /index.html). */
function widgetFrameGuard(req, res, next) {
  const list = allowedOrigins();
  const parent = embeddingOrigin(req);
  if (list.size) {
    res.setHeader("Content-Security-Policy", `frame-ancestors 'self' ${[...list].join(" ")}`);
    if (parent && !list.has(parent)) warnOnce("widget_embed_blocked", parent, {});
  } else if (parent) {
    warnOnce("widget_embed_unlisted", parent, { hint: "EMBED_ALLOWED_ORIGINS nije postavljen" });
  }
  next();
}

module.exports = {
  normalizeOrigin, allowedOrigins, invalidEntries, classifyRequest, chatOriginGuard, widgetFrameGuard,
  __internal: { ownHosts, embeddingOrigin, logged }
};
