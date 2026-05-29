const cache = require("../services/responseCacheService");

function assert(cond, msg) { if (!cond) throw new Error(`FAIL: ${msg}`); }

cache.clear();

// set + get
cache.set("q1", "answer1");
assert(cache.get("q1") === "answer1", "cache hit");
assert(cache.get("nonexistent") === null, "cache miss");

// stats
const stats = cache.getStats();
assert(stats.hits >= 1, "has hits");
assert(stats.misses >= 1, "has misses");
assert(stats.size === 1, "one entry");

// clear
cache.clear();
assert(cache.get("q1") === null, "cleared");
assert(cache.getStats().size === 0, "size 0 after clear");

console.log("responseCache.test.js — all passed ✓");
