/**
 * MCP Server (Model Context Protocol) — read/control/report surface for Claude.
 *
 * Exposes the bot's existing metrics, traces, kill-switch and knowledge-sync as
 * MCP "tools" so they can be queried in natural language from the Claude app or
 * Claude Code. Stateless Streamable HTTP transport mounted at POST /mcp.
 *
 * This module is purely additive: every tool delegates to an existing service.
 * No bot behaviour changes — if MCP_TOKEN is unset the endpoint is disabled.
 */
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const { z } = require("zod");

const env = require("../config/env");
const log = require("../config/logger");

const metricsService = require("../services/metricsService");
const tracingService = require("../services/tracingService");
const botStateService = require("../services/botStateService");
const knowledgeService = require("../services/knowledgeService");
const { normalizeForComparison } = require("../services/textUtils");

// Cijene po 1M tokena (USD) — zrcali admin-dashboard.html da prikaz bude isti.
const PRICING = {
  "openai/gpt-4o":               { input: 2.50, output: 10.00 },
  "google/gemini-2.5-flash":     { input: 0.30, output: 2.50 },
  "openai/gpt-5":                { input: 1.25, output: 10.00 },
  "openai/gpt-4.1-mini":         { input: 0.40, output: 1.60 },
  "anthropic/claude-3.5-sonnet": { input: 3.00, output: 15.00 },
  "default":                     { input: 2.50, output: 10.00 }
};

function priceFor(model) {
  if (model && PRICING[model]) return PRICING[model];
  if (model) {
    const prov = model.split("/")[0];
    const hit = Object.entries(PRICING).find(([k]) => k.startsWith(prov));
    if (hit) return hit[1];
  }
  return PRICING.default;
}

// MCP tool results are content arrays; we return pretty JSON as text.
function asText(obj) {
  return { content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] };
}

function computeCost(tokenUsage) {
  const model = tokenUsage.model || env.OPENROUTER_MODEL || "openai/gpt-4o";
  const p = priceFor(model);
  const inTok = tokenUsage.totalInputTokens || 0;
  const outTok = tokenUsage.totalOutputTokens || 0;
  const inputCost = (inTok / 1e6) * p.input;
  const outputCost = (outTok / 1e6) * p.output;
  return {
    model,
    rateUsdPer1M: p,
    totalInputTokens: inTok,
    totalOutputTokens: outTok,
    llmCalls: tokenUsage.totalRequests || 0,
    estimatedCostUsd: Number((inputCost + outputCost).toFixed(4)),
    inputCostUsd: Number(inputCost.toFixed(4)),
    outputCostUsd: Number(outputCost.toFixed(4))
  };
}

