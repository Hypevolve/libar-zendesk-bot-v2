/**
 * Test (S15b): EMBED_ALLOWED_ORIGINS se primjenjuje (services/embedOriginPolicy.js).
 *
 * Živi widget je iframe s botove domene (public/embed.js), pa /api/chat/* zove
 * botova domena sama sebe. Pokriva:
 *   - botova domena prolazi i bez popisa (živi widget se ne smije slomiti)
 *   - origin s popisa prolazi i dobiva CORS; tuđi origin i "null" → 403 bez CORS-a
 *   - zahtjev bez Origina prolazi (dokumentirano pravilo: ne-preglednički klijent)
 *   - preflight, sve /api/chat/* rute, CSP frame-ancestors na stranici widgeta
 * Zendesk je stub; mreža se ne dira.
 */
process.env.PORT = "0";
process.env.EMBED_ALLOWED_ORIGINS = "https://antikvarijat-libar.com, https://www.antikvarijat-libar.com/";

const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");

const env = require("../config/env");
const zendeskService = require("../services/zendeskService");
const policy = require("../services/embedOriginPolicy");

const created = [];
zendeskService.createChatTicket = async (args) => {
  created.push(args);
  return { ticketId: 7000 + created.length, requesterId: 1 };
};

const app = require("../index");

const CLIENT = "https://antikvarijat-libar.com";
const CLIENT_WWW = "https://www.antikvarijat-libar.com";
const BOT = "https://libar-zendesk-bot-v2.onrender.com";
const EVIL = "https://evil.example";
const CLIENT_LIST = env.EMBED_ALLOWED_ORIGINS.slice();

let server, port;
test.before(async () => {
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  port = server.address().port;
});
test.after(() => { server.close(); setImmediate(() => process.exit(0)); });

function withEnv(over, fn) {
  const prev = { EMBED_ALLOWED_ORIGINS: env.EMBED_ALLOWED_ORIGINS, RENDER_EXTERNAL_URL: env.RENDER_EXTERNAL_URL };
  Object.assign(env, over);
  return Promise.resolve().then(fn).finally(() => Object.assign(env, prev));
}

