/**
 * Što OpenRouter smije raditi s porukama kupaca (Kontra standard: ZDR, EU prvo).
 * Ide kao `provider` u svaki chat completion poziv prema OpenRouteru.
 *
 *   OPENROUTER_PRIVACY=zdr   (default) samo endpointi bez zadržavanja podataka
 *                            (zero data retention) i bez prikupljanja podataka
 *   OPENROUTER_PRIVACY=deny  samo provideri koji podatke ne spremaju i ne treniraju na njima
 *   OPENROUTER_PRIVACY=off   zahtjev ide kao prije, bez provider postavki
 * Bilo što drugo (tipfeler, "on", "true") → zdr, najstrože: netko ga je htio upaliti.
 *
 * EU prvo: model koji ima ZDR endpoint u EU dobije ga prvog u `order`; ako taj ne
 * odgovori, OpenRouter prelazi na ostale endpointe koji zadovoljavaju politiku
 * (allow_fallbacks). Provjereno na https://openrouter.ai/api/v1/endpoints/zdr 17.10.2026.:
 *   openai/gpt-4o                 1 ZDR endpoint (azure), nema EU regije
 *   google/gemini-3.5-flash-lite  google-vertex/eu (+ global, us)
 *   openai/gpt-4o-mini            azure/swedencentral (+ azure)
 *
 * Model bez ZDR endpointa u modu zdr ne dobiva odgovor (OpenRouter ga odbije), pa
 * podaci ne odlaze provideru koji ih zadržava; aiService tada prelazi na sljedeći model.
 *
 * Embeddingi (embeddingService) ovo namjerno NE koriste dok se uživo ne provjeri da
 * OpenRouterov embeddings endpoint prihvaća provider postavke.
 */
const env = require("../config/env");

const EU_ZDR_ENDPOINTS = Object.freeze({
  "google/gemini-3.5-flash-lite": "google-vertex/eu",
  "openai/gpt-4o-mini": "azure/swedencentral"
});

function privacyMode(value = env.OPENROUTER_PRIVACY) {
  const v = String(value ?? "").trim().toLowerCase();
  if (!v) return "zdr";
  return v === "deny" || v === "off" ? v : "zdr";
}

function euEndpoint(model) {
  return Object.prototype.hasOwnProperty.call(EU_ZDR_ENDPOINTS, model) ? EU_ZDR_ENDPOINTS[model] : null;
}

/** OpenRouterov `provider` objekt za model i mod; undefined kad je privatnost isključena. */
function providerSettings(model, mode = privacyMode()) {
  if (mode === "off") return undefined;
  const eu = euEndpoint(model);
  return {
    ...(eu ? { order: [eu] } : {}),
    allow_fallbacks: true,
    data_collection: "deny",
    ...(mode === "zdr" ? { zdr: true } : {})
  };
}

/**
 * Zahtjev s postavkama privatnosti u `provider`. Vlastite postavke poziva (npr.
 * drugi `order`) ostaju, ali data_collection i zdr uvijek dolaze odavde.
 */
function withPrivacy(request, mode = privacyMode()) {
  const settings = providerSettings(request.model, mode);
  if (!settings) return request;
  const own = request.provider && typeof request.provider === "object" ? request.provider : {};
  const { order, allow_fallbacks, ...privacy } = settings;
  return {
    ...request,
    provider: { ...(order ? { order } : {}), allow_fallbacks, ...own, ...privacy }
  };
}

/** OpenRouter nema endpoint za model koji zadovoljava traženu politiku podataka. */
function isDataPolicyError(error) {
  return /data policy|zero data retention/i.test(error?.message || "");
}

module.exports = { EU_ZDR_ENDPOINTS, privacyMode, providerSettings, withPrivacy, isDataPolicyError };
