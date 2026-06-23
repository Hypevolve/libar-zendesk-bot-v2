const { describe, it } = require("node:test");
const assert = require("node:assert");
const {
  isLikelyEmail,
  buildSelfServiceFallback,
  resolveAnonymousEscalation
} = require("../services/escalationFlowService");

describe("escalationFlowService", () => {
  describe("isLikelyEmail", () => {
    it("detects a bare email address", () => {
      assert.strictEqual(isLikelyEmail("Kubatovi.naza@gmail.com"), true);
    });

    it("detects an email embedded in a sentence", () => {
      assert.strictEqual(isLikelyEmail("moj mail je ana@example.com hvala"), true);
    });

    it("returns false for a normal question", () => {
      assert.strictEqual(isLikelyEmail("kako radite dostavu?"), false);
    });

    it("returns false for empty or missing input", () => {
      assert.strictEqual(isLikelyEmail(""), false);
      assert.strictEqual(isLikelyEmail(null), false);
      assert.strictEqual(isLikelyEmail(undefined), false);
    });
  });

  describe("buildSelfServiceFallback", () => {
    it("returns a safe_answer, not a human escalation", () => {
      const outcome = buildSelfServiceFallback("Kako da kupim udžbenike?");
      assert.strictEqual(outcome.type, "safe_answer");
      assert.strictEqual(outcome.stateTag, "ai_active");
      assert.strictEqual(outcome.reason, "self_service_fallback");
    });

    it("produces a non-empty helpful message that does not demand an email", () => {
      const outcome = buildSelfServiceFallback("Kako da kupim udžbenike?");
      assert.ok(outcome.customerMessage && outcome.customerMessage.length > 20);
      assert.ok(!/email adresu/i.test(outcome.customerMessage));
    });

    it("attaches relevant website links for a buying query", () => {
      const outcome = buildSelfServiceFallback("Kako da kupim udžbenike?");
      assert.ok(Array.isArray(outcome.links));
      assert.ok(outcome.links.some((l) => /kupi-udzbenike/.test(l.url)));
    });
  });

  describe("resolveAnonymousEscalation", () => {
    it("passes a non-escalation outcome through unchanged", () => {
      const session = { emailIsPlaceholder: true, emailAsked: false };
      const outcome = { type: "safe_answer", customerMessage: "ok" };
      assert.deepStrictEqual(resolveAnonymousEscalation(session, outcome), outcome);
    });

    it("does not gate escalation when the email is real (not placeholder)", () => {
      const session = { emailIsPlaceholder: false, emailAsked: false };
      const outcome = { type: "escalate_no_answer", customerMessage: "human", extraTags: [] };
      assert.strictEqual(resolveAnonymousEscalation(session, outcome), outcome);
    });

    it("asks for an email once on the first anonymous escalation", () => {
      const session = { emailIsPlaceholder: true, emailAsked: false };
      const outcome = { type: "escalate_no_answer", customerMessage: "human", reason: "intent_x", extraTags: [] };
      const result = resolveAnonymousEscalation(session, outcome);
      assert.strictEqual(result.type, "need_email");
      assert.strictEqual(session.emailAsked, true);
      assert.ok(session.pendingEscalation, "pending escalation is stored for later");
    });

    it("escalates anyway on the next message instead of looping the email request", () => {
      const session = { emailIsPlaceholder: true, emailAsked: true };
      const outcome = { type: "escalate_no_answer", customerMessage: "human", reason: "intent_x", extraTags: [] };
      const result = resolveAnonymousEscalation(session, outcome);
      assert.notStrictEqual(result.type, "need_email");
      assert.strictEqual(result.type, "escalate_no_answer");
      assert.ok(result.extraTags.includes("escalated_without_email"));
    });
  });
});
