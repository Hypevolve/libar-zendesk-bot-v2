# Admin Dashboard Redizajn + Metrike po Kanalima — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redizajnirati admin dashboard u ShadCN stilu (single-file) i dodati metrike razgovora po kanalima (web / email / facebook) iz live brojača + analize ticketa.

**Architecture:** Aditivne backend promjene (live per-channel counteri u `metricsService`, per-channel agregacija u `analyticsStore.getSummary`), instrumentacija dvaju putova u `index.js` uz postojeće `recordDecision` pozive, te potpuni vizualni redizajn `admin-dashboard.html` (vanilla HTML/CSS/JS, bez build koraka).

**Tech Stack:** Node.js (CommonJS), Express, Supabase REST (axios), `node --test`; frontend vanilla HTML/CSS/JS, Lucide inline SVG, Inter font, čisti CSS/SVG grafovi.

## Global Constraints

- **CommonJS** (`require`/`module.exports`), ne ESM.
- Sve promjene backenda su **aditivne i kompatibilne unatrag** — postojeći potrošači (`/admin/metrics`, MCP `get_metrics`, stari dashboard JS, `/admin/analytics/summary`) moraju raditi dalje.
- Komentari i korisnički tekst na **hrvatskom**, prati postojeći stil.
- Testovi su native `node --test` (nema Jest). Svi testovi: `npm test`; unit: `npm run test:unit`.
- **Osjetljivi put:** `index.js` webhook/webchat piše korisnicima uživo — nakon izmjena OBAVEZNO `npm test` + ručna provjera kroz `/run`.
- Kanonski kanali za live brojače: `web`, `email`, `facebook` (iz `aiService.normalizeChannelType`). Za analizu: sirovi Zendesk `via.channel` → bucket `web|email|facebook|ostalo`.
- Bez novih npm ovisnosti, bez CDN-a, bez build koraka.
- Grana: `feat/admin-dashboard-redesign` (već otvorena).

---

### Task 1: `metricsService` — live brojači po kanalu

**Files:**
- Modify: `services/metricsService.js`
- Test: `tests/metricsService.test.js` (Create)

**Interfaces:**
- Produces:
  - `recordChannelOutcome(channel: string, decision: string): void` — normalizira `channel` na `web|email|facebook` (ostalo = no-op); uvijek `requests++`; `decision === "safe_answer"` → `answered++`; `decision === "escalate_no_answer"` → `escalated++`.
  - `getMetrics()` vraća dodatno polje `byChannel: { web:{requests,answered,escalated}, email:{...}, facebook:{...} }`.

- [ ] **Step 1: Write the failing test**

Create `tests/metricsService.test.js`:

```js
/**
 * Test: metricsService per-channel brojači (recordChannelOutcome).
 * Vrti pravi modul; provjerava normalizaciju kanala, mapiranje odluka,
 * i da getMetrics vraća byChannel strukturu.
 */
const test = require("node:test");
const assert = require("node:assert");
const metrics = require("../services/metricsService");

test("recordChannelOutcome: safe_answer inkrementira requests+answered", () => {
  metrics.reset();
  metrics.recordChannelOutcome("web", "safe_answer");
  const m = metrics.getMetrics();
  assert.strictEqual(m.byChannel.web.requests, 1);
  assert.strictEqual(m.byChannel.web.answered, 1);
  assert.strictEqual(m.byChannel.web.escalated, 0);
});

test("recordChannelOutcome: escalate_no_answer inkrementira requests+escalated", () => {
  metrics.reset();
  metrics.recordChannelOutcome("email", "escalate_no_answer");
  const m = metrics.getMetrics();
  assert.strictEqual(m.byChannel.email.requests, 1);
  assert.strictEqual(m.byChannel.email.answered, 0);
  assert.strictEqual(m.byChannel.email.escalated, 1);
});

test("recordChannelOutcome: facebook kanal se broji", () => {
  metrics.reset();
  metrics.recordChannelOutcome("facebook", "safe_answer");
  assert.strictEqual(metrics.getMetrics().byChannel.facebook.requests, 1);
});

test("recordChannelOutcome: nepoznat kanal = no-op (ne baca, ne broji)", () => {
  metrics.reset();
  assert.doesNotThrow(() => metrics.recordChannelOutcome("unknown", "safe_answer"));
  const bc = metrics.getMetrics().byChannel;
  assert.strictEqual(bc.web.requests + bc.email.requests + bc.facebook.requests, 0);
});

test("reset čisti byChannel", () => {
  metrics.recordChannelOutcome("web", "safe_answer");
  metrics.reset();
  assert.strictEqual(metrics.getMetrics().byChannel.web.requests, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/metricsService.test.js`