function topQuestions(limit) {
  const traces = tracingService.getRecentTraces(200);
  const tally = new Map();
  for (const t of traces) {
    const q = (t.standaloneQuery || t.input || "").trim();
    if (!q) continue;
    const key = normalizeForComparison(q);
    if (!key) continue;
    const cur = tally.get(key) || { count: 0, sample: q };
    cur.count += 1;
    tally.set(key, cur);
  }
  return [...tally.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((v) => ({ question: v.sample, count: v.count }));
}

/**
 * Build a fresh MCP server with all tools registered. Called per request so the
 * stateless transport never shares JSON-RPC request ids between connections.
 */
function buildServer() {
  const server = new McpServer(
    { name: "libar-zendesk-bot", version: "2.0.0" },
    { capabilities: { tools: {} } }
  );

  // ── Read ────────────────────────────────────────────────────
  server.registerTool(
    "get_metrics",
    {
      title: "Runtime metrike",
      description: "Vrati žive brojače bota: volumen (chat/webhook), odluke, eskalacije/handoffe, latenciju (avg/p95), potrošnju tokena i cache statistiku.",
      inputSchema: {}
    },
    async () => asText(metricsService.getMetrics())
  );

  server.registerTool(
    "get_traces",
    {
      title: "AI traceovi",
      description: "Vrati zadnjih N AI traceova (input, retrieval, odluka, latencija) i agregiranu trace statistiku. Korisno za uvid u zadnje razgovore.",
      inputSchema: { limit: z.number().int().min(1).max(200).optional() }
    },
    async ({ limit }) =>
      asText({
        traces: tracingService.getRecentTraces(limit || 50),
        stats: tracingService.getTraceStats()
      })
  );

  server.registerTool(
    "get_bot_state",
    {
      title: "Stanje bota",
      description: "Je li bot trenutno upaljen (generira AI odgovore) ili pauziran (sve eskalira čovjeku).",
      inputSchema: {}
    },
    async () => asText(botStateService.getState())
  );

  // ── Control ─────────────────────────────────────────────────
  server.registerTool(
    "set_bot_state",
    {
      title: "Upali/ugasi bota (kill switch)",
      description: "Upali ili pauziraj bota u runtimeu bez redeploya. Kad je pauziran, svaki razgovor se uljudno eskalira čovjeku.",
      inputSchema: { enabled: z.boolean() }
    },
    async ({ enabled }) => {
      const state = botStateService.setEnabled(enabled, "mcp");
      log.warn("bot_state_toggled", { enabled: state.enabled, source: "mcp" });
      return asText({ ok: true, ...state });
    }
  );

  server.registerTool(
    "sync_vector",
    {
      title: "Sync knowledge baze",
      description: "Ručno pokreni sinkronizaciju vektorske knowledge baze iz OneDrivea. Vrati broj indeksiranih/preskočenih/obrisanih dokumenata.",
      inputSchema: { force: z.boolean().optional() }
    },
    async ({ force }) => {
      const result = await knowledgeService.syncVectorKnowledgeFromOneDrive({ force: force === true });
      log.info("vector_sync_via_mcp", {
        indexed: result.indexedDocuments, skipped: result.skippedDocuments
      });
      return asText({ ok: true, result });
    }
  );

  // ── Reports ─────────────────────────────────────────────────
  server.registerTool(
    "weekly_report",
    {
      title: "Sažeti report",
      description: "Sažetak rada bota: ukupni volumen, eskalacije/handoffi, raspodjela odluka, latencija, trošak tokena i top pitanja. NAPOMENA: brojači su kumulativni od zadnjeg deploya, a 'top pitanja' i trace-statistika pokrivaju zadnjih do 200 interakcija (in-memory buffer). Pravu povijest po danima dodaje budući dnevni snapshot.",
      inputSchema: {}
    },
    async () => {
      const m = metricsService.getMetrics();
      const traceStats = tracingService.getTraceStats();
      return asText({
        scope: "cumulative-since-deploy + recent-trace-window",
        volume: {
          totalChatStarts: m.totalChatStarts,
          totalChatMessages: m.totalChatMessages,
          totalWebhooks: m.totalWebhooks,
          totalRequests: m.totalRequests
        },
        escalations: {
          handoffs: m.handoffs,
          botDisabledEscalations: m.botDisabledEscalations,
          webhooksSkippedHumanHandled: m.webhooksSkippedHumanHandled,
          agentTakeoversSkipped: m.agentTakeoversSkipped
        },
        decisions: m.decisions,
        latency: { avgMs: m.avgLatencyMs, p95Ms: m.p95LatencyMs },
        errors: m.errors,
        cost: computeCost(m.tokenUsage || {}),
        cache: m.cache,
        recentTraceStats: traceStats,
        topQuestions: topQuestions(10)
      });
    }
  );

  server.registerTool(
    "top_questions",
    {
      title: "Najčešća pitanja",
      description: "Najčešća korisnička pitanja/intenti iz zadnjih do 200 traceova (in-memory buffer), grupirana po normaliziranom tekstu.",
      inputSchema: { limit: z.number().int().min(1).max(50).optional() }
    },
    async ({ limit }) => asText({ topQuestions: topQuestions(limit || 10) })
  );

  server.registerTool(
    "cost_breakdown",
    {
      title: "Trošak tokena",
      description: "Procijenjeni trošak LLM-a u USD na temelju potrošnje tokena i cijene produkcijskog modela (kumulativno od zadnjeg deploya).",
      inputSchema: {}
    },
    async () => asText(computeCost(metricsService.getMetrics().tokenUsage || {}))
  );

  return server;
}

/**
 * Express middleware — Bearer auth for the MCP endpoint. Disabled (503) when no
 * MCP_TOKEN is configured, so forgetting to set it never exposes the tools.
 */
function mcpAuth(req, res, next) {
  if (!env.MCP_TOKEN) {
    return res.status(503).json({ error: "MCP disabled: MCP_TOKEN not configured." });
  }
  const header = req.headers["authorization"] || "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : null;
  const token = bearer || req.headers["x-mcp-token"] || req.query.token;
  if (!token || token !== env.MCP_TOKEN) {
    return res.status(401).json({ error: "Unauthorized: valid MCP token required." });
  }
  next();
}

/**
 * Stateless request handler. POST carries JSON-RPC; GET/DELETE are unsupported
 * in stateless mode and answered with 405 (mirrors the SDK's stateless example).
 */
async function handleMcpRequest(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed. Use POST." },
      id: null
    });
  }

  let server;
  let transport;
  try {
    server = buildServer();
    transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      try { transport.close(); } catch (_) { /* best effort */ }
      try { server.close(); } catch (_) { /* best effort */ }
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    log.error("mcp_request_failed", { message: error.message });
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal error" },
        id: null
      });
    }
  }
}

module.exports = { buildServer, mcpAuth, handleMcpRequest };
