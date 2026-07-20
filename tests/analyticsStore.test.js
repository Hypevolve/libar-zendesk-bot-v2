/**
 * Test: analyticsStore (Supabase REST sloj za analizu ticketa).
 * Mocka HTTP klijent (_setTestClient) i postavlja dummy Supabase env da
 * isConfigured() bude true. Bez živih mrežnih poziva.
 */
const test = require("node:test");
const assert = require("node:assert");

const env = require("../config/env");
const store = require("../services/analyticsStore");

function withConfig(fn) {
  const prevUrl = env.SUPABASE_URL, prevKey = env.SUPABASE_SERVICE_ROLE_KEY;
  env.SUPABASE_URL = "https://x.supabase.co";
  env.SUPABASE_SERVICE_ROLE_KEY = "dummy-key";
  return Promise.resolve(fn()).finally(() => {
    env.SUPABASE_URL = prevUrl; env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
    store._setTestClient(null);
  });
}

function mockClient({ getImpl, postImpl } = {}) {
  const calls = { get: [], post: [] };
  const client = {
    calls,
    async get(url, config) { calls.get.push({ url, config }); return getImpl ? getImpl(url, config) : { data: [], headers: {} }; },
    async post(url, body, config) { calls.post.push({ url, body, config }); return postImpl ? postImpl(url, body, config) : { data: null }; }
  };
  store._setTestClient(client);
  return client;
}

// ─── Bez konfiguracije ─────────────────────────────────────────

test("bez Supabase konfiguracije: čitanja vraćaju prazno, isConfigured=false", async () => {
  const prevUrl = env.SUPABASE_URL, prevKey = env.SUPABASE_SERVICE_ROLE_KEY;
  env.SUPABASE_URL = ""; env.SUPABASE_SERVICE_ROLE_KEY = "";
  try {
    assert.strictEqual(store.isConfigured(), false);
    assert.deepStrictEqual(await store.getConversations(), []);
    assert.deepStrictEqual(await store.getKbGaps(), []);
    assert.deepStrictEqual(await store.getTopQuestions(), []);
    const s = await store.getSummary();
    assert.strictEqual(s.total, 0);
    assert.strictEqual(s.botResolved, 0);
    assert.strictEqual(s.humanHandled, 0);
    assert.strictEqual(s.kbGaps, 0);
    assert.deepStrictEqual(s.byChannel, { web: 0, email: 0, facebook: 0, ostalo: 0 });
  } finally { env.SUPABASE_URL = prevUrl; env.SUPABASE_SERVICE_ROLE_KEY = prevKey; }
});

// ─── Pisanje ───────────────────────────────────────────────────

test("upsertAnalysis šalje POST na ticket_analysis s merge-duplicates", () => withConfig(async () => {
  const client = mockClient();
  await store.upsertAnalysis({ ticket_id: 42, topic: "dostava" });
  assert.strictEqual(client.calls.post.length, 1);
  assert.strictEqual(client.calls.post[0].url, "/rest/v1/ticket_analysis");
  assert.strictEqual(client.calls.post[0].body.ticket_id, 42);
  assert.match(client.calls.post[0].config.headers.Prefer, /merge-duplicates/);
}));

test("getCursor čita last_cursor", () => withConfig(async () => {
  mockClient({ getImpl: () => ({ data: [{ last_cursor: "2026-06-01T00:00:00Z" }], headers: {} }) });
  assert.strictEqual(await store.getCursor(), "2026-06-01T00:00:00Z");
}));

test("getCursor vraća null kad nema reda", () => withConfig(async () => {
  mockClient({ getImpl: () => ({ data: [], headers: {} }) });
  assert.strictEqual(await store.getCursor(), null);
}));

// ─── Agregacije ────────────────────────────────────────────────

test("getTopQuestions grupira po temi i sortira po broju", () => withConfig(async () => {
  mockClient({ getImpl: () => ({ data: [{ topic: "dostava" }, { topic: "dostava" }, { topic: "povrat" }], headers: {} }) });
  const res = await store.getTopQuestions({ limit: 5 });
  assert.deepStrictEqual(res, [{ topic: "dostava", count: 2 }, { topic: "povrat", count: 1 }]);
}));

