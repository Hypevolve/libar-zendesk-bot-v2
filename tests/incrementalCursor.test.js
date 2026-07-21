/**
 * Test: cursor semantika u listTicketsSince (Zendesk Incremental Export).
 *
 * Regresija koju ovo čuva: kad se maxTickets dosegne usred stranice (Zendesk
 * vraća do 1000 ticketa po stranici), cursor se smije pomaknuti SAMO do zadnjeg
 * stvarno preuzetog ticketa. Prije se postavljao na end_time cijele stranice,
 * pa su svi neobrađeni ticketi s te stranice trajno ispadali iz analize —
 * zbog toga je admin dashboard pokazivao puno manje ticketa nego Zendesk.
 *
 * Mrežu injektiramo (opts.client), pa test ne dira ni Zendesk ni OpenRouter.
 */
process.env.ZENDESK_SUBDOMAIN = process.env.ZENDESK_SUBDOMAIN || "libar-test";
process.env.ZENDESK_EMAIL = process.env.ZENDESK_EMAIL || "agent@libar.test";
process.env.ZENDESK_API_TOKEN = process.env.ZENDESK_API_TOKEN || "test-token";

const test = require("node:test");
const assert = require("node:assert");
const { listTicketsSince } = require("../services/zendeskService");

const HOUR = 3600;
const BASE = Math.floor(Date.parse("2026-06-01T00:00:00Z") / 1000);

// Sintetička stranica: n ticketa, updated_at raste po satu od BASE + offset.
function makePage(n, { startIndex = 0, count = null, nextPage = null } = {}) {
  const tickets = Array.from({ length: n }, (_, i) => {
    const idx = startIndex + i;
    return {
      id: 1000 + idx,
      subject: `Ticket ${idx}`,
      status: "solved",
      via: { channel: "email" },
      created_at: new Date((BASE + idx * HOUR) * 1000).toISOString(),
      updated_at: new Date((BASE + idx * HOUR) * 1000).toISOString(),
      requester_id: 500 + idx,
      tags: []
    };
  });
  const last = tickets[tickets.length - 1];
  return {
    tickets,
    count: count === null ? n : count,
    end_time: Math.floor(Date.parse(last.updated_at) / 1000),
    next_page: nextPage
  };
}

// Minimalni axios-like klijent koji servira unaprijed pripremljene stranice.
function mockClient(pages) {
  const calls = [];
  let i = 0;
  return {
    calls,
    get: async (url, opts) => {
      calls.push(url);
      calls.lastOpts = opts;
      const page = pages[i++];
      if (!page) throw new Error(`Nema pripremljene stranice za: ${url}`);
      return { data: page };
    }
  };
}

const unix = (iso) => Math.floor(Date.parse(iso) / 1000);

test("cursor staje na zadnjem preuzetom ticketu kad se maxTickets dosegne usred stranice", async () => {
  // Stranica ima 1000 ticketa, mi smijemo uzeti 40.
  const page = makePage(1000, { count: 1000, nextPage: "/api/v2/incremental/tickets.json?start_time=999" });
  const client = mockClient([page]);

  const { tickets, nextCursorISO } = await listTicketsSince(
    "2026-05-31T00:00:00Z",
    { maxTickets: 40, client }
  );

  assert.strictEqual(tickets.length, 40);
  // Cursor = updated_at 40. ticketa (index 39), NE end_time cijele stranice.
  assert.strictEqual(unix(nextCursorISO), BASE + 39 * HOUR);
  assert.notStrictEqual(unix(nextCursorISO), page.end_time);
  // Ne smije tražiti sljedeću stranicu kad je kvota potrošena.
  assert.strictEqual(client.calls.length, 1);
});

