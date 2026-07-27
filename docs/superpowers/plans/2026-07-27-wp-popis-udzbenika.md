# WordPress widget — popis udžbenika po školi i razredu — plan implementacije

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Na Libarovom WordPress siteu posjetitelj upiše naziv svoje srednje škole, odabere razred i klikom otvori popis udžbenika koji je ta škola objavila za 2026./2027.

**Architecture:** Bot dobiva javni endpoint `GET /api/popis-udzbenika.json` koji servira postojeću JSON datoteku. Novi WordPress plugin `libar-popis-udzbenika` u vlastitom repou nosi kopiju te datoteke, jednom dnevno povlači svježu preko WP-Cron-a u `wp-content/uploads/libar-popis/`, a preglednik je čita kao statičnu datoteku. Sučelje je vanilla JS: čista logika pretrage i modela prikaza u zasebnim modulima s `node --test` testovima, DOM sloj odvojen.

**Tech Stack:** PHP 7.4+ / WordPress 6.0+ (plugin) · vanilla JS bez build koraka · native `node --test` · Node 22 + Express (bot endpoint)

## Global Constraints

- Bot repo je **CommonJS**, testovi native `node --test`, nema Jest.
- Komentari i sav korisnički tekst su na **hrvatskom**.
- Commit poruke **nemaju** `Co-Authored-By: Claude` liniju.
- Plugin nema npm ovisnosti u produkciji i **ne koristi jQuery** ni bilo koju vanjsku biblioteku. `node --test` se koristi samo za razvoj.
- Sve CSS klase i JS globali nose prefiks `lpu-` / `Lpu` / `Libar`.
- Widget nikad ne prikazuje popis koji nije potvrđen za 2026./2027.
- Disclaimer, doslovno, uz svaki prikaz popisa:
  `Napomena: popis je informativnog karaktera i preuzet je iz javno dostupne baze podataka (stranice škola). Antikvarijat Libar ne odgovara za eventualne netočnosti ili naknadne izmjene — službeni popis provjerite kod svoje škole.`
- Poveznica se stvara samo za `http`/`https` adrese; sve ostalo ostaje običan tekst.
- Dva repoa:
  - bot — `/Users/zrinko/Documents/Code Projects/libar-zendesk-bot-v2` (grana `main`)
  - plugin — `/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp` (novi, stvara se u Tasku 2)
- Webshop poveznica: `https://antikvarijat-libar.com/kupi-udzbenike/`
- Kontakt poveznica: `https://antikvarijat-libar.com/kontakt/`
- Na ovom računalu **nema PHP CLI-ja** (`php` nije instaliran). PHP se ne može lintati lokalno bez `brew install php`; provjera PHP koda ide na WordPressu.

## Pregled datoteka

| Datoteka | Odgovornost | Task |
|---|---|---|
| `libar-zendesk-bot-v2/index.js` | javni endpoint `GET /api/popis-udzbenika.json` | 1 |
| `libar-popis-udzbenika-wp/libar-popis-udzbenika.php` | zaglavlje plugina, konstante, uključivanje klasa, aktivacijske kuke | 2 |
| `libar-popis-udzbenika-wp/includes/class-podaci.php` | putanje i URL podataka; kasnije dohvat, validacija, cron | 2, 7 |
| `libar-popis-udzbenika-wp/includes/class-shortcode.php` | shortcode, markup, uvjetni enqueue, konfiguracija za JS | 2 |
| `libar-popis-udzbenika-wp/includes/class-admin.php` | ekran postavki, gumb za osvježavanje, status | 7 |
| `libar-popis-udzbenika-wp/assets/js/pretraga.js` | normalizacija, priprema i pretraga škola (bez DOM-a) | 3 |
| `libar-popis-udzbenika-wp/assets/js/pogled.js` | model prikaza: razredi, dokumenti, disclaimer, hash (bez DOM-a) | 4 |
| `libar-popis-udzbenika-wp/assets/js/widget.js` | DOM, dohvat podataka, tražilica, panel | 5, 6 |
| `libar-popis-udzbenika-wp/assets/css/widget.css` | stilovi widgeta | 2, 8 |
| `libar-popis-udzbenika-wp/tests/pretraga.test.js` | testovi pretrage | 3 |
| `libar-popis-udzbenika-wp/tests/pogled.test.js` | testovi modela prikaza | 4 |
| `libar-popis-udzbenika-wp/tests/rucna-provjera.html` | harness za ručnu provjeru u pregledniku | 5 |
| `libar-popis-udzbenika-wp/data/popis-udzbenika.json` | kopija podataka koja dolazi uz plugin | 2 |
| `libar-popis-udzbenika-wp/README.md` | upute za instalaciju i osvježavanje | 8 |
| `libar-zendesk-bot-v2/docs/developer.md`, `CLAUDE.md` | dokumentacija endpointa | 8 |

---

### Task 1: Javni endpoint na botu

**Files:**
- Modify: `/Users/zrinko/Documents/Code Projects/libar-zendesk-bot-v2/index.js` (odmah iza bloka `app.get("/")`, oko linije 1201)

**Interfaces:**
- Consumes: `data/popis-udzbenika-2026-27.json` — datoteka koju proizvodi Task 1 plana `docs/superpowers/plans/2026-07-27-popis-udzbenika.md`
- Produces: `GET /api/popis-udzbenika.json` → tijelo je JSON oblika `{ godina, generirano, skole: [{ id, naziv, zupanija, stranica, dokumenti: [{ razred, oznaka, url }] }] }`, zaglavlja `Cache-Control: public, max-age=3600` i `Access-Control-Allow-Origin: *`; `404` s `{ success: false, error }` kad datoteka ne postoji

- [ ] **Step 1: Provjeri postoji li izvorna datoteka**

```bash
cd "/Users/zrinko/Documents/Code Projects/libar-zendesk-bot-v2"
ls -l data/popis-udzbenika-2026-27.json
```

Ako datoteke nema, prvo odradi **Task 1** plana `docs/superpowers/plans/2026-07-27-popis-udzbenika.md` — on stvara skriptu `izvoz_za_bot.py` u repou `popis-udzbenika` i pokreće je:

```bash
cd "/Users/zrinko/Documents/Code Projects/popis-udzbenika"
.venv/bin/python izvoz_za_bot.py \
  --izlaz "/Users/zrinko/Documents/Code Projects/libar-zendesk-bot-v2/data/popis-udzbenika-2026-27.json"
```

Bez te datoteke ostatak plana nema podatke i ne može se provjeriti. Ne nastavljaj dok `ls` ne pokaže datoteku.

- [ ] **Step 2: Dodaj endpoint u `index.js`**

In `/Users/zrinko/Documents/Code Projects/libar-zendesk-bot-v2/index.js`, immediately after the block:

```js
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});
```

insert:

```js

// ─── GET /api/popis-udzbenika.json ────────────────────────────
// Javni izvor podataka za WordPress widget. Ista datoteka koju čita bot —
// jedan izvor istine za chat i web. Podaci su javni (nazivi škola i poveznice
// na dokumente koje su škole same objavile), pa je CORS otvoren.

const POPIS_UDZBENIKA_PATH = path.join(__dirname, "data", "popis-udzbenika-2026-27.json");

app.get("/api/popis-udzbenika.json", (req, res) => {
  if (!fs.existsSync(POPIS_UDZBENIKA_PATH)) {
    log.warn("popis_udzbenika_missing", { path: POPIS_UDZBENIKA_PATH });
    return res.status(404).json({ success: false, error: "Popis udžbenika trenutno nije dostupan." });
  }
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Cache-Control", "public, max-age=3600");
  res.type("application/json");
  return res.sendFile(POPIS_UDZBENIKA_PATH);
});
```

`path`, `fs` i `log` su već uvezeni na vrhu datoteke (linije 20, 21, 24) — ne dodavaj ih ponovno.

- [ ] **Step 3: Pokreni server i provjeri odgovor**

Endpoint se ne pokriva `node --test` testovima jer bi zahtijevao podizanje cijelog Express appa s punim `.env`-om; postojeći e2e testovi u ovom repou iz istog razloga gađaju pokrenuti server. Provjera je stoga s `curl`.

U jednom terminalu:

```bash
cd "/Users/zrinko/Documents/Code Projects/libar-zendesk-bot-v2" && npm run dev
```

U drugom:

```bash
curl -sD - -o /tmp/popis.json http://localhost:3000/api/popis-udzbenika.json | head -12
node -e 'const d=require("/tmp/popis.json"); console.log("godina:", d.godina, "| skola:", d.skole.length);'
```

Expected: `HTTP/1.1 200 OK`, zaglavlja `access-control-allow-origin: *` i `cache-control: public, max-age=3600`, `content-type` sadrži `application/json`, ispis godine `2026./2027.` i broja škola (oko 285).

- [ ] **Step 4: Provjeri ponašanje kad datoteke nema**

Uz server koji i dalje radi:

```bash
cd "/Users/zrinko/Documents/Code Projects/libar-zendesk-bot-v2"
mv data/popis-udzbenika-2026-27.json /tmp/popis-backup.json
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/popis-udzbenika.json
curl -s http://localhost:3000/api/popis-udzbenika.json
mv /tmp/popis-backup.json data/popis-udzbenika-2026-27.json
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/popis-udzbenika.json
```

Expected: prvo `404` i JSON `{"success":false,"error":"Popis udžbenika trenutno nije dostupan."}`, nakon vraćanja datoteke opet `200`. Zaustavi server.

- [ ] **Step 5: Pokreni unit pakete da ništa nije puklo**

Run: `cd "/Users/zrinko/Documents/Code Projects/libar-zendesk-bot-v2" && npm run test:unit 2>&1 | tail -15`

Expected: PASS, isti rezultat kao prije zahvata.

- [ ] **Step 6: Commit**

```bash
cd "/Users/zrinko/Documents/Code Projects/libar-zendesk-bot-v2"
git add index.js data/popis-udzbenika-2026-27.json
git commit -m "feat(api): javni endpoint s popisom udžbenika za WordPress widget"
```

Ako je `data/popis-udzbenika-2026-27.json` već commitan u sklopu drugog plana, `git add` te datoteke neće ništa promijeniti — to je u redu.

---

### Task 2: Kostur plugina i shortcode

**Files:**
- Create: `/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp/libar-popis-udzbenika.php`
- Create: `/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp/includes/class-podaci.php`
- Create: `/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp/includes/class-shortcode.php`
- Create: `/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp/assets/css/widget.css`
- Create: `/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp/assets/js/pretraga.js` (privremeni prazan modul, sadržaj dolazi u Tasku 3)
- Create: `/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp/assets/js/pogled.js` (privremeni prazan modul, sadržaj dolazi u Tasku 4)
- Create: `/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp/assets/js/widget.js` (privremeni, sadržaj dolazi u Tasku 5)
- Create: `/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp/data/popis-udzbenika.json`
- Create: `/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp/package.json`
- Create: `/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp/.gitignore`

**Interfaces:**
- Consumes: `data/popis-udzbenika-2026-27.json` iz bot repoa (Task 1)
- Produces:
  - konstante `LPU_VERZIJA`, `LPU_PUTANJA`, `LPU_URL`
  - `Lpu_Podaci::url_podataka() -> string` — URL JSON-a za preglednik
  - `Lpu_Podaci::putanja() -> string`, `Lpu_Podaci::mapa() -> string`, `Lpu_Podaci::meta() -> array`
  - shortcode `[libar-popis-udzbenika]`
  - globalni objekt u pregledniku `window.LibarPopisConfig = { podaciUrl, webshopUrl, kontaktUrl }`
  - markup: korijen `[data-lpu-widget]`, polje `.lpu-polje#lpu-upit`, lista `.lpu-prijedlozi#lpu-prijedlozi`, status `.lpu-status`, panel `[data-lpu-panel]`

- [ ] **Step 1: Stvori repo i strukturu mapa**

```bash
mkdir -p "/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp"/{includes,assets/js,assets/css,data,tests}
cd "/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp"
git init -q
```

- [ ] **Step 2: Kopiraj podatke iz bot repoa**

