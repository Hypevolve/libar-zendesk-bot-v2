/**
 * Test: javni kod ide pregledniku bez komentara i bez source mapa
 * (services/publicAssets.js, pravilo "Javni kod" u CLAUDE.md).
 *   - minifyHtml: HTML komentari van, inline <script>/<style> minificirani,
 *     <textarea> doslovno, globalne funkcije (onclick) zadržavaju ime
 *   - servirani /embed.js, /, /index.html, /admin/dashboard i svaka datoteka iz
 *     public/: bez "<!--", bez sourceMappingURL, JS bez ijednog komentara (acorn)
 * Mreža se ne dira; Zendesk i LLM se ne zovu.
 */
process.env.PORT = "0";

const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const acorn = require("acorn");

const { minifyHtml, minifyJs } = require("../services/publicAssets");

function jsComments(code) {
  const comments = [];
  acorn.parse(code, { ecmaVersion: "latest", sourceType: "script", onComment: comments });
  return comments;
}

// CSS nema // komentare; /* izvan stringova je komentar.
function cssHasComment(css) {
  return css.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, "").includes("/*");
}

function inlineBlocks(html, name) {
  const re = new RegExp(`<${name}\\b([^>]*)>([\\s\\S]*?)</${name}\\s*>`, "gi");
  return [...html.matchAll(re)].map((m) => ({ attrs: m[1], body: m[2] }));
}

function assertCleanHtml(html, label) {
  assert.ok(!html.includes("<!--"), `${label}: HTML komentar u izlazu`);
  assert.ok(!/sourceMappingURL/.test(html), `${label}: sourceMappingURL u izlazu`);
  for (const { body } of inlineBlocks(html, "script")) {
    if (body.trim()) assert.deepStrictEqual(jsComments(body), [], `${label}: komentar u inline skripti`);
  }
  for (const { body } of inlineBlocks(html, "style")) {
    assert.ok(!cssHasComment(body), `${label}: komentar u inline stilu`);
  }
}

// ─── minifyHtml ────────────────────────────────────────────────

test("minifyHtml: briše HTML komentare i komentare u inline skripti i stilu", () => {
  const src = [
    "<!DOCTYPE html>",
    "<html><head>",
    "<!-- komentar za developere -->",
    "<style>/* boja */ .a { color: red; }\n</style>",
    "</head><body>",
    "  <!-- Floating Action Button -->",
    "  <button onclick=\"navTo(this,'x')\">Klik</button></div><!-- /content -->",
    "<script>",
    "  // Start anonymous session",
    "  function navTo(el, id) { /* blok */ return id; }",
    "  const API = window.location.origin;",
    "</script>",
    "</body></html>"
  ].join("\n");
  const out = minifyHtml(src);
  assertCleanHtml(out, "minifyHtml");
  assert.ok(!out.includes("Floating Action Button"));
  assert.ok(out.includes("function navTo("), "globalna funkcija iz onclick zadržava ime");
  assert.ok(out.includes("const API="), "globalna varijabla zadržava ime");
  assert.ok(out.includes(`<button onclick="navTo(this,'x')">Klik</button></div>`));
  assert.ok(!/\n[ \t]*\n/.test(out), "komentar sam u retku ne ostavlja prazan redak");
});

test("minifyHtml: <textarea> i atributi ostaju doslovno", () => {
  const src = `<textarea placeholder="a > b">ne <!-- dirati --></textarea><p title="x <!-- y">t</p>`;
  assert.strictEqual(minifyHtml(src), src);
});

test("minifyHtml: JSON skripta se sažme, nepoznat type skripte se odbija", () => {
  assert.strictEqual(
    minifyHtml(`<script type="application/ld+json">{ "a": 1 }</script>`),
    `<script type="application/ld+json">{"a":1}</script>`
  );
  assert.throws(() => minifyHtml(`<script type="text/template"><!-- x --></script>`), /nije podržan/);
});

test("minifyHtml: HTML komentar u JS stringu i sintaksna greška ruše build", () => {
  assert.throws(() => minifyHtml(`<script>el.innerHTML = "<!-- interno -->";</script>`), /<!--/);
  assert.throws(() => minifyHtml(`<script>function (</script>`));
  assert.throws(() => minifyHtml(`<p><!-- nezatvoren`), /nezatvoren/);
});

test("minifyJs: bez komentara (i legal /*! */) i bez source mape", () => {
  const out = minifyJs("/*! licenca */\n// a\nvar x = 1; /* b */\n//# sourceMappingURL=x.js.map\n");
  assert.deepStrictEqual(jsComments(out), []);
  assert.ok(!out.includes("sourceMappingURL"));
});

// ─── Servirani odgovori ────────────────────────────────────────

const app = require("../index");

let server, port;
test.before(async () => {
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  port = server.address().port;
});
// index.js pokreće vlastiti server i periodične sync timere — proces se gasi eksplicitno.
test.after(() => { server.close(); setImmediate(() => process.exit(0)); });

function get(urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: urlPath, headers }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { text += c; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text }));
    }).on("error", reject);
  });
}

test("/embed.js: minificiran, bez komentara, radi isto (BOT_URL iz src-a)", async () => {
  const res = await get("/embed.js");
  assert.strictEqual(res.status, 200);
  assert.match(res.headers["content-type"], /javascript/);
  assert.deepStrictEqual(jsComments(res.text), []);
  assert.ok(!/sourceMappingURL/.test(res.text));
  assert.ok(res.text.includes("/embed.js") && res.text.includes("libar-chat-fab"));
  const src = fs.readFileSync(path.join(__dirname, "..", "public", "embed.js"), "utf8");
  assert.ok(res.text.length < src.length);
});

test("stranica widgeta (/ i /index.html) i /admin/dashboard: bez komentara", async () => {
  for (const urlPath of ["/", "/index.html", "/admin/dashboard"]) {
    const res = await get(urlPath);
    assert.strictEqual(res.status, 200, urlPath);
    assert.match(res.headers["content-type"], /text\/html/, urlPath);
    assertCleanHtml(res.text, urlPath);
    assert.ok(inlineBlocks(res.text, "script").length > 0, `${urlPath}: inline skripte su tu`);
  }
  const dash = await get("/admin/dashboard");
  assert.ok(dash.text.includes("function navTo("), "onclick handleri dashboarda i dalje imaju funkciju");
});

test("svaka datoteka iz public/ se servira očišćena, ETag i 304 rade", async () => {
  const dir = path.join(__dirname, "..", "public");
  for (const name of fs.readdirSync(dir)) {
    const res = await get(`/${name}`);
    assert.strictEqual(res.status, 200, name);
    if (name.endsWith(".js")) assert.deepStrictEqual(jsComments(res.text), [], name);
    if (name.endsWith(".css")) assert.ok(!cssHasComment(res.text), name);
    if (name.endsWith(".html")) assertCleanHtml(res.text, name);
    assert.ok(res.headers.etag, `${name}: ETag`);
    const again = await get(`/${name}`, { "If-None-Match": res.headers.etag });
    assert.strictEqual(again.status, 304, `${name}: 304`);
  }
});
