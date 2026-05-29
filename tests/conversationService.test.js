const cs = require("../services/conversationService");

function assert(cond, msg) { if (!cond) throw new Error(`FAIL: ${msg}`); }

const messages = [
  { role: "user", content: "Pozdrav, imam pitanje o dostavi" },
  { role: "assistant", content: "Dobar dan! Kako vam mogu pomoći?" },
  { role: "user", content: "Koliko traje dostava u Zagreb?" },
  { role: "assistant", content: "Dostava GLS-om traje 1-2 radna dana." }
];

// getRecentMessagesForAI
const recent = cs.getRecentMessagesForAI(messages);
assert(recent.length >= 2, "returns recent messages");
assert(recent[0].role === "user" || recent[0].role === "assistant", "valid roles");

// empty
assert(cs.getRecentMessagesForAI([]).length === 0, "empty in = empty out");

// buildConversationSummaryForAI
const summary = cs.buildConversationSummaryForAI(messages);
assert(summary.includes("Korisnik") || summary.includes("Asistent"), "has role labels");
assert(summary.length > 0, "non-empty summary");

// extractConversationTerms
const terms = cs.extractConversationTerms(messages);
assert(terms.length > 0, "extracts terms");
assert(terms.every((t) => t.length > 4), "terms >= 5 chars");

console.log("conversationService.test.js — all passed ✓");
