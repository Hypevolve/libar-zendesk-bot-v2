/**
 * Libar Zendesk Bot v2 — Main Entry Point
 * (Skill §14 — Production API, §12 — Observability, §21 — Conversation Memory)
 *
 * Endpoints:
 *  POST /api/chat/start    — start webchat session (creates Zendesk ticket)
 *  POST /api/chat/message  — continue webchat session
 *  POST /api/chat/restore  — restore existing session from Zendesk
 *  POST /api/zendesk/webhook — Zendesk webhook receiver
 *  GET  /health             — health check
 *  GET  /admin/traces       — recent AI traces
 *  GET  /admin/metrics      — runtime metrics
 *  POST /admin/sync/vector  — trigger vector knowledge sync
 */
require("dotenv").config();

const express = require("express");
const multer = require("multer");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");

const env = require("./config/env");
const log = require("./config/logger");
const rateLimiter = require("./middleware/rateLimiter");
const { webhookRateLimiter } = rateLimiter;
const inputSanitizerModule = require("./middleware/inputSanitizer");
const inputSanitizer = inputSanitizerModule.middleware;

const aiService = require("./services/aiService");
const knowledgeService = require("./services/knowledgeService");
const vectorKnowledgeService = require("./services/vectorKnowledgeService");
const embeddingService = require("./services/embeddingService");
const zendeskService = require("./services/zendeskService");
const piiService = require("./services/piiService");
const tracingService = require("./services/tracingService");
const metricsService = require("./services/metricsService");
const botStateService = require("./services/botStateService");
const outputValidator = require("./services/outputValidator");
const spamFilterService = require("./services/spamFilterService");
const conversationService = require("./services/conversationService");
const runtimeStore = require("./services/runtimeStore");
const responseCacheService = require("./services/responseCacheService");
const tokenBudget = require("./services/tokenBudgetService");
const { normalizeForComparison } = require("./services/textUtils");
const { buildDirectWebsiteLinks } = require("./services/siteLinkService");
const { detectEscalationIntent } = require("./services/intentEscalationService");

// ─── Express Setup ────────────────────────────────────────────

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.set("trust proxy", true);

const chatUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 5 }
});

// ─── Session Store ────────────────────────────────────────────

const chatSessions = new Map();
let runtimeState = runtimeStore.loadRuntimeState();
let persistTimeout = null;

function scheduleRuntimePersist() {
  if (persistTimeout) return;
  persistTimeout = setTimeout(() => {
    persistTimeout = null;
    runtimeStore.saveRuntimeState({
      ...runtimeState,
      sessions: [...chatSessions.values()].map(serializeSession),
      rateLimits: rateLimiter.getState()
    });
  }, 3000);
}

function serializeSession(s) {
  return {
    sessionId: s.sessionId, ticketId: s.ticketId, requesterId: s.requesterId,
    requesterName: s.requesterName, requesterEmail: s.requesterEmail,
    messages: (s.messages || []).slice(-30),
    conversationState: s.conversationState, entryIntent: s.entryIntent,
    createdAt: s.createdAt, updatedAt: s.updatedAt
  };
}

function createSession(opts) {
  const session = {
    sessionId: crypto.randomUUID(),
    ticketId: opts.ticketId,
    requesterId: opts.requesterId,
    requesterName: opts.requesterName || "",
    requesterEmail: opts.requesterEmail || "",
    messages: opts.messages || [],
    conversationState: { tone: "ai-active", badge: "AI Asistent", subtitle: "" },
    entryIntent: opts.entryIntent || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  chatSessions.set(session.sessionId, session);
  scheduleRuntimePersist();
  return session;
}

function getSession(id) { return chatSessions.get(id) || null; }

function findSessionByTicketId(ticketId) {
  for (const s of chatSessions.values()) { if (s.ticketId === ticketId) return s; }
  return null;
}

function removeSession(id) { chatSessions.delete(id); scheduleRuntimePersist(); }

// Sync webhook messages with in-memory session so /api/chat/restore stays current
function syncWebhookMessageToSession(ticketId, userMessage, botReply) {
  const session = findSessionByTicketId(ticketId);
  if (!session) return;

  const now = new Date().toISOString();
  session.messages.push({ role: "user", content: String(userMessage).slice(0, 2000), ts: now });
  if (botReply) {
    session.messages.push({ role: "assistant", content: String(botReply).slice(0, 2000), ts: now });
  }
  // Trim to memory budget
  if (session.messages.length > 30) {
    session.messages = session.messages.slice(-30);
  }
  session.updatedAt = now;
  scheduleRuntimePersist();
}

// Session cleanup: remove stale sessions older than 24h every 30min
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const SESSION_CLEANUP_INTERVAL_MS = 30 * 60 * 1000;

setInterval(() => {
  const cutoff = Date.now() - SESSION_MAX_AGE_MS;
  let removed = 0;
  for (const [id, session] of chatSessions) {
    const updated = new Date(session.updatedAt || session.createdAt).getTime();
    if (updated < cutoff) {
      chatSessions.delete(id);
      removed++;
    }
  }
  if (removed) {
    log.info("session_cleanup", { removed, remaining: chatSessions.size });
    scheduleRuntimePersist();
  }
}, SESSION_CLEANUP_INTERVAL_MS).unref?.();

// Webhook idempotency: track last processed message per ticket (5min TTL)
const webhookProcessed = new Map();
const WEBHOOK_IDEMPOTENCY_TTL_MS = 5 * 60 * 1000;

function normalizeDedupText(text) {
  return String(text || "")
    .replace(/<[^>]+>/g, " ") // strip HTML
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, 200);
}

