# Libar Asistent — Tehnička dokumentacija za developere

> **Verzija**: 2.0.0  
> **Zadnje ažuriranje**: 2026-06-11

---

## Sadržaj

- [Arhitektura](#arhitektura)
- [Podatkovni tok](#podatkovni-tok)
- [Servisi](#servisi)
- [API Endpointi](#api-endpointi)
- [Konfiguracija](#konfiguracija)
- [Metrike i praćenje](#metrike-i-praćenje)
- [Testiranje](#testiranje)
- [Rješavanje problema](#rješavanje-problema)
- [Dodavanje novih značajki](#dodavanje-novih-značajki)

---

## Arhitektura

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  Web Chat   │    │   Email     │    │  Facebook   │
│  Widget     │    │  (Zendesk)  │    │  Messenger  │
└──────┬──────┘    └──────┬──────┘    └──────┬──────┘
       │                  │                  │
       └──────────────────┼──────────────────┘
                          │
              ┌───────────▼───────────┐
              │    Express Server       │
              │    (index.js)         │
              └───────────┬───────────┘
                          │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
   ┌────▼────┐     ┌────▼────┐     ┌────▼────┐
   │ Zendesk │     │ OneDrive│     │Supabase │
   │  API    │     │ SharePoint│   │ Vector  │
   └─────────┘     └─────────┘     └─────────┘
                          │
                   ┌──────▼──────┐
                   │  OpenRouter │
                   │  LLM + Emb  │
                   └─────────────┘
```

---

## Podatkovni tok

### Web Chat putanja

```
1. Korisnik otvori widget → POST /api/chat/start
2. Bot kreira Zendesk tiket → zapisuje sessionId
3. Korisnik šalje poruku → POST /api/chat/message
4. resolveAutomatedOutcome():
   a. PII maskiranje
   b. Intent escalation check
   c. Knowledge search (vector → OneDrive → Help Center)
   d. Relevance grading (LLM)
   e. generateGroundedAnswer()
   f. Output validation
   g. Unmask PII → reply
5. Metrike + trace
```

### Webhook putanja (Email/Facebook)

```
1. Zendesk šalje webhook → POST /api/zendesk/webhook
2. Verifikacija tokena
3. Idempotency check
4. Agent intervention check
5. Spam filter (email only)
6. Input sanitization
7. PII maskiranje
8. Intent escalation check
9. Attachment check
10. Knowledge search
11. generateGroundedAnswer() (s channelType="web_chat")
12. Output validation
13. Race condition guard
14. Unmask PII → reply
15. Sync session + metrics + trace
```

---

## Servisi

### aiService.js

**Funkcije**:
- `generateReply(session, message, opts)` — glavna funkcija za generiranje odgovora
- `generateGroundedAnswer(userMessage, context, opts)` — generira odgovor isključivo iz konteksta
- `gradeContextRelevance(userMessage, context)` — ocjenjuje relevantnost konteksta (DA/NE)
- `rewriteStandaloneQuery(message, recentMessages)` — pretvara follow-up u samostalan upit
- `classifySpamCandidate(text)` — detekcija spam poruka

**Model fallback**:
- Primarni: `OPENROUTER_MODEL` (default: `openai/gpt-4o`)
- Fallback: `OPENROUTER_FALLBACK_MODEL` (default: `google/gemini-2.5-flash`)
- Ako oba padnu, vraća `null` (eskalacija)

### knowledgeService.js

**Hybrid RAG pipeline**:
1. Vector search (Supabase pgvector)
2. OneDrive fallback
3. Zendesk Help Center fallback
4. RRF merge
5. Relevance grading

**Thresholds**:
- `VECTOR_MIN_SCORE`: 0.65 (default)
- `VECTOR_FALLBACK_MIN_SCORE`: 0.50

### zendeskService.js

**Ključne funkcije**:
- `addBotReplyToTicket(ticketId, message, opts)` — dodaje javni komentar
- `addInternalNote(ticketId, message, tags)` — dodaje internu napomenu
- `checkForAgentIntervention(ticketId)` — provjerava je li agent odgovorio
- `updateConversationState(ticketId, state, tags)` — postavlja tagove i status
- `verifyWebhookToken(token)` — verificira Bearer token

**Human intervention detection**:
- Ako `ZENDESK_BOT_USER_ID` postoji, provjera temelji se na `author_id`
- Inače, heuristika temeljena na tagovima (`ai_active`, `human_replied`)

### piiService.js

**Maskirani podaci**:
- OIB (11 znamenki)
- IBAN (HR + 19 znamenki)
- Email adrese
- Telefonski brojevi
- Adrese (za naručivanje)

**Safe liste**:
- `SAFE_EMAILS` — poslovni emailovi (ne maskiraju se)
- `SAFE_PHONES` — poslovni telefoni (ne maskiraju se)

### metricsService.js

**Metrike**:
- `totalRequests` — ukupno AI zahtjeva
- `totalWebhooks` — ukupno webhook poziva
- `totalChatStarts` — početak razgovora
- `totalChatMessages` — poruke u razgovoru
- `decisions` — breakdown odluka (`safe_answer`, `escalate_no_answer`)
- `errors` — greške
- `handoffs` — eskalacije
- `latencies` — latencije (zadnjih 1000)

**Persistencija**: Supabase `bot_metrics` tablica (auto-save svakih 30 sekundi)

### tracingService.js

Zapisuje AI interakcije za admin panel:
- `sessionId` — ticket ID
- `input` — korisnikov upit
- `llmOutput` — generirani odgovor
- `decision` — `safe_answer` ili `escalate_no_answer`
- `retrieval` — knowledge source, score, count
- `latencyMs`

Buffer: max 500 zapisa (FIFO)

### outputValidator.js

Validira AI odgovore:
- Uncertainty check (`ne mogu`, `nisam siguran`)
- Fabricated action claims
- Internal process leakage
- PII leakage
- Invented URLs
- Token overlap s knowledge context

### tokenBudgetService.js

Kontrola troškova:
- `TOKEN_BUDGET_MAX_TOKENS` (default: 500000)
- `TOKEN_BUDGET_WINDOW_MS` (default: 86400000 = 24h)
- Ako budžet premašen, AI poziv puca s greškom

### responseCacheService.js

Cache temeljen na hashu (query + context):
- TTL: 300 sekundi (5 min)
- Max entries: 1000

---

## API Endpointi

### Korisnički endpointi

| Metoda | Ruta | Opis |
|--------|------|------|
| `GET` | `/` | Web chat widget |
| `POST` | `/api/chat/start` | Početak razgovora |
| `POST` | `/api/chat/message` | Slanje poruke |
| `POST` | `/api/chat/restore` | Obnova sesije |
| `POST` | `/api/zendesk/webhook` | Zendesk webhook |
| `GET` | `/health` | Health check |

### Admin endpointi

| Metoda | Ruta | Opis |
|--------|------|------|
| `GET` | `/admin/dashboard` | HTML admin panel |
| `GET` | `/admin/metrics` | Runtime metrike (JSON) |
| `GET` | `/admin/traces` | AI traceovi (JSON) |
| `GET` | `/admin/bot-state` | Bot status |
| `POST` | `/admin/bot-state` | Toggle kill switch |
| `POST` | `/admin/sync/vector` | Ručni vector sync |

**Autorizacija**: `x-admin-token` header

---

## Konfiguracija

### Environment varijable

```bash
# --- Zendesk ---
ZENDESK_SUBDOMAIN=
ZENDESK_EMAIL=
ZENDESK_API_TOKEN=
ZENDESK_WEBHOOK_TOKEN=
ZENDESK_BOT_USER_ID=0          # ID korisnika kojeg bot koristi

# --- OpenRouter / LLM ---
OPENROUTER_API_KEY=
OPENROUTER_MODEL=openai/gpt-4o
OPENROUTER_FALLBACK_MODEL=google/gemini-2.5-flash

# --- Supabase ---
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

# --- OneDrive (opcionalno) ---
ONEDRIVE_TENANT_ID=
ONEDRIVE_CLIENT_ID=
ONEDRIVE_CLIENT_SECRET=
ONEDRIVE_SITE_ID=
ONEDRIVE_DRIVE_ID=

# --- Embeddings ---
EMBEDDING_PROVIDER=openrouter
OPENROUTER_EMBEDDING_MODEL=openai/text-embedding-3-small

# --- Sigurnost ---
ADMIN_TOKEN=                   # za admin panel
ZENDESK_WEBHOOK_TOKEN=         # za webhook verifikaciju
EMBED_ALLOWED_ORIGINS=         # popis dozvoljenih origin domena (još se NE primjenjuje — v. README "Pristup i origin")

# --- Troškovi ---
TOKEN_BUDGET_MAX_TOKENS=500000
TOKEN_BUDGET_WINDOW_MS=86400000

# --- Sync ---
VECTOR_AUTO_SYNC_ENABLED=false
VECTOR_SYNC_INTERVAL_MS=1800000

# --- Kill switch ---
BOT_ENABLED=true
```

---

## Metrike i praćenje

### Log format

```json
{
  "level": "info",
  "event": "webhook_received",
  "data": { "ticketId": 123, "channelType": "email" }
}
```

### Ključni log događaji

| Event | Značenje |
|-------|----------|
| `webhook_received` | Webhook primljen |
| `webhook_skipped_own_reply` | Preskočeno (botov odgovor) |
| `webhook_skipped_human_handled` | Preskočeno (agent preuzeo) |
| `webhook_intent_escalation` | Eskalacija zbog intenta |
| `webhook_output_validation_failed` | Validacija nije prošla |
| `metrics_hydrated` | Metrike učitane iz Supabasea |
| `metrics_save_failed` | Greška pri spremanju metrika |

### Admin panel

Dostupan na `/admin/dashboard`.

**Prikazuje**:
- Ukupno upita (webchat + webhook)
- Odgovoreno / eskalirano
- Prosječna latencija
- Token potrošnja
- Cache hit rate
- Posljednji traceovi
- Kill switch status

---

## Testiranje

### Pokreni sve testove

```bash
npm test
```

### Samo unit testovi

```bash
npm run test:unit
```

Deterministički i offline (52 testa) — selektira samo prave unit testove, bez `e2e*`/`integration` (oni traže živi Zendesk/LLM).

### E2E testovi

```bash
npm run test:e2e
```

### CI

GitHub Actions ([.github/workflows/ci.yml](../.github/workflows/ci.yml)) pokreće `npm run test:unit` na svaki push i pull request prema `main` (Node 22). E2E/integration testovi se namjerno **ne** vrte u CI-ju jer traže mrežu i žive servise.

### Coverage

```bash
npm run test:coverage
```

### Lokalno testiranje kanala

```bash
# Web chat
curl http://localhost:3000

# Email webhook
curl -X POST http://localhost:3000/api/zendesk/webhook \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_WEBHOOK_TOKEN" \
  -d '{"ticketId":12345,"latestMessage":"Koliko košta dostava?","channelType":"email"}'

# Facebook webhook
curl -X POST http://localhost:3000/api/zendesk/webhook \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_WEBHOOK_TOKEN" \
  -d '{"ticketId":12345,"latestMessage":"Koliko košta dostava?","channelType":"facebook"}'

# Health check
curl http://localhost:3000/health
```

---

## Rješavanje problema

### `metrics_save_failed` (404)

Tablica `bot_metrics` ne postoji u Supabase. Pokreni:

```sql
CREATE TABLE bot_metrics (
    id int PRIMARY KEY,
    data jsonb,
    updated_at timestamptz DEFAULT now()
);
```

### `maskedMsg is not defined`

Provjeri da li je `maskedMsg` deklariran izvan `if (latestMessage)` bloka. Webhook handler mora imati fallback kad `latestMessage` nedostaje.

### `model_attempt_failed` (400)

Model nije dostupan na OpenRouteru. Promijeni `OPENROUTER_MODEL` u siguran model (`openai/gpt-4o` ili `openai/gpt-4o-mini`).

### Bot odgovara neodgovarajućim informacijama

1. Provjeri OneDrive dokumente — možda su zastarjeli
2. Pokreni: `node scripts/sync-vector-knowledge.js --force`
3. Provjeri referentne činjenice u `services/aiService.js`

### Vector search ne vraća rezultate

1. Provjeri da li je Supabase pgvector uključen
2. Provjeri indeksiranje: `node scripts/sync-vector-knowledge.js --force`
3. Smanji `VECTOR_MIN_SCORE` ako je previsok

---

## Dodavanje novih značajki

### Dodavanje novog kanala

1. Kreiraj handler u `index.js` (slično `/api/zendesk/webhook`)
2. Koristi `aiService.generateGroundedAnswer()` za generiranje
3. Dodaj `metricsService.increment("totalRequests")`
4. Pozovi `tracingService.createTrace()` za admin panel

### Dodavanje novog izvora znanja

1. Kreiraj servis u `services/` (slično `oneDriveService.js`)
2. Dodaj u `knowledgeService.searchKnowledgeDetailed()`
3. Implementiraj RRF merge ako je potrebno

### Dodavanje novog intenta za eskalaciju

1. U `services/intentEscalationService.js` dodaj pattern u `ESCALATION_INTENTS`
2. Dodaj poruku u `ESCALATION_MESSAGES`
3. U `index.js` provjeri u `resolveAutomatedOutcome()` ili webhook handleru

---

## Struktura projekta

```
libar-zendesk-bot-v2/
├── index.js                    # Glavna Express aplikacija
├── config/
│   ├── env.js                  # Environment konfiguracija
│   └── logger.js               # Structured logging
├── services/
│   ├── aiService.js            # LLM pozivi (OpenRouter)
│   ├── conversationService.js  # Konverzacijska memorija
│   ├── knowledgeService.js     # RAG pretraga (hybrid)
│   ├── vectorKnowledgeService.js  # Vector DB pretraga
│   ├── zendeskService.js       # Zendesk API wrapper
│   ├── oneDriveService.js      # OneDrive/SharePoint sync
│   ├── piiService.js           # PII maskiranje
│   ├── tokenBudgetService.js   # Token budget kontrola
│   ├── responseCacheService.js # Response cache
│   ├── outputValidator.js      # Validacija AI odgovora
│   ├── metricsService.js       # Interni metrički sustav
│   ├── supabaseMetricsService.js  # Supabase persistencija
│   ├── tracingService.js       # AI traceovi
│   ├── spamFilterService.js    # Email spam detekcija
│   ├── intentEscalationService.js  # Intent escalation
│   ├── inputSanitizer.js       # Input sanitizacija
│   ├── botStateService.js      # Kill switch state
│   └── runtimeStore.js         # In-memory session store
├── middleware/
│   ├── rateLimiter.js          # Rate limiting
│   └── inputSanitizer.js       # Sanitizacija ulaznih podataka
├── public/
│   └── index.html              # Web chat widget
├── scripts/
│   ├── sync-vector-knowledge.js  # OneDrive → Supabase sync
│   └── generate-tests-from-zendesk.js
├── tests/                      # Testovi
├── .env.example                # Primjer environment datoteke
├── render.yaml                 # Render deploy konfiguracija
├── README.md                   # Klijentska dokumentacija
├── CLAUDE.md                   # Operativni vodič za Claude Code
└── docs/
    ├── developer.md            # Ova datoteka
    ├── user-guide.md
    ├── production-readiness.md
    └── decisions/              # Arhitekturne odluke (ADR)
```

---

## Licenca

MIT — Razvijeno za **Antikvarijat Libar**, Dante d.o.o., Osijek