Expected: FAIL — `metrics.recordChannelOutcome is not a function` / `byChannel` undefined.

- [ ] **Step 3: Implement in `services/metricsService.js`**

3a. Dodaj `byChannel` u `counters` objekt (nakon `latencies: []`, prije `}`):

```js
  latencies: [],
  byChannel: {
    web:      { requests: 0, answered: 0, escalated: 0 },
    email:    { requests: 0, answered: 0, escalated: 0 },
    facebook: { requests: 0, answered: 0, escalated: 0 }
  }
```

3b. Dodaj helper koji vraća svježu praznu strukturu (iznad `counters`, ili odmah ispod requirea):

```js
function emptyByChannel() {
  return {
    web:      { requests: 0, answered: 0, escalated: 0 },
    email:    { requests: 0, answered: 0, escalated: 0 },
    facebook: { requests: 0, answered: 0, escalated: 0 }
  };
}
```
i promijeni inicijalizaciju u `counters` na `byChannel: emptyByChannel()`.

3c. U `hydrateFromSupabase()`, nakon `counters.latencies = ...`, dodaj (spoji perzistirano preko praznog defaulta da nova/nedostajuća polja ne pucaju):

```js
    counters.byChannel = emptyByChannel();
    if (persisted.byChannel && typeof persisted.byChannel === "object") {
      for (const ch of ["web", "email", "facebook"]) {
        const p = persisted.byChannel[ch] || {};
        counters.byChannel[ch] = {
          requests: p.requests || 0,
          answered: p.answered || 0,
          escalated: p.escalated || 0
        };
      }
    }
```

3d. U `serializeCounters()`, dodaj `byChannel` u vraćeni objekt (prije `}`):

```js
    latencies: counters.latencies,
    byChannel: counters.byChannel
```

3e. Dodaj novu funkciju (uz `recordDecision`):

```js
function recordChannelOutcome(channel, decision) {
  const ch = String(channel || "").toLowerCase();
  if (!counters.byChannel[ch]) return;              // web|email|facebook; ostalo = no-op
  counters.byChannel[ch].requests++;
  if (decision === "safe_answer") counters.byChannel[ch].answered++;
  else if (decision === "escalate_no_answer") counters.byChannel[ch].escalated++;
}
```

3f. U `reset()`, dodaj (prije `tokenBudget.resetUsage()`):

```js
  counters.byChannel = emptyByChannel();
```

3g. U `module.exports`, dodaj `recordChannelOutcome`:

```js
module.exports = { increment, recordDecision, recordChannelOutcome, recordLatency, getMetrics, reset };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/metricsService.test.js`
Expected: PASS (svih 5 testova).

- [ ] **Step 5: Commit**

```bash
git add services/metricsService.js tests/metricsService.test.js
git commit -m "feat(metrics): live brojači razgovora po kanalu (web/email/facebook)"
```

---

### Task 2: Instrumentacija `index.js` (webchat + webhook)

**Files:**
- Modify: `index.js` (webchat metrics siteovi: ~260, 282, 315, 331, 500; webhook: ~1113, 1164)

**Interfaces:**
- Consumes: `metricsService.recordChannelOutcome(channel, decision)` iz Taska 1.

**Napomena:** Svaki poziv ide **odmah uz** postojeći `recordDecision(...)`, ne mijenja logiku odluke. Webchat put je uvijek kanal `"web"`; webhook koristi `normalizedChannel` (već u scopeu). Linije su orijentir — traži postojeće `recordDecision` pozive, brojevi se mogu pomaknuti.

- [ ] **Step 1: Webchat — uz svaki `recordDecision("escalate_no_answer")` u `resolveAutomatedOutcome`/`_resolveAutomatedOutcome`**

Na sva 4 mjesta koja glase:
```js
    metricsService.recordDecision("escalate_no_answer");
    metricsService.recordLatency(Date.now() - start);
```
dodaj JEDNU liniju odmah iznad `recordLatency`:
```js
    metricsService.recordDecision("escalate_no_answer");
    metricsService.recordChannelOutcome("web", "escalate_no_answer");
    metricsService.recordLatency(Date.now() - start);
```
(mjesta: bot-disabled escalation, attachment escalation, intent escalation, i wrapper catch na ~260.)

