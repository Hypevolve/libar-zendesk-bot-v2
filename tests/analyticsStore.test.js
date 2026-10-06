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

// Mock koji glumi Supabase max-rows: svaka stranica najviše 1000 redova.
// Upit bez offseta (stari kod) dobije samo prvu stranicu.
function pagedImpl(allRows) {
  return (url) => {
    const offset = Number((url.match(/offset=(\d+)/) || [])[1] || 0);
    return { data: allRows.slice(offset, offset + 1000), headers: {} };
  };
}

test("getTopQuestions grupira varijante tema u skupine i sortira po broju", () => withConfig(async () => {
  mockClient({ getImpl: () => ({ data: [
    { topic: "dostava", handled_by: "bot", bot_quality: "good" },
    { topic: "Kupnja udžbenika", handled_by: "human", bot_quality: "na" },
    { topic: "raspoloživost naslova", handled_by: "bot", bot_quality: "good" },
    { topic: "dostupnost udžbenika", handled_by: "mixed", bot_quality: "bad" },
    { topic: "raspoloživost udžbenika", handled_by: "human", bot_quality: "na" },
    { topic: "spam", handled_by: "bot", bot_quality: "good" }
  ], headers: {} }) });
  const res = await store.getTopQuestions({ limit: 5 });
  assert.strictEqual(res[0].category, "dostupnost");
  assert.strictEqual(res[0].topic, "Dostupnost naslova");
  assert.strictEqual(res[0].count, 3, "tri varijante dostupnosti su jedna skupina");
  assert.strictEqual(res[0].botSolved, 1);
  assert.strictEqual(res[1].category, "kupnja");
  assert.strictEqual(res[1].count, 2);
  assert.ok(!res.some((r) => r.category === "sum"), "spam nije tema upita");
  assert.strictEqual(res.reduce((n, r) => n + r.share, 0).toFixed(6), "1.000000");
}));

test("getTopQuestions broji SVE redove razdoblja, ne samo prvu stranicu od 1000", () => withConfig(async () => {
  const rows = [
    ...Array.from({ length: 1000 }, () => ({ topic: "dostava", handled_by: "bot", bot_quality: "good" })),
    ...Array.from({ length: 1200 }, () => ({ topic: "otkup udžbenika", handled_by: "human", bot_quality: "na" }))
  ];
  const client = mockClient({ getImpl: pagedImpl(rows) });
  const res = await store.getTopQuestions({ limit: 5 });
  assert.strictEqual(client.calls.get.length, 3);
  assert.strictEqual(res[0].category, "otkup");
  assert.strictEqual(res[0].count, 1200);
  assert.strictEqual(res[1].count, 1000);
}));

test("getKbGaps grupira rupe po skupini s rješenjem, prijedlogom i primjerima", () => withConfig(async () => {
  mockClient({ getImpl: () => ({ data: [
    { topic: "raspoloživost naslova", suggested_kb_topic: "Stanje zaliha", ticket_id: 1, summary: "pita ima li na stanju", is_kb_gap: true },
    { topic: "dostupnost udžbenika", suggested_kb_topic: "Stanje zaliha", ticket_id: 2, summary: "kad stiže", is_kb_gap: true },
    { topic: "otkup knjiga", suggested_kb_topic: "Uvjeti otkupa", ticket_id: 3, summary: "otkupljujete li romane", is_kb_gap: true },
    { topic: "nepoznato", suggested_kb_topic: "filtriranje", ticket_id: 4, summary: "Promotivni email TikTok Shopa, nije relevantan.", is_kb_gap: true }
  ], headers: {} }) });
  const res = await store.getKbGaps({ limit: 10 });
  assert.strictEqual(res.length, 2, "promotivni mail nije rupa u bazi");
  assert.strictEqual(res[0].category, "dostupnost");
  assert.strictEqual(res[0].count, 2);
  assert.strictEqual(res[0].suggested, "Stanje zaliha");
  assert.match(res[0].fix, /zalih/i);
  assert.strictEqual(res[0].examples.length, 2);
  assert.strictEqual(res[1].category, "otkup");
}));

