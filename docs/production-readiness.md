# Analiza Production Readiness — libar-zendesk-bot-v2

## Sažetak

Bot je **arhitektonski zreo i produkcijski spreman** s jakim multi-layer defense modelom. Većina kritičnih staza radi ispravno. Identificirano je **5 problema koje treba hitno riješiti** prije isporuke klijentu, plus **8 preporuka** za daljnje poboljšanje robustnosti.

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
| **Model fallback** | A | Primarni → sekundarni model s retry logikom |
| **Kill switch** | A | `BOT_ENABLED=false` zaustavlja sve AI odgovore, runtime toggle spreman |
| **Token budget** | A | Procjena prije svakog LLM poziva, trimanje konteksta, gate na 80% |
| **Webhook resilience** | A | Idempotency (5min TTL), sanitizacija, intent escalation, attachment check, human-handoff guard |
| **Health check** | A | 200 za degraded stanje (Render ne restarta), 503 samo za total down |
| **Crash resilience** | A | uncaughtException persistira sesije prije izlaza |
| **Session cleanup** | A | 24h TTL, čišćenje svakih 30min |
| **Response cache** | A | TTL + max entries, channel-aware key |
| **Spam filter** | A | Dvostupanjski: heuristika + AI klasifikator, samo za email |
| **Tracing / Metrics** | A | In-memory trace buffer, latency percentili, token usage, cache stats |

---

## ❌ Kritični problemi (MORA se riješiti prije isporuke)

### 1. Nedostajući metrics counteri — silent failure

**Lokacija:** `index.js:229` i `index.js:706`

```javascript
metricsService.increment("botDisabledEscalations");        // ne postoji u counters
metricsService.increment("webhooksSkippedHumanHandled"); // ne postoji u counters
```

`metricsService.increment()` provjerava `typeof counters[key] === "number"` i preskače ako ključ ne postoji. Ovo je **silent failure** — brojači se nikad ne povećavaju, a admin ne vidi koliko eskalacija zbog bot disabled stanja.

**Rješenje:** Dodati ova dva polja u `counters` objekt u `services/metricsService.js`.

---

### 2. Webhook knowledge search ne koristi intent i conversation terms

**Lokacija:** `index.js:781`

Webchat path:
```javascript
knowledgeService.searchKnowledgeDetailed(rewrittenQuery, {
  taskIntent: session.entryIntent,
  conversationTerms: conversationService.extractConversationTerms(session.messages)
});
```

Webhook path:
```javascript
knowledgeService.searchKnowledgeDetailed(maskedMsg);  // NEMA taskIntent ni conversationTerms
```

Webhook upiti (Facebook/Email) ne koriste intent-based i conversation-based boosting. To znači da multi-turn razgovori preko Facebooka/Emaila imaju **slabiju pretragu** nego webchat.

**Rješenje:** Prosljediti `taskIntent` (iz ticket tagova ili prve poruke) i `conversationTerms` (iz komentara) i u webhook path.

---

### 3. Admin endpoint za kill switch ne postoji

**Lokacija:** `services/botStateService.js` ima `setEnabled()`, ali `index.js` nema HTTP endpoint za to.

Ako bot počne halucinirati u produkciji, admin ne može **runtime** isključiti bota bez redeploya. Jedina opcija je `BOT_ENABLED=false` u env + restart.

**Rješenje:** Dodati `POST /admin/bot/toggle` endpoint koji poziva `botStateService.setEnabled()`.

---

### 4. `getPublicTicketComments` — nepoznato sortiranje

**Lokacija:** `index.js:178-179` (u `detectWebhookAttachments`)

```javascript
const latest = comments[comments.length - 1];  // pretpostavlja kronološki ASC
```

Ako Zendesk API vraća komentare **DESC** (najnoviji prvi), `comments[comments.length - 1]` je **najstariji** komentar, a ne najnoviji. Attachment check bi onda gledao pogrešan komentar.

**Rješenje:** Eksplicitno sortirati komentare po `created_at` prije uzimanja zadnjeg, ili provjeriti Zendesk API dokumentaciju za default sort.

---

### 5. Webhook conversation summary — kriva logika za role

**Lokacija:** `index.js:772-774`

```javascript
const role = c.author_id ? "Korisnik" : "Asistent";
```

Ovo pretpostavlja da postojanje `author_id` znači da je komentar od korisnika. Ali:
- Bot replyjevi IMAJU `author_id` (ID agenta/bota)
- Agent replyjevi IMAJU `author_id`
- Samo korisnički komentari imaju `author_id` koji odgovara `requester_id`

To znači da će bot replyjevi biti označeni kao "Korisnik" u conversation summary, što će zbuniti LLM.

**Rješenje:** Usporediti `c.author_id` s `requester_id` ticketa. Ako se podudara → "Korisnik", inače → "Asistent/Agent".

---

## ⚠️ Važne preporuke (za prvu iteraciju nakon isporuke)

### 6. Rate limiter na webhook endpoint

Webhook (`POST /api/zendesk/webhook`) nema `rateLimiter` middleware. Iako ima token verifikaciju, DoS napad s ispravnim tokenom može preplaviti bot LLM pozivima.