test("getKbGaps grupira rupe po temi s primjerima i prijedlogom", () => withConfig(async () => {
  mockClient({ getImpl: () => ({ data: [
    { topic: "raspoloživost", suggested_kb_topic: "Stanje zaliha", ticket_id: 1, summary: "pita ima li na stanju" },
    { topic: "raspoloživost", suggested_kb_topic: null, ticket_id: 2, summary: "kad stiže" },
    { topic: "garancija", suggested_kb_topic: "Uvjeti garancije", ticket_id: 3, summary: "garancija na knjigu" }
  ], headers: {} }) });
  const res = await store.getKbGaps({ limit: 10 });
  assert.strictEqual(res[0].topic, "raspoloživost");
  assert.strictEqual(res[0].count, 2);
  assert.strictEqual(res[0].suggested, "Stanje zaliha");
  assert.strictEqual(res[0].examples.length, 2);
  assert.strictEqual(res[1].topic, "garancija");
}));

test("getSummary dohvaća redove jednim upitom i agregira ih", () => withConfig(async () => {
  const client = mockClient({ getImpl: () => ({ data: [
    { channel: "web", handled_by: "bot", bot_quality: "good", is_kb_gap: false },
    { channel: "web", handled_by: "mixed", bot_quality: "bad", is_kb_gap: true },
    { channel: "email", handled_by: "human", bot_quality: "na", is_kb_gap: false },
    { channel: "facebook", handled_by: "bot", bot_quality: "partial", is_kb_gap: false }
  ], headers: {} })});

  const s = await store.getSummary();

  // Jedan dohvat (jedna stranica), ne ~20 count upita kao prije.
  assert.strictEqual(client.calls.get.length, 1);
  assert.strictEqual(s.total, 4);
  assert.strictEqual(s.botResolved, 2);
  assert.strictEqual(s.humanHandled, 2);
  assert.strictEqual(s.kbGaps, 1);
  assert.deepStrictEqual(s.byChannel, { web: 2, email: 1, facebook: 1, ostalo: 0 });
  assert.deepStrictEqual(s.byChannelQuality.web, { good: 1, partial: 0, bad: 1, na: 0 });
}));

test("getSummary šalje created_at filter kad je zadano razdoblje", () => withConfig(async () => {
  const client = mockClient({ getImpl: () => ({ data: [], headers: {} }) });
  const s = await store.getSummary({ from: "2026-07-01", to: "2026-07-31" });

  const url = decodeURIComponent(client.calls.get[0].url);
  assert.match(url, /created_at=gte\.2026-07-01T00:00:00\.000Z/);
  assert.match(url, /created_at=lte\.2026-07-31T23:59:59\.999Z/);
  assert.deepStrictEqual(s.range, {
    from: "2026-07-01T00:00:00.000Z",
    to: "2026-07-31T23:59:59.999Z"
  });
}));

test("getSummary bez razdoblja ne šalje created_at filter", () => withConfig(async () => {
  const client = mockClient({ getImpl: () => ({ data: [], headers: {} }) });
  await store.getSummary();
  assert.ok(!client.calls.get[0].url.includes("created_at=gte"));
  assert.ok(!client.calls.get[0].url.includes("created_at=lte"));
}));

test("getSummary stranicira kad ima više od 1000 redova", () => withConfig(async () => {
  const full = Array.from({ length: 1000 }, () => ({ channel: "web", handled_by: "bot", bot_quality: "good" }));
  const rest = Array.from({ length: 7 }, () => ({ channel: "email", handled_by: "human", bot_quality: "na" }));
  const client = mockClient({ getImpl: (url) => ({
    data: url.includes("offset=0") ? full : rest,
    headers: {}
  })});

  const s = await store.getSummary();
  assert.strictEqual(client.calls.get.length, 2, "druga stranica se dohvaća dok je prva puna");
  assert.strictEqual(s.total, 1007);
  assert.strictEqual(s.byChannel.web, 1000);
  assert.strictEqual(s.byChannel.email, 7);
}));

test("getConversations i getKbGaps poštuju razdoblje", () => withConfig(async () => {
  const client = mockClient({ getImpl: () => ({ data: [], headers: {} }) });
  await store.getConversations({ limit: 5, from: "2026-07-01", to: "2026-07-31" });
  await store.getKbGaps({ limit: 5, from: "2026-07-01", to: "2026-07-31" });
  for (const call of client.calls.get) {
    const url = decodeURIComponent(call.url);
    assert.match(url, /created_at=gte\.2026-07-01/);
    assert.match(url, /created_at=lte\.2026-07-31/);
  }
}));
