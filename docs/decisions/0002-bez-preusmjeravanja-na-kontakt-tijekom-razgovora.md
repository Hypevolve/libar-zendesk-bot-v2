# 0002. Bot ne preusmjerava na mail/telefon dok razgovor već traje

- **Status:** Prihvaćeno
- **Datum:** 2026-06-25

## Kontekst
Bot je u odgovorima znao zalijepiti generičku završnu poruku tipa "za dodatna pitanja slobodno nas kontaktirajte na info@antikvarijat-libar.com ili telefonom na 031/201-230", iako je kupac **već u izravnom razgovoru s nama** (Zendesk chat, email ili Facebook). Klijent (Bojan) je s pravom prigovorio: nema smisla slati kupca na drugi kanal kad smo već tu i odgovaramo.

Bojan je tu rečenicu pokušao maknuti brisanjem iz KB dokumenata na OneDriveu, ali bez efekta — jer kontakt podaci **ne dolaze iz baze znanja**, nego iz hardkodiranih `REFERENTNE_CINJENICE` u system promptu (`services/aiService.js`). Model ih je koristio kao "ljubazan" završetak odgovora.

Razmatrane opcije:
1. Maknuti email/telefon iz `REFERENTNE_CINJENICE`.
2. Ostaviti ih, ali instrukcijom u promptu zabraniti samoinicijativno preusmjeravanje.

Opcija 1 je odbačena jer bi tada bot prestao znati odgovoriti na izravno pitanje "koji vam je mail/telefon", i razbila bi postupke koji mail nužno trebaju (npr. reklamacija s fotografijom i računom).

## Odluka
Dodano je pravilo `RAZGOVOR_U_TIJEKU` u oba prompt-buildera (`buildGroundedAnswerPrompt` i `buildSystemPrompt`), pa vrijedi za sve kanale. Pravilo zabranjuje generičko preusmjeravanje na kontakt dok razgovor traje, ali **email i telefon ostaju u `REFERENTNE_CINJENICE`**. Bot ih navodi samo kad ih korisnik **izričito traži** ili kad konkretan postupak to nužno zahtijeva (reklamacija s fotografijom i računom).

## Posljedice
- **+** Bot ne šalje kupca na drugi kanal usred živog razgovora.
- **+** I dalje odgovara na izravno pitanje za kontakt; postupak reklamacije ostaje ispravan.
- **−** Provedba ovisi o LLM-u (instrukcija u promptu, ne deterministička garancija) — vrijedi povremeno provjeriti stvarne razgovore.
- **Paziti:** kontakt podaci žive na dva mjesta — `REFERENTNE_CINJENICE` (prompt) i KB dokumenti. Uređivanje KB-a ne mijenja ono što je u promptu.
- Unit pokriće: `tests/groundedPrompt.test.js` zaključava da pravilo (i iznimka) postoje u oba prompta.
