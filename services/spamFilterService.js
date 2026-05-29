/**
 * Spam Filter Service (Skill §13 — Input Layer Defense)
 *
 * Two-tier spam detection:
 * 1. Fast heuristic pass (regex + URL count + signal tokens)
 * 2. AI classifier for borderline "likely_spam" messages
 * Only applies to email channel.
 */
const aiService = require("./aiService");
const env = require("../config/env");
const { normalizeLowercase } = require("./textUtils");

const ENABLE = env.ENABLE_EMAIL_SPAM_CLASSIFIER;
const MIN_CONF = env.EMAIL_SPAM_AI_MIN_CONFIDENCE;

const HARD_SPAM_TAGS = new Set(["spam", "suspended"]);
const SUPPORT_TOKENS = [
  "narudž","dostav","račun","racun","uplat","plać","plac","otkup","procjen",
  "knjig","strip","pošilj","posilj","povrat","reklamac","problem","upit",
  "webshop","antikvarijat","libar"
];

const HARD_SPAM = [
  { name: "guest_post_pitch", regex: /\bguest post|sponsored post|paid post\b/i, score: 3 },
  { name: "backlink_pitch", regex: /\bbacklink|link exchange|dofollow|domain authority\b/i, score: 3 },
  { name: "seo_service_pitch", regex: /\bseo services?|seo expert|improve your rankings\b/i, score: 3 },
  { name: "phishing", regex: /\bverify your account|confirm your password|wallet|seed phrase|gift card\b/i, score: 4 },
  { name: "crypto_spam", regex: /\bcrypto|blockchain|binance|wallet address\b/i, score: 4 },
  { name: "adult_or_casino", regex: /\bcasino|betting|adult traffic|porn\b/i, score: 4 }
];

const LIKELY_SPAM = [
  { name: "generic_outreach", regex: /\bi came across your website|collaboration opportunity|partnership proposal\b/i, score: 2 },
  { name: "marketing_pitch", regex: /\bmarketing agency|lead generation|digital marketing|outreach campaign\b/i, score: 2 },
  { name: "mass_email", regex: /\bdear sir\/madam|dear website owner|hello admin\b/i, score: 2 },
  { name: "alt_contact", regex: /\btelegram|whatsapp|signal\b/i, score: 2 }
];

function normalizeText(v) { return normalizeLowercase(v); }

function hasSupportSignals(text) {
  const n = normalizeText(text);
  return SUPPORT_TOKENS.some((t) => n.includes(t));
}

function evaluateHeuristics(message, ticketSummary) {
  const nm = normalizeText(message);
  const tags = (ticketSummary?.tags || []).map((t) => String(t).toLowerCase());
  const signals = [];

  if (tags.some((t) => HARD_SPAM_TAGS.has(t))) {
    return { classification: "spam", score: 99, reason: "existing_spam_tag", matchedSignals: ["existing_spam_tag"] };
  }

  let score = 0;
  const urls = (message.match(/https?:\/\/|www\./gi) || []).length;
  if (urls >= 3) { score += 4; signals.push("many_links"); }
  else if (urls === 2) { score += 2; signals.push("multiple_links"); }

  for (const p of HARD_SPAM) { if (p.regex.test(message)) { score += p.score; signals.push(p.name); } }
  for (const p of LIKELY_SPAM) { if (p.regex.test(message)) { score += p.score; signals.push(p.name); } }

  if (!(message.match(/\?/g) || []).length && nm.length > 350) { score += 1; signals.push("long_no_question"); }
  if (!hasSupportSignals(nm) && nm.length > 180) { score += 1; signals.push("no_support_signals"); }
  if (hasSupportSignals(nm)) { score = Math.max(0, score - 2); signals.push("support_signal_detected"); }

  if (score >= 5) return { classification: "spam", score, reason: signals[0] || "heuristic_spam_match", matchedSignals: signals };
  if (score >= 3) return { classification: "likely_spam", score, reason: signals[0] || "heuristic_possible_spam", matchedSignals: signals };
  return { classification: "normal", score, reason: "no_spam_signals", matchedSignals: signals };
}

function shouldBlockAI(classification) {
  if (!classification) return false;
  if (["marketing_spam", "phishing_or_malicious"].includes(classification.label)) return classification.confidence >= MIN_CONF;
  if (classification.label === "sales_outreach") return classification.confidence >= 0.85;
  return false;
}

async function evaluateIncomingMessage({ channelType, message, ticketSummary }) {
  if (aiService.normalizeChannelType(channelType) !== "email") {
    return { shouldBlock: false, classification: "normal", reason: "channel_not_eligible", matchedSignals: [], usedAiReview: false, aiClassification: null };
  }

  const h = evaluateHeuristics(message, ticketSummary);
  if (h.classification === "spam") return { shouldBlock: true, ...h, usedAiReview: false, aiClassification: null };
  if (h.classification !== "likely_spam" || !ENABLE) return { shouldBlock: false, ...h, usedAiReview: false, aiClassification: null };

  const ai = await aiService.classifySpamCandidate(message, { channelType });
  const block = shouldBlockAI(ai);
  return { shouldBlock: block, classification: block ? "spam" : "normal", reason: block ? ai.reason : h.reason, matchedSignals: h.matchedSignals, usedAiReview: true, aiClassification: ai };
}

function buildSpamFilterNote(result, channelType = "email") {
  const parts = [`Spam filter (${aiService.normalizeChannelType(channelType)}): poruka preskočena.`, `Razlog: ${result.reason}`];
  if (result.matchedSignals?.length) parts.push(`Heuristike: ${result.matchedSignals.join(", ")}`);
  if (result.aiClassification) parts.push(`AI: ${result.aiClassification.label} (${result.aiClassification.confidence.toFixed(2)})`);
  return parts.join("\n");
}

module.exports = { buildSpamFilterNote, evaluateIncomingMessage };
