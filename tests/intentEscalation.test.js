const { describe, it } = require("node:test");
const assert = require("node:assert");
const { detectEscalationIntent } = require("../services/intentEscalationService");
const { normalizeForComparison } = require("../services/textUtils");

function n(text) {
  return normalizeForComparison(text);
}

describe("intentEscalationService", () => {
  describe("detectEscalationIntent", () => {
    it("escalates complaint_damaged for oštećenje", () => {
      const result = detectEscalationIntent(n("knjiga je oštećena"));
      assert.strictEqual(result.shouldEscalate, true);
      assert.strictEqual(result.intent, "complaint_damaged");
    });

    it("escalates complaint_damaged for pokidana", () => {
      const result = detectEscalationIntent(n("pokidana stranica"));
      assert.strictEqual(result.shouldEscalate, true);
      assert.strictEqual(result.intent, "complaint_damaged");
    });

    it("escalates return_refund for povrat novca", () => {
      const result = detectEscalationIntent(n("želim povrat novca"));
      assert.strictEqual(result.shouldEscalate, true);
      assert.strictEqual(result.intent, "return_refund");
    });

    it("escalates return_refund for reklamacija", () => {
      const result = detectEscalationIntent(n("podnosim reklamaciju"));
      assert.strictEqual(result.shouldEscalate, true);
      assert.strictEqual(result.intent, "return_refund");
    });

    it("escalates wrong_order for kriva narudžba", () => {
      const result = detectEscalationIntent(n("dobio sam krivu narudžbu"));
      assert.strictEqual(result.shouldEscalate, true);
      assert.strictEqual(result.intent, "wrong_order");
    });

    it("escalates legal_threat for odvjetnik", () => {
      const result = detectEscalationIntent(n("kontaktirat ću odvjetnika"));
      assert.strictEqual(result.shouldEscalate, true);
      assert.strictEqual(result.intent, "legal_threat");
    });

    it("escalates legal_threat for sud", () => {
      const result = detectEscalationIntent(n("prijavljujem vas na sud"));
      assert.strictEqual(result.shouldEscalate, true);
      assert.strictEqual(result.intent, "legal_threat");
    });

    it("escalates urgent_problem for hitno", () => {
      const result = detectEscalationIntent(n("hitno mi treba odgovor"));
      assert.strictEqual(result.shouldEscalate, true);
      assert.strictEqual(result.intent, "urgent_problem");
    });

    it("does NOT escalate for normal delivery query", () => {
      const result = detectEscalationIntent(n("koliko traje dostava"));
      assert.strictEqual(result.shouldEscalate, false);
    });

    it("does NOT escalate for normal price query", () => {
      const result = detectEscalationIntent(n("koliko košta udžbenik"));
      assert.strictEqual(result.shouldEscalate, false);
    });

    it("does NOT escalate for greeting", () => {
      const result = detectEscalationIntent(n("dobar dan"));
      assert.strictEqual(result.shouldEscalate, false);
    });

    it("does NOT escalate for otkup query", () => {
      const result = detectEscalationIntent(n("želim prodat udžbenike"));
      assert.strictEqual(result.shouldEscalate, false);
    });

    it("escalates for nedostaje stranica", () => {
      const result = detectEscalationIntent(n("u knjizi nedostaje stranica"));
      assert.strictEqual(result.shouldEscalate, true);
      assert.strictEqual(result.intent, "complaint_damaged");
    });

    it("returns a polite escalation message", () => {
      const result = detectEscalationIntent(n("knjiga je oštećena"));
      assert.ok(result.message);
      assert.ok(result.message.includes("timu"));
      assert.ok(result.message.includes("javiti"));
    });
  });

  describe("detectEscalationIntent — extended Croatian coverage", () => {
    // Female-gender first person (used-book buyers are often women)
    it("escalates wrong_order for female gender 'dobila sam krivu'", () => {
      const result = detectEscalationIntent(n("dobila sam krivu knjigu"));
      assert.strictEqual(result.shouldEscalate, true);
      assert.strictEqual(result.intent, "wrong_order");
    });

    // Damaged used-book condition scenarios
    it("escalates complaint_damaged for mokre stranice", () => {
      const result = detectEscalationIntent(n("stranice su mokre i zgužvane"));
      assert.strictEqual(result.shouldEscalate, true);
      assert.strictEqual(result.intent, "complaint_damaged");
    });

    it("escalates complaint_damaged for fali korica", () => {
      const result = detectEscalationIntent(n("knjizi fali korica"));
      assert.strictEqual(result.shouldEscalate, true);
      assert.strictEqual(result.intent, "complaint_damaged");
    });

    it("escalates complaint_damaged for smrdi na vlagu", () => {
      const result = detectEscalationIntent(n("knjiga smrdi na vlagu"));
      assert.strictEqual(result.shouldEscalate, true);
      assert.strictEqual(result.intent, "complaint_damaged");
    });

    it("escalates return_refund for raskid ugovora", () => {
      const result = detectEscalationIntent(n("želim jednostrani raskid ugovora"));
      assert.strictEqual(result.shouldEscalate, true);
      assert.strictEqual(result.intent, "return_refund");
    });

    it("escalates legal_threat for inspekcija", () => {
      const result = detectEscalationIntent(n("prijavit ću vas tržišnoj inspekciji"));
      assert.strictEqual(result.shouldEscalate, true);
    });

    // Guard against false positives that broke benign queries before
    it("does NOT escalate 'odmah ću naručiti' (benign 'odmah')", () => {
      const result = detectEscalationIntent(n("odmah ću naručiti udžbenik"));
      assert.strictEqual(result.shouldEscalate, false);
    });

    it("does NOT escalate generic potrošač question", () => {
      const result = detectEscalationIntent(n("imate li udžbenike za prvi razred"));
      assert.strictEqual(result.shouldEscalate, false);
    });

    it("does NOT escalate normal buyback question", () => {
      const result = detectEscalationIntent(n("kako mogu prodati svoje udžbenike"));
      assert.strictEqual(result.shouldEscalate, false);
    });
  });
});
