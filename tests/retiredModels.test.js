/**
 * Test: ugašeni modeli (config/retiredModels.js + config/env.js).
 * Model koji OpenRouter gasi, a ostao je zadan u env-u (npr. Render dashboard),
 * mora se pri čitanju konfiguracije zamijeniti i zabilježiti za upozorenje pri startu.
 */
const test = require("node:test");
const assert = require("node:assert");

const { RETIRED_MODELS, remapRetiredModel } = require("../config/retiredModels");

const ENV_PATH = require.resolve("../config/env");
const MODEL_KEYS = ["OPENROUTER_MODEL", "OPENROUTER_FALLBACK_MODEL", "ANALYSIS_MODEL"];

// Učitaj config/env.js iznova sa zadanim env varijablama, pa vrati sve kako je bilo
// (ostali testovi dijele isti, već učitani env objekt). Lokalni .env se ne učitava,
// da test ne ovisi o tome što developer ima postavljeno.
function loadEnvWith(vars) {
  const saved = {};
  for (const k of MODEL_KEYS) saved[k] = process.env[k];
  const cached = require.cache[ENV_PATH];
  const dotenv = require("dotenv");
  const realConfig = dotenv.config;
  dotenv.config = () => ({ parsed: {} });
  try {
    for (const k of MODEL_KEYS) {
      if (vars[k] === undefined) delete process.env[k];
      else process.env[k] = vars[k];
    }
    delete require.cache[ENV_PATH];
    return require("../config/env");
  } finally {
    dotenv.config = realConfig;
    for (const k of MODEL_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    if (cached) require.cache[ENV_PATH] = cached;
    else delete require.cache[ENV_PATH];
  }
}

test("gemini-2.5-flash i -lite se mapiraju na gemini-3.5-flash-lite", () => {
  assert.strictEqual(remapRetiredModel("google/gemini-2.5-flash"), "google/gemini-3.5-flash-lite");
  assert.strictEqual(remapRetiredModel("google/gemini-2.5-flash-lite"), "google/gemini-3.5-flash-lite");
  assert.strictEqual(remapRetiredModel("  google/gemini-2.5-flash  "), "google/gemini-3.5-flash-lite");
});

test("modeli koji nisu ugašeni ostaju isti", () => {
  assert.strictEqual(remapRetiredModel("openai/gpt-4o"), "openai/gpt-4o");
  assert.strictEqual(remapRetiredModel("google/gemini-3.5-flash-lite"), "google/gemini-3.5-flash-lite");
  assert.strictEqual(remapRetiredModel(""), "");
  assert.strictEqual(remapRetiredModel(undefined), "");
});

test("mapa je generička: radi s bilo kojom mapom ugašeno → zamjena", () => {
  const custom = { "vendor/old": "vendor/new" };
  assert.strictEqual(remapRetiredModel("vendor/old", custom), "vendor/new");
  assert.strictEqual(remapRetiredModel("vendor/other", custom), "vendor/other");
  // Ključevi s prototipa ne smiju se tretirati kao ugašeni modeli.
  assert.strictEqual(remapRetiredModel("toString", custom), "toString");
});

test("nijedna zamjena nije i sama ugašena (nema lanaca)", () => {
  for (const replacement of Object.values(RETIRED_MODELS)) {
    assert.ok(!(replacement in RETIRED_MODELS), `${replacement} je i sam na popisu ugašenih`);
  }
});

test("env: ugašeni model iz env-a (Render dashboard) se zamijeni i zabilježi", () => {
  const env = loadEnvWith({
    OPENROUTER_MODEL: "openai/gpt-4o",
    OPENROUTER_FALLBACK_MODEL: "google/gemini-2.5-flash",
    ANALYSIS_MODEL: "google/gemini-2.5-flash-lite"
  });
  assert.strictEqual(env.OPENROUTER_MODEL, "openai/gpt-4o");
  assert.strictEqual(env.OPENROUTER_FALLBACK_MODEL, "google/gemini-3.5-flash-lite");
  assert.strictEqual(env.ANALYSIS_MODEL, "google/gemini-3.5-flash-lite");
  assert.deepStrictEqual(env.RETIRED_MODEL_REMAPS, [
    { key: "OPENROUTER_FALLBACK_MODEL", from: "google/gemini-2.5-flash", to: "google/gemini-3.5-flash-lite" },
    { key: "ANALYSIS_MODEL", from: "google/gemini-2.5-flash-lite", to: "google/gemini-3.5-flash-lite" }
  ]);
});

test("env: defaulti više nisu ugašeni modeli i nema upozorenja", () => {
  const env = loadEnvWith({});
  assert.strictEqual(env.OPENROUTER_FALLBACK_MODEL, "google/gemini-3.5-flash-lite");
  assert.strictEqual(env.ANALYSIS_MODEL, "google/gemini-3.5-flash-lite");
  assert.deepStrictEqual(env.RETIRED_MODEL_REMAPS, []);
});
