# Analitika ticketa (pravi Zendesk podaci)

Sloj koji analizira **stvarne Zendesk tickete** i daje prave uvide: konverzacije,
najčešće teme i **rupe u knowledge baseu**. Dostupno preko MCP-a ([mcp.md](mcp.md))
i u admin dashboardu.

## Tok podataka

```
Zendesk (Incremental API) → ticketAnalysisService → Supabase (ticket_analysis)
   dohvat od cursora          PII maskiranje + LLM           ← čita analyticsStore
                              analiza po ticketu                (MCP + dashboard)
```

- [services/ticketAnalysisService.js](../services/ticketAnalysisService.js) - orkestrator + LLM analizator
- [services/analyticsStore.js](../services/analyticsStore.js) - Supabase REST (čitanje/pisanje)
- [services/zendeskService.js](../services/zendeskService.js) - `listTicketsSince` (Incremental Export API)
- [migrations/ticket_analysis.sql](../migrations/ticket_analysis.sql) - tablice

## Što LLM analizira (po ticketu)

Za svaki ticket sprema se: `topic`, `intent`, `handled_by` (bot/human/mixed),
`bot_answered`, `bot_quality` (good/partial/bad/na), `is_kb_gap`, `kb_gap_reason`,
`suggested_kb_topic`, `summary`, `language`. Osobni podaci se **maskiraju**
(`piiService`) prije slanja LLM-u i prije spremanja u Supabase.

## Postavljanje

1. Primijeni [migrations/ticket_analysis.sql](../migrations/ticket_analysis.sql) u
   Supabase SQL editoru (kreira `ticket_analysis` i `analysis_sync_state`).
2. Provjeri env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (već postoje za metrike),
   `ZENDESK_*`, `OPENROUTER_API_KEY`.
3. Opcionalno podesi: `ANALYSIS_MODEL` (default `google/gemini-2.5-flash`),
   `ANALYSIS_MAX_TICKETS` (default 150), `ANALYSIS_BACKFILL_DAYS` (default 90).

## Pokretanje analize

- **Dashboard:** sekcija "Analitika ticketa" → dugme **Analiziraj tickete**.
- **MCP:** tool `analyze_tickets` (npr. "analiziraj zadnjih 90 dana ticketa").
- **Endpoint:** `POST /admin/analytics/sync` (`requireAdmin`), body `{ sinceDays?, maxTickets? }`.

### Backfill
Prvi put sustav ide unatrag `ANALYSIS_BACKFILL_DAYS` dana. Svaki run je ograničen na
`maxTickets`, pa za punu povijest pozoveš analizu **više puta** dok cursor ne stigne
do danas. Nakon toga obrađuju se samo novi ticketi (inkrementalno preko cursora u
`analysis_sync_state`). Obrisani ticketi (404) i status `deleted` se preskaču.

Eksplicitan `sinceDays` znači **ručni backfill**: kreće od tog prozora bez obzira na
spremljeni cursor, a cursor pritom nikad ne ide unatrag (dnevni sync ostaje gdje je
bio). Bez `sinceDays` se koristi spremljeni cursor.

Zato backfill u serijama vozi **pozivatelj**, ne spremljeni cursor: prva serija šalje
`sinceDays`, svaka sljedeća šalje `sinceISO` = `cursor` iz prethodnog odgovora. Gotovo
je kad `fetched` padne ispod `maxTickets`.

```bash
# prva serija
curl -X POST "$BOT/admin/analytics/sync" -H "x-admin-token: $T" \
  -H "Content-Type: application/json" -d '{"sinceDays":365,"maxTickets":200}'
# → {"result":{"fetched":200,"cursor":"2025-08-14T…Z", …}}

# sljedeće serije: sinceISO = cursor prethodne
curl -X POST "$BOT/admin/analytics/sync" -H "x-admin-token: $T" \
  -H "Content-Type: application/json" \
  -d '{"sinceISO":"2025-08-14T…Z","maxTickets":200}'
```

### Cursor semantika (zašto brojke moraju odgovarati Zendesku)
Zendesk Incremental Export vraća do 1000 ticketa po stranici, a mi obradimo najviše
`maxTickets`. Kad stranicu presiječemo, cursor ide samo do `updated_at` **zadnjeg
preuzetog** ticketa — ne do `end_time` stranice. Inače bi svi neobrađeni ticketi s te
stranice trajno ispali iz analize i dashboard bi pokazivao manje ticketa nego Zendesk.
Granični ticket se ponovi u sljedećem runu (`start_time` je inkluzivan) i upsert ga
pregazi. Pokriveno u [tests/incrementalCursor.test.js](../tests/incrementalCursor.test.js).

## Čitanje (endpointi i MCP)

| Endpoint (requireAdmin) | MCP tool | Vrati |
|---|---|---|
| `GET /admin/analytics/summary` | `conversation_insights` | total, KB rupe, raspodjela po handled_by/kvaliteti |
| `GET /admin/analytics/top-questions` | `top_questions` | najčešće teme |
| `GET /admin/analytics/kb-gaps` | `kb_gaps` | rupe u KB s primjerima i prijedlozima |
| `GET /admin/analytics/conversations` | `conversation_insights` | zadnji analizirani razgovori |

## Metrike po kanalima (web / email / facebook)

Dashboard prikazuje razdiobu razgovora po kanalu iz **dva izvora** — oni odgovaraju
na različita pitanja i imaju **različit vokabular kanala**:

| Izvor | Polje | Pokriva | Vokabular |
|---|---|---|---|
| Live brojači (`metricsService`) | `GET /admin/metrics` → `metrics.byChannel` | **sav** promet, real-time | normaliziran: `web`, `email`, `facebook` |
| Analiza ticketa (`analyticsStore`) | `GET /admin/analytics/summary` → `summary.byChannel`, `summary.byChannelQuality` | samo **analizirani** ticketi | sirovi Zendesk `via.channel` → bucket |

**Live brojači** (`metrics.byChannel.<kanal>` = `{ requests, answered, escalated }`)
puni se u `index.js` pozivom `metricsService.recordChannelOutcome(channel, decision)`
uz svaki `recordDecision`: webchat put je uvijek `web`, webhook koristi
`aiService.normalizeChannelType(channelType)` (`web`/`email`/`facebook`). Brojači su
**kumulativni** (od pokretanja, perzistiraju u Supabase kao ostale metrike) — nisu
vremenska serija po danu/tjednu.

**Analiza ticketa** čuva sirovi `via.channel` iz Zendeska (`raw.via?.channel`,
`zendeskService.js`) — npr. `email`, `facebook`, `web`, `api`, `web_service`. Zato
`analyticsStore.getSummary()` mapira te vrijednosti u `web|email|facebook|ostalo`
preko `channelBuckets()`. **Napomena:** bot-kreirani webchat ticketi znaju imati
`via.channel = api`/`web_service` (ne `web`) — provjeri stvarne vrijednosti u bazi
(`SELECT DISTINCT channel FROM ticket_analysis`) i po potrebi doradi mapu u
`channelBuckets()`.

## Trošak

Analiza koristi jeftiniji model (`ANALYSIS_MODEL`, default gemini-2.5-flash), jedan
LLM poziv po ticketu. Backfill ide u serijama (`maxTickets`) pa kontroliraš trošak.
