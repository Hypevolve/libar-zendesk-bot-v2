# CLAUDE.md — Libar Asistent (Zendesk AI bot)

Operativni vodič za rad na ovom projektu u Claude Codeu. Kratko i praktično; dublja dokumentacija je linkana.

## Što je ovo
Enterprise AI chatbot za korisničku podršku Antikvarijata Libar. Express (Node, CommonJS) backend koji spaja **Zendesk** (ticketing), **OneDrive/SharePoint** + **Supabase pgvector** (RAG baza znanja) i **OpenRouter** (LLM + embeddings). Kanali: web chat widget, email, Facebook Messenger.

- Indeks dokumentacije → [docs/README.md](docs/README.md)
- Detaljna arhitektura i podatkovni tok → [docs/developer.md](docs/developer.md)
- Funkcionalni pregled za korisnika → [docs/user-guide.md](docs/user-guide.md)
- Općeniti pregled + deploy → [README.md](README.md)
- Production readiness analiza → [docs/production-readiness.md](docs/production-readiness.md)
- Odluke i njihovo "zašto" → [docs/decisions/](docs/decisions/)

## Pokretanje
```bash
npm run dev        # lokalno s --watch
npm start          # produkcija (node index.js)
npm test           # svi testovi (node --test)
npm run test:unit  # samo unit
npm run sync:vector # ručna sinkronizacija vektorske baze znanja
```
Treba `.env` (vidi [.env.example](.env.example)). Deploy ide na **Render** preko [render.yaml](render.yaml).

## Mapa koda
- [index.js](index.js) — Express server, svi API endpointi, orkestracija (velik, ~jedan fajl)
- [services/](services/) — sva poslovna logika, jedan servis = jedna odgovornost:
  - `aiService` LLM pozivi · `zendeskService` tiketi · `vectorKnowledgeService` + `embeddingService` RAG · `oneDriveService` izvor znanja · `conversationService` memorija razgovora
  - `piiService` maskiranje osobnih podataka · `spamFilterService` · `intentEscalationService` eskalacija · `outputValidator` · `responseCacheService` · `tokenBudgetService` · `metricsService`/`supabaseMetricsService` · `botStateService` (kill switch)
- [middleware/](middleware/) — `inputSanitizer`, `rateLimiter`
- [config/](config/) — `env.js` (centralna konfiguracija), `logger.js`
- [scripts/](scripts/) — sync baze znanja, generiranje testova iz Zendeska
- [migrations/](migrations/) — `hybrid_search.sql` (Supabase)
- [public/](public/) — `embed.js` widget, `index.html`
- `admin-dashboard.html` — admin panel (razgovori, metrike, status bota)

## Konvencije
- **CommonJS** (`require`/`module.exports`), ne ESM.
- Sva konfiguracija ide kroz `config/env.js` i env varijable — ne hardkodiraj vrijednosti.
- Komentari i korisnički tekst su na **hrvatskom**; prati postojeći stil.
- Testovi su native `node --test` (nema Jest); novi servis → novi `tests/<ime>.test.js`.
- Tajne nikad ne idu u repo. `.env` je gitignoran; primjeri u `.env.example`.

## Radne smjernice za ovaj projekt
- **Klijent je zadovoljan botom.** Ne radi špekulativna "poboljšanja" — popravljaj samo prijavljene probleme i ono što je eksplicitno traženo. (vidi memory: conservative-changes)
- Promjene na PII, spam filteru, escalation logici i prompt-injection zaštiti su osjetljive — uz njih uvijek pokreni relevantne testove.
- Bot piše korisnicima uživo: prije zahvata u prompt/odgovore provjeri `outputValidator` i postojeće testove.

## Korisni linkovi (popuniti)
- Render dashboard: <!-- URL -->
- Supabase projekt: <!-- URL -->
- Zendesk admin: <!-- URL -->
