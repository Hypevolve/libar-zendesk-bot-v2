/**
 * Popis udžbenika po školi i razredu (samo web chat)
 *
 * Deterministički odgovara na upite tipa "popis udžbenika za Gimnaziju Daruvar,
 * 2. razred" linkom na dokument koji je škola objavila za 2026./2027.
 * Podaci su statični JSON generiran iz projekta popis-udzbenika — bez mreže,
 * bez LLM poziva.
 *
 * Škola se prepoznaje bodovanjem tokena naziva po IDF-u: generične riječi
 * ("škola", "srednja", "gimnazija") nose malu težinu, nazivi gradova i vlastita
 * imena veliku. Da bi se škola smatrala prepoznatom, mora prijeći prag
 * pokrivenosti I imati jasan odmak od drugoplasirane — inače radije pitamo.
 */
const fs = require("fs");
const path = require("path");
const { normalizeForSearch } = require("./textUtils");

const DATA_PATH = path.join(__dirname, "..", "data", "popis-udzbenika-2026-27.json");

// Udio težine naziva škole koji upit mora pokriti da bismo je uzeli u obzir.
const MIN_COVERAGE = 0.5;
// Minimalni zbroj IDF-a — sprječava pogodak na samim generičnim riječima.
const MIN_SCORE = 3.0;
// Koliko najbolja mora nadmašiti drugu da bismo bili sigurni.
const MARGIN = 1.2;
// Podudaranje po prefiksu hvata padeže ("daruvaru" ~ "daruvar").
const PREFIX_LEN = 4;
const PREFIX_WEIGHT = 0.7;
const MAX_LEN_DIFF = 3;
// Uređivačka udaljenost hvata tipfelere ("gimanzija" ~ "gimnazija").
const TYPO_MIN_LEN = 4;
const TYPO_LONG_LEN = 7;
const TYPO_WEIGHT = 0.55;

let index = null;

function tokenize(value) {
  return normalizeForSearch(value).split(" ").filter((token) => token.length >= 2);
}

function loadIndex(filePath = DATA_PATH) {
  if (index) return index;
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const skole = raw.skole.map((skola) => ({ ...skola, tokens: [...new Set(tokenize(skola.naziv))] }));

  const df = new Map();
  skole.forEach((skola) => skola.tokens.forEach((token) => df.set(token, (df.get(token) || 0) + 1)));

  const idf = new Map();
  df.forEach((count, token) => idf.set(token, Math.log(skole.length / count) + 0.1));

  skole.forEach((skola) => {
    skola.maxScore = skola.tokens.reduce((sum, token) => sum + idf.get(token), 0);
  });

  index = { godina: raw.godina, generirano: raw.generirano, skole, idf };
  return index;
}

function matchesByPrefix(queryToken, schoolToken) {
  if (queryToken.length < PREFIX_LEN || schoolToken.length < PREFIX_LEN) return false;
  if (Math.abs(queryToken.length - schoolToken.length) > MAX_LEN_DIFF) return false;
  return queryToken.slice(0, PREFIX_LEN) === schoolToken.slice(0, PREFIX_LEN);
}

// Levenshtein s ranim prekidom — zanima nas samo je li udaljenost unutar praga.
function withinEditDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < best) best = curr[j];
    }
    if (best > max) return false;
    prev = curr;
  }
  return prev[b.length] <= max;
}

function matchesByTypo(queryToken, schoolToken) {
  if (queryToken.length < TYPO_MIN_LEN || schoolToken.length < TYPO_MIN_LEN) return false;
  const max = schoolToken.length >= TYPO_LONG_LEN ? 2 : 1;
  return withinEditDistance(queryToken, schoolToken, max);
}

function scoreSchool(skola, queryTokens, idf) {
  let score = 0;
  for (const schoolToken of skola.tokens) {
    const weight = idf.get(schoolToken);
    if (queryTokens.includes(schoolToken)) {
      score += weight;
    } else if (queryTokens.some((queryToken) => matchesByPrefix(queryToken, schoolToken))) {
      score += weight * PREFIX_WEIGHT;
    } else if (queryTokens.some((queryToken) => matchesByTypo(queryToken, schoolToken))) {
      score += weight * TYPO_WEIGHT;
    }
  }
  return { score, coverage: skola.maxScore ? score / skola.maxScore : 0 };
}

function rankSchools(text, { minCoverage = MIN_COVERAGE, minScore = MIN_SCORE } = {}) {
  const idx = loadIndex();
  const queryTokens = tokenize(text);
  if (!queryTokens.length) return [];
  return idx.skole
    .map((skola) => ({ school: skola, ...scoreSchool(skola, queryTokens, idx.idf) }))
    .filter((row) => row.coverage >= minCoverage && row.score >= minScore)
    .sort((a, b) => b.score - a.score);
}

function findSchool(text) {
  const scored = rankSchools(text);
  if (!scored.length) return { status: "none" };

  const [best, second] = scored;
  if (!second || best.score >= second.score * MARGIN) {
    return { status: "match", school: best.school };
  }
  return { status: "ambiguous", candidates: scored.slice(0, 3).map((row) => row.school) };
}

module.exports = { loadIndex, rankSchools, findSchool };
