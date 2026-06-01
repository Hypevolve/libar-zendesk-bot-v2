/**
 * End-to-End Test Runner — Generated Scenarios from Real Zendesk Tickets
 *
 * Pokreće scenarije iz e2e-generated.test.js protiv lokalnog servera.
 * Precondition: npm start u drugom terminalu.
 *
 * Pokretanje: NODE_ENV=test node --no-deprecation --test tests/e2e-generated-runner.test.js
 */
const { test } = require("node:test");
const http = require("http");
const assert = require("assert");
const { GENERATED_SCENARIOS } = require("./e2e-generated.test.js");

const API = process.env.API_URL || "http://localhost:3000";
const DELAY_MS = Number(process.env.TEST_DELAY_MS) || 2000;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API);
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ hostname: url.hostname, port: url.port, path: url.pathname + url.search, method, headers: { "Content-Type": "application/json" } }, (res) => {
      let chunks = "";
      res.on("data", (c) => { chunks += c; });
      res.on("end", () => { try { resolve({ status: res.statusCode, body: JSON.parse(chunks) }); } catch { resolve({ status: res.statusCode, body: chunks }); } });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

async function chatStart(name, email, message) {
  return request("POST", "/api/chat/start", { name, email, message });
}

function extractBotAnswer(res) {
  const msgs = res.body?.messages || [];
  const last = msgs.filter((m) => m.role === "assistant").pop();
  return last?.content || "";
}

function normalize(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9\u0100-\u017f\s]/gi, " ").replace(/\s+/g, " ").trim();
}

function containsAny(answer, expectedPhrases) {
  const norm = normalize(answer);
  return expectedPhrases.some((phrase) => norm.includes(normalize(phrase)));
}

function classifyOutcome(answer) {
  const lowered = answer.toLowerCase();
  if (lowered.includes("proslijedi") || lowered.includes("čovjek") || lowered.includes("agent") || lowered.includes("nemam dovoljno")) {
    return "escalation";
  }
  if (lowered.includes("?") || lowered.includes("ne razumijem") || lowered.includes("nema")) {
    return "unclear";
  }
  return "answered";
}

// ─── Test runner ──────────────────────────────────────────────────────────
const results = [];

for (const scenario of GENERATED_SCENARIOS) {
  test(`GEN: ${scenario.query.slice(0, 60)}`, async () => {
    const startTime = Date.now();
    const res = await chatStart("GenTest", "gen@test.com", scenario.query);
    const latency = Date.now() - startTime;
    const answer = extractBotAnswer(res);
    const outcome = classifyOutcome(answer);

    const result = {
      id: scenario.id,
      group: scenario.group,
      query: scenario.query,
      outcome,
      latencyMs: latency,
      answer: answer.slice(0, 200),
    };
    results.push(result);

    // Core assertion: if escalation is NOT allowed, bot must answer
    if (!scenario.allowEscalation) {
      assert.ok(
        outcome === "answered" || containsAny(answer, scenario.expected?.shouldContain || []),
        `Bot escalated or failed for: "${scenario.query}". Answer: ${answer.slice(0, 100)}`
      );
    }

    // If checkRetrieval is true, verify answer contains expected points (soft check)
    if (scenario.checkRetrieval && scenario.expected?.shouldContain) {
      const hasPoint = containsAny(answer, scenario.expected.shouldContain);
      if (!hasPoint && outcome === "answered") {
        console.warn(`  ⚠️  Missing expected points for "${scenario.query}"`);
      }
    }

    console.log(`  ${outcome === "answered" ? "✅" : outcome === "escalation" ? "❌" : "⚠️"} ${scenario.id} (${latency}ms) → ${outcome}`);
    await sleep(DELAY_MS);
  });
}

// Summary after all tests
process.on("exit", () => {
  const total = results.length;
  const answered = results.filter((r) => r.outcome === "answered").length;
  const escalated = results.filter((r) => r.outcome === "escalation").length;
  const unclear = results.filter((r) => r.outcome === "unclear").length;
  const avgLatency = total ? Math.round(results.reduce((s, r) => s + r.latencyMs, 0) / total) : 0;

  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║  GENERATED TEST SUMMARY                  ║");
  console.log("╠══════════════════════════════════════════╣");
  console.log(`║  Total:        ${String(total).padStart(3)}                     ║`);
  console.log(`║  Answered:     ${String(answered).padStart(3)} ✅                  ║`);
  console.log(`║  Escalated:    ${String(escalated).padStart(3)} ❌                  ║`);
  console.log(`║  Unclear:      ${String(unclear).padStart(3)} ⚠️                   ║`);
  console.log(`║  Avg latency:   ${String(avgLatency).padStart(4)}ms                  ║`);
  console.log("╚══════════════════════════════════════════╝");
});
