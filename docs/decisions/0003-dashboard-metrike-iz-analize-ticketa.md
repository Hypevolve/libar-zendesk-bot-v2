# 3. Dashboard metrike dolaze iz analize ticketa, ne iz živih brojača

Datum: 2026-07-20
Status: prihvaćeno

## Kontekst

Bojan je prijavio da brojke u admin dashboardu nisu točne. Provjerom se pokazalo
da su kartice bile međusobno nekonzistentne na četiri načina:

- **"Ukupno upita 1.6K" s podnaslovom "Webchat: 371 · Webhook: 4.8K"** — podnaslov
  izgleda kao razdioba glavnog broja, a zbraja 5.2K. `totalRequests` broji samo
  web chat pipeline runove, `totalWebhooks` sve dolazne webhookove uključujući
  preskočene (agent preuzeo, duplikat, bot ugašen). Nesumjerljive veličine.
- **Kanali (82 + 218 + 0 = 300) ne odgovaraju ukupnom (1639)** — `byChannel` je
  uveden tek u `8683e4b` pa broji od tada, dok je `totalRequests` kumulativan od
  davno. Različiti vremenski prozori u istom pogledu.
- **Facebook = 0 unatoč stvarnim FB razgovorima** — u web chat pipelineu je kanal
  bio hardkodiran na `"web"` na svih 5 poziva `recordChannelOutcome`, iako
  `opts.channelType` nosi pravi kanal.
- **Kvaliteta (73+6+52 = 131) premašuje broj upita (82)** — trake kvalitete dolaze
  iz analize Zendesk ticketa (cijela povijest, svi kanali), a brojka iznad iz
  živih brojača (od zadnjeg deploya). Dva nepovezana skupa u istoj kartici.

Uz to je traženo filtriranje po razdoblju (7/30/90 dana ili proizvoljan raspon).
Živi brojači su kumulativni i **nemaju nijedan timestamp**, pa na njima date
picker tehnički nije izvediv.

## Odluka

Glavne kartice (volumen, riješenost, kanali, kvaliteta, KB rupe) crpe iz
**`ticket_analysis` u Supabaseu** — jedini izvor s `created_at` po razgovoru,
koji odražava stvarno stanje u Zendesku i osvježava se dnevnim auto-syncom
(`runAnalysisSync`, uveden u `1b081fa`).

Latencija, tokeni, trošak i cache ostaju živi brojači, ali su premješteni u
zasebnu sekciju **"Uživo — kumulativno od zadnjeg pokretanja"**, izvan dosega
date pickera. Time prestaje lažni dojam da se te brojke odnose jedne na druge.

KPI "uspješnost" je redefiniran u **"Bot riješio sam"** = `handled_by === "bot"`.
`mixed` se broji na stranu čovjeka: ako je agent morao intervenirati, ušteda rada
se nije dogodila. Nepoznate vrijednosti idu konzervativno čovjeku.

`getSummary()` je prepisan s ~20 uzastopnih `count` upita na **jedan straničeni
dohvat + agregaciju u JS-u** (`tallySummary`). Brže je, a i točnije: svi brojevi
dolaze iz istog snimka podataka, pa se ne može dogoditi da pojedini upiti vide
različita stanja baze.

## Posljedice

Vrijede invarijante koje su prije bile prekršene, pokrivene testovima:

- `botResolved + humanHandled === total`
- suma `byChannel` === `total` (uključujući `ostalo`)
- suma `byChannelQuality[k]` === `byChannel[k]`

Cijena: latencija i trošak se ne mogu filtrirati po datumu. Prihvaćeno svjesno —
alternativa je nova dnevna tablica čija bi povijest krenula od nule, a povijesni
podaci o ticketima već postoje. Ako to zatreba, `bot_metrics_daily` se može
dodati naknadno bez diranja ovoga.

Prompt za analizu ticketa i klasifikaciju kvalitete namjerno **nije** diran —
brojke su bile krive zbog agregacije i prikaza, a promjena promptova bi
promijenila povijesne podatke i onemogućila usporedbu kroz vrijeme.

Uz date picker se prikazuje i vrijeme zadnjeg synca; stariji od 48 sati se
naglašava, da se odmah vidi ako dnevni auto-sync zapne.