test("getKbGaps broji sve rupe razdoblja, ne samo zadnjih 500", () => withConfig(async () => {
  const rows = Array.from({ length: 1700 }, (_, i) => ({ topic: "otkup knjiga", ticket_id: i, summary: "s", is_kb_gap: true }));
  const client = mockClient({ getImpl: pagedImpl(rows) });
  const res = await store.getKbGaps({ limit: 10 });
  assert.strictEqual(res[0].count, 1700);
  assert.match(decodeURIComponent(client.calls.get[0].url), /is_kb_gap=eq\.true/);
}));

test("getSummary agregira ishode nad upitima kupaca", () => withConfig(async () => {
  const client = mockClient({ getImpl: () => ({ data: [
    { channel: "web", handled_by: "bot", bot_quality: "good", is_kb_gap: false, topic: "dostava" },
    { channel: "web", handled_by: "mixed", bot_quality: "bad", is_kb_gap: true, topic: "otkup knjiga" },
    { channel: "email", handled_by: "human", bot_quality: "na", is_kb_gap: false, topic: "status narudžbe" },
    { channel: "facebook", handled_by: "bot", bot_quality: "partial", is_kb_gap: false, topic: "otkup udžbenika" },
    { channel: "email", handled_by: "bot", bot_quality: "good", is_kb_gap: true, topic: "TikTok Shop promocija" }
  ], headers: {} })});

  const s = await store.getSummary();

  assert.strictEqual(client.calls.get.length, 1);
  assert.strictEqual(s.total, 5);
  assert.strictEqual(s.excluded.sum, 1);
  assert.strictEqual(s.customerQueries, 4);
  assert.deepStrictEqual(s.outcomes, { botSolved: 1, botAssisted: 1, botBad: 1, humanOnly: 1 });
  assert.strictEqual(s.botResolved, 1, "djelomičan odgovor bota nije 'bot riješio sam'");
  assert.strictEqual(s.humanHandled, 3);
  assert.strictEqual(s.kbGaps, 1, "rupa na promotivnom mailu se ne broji");
  assert.deepStrictEqual(s.byChannel, { web: 2, email: 1, facebook: 1, ostalo: 0 });
  assert.deepStrictEqual(s.byChannelOutcome.web, { botSolved: 1, botAssisted: 0, botBad: 1, humanOnly: 0 });
  assert.strictEqual(s.byCategory.otkup.total, 2);
  assert.strictEqual(s.byCategory.otkup.kbGaps, 1);
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

test("getSummary bez razdoblja broji od početka rada bota, ne od 2020.", () => withConfig(async () => {
  const prev = env.ANALYSIS_START_DATE;
  env.ANALYSIS_START_DATE = "2026-06-01";
  try {
    const client = mockClient({ getImpl: () => ({ data: [], headers: {} }) });
    const s = await store.getSummary();
    const url = decodeURIComponent(client.calls.get[0].url);
    assert.match(url, /created_at=gte\.2026-06-01T00:00:00\.000Z/);
    assert.ok(!url.includes("created_at=lte"));
    assert.strictEqual(s.range.from, "2026-06-01T00:00:00.000Z");
  } finally { env.ANALYSIS_START_DATE = prev; }
}));

test("svi analitički upiti poštuju početak rada bota", () => withConfig(async () => {
  const prev = env.ANALYSIS_START_DATE;
  env.ANALYSIS_START_DATE = "2026-06-01";
  try {
    const client = mockClient({ getImpl: () => ({ data: [], headers: {} }) });
    await store.getConversations({ limit: 5, from: "2020-01-01" });
    await store.getTopQuestions({ from: "2019-12-01" });
    await store.getKbGaps({});
    for (const call of client.calls.get) {
      assert.match(decodeURIComponent(call.url), /created_at=gte\.2026-06-01T00:00:00\.000Z/);
    }
  } finally { env.ANALYSIS_START_DATE = prev; }
}));

test("getSummary stranicira kad ima više od 1000 redova", () => withConfig(async () => {
  const full = Array.from({ length: 1000 }, () => ({ channel: "web", handled_by: "bot", bot_quality: "good" }));
  const rest = Array.from({ length: 7 }, () => ({ channel: "email", handled_by: "human", bot_quality: "na" }));
  const client = mockClient({ getImpl: (url) => ({
    data: /offset=0&/.test(url) ? full : rest,
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
