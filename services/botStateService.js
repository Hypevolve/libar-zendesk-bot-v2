/**
 * Global bot kill-switch.
 *
 * The bot is "enabled" by default (seeded from env.BOT_ENABLED). When disabled,
 * the request handlers stop generating AI answers and instead politely escalate
 * every conversation to a human agent. State lives in-memory so an admin can flip
 * it at runtime (via the admin endpoint) without a redeploy. On process restart it
 * re-seeds from the env var — so a permanent stop should ALSO set BOT_ENABLED=false
 * in the environment, while the runtime toggle is for fast incident response.
 */
const env = require("../config/env");
const log = require("../config/logger");

let enabled = env.BOT_ENABLED !== false;
let lastChange = { at: new Date().toISOString(), by: "env", enabled };

// Polite, on-brand handoff shown to the customer while the bot is paused.
const PAUSED_MESSAGE =
  "Trenutno Vas povezujem s našim timom za podršku kako biste dobili najtočniju pomoć. " +
  "Javit ćemo Vam se u najkraćem mogućem roku putem ovog kanala ili na info@antikvarijat-libar.com. " +
  "Hvala na strpljenju!";

function isEnabled() {
  return enabled === true;
}

function setEnabled(next, by = "admin") {
  const prev = enabled;
  enabled = next === true;
  lastChange = { at: new Date().toISOString(), by, enabled };
  if (prev !== enabled) {
    log.warn("bot_kill_switch_changed", { enabled, by });
  }
  return getState();
}

function getState() {
  return { enabled, lastChange };
}

module.exports = { isEnabled, setEnabled, getState, PAUSED_MESSAGE };
