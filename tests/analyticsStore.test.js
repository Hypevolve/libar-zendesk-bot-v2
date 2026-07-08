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
    assert.deepStrictEqual(await store.getSummary(), {
      total: 0, kbGaps: 0, byHandledBy: {}, byQuality: {},
      byChannel: { web: 0, email: 0, facebook: 0, ostalo: 0 }, byChannelQuality: {}
    });
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

test("getSummary parsira count iz content-range", () => withConfig(async () => {
  mockClient({ getImpl: (url) => {
    // total bez filtera vs filtrirani
    let count = "10";
    if (url.includes("is_kb_gap=eq.true")) count = "3";
    else if (url.includes("handled_by=eq.bot")) count = "6";
    else if (url.includes("handled_by")) count = "0";
    else if (url.includes("bot_quality=eq.good")) count = "5";
    else if (url.includes("bot_quality")) count = "0";
    return { data: [], headers: { "content-range": `0-0/${count}` } };
  }});
  const s = await store.getSummary();
  assert.strictEqual(s.total, 10);
  assert.strictEqual(s.kbGaps, 3);
  assert.strictEqual(s.byHandledBy.bot, 6);
  assert.strictEqual(s.byQuality.good, 5);
}));

test("getSummary vraća byChannel i byChannelQuality iz Zendesk via.channel", () => withConfig(async () => {
  // countWhere gradi URL "/rest/v1/ticket_analysis?select=ticket_id" + filterQS.
  // Ovdje simuliramo brojeve po channelBuckets() filteru (i po bot_quality unutar njega).
  mockClient({ getImpl: (url) => {
    let count = "10"; // total i sve ne-channel filtere (handled_by, bot_quality, kb_gap) tretiramo kao 10 - nebitno za ovaj test
    if (url.includes("channel=in.(email)")) {
      if (url.includes("bot_quality=eq.good")) count = "2";
      else if (url.includes("bot_quality=eq.partial")) count = "1";
      else if (url.includes("bot_quality=eq.bad")) count = "0";
      else if (url.includes("bot_quality=eq.na")) count = "1";
      else count = "4";
    } else if (url.includes("channel=in.(facebook,messenger,facebook_page,facebook_post)")) {
      if (url.includes("bot_quality")) count = "0";
      else count = "1";
    } else if (url.includes("channel=in.(web,web_widget,web_service,chat,messaging,api)")) {
      if (url.includes("bot_quality=eq.good")) count = "3";
      else if (url.includes("bot_quality=eq.partial")) count = "1";
      else if (url.includes("bot_quality=eq.bad")) count = "1";
      else if (url.includes("bot_quality=eq.na")) count = "0";
      else count = "5";
    }
    return { data: [], headers: { "content-range": `0-0/${count}` } };
  }});
  const s = await store.getSummary();
  assert.strictEqual(s.byChannel.email, 4);
  assert.strictEqual(s.byChannel.facebook, 1);
  assert.strictEqual(s.byChannel.web, 5);
  // ostalo = total(10) - web(5) - email(4) - facebook(1) = 0
  assert.strictEqual(s.byChannel.ostalo, 0);
  assert.deepStrictEqual(s.byChannelQuality.email, { good: 2, partial: 1, bad: 0, na: 1 });
  assert.deepStrictEqual(s.byChannelQuality.facebook, { good: 0, partial: 0, bad: 0, na: 0 });
  assert.deepStrictEqual(s.byChannelQuality.web, { good: 3, partial: 1, bad: 1, na: 0 });
}));
