# Popis udžbenika po školi i razredu — plan implementacije

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kad posjetitelj u web chat widgetu zatraži popis udžbenika za određenu školu i razred, bot odgovara klikabilnim linkom na popis koji je ta škola objavila za 2026./2027.

**Architecture:** Zaseban Python projekt `popis-udzbenika` izvozi jedan statični JSON koji se commita u bot repo. Novi servis `services/textbookListService.js` učita ga jednom pri startu, prepoznaje školu (IDF bodovanje nad tokenima naziva) i razred (regex), te sastavlja gotov odgovor. Gate u `_resolveAutomatedOutcome` poziva servis nakon escalation gateova; bez pogotka servis vraća `null` i postojeći pipeline teče nepromijenjeno. Bez LLM poziva i bez mreže.

**Tech Stack:** Node CommonJS, native `node --test`, Express (bot) · Python 3 + openpyxl (izvoz)

## Global Constraints

- **CommonJS** (`require`/`module.exports`), nikad ESM.
- Testovi su native `node --test`, nema Jest.
- Komentari i sav korisnički tekst su na **hrvatskom**.
- Sva konfiguracija ide kroz `config/env.js`, bez hardkodiranih vrijednosti.
- Commit poruke **nemaju** `Co-Authored-By: Claude` liniju.
- Feature se aktivira **samo** na `channelType === "web_chat"`.
- Bot nikad ne šalje popis koji nije potvrđen za 2026./2027.
- Disclaimer, doslovno, uz svaki odgovor koji sadrži popis:
  `Napomena: popis je informativnog karaktera i preuzet je iz javno dostupne baze podataka (stranice škola). Antikvarijat Libar ne odgovara za eventualne netočnosti ili naknadne izmjene — službeni popis provjerite kod svoje škole.`
- Dva repoa:
  - bot — `/Users/zrinko/Documents/Code Projects/libar-zendesk-bot-v2` (grana `main`)
  - izvor — `/Users/zrinko/Documents/Code Projects/popis-udzbenika` (grana `popis-2026-27`)
- U `popis-udzbenika` postoje **nespremljene izmjene u `popis_2026_27/output/`**. Ne commitati ih i ne dirati — commitati isključivo datoteke navedene u koracima.

## Pregled datoteka

| Datoteka | Odgovornost | Task |
|---|---|---|
| `popis-udzbenika/izvoz_za_bot.py` | čita 3 izlaza pipelinea + registar škola, piše JSON | 1 |
| `libar-zendesk-bot-v2/data/popis-udzbenika-2026-27.json` | generirani podaci, commitani | 1 |
| `libar-zendesk-bot-v2/services/textbookListService.js` | učitavanje, prepoznavanje škole i razreda, sastavljanje odgovora | 2, 3 |
| `libar-zendesk-bot-v2/tests/textbookListService.test.js` | unit testovi servisa | 2, 3 |
| `libar-zendesk-bot-v2/config/env.js` | zastavica `POPIS_UDZBENIKA_ENABLED` | 4 |
| `libar-zendesk-bot-v2/index.js` | gate u `_resolveAutomatedOutcome` | 4 |
| `libar-zendesk-bot-v2/public/index.html` | renderiranje markdown linkova u widgetu | 5 |
| `libar-zendesk-bot-v2/docs/developer.md`, `README.md` | dokumentacija i postupak osvježavanja | 6 |

---

### Task 1: Izvoz podataka u JSON

Radi se u repou `popis-udzbenika`. Rezultat je JSON datoteka commitana u bot repo.

**Files:**
- Create: `/Users/zrinko/Documents/Code Projects/popis-udzbenika/izvoz_za_bot.py`
- Create: `/Users/zrinko/Documents/Code Projects/libar-zendesk-bot-v2/data/popis-udzbenika-2026-27.json`

**Interfaces:**
- Consumes: `popis_2026_27/output/Udzbenici_2026_27.xlsx` (sheet `UDZBENICI`), `popis_2026_27/output/Izvjestaj_provjere_2026_27.xlsx` (sheet `STATUS_2026_27`), `popis_2026_27/output/FINALNA_provjera_popisa_oznaceno.csv`, `output/Registar_skola.xlsx` (sheet `REGISTAR`)
- Produces: JSON oblika
  ```json
  {
    "godina": "2026./2027.",
    "generirano": "2026-07-27",
    "skole": [
      {
        "id": "gimnazija-daruvar",
        "naziv": "Gimnazija Daruvar",
        "zupanija": "Bjelovarsko-bilogorska",
        "stranica": "https://gimnazija-daruvar.hr/popis-udzbenika/",
        "dokumenti": [
          { "razred": "2", "oznaka": "2. razred", "url": "https://…" }
        ]
      }
    ]
  }
  ```
  `razred` je `"1"`–`"5"` ili `null`. `stranica` je `null` kad je nemamo. `dokumenti` je prazan niz za škole bez potvrđenog popisa 26/27.

- [ ] **Step 1: Napiši izvoznu skriptu**

Create `/Users/zrinko/Documents/Code Projects/popis-udzbenika/izvoz_za_bot.py`:

