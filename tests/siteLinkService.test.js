const { buildDirectWebsiteLinks, LINKS } = require("../services/siteLinkService");

function assert(cond, msg) { if (!cond) throw new Error(`FAIL: ${msg}`); }

const deliveryLinks = buildDirectWebsiteLinks("koliko košta dostava?");
assert(deliveryLinks.length > 0, "delivery query returns links");
assert(deliveryLinks.some((l) => l.url.includes("dostave")), "includes delivery link");

const buybackLinks = buildDirectWebsiteLinks("kako funkcionira otkup?");
assert(buybackLinks.length > 0, "buyback query returns links");

const contactLinks = buildDirectWebsiteLinks("koji je vaš telefon?");
assert(contactLinks.some((l) => l.url.includes("kontakt")), "includes contact link");

const noLinks = buildDirectWebsiteLinks("hvala");
assert(noLinks.length === 0, "greeting returns no links");

console.log("siteLinkService.test.js — all passed ✓");
