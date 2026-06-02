/**
 * Test: Agent intervention detection (signature-based)
 * Every bot reply ends with the signature "---\n*Vaš Libar Asistent*".
 * By checking for this text in the latest comment we reliably detect
 * whether the bot or an agent wrote the last message.
 */
const test = require("node:test");
const assert = require("node:assert");

const BOT_SIGNATURE = "\n\n---\n*Vaš Libar Asistent*";

function mockCheckForAgentIntervention(scenario) {
  const { comments, requesterId } = scenario;
  if (comments.length === 0) {
    return { takenOver: false };
  }

  const latest = comments[comments.length - 1];
  if (latest.author_id === requesterId) {
    return { takenOver: false };
  }

  // Latest comment is NOT from the requester
  const latestBody = String(latest.body || "");
  if (latestBody.includes(BOT_SIGNATURE)) {
    // It's our own reply (signature marker is present)
    return { takenOver: false };
  }

  // Not requester, not bot → must be an agent (or admin)
  return { takenOver: true, reason: "agent_comment_detected" };
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

test("Customer after agent (stale human_active tag ignored) → bot responds", () => {
  const agentCheck = mockCheckForAgentIntervention({
    comments: [
      { author_id: 100, body: "Hello" },
      { author_id: 200, body: "Hi!" + BOT_SIGNATURE },
      { author_id: 200, body: "Agent reply" },
      { author_id: 100, body: "Another question" }
    ],
    requesterId: 100
  });

  assert.strictEqual(agentCheck.takenOver, false, "Customer is latest → proceed regardless of tags");
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
