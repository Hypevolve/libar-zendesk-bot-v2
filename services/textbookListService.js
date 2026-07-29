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
 * Dodatni uvjet za siguran pogodak je SIMETRIČAN i ima dvije strane:
 * 1. SVAKI token naziva škole iznad DISTINCTIVE_IDF praga mora biti pokriven upitom
 *    (točno, prefiksom ili tipfelerom) — inače bi nedovoljno određen upit ("srednja
 *    škola Šibenik", "ekonomska škola") samouvjereno pogodio krivu školu samo zato
 *    što je konkurentskoj slučajno "otpao" jedan nespomenut, ali prepoznatljiv token.
 * 2. Upit ne smije imenovati prepoznatljiv token koji pobjednik NEMA, a neki drugi
 *    kandidat ima — inače škola čiji je skup tokena podskup konkurentskog postaje
 *    "univerzalni donor": uvijek prolazi uvjet 1, konkurent na njemu pada, i onda
 *    "Isusovačka gimnazija Osijek" dobije popis "I. gimnazije Osijek".
 */
const fs = require("fs");
const path = require("path");
const { normalizeForSearch } = require("./textUtils");
const { LINKS } = require("./siteLinkService");

const DATA_PATH = path.join(__dirname, "..", "data", "popis-udzbenika-2026-27.json");

// Udio težine naziva škole koji upit mora pokriti da bismo je uzeli u obzir.
const MIN_COVERAGE = 0.5;
// Minimalni zbroj IDF-a — sprječava pogodak na samim generičnim riječima.
const MIN_SCORE = 3.0;
// Koliko različitih tokena naziva škole upit mora pogoditi da škola uopće uđe u igru.
// Jedan rijedak token sam prelazi MIN_SCORE (148 tokena korpusa ima dovoljno visok idf,
// među njima i posve obične riječi — "prva", "druga", "nova", "dugo", "luka", plus svako
// ime grada), pa bi "Koliko košta dostava knjiga u Osijek?" ili "Kupio sam knjigu i stigla
// je druga" otimali razgovor. Svaki legitiman upit imenuje barem dvije riječi naziva
// ("Gimnazija Daruvar" 2, "medicinsku u Bjelovaru" 2, "gimnazija Antuna Vrančića" 3),
// a u korpusu nema nijedne škole čiji se naziv sastoji od samo jednog tokena — pa ovaj
// prag ne košta nijedan stvarni naziv.
const MIN_MATCHED_TOKENS = 2;
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
// Tokeni koji školu svrstavaju u tip ili redoslijed, ali ne govore KOJA je i GDJE je.
// Siguran pogodak mora pokriti barem jedan token izvan ovog skupa — u praksi grad ili
// vlastito ime. Bez toga redni broj sam nosi pogodak: "III. gimnazija Split" je vraćala
// III. gimnaziju Osijek jer je redni broj ultrarijedak token (idf dovoljan da sam prijeđe
// MIN_SCORE) i uz "gimnazija" zadovoljava MIN_MATCHED_TOKENS, dok "split" u korpusu ne
// postoji pa ga ni imenujeTudeObiljezje ne vidi — ta provjera traži suparnika koji token
// pokriva, a nijedna škola u bazi nije u Splitu. Redni broj razlikuje škole UNUTAR grada
// i o gradu ne govori ništa, pa ne smije biti jedini oslonac.
// Zato kanonski redni brojevi (rb1–rb5, vidi REDNI_* niže) moraju biti OVDJE: normalizacija
// im daje visok idf (rb1 df 7/281 → idf 3,79; rb2 df 3 → 4,63; rb3 df 1 → 5,74), svaki
// znatno iznad DISTINCTIVE_IDF, pa bi bez ovog skupa "II. gimnazija Split" opet nosila
// siguran pogodak u krivom gradu — samo sada i u arapskom i u riječnom obliku.
// Uz njih su i goli rimski brojevi: kad redni broj NE stoji uz vrstu škole, kanonizacija
// ga ne dira (vidi DOMET_* niže) pa ostane doslovan token — tako "ii" preživi u
// "Klasična gimnazija Ivana Pavla II Zadar", gdje je papinski, a ne školski redni broj.
// vi/vii/viii danas ne postoje ni u jednom nazivu, ali su ovdje kao brana za osvježenje
// baze: ako sljedeće ljeto stigne "VI. gimnazija", ne smije nositi pogodak sama.
const NERAZLIKOVNI_TOKENI = new Set([
  // tip škole
  "skola", "skole", "srednja", "gimnazija",
  // kanonski redni broj (rimski, arapski i riječima svode se na isti token)
  "rb1", "rb2", "rb3", "rb4", "rb5",
  // goli rimski broj koji kanonizacija nije dirala jer ne stoji uz vrstu škole
  "i", "ii", "iii", "iv", "v", "vi", "vii", "viii"
]);

// Redni broj nosi 11 od 281 naziva u korpusu, u dva pravopisna oblika: rimskom
// ("I./II./III. gimnazija Osijek") i riječima ("Prva/Druga gimnazija Varaždin",
// "Prva srednja škola Vukovar"). Posjetitelji tipkaju treći, arapski oblik
// ("3. gimnazija Osijek"). Sva tri svodimo na isti kanonski token (rb1–rb5), i na
// nazivima škola i na tekstu upita, pa se oblici međusobno prepoznaju.
// Usput to popravlja i "univerzalnog donora": tokenize je "I." odbacivao kao prekratak
// token, pa je "I. gimnazija Osijek" matcheru stizala kao {gimnazija, osijek} — pravi
// podskup svake druge osječke gimnazije s rednim brojem, s pokrivenošću 1,00 na svakom
// ordinalnom upitu, dok su II./III. padale na nepokrivenom prepoznatljivom tokenu.
// Rimski oblik se u tekstu prvo označi markerom (ri1–ri5), pa se tek u tokenima odlučuje
// hoće li postati redni broj — vidi uzVrstuSkole. Ako ne postane, vraća se doslovan zapis:
// tako "Klasična gimnazija Ivana Pavla II Zadar" zadrži "ii" (papinski, ne školski broj),
// a "I." se, kao i prije ovog rada, izgubi na filtru duljine.
const RIMSKI_MARKER = { i: "ri1", ii: "ri2", iii: "ri3", iv: "ri4", v: "ri5" };
const RIMSKI_IZVORNO = new Map([
  ["ri1", "i"], ["ri2", "ii"], ["ri3", "iii"], ["ri4", "iv"], ["ri5", "v"]
]);

// Arapski oblik i riječi kanoniziramo nakon normalizacije, kad su točka i dijakritika
// već otpale. Map, a ne objekt: ključ je proizvoljan token iz korisnikove poruke, a
// objekt bi na "constructor" ili "toString" vratio naslijeđenu vrijednost s
// Object.prototype i tiho pojeo tu riječ iz upita.
//
// NAMJERNO SAMO ŽENSKI ROD — ne dodavati "prvi/drugi" ni "prvo/drugo".
// Naziv škole je uvijek ženskog roda jer su "škola" i "gimnazija" ženske imenice:
// u korpusu 8 naziva nosi "Prva"/"Druga", a MUŠKI ("prvi", "drugi", "treći",
// "četvrti", "peti") i SREDNJI rod ("prvo", "drugo", "treće", "četvrto", "peto")
// pojavljuju se u NULA naziva od 281 (mjereno). U upitima se, međutim, pojavljuju
// stalno — kao prilozi i redni brojevi u običnom govoru: "prvo bih htio popis…",
// "prvi put pišem…", "drugo pitanje…", "drugi put pitam…", "treće, zanima me…".
// Dok su bili u ovoj mapi, takva rečenica je dobivala redni broj s visokim idf-om
// koji nijedna škola nije pokrivala, pa je imenujeTudeObiljezje obarao inače
// točan pogodak: 7 od 10 prirodnih formulacija za Gimnaziju Daruvar završilo je
// na "nejasno". Muški i srednji rod nose nula vrijednosti za uparivanje i samo
// se sudaraju s prilozima — zato ih ovdje nema.
const REDNI_ZNAMENKA = new Map([
  ["1", "rb1"], ["2", "rb2"], ["3", "rb3"], ["4", "rb4"], ["5", "rb5"]
]);
const REDNI_RIJEC = new Map([
  ["prva", "rb1"], ["druga", "rb2"], ["treca", "rb3"], ["cetvrta", "rb4"], ["peta", "rb5"]
]);

// Redni broj postaje redni broj samo ako ISPRED VRSTE ŠKOLE stoji. Bez tog uvjeta je svaka
// znamenka 1–5 bilo gdje u poruci dobivala token iznad DISTINCTIVE_IDF, pa je posjetitelj
// koji je školu imenovao točno dobivao "Na koju školu mislite?" — mjereno je padalo 19 od
// 50 realnih kombinacija škola × formulacija, među njima "za 1. i 2. razred Gimnazija
// Daruvar" (roditelj dvoje djece, zadnji tjedan srpnja), "Gimnazija Daruvar, 2. godina",
// "do 1.9." i "imam 2 djeteta". RAZRED_FRAZA te slučajeve ne može dohvatiti jer riječi
// "razred" ondje nema.
//
// Vrste škole su izmjerene iz korpusa, ne pogođene: "škola" 229/281 naziva, "srednja" 91,
// "gimnazija" 51, "centar" 4 — to su jedine imenice koje u ovoj bazi imenuju ustanovu.
// Provjeravamo po korijenu jer upit dolazi u padežu ("3. gimnaziju Osijek").
const VRSTE_SKOLE = ["skol", "srednj", "gimnazij", "centar", "centr"];

// Koliko tokena unaprijed smije biti vrsta škole. Dva dometa, jer dva zapisa nose različit
// rizik — oboje izmjereno nad korpusom, ne procijenjeno:
//
// ZNAMENKE, domet 1: nijedan od 281 naziva ne sadrži arapsku znamenku. Arapski oblik je
// isključivo ono što posjetitelj utipka umjesto rimskog/riječnog ("3. gimnazija Osijek"),
// a to je uvijek neposredno ispred vrste škole. Strogi domet zato ne košta nijedan naziv,
// a upravo znamenke su te koje se u običnom tekstu pojavljuju kao datum, količina i razred.
// RIJEČI I RIMSKI, domet 3: u nazivima redni broj stoji na udaljenosti 1 ("Druga gimnazija
// Varaždin", sva tri rimska osječka), 2 ("Prva privatna gimnazija Varaždin") i 3 ("Prva
// riječka hrvatska gimnazija", "Prva sušačka hrvatska gimnazija u Rijeci") — najveća
// izmjerena udaljenost je 3, pa je to domet. Strogi domet 1 bi ta tri naziva slomio.
// Domet 3 usput izbacuje "Ivana Pavla II Zadar" (iza "ii" nema vrste škole uopće) i
// "treća stvar, treba mi popis…" (udaljenost 6).
const DOMET_ZNAMENKA = 1;
const DOMET_RIJEC = 3;

// Rimski oblik prepoznajemo PRIJE normalizacije, dok točka još postoji. Bez točke bi
// jednoslovni "i" postao redni broj u svakoj drugoj rečenici — to je najčešća hrvatska
// riječ (veznik), a isto vrijedi i za "v" (prijedlog u starijem/regionalnom pisanju).
// Dvoslovni i troslovni oblici ("ii", "iii", "iv") nisu hrvatske riječi pa ih hvatamo i
// bez točke ("II gimnazija Osijek" je čest zapis).
// Granice riječi pišemo lookaroundom nad \p{L}\p{N}, ne s \b: \b poznaje samo ASCII, pa
// mu je svako hrvatsko dijakritičko slovo granica. S \b bi "Ivšić" pukao na "Iv" + "šić"
// (redni broj 4 usred prezimena!), a svaka riječ koja završava na "ći."/"či." — "doći.",
// "moći." — dala bi redni broj 1 na kraju rečenice. Zamjena ide PRIJE normalizeForSearch,
// dok dijakritika još postoji, pa je to stvarni ulaz, ne teoretski.
const RIMSKI_S_TOCKOM = /(?<![\p{L}\p{N}])(i{1,3}|iv|v)\.(?![\p{L}\p{N}])/giu;
const RIMSKI_BEZ_TOCKE = /(?<![\p{L}\p{N}])(iii|ii|iv)(?![\p{L}\p{N}])/giu;

// Broj razreda koji upit traži uklanjamo iz teksta PRIJE prepoznavanja škole. Nakon
// normalizacije rednih brojeva "za 2. razred Gimnazija Daruvar" daje token rb2, koji
// je za matcher neraspoznatljiv od rednog broja u nazivu — "Druga gimnazija Varaždin"
// i "II. gimnazija Osijek" tada postaju suparnici koji pokrivaju obilježje koje pobjednik
// nema, pa imenujeTudeObiljezje obori inače točan pogodak na "nejasno". Razred ionako
// zasebno čita parseRazred, pa ga je čisto ukloniti na izvoru umjesto se oslanjati na
// to da ga gate-ovi nizvodno apsorbiraju.
// Oblici prate parseRazred: brojčani ("2. razred", "1.a razred", "3 razreda"), rimski
// marker (nakon zamjene: "ri2 razred") i riječima ("drugom razredu").
// Ovdje muški i srednji rod NAMJERNO ostaju, za razliku od REDNI_KANONSKI: "drugi razred"
// je posve običan način da se razred imenuje. Popis prati parseRazred, ne REDNI_KANONSKI —
// dvije liste imaju različit posao i ne treba ih izjednačavati.
const RAZRED_FRAZA = new RegExp(
  "\\b(?:ri[1-5]|[1-5]|prvi|prvom|prvog|prva|drugi|drugom|drugog|druga"
  + "|treci|trecem|treceg|treca|cetvrti|cetvrtom|cetvrtog|cetvrta|peti|petom|petog|peta)"
  + "\\s*(?:[a-e]\\s+)?razred\\w*",
  "g"
);

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

// Widget renderira markdown link regexom /\((https?:\/\/[^\s)]+)\)/ (public/index.html).
// Sve što tome ne odgovara korisnik vidi kao goli tekst — npr. interna putanja
// "ručni unos: tehnicka-sb/…xlsx" iz izvoznog pipelinea. Izvozna skripta takve zapise
// više ne propušta, ali filtriramo i ovdje: ako podaci ikad regresiraju, odgovor pada
// na "popis još nije objavljen" (uz link na stranicu škole) umjesto na šum.
const VALJAN_URL = /^https?:\/\/[^\s)]+$/;

