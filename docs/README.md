# Dokumentacija — Libar Asistent

Indeks svih dokumenata. Za brzi operativni pregled vidi [CLAUDE.md](../CLAUDE.md) u rootu.

| Dokument | Sadržaj |
|----------|---------|
| [../README.md](../README.md) | Pregled projekta, značajke, instalacija, deploy |
| [developer.md](developer.md) | Arhitektura, podatkovni tok, servisi, API endpointi, troubleshooting |
| [user-guide.md](user-guide.md) | Funkcionalni vodič za krajnjeg korisnika / admina |
| [production-readiness.md](production-readiness.md) | Analiza spremnosti za produkciju |
| [decisions/](decisions/) | Arhitekturne odluke (ADR) — *što* je odlučeno i *zašto* |

## Kako održavati
- Tehnička promjena koja mijenja arhitekturu → ažuriraj `developer.md`.
- Veća odluka (alat, pristup, trade-off) → novi ADR u `decisions/` (vidi [decisions/README.md](decisions/README.md)).
- Promjena ponašanja prema korisniku → `user-guide.md`.
