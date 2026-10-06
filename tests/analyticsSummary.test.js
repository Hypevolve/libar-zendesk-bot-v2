/**
 * Test: agregacija analitike po razdoblju (analyticsStore.tallySummary/normalizeRange).
 *
 * Ovo su čiste funkcije — bez mreže i bez mocka. Pokrivaju invarijante koje su
 * na starom dashboardu bile prekršene (kanali se nisu zbrajali u ukupno,
 * kvaliteta je premašivala broj upita).
 */
const test = require("node:test");
const assert = require("node:assert");

const env = require("../config/env");
const {
  tallySummary, normalizeRange, effectiveRange, classifyRequest, outcomeOf, tallyKbGaps
} = require("../services/analyticsStore");

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

// ─── Početak rada bota ─────────────────────────────────────────

function withStartDate(value, fn) {
  const prev = env.ANALYSIS_START_DATE;
  env.ANALYSIS_START_DATE = value;
  try { return fn(); } finally { env.ANALYSIS_START_DATE = prev; }
}

test("effectiveRange ne pušta razdoblje prije početka rada bota", () => withStartDate("2026-06-01", () => {
  assert.strictEqual(effectiveRange({}).from, "2026-06-01T00:00:00.000Z");
  assert.strictEqual(effectiveRange({ from: "2020-01-01" }).from, "2026-06-01T00:00:00.000Z");
}));

test("effectiveRange zadržava kasniji 'from' i 'to'", () => withStartDate("2026-06-01", () => {
  const r = effectiveRange({ from: "2026-08-01", to: "2026-08-31" });
  assert.strictEqual(r.from, "2026-08-01T00:00:00.000Z");
  assert.strictEqual(r.to, "2026-08-31T23:59:59.999Z");
}));

test("effectiveRange bez ANALYSIS_START_DATE ne dodaje granicu", () => withStartDate("", () => {
  assert.strictEqual(effectiveRange({}).from, null);
}));

// ─── Klasifikacija upita ───────────────────────────────────────

test("classifyRequest: spam, reklame i sistemske poruke nisu upiti kupaca", () => {
  assert.strictEqual(classifyRequest({ topic: "TikTok Shop promocija" }), "sum");
  assert.strictEqual(classifyRequest({ topic: "specifikacija pouzeća" }), "sum");
  assert.strictEqual(classifyRequest({ topic: "spam" }), "sum");
  assert.strictEqual(classifyRequest({ topic: "nepoznato", summary: "Primljen je promotivni email koji nije relevantan za Antikvarijat Libar." }), "sum");
});

test("classifyRequest: reklamacija nije reklama", () => {
  assert.strictEqual(classifyRequest({ topic: "reklamacija udžbenika" }), "narudzba");
});

test("classifyRequest: poruke bez pitanja", () => {
  assert.strictEqual(classifyRequest({ topic: "potvrda dostave" }), "bez_pitanja");
  assert.strictEqual(classifyRequest({ topic: "zahvala" }), "bez_pitanja");
  assert.strictEqual(classifyRequest({ topic: "ostalo" }), "bez_pitanja");
});

test("classifyRequest: skupine stvarnih upita", () => {
  assert.strictEqual(classifyRequest({ topic: "otkazan nalog otkupa" }), "otkazani_otkup");
  assert.strictEqual(classifyRequest({ topic: "otkazivanje otkupa" }), "otkazani_otkup");
  assert.strictEqual(classifyRequest({ topic: "status narudžbe" }), "narudzba");
  assert.strictEqual(classifyRequest({ topic: "povrat novca" }), "narudzba");
  assert.strictEqual(classifyRequest({ topic: "raspoloživost naslova" }), "dostupnost");
  assert.strictEqual(classifyRequest({ topic: "Dostupnost udžbenika" }), "dostupnost");
  assert.strictEqual(classifyRequest({ topic: "otkup udžbenika" }), "otkup");
  assert.strictEqual(classifyRequest({ topic: "prodaja knjiga" }), "otkup");
  assert.strictEqual(classifyRequest({ topic: "dostava" }), "kupnja");
  assert.strictEqual(classifyRequest({ topic: "kupnja udžbenika" }), "kupnja");
  assert.strictEqual(classifyRequest({ topic: "pretraga knjiga" }), "ostalo");
});