```bash
cp "/Users/zrinko/Documents/Code Projects/libar-zendesk-bot-v2/data/popis-udzbenika-2026-27.json" \
   "/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp/data/popis-udzbenika.json"

cd "/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp"
node -e 'const d=require("./data/popis-udzbenika.json"); console.log("godina:", d.godina, "| skola:", d.skole.length, "| s popisom:", d.skole.filter(s=>s.dokumenti.length).length);'
```

Expected: `godina: 2026./2027.`, oko 285 škola, oko 161 s popisom.

- [ ] **Step 3: Napiši glavnu datoteku plugina**

Create `/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp/libar-popis-udzbenika.php`:

```php
<?php
/**
 * Plugin Name: Libar — Popis udžbenika
 * Description: Tražilica popisa udžbenika po srednjoj školi i razredu. Shortcode: [libar-popis-udzbenika]
 * Version: 1.0.0
 * Requires at least: 6.0
 * Requires PHP: 7.4
 * Author: Antikvarijat Libar
 * License: GPL-2.0-or-later
 */

if (!defined('ABSPATH')) {
    exit;
}

define('LPU_VERZIJA', '1.0.0');
define('LPU_PUTANJA', plugin_dir_path(__FILE__));
define('LPU_URL', plugin_dir_url(__FILE__));

require_once LPU_PUTANJA . 'includes/class-podaci.php';
require_once LPU_PUTANJA . 'includes/class-shortcode.php';

Lpu_Shortcode::init();
```

- [ ] **Step 4: Napiši klasu za podatke (minimalna verzija)**

Create `/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp/includes/class-podaci.php`:

```php
<?php
/**
 * Podaci o popisima udžbenika.
 *
 * JSON nikad ne ulazi u bazu: datoteka živi u wp-content/uploads/libar-popis/,
 * a u opciji stoje samo meta podaci. Dok preuzete datoteke nema, koristi se
 * kopija koja dolazi uz plugin, pa widget uvijek ima podatke.
 *
 * Dohvat s izvora, validacija i cron dolaze u zasebnom koraku.
 */

if (!defined('ABSPATH')) {
    exit;
}

class Lpu_Podaci {

    const OPCIJA_URL   = 'lpu_izvor_url';
    const OPCIJA_META  = 'lpu_meta';
    const PODMAPA      = 'libar-popis';
    const IME_DATOTEKE = 'popis-udzbenika.json';

    /** Mapa u uploads gdje živi preuzeta datoteka. */
    public static function mapa() {
        $uploads = wp_upload_dir();
        return trailingslashit($uploads['basedir']) . self::PODMAPA;
    }

    /** Puna putanja preuzete datoteke. */
    public static function putanja() {
        return trailingslashit(self::mapa()) . self::IME_DATOTEKE;
    }

    /** Meta podaci zadnjeg dohvata. */
    public static function meta() {
        $zadano = array(
            'godina'     => '',
            'generirano' => '',
            'skola'      => 0,
            'sPopisom'   => 0,
            'dokumenata' => 0,
            'dohvaceno'  => '',
            'greska'     => '',
        );
        $spremljeno = get_option(self::OPCIJA_META, array());
        return wp_parse_args(is_array($spremljeno) ? $spremljeno : array(), $zadano);
    }

    /**
     * URL koji preglednik dohvaća. Preuzeta datoteka ako postoji, inače kopija
     * iz plugina. Parametar v probija predmemoriju nakon osvježavanja.
     */
    public static function url_podataka() {
        $meta = self::meta();
        if (file_exists(self::putanja())) {
            $uploads = wp_upload_dir();
            $url = trailingslashit($uploads['baseurl']) . self::PODMAPA . '/' . self::IME_DATOTEKE;
            $verzija = $meta['generirano'] ? $meta['generirano'] : LPU_VERZIJA;
            return add_query_arg('v', $verzija, $url);
        }
        return LPU_URL . 'data/' . self::IME_DATOTEKE . '?v=' . LPU_VERZIJA;
    }
}
```

- [ ] **Step 5: Napiši shortcode**

Create `/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp/includes/class-shortcode.php`:

```php
<?php
/**
 * Shortcode [libar-popis-udzbenika].
 *
 * Skripte i stilovi se učitavaju samo na stranicama koje shortcode stvarno
 * koriste. Widget je skriven dok ga JavaScript ne otkrije, pa posjetitelj bez
 * JS-a vidi poruku iz <noscript> umjesto polja koje ne radi.
 *
 * Predviđen je jedan widget po stranici (elementi imaju fiksne ID-ove).
 */

if (!defined('ABSPATH')) {
    exit;
}

class Lpu_Shortcode {

    const OZNAKA      = 'libar-popis-udzbenika';
    const WEBSHOP_URL = 'https://antikvarijat-libar.com/kupi-udzbenike/';
    const KONTAKT_URL = 'https://antikvarijat-libar.com/kontakt/';

    public static function init() {
        add_shortcode(self::OZNAKA, array(__CLASS__, 'prikazi'));
        add_action('wp_enqueue_scripts', array(__CLASS__, 'registriraj'));
    }

    public static function registriraj() {
        wp_register_style('lpu-widget', LPU_URL . 'assets/css/widget.css', array(), LPU_VERZIJA);
        wp_register_script('lpu-pretraga', LPU_URL . 'assets/js/pretraga.js', array(), LPU_VERZIJA, true);
        wp_register_script('lpu-pogled', LPU_URL . 'assets/js/pogled.js', array(), LPU_VERZIJA, true);
        wp_register_script('lpu-widget', LPU_URL . 'assets/js/widget.js', array('lpu-pretraga', 'lpu-pogled'), LPU_VERZIJA, true);
    }

    public static function prikazi() {
        wp_enqueue_style('lpu-widget');
        wp_enqueue_script('lpu-widget');
        wp_add_inline_script(
            'lpu-widget',
            'window.LibarPopisConfig = ' . wp_json_encode(array(
                'podaciUrl'  => Lpu_Podaci::url_podataka(),
                'webshopUrl' => self::WEBSHOP_URL,
                'kontaktUrl' => self::KONTAKT_URL,
            )) . ';',
            'before'
        );

        ob_start();
        ?>
        <div class="lpu-widget" data-lpu-widget hidden>
          <div class="lpu-trazilica">
            <label class="lpu-oznaka" for="lpu-upit">Pronađite svoju školu</label>
            <input
              id="lpu-upit"
              class="lpu-polje"
              type="text"
              role="combobox"
              aria-expanded="false"
              aria-controls="lpu-prijedlozi"
              aria-autocomplete="list"
              autocomplete="off"
              placeholder="Upišite naziv škole ili grad — npr. Gimnazija Daruvar">
            <ul id="lpu-prijedlozi" class="lpu-prijedlozi" role="listbox" aria-label="Pronađene škole" hidden></ul>
          </div>
          <p class="lpu-status" role="status" aria-live="polite"></p>
          <div class="lpu-panel" data-lpu-panel hidden></div>
        </div>
        <noscript>
          <p class="lpu-bez-js">
            Za pretragu popisa udžbenika potreban je JavaScript. Javite nam se na
            <a href="<?php echo esc_url(self::KONTAKT_URL); ?>">kontakt stranici</a>
            pa ćemo popis poslati, ili pogledajte
            <a href="<?php echo esc_url(self::WEBSHOP_URL); ?>">ponudu udžbenika</a>.
          </p>
        </noscript>
        <?php
        return ob_get_clean();
    }
}
```

- [ ] **Step 6: Napiši privremene JS module i osnovni CSS**

Create `/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp/assets/js/pretraga.js`:

```js
// Sadržaj dolazi u sljedećem koraku plana (logika pretrage).
```

Create `/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp/assets/js/pogled.js`:

```js
// Sadržaj dolazi u sljedećem koraku plana (model prikaza).
```

Create `/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp/assets/js/widget.js`:

```js
// Privremeno: samo otkriva widget da se vidi da se skripta učitala.
(function () {
  "use strict";
  var korijen = document.querySelector("[data-lpu-widget]");
  if (korijen) korijen.hidden = false;
})();
```

Create `/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp/assets/css/widget.css`:

```css
/* Osnovni stilovi; dorada dolazi na kraju plana. Boje idu kroz tokene teme
   kontra-libar (--wp--preset--*), s fallbackom za slučaj druge teme. */
.lpu-widget {
  max-width: 40rem;
  margin: 0 auto;
}

.lpu-oznaka {
  display: block;
  margin-bottom: 0.44rem;
  font-weight: 700;
}

.lpu-polje {
  width: 100%;
  padding: calc(0.75rem - 0.0625rem);
  font: inherit;
  background-color: #fcfcfc;
  border: 0.0625rem solid #e2e2e2;
  border-radius: 0.25rem;
}

.lpu-prijedlozi {
  list-style: none;
  margin: 0.44rem 0 0;
  padding: 0;
  background-color: var(--wp--preset--color--white, #fff);
  border: 0.0625rem solid rgb(0 23 31 / 0.1);
  border-radius: 0.375rem;
}

.lpu-status {
  margin: 0.67rem 0;
  font-size: var(--wp--preset--font-size--smaller, 0.875rem);
}
```

- [ ] **Step 7: Dodaj `package.json` i `.gitignore`**

Create `/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp/package.json`:

```json
{
  "name": "libar-popis-udzbenika-wp",
  "version": "1.0.0",
  "private": true,
  "description": "WordPress plugin — tražilica popisa udžbenika po školi i razredu.",
  "scripts": {
    "test": "node --test tests/"
  },
  "license": "GPL-2.0-or-later"
}
```

Create `/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp/.gitignore`:

```
node_modules/
.DS_Store
*.zip
```

- [ ] **Step 8: Provjeri da se JSON i struktura slažu**

```bash
cd "/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp"
find . -path ./.git -prune -o -type f -print | sort
```

Expected: postoje `libar-popis-udzbenika.php`, `includes/class-podaci.php`, `includes/class-shortcode.php`, tri datoteke u `assets/js/`, `assets/css/widget.css`, `data/popis-udzbenika.json`, `package.json`, `.gitignore`.

Ako je na računalu instaliran PHP (`php -v`), provjeri sintaksu:

```bash
for f in libar-popis-udzbenika.php includes/*.php; do php -l "$f"; done
```

Expected: `No syntax errors detected` za svaku datoteku. Ako `php` nije instaliran, preskoči — sintaksa se provjerava na WordPressu u Tasku 8.

- [ ] **Step 9: Commit**

```bash
cd "/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp"
git add .
git commit -m "feat: kostur plugina, shortcode i podaci"
```

---

### Task 3: Logika pretrage

**Files:**
- Modify: `/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp/assets/js/pretraga.js`
- Create: `/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp/tests/pretraga.test.js`

**Interfaces:**
- Consumes: ništa
- Produces (i u pregledniku kao `window.LibarPretraga`, i kao `module.exports`):
  - `normaliziraj(tekst) -> string` — mala slova, bez dijakritike, samo `a-z0-9` i jednostruki razmaci
  - `rijeci(tekst) -> string[]`
  - `pripremi(skole) -> skola[]` — svaka škola dobiva `rijeciNaziva`, `rijeciZupanije`, `brojDokumenata`; ostala polja ostaju
  - `pretrazi(pripremljene, upit, limit = 8) -> skola[]`

- [ ] **Step 1: Napiši testove**

Create `/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp/tests/pretraga.test.js`:

```js
const { describe, it } = require("node:test");
const assert = require("node:assert");
const { normaliziraj, pripremi, pretrazi } = require("../assets/js/pretraga");

function dokument(razred) {
  return { razred: razred, oznaka: razred + ". razred", url: "https://primjer.hr/" + razred + ".pdf" };
}

const SKOLE = [
  { id: "gimnazija-daruvar", naziv: "Gimnazija Daruvar", zupanija: "Bjelovarsko-bilogorska", stranica: null, dokumenti: [dokument("2")] },
  { id: "medicinska-skola-bjelovar", naziv: "Medicinska škola Bjelovar", zupanija: "Bjelovarsko-bilogorska", stranica: null, dokumenti: [dokument("1"), dokument("2"), dokument("3")] },
  { id: "gimnazija-bjelovar", naziv: "Gimnazija Bjelovar", zupanija: "Bjelovarsko-bilogorska", stranica: null, dokumenti: [] },
  { id: "gimnazija-antuna-vrancica-sibenik", naziv: "Gimnazija Antuna Vrančića Šibenik", zupanija: "Šibensko-kninska", stranica: null, dokumenti: [dokument("1")] },
  { id: "srednja-skola-kneza-branimira", naziv: "Srednja škola Kneza Branimira", zupanija: "Šibensko-kninska", stranica: null, dokumenti: [dokument("1")] }
];

const PRIPREMLJENE = pripremi(SKOLE);

describe("normaliziraj", () => {
  it("uklanja dijakritiku", () => {
    assert.strictEqual(normaliziraj("Gimnazija Antuna Vrančića Šibenik"), "gimnazija antuna vrancica sibenik");
  });

  it("pretvara đ u d", () => {
    assert.strictEqual(normaliziraj("Ruđera Boškovića"), "rudera boskovica");
  });

  it("izbacuje navodnike i interpunkciju", () => {
    assert.strictEqual(normaliziraj('Srednja škola "Stjepan Sulimanac" Pitomača'), "srednja skola stjepan sulimanac pitomaca");
  });

  it("podnosi prazan ulaz", () => {
    assert.strictEqual(normaliziraj(""), "");
    assert.strictEqual(normaliziraj(null), "");
  });
});

describe("pretrazi", () => {
  it("nalazi školu upisanu bez dijakritike", () => {
    const rezultat = pretrazi(PRIPREMLJENE, "gimnazija daruvar");
    assert.strictEqual(rezultat[0].naziv, "Gimnazija Daruvar");
  });

  it("ne ovisi o redoslijedu riječi", () => {
    const rezultat = pretrazi(PRIPREMLJENE, "bjelovar medicinska");
    assert.strictEqual(rezultat[0].naziv, "Medicinska škola Bjelovar");
  });

  it("hvata nedovršenu zadnju riječ", () => {
    const rezultat = pretrazi(PRIPREMLJENE, "medicinska bjelo");
    assert.strictEqual(rezultat[0].naziv, "Medicinska škola Bjelovar");
  });

  it("stavlja školu s popisom ispred one bez, kad je relevantnost ista", () => {
    const rezultat = pretrazi(PRIPREMLJENE, "bjelovar");
    const nazivi = rezultat.map((s) => s.naziv);
    assert.ok(
      nazivi.indexOf("Medicinska škola Bjelovar") < nazivi.indexOf("Gimnazija Bjelovar"),
      "škola bez popisa je ispred one s popisom: " + nazivi.join(", ")
    );
  });

  it("ne pretpostavlja školu koju korisnik nije imenovao", () => {
    const rezultat = pretrazi(PRIPREMLJENE, "gimnazija bjelovar");
    assert.strictEqual(rezultat[0].naziv, "Gimnazija Bjelovar");
  });

  it("pogodak po nazivu vrijedi više od pogotka po županiji", () => {
    const nazivi = pretrazi(PRIPREMLJENE, "bjelovar").map((s) => s.naziv);
    // Gimnazija Daruvar se pojavljuje samo zato što joj županija počinje s "bjelovar".
    assert.ok(nazivi.includes("Gimnazija Daruvar"), "Gimnazija Daruvar nije u rezultatu");
    assert.strictEqual(nazivi[nazivi.length - 1], "Gimnazija Daruvar");
  });

  it("traži da svaka riječ upita pogodi", () => {
    assert.deepStrictEqual(pretrazi(PRIPREMLJENE, "daruvar sibenik"), []);
  });

  it("šuti dok upit nema barem dva znaka", () => {
    assert.deepStrictEqual(pretrazi(PRIPREMLJENE, "g"), []);
    assert.deepStrictEqual(pretrazi(PRIPREMLJENE, ""), []);
  });

  it("vraća prazno za besmislen upit", () => {
    assert.deepStrictEqual(pretrazi(PRIPREMLJENE, "xyzzy"), []);
  });

  it("poštuje ograničenje broja rezultata", () => {
    assert.strictEqual(pretrazi(PRIPREMLJENE, "skola", 2).length, 2);
    assert.ok(pretrazi(PRIPREMLJENE, "gimnazija").length <= 8);
  });
});
```

- [ ] **Step 2: Pokreni testove i potvrdi da padaju**

Run: `cd "/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp" && node --test tests/pretraga.test.js 2>&1 | tail -20`

Expected: FAIL — `normaliziraj is not a function` (modul je još prazan).

- [ ] **Step 3: Napiši modul**

Replace the whole content of `/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp/assets/js/pretraga.js` with:

```js
/**
 * Pretraga škola — čista logika, bez DOM-a.
 *
 * Ista datoteka radi u pregledniku (window.LibarPretraga) i u node testovima
 * (module.exports), bez build koraka.
 *
 * Uparivanje je konjunktivno: svaka riječ upita mora pogoditi neku riječ naziva
 * škole ili njezine županije, po prefiksu. Zato se lista sužava kako korisnik
 * tipka, a "gimnazija bjelovar" ne vraća susjedne škole iz istog grada.
 */
(function (global) {
  "use strict";

  // Pogodak u nazivu vrijedi više od pogotka u nazivu županije — inače bi upit
  // "bjelovar" izjednačio škole iz Bjelovara sa svima u toj županiji.
  var TEZINA = {
    nazivTocno: 1,
    nazivPrefiks: 0.6,
    zupanijaTocno: 0.4,
    zupanijaPrefiks: 0.25
  };

  var NAJMANJE_ZNAKOVA = 2;
  var ZADANI_LIMIT = 8;

  function normaliziraj(tekst) {
    return String(tekst === null || tekst === undefined ? "" : tekst)
      .replace(/đ/g, "d")
      .replace(/Đ/g, "D")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function rijeci(tekst) {
    var normalizirano = normaliziraj(tekst);
    return normalizirano ? normalizirano.split(" ") : [];
  }

  function pripremi(skole) {
    return (skole || []).map(function (skola) {
      var kopija = Object.assign({}, skola);
      kopija.rijeciNaziva = rijeci(skola.naziv);
      kopija.rijeciZupanije = rijeci(skola.zupanija);
      kopija.brojDokumenata = (skola.dokumenti || []).length;
      return kopija;
    });
  }

  function najboljiBod(upitnaRijec, rijeciSkole, tocno, prefiks) {
    var najbolji = 0;
    for (var i = 0; i < rijeciSkole.length; i++) {
      if (rijeciSkole[i] === upitnaRijec) {
        return tocno;
      }
      if (rijeciSkole[i].indexOf(upitnaRijec) === 0) {
        najbolji = prefiks;
      }
    }
    return najbolji;
  }

  function bodujRijec(upitnaRijec, skola) {
    return Math.max(
      najboljiBod(upitnaRijec, skola.rijeciNaziva, TEZINA.nazivTocno, TEZINA.nazivPrefiks),
      najboljiBod(upitnaRijec, skola.rijeciZupanije, TEZINA.zupanijaTocno, TEZINA.zupanijaPrefiks)
    );
  }

  function pretrazi(pripremljene, upit, limit) {
    var granica = limit || ZADANI_LIMIT;
    var upitneRijeci = rijeci(upit);
    var brojZnakova = upitneRijeci.join("").length;
    if (!upitneRijeci.length || brojZnakova < NAJMANJE_ZNAKOVA) {
      return [];
    }

    var pogoci = [];
    (pripremljene || []).forEach(function (skola) {
      var zbroj = 0;
      for (var i = 0; i < upitneRijeci.length; i++) {
        var bod = bodujRijec(upitneRijeci[i], skola);
        if (!bod) {
          return; // izlazi iz callbacka — škola ispada iz rezultata
        }
        zbroj += bod;
      }
      pogoci.push({ skola: skola, bod: zbroj });
    });

    pogoci.sort(function (a, b) {
      if (a.bod !== b.bod) {
        return b.bod - a.bod;
      }
      var imaA = a.skola.brojDokumenata > 0 ? 1 : 0;
      var imaB = b.skola.brojDokumenata > 0 ? 1 : 0;
      if (imaA !== imaB) {
        return imaB - imaA;
      }
      if (a.skola.naziv.length !== b.skola.naziv.length) {
        return a.skola.naziv.length - b.skola.naziv.length;
      }
      return a.skola.naziv.localeCompare(b.skola.naziv, "hr");
    });

    return pogoci.slice(0, granica).map(function (pogodak) {
      return pogodak.skola;
    });
  }

  var api = {
    normaliziraj: normaliziraj,
    rijeci: rijeci,
    pripremi: pripremi,
    pretrazi: pretrazi
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.LibarPretraga = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
```

- [ ] **Step 4: Pokreni testove i potvrdi da prolaze**

Run: `cd "/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp" && node --test tests/pretraga.test.js 2>&1 | tail -20`

Expected: PASS, svi testovi.

Ako neki test padne, popravi **modul**, ne test — testovi opisuju traženo ponašanje. Za dijagnostiku:

```bash
cd "/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp"
node -e '
const { pripremi, pretrazi } = require("./assets/js/pretraga");
const podaci = require("./data/popis-udzbenika.json");
const p = pripremi(podaci.skole);
["gimnazija daruvar", "medicinska bjelo", "bjelovar", "vrancica"].forEach((q) => {
  console.log(q, "->", pretrazi(p, q).map((s) => s.naziv).join(" | "));
});
'
```

- [ ] **Step 5: Commit**

```bash
cd "/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp"
git add assets/js/pretraga.js tests/pretraga.test.js
git commit -m "feat: logika pretrage škola po nazivu i županiji"
```

---

### Task 4: Model prikaza

**Files:**
- Modify: `/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp/assets/js/pogled.js`
- Create: `/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp/tests/pogled.test.js`

**Interfaces:**
- Consumes: ništa
- Produces (i kao `window.LibarPogled`, i kao `module.exports`):
  - `DISCLAIMER` — doslovan tekst napomene
  - `imaPopis(skola) -> boolean`
  - `razrediZaSkolu(skola) -> string[]` — jedinstveni razredi `"1"`–`"5"`, uzlazno
  - `trebaBiratiRazred(skola) -> boolean`
  - `dokumentiZaRazred(skola, razred) -> dokument[]` — dokumenti tog razreda plus oni bez oznake razreda
  - `sigurnaAdresa(url) -> string|null`
  - `vrstaDatoteke(url) -> string` — `"PDF"`, `"DOCX"`… ili `""` kad se ne prepoznaje
  - `parsirajHash(hash) -> { skolaId, razred }|null`
  - `sastaviHash(skolaId, razred) -> string`

- [ ] **Step 1: Napiši testove**

Create `/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp/tests/pogled.test.js`:

```js
const { describe, it } = require("node:test");
const assert = require("node:assert");
const {
  DISCLAIMER,
  imaPopis,
  razrediZaSkolu,
  trebaBiratiRazred,
  dokumentiZaRazred,
  sigurnaAdresa,
  vrstaDatoteke,
  parsirajHash,
  sastaviHash
} = require("../assets/js/pogled");

const STRUKOVNA = {
  id: "medicinska-skola-bjelovar",
  naziv: "Medicinska škola Bjelovar",
  dokumenti: [
    { razred: "1", oznaka: "1.a — medicinska sestra opće njege", url: "https://primjer.hr/1a.pdf" },
    { razred: "1", oznaka: "1.b — farmaceutski tehničar", url: "https://primjer.hr/1b.pdf" },
    { razred: "2", oznaka: "2. razred", url: "https://primjer.hr/2.pdf" },
    { razred: null, oznaka: "Popis udžbenika", url: "https://primjer.hr/svi.pdf" }
  ]
};

const BEZ_RAZREDA = {
  id: "gimnazija-x",
  naziv: "Gimnazija X",
  dokumenti: [{ razred: null, oznaka: "Popis udžbenika", url: "https://primjer.hr/x.pdf" }]
};

const BEZ_POPISA = { id: "gimnazija-y", naziv: "Gimnazija Y", dokumenti: [] };

describe("DISCLAIMER", () => {
  it("je doslovan tekst iz specifikacije", () => {
    assert.strictEqual(
      DISCLAIMER,
      "Napomena: popis je informativnog karaktera i preuzet je iz javno dostupne baze podataka (stranice škola). Antikvarijat Libar ne odgovara za eventualne netočnosti ili naknadne izmjene — službeni popis provjerite kod svoje škole."
    );
  });
});

describe("razredi i dokumenti", () => {
  it("nabraja samo razrede koje škola ima, uzlazno", () => {
    assert.deepStrictEqual(razrediZaSkolu(STRUKOVNA), ["1", "2"]);
  });

  it("ne nudi izbor razreda kad nijedan dokument nema oznaku razreda", () => {
    assert.strictEqual(trebaBiratiRazred(BEZ_RAZREDA), false);
    assert.strictEqual(trebaBiratiRazred(STRUKOVNA), true);
  });

  it("uz razred prilaže i dokumente bez oznake razreda", () => {
    const prvi = dokumentiZaRazred(STRUKOVNA, "1");
    assert.strictEqual(prvi.length, 3);
    assert.ok(prvi.some((d) => d.oznaka === "Popis udžbenika"), "nedostaje dokument bez razreda");
  });

  it("ne miješa dokumente drugih razreda", () => {
    const drugi = dokumentiZaRazred(STRUKOVNA, "2");
    assert.ok(!drugi.some((d) => d.oznaka.indexOf("1.") === 0), "procurio je dokument prvog razreda");
  });

  it("prepoznaje školu bez popisa", () => {
    assert.strictEqual(imaPopis(BEZ_POPISA), false);
    assert.strictEqual(imaPopis(STRUKOVNA), true);
    assert.deepStrictEqual(razrediZaSkolu(BEZ_POPISA), []);
  });
});

describe("sigurnaAdresa", () => {
  it("propušta http i https", () => {
    assert.strictEqual(sigurnaAdresa("https://skola.hr/p.pdf"), "https://skola.hr/p.pdf");
    assert.strictEqual(sigurnaAdresa("http://skola.hr/p.pdf"), "http://skola.hr/p.pdf");
  });

  it("odbija sve ostalo", () => {
    assert.strictEqual(sigurnaAdresa("javascript:alert(1)"), null);
    assert.strictEqual(sigurnaAdresa("data:text/html,<script>"), null);
    assert.strictEqual(sigurnaAdresa(""), null);
    assert.strictEqual(sigurnaAdresa(null), null);
  });
});

describe("vrstaDatoteke", () => {
  it("čita nastavak iz adrese", () => {
    assert.strictEqual(vrstaDatoteke("https://skola.hr/popis.pdf"), "PDF");
    assert.strictEqual(vrstaDatoteke("https://skola.hr/popis.DOCX?v=2"), "DOCX");
    assert.strictEqual(vrstaDatoteke("https://skola.hr/popis.xlsx#dio"), "XLSX");
  });

  it("šuti kad nastavka nema ili nije dokument", () => {
    assert.strictEqual(vrstaDatoteke("https://skola.hr/popis-udzbenika/"), "");
    assert.strictEqual(vrstaDatoteke("https://skola.hr/popis.php"), "");
    assert.strictEqual(vrstaDatoteke(""), "");
  });
});

describe("hash u adresi", () => {
  it("čita školu i razred", () => {
    assert.deepStrictEqual(parsirajHash("#gimnazija-daruvar/2"), { skolaId: "gimnazija-daruvar", razred: "2" });
  });

  it("čita samo školu kad razreda nema", () => {
    assert.deepStrictEqual(parsirajHash("#gimnazija-daruvar"), { skolaId: "gimnazija-daruvar", razred: null });
  });

  it("odbija smeće", () => {
    assert.strictEqual(parsirajHash(""), null);
    assert.strictEqual(parsirajHash("#"), null);
    assert.strictEqual(parsirajHash("#<script>"), null);
    assert.strictEqual(parsirajHash("#skola/9").razred, null);
  });

  it("sastavlja hash", () => {
    assert.strictEqual(sastaviHash("gimnazija-daruvar", "2"), "#gimnazija-daruvar/2");
    assert.strictEqual(sastaviHash("gimnazija-daruvar", null), "#gimnazija-daruvar");
  });
});
```

- [ ] **Step 2: Pokreni testove i potvrdi da padaju**

Run: `cd "/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp" && node --test tests/pogled.test.js 2>&1 | tail -20`

Expected: FAIL — `razrediZaSkolu is not a function`.

- [ ] **Step 3: Napiši modul**

Replace the whole content of `/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp/assets/js/pogled.js` with:

```js
/**
 * Model prikaza — čista logika, bez DOM-a.
 *
 * Odgovara na pitanja "koje razrede ova škola ima", "koji dokumenti idu uz
 * odabrani razred" i "je li ova adresa sigurna za poveznicu". Widget samo
 * iscrtava ono što ovaj modul vrati.
 */
(function (global) {
  "use strict";

  var DISCLAIMER = "Napomena: popis je informativnog karaktera i preuzet je iz javno dostupne baze podataka (stranice škola). Antikvarijat Libar ne odgovara za eventualne netočnosti ili naknadne izmjene — službeni popis provjerite kod svoje škole.";

  function dokumenti(skola) {
    return (skola && skola.dokumenti) || [];
  }

  function imaPopis(skola) {
    return dokumenti(skola).length > 0;
  }

  function razrediZaSkolu(skola) {
    var skup = {};
    dokumenti(skola).forEach(function (dokument) {
      if (dokument.razred) {
        skup[dokument.razred] = true;
      }
    });
    return Object.keys(skup).sort();
  }

  function trebaBiratiRazred(skola) {
    return razrediZaSkolu(skola).length > 0;
  }

  // Dokument bez oznake razreda vrijedi za sve razrede te škole — tako ga
  // tretira i bot, pa korisnik nikad ne ostane bez popisa koji postoji.
  function dokumentiZaRazred(skola, razred) {
    return dokumenti(skola).filter(function (dokument) {
      return dokument.razred === razred || !dokument.razred;
    });
  }

  function sigurnaAdresa(url) {
    var tekst = String(url === null || url === undefined ? "" : url).trim();
    return /^https?:\/\//i.test(tekst) ? tekst : null;
  }

  var VRSTE = ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx"];

  // Oznaka vrste dokumenta uz poveznicu — korisnik odmah vidi otvara li PDF
  // ili Word. Stranice bez prepoznatljivog nastavka ostaju bez oznake.
  function vrstaDatoteke(url) {
    var putanja = String(url || "").split("?")[0].split("#")[0];
    var nastavak = putanja.split(".").pop().toLowerCase();
    return VRSTE.indexOf(nastavak) === -1 ? "" : nastavak.toUpperCase();
  }

  function parsirajHash(hash) {
    var tekst = String(hash || "").replace(/^#/, "");
    if (!tekst) {
      return null;
    }
    var dijelovi = tekst.split("/");
    var skolaId = decodeURIComponent(dijelovi[0] || "");
    if (!/^[a-z0-9-]+$/.test(skolaId)) {
      return null;
    }
    var razred = /^[1-5]$/.test(dijelovi[1] || "") ? dijelovi[1] : null;
    return { skolaId: skolaId, razred: razred };
  }

  function sastaviHash(skolaId, razred) {
    return "#" + skolaId + (razred ? "/" + razred : "");
  }

  var api = {
    DISCLAIMER: DISCLAIMER,
    imaPopis: imaPopis,
    razrediZaSkolu: razrediZaSkolu,
    trebaBiratiRazred: trebaBiratiRazred,
    dokumentiZaRazred: dokumentiZaRazred,
    sigurnaAdresa: sigurnaAdresa,
    vrstaDatoteke: vrstaDatoteke,
    parsirajHash: parsirajHash,
    sastaviHash: sastaviHash
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.LibarPogled = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
```

- [ ] **Step 4: Pokreni oba testna paketa**

Run: `cd "/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp" && npm test 2>&1 | tail -20`

Expected: PASS — i `pretraga.test.js` i `pogled.test.js`.

- [ ] **Step 5: Commit**

```bash
cd "/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp"
git add assets/js/pogled.js tests/pogled.test.js
git commit -m "feat: model prikaza razreda, dokumenata i adrese"
```

---

### Task 5: Widget — tražilica i prijedlozi

**Files:**
- Modify: `/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp/assets/js/widget.js`
- Create: `/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp/tests/rucna-provjera.html`

**Interfaces:**
- Consumes: `window.LibarPretraga` (Task 3), `window.LibarPogled` (Task 4), `window.LibarPopisConfig` (Task 2), markup iz Taska 2
- Produces: funkcija `odaberiSkolu(skola)` koju Task 6 zamjenjuje punim prikazom panela

- [ ] **Step 1: Napiši widget**

Replace the whole content of `/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp/assets/js/widget.js` with:

```js
/**
 * Widget — DOM sloj.
 *
 * Podaci se dohvaćaju tek na prvi dodir polja za pretragu, pa widget ne
 * usporava učitavanje stranice. Sav tekst ide kroz textContent, poveznice se
 * stvaraju samo za adrese koje prođu LibarPogled.sigurnaAdresa.
 */
(function () {
  "use strict";

  var config = window.LibarPopisConfig || {};
  var korijen = document.querySelector("[data-lpu-widget]");
  if (!korijen) {
    return;
  }

  var polje = korijen.querySelector(".lpu-polje");
  var lista = korijen.querySelector(".lpu-prijedlozi");
  var status = korijen.querySelector(".lpu-status");
  var panel = korijen.querySelector("[data-lpu-panel]");

  var podaci = null;
  var pripremljene = null;
  var ucitavanje = null;
  var prijedlozi = [];
  var oznaceni = -1;

  korijen.hidden = false;

  function postaviStatus(tekst) {
    status.textContent = tekst || "";
  }

  function ucitajPodatke() {
    if (ucitavanje) {
      return ucitavanje;
    }
    postaviStatus("Učitavam popis škola…");
    ucitavanje = fetch(config.podaciUrl, { credentials: "omit" })
      .then(function (odgovor) {
        if (!odgovor.ok) {
          throw new Error("HTTP " + odgovor.status);
        }
        return odgovor.json();
      })
      .then(function (sadrzaj) {
        podaci = sadrzaj;
        pripremljene = window.LibarPretraga.pripremi(sadrzaj.skole || []);
        postaviStatus("");
        return sadrzaj;
      })
      .catch(function (greska) {
        ucitavanje = null;
        postaviStatus("Popis trenutno nije dostupan. Pokušajte osvježiti stranicu.");
        throw greska;
      });
    return ucitavanje;
  }

  function zatvoriPrijedloge() {
    lista.textContent = "";
    lista.hidden = true;
    polje.setAttribute("aria-expanded", "false");
    polje.removeAttribute("aria-activedescendant");
    prijedlozi = [];
    oznaceni = -1;
  }

  function oznakaPopisa(skola) {
    var broj = (skola.dokumenti || []).length;
    if (!broj) {
      return "uskoro";
    }
    return broj === 1 ? "1 popis" : broj + " popisa";
  }

  function stvoriPrijedlog(skola, indeks) {
    var stavka = document.createElement("li");
    stavka.className = "lpu-prijedlog";
    stavka.id = "lpu-prijedlog-" + indeks;
    stavka.setAttribute("role", "option");
    stavka.setAttribute("aria-selected", "false");

    var naziv = document.createElement("span");
    naziv.className = "lpu-prijedlog-naziv";
    naziv.textContent = skola.naziv;

    var zupanija = document.createElement("span");
    zupanija.className = "lpu-prijedlog-zupanija";
    zupanija.textContent = skola.zupanija || "";

    var oznaka = document.createElement("span");
    oznaka.className = "lpu-prijedlog-oznaka" + ((skola.dokumenti || []).length ? "" : " lpu-uskoro");
    oznaka.textContent = oznakaPopisa(skola);

    stavka.appendChild(naziv);
    stavka.appendChild(zupanija);
    stavka.appendChild(oznaka);
    stavka.addEventListener("mousedown", function (dogadaj) {
      dogadaj.preventDefault(); // zadrži fokus u polju
      odaberiSkolu(skola);
    });
    return stavka;
  }

  function oznaci(indeks) {
    var stavke = lista.querySelectorAll(".lpu-prijedlog");
    for (var i = 0; i < stavke.length; i++) {
      var aktivan = i === indeks;
      stavke[i].classList.toggle("lpu-oznacen", aktivan);
      stavke[i].setAttribute("aria-selected", aktivan ? "true" : "false");
    }
    oznaceni = indeks;
    if (indeks >= 0 && stavke[indeks]) {
      polje.setAttribute("aria-activedescendant", stavke[indeks].id);
    } else {
      polje.removeAttribute("aria-activedescendant");
    }
  }

  function prikaziPrijedloge(pogoci) {
    lista.textContent = "";
    prijedlozi = pogoci;
    oznaceni = -1;

    if (!pogoci.length) {
      lista.hidden = true;
      polje.setAttribute("aria-expanded", "false");
      return;
    }

    pogoci.forEach(function (skola, indeks) {
      lista.appendChild(stvoriPrijedlog(skola, indeks));
    });
    lista.hidden = false;
    polje.setAttribute("aria-expanded", "true");
  }

  function pretrazi() {
    var upit = polje.value;
    if (!pripremljene) {
      return;
    }
    if (window.LibarPretraga.normaliziraj(upit).replace(/ /g, "").length < 2) {
      zatvoriPrijedloge();
      postaviStatus("");
      return;
    }
    var pogoci = window.LibarPretraga.pretrazi(pripremljene, upit);
    prikaziPrijedloge(pogoci);
    if (!pogoci.length) {
      postaviStatus("Nismo pronašli tu školu. Pokrivamo srednje škole u 18 županija (bez Grada Zagreba, Splitsko-dalmatinske i Međimurske).");
    } else {
      postaviStatus(pogoci.length === 1 ? "Pronađena 1 škola." : "Pronađeno škola: " + pogoci.length + ".");
    }
  }

  // Puni prikaz dolazi u sljedećem koraku plana.
  function odaberiSkolu(skola) {
    polje.value = skola.naziv;
    zatvoriPrijedloge();
    panel.hidden = false;
    panel.textContent = skola.naziv;
  }

  polje.addEventListener("focus", function () {
    ucitajPodatke().then(pretrazi).catch(function () {});
  });

  polje.addEventListener("input", function () {
    ucitajPodatke().then(pretrazi).catch(function () {});
  });

  polje.addEventListener("keydown", function (dogadaj) {
    if (lista.hidden) {
      return;
    }
    if (dogadaj.key === "ArrowDown") {
      dogadaj.preventDefault();
      oznaci(Math.min(oznaceni + 1, prijedlozi.length - 1));
    } else if (dogadaj.key === "ArrowUp") {
      dogadaj.preventDefault();
      oznaci(Math.max(oznaceni - 1, -1));
    } else if (dogadaj.key === "Enter" && oznaceni >= 0) {
      dogadaj.preventDefault();
      odaberiSkolu(prijedlozi[oznaceni]);
    } else if (dogadaj.key === "Escape") {
      zatvoriPrijedloge();
    }
  });

  document.addEventListener("click", function (dogadaj) {
    if (!korijen.contains(dogadaj.target)) {
      zatvoriPrijedloge();
    }
  });

  // Izloženo radi harnessa za ručnu provjeru.
  window.LibarWidget = {
    ucitajPodatke: ucitajPodatke,
    odaberiSkolu: function (skola) { odaberiSkolu(skola); },
    stanje: function () { return { podaci: podaci, prijedlozi: prijedlozi }; }
  };
})();
```

