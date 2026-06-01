const { describe, it } = require("node:test");
const assert = require("node:assert");
const { __internal } = require("../services/vectorKnowledgeService");

const { computeConfidence, buildVectorMatchAttempts } = __internal;

describe("vectorKnowledgeService.computeConfidence", () => {
  it("uses semantic similarity as the primary signal", () => {
    const c = computeConfidence(0.70, 0);
    assert.strictEqual(c, 0.70);
  });

  it("adds a bounded lexical bonus on top of similarity", () => {
    const c = computeConfidence(0.70, 0.5);
    // bonus = min(0.15, 0.5*0.5=0.25) = 0.15
    assert.ok(Math.abs(c - 0.85) < 1e-9, `expected ~0.85, got ${c}`);
  });

  it("caps the lexical bonus at 0.15", () => {
    const c = computeConfidence(0.80, 1.0);
    assert.ok(Math.abs(c - 0.95) < 1e-9, `expected ~0.95, got ${c}`);
  });

  it("never exceeds 1.0", () => {
    assert.strictEqual(computeConfidence(0.99, 1.0), 1);
  });

  it("does NOT inflate a weak lexical-only hit to full confidence", () => {
    // Regression guard for the old Math.max(sim, lexical*4) bug:
    // lexical 0.25 previously produced confidence 1.0.
    const c = computeConfidence(0, 0.25);
    assert.ok(c < 0.5, `weak lexical-only hit must stay low, got ${c}`);
    assert.ok(Math.abs(c - 0.15) < 1e-9, `expected ~0.15, got ${c}`);
  });

  it("gives a strong exact lexical hit a moderate (not maximal) score", () => {
    const c = computeConfidence(0, 1.0);
    assert.ok(Math.abs(c - 0.6) < 1e-9, `expected ~0.6, got ${c}`);
    assert.ok(c < 0.72, "lexical-only should fall below the 0.72 enriched gate");
  });

  it("handles missing/NaN inputs safely", () => {
    assert.strictEqual(computeConfidence(undefined, undefined), 0);
    assert.strictEqual(computeConfidence(NaN, NaN), 0);
  });
});

describe("vectorKnowledgeService.buildVectorMatchAttempts", () => {
  it("never includes a last_resort tier below 0.45", () => {
    const attempts = buildVectorMatchAttempts({});
    for (const a of attempts) {
      assert.ok(a.threshold >= 0.45, `threshold ${a.threshold} (${a.reason}) too low`);
    }
  });

  it("always starts with the default (highest) threshold tier", () => {
    const attempts = buildVectorMatchAttempts({});
    assert.ok(attempts.length >= 1);
    assert.ok(["default", "domain_filtered"].includes(attempts[0].reason));
  });
});
