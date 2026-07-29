const { describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const {
  findSchool,
  parseRazred,
  buildTextbookOutcome,
  loadIndex,
  DISCLAIMER,
  NERAZLIKOVNI_TOKENI
} = require("../services/textbookListService");
const { GENERATED_SCENARIOS } = require("./e2e-generated.test.js");

describe("textbookListService", () => {
  describe("findSchool", () => {
    it("prepoznaje školu po točnom nazivu", () => {
      const r = findSchool("trebam popis udžbenika za Gimnaziju Daruvar");
      assert.strictEqual(r.status, "match");
      assert.strictEqual(r.school.naziv, "Gimnazija Daruvar");
    });

    it("prepoznaje školu bez dijakritike", () => {
      const r = findSchool("popis udzbenika medicinska skola bjelovar");
      assert.strictEqual(r.status, "match");
      assert.strictEqual(r.school.naziv, "Medicinska škola Bjelovar");
    });

    it("prepoznaje školu bez obzira na velika slova i crtice", () => {
      const r = findSchool("POPIS UDŽBENIKA — GIMNAZIJA DARUVAR");
      assert.strictEqual(r.status, "match");
      assert.strictEqual(r.school.naziv, "Gimnazija Daruvar");
    });

    it("podnosi padež u nazivu grada", () => {
      const r = findSchool("popis udžbenika za gimnaziju u Daruvaru");
      assert.strictEqual(r.status, "match");
      assert.strictEqual(r.school.naziv, "Gimnazija Daruvar");
    });

    it("podnosi tipfeler u nazivu", () => {
      const r = findSchool("popis udzbenika gimanzija daruvar");
      assert.strictEqual(r.status, "match");
      assert.strictEqual(r.school.naziv, "Gimnazija Daruvar");
    });

    it("podnosi tipfeler u nazivu grada", () => {
      const r = findSchool("popis udzbenika medicinska skola bjelovr");
      assert.strictEqual(r.status, "match");
      assert.strictEqual(r.school.naziv, "Medicinska škola Bjelovar");
    });

    it("ne pogađa školu iz generičnog upita", () => {
      assert.strictEqual(findSchool("kako naručiti udžbenike?").status, "none");
      assert.strictEqual(findSchool("otkupljujete li udžbenike?").status, "none");
      assert.strictEqual(findSchool("koliko košta dostava?").status, "none");
    });

    it("ne pogađa školu iz same riječi gimnazija", () => {
      assert.notStrictEqual(findSchool("trebam popis za gimnaziju").status, "match");
    });

    it("nema nijedan naziv škole s pokvarenim dijakriticima", () => {
      const r = findSchool("Gimnazija Antuna Vrančića Šibenik");
      assert.strictEqual(r.status, "match");
      assert.ok(!r.school.naziv.includes("?"), `naziv sadrži upitnik: ${r.school.naziv}`);
    });

    it("ne pogađa školu iz nedovoljno određenog upita (grad s više škola istog tipa)", () => {
      // Šibenik ima desetak srednjih škola; "srednja škola Šibenik" ne otkriva o kojoj je riječ
      // — bez gate-a na prepoznatljivim tokenima ovo bi lažno samouvjereno pogodilo jednu od njih.
      assert.notStrictEqual(findSchool("srednja skola Sibenik").status, "match");
    });

    it("ne pogađa školu iz upita bez grada (tip škole sam po sebi nije dovoljan)", () => {
      // "ekonomska škola" postoji u desetak gradova; ako upit ne kaže koji grad, ne smijemo
      // pogoditi samo zato što je jedna škola slučajno jedina koja prijeđe prag pokrivenosti.
      assert.notStrictEqual(findSchool("ekonomska skola").status, "match");
    });

    it("prepoznaje školu po vlastitom imenu bez grada, kad je jedini kandidat u korpusu", () => {
      const r = findSchool("gimnazija Antuna Vrancica");
      assert.strictEqual(r.status, "match");
      assert.strictEqual(r.school.naziv, "Gimnazija Antuna Vrančića Šibenik");
    });

    it("prepoznaje školu po dugom vlastitom imenu bez grada, kad je jedini kandidat u korpusu", () => {
      const r = findSchool("biskupijska klasicna gimnazija rudjera boskovica");
      assert.strictEqual(r.status, "match");
      assert.strictEqual(r.school.naziv, "Biskupijska klasična gimnazija Ruđera Boškovića Dubrovnik");
    });

    it("ne miješa 'Ivana' s nepovezanim gradom 'Ivanec' zbog labavog prefiksa", () => {
      // "ivana" i "ivanec" dijele samo prva 4 od 5-6 znakova — to nije padež iste riječi,
      // već dvije različite riječi koje se slučajno podudaraju na početku.
      const r = findSchool("Srednja škola Ivana Meštrovića");
      assert.strictEqual(r.status, "match");
      assert.notStrictEqual(r.school.naziv, "Srednja škola Ivanec");
      assert.strictEqual(r.school.naziv, "Srednja škola Ivana Meštrovića Drniš");
    });

    it("ne miješa 'Petra' s nepovezanim gradom 'Petrinja' zbog labavog prefiksa", () => {
      const r = findSchool("Srednja škola Petra Šegedina");
      assert.strictEqual(r.status, "match");
      assert.notStrictEqual(r.school.naziv, "Srednja škola Petrinja");
      assert.strictEqual(r.school.naziv, "Srednja škola Petra Šegedina Korčula");
    });

    // Škola čiji je skup tokena podskup konkurentskog uvijek prolazi jednostrani gate
    // ("svi moji prepoznatljivi tokeni su pokriveni"), a konkurent na njemu pada — pa
    // ostane sama i pobijedi bez usporedbe. Upit koji imenuje nešto prepoznatljivo što
    // pobjednik nema, a suparnik ima, mora završiti pitanjem, ne krivim popisom.
    // ("Prvu hrvatsku gimnaziju u Rijeci" ostaje poznata iznimka: razlikovni token
    // "sušačka" upit uopće ne spominje, pa ga nema po čemu razlučiti — vidi izvještaj.)
    const PODSKUP_UPITI = [
      ["popis udzbenika Isusovacka gimnazija Osijek 1. razred", "I. gimnazija Osijek"],
      ["popis udzbenika Katolicka gimnazija Pozega 1. razred", "Gimnazija Požega"],
      ["popis udzbenika Srednja skola Ivanic Grad 1. razred", "Srednja škola Ivanec"],
      ["popis udzbenika klasicna gimnazija Osijek 1. razred", "I. gimnazija Osijek"],
      ["popis udzbenika Biskupijska gimnazija Rudjera Boskovica Dubrovnik", "Gimnazija Dubrovnik"]
    ];

    for (const [upit, kriva] of PODSKUP_UPITI) {
      it(`pita umjesto da pošalje "${kriva}" na: ${upit}`, () => {
        // Tvrdimo točan ishod, ne samo "nije ta škola" — inače bi test prošao i da kod
        // regresira na neku TREĆU krivu školu, ili da se ova preimenuje sljedeće ljeto.
        const r = findSchool(upit);
        assert.strictEqual(
          r.status,
          "ambiguous",
          `očekivano pitanje, dobiveno ${r.status}${r.school ? `: ${r.school.naziv}` : ""}`
        );
      });
    }

    // Redni broj razlikuje škole unutar grada i ne kaže ništa o gradu. Par je nerazdvojiv:
    // ispravak koji ušutka Split, a usput obori Osijek, nije ispravak.
    const RIMSKI_IZVAN_KORPUSA = [
      "popis udžbenika za III. gimnaziju Split",
      "popis udžbenika II. gimnazija Zagreb",
      "popis udžbenika II. gimnazija Čakovec",
      "popis udžbenika III. gimnazija Solin",
      "popis udžbenika II. gimnazija Sinj",
      "popis udžbenika III. gimnazija Trogir",
      "popis udžbenika II. gimnazija Imotski",
      "popis udžbenika III. gimnazija Sesvete",
      "popis udžbenika II. gimnazija Zaprešić"
    ];

    for (const upit of RIMSKI_IZVAN_KORPUSA) {
      it(`ne šalje popis osječke škole na: ${upit}`, () => {
        const r = findSchool(upit);
        assert.notStrictEqual(
          r.status,
          "match",
          `siguran pogodak u krivom gradu: ${r.school && r.school.naziv}`
        );
      });
    }

    const RIMSKI_U_KORPUSU = [
      ["popis udžbenika I. gimnazija Osijek", "I. gimnazija Osijek"],
      ["popis udžbenika II. gimnazija Osijek", "II. gimnazija Osijek"],
      ["popis udžbenika III. gimnazija Osijek", "III. gimnazija Osijek"]
    ];

    for (const [upit, ocekivana] of RIMSKI_U_KORPUSU) {
      it(`i dalje prepoznaje: ${upit}`, () => {
        const r = findSchool(upit);
        assert.strictEqual(r.status, "match");
        assert.strictEqual(r.school.naziv, ocekivana);
      });
    }

    // Redni broj u nazivu piše se rimski ("III. gimnazija Osijek") ili riječima
    // ("Druga gimnazija Varaždin"), a posjetitelji tipkaju arapski ("3. gimnazija
    // Osijek"). Sva tri oblika svode se na isti kanonski token, pa moraju dati istu
    // školu. Prije toga je arapski oblik tiho nestajao (token "3" prekratak), a
    // "I. gimnazija Osijek" je bila univerzalni donor koja je odnosila SVAKI ordinalni
    // upit u Osijeku — najvjerojatnijem gradu upita, jer je to grad antikvarijata.
    const REDNI_BROJ_OBLICI = [
      ["popis udžbenika 1. gimnazija Osijek", "I. gimnazija Osijek"],
      ["popis udžbenika I. gimnazija Osijek", "I. gimnazija Osijek"],
      ["popis udžbenika prva gimnazija Osijek", "I. gimnazija Osijek"],
      ["popis udžbenika 2. gimnazija Osijek", "II. gimnazija Osijek"],
      ["popis udžbenika II. gimnazija Osijek", "II. gimnazija Osijek"],
      ["popis udžbenika druga gimnazija Osijek", "II. gimnazija Osijek"],
      ["popis udžbenika 3. gimnazija Osijek", "III. gimnazija Osijek"],
      ["popis udžbenika III. gimnazija Osijek", "III. gimnazija Osijek"],
      ["popis udžbenika treća gimnazija Osijek", "III. gimnazija Osijek"],
      ["popis udžbenika 2. gimnazija Varaždin", "Druga gimnazija Varaždin"],
      ["popis udžbenika Druga gimnazija Varaždin", "Druga gimnazija Varaždin"],
      // Rimski broj bez točke i pisan malim slovima — oba su česta u chatu.
      ["popis udzbenika II gimnazija Osijek", "II. gimnazija Osijek"],
      ["popis udzbenika iii. gimnazija osijek", "III. gimnazija Osijek"]
    ];

    for (const [upit, ocekivana] of REDNI_BROJ_OBLICI) {
      it(`redni broj u bilo kojem obliku vodi na istu školu: ${upit}`, () => {
        const r = findSchool(upit);
        assert.strictEqual(
          r.status,
          "match",
          `očekivan pogodak, dobiveno ${r.status}`
        );
        assert.strictEqual(r.school.naziv, ocekivana);
      });
    }

    // Par uz RIMSKI_IZVAN_KORPUSA: normalizacija rednog broja ne smije arapskom ni
    // riječnom obliku dati ono što rimskom nikad nije bilo dopušteno — redni broj
    // razlikuje škole UNUTAR grada i o gradu ne govori ništa.
    const REDNI_BROJ_IZVAN_KORPUSA = [
      "popis udžbenika 3. gimnazija Split",
      "popis udžbenika treća gimnazija Split",
      "popis udžbenika 2. gimnazija Zagreb",
      "popis udžbenika druga gimnazija Zagreb",
      "popis udžbenika 2. gimnazija Čakovec",
      "popis udžbenika 3. gimnazija Solin",
      "popis udžbenika 2. gimnazija Sinj",
      "popis udžbenika 3. gimnazija Trogir",
      "popis udžbenika 2. gimnazija Imotski",
      "popis udžbenika 3. gimnazija Sesvete",
      "popis udžbenika 2. gimnazija Zaprešić"
    ];

    for (const upit of REDNI_BROJ_IZVAN_KORPUSA) {
      it(`ne šalje popis škole iz korpusa na: ${upit}`, () => {
        const r = findSchool(upit);
        assert.notStrictEqual(
          r.status,
          "match",
          `siguran pogodak u krivom gradu: ${r.school && r.school.naziv}`
        );
      });
    }

    // Granica riječi za rimski broj mora poznavati dijakritiku: s ASCII \b bi "Ivšić"
    // pukao na "Iv" (= redni broj 4) + "šić", a svaka riječ koja završi na "ći." bi na
    // kraju rečenice ispalila redni broj 1.
    it("dijakritika ne raspada naziv škole na lažni redni broj", () => {
      const r = findSchool("popis udžbenika Srednja škola Stjepan Ivšić Orahovica");
      assert.strictEqual(r.status, "match");
      assert.match(r.school.naziv, /Ivšić/);
    });

    it("riječ koja završava na 'ći.' ne postaje redni broj", () => {
      assert.strictEqual(buildTextbookOutcome("Kada mogu doći po knjige.", {}), null);
      assert.strictEqual(buildTextbookOutcome("Nije moguće doći.", {}), null);
    });
  });

  describe("parseRazred", () => {
    it("čita brojčani oblik", () => {
      assert.strictEqual(parseRazred("popis za 2. razred"), "2");
      assert.strictEqual(parseRazred("3 razred gimnazije"), "3");
      assert.strictEqual(parseRazred("popis za 1.a razred"), "1");
    });

    it("čita riječima pisan oblik", () => {
      assert.strictEqual(parseRazred("u drugom razredu"), "2");
      assert.strictEqual(parseRazred("prvi razred"), "1");
      assert.strictEqual(parseRazred("četvrti razred"), "4");
    });

    it("vraća null kad razreda nema", () => {
      assert.strictEqual(parseRazred("trebam popis udžbenika"), null);
      assert.strictEqual(parseRazred("imam 3 udžbenika za otkup"), null);
    });
  });

  describe("buildTextbookOutcome", () => {
    it("vraća null za upite bez škole — postojeći tok ostaje netaknut", () => {
      assert.strictEqual(buildTextbookOutcome("Kako naručiti udžbenike?", {}), null);
      assert.strictEqual(buildTextbookOutcome("Otkupljujete li udžbenike?", {}), null);
      assert.strictEqual(buildTextbookOutcome("Koliko košta dostava?", {}), null);
      assert.strictEqual(buildTextbookOutcome("Pozdrav!", {}), null);
    });

    it("vraća null kad je škola prepoznata ali upit nije o popisu", () => {
      assert.strictEqual(buildTextbookOutcome("radim u Gimnaziji Daruvar", {}), null);
    });

    it("šalje link na popis za školu i razred", () => {
      const outcome = buildTextbookOutcome("popis udžbenika Gimnazija Daruvar 2. razred", {});
      assert.strictEqual(outcome.type, "safe_answer");
      assert.strictEqual(outcome.source, "textbook_list");
      assert.strictEqual(outcome.stateTag, "ai_active");
      assert.match(outcome.customerMessage, /Gimnazija Daruvar/);
      assert.match(outcome.customerMessage, /\[[^\]]+\]\(https:\/\/[^)]+\)/);
    });

    it("uz svaki popis prilaže disclaimer", () => {
      const outcome = buildTextbookOutcome("popis udžbenika Gimnazija Daruvar 2. razred", {});
      assert.ok(outcome.customerMessage.includes(DISCLAIMER));
      assert.match(DISCLAIMER, /informativnog karaktera/);
      assert.match(DISCLAIMER, /ne odgovara za eventualne netočnosti/);
    });

    it("izlistava sve smjerove kad ih škola ima više", () => {
      const outcome = buildTextbookOutcome("popis udžbenika Medicinska škola Bjelovar 1. razred", {});
      const linkovi = outcome.customerMessage.match(/\[[^\]]+\]\(https:\/\/[^)]+\)/g) || [];
      assert.ok(linkovi.length >= 3, `očekivano više linkova, dobiveno ${linkovi.length}`);
    });

    it("nudi kandidate kad je naziv škole nepotpun ili pogrešno upisan", () => {
      const outcome = buildTextbookOutcome("trebam popis udžbenika za medicinsku u Bjelovaru", {});
      assert.ok(outcome, "očekivan je odgovor s kandidatima");
      assert.ok(
        ["textbook_did_you_mean", "textbook_ambiguous_school", "textbook_need_razred"].includes(outcome.reason),
        `neočekivan reason: ${outcome.reason}`
      );
      assert.match(outcome.customerMessage, /Bjelovar/);
    });

    it("pita za razred kad ga upit ne sadrži i pamti školu u sesiji", () => {
      const session = {};
      const outcome = buildTextbookOutcome("popis udžbenika Gimnazija Daruvar", session);
      assert.strictEqual(outcome.reason, "textbook_need_razred");
      assert.match(outcome.customerMessage, /razred/i);
      assert.ok(session.textbookSchoolId, "škola nije zapamćena u sesiji");
    });

    it("nastavlja iz sesije kad korisnik odgovori samo razredom", () => {
      const session = {};
      buildTextbookOutcome("popis udžbenika Gimnazija Daruvar", session);
      const outcome = buildTextbookOutcome("2. razred", session);
      assert.strictEqual(outcome.reason, "textbook_list");
      assert.match(outcome.customerMessage, /Gimnazija Daruvar/);
      // Marker se troši na ulazu, ali ga poslani popis postavlja iznova — zbog pitanja
      // za drugo dijete ("a 3. razred?"). Lanac je i dalje omeđen: vrijedi točno jednu
      // poruku, a poruka koja nije nastavak ga briše (provjereno odmah ispod).
      assert.strictEqual(session.textbookSchoolId, "gimnazija-daruvar", "škola nije zapamćena za sljedeću poruku");
      assert.strictEqual(buildTextbookOutcome("hvala", session), null);
      assert.strictEqual(session.textbookSchoolId, undefined, "sesija nije očišćena");
    });

    it("kaže da popis još nije objavljen kad škola nema dokumenata", () => {
      // Uzmi prvu školu bez dokumenata koju matcher pouzdano prepoznaje po nazivu.
      const bez = loadIndex().skole.find((s) => {
        if (s.dokumenti.length) return false;
        const pogodak = findSchool(s.naziv);
        return pogodak.status === "match" && pogodak.school.id === s.id;
      });
      assert.ok(bez, "u podacima nema nijedne prepoznatljive škole bez popisa");

      const outcome = buildTextbookOutcome(`popis udžbenika ${bez.naziv}`, {});
      assert.strictEqual(outcome.reason, "textbook_no_list");
      assert.match(outcome.customerMessage, /još nije objavljen/i);
      assert.ok(!/\.pdf|\.docx/i.test(outcome.customerMessage), "poslan je link na dokument");
    });

    it("ne odgovara za zapamćenu školu kad sljedeća poruka imenuje drugu školu", () => {
      const session = {};
      buildTextbookOutcome("popis udžbenika Gimnazija Daruvar", session);
      const outcome = buildTextbookOutcome("Ekonomska škola Pula, 1. razred popis udžbenika", session);
      assert.match(outcome.customerMessage, /Ekonomska škola Pula/);
      assert.doesNotMatch(outcome.customerMessage, /Gimnazija Daruvar/);
    });

    it("gramatički ispravno pita za razred (bez 'u ' + nominativ)", () => {
      const outcome = buildTextbookOutcome("popis udžbenika Gimnazija Daruvar", {});
      assert.doesNotMatch(outcome.customerMessage, /u Gimnazija/);
    });

    it("gramatički ispravno javlja da razred nije objavljen (bez 'Za ' + nominativ)", () => {
      const outcome = buildTextbookOutcome("popis udžbenika Dubrovačka privatna gimnazija 5. razred", {});
      assert.strictEqual(outcome.reason, "textbook_no_razred");
      assert.doesNotMatch(outcome.customerMessage, /Za Dubrovačka/);
    });

    it("gramatički ispravno javlja da popis još nije objavljen (bez 'Za ' + nominativ)", () => {
      const bez = loadIndex().skole.find((s) => {
        if (s.dokumenti.length) return false;
        const pogodak = findSchool(s.naziv);
        return pogodak.status === "match" && pogodak.school.id === s.id;
      });
      assert.ok(bez, "u podacima nema nijedne prepoznatljive škole bez popisa");
      const outcome = buildTextbookOutcome(`popis udžbenika ${bez.naziv}`, {});
      assert.ok(!outcome.customerMessage.startsWith("Za "), `poruka počinje s 'Za ': ${outcome.customerMessage}`);
    });

    it("nastavak sesije: pouzdano imenovana druga škola s okidačem pobjeđuje zapamćenu", () => {
      const session = {};
      buildTextbookOutcome("popis udžbenika Gimnazija Daruvar", session);
      const outcome = buildTextbookOutcome("Ekonomska škola Pula, 3. razred popis udžbenika", session);
      assert.match(outcome.customerMessage, /Ekonomska škola Pula/);
      assert.doesNotMatch(outcome.customerMessage, /Gimnazija Daruvar/);
      assert.strictEqual(session.textbookSchoolId, undefined, "sesija nije očišćena");
    });

    it("nastavak sesije: pouzdano imenovana druga škola bez okidačke riječi i dalje dobiva odgovor, ne null", () => {
      const session = {};
      buildTextbookOutcome("popis udžbenika Gimnazija Daruvar", session);
      const outcome = buildTextbookOutcome("Ekonomska škola Pula, 3. razred", session);
      assert.ok(outcome, "razgovor u tijeku ne smije vratiti null samo zato što nedostaje riječ 'popis'/'udžbenik'");
      assert.match(outcome.customerMessage, /Ekonomska škola Pula/);
      assert.doesNotMatch(outcome.customerMessage, /Gimnazija Daruvar/);
    });

    it("nastavak sesije: nejasno imenovana škola (više kandidata u gradu) pita umjesto da padne na zapamćenu", () => {
      const session = {};
      buildTextbookOutcome("popis udžbenika Gimnazija Daruvar", session);
      const outcome = buildTextbookOutcome("srednja škola Šibenik, 3. razred popis udžbenika", session);
      assert.strictEqual(outcome.reason, "textbook_ambiguous_school");
      assert.doesNotMatch(outcome.customerMessage, /Gimnazija Daruvar/);
    });

    it("nastavak sesije: nejasno imenovana škola (tip bez grada) pita umjesto da padne na zapamćenu", () => {
      const session = {};
      buildTextbookOutcome("popis udžbenika Gimnazija Daruvar", session);
      const outcome = buildTextbookOutcome("Ekonomska škola, 3. razred popis udžbenika", session);
      assert.strictEqual(outcome.reason, "textbook_ambiguous_school");
      assert.doesNotMatch(outcome.customerMessage, /Gimnazija Daruvar/);
    });
  });

  // Bot pita "Na koju školu mislite?", posjetitelj napiše naziv — i to mora biti pravi
  // nastavak razgovora. Prije ovoga je odgovor padao kroz TEXTBOOK_RE (naziv škole ne
  // sadrži "popis" ni "udžbenik") i završavao na generičkom fallbacku, a razred pročitan
  // iz prve poruke bacao se pa se tražio drugi put. Slijepa ulica na najvjerojatnijem
  // ulazu: roditelj imenuje tip škole i grad, a ne službeni naziv.
  describe("nastavak nakon pitanja 'Na koju školu mislite?'", () => {
    const PRVA_PORUKA = "Pozdrav, imate li popis udzbenika za 1. razred ekonomske škole Bjelovar?";

    it("prva poruka pita za školu i pamti da čeka naziv, zajedno s razredom", () => {
      const session = {};
      const outcome = buildTextbookOutcome(PRVA_PORUKA, session);
      assert.strictEqual(outcome.reason, "textbook_ambiguous_school");
      assert.strictEqual(session.textbookAwaitingSchool, true, "sesija ne pamti da čeka naziv škole");
      assert.strictEqual(session.textbookRazred, "1", "razred iz prve poruke nije prenesen");
    });

    it("uputa traži samo naziv škole kad je razred već poznat", () => {
      const outcome = buildTextbookOutcome(PRVA_PORUKA, {});
      assert.match(outcome.customerMessage, /Napišite puni naziv škole, pa Vam šaljem popis za 1\. razred\./);
      assert.doesNotMatch(outcome.customerMessage, /naziv škole i razred/);
    });

    it("uputa i dalje traži naziv i razred kad razreda nema", () => {
      const outcome = buildTextbookOutcome("popis udžbenika srednja škola Šibenik", {});
      assert.strictEqual(outcome.reason, "textbook_ambiguous_school");
      assert.match(outcome.customerMessage, /Napišite puni naziv škole i razred/);
    });

    it("puni naziv škole u odgovoru daje popis, s razredom prenesenim iz prve poruke", () => {
      const session = {};
      buildTextbookOutcome(PRVA_PORUKA, session);
      const outcome = buildTextbookOutcome("Ekonomska i birotehnička škola Bjelovar", session);
      assert.strictEqual(outcome.reason, "textbook_list");
      assert.match(outcome.customerMessage, /Ekonomska i birotehnička škola Bjelovar/);
      assert.match(outcome.customerMessage, /1\. razred/);
      assert.doesNotMatch(outcome.customerMessage, /za koji razred/i);
    });

    it("skraćeni naziv u odgovoru također razrješava školu", () => {
      const session = {};
      buildTextbookOutcome(PRVA_PORUKA, session);
      const outcome = buildTextbookOutcome("Ekonomska i birotehnička", session);
      assert.strictEqual(outcome.reason, "textbook_list");
      assert.match(outcome.customerMessage, /Ekonomska i birotehnička škola Bjelovar/);
      assert.match(outcome.customerMessage, /1\. razred/);
    });

    it("razred iz nove poruke ima prednost pred prenesenim", () => {
      const session = {};
      buildTextbookOutcome(PRVA_PORUKA, session);
      const outcome = buildTextbookOutcome("Ekonomska i birotehnička škola Bjelovar, 2. razred", session);
      assert.strictEqual(outcome.reason, "textbook_list");
      assert.match(outcome.customerMessage, /2\. razred/);
      assert.doesNotMatch(outcome.customerMessage, /za 1\. razred/);
    });

    it("bez prenesenog razreda odgovor s nazivom škole pita za razred", () => {
      const session = {};
      buildTextbookOutcome("popis udžbenika srednja škola Šibenik", session);
      assert.strictEqual(session.textbookRazred, undefined, "razreda nije bilo, a ipak je prenesen");
      const outcome = buildTextbookOutcome("Gimnazija Antuna Vrančića Šibenik", session);
      assert.strictEqual(outcome.reason, "textbook_need_razred");
      assert.ok(session.textbookSchoolId, "škola nije zapamćena za sljedeći krug");
    });

    // Najvažniji test ovog kruga: nemarna izvedba ove značajke vuče posjetitelja natrag
    // u temu koju je napustio.
    for (const odustajanje of ["hvala", "Hvala Vam!", "koliko košta dostava?", "a koliko košta dostava?", "ok", "ne treba, hvala"]) {
      it(`promjena teme nakon popisa kandidata ne dobiva odgovor o udžbenicima: ${odustajanje}`, () => {
        const session = {};
        buildTextbookOutcome(PRVA_PORUKA, session);
        const outcome = buildTextbookOutcome(odustajanje, session);
        assert.strictEqual(outcome, null, `gate se aktivirao na: ${odustajanje}`);
        assert.strictEqual(session.textbookAwaitingSchool, undefined, "marker je preživio promjenu teme");
        assert.strictEqual(session.textbookRazred, undefined, "razred je preživio promjenu teme");
      });
    }

    it("marker vrijedi samo jednu poruku — naziv škole dvije poruke kasnije više ne opali", () => {
      const session = {};
      buildTextbookOutcome(PRVA_PORUKA, session);
      buildTextbookOutcome("hvala", session);
      const outcome = buildTextbookOutcome("Ekonomska i birotehnička škola Bjelovar", session);
      assert.strictEqual(outcome, null, "potrošeni marker je opalio na kasnijoj poruci");
    });

    it("i 'jeste li mislili' pamti da čeka naziv škole", () => {
      const session = {};
      const outcome = buildTextbookOutcome("trebam popis udžbenika za medicinsku u Bjelovaru", session);
      assert.ok(outcome, "očekivan je odgovor s kandidatima");
      if (outcome.reason === "textbook_need_razred") return; // matcher je školu ipak razriješio
      assert.strictEqual(session.textbookAwaitingSchool, true, "sesija ne pamti da čeka naziv škole");
    });
  });

  // Posjetitelj traži popis, ali školu ne imenuje ("trebam popis udžbenika"). Dosad je
  // takva poruka padala u generički fallback, pa je i odgovor na nju ("Gimnazija
  // Daruvar") ostajao bez konteksta i vraćao null — dvije poruke, nijedan odgovor.
  // Razlikovanje je izmjereno nad 107 stvarnih upita (76 GEN + 31 e2e): nijedan nema
  // kolokaciju "popis (…) udžbenika", a 15 ih spominje udžbenik u posve drugom poslu.
  describe("upit za popisom bez imenovane škole", () => {
    const TRAZE_POPIS = [
      "trebam popis udžbenika",
      "gdje je popis udžbenika",
      "popis udžbenika",
      "Poštovani, trebam popis udžbenika, hvala",
      "imate li popis školskih udžbenika?"
    ];

    for (const upit of TRAZE_POPIS) {
      it(`pita za školu umjesto da odustane: ${upit}`, () => {
        const session = {};
        const outcome = buildTextbookOutcome(upit, session);
        assert.ok(outcome, `gate nije opalio na: ${upit}`);
        assert.strictEqual(outcome.reason, "textbook_need_school");
        assert.match(outcome.customerMessage, /Za koju školu/);
        assert.strictEqual(session.textbookAwaitingSchool, true, "sesija ne pamti da čeka naziv škole");
      });
    }

    it("naziv škole u sljedećoj poruci dobiva odgovor, ne null", () => {
      const session = {};
      buildTextbookOutcome("trebam popis udžbenika", session);
      const outcome = buildTextbookOutcome("Gimnazija Daruvar", session);
      assert.ok(outcome, "odgovor na pitanje o školi je ostao bez odgovora");
      assert.strictEqual(outcome.reason, "textbook_need_razred");
      assert.match(outcome.customerMessage, /Gimnazija Daruvar/);
    });

    it("razred iz prve poruke se nosi dalje", () => {
      const session = {};
      const pitanje = buildTextbookOutcome("trebam popis udžbenika za 1. razred", session);
      assert.strictEqual(pitanje.reason, "textbook_need_school");
      assert.match(pitanje.customerMessage, /pa Vam šaljem popis za 1\. razred\./);
      assert.strictEqual(session.textbookRazred, "1");
      const outcome = buildTextbookOutcome("Gimnazija Daruvar", session);
      assert.strictEqual(outcome.reason, "textbook_list");
      assert.match(outcome.customerMessage, /1\. razred/);
      assert.match(outcome.customerMessage, /Gimnazija Daruvar/);
    });

    it("bez razreda uputa traži i naziv i razred", () => {
      const outcome = buildTextbookOutcome("trebam popis udžbenika", {});
      assert.match(outcome.customerMessage, /Napišite naziv škole i razred/);
    });

    // Najvažniji test ove grane: nemarna izvedba drži posjetitelja u temi koju je napustio.
    for (const odustajanje of ["hvala", "Hvala Vam!", "koliko košta dostava?", "ok", "ne treba, hvala"]) {
      it(`promjena teme nakon pitanja za školu ne dobiva odgovor: ${odustajanje}`, () => {
        const session = {};
        buildTextbookOutcome("trebam popis udžbenika", session);
        const outcome = buildTextbookOutcome(odustajanje, session);
        assert.strictEqual(outcome, null, `gate se aktivirao na: ${odustajanje}`);
        assert.strictEqual(session.textbookAwaitingSchool, undefined, "marker je preživio promjenu teme");
        assert.strictEqual(session.textbookRazred, undefined, "razred je preživio promjenu teme");
      });
    }

    it("marker vrijedi samo jednu poruku i nakon pitanja za školu", () => {
      const session = {};
      buildTextbookOutcome("trebam popis udžbenika", session);
      buildTextbookOutcome("hvala", session);
      assert.strictEqual(buildTextbookOutcome("Gimnazija Daruvar", session), null);
    });

    // Druga strana: sama riječ "udžbenik" ne smije nikoga odvesti u ovu granu. Prva
    // četiri su doslovni upiti iz e2e korpusa stvarnih tiketa (C1, K2, A6, G3).
    const NE_SMIJU_U_GRANU = [
      "Kako naručiti udžbenike?",
      "Otkupljujete li udžbenike?",
      "Koliko dobivam za otkup udžbenika matematike?",
      "Koja je cijena udžbenika za 3. razred gimnazije?",
      "Koliko košta dostava knjiga u Osijek?",
      "Kako naručiti sve potrebne udžbenike za odabrani razred odjednom?",
      "Trebaju mi udžbenici za 1. razred",
      "Možete li procijeniti vrijednost mojih knjiga po popisu ili fotografijama?",
      // Kolokacija postoji, ali u otkupnom smjeru — nije traženje školskog popisa.
      "šaljem vam popis udžbenika za otkup",
      "evo popisa udžbenika koje želim prodati",
      "Poslao sam popis udžbenika, kad ćete mi javiti procjenu?"
    ];

    for (const upit of NE_SMIJU_U_GRANU) {
      it(`ne otima postojeći tok: ${upit}`, () => {
        const session = {};
        assert.strictEqual(buildTextbookOutcome(upit, session), null);
        assert.strictEqual(session.textbookAwaitingSchool, undefined, "marker je postavljen bez potrebe");
      });
    }

    it("žalba i dalje ne dobiva pitanje za školu", () => {
      assert.strictEqual(
        buildTextbookOutcome("Trebam popis udžbenika, ali čekam uplatu već tjedan dana", {}),
        null
      );
    });
  });

  // Roditelj dvoje djece pita za drugo dijete odmah nakon prvog popisa. Prije ovoga je
  // "a za drugo dijete treba 3. razred iste škole" vraćalo null — posjetitelj koji je
  // očito još u toku ostajao bi bez odgovora.
  describe("pamćenje škole nakon poslanog popisa", () => {
    const PRVI_POPIS = "popis udžbenika Gimnazija Daruvar 1. razred";

    const NASTAVCI = [
      "a za drugo dijete treba 3. razred iste škole",
      "a 3. razred?",
      "te škole, 3. razred",
      "a u istoj školi 3. razred molim"
    ];

    for (const nastavak of NASTAVCI) {
      it(`nastavlja na zapamćenoj školi: ${nastavak}`, () => {
        const session = {};
        const prvi = buildTextbookOutcome(PRVI_POPIS, session);
        assert.strictEqual(prvi.reason, "textbook_list");
        assert.strictEqual(session.textbookSchoolId, "gimnazija-daruvar", "škola nije zapamćena nakon popisa");
        const outcome = buildTextbookOutcome(nastavak, session);
        assert.ok(outcome, `nastavak je ostao bez odgovora: ${nastavak}`);
        assert.strictEqual(outcome.reason, "textbook_list");
        assert.match(outcome.customerMessage, /Gimnazija Daruvar/);
        assert.match(outcome.customerMessage, /3\. razred/);
      });
    }

    for (const odustajanje of ["hvala", "koliko košta dostava?", "ok", "Kako naručiti udžbenike?"]) {
      it(`promjena teme nakon popisa ne dobiva odgovor: ${odustajanje}`, () => {
        const session = {};
        buildTextbookOutcome(PRVI_POPIS, session);
        const outcome = buildTextbookOutcome(odustajanje, session);
        assert.strictEqual(outcome, null, `gate se aktivirao na: ${odustajanje}`);
        assert.strictEqual(session.textbookSchoolId, undefined, "marker je preživio promjenu teme");
      });
    }

    it("marker vrijedi točno jednu poruku — razred dvije poruke kasnije više ne opali", () => {
      const session = {};
      buildTextbookOutcome(PRVI_POPIS, session);
      buildTextbookOutcome("hvala", session);
      assert.strictEqual(buildTextbookOutcome("a 3. razred?", session), null);
    });

    it("nova imenovana škola pobjeđuje zapamćenu", () => {
      const session = {};
      buildTextbookOutcome(PRVI_POPIS, session);
      const outcome = buildTextbookOutcome("a Medicinska škola Bjelovar, 2. razred", session);
      assert.strictEqual(outcome.reason, "textbook_list");
      assert.match(outcome.customerMessage, /Medicinska škola Bjelovar/);
      assert.doesNotMatch(outcome.customerMessage, /Gimnazija Daruvar/);
    });

    it("žalba nakon popisa ne dobiva novi popis", () => {
      const session = {};
      buildTextbookOutcome(PRVI_POPIS, session);
      const outcome = buildTextbookOutcome("a 3. razred, ali paket mi nije stigao", session);
      assert.strictEqual(outcome, null, "žalba usred razgovora je dobila popis");
      assert.strictEqual(session.textbookSchoolId, undefined, "sesija nije očišćena");
    });
  });

  // Bot pita "za koji razred trebate popis udžbenika?", posjetitelj odgovori "2." — i to
  // je jedini prirodan način da se na to pitanje odgovori. Prije ovoga je parseRazred
  // tražio doslovnu riječ "razred", pa je odgovor padao u generički fallback: bot pita,
  // čovjek odgovori, bot ga ne čuje (prijavljeno s produkcije, Graditeljska Varaždin).
  describe("gol redni broj kao odgovor na botovo pitanje o razredu", () => {
    // Doslovna škola iz prijavljenog razgovora — ima popise za 1., 2. i 3. razred.
    const PITANJE = "popis udzbenika Graditeljska, prirodoslovna i rudarska škola Varaždin";
    const ODGOVORI = ["2.", "2", "drugi", "drugu", "za drugi", "2. razred", "u drugom razredu"];

    for (const odgovor of ODGOVORI) {
      it(`odgovor "${odgovor}" daje popis za 2. razred te škole`, () => {
        const session = {};
        const pitanje = buildTextbookOutcome(PITANJE, session);
        assert.strictEqual(pitanje.reason, "textbook_need_razred");
        assert.strictEqual(session.textbookAwaitingRazred, true, "sesija ne pamti da čeka razred");

        const outcome = buildTextbookOutcome(odgovor, session);
        assert.ok(outcome, `odgovor je ostao bez odgovora: ${odgovor}`);
        assert.strictEqual(outcome.reason, "textbook_list");
        assert.match(outcome.customerMessage, /Graditeljska, prirodoslovna i rudarska škola Varaždin/);
        assert.match(outcome.customerMessage, /2\. razred/);
        assert.match(outcome.customerMessage, /\[[^\]]+\]\(https:\/\/[^)]+\)/);
      });
    }

    it("svi oblici vode na isti razred, ne na neki drugi", () => {
      const linkovi = new Set();
      for (const odgovor of ODGOVORI) {
        const session = {};
        buildTextbookOutcome(PITANJE, session);
        const outcome = buildTextbookOutcome(odgovor, session);
        linkovi.add((outcome.customerMessage.match(/\((https?:\/\/[^\s)]+)\)/g) || []).join("|"));
      }
      assert.strictEqual(linkovi.size, 1, `oblici daju različite popise:\n${[...linkovi].join("\n")}`);
    });

    it("i drugi razredi se čitaju iz golog oblika", () => {
      for (const [odgovor, ocekivani] of [["1.", "1"], ["prvi", "1"], ["3", "3"], ["treći", "3"]]) {
        const session = {};
        buildTextbookOutcome(PITANJE, session);
        const outcome = buildTextbookOutcome(odgovor, session);
        assert.strictEqual(outcome.reason, "textbook_list", `bez popisa na: ${odgovor}`);
        assert.match(outcome.customerMessage, new RegExp(`${ocekivani}\\. razred`));
      }
    });

    it("dva različita broja u istoj poruci ne pogađaju razred", () => {
      // "1. i 2." ne kaže koji je tražen — radije ništa nego krivi popis.
      const session = {};
      buildTextbookOutcome(PITANJE, session);
      assert.strictEqual(buildTextbookOutcome("1. i 2.", session), null);
    });

    it("marker vrijedi točno jednu poruku — gol razred dvije poruke kasnije više ne opali", () => {
      const session = {};
      buildTextbookOutcome(PITANJE, session);
      buildTextbookOutcome("hvala", session);
      assert.strictEqual(buildTextbookOutcome("2.", session), null);
    });

    for (const odustajanje of ["hvala", "Hvala Vam!", "koliko košta dostava?", "ok", "ne treba, hvala"]) {
      it(`promjena teme nakon pitanja za razred i dalje ne dobiva popis: ${odustajanje}`, () => {
        const session = {};
        buildTextbookOutcome(PITANJE, session);
        assert.strictEqual(buildTextbookOutcome(odustajanje, session), null);
        assert.strictEqual(session.textbookAwaitingRazred, undefined, "marker je preživio promjenu teme");
        assert.strictEqual(session.textbookSchoolId, undefined, "sesija nije očišćena");
      });
    }
  });

  // NAJVAŽNIJI blok ovog kruga. Gol redni broj smije značiti razred SAMO dok bot na njega
  // čeka. Izvan tog stanja mora ostati bezznačajan — ova je grana već jednom platila
  // regresiju u kojoj je znamenka bilo gdje u poruci ("imam 2 djeteta", "do 1.9.") vukla
  // škole s rednim brojem u nazivu u bodovanje i obarala točne pogotke.
  describe("gol redni broj izvan stanja čekanja ne znači ništa", () => {
    const GOLI_ODGOVORI = ["2.", "2", "drugi", "drugu", "za drugi", "2. razred", "u drugom razredu"];

    for (const odgovor of GOLI_ODGOVORI) {
      it(`prazna sesija: "${odgovor}" ne dobiva odgovor o udžbenicima`, () => {
        const session = {};
        assert.strictEqual(buildTextbookOutcome(odgovor, session), null, `gate se aktivirao na: ${odgovor}`);
        assert.deepStrictEqual(session, {}, "poruka izvan toka je postavila marker");
      });
    }

    for (const odgovor of GOLI_ODGOVORI) {
      it(`nakon poslanog popisa (bot ništa ne pita): "${odgovor}" ne dobiva novi popis`, () => {
        // Popis pamti školu zbog drugog djeteta ("a 3. razred?"), ali bot NIJE postavio
        // pitanje o razredu — pa gol broj ovdje ne smije vrijediti kao odgovor.
        const session = {};
        const prvi = buildTextbookOutcome("popis udžbenika Gimnazija Daruvar 1. razred", session);
        assert.strictEqual(prvi.reason, "textbook_list");
        assert.strictEqual(session.textbookAwaitingRazred, undefined, "popis je postavio marker čekanja razreda");
        const outcome = buildTextbookOutcome(odgovor, session);
        if (odgovor === "2. razred" || odgovor === "u drugom razredu") {
          // Ovi oblici nose riječ "razred" pa ih parseRazred čita i bez ovog rada —
          // ponašanje je nepromijenjeno i namjerno ostaje.
          assert.strictEqual(outcome.reason, "textbook_list");
          return;
        }
        assert.strictEqual(outcome, null, `gol broj je opalio izvan pitanja: ${odgovor}`);
      });
    }

    for (const odgovor of ["2.", "2", "drugi", "drugu", "za drugi"]) {
      it(`dok bot čeka NAZIV ŠKOLE, "${odgovor}" ne dobiva popis`, () => {
        const session = {};
        buildTextbookOutcome("trebam popis udžbenika", session);
        assert.strictEqual(session.textbookAwaitingSchool, true);
        assert.strictEqual(buildTextbookOutcome(odgovor, session), null, `gol broj je opalio: ${odgovor}`);
      });
    }

    it("parseRazred ostaje nepromijenjen — gol oblik i dalje nije razred", () => {
      // Zajednička funkcija se koristi i na prvoj poruci razgovora, gdje je znamenka bilo
      // što ("do 1.9.", "imam 2 djeteta"). Popuštanje OVDJE je zabranjeno; goli oblik čita
      // zasebna, stanjem omeđena funkcija.
      for (const tekst of ["2.", "2", "drugi", "drugu", "za drugi"]) {
        assert.strictEqual(parseRazred(tekst), null, `parseRazred je popustio na: ${tekst}`);
      }
    });

    it("rečenice s brojem izvan fraze razreda i dalje prepoznaju školu", () => {
      // Ista regresija, druga strana: gol broj se čita samo u stanju čekanja, pa prva
      // poruka razgovora ostaje netaknuta.
      for (const upit of [
        "popis udžbenika za 1. i 2. razred Gimnazija Daruvar",
        "popis udžbenika Gimnazija Daruvar, imam 2 djeteta",
        "trebam popis udžbenika za Gimnaziju Daruvar do 1.9."
      ]) {
        const r = findSchool(upit);
        assert.strictEqual(r.status, "match", `${upit} -> ${r.status}`);
        assert.strictEqual(r.school.naziv, "Gimnazija Daruvar");
      }
    });
  });

  // "Na koju školu mislite? — Ekonomska škola Pula" pita koja je od jedne: čita se kao
  // kvar, a posjetitelj ne zna što bi drukčije napisao. Matcher školu ipak NIJE prepoznao
  // pouzdano, pa je ne smijemo samo poslati — pitamo za potvrdu i imenujemo je u pitanju.
  describe("jedan kandidat: pitanje s imenom škole i potvrda s 'da'", () => {
    const JEDAN = "popis udzbenika ekonomska škola";

    it("pitanje imenuje školu i ne izgleda kao izbor iz jednog", () => {
      const session = {};
      const outcome = buildTextbookOutcome(JEDAN, session);
      assert.strictEqual(outcome.reason, "textbook_ambiguous_school");
      assert.match(outcome.customerMessage, /Ekonomska škola Pula/);
      assert.match(outcome.customerMessage, /Je li to ta škola\?/);
      assert.doesNotMatch(outcome.customerMessage, /Na koju školu mislite\?/);
      assert.doesNotMatch(outcome.customerMessage, /^- /m, "jedan kandidat je ponuđen kao popis za izbor");
      assert.strictEqual(session.textbookAwaitingSchool, true);
      assert.strictEqual(session.textbookPotvrdaSkolaId, "ekonomska-skola-pula");
    });

    for (const potvrda of ["da", "to je to", "tako je", "može", "Da, hvala", "Tako je."]) {
      it(`potvrda "${potvrda}" razrješava školu`, () => {
        const session = {};
        buildTextbookOutcome(JEDAN, session);
        const outcome = buildTextbookOutcome(potvrda, session);
        assert.ok(outcome, `potvrda je ostala bez odgovora: ${potvrda}`);
        assert.strictEqual(outcome.reason, "textbook_need_razred");
        assert.match(outcome.customerMessage, /Ekonomska škola Pula/);
      });
    }

    it("potvrda uz poznat razred odmah šalje popis", () => {
      const session = {};
      const pitanje = buildTextbookOutcome("popis udzbenika ekonomska škola 1. razred", session);
      assert.match(pitanje.customerMessage, /Ako jest, napišite "da" i šaljem Vam popis za 1\. razred\./);
      const outcome = buildTextbookOutcome("da", session);
      assert.strictEqual(outcome.reason, "textbook_list");
      assert.match(outcome.customerMessage, /Ekonomska škola Pula/);
      assert.match(outcome.customerMessage, /1\. razred/);
    });

    it("potvrda i razred u istoj poruci vode na taj razred", () => {
      const session = {};
      buildTextbookOutcome(JEDAN, session);
      const outcome = buildTextbookOutcome("da, 1. razred", session);
      assert.strictEqual(outcome.reason, "textbook_list");
      assert.match(outcome.customerMessage, /Ekonomska škola Pula/);
      assert.match(outcome.customerMessage, /1\. razred/);
    });

    it("cijeli lanac: pitanje → 'da' → gol razred", () => {
      const session = {};
      buildTextbookOutcome(JEDAN, session);
      buildTextbookOutcome("da", session);
      const outcome = buildTextbookOutcome("1.", session);
      assert.strictEqual(outcome.reason, "textbook_list");
      assert.match(outcome.customerMessage, /Ekonomska škola Pula/);
      assert.match(outcome.customerMessage, /1\. razred/);
    });

    it("puni naziv škole i dalje razrješava, kao i dosad", () => {
      const session = {};
      buildTextbookOutcome(JEDAN, session);
      const outcome = buildTextbookOutcome("Ekonomska škola Pula", session);
      assert.strictEqual(outcome.reason, "textbook_need_razred");
      assert.match(outcome.customerMessage, /Ekonomska škola Pula/);
    });

    it("druga škola u odgovoru pobjeđuje ponuđenu", () => {
      const session = {};
      buildTextbookOutcome(JEDAN, session);
      const outcome = buildTextbookOutcome("Gimnazija Daruvar, 2. razred", session);
      assert.strictEqual(outcome.reason, "textbook_list");
      assert.match(outcome.customerMessage, /Gimnazija Daruvar/);
      assert.doesNotMatch(outcome.customerMessage, /Ekonomska škola Pula/);
    });

    for (const odustajanje of ["hvala", "Hvala Vam!", "koliko košta dostava?", "ok", "ne treba, hvala"]) {
      it(`odustajanje nakon pitanja za potvrdu ne dobiva popis: ${odustajanje}`, () => {
        const session = {};
        buildTextbookOutcome(JEDAN, session);
        assert.strictEqual(buildTextbookOutcome(odustajanje, session), null, `gate se aktivirao na: ${odustajanje}`);
        assert.strictEqual(session.textbookPotvrdaSkolaId, undefined, "marker je preživio promjenu teme");
        assert.strictEqual(session.textbookAwaitingSchool, undefined, "marker je preživio promjenu teme");
      });
    }

    it("marker potvrde vrijedi točno jednu poruku", () => {
      const session = {};
      buildTextbookOutcome(JEDAN, session);
      buildTextbookOutcome("hvala", session);
      assert.strictEqual(buildTextbookOutcome("da", session), null, "potrošeni marker je opalio kasnije");
    });

    it("žalba umjesto potvrde ne dobiva popis", () => {
      const session = {};
      buildTextbookOutcome(JEDAN, session);
      const outcome = buildTextbookOutcome("da, ali paket mi nije stigao", session);
      assert.strictEqual(outcome, null, "žalba je dobila popis");
      assert.strictEqual(session.textbookPotvrdaSkolaId, undefined, "sesija nije očišćena");
    });

    // Uputa mora opisivati točno ono što kod prima. Prva izvedba je tražila '"da" i razred',
    // a onda odbijala "da 2." i "2." — isti kvar kao onaj koji ovaj rad popravlja, samo
    // jedno stanje ulijevo. Ovaj blok je zaključava: svaki oblik ima svoju tvrdnju, da
    // nijedan ne može tiho ispasti.
    describe("odgovor na pitanje o jednoj školi — svaki oblik", () => {
      // Škola iz prijavljenog razgovora; ima popise za 1., 2. i 3. razred, pa se razred
      // pročitan iz odgovora vidi u samom popisu.
      const PONUDA = "Može i za Graditeljsku, prirodoslovnu i rudarsku školu";
      const NAZIV = "Graditeljska, prirodoslovna i rudarska škola Varaždin";

      function pitanjeSJednomSkolom() {
        const session = {};
        const pitanje = buildTextbookOutcome("trebam popis udžbenika", session);
        assert.strictEqual(pitanje.reason, "textbook_need_school");
        const ponuda = buildTextbookOutcome(PONUDA, session);
        assert.strictEqual(ponuda.reason, "textbook_ambiguous_school");
        assert.match(ponuda.customerMessage, /Je li to ta škola\?/);
        assert.ok(session.textbookPotvrdaSkolaId, "škola nije zapamćena kao ponuđena");
        return session;
      }

      // Potvrda s razredom i gol razred — oba moraju dati popis za taj razred.
      for (const odgovor of ["da 2.", "da 2", "da, 2. razred", "da drugi", "2.", "2", "2. razred", "drugi"]) {
        it(`"${odgovor}" daje popis za 2. razred`, () => {
          const session = pitanjeSJednomSkolom();
          const outcome = buildTextbookOutcome(odgovor, session);
          assert.ok(outcome, `odgovor je ostao bez odgovora: ${odgovor}`);
          assert.strictEqual(outcome.reason, "textbook_list");
          assert.match(outcome.customerMessage, new RegExp(NAZIV.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
          assert.match(outcome.customerMessage, /2\. razred/);
          assert.match(outcome.customerMessage, /\[[^\]]+\]\(https:\/\/[^)]+\)/);
        });
      }

      // Gola potvrda — škola je razriješena, razred se traži kao i dosad.
      for (const odgovor of ["da", "to je to", "tako je", "može", "Da, hvala"]) {
        it(`"${odgovor}" potvrđuje školu i pita za razred`, () => {
          const session = pitanjeSJednomSkolom();
          const outcome = buildTextbookOutcome(odgovor, session);
          assert.ok(outcome, `potvrda je ostala bez odgovora: ${odgovor}`);
          assert.strictEqual(outcome.reason, "textbook_need_razred");
          assert.match(outcome.customerMessage, /Graditeljska/);
          assert.strictEqual(session.textbookAwaitingRazred, true, "sesija ne pamti da čeka razred");
        });
      }

      it("prijavljeni razgovor u cijelosti završava popisom za 2. razred", () => {
        const session = {};
        const prvo = buildTextbookOutcome("trebam popis udžbenika", session);
        assert.match(prvo.customerMessage, /Za koju školu trebate popis udžbenika\?/);
        const drugo = buildTextbookOutcome("Može i za Graditeljsku, prirodoslovnu i rudarsku školu", session);
        assert.match(drugo.customerMessage, /Je li to ta škola\?/);
        const trece = buildTextbookOutcome("2.", session);
        assert.strictEqual(trece.reason, "textbook_list");
        assert.match(trece.customerMessage, /Graditeljska, prirodoslovna i rudarska škola Varaždin/);
        assert.match(trece.customerMessage, /2\. razred/);
      });

      it("uputa traži samo ono što kod prima (razred, ili puni naziv druge škole)", () => {
        const session = {};
        buildTextbookOutcome("trebam popis udžbenika", session);
        const ponuda = buildTextbookOutcome(PONUDA, session);
        assert.match(ponuda.customerMessage, /Ako jest, napišite razred \(npr\. "2\."\) i šaljem Vam popis\./);
        assert.match(ponuda.customerMessage, /Ako nije, napišite puni naziv škole\./);
        assert.doesNotMatch(ponuda.customerMessage, /napišite "da" i razred/);
      });

      it("druga imenovana škola pobjeđuje ponuđenu", () => {
        const session = pitanjeSJednomSkolom();
        const outcome = buildTextbookOutcome("Gimnazija Daruvar, 2. razred", session);
        assert.strictEqual(outcome.reason, "textbook_list");
        assert.match(outcome.customerMessage, /Gimnazija Daruvar/);
        assert.doesNotMatch(outcome.customerMessage, /Graditeljska/);
      });

      for (const odustajanje of ["hvala", "Hvala Vam!", "koliko košta dostava?", "ok", "ne treba, hvala"]) {
        it(`odustajanje i dalje ne dobiva popis: ${odustajanje}`, () => {
          const session = pitanjeSJednomSkolom();
          assert.strictEqual(buildTextbookOutcome(odustajanje, session), null, `gate se aktivirao na: ${odustajanje}`);
          assert.strictEqual(session.textbookPotvrdaSkolaId, undefined, "marker je preživio promjenu teme");
          assert.strictEqual(session.textbookAwaitingSchool, undefined, "marker je preživio promjenu teme");
          assert.strictEqual(session.textbookRazred, undefined, "razred je preživio promjenu teme");
        });
      }

      it("broj s vlastitim značenjem nije razred ni ovdje", () => {
        for (const poruka of ["2 djeteta", "2 puta", "3 komada"]) {
          const session = pitanjeSJednomSkolom();
          assert.strictEqual(buildTextbookOutcome(poruka, session), null, `gate se aktivirao na: ${poruka}`);
        }
      });

      it("gol razred izvan ovog stanja i dalje ne znači ništa", () => {
        for (const poruka of ["da 2.", "2.", "drugi", "da"]) {
          const session = {};
          assert.strictEqual(buildTextbookOutcome(poruka, session), null, `gate se aktivirao na: ${poruka}`);
          assert.deepStrictEqual(session, {}, `poruka je postavila marker: ${poruka}`);
        }
      });
    });

    // Druga strana: potvrda vrijedi samo tamo gdje je ponuđena JEDNA škola.
    it("dva ili više kandidata zadržavaju postojeću formulaciju i ne primaju 'da'", () => {
      const session = {};
      const outcome = buildTextbookOutcome(
        "Pozdrav, imate li popis udzbenika za 1. razred ekonomske škole Bjelovar?", session
      );
      assert.strictEqual(outcome.reason, "textbook_ambiguous_school");
      assert.match(outcome.customerMessage, /^Na koju školu mislite\?$/m);
      assert.ok((outcome.customerMessage.match(/^- /gm) || []).length >= 2, "očekivan popis kandidata");
      assert.match(outcome.customerMessage, /Napišite puni naziv škole, pa Vam šaljem popis za 1\. razred\./);
      assert.strictEqual(session.textbookPotvrdaSkolaId, undefined, "potvrda je ponuđena na više kandidata");
      assert.strictEqual(buildTextbookOutcome("da", session), null, "'da' je razriješilo izbor iz više škola");
    });
  });

  // Otkad se redni broj normalizira, broj razreda iz upita ("za 2. razred") izgleda
  // matcheru isto kao redni broj u nazivu škole — pa bi "Druga gimnazija Varaždin" i
  // "II. gimnazija Osijek" postale suparnice koje pokrivaju obilježje koje pobjednik
  // nema i oborile bi inače točan pogodak na "nejasno". Zato se razred uklanja iz teksta
  // prije prepoznavanja škole; parseRazred ga i dalje čita iz izvorne poruke.
  describe("broj razreda ne curi u prepoznavanje škole", () => {
    const RAZRED_UPITI = [
      ["popis udžbenika za 2. razred Gimnazija Daruvar", "Gimnazija Daruvar", "2"],
      ["popis udžbenika Gimnazija Daruvar 1. razred", "Gimnazija Daruvar", "1"],
      ["trebam popis za 3. razred u Gimnaziji Daruvar", "Gimnazija Daruvar", "3"],
      ["popis udžbenika za drugi razred Gimnazija Daruvar", "Gimnazija Daruvar", "2"],
      ["popis udžbenika Gimnazija Daruvar 1.a razred", "Gimnazija Daruvar", "1"],
      ["popis udžbenika za 3. razred Medicinska škola Bjelovar", "Medicinska škola Bjelovar", "3"],
      ["popis udžbenika za 2. razred Ekonomska škola Pula", "Ekonomska škola Pula", "2"]
    ];

    for (const [upit, ocekivana, razred] of RAZRED_UPITI) {
      it(`prepoznaje školu i razred: ${upit}`, () => {
        const r = findSchool(upit);
        assert.strictEqual(r.status, "match", `očekivan pogodak, dobiveno ${r.status}`);
        assert.strictEqual(r.school.naziv, ocekivana);
        assert.strictEqual(parseRazred(upit), razred);
      });
    }

    it("broj razreda ne izvlači školu s tim rednim brojem u nazivu", () => {
      const outcome = buildTextbookOutcome("popis udžbenika za 2. razred Gimnazija Daruvar", {});
      assert.strictEqual(outcome.reason, "textbook_list");
      assert.match(outcome.customerMessage, /Gimnazija Daruvar/);
      assert.doesNotMatch(outcome.customerMessage, /Druga gimnazija Varaždin|II\. gimnazija Osijek/);
    });

    it("razred i redni broj škole u istom upitu se ne miješaju", () => {
      const r = findSchool("popis udžbenika 3. gimnazija Osijek 2. razred");
      assert.strictEqual(r.status, "match");
      assert.strictEqual(r.school.naziv, "III. gimnazija Osijek");
      assert.strictEqual(parseRazred("popis udžbenika 3. gimnazija Osijek 2. razred"), "2");
    });
  });

  // Redni broj u nazivu škole uvijek je ženskog roda ("Prva"/"Druga"), jer su "škola" i
  // "gimnazija" ženske imenice — muški i srednji rod ne nosi nijedan od 281 naziva. U
  // upitima su, naprotiv, svakodnevni kao prilozi: "prvo bih htio…", "prvi put pišem…",
  // "drugo pitanje…". Dok su se i oni kanonizirali u redni broj, takva je rečenica
  // dobivala token koji nijedna škola nije pokrivala i inače točan pogodak je padao na
  // "nejasno" — 7 od ovih 10 rečenica. Ovo su obični početci poruke, ne rubni slučajevi.
  describe("prilozi u prirodnom govoru ne obaraju prepoznavanje škole", () => {
    const PRIRODNE_FORMULACIJE = [
      "prvo bih htio popis udžbenika za Gimnaziju Daruvar",
      "prvo mi treba popis udžbenika, Gimnazija Daruvar",
      "drugo pitanje, popis udžbenika Gimnazija Daruvar",
      "kao prvo, trebam popis udžbenika za Gimnaziju Daruvar",
      "prvi put pišem, trebam popis udžbenika Gimnazija Daruvar",
      "drugi put pitam za popis udžbenika Gimnazija Daruvar",
      "treće, zanima me popis udžbenika Gimnazija Daruvar",
      // Kontrolna skupina bez priloga — ove su prolazile i prije, moraju i dalje.
      "trebam popis udžbenika za Gimnaziju Daruvar",
      "popis udžbenika Gimnazija Daruvar",
      "dobar dan, trebam popis udžbenika za Gimnaziju Daruvar molim"
    ];

    for (const upit of PRIRODNE_FORMULACIJE) {
      it(`prepoznaje Gimnaziju Daruvar u: ${upit}`, () => {
        const r = findSchool(upit);
        assert.strictEqual(
          r.status,
          "match",
          `očekivan pogodak, dobiveno ${r.status}`
        );
        assert.strictEqual(r.school.naziv, "Gimnazija Daruvar");
      });
    }
  });

  // Redni broj se kanonizira samo kad stoji ispred vrste škole. Bez tog uvjeta je svaka
  // znamenka 1–5 bilo gdje u poruci dobivala token iznad DISTINCTIVE_IDF, pa je
  // imenujeTudeObiljezje obarao pogodak na školu koju je posjetitelj imenovao točno —
  // 19 od 50 realnih kombinacija škola × formulacija završilo bi s "Na koju školu
  // mislite?", uz popis dviju škola koje posjetitelj nikad nije spomenuo. RAZRED_FRAZA
  // te slučajeve ne doseže jer riječi "razred" ondje nema.
  describe("broj izvan fraze razreda ne obara prepoznavanje škole", () => {
    const BROJEVI_U_PORUCI = [
      // Roditelj dvoje djece, zadnji tjedan srpnja — vršno opterećenje, ne rubni slučaj.
      "popis udžbenika za 1. i 2. razred Gimnazija Daruvar",
      "popis udžbenika Gimnazija Daruvar za 2. r.",
      "popis udžbenika Gimnazija Daruvar, 2. godina",
      "trebam popis udžbenika za Gimnaziju Daruvar do 1.9.",
      "popis udžbenika Gimnazija Daruvar, imam 2 djeteta",
      "treća stvar, treba mi popis udžbenika Gimnazija Daruvar"
    ];

    for (const upit of BROJEVI_U_PORUCI) {
      it(`prepoznaje Gimnaziju Daruvar u: ${upit}`, () => {
        const r = findSchool(upit);
        assert.strictEqual(r.status, "match", `očekivan pogodak, dobiveno ${r.status}`);
        assert.strictEqual(r.school.naziv, "Gimnazija Daruvar");
      });
    }

    it("dvostruki razred i dalje daje popis, s razredom iz poruke", () => {
      const outcome = buildTextbookOutcome("popis udžbenika za 1. i 2. razred Gimnazija Daruvar", {});
      assert.strictEqual(outcome.reason, "textbook_list");
      assert.match(outcome.customerMessage, /Gimnazija Daruvar/);
    });
  });

  // Kanarinac za osvježenje baze. Odluka da se kanonizira samo ženski rod počiva na
  // činjenici o KORPUSU (0 muških i 0 srednjih oblika u 281 nazivu), a ne na nečemu što
  // kod jamči — sljedeće ljeto to može tiho prestati vrijediti. Naziv poput "Drugi centar
  // Zadar" dao bi token "drugi" s idf 5,75 izvan NERAZLIKOVNI_TOKENI, pa bi
  // "popis udžbenika drugi centar" nosio siguran pogodak bez ijednog imenovanog grada —
  // točno onaj razred greške ("II. gimnazija Split") koji je ovaj rad zatvorio, ponovno
  // otvoren podacima, uz zelen cijeli paket testova. (Provjereno nad sintetskim korpusom.)
  describe("kanarinac: osvježena baza ne smije unijeti redni broj izvan NERAZLIKOVNI_TOKENI", () => {
    const OBLICI_REDNOG_BROJA = new Set([
      // ženski rod — kanonizacija ih pretvara u rb1–rb5; ako neki preživi, pravilo
      // susjedstva ga nije dohvatilo i treba proširiti VRSTE_SKOLE
      "prva", "druga", "treca", "cetvrta", "peta",
      // muški i srednji rod — namjerno se ne kanoniziraju (sudaraju se s prilozima),
      // pa u nazivu škole ne smiju završiti kao razlikovan token
      "prvi", "drugi", "treci", "cetvrti", "peti",
      "prvo", "drugo", "trece", "cetvrto", "peto",
      // rimski, uključujući više brojeve koje kanonizacija ne pokriva
      "i", "ii", "iii", "iv", "v", "vi", "vii", "viii",
      "rb1", "rb2", "rb3", "rb4", "rb5"
    ]);

    function redniBrojeviIzvanSkupa(skole) {
      const nadeni = [];
      for (const skola of skole) {
        for (const token of skola.tokens) {
          if (OBLICI_REDNOG_BROJA.has(token) && !NERAZLIKOVNI_TOKENI.has(token)) {
            nadeni.push(`${skola.naziv}: ${token}`);
          }
        }
      }
      return nadeni;
    }

    it("trenutna baza je čista", () => {
      const nadeni = redniBrojeviIzvanSkupa(loadIndex().skole);
      assert.deepStrictEqual(
        nadeni,
        [],
        "naziv škole nosi redni broj koji nije nerazlikovan — takav token sam može nositi "
        + `siguran pogodak bez imenovanog grada:\n${nadeni.join("\n")}`
      );
    });

    it("kanarinac ima zube — hvata muški i srednji rod u nazivu", () => {
      // Da provjera ne postane tiho beskorisna, dokazujemo da na sumnjivim nazivima pada.
      const sintetske = [
        { naziv: "Prvo učilište Osijek", tokens: ["prvo", "uciliste", "osijek"] },
        { naziv: "Drugi centar Zadar", tokens: ["drugi", "centar", "zadar"] },
        { naziv: "Gimnazija Daruvar", tokens: ["gimnazija", "daruvar"] }
      ];
      assert.deepStrictEqual(redniBrojeviIzvanSkupa(sintetske), [
        "Prvo učilište Osijek: prvo",
        "Drugi centar Zadar: drugi"
      ]);
    });
  });

  describe("gate ne otima postojeće upite", () => {
    const POSTOJECI_UPITI = [
      "Kako naručiti udžbenike?",
      "Otkupljujete li udžbenike fizike?",
      "Koliko dobivam za otkup udžbenika matematike?",
      "Koja je cijena udžbenika za 3. razred gimnazije?",
      "Kako mogu prodati svoje udžbenike",
      "Imate li udžbenike za prvi razred",
      "Koliko košta dostava za više udžbenika?",
      "Želim reklamirati oštećenu knjigu",
      "Pozdrav"
    ];

    for (const upit of POSTOJECI_UPITI) {
      it(`ne aktivira se na: ${upit}`, () => {
        assert.strictEqual(buildTextbookOutcome(upit, {}), null);
      });
    }

    // Svaki od ovih je gate otimao na jednom slučajno pogođenom rijetkom tokenu
    // ("osijek", "prva", "druga") uz okidač "knjig" — obična pitanja o dostavi,
    // narudžbi i reklamaciji, ne upiti o popisu udžbenika.
    const OTETI_UPITI = [
      "Koliko košta dostava knjiga u Osijek?",
      "Kako vam mogu poslati fotografije knjiga ili druge priloge?",
      "Prva narudžba mi nije stigla, gdje su knjige?",
      "Koliko dugo traje dostava knjiga?",
      "Kupio sam knjigu i stigla je druga"
    ];

    for (const upit of OTETI_UPITI) {
      it(`ne aktivira se na: ${upit}`, () => {
        assert.strictEqual(buildTextbookOutcome(upit, {}), null);
      });
    }
  });

  // Korpusne provjere: baza se osvježava svako ljeto, pa ova tri sweepa čuvaju
  // svojstva koja pojedinačni testovi ne vide — prepoznatljivost svih škola,
  // upotrebljivost svih linkova i to da gate ne otima postojeće upite.
  describe("korpusne provjere nad cijelom bazom", () => {
    it("svaka škola se prepoznaje po svom točnom službenom nazivu", () => {
      const promasaji = [];
      for (const skola of loadIndex().skole) {
        const r = findSchool(skola.naziv);
        if (r.status !== "match" || r.school.id !== skola.id) {
          promasaji.push(`${skola.naziv} -> ${r.status === "match" ? r.school.naziv : r.status}`);
        }
      }
      assert.deepStrictEqual(promasaji, [], `škole se ne prepoznaju po vlastitom nazivu:\n${promasaji.join("\n")}`);
    });

    it("svaki url u bazi widget može prikazati kao klikabilan link", () => {
      // Regex je preslika onog iz public/index.html — url s razmakom ili internom
      // putanjom ("ručni unos: …") korisnik vidi kao goli tekst usred odgovora.
      const WIDGET_URL = /^https?:\/\/[^\s)]+$/;
      const sirovi = JSON.parse(
        fs.readFileSync(path.join(__dirname, "..", "data", "popis-udzbenika-2026-27.json"), "utf8")
      );
      const losi = [];
      for (const skola of sirovi.skole) {
        for (const dokument of skola.dokumenti) {
          if (!WIDGET_URL.test(String(dokument.url))) losi.push(`${skola.naziv}: ${dokument.url}`);
        }
      }
      assert.deepStrictEqual(losi, [], `url-ovi koje widget ne prikazuje kao link:\n${losi.join("\n")}`);
    });

    it("nijedan odgovor s popisom ne ostaje bez klikabilnog linka", () => {
      const LINK = /\((https?:\/\/[^\s)]+)\)/;
      const bezLinka = [];
      for (const skola of loadIndex().skole) {
        if (!skola.dokumenti.length) continue;
        for (const razred of ["1", "2", "3", "4", "5"]) {
          if (!skola.dokumenti.some((d) => d.razred === razred || d.razred === null)) continue;
          const outcome = buildTextbookOutcome(`popis udžbenika ${razred}. razred`, { textbookSchoolId: skola.id });
          if (!outcome || !LINK.test(outcome.customerMessage)) {
            bezLinka.push(`${skola.naziv} / ${razred}. razred`);
          }
        }
      }
      assert.deepStrictEqual(bezLinka, [], `odgovori bez klikabilnog linka:\n${bezLinka.join("\n")}`);
    });

    it("gard za žalbe ne gasi nijedan legitiman upit za popisom, ni na jednoj školi", () => {
      // Sonda preko cijelog korpusa: gard smije ušutkati samo žalbe. Ako neki uzorak
      // slučajno pogodi običnu formulaciju ("Poštovani…", "Hvala"), ovdje pada odmah,
      // a ne tek na produkciji na jednoj jedinoj školi.
      const SABLONE = [
        (naziv) => `popis udžbenika ${naziv}`,
        (naziv) => `trebam popis udžbenika za ${naziv}, 1. razred`,
        (naziv) => `Poštovani, imate li popis udžbenika za 3. razred, ${naziv}? Hvala`
      ];
      const ugaseni = [];
      for (const skola of loadIndex().skole) {
        for (const sablona of SABLONE) {
          const upit = sablona(skola.naziv);
          if (buildTextbookOutcome(upit, {}) === null) ugaseni.push(upit);
        }
      }
      assert.deepStrictEqual(ugaseni, [], `gard je ugasio legitimne upite:\n${ugaseni.slice(0, 10).join("\n")}`);
    });

    it("nijedan upit iz e2e korpusa stvarnih tiketa ne aktivira gate", () => {
      const oteti = GENERATED_SCENARIOS
        .map((scenarij) => ({ scenarij, outcome: buildTextbookOutcome(scenarij.query, {}) }))
        .filter((r) => r.outcome !== null)
        .map((r) => `${r.scenarij.id} (${r.outcome.reason}): ${r.scenarij.query}`);
      assert.deepStrictEqual(oteti, [], `gate je oteo postojeće upite:\n${oteti.join("\n")}`);
    });
  });

  // Hrvatska palatalizacija: k prelazi u c ispred i, pa množina "udžbenici/udžbenicima"
  // ispada iz korijena "udzbenik". Okidač je zato "udzbeni". Bez toga je
  // "trebaju mi udžbenici za 1. razred medicinske škole u Bjelovaru" — posve obična
  // rečenica — prolazila kroz matcher (točna škola, točan razred) i završila u
  // generičkom fallbacku, jer gate nikad nije opalio.
  describe("okidač hvata sve oblike riječi udžbenik", () => {
    // Po jedan test za svaki oblik, da buduća izmjena izraza ne može tiho ispustiti padež.
    const OBLICI = [
      "udžbenik", "udžbenika", "udžbeniku", "udžbenikom", "udžbenike",
      "udžbenici", "udžbenicima"
    ];

    for (const oblik of OBLICI) {
      it(`oblik "${oblik}" aktivira gate uz imenovanu školu`, () => {
        const outcome = buildTextbookOutcome(`trebaju mi ${oblik} za 2. razred Gimnazija Daruvar`, {});
        assert.ok(outcome, `oblik "${oblik}" ne aktivira gate`);
        assert.strictEqual(outcome.reason, "textbook_list");
        assert.match(outcome.customerMessage, /Gimnazija Daruvar/);
      });
    }

    it("prijavljena rečenica daje popis za 1. razred Medicinske škole Bjelovar", () => {
      const outcome = buildTextbookOutcome(
        "trebaju mi udžbenici za 1. razred medicinske škole u Bjelovaru", {}
      );
      assert.ok(outcome, "gate nije opalio");
      assert.strictEqual(outcome.reason, "textbook_list");
      assert.match(outcome.customerMessage, /Medicinska škola Bjelovar/);
      assert.match(outcome.customerMessage, /1\. razred/);
      assert.match(outcome.customerMessage, /\[[^\]]+\]\(https:\/\/[^)]+\)/);
    });

    it("i dalje hvata sve oblike riječi popis (s se ne palatalizira)", () => {
      for (const oblik of ["popis", "popisa", "popisu", "popise", "popisi", "popisom", "popisima"]) {
        const outcome = buildTextbookOutcome(`${oblik} za 2. razred Gimnazija Daruvar`, {});
        assert.ok(outcome, `oblik "${oblik}" ne aktivira gate`);
      }
    });

    // Druga strana: širi korijen ne smije oteti poruku koja školu ne imenuje.
    const BEZ_SKOLE = [
      "Otkupljujete li udžbenici?",
      "Koji udžbenici se otkupljuju ove godine?",
      "Trebaju mi udžbenici za 1. razred",
      "Koliko koštaju udžbenici?",
      "Što je s udžbenicima koje sam poslao?",
      "Radim s udžbenicima u školi"
    ];

    for (const upit of BEZ_SKOLE) {
      it(`množina bez imenovane škole ne aktivira gate: ${upit}`, () => {
        assert.strictEqual(buildTextbookOutcome(upit, {}), null);
      });
    }
  });

  // Žalba koja usput imenuje školu nije upit o popisu. Prije garda je "Krivi udžbenik
  // ste mi poslali za 2. razred Gimnazije Daruvar, tražim zamjenu" dobivao vedar popis
  // za 2. razred — samouvjeren odgovor na posve drugu temu, i to čovjeku koji se žali.
  // Ispravan ishod je onaj koji je vrijedio prije ove značajke: null, pa poruka teče
  // dalje kroz pipeline. Gard ne eskalira — eskalacija je posao
  // intentEscalationServicea, koji u pipelineu stoji ispred i koji ne diramo.
  describe("žalbe ne dobivaju popis udžbenika", () => {
    const ZALBE = [
      "Poslao sam udžbenike iz Gimnazije Daruvar i nisu mi platili, ovo je prijevara!",
      "Krivi udžbenik ste mi poslali za 2. razred Gimnazije Daruvar, tražim zamjenu",
      "Već tjedan dana čekam uplatu za udžbenike, Gimnazija Daruvar",
      "Nezadovoljan sam uslugom, naručio sam za Gimnaziju Daruvar",
      "Prevarili ste me s udžbenicima za Gimnaziju Daruvar",
      "Gdje mi je paket za Gimnaziju Daruvar, kasni već 10 dana",
      "Ovo je katastrofa, Gimnazija Daruvar, nitko se ne javlja"
    ];

    for (const zalba of ZALBE) {
      it(`vraća null na: ${zalba}`, () => {
        assert.strictEqual(
          buildTextbookOutcome(zalba, {}),
          null,
          "žalba je dobila odgovor o popisu udžbenika"
        );
      });
    }

    // Gard mora stajati ispred OBJE grane koje nastavljaju razgovor, inače posjetitelj
    // koji je ušao kao običan upit pa skrenuo na žalbu i dalje dobije popis.
    it("nastavak sesije: žalba uz razred ne dobiva popis zapamćene škole", () => {
      const session = {};
      const pitanje = buildTextbookOutcome("popis udžbenika Gimnazija Daruvar", session);
      assert.strictEqual(pitanje.reason, "textbook_need_razred");
      const outcome = buildTextbookOutcome(
        "2. razred, ali čekam uplatu već tjedan dana i nitko se ne javlja", session
      );
      assert.strictEqual(outcome, null, "žalba usred razgovora je dobila popis");
      assert.strictEqual(session.textbookSchoolId, undefined, "sesija nije očišćena");
    });

    it("nastavak sesije: žalba uz naziv škole ne dobiva popis (grana čekanja naziva)", () => {
      const session = {};
      buildTextbookOutcome("Pozdrav, imate li popis udzbenika za 1. razred ekonomske škole Bjelovar?", session);
      assert.strictEqual(session.textbookAwaitingSchool, true);
      const outcome = buildTextbookOutcome(
        "Ekonomska i birotehnička škola Bjelovar, ali čekam uplatu već tjedan dana i nitko se ne javlja", session
      );
      assert.strictEqual(outcome, null, "žalba usred razgovora je dobila popis");
      assert.strictEqual(session.textbookAwaitingSchool, undefined, "marker je preživio žalbu");
      assert.strictEqual(session.textbookRazred, undefined, "razred je preživio žalbu");
    });

    // Druga strana garda: rječnik je namjerno uzak. Ovo su rečenice koje dijele korijen
    // s nekim uzorkom ("kasnije" ~ "kasni", "čekam popis" ~ "čekam uplatu", "gdje je
    // popis" ~ "gdje je paket") i moraju i dalje dobiti popis.
    const NISU_ZALBE = [
      "Javit ću se kasnije za popis udžbenika, Gimnazija Daruvar",
      "Trebam popis udžbenika za Gimnaziju Daruvar, kasnim s kupnjom",
      "Nisam dobio popis udžbenika za Gimnaziju Daruvar",
      "Čekam popis udžbenika za Gimnaziju Daruvar",
      "Gdje mogu naći popis udžbenika za Gimnaziju Daruvar?",
      "Gdje je popis udžbenika za Gimnaziju Daruvar?"
    ];

    for (const upit of NISU_ZALBE) {
      it(`i dalje odgovara na: ${upit}`, () => {
        const outcome = buildTextbookOutcome(upit, {});
        assert.ok(outcome, "gard je ugasio legitiman upit za popisom");
        assert.match(outcome.customerMessage, /Gimnazija Daruvar/);
      });
    }

    // Korijeni u ZALBA_UZORCI moraju preživjeti deklinaciju i palatalizaciju isto kao
    // okidač. Svaki redak je oblik koji je uži korijen promašivao: "stigao" (muški rod,
    // l → o), "pošiljci" (k → c), "uplaćeno" (t → ć), "novca" (nepostojano a),
    // "udžbenik" uz korijen množine, "zamijeniti" (drugi korijen), "kasnio"/"čekao"
    // (prošlo vrijeme).
    const OBLICI_ZALBE = [
      "Paket s udžbenicima nije stigao, popis Gimnazija Daruvar",
      "Udžbenik nije stigao, popis Gimnazija Daruvar",
      "Gdje je moja pošiljci udžbenika, Gimnazija Daruvar",
      "Popis udžbenika Gimnazija Daruvar — nije mi uplaćeno za poslane knjige",
      "Čekam novca za udžbenike, Gimnazija Daruvar",
      "Želim zamijeniti udžbenik za Gimnaziju Daruvar, popis",
      "Paket je kasnio 10 dana, popis udžbenika Gimnazija Daruvar",
      "Čekao sam uplatu mjesec dana, popis udžbenika Gimnazija Daruvar"
    ];

    for (const zalba of OBLICI_ZALBE) {
      it(`padež i palatalizacija ne propuštaju žalbu: ${zalba}`, () => {
        assert.strictEqual(buildTextbookOutcome(zalba, {}), null);
      });
    }
  });
});
