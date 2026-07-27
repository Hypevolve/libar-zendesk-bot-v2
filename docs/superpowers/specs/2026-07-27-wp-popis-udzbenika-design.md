# WordPress widget — popis udžbenika po školi i razredu — dizajn

Datum: 2026-07-27
Status: prihvaćeno, čeka plan implementacije

## Cilj

Nova stranica na Libarovom WordPress siteu (npr. `/popis-udzbenika/`) na kojoj
posjetitelj upiše naziv svoje škole, odabere razred i dobije poveznicu na popis
udžbenika koji je ta škola objavila za 2026./2027.

Isti podaci koje koristi web chat bot, ista pravila — samo drugo sučelje.

## Opseg

- **Srednje škole u 18 županija** koje pokriva projekt `popis-udzbenika`.
  Grad Zagreb, Splitsko-dalmatinska i Međimurska nisu u opsegu.
- **Samo popisi potvrđeni za 2026./2027.** Lanjski popisi se nikad ne prikazuju.
- Widget vodi na **dokument koji je škola objavila**, ne na Libarov webshop i ne
  na popis pojedinačnih naslova.

Stanje izvora (generirano 2026-07-27): 285 škola u opsegu, 161 s potvrđenim
popisom, 124 bez, oko 1.025 poveznica na dokumente.

## Arhitektura

Novi WordPress plugin `libar-popis-udzbenika` u **vlastitom repou** (ne u bot
repou). Instalira se na Libarov site, stranica dobiva shortcode
`[libar-popis-udzbenika]`.

```
libar-popis-udzbenika/
├── libar-popis-udzbenika.php   bootstrap, konstante, aktivacija, cron raspored
├── includes/
│   ├── class-shortcode.php     shortcode, uvjetni enqueue JS/CSS
│   ├── class-podaci.php        čitanje, validacija, dohvat s URL-a, cron
│   └── class-admin.php         ekran postavki i statusa
├── assets/
│   ├── js/pretraga.js          čista logika pretrage (bez DOM-a, testabilna)
│   ├── js/widget.js            DOM, stanja, dohvat podataka
│   └── css/widget.css          stilovi s prefiksom lpu-
├── data/popis-udzbenika.json   kopija koja dolazi uz plugin
├── tests/pretraga.test.js      node --test
└── uninstall.php
```

Bez jQueryja i bez vanjskih biblioteka. Vanilla JS, cilj ispod 10 KB. CSS
nasljeđuje fontove i boje teme, sve klase pod prefiksom `lpu-` da se ne sudaraju
s temom.

### Tok podataka

1. Projekt `popis-udzbenika` generira JSON (skripta `izvoz_za_bot.py`).
2. JSON se commita u bot repo kao `data/popis-udzbenika-2026-27.json`.
3. Bot ga servira na `GET /api/popis-udzbenika.json`.
4. WP-Cron u pluginu jednom dnevno povuče datoteku i spremi je u
   `wp-content/uploads/libar-popis/popis-udzbenika.json`.
5. Preglednik je dohvaća kao **statičnu datoteku**, bez PHP-a po zahtjevu.

Kad datoteka u `uploads/` ne postoji ili je neispravna, koristi se kopija koja
dolazi uz plugin. Widget uvijek ima podatke.

