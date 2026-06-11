# Libar Asistent — AI Chatbot za Antikvarijat Libar

**Libar Asistent** je enterprise AI chatbot za korisničku podršku Antikvarijata Libar. Primarno integriran s **Zendeskom** kao backend ticketing sustavom, bot služi kao prva linija podrške kroz više kanala: web chat widget, email i Facebook Messenger.

---

## Sadržaj

- [Pregled](#pregled)
- [Arhitektura](#arhitektura)
- [Kanali](#kanali)
- [RAG (Retrieval-Augmented Generation)](#rag-retrieval-augmented-generation)
- [Konverzacijska memorija](#konverzacijska-memorija)
- [Escalation logika](#escalation-logika)
- [Sigurnost i zaštita](#sigurnost-i-zaštita)
- [Instalacija i pokretanje](#instalacija-i-pokretanje)
- [Environment varijable](#environment-varijable)
- [Deployment na Render](#deployment-na-render)
- [Upravljanje znanjem (OneDrive + Supabase)](#upravljanje-znanjem-onedrive--supabase)
- [Kill switch](#kill-switch)
- [Testiranje](#testiranje)
- [Troubleshooting](#troubleshooting)

---

## Pregled

**Libar Asistent** je AI chatbot koji služi kao prva linija korisničke podrške za Antikvarijat Libar. Dostupan je putem web stranice, emaila i Facebook Messengera.

### Glavne značajke

- **Višekanalni** — web chat widget, email (Zendesk), Facebook Messenger
- **Pametan** — pretražuje bazu znanja i daje točne odgovore na temelju dokumenata
- **Pamti razgovor** — razumije follow-up pitanja bez ponavljanja konteksta
- **Smart escalation** — automatski šalje složene upite ljudskom timu
- **Spam filtriranje** — detekcija neželjenih email poruka
- **Siguran** — maskira osobne podatke prije slanja AI-ju
- **Kill switch** — emergency stop bez potrebe za tehničkom intervencijom
- **Admin panel** — pregled svih razgovora, metrika i statusa bota

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
              │    Express Server     │
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

### Struktura projekta


---

## Kanali

### 1. Web Chat Widget (`/`)

Moderni floating chat widget serviran na root path-u. Značajke:
- **Light mode** s brand bojama (narančasta primarna boja)
- **Phosphor icons** (CDN) — profesionalni vektorski ikone
- **Typing indicator** — animirane točkice dok bot razmišlja
- **Timestamps** — vremenske oznake na svakoj poruci
- **Scroll-to-bottom** — automatsko skrolanje
- **Error retry** — retry logika kod grešaka
- **End chat** — gumb za završetak razgovora
- **Pre-chat form** — prikuplja ime i email prije početka

**Embed na WordPress / bilo koju web stranicu:**

Najlakši način je umetnuti ovaj `<script>` u footer web stranice:

```html
<!-- Zamijeni TV-RENDER-URL stvarnim URL-om bota (npr. https://libar-bot.onrender.com) -->
<script src="https://TV-RENDER-URL.com/embed.js" async></script>
```

**WordPress** — ubaci preko plugina *"Insert Headers and Footers"*:
1. Idi na **Settings → Insert Headers and Footers**
2. U polje *"Scripts in Footer"* zalijepi gornji `<script>` tag
3. Zamijeni `TV-RENDER-URL` stvarnim URL-om s Rendera
4. Spremi

**Alternativa — iframe** (ako želiš embeddati u određeni dio stranice):

```html
<iframe src="https://TV-RENDER-URL.com" style="width:400px;height:580px;border:none;"></iframe>
```

### 2. Email (Zendesk Ticketing)

- Dolazni emailovi stvaraju Zendesk tikete
- Bot analizira pitanje i odgovara direktno u tiket
- Ako bot ne može odgovoriti → eskalira (interna napomena + tag)
- Spam emailovi se automatski filtriraju

### 3. Facebook Messenger (preko Zendesk)

- Facebook poruke se sinkroniziraju s Zendesk tiketima
- Bot obrađuje istim RAG pipeline-om kao email

### 4. Zendesk Webhook

Webhook ruta (`/zendesk/webhook`) prima događaje:
- `ticket_created` — novi tiket od korisnika
- `ticket_comment` — novi komentar na tiketu

**Rate limiting**: 30 zahtjeva/min
**Deduplication**: hash temeljen na tekstu + timestamp-u
**Session sync**: webhook poruke se sinkroniziraju s web chat sesijama

---

## Admin panel

Admin panel dostupan na `/admin/dashboard`. Prikazuje:

- **Ukupno upita** — webchat + email/Facebook
- **Odgovoreno / eskalirano** — s postotcima
- **Prosječna latencija** — brzina odgovora
- **Token potrošnja** — in/out i procijenjeni trošak
- **Cache hit rate** — učinkovitost cachea
- **Posljednji razgovori** — pregled svih upita i odluka
- **Kill switch** — uključivanje/isključivanje bota jednim klikom

**Pristup**: Unesi `ADMIN_TOKEN` u login formu.

---

## RAG (Retrieval-Augmented Generation)

Bot koristi RAG tehnologiju — umjesto da "zna" sve napamet, **pretražuje dokumente** i odgovara isključivo na temelju pronađenih informacija.

### Izvori znanja (prioritetno)

| Izvor | Prioritet | Opis |
|-------|----------|------|
| **Supabase Vector DB** | 1 | Embedded dokumenti iz OneDrive-a |
| **OneDrive SharePoint** | 2 | Live dokumenti (Word, Excel) |
| **Zendesk Help Center** | 3 | Članci pomoći |
| **Referentne činjenice** | 4 | Ključni podaci (cijene, adresa, radno vrijeme) |

### Referentne činjenice (hardcoded)

Ove činjenice su uvijek dostupne LLM-u, čak i bez vector pretrage:

- Dostava GLS kućna adresa: **5,97 EUR**
- Dostava GLS paketomat: **3,75 EUR**
- Dostava BoxNow paketomat: **3,25 EUR**
- Osobno preuzimanje Osijek: **besplatno**
- Rok dostave: **1–2 radna dana**
- Radno vrijeme: **pon–pet 08:00–20:00, sub 08:00–13:00**
- Adresa: **Županijska ulica 17, 31000 Osijek**
- Telefon: **031/201-230**
- Email: **info@antikvarijat-libar.com**
- Online plaćanje: **CorvusPay**
- Plaćanje u poslovnici: **gotovina, kartica, rate (PBZ/Zaba)**
- Program vjernosti SJEDI 5: **5 otkupa = besplatna dostava, 8 = 5%, 11 = 10%**
- Otkup: **4+ knjige = besplatno, <4 = 3,00 EUR**

---

## Konverzacijska memorija

Bot pamti kontekst kroz više poruka:

- **Max poruka**: 10 zadnjih
- **Max znakova**: 3000
- **Sliding window** — najstarije se odbacuju

### Follow-up pitanja

Primjer multi-turn razgovora:

```
Korisnik: Koliko košta dostava?
Bot:     Dostava GLS 5,97 EUR, paketomat 3,75 EUR...

Korisnik: A za iste knjige u paketomat?        ← follow-up
Bot:     GLS paketomat 3,75 EUR, BoxNow 3,25 EUR  ✅

Korisnik: A koliko je otkup knjiga?            ← prebacivanje teme
Bot:     Raspon otkupa 1,33–15,00 EUR...       ✅

Korisnik: A za 3 knjige?                      ← follow-up
Bot:     Trošak dostave 3,00 EUR (odbit će se od otkupa) ✅
```

**Implementacija**: Ako kratki follow-up (≤6 riječi) ne pronađe rezultate, bot kombinira prethodno pitanje + trenutno pitanje za vector pretragu.

---

## Escalation logika

Bot **automatski eskalira** (šalje ljudskom agentu) u sljedećim slučajevima:

| Trigger | Razlog | Kategorija |
|---------|--------|------------|
| `bot_disabled` | Kill switch = false | Hard handoff |
| `attachment_uploaded` | Korisnik šalje slike/datoteke | Hard handoff |
| `intent_complaint` | Žalba, reklamacija | Hard handoff |
| `intent_legal_threat` | Pravna prijetnja | Hard handoff |
| `intent_return` | Povrat knjiga | Hard handoff |
| `intent_damaged_item` | Oštećena knjiga | Hard handoff |
| `no_grounded_answer` | Nema relevantnog konteksta | Soft handoff |
| `ai_generation_failed` | LLM timeout / greška | Soft handoff |

**Hard handoff** — odmah preusmjerava na agenta, bot više ne odgovara  
**Soft handoff** — bot šalje pripremnu poruku, eskalira tiket, ali ostaje aktivan

---

## Sigurnost i zaštita

### Rate limiting
- **30 zahtjeva/min** po IP adresi
- **10 upload-ova/min** za datoteke
- **60 sekundi** cooldown između poruka u istoj sesiji

### PII (Personally Identifiable Information)
- **Automatsko maskiranje** — OIB, IBAN, email, telefon, adresa
- Prije slanja LLM-u, osjetljivi podaci se zamjenjuju placeholderima
- Po vraćanju odgovora, originalni podaci se ne vraćaju korisniku

### Input sanitizacija
- **XSS protection** — escape HTML znakova
- **Maksimalna duljina** — 1500 znakova
- **Dozvoljeni kanali** — webchat, email, facebook, unknown

### CORS
- Web widget dopušteno samo na `EMBED_ALLOWED_ORIGINS` domenama
- Admin API zaštićen `ADMIN_TOKEN`-om

---

## Instalacija i pokretanje

### Preduvjeti

- **Node.js** ≥ 18 (preporuka: 22)
- **npm**
- **Zendesk** račun s API pristupom
- **OpenRouter** API ključ
- **Supabase** projekt s pgvector ekstenzijom (za RAG)
- *(Opcionalno)* **OneDrive** Enterprise aplikacija (za sinkronizaciju dokumenata)

### Lokalno pokretanje

```bash
# 1. Kloniraj repozitorij
git clone https://github.com/Hypevolve/libar-zendesk-bot-v2.git
cd libar-zendesk-bot-v2

# 2. Instaliraj ovisnosti
npm install

# 3. Kopiraj primjer environment datoteke
cp .env.example .env

# 4. Uredi .env — unesi sve potrebne API ključeve
#    (vidi odjeljak "Environment varijable")

# 5. Pokreni
touch .env
npm start          # Produkcija
npm run dev        # Razvoj (auto-reload)
```

### Lokalno testiranje kanala

**Web Chat:**
```bash
# Pokreni server i otvori u browseru:
open http://localhost:3000
```

**Email (simulacija):**
```bash
curl -X POST http://localhost:3000/api/zendesk/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "ticketId": 12345,
    "requesterId": 67890,
    "requesterName": "Test User",
    "requesterEmail": "test@example.com",
    "subject": "Pitanje o dostavi",
    "latestMessage": "Koliko košta dostava?",
    "channelType": "email"
  }'
```

**Facebook (simulacija):**
```bash
curl -X POST http://localhost:3000/api/zendesk/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "ticketId": 12345,
    "requesterId": 67890,
    "requesterName": "Test User",
    "requesterEmail": "test@example.com",
    "latestMessage": "Koliko košta dostava?",
    "channelType": "facebook"
  }'
```

**Health check:**
```bash
curl http://localhost:3000/health
```

---

## Environment varijable

Za pokretanje bota potrebni su sljedeći API ključevi:

| Varijabla | Opis | Primjer |
|-----------|------|---------|
| `ZENDESK_SUBDOMAIN` | Tvoj Zendesk subdomain | `antikvarijat-libar` |
| `ZENDESK_EMAIL` | Email agenta | `agent@example.com` |
| `ZENDESK_API_TOKEN` | Zendesk API token | `abc123...` |
| `ZENDESK_WEBHOOK_TOKEN` | Tajni token za webhook | `webhook-secret-xyz` |
| `OPENROUTER_API_KEY` | OpenRouter API ključ | `sk-or-...` |
| `SUPABASE_URL` | Supabase URL | `https://xxxxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role ključ | `eyJhbGci...` |

Puni popis varijabli i tehnički detalji: vidi [docs/developer.md](docs/developer.md).

---

## Deployment na Render

### 1. Kreiraj novi web service

1. Otvori [render.com](https://render.com)
2. **New + → Web Service**
3. Poveži GitHub repozitorij `Hypevolve/libar-zendesk-bot-v2`
4. Odaberi branch: `main`

### 2. Konfiguracija

```yaml
# render.yaml (već uključen u repozitoriju)
name: libar-zendesk-bot-v2
runtime: node
plan: starter        # ⚠️ Obavezno Starter ili više!
buildCommand: npm install
startCommand: npm start
healthCheckPath: /health
```

**⚠️ Važno**: Koristi **Starter plan** ($7/mj) ili više. Besplatni plan ulazi u sleep mode nakon 15 min neaktivnosti — bot neće moći primiti webhookeve.

### 3. Environment varijable

U Render dashboardu → Environment → dodaj sve varijable iz `.env.example`:

1. `OPENROUTER_API_KEY` — sync: false
2. `ZENDESK_API_TOKEN` — sync: false
3. `SUPABASE_SERVICE_ROLE_KEY` — sync: false
4. `ONEDRIVE_CLIENT_SECRET` — sync: false
5. `ADMIN_TOKEN` — sync: false

Varijable označene `sync: false` se ne prikazuju u logovima.

### 4. Deploy

Klikni **Deploy**. Render će automatski:
1. Pokrenuti `npm install`
2. Pokrenuti `npm start`
3. Health check na `/health`
4. Auto-deploy na svaki push na `main`

---

## Upravljanje znanjem (OneDrive + Supabase)

### Supabase setup (za RAG)

1. Kreiraj novi Supabase projekt
2. Uključi **pgvector** ekstenziju (Database → Extensions)
3. Kreiraj tablicu za vektore:

```sql
CREATE TABLE knowledge_vectors (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id text,
    chunk_index int,
    content text,
    embedding vector(1536),
    metadata jsonb,
    created_at timestamptz DEFAULT now()
);

CREATE INDEX ON knowledge_vectors USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);
```

### OneDrive sync

```bash
# Ručna sinkronizacija
cd libar-zendesk-bot-v2
node scripts/sync-vector-knowledge.js --force --delete-missing
```

**Opcije:**
- `--force` — re-index čak i ako se hash nije promijenio
- `--delete-missing` — obriši chunkove za dokumente koji više ne postoje

### Auto sync

Postavi `VECTOR_AUTO_SYNC_ENABLED=true` i `VECTOR_SYNC_INTERVAL_MS=1800000` (30 min) za automatsku sinkronizaciju.

---

## Kill switch

Emergency stop bez redeploya:

```bash
# Lokalno
BOT_ENABLED=false npm start

# Na Renderu — promjeni environment varijablu
BOT_ENABLED=false
```

**Efekt**: Bot prestaje generirati AI odgovore. Sve poruke se automatski eskaliraju s porukom:
> "Trenutno nisam dostupan. Vaš upit je proslijeđen našem timu koji će vam se javiti."

**Za ponovno uključivanje**: postavi `BOT_ENABLED=true` i restartaj servis.

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

### Samo integracijski testovi

```bash
npm run test:integration
```

### E2E testovi (zahtijevaju live API-eve)

```bash
npm run test:e2e
```

### Coverage

```bash
npm run test:coverage
```

---

## Troubleshooting

### Bot ne odgovara na email

1. Provjeri Zendesk trigger — URL mora biti `https://tvoj-bot-url.com/api/zendesk/webhook`
2. Provjeri da li webhook ima Bearer token (`ZENDESK_WEBHOOK_TOKEN`)
3. Provjeri da li trigger šalje `latestMessage` polje

### Bot šalje dvostruke odgovore

Bot ima zaštitu od petlje — provjeri da li trigger šalje samo korisnikove poruke, a ne i botove.

### Bot ne zna odgovor iako je u bazi znanja

1. Pokreni ručni sync: `node scripts/sync-vector-knowledge.js --force`
2. Provjeri OneDrive dokumente — možda su zastarjeli

### Metrike se ne spremaju

Tablica `bot_metrics` mora postojati u Supabase. SQL za kreiranje nalazi se u [docs/developer.md](docs/developer.md).

Za detaljno rješavanje problema: vidi [docs/developer.md](docs/developer.md).

---

## Autor

Razvijeno za **Antikvarijat Libar** — Dante d.o.o., Osijek

- **Verzija**: 2.0.0
- **Licenca**: MIT
