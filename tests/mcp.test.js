/**
 * Test: MCP server (mcp/server.js).
 * Verificira da su svi toolovi registrirani i da rade preko pravog MCP
 * Client↔Server in-memory transporta, plus da auth gate (mcpAuth) i
 * handleMcpRequest pravilno odbijaju neovlaštene / krive zahtjeve.
 * Ne diže HTTP server — koristi SDK-ov InMemoryTransport.
 */
const test = require("node:test");
const assert = require("node:assert");

const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = require("@modelcontextprotocol/sdk/inMemory.js");

const env = require("../config/env");
const botStateService = require("../services/botStateService");
const { buildServer, mcpAuth, handleMcpRequest } = require("../mcp/server");

async function connectedClient() {
  const server = buildServer();
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([client.connect(clientT), server.connect(serverT)]);
  // close() must tear down BOTH sides, else open transports keep the test
  // process alive and the multi-file runner hangs after this file.
  const close = async () => { await client.close(); await server.close(); };
  return { client, server, close };
}

function parse(result) {
  return JSON.parse(result.content[0].text);
}

// ─── Tool registration ─────────────────────────────────────────

test("svi očekivani toolovi su registrirani", async () => {
  const { client, close } = await connectedClient();
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepStrictEqual(names, [
    "cost_breakdown", "get_bot_state", "get_metrics", "get_traces",
    "set_bot_state", "sync_vector", "top_questions", "weekly_report"
  ]);
  await close();
});

// ─── Read toolovi ──────────────────────────────────────────────

test("get_metrics vraća brojače", async () => {
  const { client, close } = await connectedClient();
  const data = parse(await client.callTool({ name: "get_metrics", arguments: {} }));
  assert.ok("totalRequests" in data, "ima totalRequests");
  assert.ok("avgLatencyMs" in data, "ima avgLatencyMs");
  await close();
});

test("get_bot_state vraća enabled boolean", async () => {
  const { client, close } = await connectedClient();
  const data = parse(await client.callTool({ name: "get_bot_state", arguments: {} }));
  assert.strictEqual(typeof data.enabled, "boolean");
  await close();
});

// ─── Control toolovi ───────────────────────────────────────────

test("set_bot_state mijenja stanje, pa ga vraćamo nazad", async () => {
  const original = botStateService.getState().enabled;
  const { client, close } = await connectedClient();
  try {
    const off = parse(await client.callTool({ name: "set_bot_state", arguments: { enabled: false } }));
    assert.strictEqual(off.enabled, false);
    assert.strictEqual(botStateService.getState().enabled, false);

    const on = parse(await client.callTool({ name: "set_bot_state", arguments: { enabled: true } }));
    assert.strictEqual(on.enabled, true);
  } finally {
    botStateService.setEnabled(original, "test-restore");
    await close();
  }
});

// ─── Report toolovi ────────────────────────────────────────────

test("cost_breakdown vraća numerički estimatedCostUsd", async () => {
  const { client, close } = await connectedClient();
  const data = parse(await client.callTool({ name: "cost_breakdown", arguments: {} }));
  assert.strictEqual(typeof data.estimatedCostUsd, "number");
  assert.ok(data.rateUsdPer1M && typeof data.rateUsdPer1M.input === "number");
  await close();
});

test("weekly_report ima volume/escalations/cost sekcije", async () => {
  const { client, close } = await connectedClient();
  const data = parse(await client.callTool({ name: "weekly_report", arguments: {} }));
  assert.ok(data.volume && data.escalations && data.cost);
  assert.ok(Array.isArray(data.topQuestions));
  await close();
});

test("top_questions vraća niz", async () => {
  const { client, close } = await connectedClient();
  const data = parse(await client.callTool({ name: "top_questions", arguments: { limit: 5 } }));
  assert.ok(Array.isArray(data.topQuestions));
  await close();
});

// ─── Auth gate ─────────────────────────────────────────────────

function mockRes() {
  return {
    statusCode: null,
    body: null,
    headersSent: false,
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; this.headersSent = true; return this; }
  };
}

test("mcpAuth: 503 kad MCP_TOKEN nije postavljen", () => {
  const prev = env.MCP_TOKEN;
  env.MCP_TOKEN = "";
  try {
    const res = mockRes();
    let nextCalled = false;
    mcpAuth({ headers: {}, query: {} }, res, () => { nextCalled = true; });
    assert.strictEqual(res.statusCode, 503);
    assert.strictEqual(nextCalled, false);
  } finally { env.MCP_TOKEN = prev; }
});

test("mcpAuth: 401 bez tokena i s krivim tokenom", () => {
  const prev = env.MCP_TOKEN;
  env.MCP_TOKEN = "secret-token";
  try {
    const r1 = mockRes();
    mcpAuth({ headers: {}, query: {} }, r1, () => {});
    assert.strictEqual(r1.statusCode, 401);

    const r2 = mockRes();
    mcpAuth({ headers: { authorization: "Bearer nope" }, query: {} }, r2, () => {});
    assert.strictEqual(r2.statusCode, 401);
  } finally { env.MCP_TOKEN = prev; }
});

test("mcpAuth: propušta ispravan Bearer token", () => {
  const prev = env.MCP_TOKEN;
  env.MCP_TOKEN = "secret-token";
  try {
    const res = mockRes();
    let nextCalled = false;
    mcpAuth({ headers: { authorization: "Bearer secret-token" }, query: {} }, res, () => { nextCalled = true; });
    assert.strictEqual(nextCalled, true);
    assert.strictEqual(res.statusCode, null);
  } finally { env.MCP_TOKEN = prev; }
});

test("handleMcpRequest: GET vraća 405", async () => {
  const res = mockRes();
  await handleMcpRequest({ method: "GET", headers: {}, query: {} }, res);
  assert.strictEqual(res.statusCode, 405);
});
