const {
  normalizeWhitespace, normalizeLowercase, normalizeForSearch,
  normalizeForComparison, stripHtml, truncateText, tokenize
} = require("../services/textUtils");

function assert(cond, msg) { if (!cond) throw new Error(`FAIL: ${msg}`); }

// normalizeWhitespace
assert(normalizeWhitespace("  hello   world  ") === "hello world", "whitespace collapse");
assert(normalizeWhitespace("") === "", "empty string");

// normalizeLowercase
assert(normalizeLowercase("Đuro Đaković") === "duro dakovic", "croatian diacritics");
assert(normalizeLowercase("Č Ć Ž Š") === "c c z s", "combining marks removed");

// normalizeForSearch
assert(normalizeForSearch("<b>Test</b>").includes("test"), "strip html + lowercase");
assert(normalizeForSearch("Šibenik 2024").includes("sibenik"), "search normalization");

// normalizeForComparison
assert(normalizeForComparison("  Hello-World #1  ") === "hello-world #1", "comparison preserves # and -");

// stripHtml
assert(stripHtml("<p>Hello</p><p>World</p>").includes("Hello"), "strip p tags");
assert(!stripHtml("<script>alert(1)</script>Text").includes("alert"), "strip script");

// truncateText
assert(truncateText("short") === "short", "short text unchanged");
assert(truncateText("a".repeat(1000), 100).length <= 105, "truncation works");

// tokenize
const tokens = tokenize("Dostava udžbenika u Osijek");
assert(tokens.length >= 2, "tokenize splits");
assert(tokens.every((t) => t.length > 1), "no single char tokens");

console.log("textUtils.test.js — all passed ✓");
