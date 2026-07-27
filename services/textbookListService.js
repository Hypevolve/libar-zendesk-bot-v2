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
 *
 * Dodatni uvjet za siguran pogodak: SVAKI token naziva škole iznad DISTINCTIVE_IDF
 * praga mora biti pokriven upitom (točno, prefiksom ili tipfelerom). Bez toga bi
 * nedovoljno određen upit ("srednja škola Šibenik", "ekonomska škola") mogao
 * samouvjereno pogoditi krivu školu samo zato što je konkurentskoj slučajno
 * "otpao" jedan nespomenut, ali prepoznatljiv token (npr. grad ili specifičniji tip).
 */
const fs = require("fs");
const path = require("path");
const { normalizeForSearch } = require("./textUtils");

const DATA_PATH = path.join(__dirname, "..", "data", "popis-udzbenika-2026-27.json");

// Udio težine naziva škole koji upit mora pokriti da bismo je uzeli u obzir.
const MIN_COVERAGE = 0.5;
// Minimalni zbroj IDF-a — sprječava pogodak na samim generičnim riječima.
const MIN_SCORE = 3.0;
// Koliko najbolja mora nadmašiti drugu da bismo bili sigurni (kad obje prođu DISTINCTIVE_IDF gate).
const MARGIN = 1.35;
// Prag iznad kojeg je token naziva škole "prepoznatljiv" i MORA biti pokriven upitom da
// bismo tu školu smatrali sigurnim pogotkom — inače upit poput "srednja škola Šibenik" ili
// "ekonomska škola" (bez grada) dobije lažno samouvjeren odgovor jer je nekoj konkurentskoj
// školi slučajno "otpao" jedan nespomenut token. Prag je postavljen odmah iznad "škola"
// (idf 0,30 — pojavljuje se u 229/281 naziva, 81% korpusa; jedina riječ toliko univerzalna
// da je svaki naziv gotovo nužno sadrži pa je izuzimamo) i ispod "srednja" (idf 1,23,
// 91/281 = 32%). Svaki drugi token — tip škole ("gimnazija" 1,81/18%, "tehnička" 2,44/10%,
// "strukovna" 2,91/6% …) ili ime grada — mora biti pokriven, inače škola ne prolazi kao
// siguran pogodak. (Ako je "škola" jedini uvjet koji ostaje nepokriven, to ne blokira gate.)
const DISTINCTIVE_IDF = 0.8;
// Iznimka od gornjeg gate-a: kad je škola JEDINI kandidat u cijelom korpusu (ne samo u
// "confident" skupu) i upit pokriva barem ovoliki udio njenog naziva, smatramo je sigurnim
// pogotkom i bez pokrivenog prepoznatljivog tokena — hvata upite koji školu imenuju vlastitim
// imenom bez grada ("gimnazija Antuna Vrančića", cov 0,77; "biskupijska klasična gimnazija
// Ruđera Boškovića", cov 0,76 — oboje moraju pogoditi). Prag mora ostati iznad "ekonomska
// škola" (cov 0,50, jedini kandidat, ali NE smije pogoditi jer grad uopće nije spomenut) i
// iznad "škola Daruvar" (cov 0,71 — ali ima 2 kandidata pa ionako ne prolazi uvjet "jedini").
// Postavljen na sredinu raspona 0,50–0,76.
const LONE_SURVIVOR_COVERAGE = 0.65;
// Podudaranje po prefiksu hvata padeže ("daruvaru" ~ "daruvar") — hrvatska deklinacija mijenja
// samo rep riječi, obično jedno slovo ("daruvar"→"daruvaru", "gimnazija"→"gimnaziju"). Zato
// tražimo da se tokeni podudaraju u SVIM osim najviše jednog znaka SVAKOG tokena, a ne samo
// u fiksnih prvih N znakova — fiksni prefiks (npr. prva 4 znaka + labava razlika duljine)
// lažno izjednačava nepovezana imena čim dijele početak: "ivana"~"ivanec" (zajedničko 4 od
// 5,6), "petra"~"petrinja" (4 od 5,8), "marka"~"maruševcu" (3 od 5,9) — sve su odbačene niže
// (PREFIX_MIN_LEN i dalje sprječava da vrlo kratki tokeni prođu).
const PREFIX_MIN_LEN = 4;
const PREFIX_WEIGHT = 0.7;
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

function commonPrefixLength(a, b) {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) i++;
  return i;
}

function matchesByPrefix(queryToken, schoolToken) {
  if (queryToken.length < PREFIX_MIN_LEN || schoolToken.length < PREFIX_MIN_LEN) return false;
  const common = commonPrefixLength(queryToken, schoolToken);
  // Zajednički prefiks mora pokriti sve osim najviše jednog znaka OBA tokena — inače su to
  // dvije različite riječi koje se slučajno podudaraju na početku, ne padež iste riječi.
  return common >= queryToken.length - 1 && common >= schoolToken.length - 1;
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
  // Je li neki prepoznatljiv token naziva (iznad DISTINCTIVE_IDF) ostao nepokriven upitom.
  // Takva škola ne može biti siguran pogodak — vidi findSchool.
  let uncoveredDistinctive = false;
  for (const schoolToken of skola.tokens) {
    const weight = idf.get(schoolToken);
    let matched = false;
    if (queryTokens.includes(schoolToken)) {
      score += weight;
      matched = true;
    } else if (queryTokens.some((queryToken) => matchesByPrefix(queryToken, schoolToken))) {
      score += weight * PREFIX_WEIGHT;
      matched = true;
    } else if (queryTokens.some((queryToken) => matchesByTypo(queryToken, schoolToken))) {
      score += weight * TYPO_WEIGHT;
      matched = true;
    }
    if (!matched && weight > DISTINCTIVE_IDF) {
      uncoveredDistinctive = true;
    }
  }
  return { score, coverage: skola.maxScore ? score / skola.maxScore : 0, uncoveredDistinctive };
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

  // Jedini kandidat u cijelom korpusu, s upitom koji objašnjava većinu njegovog naziva —
  // sigurno je prepoznat i bez pokrivenog prepoznatljivog tokena (vidi LONE_SURVIVOR_COVERAGE).
  // Mora biti JEDINI ukupno, ne samo u "confident" skupu, inače bi npr. "škola Daruvar"
  // (dva kandidata, oba visoke pokrivenosti) lažno pogodio jednog od njih.
  if (scored.length === 1 && scored[0].coverage >= LONE_SURVIVOR_COVERAGE) {
    return { status: "match", school: scored[0].school };
  }

  // Siguran pogodak smije biti samo škola čiji su svi prepoznatljivi tokeni pokriveni
  // upitom (vidi DISTINCTIVE_IDF) — inače je pobjeda slučajna (npr. grad ima samo jednu
  // "ekonomsku školu" pa upit "ekonomska škola" pogodi tu, bez da je itko spomenuo grad).
  const confident = scored.filter((row) => !row.uncoveredDistinctive);
  if (!confident.length) {
    return { status: "ambiguous", candidates: scored.slice(0, 3).map((row) => row.school) };
  }

  const [best, second] = confident;
  if (!second || best.score >= second.score * MARGIN) {
    return { status: "match", school: best.school };
  }
  return { status: "ambiguous", candidates: confident.slice(0, 3).map((row) => row.school) };
}

module.exports = { loadIndex, rankSchools, findSchool };
