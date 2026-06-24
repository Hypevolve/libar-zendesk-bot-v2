/**
 * Test: normalizeIncrementalTicket (čista normalizacija ticketa iz Zendesk
 * Incremental API-ja). Mrežna listTicketsSince se ne testira uživo.
 */
const test = require("node:test");
const assert = require("node:assert");
const { normalizeIncrementalTicket } = require("../services/zendeskService");

test("normalizira polja i izvlači kanal iz via", () => {
  const out = normalizeIncrementalTicket({
    id: 123, subject: "Dostava", status: "solved",
    via: { channel: "email" }, created_at: "2026-06-01T10:00:00Z",
    requester_id: 999, tags: ["delivery"]
  });
  assert.deepStrictEqual(out, {
    id: 123, subject: "Dostava", status: "solved", channel: "email",
    created_at: "2026-06-01T10:00:00Z", requester_id: 999, tags: ["delivery"]
  });
});

test("ima sigurne defaulte kad polja fale", () => {
  const out = normalizeIncrementalTicket({ id: 5 });
  assert.strictEqual(out.channel, "unknown");
  assert.strictEqual(out.subject, "");
  assert.deepStrictEqual(out.tags, []);
  assert.strictEqual(out.status, null);
});

test("koristi raw_subject kao fallback za subject", () => {
  const out = normalizeIncrementalTicket({ id: 7, raw_subject: "Re: upit" });
  assert.strictEqual(out.subject, "Re: upit");
});
