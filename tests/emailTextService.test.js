/**
 * Test: emailTextService — izvlačenje kupčevog teksta iz dolaznog emaila.
 * Primjeri su skraćeni oblici stvarnih poruka iz Zendeska (bez osobnih podataka).
 */
const test = require("node:test");
const assert = require("node:assert");

const {
  prepareEmailText, stripQuotedReply, stripSignature, extractContactFormMessage
} = require("../services/emailTextService");

const LIBAR_TEMPLATE = [
  "> Imate kakvih pitanja?",
  "> Slobodno nam se obratite na našoj Facebook stranici, putem email adrese info@antikvarijat-libar.com ili odgovorite na ovaj email.",
  ">",
  "> # Vaša narudžba je poslana",
  "> Uvjeti poslovanja",
  "> Opći uvjeti"
].join("\n");

// ─── Citati ────────────────────────────────────────────────────

test("odgovor na naš automatski mail: ostaje samo kupčev tekst (Gmail HR zaglavlje)", () => {
  const raw = [
    "Pozdrav, kada mogu očekivati paket?",
    "",
    "pon, 5. lis 2026. 09:38 Antikvarijat Libar <info@antikvarijat-libar.com> je napisao:",
    "",
    LIBAR_TEMPLATE
  ].join("\n");
  const out = prepareEmailText(raw);
  assert.strictEqual(out.text, "Pozdrav, kada mogu očekivati paket?");
  assert.strictEqual(out.parts.quoteRemoved, true);
});

test("zaglavlje prelomljeno u dva retka i varijanta 'napisao je'", () => {
  const raw = [
    "Molim otkazati narudžbu.",
    "",
    "čet, 27. kol 2026. u 10:43 Antikvarijat Libar <",
    "info@antikvarijat-libar.com> napisao je:",
    LIBAR_TEMPLATE
  ].join("\n");
  assert.strictEqual(stripQuotedReply(raw), "Molim otkazati narudžbu.");
});

test("engleski Gmail 'wrote:' i '>' citat", () => {
  assert.strictEqual(stripQuotedReply("Thanks!\n\nOn Mon, Oct 5, 2026 at 9:38 AM Libar <info@x.com> wrote:\n> old"), "Thanks!");
  assert.strictEqual(stripQuotedReply("Hvala\n> citirani redak"), "Hvala");
});

test("Outlook blok (Šalje/Datum/Predmet) i separator crtica", () => {
  const hr = "Imam još knjiga za otkup.\n\nŠalje: **Antikvarijat Libar** <info@antikvarijat-libar.com>\nDatum: 8. 9. 2026. 08:35\nPredmet: Vaš nalog otkupa je zaprimljen.";
  assert.strictEqual(stripQuotedReply(hr), "Imam još knjiga za otkup.");
  const en = "Da li ste zainteresirani?\n\n________________________________\n**From:** Tomislav <t@x.hr>\n **Sent:** Tuesday\n **To:** Libar";
  assert.strictEqual(stripQuotedReply(en), "Da li ste zainteresirani?");
});

test("proslijeđeni mail bez vlastitog teksta: vraća se izvornik (nema se što izgubiti)", () => {
  const raw = "---------- Forwarded message ---------\nŠalje: Ivana <i@x.hr>\nDate: pet, 2. lis 2026. 10:52\nSubject: Povrat\n\nŽelim vratiti udžbenik.";
  const out = prepareEmailText(raw);
  assert.strictEqual(out.text, raw);
  assert.strictEqual(out.parts.quoteRemoved, false);
});

test("'Kolega mi je napisao:' u tekstu kupca nije citat", () => {
  const raw = "Kolega mi je napisao:\nda imate Focus 3. Je li to točno?";
  assert.strictEqual(stripQuotedReply(raw), raw);
});

