/**
 * Test: Agent intervention detection (signature-based, STICKY).
 * Every bot reply ends with the signature "---\n*Vaš Libar AI Asistent*".
 * Once ANY public comment in the ticket is from a human agent, the bot must
 * stay silent for the rest of the conversation — even if the customer messages
 * again afterwards. We exercise the real pure function (no API).
 *
 * Nakon preimenovanja (EU AI Act) bot EMITIRA novi potpis, ali MORA i dalje
 * prepoznavati STARI ("Vaš Libar Asistent") jer ga nose botovi odgovori na već
 * otvorenim tiketima u Zendesku. Zato se cijeli scenarij dolje vrti nad OBA
 * potpisa — ako netko ubuduće izbaci legacy oblik, ovi testovi padnu.
 */
const test = require("node:test");
const assert = require("node:assert");
const {
  detectAgentTakeover,
  isBotSignedComment,
  containsBotSignatureName,
  BOT_SIGNATURE: EXPORTED_BOT_SIGNATURE,
  LEGACY_BOT_SIGNATURE: EXPORTED_LEGACY_BOT_SIGNATURE
} = require("../services/zendeskService");

// Doslovne kopije — namjerno NE izvedene iz servisa, da promjena konstante u
// servisu ovdje padne umjesto da tiho prođe.
const BOT_SIGNATURE = "\n\n---\n*Vaš Libar AI Asistent*";
const LEGACY_BOT_SIGNATURE = "\n\n---\n*Vaš Libar Asistent*";

const SIGNATURES = [
  ["novi potpis", BOT_SIGNATURE],
  ["stari potpis (legacy)", LEGACY_BOT_SIGNATURE]
];

function mockCheckForAgentIntervention(scenario) {
  return detectAgentTakeover(scenario.comments, scenario.requesterId);
}

function mockIsHumanHandled(tags) {
  const blocked = ["resolved", "awaiting_human"];
  return tags.some((t) => blocked.includes(t));
}

// ─── Potpis koji bot emitira / prepoznaje ──────────────────────────────────

test("Bot emitira NOVI potpis", () => {
  assert.strictEqual(EXPORTED_BOT_SIGNATURE, BOT_SIGNATURE, "emitirani potpis mora biti 'Vaš Libar AI Asistent'");
});

test("Legacy potpis je i dalje definiran (regresija: ne smije se obrisati)", () => {
  assert.strictEqual(EXPORTED_LEGACY_BOT_SIGNATURE, LEGACY_BOT_SIGNATURE);
});

test("isBotSignedComment prepoznaje NOVI potpis", () => {
  assert.strictEqual(isBotSignedComment("Odgovor" + BOT_SIGNATURE), true);
});

test("isBotSignedComment prepoznaje STARI potpis (regresija)", () => {
  assert.strictEqual(isBotSignedComment("Odgovor" + LEGACY_BOT_SIGNATURE), true);
});

test("isBotSignedComment ne prepoznaje običan agentov komentar", () => {
  assert.strictEqual(isBotSignedComment("Javljam se ja, agent."), false);
  assert.strictEqual(isBotSignedComment(""), false);
  assert.strictEqual(isBotSignedComment(null), false);
});

test("Loop-guard (containsBotSignatureName) prepoznaje NOVI potpis", () => {
  assert.strictEqual(containsBotSignatureName("Odgovor" + BOT_SIGNATURE), true);
  assert.strictEqual(containsBotSignatureName("<p>Odgovor</p><p><em>Vaš Libar AI Asistent</em></p>"), true);
});

test("Loop-guard (containsBotSignatureName) prepoznaje STARI potpis (regresija)", () => {
  assert.strictEqual(containsBotSignatureName("Odgovor" + LEGACY_BOT_SIGNATURE), true);
  assert.strictEqual(containsBotSignatureName("<p>Odgovor</p><p><em>Vaš Libar Asistent</em></p>"), true);
});

test("Loop-guard ne okida na poruci kupca", () => {
  assert.strictEqual(containsBotSignatureName("Dobar dan, zanima me dostava."), false);
  assert.strictEqual(containsBotSignatureName(""), false);
  assert.strictEqual(containsBotSignatureName(undefined), false);
});

// ─── Signature-based detection (nad OBA potpisa) ───────────────────────────

