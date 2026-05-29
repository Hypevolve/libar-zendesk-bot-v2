/**
 * Runtime Store — File-based state persistence
 *
 * Persists chat sessions, webhook dedup keys, and recent starts
 * across restarts. Atomic write via temp file + rename.
 */
const fs = require("node:fs");
const path = require("node:path");

const RUNTIME_DIR = path.join(__dirname, "..", ".runtime");
const STORE_PATH = path.join(RUNTIME_DIR, "runtime-store.json");
const SESSION_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
const WEBHOOK_RETENTION_MS = 24 * 60 * 60 * 1000;
const START_RETENTION_MS = 6 * 60 * 60 * 1000;

function ensureDir() { fs.mkdirSync(RUNTIME_DIR, { recursive: true }); }

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch (e) { if (e.code === "ENOENT") return null; throw e; }
}

function ts(v) { const t = new Date(v || 0).getTime(); return Number.isFinite(t) ? t : 0; }

function pruneSessions(s = [], now = Date.now()) {
  return (Array.isArray(s) ? s : []).filter((x) => { const u = ts(x?.updatedAt || x?.createdAt); return u > 0 && now - u <= SESSION_RETENTION_MS; });
}

function pruneEntries(e = [], retention, now = Date.now()) {
  return (Array.isArray(e) ? e : []).filter((x) => { const c = Number(x?.createdAt || 0); return Number.isFinite(c) && now - c <= retention; });
}

function loadRuntimeState() {
  const d = readJson(STORE_PATH) || {};
  const now = Date.now();
  return {
    sessions: pruneSessions(d.sessions, now),
    processedWebhookAudits: pruneEntries(d.processedWebhookAudits, WEBHOOK_RETENTION_MS, now),
    processedWebhookMessages: pruneEntries(d.processedWebhookMessages, WEBHOOK_RETENTION_MS, now),
    recentChatStarts: pruneEntries(d.recentChatStarts, START_RETENTION_MS, now)
  };
}

function saveRuntimeState(state = {}) {
  ensureDir();
  const payload = {
    sessions: pruneSessions(state.sessions),
    processedWebhookAudits: pruneEntries(state.processedWebhookAudits, WEBHOOK_RETENTION_MS),
    processedWebhookMessages: pruneEntries(state.processedWebhookMessages, WEBHOOK_RETENTION_MS),
    recentChatStarts: pruneEntries(state.recentChatStarts, START_RETENTION_MS),
    savedAt: new Date().toISOString()
  };
  const tmp = `${STORE_PATH}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf8");
  fs.renameSync(tmp, STORE_PATH);
}

module.exports = { loadRuntimeState, saveRuntimeState };
