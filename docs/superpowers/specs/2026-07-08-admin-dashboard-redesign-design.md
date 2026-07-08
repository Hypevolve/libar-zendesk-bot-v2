# Spec: Redizajn admin dashboarda + metrike po kanalima

**Datum:** 2026-07-08
**Autor:** Zrinko (+ Claude Code)
**Zahtjev:** Petar traži bolji admin dashboard, s naglaskom na metrike razgovora po kanalima (web, mail, Facebook). Cilj: moderno, clean, profesionalno, sofisticirano admin sučelje u ShadCN stilu s pregledom svih ključnih funkcionalnosti i kontrola bota.

## Cilj

1. Prikazati **razdiobu razgovora po kanalima** (web / email / Facebook) — volumen, uspješnost, eskalacije, kvaliteta.
2. Puni vizualni **redizajn** postojećeg [admin-dashboard.html](../../../admin-dashboard.html) u ShadCN „New York" estetici, uz sve postojeće funkcije i kontrole.
3. **Bez rizika za deploy** i bez izmišljenih podataka — sve kartice hrani stvarni (postojeći ili minimalno prošireni) backend.

## Odluke (potvrđene s korisnikom)

| Pitanje | Odluka |
|---|---|
| Tech pristup | **ShadCN look, single-file** — vanilla HTML/CSS/JS, bez build koraka; drop-in zamjena `admin-dashboard.html`. Express `/admin/dashboard` nepromijenjen. Poštuje CLAUDE.md „conservative changes". |
| Izvor metrika po kanalu | **Oba** — live brojači (točan volumen, 100% prometa, real-time) + analiza ticketa (kvaliteta/teme po kanalu, analizirani uzorak). |
| Opseg | **Puni redizajn + nove korisne kartice** — sve postojeće sekcije restilizirane + novi blok kanala + smislene nove vizualizacije bez lažnih podataka. |
| Tema | **Light + Dark toggle** — izbor se sprema (localStorage), toggle u topbaru. |
| Grafovi | **Čisti CSS/SVG** — barovi, donut, sparkline ručno; bez vanjskih ovisnosti/CDN, poštuje single-file i CSP. |

## Kanonski kanali

`aiService.normalizeChannelType` vraća: `web_chat`, `email`, `facebook`, `unknown`.
Dashboard i backend normaliziraju na tri prikaza: **web** (`web_chat`), **email** (`email`), **facebook** (`facebook`; Messenger/FB post/page sve mapira ovamo). `unknown` se u prikazu ignorira ili grupira pod „ostalo".

## Backend promjene (aditivne, kompatibilne unatrag)

### 1. `services/metricsService.js` — live brojači po kanalu
- Novi counter:
  ```js
  byChannel: {
    web:      { requests: 0, answered: 0, escalated: 0 },
    email:    { requests: 0, answered: 0, escalated: 0 },
    facebook: { requests: 0, answered: 0, escalated: 0 }
  }
  ```
- Nova funkcija `recordChannelOutcome(channel, decision)`:
  - `channel` normaliziran na `web|email|facebook` (ostalo → no-op).
  - `decision === "safe_answer"` → `answered++`; `decision === "escalate_no_answer"` → `escalated++`; uvijek `requests++`.
- Uključiti `byChannel` u `serializeCounters()`, `hydrateFromSupabase()` i `reset()` (preživljava restart, kao ostali counteri; hydrate defaultira na praznu strukturu ako polje ne postoji u perzistiranom stanju).
- Export: dodati `recordChannelOutcome`.

### 2. `index.js` — instrumentacija (2 mjesta)
- **Webchat put** (obrada `resolveAutomatedOutcome` / escalation u `/api/chat/message`): nakon što je odluka poznata → `metricsService.recordChannelOutcome("web", decision)`.
- **Webhook put** (`/webhook`, nakon `normalizedChannel` i donesene odluke): `metricsService.recordChannelOutcome(normalizedChannel, decision)`.
- Poziv ide **uz** postojeći `recordDecision`, ne mijenja postojeću logiku odluke.

### 3. `services/analyticsStore.js` — kvaliteta/volumen po kanalu
**Nesklad vokabulara (VAŽNO):** analitika sprema **sirovi Zendesk `via.channel`** (`zendeskService.js:476` → `raw.via?.channel || "unknown"`), NE normalizirani naziv. Zendeskove vrijednosti su npr. `email`, `facebook`, `web`, `api`, `web_service`, `chat`, `messaging`… Bot-kreirani webchat ticketi idu preko Zendesk API-ja pa im `via.channel` može biti `api`/`web_service`, ne `web`. Zato je potrebna mapa:
  ```js
  // analyticsChannelToBucket(zendeskVia) → "web" | "email" | "facebook" | "ostalo"
  email                              → email
  facebook, messenger, facebook_*    → facebook
  web, web_widget, chat, messaging, api, web_service → web
  (ostalo)                           → ostalo
  ```
- U `getSummary()` dodati:
  ```js
  byChannel: { web, email, facebook, ostalo }             // zbroj countWhere po via-vrijednostima u svakom bucketu
  byChannelQuality: { web:{good,partial,bad,na}, email:{...}, facebook:{...} }
  ```