```python
#!/usr/bin/env python3
"""Izvoz popisa udžbenika u JSON za Libar Zendesk bot.

Čita izlaze pipelinea i piše jednu JSON datoteku koja se kopira u bot repo
kao data/popis-udzbenika-2026-27.json.

Pokretanje:
    .venv/bin/python izvoz_za_bot.py --izlaz ../libar-zendesk-bot-v2/data/popis-udzbenika-2026-27.json
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import unicodedata
from datetime import date
from pathlib import Path
from urllib.parse import unquote

import openpyxl

KORIJEN = Path(__file__).resolve().parent
IZLAZ_2627 = KORIJEN / "popis_2026_27" / "output"
GODINA = "2026./2027."

# Nazivi škola koje nemaju zapis u službenom registru (privatne i vjerske
# ustanove), pa se pokvareni dijakritici ne mogu rekonstruirati automatski.
RUCNI_ISPRAVCI = {
    "Biskupijska klasi?na gimnazija Ru?era Boškovi?a Dubrovnik":
        "Biskupijska klasična gimnazija Ruđera Boškovića Dubrovnik",
    "Isusova?ka klasi?na gimnazija Osijek":
        "Isusovačka klasična gimnazija Osijek",
    "Katoli?ka klasi?na gimnazija Požega":
        "Katolička klasična gimnazija Požega",
    "Katoli?ka klasi?na gimnazija Virovitica":
        "Katolička klasična gimnazija Virovitica",
    "Klasi?na gimnazija Ivana Pavla II Zadar":
        "Klasična gimnazija Ivana Pavla II Zadar",
    "Pazinski kolegij – klasi?na gimnazija":
        "Pazinski kolegij – klasična gimnazija",
    "Prosvjetno-kulturni centar Ma?ara u RH":
        "Prosvjetno-kulturni centar Mađara u RH",
    "Salezijanska klasi?na gimnazija Rijeka":
        "Salezijanska klasična gimnazija Rijeka",
    'Srednja škola "Stjepan Sulimanac" Pitoma?a':
        'Srednja škola "Stjepan Sulimanac" Pitomača',
    "Srednja škola Pavla Rittera Vitezovi?a Senj":
        "Srednja škola Pavla Rittera Vitezovića Senj",
    "Srednja škola Zvane ?rnje Rovinj":
        "Srednja škola Zvane Črnje Rovinj",
    "Strukovna škola Eugena Kumi?i?a":
        "Strukovna škola Eugena Kumičića",
    "Strukovna škola Marko Babi? Vukovar":
        "Strukovna škola Marko Babić Vukovar",
}

# Riječi koje ne nose smjer, pa ispadaju iz čitljive oznake dokumenta.
GENERICKE_RIJECI = {
    "popis", "popisi", "udzbenika", "udzbenici", "udzbenik", "za", "u",
    "skolsku", "godinu", "god", "sk", "novo", "novi", "final", "finalno",
    "razred", "razreda", "r", "ss", "os",
}


def bez_dijakritike(vrijednost: str) -> str:
    """Sklopi naziv na [a-z0-9?] radi usporedbe s registrom."""
    tekst = str(vrijednost).replace("đ", "d").replace("Đ", "D")
    tekst = unicodedata.normalize("NFD", tekst)
    tekst = "".join(z for z in tekst if unicodedata.category(z) != "Mn")
    return re.sub(r"[^a-z0-9?]", "", tekst.lower())


def ucitaj_registar() -> dict[str, str]:
    """Ključ bez dijakritike -> službeni naziv srednje škole iz registra."""
    putanja = KORIJEN / "output" / "Registar_skola.xlsx"
    knjiga = openpyxl.load_workbook(putanja, read_only=True)
    registar: dict[str, str] = {}
    for redak in knjiga["REGISTAR"].iter_rows(min_row=2, values_only=True):
        naziv, razina, mjesto = redak[1], str(redak[2] or ""), str(redak[5] or "")
        if not naziv or "SŠ" not in razina:
            continue
        naziv = str(naziv).strip()
        registar.setdefault(bez_dijakritike(naziv), naziv)
        if mjesto:
            registar.setdefault(bez_dijakritike(naziv + mjesto), f"{naziv} {mjesto}")
    knjiga.close()
    return registar


def spoji(izvorni: str, sluzbeni: str) -> str | None:
    """Zamijeni '?' znakovima iz službenog naziva, uz očuvanje izvornog pisanja.

    Službeni registar je pola velikim slovima ("GIMNAZIJA DARUVAR"), pa se naziv
    ne smije preuzeti doslovno — vraćaju se samo znakovi na mjestima upitnika.
    """
    mjesta = [i for i, znak in enumerate(izvorni) if bez_dijakritike(znak)]
    znakovi_sluzbenog = [znak for znak in sluzbeni if bez_dijakritike(znak)]
    if len(mjesta) != len(znakovi_sluzbenog):
        return None
    izlaz = list(izvorni)
    for redni, i in enumerate(mjesta):
        if izlaz[i] != "?":
            continue
        zamjena = znakovi_sluzbenog[redni]
        pocetak_rijeci = i == 0 or not izvorni[i - 1].isalpha()
        izlaz[i] = zamjena.upper() if (pocetak_rijeci or izvorni[i - 1].isupper()) else zamjena.lower()
    return "".join(izlaz)


def popravi_naziv(naziv: str, registar: dict[str, str]) -> str:
    """Vrati naziv s ispravnim dijakriticima. '?' se tretira kao wildcard."""
    if "?" not in naziv:
        return naziv
    if naziv in RUCNI_ISPRAVCI:
        return RUCNI_ISPRAVCI[naziv]
    uzorak = re.compile("^" + re.escape(bez_dijakritike(naziv)).replace(r"\?", ".") + "$")
    pogoci = {v for k, v in registar.items() if uzorak.match(k)}
    if len(pogoci) == 1:
        return spoji(naziv, pogoci.pop()) or naziv
    return naziv


def slug(naziv: str) -> str:
    osnova = bez_dijakritike(naziv)
    tekst = str(naziv).replace("đ", "d").replace("Đ", "D")
    tekst = unicodedata.normalize("NFD", tekst)
    tekst = "".join(z for z in tekst if unicodedata.category(z) != "Mn").lower()
    tekst = re.sub(r"[^a-z0-9]+", "-", tekst).strip("-")
    return tekst or osnova


def ukloni_naziv_skole(rijeci: list[str], naziv_skole: str) -> list[str]:
    """Izbaci naziv škole iz oznake — škole ga rutinski stavljaju u ime datoteke.

    Uklanja se samo kao cjelovit niz riječi, da se iz "medicinska sestra opće
    njege" ne izgubi "medicinska" samo zato što je i u nazivu škole.
    """
    cilj = "".join(bez_dijakritike(dio) for dio in re.split(r"\W+", naziv_skole) if dio)
    if not cilj:
        return rijeci
    for pocetak in range(len(rijeci)):
        spojeno = ""
        for kraj in range(pocetak, len(rijeci)):
            spojeno += bez_dijakritike(rijeci[kraj])
            if spojeno == cilj:
                return rijeci[:pocetak] + rijeci[kraj + 1:]
            if len(spojeno) > len(cilj):
                break
    return rijeci


def oznaka_i_razred(url: str, naziv_skole: str) -> tuple[str | None, str]:
    """Iz naziva datoteke izvuci razred i čitljivu oznaku smjera."""
    ime = unquote(str(url).rsplit("/", 1)[-1])
    ime = re.sub(r"\.(pdf|docx?|xlsx?|pptx?|html?)$", "", ime, flags=re.I)
    tekst = re.sub(r"[-_+%]+", " ", ime)
    tekst = re.sub(r"\s+", " ", tekst).strip()

    pogodak = re.search(r"(?<!\d)([1-5])\s*\.?\s*([a-eA-E])?\s*\.?\s*(?:razred|r\b)", tekst, re.I)
    razred = pogodak.group(1) if pogodak else None
    odjeljenje = (pogodak.group(2) or "").lower() if pogodak else ""
    ostatak = (tekst[: pogodak.start()] + " " + tekst[pogodak.end():]) if pogodak else tekst

    rijeci = [
        rijec for rijec in re.split(r"[\s.,()]+", ostatak)
        if rijec
        and bez_dijakritike(rijec) not in GENERICKE_RIJECI
        and not re.fullmatch(r"\d+", rijec)
        and len(rijec) > 1
    ]
    smjer = " ".join(ukloni_naziv_skole(rijeci, naziv_skole)).strip()

    if razred and smjer:
        prefiks = f"{razred}.{odjeljenje}" if odjeljenje else f"{razred}. razred"
        return razred, f"{prefiks} — {smjer}"
    if razred:
        return razred, f"{razred}.{odjeljenje} razred" if odjeljenje else f"{razred}. razred"
    if smjer:
        return None, smjer
    return None, "Popis udžbenika"


def razred_iz_stupca(vrijednost) -> str | None:
    pogodak = re.match(r"\s*([1-5])", str(vrijednost or ""))
    return pogodak.group(1) if pogodak else None


def ucitaj_status() -> list[tuple[str, str]]:
    """[(županija, škola)] za sve škole u opsegu, bez duplikata."""
    knjiga = openpyxl.load_workbook(IZLAZ_2627 / "Izvjestaj_provjere_2026_27.xlsx", read_only=True)
    vidjeno: dict[str, tuple[str, str]] = {}
    for redak in knjiga["STATUS_2026_27"].iter_rows(min_row=2, values_only=True):
        zupanija, skola = redak[1], redak[2]
        if skola:
            vidjeno.setdefault(str(skola), (str(zupanija or ""), str(skola)))
    knjiga.close()
    return list(vidjeno.values())


def ucitaj_stranice() -> dict[str, str]:
    """Naziv škole -> stranica s popisima."""
    putanja = IZLAZ_2627 / "FINALNA_provjera_popisa_oznaceno.csv"
    with putanja.open(encoding="utf-8-sig") as dat:
        return {
            str(r["Škola"]): str(r["Link na popis"])
            for r in csv.DictReader(dat)
            if r.get("Škola") and r.get("Link na popis")
        }


def ucitaj_dokumente() -> dict[str, dict[str, str | None]]:
    """Sirovi naziv škole -> {url: razred iz stupca}, bez duplikata po URL-u."""
    knjiga = openpyxl.load_workbook(IZLAZ_2627 / "Udzbenici_2026_27.xlsx", read_only=True)
    po_skoli: dict[str, dict[str, str | None]] = {}
    for redak in knjiga["UDZBENICI"].iter_rows(min_row=2, values_only=True):
        skola, razred_stupac, url = redak[1], redak[2], redak[13]
        if not skola or not url:
            continue
        po_skoli.setdefault(str(skola), {}).setdefault(str(url), razred_iz_stupca(razred_stupac))
    knjiga.close()
    return po_skoli


def sastavi_dokumente(sirovi: dict[str, str | None], naziv: str) -> list[dict]:
    """Oznaka se računa tek ovdje, jer traži ispravljen naziv škole."""
    dokumenti = []
    for url, razred_stupca in sirovi.items():
        razred, oznaka = oznaka_i_razred(url, naziv)
        if razred is None:
            razred = razred_stupca
            if razred and oznaka == "Popis udžbenika":
                oznaka = f"{razred}. razred"
        dokumenti.append({"razred": razred, "oznaka": oznaka, "url": url})
    return sorted(dokumenti, key=lambda d: (d["razred"] or "9", d["oznaka"]))


def main() -> int:
    razclanik = argparse.ArgumentParser(description="Izvoz popisa udžbenika za bot.")
    razclanik.add_argument("--izlaz", required=True, help="Putanja do izlazne JSON datoteke.")
    argumenti = razclanik.parse_args()

    registar = ucitaj_registar()
    stranice = ucitaj_stranice()
    dokumenti = ucitaj_dokumente()

    skole = []
    for zupanija, sirovi_naziv in ucitaj_status():
        naziv = popravi_naziv(sirovi_naziv, registar)
        skole.append({
            "id": slug(naziv),
            "naziv": naziv,
            "zupanija": popravi_naziv(zupanija, registar),
            "stranica": stranice.get(sirovi_naziv),
            "dokumenti": sastavi_dokumente(dokumenti.get(sirovi_naziv, {}), naziv),
        })
    skole.sort(key=lambda s: s["naziv"])

    neispravni = [s["naziv"] for s in skole if "?" in s["naziv"]]
    if neispravni:
        print("GREŠKA: nazivi s nerekonstruiranim dijakriticima:", file=sys.stderr)
        for naziv in neispravni:
            print(f"  {naziv}", file=sys.stderr)
        print("Dodaj ih u RUCNI_ISPRAVCI pa ponovi izvoz.", file=sys.stderr)
        return 1

    sadrzaj = {
        "godina": GODINA,
        "generirano": date.today().isoformat(),
        "skole": skole,
    }
    putanja = Path(argumenti.izlaz)
    putanja.parent.mkdir(parents=True, exist_ok=True)
    putanja.write_text(
        json.dumps(sadrzaj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    s_popisom = sum(1 for s in skole if s["dokumenti"])
    ukupno_dokumenata = sum(len(s["dokumenti"]) for s in skole)
    print(f"Zapisano {putanja}")
    print(f"  škola ukupno:      {len(skole)}")
    print(f"  s popisom 26/27:   {s_popisom}")
    print(f"  dokumenata:        {ukupno_dokumenata}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Pokreni izvoz**

```bash
cd "/Users/zrinko/Documents/Code Projects/popis-udzbenika"
.venv/bin/python izvoz_za_bot.py \
  --izlaz "/Users/zrinko/Documents/Code Projects/libar-zendesk-bot-v2/data/popis-udzbenika-2026-27.json"