Podaci se dohvaćaju **tek na prvi klik u polje za pretragu**, ne pri učitavanju
stranice. Do tada je na stranici samo prazno polje, pa widget ne usporava
učitavanje. Dok dohvat traje, polje javlja „Učitavam popis škola…"; upit
utipkan u međuvremenu primijeni se čim podaci stignu. Jedina iznimka je
učitavanje stranice s hashom u adresi (vidi „Adresa") — tada dohvat kreće odmah,
jer se sadržaj mora prikazati bez korisnikove akcije.

Adresa datoteke nosi `?v=<generirano>` radi probijanja predmemorije nakon
osvježavanja.

### Oblik JSON-a

Nepromijenjen u odnosu na bot:

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
        { "razred": "2", "oznaka": "2. razred", "url": "https://…" }
      ]
    }
  ]
}
```

`razred` je `"1"`–`"5"` ili `null`. `stranica` je `null` kad je nemamo.
Škole bez potvrđenog popisa imaju prazan `dokumenti`.

## Pretraga

Logika živi u `assets/js/pretraga.js` kao čiste funkcije bez DOM-a, pa je
testabilna s `node --test`.

**Normalizacija** (i upita i naziva): mala slova, `đ`→`d`, uklanjanje
dijakritike preko NFD, sve što nije slovo ili broj postaje razmak, sažimanje
razmaka. Nazivi se normaliziraju jednom pri učitavanju podataka.

**Uparivanje:** upit se razlomi na riječi; **svaka** riječ upita mora pogoditi
neku riječ naziva škole ili njezine županije, po prefiksu. Time `medicinska
bjelo`, `Medicinska škola Bjelovar` i `bjelovar medicinska` daju isti rezultat,
a lista se sužava kako korisnik tipka. Riječi županije nose manju težinu od
riječi naziva, pa škola s gradom u nazivu ide ispred susjedne škole iz iste
županije.

**Rangiranje:** prvo po zbroju težina pogodaka (točna riječ vrijedi više od
prefiksa), zatim škole s popisom ispred onih bez, pa kraći naziv prvi.
Relevantnost mora biti ispred „ima popis" — inače bi upit `gimnazija bjelovar`
vratio susjednu školu s popisom prije škole koju je korisnik doslovno imenovao.
Prikazuje se najviše **8** prijedloga. Pretraga kreće od **2 znaka**.

## Tok korisnika

### Korak 1 — tražilica

Jedno polje, placeholder: *„Upišite naziv škole ili grad — npr. Gimnazija
Daruvar"*. Polje se ne fokusira samo, da na mobitelu ne iskoči tipkovnica.

Prijedlog prikazuje naziv škole, županiju sitnije i oznaku desno — `15 popisa`
ili `uskoro` za škole bez popisa. Pogođeni dio naziva se **ne** podebljava:
uparuje se normalizirani tekst, pa se pozicije znakova ne poklapaju s izvornim
nazivom i podebljanje bi često palo na krivo mjesto.

Tipkovnica: ↑/↓ kroz prijedloge, Enter odabir, Esc zatvaranje. Uloge
`combobox`/`listbox`/`option`, `aria-expanded`, `aria-activedescendant`, te
`aria-live` područje koje javlja broj pronađenih škola.

Bez pogotka:

> Nismo pronašli tu školu. Pokrivamo srednje škole u 18 županija (bez Grada
> Zagreba, Splitsko-dalmatinske i Međimurske).

uz poveznicu na webshop.

### Korak 2 — razred

Odabir škole otvara panel s nazivom škole, županijom i gumbima za razrede koje
ta škola ima — samo za one koji postoje u podacima, po redu `1.`–`5.`

Dokumenti kojima razred nije određen (`razred: null`) pojavljuju se u popisu
**svakog** razreda. Ako škola ima isključivo takve dokumente, korak s razredom
se preskače i odmah se prikazuje popis.

### Korak 3 — dokumenti

Popis dokumenata za odabrani razred, svaki s oznakom smjera i vrstom datoteke:

```
1. razred — Medicinska škola Bjelovar

→ 1.a — medicinska sestra opće njege          PDF
→ 1.b — farmaceutski tehničar                 PDF
→ 1.c — zdravstveno-laboratorijski tehničar   PDF

Stranica škole s popisima →

Napomena: popis je informativnog karaktera…

Ove udžbenike možete kupiti rabljene i povoljnije u našem webshopu →
```

Klik otvara dokument škole u novoj kartici (`target="_blank"`,
`rel="noopener"`). Poveznica se stvara samo za `http`/`https` adrese; sve ostalo
ostaje običan tekst.

Webshop CTA stoji ispod popisa jer korisnik odlazi na stranicu škole — vidi ga
prije nego klikne.

### Škola bez popisa

> Za <škola> popis udžbenika za 2026./2027. još nije objavljen — škole ih
> objavljuju tijekom ljeta, pa pokušajte ponovno za koji dan.

uz poveznicu na stranicu škole s popisima (kad je imamo) i webshop CTA.

### Disclaimer

Doslovan tekst, ide uz **svaki** prikaz popisa — isti kao u botu:

> Napomena: popis je informativnog karaktera i preuzet je iz javno dostupne baze
> podataka (stranice škola). Antikvarijat Libar ne odgovara za eventualne
> netočnosti ili naknadne izmjene — službeni popis provjerite kod svoje škole.

### Adresa

Odabir škole i razreda upisuje se u adresu kao `#gimnazija-daruvar/2` preko
`history.pushState`. Nije nova stranica i ne indeksira se — služi tome da gumb
„natrag" vraća korak unatrag i da se link može podijeliti. Pri učitavanju
stranice s takvim hashom widget odmah otvori taj razred te škole.

### Bez JavaScripta

Shortcode ispiše poruku da je za pretragu potreban JavaScript, uz poveznicu na
web chat i webshop.

## Admin

Ekran *Postavke → Popis udžbenika* (`manage_options`):

