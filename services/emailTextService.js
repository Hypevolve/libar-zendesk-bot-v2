/**
 * Email Text Service
 *
 * Iz dolaznog emaila izvlači ono što je kupac stvarno napisao, prije nego što
 * tekst ide u detekciju eskalacije, pretragu baze i generiranje odgovora.
 *
 * Zašto: Zendesk šalje cijelo tijelo maila. Kad kupac odgovori na naš
 * automatski mail (narudžba poslana, otkup zaprimljen…), ~88% poruke je
 * citirani predložak — pretraga baze tada traži po našem predlošku, a ne po
 * pitanju. Kad je tijelo kratko ("imate li ovo?"), pitanje je često u naslovu,
 * koji bot dosad nije vidio.
 *
 * Sve funkcije su čiste (bez mreže) i konzervativne: kad ne prepoznaju
 * strukturu ili bi rezultat ostao prazan, vraćaju izvorni tekst.
 */

// "pon, 5. lis 2026. 09:38 Antikvarijat Libar <info@…> je napisao:" (Gmail HR),
// "On Mon, Oct 5, 2026 at 9:38 AM X <…> wrote:" (Gmail EN) i slični.
const QUOTE_HEADER_LINE_RE = /(je napisa[oa]|napisa[oa] je|wrote|schrieb|a écrit|ha scritto)\s*:\s*$/i;
// Prijelom Gmail zaglavlja u dva retka: "… Antikvarijat Libar <" + "info@…> je napisao:"
const WRAPPED_HEADER_START_RE = /\d{4}\.?.{0,80}$/;
const HEADER_EVIDENCE_RE = /\d{1,2}:\d{2}|@|\b\d{4}\b/;

const FORWARD_LINE_RE = /^\s*-{2,}\s*(forwarded message|original message|izvorna poruka|proslijeđena poruka|prosljeđena poruka|prosleđena poruka)\s*-{2,}\s*$/i;

// Outlook blok: "From:/Od:/Šalje:" pa unutar par redaka "Sent:/Datum:/Subject:/Predmet:…"
const OUTLOOK_FROM_RE = /^\s*\**(from|od|šalje|sender|pošiljatelj)\**\s*:/i;
const OUTLOOK_META_RE = /^\s*\**(sent|poslano|date|datum|subject|predmet|to|prima|cc)\**\s*:/i;
const SEPARATOR_LINE_RE = /^\s*_{5,}\s*$/;

const SIGNATURE_DELIMITER_RE = /^--\s?$/;
const MOBILE_SIGNATURE_RE = /^\s*(sent from (my |outlook|yahoo|mail)|get outlook for|poslano (s|sa|iz) (mog|mojeg|moga|aplikacije|uređaja)|šalje se s|poslano s uređaja)/i;

// Ako iznad citata nema baš ničega (kupac je samo proslijedio mail ili pisao
// ispod citata), vrati izvornik — inače je i kratko "Poslano, lp." bolji ulaz od
// našeg citiranog predloška.
const MIN_CONTENT_CHARS = 2;

function meaningfulLength(text) {
  return String(text || "").replace(/[\s>*_\-–—.,!]+/g, "").length;
}

/**
 * Indeks retka na kojem počinje citat/proslijeđeni sadržaj, ili -1.
 * Gleda: zaglavlje odgovora, "> " citat, forward separator, Outlook blok.
 */
function findQuoteStartLine(lines) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (QUOTE_HEADER_LINE_RE.test(line)) {
      const prev = i > 0 ? lines[i - 1] : "";
      // Zaglavlje prelomljeno u dva retka — počni od prethodnog ako nosi datum.
      if (prev && WRAPPED_HEADER_START_RE.test(prev) && !/[.!?]\s*$/.test(prev)) return i - 1;
      // Pravo zaglavlje nosi vrijeme, godinu ili adresu; "Kolega mi je napisao:"
      // u tekstu kupca nije citat i ne smije odrezati ostatak poruke.
      if (HEADER_EVIDENCE_RE.test(line)) return i;
    }
    if (/^\s*>/.test(line)) return i;
    if (FORWARD_LINE_RE.test(line)) return i;
    if (SEPARATOR_LINE_RE.test(line)) {
      const next = lines.slice(i + 1, i + 3).find((l) => l.trim());
      if (next && OUTLOOK_FROM_RE.test(next)) return i;
    }
    if (OUTLOOK_FROM_RE.test(line)) {
      const following = lines.slice(i + 1, i + 5);
      if (following.some((l) => OUTLOOK_META_RE.test(l))) return i;
    }
  }
  return -1;
}

