const { buildGroundedAnswerPrompt, buildSystemPrompt } = require("../services/aiService");

function assert(cond, msg) { if (!cond) throw new Error(`FAIL: ${msg}`); }

// Kupac je uvijek već u izravnom razgovoru (chat/email/fb), pa bot ne smije
// sam od sebe slati kupca na mail/telefon. Pravilo mora biti u promptu, neovisno o kanalu.
for (const channel of ["web_chat", "email", "facebook", "unknown"]) {
  const grounded = buildGroundedAnswerPrompt("Nema pronađenog konteksta.", { channelType: channel });
  assert(/RAZGOVOR JE VEĆ U TIJEKU/.test(grounded),
    `grounded prompt (${channel}) sadrži pravilo o razgovoru u tijeku`);
  assert(/ne upu[ćc]uj|ne dodaj/i.test(grounded),
    `grounded prompt (${channel}) zabranjuje generičko preusmjeravanje na kontakt`);
  // Iznimka mora ostati: ako kupac izričito traži kontakt, bot ga smije dati.
  assert(/izri[čc]ito/i.test(grounded),
    `grounded prompt (${channel}) zadržava iznimku 'samo ako izričito traži'`);

  const sys = buildSystemPrompt("Nema pronađenog konteksta.", { channelType: channel });
  assert(/RAZGOVOR JE VEĆ U TIJEKU/.test(sys),
    `system prompt (${channel}) sadrži pravilo o razgovoru u tijeku`);
}

console.log("groundedPrompt.test.js — all passed ✓");