function isWebhookDuplicate(ticketId, message, timestamp = null) {
  // Prefer timestamp-based dedup if available (Zendesk trigger can send created_at)
  if (timestamp) {
    const tsKey = `${ticketId}:ts:${String(timestamp).slice(0, 30)}`;
    const tsEntry = webhookProcessed.get(tsKey);
    if (tsEntry && Date.now() - tsEntry.ts < WEBHOOK_IDEMPOTENCY_TTL_MS) {
      return true;
    }
    webhookProcessed.set(tsKey, { ts: Date.now() });
  }

  // Fallback: normalized text hash
  const key = `${ticketId}:${normalizeDedupText(message)}`;
  const entry = webhookProcessed.get(key);
  if (entry && Date.now() - entry.ts < WEBHOOK_IDEMPOTENCY_TTL_MS) {
    return true;
  }
  webhookProcessed.set(key, { ts: Date.now() });

  // Cleanup old entries
  const cutoff = Date.now() - WEBHOOK_IDEMPOTENCY_TTL_MS;
  for (const [k, v] of webhookProcessed) {
    if (v.ts < cutoff) webhookProcessed.delete(k);
  }
  return false;
}

/**
 * Detect whether the customer's latest inbound message carries attachments
 * (images/files) that the bot cannot analyze. Two layers:
 *  1. Inspect the webhook payload itself (cheap) — many Zendesk triggers can be
 *     configured to send an `attachments` count/array or media flags.
 *  2. Fallback to the latest public comment via the Comments API and check its
 *     `attachments` array. The bot only escalates on attachments authored by the
 *     customer (not on its own/agent replies).
 */
async function detectWebhookAttachments(body = {}, ticketId) {
  // Layer 1: webhook payload heuristics (configuration-dependent, best-effort).
  const direct = body.attachments ?? body.attachment ?? body.media ?? body.files;
  if (Array.isArray(direct) && direct.length > 0) return true;
  if (typeof body.attachmentCount === "number" && body.attachmentCount > 0) return true;
  if (typeof body.hasAttachments === "boolean") return body.hasAttachments;

  // Layer 2: authoritative check via the Comments API.
  if (!ticketId) return false;
  let comments = [];
  try {
    comments = await zendeskService.getPublicTicketComments(ticketId);
  } catch {
    return false; // fail-open to text handling; attachment escalation is a best-effort safety net
  }
  if (!comments.length) return false;

  // The most recent public comment is the customer's current message.
  const latest = comments[comments.length - 1];
  const atts = Array.isArray(latest?.attachments) ? latest.attachments : [];
  return atts.length > 0;
}

function normalizeMessage(msg) {
  return String(msg || "").replace(/\s+/g, " ").trim().slice(0, 4000);
}

function buildChatSubject(name) {
  return `Webshop chat: ${name || "Korisnik"}`;
}

function isClosedTicketStatus(status) {
  return ["closed", "solved"].includes(String(status).toLowerCase());
}

// ─── AI Outcome Resolution ───────────────────────────────────

async function resolveAutomatedOutcome(session, userMessage, opts = {}) {
  const start = Date.now();
  metricsService.increment("totalRequests");

  try {
    return await _resolveAutomatedOutcome(session, userMessage, opts);
  } catch (error) {
    log.error("automated_outcome_failed", { message: error.message, stack: error.stack });
    metricsService.recordDecision("escalate_no_answer");
    metricsService.recordLatency(Date.now() - start);
    return {
      knowledge: null,
      outcome: {
        type: "escalate_no_answer",
        customerMessage: "Nažalost, trenutno imam tehničkih poteškoća. Prosljeđujem Vaš upit našem timu koji će Vam se javiti u najkraćem mogućem roku.",
        stateTag: "awaiting_human", reason: "pipeline_error",
        links: [], extraTags: ["ai_escalated"]
      }
    };
  }
}

