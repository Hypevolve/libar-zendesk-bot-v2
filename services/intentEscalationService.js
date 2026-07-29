/**
 * Intent Escalation Service
 * Detects intents that MUST be escalated to a human agent.
 * Regex-based fast detection for Croatian support queries.
 *
 * IMPORTANT: input is expected to be normalised via textUtils.normalizeForComparison
 * (lowercase + diacritics folded, so č→c, ž→z, š→s, đ→d). All patterns below are
 * therefore written WITHOUT diacritics and in lowercase. Patterns try to cover the
 * rich Croatian inflection (a/e/i/o/u/om/ama endings) and both grammatical genders
 * (e.g. narucio/narucila, dobio/dobila) since customers write in first person.
 */

const ESCALATION_INTENTS = [
  {
    intent: "complaint_damaged",
    patterns: [
      /ostecen/, /pokidan/, /poderan/, /razderen/, /otrgnu/, /pokvaren/,
      /slomlj/, /defekt/, /neispravn/,
      /nedostaje (stranic|koric|list)/, /fali (stranic|koric|list|dio)/,
      /(stranice|korice|listovi).{0,20}(mokr|vlazn|zguzvan|isaran|poderan|nedostaj)/,
      /(mokr|vlazn|zguzvan|isaran|prljav).{0,20}(stranic|koric|knjig)/,
      /smrdi/, /plijesan/, /pljesniv/, /vlaga u knjiz/,
      /knjiga.{0,20}(los|ostecen|neispravn|pogresn)/,
      /(los|losem) stanj/, /nije u opisanom stanj/
    ],
    message: "Žao nam je što ste imali problema! Vaš slučaj prosljeđujemo našem timu koji će Vam se javiti u najkraćem roku s rješenjem."
  },
  {
    intent: "return_refund",
    patterns: [
      /povrat novca/, /vrati(te)? novac/, /vracanje novca/, /refund/,
      /reklamacij/, /reklamir/,
      /povrat (robe|knjig|artikl|narudzb)/, /vracam (knjig|robu|narudzb|artikl)/,
      /zelim vratiti/, /htio bih vratiti/, /htjela bih vratiti/, /vratit cu/,
      /raskid ugovor/, /jednostrani raskid/, /odustajem od kupnj/
    ],
    message: "Razumijemo Vaš zahtjev. Prosljeđujemo Vas našem timu za reklamacije koji će Vam se javiti s detaljima postupka."
  },
  {
    intent: "wrong_order",
    patterns: [
      // Imenice pokrivaju i "udzbenik" — u knjižari udžbenika "pogresan udzbenik" je
      // isti slučaj kao "pogresna knjiga". "pogres(a)?n" hvata i nepostojani a
      // (pogrešan / pogrešna / pogrešni).
      /kriv[aeiou]? (narudzb|knjig|udzbenik|udzbenic|artikl|posiljk|komplet|primjerak)/,
      /pogres(a)?n[aeiou]? (knjig|udzbenik|udzbenic|artikl|narudzb|posiljk|komplet|primjerak)/,
      /poslali ste (mi )?krivo/, /poslali ste (mi )?pogresn/,
      /nije ono sto sam naruci/, /ovo nisam naruci/, /ovo nisam trazi/,
      /dobio sam kriv/, /dobila sam kriv/, /dobio sam pogresn/, /dobila sam pogresn/,
      /stigl[aoi].{0,15}(kriv|pogresn|druga knjig|drugi artikl)/,
      /zamijenili ste/, /naruci(o|la) sam .{0,30}(a )?(dobi|stig)/
    ],
    message: "Žao nam je zbog neugodnosti! Vaš upit o pogrešnoj pošiljci prosljeđujemo timu koji će Vam se javiti s rješenjem."
  },
  {
    // Greška pri narudžbi/plaćanju ili izostanak potvrde — bot nema pristup
    // narudžbama pa ne može provjeriti je li narudžba prošla; mora ići čovjeku.
    // (Prije je ovakav upit padao u generički self-service fallback.)
    intent: "order_issue",
    patterns: [
      /(greska|greske|gresku|error|problem).{0,40}(naruc|narudzb|kupnj|placanj|webshop|kosaric)/,
      /(naruc|narudzb|kupnj|placanj|webshop|kosaric).{0,40}(greska|greske|gresku|error|problem|ne radi|nije (prosl|uspjel)|neuspje)/,
      /nisam dobi(o|la).{0,30}potvrd/, /nije (mi )?(stigla|dosla).{0,20}potvrd/,
      /(ne znam|nisam sigur|nije (mi )?jasno).{0,40}(naruce|narudzb)/,
      /(je li|jel|jeli|da li|dal[i]? ).{0,30}narudzb.{0,30}(prosl|zaprimljen|uspjel|evidentiran)/,
      /(skinut|naplacen|terecen).{0,30}(novac|kartic|iznos)/,
      /(novac|kartic|iznos).{0,30}(skinut|naplacen|terecen)/
    ],
    message: "Žao nam je zbog poteškoća s narudžbom! Vaš upit prosljeđujemo našem timu koji će provjeriti status narudžbe i javiti Vam se u najkraćem roku."
  },
  {
    // Optužba za prijevaru ("ovo je prijevara", "prevarili ste me"). Najjači
    // signal u poruci — ide ispred ostalih pritužbi jer određuje prioritet trijaže.
    // Poruka je namjerno neutralna: bot ne smije ni priznati ni poricati.
    intent: "fraud_accusation",
    patterns: [
      /prijevar/, /prevar/,
      /varate (me|nas|ljude|kupce)/, /lazete/, /lopov/,
      /(ovo|to) je (obmana|podvala|krada)/
    ],
    message: "Žao nam je što ste stekli takav dojam. Vaš slučaj odmah prosljeđujemo našem timu koji će ga provjeriti i javiti Vam se u najkraćem roku."
  },
  {
    // Izostala ili zakašnjela isplata za otkup. Bot nema pristup evidenciji
    // isplata pa ne može provjeriti status — mora ići čovjeku.
    //
    // VAŽNA GRANICA: hvata se isključivo pritužba na PROTEKLI rok (predikat
    // "kasni", "nije stigla", "nisu mi platili", "vec ... cekam"). Pitanje o
    // standardnom roku ("kada mogu ocekivati uplatu", "koliko se ceka na uplatu")
    // NE eskalira — na to bot ima odgovor u bazi znanja. Zato uzorci nikad ne
    // okidaju na samu imenicu "uplata/isplata", nego samo u paru s predikatom.
    intent: "payment_missing",
    patterns: [
      /(nisu|niste) (mi )?(jos )?(platili|uplatili|isplatili)/,
      /nije (mi )?(jos )?(placeno|uplaceno|isplaceno)/,
      /(uplat|isplat|novac).{0,25}(kasni|nije stig|nije dos|nije sjel|jos nije|nije jos|nije uplacen|nije isplacen|nije evidentiran)/,
      /(kasni|nije stigla|jos cekam).{0,25}(uplat|isplat)/,
      /(vec|jos).{0,30}(cekam|cekamo).{0,25}(uplat|isplat|novac)/,
      /gdje (mi )?je (moj[aeu]? )?(novac|uplata|isplata)/
    ],
    message: "Žao nam je zbog čekanja! Vaš upit o isplati prosljeđujemo našem timu koji će provjeriti status Vaše pošiljke i javiti Vam se u najkraćem roku."
  },
  {
    intent: "legal_threat",
    patterns: [
      /odvjetnik/, /odvjetnic/, /tuzb[aeiou]/, /tuzit cu/, /tuzi(t|m|li)/,
      /pravni (postupak|put|korak|savjet)/, /sudski/, /\bna sud\b/, /\bsud\b/,
      /inspekcij/, /trzisna inspekcij/, /zakon o zastit potrosac/,
      /prava potrosac/, /prijav(it|lj)/, /podnosim prigovor/, /sluzbeni prigovor/
    ],
    message: "Vaš upit smo zabilježili. Naš tim će Vam se javiti u najkraćem roku."
  },
  {
    intent: "urgent_problem",
    patterns: [
      /\bhitno\b/, /urgentno/, /\bsto hitnije\b/,
      /vec (dva|tri|cetiri|pet|sest|nekoliko) (dana|tjedn)/,
      // Trajanje napisano brojkom ili u jednini ("vec 10 dana", "vec tjedan dana",
      // "vec mjesec dana") — gornji uzorak hvata samo ispisane brojeve u množini.
      /vec (\d{1,3}|sedam|osam|devet|deset|petnaest|dvadeset|tjedan|mjesec|godinu|par) (dana|tjedn|mjesec)/,
      /vec (dulje|duze) (vrijeme|od)/,
      // Zakašnjela pošiljka ("paket kasni", "narudzba kasni vec 10 dana")
      /(paket|posiljk|narudzb|dostava|isporuka).{0,15}kasni/, /kasni (vec|jos)/,
      /ne javljate se/, /ne odgovarate/, /nitko se ne javlja/,
      /jos cekam odgovor/, /dugo cekam/, /cekam vec/
    ],
    message: "Razumijemo hitnost Vašeg upita. Prosljeđujemo Vas našem timu koji će Vam se javiti u najkraćem mogućem roku."
  },
  {
    // Općenito nezadovoljstvo uslugom bez konkretnog oštećenja, povrata ili
    // pogrešne pošiljke ("nezadovoljan sam uslugom", "razocarana sam"). Namjerno
    // je POSLJEDNJI u nizu — konkretniji intenti (oštećenje, povrat, kriva
    // pošiljka, isplata) imaju prednost i daju korisniju poruku.
    intent: "service_complaint",
    patterns: [
      /nezadovolj/, /razocara/,
      /zalim se/, /\bzalb[aeiou]/, /prituzb/,
      /(uzasn|katastrofaln|sramotn|ocajn|najgor|grozn|nikakv)[aeiou]{0,3} ?(usluga|uslugu|uslugom|iskustv|odnos|podrsk|komunikacij)/,
      /(usluga|uslugu|uslugom|iskustvo|odnos|komunikacij|podrsk).{0,25}(uzasn|katastrof|sramot|ocajn|najgor|grozn|nikakv)/,
      /(katastrofa|sramota)\b/
    ],
    message: "Žao nam je što niste zadovoljni! Vaš slučaj prosljeđujemo našem timu koji će Vam se javiti u najkraćem roku."
  }
];

function detectEscalationIntent(normMsg) {
  for (const { intent, patterns, message } of ESCALATION_INTENTS) {
    for (const pattern of patterns) {
      if (pattern.test(normMsg)) {
        return { shouldEscalate: true, intent, reason: `intent_${intent}`, message };
      }
    }
  }
  return { shouldEscalate: false };
}

module.exports = { ESCALATION_INTENTS, detectEscalationIntent };
