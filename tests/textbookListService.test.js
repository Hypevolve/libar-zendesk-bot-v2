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
      it(`ne pogađa "${kriva}" na: ${upit}`, () => {
        const r = findSchool(upit);
        assert.notStrictEqual(
          r.status === "match" ? r.school.naziv : null,
          kriva,
          `poslan je popis krive škole: ${kriva}`
        );
      });
    }
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
