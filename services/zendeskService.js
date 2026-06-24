/**
 * Zendesk Service (Skill §14 — Production API)
 *
 * All Zendesk API interactions: tickets, comments, Help Center search,
 * attachments, webhook verification, conversation state.
 */
const axios = require("axios");
const env = require("../config/env");
const log = require("../config/logger");
const { normalizeForSearch, stripHtml, tokenize, truncateText } = require("./textUtils");

// ─── Client ───────────────────────────────────────────────────

if (!env.ZENDESK_SUBDOMAIN || !env.ZENDESK_EMAIL || !env.ZENDESK_API_TOKEN) {
  log.warn("zendesk_config_missing", "Zendesk env vars missing. API calls will fail.");
}

const zendeskClient = axios.create({
  baseURL: `https://${env.ZENDESK_SUBDOMAIN}.zendesk.com`,
  auth: {
    username: `${env.ZENDESK_EMAIL}/token`,
    password: env.ZENDESK_API_TOKEN
  },
  headers: { "Content-Type": "application/json" },
  timeout: 15000
});

// ─── Config Summary ───────────────────────────────────────────

function maskSecret(v = "") {
  const s = String(v).trim();
  if (!s || s.length <= 6) return "***";
  return `${s.slice(0, 3)}***${s.slice(-3)}`;
}

function getZendeskConfigSummary() {
  return {
    baseURL: `https://${env.ZENDESK_SUBDOMAIN}.zendesk.com`,
    email: env.ZENDESK_EMAIL,
    tokenPreview: maskSecret(env.ZENDESK_API_TOKEN),
    webhookTokenConfigured: Boolean(env.ZENDESK_WEBHOOK_TOKEN)
  };
}

// ─── Validation ───────────────────────────────────────────────

const PLACEHOLDER_VALUES = new Set(["", "your-subdomain", "agent@example.com", "your-zendesk-api-token"]);

function validateZendeskConfig() {
  if (PLACEHOLDER_VALUES.has(env.ZENDESK_SUBDOMAIN.toLowerCase())) {
    throw new Error("ZENDESK_SUBDOMAIN is missing or placeholder.");
  }
  if (PLACEHOLDER_VALUES.has(env.ZENDESK_EMAIL.toLowerCase()) || !env.ZENDESK_EMAIL.includes("@")) {
    throw new Error("ZENDESK_EMAIL must be a real agent email.");
  }
  if (PLACEHOLDER_VALUES.has(env.ZENDESK_API_TOKEN.toLowerCase())) {
    throw new Error("ZENDESK_API_TOKEN is missing or placeholder.");
  }
}

function buildApiError(action, error, extra = {}) {
  const status = error.response?.status;
  if (status === 401) return new Error(`${action}: auth failed (401). Check email/token.`);
  if (status === 403) return new Error(`${action}: access denied (403).`);
  const err = new Error(`${action} failed${status ? ` (${status})` : ""}.`);
  err.status = status || null;
  err.extra = extra;
  return err;
}

// ─── Help Center ──────────────────────────────────────────────

const helpCenterCache = { articles: null, expiresAt: 0 };

async function fetchAllHelpCenterArticles() {
  validateZendeskConfig();
  const now = Date.now();
  if (helpCenterCache.articles && helpCenterCache.expiresAt > now) return helpCenterCache.articles;

  const all = [];
  let url = "/api/v2/help_center/articles.json?page[size]=100";
  while (url) {
    const res = await zendeskClient.get(url);
    const page = Array.isArray(res.data?.articles) ? res.data.articles : [];
    all.push(...page);
    url = res.data?.next_page || null;
  }

  const published = all.filter((a) => !a.draft);
  helpCenterCache.articles = published;
  helpCenterCache.expiresAt = now + env.HELP_CENTER_CACHE_TTL_MS;
  return published;
}

function scoreSearchText(text, query) {
  const normalised = normalizeForSearch(text);
  const tokens = tokenize(query);
  if (!tokens.length || !normalised) return 0;
  let score = 0;
  for (const token of tokens) {
    if (normalised.includes(token)) score += 3;
  }
  if (normalised.includes(normalizeForSearch(query))) score += 10;
  return score;
}

function findBestExcerpt(body, query, maxLen = 900) {
  const plainBody = stripHtml(body);
  const normQuery = normalizeForSearch(query);
  const normBody = normalizeForSearch(plainBody);
  const idx = normBody.indexOf(normQuery);
  if (idx === -1) return truncateText(plainBody, maxLen);
  const start = Math.max(0, idx - 100);
  return plainBody.slice(start, start + maxLen);
}

