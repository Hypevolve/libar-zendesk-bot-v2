/**
 * Supabase Metrics Persistence
 *
 * Persists bot counters to Supabase so they survive restarts / deploys.
 * Uses Supabase REST API (axios) — no extra client library needed.
 */
const axios = require("axios");
const env = require("../config/env");
const log = require("../config/logger");

const SUPABASE_URL = (env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

function isConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
}

function getClient() {
  if (!isConfigured()) throw new Error("Supabase not configured.");
  return axios.create({
    baseURL: SUPABASE_URL,
    timeout: 15000,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json"
    }
  });
}

/**
 * Load persisted metrics from Supabase.
 * Returns null if nothing saved yet or Supabase not configured.
 */
async function load() {
  if (!isConfigured()) return null;
  try {
    const client = getClient();
    const res = await client.get("/rest/v1/bot_metrics?id=eq.1&select=*");
    const rows = res.data;
    if (rows && rows.length > 0 && rows[0].data) {
      log.info("metrics_loaded", { keys: Object.keys(rows[0].data) });
      return rows[0].data;
    }
    return null;
  } catch (error) {
    log.warn("metrics_load_failed", { message: error.message });
    return null;
  }
}

let tableMissingLogged = false;

/**
 * Save current metrics snapshot to Supabase.
 * Uses upsert (merge on id=1) so we always keep exactly one row.
 */
async function save(data) {
  if (!isConfigured()) return;
  try {
    const client = getClient();
    await client.post(
      "/rest/v1/bot_metrics",
      { id: 1, data, updated_at: new Date().toISOString() },
      { headers: { Prefer: "resolution=merge-duplicates,return=minimal" } }
    );
  } catch (error) {
    const is404 = error.response?.status === 404 || error.message?.includes("404");
    if (is404 && !tableMissingLogged) {
      tableMissingLogged = true;
      log.warn("metrics_table_missing", { table: "bot_metrics", hint: "Run SQL in Supabase: CREATE TABLE bot_metrics (id int PRIMARY KEY, data jsonb, updated_at timestamptz DEFAULT now());" });
    } else if (!is404) {
      log.warn("metrics_save_failed", { message: error.message });
    }
  }
}

module.exports = { isConfigured, load, save };