let index = null;

function oznaciRimskeRedneBrojeve(text) {
  return String(text || "")
    .replace(RIMSKI_S_TOCKOM, (_, oblik) => ` ${RIMSKI_MARKER[oblik.toLowerCase()]} `)
    .replace(RIMSKI_BEZ_TOCKE, (_, oblik) => ` ${RIMSKI_MARKER[oblik.toLowerCase()]} `);
}

// Stoji li unutar dometa iza tokena i neka vrsta škole. Prazni tokeni (ostatak nakon
// uklanjanja fraze razreda) se NE preskaču — svaki troši domet, pa je pravilo strože,
// a ne labavije, na upitima koji su prošli kroz RAZRED_FRAZA.
function uzVrstuSkole(tokeni, i, domet) {
  for (let j = i + 1; j <= i + domet && j < tokeni.length; j++) {
    if (VRSTE_SKOLE.some((korijen) => tokeni[j].startsWith(korijen))) return true;
  }
  return false;
}

function kanonskiRedniBroj(token, tokeni, i) {
  if (RIMSKI_IZVORNO.has(token)) {
    // Marker uvijek nestaje: ili postane redni broj, ili se vrati u doslovan zapis.
    return uzVrstuSkole(tokeni, i, DOMET_RIJEC)
      ? `rb${token.slice(2)}`
      : RIMSKI_IZVORNO.get(token);
  }
  const znamenka = REDNI_ZNAMENKA.get(token);
  if (znamenka) return uzVrstuSkole(tokeni, i, DOMET_ZNAMENKA) ? znamenka : token;
  const rijec = REDNI_RIJEC.get(token);
  if (rijec) return uzVrstuSkole(tokeni, i, DOMET_RIJEC) ? rijec : token;
  return token;
}

