# Popis udžbenika po školi i razredu — dizajn

Datum: 2026-07-27
Status: prihvaćeno, čeka plan implementacije

## Cilj

Kad posjetitelj u **web chat widgetu** zatraži popis udžbenika za određenu školu i
razred, bot odgovara klikabilnim linkom na popis koji je ta škola objavila na
svojim stranicama za školsku godinu 2026./2027.

Bez LLM poziva — prepoznavanje i odgovor su deterministički, pa je odgovor
trenutan i ne troši token budžet.

## Opseg

- **Samo web chat** (`channelType === "web_chat"`). Email i Facebook Messenger
  se ne mijenjaju.
- **Samo srednje škole u 18 županija** koje pokriva projekt `popis-udzbenika`.
  Grad Zagreb, Splitsko-dalmatinska i Međimurska nisu u opsegu i neće biti
  dodani.
- **Samo popisi potvrđeni za 2026./2027.** Lanjski popisi se nikad ne šalju.

Trenutno stanje izvora (`popis_2026_27/output/`, generirano 2026-07-27):

| | |
|---|---|
| Škole s potvrđenim popisom 26/27 | 161 |
| Škole u opsegu bez popisa (još) | 124 |
| Kombinacija škola + razred | 429 |
| Linkova na dokumente | 1.025 |

Baza se osvježava kako škole objavljuju nove popise — ponovnim pokretanjem
izvozne skripte i commitom novog JSON-a.

## Izvor podataka

Zaseban Python projekt `popis-udzbenika` proizvodi
`popis_2026_27/output/`. Iz njega se čitaju tri datoteke:

| Datoteka | Što daje |
|---|---|
| `Udzbenici_2026_27.xlsx`, sheet `UDZBENICI` | 161 škola s potvrđenim popisom: Škola, Razred, Izvor (link na dokument) |
| `Izvjestaj_provjere_2026_27.xlsx`, sheet `STATUS_2026_27` | svih 285 škola u opsegu i status (`IMA POPIS 26/27` / `BEZ POPISA (još)`) |
| `FINALNA_provjera_popisa_oznaceno.csv` | stupac `Link na popis` — stranica škole s popisima |

Sheet `UDZBENICI` je već filtriran na potvrđenu godinu 26/27. Sheet `DOKUMENTI`
se **ne** koristi jer sadrži i lanjske popise (`objavljeno ranije`,
`druga godina`, `bez godine`), a bot ne smije poslati popis za 25/26.

`STATUS_2026_27` je izvor za 124 škole koje još nemaju popis — one ulaze u JSON
s praznim `dokumenti` da ih bot može prepoznati i reći da popis još nije
objavljen, umjesto da ih ne prepozna uopće.

### Izvozna skripta

Skripta živi u repou `popis-udzbenika` (koji već ima `openpyxl` i vlasnik je
podataka), ne u bot repou — bot nema xlsx čitač među ovisnostima i neće ga
dobiti. Izlaz je jedan JSON koji se kopira u bot repo kao
`data/popis-udzbenika-2026-27.json` i commita.

Skripta radi tri transformacije:

1. **Popravak mojibakea u nazivima škola.** 16 od 161 naziva ima `?` umjesto
   dijakritičkog znaka (`Gimnazija Antuna Vran?i?a Šibenik`,
   `Elektrotehni?ka i ekonomska škola Nova Gradiška`). Popravlja se prije
   zapisa; ako se naziv ne da rekonstruirati, `?` se tretira kao wildcard pri
   uparivanju.
2. **Određivanje razreda po dokumentu.** Prvo iz naziva datoteke kad ga daje
   eksplicitno (351 od 910 dokumenata: `Popis-udzbenika-za-1.-b-razred-…`),
   inače iz stupca `Razred` koji je odredio pipeline. Dokument kojem se razred
   ne može odrediti veže se uz sve razrede te škole.
3. **Čitljiva oznaka smjera** iz naziva datoteke, jer strukovne škole objavljuju
   zaseban popis po smjeru:
   `Popis-udzbenika-za-1.-b-razred-farmaceutski-tehnicar.pdf`
   → `"1.b — farmaceutski tehničar"`.
   Kad naziv nije čitljiv (`2026 EL 1.pdf`, `udzbenici`), oznaka je
   `"Popis udžbenika"`.

