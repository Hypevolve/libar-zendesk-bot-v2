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

const env = require("./config/env");
const log = require("./config/logger");
const rateLimiter = require("./middleware/rateLimiter");
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
const outputValidator = require("./services/outputValidator");
const spamFilterService = require("./services/spamFilterService");
const conversationService = require("./services/conversationService");
const runtimeStore = require("./services/runtimeStore");
const responseCacheService = require("./services/responseCacheService");
const tokenBudget = require("./services/tokenBudgetService");
const { normalizeForComparison } = require("./services/textUtils");
const { buildDirectWebsiteLinks } = require("./services/siteLinkService");

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

function isWebhookDuplicate(ticketId, message) {
  const key = `${ticketId}:${String(message).slice(0, 200)}`;
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

// ─── Helpers ──────────────────────────────────────────────────

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

  const { masked: maskedMsg, mappings: piiMappings } = piiService.maskPII(userMessage);

  const conversationSummary = conversationService.buildConversationSummaryForAI(session.messages || []);
  const groundedOpts = {
    channelType: opts.channelType || "web_chat",
    customerName: session.requesterName || "",
    conversationSummary
  };

  // Reference facts check first
  const normMsg = normalizeForComparison(userMessage);
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

  // Attachment escalation: if user uploaded images/files, we cannot analyze them,
  // so immediately hand off to a human agent with a reassuring message.
  if (opts.hasAttachments) {
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

  const knowledge = await knowledgeService.searchKnowledgeDetailed(rewrittenQuery || maskedMsg, {
    taskIntent: session.entryIntent,
    conversationTerms: conversationService.extractConversationTerms(session.messages)
  });

  let customerMessage = null;

  if (knowledge?.context) {
    // Skip relevance grading if hybrid confidence is already high
    let relevance = { relevant: true, reason: "high_confidence" };
    const topConfidence = knowledge.topConfidence || 0;
    if (!skipNonEssential && topConfidence < 0.72) {
      relevance = await aiService.gradeContextRelevance(maskedMsg, knowledge.context);
    }

    if (relevance.relevant) {
      // Enrich vector chunks with canonical reference facts so the LLM always
      // has access to core business rules even when chunks are incomplete.
      const enrichedContext = `${aiService.REFERENTNE_CINJENICE}\n\n--- RELEVANTNI DOKUMENTI ---\n\n${knowledge.context}`;
      customerMessage = await aiService.generateGroundedAnswer(maskedMsg, enrichedContext, groundedOpts);

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
      if (!/(ne mogu|nisam siguran|nemam informacij|pouzdano potvrditi)/.test(norm)) {
        customerMessage = fallbackAnswer;
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
        customerMessage: "Hvala na pitanju! Nažalost, nemam dovoljno informacija da vam odgovorim. Proslijedit ću vaš upit našem timu koji će vam se javiti.",
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

// ─── Intent Escalation ───────────────────────────────────────

const ESCALATION_INTENTS = [
  {
    intent: "complaint_damaged",
    patterns: [/ostecen[aeiou]?\b/, /pokidan[aeiou]?\b/, /slomlj/, /razderen/, /otrgnu/, /defekt/, /nedostaje stranica/, /kriv[aeiou]? knjig/],
    message: "Žao nam je što ste imali problema! Vaš slučaj prosljeđujemo našem timu koji će Vam se javiti u najkraćem roku s rješenjem."
  },
  {
    intent: "return_refund",
    patterns: [/povrat novca/, /vrati(te)? novac/, /refund/, /reklamacij[aeiou]/, /povrat (robe|knjig)/, /vracam/, /vratit cu/],
    message: "Razumijemo Vaš zahtjev. Prosljeđujemo Vas našem timu za reklamacije koji će Vam se javiti s detaljima postupka."
  },
  {
    intent: "wrong_order",
    patterns: [/kriv[aeiou]? narudzb/, /pogresn[aeiou]? (knjig|artikl|narudzb)/, /poslali ste (mi )?krivo/, /nije ono sto sam narucio/, /dobio sam kriv/],
    message: "Žao nam je zbog neugodnosti! Vaš upit o pogrešnoj pošiljci prosljeđujemo timu koji će Vam se javiti s rješenjem."
  },
  {
    intent: "legal_threat",
    patterns: [/odvjetnik/, /tuzb[aeiou]/, /tuzit cu/, /pravni/, /sud\b/, /inspekcij/, /zakon o zastit/, /prigovor/, /potrosac/],
    message: "Vaš upit smo zabilježili. Naš tim će Vam se javiti u najkraćem roku."
  },
  {
    intent: "urgent_problem",
    patterns: [/hitno/, /urgentno/, /odmah/, /vec (dva|tri|cetiri|pet|sest) (dana|tjedn)/, /ne javljate se/, /ne odgovarate/, /cekam odgovor/],
    message: "Razumijemo hitnost Vašeg upita. Prosljeđujemo Vas našem timu koji će Vam se javiti u najkraćem mogućem roku."
  }
];

function detectEscalationIntent(normMsg) {
  for (const { intent, patterns, message } of ESCALATION_INTENTS) {
    for (const pattern of patterns) {
      if (pattern.test(normMsg)) {
        return { shouldEscalate: true, intent, reason: `intent_${intent}`, message };
      }
    }
  }
  return { shouldEscalate: false };
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

app.post("/api/zendesk/webhook", async (req, res) => {
  const token = req.headers["x-zendesk-webhook-token"] || req.body?.token;
  if (!zendeskService.verifyWebhookToken(token)) {
    return res.status(401).json({ success: false, error: "Invalid webhook token." });
  }

  metricsService.increment("totalWebhooks");

  const { ticketId, channelType, latestMessage } = req.body || {};
  if (!ticketId) return res.status(400).json({ success: false, error: "ticketId required." });

  // Idempotency: skip duplicate webhook deliveries for the same message
  if (latestMessage && isWebhookDuplicate(ticketId, latestMessage)) {
    log.info("webhook_duplicate_skipped", { ticketId });
    return res.status(200).json({ success: true, duplicate: true });
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

      // Intent-based escalation check (before any LLM calls)
      const normWebhookMsg = normalizeForComparison(cleanMessage);
      const webhookEscalation = detectEscalationIntent(normWebhookMsg);
      if (webhookEscalation.shouldEscalate) {
        await zendeskService.addBotReplyToTicket(ticketId, webhookEscalation.message, { channelType: normalizedChannel });
        await zendeskService.updateConversationState(ticketId, "awaiting_human", ["ai_escalated", `intent_${webhookEscalation.intent}`]);
        log.info("webhook_intent_escalation", { ticketId, intent: webhookEscalation.intent });
        return res.status(200).json({ success: true, escalated: true, reason: webhookEscalation.reason });
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

      const knowledge = await knowledgeService.searchKnowledgeDetailed(cleanMessage);
      let answer = null;

      if (knowledge?.context) {
        const relevance = await aiService.gradeContextRelevance(cleanMessage, knowledge.context);
        if (relevance.relevant) {
          const enrichedContext = `${aiService.REFERENTNE_CINJENICE}\n\n--- RELEVANTNI DOKUMENTI ---\n\n${knowledge.context}`;
          answer = await aiService.generateGroundedAnswer(cleanMessage, enrichedContext, { channelType: normalizedChannel, conversationSummary });
        }
      }

      if (!answer) {
        answer = await aiService.generateGroundedAnswer(cleanMessage, aiService.REFERENTNE_CINJENICE, { channelType: normalizedChannel, conversationSummary });
        if (answer) {
          const norm = normalizeForComparison(answer);
          if (/(ne mogu|nisam siguran|nemam informacij|pouzdano potvrditi)/.test(norm)) answer = null;
        }
      }

      if (answer) {
        const validation = outputValidator.validateAnswerQuality(answer, { knowledgeContext: knowledge?.context || "", userMessage: cleanMessage });
        if (validation.valid) {
          await zendeskService.addBotReplyToTicket(ticketId, answer, { channelType: normalizedChannel });
          await zendeskService.updateConversationState(ticketId, "ai_active", ["ai_replied"]);
        } else {
          await zendeskService.updateConversationState(ticketId, "awaiting_human", ["ai_escalated"]);
          await zendeskService.addInternalNote(ticketId, `AI output validation failed: ${validation.reason}`);
        }
      } else {
        await zendeskService.updateConversationState(ticketId, "awaiting_human", ["ai_escalated"]);
        await zendeskService.addInternalNote(ticketId, "AI nije mogao generirati pouzdan odgovor. Eskalacija na tim.");
      }
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    log.error("webhook_failed", { ticketId, message: error.message });
    return res.status(200).json({ success: true, error: error.message });
  }
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
  const code = allOk ? 200 : (anyOk ? 503 : 503);

  res.status(code).json({
    success: allOk, status,
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

app.post("/admin/sync/vector", requireAdmin, async (req, res) => {
  try {
    const result = await knowledgeService.syncVectorKnowledgeFromOneDrive({ force: req.body?.force === true });
    res.json({ success: true, result });
  } catch (error) {
    log.error("vector_sync_failed", { message: error.message });
    res.status(500).json({ success: false, error: error.message });
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