// bezRazreda se koristi samo za tekst upita — naziv škole nikad ne sadrži "razred".
function tokenize(value, { bezRazreda = false } = {}) {
  let norm = normalizeForSearch(oznaciRimskeRedneBrojeve(value));
  if (bezRazreda) norm = norm.replace(RAZRED_FRAZA, " ");
  // Kanonizacija ide PRIJE filtra duljine: "1" i "3" su prekratki, ali rb1/rb3 nisu —
  // upravo to arapskom obliku vraća glas koji je dosad tiho nestajao. Nekanonizirana
  // znamenka ostaje jednoznakovna pa je filtar odbaci, kao i prije ovog rada.
  const tokeni = norm.split(" ");
  return tokeni
    .map((token, i) => kanonskiRedniBroj(token, tokeni, i))
    .filter((token) => token.length >= 2);
}

function loadIndex(filePath = DATA_PATH) {
  if (index) return index;
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const skole = raw.skole.map((skola) => ({
    ...skola,
    dokumenti: (skola.dokumenti || []).filter((dokument) => VALJAN_URL.test(String(dokument.url || ""))),
    tokens: [...new Set(tokenize(skola.naziv))]
  }));

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

// Pokriva li naziv škole zadani token upita (točno, padežom ili tipfelerom).
function pokrivaToken(skola, queryToken) {
  return skola.tokens.some((schoolToken) => (
    schoolToken === queryToken
    || matchesByPrefix(queryToken, schoolToken)
    || matchesByTypo(queryToken, schoolToken)
  ));
}

function scoreSchool(skola, queryTokens, idf) {
  let score = 0;
  // Koliko je RAZLIČITIH tokena naziva upit pogodio — vidi MIN_MATCHED_TOKENS.
  let matchedTokens = 0;
  // Je li upit pogodio barem jedan token koji nosi identitet škole (grad ili vlastito
  // ime), a ne samo tip i redni broj — vidi NERAZLIKOVNI_TOKENI.
  let razlikovniPogodak = false;
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
    if (matched) {
      matchedTokens += 1;
      if (!NERAZLIKOVNI_TOKENI.has(schoolToken)) razlikovniPogodak = true;
    }
    if (!matched && weight > DISTINCTIVE_IDF) {
      uncoveredDistinctive = true;
    }
  }
  return {
    score,
    coverage: skola.maxScore ? score / skola.maxScore : 0,
    matchedTokens,
    razlikovniPogodak,
    uncoveredDistinctive
  };
}

