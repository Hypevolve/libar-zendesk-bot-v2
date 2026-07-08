/**
 * Analytics Store (Supabase REST)
 *
 * Čita/piše analizu Zendesk ticketa u Supabase (tablice ticket_analysis i
 * analysis_sync_state). Koristi Supabase REST/PostgREST (axios), kao
 * supabaseMetricsService - bez dodatne klijent biblioteke.
 *
 * Sve funkcije su sigurne bez konfiguracije: čitanja vraćaju prazne podatke,
 * pisanja su no-op (isConfigured() === false).
 */
const axios = require("axios");
const env = require("../config/env");
const log = require("../config/logger");

const SUPABASE_URL = (env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

// Test hook: kad je postavljen, getClient() vraća ovaj mock umjesto pravog klijenta.
let _testClient = null;
function _setTestClient(client) { _testClient = client; }

function isConfigured() {
  return Boolean((env.SUPABASE_URL || "") && (env.SUPABASE_SERVICE_ROLE_KEY || ""));
}

function getClient() {
  if (_testClient) return _testClient;
  if (!isConfigured()) throw new Error("Supabase not configured.");
  return axios.create({
    baseURL: (env.SUPABASE_URL || "").replace(/\/+$/, ""),
    timeout: 15000,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json"
    }
  });
}

const UPSERT_HEADERS = { headers: { Prefer: "resolution=merge-duplicates,return=minimal" } };

// ─── Pisanje ───────────────────────────────────────────────────

async function upsertAnalysis(row) {
  if (!isConfigured()) return;
  try {
    await getClient().post("/rest/v1/ticket_analysis", row, UPSERT_HEADERS);
  } catch (error) {
    log.warn("analytics_upsert_failed", { ticketId: row?.ticket_id, message: error.message });
    throw error;
  }
}

async function getCursor() {
  if (!isConfigured()) return null;
  try {
    const res = await getClient().get("/rest/v1/analysis_sync_state?id=eq.1&select=last_cursor");
    return res.data?.[0]?.last_cursor || null;
  } catch (error) {
    log.warn("analytics_cursor_read_failed", { message: error.message });
    return null;
  }
}

async function setCursor(iso) {
  if (!isConfigured()) return;
  await getClient().post(
    "/rest/v1/analysis_sync_state",
    { id: 1, last_cursor: iso, updated_at: new Date().toISOString() },
    UPSERT_HEADERS
  );
}

// ─── Čitanje ───────────────────────────────────────────────────

async function countWhere(filterQS = "") {
  const res = await getClient().get(
    `/rest/v1/ticket_analysis?select=ticket_id${filterQS}`,
    { headers: { Prefer: "count=exact", Range: "0-0" } }
  );
  const cr = res.headers?.["content-range"] || res.headers?.["Content-Range"] || "";
  return Number(String(cr).split("/")[1]) || 0;
}

// Zendesk via.channel je heterogen (email, facebook, web, api, web_service, chat…).
// Mapiramo sirove vrijednosti u 3 prikazna kanala + "ostalo".
// VAŽNO: provjeri stvarne vrijednosti u bazi (SELECT DISTINCT channel) i doradi.
function channelBuckets() {
  return {
    email: ["email"],
    facebook: ["facebook", "messenger", "facebook_page", "facebook_post"],
    web: ["web", "web_widget", "web_service", "chat", "messaging", "api"]
  };
}

async function getSummary() {
  if (!isConfigured()) return {
    total: 0, kbGaps: 0, byHandledBy: {}, byQuality: {},
    byChannel: { web: 0, email: 0, facebook: 0, ostalo: 0 }, byChannelQuality: {}
  };
  const total = await countWhere("");
  const kbGaps = await countWhere("&is_kb_gap=eq.true");
  const byHandledBy = {};
  for (const v of ["bot", "human", "mixed"]) byHandledBy[v] = await countWhere(`&handled_by=eq.${v}`);
  const byQuality = {};
  for (const v of ["good", "partial", "bad", "na"]) byQuality[v] = await countWhere(`&bot_quality=eq.${v}`);

  const buckets = channelBuckets();
  const byChannel = { web: 0, email: 0, facebook: 0, ostalo: 0 };
  const byChannelQuality = {};
  for (const [bucket, vias] of Object.entries(buckets)) {
    byChannel[bucket] = await countWhere(`&channel=in.(${vias.join(",")})`);
    byChannelQuality[bucket] = {};
    for (const q of ["good", "partial", "bad", "na"]) {
      byChannelQuality[bucket][q] =
        await countWhere(`&channel=in.(${vias.join(",")})&bot_quality=eq.${q}`);
    }
  }
  byChannel.ostalo = Math.max(0, total - byChannel.web - byChannel.email - byChannel.facebook);

  return { total, kbGaps, byHandledBy, byQuality, byChannel, byChannelQuality };
}

async function getConversations({ limit = 20 } = {}) {
  if (!isConfigured()) return [];
  const n = Math.min(Math.max(Number(limit) || 20, 1), 200);
  const res = await getClient().get(`/rest/v1/ticket_analysis?select=*&order=created_at.desc&limit=${n}`);
  return res.data || [];
}

async function getTopQuestions({ limit = 10 } = {}) {
  if (!isConfigured()) return [];
  const res = await getClient().get("/rest/v1/ticket_analysis?select=topic&topic=not.is.null&limit=2000");
  const tally = new Map();
  for (const r of res.data || []) {
    const t = (r.topic || "").trim();
    if (!t) continue;
    tally.set(t, (tally.get(t) || 0) + 1);
  }
  return [...tally.entries()]
    .map(([topic, count]) => ({ topic, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, Math.min(Math.max(Number(limit) || 10, 1), 50));
}

async function getKbGaps({ limit = 10 } = {}) {
  if (!isConfigured()) return [];
  const res = await getClient().get(
    "/rest/v1/ticket_analysis?is_kb_gap=eq.true&select=topic,suggested_kb_topic,ticket_id,summary&order=created_at.desc&limit=500"
  );
  const groups = new Map();
  for (const r of res.data || []) {
    const topic = (r.topic || "ostalo").trim();
    const g = groups.get(topic) || { topic, count: 0, suggested: null, examples: [] };
    g.count += 1;
    if (!g.suggested && r.suggested_kb_topic) g.suggested = r.suggested_kb_topic;
    if (g.examples.length < 3) g.examples.push({ ticket_id: r.ticket_id, summary: r.summary || null });
    groups.set(topic, g);
  }
  return [...groups.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, Math.min(Math.max(Number(limit) || 10, 1), 50));
}

module.exports = {
  isConfigured,
  upsertAnalysis,
  getCursor,
  setCursor,
  getSummary,
  getConversations,
  getTopQuestions,
  getKbGaps,
  _setTestClient
};