```

Očekivano: izlazni kod 0, oko 282 škole ukupno, oko 161 s popisom, oko 900 dokumenata.

Ako skripta izađe s kodom 1 i ispiše nazive s `?`, dodaj ih u `RUCNI_ISPRAVCI` s ispravnim dijakriticima i ponovi. **Ne** zaobilazi provjeru.

- [ ] **Step 3: Provjeri sadržaj JSON-a**

```bash
cd "/Users/zrinko/Documents/Code Projects/libar-zendesk-bot-v2"
node -e '
const d = require("./data/popis-udzbenika-2026-27.json");
const s = d.skole.find((x) => x.naziv === "Gimnazija Daruvar");
console.log("godina:", d.godina);
console.log("skola:", s.naziv, "| dokumenata:", s.dokumenti.length);
console.log(JSON.stringify(s.dokumenti, null, 2));
const m = d.skole.find((x) => x.naziv === "Medicinska škola Bjelovar");
console.log("Medicinska 1. razred:", m.dokumenti.filter((x) => x.razred === "1").map((x) => x.oznaka));
console.log("s upitnikom u nazivu:", d.skole.filter((x) => x.naziv.includes("?")).length);
'
```

Očekivano: `godina` je `2026./2027.`, Gimnazija Daruvar ima barem jedan dokument s `razred: "2"`, Medicinska škola Bjelovar ima više oznaka za 1. razred s nazivima smjerova, broj naziva s upitnikom je **0**.

- [ ] **Step 4: Commit u oba repoa**

Commitaj **samo** navedene datoteke. U `popis-udzbenika` postoje nespremljene izmjene u `output/` — ne diraj ih.

```bash
cd "/Users/zrinko/Documents/Code Projects/popis-udzbenika"
git add izvoz_za_bot.py
git commit -m "feat: izvoz popisa udžbenika u JSON za Libar bota"

cd "/Users/zrinko/Documents/Code Projects/libar-zendesk-bot-v2"
git add data/popis-udzbenika-2026-27.json
git commit -m "data: popis udžbenika 2026./2027. po školi i razredu"
```

---

### Task 2: Servis — učitavanje i prepoznavanje škole

**Files:**
- Create: `libar-zendesk-bot-v2/services/textbookListService.js`
- Create: `libar-zendesk-bot-v2/tests/textbookListService.test.js`

**Interfaces:**
- Consumes: `data/popis-udzbenika-2026-27.json` (Task 1), `normalizeForSearch` iz `services/textUtils`
- Produces:
  - `loadIndex(filePath?) -> { godina, generirano, skole, idf }` — učita i memoizira
  - `rankSchools(text, { minCoverage?, minScore? }?) -> [{ school, score, coverage }]` — sortirano silazno
  - `findSchool(text) -> { status: "match", school } | { status: "ambiguous", candidates } | { status: "none" }`

Prepoznavanje je otporno na tri vrste nepreciznog upisa:

| Upis | Kako se hvata |
|---|---|
| bez dijakritike, velika/mala slova, crtice i razmaci | `normalizeForSearch` nad upitom i nazivom — isti niz tokena |
| padeži (`daruvaru`, `šibeniku`) | podudaranje po prefiksu, težina 0,7 |
| tipfeleri (`gimanzija`, `bjelovr`) | uređivačka udaljenost ≤1 (≤2 za tokene od 7 znakova naviše), težina 0,55 |

- [ ] **Step 1: Napiši testove za prepoznavanje škole**

Create `libar-zendesk-bot-v2/tests/textbookListService.test.js`:

```js
const { describe, it } = require("node:test");
const assert = require("node:assert");
const { findSchool } = require("../services/textbookListService");

