/**
 * Text Normalization Utilities
 * Purpose-specific variants to avoid ambiguous "normalizeText" calls.
 */

function normalizeWhitespace(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function foldCroatianDiacritics(value = "") {
  return String(value || "").replace(/[Đđ]/g, "d");
}

function normalizeLowercase(value = "") {
  return foldCroatianDiacritics(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function normalizeForSearch(text = "", { stripHtmlContent = true } = {}) {
  const base = stripHtmlContent ? stripHtml(text) : String(text);
  return foldCroatianDiacritics(base)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeForComparison(value = "") {
  return foldCroatianDiacritics(normalizeWhitespace(value))
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s#-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtml(html = "") {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|br|tr|section|article)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function truncateText(text, maxLength = 900) {
  if (!text || text.length <= maxLength) return text || "";
  return text.slice(0, maxLength).replace(/\s+\S*$/, "") + "…";
}

function tokenize(text = "") {
  return normalizeForSearch(text).split(/\s+/).filter((t) => t.length > 1);
}

module.exports = {
  normalizeWhitespace,
  normalizeLowercase,
  normalizeForSearch,
  normalizeForComparison,
  stripHtml,
  truncateText,
  tokenize,
  foldCroatianDiacritics
};