### Oblik JSON-a

```json
{
  "godina": "2026./2027.",
  "generirano": "2026-07-27",
  "skole": [
    {
      "id": "gimnazija-daruvar",
      "naziv": "Gimnazija Daruvar",
      "zupanija": "Bjelovarsko-bilogorska",
      "stranica": "https://gimnazija-daruvar.hr/popis-udzbenika/",
      "dokumenti": [
        {
          "razred": "2",
          "oznaka": "2. razred",
          "url": "https://gimnazija-daruvar.hr/…/Popis-udzbenika-2.-razred-26-27.pdf"
        }
      ]
    }
  ]
}
```

`razred` je `"1"`–`"5"` ili `null`. `stranica` je `null` ako je nemamo.
U `skole` ulazi svih 285 škola iz opsega — i onih 124 bez popisa, s praznim
`dokumenti`.

Datoteka se učitava jednom pri startu procesa i drži u memoriji.

## Novi servis — `services/textbookListService.js`

Bez mrežnih poziva i bez LLM-a. Tri odgovornosti.

### Prepoznavanje škole

Inverted index `token → škole`, bodovanje po IDF-u tokena. Normalizacija ulaza
prati postojeći `normalizeForComparison` iz `textUtils` (mala slova, uklanjanje
dijakritike, sažimanje razmaka), plus uklanjanje navodnika i točaka.

Generični tokeni (`skola`, `srednja`, `gimnazija`, `ekonomska`, `tehnicka`)
imaju nisku težinu jer se pojavljuju u desecima naziva. Nazivi gradova i vlastita
imena imaju visoku.

Škola se smatra prepoznatom kad najbolji rezultat prijeđe prag **i** ima jasan
odmak od drugoplasiranog. Inače je nejasno i bot nudi 2-3 najbliža kandidata.
Prag i odmak su konstante u servisu, pokrivene testovima.

### Prepoznavanje razreda

Regex nad normaliziranom porukom: `1. razred`, `prvi razred`, `1.a`, `1.r`,
`u drugom razredu`, `2 razred`. Vraća `"1"`–`"5"` ili `null`.

### Formatiranje odgovora

Sastavlja tekst i listu linkova. Disclaimer se dodaje na **svaki** odgovor koji
sadrži popis.

## Tok razgovora

| Situacija | Odgovor |
|---|---|
| Škola + razred, jedan dokument | Direktan link na popis |
| Škola + razred, više dokumenata | Svi linkovi, svaki s oznakom smjera |
| Škola prepoznata, razred nije | Pita za razred i nabraja koje ima |
| Škola nejasna | Nudi 2-3 najbliža kandidata |
| Škola prepoznata, nema popis 26/27 | „Popis još nije objavljen" + link na stranicu škole (ako postoji) + webshop |
| Škola nije prepoznata | Servis vraća `null`, postojeći tok bota se nastavlja nepromijenjen |

Za dvokoračne slučajeve (bot pitao za razred, korisnik odgovorio `"2. razred"`)
pamti se `session.textbookSchoolId`, po uzoru na postojeći
`session.pendingEscalation` u `escalationFlowService`. Polje se briše nakon
iskorištavanja.

### Primjer — gimnazija, jedan dokument

> **Korisnik:** trebam popis udžbenika za Gimnaziju Daruvar, 2. razred
>
> **Bot:** Evo popisa udžbenika za 2. razred — Gimnazija Daruvar (2026./2027.):
>
> • [2. razred](…)
>
> _Napomena: popis je informativnog karaktera i preuzet je iz javno dostupne
> baze podataka (stranice škola). Antikvarijat Libar ne odgovara za eventualne
> netočnosti ili naknadne izmjene — službeni popis provjerite kod svoje škole._

### Primjer — strukovna škola, više smjerova

> **Korisnik:** popis udžbenika medicinska škola bjelovar 1 razred
>
> **Bot:** Medicinska škola Bjelovar objavljuje popis po smjerovima. Evo svih
> popisa za 1. razred (2026./2027.):
>
> • [1.a — medicinska sestra opće njege](…)
> • [1.b — farmaceutski tehničar](…)
> • [1.c — zdravstveno-laboratorijski tehničar](…)
> • [1.d — dentalni tehničar](…)
>
> _Napomena: …_

