/**
 * Lokalni widget za ručnu provjeru — BEZ pisanja u Zendesk.
 *
 * Pokreće pravi Express server i pravi widget, ali presreće zendeskService prije
 * nego ga index.js učita, pa se nijedan tiket ne otvara na produkciji klijenta.
 * Sve ostalo je stvarno: gate u _resolveAutomatedOutcome, prepoznavanje škole,
 * sesija, renderiranje linkova u pregledniku.
 *
 * Pokretanje:
 *   node scripts/dev-widget-bez-zendeska.js
 *   pa otvori http://localhost:3000
 *
 * Za upite o popisu udžbenika ne treba nikakav API ključ — taj odgovor je
 * deterministički i nastaje prije ijednog LLM poziva. Za kontrolne upite
 * ("Kako naručiti udžbenike?") treba OPENROUTER_API_KEY; bez njega bot na njih
 * odgovori porukom o tehničkim poteškoćama, što je za ovu provjeru dovoljno
 * jer pokazuje da ga gate za udžbenike nije oteo.
 */
process.env.NODE_ENV = process.env.NODE_ENV || "development";
process.env.PORT = process.env.PORT || "3000";
// Auto-sync poslovi su ionako ugašeni po defaultu — ostavljamo ih ugašenima.
process.env.VECTOR_AUTO_SYNC_ENABLED = "false";
process.env.ANALYSIS_AUTO_SYNC_ENABLED = "false";

let brojac = 900000;
const tiketi = new Map();

function zapisi(sto, detalji) {
  console.log(`   [zendesk-stub] ${sto}`, detalji ?? "");
}

const stub = {
  async createChatTicket({ requesterName, initialMessage }) {
    const ticketId = ++brojac;
    tiketi.set(ticketId, { id: ticketId, status: "open", tags: ["ai_active"], komentari: [] });
    zapisi("createChatTicket ->", `#${ticketId} (${requesterName || "anoniman"})`);
    if (initialMessage) zapisi("  prva poruka:", initialMessage.slice(0, 60));
    return { ticketId, requesterId: 1 };
  },
  async getTicketSummary(ticketId) {
    return tiketi.get(Number(ticketId)) || { id: Number(ticketId), status: "open", tags: ["ai_active"] };
  },
  async addCustomerMessageToTicket(ticketId, _rid, text) {
    zapisi("korisnik ->", text.slice(0, 70));
  },
  async addBotReplyToTicket(ticketId, text) {
    zapisi("bot ->", (text || "").split("\n")[0].slice(0, 70));
  },
  async addInternalNote(ticketId, text) { zapisi("interna napomena:", String(text).slice(0, 60)); },
  async addTagAndNote() {},
  async updateConversationState(ticketId, stateTag) { zapisi("stanje:", stateTag); },
  async updateRequester() {}, async updateTicketRequester() {},
  async uploadAttachments() { return []; },
  async searchUsersByEmail() { return []; },
  async getTicketAudits() { return []; },
  async getPublicTicketComments() { return []; },
  async checkForAgentIntervention() { return false; },
  async ping() { return { ok: true, stub: true }; },
  detectAgentTakeover: () => false,
  isHumanHandled: () => false,
  isTicketHumanHandled: () => false,
  verifyWebhookToken: () => false,
  ticketUrl: (id) => `https://primjer.zendesk.com/agent/tickets/${id}`,
  HUMAN_OWNED_TAGS: []
};

// Ubaci stub u require cache PRIJE nego ga index.js zatraži.
const putanja = require.resolve("../services/zendeskService");
require.cache[putanja] = { id: putanja, filename: putanja, loaded: true, exports: stub };

console.log("");
console.log("  Zendesk je presretnut — nijedan tiket se ne otvara.");
console.log("  Otvori http://localhost:3000 i prati korake iz");
console.log("  .superpowers/sdd/2026-07-27-popis-udzbenika/ziva-provjera.md");
console.log("");

require("../index.js");