- **URL izvora** — zadano bot endpoint,
- **Osvježi sada** — dohvat na zahtjev, zaštićen nonceom,
- **Status** — školska godina, datum generiranja, broj škola / s popisom /
  dokumenata, vrijeme zadnjeg uspješnog dohvata, tekst zadnje greške.

Dohvat ide kroz `wp_remote_get` s timeoutom 15 s i provjerom veličine odgovora.
Prije zamjene se JSON validira: postoji `godina`, `skole` je neprazan niz, svaka
škola ima `id` i `naziv`, `dokumenti` je niz. Ako dohvat ili validacija padnu,
**stari podaci ostaju netaknuti**, greška se zapiše u meta opciju i prikaže kao
admin obavijest. Bolje jučerašnji popis nego prazan widget.

Meta podaci idu u opciju `libar_popis_meta` bez `autoload`. Sam JSON nikad ne
ulazi u bazu.

## Endpoint na botu

U bot repo dolazi `GET /api/popis-udzbenika.json`:

- servira `data/popis-udzbenika-2026-27.json`,
- `Cache-Control: public, max-age=3600`,
- `Access-Control-Allow-Origin: *` — podaci su javni,
- `404` s jasnom porukom kad datoteka ne postoji.

Jedan izvor istine za chat i web: regeneriraš JSON za bota, WordPress se sam
uskladi u roku od dana.

### Ovisnost o bot planu

JSON još ne postoji. Nastaje u **Tasku 1** plana
`docs/superpowers/plans/2026-07-27-popis-udzbenika.md` (skripta
`izvoz_za_bot.py`). Redoslijed je: prvo Task 1 bot plana, zatim endpoint, zatim
plugin. Do tada plugin radi na kopiji koju nosi u sebi, ali automatsko
osvježavanje nema odakle povlačiti.

## Testovi

`tests/pretraga.test.js`, native `node --test`:

- pretraga bez dijakritike (`gimnazija daruvar` → Gimnazija Daruvar),
- obrnut redoslijed riječi (`bjelovar medicinska`),
- nepotpuna zadnja riječ (`medicinska bjelo`),
- škole s popisom ispred onih bez, kod jednake relevantnosti,
- pogodak po županiji nosi manju težinu od pogotka po nazivu,
- upit kraći od 2 znaka i besmislen upit vraćaju prazno,
- najviše 8 rezultata.

PHP strana ide kroz ručnu QA listu: instalacija na čistom WordPressu, prikaz
shortcodea, cron dohvat, pad dohvata (stari podaci ostaju), prazan `uploads`
(pada na kopiju iz plugina), deinstalacija.

## Odluke i njihovo „zašto"

**Klik vodi na dokument škole, ne na popis naslova s cijenama.** Izvor
(`Udzbenici_2026_27.xlsx`) ima 12.092 retka s naslovima, autorima i MPC-om, pa
bi popis naslova s poveznicama na webshop bio moguć — svjesno je odgođen.
Uparivanje naslova s proizvodima je zaseban i puno veći posao.

**Tražilica, ne kaskadni izbornici.** Korisnik u pravilu zna naziv svoje škole,
a ne županiju. Jedno polje je i najbrže na mobitelu.

**Razred prije dokumenata.** Strukovne škole imaju i po 15 dokumenata; prikaz
svih odjednom je zid teksta. Bot šalje sve odjednom jer je u chatu dodatni krug
razgovora skuplji od duljeg odgovora — na stranici je klik jeftin.

**Statična JSON datoteka, ne WP baza.** Datoteka je mala, mijenja se rijetko i u
naletima, i preglednik je uzima izravno bez PHP-a. Uvoz u custom post type bi
donio migracije i sinkronizaciju bez ijedne nove mogućnosti.

**Podaci se dohvaćaju s bot endpointa.** Bot je već vlasnik te datoteke u
produkciji. Alternativa (GitHub raw) traži javan repo ili token u konfiguraciji.

**Bez zasebnih stranica po školi.** Odluka naručitelja: 285 indeksiranih
stranica donosi SEO, ali i održavanje sadržaja koji Libar ne kontrolira.

**Plugin u vlastitom repou.** Drugi jezik, drugi ciklus izdavanja i drugi način
isporuke od bota; jedina dodirna točka je JSON endpoint.

## Što nije u opsegu

- Popis pojedinačnih naslova s cijenama i uparivanje s webshop proizvodima.
- Osnovne škole.
- Zasebne stranice po školi i SEO strukturirani podaci.
- Praćenje klikova i analitika.
- Gutenberg blok — shortcode je dovoljan, ubacuje se kroz blok „Kratki kod".
- Višejezičnost.
