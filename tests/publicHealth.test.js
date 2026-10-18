/**
 * Test (S15): javni odgovori ne nose konfiguraciju ni dijelove tajni.
 *   - GET /health: samo success, status, version, commit, uptime
 *   - provjere ovisnosti, greške i RAG postavke samo na /admin/health, uz token
 *   - getVectorConfigSummary bez Supabase URL-a i bez ijednog znaka ključa
 *   - neispravan JSON: kratka JSON greška, bez stack tracea
 * Zendesk, Supabase i embedding ping su stubovi; mreža se ne dira (.invalid se
 * nikad ne razrješava, RFC 2606).
 */
const FAKE = {
  SUPABASE_URL: "https://s15-test-project.supabase.invalid",
  SUPABASE_SERVICE_ROLE_KEY: "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.S15headTAILk9Zq",
  ADMIN_TOKEN: "s15-admin-token",
  RENDER_GIT_COMMIT: "0123456789abcdef0123456789abcdef01234567"
};
Object.assign(process.env, FAKE, { PORT: "0" });

const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");

const zendeskService = require("../services/zendeskService");
const vectorKnowledgeService = require("../services/vectorKnowledgeService");
const embeddingService = require("../services/embeddingService");
const { version } = require("../package.json");

// Greška ovisnosti koja bi otkrila host da ode van (stari /health ju je vraćao u details).
const DOWN_ERROR = `getaddrinfo ENOTFOUND ${new URL(FAKE.SUPABASE_URL).host}`;
let up = true;
zendeskService.ping = async () => (up ? { ok: true, user: "Bot" } : { ok: false, error: DOWN_ERROR });
vectorKnowledgeService.ping = async () => (up ? { ok: true } : { ok: false, error: DOWN_ERROR });
embeddingService.ping = () => ({ ok: up, provider: "openrouter", model: "openai/text-embedding-3-small" });

const app = require("../index");

let server, port;
test.before(async () => {
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  port = server.address().port;
});
// index.js pokreće vlastiti server i periodične sync timere — proces se gasi eksplicitno.
test.after(() => { server.close(); setImmediate(() => process.exit(0)); });

function request(method, path, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, method, headers }, (res) => {
      let text = "";
      res.on("data", (c) => { text += c; });
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(text); } catch { /* nije JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

const KEY = FAKE.SUPABASE_SERVICE_ROLE_KEY;
function assertNoSecrets(text) {
  assert.ok(!text.includes(new URL(FAKE.SUPABASE_URL).host), "Supabase host ne smije van");
  assert.ok(!/supabase/i.test(text), "ni riječ supabase");
  assert.ok(!text.includes(KEY.slice(0, 4)) && !text.includes(KEY.slice(-4)), "ni prvi ni zadnji znakovi ključa");
  assert.ok(!text.includes("***"), "nikakav 'preview' ključa");
  assert.ok(!text.includes(FAKE.ADMIN_TOKEN));
}

test("GET /health: samo status, verzija, commit i uptime", async () => {
  up = true;
  const res = await request("GET", "/health");
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(Object.keys(res.json).sort(), ["commit", "status", "success", "uptime", "version"]);
  assert.strictEqual(res.json.success, true);
  assert.strictEqual(res.json.status, "ok");
  assert.strictEqual(res.json.version, version);
  assert.strictEqual(res.json.commit, FAKE.RENDER_GIT_COMMIT);
  assert.strictEqual(typeof res.json.uptime, "number");
  assertNoSecrets(res.text);
});

test("GET /health kad su ovisnosti pale: 503 i dalje bez poruka grešaka", async () => {
  up = false;
  try {
    const res = await request("GET", "/health");
    assert.strictEqual(res.status, 503, "Render i dalje vidi da je servis dolje");
    assert.strictEqual(res.json.status, "down");
    assert.deepStrictEqual(Object.keys(res.json).sort(), ["commit", "status", "success", "uptime", "version"]);
    assert.ok(!res.text.includes("ENOTFOUND"));
    assertNoSecrets(res.text);
  } finally {
    up = true;
  }
});

test("GET /admin/health: bez tokena 401, s tokenom provjere i greške, bez ključa i URL-a", async () => {
  const anon = await request("GET", "/admin/health");
  assert.strictEqual(anon.status, 401);
  assert.ok(!("checks" in (anon.json || {})));

  up = false;
  try {
    const res = await request("GET", "/admin/health", { headers: { "x-admin-token": FAKE.ADMIN_TOKEN } });
    assert.strictEqual(res.status, 503);
    assert.deepStrictEqual(res.json.checks, { zendesk: false, vector: false, embedding: false });
    assert.strictEqual(res.json.details.vector, DOWN_ERROR, "adminu ostaju detalji za dijagnozu");
    assert.strictEqual(typeof res.json.activeSessions, "number");
    assert.strictEqual(res.json.vectorConfig.supabaseConfigured, true);
    assert.strictEqual(res.json.vectorConfig.serviceRoleKeyConfigured, true);
    const config = JSON.stringify(res.json.vectorConfig);
    assert.ok(!config.includes("supabase.invalid") && !config.includes(KEY.slice(-4)));
    assert.ok(!("serviceRoleKeyPreview" in res.json.vectorConfig));
    assert.ok(!("supabaseUrl" in res.json.vectorConfig));
  } finally {
    up = true;
  }
});

test("getVectorConfigSummary: ni URL ni ijedan znak ključa", () => {
  const summary = vectorKnowledgeService.getVectorConfigSummary();
  const text = JSON.stringify(summary);
  assert.ok(!("serviceRoleKeyPreview" in summary));
  assert.ok(!("supabaseUrl" in summary));
  assert.ok(!text.includes(KEY.slice(0, 4)) && !text.includes(KEY.slice(-4)));
  assert.ok(!text.includes("supabase.invalid"));
  assert.strictEqual(summary.serviceRoleKeyConfigured, true);
});

test("neispravan JSON na javnu rutu: 400 JSON, bez stack tracea i putanja", async () => {
  const res = await request("POST", "/api/chat/start", {
    headers: { "Content-Type": "application/json" },
    body: "{\"name\": "
  });
  assert.strictEqual(res.status, 400);
  assert.deepStrictEqual(res.json, { success: false, error: "Bad request." });
  assert.ok(!res.text.includes("node_modules") && !/\bat \S+ \(/.test(res.text), "bez stack tracea");
});
