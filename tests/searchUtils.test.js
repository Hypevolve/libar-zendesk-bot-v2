const { scoreSearchText, findBestExcerpt, tokenize, expandQueryTerms, preprocessSearchQuery, truncateText } = require("../services/searchUtils");

function assert(cond, msg) { if (!cond) throw new Error(`FAIL: ${msg}`); }

// scoreSearchText
const score1 = scoreSearchText("Dostava GLS-om traje 1-2 radna dana u cijeloj Hrvatskoj.", "dostava");
assert(score1 > 0, "relevant text scores > 0");

const score2 = scoreSearchText("Recept za palačinke s čokoladom.", "dostava");
assert(score2 === 0 || score2 < score1, "irrelevant text scores lower");

// Domain boosts
const rvScore = scoreSearchText("Radno vrijeme poslovnice ponedjeljak petak subota 08:00 20:00 13:00", "radno vrijeme");
assert(rvScore >= 200, "radno vrijeme domain boost");

const sjedi5 = scoreSearchText("Sjedi 5 program vjernosti 5 udzbenika besplatna dostava 8 udzbenika 5% popusta", "sjedi 5");
assert(sjedi5 >= 200, "sjedi 5 domain boost");

// tokenize
const tokens = tokenize("Koliko traje dostava u Osijek?");
assert(tokens.length >= 2, "tokenize returns tokens");
assert(!tokens.includes("u"), "stop words removed");

// expandQueryTerms
const expanded = expandQueryTerms("radno vrijeme");
assert(expanded.length > 0, "expands radno vrijeme");
assert(expanded.some((t) => t.includes("ponedjeljak") || t.includes("otvoreni")), "has expected terms");

const otkupExpanded = expandQueryTerms("otkup udžbenika");
assert(otkupExpanded.length > 0, "expands otkup");

// preprocessSearchQuery
const processed = preprocessSearchQuery("Pozdrav, molim vas koliko traje dostava?");
assert(!processed.startsWith("Pozdrav"), "greeting stripped");
assert(processed.length > 10, "query enriched");

// findBestExcerpt
const body = "Uvod u temu.\n\nDostava GLS-om traje 1-2 radna dana.\n\nKontakt informacije.";
const excerpt = findBestExcerpt(body, "dostava", 200);
assert(excerpt.includes("Dostava") || excerpt.includes("dostava") || excerpt.includes("GLS"), "excerpt contains relevant segment");

// truncateText
assert(truncateText("short") === "short", "short text unchanged");
assert(truncateText("x".repeat(2000), 100).length <= 104, "truncation works");

console.log("searchUtils.test.js — all passed ✓");