function rankSchools(
  text,
  { minCoverage = MIN_COVERAGE, minScore = MIN_SCORE, minMatched = MIN_MATCHED_TOKENS } = {}
) {
  const idx = loadIndex();
  const queryTokens = tokenize(text, { bezRazreda: true });
  if (!queryTokens.length) return [];
  return idx.skole
    .map((skola) => ({ school: skola, ...scoreSchool(skola, queryTokens, idx.idf) }))
    .filter((row) => (
      row.coverage >= minCoverage
      && row.score >= minScore
      && row.matchedTokens >= minMatched
    ))
    .sort((a, b) => b.score - a.score);
}

// Druga strana simetričnog gate-a: imenuje li upit prepoznatljiv token koji pobjednik
// nema u nazivu, a neki drugi kandidat ga ima. Bez ove provjere škola čiji je skup tokena
// podskup konkurentskog uvijek preživi kao "confident" (nema nepokrivenih tokena), dok
// konkurent ispadne — pa ostane sama, MARGIN nema s čime usporediti i korisnik dobije
// popis krive škole ("Isusovačka gimnazija Osijek" → "I. gimnazija Osijek", jer tokenize
// odbacuje "I." kao prekratak token).
function imenujeTudeObiljezje(best, suparnici, queryTokens, idf) {
  return queryTokens.some((queryToken) => {
    const weight = idf.get(queryToken);
    if (!(weight > DISTINCTIVE_IDF)) return false;
    if (pokrivaToken(best.school, queryToken)) return false;
    return suparnici.some((row) => row.school.id !== best.school.id && pokrivaToken(row.school, queryToken));
  });
}

