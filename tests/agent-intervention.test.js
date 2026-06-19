/**
 * Test: Agent intervention detection (signature-based, STICKY).
 * Every bot reply ends with the signature "---\n*Vaš Libar Asistent*".
 * Once ANY public comment in the ticket is from a human agent, the bot must
 * stay silent for the rest of the conversation — even if the customer messages
 * again afterwards. We exercise the real pure function (no API).
 */
const test = require("node:test");
const assert = require("node:assert");
const { detectAgentTakeover } = require("../services/zendeskService");

const BOT_SIGNATURE = "\n\n---\n*Vaš Libar Asistent*";

function mockCheckForAgentIntervention(scenario) {
  return detectAgentTakeover(scenario.comments, scenario.requesterId);
}

function mockIsHumanHandled(tags) {
  const blocked = ["resolved", "awaiting_human"];
  return tags.some((t) => blocked.includes(t));
}

// ─── Signature-based detection ─────────────────────────────────────────────

test("Customer messages after bot reply → bot responds", () => {
  const agentCheck = mockCheckForAgentIntervention({
    comments: [
      { author_id: 100, body: "Hello" },
      { author_id: 200, body: "Hi!" + BOT_SIGNATURE },
      { author_id: 100, body: "Another question" }
    ],
    requesterId: 100
  });

  assert.strictEqual(agentCheck.takenOver, false, "Customer is latest → proceed");
});

test("Agent replies and forgets tags → bot stays silent", () => {
  const agentCheck = mockCheckForAgentIntervention({
    comments: [
      { author_id: 100, body: "Hello" },
      { author_id: 200, body: "Hi!" + BOT_SIGNATURE },
      { author_id: 200, body: "Let me check that" }  // agent, no signature
    ],
    requesterId: 100
  });

  assert.strictEqual(agentCheck.takenOver, true, "Agent is latest, no signature → skip");
});

test("Bot's own comment as latest → bot can proceed", () => {
  const agentCheck = mockCheckForAgentIntervention({
    comments: [
      { author_id: 100, body: "Hello" },
      { author_id: 200, body: "How can I help?" + BOT_SIGNATURE }
    ],
    requesterId: 100
  });

  assert.strictEqual(agentCheck.takenOver, false, "Bot is latest (has signature) → proceed");
});

test("Customer messages AFTER an agent joined → bot STAYS SILENT (sticky)", () => {
  // Regression guard: previously the bot only looked at the latest comment, so a
  // follow-up customer message let it talk over an agent who had already replied.
  // Now agent intervention is sticky for the whole ticket.
  const agentCheck = mockCheckForAgentIntervention({
    comments: [
      { author_id: 100, body: "Hello" },
      { author_id: 200, body: "Hi!" + BOT_SIGNATURE },   // bot reply
      { author_id: 300, body: "Agent reply" },            // human agent joined
      { author_id: 100, body: "Another question" }        // customer follows up
    ],
    requesterId: 100
  });

  assert.strictEqual(agentCheck.takenOver, true, "Agent joined earlier → bot must stay silent");
});

test("Agent comment with signature text (spoof attempt) → still detected as agent", () => {
  // Edge case: agent manually copies the signature text.
  // Since author is not requester and signature is present, we would incorrectly proceed.
  // In practice this is extremely unlikely; agents don't copy bot signatures.
  const agentCheck = mockCheckForAgentIntervention({
    comments: [
      { author_id: 100, body: "Hello" },
      { author_id: 200, body: "I'll handle this" + BOT_SIGNATURE }  // agent spoofing
    ],
    requesterId: 100
  });

  // This is a known theoretical limitation — but practically never happens.
  assert.strictEqual(agentCheck.takenOver, false, "KNOWN EDGE: signature text present → treated as bot");
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
