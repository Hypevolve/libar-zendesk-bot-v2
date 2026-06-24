/**
 * Test: ticketAnalysisService (LLM analizator + orkestrator).
 * Sve ovisnosti (Zendesk, LLM, store) su mockane - bez živih poziva.
 */
const test = require("node:test");
const assert = require("node:assert");
const svc = require("../services/ticketAnalysisService");

// ─── parseAnalysis ─────────────────────────────────────────────

test("parseAnalysis čita valjan JSON i normalizira enume", () => {
  const a = svc.parseAnalysis(JSON.stringify({
    topic: "dostava", intent: "pita gdje je paket", handled_by: "bot",
    bot_answered: true, bot_quality: "good", is_kb_gap: false,
    summary: "korisnik pita za dostavu", language: "hr"
  }));
  assert.strictEqual(a.topic, "dostava");
  assert.strictEqual(a.handled_by, "bot");
  assert.strictEqual(a.bot_answered, true);
  assert.strictEqual(a.is_kb_gap, false);
  assert.strictEqual(a.kb_gap_reason, null);
});

test("parseAnalysis vraća sigurne defaulte za manjkav/nevaljan izlaz", () => {
  const a = svc.parseAnalysis("nije json");
  assert.strictEqual(a.topic, "ostalo");
  assert.strictEqual(a.bot_quality, "na");
  assert.strictEqual(a.handled_by, "mixed");
  assert.strictEqual(a.is_kb_gap, false);
});

test("parseAnalysis poništava gap polja kad is_kb_gap nije true", () => {
  const a = svc.parseAnalysis(JSON.stringify({ is_kb_gap: false, kb_gap_reason: "x", suggested_kb_topic: "y" }));
  assert.strictEqual(a.kb_gap_reason, null);
  assert.strictEqual(a.suggested_kb_topic, null);
});

// ─── run() orkestracija ────────────────────────────────────────

function mockStore({ cursor = null } = {}) {
  const calls = { upserts: [], cursors: [] };
  return {
    calls,
    isConfigured: () => true,
    getCursor: async () => cursor,
    setCursor: async (c) => { calls.cursors.push(c); },
    upsertAnalysis: async (r) => { calls.upserts.push(r); }
  };
}

test("run() analizira tickete, broji KB rupe i pomiče cursor", async () => {
  const store = mockStore();
  let call = 0;
  const deps = {
    store,
    listTicketsSince: async (cursor, opts) => {
      deps._listArgs = { cursor, opts };
      return { tickets: [
        { id: 1, channel: "email", created_at: "2026-06-01T00:00:00Z", subject: "A", requester_id: 11, status: "solved" },
        { id: 2, channel: "web_chat", created_at: "2026-06-02T00:00:00Z", subject: "B", requester_id: 22, status: "open" }
      ], nextCursorISO: "2026-06-03T00:00:00Z" };
    },
    getPublicTicketComments: async () => [{ body: "Pitanje korisnika" }],
    llm: async () => {
      call += 1;
      return JSON.stringify({
        topic: call === 1 ? "raspoloživost" : "dostava",
        handled_by: "bot", bot_answered: call !== 1, bot_quality: call === 1 ? "bad" : "good",
        is_kb_gap: call === 1, kb_gap_reason: call === 1 ? "nema u bazi" : null,
        suggested_kb_topic: call === 1 ? "Stanje zaliha" : null,
        summary: "sažetak", language: "hr"
      });
    }
  };

  const res = await svc.run({ maxTickets: 50 }, deps);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.analyzed, 2);
  assert.strictEqual(res.kbGaps, 1);
  assert.strictEqual(res.errors, 0);
  assert.strictEqual(store.calls.upserts.length, 2);
  assert.strictEqual(store.calls.upserts[0].ticket_id, 1);
  assert.strictEqual(store.calls.upserts[0].is_kb_gap, true);
  assert.strictEqual(store.calls.cursors[0], "2026-06-03T00:00:00Z");
  assert.strictEqual(deps._listArgs.opts.maxTickets, 50);
});

test("run() maskira PII prije slanja LLM-u", async () => {
  const store = mockStore();
  let capturedUserText = "";
  const deps = {
    store,
    listTicketsSince: async () => ({ tickets: [{ id: 9, channel: "email", subject: "upit", requester_id: 1 }], nextCursorISO: "2026-06-03T00:00:00Z" }),
    getPublicTicketComments: async () => [{ body: "Moj email je test@example.com, javite se." }],
    llm: async (_sys, userText) => { capturedUserText = userText; return JSON.stringify({ topic: "x", summary: "y" }); }
  };
  await svc.run({}, deps);
  assert.ok(!capturedUserText.includes("test@example.com"), "sirovi email ne smije ići LLM-u");
});

test("run() nastavlja kad LLM padne na jednom ticketu", async () => {
  const store = mockStore();
  let call = 0;
  const deps = {
    store,
    listTicketsSince: async () => ({ tickets: [{ id: 1, subject: "a" }, { id: 2, subject: "b" }], nextCursorISO: "2026-06-03T00:00:00Z" }),
    getPublicTicketComments: async () => [{ body: "x" }],
    llm: async () => { call += 1; if (call === 1) throw new Error("LLM down"); return JSON.stringify({ topic: "ok" }); }
  };
  const res = await svc.run({}, deps);
  assert.strictEqual(res.errors, 1);
  assert.strictEqual(res.analyzed, 1);
});

test("run() vraća ok:false kad Supabase nije konfiguriran", async () => {
  const res = await svc.run({}, { store: { isConfigured: () => false } });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, "supabase_not_configured");
});
