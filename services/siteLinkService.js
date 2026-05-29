/**
 * Site Link Service
 * Maps intent/domain to direct website links for enriching bot responses.
 */
const BASE_URL = "https://antikvarijat-libar.com";

const LINKS = {
  buyback: { url: `${BASE_URL}/otkup-udzbenika/`, label: "Otkup udžbenika" },
  buybackLoyalty: { url: `${BASE_URL}/program-vjernosti/`, label: "Program vjernosti" },
  buyBooks: { url: `${BASE_URL}/kupi-udzbenike/`, label: "Kupi udžbenike" },
  delivery: { url: `${BASE_URL}/troskovi-dostave/`, label: "Troškovi dostave" },
  contact: { url: `${BASE_URL}/kontakt/`, label: "Kontakt" },
  paymentMethods: { url: `${BASE_URL}/nacini-placanja/`, label: "Načini plaćanja" },
  returns: { url: `${BASE_URL}/povrat-i-zamjena/`, label: "Povrat i zamjena" },
  cart: { url: `${BASE_URL}/kosarica/`, label: "Košarica" },
  home: { url: BASE_URL, label: "Početna" }
};

function containsAny(text, terms) {
  const lower = String(text || "").toLowerCase();
  return terms.some((t) => lower.includes(t));
}

function pushUnique(arr, key) {
  if (LINKS[key] && !arr.includes(key)) arr.push(key);
}

function buildDirectWebsiteLinks(query, { knowledge = null, outcome = null } = {}) {
  const links = [];

  if (containsAny(query, ["program vjernosti", "vjernost", "bonus", "sjedi 5"])) {
    pushUnique(links, "buybackLoyalty");
    pushUnique(links, "buyback");
  }
  if (containsAny(query, ["otkup", "prodaj", "prodati", "prodam"])) {
    pushUnique(links, "buyback");
  }
  if (containsAny(query, ["dostav", "poštarin", "cijena dostave", "paketomat", "gls"])) {
    pushUnique(links, "delivery");
  }
  if (containsAny(query, ["plać", "kartic", "pouzeć", "corvuspay", "rata"])) {
    pushUnique(links, "paymentMethods");
  }
  if (containsAny(query, ["povrat", "zamjen", "reklamacij", "raskid"])) {
    pushUnique(links, "returns");
  }
  if (containsAny(query, ["kontakt", "telefon", "email", "adresa", "lokacija", "radno vrijeme"])) {
    pushUnique(links, "contact");
  }
  if (containsAny(query, ["kupi", "naruč", "udžbenik", "košaric"])) {
    pushUnique(links, "buyBooks");
  }

  return links.map((key) => LINKS[key]);
}

module.exports = { BASE_URL, LINKS, buildDirectWebsiteLinks };