async function _resolveAutomatedOutcome(session, userMessage, opts = {}) {
  const start = Date.now();

  // ── KILL SWITCH (absolute highest priority) ───────────────────
  // When the bot is globally disabled, generate no AI answer — politely hand the
  // whole conversation to a human. This is the incident-response stop button.
  if (!botStateService.isEnabled()) {
    metricsService.recordDecision("escalate_no_answer");
    metricsService.recordLatency(Date.now() - start);
    metricsService.increment("botDisabledEscalations");
    log.warn("bot_disabled_escalation", { ticketId: session.ticketId });
    return {
      knowledge: null,
      outcome: {
        type: "escalate_no_answer",
        customerMessage: botStateService.PAUSED_MESSAGE,
        stateTag: "awaiting_human", reason: "bot_disabled", links: [], extraTags: ["ai_paused"]
      }
    };
  }

  const { masked: maskedMsg, mappings: piiMappings } = piiService.maskPII(userMessage);

  const conversationSummary = conversationService.buildConversationSummaryForAI(session.messages || []);
  const groundedOpts = {
    channelType: opts.channelType || "web_chat",
    customerName: session.requesterName || "",
    conversationSummary
  };

  const normMsg = normalizeForComparison(userMessage);

  // ── ESCALATION GATES (highest priority) ───────────────────────
  // These run BEFORE reference-facts shortcuts and the response cache so an
  // urgent/complaint/attachment message is never answered from cache or treated
  // as a generic greeting. A human must always see these.

  // Attachment escalation: if the user uploaded images/files, we cannot analyze
  // them, so immediately hand off to a human agent with a reassuring message.
  if (opts.hasAttachments) {
    metricsService.recordDecision("escalate_no_answer");
    metricsService.recordLatency(Date.now() - start);
    return {
      knowledge: null,
      outcome: {
        type: "escalate_no_answer",
        customerMessage: "Hvala na upitu i privitcima! Vaša poruka je zaprimljena i razgovor će biti preusmjeren na našeg agenta koji će se ubrzo javiti.",
        stateTag: "awaiting_human", reason: "user_uploaded_attachments", links: [], extraTags: ["attachment_uploaded"]
      }
    };
  }

  // Intent-based escalation: detect intents that MUST go to a human agent
  // (complaints, returns, legal, damaged items) — never let AI answer these.
  const escalationCheck = detectEscalationIntent(normMsg);
  if (escalationCheck.shouldEscalate) {
    metricsService.recordDecision("escalate_no_answer");
    metricsService.recordLatency(Date.now() - start);
    log.info("intent_escalation", { reason: escalationCheck.reason, intent: escalationCheck.intent });
    return {
      knowledge: null,
      outcome: {
        type: "escalate_no_answer",
        customerMessage: escalationCheck.message,
        stateTag: "awaiting_human", reason: escalationCheck.reason,
        links: buildDirectWebsiteLinks(userMessage, { knowledge: null }),
        extraTags: ["ai_escalated", `intent_${escalationCheck.intent}`]
      }
    };
  }

  // Reference facts check (greetings, canned facts) — only after escalation gates
  const refResult = tryReferenceFacts(normMsg, maskedMsg, groundedOpts);
  if (refResult) {
    metricsService.recordLatency(Date.now() - start);
    return { knowledge: null, outcome: refResult };
  }

  // Response cache check (simple queries only, no conversation history)
  const messageWordCount = maskedMsg.trim().split(/\s+/).filter(Boolean).length;
  const hasHistory = (session.messages || []).length > 2;
  let cacheKey = null;
  if (!hasHistory && messageWordCount <= 12) {
    cacheKey = `${maskedMsg}:${session.entryIntent || ""}:${opts.channelType || "web_chat"}`;
    const cached = responseCacheService.get(cacheKey);
    if (cached) {
      metricsService.recordLatency(Date.now() - start);
      return {
        knowledge: null,
        outcome: {
          type: "safe_answer", customerMessage: cached, stateTag: "ai_active",
          reason: "cache_hit", source: "cache",
          links: buildDirectWebsiteLinks(userMessage, { knowledge: null }), extraTags: []
        }
      };
    }
  }

  // Global token budget gate: if estimated total pipeline cost exceeds 80% of input budget,
  // skip non-essential LLM calls (rewrite, relevance grading).
  const estimatedRewrite = hasHistory || messageWordCount > 6 ? 250 : 0;
  const estimatedGrade = 180;
  const estimatedGenerate = tokenBudget.estimateTokens(maskedMsg) + 900;
  const estimatedFallback = tokenBudget.estimateTokens(maskedMsg) + 700;
  const totalEstimate = estimatedRewrite + estimatedGrade + estimatedGenerate + estimatedFallback;
  const skipNonEssential = totalEstimate > Math.floor(tokenBudget.MAX_INPUT * 0.8);
  if (skipNonEssential) {
    log.warn("token_budget_gate_skipping_nonessential", { estimated: totalEstimate, limit: tokenBudget.MAX_INPUT });
  }

  // Knowledge search with optional query rewrite
  let rewrittenQuery = maskedMsg;
  if (!skipNonEssential && (hasHistory || messageWordCount > 6)) {
    try {
      const recentMessages = conversationService.getRecentMessagesForAI(session.messages || []);
      rewrittenQuery = await aiService.rewriteStandaloneQuery(maskedMsg, recentMessages) || maskedMsg;
    } catch (err) {
      log.warn("query_rewrite_failed", { message: err.message });
      rewrittenQuery = maskedMsg;
    }
  }

  let knowledge = await knowledgeService.searchKnowledgeDetailed(rewrittenQuery || maskedMsg, {
    taskIntent: session.entryIntent,
    conversationTerms: conversationService.extractConversationTerms(session.messages)
  });

  // Fallback: if no results and this is a follow-up, combine previous user query with current one
  if (!knowledge?.context && hasHistory) {
    const userMsgs = (session.messages || []).filter((m) => m.role === "user");
    const prevQuery = userMsgs.length >= 2 ? String(userMsgs[userMsgs.length - 2].content || "").trim() : "";
    if (prevQuery && prevQuery !== maskedMsg) {
      const combinedQuery = `${prevQuery} ${maskedMsg}`.trim();
      log.info("knowledge_fallback_combined_query", { original: rewrittenQuery || maskedMsg, combined: combinedQuery });
      knowledge = await knowledgeService.searchKnowledgeDetailed(combinedQuery, {
        taskIntent: session.entryIntent,
        conversationTerms: conversationService.extractConversationTerms(session.messages)
      });
    }
  }

  let customerMessage = null;

  if (knowledge?.context) {
    // Skip relevance grading if hybrid confidence is already high
    let relevance = { relevant: true, reason: "high_confidence" };
    const topConfidence = knowledge.topConfidence || 0;
    const isFollowUp = hasHistory && messageWordCount <= 6;
    if (!skipNonEssential && topConfidence < 0.72 && !isFollowUp) {
      relevance = await aiService.gradeContextRelevance(maskedMsg, knowledge.context, {
        conversationSummary: conversationService.buildConversationSummaryForAI(session.messages || [])
      });
    }

    if (relevance.relevant) {
      // Enrich vector chunks with canonical reference facts so the LLM always
      // has access to core business rules even when chunks are incomplete.
      customerMessage = await aiService.generateGroundedAnswer(maskedMsg, knowledge.context, groundedOpts);

      if (customerMessage) {
        const norm = normalizeForComparison(customerMessage);
        if (/(ne mogu|nisam siguran|nemam informacij|pouzdano potvrditi)/.test(norm)) {
          customerMessage = null;
        }
      }

      if (customerMessage) {
        const validation = outputValidator.validateAnswerQuality(customerMessage, { knowledgeContext: knowledge.context, userMessage: maskedMsg });
        if (!validation.valid) {
          log.warn("output_validation_failed", { reason: validation.reason });
          customerMessage = null;
        }
        const piiFound = piiService.detectPII(customerMessage);
        if (piiFound.length) {
          log.warn("pii_in_output", { types: piiFound.map((p) => p.type) });
        }
      }
    } else {
      log.info("context_relevance_rejected", { reason: relevance.reason });
    }
  }

  // Fallback: reference facts grounded answer
  if (!customerMessage) {
    const fallbackAnswer = await aiService.generateGroundedAnswer(maskedMsg, aiService.REFERENTNE_CINJENICE, groundedOpts);
    if (fallbackAnswer) {
      const norm = normalizeForComparison(fallbackAnswer);
      const uncertain = /(ne mogu|nisam siguran|nemam informacij|pouzdano potvrditi)/.test(norm);
      if (!uncertain) {
        // Apply the SAME quality validation as the knowledge path. The fallback is
        // grounded in REFERENTNE_CINJENICE, so validate against those facts —
        // otherwise a hallucinated price/term could slip through unchecked.
        const fbValidation = outputValidator.validateAnswerQuality(fallbackAnswer, {
          knowledgeContext: aiService.REFERENTNE_CINJENICE,
          userMessage: maskedMsg
        });
        if (fbValidation.valid) {
          customerMessage = fallbackAnswer;
        } else {
          log.warn("fallback_validation_failed", { reason: fbValidation.reason });
        }
      }
    }
  }

  // Cache the successful answer for future identical queries
  if (customerMessage && cacheKey) {
    responseCacheService.set(cacheKey, customerMessage);
  }

  const links = buildDirectWebsiteLinks(userMessage, { knowledge });

  const outcome = customerMessage
    ? {
        type: "safe_answer", customerMessage, stateTag: "ai_active",
        reason: "grounded_answer", source: knowledge ? "knowledge" : "reference_facts",
        links, extraTags: []
      }
    : {
        type: "escalate_no_answer",
        customerMessage: "Hvala na pitanju! Proslijedit ću vaš upit našem timu koji će vam se javiti.",
        stateTag: "awaiting_human", reason: "no_grounded_answer",
        links, extraTags: ["ai_escalated"]
      };

  metricsService.recordDecision(outcome.type);
  metricsService.recordLatency(Date.now() - start);

  tracingService.createTrace({
    input: maskedMsg,
    llmOutput: outcome.customerMessage,
    decision: outcome.type,
    retrieval: knowledge ? { source: knowledge.primarySource, topScore: knowledge.topScore, articleCount: knowledge.totalMatches } : null,
    latencyMs: Date.now() - start
  });

  return { knowledge, outcome };
}

