const { describe, it } = require("node:test");
const assert = require("node:assert");
const { detectEscalationIntent } = require("../services/intentEscalationService");
const { normalizeForComparison } = require("../services/textUtils");

function n(text) {
  return normalizeForComparison(text);
}

describe("intentEscalationService", () => {
  describe("detectEscalationIntent", () => {
    it("escalates complaint_damaged for oštećenje", () => {
      const result = detectEscalationIntent(n("knjiga je oštećena"));
      assert.strictEqual(result.shouldEscalate, true);
      assert.strictEqual(result.intent, "complaint_damaged");
    });

    it("escalates complaint_damaged for pokidana", () => {
      const result = detectEscalationIntent(n("pokidana stranica"));
      assert.strictEqual(result.shouldEscalate, true);
      assert.strictEqual(result.intent, "complaint_damaged");
    });

    it("escalates return_refund for povrat novca", () => {
      const result = detectEscalationIntent(n("želim povrat novca"));
      assert.strictEqual(result.shouldEscalate, true);
      assert.strictEqual(result.intent, "return_refund");
    });

    it("escalates return_refund for reklamacija", () => {
      const result = detectEscalationIntent(n("podnosim reklamaciju"));
      assert.strictEqual(result.shouldEscalate, true);
      assert.strictEqual(result.intent, "return_refund");
    });

    it("escalates wrong_order for kriva narudžba", () => {
      const result = detectEscalationIntent(n("dobio sam krivu narudžbu"));
      assert.strictEqual(result.shouldEscalate, true);
      assert.strictEqual(result.intent, "wrong_order");
    });

    it("escalates legal_threat for odvjetnik", () => {
      const result = detectEscalationIntent(n("kontaktirat ću odvjetnika"));
      assert.strictEqual(result.shouldEscalate, true);
      assert.strictEqual(result.intent, "legal_threat");
    });

    it("escalates legal_threat for sud", () => {
      const result = detectEscalationIntent(n("prijavljujem vas na sud"));
      assert.strictEqual(result.shouldEscalate, true);
      assert.strictEqual(result.intent, "legal_threat");
    });

    it("escalates urgent_problem for hitno", () => {
      const result = detectEscalationIntent(n("hitno mi treba odgovor"));
      assert.strictEqual(result.shouldEscalate, true);
      assert.strictEqual(result.intent, "urgent_problem");
    });

    it("does NOT escalate for normal delivery query", () => {
      const result = detectEscalationIntent(n("koliko traje dostava"));
      assert.strictEqual(result.shouldEscalate, false);
    });

    it("does NOT escalate for normal price query", () => {
      const result = detectEscalationIntent(n("koliko košta udžbenik"));
      assert.strictEqual(result.shouldEscalate, false);
    });

    it("does NOT escalate for greeting", () => {
      const result = detectEscalationIntent(n("dobar dan"));
      assert.strictEqual(result.shouldEscalate, false);
    });

    it("does NOT escalate for otkup query", () => {
      const result = detectEscalationIntent(n("želim prodat udžbenike"));
      assert.strictEqual(result.shouldEscalate, false);
    });

    it("escalates for nedostaje stranica", () => {
      const result = detectEscalationIntent(n("u knjizi nedostaje stranica"));
      assert.strictEqual(result.shouldEscalate, true);
      assert.strictEqual(result.intent, "complaint_damaged");
    });

    it("returns a polite escalation message", () => {
      const result = detectEscalationIntent(n("knjiga je oštećena"));
      assert.ok(result.message);
      assert.ok(result.message.includes("timu"));
      assert.ok(result.message.includes("javiti"));
    });
  });

  describe("detectEscalationIntent — extended Croatian coverage", () => {
    // Female-gender first person (used-book buyers are often women)
    it("escalates wrong_order for female gender 'dobila sam krivu'", () => {
      const result = detectEscalationIntent(n("dobila sam krivu knjigu"));
      assert.strictEqual(result.shouldEscalate, true);
      assert.strictEqual(result.intent, "wrong_order");
    });

    // Damaged used-book condition scenarios
    it("escalates complaint_damaged for mokre stranice", () => {
      const result = detectEscalationIntent(n("stranice su mokre i zgužvane"));
      assert.strictEqual(result.shouldEscalate, true);
      assert.strictEqual(result.intent, "complaint_damaged");
    });

    it("escalates complaint_damaged for fali korica", () => {
      const result = detectEscalationIntent(n("knjizi fali korica"));
      assert.strictEqual(result.shouldEscalate, true);
      assert.strictEqual(result.intent, "complaint_damaged");
    });

    it("escalates complaint_damaged for smrdi na vlagu", () => {
      const result = detectEscalationIntent(n("knjiga smrdi na vlagu"));
      assert.strictEqual(result.shouldEscalate, true);
      assert.strictEqual(result.intent, "complaint_damaged");
    });

    it("escalates return_refund for raskid ugovora", () => {
      const result = detectEscalationIntent(n("želim jednostrani raskid ugovora"));
      assert.strictEqual(result.shouldEscalate, true);
      assert.strictEqual(result.intent, "return_refund");
    });

    it("escalates legal_threat for inspekcija", () => {
      const result = detectEscalationIntent(n("prijavit ću vas tržišnoj inspekciji"));
      assert.strictEqual(result.shouldEscalate, true);
    });

    // Guard against false positives that broke benign queries before
    it("does NOT escalate 'odmah ću naručiti' (benign 'odmah')", () => {
      const result = detectEscalationIntent(n("odmah ću naručiti udžbenik"));
      assert.strictEqual(result.shouldEscalate, false);
    });

    it("does NOT escalate generic potrošač question", () => {
      const result = detectEscalationIntent(n("imate li udžbenike za prvi razred"));
      assert.strictEqual(result.shouldEscalate, false);
    });

    it("does NOT escalate normal buyback question", () => {
      const result = detectEscalationIntent(n("kako mogu prodati svoje udžbenike"));
      assert.strictEqual(result.shouldEscalate, false);
    });
  });

  describe("detectEscalationIntent — order_issue (greška pri narudžbi)", () => {
    // Stvarni slučaj iz Zendeska: greška na checkoutu + nema potvrde o kupnji.
    // Bot nema pristup narudžbama pa OVO mora ići čovjeku, ne u self-service fallback.
    it("escalates for checkout error without confirmation (stvarni ticket)", () => {
      const result = detectEscalationIntent(n(
        "Pokusala sam naruciti knjige preko vase stranice, i na kraju mi je pisalo da se desilo greska sad ne znam dal su knjige narucene ili ne, nisam dobila ni potvrdu o kupnji"
      ));
      assert.strictEqual(result.shouldEscalate, true);
      assert.strictEqual(result.intent, "order_issue");
    });

    it("escalates for 'nisam dobio potvrdu narudžbe'", () => {
      const result = detectEscalationIntent(n("nisam dobio potvrdu narudžbe"));
      assert.strictEqual(result.shouldEscalate, true);
      assert.strictEqual(result.intent, "order_issue");
    });

    it("escalates for 'prilikom plaćanja se pojavila greška'", () => {
      const result = detectEscalationIntent(n("prilikom plaćanja se pojavila greška"));
      assert.strictEqual(result.shouldEscalate, true);
      assert.strictEqual(result.intent, "order_issue");
    });

    it("escalates for 'ne znam je li narudžba prošla'", () => {
      const result = detectEscalationIntent(n("ne znam je li narudžba prošla"));
      assert.strictEqual(result.shouldEscalate, true);
      assert.strictEqual(result.intent, "order_issue");
    });

    it("escalates for 'imam problem s narudžbom'", () => {
      const result = detectEscalationIntent(n("imam problem s narudžbom"));
      assert.strictEqual(result.shouldEscalate, true);
      assert.strictEqual(result.intent, "order_issue");
    });

    it("escalates for 'skinut mi je novac s kartice a narudžba nije prošla'", () => {
      const result = detectEscalationIntent(n("skinut mi je novac s kartice a narudžba nije prošla"));
      assert.strictEqual(result.shouldEscalate, true);
      assert.strictEqual(result.intent, "order_issue");
    });

    // Benigni upiti o naručivanju NE smiju eskalirati (bot ih dobro odgovara iz KB)
    it("does NOT escalate 'kako mogu naručiti udžbenik'", () => {
      const result = detectEscalationIntent(n("kako mogu naručiti udžbenik"));
      assert.strictEqual(result.shouldEscalate, false);
    });

    it("does NOT escalate 'želim naručiti knjige'", () => {
      const result = detectEscalationIntent(n("želim naručiti knjige"));
      assert.strictEqual(result.shouldEscalate, false);
    });

    it("does NOT escalate 'naručila sam knjige i zanima me kada stižu'", () => {
      const result = detectEscalationIntent(n("naručila sam knjige i zanima me kada stižu"));
      assert.strictEqual(result.shouldEscalate, false);
    });
  });

  describe("detectEscalationIntent — zatvorene rupe u rječniku", () => {
    // Sedam stvarnih situacija koje su prije završavale u bazi znanja umjesto kod čovjeka.
    const RUPE = [
      ["Poslao sam udžbenike i nisu mi platili, ovo je prijevara", "fraud_accusation"],
      ["Krivi udžbenik ste mi poslali, tražim zamjenu", "wrong_order"],
      ["Pogrešan udžbenik sam dobio", "wrong_order"],
      ["Već tjedan dana čekam uplatu", "payment_missing"],
      ["Prevarili ste me s udžbenicima", "fraud_accusation"],
      ["Gdje mi je paket, kasni već 10 dana", "urgent_problem"],
      ["Nezadovoljan sam uslugom", "service_complaint"]
    ];

    for (const [query, intent] of RUPE) {
      it(`escalates '${query}' kao ${intent}`, () => {
        const result = detectEscalationIntent(n(query));
        assert.strictEqual(result.shouldEscalate, true);
        assert.strictEqual(result.intent, intent);
        assert.ok(result.message && result.message.includes("javiti"));
      });
    }

    // U knjižari udžbenika "udžbenik" mora biti ravnopravan s "knjigom".
    for (const query of ["pogrešna knjiga", "pogrešan udžbenik", "krivi udžbenik", "kriva knjiga",
      "poslali ste mi pogrešni udžbenik", "dobila sam krivi udžbenik"]) {
      it(`escalates wrong_order za '${query}'`, () => {
        const result = detectEscalationIntent(n(query));
        assert.strictEqual(result.shouldEscalate, true);
        assert.strictEqual(result.intent, "wrong_order");
      });
    }

    // Dodatni oblici izostale isplate za otkup
    it("escalates payment_missing za 'uplata kasni'", () => {
      const result = detectEscalationIntent(n("uplata kasni već dulje vrijeme"));
      assert.strictEqual(result.shouldEscalate, true);
      assert.strictEqual(result.intent, "payment_missing");
    });

    it("escalates payment_missing za 'isplata nije stigla'", () => {
      const result = detectEscalationIntent(n("poslala sam udžbenike ali isplata nije stigla"));
      assert.strictEqual(result.shouldEscalate, true);
      assert.strictEqual(result.intent, "payment_missing");
    });
  });

  describe("detectEscalationIntent — kontrolni upiti koji NE smiju eskalirati", () => {
    // Osam radnih putanja koje bot danas ispravno odgovara iz baze znanja.
    const KONTROLE = [
      "Kako naručiti udžbenike?",
      "Otkupljujete li udžbenike?",
      "Otkupljujete li udžbenike fizike?",
      "Koliko dobivam za otkup udžbenika matematike?",
      "Koliko košta dostava?",
      "Koliko dugo traje dostava knjiga?",
      "Koja je cijena udžbenika za 3. razred gimnazije?",
      "Kada mogu očekivati uplatu za poslane udžbenike (otkup)?"
    ];

    for (const query of KONTROLE) {
      it(`does NOT escalate '${query}'`, () => {
        const result = detectEscalationIntent(n(query));
        assert.strictEqual(result.shouldEscalate, false);
      });
    }

    // Granica isplate: pitanje o standardnom roku ostaje botu, pritužba na
    // protekli rok ide čovjeku. Uzorci okidaju na predikat, ne na imenicu.
    const BENIGNA_ISPLATA = [
      "Kada mogu očekivati uplatu nakon što sam poslao knjige?",
      "Koliko se čeka na uplatu?",
      "Kada dobivam novac za online otkup?",
      "Koliko dana traje isplata?",
      "Na koji način vršite isplatu za otkup?"
    ];

    for (const query of BENIGNA_ISPLATA) {
      it(`does NOT escalate benigno pitanje o isplati: '${query}'`, () => {
        const result = detectEscalationIntent(n(query));
        assert.strictEqual(result.shouldEscalate, false);
      });
    }

    // Popis udžbenika ima gate IZA eskalacije — ovi upiti mu se ne smiju oteti.
    const POPIS = [
      "popis udžbenika Gimnazija Daruvar 2. razred",
      "trebam popis udžbenika za Gimnaziju Daruvar",
      "trebaju mi udžbenici za 1. razred medicinske škole u Bjelovaru",
      "trebam popis udžbenika"
    ];

    for (const query of POPIS) {
      it(`does NOT escalate upit za popis udžbenika: '${query}'`, () => {
        const result = detectEscalationIntent(n(query));
        assert.strictEqual(result.shouldEscalate, false);
      });
    }
  });

  // Prijava od 2026-07-31: korisnik je na web widgetu napisao "Dali mogu razgovarati
  // s agentom" (tiket 91163) i dobio generički self-service letak jer rječnik nije
  // imao nijedan uzorak za izravan zahtjev za čovjekom. Izravan zahtjev je najjasniji
  // mogući signal i mora ići čovjeku bez ijednog LLM poziva.
  describe("detectEscalationIntent — human_agent_request", () => {
    const requests = [
      "Dali mogu razgovarati s agentom",
      "želim razgovarati s čovjekom",
      "mogu li pričati sa agentom",
      "spojite me s agentom",
      "prebacite me na čovjeka",
      "trebam pravog čovjeka",
      "dajte mi agenta",
      "hoću ljudsku podršku",
      "ne želim razgovarati s botom",
      "može li se javiti neki djelatnik"
    ];

    for (const query of requests) {
      it(`escalates human_agent_request for '${query}'`, () => {
        const result = detectEscalationIntent(n(query));
        assert.strictEqual(result.shouldEscalate, true);
        assert.strictEqual(result.intent, "human_agent_request");
      });
    }

    // Rječnik ne smije pojesti benigne upite — "osob" je namjerno izostavljen iz
    // uzoraka jer bi "osobno preuzimanje" završilo na eskalaciji.
    const benign = [
      "mogu li knjige preuzeti osobno",
      "je li osobno preuzimanje besplatno",
      "kako mogu kupiti udžbenike",
      "želim naručiti knjige za prvi razred",
      "koliko traje dostava"
    ];

    for (const query of benign) {
      it(`does NOT escalate '${query}'`, () => {
        const result = detectEscalationIntent(n(query));
        assert.strictEqual(result.shouldEscalate, false);
      });
    }
  });
});