describe("textbookListService", () => {
  describe("findSchool", () => {
    it("prepoznaje školu po točnom nazivu", () => {
      const r = findSchool("trebam popis udžbenika za Gimnaziju Daruvar");
      assert.strictEqual(r.status, "match");
      assert.strictEqual(r.school.naziv, "Gimnazija Daruvar");
    });

    it("prepoznaje školu bez dijakritike", () => {
      const r = findSchool("popis udzbenika medicinska skola bjelovar");
      assert.strictEqual(r.status, "match");
      assert.strictEqual(r.school.naziv, "Medicinska škola Bjelovar");
    });

    it("prepoznaje školu bez obzira na velika slova i crtice", () => {
      const r = findSchool("POPIS UDŽBENIKA — GIMNAZIJA DARUVAR");
      assert.strictEqual(r.status, "match");
      assert.strictEqual(r.school.naziv, "Gimnazija Daruvar");
    });

    it("podnosi padež u nazivu grada", () => {
      const r = findSchool("popis udžbenika za gimnaziju u Daruvaru");
      assert.strictEqual(r.status, "match");
      assert.strictEqual(r.school.naziv, "Gimnazija Daruvar");
    });

    it("podnosi tipfeler u nazivu", () => {
      const r = findSchool("popis udzbenika gimanzija daruvar");
      assert.strictEqual(r.status, "match");
      assert.strictEqual(r.school.naziv, "Gimnazija Daruvar");
    });

    it("podnosi tipfeler u nazivu grada", () => {
      const r = findSchool("popis udzbenika medicinska skola bjelovr");
      assert.strictEqual(r.status, "match");
      assert.strictEqual(r.school.naziv, "Medicinska škola Bjelovar");
    });

    it("ne pogađa školu iz generičnog upita", () => {
      assert.strictEqual(findSchool("kako naručiti udžbenike?").status, "none");
      assert.strictEqual(findSchool("otkupljujete li udžbenike?").status, "none");
      assert.strictEqual(findSchool("koliko košta dostava?").status, "none");
    });

    it("ne pogađa školu iz same riječi gimnazija", () => {
      assert.notStrictEqual(findSchool("trebam popis za gimnaziju").status, "match");
    });

    it("nema nijedan naziv škole s pokvarenim dijakriticima", () => {
      const r = findSchool("Gimnazija Antuna Vrančića Šibenik");
      assert.strictEqual(r.status, "match");
      assert.ok(!r.school.naziv.includes("?"), `naziv sadrži upitnik: ${r.school.naziv}`);
    });
  });
});
```

- [ ] **Step 2: Pokreni testove i potvrdi da padaju**

Run: `cd "/Users/zrinko/Documents/Code Projects/libar-zendesk-bot-v2" && NODE_ENV=test node --test tests/textbookListService.test.js 2>&1 | tail -20`

Expected: FAIL — `Cannot find module '../services/textbookListService'`

- [ ] **Step 3: Napiši servis (učitavanje + prepoznavanje škole)**

Create `libar-zendesk-bot-v2/services/textbookListService.js`:

```js
/**
 * Popis udžbenika po školi i razredu (samo web chat)
 *
 * Deterministički odgovara na upite tipa "popis udžbenika za Gimnaziju Daruvar,
 * 2. razred" linkom na dokument koji je škola objavila za 2026./2027.
 * Podaci su statični JSON generiran iz projekta popis-udzbenika — bez mreže,
 * bez LLM poziva.
 *
 * Škola se prepoznaje bodovanjem tokena naziva po IDF-u: generične riječi
 * ("škola", "srednja", "gimnazija") nose malu težinu, nazivi gradova i vlastita
 * imena veliku. Da bi se škola smatrala prepoznatom, mora prijeći prag
 * pokrivenosti I imati jasan odmak od drugoplasirane — inače radije pitamo.
 */
const fs = require("fs");
const path = require("path");
const { normalizeForSearch } = require("./textUtils");

const DATA_PATH = path.join(__dirname, "..", "data", "popis-udzbenika-2026-27.json");

// Udio težine naziva škole koji upit mora pokriti da bismo je uzeli u obzir.
const MIN_COVERAGE = 0.5;
// Minimalni zbroj IDF-a — sprječava pogodak na samim generičnim riječima.
const MIN_SCORE = 3.0;
// Koliko najbolja mora nadmašiti drugu da bismo bili sigurni.
const MARGIN = 1.35;
// Podudaranje po prefiksu hvata padeže ("daruvaru" ~ "daruvar").
const PREFIX_LEN = 4;
const PREFIX_WEIGHT = 0.7;
const MAX_LEN_DIFF = 3;
// Uređivačka udaljenost hvata tipfelere ("gimanzija" ~ "gimnazija").
const TYPO_MIN_LEN = 4;
const TYPO_LONG_LEN = 7;
const TYPO_WEIGHT = 0.55;

let index = null;

function tokenize(value) {
  return normalizeForSearch(value).split(" ").filter((token) => token.length >= 2);
}

function loadIndex(filePath = DATA_PATH) {
  if (index) return index;
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const skole = raw.skole.map((skola) => ({ ...skola, tokens: [...new Set(tokenize(skola.naziv))] }));

  const df = new Map();
  skole.forEach((skola) => skola.tokens.forEach((token) => df.set(token, (df.get(token) || 0) + 1)));

  const idf = new Map();
  df.forEach((count, token) => idf.set(token, Math.log(skole.length / count) + 0.1));

  skole.forEach((skola) => {
    skola.maxScore = skola.tokens.reduce((sum, token) => sum + idf.get(token), 0);
  });

  index = { godina: raw.godina, generirano: raw.generirano, skole, idf };
  return index;
}

function matchesByPrefix(queryToken, schoolToken) {
  if (queryToken.length < PREFIX_LEN || schoolToken.length < PREFIX_LEN) return false;
  if (Math.abs(queryToken.length - schoolToken.length) > MAX_LEN_DIFF) return false;
  return queryToken.slice(0, PREFIX_LEN) === schoolToken.slice(0, PREFIX_LEN);
}

// Levenshtein s ranim prekidom — zanima nas samo je li udaljenost unutar praga.
function withinEditDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < best) best = curr[j];
    }
    if (best > max) return false;
    prev = curr;
  }
  return prev[b.length] <= max;
}

function matchesByTypo(queryToken, schoolToken) {
  if (queryToken.length < TYPO_MIN_LEN || schoolToken.length < TYPO_MIN_LEN) return false;
  const max = schoolToken.length >= TYPO_LONG_LEN ? 2 : 1;
  return withinEditDistance(queryToken, schoolToken, max);
}

function scoreSchool(skola, queryTokens, idf) {
  let score = 0;
  for (const schoolToken of skola.tokens) {
    const weight = idf.get(schoolToken);
    if (queryTokens.includes(schoolToken)) {
      score += weight;
    } else if (queryTokens.some((queryToken) => matchesByPrefix(queryToken, schoolToken))) {
      score += weight * PREFIX_WEIGHT;
    } else if (queryTokens.some((queryToken) => matchesByTypo(queryToken, schoolToken))) {
      score += weight * TYPO_WEIGHT;
    }
  }
  return { score, coverage: skola.maxScore ? score / skola.maxScore : 0 };
}

function rankSchools(text, { minCoverage = MIN_COVERAGE, minScore = MIN_SCORE } = {}) {
  const idx = loadIndex();
  const queryTokens = tokenize(text);
  if (!queryTokens.length) return [];
  return idx.skole
    .map((skola) => ({ school: skola, ...scoreSchool(skola, queryTokens, idx.idf) }))
    .filter((row) => row.coverage >= minCoverage && row.score >= minScore)
    .sort((a, b) => b.score - a.score);
}

