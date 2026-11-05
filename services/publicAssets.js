/**
 * Javni kod bez komentara i bez source mapa.
 *
 * Sve što preglednik posjetitelja dobije (public/embed.js, stranica widgeta,
 * admin dashboard) servira se iz memorije, minificirano pri pokretanju servera.
 * Izvorne datoteke ostaju s komentarima; express.static ih više ne šalje.
 *
 *   .js   → esbuild minify, legalComments "none", bez source mape
 *   .css  → isto
 *   .html → HTML komentari se brišu, sadržaj <script> i <style> ide kroz esbuild,
 *           <textarea> i <title> ostaju doslovno (u njima "<!--" nije komentar)
 *   ostalo (slike i sl.) → bajtovi kako jesu
 *
 * Ako minifikacija ne uspije (sintaksna greška, nepoznat type skripte, HTML
 * komentar u JS stringu), build baca grešku i server se ne pokrene: na Renderu
 * deploy tada padne, a prethodna verzija ostaje živa. Sirovi izvor se nikad ne
 * šalje kao zamjena.
 */
const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");

// Izvori već koriste ?. (ES2020); minifier ne smije uvesti noviju sintaksu od toga.
const JS_TARGET = "es2020";
const BASE = { minify: true, legalComments: "none", sourcemap: false };

const JS_TYPES = new Set(["", "text/javascript", "application/javascript", "module", "text/ecmascript", "application/ecmascript"]);
const JSON_TYPES = new Set(["application/json", "application/ld+json", "importmap"]);
const MINIFIED_EXT = new Set([".js", ".mjs", ".css", ".html", ".htm"]);

function minifyJs(code, label = "inline.js") {
  return esbuild.transformSync(code, { ...BASE, loader: "js", target: JS_TARGET, sourcefile: label }).code.trim();
}

function minifyCss(code, label = "inline.css") {
  return esbuild.transformSync(code, { ...BASE, loader: "css", sourcefile: label }).code.trim();
}

function attr(tag, name) {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3] ?? "").trim().toLowerCase() : null;
}

function inlineScript(tag, content, label) {
  const type = attr(tag, "type") ?? "";
  if (!content.trim()) return "";
  if (JSON_TYPES.has(type)) return JSON.stringify(JSON.parse(content));
  if (!JS_TYPES.has(type)) throw new Error(`${label}: <script type="${type}"> nije podržan, a sadržaj bi otišao javno neočišćen`);
  const code = minifyJs(content, `${label} <script>`);
  // esbuild escapea "</script" u stringovima; "<!--" u stringu bi bio HTML komentar koji ide javno.
  if (/<\/script/i.test(code)) throw new Error(`${label}: "</script" u inline skripti`);
  if (code.includes("<!--")) throw new Error(`${label}: "<!--" u inline skripti (HTML komentar u JS stringu?)`);
  return code;
}

function inlineStyle(tag, content, label) {
  const type = attr(tag, "type") ?? "";
  if (type && type !== "text/css") throw new Error(`${label}: <style type="${type}"> nije podržan`);
  return content.trim() ? minifyCss(content, `${label} <style>`) : "";
}

// Elementi čiji se sadržaj ne parsira kao HTML: do zatvarajućeg taga je sve tekst.
const RAW_TEXT = new Set(["script", "style", "textarea", "title"]);

/**
 * Briše HTML komentare i minificira inline <script>/<style>. Ostali markup
 * (tagovi, atributi, tekst) ostaje kako jest — whitespace se ne dira, pa se
 * prikaz ne može promijeniti.
 */