function findSchool(text) {
  // Suparnički skup se namjerno NE prosijava kroz MIN_MATCHED_TOKENS. Škola s jednim
  // pogođenim tokenom ne smije pobijediti, ali smije oboriti tuđu samouvjerenost:
  // na "škola Županja" Gimnazija Županja pogađa samo "Županja", no i dalje je jednako
  // vjerojatna kao Tehnička škola Županja — pobjednika ne smije biti.
  const suparnici = rankSchools(text, { minMatched: 1 });
  const scored = suparnici.filter((row) => row.matchedTokens >= MIN_MATCHED_TOKENS);
  if (!scored.length) return { status: "none" };
  const nejasno = () => ({ status: "ambiguous", candidates: suparnici.slice(0, 3).map((row) => row.school) });

  let best = null;
  if (suparnici.length === 1 && scored[0].coverage >= LONE_SURVIVOR_COVERAGE) {
    // Jedini kandidat u cijelom korpusu, s upitom koji objašnjava većinu njegovog naziva —
    // sigurno je prepoznat i bez pokrivenog prepoznatljivog tokena (vidi LONE_SURVIVOR_COVERAGE).
    // Mora biti JEDINI ukupno, ne samo u "confident" skupu, inače bi npr. "škola Daruvar"
    // (dva kandidata, oba visoke pokrivenosti) lažno pogodio jednog od njih.
    best = scored[0];
  } else {
    // Siguran pogodak smije biti samo škola čiji su svi prepoznatljivi tokeni pokriveni
    // upitom (vidi DISTINCTIVE_IDF) — inače je pobjeda slučajna (npr. grad ima samo jednu
    // "ekonomsku školu" pa upit "ekonomska škola" pogodi tu, bez da je itko spomenuo grad).
    const confident = scored.filter((row) => !row.uncoveredDistinctive);
    if (!confident.length) return nejasno();

    const [prvi, drugi] = confident;
    if (drugi && prvi.score < drugi.score * MARGIN) {
      return { status: "ambiguous", candidates: confident.slice(0, 3).map((row) => row.school) };
    }
    best = prvi;
  }

  // Pogodak koji počiva samo na tipu i rednom broju ("II. gimnazija") ne kaže o kojem je
  // gradu riječ — radije pitamo nego da popis ode u krivi grad (vidi NERAZLIKOVNI_TOKENI).
  if (!best.razlikovniPogodak) return nejasno();

  const idx = loadIndex();
  // Isti tokeni koje je vidio rankSchools — uključujući uklanjanje razreda, inače bi
  // rb-token iz "za 2. razred" ovdje ulovio "tuđe obilježje" koje upit uopće ne imenuje.
  if (imenujeTudeObiljezje(best, suparnici, tokenize(text, { bezRazreda: true }), idx.idf)) return nejasno();
  return { status: "match", school: best.school };
}