function scoreArticle(article, query) {
  const searchText = [
    article.title || "", article.body || "",
    Array.isArray(article.label_names) ? article.label_names.join(" ") : ""
  ].join(" ");
  let score = scoreSearchText(searchText, query);
  const title = normalizeForSearch(article.title || "");
  if (title.includes(normalizeForSearch(query))) score += 15;
  score += scoreSearchText(article.title || "", query) * 2;
  return score;
}

async function searchHelpCenterDetailed(query, options = {}) {
  try {
    const articles = await fetchAllHelpCenterArticles();
    if (!articles.length) return null;

    const ranked = articles
      .map((article) => ({
        article, score: scoreArticle(article, query),
        excerpt: findBestExcerpt(article.body || "", query)
      }))
      .filter((e) => e.score > 0)
      .sort((a, b) => b.score - a.score);

    const seen = new Set();
    const unique = ranked.filter(({ article }) => {
      const key = normalizeForSearch(`${article.title} ${stripHtml(article.body || "").slice(0, 240)}`);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, env.HELP_CENTER_CONTEXT_ARTICLES);

    if (!unique.length) return null;

    const context = unique.map(({ article, score, excerpt }, i) => {
      const title = stripHtml(article.title || "Bez naslova");
      const body = excerpt || truncateText(stripHtml(article.body || ""));
      return `Članak ${i + 1}:\nNaslov: ${title}\nRelevantnost: ${score}\nSadržaj: ${body}`;
    }).join("\n\n");

    return {
      context,
      articles: unique.map(({ article, score, excerpt }) => ({
        id: article.id,
        title: stripHtml(article.title || "Bez naslova"),
        score,
        body: excerpt || truncateText(stripHtml(article.body || "")),
        source: "zendesk"
      })),
      topScore: unique[0]?.score || 0,
      totalMatches: unique.length
    };
  } catch (error) {
    log.error("help_center_search_failed", { message: error.message });
    return null;
  }
}

async function searchHelpCenter(query) {
  const result = await searchHelpCenterDetailed(query);
  return result?.context || null;
}

// ─── Ticket Operations ────────────────────────────────────────

async function getRequesterProfile(requesterId) {
  if (!requesterId) return { id: null, name: "", email: "" };
  try {
    validateZendeskConfig();
    const res = await zendeskClient.get(`/api/v2/users/${requesterId}.json`);
    const u = res.data?.user || {};
    return { id: u.id || requesterId, name: (u.name || "").trim(), email: (u.email || "").trim() };
  } catch (error) {
    log.error("requester_profile_failed", { requesterId, message: error.message });
    return { id: requesterId, name: "", email: "" };
  }
}

async function searchUsersByEmail(email) {
  if (!email) return [];
  try {
    validateZendeskConfig();
    // Plain text search — more reliable than email: operator
    const res = await zendeskClient.get(`/api/v2/users/search.json?query=${encodeURIComponent(email)}`);
    const users = res.data?.users || [];
    // Defensive: only return users whose email actually matches
    const exactMatches = users.filter((u) => (u.email || "").trim().toLowerCase() === email.toLowerCase());
    log.info("search_users_result", { email, rawCount: users.length, exactCount: exactMatches.length, exactIds: exactMatches.map((u) => u.id) });
    return exactMatches;
  } catch (error) {
    log.error("search_users_failed", { email, message: error.message });
    return [];
  }
}

async function updateRequester(requesterId, { name, email }) {
  if (!requesterId) throw new Error("requesterId is required.");
  try {
    validateZendeskConfig();
    const res = await zendeskClient.put(`/api/v2/users/${requesterId}.json`, {
      user: { name, email }
    });
    return res.data?.user || {};
  } catch (error) {
    throw buildApiError("updateRequester", error, { requesterId });
  }
}

async function updateTicketRequester(ticketId, requesterId) {
  if (!ticketId || !requesterId) throw new Error("ticketId and requesterId are required.");
  try {
    validateZendeskConfig();
    const res = await zendeskClient.put(`/api/v2/tickets/${ticketId}.json`, {
      ticket: { requester_id: requesterId }
    });
    return res.data?.ticket || {};
  } catch (error) {
    throw buildApiError("updateTicketRequester", error, { ticketId });
  }
}

async function replyToTicket(ticketId, replyText, isPublic = false, options = {}) {
  try {
    validateZendeskConfig();
    const res = await zendeskClient.put(`/api/v2/tickets/${ticketId}.json`, {
      ticket: {
        comment: {
          public: isPublic, body: replyText,
          ...(options.authorId ? { author_id: options.authorId } : {}),
          ...(options.uploadTokens?.length ? { uploads: options.uploadTokens } : {})
        },
        ...(options.metadata ? { metadata: { custom: options.metadata } } : {}),
        ...(options.additionalTags?.length ? { additional_tags: options.additionalTags } : {})
      }
    });
    return res.data;
  } catch (error) {
    throw buildApiError("replyToTicket", error, { ticketId });
  }
}

async function addInternalNote(ticketId, noteText, additionalTags = []) {
  return replyToTicket(ticketId, noteText, false, { additionalTags });
}

async function addTagAndNote(ticketId, tag, noteText) {
  try {
    validateZendeskConfig();
    const res = await zendeskClient.put(`/api/v2/tickets/${ticketId}.json`, {
      ticket: { additional_tags: [tag], comment: { public: false, body: noteText } }
    });
    return res.data;
  } catch (error) {
    throw buildApiError("addTagAndNote", error, { ticketId, tag });
  }
}

async function createChatTicket({ requesterName, requesterEmail, initialMessage, subject, uploadTokens = [], externalId = null, additionalTags = [] }) {
  try {
    validateZendeskConfig();
    const res = await zendeskClient.post("/api/v2/tickets.json", {
      ticket: {
        subject: subject || "Webshop chat conversation",
        comment: {
          public: true, body: initialMessage,
          ...(uploadTokens.length ? { uploads: uploadTokens } : {})
        },
        metadata: { custom: { libar_message_role: "customer", libar_message_origin: "webchat" } },
        requester: { name: requesterName, email: requesterEmail },
        ...(externalId ? { external_id: externalId } : {}),
        additional_tags: [...new Set(["webshop_chat", "ai_chat", "ai_active", ...additionalTags])]
      }
    });
    const ticket = res.data?.ticket;
    return {
      ticketId: ticket?.id,
      requesterId: ticket?.requester_id,
      externalId: ticket?.external_id || externalId || null
    };
  } catch (error) {
    throw buildApiError("createChatTicket", error);
  }
}

async function addCustomerMessageToTicket(ticketId, requesterId, messageText, uploadTokens = []) {
  return replyToTicket(ticketId, messageText, true, {
    authorId: requesterId, uploadTokens,
    metadata: { libar_message_role: "customer", libar_message_origin: "webchat" }
  });
}

function resolveBotReplyOrigin(channelType = "web_chat") {
  const n = String(channelType).trim().toLowerCase();
  if (n === "facebook") return "facebook_ai";
  if (n === "email") return "email_ai";
  if (n === "web_chat" || n === "webchat") return "webchat_ai";
  return "zendesk_ai";
}

// Signature marker appended to every bot reply. Used for precise agent-intervention
// detection (checkForAgentIntervention looks for this text in the latest comment).
const BOT_SIGNATURE = "\n\n---\n*Vaš Libar Asistent*";

async function addBotReplyToTicket(ticketId, replyText, options = {}) {
  const signedReply = replyText + BOT_SIGNATURE;
  return replyToTicket(ticketId, signedReply, true, {
    additionalTags: [...new Set(["ai_replied", ...(options.additionalTags || [])])],
    metadata: { ...(options.metadata || {}), libar_message_role: "assistant", libar_message_origin: resolveBotReplyOrigin(options.channelType) }
  });
}

async function setTicketTags(ticketId, nextTags = []) {
  try {
    validateZendeskConfig();
    const res = await zendeskClient.put(`/api/v2/tickets/${ticketId}.json`, { ticket: { tags: nextTags } });
    return res.data;
  } catch (error) {
    throw buildApiError("setTicketTags", error, { ticketId });
  }
}

const STATE_TAGS = new Set(["ai_active", "awaiting_human", "awaiting_customer_detail", "human_active", "resolved"]);

// Tags that mean a human agent has taken over (or the ticket is closed). When any
// of these is present the bot MUST stay silent so it never talks over an agent or
// re-opens a resolved conversation. Pure function so it can be unit-tested.
const HUMAN_OWNED_TAGS = new Set(["human_active", "awaiting_human", "resolved"]);

function isHumanHandled(tags = []) {
  if (!Array.isArray(tags)) return false;
  return tags.some((t) => HUMAN_OWNED_TAGS.has(String(t || "").trim().toLowerCase()));
}

/**
 * Fetch the ticket and decide whether the bot should stay silent. Returns
 * { handled: boolean, tags: string[] }. On API failure we FAIL-OPEN to false so a
 * transient Zendesk error doesn't permanently mute the bot — but we log it.
 */
async function isTicketHumanHandled(ticketId) {
  try {
    const summary = await getTicketSummary(ticketId);
    return { handled: isHumanHandled(summary.tags), tags: summary.tags || [] };
  } catch (error) {
    log.warn("human_handled_check_failed", { ticketId, message: error.message });
    return { handled: false, tags: [] };
  }
}

async function updateConversationState(ticketId, nextState, extraTags = []) {
  const ticket = await getTicketSummary(ticketId);
  const nextTags = (ticket.tags || []).filter((t) => !STATE_TAGS.has(t));
  if (nextState) nextTags.push(nextState);
  for (const t of extraTags) { if (t && !nextTags.includes(t)) nextTags.push(t); }
  return setTicketTags(ticketId, nextTags);
}

async function solveTicket(ticketId, options = {}) {
  try {
    validateZendeskConfig();
    const res = await zendeskClient.put(`/api/v2/tickets/${ticketId}.json`, {
      ticket: {
        status: "solved",
        ...(options.commentBody ? { comment: { public: true, body: options.commentBody } } : {}),
        ...(options.additionalTags?.length ? { additional_tags: options.additionalTags } : {})
      }
    });
    return res.data;
  } catch (error) {
    throw buildApiError("solveTicket", error, { ticketId });
  }
}

async function uploadAttachment(file) {
  try {
    validateZendeskConfig();
    const res = await zendeskClient.post("/api/v2/uploads.json", file.buffer, {
      params: { filename: file.originalname },
      headers: { "Content-Type": file.mimetype || "application/octet-stream" },
      maxBodyLength: Infinity, maxContentLength: Infinity
    });
    const upload = res.data?.upload;
    return {
      token: upload?.token,
      attachment: {
        id: upload?.attachment?.id || file.originalname,
        name: upload?.attachment?.file_name || file.originalname,
        contentType: upload?.attachment?.content_type || file.mimetype,
        size: upload?.attachment?.size || file.size,
        url: upload?.attachment?.content_url || null
      }
    };
  } catch (error) {
    throw buildApiError("uploadAttachment", error, { filename: file.originalname });
  }
}

async function uploadAttachments(files = []) {
  return Promise.all(files.map(uploadAttachment));
}

async function getPublicTicketComments(ticketId) {
  try {
    validateZendeskConfig();
    const res = await zendeskClient.get(`/api/v2/tickets/${ticketId}/comments.json`, { params: { sort: "created_at" } });
    return (Array.isArray(res.data?.comments) ? res.data.comments : []).filter((c) => c.public !== false);
  } catch (error) {
    throw buildApiError("getPublicTicketComments", error, { ticketId });
  }
}

async function getTicketAudits(ticketId) {
  try {
    validateZendeskConfig();
    const audits = [];
    let url = `/api/v2/tickets/${ticketId}/audits.json?filter_events[]=Comment&page[size]=100`;
    while (url) {
      const res = await zendeskClient.get(url);
      audits.push(...(Array.isArray(res.data?.audits) ? res.data.audits : []));
      url = res.data?.next_page || null;
    }
    return audits;
  } catch (error) {
    throw buildApiError("getTicketAudits", error, { ticketId });
  }
}

async function getTicketSummary(ticketId) {
  try {
    validateZendeskConfig();
    const res = await zendeskClient.get(`/api/v2/tickets/${ticketId}.json`);
    const t = res.data?.ticket || {};
    const requester = await getRequesterProfile(t.requester_id);
    return {
      id: t.id, status: t.status || null,
      tags: Array.isArray(t.tags) ? t.tags : [],
      assigneeId: t.assignee_id || null,
      requesterId: t.requester_id || null,
      externalId: t.external_id || null,
      requesterName: requester.name,
      requesterEmail: requester.email
    };
  } catch (error) {
    throw buildApiError("getTicketSummary", error, { ticketId });
  }
}

// Čista funkcija: normalizira sirovi ticket iz Incremental API-ja u oblik za analizu.
function normalizeIncrementalTicket(raw = {}) {
  return {
    id: raw.id,
    subject: raw.subject || raw.raw_subject || "",
    status: raw.status || null,
    channel: raw.via?.channel || "unknown",
    created_at: raw.created_at || null,
    requester_id: raw.requester_id || null,
    tags: Array.isArray(raw.tags) ? raw.tags : []
  };
}

/**
 * Dohvati tickete kreirane/izmijenjene od sinceISO preko Incremental Export API-ja.
 * Paginirano; staje kad skupi maxTickets ili kad nema više stranica.
 * Vraća { tickets: normalized[], nextCursorISO } (cursor = zadnji end_time kao ISO).
 */
async function listTicketsSince(sinceISO, { maxTickets = 150 } = {}) {
  validateZendeskConfig();
  const startTime = Math.floor(new Date(sinceISO || 0).getTime() / 1000) || 0;
  const tickets = [];
  let url = `/api/v2/incremental/tickets.json?start_time=${startTime}`;
  let cursorUnix = startTime;
  try {
    while (url && tickets.length < maxTickets) {
      const res = await zendeskClient.get(url);
      const batch = Array.isArray(res.data?.tickets) ? res.data.tickets : [];
      for (const raw of batch) {
        tickets.push(normalizeIncrementalTicket(raw));
        if (tickets.length >= maxTickets) break;
      }
      if (res.data?.end_time) cursorUnix = res.data.end_time;
      // Incremental stream je gotov kad count < 1000 (Zendesk konvencija).
      url = (res.data?.count >= 1000 && tickets.length < maxTickets) ? res.data.next_page : null;
    }
    return { tickets, nextCursorISO: new Date(cursorUnix * 1000).toISOString() };
  } catch (error) {
    throw buildApiError("listTicketsSince", error, { sinceISO });
  }
}

function verifyWebhookToken(token = "") {
  if (!env.ZENDESK_WEBHOOK_TOKEN) return false;
  return String(token).trim() === env.ZENDESK_WEBHOOK_TOKEN;
}

async function testZendeskTicketAccess(ticketId) {
  try {
    validateZendeskConfig();
    const res = await zendeskClient.get(`/api/v2/tickets/${ticketId}.json`);
    return { ok: true, ticketId: res.data?.ticket?.id || ticketId };
  } catch (error) {
    throw buildApiError("testZendeskTicketAccess", error, { ticketId });
  }
}

function resetHelpCenterCache() {
  helpCenterCache.articles = null;
  helpCenterCache.expiresAt = 0;
}

async function ping() {
  try {
    const res = await zendeskClient.get("/api/v2/users/me.json");
    return { ok: true, user: res.data?.user?.name || "unknown" };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

/**
 * Pure decision: has a human agent taken over this ticket?
 *
 * STICKY semantics — once ANY public comment in the ticket is from a human agent,
 * the bot must stay silent for the rest of the conversation, even if the customer
 * messages again afterwards. (Previously this only looked at the single latest
 * comment, so a follow-up customer message let the bot talk over an agent who had
 * already joined — see tests for the regression this guards against.)
 *
 * We only ever receive PUBLIC comments here (getPublicTicketComments filters out
 * internal notes), so an agent's private note does not silence the bot — only a
 * public reply to the customer does.
 *
 * A comment counts as an agent comment when it is:
 *   (a) NOT authored by the requester (so not a customer message), AND
 *   (b) NOT one of the bot's own signed replies (no BOT_SIGNATURE).
 *
 * Returns { takenOver: boolean, reason?: string }. Pure function so it can be
 * unit-tested without hitting the Zendesk API.
 */
function detectAgentTakeover(comments = [], requesterId = null) {
  for (const c of comments) {
    if (c.author_id === requesterId) continue;                  // customer message
    if (String(c.body || "").includes(BOT_SIGNATURE)) continue; // bot's own reply
    return { takenOver: true, reason: "agent_comment_detected" }; // human agent joined
  }
  return { takenOver: false };
}

/**
 * Fetches the ticket + its public comments and applies detectAgentTakeover.
 * On API failure we FAIL-OPEN to false so a transient Zendesk error doesn't
 * permanently mute the bot — but we log it.
 */
async function checkForAgentIntervention(ticketId) {
  try {
    const summary = await getTicketSummary(ticketId);
    const comments = await getPublicTicketComments(ticketId);
    return detectAgentTakeover(comments, summary.requesterId);
  } catch (error) {
    log.warn("agent_intervention_check_failed", { ticketId, message: error.message });
    return { takenOver: false };
  }
}

module.exports = {
  addInternalNote, addTagAndNote, addBotReplyToTicket, addCustomerMessageToTicket,
  checkForAgentIntervention, detectAgentTakeover,
  createChatTicket, fetchAllHelpCenterArticles, getZendeskConfigSummary,
  getPublicTicketComments, getRequesterProfile, getTicketAudits, getTicketSummary,
  ping, replyToTicket, resetHelpCenterCache, searchHelpCenter, searchHelpCenterDetailed,
  searchUsersByEmail,
  setTicketTags, solveTicket, testZendeskTicketAccess, updateConversationState,
  updateRequester, updateTicketRequester,
  uploadAttachments, verifyWebhookToken,
  isHumanHandled, isTicketHumanHandled, HUMAN_OWNED_TAGS,
  listTicketsSince, normalizeIncrementalTicket
};
