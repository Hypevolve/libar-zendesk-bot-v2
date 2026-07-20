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

// ─── Razdoblje ─────────────────────────────────────────────────

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Normalizira {from, to} u ISO timestampe za PostgREST filter.
 * Datum bez vremena ("2026-07-01") se širi na cijeli dan da rubni dani budu
 * uključivi u oba smjera — inače bi "do 31.7." odbacilo sve tog dana.
 * Vraća null za nezadanu granicu (= bez filtera).
 */
function normalizeRange({ from = null, to = null } = {}) {
  const parse = (value, endOfDay) => {
    if (value === null || value === undefined || value === "") return null;
    const raw = String(value).trim();
    const iso = DATE_ONLY_RE.test(raw)
      ? `${raw}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`
      : raw;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) throw new Error(`Neispravan datum: ${raw}`);
    // Datum-only smo već sami sastavili; pun ISO vraćamo doslovno kako ga je
    // pozivatelj poslao (bez preformatiranja u drugu vremensku zonu).
    return DATE_ONLY_RE.test(raw) ? iso : raw;
  };

  const fromIso = parse(from, false);
  const toIso = parse(to, true);
  if (fromIso && toIso && new Date(fromIso) > new Date(toIso)) {
    throw new Error("Neispravan raspon: 'from' je nakon 'to'.");
  }
  return { from: fromIso, to: toIso };
}

// ─── Agregacija (čista funkcija — bez mreže) ───────────────────

const QUALITIES = ["good", "partial", "bad", "na"];

function emptyQuality() {
  return { good: 0, partial: 0, bad: 0, na: 0 };
}

function emptySummary(range = { from: null, to: null }) {
  return {
    total: 0, botResolved: 0, humanHandled: 0, kbGaps: 0,
    byHandledBy: { bot: 0, human: 0, mixed: 0 },
    byQuality: emptyQuality(),
    byChannel: { web: 0, email: 0, facebook: 0, ostalo: 0 },
    byChannelQuality: { web: emptyQuality(), email: emptyQuality(), facebook: emptyQuality(), ostalo: emptyQuality() },
    range
  };
}

// Mapira sirovi Zendesk via.channel u jedan od 4 prikazna kanala.
function bucketForChannel(raw) {
  const ch = String(raw || "").trim().toLowerCase();
  for (const [bucket, vias] of Object.entries(channelBuckets())) {
    if (vias.includes(ch)) return bucket;
  }
  return "ostalo";
}

/**
 * Zbraja redove ticket_analysis u brojke za dashboard.
 *
 * Sve kartice se računaju iz ISTOG skupa redova, pa vrijede invarijante koje
 * su na starom panelu bile prekršene:
 *   botResolved + humanHandled === total
 *   suma byChannel === total
 *   suma byChannelQuality[k] === byChannel[k]
 *
 * "Bot riješio" je isključivo handled_by === "bot" — 'mixed' znači da je agent
 * ipak morao intervenirati, pa se ne broji kao ušteda rada. Nepoznate/prazne
 * vrijednosti idu konzervativno na stranu čovjeka.
 */
function tallySummary(rows = [], range = { from: null, to: null }) {
  const s = emptySummary(range);
  for (const r of rows || []) {
    s.total++;

    const handled = String(r?.handled_by || "").trim().toLowerCase();
    if (handled === "bot") { s.byHandledBy.bot++; s.botResolved++; }
    else {
      if (handled === "human" || handled === "mixed") s.byHandledBy[handled]++;
      s.humanHandled++;
    }

    const quality = String(r?.bot_quality || "").trim().toLowerCase();
    const q = QUALITIES.includes(quality) ? quality : "na";
    s.byQuality[q]++;

    const bucket = bucketForChannel(r?.channel);
    s.byChannel[bucket]++;
    s.byChannelQuality[bucket][q]++;

    if (r?.is_kb_gap === true) s.kbGaps++;
  }
  return s;
}

// ─── Dohvat + agregacija ───────────────────────────────────────

const PAGE_SIZE = 1000;
const MAX_PAGES = 50; // 50k redova — zaštita od runawaya, daleko iznad realnog volumena

function rangeFilter({ from, to }) {
  let qs = "";
  if (from) qs += `&created_at=gte.${encodeURIComponent(from)}`;
  if (to) qs += `&created_at=lte.${encodeURIComponent(to)}`;
  return qs;
}

/**
 * Dohvaća redove za razdoblje u stranicama. Jedan prolaz kroz podatke umjesto
 * ~20 zasebnih count upita — brže i bez rizika da pojedini upiti vide različita
 * stanja baze (što je znalo dati kartice koje se ne zbrajaju).
 */
async function fetchRowsInRange(range) {
  const client = getClient();
  const filter = rangeFilter(range);
  const rows = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const offset = page * PAGE_SIZE;
    const res = await client.get(
      `/rest/v1/ticket_analysis?select=created_at,channel,handled_by,bot_quality,is_kb_gap${filter}` +
      `&order=created_at.desc&offset=${offset}&limit=${PAGE_SIZE}`
    );
    const batch = res.data || [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return rows;
}

async function getSummary({ from = null, to = null } = {}) {
  const range = normalizeRange({ from, to });
  if (!isConfigured()) return emptySummary(range);
  const rows = await fetchRowsInRange(range);
  return tallySummary(rows, range);
}

async function getConversations({ limit = 20, from = null, to = null } = {}) {
  if (!isConfigured()) return [];
  const n = Math.min(Math.max(Number(limit) || 20, 1), 200);
  const filter = rangeFilter(normalizeRange({ from, to }));
  const res = await getClient().get(
    `/rest/v1/ticket_analysis?select=*${filter}&order=created_at.desc&limit=${n}`
  );
  return res.data || [];
}

async function getTopQuestions({ limit = 10, from = null, to = null } = {}) {
  if (!isConfigured()) return [];
  const filter = rangeFilter(normalizeRange({ from, to }));
  const res = await getClient().get(
    `/rest/v1/ticket_analysis?select=topic&topic=not.is.null${filter}&limit=2000`
  );
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

async function getKbGaps({ limit = 10, from = null, to = null } = {}) {
  if (!isConfigured()) return [];
  const filter = rangeFilter(normalizeRange({ from, to }));
  const res = await getClient().get(
    `/rest/v1/ticket_analysis?is_kb_gap=eq.true&select=topic,suggested_kb_topic,ticket_id,summary${filter}` +
    "&order=created_at.desc&limit=500"
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
  // Čiste funkcije — izložene radi testiranja bez mreže.
  normalizeRange,
  tallySummary,
  _setTestClient
};
