/**
 * Escalation Flow Service
 *
 * Centralises two web-chat decisions:
 *
 *  1. buildNoAnswerEscalation — when the bot has no grounded answer, hand the
 *     conversation to a human, exactly like the email/Facebook webhook path does.
 *
 *     POVIJEST (ne vraćati na staro): ovdje je do 2026-07-31 stajao
 *     buildSelfServiceFallback, koji je umjesto eskalacije slao generički letak
 *     ("Evo kako Vam Antikvarijat Libar može najbrže pomoći") i razgovor ostavljao
 *     na "ai_active". Uveden je da zaustavi eskalaciju-na-sve i petlju s traženjem
 *     emaila, ali je time svaki upit bez pouzdanog odgovora — dostupnost naslova,
 *     otkupni iznos, pa i izravno "mogu li razgovarati s agentom" — završavao kao
 *     tobože uspješan odgovor koji nitko iz tima nije vidio. Petlja s emailom je u
 *     međuvremenu riješena zasebno (anonimne sesije se otvaraju bez emaila, a
 *     resolveAnonymousEscalation traži email najviše jednom), pa letak više nema
 *     svrhu i eskalacija je opet ispravan ishod.
 *
 *  2. resolveAnonymousEscalation — when a real escalation happens on an anonymous
 *     web-chat session (placeholder email), ask for an email AT MOST ONCE. If the
 *     visitor does not provide one, the escalation proceeds anyway (an agent
 *     replies inside the chat widget) so the conversation never deadlocks.
 */
const { buildDirectWebsiteLinks } = require("./siteLinkService");

const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;

function isLikelyEmail(text) {
  return EMAIL_RE.test(String(text || "").trim());
}

const NEED_EMAIL_MESSAGE = [
  "Rado ću Vaš upit proslijediti našem timu. Ako želite odgovor i na email,",
  "upišite svoju email adresu — ili samo nastavite pisati i naš tim će Vam",
  "odgovoriti ovdje u razgovoru."
].join(" ");

// Poruka mora biti iskrena: bot nema odgovor i ne glumi da ga ima. Korisniku se
// kaže tko preuzima i gdje će dobiti odgovor, bez traženja emaila (za to postoji
// resolveAnonymousEscalation, koji pita najviše jednom).
const NO_ANSWER_MESSAGE = [
  "Ovo Vam ne mogu potvrditi sa sigurnošću, pa upit prosljeđujem našem timu.",
  "Kolega će Vam odgovoriti ovdje u razgovoru u najkraćem mogućem roku."
].join(" ");

function buildNoAnswerEscalation(userMessage) {
  return {
    type: "escalate_no_answer",
    customerMessage: NO_ANSWER_MESSAGE,
    stateTag: "awaiting_human",
    reason: "no_grounded_answer",
    source: "escalation",
    links: buildDirectWebsiteLinks(userMessage, { knowledge: null }),
    extraTags: ["ai_escalated"]
  };
}

function resolveAnonymousEscalation(session, outcome) {
  // Only intervene for real human escalations on anonymous (placeholder-email) sessions.
  if (outcome.type !== "escalate_no_answer" || !session.emailIsPlaceholder) {
    return outcome;
  }

  // First escalation: ask for an email once and remember the pending escalation.
  if (!session.emailAsked) {
    session.emailAsked = true;
    session.pendingEscalation = { ...outcome };
    return {
      type: "need_email",
      customerMessage: NEED_EMAIL_MESSAGE,
      stateTag: "awaiting_email",
      reason: "email_needed_before_escalation",
      links: [],
      extraTags: []
    };
  }

  // Already asked once and still no email — escalate anyway, never loop.
  return {
    ...outcome,
    extraTags: [...(outcome.extraTags || []), "escalated_without_email"]
  };
}

module.exports = {
  isLikelyEmail,
  buildNoAnswerEscalation,
  resolveAnonymousEscalation,
  NEED_EMAIL_MESSAGE,
  NO_ANSWER_MESSAGE
};
