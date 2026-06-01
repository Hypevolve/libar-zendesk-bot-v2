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
      /kriv[aeiou]? narudzb/, /pogresn[aeiou]? (knjig|artikl|narudzb|posiljk)/,
      /poslali ste (mi )?krivo/, /poslali ste (mi )?pogresn/,
      /nije ono sto sam naruci/, /ovo nisam naruci/, /ovo nisam trazi/,
      /dobio sam kriv/, /dobila sam kriv/, /dobio sam pogresn/, /dobila sam pogresn/,
      /stigl[aoi].{0,15}(kriv|pogresn|druga knjig|drugi artikl)/,
      /zamijenili ste/, /naruci(o|la) sam .{0,30}(a )?(dobi|stig)/
    ],
    message: "Žao nam je zbog neugodnosti! Vaš upit o pogrešnoj pošiljci prosljeđujemo timu koji će Vam se javiti s rješenjem."
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
      /ne javljate se/, /ne odgovarate/, /nitko se ne javlja/,
      /jos cekam odgovor/, /dugo cekam/, /cekam vec/
    ],
    message: "Razumijemo hitnost Vašeg upita. Prosljeđujemo Vas našem timu koji će Vam se javiti u najkraćem mogućem roku."
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