- [ ] **Step 2: Napiši harness za ručnu provjeru**

Markup mora ostati identičan onome u `includes/class-shortcode.php` — ako se ondje mijenja, promijeni i ovdje.

Create `/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp/tests/rucna-provjera.html`:

```html
<!doctype html>
<html lang="hr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Ručna provjera widgeta</title>
  <link rel="stylesheet" href="../assets/css/widget.css">
  <style>
    /* Gruba imitacija teme kontra-libar da provjera izgleda kao na sitecu:
       isti tokeni, ista tipografija. Font se učitava s Libarovog sitea, pa
       harness treba mrežu; bez nje pada na sistemski sans-serif. */
    @font-face {
      font-family: Poppins;
      font-weight: 500;
      font-display: swap;
      src: url("https://antikvarijat-libar.com/wp-content/themes/kontra-libar/assets/fonts/Poppins/Poppins-Medium.woff2") format("woff2");
    }
    @font-face {
      font-family: Poppins;
      font-weight: 700;
      font-display: swap;
      src: url("https://antikvarijat-libar.com/wp-content/themes/kontra-libar/assets/fonts/Poppins/Poppins-Bold.woff2") format("woff2");
    }
    :root {
      --wp--preset--color--black: #00171F;
      --wp--preset--color--white: #FFFFFF;
      --wp--preset--color--orange: #F26A35;
      --wp--preset--color--orange-hover: #F27935;
      --wp--preset--color--grey-dark: #767676;
      --wp--preset--color--grey-light-hover: #F5F5F5;
      --wp--preset--font-size--extra-small: 0.75rem;
      --wp--preset--font-size--smaller: 0.875rem;
      --wp--preset--font-size--normal: 1rem;
      --wp--preset--font-size--medium: 1.25rem;
    }
    body {
      margin: 2rem 1.25rem;
      color: var(--wp--preset--color--black);
      font-family: Poppins, sans-serif;
      font-size: 1rem;
      font-weight: 500;
      line-height: 1.5;
    }
    a { color: var(--wp--preset--color--orange); text-decoration: none; }
  </style>
</head>
<body>
  <h1>Popis udžbenika — ručna provjera</h1>

  <div class="lpu-widget" data-lpu-widget hidden>
    <div class="lpu-trazilica">
      <label class="lpu-oznaka" for="lpu-upit">Pronađite svoju školu</label>
      <input
        id="lpu-upit"
        class="lpu-polje"
        type="text"
        role="combobox"
        aria-expanded="false"
        aria-controls="lpu-prijedlozi"
        aria-autocomplete="list"
        autocomplete="off"
        placeholder="Upišite naziv škole ili grad — npr. Gimnazija Daruvar">
      <ul id="lpu-prijedlozi" class="lpu-prijedlozi" role="listbox" aria-label="Pronađene škole" hidden></ul>
    </div>
    <p class="lpu-status" role="status" aria-live="polite"></p>
    <div class="lpu-panel" data-lpu-panel hidden></div>
  </div>

  <script>
    window.LibarPopisConfig = {
      podaciUrl: "../data/popis-udzbenika.json",
      webshopUrl: "https://antikvarijat-libar.com/kupi-udzbenike/",
      kontaktUrl: "https://antikvarijat-libar.com/kontakt/"
    };
  </script>
  <script src="../assets/js/pretraga.js"></script>
  <script src="../assets/js/pogled.js"></script>
  <script src="../assets/js/widget.js"></script>
</body>
</html>
```

- [ ] **Step 3: Provjeri tražilicu u pregledniku**

```bash
cd "/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp"
python3 -m http.server 8080
```

Otvori `http://localhost:8080/tests/rucna-provjera.html` (potreban je http, `file://` blokira `fetch`).

Provjeri:
- prije klika u polje mreža ne dohvaća JSON; nakon klika se dohvati jednom,
- `daruvar` → među prijedlozima je Gimnazija Daruvar s oznakom broja popisa,
- `medicinska bjelo` → Medicinska škola Bjelovar,
- škola bez popisa nosi oznaku `uskoro`,
- ↑/↓ pomiču označeni prijedlog, Enter ga odabire, Esc zatvara listu,
- klik izvan widgeta zatvara listu,
- `xyzzy` → poruka da škola nije pronađena,
- u konzoli nema grešaka.

Zaustavi server (Ctrl+C).

- [ ] **Step 4: Pokreni testove**

Run: `cd "/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp" && npm test 2>&1 | tail -10`

Expected: PASS — widget nema svoje unit testove, ali moduli koje koristi moraju i dalje prolaziti.

- [ ] **Step 5: Commit**

```bash
cd "/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp"
git add assets/js/widget.js tests/rucna-provjera.html
git commit -m "feat: tražilica škola s prijedlozima i tipkovnicom"
```

---

### Task 6: Widget — razredi, dokumenti i adresa

**Files:**
- Modify: `/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp/assets/js/widget.js`

**Interfaces:**
- Consumes: `window.LibarPogled` (Task 4), `odaberiSkolu` iz Taska 5
- Produces: ništa za druge taskove

- [ ] **Step 1: Zamijeni privremenu funkciju `odaberiSkolu`**

In `/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp/assets/js/widget.js`, replace this block:

```js
  // Puni prikaz dolazi u sljedećem koraku plana.
  function odaberiSkolu(skola) {
    polje.value = skola.naziv;
    zatvoriPrijedloge();
    panel.hidden = false;
    panel.textContent = skola.naziv;
  }
```

with:

```js
  function naslovPanela(skola) {
    var naslov = document.createElement("h3");
    naslov.className = "lpu-panel-naslov";
    naslov.textContent = skola.naziv;

    var zupanija = document.createElement("p");
    zupanija.className = "lpu-panel-zupanija";
    zupanija.textContent = skola.zupanija || "";

    var omot = document.createDocumentFragment();
    omot.appendChild(naslov);
    omot.appendChild(zupanija);
    return omot;
  }

  function poveznica(tekst, url, razred) {
    var adresa = window.LibarPogled.sigurnaAdresa(url);
    if (!adresa) {
      var obicni = document.createElement("span");
      obicni.textContent = tekst;
      return obicni;
    }
    var veza = document.createElement("a");
    veza.className = razred || "lpu-veza";
    veza.href = adresa;
    veza.target = "_blank";
    veza.rel = "noopener";
    veza.textContent = tekst;
    return veza;
  }

  function dodajDisclaimer(cilj) {
    var napomena = document.createElement("p");
    napomena.className = "lpu-napomena";
    napomena.textContent = window.LibarPogled.DISCLAIMER;
    cilj.appendChild(napomena);
  }

  function dodajWebshop(cilj, tekst) {
    var odlomak = document.createElement("p");
    odlomak.className = "lpu-cta";
    odlomak.appendChild(poveznica(tekst, config.webshopUrl, "lpu-cta-veza"));
    cilj.appendChild(odlomak);
  }

  function dodajStranicuSkole(cilj, skola) {
    if (!window.LibarPogled.sigurnaAdresa(skola.stranica)) {
      return;
    }
    var odlomak = document.createElement("p");
    odlomak.className = "lpu-stranica-skole";
    odlomak.appendChild(poveznica("Stranica škole s popisima", skola.stranica));
    cilj.appendChild(odlomak);
  }

  function prikaziDokumente(skola, razred) {
    var dokumenti = window.LibarPogled.dokumentiZaRazred(skola, razred);
    var stari = panel.querySelector(".lpu-dokumenti-blok");
    if (stari) {
      panel.removeChild(stari);
    }

    var blok = document.createElement("div");
    blok.className = "lpu-dokumenti-blok";

    var naslov = document.createElement("h4");
    naslov.className = "lpu-dokumenti-naslov";
    naslov.textContent = razred
      ? razred + ". razred — " + skola.naziv
      : "Popis udžbenika — " + skola.naziv;
    blok.appendChild(naslov);

    if (!dokumenti.length) {
      var prazno = document.createElement("p");
      prazno.className = "lpu-poruka";
      prazno.textContent = "Za taj razred nemamo popis. Škole ih objavljuju tijekom ljeta, pa pokušajte ponovno za koji dan.";
      blok.appendChild(prazno);
      dodajStranicuSkole(blok, skola);
      dodajWebshop(blok, "Udžbenike možete potražiti u našem webshopu");
      panel.appendChild(blok);
      return;
    }

    var popis = document.createElement("ul");
    popis.className = "lpu-dokumenti";
    dokumenti.forEach(function (dokument) {
      var stavka = document.createElement("li");
      stavka.appendChild(poveznica(dokument.oznaka, dokument.url, "lpu-dokument"));
      var vrsta = window.LibarPogled.vrstaDatoteke(dokument.url);
      if (vrsta) {
        var oznakaVrste = document.createElement("span");
        oznakaVrste.className = "lpu-vrsta";
        oznakaVrste.textContent = vrsta;
        stavka.appendChild(oznakaVrste);
      }
      popis.appendChild(stavka);
    });
    blok.appendChild(popis);

    dodajStranicuSkole(blok, skola);
    dodajDisclaimer(blok);
    dodajWebshop(blok, "Ove udžbenike možete kupiti rabljene i povoljnije u našem webshopu");
    panel.appendChild(blok);
  }

  function prikaziRazrede(skola, odabrani) {
    var razredi = window.LibarPogled.razrediZaSkolu(skola);
    var traka = document.createElement("div");
    traka.className = "lpu-razredi";
    traka.setAttribute("role", "group");
    traka.setAttribute("aria-label", "Odaberite razred");

    razredi.forEach(function (razred) {
      var gumb = document.createElement("button");
      gumb.type = "button";
      gumb.className = "lpu-razred" + (razred === odabrani ? " lpu-razred-aktivan" : "");
      gumb.setAttribute("aria-pressed", razred === odabrani ? "true" : "false");
      gumb.textContent = razred + ". razred";
      gumb.addEventListener("click", function () {
        otvoriSkolu(skola, razred, true);
      });
      traka.appendChild(gumb);
    });

    panel.appendChild(traka);
  }

  function prikaziBezPopisa(skola) {
    var poruka = document.createElement("p");
    poruka.className = "lpu-poruka";
    poruka.textContent = "Za " + skola.naziv + " popis udžbenika za " +
      ((podaci && podaci.godina) || "tekuću školsku godinu") +
      " još nije objavljen — škole ih objavljuju tijekom ljeta, pa pokušajte ponovno za koji dan.";
    panel.appendChild(poruka);
    dodajStranicuSkole(panel, skola);
    dodajWebshop(panel, "Udžbenike možete potražiti u našem webshopu");
  }

  /**
   * Iscrtava panel za školu. razred je null dok ga korisnik ne odabere;
   * kad škola nema nijedan dokument s oznakom razreda, korak s razredima se
   * preskače i popis se prikazuje odmah.
   */
  function otvoriSkolu(skola, razred, upisiUAdresu) {
    panel.textContent = "";
    panel.hidden = false;
    panel.appendChild(naslovPanela(skola));

    if (!window.LibarPogled.imaPopis(skola)) {
      prikaziBezPopisa(skola);
    } else if (!window.LibarPogled.trebaBiratiRazred(skola)) {
      prikaziDokumente(skola, null);
    } else {
      prikaziRazrede(skola, razred);
      if (razred) {
        prikaziDokumente(skola, razred);
      } else {
        var uputa = document.createElement("p");
        uputa.className = "lpu-poruka";
        uputa.textContent = "Odaberite razred da vidite popis udžbenika.";
        panel.appendChild(uputa);
      }
    }

    if (upisiUAdresu) {
      var novi = window.LibarPogled.sastaviHash(skola.id, razred);
      if (window.location.hash !== novi) {
        window.history.pushState({ skolaId: skola.id, razred: razred }, "", novi);
      }
    }
    panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function odaberiSkolu(skola) {
    polje.value = skola.naziv;
    zatvoriPrijedloge();
    postaviStatus("");
    otvoriSkolu(skola, null, true);
  }

  function skolaPoId(id) {
    if (!podaci) {
      return null;
    }
    var pronadena = null;
    (podaci.skole || []).forEach(function (skola) {
      if (skola.id === id) {
        pronadena = skola;
      }
    });
    return pronadena;
  }

  function primijeniHash() {
    var trazeno = window.LibarPogled.parsirajHash(window.location.hash);
    if (!trazeno) {
      panel.hidden = true;
      panel.textContent = "";
      return;
    }
    ucitajPodatke()
      .then(function () {
        var skola = skolaPoId(trazeno.skolaId);
        if (!skola) {
          return;
        }
        polje.value = skola.naziv;
        otvoriSkolu(skola, trazeno.razred, false);
      })
      .catch(function () {});
  }
```

- [ ] **Step 2: Poveži hash s učitavanjem stranice i gumbom „natrag"**

In the same file, replace this block:

```js
  // Izloženo radi harnessa za ručnu provjeru.
  window.LibarWidget = {
```

with:

```js
  window.addEventListener("popstate", primijeniHash);

  // Kad je škola već u adresi, podaci se dohvaćaju odmah — sadržaj se mora
  // prikazati bez ijedne korisnikove akcije.
  if (window.LibarPogled.parsirajHash(window.location.hash)) {
    primijeniHash();
  }

  // Izloženo radi harnessa za ručnu provjeru.
  window.LibarWidget = {
```

- [ ] **Step 3: Provjeri panel u pregledniku**

```bash
cd "/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp"
python3 -m http.server 8080
```

Otvori `http://localhost:8080/tests/rucna-provjera.html` i provjeri:

- `medicinska bjelovar` → odabir škole prikaže gumbe razreda i uputu da se odabere razred,
- klik na `1. razred` izlista dokumente s oznakama smjerova i oznakom vrste (`PDF`); svaki se otvara u novoj kartici,
- ispod popisa stoji disclaimer i CTA na webshop,
- odabir drugog razreda zamijeni popis, ne dodaje drugi,
- škola bez popisa (npr. upiši naziv neke s oznakom `uskoro`) → poruka „još nije objavljen", **bez** ijedne poveznice na dokument,
- adresa se mijenja u `#id-skole/1`; gumb „natrag" vraća na prethodni razred,
- otvaranje `http://localhost:8080/tests/rucna-provjera.html#gimnazija-daruvar/2` odmah prikaže popis te škole,
- `#<script>` u adresi ne ruši widget,
- u konzoli nema grešaka.

Zaustavi server.

- [ ] **Step 4: Pokreni testove**

Run: `cd "/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp" && npm test 2>&1 | tail -10`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd "/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp"
git add assets/js/widget.js
git commit -m "feat: prikaz razreda, dokumenata i djeljiva adresa"
```

---

### Task 7: Dohvat podataka, cron i admin ekran

**Files:**
- Modify: `/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp/includes/class-podaci.php`
- Create: `/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp/includes/class-admin.php`
- Modify: `/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp/libar-popis-udzbenika.php`
- Create: `/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp/uninstall.php`

**Interfaces:**
- Consumes: `Lpu_Podaci::mapa()`, `putanja()`, `meta()` (Task 2); endpoint iz Taska 1
- Produces:
  - `Lpu_Podaci::init()`, `pri_aktivaciji()`, `pri_deaktivaciji()`
  - `Lpu_Podaci::izvor_url() -> string`
  - `Lpu_Podaci::validiraj($sadrzaj) -> bool`
  - `Lpu_Podaci::dohvati() -> true|WP_Error`
  - `Lpu_Admin::init()` — ekran *Postavke → Popis udžbenika*

- [ ] **Step 1: Dopuni klasu za podatke**

In `/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp/includes/class-podaci.php`, replace the constants block:

```php
    const OPCIJA_URL   = 'lpu_izvor_url';
    const OPCIJA_META  = 'lpu_meta';
    const PODMAPA      = 'libar-popis';
    const IME_DATOTEKE = 'popis-udzbenika.json';
```

with:

```php
    const OPCIJA_URL   = 'lpu_izvor_url';
    const OPCIJA_META  = 'lpu_meta';
    const PODMAPA      = 'libar-popis';
    const IME_DATOTEKE = 'popis-udzbenika.json';
    const CRON_KUKA    = 'lpu_dnevni_dohvat';
    const ZADANI_URL   = 'https://libar-zendesk-bot-v2.onrender.com/api/popis-udzbenika.json';
    const NAJVECA_VELICINA = 5242880; // 5 MB
```

Then add these methods immediately before the closing `}` of the class:

```php

    public static function init() {
        add_action(self::CRON_KUKA, array(__CLASS__, 'dohvati'));
    }

    public static function pri_aktivaciji() {
        if (!wp_next_scheduled(self::CRON_KUKA)) {
            wp_schedule_event(time() + 300, 'daily', self::CRON_KUKA);
        }
    }

    public static function pri_deaktivaciji() {
        wp_clear_scheduled_hook(self::CRON_KUKA);
    }

    /** Adresa s koje se povlače podaci; prazna opcija znači zadani izvor. */
    public static function izvor_url() {
        $url = get_option(self::OPCIJA_URL, '');
        return $url ? $url : self::ZADANI_URL;
    }

    /** Sadržaj je upotrebljiv samo ako ima godinu i barem jednu ispravnu školu. */
    public static function validiraj($sadrzaj) {
        if (!is_array($sadrzaj)) {
            return false;
        }
        if (empty($sadrzaj['godina']) || !is_string($sadrzaj['godina'])) {
            return false;
        }
        if (empty($sadrzaj['skole']) || !is_array($sadrzaj['skole'])) {
            return false;
        }
        foreach ($sadrzaj['skole'] as $skola) {
            if (!is_array($skola) || empty($skola['id']) || empty($skola['naziv'])) {
                return false;
            }
            if (!isset($skola['dokumenti']) || !is_array($skola['dokumenti'])) {
                return false;
            }
        }
        return true;
    }

    /**
     * Povlači svježe podatke s izvora. Pri bilo kakvom neuspjehu stari podaci
     * ostaju netaknuti — bolje jučerašnji popis nego prazan widget.
     */
    public static function dohvati() {
        $odgovor = wp_remote_get(self::izvor_url(), array(
            'timeout'     => 15,
            'redirection' => 3,
        ));

        if (is_wp_error($odgovor)) {
            return self::zabiljezi_gresku($odgovor->get_error_message());
        }

        $kod = wp_remote_retrieve_response_code($odgovor);
        if (200 !== (int) $kod) {
            return self::zabiljezi_gresku(sprintf('Izvor je vratio HTTP %d.', (int) $kod));
        }

        $tijelo = wp_remote_retrieve_body($odgovor);
        if (strlen($tijelo) > self::NAJVECA_VELICINA) {
            return self::zabiljezi_gresku('Datoteka je veća od 5 MB.');
        }

        $sadrzaj = json_decode($tijelo, true);
        if (!self::validiraj($sadrzaj)) {
            return self::zabiljezi_gresku('Sadržaj s izvora nije ispravan popis udžbenika.');
        }

        if (!wp_mkdir_p(self::mapa())) {
            return self::zabiljezi_gresku('Ne mogu stvoriti mapu u uploads.');
        }
        if (false === file_put_contents(self::putanja(), $tijelo)) {
            return self::zabiljezi_gresku('Ne mogu zapisati datoteku u uploads.');
        }

        $s_popisom  = 0;
        $dokumenata = 0;
        foreach ($sadrzaj['skole'] as $skola) {
            $broj = count($skola['dokumenti']);
            $dokumenata += $broj;
            if ($broj) {
                $s_popisom++;
            }
        }

        update_option(self::OPCIJA_META, array(
            'godina'     => $sadrzaj['godina'],
            'generirano' => isset($sadrzaj['generirano']) ? $sadrzaj['generirano'] : '',
            'skola'      => count($sadrzaj['skole']),
            'sPopisom'   => $s_popisom,
            'dokumenata' => $dokumenata,
            'dohvaceno'  => current_time('mysql'),
            'greska'     => '',
        ), false);

        return true;
    }

    private static function zabiljezi_gresku($poruka) {
        $meta = self::meta();
        $meta['greska'] = $poruka . ' (' . current_time('mysql') . ')';
        update_option(self::OPCIJA_META, $meta, false);
        return new WP_Error('lpu_dohvat', $poruka);
    }
```

- [ ] **Step 2: Napiši admin ekran**

Create `/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp/includes/class-admin.php`:

```php
<?php
/**
 * Ekran Postavke → Popis udžbenika: izvor podataka, ručno osvježavanje i status.
 */

if (!defined('ABSPATH')) {
    exit;
}

class Lpu_Admin {

    const AKCIJA_OSVJEZI = 'lpu_osvjezi';
    const STRANICA       = 'lpu-postavke';