function request(method, path, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request({
      host: "127.0.0.1", port, path, method,
      headers: { ...(data ? { "Content-Type": "application/json" } : {}), ...headers }
    }, (res) => {
      let text = "";
      res.on("data", (c) => { text += c; });
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(text); } catch { /* nije JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, json });
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

const startChat = (headers) => request("POST", "/api/chat/start", { headers, body: { name: "Test" } });

// ─── Pravilo ───────────────────────────────────────────────────

test("normalizeOrigin: shema+host+port, mala slova, bez putanje; neispravno → null", () => {
  assert.strictEqual(policy.normalizeOrigin("https://WWW.Antikvarijat-Libar.com/"), CLIENT_WWW);
  assert.strictEqual(policy.normalizeOrigin("https://antikvarijat-libar.com/kontakt/"), CLIENT);
  assert.strictEqual(policy.normalizeOrigin("http://localhost:3000"), "http://localhost:3000");
  assert.strictEqual(policy.normalizeOrigin("null"), null);
  assert.strictEqual(policy.normalizeOrigin(""), null);
  assert.strictEqual(policy.normalizeOrigin("antikvarijat-libar.com"), null, "bez sheme nije origin");
  assert.strictEqual(policy.normalizeOrigin("file:///etc/passwd"), null);
  assert.deepStrictEqual([...policy.allowedOrigins(CLIENT_LIST)], [CLIENT, CLIENT_WWW]);
  assert.deepStrictEqual(policy.invalidEntries([CLIENT, "antikvarijat-libar.com", "https://a b"]), ["antikvarijat-libar.com", "https://a b"]);
  assert.deepStrictEqual(policy.invalidEntries(CLIENT_LIST), []);
});

test("classifyRequest: bez Origina, botova domena, s popisa, tuđi", () => {
  const req = (headers) => ({ headers: { host: "libar-zendesk-bot-v2.onrender.com", ...headers } });
  assert.strictEqual(policy.classifyRequest(req({}), CLIENT_LIST).decision, "none");
  assert.strictEqual(policy.classifyRequest(req({ origin: BOT }), []).decision, "self");
  assert.strictEqual(policy.classifyRequest(req({ origin: CLIENT }), CLIENT_LIST).decision, "listed");
  assert.strictEqual(policy.classifyRequest(req({ origin: CLIENT }), []).decision, "blocked");
  assert.strictEqual(policy.classifyRequest(req({ origin: EVIL }), CLIENT_LIST).decision, "blocked");
  assert.strictEqual(policy.classifyRequest(req({ origin: "null" }), CLIENT_LIST).decision, "blocked");
  // Tuđa stranica ne može postati "self" lažnim Sec-Fetch-Site: preglednik ga postavlja sam.
  assert.strictEqual(policy.classifyRequest(req({ origin: EVIL, "sec-fetch-site": "cross-site" }), CLIENT_LIST).decision, "blocked");
});

// ─── /api/chat/* ───────────────────────────────────────────────

test("widget s botove domene (same-origin) prolazi, i kad popis nije postavljen", async () => {
  const self = `http://127.0.0.1:${port}`;
  for (const list of [CLIENT_LIST, []]) {
    await withEnv({ EMBED_ALLOWED_ORIGINS: list }, async () => {
      const before = created.length;
      const res = await startChat({ Origin: self });
      assert.strictEqual(res.status, 200, `popis: ${JSON.stringify(list)}`);
      assert.strictEqual(res.json.success, true);
      assert.ok(res.json.sessionId);
      assert.strictEqual(created.length, before + 1);
      assert.strictEqual(res.headers["access-control-allow-origin"], undefined, "same-origin ne treba CORS");
    });
  }
});

test("botova domena iza proxyja: Sec-Fetch-Site, RENDER_EXTERNAL_URL ili X-Forwarded-Host", async () => {
  await withEnv({ EMBED_ALLOWED_ORIGINS: [] }, async () => {
    const proxied = { Origin: BOT, Host: "10.0.0.5:10000" };
    assert.strictEqual((await startChat(proxied)).status, 403, "bez ijednog signala to nije botova domena");
    assert.strictEqual((await startChat({ ...proxied, "Sec-Fetch-Site": "same-origin" })).status, 200);
    assert.strictEqual((await startChat({ ...proxied, "X-Forwarded-Host": "libar-zendesk-bot-v2.onrender.com" })).status, 200);
    await withEnv({ RENDER_EXTERNAL_URL: BOT }, async () => {
      assert.strictEqual((await startChat(proxied)).status, 200);
    });
  });
});

test("origin s popisa prolazi i dobiva CORS zaglavlja", async () => {
  for (const origin of [CLIENT, CLIENT_WWW]) {
    const res = await startChat({ Origin: origin });
    assert.strictEqual(res.status, 200, origin);
    assert.strictEqual(res.headers["access-control-allow-origin"], origin);
    assert.match(res.headers.vary || "", /Origin/);
  }
});

test("tuđi origin → 403, bez CORS-a, tiket se ne otvara", async () => {
  for (const origin of [EVIL, "null", "https://antikvarijat-libar.com.evil.example", "http://antikvarijat-libar.com"]) {
    const before = created.length;
    const res = await startChat({ Origin: origin });
    assert.strictEqual(res.status, 403, origin);
    assert.deepStrictEqual(res.json, { success: false, error: "Origin not allowed." });
    assert.strictEqual(res.headers["access-control-allow-origin"], undefined);
    assert.strictEqual(created.length, before, "Zendesk se ne smije ni dotaknuti");
  }
  assert.ok(policy.__internal.logged.has(`chat_origin_blocked|${EVIL}`), "blokirani origin ide u log");
});

test("klijentova domena bez popisa je tuđa (popis ju mora navesti)", async () => {
  await withEnv({ EMBED_ALLOWED_ORIGINS: [] }, async () => {
    assert.strictEqual((await startChat({ Origin: CLIENT })).status, 403);
  });
});

test("zahtjev bez Origina prolazi (curl, skripte, e2e) — dokumentirano pravilo", async () => {
  const res = await startChat({});
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers["access-control-allow-origin"], undefined);
});

test("sve /api/chat/* rute su iza provjere", async () => {
  for (const path of ["/api/chat/start", "/api/chat/message", "/api/chat/restore", "/api/chat/update-profile"]) {
    const res = await request("POST", path, { headers: { Origin: EVIL }, body: {} });
    assert.strictEqual(res.status, 403, path);
  }
  // Iste rute s botove domene dolaze do svoje validacije (404/400), ne do 403.
  const self = { Origin: `http://127.0.0.1:${port}` };
  assert.strictEqual((await request("POST", "/api/chat/message", { headers: self, body: { sessionId: "nema" } })).status, 404);
  assert.strictEqual((await request("POST", "/api/chat/restore", { headers: self, body: {} })).status, 400);
});

test("preflight: origin s popisa 204 s CORS-om, tuđi 403", async () => {
  const pre = (origin) => request("OPTIONS", "/api/chat/start", {
    headers: { Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" }
  });
  const ok = await pre(CLIENT);
  assert.strictEqual(ok.status, 204);
  assert.strictEqual(ok.headers["access-control-allow-origin"], CLIENT);
  assert.match(ok.headers["access-control-allow-methods"], /POST/);
  assert.match(ok.headers["access-control-allow-headers"], /Content-Type/i);
  const bad = await pre(EVIL);
  assert.strictEqual(bad.status, 403);
  assert.strictEqual(bad.headers["access-control-allow-origin"], undefined);
});

test("webhook i javni JSON nisu iza provjere origina", async () => {
  const hook = await request("POST", "/api/zendesk/webhook", { headers: { Origin: EVIL }, body: {} });
  assert.strictEqual(hook.status, 401, "webhook ima svoj token, origin ga ne dira");
  const popis = await request("GET", "/api/popis-udzbenika.json", { headers: { Origin: EVIL } });
  assert.notStrictEqual(popis.status, 403);
});

// ─── Stranica widgeta ──────────────────────────────────────────

test("stranica widgeta: s popisom CSP frame-ancestors 'self' + popis", async () => {
  for (const path of ["/", "/index.html"]) {
    const res = await request("GET", path);
    assert.strictEqual(res.status, 200, path);
    assert.strictEqual(res.headers["content-security-policy"], `frame-ancestors 'self' ${CLIENT} ${CLIENT_WWW}`, path);
  }
});

test("stranica widgeta bez popisa: bez CSP-a (radi svugdje), ugrađivač ide u log", async () => {
  await withEnv({ EMBED_ALLOWED_ORIGINS: [] }, async () => {
    const res = await request("GET", "/", {
      headers: { Referer: "https://neka-druga-stranica.example/kosarica/", "Sec-Fetch-Dest": "iframe" }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers["content-security-policy"], undefined);
    assert.ok(policy.__internal.logged.has("widget_embed_unlisted|https://neka-druga-stranica.example"));
  });
});