test("mail bez citata ostaje nepromijenjen", () => {
  const raw = "Poštovani, imate li udžbenik Focus 3?\nHvala, Zdenka";
  const out = prepareEmailText(raw);
  assert.strictEqual(out.text, raw);
  assert.strictEqual(out.changed, false);
});

test("kratak tekst iznad citata ('Poslano, lp.') ima prednost pred našim predloškom", () => {
  const raw = "Poslano,lp.\n\nčet, 3. ruj 2026. u 20:25 Antikvarijat Libar <info@antikvarijat-libar.com> napisao je:\n\n" + LIBAR_TEMPLATE;
  assert.strictEqual(prepareEmailText(raw).text, "Poslano,lp.");
});

// ─── Potpisi ───────────────────────────────────────────────────

test("mobilni potpisi i '-- ' delimiter se uklanjaju", () => {
  assert.strictEqual(stripSignature("Molim ponudu.\n\nPoslano s mojeg iPhonea"), "Molim ponudu.");
  assert.strictEqual(stripSignature("Molim ponudu.\n\nPoslano iz aplikacije Outlook za Android"), "Molim ponudu.");
  assert.strictEqual(stripSignature("Molim ponudu.\n--\nDražen +385 91 000 000"), "Molim ponudu.");
});

test("botov potpis ('---' + Vaš Libar AI Asistent) se NE reže kao potpis", () => {
  const bot = "Dostava traje 2-3 dana.\n\n---\n*Vaš Libar AI Asistent*";
  assert.strictEqual(stripSignature(bot), bot);
  assert.strictEqual(stripQuotedReply(bot), bot);
});

// ─── Kontakt forma ─────────────────────────────────────────────

test("kontakt forma: samo poruka i mjesto, bez zaglavlja i podnožja", () => {
  const raw = [
    "Zaprimili ste novi kontakt upit:", "", "**Ime i prezime:**", "Sanja V.", "", "**E-mail:**", "s@x.hr", "",
    "**Grad/mjesto:**", "ZADAR 23000", "", "**Poruka:**", "Tražim knjigu Stabilnost broda za 3. razred.", "",
    "**Stranica:**", "Kontakt (https://antikvarijat-libar.com/kontakt/)", "", "---", "Ovaj e-mail je poslan s forme"
  ].join("\n");
  assert.strictEqual(extractContactFormMessage(raw), "Tražim knjigu Stabilnost broda za 3. razred.\n(Mjesto: ZADAR 23000)");
  assert.strictEqual(prepareEmailText(raw).parts.contactForm, true);
});

test("običan mail nije kontakt forma", () => {
  assert.strictEqual(extractContactFormMessage("Poštovani, imate li Focus 3?"), null);
});

// ─── Naslov ────────────────────────────────────────────────────

test("kratko tijelo dobiva naslov maila (pitanje je često u naslovu)", () => {
  const out = prepareEmailText("Imate li ovo? Hvala", { subject: "Udžbenik Focus 3" });
  assert.strictEqual(out.text, "Udžbenik Focus 3\nImate li ovo? Hvala");
  assert.strictEqual(out.parts.subjectAdded, true);
});

test("naslov odgovora ('Re:') se ne dodaje — to je naslov našeg maila", () => {
  const out = prepareEmailText("Kada stiže?", { subject: "Re: Vaša narudžba je poslana" });
  assert.strictEqual(out.text, "Kada stiže?");
  assert.strictEqual(out.parts.subjectAdded, false);
});

test("dugo tijelo ne dobiva naslov", () => {
  const body = "Poštovani, ".repeat(20) + "imate li Focus 3?";
  assert.strictEqual(prepareEmailText(body, { subject: "Upit" }).parts.subjectAdded, false);
});

test("prazan ulaz ne puca", () => {
  assert.deepStrictEqual(prepareEmailText("").text, "");
  assert.strictEqual(prepareEmailText(null).text, "");
  assert.strictEqual(stripQuotedReply(undefined), "");
});
