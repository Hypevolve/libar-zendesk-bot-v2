/**
 * Intent Escalation Service
 * Detects intents that MUST be escalated to a human agent.
 * Regex-based fast detection for Croatian support queries.
 */

const ESCALATION_INTENTS = [
  {
    intent: "complaint_damaged",
    patterns: [/ostecen[aeiou]?\b/, /pokidan[aeiou]?\b/, /slomlj/, /razderen/, /otrgnu/, /defekt/, /nedostaje stranica/, /kriv[aeiou]? knjig/],
    message: "Žao nam je što ste imali problema! Vaš slučaj prosljeđujemo našem timu koji će Vam se javiti u najkraćem roku s rješenjem."
  },
  {
    intent: "return_refund",
    patterns: [/povrat novca/, /vrati(te)? novac/, /refund/, /reklamacij[aeiou]/, /povrat (robe|knjig)/, /vracam/, /vratit cu/],
    message: "Razumijemo Vaš zahtjev. Prosljeđujemo Vas našem timu za reklamacije koji će Vam se javiti s detaljima postupka."
  },
  {
    intent: "wrong_order",
    patterns: [/kriv[aeiou]? narudzb/, /pogresn[aeiou]? (knjig|artikl|narudzb)/, /poslali ste (mi )?krivo/, /nije ono sto sam narucio/, /dobio sam kriv/],
    message: "Žao nam je zbog neugodnosti! Vaš upit o pogrešnoj pošiljci prosljeđujemo timu koji će Vam se javiti s rješenjem."
  },
  {
    intent: "legal_threat",
    patterns: [/odvjetnik/, /tuzb[aeiou]/, /tuzit cu/, /pravni/, /sud\b/, /inspekcij/, /zakon o zastit/, /prigovor/, /potrosac/],
    message: "Vaš upit smo zabilježili. Naš tim će Vam se javiti u najkraćem roku."
  },
  {
    intent: "urgent_problem",
    patterns: [/hitno/, /urgentno/, /odmah/, /vec (dva|tri|cetiri|pet|sest) (dana|tjedn)/, /ne javljate se/, /ne odgovarate/, /cekam odgovor/],
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