const DISCLAIMER = [
  "Napomena: popis je informativnog karaktera i preuzet je iz javno dostupne baze",
  "podataka (stranice škola). Antikvarijat Libar ne odgovara za eventualne netočnosti",
  "ili naknadne izmjene — službeni popis provjerite kod svoje škole."
].join(" ");

// Upit mora spominjati udžbenike/popis da gate uopće opali. Bez ovoga bi
// "radim u Gimnaziji Daruvar" oteo razgovor.
// "knjig" je namjerno izbačen: "knjiga/knjige/knjigu" su svakodnevne riječi u pitanjima
// o dostavi, narudžbi i otkupu ("Koliko dugo traje dostava knjiga?", "Kupio sam knjigu i
// stigla je druga") pa je taj okidač otimao postojeće upite, a nije donosio ništa —
// tko traži popis, napiše "popis" ili "udžbenik".
const TEXTBOOK_RE = /\budzbenik|\bpopis/;

// Blaži prag za "jeste li mislili" — popušta se samo pokrivenost, nikad
// MIN_SCORE, da nedovoljno određen upit ne izvuče nasumične kandidate.
const RELAXED_COVERAGE = 0.34;

const RAZRED_RIJECI = {
  prvi: "1", prvom: "1", prvog: "1", prva: "1",
  drugi: "2", drugom: "2", drugog: "2", druga: "2",
  treci: "3", trecem: "3", treceg: "3", treca: "3",
  cetvrti: "4", cetvrtom: "4", cetvrtog: "4", cetvrta: "4",
  peti: "5", petom: "5", petog: "5", peta: "5"
};

