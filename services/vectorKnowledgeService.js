/**
 * Vector Knowledge Service (Skill §5 — Vector DB, §3 — Chunking, §8 — Hybrid Search)
 *
 * Supabase pgvector storage: chunking, embedding, upsert, semantic search.
 * Domain-aware retrieval with multi-tier threshold fallback.
 */
const crypto = require("crypto");
const axios = require("axios");
const embeddingService = require("./embeddingService");
const { normalizeForComparison, normalizeWhitespace } = require("./textUtils");
const env = require("../config/env");
const log = require("../config/logger");

const SUPABASE_URL = env.SUPABASE_URL.replace(/\/+$/, "");
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const MATCH_COUNT = env.VECTOR_MATCH_COUNT;
const MIN_SCORE = env.VECTOR_MIN_SCORE;
const DOMAIN_MIN_SCORE = parseFloat(process.env.VECTOR_DOMAIN_AWARE_MIN_SCORE || "0.58");
const FALLBACK_MIN_SCORE = parseFloat(process.env.VECTOR_FALLBACK_MIN_SCORE || "0.40");
const CONTEXT_ITEMS = env.VECTOR_CONTEXT_ITEMS;
const CHUNK_MAX = env.VECTOR_CHUNK_MAX_CHARS;
const CHUNK_OVERLAP = env.VECTOR_CHUNK_OVERLAP_CHARS;
const INSERT_BATCH = 100;

// ─── Config ───────────────────────────────────────────────────

function isSupabaseConfigured() { return Boolean(SUPABASE_URL && SUPABASE_KEY); }
function isConfigured() { return isSupabaseConfigured() && embeddingService.isConfigured(); }

function getVectorConfigSummary() {
  const k = SUPABASE_KEY;
  return {
    enabled: isConfigured(),
    supabaseConfigured: isSupabaseConfigured(),
    supabaseUrl: SUPABASE_URL,
    serviceRoleKeyPreview: k ? `${k.slice(0, 4)}***${k.slice(-4)}` : "(empty)",
    embeddings: embeddingService.getEmbeddingConfigSummary(),
    matchCount: MATCH_COUNT, minScore: MIN_SCORE,
    contextItems: CONTEXT_ITEMS, chunkMaxChars: CHUNK_MAX, chunkOverlapChars: CHUNK_OVERLAP
  };
}

function getSupabaseClient() {
  if (!isSupabaseConfigured()) throw new Error("Supabase not configured for vector knowledge.");
  return axios.create({
    baseURL: SUPABASE_URL, timeout: 30000,
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" }
  });
}

// ─── Chunking (Skill §3 — Recursive with overlap) ────────────

function hashText(v = "") { return crypto.createHash("sha256").update(String(v)).digest("hex"); }

function splitLongText(value = "", max = CHUNK_MAX) {
  const words = normalizeWhitespace(value).split(/\s+/).filter(Boolean);
  const chunks = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > max && cur) { chunks.push(cur); cur = w; }
    else cur = next;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

function tailOverlap(value = "", overlap = CHUNK_OVERLAP) {
  const n = normalizeWhitespace(value);
  if (!n || overlap <= 0 || n.length <= overlap) return n;
  const tail = n.slice(-overlap);
  const sp = tail.indexOf(" ");
  return sp === -1 ? tail : tail.slice(sp + 1);
}

