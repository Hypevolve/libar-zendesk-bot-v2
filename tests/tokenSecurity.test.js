/**
 * Test: provjera tokena u konstantnom vremenu i skrivanje ?token= iz URL-a/logova
 * (services/tokenSecurity.js, mcpAuth, verifyWebhookToken, config/logger).
 */
const test = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");

const env = require("../config/env");
env.SUPABASE_URL = "";
env.SUPABASE_SERVICE_ROLE_KEY = "";

const { tokensMatch, redactTokens, takeQueryToken } = require("../services/tokenSecurity");
const { mcpAuth } = require("../mcp/server");
const zendeskService = require("../services/zendeskService");
const { formatEntry } = require("../config/logger");

const SECRET = "a3f1c9e07b2d4e6f8a9b0c1d2e3f4a5b";

function mockRes() {
  return {
    statusCode: null,
    status(code) { this.statusCode = code; return this; },
    json() { return this; }
  };
}

function withEnv(key, value, fn) {
  const prev = env[key];
  env[key] = value;
  try { return fn(); } finally { env[key] = prev; }
}

// ─── tokensMatch ───────────────────────────────────────────────

test("tokensMatch: isti token prolazi, svaki drugi pada", () => {
  assert.strictEqual(tokensMatch(SECRET, SECRET), true);
  assert.strictEqual(tokensMatch(SECRET.slice(0, -1) + "0", SECRET), false, "ista duljina, zadnji znak drukčiji");
  assert.strictEqual(tokensMatch("0" + SECRET.slice(1), SECRET), false, "ista duljina, prvi znak drukčiji");
  assert.strictEqual(tokensMatch(SECRET.slice(0, 8), SECRET), false, "prefiks");
  assert.strictEqual(tokensMatch(SECRET + "x", SECRET), false, "dulji");
  assert.strictEqual(tokensMatch(` ${SECRET}`, SECRET), false, "razmak nije isti token");
});

test("tokensMatch: prazan/nepostavljen očekivani token nikad ne prolazi", () => {
  assert.strictEqual(tokensMatch("", ""), false);
  assert.strictEqual(tokensMatch(undefined, ""), false);
  assert.strictEqual(tokensMatch("x", undefined), false);
});

test("tokensMatch: sve što nije string se odbija (bez iznimke)", () => {
  assert.strictEqual(tokensMatch(undefined, SECRET), false);
  assert.strictEqual(tokensMatch(null, SECRET), false);
  assert.strictEqual(tokensMatch([SECRET, SECRET], SECRET), false, "?token=a&token=b daje niz");
  assert.strictEqual(tokensMatch({ toString: () => SECRET }, SECRET), false);
  assert.strictEqual(tokensMatch(12345, "12345"), false);
});

test("tokensMatch: uvijek ide kroz crypto.timingSafeEqual s jednako dugim (32 B) međuspremnicima", (t) => {
  const spy = t.mock.method(crypto, "timingSafeEqual");
  for (const provided of [SECRET, "kratko", SECRET.repeat(4), "", undefined]) {
    tokensMatch(provided, SECRET);
  }
  assert.strictEqual(spy.mock.callCount(), 5, "svaki poziv, i za krivu duljinu ili tip");
  for (const call of spy.mock.calls) {
    const [a, b] = call.arguments;
    assert.strictEqual(a.length, 32);
    assert.strictEqual(b.length, 32);
  }
});

// ─── mcpAuth ───────────────────────────────────────────────────

test("mcpAuth: ?token= i dalje radi (klijentska integracija)", () => {
  withEnv("MCP_TOKEN", SECRET, () => {
    const req = { headers: {}, query: { token: SECRET, limit: "5" }, url: `/mcp?token=${SECRET}&limit=5`, originalUrl: `/mcp?token=${SECRET}&limit=5` };
    let nextCalled = false;
    mcpAuth(req, mockRes(), () => { nextCalled = true; });
    assert.strictEqual(nextCalled, true);
  });
});

test("mcpAuth: nakon provjere ?token= više nije u req.url/originalUrl/query", () => {
  withEnv("MCP_TOKEN", SECRET, () => {
    const req = { headers: {}, query: { token: SECRET, limit: "5" }, url: `/mcp?token=${SECRET}&limit=5`, originalUrl: `/mcp?token=${SECRET}&limit=5` };
    mcpAuth(req, mockRes(), () => {});
    assert.ok(!req.url.includes(SECRET));
    assert.ok(!req.originalUrl.includes(SECRET));
    assert.strictEqual(req.url, "/mcp?token=REDACTED&limit=5");
    assert.deepStrictEqual(req.query, { limit: "5" });
  });
});