function parseRazred(text) {
  const norm = normalizeForSearch(text);
  const brojcani = norm.match(/\b([1-5])\s*[a-e]?\s*razred/);
  if (brojcani) return brojcani[1];
  const rijecima = norm.match(
    /\b(prvi|prvom|prvog|prva|drugi|drugom|drugog|druga|treci|trecem|treceg|treca|cetvrti|cetvrtom|cetvrtog|cetvrta|peti|petom|petog|peta)\s+razred/
  );
  if (rijecima) return RAZRED_RIJECI[rijecima[1]];
  return null;
}

function markdownLink(label, url) {
  return `- [${label}](${url})`;
}

function safeAnswer(customerMessage, reason) {
  return {
    type: "safe_answer",
    customerMessage,
    stateTag: "ai_active",
    reason,
    source: "textbook_list",
    links: [],
    extraTags: []
  };
}

function buildListAnswer(skola, razred, godina) {
  const dokumenti = skola.dokumenti.filter((d) => d.razred === razred || d.razred === null);
  if (!dokumenti.length) return buildNoRazredAnswer(skola, razred, godina);

  const uvod = dokumenti.length > 1
    ? `${skola.naziv} objavljuje popis po smjerovima. Evo svih popisa za ${razred}. razred (${godina}):`
    : `Evo popisa udžbenika za ${razred}. razred — ${skola.naziv} (${godina}):`;

  const redci = [uvod, "", ...dokumenti.map((d) => markdownLink(d.oznaka, d.url)), "", DISCLAIMER];
  return safeAnswer(redci.join("\n"), "textbook_list");
}

function buildNoRazredAnswer(skola, razred, godina) {
  const redci = [
    `${skola.naziv} — nemam popis udžbenika za ${razred}. razred (${godina}). Škole ih objavljuju tijekom ljeta, pa pokušajte ponovno za koji dan.`,
    ""
  ];
  if (skola.stranica) redci.push(markdownLink("Stranica škole s popisima", skola.stranica));
  redci.push(markdownLink("Udžbenike možete potražiti u našem webshopu", LINKS.buyBooks.url));
  return safeAnswer(redci.join("\n"), "textbook_no_razred");
}

function buildNoListAnswer(skola, godina) {
  const redci = [
    `${skola.naziv} — popis udžbenika za ${godina} još nije objavljen. Škole ih objavljuju tijekom ljeta, pa pokušajte ponovno za koji dan.`,
    ""
  ];
  if (skola.stranica) redci.push(markdownLink("Stranica škole s popisima", skola.stranica));
  redci.push(markdownLink("Udžbenike možete potražiti u našem webshopu", LINKS.buyBooks.url));
  return safeAnswer(redci.join("\n"), "textbook_no_list");
}

function buildAskRazredAnswer(skola, session) {
  session.textbookSchoolId = skola.id;
  const razredi = [...new Set(skola.dokumenti.map((d) => d.razred).filter(Boolean))].sort();
  const popisRazreda = razredi.length ? ` Imam popise za: ${razredi.map((r) => `${r}. razred`).join(", ")}.` : "";
  return safeAnswer(
    `${skola.naziv} — za koji razred trebate popis udžbenika?${popisRazreda}`,
    "textbook_need_razred"
  );
}

function buildCandidatesAnswer(candidates, session, uvod, reason) {
  delete session.textbookSchoolId;
  const redci = [
    uvod,
    "",
    ...candidates.map((skola) => `- ${skola.naziv}`),
    "",
    "Napišite puni naziv škole i razred, pa Vam šaljem popis."
  ];
  return safeAnswer(redci.join("\n"), reason);
}