- Koristi postojeći `countWhere` nad `channel` kolonom — **bez migracije**. Za svaki bucket zbroji `countWhere(&channel=eq.<via>)` po svim via-vrijednostima koje padaju u taj bucket (ili jedan `channel=in.(...)` upit po bucketu).
- **Provjeriti stvarne `via.channel` vrijednosti** u tablici tijekom implementacije (npr. `SELECT DISTINCT channel`) i po potrebi doraditi mapu — Zendesk instanca je izvor istine.

### 4. Endpointi
- **Bez novih ruta.** Payload `/admin/metrics` (već vraća cijeli `getMetrics()`) i `/admin/analytics/summary` automatski dobiju nova polja. Stari potrošači (MCP `get_metrics`, postojeći JS) rade dalje jer su polja aditivna.

## Frontend redizajn — `admin-dashboard.html` (single-file)

### Design sustav (ShadCN „New York")
- **Paleta:** neutralna zinc/slate skala kroz CSS varijable (`--background`, `--foreground`, `--card`, `--muted`, `--muted-foreground`, `--border`, `--ring`, `--primary`…), brand narančasta (`#E85D04`) kao `--primary`/accent.
- **Tema:** `:root` (light) + `[data-theme="dark"]` override sve varijable. Toggle gumb (Lucide sun/moon) u topbaru; izbor u `localStorage` (`libar_admin_theme`), init prije prvog paint-a da nema flash-a. Respektira `prefers-color-scheme` kao default.
- **Font:** Inter (Google Fonts, preconnect kao sada) za tekst; mono za brojke/tokene ostaje.
- **Ikone:** Lucide (inline SVG, kao i sad — bez CDN-a).
- **Tokeni:** radius sustav (`--radius`), suptilne borde, `--muted-foreground` hijerarhija, ShadCN-style sjene (tanke).

### Zadržati (ne dirati funkcionalno)
- Login/token flow, sessionStorage token, sidebar nav + scroll-spy, polling s backoffom i visibility pauzom, toasti, `esc()` HTML-escape, sve a11y (sr-only, focus-visible, reduced-motion, touch targeti, aria-live), mobilni off-canvas sidebar.

### Sekcije (redom)
1. **Overview KPI** — 4 stat-kartice (Ukupno upita, Odgovoreno, Eskalirano, Prosj. latencija) u ShadCN card stilu s ikonom, vrijednošću, sub/trend linijom.
2. **Kanali (NOVO — u fokusu)** — 3 kartice **Web / Email / Facebook**, svaka: volumen (live `byChannel.requests`), % odgovoreno, % eskalirano, mini-bar; + usporedni horizontalni bar graf volumena. Ispod: kvaliteta bota po kanalu (iz `byChannelQuality`) kad je analiza pokrenuta.
3. **Bot kontrola** (kill switch, kao sad) + **Breakdown odluka** (safe_answer / escalate / ostalo) — restilizirano.
4. **Nove kartice:** uspješnost po kanalu (bar), trošak istaknut (postojeći `PRICING` izračun), P95 latencija vizual, cache hit rate.
5. **Razgovori** — postojeća tablica + **novi stupac/badge kanala** po retku (iz `channel` polja koje `/admin/analytics/conversations` već vraća).
6. **Analitika ticketa** — najčešće teme + KB rupe (restil).
7. **KB sinkronizacija** + **Analiziraj tickete** kontrole (restil).

### Grafovi (čisti CSS/SVG)
- Horizontalni barovi (postojeći `bar-track/bar-fill` pattern, restil).
- Donut/prsten za raspodjelu kanala — inline SVG `stroke-dasharray`.
- Sparkline latencije — inline SVG polyline (ako ima dovoljno podataka; inače sakriti).

## Testiranje

- **`tests/metricsService.test.js`** (novi ili proširen): `recordChannelOutcome` ispravno inkrementira `requests/answered/escalated` po kanalu; nepoznati kanal = no-op; `byChannel` preživi `serialize → hydrate` round-trip; `reset` čisti.
- **`tests/analyticsStore.test.js`** (novi ili proširen): `getSummary()` s mock klijentom (`_setTestClient`) vraća `byChannel`/`byChannelQuality`; bez konfiguracije vraća sigurne prazne strukture.
- **Ručna provjera** kroz `/run`: pokrenuti app, otvoriti `/admin/dashboard`, provjeriti render u light i dark temi, responsive (mobilni sidebar), da polling radi.
- Pokrenuti **puni** `npm test` (osjetljivi live-metrics put — CLAUDE.md).

## Van opsega (YAGNI)

- Bez React/Vite/build pipelinea (odbijeno u korist single-filea).
- Bez novih Zendesk polja / migracija baze.
- Bez povijesnih vremenskih serija po danu/tjednu (backend trenutno ne čuva time-series po kanalu; live brojači su kumulativni). Sparkline latencije koristi postojeći `latencies` buffer, ne per-channel povijest.
- Bez izmišljenih/mock metrika u produkcijskom prikazu.

## Rizici

- Instrumentacija `index.js` dira live put bota — pokriti testovima i ručnom provjerom prije commita (CLAUDE.md: bot piše korisnicima uživo).
- Uskladiti nazive kanala između `ticketAnalysisService` (što sprema u `channel`) i upita u `analyticsStore.getSummary()` — provjeriti stvarne vrijednosti u bazi tijekom implementacije.
- Dark tema: paziti na kontrast (WCAG) i na sve postojeće stanja (badge, toast, login).
