/**
 * Escalation Flow Service
 *
 * Centralises two web-chat decisions that previously caused a 100% escalation
 * rate and an email-collection deadlock:
 *
 *  1. buildSelfServiceFallback — when the bot has no grounded answer, give the
 *     user a helpful self-service reply (webshop / otkup / kontakt links) instead
 *     of handing every unknown question to a human (which, on web chat, demanded
 *     an email and looped). Genuine human-need cases (complaints, returns, legal)
 *     are still escalated earlier by intentEscalationService.
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

const SELF_SERVICE_MESSAGE = [
  "Hvala na upitu! Evo kako Vam Antikvarijat Libar može najbrže pomoći:",
  "",
  "- Kupnja udžbenika: pretražite ponudu i naručite putem našeg webshopa.",
  "- Otkup udžbenika: upute i uvjeti nalaze se na stranici Otkup udžbenika.",
  "",
  "Ako trebate dodatnu pomoć, naš tim Vam stoji na raspolaganju putem kontakt stranice."
].join("\n");

function buildSelfServiceFallback(userMessage) {
  return {
    type: "safe_answer",
    customerMessage: SELF_SERVICE_MESSAGE,
    stateTag: "ai_active",
    reason: "self_service_fallback",
    source: "self_service",
    links: buildDirectWebsiteLinks(userMessage, { knowledge: null }),
    extraTags: []
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
  buildSelfServiceFallback,
  resolveAnonymousEscalation,
  NEED_EMAIL_MESSAGE,
  SELF_SERVICE_MESSAGE
};