test("mcpAuth: krivi ?token= iste duljine → 401, i on se makne iz URL-a", () => {
  withEnv("MCP_TOKEN", SECRET, () => {
    const wrong = SECRET.slice(0, -1) + "0";
    const req = { headers: {}, query: { token: wrong }, url: `/mcp?token=${wrong}` };
    const res = mockRes();
    let nextCalled = false;
    mcpAuth(req, res, () => { nextCalled = true; });
    assert.strictEqual(res.statusCode, 401);
    assert.strictEqual(nextCalled, false);
    assert.ok(!req.url.includes(wrong));
  });
});

test("mcpAuth: ponovljeni ?token=a&token=b → 401", () => {
  withEnv("MCP_TOKEN", SECRET, () => {
    const res = mockRes();
    mcpAuth({ headers: {}, query: { token: [SECRET, SECRET] } }, res, () => {});
    assert.strictEqual(res.statusCode, 401);
  });
});

test("mcpAuth: x-mcp-token header prolazi", () => {
  withEnv("MCP_TOKEN", SECRET, () => {
    let nextCalled = false;
    mcpAuth({ headers: { "x-mcp-token": SECRET }, query: {} }, mockRes(), () => { nextCalled = true; });
    assert.strictEqual(nextCalled, true);
  });
});

// ─── Zendesk webhook ───────────────────────────────────────────

test("verifyWebhookToken: isti token (uz razmake) prolazi, krivi i prazni padaju", () => {
  withEnv("ZENDESK_WEBHOOK_TOKEN", SECRET, () => {
    assert.strictEqual(zendeskService.verifyWebhookToken(SECRET), true);
    assert.strictEqual(zendeskService.verifyWebhookToken(`  ${SECRET}\n`), true);
    assert.strictEqual(zendeskService.verifyWebhookToken(SECRET.slice(0, 10)), false);
    assert.strictEqual(zendeskService.verifyWebhookToken(""), false);
    assert.strictEqual(zendeskService.verifyWebhookToken(undefined), false);
    assert.strictEqual(zendeskService.verifyWebhookToken(null), false);
  });
  withEnv("ZENDESK_WEBHOOK_TOKEN", "", () => {
    assert.strictEqual(zendeskService.verifyWebhookToken(""), false);
  });
});

// ─── Redakcija ─────────────────────────────────────────────────

test("redactTokens: token iz query stringa se skriva, ostalo ostaje", () => {
  assert.strictEqual(redactTokens(`/admin/metrics?token=${SECRET}`), "/admin/metrics?token=REDACTED");
  assert.strictEqual(redactTokens(`/x?limit=2&token=${SECRET}&from=2026-10-01`), "/x?limit=2&token=REDACTED&from=2026-10-01");
  assert.strictEqual(redactTokens(`/x?access_token=${SECRET}`), "/x?access_token=REDACTED");
  assert.strictEqual(redactTokens("/x?limit=2"), "/x?limit=2");
  assert.strictEqual(redactTokens("tokeni potrošeni: 1200"), "tokeni potrošeni: 1200");
});

test("takeQueryToken: vrati token i ukloni ga iz zahtjeva", () => {
  const req = { query: { token: SECRET }, url: `/admin/traces?token=${SECRET}`, originalUrl: `/admin/traces?token=${SECRET}` };
  assert.strictEqual(takeQueryToken(req), SECRET);
  assert.deepStrictEqual(req.query, {});
  assert.strictEqual(req.url, "/admin/traces?token=REDACTED");
  assert.strictEqual(takeQueryToken({ headers: {} }), undefined, "zahtjev bez query/url");
});

test("logger: token iz URL-a ne završi u log liniji, a linija ostaje valjan JSON", () => {
  const line = formatEntry("warn", "x", {
    url: `/mcp?token=${SECRET}`,
    note: `kupac je zalijepio "https://bot/admin?limit=1&token=${SECRET}"`
  });
  assert.ok(!line.includes(SECRET), line);
  const parsed = JSON.parse(line);
  assert.strictEqual(parsed.url, "/mcp?token=REDACTED");
});