function findSchool(text) {
  const scored = rankSchools(text);
  if (!scored.length) return { status: "none" };

  const [best, second] = scored;
  if (!second || best.score >= second.score * MARGIN) {
    return { status: "match", school: best.school };
  }
  return { status: "ambiguous", candidates: scored.slice(0, 3).map((row) => row.school) };
}

module.exports = { loadIndex, rankSchools, findSchool };
```

- [ ] **Step 4: Pokreni testove i podesi konstante dok ne prođu**

Run: `cd "/Users/zrinko/Documents/Code Projects/libar-zendesk-bot-v2" && NODE_ENV=test node --test tests/textbookListService.test.js 2>&1 | tail -30`

Expected: PASS.

Ako neki test padne, **podesi konstante** (`MIN_COVERAGE`, `MIN_SCORE`, `MARGIN`), nikako ne mijenjaj očekivanja u testovima — testovi opisuju traženo ponašanje. Za dijagnostiku:

```bash
node -e '
const s = require("./services/textbookListService");
const upiti = [
  "trebam popis udžbenika za Gimnaziju Daruvar",
  "popis udzbenika medicinska skola bjelovar",
  "POPIS UDŽBENIKA — GIMNAZIJA DARUVAR",
  "popis udžbenika za gimnaziju u Daruvaru",
  "popis udzbenika gimanzija daruvar",
  "popis udzbenika medicinska skola bjelovr",
  "kako naručiti udžbenike?",
  "trebam popis za gimnaziju"
];
for (const q of upiti) {
  const r = s.rankSchools(q).slice(0, 3)
    .map((x) => `${x.school.naziv} (score ${x.score.toFixed(2)}, cov ${x.coverage.toFixed(2)})`);
  console.log(q, "->", s.findSchool(q).status, "|", r.join(" ; ") || "-");
}
'
```

- [ ] **Step 5: Commit**

```bash
cd "/Users/zrinko/Documents/Code Projects/libar-zendesk-bot-v2"
git add services/textbookListService.js tests/textbookListService.test.js
git commit -m "feat(popis): prepoznavanje škole iz upita po IDF bodovanju"
```

---

### Task 3: Servis — razred i sastavljanje odgovora

**Files:**
- Modify: `libar-zendesk-bot-v2/services/textbookListService.js`
- Modify: `libar-zendesk-bot-v2/tests/textbookListService.test.js`

**Interfaces:**
- Consumes: `findSchool`, `rankSchools`, `loadIndex` (Task 2), `LINKS` iz `services/siteLinkService`
- Produces:
  - `parseRazred(text) -> "1"|"2"|"3"|"4"|"5"|null`
  - `buildTextbookOutcome(userMessage, session) -> outcome|null` gdje je `outcome` oblika `{ type: "safe_answer", customerMessage, stateTag: "ai_active", reason, source: "textbook_list", links: [], extraTags: [] }`
  - `DISCLAIMER` — konstanta s doslovnim tekstom

Mogući `reason`: `textbook_list`, `textbook_need_razred`, `textbook_no_razred`, `textbook_no_list`, `textbook_ambiguous_school`, `textbook_did_you_mean`.

Linkovi se ugrađuju u `customerMessage` kao markdown `[oznaka](url)`, ne u `outcome.links`. Razlog: `session.messages` čuva samo `content`, pa bi chipovi nestali pri obnovi razgovora, a u Zendesku agent ne bi vidio što je bot poslao. Widget dobiva renderer u Tasku 5.

- [ ] **Step 1: Dopiši testove za razred i odgovore**

In `libar-zendesk-bot-v2/tests/textbookListService.test.js`, replace the import line:

```js
const { findSchool } = require("../services/textbookListService");
```

with:

```js
const {
  findSchool,
  parseRazred,
  buildTextbookOutcome,
  loadIndex,
  DISCLAIMER
} = require("../services/textbookListService");
```

Then add these blocks inside the outer `describe("textbookListService", …)`, after the existing `describe("findSchool", …)`:

```js
  describe("parseRazred", () => {
    it("čita brojčani oblik", () => {
      assert.strictEqual(parseRazred("popis za 2. razred"), "2");
      assert.strictEqual(parseRazred("3 razred gimnazije"), "3");
      assert.strictEqual(parseRazred("popis za 1.a razred"), "1");
    });

    it("čita riječima pisan oblik", () => {
      assert.strictEqual(parseRazred("u drugom razredu"), "2");
      assert.strictEqual(parseRazred("prvi razred"), "1");
      assert.strictEqual(parseRazred("četvrti razred"), "4");
    });

    it("vraća null kad razreda nema", () => {
      assert.strictEqual(parseRazred("trebam popis udžbenika"), null);
      assert.strictEqual(parseRazred("imam 3 udžbenika za otkup"), null);
    });
  });

  describe("buildTextbookOutcome", () => {
    it("vraća null za upite bez škole — postojeći tok ostaje netaknut", () => {
      assert.strictEqual(buildTextbookOutcome("Kako naručiti udžbenike?", {}), null);
      assert.strictEqual(buildTextbookOutcome("Otkupljujete li udžbenike?", {}), null);
      assert.strictEqual(buildTextbookOutcome("Koliko košta dostava?", {}), null);
      assert.strictEqual(buildTextbookOutcome("Pozdrav!", {}), null);
    });

    it("vraća null kad je škola prepoznata ali upit nije o popisu", () => {
      assert.strictEqual(buildTextbookOutcome("radim u Gimnaziji Daruvar", {}), null);
    });

    it("šalje link na popis za školu i razred", () => {
      const outcome = buildTextbookOutcome("popis udžbenika Gimnazija Daruvar 2. razred", {});
      assert.strictEqual(outcome.type, "safe_answer");
      assert.strictEqual(outcome.source, "textbook_list");
      assert.strictEqual(outcome.stateTag, "ai_active");
      assert.match(outcome.customerMessage, /Gimnazija Daruvar/);
      assert.match(outcome.customerMessage, /\[[^\]]+\]\(https:\/\/[^)]+\)/);
    });

    it("uz svaki popis prilaže disclaimer", () => {
      const outcome = buildTextbookOutcome("popis udžbenika Gimnazija Daruvar 2. razred", {});
      assert.ok(outcome.customerMessage.includes(DISCLAIMER));
      assert.match(DISCLAIMER, /informativnog karaktera/);
      assert.match(DISCLAIMER, /ne odgovara za eventualne netočnosti/);
    });

    it("izlistava sve smjerove kad ih škola ima više", () => {
      const outcome = buildTextbookOutcome("popis udžbenika Medicinska škola Bjelovar 1. razred", {});
      const linkovi = outcome.customerMessage.match(/\[[^\]]+\]\(https:\/\/[^)]+\)/g) || [];
      assert.ok(linkovi.length >= 3, `očekivano više linkova, dobiveno ${linkovi.length}`);
    });

    it("nudi kandidate kad je naziv škole nepotpun ili pogrešno upisan", () => {
      const outcome = buildTextbookOutcome("trebam popis udžbenika za medicinsku u Bjelovaru", {});
      assert.ok(outcome, "očekivan je odgovor s kandidatima");
      assert.ok(
        ["textbook_did_you_mean", "textbook_ambiguous_school", "textbook_need_razred"].includes(outcome.reason),
        `neočekivan reason: ${outcome.reason}`
      );
      assert.match(outcome.customerMessage, /Bjelovar/);
    });

    it("pita za razred kad ga upit ne sadrži i pamti školu u sesiji", () => {
      const session = {};
      const outcome = buildTextbookOutcome("popis udžbenika Gimnazija Daruvar", session);
      assert.strictEqual(outcome.reason, "textbook_need_razred");
      assert.match(outcome.customerMessage, /razred/i);
      assert.ok(session.textbookSchoolId, "škola nije zapamćena u sesiji");
    });

    it("nastavlja iz sesije kad korisnik odgovori samo razredom", () => {
      const session = {};
      buildTextbookOutcome("popis udžbenika Gimnazija Daruvar", session);
      const outcome = buildTextbookOutcome("2. razred", session);
      assert.strictEqual(outcome.reason, "textbook_list");
      assert.match(outcome.customerMessage, /Gimnazija Daruvar/);
      assert.strictEqual(session.textbookSchoolId, undefined, "sesija nije očišćena");
    });

    it("kaže da popis još nije objavljen kad škola nema dokumenata", () => {
      // Uzmi prvu školu bez dokumenata koju matcher pouzdano prepoznaje po nazivu.
      const bez = loadIndex().skole.find((s) => {
        if (s.dokumenti.length) return false;
        const pogodak = findSchool(s.naziv);
        return pogodak.status === "match" && pogodak.school.id === s.id;
      });
      assert.ok(bez, "u podacima nema nijedne prepoznatljive škole bez popisa");

      const outcome = buildTextbookOutcome(`popis udžbenika ${bez.naziv}`, {});
      assert.strictEqual(outcome.reason, "textbook_no_list");
      assert.match(outcome.customerMessage, /još nije objavljen/i);
      assert.ok(!/\.pdf|\.docx/i.test(outcome.customerMessage), "poslan je link na dokument");
    });
  });
