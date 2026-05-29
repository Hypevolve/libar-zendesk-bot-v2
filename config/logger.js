/**
 * Structured JSON Logger (Skill §12 — Three Pillars of Production Visibility)
 *
 * All log output is JSON for aggregators (DataDog, ELK, CloudWatch).
 * Suppressed during tests unless DEBUG_TEST_LOGS=true.
 */
const { IS_TEST } = require("./env");
const SHOULD_LOG = !IS_TEST || process.env.DEBUG_TEST_LOGS === "true";

function formatEntry(level, event, data) {
  return JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...(typeof data === "object" && data !== null ? data : data !== undefined ? { message: data } : {})
  });
}

function info(event, data) {
  if (SHOULD_LOG) console.info(formatEntry("info", event, data));
}

function warn(event, data) {
  if (SHOULD_LOG) console.warn(formatEntry("warn", event, data));
}

function error(event, data) {
  if (SHOULD_LOG) console.error(formatEntry("error", event, data));
}

module.exports = { info, warn, error };