function tryReferenceFacts(normMsg, maskedMsg, groundedOpts) {
  if (/^(hvala|pozdrav|dobar dan|dobro jutro|dobro vece|zdravo|bok|cao|halo)[.!?\s]*$/.test(normMsg)) {
    return {
      type: "safe_answer",
      customerMessage: "Pozdrav! Dobrodošli u Antikvarijat Libar. Kako vam mogu pomoći?",
      stateTag: "ai_active", reason: "greeting", extraTags: []
    };
  }
  return null;
}

// ─── POST /api/chat/start ─────────────────────────────────────

app.post("/api/chat/start", rateLimiter, inputSanitizer, chatUpload.array("attachments", 5), async (req, res) => {
  const { name, email, message: rawMessage, entryIntent } = req.body || {};
  const message = normalizeMessage(rawMessage);
  const files = req.files || [];

  if (!message || !email) {
    return res.status(400).json({ success: false, error: "message and email are required." });
  }

  try {
    metricsService.increment("totalChatStarts");

    let uploadTokens = [];
    if (files.length) {
      try {
        const uploads = await zendeskService.uploadAttachments(files);
        uploadTokens = uploads.map((u) => u.token).filter(Boolean);
      } catch (err) {
        return res.status(503).json({ success: false, error: "Privitke trenutno ne možemo obraditi." });
      }
    }

    const { ticketId, requesterId } = await zendeskService.createChatTicket({
      requesterName: name || "Korisnik",
      requesterEmail: email,
      initialMessage: message,
      subject: buildChatSubject(name),
      uploadTokens
    });

    const session = createSession({
      ticketId, requesterId,
      requesterName: name || "Korisnik",
      requesterEmail: email,
      entryIntent: entryIntent || null
    });

    const { knowledge, outcome } = await resolveAutomatedOutcome(session, message, { hasAttachments: files.length > 0, channelType: "web_chat" });

    if (files.length) {
      await zendeskService.addTagAndNote(ticketId, "hitno_slike", "Korisnik je poslao privitke. Potrebna ljudska provjera.");
    }

    if (outcome.type !== "safe_answer") {
      await zendeskService.addInternalNote(ticketId, `[ESKALACIJA] ${outcome.reason}`);
    }

    try {
      await zendeskService.updateConversationState(ticketId, outcome.stateTag, outcome.extraTags || []);
      await zendeskService.addBotReplyToTicket(ticketId, outcome.customerMessage, { channelType: "web_chat" });
    } catch (err) {
      log.warn("zendesk_write_degraded", { ticketId, message: err.message });
    }

    session.messages.push(
      { role: "user", content: message, ts: new Date().toISOString() },
      { role: "assistant", content: outcome.customerMessage, ts: new Date().toISOString() }
    );
    session.updatedAt = new Date().toISOString();
    scheduleRuntimePersist();

    return res.status(200).json({
      success: true, sessionId: session.sessionId, ticketId,
      session: serializeSession(session),
      messages: session.messages,
      conversationState: session.conversationState,
      links: outcome.links || [],
      retrieval: knowledge ? { topScore: knowledge.topScore, source: knowledge.primarySource, articleCount: knowledge.totalMatches } : null
    });
  } catch (error) {
    log.error("chat_start_failed", { message: error.message, stack: error.stack });
    return res.status(500).json({ success: false, error: "Unable to start chat session." });
  }
});

