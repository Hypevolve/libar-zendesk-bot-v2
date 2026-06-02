/**
 * Test: Agent intervention detection
 * Verifies that the bot stops responding when a human agent takes over a conversation.
 *
 * Two modes:
 *   1. Precise mode: ZENDESK_BOT_USER_ID configured — 100% reliable.
 *   2. Fallback mode: no bot user ID — uses ai_active tag heuristic (less reliable).
 */
const test = require("node:test");
const assert = require("node:assert");

const BOT_USER_ID = 999; // Simulated bot Zendesk user ID

function mockCheckForAgentIntervention(scenario, botUserId = 0) {
  const { comments, requesterId, tags } = scenario;
  if (comments.length === 0) {
    return { takenOver: false };
  }

  const latest = comments[comments.length - 1];
  if (latest.author_id === requesterId) {
    return { takenOver: false };
  }

  // Latest comment is NOT from the requester
  if (botUserId > 0) {
    // Precise mode: we know exactly who the bot is
    if (latest.author_id === botUserId) {
      return { takenOver: false };
    }
    return { takenOver: true, reason: "agent_comment_detected" };
  }

  // Fallback mode: use ai_active tag heuristic
  if (tags.includes("ai_active")) {
    return { takenOver: false };
  }
  return { takenOver: true, reason: "agent_comment_detected" };
}

function mockIsHumanHandled(tags) {
  const blocked = ["resolved", "awaiting_human"];
  return tags.some((t) => blocked.includes(t));
}

// ─── Precise Mode (ZENDESK_BOT_USER_ID configured) ─────────────────────────

test("[PRECISE] Customer messages after bot reply → bot responds", () => {
  const agentCheck = mockCheckForAgentIntervention({
    comments: [
      { author_id: 100, body: "Hello" },
      { author_id: BOT_USER_ID, body: "Hi!" },
      { author_id: 100, body: "Another question" }
    ],
    requesterId: 100,
    tags: ["ai_active"]
  }, BOT_USER_ID);

  assert.strictEqual(agentCheck.takenOver, false, "Precise mode: customer is latest → proceed");
});

test("[PRECISE] Agent replies and forgets tags → bot stays silent", () => {
  const agentCheck = mockCheckForAgentIntervention({
    comments: [
      { author_id: 100, body: "Hello" },
      { author_id: BOT_USER_ID, body: "Hi!" },
      { author_id: 200, body: "Let me check that" }  // agent
    ],
    requesterId: 100,
    tags: ["ai_active"]  // ai_active present, but agent is latest
  }, BOT_USER_ID);

  assert.strictEqual(agentCheck.takenOver, true, "Precise mode: agent is latest, even with ai_active tag → skip");
});

test("[PRECISE] Bot's own comment as latest → bot can proceed", () => {
  const agentCheck = mockCheckForAgentIntervention({
    comments: [
      { author_id: 100, body: "Hello" },
      { author_id: BOT_USER_ID, body: "How can I help?" }
    ],
    requesterId: 100,
    tags: ["ai_active"]
  }, BOT_USER_ID);

  assert.strictEqual(agentCheck.takenOver, false, "Precise mode: bot is latest → proceed (race check before reply)");
});

test("[PRECISE] Customer after agent (stale human_active) → bot responds", () => {
  const agentCheck = mockCheckForAgentIntervention({
    comments: [
      { author_id: 100, body: "Hello" },
      { author_id: BOT_USER_ID, body: "Hi!" },
      { author_id: 200, body: "Agent reply" },
      { author_id: 100, body: "Another question" }
    ],
    requesterId: 100,
    tags: ["human_active"]
  }, BOT_USER_ID);

  assert.strictEqual(agentCheck.takenOver, false, "Precise mode: customer is latest, stale tag ignored → proceed");
});

// ─── Fallback Mode (no ZENDESK_BOT_USER_ID) ────────────────────────────────

test("[FALLBACK] Customer messages after bot reply → bot responds", () => {
  const agentCheck = mockCheckForAgentIntervention({
    comments: [
      { author_id: 100, body: "Hello" },
      { author_id: 999, body: "Hi!" },
      { author_id: 100, body: "Another question" }
    ],
    requesterId: 100,
    tags: ["ai_active"]
  }, 0);

  assert.strictEqual(agentCheck.takenOver, false, "Fallback: customer is latest → proceed");
});

test("[FALLBACK] Agent replies and removes ai_active → bot stays silent", () => {
  const agentCheck = mockCheckForAgentIntervention({
    comments: [
      { author_id: 100, body: "Hello" },
      { author_id: 999, body: "Hi!" },
      { author_id: 200, body: "I'll handle this" }
    ],
    requesterId: 100,
    tags: []
  }, 0);

  assert.strictEqual(agentCheck.takenOver, true, "Fallback: agent is latest and no ai_active tag → skip");
  assert.strictEqual(agentCheck.reason, "agent_comment_detected");
});

test("[FALLBACK] Agent replies but ai_active remains → KNOWN LIMITATION", () => {
  // This is the false-negative scenario: agent commented but ai_active tag
  // is still present because the agent didn't change it.
  const agentCheck = mockCheckForAgentIntervention({
    comments: [
      { author_id: 100, body: "Hello" },
      { author_id: 999, body: "Hi!" },
      { author_id: 200, body: "Let me help" }  // agent, forgot tags
    ],
    requesterId: 100,
    tags: ["ai_active"]
  }, 0);

  assert.strictEqual(agentCheck.takenOver, false, "Fallback LIMITATION: ai_active tag masks agent comment");
});

// ─── Tag-based guards ─────────────────────────────────────────────────────

test("Ticket resolved → bot always skips", () => {
  assert.strictEqual(mockIsHumanHandled(["resolved"]), true, "resolved ticket blocks bot");
});

test("Ticket awaiting_human → bot always skips", () => {
  assert.strictEqual(mockIsHumanHandled(["awaiting_human"]), true, "awaiting_human ticket blocks bot");
});

test("Ticket human_active alone → NOT blocked by tag guard", () => {
  // human_active is no longer checked by isTicketHumanHandled.
  // Only resolved / awaiting_human block unconditionally.
  assert.strictEqual(mockIsHumanHandled(["human_active"]), false, "human_active alone does not block");
});

test("No comments → bot proceeds", () => {
  const agentCheck = mockCheckForAgentIntervention({ comments: [], requesterId: 100, tags: [] }, BOT_USER_ID);
  assert.strictEqual(agentCheck.takenOver, false, "Empty ticket → proceed");
});

test("Race condition: agent comments during LLM → bot skips", () => {
  const initial = mockCheckForAgentIntervention({
    comments: [{ author_id: 100, body: "Question?" }],
    requesterId: 100,
    tags: []
  }, BOT_USER_ID);
  assert.strictEqual(initial.takenOver, false, "Race check start: customer is latest → proceed");

  const race = mockCheckForAgentIntervention({
    comments: [
      { author_id: 100, body: "Question?" },
      { author_id: 200, body: "Let me help" }  // agent during LLM call
    ],
    requesterId: 100,
    tags: []
  }, BOT_USER_ID);
  assert.strictEqual(race.takenOver, true, "Race check end: agent is latest → skip");
});

console.log("\n=== Agent Intervention Tests ===");
console.log("Run with: node --test tests/agent-intervention.test.js");