function buildTextbookOutcome(userMessage, session = {}) {
  const idx = loadIndex();
  const razred = parseRazred(userMessage);
  const norm = normalizeForSearch(userMessage);

  // Nastavak razgovora: školu smo zapamtili, korisnik je dopisao razred (ili spomenuo
  // posve drugu školu). Grana odgovara za sva tri moguća ishoda findSchool-a ovdje —
  // ne smije propasti do TEXTBOOK_RE gate-a ispod, jer bi to za pouzdan pogodak bez
  // riječi "popis"/"udžbenik" izgubilo kontekst i vratilo null, a za "ambiguous" bi
  // moglo pasti natrag na zapamćenu školu i odgovoriti krivim popisom.
  if (session.textbookSchoolId) {
    const zapamcena = session.textbookSchoolId;
    // Marker vrijedi samo za sljedeću poruku — inače bi kasniji spomen razreda
    // u nevezanom razgovoru izvukao popis niotkuda.
    delete session.textbookSchoolId;
    const pogodakUPoruci = findSchool(userMessage);

    if (pogodakUPoruci.status === "match") {
      // Poruka sama pouzdano imenuje (drugu) školu — ta škola pobjeđuje, bez obzira
      // spominje li poruka riječi "popis"/"udžbenik" (razgovor je već u tijeku).
      const skola = pogodakUPoruci.school;
      if (!skola.dokumenti.length) return buildNoListAnswer(skola, idx.godina);
      if (!razred) return buildAskRazredAnswer(skola, session);
      return buildListAnswer(skola, razred, idx.godina);
    }

    if (pogodakUPoruci.status === "ambiguous") {
      // Poruka imenuje školu koju matcher ne može odrediti (npr. "Ekonomska škola"
      // bez grada) — nikad ne padati natrag na zapamćenu školu, to bi bio siguran
      // odgovor za pogrešnu školu.
      return buildCandidatesAnswer(
        pogodakUPoruci.candidates, session, "Na koju školu mislite?", "textbook_ambiguous_school"
      );
    }

    // status === "none": poruka ne imenuje nijednu školu — pravi nastavak razgovora,
    // korisnik je odgovorio samo razredom.
    if (razred) {
      const skola = idx.skole.find((s) => s.id === zapamcena);
      if (skola) {
        return skola.dokumenti.length
          ? buildListAnswer(skola, razred, idx.godina)
          : buildNoListAnswer(skola, idx.godina);
      }
    }
  }

  if (!TEXTBOOK_RE.test(norm)) return null;

  const pogodak = findSchool(userMessage);

  if (pogodak.status === "ambiguous") {
    return buildCandidatesAnswer(
      pogodak.candidates, session, "Na koju školu mislite?", "textbook_ambiguous_school"
    );
  }

  if (pogodak.status === "none") {
    // Strogi prag nije prošao, a upit očito traži popis — vjerojatno je naziv
    // upisan nepotpuno ili s greškom. Ponudi najbliže umjesto tihog odustajanja.
    const blizi = rankSchools(userMessage, { minCoverage: RELAXED_COVERAGE }).slice(0, 3);
    if (!blizi.length) return null;
    return buildCandidatesAnswer(
      blizi.map((row) => row.school), session,
      "Nisam siguran na koju školu mislite. Jeste li mislili na neku od ovih?",
      "textbook_did_you_mean"
    );
  }

  const skola = pogodak.school;
  if (!skola.dokumenti.length) return buildNoListAnswer(skola, idx.godina);
  if (!razred) return buildAskRazredAnswer(skola, session);
  return buildListAnswer(skola, razred, idx.godina);
}

module.exports = {
  loadIndex,
  rankSchools,
  findSchool,
  parseRazred,
  buildTextbookOutcome,
  DISCLAIMER,
  // Izvezeno zbog kanarinca u testovima: baza se osvježava svako ljeto i test mora moći
  // provjeriti da nijedan novi naziv ne unese redni broj izvan ovog skupa.
  NERAZLIKOVNI_TOKENI
};