// ─── POST /api/chat/message ───────────────────────────────────

app.post("/api/chat/message", rateLimiter, inputSanitizer, chatUpload.array("attachments", 5), async (req, res) => {
  const { sessionId } = req.body || {};
  const message = normalizeMessage(req.body?.message);
  const files = req.files || [];
  const session = getSession(sessionId);

  if (!session) return res.status(404).json({ success: false, error: "Chat session not found." });
  if (!message && !files.length) return res.status(400).json({ success: false, error: "Message or attachment required." });

  try {
    metricsService.increment("totalChatMessages");

    let ticketSummary;
    try { ticketSummary = await zendeskService.getTicketSummary(session.ticketId); }
    catch (err) { return res.status(503).json({ success: false, error: "Zendesk privremeno nije dostupan." }); }

    if (isClosedTicketStatus(ticketSummary.status)) {
      return res.status(409).json({
        success: false,
        error: "Prethodni razgovor je završen. Za novo pitanje pokrenite novi razgovor.",
        conversationState: { tone: "resolved", badge: "Razgovor završen" }
      });
    }

    let uploadTokens = [];
    if (files.length) {
      try {
        const uploads = await zendeskService.uploadAttachments(files);
        uploadTokens = uploads.map((u) => u.token).filter(Boolean);
      } catch (err) {
        return res.status(503).json({ success: false, error: "Privitke trenutno ne možemo obraditi." });
      }
    }

    await zendeskService.addCustomerMessageToTicket(
      session.ticketId, session.requesterId, message || "Šaljem privitak.", uploadTokens
    );

    session.messages.push({ role: "user", content: message || "Šaljem privitak.", ts: new Date().toISOString() });

    // Human-active pass-through
    if (session.conversationState?.tone === "human-active") {
      session.updatedAt = new Date().toISOString();
      scheduleRuntimePersist();
      return res.status(200).json({
        success: true, ticketId: session.ticketId,
        messages: session.messages, conversationState: session.conversationState
      });
    }

    const { knowledge, outcome } = await resolveAutomatedOutcome(session, message || "Šaljem privitak.", {
      hasAttachments: files.length > 0, channelType: "web_chat"
    });

    if (files.length) {
      await zendeskService.addTagAndNote(session.ticketId, "hitno_slike", "Korisnik je poslao privitke.");
    }

    if (outcome.type !== "safe_answer") {
      await zendeskService.addInternalNote(session.ticketId, `[ESKALACIJA] ${outcome.reason}`);
    }

    try {
      await zendeskService.updateConversationState(session.ticketId, outcome.stateTag, outcome.extraTags || []);
      await zendeskService.addBotReplyToTicket(session.ticketId, outcome.customerMessage, { channelType: "web_chat" });
    } catch (err) {
      log.warn("zendesk_write_degraded", { ticketId: session.ticketId, message: err.message });
    }

    session.messages.push({ role: "assistant", content: outcome.customerMessage, ts: new Date().toISOString() });
    session.updatedAt = new Date().toISOString();
    scheduleRuntimePersist();

    return res.status(200).json({
      success: true, ticketId: session.ticketId,
      messages: session.messages, conversationState: session.conversationState,
      links: outcome.links || []
    });
  } catch (error) {
    log.error("chat_message_failed", { sessionId, message: error.message, stack: error.stack });
    return res.status(500).json({ success: false, error: "Unable to process message." });
  }
});

// ─── POST /api/chat/restore ──────────────────────────────────