### Primjer — nema popisa

> **Bot:** Za Gimnaziju Bjelovar popis udžbenika za 2026./2027. još nije
> objavljen — škole ih objavljuju tijekom ljeta, pa pokušajte ponovno za koji
> dan.
>
> • [Stranica škole s popisima](…)
> • [Udžbenike možete potražiti u našem webshopu](https://antikvarijat-libar.com/kupi-udzbenike/)

## Disclaimer

Doslovan tekst, ide uz svaki odgovor koji sadrži popis:

> Napomena: popis je informativnog karaktera i preuzet je iz javno dostupne baze
> podataka (stranice škola). Antikvarijat Libar ne odgovara za eventualne
> netočnosti ili naknadne izmjene — službeni popis provjerite kod svoje škole.

## Uklapanje u `index.js`

Jedan poziv u `_resolveAutomatedOutcome`:

- **nakon** escalation gateova (kill switch, privitci, `detectEscalationIntent`)
  — žalbe, reklamacije i pravna pitanja i dalje idu čovjeku prije svega ostalog;
- **prije** `tryReferenceFacts`, response cachea i pretrage znanja — da se ne
  troše LLM pozivi kad postoji deterministički odgovor;
- iza uvjeta `opts.channelType === "web_chat"`.

Bez pogotka servis vraća `null` i pipeline teče kao danas. Pogodak vraća
`{ type: "safe_answer", source: "textbook_list", stateTag: "ai_active" }`, uz
`metricsService.recordDecision` i `recordChannelOutcome` kao i ostale grane.

Linkovi idu kroz postojeće `outcome.links` polje, pa ih widget renderira bez
promjena.

## Testovi

Novi `tests/textbookListService.test.js` (native `node --test`):

- prepoznavanje škole — točan naziv, bez dijakritike, s mojibakeom u izvoru,
  skraćeno (`gimnazija daruvar`), s gradom (`gimnazija u Daruvaru`);
- prepoznavanje razreda u svim oblicima iz regexa;
- više dokumenata po razredu → svi linkovi s oznakama;
- škola bez popisa → poruka „još nije objavljen", nikad link na lanjski popis;
- nejasan upit → kandidati, ne pogađanje;
- disclaimer prisutan u svakom odgovoru s popisom;
- **ne aktivira se** na postojećim upitima bez škole: „Kako naručiti udžbenike?",
  „Otkupljujete li udžbenike?", „Koliko košta dostava?".

Uz to se pokreće `npm run test:unit` u cijelosti — gate je u zajedničkom
pipelineu, pa postojeći escalation i e2e testovi moraju proći nepromijenjeni.

## Odluke i njihovo „zašto"

**Link vodi na dokument škole, ne na Libarov webshop.** Najprecizniji podatak
koji imamo; Libar nema stranice s popisima po školama.

**Kod više smjerova bot šalje sve linkove odjednom**, umjesto da pita za smjer.
Dodatni krug razgovora u web chatu gubi korisnike, a oznaka smjera je dovoljno
čitljiva da korisnik sam prepozna svoju.

**Podaci su statični JSON u repou**, ne Supabase tablica ni runtime dohvat.
Datoteka je mala, mijenja se rijetko i u naletima, i ovako je verzionirana uz
kod. Nema nove infrastrukture ni runtime ovisnosti.

**Izvozna skripta je u `popis-udzbenika`, ne u bot repou.** Taj projekt je
vlasnik podataka i već ima `openpyxl`; bot ostaje bez xlsx ovisnosti.

**Gate je deterministički, ne LLM tool.** Prati postojeći obrazac
`searchUtils` / `intentEscalationService` — predvidljivo, testabilno, bez
troška i bez rizika od halucinacije linka.

## Što nije u opsegu

- Popis naslova s cijenama u samom chatu (sheet `UDZBENICI` ima 12.092 retka s
  MPC-om) — samo link na dokument škole.
- Osnovne škole.
- Automatski dohvat novih popisa u runtimeu — osvježavanje je ručno,
  regeneracijom JSON-a.
- Email i Facebook Messenger.
