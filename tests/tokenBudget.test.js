const tokenBudget = require("../services/tokenBudgetService");

function assert(cond, msg) { if (!cond) throw new Error(`FAIL: ${msg}`); }

// estimateTokens
const est = tokenBudget.estimateTokens("Hello world, this is a test.");
assert(est > 0, "token estimate > 0");
assert(est < 100, "token estimate reasonable");

// checkBudget
const check = tokenBudget.checkBudget("Short text");
assert(check.withinBudget === true, "short text within budget");
assert(check.estimatedTokens > 0, "has estimate");

// trimContextToBudget
const longText = "word ".repeat(5000);
const trimmed = tokenBudget.trimContextToBudget(longText, 500);
assert(trimmed.length < longText.length, "context was trimmed");

// recordUsage + getUsageStats
tokenBudget.resetUsage();
tokenBudget.recordUsage(100, 50);
tokenBudget.recordUsage(200, 100);
const stats = tokenBudget.getUsageStats();
assert(stats.totalInputTokens === 300, "input total");
assert(stats.totalOutputTokens === 150, "output total");
assert(stats.totalRequests === 2, "call count");

console.log("tokenBudget.test.js — all passed ✓");
