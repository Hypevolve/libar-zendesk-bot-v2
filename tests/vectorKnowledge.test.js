const vk = require("../services/vectorKnowledgeService");

function assert(cond, msg) { if (!cond) throw new Error(`FAIL: ${msg}`); }

const { chunkText, inferDomain, buildVectorQuery, hashText } = vk.__internal;

// chunkText
const chunks = chunkText("Paragraph one.\n\nParagraph two.\n\nParagraph three.", 50);
assert(chunks.length >= 1, "produces chunks");
assert(chunks.every((c) => c.length <= 60), "chunks respect max (with margin)");

const emptyChunks = chunkText("");
assert(emptyChunks.length === 0, "empty input = no chunks");

// inferDomain
assert(inferDomain({ title: "Otkup udžbenika" }) === "buyback", "buyback domain");
assert(inferDomain({ title: "Dostava GLS" }) === "delivery", "delivery domain");
assert(inferDomain({ title: "Reklamacija narudžbe" }) === "order", "order domain");
assert(inferDomain({ title: "Kontakt i radno vrijeme" }) === "support_info", "support domain");
assert(inferDomain({ title: "Nešto drugo" }) === "general", "general domain");

// buildVectorQuery
const vq = buildVectorQuery("dostava", { retrievalHints: ["gls"], conversationTerms: ["boxnow", "rok"] });
assert(vq.includes("dostava"), "contains query");
assert(vq.includes("gls"), "contains hint");

// hashText
assert(hashText("test").length === 64, "sha256 hex length");
assert(hashText("a") !== hashText("b"), "different hashes");

console.log("vectorKnowledge.test.js — all passed ✓");