```

- [ ] **Step 2: Pokreni testove i potvrdi da padaju**

Run: `cd "/Users/zrinko/Documents/Code Projects/libar-zendesk-bot-v2" && NODE_ENV=test node --test tests/textbookListService.test.js 2>&1 | tail -30`

Expected: FAIL — `parseRazred is not a function`

- [ ] **Step 3: Dopiši servis**

First, in `libar-zendesk-bot-v2/services/textbookListService.js`, add to the requires at the top of the file, after `const { normalizeForSearch } = require("./textUtils");`:

```js
const { LINKS } = require("./siteLinkService");
```

Then add the following after the `findSchool` function, before `module.exports`:

```js
const DISCLAIMER = [
  "Napomena: popis je informativnog karaktera i preuzet je iz javno dostupne baze",
  "podataka (stranice škola). Antikvarijat Libar ne odgovara za eventualne netočnosti",
  "ili naknadne izmjene — službeni popis provjerite kod svoje škole."
].join(" ");

// Upit mora spominjati udžbenike/popis da gate uopće opali. Bez ovoga bi
// "radim u Gimnaziji Daruvar" oteo razgovor.
const TEXTBOOK_RE = /\budzbenik|\bpopis|\bknjig/;

// Blaži prag za "jeste li mislili" — popušta se samo pokrivenost, nikad
// MIN_SCORE, da nedovoljno određen upit ne izvuče nasumične kandidate.
const RELAXED_COVERAGE = 0.34;

const RAZRED_RIJECI = {
  prvi: "1", prvom: "1", prvog: "1", prva: "1",
  drugi: "2", drugom: "2", drugog: "2", druga: "2",
  treci: "3", trecem: "3", treceg: "3", treca: "3",
  cetvrti: "4", cetvrtom: "4", cetvrtog: "4", cetvrta: "4",
  peti: "5", petom: "5", petog: "5", peta: "5"
};

function parseRazred(text) {
  const norm = normalizeForSearch(text);
  const brojcani = norm.match(/\b([1-5])\s*[a-e]?\s*razred/);
  if (brojcani) return brojcani[1];
  const rijecima = norm.match(
    /\b(prvi|prvom|prvog|prva|drugi|drugom|drugog|druga|treci|trecem|treceg|treca|cetvrti|cetvrtom|cetvrtog|cetvrta|peti|petom|petog|peta)\s+razred/
  );
  if (rijecima) return RAZRED_RIJECI[rijecima[1]];
  return null;
}

function markdownLink(label, url) {
  return `- [${label}](${url})`;
}

function safeAnswer(customerMessage, reason) {
  return {
    type: "safe_answer",
    customerMessage,
    stateTag: "ai_active",
    reason,
    source: "textbook_list",
    links: [],
    extraTags: []
  };
}

function buildListAnswer(skola, razred, godina) {
  const dokumenti = skola.dokumenti.filter((d) => d.razred === razred || d.razred === null);
  if (!dokumenti.length) return buildNoRazredAnswer(skola, razred, godina);

  const uvod = dokumenti.length > 1
    ? `${skola.naziv} objavljuje popis po smjerovima. Evo svih popisa za ${razred}. razred (${godina}):`
    : `Evo popisa udžbenika za ${razred}. razred — ${skola.naziv} (${godina}):`;

  const redci = [uvod, "", ...dokumenti.map((d) => markdownLink(d.oznaka, d.url)), "", DISCLAIMER];
  return safeAnswer(redci.join("\n"), "textbook_list");
}

function buildNoRazredAnswer(skola, razred, godina) {
  const redci = [
    `Za ${skola.naziv} nemam popis udžbenika za ${razred}. razred (${godina}) — škole ih objavljuju tijekom ljeta, pa pokušajte ponovno za koji dan.`,
    ""
  ];
  if (skola.stranica) redci.push(markdownLink("Stranica škole s popisima", skola.stranica));
  redci.push(markdownLink("Udžbenike možete potražiti u našem webshopu", LINKS.buyBooks.url));
  return safeAnswer(redci.join("\n"), "textbook_no_razred");
}

function buildNoListAnswer(skola, godina) {
  const redci = [
    `Za ${skola.naziv} popis udžbenika za ${godina} još nije objavljen — škole ih objavljuju tijekom ljeta, pa pokušajte ponovno za koji dan.`,
    ""
  ];
  if (skola.stranica) redci.push(markdownLink("Stranica škole s popisima", skola.stranica));
  redci.push(markdownLink("Udžbenike možete potražiti u našem webshopu", LINKS.buyBooks.url));
  return safeAnswer(redci.join("\n"), "textbook_no_list");
}

function buildAskRazredAnswer(skola, session) {
  session.textbookSchoolId = skola.id;
  const razredi = [...new Set(skola.dokumenti.map((d) => d.razred).filter(Boolean))].sort();
  const popisRazreda = razredi.length ? ` Imam popise za: ${razredi.map((r) => `${r}. razred`).join(", ")}.` : "";
  return safeAnswer(
    `Za koji razred trebate popis udžbenika u ${skola.naziv}?${popisRazreda}`,
    "textbook_need_razred"
  );
}

function buildCandidatesAnswer(candidates, session, uvod, reason) {
  delete session.textbookSchoolId;
  const redci = [
    uvod,
    "",
    ...candidates.map((skola) => `- ${skola.naziv}`),
    "",
    "Napišite puni naziv škole i razred, pa Vam šaljem popis."
  ];
  return safeAnswer(redci.join("\n"), reason);
}

