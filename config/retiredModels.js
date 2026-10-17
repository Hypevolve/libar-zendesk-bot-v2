/**
 * Modeli koje OpenRouter gasi → zamjena.
 *
 * Render dashboard može imati model postavljen eksplicitno (env varijabla jača
 * od defaulta i render.yaml-a), a taj dashboard ne možemo uvijek promijeniti.
 * Zato se svaki model iz konfiguracije propušta kroz ovu mapu: umjesto da bot na
 * dan gašenja počne padati na 404, koristi zamjenu i jednom upozori u logu.
 *
 * Kad OpenRouter najavi gašenje novog modela, dodaj redak ovdje.
 */
const RETIRED_MODELS = Object.freeze({
  // OpenRouter /api/v1/models: expiration_date 2026-10-20 za oba.
  // gemini-3.5-flash-lite: ista cijena kao 2.5-flash, ZDR endpointi (i google-vertex/eu),
  // structured outputs, bez datuma gašenja.
  "google/gemini-2.5-flash": "google/gemini-3.5-flash-lite",
  "google/gemini-2.5-flash-lite": "google/gemini-3.5-flash-lite"
});

/** Zamjena za ugašeni model, ili isti model ako nije na popisu. */
function remapRetiredModel(model, retired = RETIRED_MODELS) {
  const key = String(model ?? "").trim();
  return Object.prototype.hasOwnProperty.call(retired, key) ? retired[key] : key;
}

module.exports = { RETIRED_MODELS, remapRetiredModel };