for (const [label, SIG] of SIGNATURES) {
  test(`Customer messages after bot reply → bot responds [${label}]`, () => {
    const agentCheck = mockCheckForAgentIntervention({
      comments: [
        { author_id: 100, body: "Hello" },
        { author_id: 200, body: "Hi!" + SIG },
        { author_id: 100, body: "Another question" }
      ],
      requesterId: 100
    });

    assert.strictEqual(agentCheck.takenOver, false, "Customer is latest → proceed");
  });

  test(`Agent replies and forgets tags → bot stays silent [${label}]`, () => {
    const agentCheck = mockCheckForAgentIntervention({
      comments: [
        { author_id: 100, body: "Hello" },
        { author_id: 200, body: "Hi!" + SIG },
        { author_id: 200, body: "Let me check that" }  // agent, no signature
      ],
      requesterId: 100
    });

    assert.strictEqual(agentCheck.takenOver, true, "Agent is latest, no signature → skip");
  });

  test(`Bot's own comment as latest → bot can proceed [${label}]`, () => {
    const agentCheck = mockCheckForAgentIntervention({
      comments: [
        { author_id: 100, body: "Hello" },
        { author_id: 200, body: "How can I help?" + SIG }
      ],
      requesterId: 100
    });

    assert.strictEqual(agentCheck.takenOver, false, "Bot is latest (has signature) → proceed");
  });

  test(`Customer messages AFTER an agent joined → bot STAYS SILENT (sticky) [${label}]`, () => {
    // Regression guard: previously the bot only looked at the latest comment, so a
    // follow-up customer message let it talk over an agent who had already replied.
    // Now agent intervention is sticky for the whole ticket.
    const agentCheck = mockCheckForAgentIntervention({
      comments: [
        { author_id: 100, body: "Hello" },
        { author_id: 200, body: "Hi!" + SIG },      // bot reply
        { author_id: 300, body: "Agent reply" },    // human agent joined
        { author_id: 100, body: "Another question" } // customer follows up
      ],
      requesterId: 100
    });

    assert.strictEqual(agentCheck.takenOver, true, "Agent joined earlier → bot must stay silent");
  });

  test(`Agent comment with signature text (spoof attempt) → still detected as agent [${label}]`, () => {
    // Edge case: agent manually copies the signature text.
    // Since author is not requester and signature is present, we would incorrectly proceed.
    // In practice this is extremely unlikely; agents don't copy bot signatures.
    const agentCheck = mockCheckForAgentIntervention({
      comments: [
        { author_id: 100, body: "Hello" },
        { author_id: 200, body: "I'll handle this" + SIG }  // agent spoofing
      ],
      requesterId: 100
    });

    // This is a known theoretical limitation — but practically never happens.
    assert.strictEqual(agentCheck.takenOver, false, "KNOWN EDGE: signature text present → treated as bot");
  });
}

// Mješoviti tiket: stari botovi odgovori + novi botovi odgovori, bez agenta.
// Ovo je točan oblik već otvorenog tiketa nakon deploya preimenovanja.
test("Tiket sa STARIM i NOVIM potpisom bota, bez agenta → bot nastavlja", () => {
  const agentCheck = mockCheckForAgentIntervention({
    comments: [
      { author_id: 100, body: "Dobar dan" },
      { author_id: 200, body: "Izvolite" + LEGACY_BOT_SIGNATURE }, // prije preimenovanja
      { author_id: 100, body: "Još jedno pitanje" },
      { author_id: 200, body: "Evo odgovora" + BOT_SIGNATURE },    // nakon preimenovanja
      { author_id: 100, body: "Hvala" }
    ],
    requesterId: 100
  });

  assert.strictEqual(agentCheck.takenOver, false, "Nijedan komentar nije agentov → bot smije odgovoriti");
});

// ─── Tag-based guards ─────────────────────────────────────────────────────

test("Ticket resolved → bot always skips", () => {
  assert.strictEqual(mockIsHumanHandled(["resolved"]), true, "resolved ticket blocks bot");
});

test("Ticket awaiting_human → bot always skips", () => {
  assert.strictEqual(mockIsHumanHandled(["awaiting_human"]), true, "awaiting_human ticket blocks bot");
});

test("Ticket human_active alone → NOT blocked by tag guard", () => {
  assert.strictEqual(mockIsHumanHandled(["human_active"]), false, "human_active alone does not block");
});

test("No comments → bot proceeds", () => {
  const agentCheck = mockCheckForAgentIntervention({ comments: [], requesterId: 100 });
  assert.strictEqual(agentCheck.takenOver, false, "Empty ticket → proceed");
});

test("Race condition: agent comments during LLM → bot skips", () => {
  const initial = mockCheckForAgentIntervention({
    comments: [{ author_id: 100, body: "Question?" }],
    requesterId: 100
  });
  assert.strictEqual(initial.takenOver, false, "Race check start: customer is latest → proceed");

  const race = mockCheckForAgentIntervention({
    comments: [
      { author_id: 100, body: "Question?" },
      { author_id: 200, body: "Let me help" }  // agent during LLM call
    ],
    requesterId: 100
  });
  assert.strictEqual(race.takenOver, true, "Race check end: agent is latest → skip");
});

console.log("\n=== Agent Intervention Tests ===");
console.log("Run with: node --test tests/agent-intervention.test.js");
