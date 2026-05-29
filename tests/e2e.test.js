/**
 * End-to-End Test Suite — Libar Zendesk Bot v2
 *
 * Pokreće stvarne korisničke scenarije kroz lokalni server,
 * bilježi knowledge retrieval, AI odgovore, i stvara tickete u Zendesku.
 *
 * Pokretanje: NODE_ENV=test node tests/e2e.test.js
 * Precondition: npm start u drugom terminalu.
 */
const http = require("http");

const API = process.env.API_URL || "http://localhost:3000";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const DELAY_MS = Number(process.env.TEST_DELAY_MS) || 2500;
const MAX_LATENCY_MS = Number(process.env.MAX_LATENCY_MS) || 65000;

const RESULTS = [];
let PASS = 0;
let FAIL = 0;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function request(method, path, body = null, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API);
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ hostname: url.hostname, port: url.port, path: url.pathname + url.search, method, headers: { "Content-Type": "application/json", ...extraHeaders } }, (res) => {
      let chunks = "";
      res.on("data", (c) => { chunks += c; });
      res.on("end", () => { try { resolve({ status: res.statusCode, body: JSON.parse(chunks) }); } catch { resolve({ status: res.statusCode, body: chunks }); } });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

async function chatStart(name, email, message, entryIntent = null) {
  const body = entryIntent ? { name, email, message, entryIntent } : { name, email, message };
  return request("POST", "/api/chat/start", body);
}

async function chatMessage(sessionId, message) {
  return request("POST", "/api/chat/message", { sessionId, message });
}

function record(scenario, result) {
  RESULTS.push(result);
  if (result.passed) { PASS++; } else { FAIL++; }
  const status = result.passed ? "✓" : "✗";
  const latency = result.latency ? `${result.latency}ms` : "n/a";
  const ticket = result.ticketId || "—";
  console.log(`${status} ${scenario.padEnd(50)} | ticket:${ticket} | latency:${latency} | ${result.reason || ""}`);
}

function validateResponse(resp, expected) {
  const issues = [];
  if (!resp.body?.success) issues.push("success=false");
  const msg = resp.body?.messages?.find((m) => m.role === "assistant")?.content || "";
  if (!msg) issues.push("no assistant message");
  if (msg.length < 10) issues.push("answer too short");
  if (expected.shouldNotContain) {
    for (const phrase of expected.shouldNotContain) {
      if (msg.toLowerCase().includes(phrase.toLowerCase())) issues.push(`unexpected:"${phrase}"`);
    }
  }
  if (expected.shouldContain) {
    for (const phrase of expected.shouldContain) {
      if (!msg.toLowerCase().includes(phrase.toLowerCase())) issues.push(`missing:"${phrase}"`);
    }
  }
  return { valid: issues.length === 0, issues, msg };
}

// ─── SCENARIOS ────────────────────────────────────────────────

const SCENARIOS = [
  // ─── A: Otkup (buyback) ─────────────────────────────────────
  {
    id: "A1", group: "Otkup", query: "Koje knjige otkupljujete?",
    expected: { shouldContain: ["srednj", "udžbenik", "ne otkupljujemo"] },
    checkRetrieval: true
  },
  {
    id: "A2", group: "Otkup", query: "Kako funkcionira online otkup?",
    expected: { shouldContain: ["otkup", "online", "paket"] },
    checkRetrieval: true
  },
  {
    id: "A3", group: "Otkup", query: "Od koliko knjiga je besplatna dostava kod otkupa?",
    expected: { shouldContain: ["4", "besplatna"] },
    checkRetrieval: true
  },
  {
    id: "A4", group: "Otkup", query: "Kada dobivam novac za online otkup?",
    expected: { shouldContain: ["isti dan", "sljedeći", "radni dan"] },
    checkRetrieval: true
  },
  {
    id: "A5", group: "Otkup", query: "Što trebam ponijeti za fizički otkup?",
    expected: { shouldContain: ["udžbenik", "srednj", "poslovnic"] },
    checkRetrieval: true
  },
  {
    id: "A6", group: "Otkup", query: "Koliko dobivam za otkup udžbenika matematike?",
    expected: { shouldContain: ["informacija", "tim"] }, // should escalate
    checkRetrieval: true, allowEscalation: true
  },

  // ─── B: Dostava ─────────────────────────────────────────────
  {
    id: "B1", group: "Dostava", query: "Koliko traje dostava?",
    expected: { shouldContain: ["1", "2", "radna dana", "48"] },
    checkRetrieval: true
  },
  {
    id: "B2", group: "Dostava", query: "Koliko košta dostava?",
    expected: { shouldContain: ["eur", "gls", "boxnow"] },
    checkRetrieval: true
  },
  {
    id: "B3", group: "Dostava", query: "Koje opcije dostave imate?",
    expected: { shouldContain: ["gls", "boxnow", "osobno"] },
    checkRetrieval: true
  },

  // ─── C: Narudžbe ────────────────────────────────────────────
  {
    id: "C1", group: "Narudžbe", query: "Kako naručiti udžbenike?",
    expected: { shouldContain: ["naruč", "tražil", "isbn"] },
    checkRetrieval: true
  },
  {
    id: "C2", group: "Narudžbe", query: "Kako provjeriti je li knjiga na stanju?",
    expected: { shouldContain: ["webshop", "pretraž", "dostupnost"] },
    checkRetrieval: true
  },

  // ─── D: Povrat / reklamacija ────────────────────────────────
  {
    id: "D1", group: "Povrat", query: "Kako vratiti knjigu?",
    expected: { shouldContain: ["14 dana", "povrat", "račun"] },
    checkRetrieval: true
  },
  {
    id: "D2", group: "Povrat", query: "Primio sam oštećenu knjigu",
    expected: { shouldContain: ["reklamacij", "fotografij", "račun"] },
    checkRetrieval: true
  },

  // ─── E: Kontakt ─────────────────────────────────────────────
  {
    id: "E1", group: "Kontakt", query: "Koje je radno vrijeme?",
    expected: { shouldContain: ["08", "20", "sub"] },
    checkRetrieval: true
  },
  {
    id: "E2", group: "Kontakt", query: "Gdje se nalazite?",
    expected: { shouldContain: ["županijsk", "osijek", "17"] },
    checkRetrieval: true
  },
  {
    id: "E3", group: "Kontakt", query: "Koji je kontakt telefon?",
    expected: { shouldContain: ["031"] },
    checkRetrieval: true
  },

  // ─── F: Plaćanje / loyalty ──────────────────────────────────
  {
    id: "F1", group: "Plaćanje", query: "Koje načine plaćanja prihvaćate?",
    expected: { shouldContain: ["kartic", "gotovin", "pouzeće", "rate"] },
    checkRetrieval: true
  },
  {
    id: "F2", group: "Loyalty", query: "Kako funkcionira Sjedi 5?",
    expected: { shouldContain: ["5", "besplatna", "dostava", "popust", "%"] },
    checkRetrieval: true
  },
  {
    id: "F3", group: "Plaćanje", query: "Može li R1 račun?",
    expected: { shouldContain: ["r1", "tvrtk", "info@"] },
    checkRetrieval: true
  },
  {
    id: "F4", group: "Plaćanje", query: "Može li isplata na Aircash?",
    expected: { shouldContain: ["aircash", "nije", "dostupna"] },
    checkRetrieval: true
  },

  // ─── G: Edge / eskalacija ───────────────────────────────────
  {
    id: "G1", group: "Edge", query: "Pozdrav!",
    expected: { shouldContain: ["pozdrav", "dobrodošli"] },
    checkRetrieval: false
  },
  {
    id: "G2", group: "Edge", query: "Koliko košta otkup matematike za 1. razred?",
    expected: { shouldNotContain: ["eur", "kn "] },
    checkRetrieval: true, allowEscalation: true
  },
  {
    id: "G3", group: "Edge", query: "Koja je cijena udžbenika za 3. razred gimnazije?",
    expected: { shouldNotContain: ["eur", "cijena je"] },
    checkRetrieval: true, allowEscalation: true
  }
];

// ─── MAIN RUNNER ──────────────────────────────────────────────

async function runScenario(s) {
  const startTime = Date.now();
  try {
    const resp = await chatStart(`Test-${s.id}`, `test-${s.id}@libar.local`, s.query);
    const latency = Date.now() - startTime;

    if (!resp.body?.success) {
      record(`${s.id} ${s.group}: ${s.query}`, { passed: false, ticketId: null, latency, reason: `start failed: ${resp.body?.error || resp.status}` });
      return;
    }

    const ticketId = resp.body?.ticketId;
    const assistantMsg = resp.body?.messages?.find((m) => m.role === "assistant")?.content || "";
    const decision = resp.body?.conversationState?.tone || "unknown";
    const links = resp.body?.links || [];

    // Retrieve trace for knowledge details
    const tracesResp = await request("GET", "/admin/traces?limit=1", null, { "x-admin-token": ADMIN_TOKEN });
    const trace = tracesResp.body?.traces?.[0] || {};
    const topScore = trace.retrieval?.topScore || 0;
    const articleCount = trace.retrieval?.articleCount || 0;

    const validation = validateResponse(resp, s.expected);

    const issues = [...validation.issues];
    if (s.checkRetrieval && topScore < 5) issues.push(`low_retrieval_score:${topScore}`);
    if (latency > MAX_LATENCY_MS) issues.push(`slow:${latency}ms`);
    if (assistantMsg.toLowerCase().includes("ne mogu") || assistantMsg.toLowerCase().includes("nisam siguran")) {
      if (!s.allowEscalation) issues.push("uncertain_answer");
    }

    const passed = issues.length === 0;
    record(`${s.id} ${s.group}: ${s.query}`, {
      passed, ticketId, latency, topScore, articleCount, decision, links: links.length,
      msg: assistantMsg.slice(0, 200),
      reason: passed ? "OK" : issues.join("; ")
    });

  } catch (err) {
    record(`${s.id} ${s.group}: ${s.query}`, { passed: false, ticketId: null, latency: Date.now() - startTime, reason: err.message });
  }
}

async function main() {
  console.log("=== Libar Bot v2 — End-to-End Test Suite ===\n");
  console.log(`API: ${API} | Delay: ${DELAY_MS}ms | Max latency: ${MAX_LATENCY_MS}ms\n`);

  // Verify server is up
  const health = await request("GET", "/health");
  if (!health.body?.success) { console.error("Server not available at", API); process.exit(1); }
  console.log("Health:", health.body.status, "| Zendesk:", health.body.checks.zendesk ? "OK" : "FAIL", "\n");

  for (const s of SCENARIOS) {
    await runScenario(s);
    await sleep(DELAY_MS);
  }

  // Summary
  console.log("\n=== Summary ===");
  console.log(`Total: ${SCENARIOS.length} | Pass: ${PASS} | Fail: ${FAIL}`);
  console.log(`\nTickets created: ${RESULTS.filter((r) => r.ticketId).map((r) => r.ticketId).join(", ") || "none"}`);

  // Save report
  const reportPath = "/Users/zrinko/Downloads/libar-zendesk-bot-v2/tests/e2e-report.json";
  require("fs").writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(), api: API,
    total: SCENARIOS.length, pass: PASS, fail: FAIL,
    results: RESULTS
  }, null, 2));
  console.log(`\nReport saved: ${reportPath}`);

  if (FAIL > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
