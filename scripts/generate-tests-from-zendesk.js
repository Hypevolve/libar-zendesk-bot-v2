/**
 * Skripta za analizu stvarnih Zendesk ticketa i generiranje e2e test scenarija.
 *
 * Koraci:
 * 1. Dohvati zadnjih N ticketa iz Zendeska
 * 2. Ekstraktiraj korisničke upite (prva poruka od requestera)
 * 3. Koristi LLM da kategorizira, grupira i generalizira upite
 * 4. Generiraj test scenarije u e2e formatu
 * 5. Spremi u tests/e2e-generated.test.js
 *
 * Pokretanje: node scripts/generate-tests-from-zendesk.js
 */
require("dotenv").config();
const https = require("https");
const fs = require("fs");
const path = require("path");

const ZENDESK_SUBDOMAIN = process.env.ZENDESK_SUBDOMAIN;
const ZENDESK_EMAIL = process.env.ZENDESK_EMAIL;
const ZENDESK_API_TOKEN = process.env.ZENDESK_API_TOKEN;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";

const MAX_TICKETS = 200;
const DAYS_BACK = 60;
const OUTPUT_FILE = path.join(__dirname, "../tests/e2e-generated.test.js");

async function zendeskRequest(path) {
  return new Promise((resolve, reject) => {
    const auth = Buffer.from(`${ZENDESK_EMAIL}/token:${ZENDESK_API_TOKEN}`).toString("base64");
    const req = https.request({
      hostname: `${ZENDESK_SUBDOMAIN}.zendesk.com`,
      path: `/api/v2${path}`,
      method: "GET",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" }
    }, (res) => {
      let data = "";
      res.on("data", (c) => { data += c; });
      res.on("end", () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error("timeout")); });
    req.end();
  });
}

async function fetchRecentTickets() {
  const since = new Date(Date.now() - DAYS_BACK * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const query = encodeURIComponent(`type:ticket created>=${since} -requester:test-*@libar.local`);
  const result = await zendeskRequest(`/search.json?query=${query}&sort_by=created_at&sort_order=desc&per_page=${MAX_TICKETS}`);
  return result.results || [];
}

async function fetchTicketComments(ticketId) {
  const result = await zendeskRequest(`/tickets/${ticketId}/comments.json`);
  return (result.comments || []).filter((c) => c.via?.channel !== "web_service");
}

async function llmAnalyze(queriesBatch) {
  const prompt = `Ti si analitičar korisničke podrške. Analiziraj sljedeće STVARNE korisničke upite iz Zendesk ticketa.

ZADATAK:
1. Grupiraj upite po temama: otkup, dostava, narudzba, povrat, kontakt, placanje, ostalo
2. Za svaku grupu izdvoji 3-5 tipičnih pitanja (generalizirane verzije, bez osobnih podataka)
3. Za svako pitanje navedi 2-3 ključne točke koje AI treba spomenuti u odgovoru
4. Označi koja pitanja zahtijevaju eskalaciju na ljudskog agenta

UPITI:
${queriesBatch.map((q, i) => `${i + 1}. ${q.text.slice(0, 180)}`).join("\n")}

Odgovori SAMO u JSON formatu (bez markdown, bez objašnjenja prije i poslije):
{"otkup": [{"q": "pitanje", "points": ["točka1", "točka2"], "escalate": false}], "dostava": [...], "narudzba": [...], "povrat": [...], "kontakt": [...], "placanje": [...], "ostalo": [...]}`;

  return new Promise((resolve) => {
    const body = JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 3000,
      temperature: 0.1
    });

    const req = https.request({
      hostname: "openrouter.ai",
      path: "/api/v1/chat/completions",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        "HTTP-Referer": "https://antikvarijat-libar.com",
        "X-Title": "Libar Test Generator"
      }
    }, (res) => {
      let data = "";
      res.on("data", (c) => { data += c; });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          console.log("API response keys:", Object.keys(parsed));
          if (parsed.error) { console.log("API error:", parsed.error); }
          const content = parsed.choices?.[0]?.message?.content?.trim() || "";
          console.log("LLM content:", content.slice(0, 800));
          // Try to extract JSON
          const match = content.match(/\{[\s\S]*\}/);
          if (match) {
            resolve(JSON.parse(match[0]));
          } else {
            resolve({ error: "no_json", raw: content.slice(0, 500) });
          }
        } catch {
          resolve({ error: "parse_failed", raw: data.slice(0, 500) });
        }
      });
    });
    req.on("error", () => resolve({ error: "network" }));
    req.setTimeout(45000, () => { req.destroy(); resolve({ error: "timeout" }); });
    req.write(body);
    req.end();
  });
}

