/**
 * Knowledge Service (Skill §8 — Hybrid Search Orchestrator)
 *
 * Merges results from three knowledge sources:
 * 1. Vector (Supabase pgvector) — semantic
 * 2. OneDrive — lexical
 * 3. Zendesk Help Center — lexical
 *
 * Deduplicates, re-ranks, and formats the context block for LLM.
 */
const oneDriveService = require("./oneDriveService");
const vectorKnowledgeService = require("./vectorKnowledgeService");
const zendeskService = require("./zendeskService");
const env = require("../config/env");

const CONTEXT_ITEMS = env.KNOWLEDGE_CONTEXT_ITEMS;

function normalizeKnowledgeArticles(result) {
  return Array.isArray(result?.articles) ? result.articles : [];
}

function normalizeSourceArticles(result, source) {
  return normalizeKnowledgeArticles(result).map((entry) => ({
    ...entry,
    source: entry?.source || source
  }));
}

function deduplicateArticles(articles = []) {
  const seen = new Map();
  for (const article of articles) {
    const key = `${(article.title || "").toLowerCase().trim()}::${article.source || ""}`;
    const existing = seen.get(key);
    if (!existing || (article.score || 0) > (existing.score || 0)) {
      seen.set(key, article);
    }
  }
  return [...seen.values()];
}

function mergeKnowledgeResults(results = []) {
  const all = results.flatMap(({ result, source }) => normalizeSourceArticles(result, source));
  const deduped = deduplicateArticles(all);
  const candidates = deduped
    .sort((a, b) => {
      const diff = (b.score || 0) - (a.score || 0);
      if (diff !== 0) return diff;
      return a.source === "onedrive" ? -1 : 1;
    })
    .slice(0, CONTEXT_ITEMS);

  if (!candidates.length) return null;

  const context = candidates.map((entry, i) => [
    `Izvor ${i + 1} (${entry.source === "zendesk" ? "Zendesk Help Center" : "OneDrive"}):`,
    `Naslov: ${entry.title}`,
    `Sadržaj: ${entry.body}`
  ].filter(Boolean).join("\n")).join("\n\n");

  return {
    context,
    articles: candidates,
    topScore: candidates[0]?.score || 0,
    totalMatches: candidates.length,
    primarySource: candidates[0]?.source || null
  };
}

/**
 * Main entry point — parallel search across all sources.
 */
async function searchKnowledgeDetailed(query, options = {}) {
  const [vectorKnowledge, oneDriveKnowledge, zendeskKnowledge] = await Promise.all([
    vectorKnowledgeService.searchVectorKnowledgeDetailed(query, options),
    oneDriveService.searchOneDriveDetailed(query, options),
    zendeskService.searchHelpCenterDetailed(query, options)
  ]);

  return mergeKnowledgeResults([
    { result: vectorKnowledge, source: "onedrive" },
    { result: oneDriveKnowledge, source: "onedrive" },
    { result: zendeskKnowledge, source: "zendesk" }
  ]);
}

async function searchKnowledge(query, options = {}) {
  const result = await searchKnowledgeDetailed(query, options);
  return result?.context || null;
}

module.exports = {
  getVectorConfigSummary: vectorKnowledgeService.getVectorConfigSummary,
  searchKnowledgeDetailed,
  searchKnowledge,
  syncVectorKnowledgeFromOneDrive: vectorKnowledgeService.syncOneDriveKnowledge
};
