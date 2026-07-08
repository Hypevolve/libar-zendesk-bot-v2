/**
 * Test: metricsService per-channel brojači (recordChannelOutcome).
 * Vrti pravi modul; provjerava normalizaciju kanala, mapiranje odluka,
 * i da getMetrics vraća byChannel strukturu.
 */
const test = require("node:test");
const assert = require("node:assert");
const metrics = require("../services/metricsService");

test("recordChannelOutcome: safe_answer inkrementira requests+answered", () => {
  metrics.reset();
  metrics.recordChannelOutcome("web", "safe_answer");
  const m = metrics.getMetrics();
  assert.strictEqual(m.byChannel.web.requests, 1);
  assert.strictEqual(m.byChannel.web.answered, 1);
  assert.strictEqual(m.byChannel.web.escalated, 0);
});

test("recordChannelOutcome: escalate_no_answer inkrementira requests+escalated", () => {
  metrics.reset();
  metrics.recordChannelOutcome("email", "escalate_no_answer");
  const m = metrics.getMetrics();
  assert.strictEqual(m.byChannel.email.requests, 1);
  assert.strictEqual(m.byChannel.email.answered, 0);
  assert.strictEqual(m.byChannel.email.escalated, 1);
});

test("recordChannelOutcome: facebook kanal se broji", () => {
  metrics.reset();
  metrics.recordChannelOutcome("facebook", "safe_answer");
  assert.strictEqual(metrics.getMetrics().byChannel.facebook.requests, 1);
});

test("recordChannelOutcome: nepoznat kanal = no-op (ne baca, ne broji)", () => {
  metrics.reset();
  assert.doesNotThrow(() => metrics.recordChannelOutcome("unknown", "safe_answer"));
  const bc = metrics.getMetrics().byChannel;
  assert.strictEqual(bc.web.requests + bc.email.requests + bc.facebook.requests, 0);
});

test("reset čisti byChannel", () => {
  metrics.recordChannelOutcome("web", "safe_answer");
  metrics.reset();
  assert.strictEqual(metrics.getMetrics().byChannel.web.requests, 0);
});