app.post("/api/chat/restore", async (req, res) => {
  const { ticketId, requesterId, requesterName, requesterEmail } = req.body || {};
  if (!ticketId || !requesterId) {
    return res.status(400).json({ success: false, error: "ticketId and requesterId are required." });
  }

  try {
    const existing = findSessionByTicketId(ticketId);
    let ticketSummary, audits;

    try {
      [audits, ticketSummary] = await Promise.all([
        zendeskService.getTicketAudits(ticketId),
        zendeskService.getTicketSummary(ticketId)
      ]);
    } catch (err) {
      if (existing) return res.status(200).json({ success: true, restored: true, degraded: true, mode: "active_session", session: existing });
      return res.status(503).json({ success: false, error: "Zendesk privremeno nije dostupan." });
    }

    const restoredMessages = mapAuditsToMessages(audits, requesterId, ticketSummary);

    if (isClosedTicketStatus(ticketSummary.status)) {
      if (existing) removeSession(existing.sessionId);
      return res.status(200).json({ success: true, restored: true, mode: "closed_session", messages: restoredMessages });
    }

    if (existing) {
      existing.messages = restoredMessages;
      existing.requesterName = ticketSummary.requesterName || existing.requesterName;
      existing.requesterEmail = ticketSummary.requesterEmail || existing.requesterEmail;
      existing.updatedAt = new Date().toISOString();
      scheduleRuntimePersist();
      return res.status(200).json({ success: true, restored: true, mode: "active_session", session: existing });
    }

    const session = createSession({
      ticketId, requesterId,
      requesterName: ticketSummary.requesterName || requesterName || "",
      requesterEmail: ticketSummary.requesterEmail || requesterEmail || "",
      messages: restoredMessages
    });
    return res.status(200).json({ success: true, restored: true, mode: "active_session", session });
  } catch (error) {
    log.error("chat_restore_failed", { ticketId, message: error.message });
    return res.status(500).json({ success: false, error: "Unable to restore chat session." });
  }
});

function mapAuditsToMessages(audits = [], requesterId, ticketSummary) {
  const messages = [];
  for (const audit of audits) {
    for (const event of (audit.events || [])) {
      if (event.type !== "Comment" || !event.body) continue;
      if (event.public === false) continue;
      const role = String(event.author_id) === String(requesterId) ? "user" : "assistant";
      messages.push({ role, content: event.body, ts: audit.created_at });
    }
  }
  return messages;
}

// ─── POST /api/zendesk/webhook ────────────────────────────────