function buildTestFile(analysis) {
  const scenarios = [];
  let counter = 1;

  for (const [groupName, patterns] of Object.entries(analysis)) {
    if (groupName === "error" || groupName === "raw" || !Array.isArray(patterns)) continue;
    for (const pattern of patterns) {
      if (!pattern.q) continue;
      const id = `GEN-${String(counter).padStart(2, "0")}`;
      const points = (pattern.points || []).slice(0, 3).map((p) => JSON.stringify(p)).join(", ");
      scenarios.push(`
  {
    id: "${id}", group: "${groupName}", query: ${JSON.stringify(pattern.q)},
    expected: { shouldContain: [${points}] },
    checkRetrieval: true${pattern.escalate ? ", allowEscalation: true" : ""}
  }`);
      counter++;
    }
  }

  const content = `/**
 * Auto-generated e2e tests from real Zendesk tickets
 * Generated: ${new Date().toISOString()}
 * Source: ${MAX_TICKETS} tickets from last ${DAYS_BACK} days
 */
const GENERATED_SCENARIOS = [${scenarios.join(",")}
];

module.exports = { GENERATED_SCENARIOS };
`;
  return content;
}

async function main() {
  console.log("API key present:", OPENROUTER_API_KEY ? "yes (" + OPENROUTER_API_KEY.slice(0, 8) + "...)" : "NO");
  console.log("Model:", OPENROUTER_MODEL);
  console.log("Fetching recent Zendesk tickets...");
  let tickets = await fetchRecentTickets();
  tickets = tickets.filter((t) => !t.requester?.email?.includes("test-") && !t.requester?.email?.includes("@libar.local"));
  console.log(`Found ${tickets.length} real tickets (test tickets excluded)`);

  const queries = [];
  let processed = 0;
  for (const ticket of tickets.slice(0, 50)) { // max 50 for API rate limiting
    try {
      const comments = await fetchTicketComments(ticket.id);
      const firstCustomerComment = comments.find((c) => c.author_id === ticket.requester_id);
      if (firstCustomerComment) {
        const text = firstCustomerComment.body?.replace(/<[^>]+>/g, " ").trim();
        if (text && text.length > 5 && text.length < 500) {
          queries.push({ text, group: ticket.subject?.slice(0, 30) || "general" });
        }
      }
    } catch (err) {
      console.warn(`Skip ticket ${ticket.id}: ${err.message}`);
    }
    processed++;
    if (processed % 10 === 0) console.log(`  ${processed}/${tickets.length}...`);
  }

  console.log(`\nExtracted ${queries.length} customer queries`);
  if (queries.length === 0) {
    console.log("No queries found. Exiting.");
    process.exit(0);
  }

  console.log("Analyzing with LLM...");
  const analysis = await llmAnalyze(queries);

  if (analysis.error) {
    console.error("LLM analysis failed:", analysis.error, analysis.raw?.slice(0, 200));
    process.exit(1);
  }

  console.log("\nAnalysis results:");
  for (const [group, data] of Object.entries(analysis.groups || {})) {
    console.log(`  ${group}: ${(data.patterns || []).length} patterns`);
  }
  if (analysis.edgeCases?.length) {
    console.log(`  Edge cases: ${analysis.edgeCases.length}`);
  }

  const testContent = buildTestFile(analysis);
  fs.writeFileSync(OUTPUT_FILE, testContent, "utf8");
  console.log(`\nGenerated ${OUTPUT_FILE} with ${(analysis.groups || {}).length} groups`);
}

main().catch((err) => { console.error(err); process.exit(1); });