**Rješenje:** Dodati `rateLimiter` na webhook, ali s višim pragom (npr. 60/min) nego chat endpointi (30/min).

---

### 7. `REFERENTNE_CINJENICE` duplirane u promptu

`index.js:360` dodaje `REFERENTNE_CINJENICE` u kontekst:
```javascript
const enrichedContext = `${aiService.REFERENTNE_CINJENICE}\n\n...${knowledge.context}`;
```

A `buildGroundedAnswerPrompt` VEĆ uključuje `REFERENTNE_CINJENICE` odvojeno prije "KONTEKST:" sekcije. To troši ~300-400 tokena viška po pozivu.

**Rješenje:** Ukloniti `REFERENTNE_CINJENICE` iz `enrichedContext` u index.js — prompt ih već uključuje.

---

### 8. `getConfiguredModels()` prazan niz ako env nije postavljen

Ako `OPENROUTER_MODEL` i `OPENROUTER_FALLBACK_MODEL` nisu postavljeni, `getConfiguredModels()` vraća `[]`. `runWithModelFallback` će loopati 0 puta i vratiti `undefined`.

**Rješenje:** Dodati fallback default model u `getConfiguredModels()`:
```javascript
if (models.length === 0) models.push("openai/gpt-4.1-mini");
```

---

### 9. Nema retry mehanizma na LLM timeout

15s timeout je postavljen, ali ako istekne, `runWithModelFallback` hvata grešku i prelazi na sljedeći model. To je OK. Ali ako OBA modela timeoutaju, cijeli pipeline pada u graceful degradation.

**Rješenje:** Razmotriti kratak retry (1 retry s 2s delay) na timeout prije fallbacka na sljedeći model.

---

### 10. Webhook ne ažurira `chatSessions`

Webhook handler obrađuje poruke ali ne ažurira in-memory `chatSessions` Map. To znači da `POST /api/chat/restore` može vratiti zastarjelu povijest ako je korisnik nastavio razgovor preko Facebooka/Emaila.

**Rješenje:** Nakon obrade webhook poruke, ako postoji sesija za taj ticket, dodati poruku u `session.messages` i ažurirati `updatedAt`.

---

### 11. `isWebhookDuplicate` — ovisnost o raw tekstu

Deduplicacija se temelji na `ticketId + messageText`. Ako Zendesk pošalje istu poruku s malo drugačijim formatiranjem (HTML vs plain), dedup neće prepoznati duplikat.

**Rješenje:** Koristiti `ticketId + createdAt` (timestamp) umjesto sadržaja poruke, ili kombinirati oboje.

---

### 12. Nema `BOT_ENABLED` u `.env.example`

`config/env.js` čita `BOT_ENABLED`, ali `.env.example` ne sadrži tu varijablu. Novi developer ne zna da ovo postoji.

**Rješenje:** Dodati `# BOT_ENABLED=true` u `.env.example` s objašnjenjem.

---

### 13. E2E testovi — ne pokreću se automatski

E2E testovi (`tests/e2e.test.js`) zahtijevaju pokrenuti server i živi Zendesk/LLM. Nema CI pipeline konfiguracije.

**Rješenje:** Dodati `render.yaml` health check path i razmotriti GitHub Actions za unit testove.

---

## 📊 Finalna ocjena readinessa

| Kategorija | Ocjena | Status |
|------------|--------|--------|
| Točnost odgovora (RAG) | A- | Hybrid search + relevance grading + validation |
| Intent recognition | A | 5 escalation tipova + greeting detection |
| Eskalacija | A | Attachment + intent + no-grounded-answer |
| Multi-turn memory | B+ | Webchat odličan, webhook dobar ali bez session synca |
| Halucinacija prevention | A- | 6-slojna validacija, token overlap, URL check |
| PII / Security | A | Mask, detect, block, safe whitelist |
| Webhook / FB / Email | B+ | Kontekst se dohvaća, ali bez intent/terms boosta |
| Opservabilnost | B+ | Tracing + metrics, ali nedostajući counteri |
| Crash / Error recovery | A | Graceful degradation, session persist, crash handler |
| Dokumentacija | B | .env.example dobar, ali nedostaje opis BOT_ENABLED |

**Ukupna ocjena: A- (Production Ready nakon fixanja 5 kritičnih problema)**

---

## Prioritetni redoslijed fixeva

1. **Fix #1** — Dodati `botDisabledEscalations` i `webhooksSkippedHumanHandled` u metricsService (2 min)
2. **Fix #3** — Dodati admin endpoint za bot toggle (10 min)
3. **Fix #5** — Fix role logike u webhook conversation summary (5 min)
4. **Fix #4** — Sortirati komentare u `detectWebhookAttachments` (5 min)
5. **Fix #2** — Prosljediti intent/terms u webhook knowledge search (15 min)
6. **Fix #7** — Ukloniti duplirane REFERENTNE_CINJENICE iz enrichedContext (2 min)
7. **Fix #12** — Dodati BOT_ENABLED u .env.example (1 min)

**Ukupno: ~40 minuta implementacije**