function minifyHtml(html, label = "page.html") {
  let out = "";
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) { out += html.slice(i); break; }
    out += html.slice(i, lt);

    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      if (end === -1) throw new Error(`${label}: nezatvoren HTML komentar`);
      i = end + 3;
      // Komentar sam u retku: makni i redak, da ne ostane prazan.
      const lineStart = out.lastIndexOf("\n") + 1;
      const rest = /^[ \t]*(\r?\n|$)/.exec(html.slice(i));
      if (/^[ \t]*$/.test(out.slice(lineStart)) && rest) {
        out = out.slice(0, lineStart);
        i += rest[0].length;
      }
      continue;
    }

    const open = /^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(html.slice(lt, lt + 64));
    if (!open) { out += "<"; i = lt + 1; continue; }

    // Kraj otvarajućeg taga, uz poštivanje navodnika u atributima.
    let j = lt + open[0].length;
    let quote = null;
    for (; j < html.length; j++) {
      const c = html[j];
      if (quote) { if (c === quote) quote = null; } else if (c === '"' || c === "'") quote = c; else if (c === ">") break;
    }
    if (j >= html.length) throw new Error(`${label}: nezatvoren tag <${open[1]}`);
    const tag = html.slice(lt, j + 1);
    out += tag;
    i = j + 1;

    const name = open[1].toLowerCase();
    if (!RAW_TEXT.has(name)) continue;
    const close = new RegExp(`</${name}\\s*>`, "ig");
    close.lastIndex = i;
    const m = close.exec(html);
    if (!m) throw new Error(`${label}: nedostaje </${name}>`);
    const content = html.slice(i, m.index);
    if (name === "script") out += inlineScript(tag, content, label);
    else if (name === "style") out += inlineStyle(tag, content, label);
    else out += content;
    out += m[0];
    i = m.index + m[0].length;
  }
  return out;
}

function minifyByExt(text, ext, label) {
  if (ext === ".js" || ext === ".mjs") return minifyJs(text, label);
  if (ext === ".css") return minifyCss(text, label);
  return minifyHtml(text, label);
}

function buildEntry(file, label) {
  const ext = path.extname(file).toLowerCase();
  if (!MINIFIED_EXT.has(ext)) return { ext, body: fs.readFileSync(file) };
  const text = minifyByExt(fs.readFileSync(file, "utf8"), ext, label);
  if (/sourceMappingURL/.test(text)) throw new Error(`${label}: sourceMappingURL u izlazu`);
  if ((ext === ".html" || ext === ".htm") && text.includes("<!--")) throw new Error(`${label}: "<!--" u izlazu`);
  return { ext, body: Buffer.from(text, "utf8") };
}

function listFiles(dir, prefix = "") {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const rel = `${prefix}/${entry.name}`;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(full, rel));
    else if (entry.isFile()) files.push([rel, full]);
  }
  return files;
}

/**
 * @param {object} opts
 * @param {string} opts.publicDir  mapa čije datoteke idu na URL /<putanja>
 * @param {Record<string,string>} [opts.pages]  imenovane stranice izvan publicDir (npr. admin dashboard)
 */
function build({ publicDir, pages = {} }) {
  const files = new Map();
  for (const [urlPath, full] of listFiles(publicDir)) {
    files.set(urlPath, buildEntry(full, path.relative(process.cwd(), full) || full));
  }
  const named = new Map();
  for (const [name, full] of Object.entries(pages)) {
    named.set(name, buildEntry(full, path.relative(process.cwd(), full) || full));
  }
  // esbuild drži pomoćni proces nakon sync poziva; pri pokretanju više ne treba.
  Promise.resolve(esbuild.stop()).catch(() => {});

  function send(res, entry, { cache = true } = {}) {
    res.type(entry.ext);
    if (cache) res.set("Cache-Control", "public, max-age=0");
    return res.send(entry.body);
  }

  return {
    files,
    pages: named,
    /** Pošalji datoteku iz publicDir po URL putanji (npr. "/index.html"). */
    sendFile(res, urlPath) {
      const entry = files.get(urlPath);
      if (!entry) throw new Error(`publicAssets: nema ${urlPath}`);
      return send(res, entry);
    },
    /** Pošalji imenovanu stranicu (opts.pages). */
    sendPage(res, name) {
      const entry = named.get(name);
      if (!entry) throw new Error(`publicAssets: nema stranice ${name}`);
      return send(res, entry, { cache: false });
    },
    /** Zamjena za express.static(publicDir): samo GET/HEAD i samo izgrađene datoteke. */
    middleware(req, res, next) {
      if (req.method !== "GET" && req.method !== "HEAD") return next();
      const entry = files.get(req.path);
      return entry ? send(res, entry) : next();
    }
  };
}

module.exports = { build, minifyHtml, minifyJs, minifyCss };