- [ ] **Step 2: Webchat — finalni outcome (~500)**

Nađi:
```js
  metricsService.recordDecision(outcome.type);
  metricsService.recordLatency(Date.now() - start);
```
i umetni između:
```js
  metricsService.recordDecision(outcome.type);
  metricsService.recordChannelOutcome("web", outcome.type);
  metricsService.recordLatency(Date.now() - start);
```

- [ ] **Step 3: Webhook — race-condition escalation (~1113)**

Nađi (unutar `raceCheck.takenOver` grane):
```js
            metricsService.recordDecision("escalate_no_answer");
            metricsService.recordLatency(Date.now() - webhookStart);
```
umetni:
```js
            metricsService.recordDecision("escalate_no_answer");
            metricsService.recordChannelOutcome(normalizedChannel, "escalate_no_answer");
            metricsService.recordLatency(Date.now() - webhookStart);
```

- [ ] **Step 4: Webhook — finalna odluka (~1164)**

Nađi:
```js
      metricsService.recordDecision(safeAnswerSent ? "safe_answer" : "escalate_no_answer");
      metricsService.recordLatency(Date.now() - webhookStart);
```
umetni:
```js
      const webhookDecision = safeAnswerSent ? "safe_answer" : "escalate_no_answer";
      metricsService.recordDecision(webhookDecision);
      metricsService.recordChannelOutcome(normalizedChannel, webhookDecision);
      metricsService.recordLatency(Date.now() - webhookStart);
```

- [ ] **Step 5: Pokreni cijeli test suite (osjetljivi put)**

Run: `npm test`
Expected: PASS (nema regresija; e2e/webhook testovi prolaze kao prije).

- [ ] **Step 6: Ručna provjera kroz `/run`**

Pokreni app lokalno (`npm run dev`), pošalji webchat poruku (`POST /api/chat/start` + `/api/chat/message`), pa provjeri `GET /admin/metrics` (s `x-admin-token`) — `metrics.byChannel.web.requests` je narastao.

- [ ] **Step 7: Commit**

```bash
git add index.js
git commit -m "feat(metrics): bilježi kanal razgovora na webchat i webhook putu"
```

---

### Task 3: `analyticsStore.getSummary` — agregacija po kanalu

**Files:**
- Modify: `services/analyticsStore.js`
- Test: `tests/analyticsStore.test.js` (Modify — dodati testove; koristi `_setTestClient`)

**Interfaces:**
- Produces: `getSummary()` vraća dodatno:
  - `byChannel: { web, email, facebook, ostalo }` (brojevi ticketa)
  - `byChannelQuality: { web:{good,partial,bad,na}, email:{...}, facebook:{...} }`
- Interni helper: `channelBuckets()` → mapa `bucket → [via vrijednosti]`.

- [ ] **Step 1: Pogledaj postojeći test obrazac**

Read: `tests/analyticsStore.test.js` — vidi kako se koristi `analyticsStore._setTestClient(mock)` (mock ima `.get(url)` koji vraća `{ data, headers }`). Novi testovi prate isti obrazac.

- [ ] **Step 2: Write the failing test**

U `tests/analyticsStore.test.js` dodaj (prilagodi importe ako test već ima helpere):

```js
test("getSummary vraća byChannel bucket-e iz Zendesk via.channel", async () => {
  // countWhere gleda content-range header: "0-0/<N>". Vraćamo N po filteru.
  const counts = {
    "": 10,
    "&is_kb_gap=eq.true": 2,
    "&handled_by=eq.bot": 6, "&handled_by=eq.human": 3, "&handled_by=eq.mixed": 1,
    "&bot_quality=eq.good": 5, "&bot_quality=eq.partial": 2, "&bot_quality=eq.bad": 1, "&bot_quality=eq.na": 2,
    // channel bucketi
    "&channel=in.(email)": 4,
    "&channel=in.(facebook,messenger,facebook_page,facebook_post)": 1,
    "&channel=in.(web,web_widget,web_service,chat,messaging,api)": 5,
  };
  analyticsStore._setTestClient({
    get: async (url) => {
      const qs = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
      // izvuci filter dio nakon select=ticket_id
      const filter = qs.replace(/^select=ticket_id/, "").replace(/&order=[^&]*/,"");
      const n = counts[filter] ?? 0;
      return { data: [], headers: { "content-range": `0-0/${n}` } };
    }
  });
  const s = await analyticsStore.getSummary();
  assert.strictEqual(s.byChannel.email, 4);
  assert.strictEqual(s.byChannel.facebook, 1);
  assert.strictEqual(s.byChannel.web, 5);
  analyticsStore._setTestClient(null);
});
```