test("classifyRequest: kupac koji spominje spam ostaje upit kupca", () => {
  assert.strictEqual(
    classifyRequest({ topic: "otkup knjiga", summary: "Korisnik pita zašto je njegov mail završio u spamu i otkupljujete li knjige." }),
    "otkup"
  );
});

// ─── Ishod upita ───────────────────────────────────────────────

test("outcomeOf: loš odgovor bota nije 'bot riješio'", () => {
  // Stari dashboard je svaki bot-only ticket brojao kao riješen, i s lošim odgovorom.
  assert.strictEqual(outcomeOf({ handled_by: "bot", bot_quality: "bad" }), "botBad");
  assert.strictEqual(outcomeOf({ handled_by: "bot", bot_quality: "na" }), "botBad");
  assert.strictEqual(outcomeOf({ handled_by: "bot", bot_quality: "good" }), "botSolved");
});

test("outcomeOf: djelomičan ili koristan doprinos bota uz agenta = pomogao", () => {
  assert.strictEqual(outcomeOf({ handled_by: "bot", bot_quality: "partial" }), "botAssisted");
  assert.strictEqual(outcomeOf({ handled_by: "mixed", bot_quality: "good" }), "botAssisted");
  assert.strictEqual(outcomeOf({ handled_by: "mixed", bot_quality: "partial" }), "botAssisted");
  assert.strictEqual(outcomeOf({ handled_by: "mixed", bot_quality: "bad" }), "botBad");
});

test("outcomeOf: bot nije sudjelovao → samo agent", () => {
  assert.strictEqual(outcomeOf({ handled_by: "human", bot_quality: "na" }), "humanOnly");
  assert.strictEqual(outcomeOf({ handled_by: "mixed", bot_quality: "na" }), "humanOnly");
  assert.strictEqual(outcomeOf({}), "humanOnly");
});

// ─── tallySummary: upiti kupaca ────────────────────────────────

test("tallySummary: spam i poruke bez pitanja ne ulaze u nazivnik", () => {
  const s = tallySummary([
    row({ topic: "dostava", handled_by: "bot", bot_quality: "good" }),
    row({ topic: "status narudžbe", handled_by: "human", bot_quality: "na" }),
    row({ topic: "TikTok Shop promocija", handled_by: "bot", bot_quality: "good" }),
    row({ topic: "potvrda dostave", handled_by: "bot", bot_quality: "good" })
  ]);
  assert.strictEqual(s.total, 4);
  assert.deepStrictEqual(s.excluded, { sum: 1, bez_pitanja: 1 });
  assert.strictEqual(s.customerQueries, 2);
  assert.strictEqual(s.botResolved, 1, "reklama i potvrda dostave nisu zasluga bota");
  assert.strictEqual(s.customerQueries + s.excluded.sum + s.excluded.bez_pitanja, s.total);
});

test("tallySummary: ishodi se zbrajaju u upite kupaca, i po kanalu", () => {
  const s = tallySummary([
    row({ channel: "email", handled_by: "bot", bot_quality: "good" }),
    row({ channel: "email", handled_by: "mixed", bot_quality: "partial" }),
    row({ channel: "web", handled_by: "bot", bot_quality: "bad" }),
    row({ channel: "facebook", handled_by: "human", bot_quality: "na" })
  ]);
  const o = s.outcomes;
  assert.strictEqual(o.botSolved + o.botAssisted + o.botBad + o.humanOnly, s.customerQueries);
  for (const ch of ["web", "email", "facebook", "ostalo"]) {
    const c = s.byChannelOutcome[ch];
    assert.strictEqual(c.botSolved + c.botAssisted + c.botBad + c.humanOnly, s.byChannel[ch]);
  }
  assert.strictEqual(s.byChannelOutcome.email.botSolved, 1);
  assert.strictEqual(s.byChannelOutcome.email.botAssisted, 1);
});

test("tallyKbGaps: rupe na spamu se ne broje", () => {
  const gaps = tallyKbGaps([
    { topic: "otkup knjiga", is_kb_gap: true, ticket_id: 1 },
    { topic: "spam", is_kb_gap: true, ticket_id: 2 },
    { topic: "otkup knjiga", is_kb_gap: false, ticket_id: 3 }
  ]);
  assert.deepStrictEqual(gaps.map((g) => [g.category, g.count]), [["otkup", 1]]);
});
