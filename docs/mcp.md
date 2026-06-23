# MCP integracija (Claude app + Claude Code)

Bot izlaže **MCP endpoint** na `POST /mcp` (Streamable HTTP, stateless) preko kojeg
Claude može prirodnim jezikom tražiti žive stats, reporte i kontrolirati bota.

Implementacija: [mcp/server.js](../mcp/server.js), montirano u [index.js](../index.js).
Svaki tool samo delegira na postojeći servis - nema duplikata logike.

## Toolovi

| Tool | Tip | Što radi |
|------|-----|----------|
| `get_metrics` | read | Runtime brojači: volumen, odluke, eskalacije, latencija (avg/p95), tokeni, cache |
| `get_traces` | read | Zadnjih N AI traceova + agregirana statistika |
| `get_bot_state` | read | Je li bot upaljen ili pauziran |
| `set_bot_state` | control | Upali/ugasi bota (kill switch) bez redeploya |
| `sync_vector` | control | Ručno pokreni sync knowledge baze iz OneDrivea |
| `weekly_report` | report | Sažetak: volumen, eskalacije, odluke, latencija, trošak, top pitanja |
| `top_questions` | report | Najčešća pitanja iz zadnjih do 200 traceova |
| `cost_breakdown` | report | Procijenjeni trošak LLM-a u USD (cijene zrcale admin dashboard) |

> Napomena o povijesti: `weekly_report`/`top_questions` rade nad in-memory trace
> bufferom (do 200 zadnjih interakcija) + kumulativnim brojačima od zadnjeg
> deploya. Pravu povijest po danima dodaje budući dnevni snapshot u Supabase.

## Sigurnost

- Auth: `Authorization: Bearer <MCP_TOKEN>` (ili header `x-mcp-token`).
- `MCP_TOKEN` je **odvojen** od `ADMIN_TOKEN`. Ako nije postavljen, `/mcp` vraća 503
  i toolovi se nikad ne izlažu.
- Kontrolne akcije (`set_bot_state`, `sync_vector`) se logiraju.

## Postavljanje (Render)

1. U Render dashboardu → Environment dodaj `MCP_TOKEN` (vrijednost je u `.env.render`,
   ili generiraj novu: `openssl rand -hex 32`).
2. Redeploy.

## Spajanje

**Claude Code:**
```bash
claude mcp add --transport http libar-bot https://<render-url>/mcp \
  --header "Authorization: Bearer <MCP_TOKEN>"
```

**Claude app (claude.ai / desktop):**
Settings → Connectors → Add custom connector → URL `https://<render-url>/mcp`,
dodaj Authorization header s Bearer tokenom.

Nakon spajanja možeš pitati npr.: *"Daj mi weekly report za Libar bota"*,
*"Koliko je bot potrošio na tokene?"*, *"Pauziraj bota"*.

## Lokalni test

```bash
npm test                       # uključuje tests/mcp.test.js
MCP_TOKEN=test npm start        # pa gađaj http://localhost:3000/mcp
```
