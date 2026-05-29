const tracing = require("../services/tracingService");

function assert(cond, msg) { if (!cond) throw new Error(`FAIL: ${msg}`); }

tracing.clear();
tracing.createTrace({ input: "test1", llmOutput: "ans1", decision: "safe_answer", latencyMs: 150 });
tracing.createTrace({ input: "test2", llmOutput: "ans2", decision: "escalate", latencyMs: 300 });

const recent = tracing.getRecentTraces(10);
assert(recent.length === 2, "has traces");
assert(recent[0].input === "test2", "most recent trace first");
assert(recent[1].input === "test1", "older trace second");

const stats = tracing.getTraceStats();
assert(stats.total === 2, "stats count");
assert(stats.avgLatencyMs === 225, "avg latency computed");

console.log("tracingService.test.js — all passed ✓");