function buildTextbookOutcome(userMessage, session = {}) {
  const idx = loadIndex();
  const razred = parseRazred(userMessage);
  const norm = normalizeForSearch(userMessage);

  // Nastavak razgovora: školu smo zapamtili, korisnik je dopisao samo razred.
  if (session.textbookSchoolId) {
    const zapamcena = session.textbookSchoolId;
    // Marker vrijedi samo za sljedeću poruku — inače bi kasniji spomen razreda
    // u nevezanom razgovoru izvukao popis niotkuda.
    delete session.textbookSchoolId;
    if (razred) {
      const skola = idx.skole.find((s) => s.id === zapamcena);
      if (skola) {
        return skola.dokumenti.length
          ? buildListAnswer(skola, razred, idx.godina)
          : buildNoListAnswer(skola, idx.godina);
      }
    }
  }

  if (!TEXTBOOK_RE.test(norm)) return null;

  const pogodak = findSchool(userMessage);

  if (pogodak.status === "ambiguous") {
    return buildCandidatesAnswer(
      pogodak.candidates, session, "Na koju školu mislite?", "textbook_ambiguous_school"
    );
  }

  if (pogodak.status === "none") {
    // Strogi prag nije prošao, a upit očito traži popis — vjerojatno je naziv
    // upisan nepotpuno ili s greškom. Ponudi najbliže umjesto tihog odustajanja.
    const blizi = rankSchools(userMessage, { minCoverage: RELAXED_COVERAGE }).slice(0, 3);
    if (!blizi.length) return null;
    return buildCandidatesAnswer(
      blizi.map((row) => row.school), session,
      "Nisam siguran na koju školu mislite. Jeste li mislili na neku od ovih?",
      "textbook_did_you_mean"
    );
  }

  const skola = pogodak.school;
  if (!skola.dokumenti.length) return buildNoListAnswer(skola, idx.godina);
  if (!razred) return buildAskRazredAnswer(skola, session);
  return buildListAnswer(skola, razred, idx.godina);
}
```

Then update the exports at the bottom of the file:

```js
module.exports = {
  loadIndex,
  rankSchools,
  findSchool,
  parseRazred,
  buildTextbookOutcome,
  DISCLAIMER
};
```

- [ ] **Step 4: Pokreni testove i potvrdi da prolaze**

Run: `cd "/Users/zrinko/Documents/Code Projects/libar-zendesk-bot-v2" && NODE_ENV=test node --test tests/textbookListService.test.js 2>&1 | tail -30`

Expected: PASS, svi testovi.

- [ ] **Step 5: Commit**

```bash
cd "/Users/zrinko/Documents/Code Projects/libar-zendesk-bot-v2"
git add services/textbookListService.js tests/textbookListService.test.js
git commit -m "feat(popis): razred iz upita i sastavljanje odgovora s disclaimerom"
```

---

### Task 4: Uklapanje u pipeline bota

**Files:**
- Modify: `libar-zendesk-bot-v2/config/env.js`
- Modify: `libar-zendesk-bot-v2/index.js` (import blok oko linije 47; gate u `_resolveAutomatedOutcome` iza intent-escalation gatea, oko linije 348)
- Modify: `libar-zendesk-bot-v2/.env.example`
- Modify: `libar-zendesk-bot-v2/tests/textbookListService.test.js`

**Interfaces:**
- Consumes: `buildTextbookOutcome(userMessage, session)` (Task 3)
- Produces: `env.POPIS_UDZBENIKA_ENABLED` (boolean, default `true`)

- [ ] **Step 1: Napiši test da gate ne dira postojeće ponašanje**

Add to `libar-zendesk-bot-v2/tests/textbookListService.test.js`, unutar vanjskog `describe("textbookListService", …)`:

```js
  describe("gate ne otima postojeće upite", () => {
    const POSTOJECI_UPITI = [
      "Kako naručiti udžbenike?",
      "Otkupljujete li udžbenike fizike?",
      "Koliko dobivam za otkup udžbenika matematike?",
      "Koja je cijena udžbenika za 3. razred gimnazije?",
      "Kako mogu prodati svoje udžbenike",
      "Imate li udžbenike za prvi razred",
      "Koliko košta dostava za više udžbenika?",
      "Želim reklamirati oštećenu knjigu",
      "Pozdrav"
    ];

    for (const upit of POSTOJECI_UPITI) {
      it(`ne aktivira se na: ${upit}`, () => {
        assert.strictEqual(buildTextbookOutcome(upit, {}), null);
      });
    }
  });
```

- [ ] **Step 2: Pokreni test i potvrdi rezultat**

Run: `cd "/Users/zrinko/Documents/Code Projects/libar-zendesk-bot-v2" && NODE_ENV=test node --test tests/textbookListService.test.js 2>&1 | tail -30`

Expected: PASS. Ako neki upit padne, znači da matcher prepoznaje školu ondje gdje je nema — podigni `MIN_SCORE`, `MIN_COVERAGE` ili `RELAXED_COVERAGE` u servisu i ponovi. Nikad ne uklanjaj upit iz liste: ovi upiti su regresijski štit za postojeće ponašanje bota.

- [ ] **Step 3: Dodaj zastavicu u konfiguraciju**

In `libar-zendesk-bot-v2/config/env.js`, add before the closing `};` (iza `--- Spam ---` bloka):

```js

  // --- Popis udžbenika ---
  // Deterministički odgovor s linkom na popis udžbenika škole (samo web chat).
  // Postavi POPIS_UDZBENIKA_ENABLED=false da se ugasi bez diranja koda.
  POPIS_UDZBENIKA_ENABLED: envBool("POPIS_UDZBENIKA_ENABLED", true),
```

In `libar-zendesk-bot-v2/.env.example`, add at the end:

```
# Popis udžbenika po školi i razredu u web chatu (true/false, zadano true)
POPIS_UDZBENIKA_ENABLED=true
```

- [ ] **Step 4: Uveži servis u index.js**

In `libar-zendesk-bot-v2/index.js`, after the line `const { isLikelyEmail, buildSelfServiceFallback, resolveAnonymousEscalation } = require("./services/escalationFlowService");` add:

```js
const textbookListService = require("./services/textbookListService");
```

- [ ] **Step 5: Dodaj gate u `_resolveAutomatedOutcome`**

In `libar-zendesk-bot-v2/index.js`, in `_resolveAutomatedOutcome`, immediately after the intent-escalation block (the one ending with the `}` that closes `if (escalationCheck.shouldEscalate) { … }`) and **before** the line `// Reference facts check (greetings, canned facts) — only after escalation gates`, insert:

```js
  // ── POPIS UDŽBENIKA (samo web chat) ───────────────────────────
  // Deterministički odgovor s linkom na popis koji je škola objavila za tekuću
  // godinu. Stoji iza escalation gateova (žalbe i reklamacije uvijek idu čovjeku)
  // i ispred cachea i pretrage znanja, pa nepotrebno ne troši LLM pozive.
  // Bez pogotka vraća null i pipeline teče nepromijenjeno.
  if (env.POPIS_UDZBENIKA_ENABLED && (opts.channelType || "web_chat") === "web_chat") {
    const textbookOutcome = textbookListService.buildTextbookOutcome(userMessage, session);
    if (textbookOutcome) {
      metricsService.recordDecision(textbookOutcome.type);
      metricsService.recordChannelOutcome("web_chat", textbookOutcome.type);
      metricsService.recordLatency(Date.now() - start);
      log.info("textbook_list_answer", { reason: textbookOutcome.reason });
      return { knowledge: null, outcome: textbookOutcome };
    }
  }
```

- [ ] **Step 6: Pokreni cijeli unit paket**

Run: `cd "/Users/zrinko/Documents/Code Projects/libar-zendesk-bot-v2" && npm run test:unit 2>&1 | tail -30`

Expected: PASS — svi postojeći testovi prolaze nepromijenjeni, plus novi. Ako padne neki postojeći test, gate otima upit koji ne bi smio; popravi servis, ne test.

- [ ] **Step 7: Provjeri da se server podiže**

Run: `cd "/Users/zrinko/Documents/Code Projects/libar-zendesk-bot-v2" && node -e 'require("./config/env"); const s = require("./services/textbookListService"); const i = s.loadIndex(); console.log("skola:", i.skole.length, "| godina:", i.godina);'`