app.post("/api/zendesk/webhook", webhookRateLimiter, async (req, res) => {
  const token = req.headers["x-zendesk-webhook-token"] || req.body?.token;
  if (!zendeskService.verifyWebhookToken(token)) {
    return res.status(401).json({ success: false, error: "Invalid webhook token." });
  }

  metricsService.increment("totalWebhooks");

  const { ticketId, channelType, latestMessage, timestamp: webhookTimestamp } = req.body || {};
  if (!ticketId) return res.status(400).json({ success: false, error: "ticketId required." });

  // Idempotency: skip duplicate webhook deliveries for the same message
  if (latestMessage && isWebhookDuplicate(ticketId, latestMessage, webhookTimestamp)) {
    log.info("webhook_duplicate_skipped", { ticketId });
    return res.status(200).json({ success: true, duplicate: true });
  }

  // Human-takeover guard: if an agent has taken over (human_active / awaiting_human)
  // or the ticket is resolved, the bot stays silent so it never talks over an agent.
  if (latestMessage) {
    const handoff = await zendeskService.isTicketHumanHandled(ticketId);
    if (handoff.handled) {
      log.info("webhook_skipped_human_handled", { ticketId, tags: handoff.tags });
      metricsService.increment("webhooksSkippedHumanHandled");
      return res.status(200).json({ success: true, skipped: "human_handled" });
    }
  }

  // Agent-intervention guard: checks the actual latest comment author.
  // Catches cases where an agent replied but forgot to update tags.
  if (latestMessage) {
    const agentCheck = await zendeskService.checkForAgentIntervention(ticketId);
    if (agentCheck.takenOver) {
      log.info("webhook_skipped_agent_intervention", { ticketId, reason: agentCheck.reason });
      metricsService.increment("agentTakeoversSkipped");
      await zendeskService.updateConversationState(ticketId, "human_active", ["agent_detected"]);
      return res.status(200).json({ success: true, skipped: "agent_took_over" });
    }
  }

  try {
    const normalizedChannel = aiService.normalizeChannelType(channelType || "email");

    // Spam filter for email
    if (normalizedChannel === "email" && latestMessage) {
      const ticketSummary = await zendeskService.getTicketSummary(ticketId);
      const spam = await spamFilterService.evaluateIncomingMessage({ channelType: normalizedChannel, message: latestMessage, ticketSummary });
      if (spam.shouldBlock) {
        await zendeskService.addInternalNote(ticketId, spamFilterService.buildSpamFilterNote(spam, normalizedChannel), ["spam_blocked"]);
        return res.status(200).json({ success: true, blocked: true, reason: spam.reason });
      }
    }

    // Auto-reply for webhook tickets
    if (latestMessage) {
      // Input sanitization for webhook messages
      const sanitized = inputSanitizerModule.check(latestMessage);
      if (!sanitized.safe) {
        log.warn("webhook_input_blocked", { ticketId, reason: sanitized.reason });
        return res.status(200).json({ success: true, blocked: true, reason: "injection_detected" });
      }
      const cleanMessage = inputSanitizerModule.clean(latestMessage);

      // Mask PII BEFORE it reaches the LLM or knowledge search (parity with the
      // web-chat path). The model only ever sees masked tokens; we unmask the
      // final answer just before it goes back to the customer.
      const { masked: maskedMsg, mappings: piiMappings } = piiService.maskPII(cleanMessage);

      // Intent-based escalation check (before any LLM calls)
      const normWebhookMsg = normalizeForComparison(cleanMessage);
      const webhookEscalation = detectEscalationIntent(normWebhookMsg);
      if (webhookEscalation.shouldEscalate) {
        await zendeskService.addBotReplyToTicket(ticketId, webhookEscalation.message, { channelType: normalizedChannel });
        await zendeskService.updateConversationState(ticketId, "awaiting_human", ["ai_escalated", `intent_${webhookEscalation.intent}`]);
        log.info("webhook_intent_escalation", { ticketId, intent: webhookEscalation.intent });
        return res.status(200).json({ success: true, escalated: true, reason: webhookEscalation.reason });
      }

      // Attachment escalation: the bot cannot analyze images/files. If the customer's
      // latest message carries attachments (sent via Facebook, email or web form into
      // Zendesk), hand off to a human immediately — parity with the web-chat path.
      let hasAttachments = false;
      try {
        hasAttachments = await detectWebhookAttachments(req.body, ticketId);
      } catch (err) {
        log.warn("webhook_attachment_check_failed", { ticketId, message: err.message });
      }
      if (hasAttachments) {
        const attachmentReply = "Hvala na upitu i privitcima! Vaša poruka je zaprimljena i razgovor će biti preusmjeren na našeg agenta koji će se ubrzo javiti.";
        await zendeskService.addBotReplyToTicket(ticketId, attachmentReply, { channelType: normalizedChannel });
        await zendeskService.updateConversationState(ticketId, "awaiting_human", ["ai_escalated", "attachment_uploaded"]);
        log.info("webhook_attachment_escalation", { ticketId });
        return res.status(200).json({ success: true, escalated: true, reason: "user_uploaded_attachments" });
      }

      // Fetch conversation history for multi-turn context
      let conversationSummary = "";
      try {
        const comments = await zendeskService.getPublicTicketComments(ticketId);
        if (comments.length > 1) {
          const recent = comments.slice(-6, -1); // exclude the latest (current) message
          conversationSummary = recent.map(c => {
            const role = c.author_id ? "Korisnik" : "Asistent";
            return `${role}: ${String(c.body || "").slice(0, 200)}`;
          }).join("\n");
        }
      } catch (err) {
        log.warn("webhook_history_fetch_failed", { ticketId, message: err.message });
      }

      const knowledge = await knowledgeService.searchKnowledgeDetailed(maskedMsg);
      let answer = null;

      if (knowledge?.context) {
        const relevance = await aiService.gradeContextRelevance(maskedMsg, knowledge.context);
        if (relevance.relevant) {
          answer = await aiService.generateGroundedAnswer(maskedMsg, knowledge.context, { channelType: normalizedChannel, conversationSummary });
        }
      }

      if (!answer) {
        answer = await aiService.generateGroundedAnswer(maskedMsg, aiService.REFERENTNE_CINJENICE, { channelType: normalizedChannel, conversationSummary });
        if (answer) {
          const norm = normalizeForComparison(answer);
          if (/(ne mogu|nisam siguran|nemam informacij|pouzdano potvrditi)/.test(norm)) answer = null;
        }
      }

      if (answer) {
        const validation = outputValidator.validateAnswerQuality(answer, { knowledgeContext: knowledge?.context || "", userMessage: maskedMsg });
        if (validation.valid) {
          // Race-condition guard: re-check if an agent commented while we were generating.
          const raceCheck = await zendeskService.checkForAgentIntervention(ticketId);
          if (raceCheck.takenOver) {
            log.info("webhook_race_condition_agent", { ticketId, reason: raceCheck.reason });
            metricsService.increment("agentTakeoversSkipped");
            await zendeskService.updateConversationState(ticketId, "human_active", ["agent_detected_race"]);
            return res.status(200).json({ success: true, skipped: "agent_took_over_race" });
          }

          // Restore any masked PII (e.g. customer's own order email) before replying.
          const finalAnswer = piiService.unmaskPII(answer, piiMappings);
          await zendeskService.addBotReplyToTicket(ticketId, finalAnswer, { channelType: normalizedChannel });
          await zendeskService.updateConversationState(ticketId, "ai_active", ["ai_replied"]);
        } else {
          await zendeskService.updateConversationState(ticketId, "awaiting_human", ["ai_escalated"]);
          await zendeskService.addInternalNote(ticketId, `AI output validation failed: ${validation.reason}`);
        }
      } else {
        await zendeskService.updateConversationState(ticketId, "awaiting_human", ["ai_escalated"]);
        await zendeskService.addInternalNote(ticketId, "AI nije mogao generirati pouzdan odgovor. Eskalacija na tim.");
      }

      // Sync with in-memory session so /api/chat/restore returns current state
      syncWebhookMessageToSession(ticketId, latestMessage, answer || null);
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    log.error("webhook_failed", { ticketId, message: error.message });
    return res.status(200).json({ success: true, error: error.message });
  }
});

// ─── GET / (Web Chat Widget) ────────────────────────────────

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ─── GET /health ──────────────────────────────────────────────

app.get("/health", async (req, res) => {
  const checks = { zendesk: false, vector: false, embedding: false };
  const details = {};

  try {
    const zendeskPing = await zendeskService.ping();
    checks.zendesk = zendeskPing.ok;
    details.zendesk = zendeskPing.ok ? "reachable" : (zendeskPing.error || "unreachable");
  } catch (err) { details.zendesk = err.message; }

  try {
    const vectorPing = await vectorKnowledgeService.ping();
    checks.vector = vectorPing.ok;
    details.vector = vectorPing.ok ? "reachable" : (vectorPing.error || "unreachable");
  } catch (err) { details.vector = err.message; }

  try {
    const embedPing = embeddingService.ping();
    checks.embedding = embedPing.ok;
    details.embedding = embedPing.ok ? "configured" : "not_configured";
  } catch (err) { details.embedding = err.message; }

  const allOk = checks.zendesk && checks.vector && checks.embedding;
  const anyOk = checks.zendesk || checks.vector || checks.embedding;
  const status = allOk ? "ok" : (anyOk ? "degraded" : "down");
  // Return 200 for ok/degraded so Render doesn't restart the app on temporary dependency issues.
  // Only return 503 if the app itself is completely down.
  const code = status === "down" ? 503 : 200;

  res.status(code).json({
    success: status !== "down", status,
    checks, details,
    vectorConfig: vectorKnowledgeService.getVectorConfigSummary?.() || {},
    activeSessions: chatSessions.size,
    uptime: Math.floor(process.uptime())
  });
});

// ─── Admin Endpoints ──────────────────────────────────────────

function requireAdmin(req, res, next) {
  const token = req.headers["x-admin-token"] || req.query.token;
  if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) {
    return res.status(401).json({ success: false, error: "Admin token required." });
  }
  next();
}