function chunkText(value = "", max = CHUNK_MAX) {
  const normalised = String(value || "").replace(/\r/g, "").replace(/\u0000/g, "").trim();
  if (!normalised) return [];

  const paragraphs = normalised
    .split(/\n{2,}|\n(?=\s*(?:ČLANAK|CLANAK|UVJETI|PRAVILA|NAČIN|DOSTAVA|OTKUP|KUPNJA|PLAĆANJE|REKLAMACIJA|POVRAT|ZAMJENA|LOJALNOST|POPUST|\d+[.)]|[-*]\s))/i)
    .map(normalizeWhitespace).filter(Boolean);
  const chunks = [];
  let cur = "";

  for (const para of paragraphs) {
    const parts = para.length > max ? splitLongText(para, max) : [para];
    for (const part of parts) {
      const next = cur ? `${cur}\n\n${part}` : part;
      if (next.length > max && cur) {
        chunks.push(cur);
        const ov = tailOverlap(cur);
        cur = ov && ov !== cur ? `${ov}\n\n${part}` : part;
      } else {
        cur = next;
      }
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

// ─── Domain Inference ─────────────────────────────────────────

function inferDomain(doc = {}, chunkBody = "") {
  const bodyText = normalizeForComparison(chunkBody || doc.body || "");
  const titleText = normalizeForComparison(doc.title || "");

  const scores = { buyback: 0, delivery: 0, order: 0, support_info: 0 };

  // Body matches are weighted higher (2 pts) — chunk content is more specific than title
  if (/(otkup|prodaj|isplata|aircash|dostavljac|kurir|naljepnic|online otkup)/.test(bodyText)) scores.buyback += 2;
  if (/(dostava|isporuk|gls|boxnow|paketomat|tracking|pouzec)/.test(bodyText)) scores.delivery += 2;
  if (/(narudzb|racun|reklamacij|povrat|zamjen)/.test(bodyText)) scores.order += 2;
  if (/(radno vrijeme|kontakt|telefon|email|adresa|placanj)/.test(bodyText)) scores.support_info += 2;

  // Title matches add smaller weight (1 pt)
  if (/(otkup|prodaj|isplata|aircash|dostavljac|kurir|naljepnic|online otkup)/.test(titleText)) scores.buyback += 1;
  if (/(dostava|isporuk|gls|boxnow|paketomat|tracking|pouzec)/.test(titleText)) scores.delivery += 1;
  if (/(narudzb|racun|reklamacij|povrat|zamjen)/.test(titleText)) scores.order += 1;
  if (/(radno vrijeme|kontakt|telefon|email|adresa|placanj)/.test(titleText)) scores.support_info += 1;

  let best = "general";
  let bestScore = 0;
  for (const [domain, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      best = domain;
    }
  }
  return best;
}

function buildDocumentChunks(doc = {}) {
  return chunkText(doc.body || "").map((body, i) => ({
    source: "onedrive",
    sourceDocumentId: String(doc.id || ""),
    chunkIndex: i,
    title: doc.title || "OneDrive dokument",
    body,
    domain: inferDomain(doc, body),
    url: doc.url || null,
    contentHash: hashText(`${doc.id || ""}:${i}:${body}`),
    metadata: { path: doc.path || "", lastModifiedAt: doc.lastModifiedAt || null }
  }));
}

// ─── Sync ─────────────────────────────────────────────────────

async function getIndexedDocuments(source = "onedrive") {
  const res = await getSupabaseClient().get("/rest/v1/kb_documents", {
    params: { source: `eq.${source}`, select: "id,source_document_id,content_hash" }
  });
  return Array.isArray(res.data) ? res.data : [];
}

async function upsertDocument(doc, contentHash) {
  const res = await getSupabaseClient().post(
    "/rest/v1/kb_documents?on_conflict=source,source_document_id",
    {
      source: "onedrive", source_document_id: String(doc.id || ""),
      title: doc.title || "OneDrive dokument", url: doc.url || null,
      source_path: doc.path || "", last_modified_at: doc.lastModifiedAt || null,
      content_hash: contentHash,
      metadata: { title: doc.title || "", source: "onedrive" },
      synced_at: new Date().toISOString()
    },
    { headers: { Prefer: "resolution=merge-duplicates,return=representation" } }
  );
  return Array.isArray(res.data) ? res.data[0] : null;
}

async function deleteChunksForDocument(docId) {
  await getSupabaseClient().delete("/rest/v1/kb_chunks", { params: { document_id: `eq.${docId}` } });
}

async function deleteDocument(docId) {
  await getSupabaseClient().delete("/rest/v1/kb_documents", { params: { id: `eq.${docId}` } });
}

async function insertChunkRows(rows = []) {
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    const batch = rows.slice(i, i + INSERT_BATCH);
    if (batch.length) await getSupabaseClient().post("/rest/v1/kb_chunks", batch, { headers: { Prefer: "return=minimal" } });
  }
}

async function indexDocument(doc, { force = false, existing = null } = {}) {
  const docHash = hashText(`${doc.title || ""}\n${doc.lastModifiedAt || ""}\n${doc.body || ""}`);
  if (!force && existing?.content_hash === docHash) return { status: "skipped", documentId: existing.id, chunks: 0 };

  const row = await upsertDocument(doc, docHash);
  if (!row?.id) throw new Error(`Unable to upsert vector doc for ${doc.title || doc.id}.`);

  const chunks = buildDocumentChunks(doc);
  await deleteChunksForDocument(row.id);
  if (!chunks.length) return { status: "indexed", documentId: row.id, chunks: 0 };

  const embeddings = await embeddingService.embedTexts(chunks.map((c) => {
    const domainLabel = {
      buyback: "otkupu i prodaji udžbenika",
      delivery: "dostavi i isporuci",
      order: "narudžbama i reklamacijama",
      support_info: "kontakt informacijama i radnom vremenu"
    }[c.domain] || "općim informacijama";
    return `Dokument: "${c.title}". Odlomak govori o: ${domainLabel}. Sadržaj: ${c.body}`;
  }));
  if (embeddings.length !== chunks.length) throw new Error(`Embedding count mismatch for ${doc.title}.`);

  await insertChunkRows(chunks.map((c, i) => ({
    document_id: row.id, source: c.source, source_document_id: c.sourceDocumentId,
    chunk_index: c.chunkIndex, title: c.title, body: c.body, domain: c.domain,
    url: c.url, content_hash: c.contentHash, metadata: c.metadata, embedding: embeddings[i]
  })));

  return { status: "indexed", documentId: row.id, chunks: chunks.length };
}

async function syncOneDriveKnowledge({ force = false, deleteMissing = true } = {}) {
  if (!isConfigured()) return { success: false, configured: false, reason: "not_configured", summary: getVectorConfigSummary() };

  const oneDriveService = require("./oneDriveService");
  const documents = await oneDriveService.fetchFolderDocuments();
  const existing = await getIndexedDocuments("onedrive");
  const bySourceId = new Map(existing.map((d) => [String(d.source_document_id || ""), d]));
  const seen = new Set();
  const result = { success: true, configured: true, documentsSeen: documents.length, indexedDocuments: 0, skippedDocuments: 0, deletedDocuments: 0, chunksIndexed: 0, errors: [] };

  for (const doc of documents) {
    const sid = String(doc.id || "");
    if (!sid || !doc.body) continue;
    seen.add(sid);
    try {
      const r = await indexDocument(doc, { force, existing: bySourceId.get(sid) });
      if (r.status === "skipped") result.skippedDocuments++; else { result.indexedDocuments++; result.chunksIndexed += r.chunks; }
    } catch (err) { result.errors.push({ documentId: sid, title: doc.title || "", message: err.message }); }
  }

  if (deleteMissing) {
    for (const e of existing) {
      if (!seen.has(String(e.source_document_id || ""))) { await deleteDocument(e.id); result.deletedDocuments++; }
    }
  }

  result.success = result.errors.length === 0;
  return result;
}

// ─── Search (Skill §8 — Domain-aware multi-tier) ─────────────

function buildVectorQuery(query = "", options = {}) {
  return [query, ...(options.retrievalHints || []), ...(options.conversationTerms || []).slice(-2)]
    .map(normalizeWhitespace).filter(Boolean).join("\n");
}

function normalizeDomainFilter(options = {}) {
  const d = normalizeForComparison(options.taskIntent || options.activeDomain || "");
  return ["buyback", "delivery", "order", "support_info"].includes(d) ? d : null;
}

function buildVectorMatchAttempts(options = {}) {
  const domain = normalizeDomainFilter(options);
  const fb = Math.min(MIN_SCORE, FALLBACK_MIN_SCORE);
  const attempts = [{ threshold: MIN_SCORE, domainFilter: domain, reason: domain ? "domain_filtered" : "default" }];
  if (domain && DOMAIN_MIN_SCORE < MIN_SCORE) attempts.push({ threshold: DOMAIN_MIN_SCORE, domainFilter: domain, reason: "domain_aware_lower" });
  if (domain) attempts.push({ threshold: MIN_SCORE, domainFilter: null, reason: "no_domain_filter" });
  if (fb < MIN_SCORE) attempts.push({ threshold: fb, domainFilter: null, reason: "lower_threshold" });
  // Last resort: catch weakly related chunks that reranking / LLM can filter
  attempts.push({ threshold: 0.30, domainFilter: null, reason: "last_resort" });
  return attempts;
}

// Hybrid RPC availability flag — flips to false if the function is missing
// (e.g. migration not yet applied), so we gracefully fall back to vector-only.
let hybridRpcAvailable = true;

function isMissingFunctionError(err) {
  const status = err?.response?.status;
  const payload = JSON.stringify(err?.response?.data || "");
  return status === 404 || /PGRST202|could not find the function|does not exist/i.test(payload);
}

async function matchKnowledgeChunks(embedding, queryText, attempt) {
  const client = getSupabaseClient();

  if (hybridRpcAvailable) {
    try {
      const res = await client.post("/rest/v1/rpc/hybrid_match_knowledge_chunks", {
        query_embedding: embedding, query_text: queryText || "",
        match_count: MATCH_COUNT, match_threshold: attempt.threshold,
        filter_source: "onedrive", filter_domain: attempt.domainFilter
      });
      const rows = Array.isArray(res.data) ? res.data : [];
      // If hybrid returns empty but the function exists, also try pure vector RPC
      // (hybrid lexical CTE can be too strict with Croatian inflection)
      if (!rows.length) {
        const vres = await client.post("/rest/v1/rpc/match_knowledge_chunks", {
          query_embedding: embedding, match_count: MATCH_COUNT,
          match_threshold: attempt.threshold, filter_source: "onedrive", filter_domain: attempt.domainFilter
        });
        return Array.isArray(vres.data) ? vres.data : [];
      }
      return rows;
    } catch (err) {
      if (isMissingFunctionError(err)) {
        hybridRpcAvailable = false;
        log.warn("hybrid_rpc_unavailable_fallback_to_vector", { message: err.message });
      } else {
        throw err;
      }
    }
  }

  const res = await client.post("/rest/v1/rpc/match_knowledge_chunks", {
    query_embedding: embedding, match_count: MATCH_COUNT,
    match_threshold: attempt.threshold, filter_source: "onedrive", filter_domain: attempt.domainFilter
  });
  return Array.isArray(res.data) ? res.data : [];
}

async function searchVectorKnowledgeDetailed(query, options = {}) {
  if (!isConfigured()) return null;

  try {
    const vq = buildVectorQuery(query, options);
    const embedding = await embeddingService.embedText(vq);
    if (!embedding) return null;

    let rows = [];
    let matched = null;
    for (const attempt of buildVectorMatchAttempts(options)) {
      rows = await matchKnowledgeChunks(embedding, vq, attempt);
      if (rows.length) { matched = attempt; break; }
    }
    if (!rows.length) return null;

    const articles = rows.slice(0, CONTEXT_ITEMS).map((r) => {
      const similarity = Number(r.similarity || 0);
      const lexical = Number(r.lexical_rank || 0);
      // Normalized 0–1 confidence: semantic similarity is primary; a strong
      // lexical match (exact tokens) can lift a lexical-only hit.
      const confidence = Math.max(similarity, Math.min(1, lexical * 4));
      return {
        id: r.chunk_id || r.id || null, title: r.title || "OneDrive dokument",
        body: r.body || "", score: Math.round(confidence * 100), confidence,
        similarity, lexicalRank: lexical, rrfScore: Number(r.rrf_score || 0),
        source: "vector", url: r.url || null, retrieval: "vector",
        retrievalTier: matched?.reason || "default", domain: r.domain || null, documentId: r.document_id || null
      };
    });

    const context = articles.map((a, i) => [
      `Dokument ${i + 1}:`, "Izvor: OneDrive vector",
      `Naslov: ${a.title}`, `Relevantnost: ${a.score}`, `Sadržaj: ${a.body}`
    ].join("\n")).join("\n\n");

    return { context, articles, topScore: articles[0]?.score || 0, totalMatches: articles.length, primarySource: "vector", retrievalTier: matched?.reason || "default" };
  } catch (error) {
    log.error("vector_search_failed", { message: error.message, status: error.response?.status });
    return null;
  }
}

async function ping() {
  try {
    await getSupabaseClient().get("/rest/v1/kb_documents?select=id&limit=1");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

module.exports = {
  buildDocumentChunks, getVectorConfigSummary, isConfigured,
  searchVectorKnowledgeDetailed, syncOneDriveKnowledge, ping,
  __internal: { chunkText, inferDomain, buildVectorQuery, buildVectorMatchAttempts, normalizeDomainFilter, hashText }
};