/**
 * Tekst prije citiranog/proslijeđenog dijela. Može biti prazan string (kupac
 * je pisao ispod citata ili samo proslijedio mail) — pozivatelj odlučuje što tada.
 */
function stripQuotedReply(text = "") {
  const lines = String(text || "").split(/\r?\n/);
  const start = findQuoteStartLine(lines);
  if (start === -1) return String(text || "");
  return lines.slice(0, start).join("\n").trimEnd();
}

/** Uklanja potpis ("-- " i sve ispod) i mobilne potpise ("Poslano s mojeg iPhonea"). */
function stripSignature(text = "") {
  const lines = String(text || "").split(/\r?\n/);
  const cut = lines.findIndex((l) => SIGNATURE_DELIMITER_RE.test(l) || MOBILE_SIGNATURE_RE.test(l));
  if (cut === -1) return String(text || "");
  return lines.slice(0, cut).join("\n").trimEnd();
}

/**
 * Poruka iz WordPress kontakt forme ("Zaprimili ste novi kontakt upit: …
 * **Poruka:** … **Stranica:** …"). Vraća samo poruku kupca (+ mjesto, jer je
 * bitno za dostavu/otkup), ili null ako mail nije s forme.
 */
function extractContactFormMessage(text = "") {
  const s = String(text || "");
  if (!/zaprimili ste novi kontakt upit/i.test(s)) return null;
  const msg = s.match(/\*\*Poruka:\*\*\s*([\s\S]*?)(?:\n\s*\*\*Stranica:\*\*|\n-{3,}|$)/i);
  if (!msg || meaningfulLength(msg[1]) < 2) return null;
  const place = s.match(/\*\*Grad\/mjesto:\*\*\s*([^\n*]+)/i);
  const body = msg[1].trim();
  return place && place[1].trim() ? `${body}\n(Mjesto: ${place[1].trim()})` : body;
}

// Naslov odgovora/prosljeđivanja nosi naslov NAŠEG maila, ne pitanje kupca.
const REPLY_SUBJECT_RE = /^\s*(re|odg|odgovor|aw|sv|fw|fwd|wg|tr|prosl)\s*:/i;
// Naslov uz koji tijelo ima smisla pojačati — kratko tijelo bez jasnog pitanja.
const SHORT_BODY_CHARS = 120;

/**
 * Glavna funkcija: tekst za AI obradu dolaznog emaila.
 *   1. kontakt forma → samo poruka
 *   2. odreži citat / proslijeđeni dio (ako ostane dovoljno teksta)
 *   3. odreži potpis
 *   4. kratko tijelo + naslov koji nije "Re:" → dodaj naslov ispred
 * Vraća { text, changed, parts } — parts služi logu i testovima.
 */
function prepareEmailText(rawText = "", { subject = "" } = {}) {
  const original = String(rawText || "");
  const parts = { contactForm: false, quoteRemoved: false, signatureRemoved: false, subjectAdded: false };
  let text = original;

  const form = extractContactFormMessage(text);
  if (form) { text = form; parts.contactForm = true; }

  const withoutQuote = stripQuotedReply(text);
  if (withoutQuote.length < text.length && meaningfulLength(withoutQuote) >= MIN_CONTENT_CHARS) {
    text = withoutQuote;
    parts.quoteRemoved = true;
  }

  const withoutSig = stripSignature(text);
  if (withoutSig.length < text.length && meaningfulLength(withoutSig) >= MIN_CONTENT_CHARS) {
    text = withoutSig;
    parts.signatureRemoved = true;
  }

  const cleanSubject = String(subject || "").trim();
  if (cleanSubject && !REPLY_SUBJECT_RE.test(cleanSubject) && text.trim().length < SHORT_BODY_CHARS
      && !text.toLowerCase().includes(cleanSubject.toLowerCase())) {
    text = `${cleanSubject}\n${text.trim()}`;
    parts.subjectAdded = true;
  }

  text = text.trim() || original;
  return { text, changed: text !== original, parts };
}

module.exports = {
  prepareEmailText,
  stripQuotedReply,
  stripSignature,
  extractContactFormMessage
};