app.get("/admin/traces", requireAdmin, (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  res.json({ success: true, traces: tracingService.getRecentTraces(limit), stats: tracingService.getTraceStats() });
});

app.get("/admin/metrics", requireAdmin, (req, res) => {
  res.json({ success: true, metrics: metricsService.getMetrics() });
});

// Kill switch: read current state and toggle the bot on/off at runtime (no redeploy).
app.get("/admin/bot-state", requireAdmin, (req, res) => {
  res.json({ success: true, ...botStateService.getState() });
});

app.post("/admin/bot-state", requireAdmin, (req, res) => {
  const desired = req.body?.enabled;
  if (typeof desired !== "boolean") {
    return res.status(400).json({ success: false, error: "Body must include boolean 'enabled'." });
  }
  const state = botStateService.setEnabled(desired, "admin");
  log.warn("bot_state_toggled", { enabled: state.enabled });
  res.json({ success: true, ...state });
});

app.post("/admin/sync/vector", requireAdmin, async (req, res) => {
  try {
    const result = await knowledgeService.syncVectorKnowledgeFromOneDrive({ force: req.body?.force === true });
    res.json({ success: true, result });
  } catch (error) {
    log.error("vector_sync_failed", { message: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

// Admin Dashboard HTML UI (public — auth handled by JS API calls)
app.get("/admin/dashboard", (req, res) => {
  const dashboardPath = path.join(__dirname, "admin-dashboard.html");
  try {
    const html = fs.readFileSync(dashboardPath, "utf8");
    res.setHeader("Content-Type", "text/html");
    res.send(html);
  } catch (error) {
    res.status(500).json({ success: false, error: "Dashboard file not found." });
  }
});

// ─── Vector Knowledge Auto-Sync ───────────────────────────────

const VECTOR_SYNC_INTERVAL_MS = env.VECTOR_AUTO_SYNC_INTERVAL_MS || 1800000;

async function runVectorSync() {
  try {
    const result = await knowledgeService.syncVectorKnowledgeFromOneDrive();
    log.info("vector_sync_complete", {
      indexed: result.indexedDocuments, skipped: result.skippedDocuments,
      deleted: result.deletedDocuments, errors: result.errors?.length || 0
    });
  } catch (err) {
    log.error("vector_sync_error", { message: err.message });
  }
}

// ─── Static Widget ────────────────────────────────────────────

app.use("/widget", express.static("public"));

// ─── Server Startup ───────────────────────────────────────────

const PORT = env.PORT;

const server = app.listen(PORT, () => {
  log.info("server_started", { port: PORT });

  // Restore persisted sessions
  for (const s of runtimeState.sessions || []) {
    if (s.sessionId && s.ticketId) chatSessions.set(s.sessionId, s);
  }
  log.info("sessions_restored", { count: chatSessions.size });

  // Restore rate limit state
  if (runtimeState.rateLimits) {
    rateLimiter.load(runtimeState.rateLimits);
  }

  // Schedule vector sync
  setTimeout(runVectorSync, 10000);
  setInterval(runVectorSync, VECTOR_SYNC_INTERVAL_MS);
});

function gracefulShutdown(signal) {
  log.info("graceful_shutdown", { signal });
  runtimeStore.saveRuntimeState({
    ...runtimeState,
    sessions: [...chatSessions.values()].map(serializeSession),
    rateLimits: rateLimiter.getState()
  });
  server.close(() => {
    log.info("server_closed");
    process.exit(0);
  });
  setTimeout(() => {
    log.error("forced_shutdown");
    process.exit(1);
  }, 10000);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

process.on("uncaughtException", (err) => {
  log.error("uncaught_exception", { message: err.message, stack: err.stack });
  try {
    runtimeStore.saveRuntimeState({
      ...runtimeState,
      sessions: [...chatSessions.values()].map(serializeSession),
      rateLimits: rateLimiter.getState()
    });
  } catch (_) { /* best effort */ }
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  log.error("unhandled_rejection", { message: String(reason?.message || reason), stack: reason?.stack });
});

module.exports = app;