> Napomena implementatoru: uskladi točan oblik `filter` stringa s onim što `countWhere` gradi (`/rest/v1/ticket_analysis?select=ticket_id${filterQS}`). Ako se mock ne poklopi, ispiši `url` u mocku i prilagodi parsiranje — cilj je da svaki `countWhere(filterQS)` vrati odgovarajući broj.

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test tests/analyticsStore.test.js`
Expected: FAIL — `s.byChannel` undefined.

- [ ] **Step 4: Implement u `services/analyticsStore.js`**

4a. Dodaj helper (iznad `getSummary`):

```js
// Zendesk via.channel je heterogen (email, facebook, web, api, web_service, chat…).
// Mapiramo sirove vrijednosti u 3 prikazna kanala + "ostalo".
// VAŽNO: provjeri stvarne vrijednosti u bazi (SELECT DISTINCT channel) i doradi.
function channelBuckets() {
  return {
    email: ["email"],
    facebook: ["facebook", "messenger", "facebook_page", "facebook_post"],
    web: ["web", "web_widget", "web_service", "chat", "messaging", "api"]
  };
}
```

4b. U `getSummary()`, prije `return`, dodaj agregaciju:

```js
  const buckets = channelBuckets();
  const byChannel = { web: 0, email: 0, facebook: 0, ostalo: 0 };
  const byChannelQuality = {};
  const knownVia = [];
  for (const [bucket, vias] of Object.entries(buckets)) {
    knownVia.push(...vias);
    byChannel[bucket] = await countWhere(`&channel=in.(${vias.join(",")})`);
    byChannelQuality[bucket] = {};
    for (const q of ["good", "partial", "bad", "na"]) {
      byChannelQuality[bucket][q] =
        await countWhere(`&channel=in.(${vias.join(",")})&bot_quality=eq.${q}`);
    }
  }
  byChannel.ostalo = Math.max(0, total - byChannel.web - byChannel.email - byChannel.facebook);
```

4c. Dodaj `byChannel` i `byChannelQuality` u vraćeni objekt:

```js
  return { total, kbGaps, byHandledBy, byQuality, byChannel, byChannelQuality };
```

4d. U `isConfigured() === false` grani (rano vraćanje), dodaj prazne strukture:

```js
  if (!isConfigured()) return {
    total: 0, kbGaps: 0, byHandledBy: {}, byQuality: {},
    byChannel: { web: 0, email: 0, facebook: 0, ostalo: 0 }, byChannelQuality: {}
  };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tests/analyticsStore.test.js`
Expected: PASS (novi + postojeći testovi).

- [ ] **Step 6: Commit**

```bash
git add services/analyticsStore.js tests/analyticsStore.test.js
git commit -m "feat(analytics): agregacija razgovora po kanalu u getSummary"
```

---

### Task 4: Frontend redizajn — `admin-dashboard.html` (ShadCN stil, kanali, light/dark)

**Files:**
- Modify (rewrite): `admin-dashboard.html`

**Interfaces:**
- Consumes: `GET /admin/metrics` → `metrics.byChannel` (Task 1/2); `GET /admin/analytics/summary` → `summary.byChannel`, `summary.byChannelQuality` (Task 3); `GET /admin/analytics/conversations` → `channel` po retku (postoji).

**Pristup:** Zadrži SVU postojeću JS logiku i funkcije (`api`, `loadAll`, `renderMetrics`, `renderBot`, `toggleBot`, `triggerSync`, `analyzeTickets`, `loadAnalytics`, `renderConversations`, polling, scroll-spy, mobilni sidebar, `esc`, a11y). Radi se o **restilizaciji + dodavanju kanala**, ne o rušenju logike. Ovo je najveća jedinica; testira se ručno kroz `/run` (nema test harnessa za statički HTML).

- [ ] **Step 1: Design tokeni + tema (CSS)**

Zamijeni `:root` blok ShadCN token sustavom + dark override. Zadrži brand narančastu kao `--primary`. Primjer (uskladi ostatak CSS-a da koristi ove varijable):

```css
:root {
  --background:#FAFAFA; --foreground:#0A0A0A;
  --card:#FFFFFF; --card-foreground:#0A0A0A;
  --muted:#F4F4F5; --muted-foreground:#71717A;
  --border:#E4E4E7; --input:#E4E4E7; --ring:#E85D04;
  --primary:#E85D04; --primary-foreground:#FFFFFF;
  --green:#16A34A; --red:#DC2626; --amber:#D97706; --indigo:#4F46E5;
  --radius:0.65rem; --sidebar:#0A0A0B; --sidebar-foreground:#A1A1AA;
  --shadow:0 1px 2px rgba(0,0,0,.04),0 1px 3px rgba(0,0,0,.06);
}
:root[data-theme="dark"] {
  --background:#09090B; --foreground:#FAFAFA;
  --card:#131316; --card-foreground:#FAFAFA;
  --muted:#1C1C1F; --muted-foreground:#A1A1AA;
  --border:#27272A; --input:#27272A;
  --sidebar:#050506; --sidebar-foreground:#A1A1AA;
  --shadow:0 1px 2px rgba(0,0,0,.3);
}
```

Zamijeni font na Inter u `<head>`:
```html
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">
```
i `body { font-family:'Inter',system-ui,sans-serif; background:var(--background); color:var(--foreground); }`.

- [ ] **Step 2: Theme toggle (JS + markup)**

U topbar (`.topbar-right`, prije Osvježi gumba) dodaj:
```html
<button class="tb-btn" id="theme-toggle" onclick="toggleTheme()" aria-label="Promijeni temu">
  <svg id="theme-icon" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
