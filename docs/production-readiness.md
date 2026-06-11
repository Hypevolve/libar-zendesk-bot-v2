# Analiza Production Readiness — libar-zendesk-bot-v2

> **Status:** Ažurirano 2026-06-11. Bot je produkcijski spreman i u radu. Većina problema iz prve analize riješena je novijim commitovima (security hardening, dashboard redesign, dedup/Zendesk fix). Ovaj dokument odražava **stvarno trenutno stanje koda**.

## Sažetak

Bot je **arhitektonski zreo i produkcijski spreman** s jakim multi-layer defense modelom. Od izvornih **5 kritičnih** problema **svih 5 je riješeno**; od **8 preporuka 6 je riješeno**, a ostaju **#7** (svjesno — vidi napomenu, NIJE čista ušteda) i **#9** (retry, niski prioritet). Web chat putanja je potpuna; webhook (Facebook/email) putanja je nakon zadnjih fixeva na paritetu.

---

## ✅ Što radi izvrsno (ne dirati)

| Komponenta | Ocjena | Obrazloženje |
|------------|--------|--------------|
| **Arhitektura** | A | Čista separacija: AI, Knowledge, Vector, Zendesk, PII, Spam, Memory — svaki u vlastitom servisu |
| **Intent escalation** | A | 5 kategorija (reklamacija, oštećenje, pravna prijetnja, hitno, kriva narudžba) — regex-based, brzo, pouzdano |
| **Attachment escalation** | A | Webchat + webhook oba patha eskaliraju slike/datoteke odmah na agenta |
| **PII defense** | A | Maskiranje prije LLM-a, OIB checksum, SAFE whitelist za javne kontakte, detekcija u outputu |
| **Output validation** | A | 6 slojeva: uncertainty, fabricated action, internal leak, PII, invented URL, token overlap |
| **Hybrid search** | A | Vector (pgvector) + FTS + RRF fusion, domain-aware thresholds, multi-tier fallback |
| **Conversation memory** | A | Sliding window (10 poruka / 3000 znakova), query rewriting za multi-turn |
| **Model fallback** | A | Primarni → sekundarni model s retry logikom; default model ako env nije postavljen |
| **Kill switch** | A | `BOT_ENABLED=false` + runtime toggle preko `POST /admin/bot-state` |
| **Token budget** | A | Procjena prije svakog LLM poziva, trimanje konteksta, gate na 80% |
| **Webhook resilience** | A | Idempotency (timestamp + normalizirani tekst), sanitizacija, intent escalation, attachment check, human-handoff guard, rate limiter |
| **Health check** | A | 200 za degraded stanje (Render ne restarta), 503 samo za total down |
| **Crash resilience** | A | uncaughtException persistira sesije prije izlaza |
| **Session cleanup** | A | 24h TTL, čišćenje svakih 30min |
| **Response cache** | A | TTL + max entries, channel-aware key |
| **Spam filter** | A | Dvostupanjski: heuristika + AI klasifikator, samo za email |
| **Tracing / Metrics** | A | In-memory trace buffer, latency percentili, token usage, cache stats |

---

## ✅ Riješeni problemi (bili kritični / preporuke u prvoj analizi)

