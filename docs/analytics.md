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

## Čitanje (endpointi i MCP)

| Endpoint (requireAdmin) | MCP tool | Vrati |
|---|---|---|
| `GET /admin/analytics/summary` | `conversation_insights` | total, KB rupe, raspodjela po handled_by/kvaliteti |
| `GET /admin/analytics/top-questions` | `top_questions` | najčešće teme |
| `GET /admin/analytics/kb-gaps` | `kb_gaps` | rupe u KB s primjerima i prijedlozima |
| `GET /admin/analytics/conversations` | `conversation_insights` | zadnji analizirani razgovori |

## Trošak

Analiza koristi jeftiniji model (`ANALYSIS_MODEL`, default gemini-2.5-flash), jedan
LLM poziv po ticketu. Backfill ide u serijama (`maxTickets`) pa kontroliraš trošak.
