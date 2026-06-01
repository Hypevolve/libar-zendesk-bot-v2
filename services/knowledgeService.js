/**
 * Knowledge Service (Skill §8 — Hybrid Search Orchestrator)
 *
 * Canonical model: OneDrive documents are synced into a single vector/FTS
 * table. Vector search is PRIMARY; live OneDrive and Zendesk HC are FALLBACK.
 *
 * Why: All three sources serve the same corpus. Three scales → noise.
 * One canonical corpus + hybrid (semantic + FTS) inside that corpus → accuracy.
 */
const oneDriveService = require("./oneDriveService");
const vectorKnowledgeService = require("./vectorKnowledgeService");
const zendeskService = require("./zendeskService");
const { scoreSearchText } = require("./searchUtils");
const env = require("../config/env");
const log = require("../config/logger");

const CONTEXT_ITEMS = env.KNOWLEDGE_CONTEXT_ITEMS;
const MIN_CONFIDENCE = 0.50; // 0–1 confidence gate; below this → try fallback

function normalizeKnowledgeArticles(result) {
  return Array.isArray(result?.articles) ? result.articles : [];
}

function deduplicateArticles(articles = []) {
  const seen = new Map();
  for (const article of articles) {
    const key = `${(article.title || "").toLowerCase().trim()}::${(article.body || "").slice(0, 80)}`;
    const existing = seen.get(key);
    if (!existing || (article.confidence || 0) > (existing.confidence || 0)) {
      seen.set(key, article);
    }
  }
  return [...seen.values()];
}

function computeRRF(rank, k = 60) {
  return 1 / (k + rank);
}

function rankBasedMerge(vectorArticles = [], fallbackArticles = [], k = 60) {
  // RRF merge: rank each list independently, then fuse.
  const rrfScores = new Map();

  vectorArticles.forEach((a, rank) => {
    const key = `${(a.title || "").toLowerCase().trim()}::${(a.body || "").slice(0, 80)}`;
    if (!rrfScores.has(key)) rrfScores.set(key, { entry: a, score: 0 });
    rrfScores.get(key).score += computeRRF(rank + 1, k);
  });

  fallbackArticles.forEach((a, rank) => {
    const key = `${(a.title || "").toLowerCase().trim()}::${(a.body || "").slice(0, 80)}`;
    if (!rrfScores.has(key)) rrfScores.set(key, { entry: a, score: 0 });
    rrfScores.get(key).score += computeRRF(rank + 1, k);
  });

  return [...rrfScores.values()]
    .map(({ entry, score }) => ({ ...entry, rrfScore: score }))
    .sort((a, b) => b.rrfScore - a.rrfScore);
}

function lightRerank(candidates, query = "") {
  if (!query || !candidates.length) return candidates;
  return candidates
    .map((c) => ({
      ...c,
      _score: (c.rrfScore || c.confidence || 0.5)
        + (scoreSearchText(`${c.title || ""} ${c.body || ""}`, query) / 2000)
    }))
    .sort((a, b) => b._score - a._score);
}

function buildContext(candidates) {
  return candidates.map((entry, i) => [
    `Izvor ${i + 1} (${entry.source === "zendesk" ? "Zendesk Help Center" : entry.source === "vector" ? "Vektorska baza" : "OneDrive"}):`,
    `Naslov: ${entry.title}`,
    `Sadržaj: ${entry.body}`
  ].filter(Boolean).join("\n")).join("\n\n");
}

function finalizeResult(candidates) {
  if (!candidates.length) return null;
  const primary = candidates[0];
  return {
    context: buildContext(candidates),
    articles: candidates,
    topScore: primary.score || 0,          // 0–100 (backward compat for tracing)
    topConfidence: Math.max(...candidates.map(c => c.confidence || 0)), // 0–1 (for gating decisions)
    totalMatches: candidates.length,
    primarySource: primary.source || null
  };
}

/**
 * Main entry point — vector-first, fallback on lexical sources.
 */
async function searchKnowledgeDetailed(query, options = {}) {
  // ── 1. PRIMARY: canonical vector + FTS hybrid search ──────────
  let result = await vectorKnowledgeService.searchVectorKnowledgeDetailed(query, options);
  let candidates = normalizeKnowledgeArticles(result);

  const topConfidence = candidates.length ? Math.max(...candidates.map((c) => c.confidence || 0)) : 0;
  const hasStrongVector = candidates.length >= 2 && topConfidence >= MIN_CONFIDENCE;

  // ── 2. FALLBACK: only if vector is empty, unconfident, or fails ─
  if (!hasStrongVector) {
    let fallback = [];
    try {
      // Try OneDrive live lexical (same corpus, different retrieval path)
      const od = await oneDriveService.searchOneDriveDetailed(query, options);
      if (od?.articles?.length) fallback.push(...od.articles.map((a) => ({
        ...a,
        confidence: Math.min(1, ((a.score || 0) + 20) / 150), // normalize 0–1
        source: a.source || "onedrive"
      })));
    } catch (e) { /* fallback soft-fail */ }

    if (!fallback.length) {
      try {
        const zd = await zendeskService.searchHelpCenterDetailed(query, options);
        if (zd?.articles?.length) fallback.push(...zd.articles.map((a) => ({
          ...a,
          confidence: Math.min(1, ((a.score || 0) + 20) / 150),
          source: a.source || "zendesk"
        })));
      } catch (e) { /* fallback soft-fail */ }
    }

    if (candidates.length && fallback.length) {
      // RRF-merge vector hits with lexical fallback
      candidates = rankBasedMerge(candidates, fallback).slice(0, CONTEXT_ITEMS);
    } else if (fallback.length) {
      candidates = deduplicateArticles(fallback)
        .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
        .slice(0, CONTEXT_ITEMS);
    }

    if (candidates.length) {
      candidates = lightRerank(candidates, query).slice(0, CONTEXT_ITEMS);
    }
  }

  if (!candidates.length) return null;

  // Logging for observability
  const primarySource = candidates[0]?.source;
  log.info("knowledge_retrieval", {
    primarySource,
    topConfidence: candidates[0]?.confidence || 0,
    topScore: candidates[0]?.score || 0,
    totalMatches: candidates.length,
    hybridRpcUsed: true
  });

  return finalizeResult(candidates);
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