| # | Problem | Status | Dokaz u kodu |
|---|---------|--------|--------------|
| 1 | Nedostajući metrics counteri (`botDisabledEscalations`, `webhooksSkippedHumanHandled`) | **Riješeno** | Ključevi postoje u `counters` — [services/metricsService.js:20-21](../services/metricsService.js#L20-L21) |
| 2 | Webhook knowledge search bez intent/conversation boosta | **Riješeno** | `conversationTerms` se prosljeđuju u `searchKnowledgeDetailed` — [index.js](../index.js) (webhook history blok) |
| 3 | Nema admin endpointa za kill switch | **Riješeno** | `POST /admin/bot-state` poziva `botStateService.setEnabled()` — [index.js:1207](../index.js#L1207) |
| 4 | `getPublicTicketComments` — nepoznato sortiranje | **Riješeno** | Eksplicitan `sort: created_at` — [services/zendeskService.js:421](../services/zendeskService.js#L421) |
| 5 | Webhook conversation summary — kriva role logika | **Riješeno** | `String(c.author_id) === String(requesterId)` razlikuje korisnika od bota/agenta — [index.js](../index.js) (webhook history blok) |
| 6 | Rate limiter na webhook endpointu | **Riješeno** | `webhookRateLimiter` (80/min) — [index.js:885](../index.js#L885), [middleware/rateLimiter.js:73-93](../middleware/rateLimiter.js#L73-L93) |
| 8 | `getConfiguredModels()` prazan niz bez env-a | **Riješeno** | Default `openai/gpt-4o-mini` fallback — [services/aiService.js:37-47](../services/aiService.js#L37-L47) |
| 10 | Webhook ne ažurira `chatSessions` | **Riješeno** | `syncWebhookMessageToSession()` nakon obrade — [index.js](../index.js) |
| 11 | `isWebhookDuplicate` ovisan o raw tekstu | **Riješeno** | Timestamp-based dedup primarni, fallback normalizirani tekst (HTML strip + collapse) — [index.js:161-200](../index.js#L161-L200) |
| 12 | Nema `BOT_ENABLED` u `.env.example` | **Riješeno** | Prisutan — [.env.example](../.env.example) |
| 13 | Nema CI pipelinea | **Riješeno** | GitHub Actions pokreće `npm run test:unit` na push/PR — [.github/workflows/ci.yml](../.github/workflows/ci.yml) |

---

## ⚠️ Otvorene preporuke (izvan opsega zadnjeg zahvata, niski prioritet)

Sljedeće je svjesno **ostavljeno** — klijent je zadovoljan botom, ovo nisu prijavljeni problemi. Zabilježeno kao buduće poboljšanje.

### 7. `REFERENTNE_CINJENICE` u fallback promptu — NIJE čista ušteda (REVIDIRANO)

Prvotna analiza tvrdila je da je ovo "samo trošak". Detaljnija provjera pokazuje da **nije**: `buildGroundedAnswerPrompt` ([services/aiService.js:263](../services/aiService.js#L263)) uvijek uključuje `REFERENTNE_CINJENICE` kao zaseban blok, a na **fallback** putanji (kad RAG ne nađe ništa) `generateGroundedAnswer(maskedMsg, REFERENTNE_CINJENICE, …)` iste činjenice ubacuje i u `KONTEKST:` slot ([index.js:1061](../index.js#L1061)).

To je **namjerno i nosivo**: prompt kaže "tvoj JEDINI izvor istine je kontekst ispod" ([aiService.js:215](../services/aiService.js#L215)) i da odbije ako odgovor nije podržan *KONTEKSTOM*. Stavljanje činjenica u KONTEKST slot je ono što fallbacku dopušta da uopće odgovori (npr. "koliko košta dostava?" kad pretraga promaši). Uklanjanje "duplikata" riskira češća odbijanja na fallback putanji. **Odluka: ne dirati bez A/B testa na živom botu.** Ušteda (~300-400 tok) javlja se samo na fallback pozivima, ne na svakom.

### 9. Nema eksplicitnog retryja na grounded-answer timeout

`runWithModelFallback` podržava per-model retry preko `maxAttemptsPerModel`, ali `generateGroundedAnswer` koristi default (1, bez retryja). `generateReply` koristi 2. Na timeout se prelazi na sljedeći model — graceful, ali bez kratkog retryja na istom modelu. **Niski prioritet, ostaje odgođeno.**

---

### Napomena: test infrastruktura (riješeno uz #13)

Uz uvođenje CI-ja popravljena su dva problema u test setupu:
- `npm run test:unit` je prije vukao i `e2e*`/`integration` testove (node 22 ne poštuje `'!'` glob negaciju) → lažni `ECONNREFUSED` failovi. Sada selektira samo prave unit testove (`ls tests/*.test.js | grep -vE 'e2e|integration'`), 52 testa, deterministički offline.
- `tests/tokenBudget.test.js` je bio zastario prema refaktoriranom potpisu `trimContextToBudget(context, reservedTokens)` — ažuriran.

---

## 📊 Finalna ocjena readinessa

| Kategorija | Ocjena | Status |
|------------|--------|--------|
| Točnost odgovora (RAG) | A | Hybrid search + relevance grading + validation; webhook na paritetu s webchatom |
| Intent recognition | A | 5 escalation tipova + greeting detection |
| Eskalacija | A | Attachment + intent + no-grounded-answer |
| Multi-turn memory | A | Webchat i webhook (session sync + conversation terms) |
| Halucinacija prevention | A- | 6-slojna validacija, token overlap, URL check |
| PII / Security | A | Mask, detect, block, safe whitelist |
| Webhook / FB / Email | A- | Kontekst, intent escalation, rate limiter, session sync, conversation terms |
| Opservabilnost | A- | Tracing + metrics, counteri kompletni |
| Crash / Error recovery | A | Graceful degradation, session persist, crash handler |
| Dokumentacija | A- | `.env.example` kompletan, `CLAUDE.md` + `docs/` struktura |

**Ukupna ocjena: A (Production Ready — u radu)**

Preostale otvorene stavke (#7, #9) su niskoprioritetne i ne blokiraju produkciju.
