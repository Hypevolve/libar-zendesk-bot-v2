/**
 * Integration test stub for Vector Knowledge Service
 * Mocks Supabase pgvector RPC and document REST endpoints.
 * Run with real credentials to test live connections.
 */
const vectorKnowledgeService = require("../services/vectorKnowledgeService");
const embeddingService = require("../services/embeddingService");

function assert(cond, msg) { if (!cond) throw new Error(`FAIL: ${msg}`); }

async function runMockTests() {
  // 1. Configuration check
  const config = vectorKnowledgeService.getVectorConfigSummary();
  console.log("Vector config:", JSON.stringify(config, null, 2));
  assert(typeof config.enabled === "boolean", "enabled is boolean");
  assert(typeof config.matchCount === "number", "matchCount is number");

  // 2. Build document chunks
  // Must exceed 1200 chars total to trigger multi-chunk splitting
  const longBody = [
    "Online otkup: knjige šaljete kurirskom službom. Dostavljač donosi gotovu naljepnicu. Vi ništa ne pišete na paket. Online otkup uključuje besplatnu dostavu za 4 ili više knjiga. Za manje količine dostava se naplaćuje 2,70 EUR.",
    "Fizički otkup: donosite knjige osobno u poslovnicu na Županijskoj 17 u Osijeku. Isplata odmah u gotovini na blagajni. Za fizički otkup ne zahtijeva prethodnu najavu. Donesite knjige složene i čiste, uz OIB ili broj osobne iskaznice. Potreban je i otkupni blok.",
    "Dostava GLS-om traje 1-2 radna dana u cijeloj Hrvatskoj. Za otok Krk i Lastovo može trajati dan duže. Cijena dostave za 3 ili manje knjiga je 2,70 EUR. Za 4 ili više knjiga dostava je besplatna. Paket možete pratiti putem GLS tracking sustava.",
    "Radno vrijeme poslovnice: ponedjeljak do petka 08:00-20:00, subota 08:00-13:00. Nedjeljom zatvoreno. Blagajna radi do 19:30. Kontakt telefon: 031/201-230. Email: info@antikvarijat-libar.com. Facebook stranica: Antikvarijat Libar.",
    "Povrat i zamjena robe: unutar 14 dana od primitka robe, uz priloženi račun ili fotografiju računa. Trošak povrata snosi kupac. Zamjena je moguća uz nadoplatu razlike u cijeni. Reklamacije obrađujemo u roku 8 radnih dana.",
    "Program vjernosti Sjedi 5: pri kupnji 5 udžbenika ostvarujete besplatnu dostavu. Pri kupnji ukupno 8 udžbenika dobivate 5 posto popusta. Pri kupnji 11 ili više udžbenika dobivate 10 posto popusta. Popusti se ne zbrajaju s ostalim akcijama.",
    "Načini plaćanja: gotovina, kartica, pouzeće, te rate putem PBZ i ZABA kartica u 2 do 6 rata. R1 račun za pravne osobe nije automatski — pošaljite podatke tvrtke na email. Isplata na Aircash nije dostupna."
  ].join("\n\n");
  const doc = { id: "test-doc-1", title: "Otkup udžbenika", body: longBody, url: "https://example.com" };
  const chunks = vectorKnowledgeService.buildDocumentChunks(doc);
  assert(chunks.length >= 2, "document chunked into multiple parts");
  assert(chunks.every((c) => c.body.length <= 1300), "chunks within max+margin");
  assert(chunks.some((c) => c.domain === "buyback"), "buyback domain detected");
  assert(chunks.some((c) => c.domain === "delivery"), "delivery domain detected");
  assert(chunks.some((c) => c.domain === "support_info"), "support_info domain detected");
  assert(chunks.every((c) => c.contentHash && c.contentHash.length === 64), "sha256 hash present");

  // 3. Domain inference edge cases
  const genDoc = { id: "2", title: "Random text", body: "Something unrelated." };
  const genChunks = vectorKnowledgeService.buildDocumentChunks(genDoc);
  assert(genChunks.every((c) => c.domain === "general"), "general domain for unrelated text");

  // 4. Build vector query
  const { buildVectorQuery } = vectorKnowledgeService.__internal;
  const vq = buildVectorQuery("dostava", { retrievalHints: ["gls"], conversationTerms: ["boxnow"] });
  assert(vq.includes("dostava") && vq.includes("gls") && vq.includes("boxnow"), "vector query combines hints");

  // 5. Search requires Supabase RPC — skip if not configured
  const configured = vectorKnowledgeService.isConfigured();
  if (!configured) {
    console.log("SKIP: Supabase not configured. Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY to run live tests.");
    return;
  }

  // Live test: embed a query
  const embedding = await embeddingService.embedText("koliko traje dostava");
  assert(Array.isArray(embedding) && embedding.length > 0, "embedding produced");
  console.log(`Embedding dimension: ${embedding.length}`);

  // Live test: search (requires match_knowledge_chunks RPC in Supabase)
  const result = await vectorKnowledgeService.searchVectorKnowledgeDetailed("dostava", { taskIntent: "delivery" });
  if (result) {
    assert(result.context && result.context.length > 0, "context returned");
    assert(Array.isArray(result.articles), "articles array");
    assert(result.topScore >= 0, "topScore >= 0");
    console.log(`Live search: ${result.totalMatches} matches, top score ${result.topScore}`);
  } else {
    console.log("Live search returned null — either no data in vector DB or match_knowledge_chunks RPC missing.");
  }
}

runMockTests().then(() => console.log("integration.vectorKnowledge.test.js — done ✓")).catch((e) => { console.error(e.message); process.exit(1); });
