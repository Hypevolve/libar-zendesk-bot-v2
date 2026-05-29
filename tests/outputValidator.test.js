const { validateAnswerQuality } = require("../services/outputValidator");

function assert(cond, msg) { if (!cond) throw new Error(`FAIL: ${msg}`); }

// Valid answer
const ok = validateAnswerQuality("Dostava traje 1-2 radna dana putem GLS-a.", { knowledgeContext: "GLS dostava 1-2 radna dana", userMessage: "koliko traje dostava" });
assert(ok.valid === true, "valid answer passes");

// Fabricated action claim
const fab = validateAnswerQuality("Provjerio sam vašu narudžbu i sve je u redu.", { knowledgeContext: "Radno vrijeme ponedjeljak-petak", userMessage: "kontakt" });
assert(fab.valid === false, "fabricated action detected");

// Low knowledge overlap (answer unrelated to empty context)
const lowOverlap = validateAnswerQuality("Ovo je potpuno nepoznat odgovor bez ikakve veze s ičime.", { knowledgeContext: "Dostava GLS-om traje jedan do dva radna dana u cijeloj Hrvatskoj.", userMessage: "status" });
assert(lowOverlap.valid === false, "low knowledge overlap rejected");

// Empty answer
const empty = validateAnswerQuality("", { knowledgeContext: "nesto", userMessage: "pitanje" });
assert(empty.valid === false, "empty answer invalid");

console.log("outputValidator.test.js — all passed ✓");