Expected: ispisuje broj škola (oko 282) i godinu `2026./2027.`

- [ ] **Step 8: Commit**

```bash
cd "/Users/zrinko/Documents/Code Projects/libar-zendesk-bot-v2"
git add config/env.js .env.example index.js tests/textbookListService.test.js
git commit -m "feat(popis): gate za popis udžbenika u web chat pipelineu"
```

---

### Task 5: Renderiranje linkova u widgetu

Widget trenutno postavlja `msg.innerHTML = content` i pretvara samo `**bold**` i `\n`. Markdown linkovi bi se prikazali kao goli tekst. Uz renderer dolazi i escapanje HTML-a — nužno jer sada u sadržaju namjerno gradimo `<a>` element, pa sve ostalo mora biti neutralizirano.

**Files:**
- Modify: `libar-zendesk-bot-v2/public/index.html:365-385` (funkcija `addMessage`)

**Interfaces:**
- Consumes: `customerMessage` s markdown linkovima `[oznaka](https://…)` (Task 3)
- Produces: ništa za druge taskove

- [ ] **Step 1: Zamijeni sastavljanje sadržaja poruke**

In `libar-zendesk-bot-v2/public/index.html`, replace this line inside `addMessage`:

```js
      msg.innerHTML = content.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br>");
```

with:

```js
      msg.innerHTML = renderContent(content);
```

- [ ] **Step 2: Dodaj renderer**

In `libar-zendesk-bot-v2/public/index.html`, insert immediately before `function addMessage(role, content, links) {`:

```js
    // Sadržaj poruke se escapa pa se tek onda ubacuje ograničen markdown:
    // linkovi (samo http/https) i podebljanje. Bez escapanja bi bilo koji HTML
    // iz odgovora završio u DOM-u.
    function renderContent(text) {
      return String(text || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
          '<a href="$2" target="_blank" rel="noopener">$1</a>')
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\n/g, "<br>");
    }
```

- [ ] **Step 3: Provjeri renderer u izolaciji**

Run:

```bash
cd "/Users/zrinko/Documents/Code Projects/libar-zendesk-bot-v2"
node -e '
const fs = require("fs");
const html = fs.readFileSync("public/index.html", "utf8");
const src = html.match(/function renderContent[\s\S]*?\n    }/)[0];
eval(src);
console.log(renderContent("Evo popisa:\n- [2. razred](https://skola.hr/p.pdf)"));
console.log(renderContent("<img src=x onerror=alert(1)>"));
console.log(renderContent("[zlo](javascript:alert(1))"));
'
```

Expected:
- prvi red sadrži `<a href="https://skola.hr/p.pdf" target="_blank" rel="noopener">2. razred</a>`
- drugi red je escapan (`&lt;img …`), bez `<img`
- treći red ostaje goli tekst `[zlo](javascript:alert(1))`, bez `<a`

- [ ] **Step 4: Provjeri uživo u widgetu**

```bash
cd "/Users/zrinko/Documents/Code Projects/libar-zendesk-bot-v2"
npm run dev
```

Otvori `http://localhost:3000`, pošalji `popis udžbenika Gimnazija Daruvar 2. razred` i potvrdi da je popis klikabilan, da disclaimer stoji ispod, te da linkovi ostanu i nakon osvježavanja stranice. Zaustavi server nakon provjere.

- [ ] **Step 5: Commit**

```bash
cd "/Users/zrinko/Documents/Code Projects/libar-zendesk-bot-v2"
git add public/index.html
git commit -m "feat(widget): renderiranje markdown linkova uz escapanje HTML-a"
```

---

### Task 6: Dokumentacija

**Files:**
- Modify: `libar-zendesk-bot-v2/docs/developer.md`
- Modify: `libar-zendesk-bot-v2/CLAUDE.md` (popis servisa u sekciji „Mapa koda")

- [ ] **Step 1: Opiši feature i postupak osvježavanja**

In `libar-zendesk-bot-v2/docs/developer.md`, add a new section at the end:

```markdown
## Popis udžbenika po školi i razredu

Web chat odgovara linkom na popis udžbenika koji je škola objavila za tekuću
školsku godinu. Deterministički, bez LLM poziva.

- Servis: [services/textbookListService.js](../services/textbookListService.js)
- Podaci: `data/popis-udzbenika-2026-27.json` (generirani, commitani)
- Gate: `_resolveAutomatedOutcome` u [index.js](../index.js), iza escalation
  gateova i ispred cachea; aktivan samo za `channelType === "web_chat"`
- Zastavica: `POPIS_UDZBENIKA_ENABLED` (zadano `true`)

Škola se prepoznaje IDF bodovanjem tokena naziva, razred regexom. Kad je škola
nejasna ili razred nedostaje, bot pita umjesto da pogađa. Uz svaki popis ide
disclaimer da je informativan i preuzet iz javno dostupne baze.

Nepotpun ili neuredan upis naziva škole podnosi se na tri razine: dijakritici,
velika slova i interpunkcija otpadaju normalizacijom; padeži se hvataju
podudaranjem po prefiksu; tipfeleri uređivačkom udaljenošću. Kad ni to ne da
siguran pogodak, bot ponudi najbliže škole ("jeste li mislili…") umjesto da
tiho odustane.

Opseg: srednje škole u 18 županija (bez Grada Zagreba, Splitsko-dalmatinske i
Međimurske). Škole bez objavljenog popisa su u podacima s praznim `dokumenti`,
pa ih bot prepozna i kaže da popis još nije objavljen.

### Osvježavanje podataka

Kad škole objave nove popise, u projektu `popis-udzbenika` pokrenuti pipeline pa
izvoz:

```bash
cd ../popis-udzbenika
.venv/bin/python pipeline.py --ponovi-greske
.venv/bin/python izvoz_za_bot.py \
  --izlaz ../libar-zendesk-bot-v2/data/popis-udzbenika-2026-27.json
```

Izvoz pada s greškom ako neki naziv škole ostane s pokvarenim dijakriticima —
tada ga treba dodati u `RUCNI_ISPRAVCI` u `izvoz_za_bot.py`. Nakon izvoza
commitati JSON u bot repo i deployati; datoteka se učitava pri startu procesa.
```

- [ ] **Step 2: Dopiši servis u mapu koda**

In `libar-zendesk-bot-v2/CLAUDE.md`, in the „Mapa koda" section, add to the services list (iza retka koji spominje `botStateService`):

```markdown
  - `textbookListService` popis udžbenika po školi i razredu (web chat, statični podaci u `data/`)
```

- [ ] **Step 3: Commit**

```bash
cd "/Users/zrinko/Documents/Code Projects/libar-zendesk-bot-v2"
git add docs/developer.md CLAUDE.md
git commit -m "docs: popis udžbenika po školi i razredu"
```

---

## Provjera na kraju

- [ ] `npm run test:unit` prolazi u cijelosti
- [ ] `node -e 'require("./services/textbookListService").loadIndex()'` ne baca grešku
- [ ] Widget na `localhost:3000` vraća klikabilan popis za `popis udžbenika Gimnazija Daruvar 2. razred`
- [ ] Widget vraća „još nije objavljen" za školu bez popisa i **ne** šalje link na dokument
- [ ] `Kako naručiti udžbenike?` i `Otkupljujete li udžbenike?` odgovaraju kao i prije zahvata
- [ ] Disclaimer je prisutan u svakom odgovoru s popisom
- [ ] Naziv bez dijakritike, velikim slovima i s tipfelerom i dalje pogađa školu
- [ ] Nedovoljno određen naziv daje „jeste li mislili" s kandidatima, ne pogađa