    public static function init() {
        add_action('admin_menu', array(__CLASS__, 'izbornik'));
        add_action('admin_init', array(__CLASS__, 'postavke'));
        add_action('admin_post_' . self::AKCIJA_OSVJEZI, array(__CLASS__, 'osvjezi'));
        add_action('admin_notices', array(__CLASS__, 'obavijest_o_gresci'));
    }

    public static function izbornik() {
        add_options_page(
            'Popis udžbenika',
            'Popis udžbenika',
            'manage_options',
            self::STRANICA,
            array(__CLASS__, 'stranica')
        );
    }

    public static function postavke() {
        register_setting('lpu_postavke', Lpu_Podaci::OPCIJA_URL, array(
            'type'              => 'string',
            'sanitize_callback' => 'esc_url_raw',
            'default'           => '',
        ));
    }

    public static function osvjezi() {
        if (!current_user_can('manage_options')) {
            wp_die('Nemate ovlasti za ovu radnju.');
        }
        check_admin_referer(self::AKCIJA_OSVJEZI);

        $rezultat = Lpu_Podaci::dohvati();
        $poruka   = is_wp_error($rezultat) ? 'greska' : 'ok';

        wp_safe_redirect(add_query_arg(
            'lpu_poruka',
            $poruka,
            admin_url('options-general.php?page=' . self::STRANICA)
        ));
        exit;
    }

    public static function obavijest_o_gresci() {
        if (!current_user_can('manage_options')) {
            return;
        }
        $meta = Lpu_Podaci::meta();
        if (empty($meta['greska'])) {
            return;
        }
        printf(
            '<div class="notice notice-warning"><p><strong>Popis udžbenika:</strong> zadnji dohvat nije uspio — %s Widget i dalje radi na ranije preuzetim podacima.</p></div>',
            esc_html($meta['greska'])
        );
    }

    public static function stranica() {
        if (!current_user_can('manage_options')) {
            return;
        }
        $meta = Lpu_Podaci::meta();
        $poruka = isset($_GET['lpu_poruka']) ? sanitize_key($_GET['lpu_poruka']) : '';
        ?>
        <div class="wrap">
          <h1>Popis udžbenika</h1>

          <?php if ('ok' === $poruka) : ?>
            <div class="notice notice-success"><p>Podaci su osvježeni.</p></div>
          <?php elseif ('greska' === $poruka) : ?>
            <div class="notice notice-error"><p>Dohvat nije uspio. Detalji su niže u statusu.</p></div>
          <?php endif; ?>

          <form method="post" action="options.php">
            <?php settings_fields('lpu_postavke'); ?>
            <table class="form-table" role="presentation">
              <tr>
                <th scope="row"><label for="lpu-izvor">URL izvora</label></th>
                <td>
                  <input
                    id="lpu-izvor"
                    class="regular-text"
                    type="url"
                    name="<?php echo esc_attr(Lpu_Podaci::OPCIJA_URL); ?>"
                    value="<?php echo esc_attr(get_option(Lpu_Podaci::OPCIJA_URL, '')); ?>"
                    placeholder="<?php echo esc_attr(Lpu_Podaci::ZADANI_URL); ?>">
                  <p class="description">Prazno znači zadani izvor: <code><?php echo esc_html(Lpu_Podaci::ZADANI_URL); ?></code></p>
                </td>
              </tr>
            </table>
            <?php submit_button('Spremi'); ?>
          </form>

          <h2>Osvježavanje</h2>
          <p>Podaci se povlače automatski jednom dnevno. Ovim gumbom ih možete povući odmah.</p>
          <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
            <input type="hidden" name="action" value="<?php echo esc_attr(self::AKCIJA_OSVJEZI); ?>">
            <?php wp_nonce_field(self::AKCIJA_OSVJEZI); ?>
            <?php submit_button('Osvježi sada', 'secondary', 'submit', false); ?>
          </form>

          <h2>Status</h2>
          <table class="widefat striped" style="max-width:40rem">
            <tbody>
              <tr><th scope="row">Školska godina</th><td><?php echo esc_html($meta['godina'] ? $meta['godina'] : '—'); ?></td></tr>
              <tr><th scope="row">Podaci generirani</th><td><?php echo esc_html($meta['generirano'] ? $meta['generirano'] : '—'); ?></td></tr>
              <tr><th scope="row">Škola ukupno</th><td><?php echo esc_html((string) $meta['skola']); ?></td></tr>
              <tr><th scope="row">Škola s popisom</th><td><?php echo esc_html((string) $meta['sPopisom']); ?></td></tr>
              <tr><th scope="row">Dokumenata</th><td><?php echo esc_html((string) $meta['dokumenata']); ?></td></tr>
              <tr><th scope="row">Zadnji uspješan dohvat</th><td><?php echo esc_html($meta['dohvaceno'] ? $meta['dohvaceno'] : 'nikad — koristi se kopija iz plugina'); ?></td></tr>
              <tr><th scope="row">Zadnja greška</th><td><?php echo esc_html($meta['greska'] ? $meta['greska'] : '—'); ?></td></tr>
              <tr><th scope="row">Datoteka</th><td><code><?php echo esc_html(Lpu_Podaci::putanja()); ?></code></td></tr>
            </tbody>
          </table>

          <h2>Ugradnja</h2>
          <p>Na stranicu gdje želite tražilicu dodajte shortcode: <code>[libar-popis-udzbenika]</code></p>
        </div>
        <?php
    }
}
```

- [ ] **Step 3: Poveži klase u glavnoj datoteci**

In `/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp/libar-popis-udzbenika.php`, replace:

```php
require_once LPU_PUTANJA . 'includes/class-podaci.php';
require_once LPU_PUTANJA . 'includes/class-shortcode.php';

Lpu_Shortcode::init();
```

with:

```php
require_once LPU_PUTANJA . 'includes/class-podaci.php';
require_once LPU_PUTANJA . 'includes/class-shortcode.php';

Lpu_Podaci::init();
Lpu_Shortcode::init();

if (is_admin()) {
    require_once LPU_PUTANJA . 'includes/class-admin.php';
    Lpu_Admin::init();
}

register_activation_hook(__FILE__, array('Lpu_Podaci', 'pri_aktivaciji'));
register_deactivation_hook(__FILE__, array('Lpu_Podaci', 'pri_deaktivaciji'));
```

- [ ] **Step 4: Napiši `uninstall.php`**

Create `/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp/uninstall.php`:

```php
<?php
/**
 * Čišćenje pri deinstalaciji: opcije i preuzeta datoteka.
 */

if (!defined('WP_UNINSTALL_PLUGIN')) {
    exit;
}

delete_option('lpu_izvor_url');
delete_option('lpu_meta');

$uploads = wp_upload_dir();
$datoteka = trailingslashit($uploads['basedir']) . 'libar-popis/popis-udzbenika.json';
if (file_exists($datoteka)) {
    unlink($datoteka);
}
```

- [ ] **Step 5: Provjeri sintaksu ako je PHP dostupan**

```bash
cd "/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp"
if command -v php >/dev/null; then for f in libar-popis-udzbenika.php uninstall.php includes/*.php; do php -l "$f"; done; else echo "php nije instaliran — provjera ide na WordPressu (Task 8)"; fi
```

Expected: `No syntax errors detected` za svaku datoteku, ili poruka da PHP nije instaliran.

- [ ] **Step 6: Potvrdi da zadani URL odgovara**

```bash
curl -sI https://libar-zendesk-bot-v2.onrender.com/api/popis-udzbenika.json | head -3
```

Expected: `HTTP/… 200`. Ako vrati `404` jer endpoint još nije deployan, prvo pushaj i deployaj bot repo. Ako je adresa servisa drukčija, ispravi `ZADANI_URL` u `includes/class-podaci.php` na stvarnu adresu iz Render dashboarda.

- [ ] **Step 7: Commit**

```bash
cd "/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp"
git add includes/class-podaci.php includes/class-admin.php libar-popis-udzbenika.php uninstall.php
git commit -m "feat: dnevni dohvat podataka, validacija i admin ekran"
```

---

### Task 8: Stil, provjera na WordPressu i dokumentacija

**Files:**
- Modify: `/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp/assets/css/widget.css`
- Create: `/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp/README.md`
- Modify: `/Users/zrinko/Documents/Code Projects/libar-zendesk-bot-v2/docs/developer.md`
- Modify: `/Users/zrinko/Documents/Code Projects/libar-zendesk-bot-v2/CLAUDE.md`

**Interfaces:**
- Consumes: sve iz prethodnih taskova
- Produces: ništa

- [ ] **Step 1: Dovrši stilove**

Replace the whole content of `/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp/assets/css/widget.css` with:

```css
/**
 * Widget popisa udžbenika.
 *
 * Boje, font i radijusi dolaze iz tokena teme kontra-libar
 * (--wp--preset--color--*, Poppins iz body-ja). Vrijednosti iza zareza su
 * fallback ako plugin završi na drugoj temi — ne mijenjaj ih u brand boje,
 * jer bi tada widget prestao pratiti temu.
 *
 * Konvencije preuzete iz teme: gumbi i polja radius 0.25rem, plohe 0.375rem,
 * obrub ploha rgb(0 23 31 / 0.1), prijelazi 0.25s ease, gumbi weight 700.
 */

