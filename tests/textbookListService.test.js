const { describe, it } = require("node:test");
const assert = require("node:assert");
const { findSchool } = require("../services/textbookListService");

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
  });
});
