/**
 * Test: POST /api/zendesk/webhook — obrada emaila kroz cijelu rutu.
 *
 * Zendesk, AI i baza znanja su zamijenjeni stubovima (bez mreže); ruta i
 * emailTextService/metricsService su pravi. Pokriva:
 *   - kupčev email odgovor koji CITIRA botov odgovor nije "botova poruka"
 *   - AI dobiva samo kupčev tekst (bez citata), a kratkom tijelu dodaje se naslov
 *   - Facebook poruke se ne diraju
 *   - brojač ishoda po stvarnom kanalu ticketa
 */
process.env.PORT = "0";
process.env.ZENDESK_WEBHOOK_TOKEN = "test-webhook-token";

const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");

const zendeskService = require("../services/zendeskService");
const aiService = require("../services/aiService");
const knowledgeService = require("../services/knowledgeService");
const outputValidator = require("../services/outputValidator");
const spamFilterService = require("../services/spamFilterService");
const metricsService = require("../services/metricsService");

// ─── Stubovi ───────────────────────────────────────────────────

const calls = { replies: [], notes: [], searches: [], generated: [] };
let ticket = { channel: "email", subject: "" };
let knowledgeContext = "Dostava traje 2-3 radna dana. Udžbenike pretražite na webshopu antikvarijat-libar.com.";

zendeskService.checkForAgentIntervention = async () => ({ takenOver: false, channel: ticket.channel, subject: ticket.subject });
zendeskService.isTicketHumanHandled = async () => ({ handled: false, tags: [] });
zendeskService.getTicketSummary = async () => ({ requesterId: 1, tags: [], channel: ticket.channel, subject: ticket.subject });
zendeskService.getPublicTicketComments = async () => [];
zendeskService.addBotReplyToTicket = async (id, text) => { calls.replies.push({ id, text }); };
zendeskService.addInternalNote = async (id, text) => { calls.notes.push({ id, text }); };
zendeskService.updateConversationState = async () => {};
spamFilterService.evaluateIncomingMessage = async () => ({ shouldBlock: false });
knowledgeService.searchKnowledgeDetailed = async (query) => {
  calls.searches.push(query);
  return knowledgeContext ? { context: knowledgeContext, primarySource: "test", topScore: 1, totalMatches: 1 } : null;
};
aiService.gradeContextRelevance = async () => ({ relevant: true });
aiService.generateGroundedAnswer = async (msg) => {
  calls.generated.push(msg);
  return knowledgeContext ? "Dostava traje 2-3 radna dana." : null;
};
outputValidator.validateAnswerQuality = () => ({ valid: true });

const app = require("../index");

let server, port;
test.before(async () => {
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  port = server.address().port;
});
// index.js pokreće vlastiti server i periodične sync timere — proces se gasi eksplicitno.
test.after(() => { server.close(); setImmediate(() => process.exit(0)); });

function reset(over = {}) {
  calls.replies.length = 0; calls.notes.length = 0; calls.searches.length = 0; calls.generated.length = 0;
  ticket = { channel: "email", subject: "", ...over };
  knowledgeContext = "Dostava traje 2-3 radna dana. Udžbenike pretražite na webshopu antikvarijat-libar.com.";
}

let seq = 0;
async function postWebhook(latestMessage, extra = {}) {
  seq += 1;
  const body = JSON.stringify({ ticketId: 5000 + seq, latestMessage, timestamp: `t${seq}`, ...extra });
  const res = await fetch(`http://127.0.0.1:${port}/api/zendesk/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer test-webhook-token" },
    body
  });
  return res.json();
}

function outcomes(channel) {
  return { ...((metricsService.getMetrics().webhookOutcomes || {})[channel] || {}) };
}

// ─── Testovi ───────────────────────────────────────────────────

test("kupčev email odgovor koji citira botov odgovor dobiva odgovor (nije 'own_reply')", async () => {
  reset();
  const before = outcomes("email").answered || 0;
  const msg = [
    "A koliko traje dostava na otok?",
    "",
    "pon, 5. lis 2026. 09:38 Antikvarijat Libar <info@antikvarijat-libar.com> je napisao:",
    "> Udžbenike pretražite na webshopu.",
    "> ---",
    "> *Vaš Libar AI Asistent*"
  ].join("\n");
  const res = await postWebhook(msg, { channelType: "email" });
  assert.notStrictEqual(res.skipped, "own_reply");
  assert.strictEqual(calls.replies.length, 1, "bot mora odgovoriti kupcu");
  assert.strictEqual(outcomes("email").answered, before + 1);
});

test("botova vlastita poruka (potpis bez citata) i dalje se preskače", async () => {
  reset();
  const res = await postWebhook("Dostava traje 2-3 dana.\n\n---\n*Vaš Libar AI Asistent*", { channelType: "email" });
  assert.strictEqual(res.skipped, "own_reply");
  assert.strictEqual(calls.replies.length, 0);
});

test("AI dobiva samo kupčev tekst — citirani predložak ne ide u pretragu ni generiranje", async () => {
  reset();
  const msg = [
    "Kada stiže moj paket?",
    "",
    "uto, 8. ruj 2026. 14:02 Antikvarijat Libar <info@antikvarijat-libar.com> je napisao:",
    "> Imate kakvih pitanja?",
    "> # Vaša narudžba je poslana",
    "> Uvjeti poslovanja · Opći uvjeti · Načini dostave i prikupa"
  ].join("\n");
  await postWebhook(msg, { channelType: "email" });
  assert.strictEqual(calls.searches.length, 1);
  assert.match(calls.searches[0], /Kada stiže moj paket\?/);
  assert.doesNotMatch(calls.searches[0], /Imate kakvih pitanja|Uvjeti poslovanja/);
  assert.doesNotMatch(calls.generated[0], /Imate kakvih pitanja/);
});

test("kratko email tijelo dobiva naslov ticketa", async () => {
  reset({ subject: "Udžbenik Focus 3" });
  await postWebhook("Imate li ovo? Hvala", { channelType: "email" });
  assert.match(calls.searches[0], /Udžbenik Focus 3/);
});

test("Facebook poruka se ne čisti i ne dobiva naslov, čak i kad payload nema channelType", async () => {
  reset({ channel: "facebook", subject: "Conversation with Ana" });
  const before = outcomes("facebook").answered || 0;
  await postWebhook("Imate li Focus 3?");
  assert.strictEqual(calls.searches[0], "Imate li Focus 3?");
  assert.strictEqual(outcomes("facebook").answered, before + 1, "brojač ide po stvarnom kanalu ticketa");
});

test("bez pouzdanog odgovora: interna bilješka i ishod 'no_answer' na kanalu", async () => {
  reset();
  knowledgeContext = "";
  const before = outcomes("email").no_answer || 0;
  await postWebhook("Imate li Stabilnost broda za 3. razred?", { channelType: "email" });
  assert.strictEqual(calls.replies.length, 0);
  assert.strictEqual(calls.notes.length, 1);
  assert.strictEqual(outcomes("email").no_answer, before + 1);
});

test("agent već u razgovoru: ishod 'agent_takeover'", async () => {
  reset();
  const orig = zendeskService.checkForAgentIntervention;
  zendeskService.checkForAgentIntervention = async () => ({ takenOver: true, reason: "agent_comment", channel: "email" });
  try {
    const before = outcomes("email").agent_takeover || 0;
    const res = await postWebhook("Hvala, čekam.", { channelType: "email" });
    assert.strictEqual(res.skipped, "agent_took_over");
    assert.strictEqual(outcomes("email").agent_takeover, before + 1);
  } finally { zendeskService.checkForAgentIntervention = orig; }
});