.lpu-widget {
  --lpu-crna: var(--wp--preset--color--black, #00171f);
  --lpu-naglasak: var(--wp--preset--color--orange, #f26a35);
  --lpu-naglasak-hover: var(--wp--preset--color--orange-hover, #f27935);
  --lpu-sivo-tekst: var(--wp--preset--color--grey-dark, #767676);
  --lpu-sivo-podloga: var(--wp--preset--color--grey-light-hover, #f5f5f5);
  --lpu-obrub: rgb(0 23 31 / 0.1);
  --lpu-ploha: var(--wp--preset--color--white, #fff);

  max-width: 40rem;
  margin: 0 auto;
  color: var(--lpu-crna);
}

.lpu-trazilica {
  position: relative;
}

.lpu-oznaka {
  display: block;
  margin-bottom: 0.44rem;
  font-weight: 700;
}

/* Isti izgled kao ostala polja na sitecu. */
.lpu-polje {
  width: 100%;
  padding: calc(0.75rem - 0.0625rem);
  font: inherit;
  color: inherit;
  background-color: #fcfcfc;
  border: 0.0625rem solid #e2e2e2;
  border-radius: 0.25rem;
  transition: border-color 0.25s ease;
}

.lpu-polje:hover {
  border-color: var(--lpu-sivo-tekst);
}

/* Tema globalno gasi outline (:focus-visible { outline: none !important }),
   pa fokus vraćamo eksplicitno — bez njega se tipkovnicom ne vidi gdje si. */
.lpu-widget :is(.lpu-polje, .lpu-razred, a):focus-visible {
  outline: 0.125rem solid var(--lpu-naglasak) !important;
  outline-offset: 0.125rem;
  border-radius: 0.25rem;
}

.lpu-prijedlozi {
  position: absolute;
  z-index: 20;
  width: 100%;
  max-height: 22rem;
  overflow-y: auto;
  margin: 0.44rem 0 0;
  padding: 0;
  list-style: none;
  background-color: var(--lpu-ploha);
  border: 0.0625rem solid var(--lpu-obrub);
  border-radius: 0.375rem;
  box-shadow: 0 0.375rem 1.25rem rgb(0 23 31 / 0.08);
}

.lpu-prijedlog {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0 0.67rem;
  min-height: 2.75rem;
  padding: 0.67rem 1rem;
  cursor: pointer;
  border-bottom: 0.0625rem solid var(--lpu-obrub);
  transition: background-color 0.25s ease;
}

.lpu-prijedlog:last-child {
  border-bottom: 0;
}

.lpu-prijedlog:hover,
.lpu-prijedlog.lpu-oznacen {
  background-color: var(--lpu-sivo-podloga);
}

.lpu-prijedlog-naziv {
  font-weight: 600;
}

.lpu-prijedlog-zupanija {
  grid-column: 1;
  color: var(--lpu-sivo-tekst);
  font-size: var(--wp--preset--font-size--smaller, 0.875rem);
}

.lpu-prijedlog-oznaka {
  grid-row: 1 / span 2;
  grid-column: 2;
  align-self: center;
  color: var(--lpu-naglasak);
  font-size: var(--wp--preset--font-size--extra-small, 0.75rem);
  font-weight: 700;
  white-space: nowrap;
}

.lpu-prijedlog-oznaka.lpu-uskoro {
  color: var(--lpu-sivo-tekst);
  font-weight: 500;
  font-style: italic;
}

.lpu-status {
  margin: 0.67rem 0;
  color: var(--lpu-sivo-tekst);
  font-size: var(--wp--preset--font-size--smaller, 0.875rem);
}

/* Ploha po uzoru na kartice u temi. */
.lpu-panel {
  margin-top: 1.5rem;
  padding: 1.5rem;
  background-color: var(--lpu-ploha);
  border: 0.0625rem solid var(--lpu-obrub);
  border-radius: 0.375rem;
}

.lpu-panel-naslov {
  margin: 0 0 0.2rem;
  font-size: var(--wp--preset--font-size--medium, 1.25rem);
  font-weight: 700;
}

.lpu-panel-zupanija {
  margin: 0 0 1.5rem;
  color: var(--lpu-sivo-tekst);
  font-size: var(--wp--preset--font-size--smaller, 0.875rem);
}

.lpu-razredi {
  display: flex;
  flex-wrap: wrap;
  gap: 0.44rem;
  margin-bottom: 1.5rem;
}

/* Neaktivan razred je obrisni gumb, aktivan poprima izgled temina gumba. */
.lpu-razred {
  min-height: 2.75rem;
  padding: 0.75rem 1.25rem;
  color: inherit;
  font-family: inherit;
  font-size: var(--wp--preset--font-size--extra-small, 0.75rem);
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  background-color: var(--lpu-ploha);
  border: 0.0625rem solid var(--lpu-obrub);
  border-radius: 0.25rem;
  transition: background-color 0.25s ease, border-color 0.25s ease, color 0.25s ease;
}

.lpu-razred:hover {
  border-color: var(--lpu-naglasak);
  color: var(--lpu-naglasak);
}

.lpu-razred-aktivan,
.lpu-razred-aktivan:hover {
  background-color: var(--lpu-naglasak);
  border-color: var(--lpu-naglasak);
  color: var(--wp--preset--color--white, #fff);
}

.lpu-dokumenti-naslov {
  margin: 0 0 0.67rem;
  font-size: var(--wp--preset--font-size--normal, 1rem);
  font-weight: 700;
}

.lpu-dokumenti {
  margin: 0 0 1rem;
  padding: 0;
  list-style: none;
}

.lpu-dokumenti li {
  padding: 0.44rem 0;
  border-bottom: 0.0625rem solid var(--lpu-obrub);
}

.lpu-dokumenti li:last-child {
  border-bottom: 0;
}

.lpu-dokument {
  font-weight: 600;
}

.lpu-vrsta {
  margin-left: 0.44rem;
  color: var(--lpu-sivo-tekst);
  font-size: var(--wp--preset--font-size--extra-small, 0.75rem);
  letter-spacing: 0.04em;
}

.lpu-napomena {
  margin: 1rem 0;
  color: var(--lpu-sivo-tekst);
  font-size: var(--wp--preset--font-size--smaller, 0.875rem);
}

.lpu-stranica-skole {
  margin: 0.67rem 0;
}

.lpu-cta {
  margin: 1rem 0 0;
}

/* CTA nosi izgled temina gumba — to je jedina radnja koja vodi u webshop. */
.lpu-cta-veza {
  display: inline-block;
  padding: calc(1.125rem - 0.0625rem) calc(1.5rem - 0.0625rem);
  color: var(--wp--preset--color--white, #fff) !important;
  font-size: var(--wp--preset--font-size--extra-small, 0.75rem);
  font-weight: 700;
  line-height: 1;
  text-align: center;
  text-decoration: none;
  background-color: var(--lpu-naglasak);
  border: 0.0625rem solid var(--lpu-naglasak);
  border-radius: 0.25rem;
  transition: background-color 0.25s ease, border-color 0.25s ease;
}

.lpu-cta-veza:hover {
  background-color: var(--lpu-naglasak-hover);
  border-color: var(--lpu-naglasak-hover);
}

.lpu-poruka {
  margin: 0.67rem 0;
}

/* Ispod sm breakpointa teme (576px). */
@media (max-width: 575.98px) {
  .lpu-panel {
    padding: 1rem;
  }

  .lpu-prijedlog {
    grid-template-columns: 1fr;
  }

  .lpu-prijedlog-oznaka {
    grid-row: auto;
    grid-column: 1;
  }

  .lpu-cta-veza {
    display: block;
  }
}
```

- [ ] **Step 2: Provjeri izgled na uskom i širokom ekranu**

```bash
cd "/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp"
python3 -m http.server 8080
```

Otvori `http://localhost:8080/tests/rucna-provjera.html`, u alatima za razvoj uključi prikaz mobitela (360 px širine) i provjeri:
- ništa ne izlazi izvan ekrana i nema vodoravnog scrolla,
- gumbi razreda i stavke prijedloga su visoki barem 44 px,
- lista prijedloga se preklapa preko panela, ne gura sadržaj,
- tipkanjem Tab kroz widget fokus je **vidljiv** na polju, gumbima razreda i poveznicama,
- aktivan razred je narančast s bijelim tekstom, neaktivni su obrisni.

Zaustavi server.

- [ ] **Step 3: Napiši README plugina**

Create `/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp/README.md`:

```markdown
# Libar — Popis udžbenika (WordPress plugin)

Tražilica popisa udžbenika po srednjoj školi i razredu. Posjetitelj upiše naziv
škole, odabere razred i otvori popis koji je ta škola objavila na svojim
stranicama.

## Ugradnja

1. Zipaj mapu plugina i instaliraj je kroz *Dodaci → Dodaj novi → Pošalji dodatak*.
2. Aktiviraj plugin.
3. Na željenu stranicu dodaj shortcode `[libar-popis-udzbenika]`.
4. U *Postavke → Popis udžbenika* klikni **Osvježi sada** da povučeš svježe podatke.

```bash
cd "/Users/zrinko/Documents/Code Projects"
zip -r libar-popis-udzbenika.zip libar-popis-udzbenika-wp \
  -x "*/.git/*" "*/node_modules/*" "*/tests/*" "*/.DS_Store"
```

## Podaci

Izvor je JSON koji servira Libar bot na
`https://libar-zendesk-bot-v2.onrender.com/api/popis-udzbenika.json`, a proizvodi
ga projekt `popis-udzbenika`. Plugin ga povlači jednom dnevno (WP-Cron) u
`wp-content/uploads/libar-popis/`. Dok preuzete datoteke nema, koristi se kopija
iz `data/popis-udzbenika.json`.

Ako dohvat ili validacija padnu, stari podaci ostaju i u adminu se prikaže
obavijest.

Osvježavanje izvora (u repou `popis-udzbenika`):

```bash
.venv/bin/python pipeline.py --ponovi-greske
.venv/bin/python izvoz_za_bot.py --izlaz ../libar-zendesk-bot-v2/data/popis-udzbenika-2026-27.json
```

Nakon commita i deploya bota, WordPress se uskladi sam u roku od dana.

## Razvoj

```bash
npm test                      # logika pretrage i modela prikaza
python3 -m http.server 8080   # pa otvori tests/rucna-provjera.html
```

Markup u `tests/rucna-provjera.html` mora ostati identičan onome u
`includes/class-shortcode.php`.

## Opseg podataka

Srednje škole u 18 županija — bez Grada Zagreba, Splitsko-dalmatinske i
Međimurske. Škole bez objavljenog popisa prikazuju se s oznakom „uskoro".
```

- [ ] **Step 4: Instaliraj i provjeri na WordPressu**

Ovo je prva provjera PHP koda — do sada se izvršavao samo JS.

1. Zipaj plugin naredbom iz README-a.
2. Instaliraj ga na **staging** site ako postoji; ako ne postoji, instaliraj na produkciji, ali shortcode stavi na stranicu u statusu **skica**.
3. Aktiviraj plugin i prođi listu:

- [ ] plugin se aktivira bez PHP greške ili upozorenja,
- [ ] *Postavke → Popis udžbenika* se otvara i prikazuje status,
- [ ] **Osvježi sada** javlja „Podaci su osvježeni", status pokaže godinu `2026./2027.` i oko 285 škola,
- [ ] datoteka postoji u `wp-content/uploads/libar-popis/popis-udzbenika.json`,
- [ ] stranica sa shortcodeom prikazuje tražilicu,
- [ ] widget je u Poppinsu i naslijeđenim brand bojama — polje izgleda kao ostala polja na sitecu, CTA kao ostali gumbi (usporedi sa `/kontakt/` i bilo kojom stranicom proizvoda),
- [ ] pretraga, odabir razreda i otvaranje dokumenta rade kao u ručnoj provjeri,
- [ ] disclaimer i CTA na webshop su vidljivi uz svaki popis,
- [ ] škola bez popisa daje poruku „još nije objavljen" bez poveznice na dokument,
- [ ] s isključenim JavaScriptom u pregledniku vidi se `<noscript>` poruka,
- [ ] u *Alati → Zdravlje stranice → Podaci* ili preko WP Crontrol postoji zakazani događaj `lpu_dnevni_dohvat`,
- [ ] neispravan URL izvora u postavkama → „Osvježi sada" prijavi grešku, a widget i dalje radi sa starim podacima (vrati ispravan URL nakon provjere),
- [ ] deaktivacija plugina ukloni zakazani događaj.

Zapiši eventualne greške i popravi ih prije nastavka.

- [ ] **Step 5: Dopiši dokumentaciju u bot repou**

In `/Users/zrinko/Documents/Code Projects/libar-zendesk-bot-v2/docs/developer.md`, add a new section at the end:

```markdown
## Javni endpoint s popisom udžbenika

`GET /api/popis-udzbenika.json` servira `data/popis-udzbenika-2026-27.json` —
istu datoteku koju čita `textbookListService`. Zaglavlja: `Cache-Control:
public, max-age=3600` i `Access-Control-Allow-Origin: *`. Kad datoteke nema,
vraća `404` s porukom.

Koristi ga WordPress plugin `libar-popis-udzbenika` (repo
`libar-popis-udzbenika-wp`), koji jednom dnevno povlači podatke i prikazuje
tražilicu popisa po školi i razredu na stranici Libarovog sitea. Jedan izvor
istine za chat i web: regeneriraš JSON i deployaš bota, WordPress se uskladi sam.
```

In `/Users/zrinko/Documents/Code Projects/libar-zendesk-bot-v2/CLAUDE.md`, in the „Mapa koda" section, add after the line describing `index.js`:

```markdown
  - javni endpoint `GET /api/popis-udzbenika.json` — izvor podataka za WordPress plugin `libar-popis-udzbenika`
```

- [ ] **Step 6: Commit u oba repoa**

```bash
cd "/Users/zrinko/Documents/Code Projects/libar-popis-udzbenika-wp"
git add assets/css/widget.css README.md
git commit -m "feat: dovršeni stilovi i upute za instalaciju"

cd "/Users/zrinko/Documents/Code Projects/libar-zendesk-bot-v2"
git add docs/developer.md CLAUDE.md
git commit -m "docs: javni endpoint s popisom udžbenika"
```

---

## Provjera na kraju

- [ ] `npm test` u plugin repou prolazi u cijelosti
- [ ] `npm run test:unit` u bot repou prolazi nepromijenjen
- [ ] `curl -sI https://<bot>/api/popis-udzbenika.json` vraća `200` s `access-control-allow-origin: *`
- [ ] Stranica sa shortcodeom nalazi školu upisanu bez dijakritike i s obrnutim redoslijedom riječi
- [ ] Odabir razreda otvara dokumente s oznakama smjerova, svaki u novoj kartici
- [ ] Disclaimer stoji uz svaki prikaz popisa, doslovno kako je zadano
- [ ] Škola bez popisa daje poruku „još nije objavljen" i nijednu poveznicu na dokument
- [ ] „Osvježi sada" u adminu povlači svježe podatke; pad dohvata ostavlja stare
- [ ] Widget radi na mobitelu (360 px) bez vodoravnog scrolla
