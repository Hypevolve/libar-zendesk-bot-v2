const { describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const {
  findSchool,
  parseRazred,
  buildTextbookOutcome,
  loadIndex,
  DISCLAIMER
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

    it("nijedan upit iz e2e korpusa stvarnih tiketa ne aktivira gate", () => {
      const oteti = GENERATED_SCENARIOS
        .map((scenarij) => ({ scenarij, outcome: buildTextbookOutcome(scenarij.query, {}) }))
        .filter((r) => r.outcome !== null)
        .map((r) => `${r.scenarij.id} (${r.outcome.reason}): ${r.scenarij.query}`);
      assert.deepStrictEqual(oteti, [], `gate je oteo postojeće upite:\n${oteti.join("\n")}`);
    });
  });
});
