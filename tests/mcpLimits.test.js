/**
 * Test: granice MCP zahtjeva (GHSA-46jr-4wx8-v453, GHSA-f897-62hf-6gxq).
 * - previše elemenata u argumentima toola → isError, tool se ne izvrši
 * - preveliko tijelo → 413, i to tek nakon provjere tokena
 * - /mcp je u index.js registriran prije express.json(), inače transport
 *   dobije već parsirano tijelo i ne provjerava mu veličinu
 * HTTP dio diže mali Express server na slučajnom portu (bez vanjskih servisa).
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const express = require("express");

const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = require("@modelcontextprotocol/sdk/inMemory.js");

const env = require("../config/env");
env.SUPABASE_URL = "";
env.SUPABASE_SERVICE_ROLE_KEY = "";

const { buildServer, mcpAuth, handleMcpRequest } = require("../mcp/server");
const botStateService = require("../services/botStateService");

const TOKEN = "mcp-limits-test-token";

async function connectedClient() {
  const server = buildServer();
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([client.connect(clientT), server.connect(serverT)]);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

function manyKeys(n) {
  const args = {};
  for (let i = 0; i < n; i++) args[`k${i}`] = i;
  return args;
}

// Isti raspored kao index.js: /mcp prije globalnog express.json().
async function startApp() {
  const app = express();
  app.all("/mcp", mcpAuth, handleMcpRequest);
  app.use(express.json({ limit: "1mb" }));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const url = `http://127.0.0.1:${server.address().port}/mcp`;
  return { url, close: () => new Promise((r) => server.close(r)) };
}

function post(url, body, { token = TOKEN } = {}) {
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream"
  };
  if (token) headers.authorization = `Bearer ${token}`;
  return fetch(url, { method: "POST", headers, body });
}

const initialize = {
  jsonrpc: "2.0", id: 1, method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } }
};

test("granice imaju razumne vrijednosti", () => {
  assert.strictEqual(env.MCP_MAX_TOOL_INPUT_ELEMENTS, 20);
  assert.strictEqual(env.MCP_MAX_REQUEST_BODY_BYTES, 64 * 1024);
});

test("tool s legitimnim argumentima i dalje radi", async () => {
  const { client, close } = await connectedClient();
  try {
    const res = await client.callTool({ name: "top_questions", arguments: { limit: 5 } });
    assert.notStrictEqual(res.isError, true);
  } finally { await close(); }
});

test("previše ključeva u argumentima → isError, tool se ne izvrši", async () => {
  const original = botStateService.getState().enabled;
  const { client, close } = await connectedClient();
  try {
    const args = { enabled: !original, ...manyKeys(env.MCP_MAX_TOOL_INPUT_ELEMENTS + 5) };
    const res = await client.callTool({ name: "set_bot_state", arguments: args });
    assert.strictEqual(res.isError, true);
    assert.match(res.content[0].text, /more than the maximum of 20 elements/);
    assert.strictEqual(botStateService.getState().enabled, original, "stanje bota se ne smije promijeniti");
  } finally {
    botStateService.setEnabled(original, "test-restore");
    await close();
  }
});

test("veliki niz u argumentu → isError (prije validacije sheme)", async () => {
  const { client, close } = await connectedClient();
  try {
    const res = await client.callTool({ name: "get_traces", arguments: { limit: new Array(5000).fill(1) } });
    assert.strictEqual(res.isError, true);
    assert.match(res.content[0].text, /maximum of 20 elements/);
  } finally { await close(); }
});

test("HTTP: initialize s ispravnim tokenom prolazi (transport sam čita tijelo)", async () => {
  const app = await startApp();
  const prev = env.MCP_TOKEN;
  env.MCP_TOKEN = TOKEN;
  try {
    const res = await post(app.url, JSON.stringify(initialize));
    assert.strictEqual(res.status, 200);
    const text = await res.text();
    assert.match(text, /libar-zendesk-bot/);
  } finally { env.MCP_TOKEN = prev; await app.close(); }
});

test("HTTP: tijelo veće od MCP_MAX_REQUEST_BODY_BYTES → 413", async () => {
  const app = await startApp();
  const prev = env.MCP_TOKEN;
  env.MCP_TOKEN = TOKEN;
  try {
    const big = JSON.stringify({ ...initialize, params: { ...initialize.params, pad: "x".repeat(env.MCP_MAX_REQUEST_BODY_BYTES + 1) } });
    const res = await post(app.url, big);
    assert.strictEqual(res.status, 413);
  } finally { env.MCP_TOKEN = prev; await app.close(); }
});

test("HTTP: batch s više od 100 poruka → 400", async () => {
  const app = await startApp();
  const prev = env.MCP_TOKEN;
  env.MCP_TOKEN = TOKEN;
  try {
    const batch = Array.from({ length: 101 }, () => ({ jsonrpc: "2.0", method: "notifications/initialized" }));
    const res = await post(app.url, JSON.stringify(batch));
    assert.strictEqual(res.status, 400);
  } finally { env.MCP_TOKEN = prev; await app.close(); }
});

test("HTTP: bez tokena → 401, tijelo se ni ne čita", async () => {
  const app = await startApp();
  const prev = env.MCP_TOKEN;
  env.MCP_TOKEN = TOKEN;
  try {
    const big = "x".repeat(env.MCP_MAX_REQUEST_BODY_BYTES * 2);
    const res = await post(app.url, big, { token: null });
    assert.strictEqual(res.status, 401);
  } finally { env.MCP_TOKEN = prev; await app.close(); }
});

test("index.js registrira /mcp prije body parsera", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  const mcpRoute = src.indexOf('app.all("/mcp"');
  const jsonParser = src.indexOf("app.use(express.json(");
  const formParser = src.indexOf("app.use(express.urlencoded(");
  assert.ok(mcpRoute > 0, "nema /mcp rute");
  assert.ok(mcpRoute < jsonParser, "/mcp mora biti prije express.json()");
  assert.ok(mcpRoute < formParser, "/mcp mora biti prije express.urlencoded()");
});