test("sljedeći run nastavlja od zadnjeg preuzetog ticketa i pokupi ostatak", async () => {
  const first = makePage(1000, { count: 1000, nextPage: "/next" });
  const firstRun = await listTicketsSince("2026-05-31T00:00:00Z", {
    maxTickets: 40, client: mockClient([first])
  });

  // Drugi run: Zendesk vraća ostatak počevši od cursora (ticket index 39 nadalje).
  const second = makePage(40, { startIndex: 39, count: 40 });
  const secondRun = await listTicketsSince(firstRun.nextCursorISO, {
    maxTickets: 40, client: mockClient([second])
  });

  const firstIds = firstRun.tickets.map((t) => t.id);
  const secondIds = secondRun.tickets.map((t) => t.id);
  // Preklapanje je samo granični ticket (start_time je inkluzivan) — upsert ga
  // pregazi. Bitno je da nema RUPE: id-evi se nastavljaju bez preskoka.
  assert.strictEqual(secondIds[0], firstIds[firstIds.length - 1]);
  assert.strictEqual(secondIds[1], firstIds[firstIds.length - 1] + 1);
});

test("cursor ide na end_time kad je cijela stranica obrađena", async () => {
  const page = makePage(120, { count: 120 });
  const { tickets, nextCursorISO } = await listTicketsSince(
    "2026-05-31T00:00:00Z",
    { maxTickets: 150, client: mockClient([page]) }
  );

  assert.strictEqual(tickets.length, 120);
  assert.strictEqual(unix(nextCursorISO), page.end_time);
});

test("paginira dok stream nije gotov (count >= 1000)", async () => {
  const p1 = makePage(1000, { count: 1000, nextPage: "/page2" });
  const p2 = makePage(30, { startIndex: 1000, count: 30 });
  const client = mockClient([p1, p2]);

  const { tickets, nextCursorISO } = await listTicketsSince(
    "2026-05-31T00:00:00Z",
    { maxTickets: 5000, client }
  );

  assert.strictEqual(tickets.length, 1030);
  assert.strictEqual(client.calls.length, 2);
  assert.strictEqual(unix(nextCursorISO), p2.end_time);
});

test("cursor napreduje i kad svi preuzeti ticketi dijele istu sekundu (bez deadlocka)", async () => {
  // Patološki slučaj: 40 ticketa s identičnim updated_at == start_time.
  // Da cursor ostane na istoj vrijednosti, sync bi zauvijek vrtio isti blok.
  const sameIso = "2026-06-01T00:00:00Z";
  const tickets = Array.from({ length: 1000 }, (_, i) => ({
    id: 2000 + i, subject: "x", status: "open", via: { channel: "email" },
    created_at: sameIso, updated_at: sameIso, requester_id: 1, tags: []
  }));
  const page = { tickets, count: 1000, end_time: unix(sameIso), next_page: "/next" };

  const { nextCursorISO } = await listTicketsSince(sameIso, {
    maxTickets: 40, client: mockClient([page])
  });

  assert.ok(unix(nextCursorISO) > unix(sameIso), "cursor mora napredovati barem 1s");
});

test("incremental poziv ima veći timeout od standardnog klijenta", async () => {
  // Stranica od 1000 ticketa ne stigne u klijentovih 15 s — backfill je zbog
  // toga padao s "listTicketsSince failed" na gustoj povijesti.
  const client = mockClient([makePage(10, { count: 10 })]);
  await listTicketsSince("2026-05-31T00:00:00Z", { maxTickets: 10, client });

  assert.ok(client.calls.lastOpts?.timeout >= 60000, "timeout mora biti barem 60 s");
});

test("ticket bez updated_at ne ruši cursor unatrag", async () => {
  const tickets = Array.from({ length: 1000 }, (_, i) => ({
    id: 3000 + i, subject: "x", status: "open", via: { channel: "email" },
    created_at: "2026-06-01T00:00:00Z", requester_id: 1, tags: []
  }));
  const page = { tickets, count: 1000, end_time: BASE + 5 * HOUR, next_page: "/next" };

  const { nextCursorISO } = await listTicketsSince("2026-05-31T00:00:00Z", {
    maxTickets: 10, client: mockClient([page])
  });

  // Nema pouzdanog updated_at → ostajemo na polaznom cursoru (radije ponovi
  // nego preskoči). Ni u kojem slučaju ne skačemo na end_time stranice.
  assert.strictEqual(unix(nextCursorISO), unix("2026-05-31T00:00:00Z"));
});
