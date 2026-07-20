/**
 * Test: agregacija analitike po razdoblju (analyticsStore.tallySummary/normalizeRange).
 *
 * Ovo su čiste funkcije — bez mreže i bez mocka. Pokrivaju invarijante koje su
 * na starom dashboardu bile prekršene (kanali se nisu zbrajali u ukupno,
 * kvaliteta je premašivala broj upita).
 */
const test = require("node:test");
const assert = require("node:assert");

const { tallySummary, normalizeRange } = require("../services/analyticsStore");

function row(over = {}) {
  return {
    created_at: "2026-07-10T10:00:00Z",
    channel: "web",
    handled_by: "bot",
    bot_quality: "good",
    is_kb_gap: false,
    ...over
  };
}

// ─── normalizeRange ────────────────────────────────────────────

test("normalizeRange širi datum-only na cijeli dan (from 00:00, to 23:59)", () => {
  const r = normalizeRange({ from: "2026-07-01", to: "2026-07-31" });
  assert.strictEqual(r.from, "2026-07-01T00:00:00.000Z");
  assert.strictEqual(r.to, "2026-07-31T23:59:59.999Z");
});

test("normalizeRange propušta pun ISO timestamp nepromijenjen", () => {
  const r = normalizeRange({ from: "2026-07-01T08:30:00.000Z", to: "2026-07-02T09:00:00.000Z" });
  assert.strictEqual(r.from, "2026-07-01T08:30:00.000Z");
  assert.strictEqual(r.to, "2026-07-02T09:00:00.000Z");
});

test("normalizeRange bez argumenata vraća null (bez filtera = sve)", () => {
  const r = normalizeRange({});
  assert.strictEqual(r.from, null);
  assert.strictEqual(r.to, null);
});

test("normalizeRange odbacuje neispravan datum", () => {
  assert.throws(() => normalizeRange({ from: "jucer" }), /neispravan/i);
  assert.throws(() => normalizeRange({ to: "2026-13-45" }), /neispravan/i);
});

test("normalizeRange odbacuje obrnut raspon (from nakon to)", () => {
  assert.throws(() => normalizeRange({ from: "2026-07-31", to: "2026-07-01" }), /raspon/i);
});

// ─── tallySummary: osnovne invarijante ─────────────────────────

test("tallySummary: bot + čovjek uvijek daju ukupno", () => {
  const s = tallySummary([
    row({ handled_by: "bot" }),
    row({ handled_by: "bot" }),
    row({ handled_by: "mixed" }),
    row({ handled_by: "human" })
  ]);
  assert.strictEqual(s.total, 4);
  assert.strictEqual(s.botResolved, 2);
  assert.strictEqual(s.humanHandled, 2, "mixed i human se oboje broje kao čovjek preuzeo");
  assert.strictEqual(s.botResolved + s.humanHandled, s.total);
});

test("tallySummary: kanali se zbrajaju u ukupno (uklj. 'ostalo')", () => {
  const s = tallySummary([
    row({ channel: "web" }),
    row({ channel: "api" }),          // web bucket
    row({ channel: "email" }),
    row({ channel: "facebook" }),
    row({ channel: "voice" })          // nepoznat → ostalo
  ]);
  const { web, email, facebook, ostalo } = s.byChannel;
  assert.strictEqual(web, 2);
  assert.strictEqual(email, 1);
  assert.strictEqual(facebook, 1);
  assert.strictEqual(ostalo, 1);
  assert.strictEqual(web + email + facebook + ostalo, s.total);
});

test("tallySummary: kvaliteta po kanalu ne premašuje broj upita tog kanala", () => {
  const s = tallySummary([
    row({ channel: "web", bot_quality: "good" }),
    row({ channel: "web", bot_quality: "bad" }),
    row({ channel: "web", bot_quality: "na" }),
    row({ channel: "email", bot_quality: "partial" })
  ]);
  const q = s.byChannelQuality.web;
  assert.deepStrictEqual(q, { good: 1, partial: 0, bad: 1, na: 1 });
  assert.strictEqual(q.good + q.partial + q.bad + q.na, s.byChannel.web);
  assert.strictEqual(s.byChannelQuality.email.partial, 1);
});

test("tallySummary: ukupna kvaliteta se zbraja u ukupno", () => {
  const s = tallySummary([
    row({ bot_quality: "good" }),
    row({ bot_quality: "good" }),
    row({ bot_quality: "partial" }),
    row({ bot_quality: "bad" }),
    row({ bot_quality: "na" })
  ]);
  const { good, partial, bad, na } = s.byQuality;
  assert.strictEqual(good + partial + bad + na, s.total);
  assert.strictEqual(good, 2);
});

test("tallySummary broji KB rupe", () => {
  const s = tallySummary([row({ is_kb_gap: true }), row({ is_kb_gap: true }), row({ is_kb_gap: false })]);
  assert.strictEqual(s.kbGaps, 2);
});

// ─── tallySummary: rubni slučajevi ─────────────────────────────

test("tallySummary na praznom skupu vraća nule, ne dijeli s nulom", () => {
  const s = tallySummary([]);
  assert.strictEqual(s.total, 0);
  assert.strictEqual(s.botResolved, 0);
  assert.strictEqual(s.humanHandled, 0);
  assert.deepStrictEqual(s.byChannel, { web: 0, email: 0, facebook: 0, ostalo: 0 });
});

test("tallySummary tolerira nedostajuća/nepoznata polja", () => {
  const s = tallySummary([
    { created_at: "2026-07-10T10:00:00Z" },                    // sve prazno
    { channel: null, handled_by: null, bot_quality: null },
    { channel: "EMAIL", handled_by: "BOT", bot_quality: "GOOD" } // velika slova
  ]);
  assert.strictEqual(s.total, 3);
  assert.strictEqual(s.byChannel.ostalo, 2, "nepoznat/prazan kanal ide u ostalo");
  assert.strictEqual(s.byChannel.email, 1, "kanal se uspoređuje case-insensitive");
  assert.strictEqual(s.botResolved, 1);
  assert.strictEqual(s.byQuality.good, 1);
  // Redovi bez bot_quality ne smiju nestati iz zbroja
  assert.strictEqual(s.byQuality.good + s.byQuality.partial + s.byQuality.bad + s.byQuality.na, s.total);
});

test("tallySummary: handled_by izvan poznatih vrijednosti se broji kao čovjek", () => {
  // Konzervativno: ne pripisuj botu zasluge za nešto što nismo klasificirali.
  const s = tallySummary([row({ handled_by: "nepoznato" })]);
  assert.strictEqual(s.botResolved, 0);
  assert.strictEqual(s.humanHandled, 1);
  assert.strictEqual(s.botResolved + s.humanHandled, s.total);
});
