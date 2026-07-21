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

// ─── extractQA ─────────────────────────────────────────────────

test("extractQA razlikuje pitanje kupca i zadnji odgovor po requesterId", () => {
  const comments = [
    { author_id: 11, body: "Gdje je moja narudžba?" },
    { author_id: 99, body: "Poslana je jučer, stiže sutra." },
    { author_id: 11, body: "Hvala!" }
  ];
  const qa = svc.extractQA(comments, 11);
  assert.strictEqual(qa.firstQuestion, "Gdje je moja narudžba?");
  assert.strictEqual(qa.lastReply, "Poslana je jučer, stiže sutra.");
});

test("extractQA fallback na prvi/zadnji kad nema requesterId", () => {
  const qa = svc.extractQA([{ body: "A" }, { body: "B" }]);
  assert.strictEqual(qa.firstQuestion, "A");
  assert.strictEqual(qa.lastReply, "B");
});

test("extractQA: lastReply prazan kad postoji samo pitanje", () => {
  const qa = svc.extractQA([{ author_id: 11, body: "Samo pitanje" }], 11);
  assert.strictEqual(qa.firstQuestion, "Samo pitanje");
  assert.strictEqual(qa.lastReply, "");
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

// ─── backfill (sinceDays nadjačava spremljeni cursor) ──────────

// Zajednički mock za backfill testove: bilježi s kojim je cursorom pozvan
// listTicketsSince i vraća zadani nextCursorISO.
function backfillDeps(store, { nextCursorISO }) {
  const deps = {
    store,
    listTicketsSince: async (cursor, opts) => {
      deps._listArgs = { cursor, opts };
      return { tickets: [{ id: 1, subject: "a", created_at: "2026-04-01T00:00:00Z" }], nextCursorISO };
    },
    getPublicTicketComments: async () => [{ body: "x" }],
    llm: async () => JSON.stringify({ topic: "ok", summary: "s" })
  };
  return deps;
}

test("run({sinceDays}) kreće od zadanog prozora, ne od spremljenog cursora", async () => {
  const store = mockStore({ cursor: "2026-07-01T00:00:00Z" });
  const deps = backfillDeps(store, { nextCursorISO: "2026-04-05T00:00:00Z" });

  await svc.run({ sinceDays: 365 }, deps);

  const used = new Date(deps._listArgs.cursor).getTime();
  const expected = Date.now() - 365 * 24 * 60 * 60 * 1000;
  assert.ok(Math.abs(used - expected) < 60_000, "cursor mora biti ~365 dana unatrag");
  assert.ok(used < new Date("2026-07-01T00:00:00Z").getTime(), "ne smije koristiti spremljeni cursor");
});

test("backfill ne vraća spremljeni cursor unatrag", async () => {
  const store = mockStore({ cursor: "2026-07-01T00:00:00Z" });
  const deps = backfillDeps(store, { nextCursorISO: "2026-04-05T00:00:00Z" });

  await svc.run({ sinceDays: 365 }, deps);

  assert.deepStrictEqual(store.calls.cursors, [], "stariji cursor se ne smije upisati");
});

test("backfill koji prestigne spremljeni cursor ga pomiče naprijed", async () => {
  const store = mockStore({ cursor: "2026-07-01T00:00:00Z" });
  const deps = backfillDeps(store, { nextCursorISO: "2026-07-15T00:00:00Z" });

  await svc.run({ sinceDays: 365 }, deps);

  assert.deepStrictEqual(store.calls.cursors, ["2026-07-15T00:00:00Z"]);
});

test("run() bez sinceDays i dalje koristi spremljeni cursor", async () => {
  const store = mockStore({ cursor: "2026-07-01T00:00:00Z" });
  const deps = backfillDeps(store, { nextCursorISO: "2026-07-02T00:00:00Z" });

  await svc.run({}, deps);

  assert.strictEqual(deps._listArgs.cursor, "2026-07-01T00:00:00Z");
  assert.deepStrictEqual(store.calls.cursors, ["2026-07-02T00:00:00Z"]);
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

test("run() preskače obrisane tickete (status deleted) i 404, ne broji kao greške", async () => {
  const store = mockStore();
  const deps = {
    store,
    listTicketsSince: async () => ({ tickets: [
      { id: 1, status: "deleted", subject: "a" },
      { id: 2, status: "solved", subject: "b" },
      { id: 3, status: "open", subject: "c" }
    ], nextCursorISO: "2026-06-03T00:00:00Z" }),
    getPublicTicketComments: async (id) => {
      if (id === 3) throw new Error("getPublicTicketComments failed (404).");
      return [{ body: "x" }];
    },
    llm: async () => JSON.stringify({ topic: "ok" })
  };
  const res = await svc.run({}, deps);
  assert.strictEqual(res.analyzed, 1);  // samo ticket 2
  assert.strictEqual(res.skipped, 2);   // 1 deleted + 1 (404)
  assert.strictEqual(res.errors, 0);
});

test("run() vraća ok:false kad Supabase nije konfiguriran", async () => {
  const res = await svc.run({}, { store: { isConfigured: () => false } });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, "supabase_not_configured");
});