</button>
```

Dodaj JS (i pozovi `initTheme()` na vrhu skripte, prije prvog paint-a — stavi inline `<script>` u `<head>` ili na sam početak body skripte):
```js
function applyTheme(t){document.documentElement.setAttribute('data-theme',t);
  const dark=t==='dark';
  document.getElementById('theme-icon')?.setAttribute('style',dark?'':'');
}
function initTheme(){
  const saved=localStorage.getItem('libar_admin_theme');
  const t=saved||(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
  document.documentElement.setAttribute('data-theme',t);
}
function toggleTheme(){
  const cur=document.documentElement.getAttribute('data-theme')==='dark'?'dark':'light';
  const next=cur==='dark'?'light':'dark';
  localStorage.setItem('libar_admin_theme',next);
  document.documentElement.setAttribute('data-theme',next);
}
initTheme();
```
(Da nema flash-a, dodaj mali inline `<script>initTheme?.()</script>` odmah nakon `<body>` ILI postavi `data-theme` inline skriptom u `<head>` prije CSS-a — vidi ShadCN no-flash obrazac.)

- [ ] **Step 3: Sekcija „Kanali" (markup + render)**

Dodaj novu sekciju odmah ispod KPI grida (nakon `#sec-metrics`), s id `sec-channels` i nav stavkom u sidebaru („Kanali"):

```html
<div class="row c3" id="sec-channels" role="region" aria-label="Metrike po kanalima">
  <div class="card ch-card" data-ch="web">
    <div class="card-hd"><div><div class="card-title">🌐 Web chat</div><div class="card-sub">Widget na stranici</div></div></div>
    <div class="kpi-val" id="ch-web-req">—</div>
    <div class="bd-meta"><span class="bd-label">Odgovoreno</span><span class="bd-val" id="ch-web-ans">—</span></div>
    <div class="bar-track"><div class="bar-fill g" id="ch-web-bar"></div></div>
    <div class="msc-detail" id="ch-web-esc">—</div>
  </div>
  <div class="card ch-card" data-ch="email"> … isti obrazac, id-evi ch-email-* … </div>
  <div class="card ch-card" data-ch="facebook"> … ch-facebook-* … </div>
</div>
```

Dodaj render funkciju i pozovi je iz `renderMetrics(m)` (na kraju), hraneći iz `m.byChannel`:
```js
function renderChannels(byChannel){
  const chans=[['web','ch-web'],['email','ch-email'],['facebook','ch-facebook']];
  for(const [key,pfx] of chans){
    const c=(byChannel&&byChannel[key])||{requests:0,answered:0,escalated:0};
    const req=c.requests||0;
    $(`${pfx}-req`).textContent=fmt(req);
    const ansPct=req?((c.answered/req)*100).toFixed(0):0;
    $(`${pfx}-ans`).textContent=`${fmt(c.answered||0)} (${ansPct}%)`;
    $(`${pfx}-bar`).style.transform=`scaleX(${req?c.answered/req:0})`;
    $(`${pfx}-esc`).textContent=`Eskalirano: ${fmt(c.escalated||0)}`;
  }
}
```
U `renderMetrics`, na kraju dodaj: `renderChannels(m.byChannel);`

- [ ] **Step 4: Kvaliteta po kanalu iz analize (opcionalno u istoj sekciji)**

U `renderAnalytics(summary, …)` dodaj korištenje `summary.byChannel`/`summary.byChannelQuality` za mali „kvaliteta po kanalu" prikaz (npr. good/partial/bad stacked bar po kanalu). Ako polja nema (stari backend), preskoči tiho:
```js
if (summary && summary.byChannelQuality) { /* renderaj stacked barove po kanalu */ }
```

- [ ] **Step 5: Badge kanala u tablici razgovora**

U `renderConversations(rows)` dodaj stupac/badge kanala iz `c.channel`. Mapa prikaza:
```js
function channelBadge(ch){
  const v=String(ch||'').toLowerCase();
  if(['email','mail'].includes(v)) return '<span class="badge other">✉️ Email</span>';
  if(['facebook','messenger'].includes(v)||v.startsWith('facebook')) return '<span class="badge other">💬 Facebook</span>';
  if(['web','web_widget','chat','messaging','api','web_service'].includes(v)) return '<span class="badge answered">🌐 Web</span>';
  return `<span class="badge other">${esc(ch||'—')}</span>`;
}
```
Dodaj `<th>Kanal</th>` u thead i `<td>${channelBadge(c.channel)}</td>` u red (uskladi `colspan` u empty-row na novi broj stupaca).

- [ ] **Step 6: Restiliziraj preostale sekcije**

Prođi kroz `.kpi`, `.card`, `.msc`, `.badge`, `table`, `.bot-box`, `.sync-btn`, login, toast, sidebar — zamijeni hardkodirane boje (`--surface`, `--bg`, `--text*`) referencama na nove tokene (`--card`, `--background`, `--foreground`, `--muted-foreground`, `--border`). Provjeri da SVE radi i u dark temi (badge, toast, login card).

- [ ] **Step 7: Ručna provjera kroz `/run`**

Pokreni app (`npm run dev`), otvori `/admin/dashboard`, prijavi se admin tokenom. Provjeri:
- KPI + sekcija Kanali se renderaju (web/email/facebook brojevi iz `/admin/metrics`).
- Theme toggle mijenja light/dark bez flash-a i preživi refresh.
- Tablica razgovora ima badge kanala.
- Responsive: mobilni sidebar (off-canvas) radi; grid se slaže na < 1024px i < 480px.
- Polling, „Osvježi", „Sinkroniziraj", „Analiziraj tickete", bot toggle rade kao prije.
- Nema JS grešaka u konzoli.

- [ ] **Step 8: Commit**

```bash
git add admin-dashboard.html
git commit -m "feat(dashboard): ShadCN redizajn + sekcija kanala + light/dark"
```

---

### Task 5: Dokumentacija + finalna provjera

**Files:**
- Modify: `docs/developer.md` ili `docs/analytics.md` (kratka bilješka o `byChannel` metrikama i sekciji kanala)

- [ ] **Step 1: Dopuni dokumentaciju**

Dodaj u relevantni doc (npr. `docs/analytics.md`) kratku sekciju: „Metrike po kanalima" — objašnjenje `metrics.byChannel` (live) i `summary.byChannel` (analiza), te nesklad vokabulara (live normaliziran vs. Zendesk `via.channel`).

- [ ] **Step 2: Puni test suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add docs/
git commit -m "docs: metrike po kanalima u dashboardu i analitici"
```

---

## Self-Review (popunjeno tijekom pisanja)

- **Spec coverage:** metricsService byChannel (T1) ✓ · index.js instrumentacija (T2) ✓ · analyticsStore byChannel+quality (T3) ✓ · frontend redizajn/kanali/tema/badge (T4) ✓ · čisti CSS/SVG (T4) ✓ · testovi (T1,T3,T5) ✓ · aditivni endpointi (T1,T3 — bez novih ruta) ✓ · dokumentacija (T5) ✓.
- **Placeholder scan:** frontend markup za email/facebook kartice ponavlja isti obrazac kao web (Step 3) — implementator kopira uz zamjenu prefiksa; grafovi kvalitete (Step 4) su opcionalni i tiho preskaču ako polja nema.
- **Type consistency:** `recordChannelOutcome(channel, decision)` — isti potpis u T1 (def), T2 (poziv). `byChannel` oblik `{requests,answered,escalated}` isti u T1 i T4 renderu. `summary.byChannel`/`byChannelQuality` isti u T3 i T4.
