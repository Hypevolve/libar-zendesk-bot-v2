/**
 * OneDrive / SharePoint Knowledge Service (Skill §5 — External Data Source)
 *
 * MS Graph: auth, folder traversal, document download, text extraction.
 * Lexical scoring for keyword-based retrieval (complements vector search).
 */
const path = require("path");
const axios = require("axios");
const mammoth = require("mammoth");
const { findBestExcerpt, normalizeText, preprocessSearchQuery, scoreSearchText, stripHtml, truncateText } = require("./searchUtils");
const env = require("../config/env");
const log = require("../config/logger");

const graphClient = axios.create({ baseURL: "https://graph.microsoft.com/v1.0", timeout: 20000 });
const tokenCache = { token: null, expiresAt: 0 };
const oneDriveCache = { documents: null, expiresAt: 0 };

function isConfigured() {
  const creds = [env.ONEDRIVE_TENANT_ID, env.ONEDRIVE_CLIENT_ID, env.ONEDRIVE_CLIENT_SECRET].every(Boolean);
  const target = Boolean((env.ONEDRIVE_DRIVE_ID && env.ONEDRIVE_FOLDER_ID) || env.ONEDRIVE_FOLDER_URL);
  return !!(creds && target);
}

function maskSecret(v = "") {
  const s = String(v).trim();
  if (!s || s.length <= 6) return "***";
  return `${s.slice(0, 3)}***${s.slice(-3)}`;
}

function getOneDriveConfigSummary() {
  return {
    enabled: isConfigured(),
    tenantId: env.ONEDRIVE_TENANT_ID,
    clientId: env.ONEDRIVE_CLIENT_ID,
    clientSecretPreview: maskSecret(env.ONEDRIVE_CLIENT_SECRET),
    driveId: env.ONEDRIVE_DRIVE_ID,
    siteId: env.ONEDRIVE_SITE_ID,
    folderId: env.ONEDRIVE_FOLDER_ID,
    folderUrl: env.ONEDRIVE_FOLDER_URL
  };
}

// ─── Auth ─────────────────────────────────────────────────────

async function getAccessToken() {
  if (!isConfigured()) return null;
  const now = Date.now();
  if (tokenCache.token && tokenCache.expiresAt > now + 60000) return tokenCache.token;

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: env.ONEDRIVE_CLIENT_ID,
    client_secret: env.ONEDRIVE_CLIENT_SECRET,
    scope: "https://graph.microsoft.com/.default"
  });

  const res = await axios.post(
    `https://login.microsoftonline.com/${env.ONEDRIVE_TENANT_ID}/oauth2/v2.0/token`,
    body.toString(),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 20000 }
  );

  tokenCache.token = res.data?.access_token || null;
  tokenCache.expiresAt = now + (Number(res.data?.expires_in) || 3600) * 1000;
  return tokenCache.token;
}

async function graphGet(url, accessToken, config = {}) {
  return graphClient.get(url, { ...config, headers: { Authorization: `Bearer ${accessToken}`, ...(config.headers || {}) } });
}

// ─── URL Parsing ──────────────────────────────────────────────

function encodeGraphPath(pathname = "") {
  return String(pathname).split("/").filter(Boolean).map(encodeURIComponent).join("/");
}

function parseSharePointFolderUrl(folderUrl = "") {
  if (!folderUrl) return null;
  const parsed = new URL(folderUrl);
  const rawId = parsed.searchParams.get("id") || "";
  const decodedId = decodeURIComponent(rawId).replace(/\/+$/, "");
  if (!decodedId.startsWith("/")) throw new Error("ONEDRIVE_FOLDER_URL missing valid SharePoint folder path.");

  let sitePath = "/", documentPath = decodedId;
  const roots = ["/sites/", "/teams/", "/personal/"];
  const root = roots.find((r) => decodedId.startsWith(r));
  if (root) {
    const segs = decodedId.split("/").filter(Boolean);
    if (segs.length < 3) throw new Error("ONEDRIVE_FOLDER_URL unresolvable.");
    sitePath = `/${segs.slice(0, 2).join("/")}`;
    documentPath = `/${segs.slice(2).join("/")}`;
  }

  const libs = ["/Shared Documents/", "/Documents/"];
  const lib = libs.find((l) => documentPath.startsWith(l));
  const rel = lib ? documentPath.slice(lib.length) : documentPath.replace(/^\/+/, "");
  if (!rel) throw new Error("ONEDRIVE_FOLDER_URL points to library root.");

  return { hostname: parsed.hostname, sitePath, documentPath, driveRelativePath: rel };
}

async function resolveSiteId(accessToken, details) {
  if (!details && env.ONEDRIVE_SITE_ID) return env.ONEDRIVE_SITE_ID;
  if (!details || details.sitePath === "/") {
    const res = await graphGet("/sites/root", accessToken);
    return res.data?.id || null;
  }
  const res = await graphGet(`/sites/${details.hostname}:${details.sitePath}`, accessToken);
  return res.data?.id || null;
}

async function resolveTarget(accessToken) {
  if (env.ONEDRIVE_FOLDER_URL) {
    const details = parseSharePointFolderUrl(env.ONEDRIVE_FOLDER_URL);
    const siteId = await resolveSiteId(accessToken, details);
    if (!siteId) throw new Error("Cannot resolve SharePoint site.");
    const driveRes = await graphGet(`/sites/${siteId}/drive`, accessToken);
    const driveId = driveRes.data?.id;
    if (!driveId) throw new Error("Cannot resolve drive.");
    const encoded = encodeGraphPath(details.driveRelativePath);
    const folderRes = await graphGet(`/drives/${driveId}/root:/${encoded}:?$select=id,name,webUrl`, accessToken);
    const folderId = folderRes.data?.id;
    if (!folderId) throw new Error("Cannot resolve folder.");
    return { driveId, folderId, source: "url", siteId, path: details.driveRelativePath };
  }
  return { driveId: env.ONEDRIVE_DRIVE_ID, folderId: env.ONEDRIVE_FOLDER_ID, source: "direct", siteId: env.ONEDRIVE_SITE_ID || null, path: null };
}

// ─── Document Collection ──────────────────────────────────────

const SUPPORTED_EXT = new Set([".txt", ".md", ".csv", ".json", ".html", ".htm", ".docx"]);

function isSupportedDocument(item = {}) {
  return SUPPORTED_EXT.has(path.extname(String(item.name || "")).toLowerCase());
}

async function listFolderChildren(accessToken, driveId, itemId) {
  const children = [];
  let url = `/drives/${driveId}/items/${itemId}/children?$top=200&select=id,name,size,webUrl,lastModifiedDateTime,file,folder,parentReference,@microsoft.graph.downloadUrl`;
  while (url) {
    const res = await graphGet(url, accessToken);
    children.push(...(Array.isArray(res.data?.value) ? res.data.value : []));
    url = res.data?.["@odata.nextLink"] || null;
  }
  return children;
}

async function collectDocuments(accessToken, driveId, folderId) {
  const docs = [];
  const queue = [folderId];
  while (queue.length) {
    const id = queue.shift();
    const children = await listFolderChildren(accessToken, driveId, id);
    for (const child of children) {
      if (child.folder) { queue.push(child.id); continue; }
      if (!child.file || !isSupportedDocument(child)) continue;
      if (Number(child.size) > env.ONEDRIVE_MAX_FILE_SIZE_BYTES) continue;
      docs.push(child);
    }
  }
  return docs;
}

async function parseDocxBuffer(buffer) {
  const result = await mammoth.extractRawText({ buffer });
  return String(result?.value || "").trim();
}

async function parseDocumentContent(item, buffer) {
  const ext = path.extname(String(item.name)).toLowerCase();
  if (ext === ".docx") {
    try { return await parseDocxBuffer(buffer); } catch (e) { log.warn("docx_parse_failed", { name: item.name }); return ""; }
  }
  if (ext === ".html" || ext === ".htm") return stripHtml(buffer.toString("utf8"));
  return buffer.toString("utf8").trim();
}

async function downloadDocument(accessToken, item) {
  const url = item["@microsoft.graph.downloadUrl"];
  if (!url) return null;
  const res = await axios.get(url, { responseType: "arraybuffer", timeout: 20000 });
  const body = await parseDocumentContent(item, Buffer.from(res.data));
  if (!body) return null;
  return {
    id: item.id, title: item.name, body,
    path: item.parentReference?.path || "", url: item.webUrl || null,
    lastModifiedAt: item.lastModifiedDateTime || null, source: "onedrive"
  };
}

async function fetchFolderDocuments() {
  if (!isConfigured()) return [];
  const now = Date.now();
  if (oneDriveCache.documents && oneDriveCache.expiresAt > now) return oneDriveCache.documents;

  const accessToken = await getAccessToken();
  const target = await resolveTarget(accessToken);
  const items = await collectDocuments(accessToken, target.driveId, target.folderId);
  const docs = [];
  for (const item of items) {
    const doc = await downloadDocument(accessToken, item);
    if (doc) docs.push(doc);
  }
  oneDriveCache.documents = docs;
  oneDriveCache.expiresAt = now + env.ONEDRIVE_CACHE_TTL_MS;
  return docs;
}

// ─── Lexical Search ───────────────────────────────────────────

function scoreDocument(doc, query, options = {}) {
  const title = normalizeText(doc.title || "");
  const searchText = normalizeText(`${doc.title || ""} ${doc.body || ""}`);
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery || !searchText) return 0;

  let score = scoreSearchText(searchText, query);
  if (title.includes(normalizedQuery)) score += 15;
  score += scoreSearchText(doc.title || "", query) * 2;

  const taskIntent = normalizeText(options?.taskIntent || "");
  if ((taskIntent === "buyback") && /(otkup|procjena|bonus)/.test(searchText)) score += 10;
  if ((taskIntent === "delivery") && /(dostava|isporuka|gls|boxnow|paketomat)/.test(searchText)) score += 10;
  if ((taskIntent === "support_info") && /(radno vrijeme|adresa|kontakt|telefon|email)/.test(searchText)) score += 7;

  return score;
}

async function searchOneDriveDetailed(query, options = {}) {
  if (!isConfigured()) return null;
  try {
    const searchQuery = preprocessSearchQuery(query, options);
    const documents = await fetchFolderDocuments();
    if (!documents.length) return null;

    const maxDocs = ["buyback", "delivery", "support_info"].includes(options?.taskIntent)
      ? Math.max(env.ONEDRIVE_CONTEXT_DOCUMENTS, 4) : env.ONEDRIVE_CONTEXT_DOCUMENTS;

    const ranked = documents
      .map((doc) => ({ document: doc, score: scoreDocument(doc, searchQuery, options), excerpt: findBestExcerpt(doc.body || "", searchQuery, 3200) }))
      .filter((e) => e.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxDocs);

    if (!ranked.length) return null;

    const context = ranked.map(({ document, score, excerpt }, i) => [
      `Dokument ${i + 1}:`, "Izvor: OneDrive",
      `Naslov: ${document.title}`, `Relevantnost: ${score}`,
      `Sadržaj: ${excerpt || truncateText(document.body, 3200)}`
    ].join("\n")).join("\n\n");

    return {
      context,
      articles: ranked.map(({ document, score, excerpt }) => ({
        id: document.id, title: document.title, score,
        body: excerpt || truncateText(document.body, 3200),
        source: "onedrive", url: document.url || null
      })),
      topScore: ranked[0]?.score || 0,
      totalMatches: ranked.length
    };
  } catch (error) {
    log.error("onedrive_search_failed", { message: error.message });
    return null;
  }
}

async function searchOneDrive(query) {
  const result = await searchOneDriveDetailed(query);
  return result?.context || null;
}

function resetOneDriveCache() {
  oneDriveCache.documents = null;
  oneDriveCache.expiresAt = 0;
}

module.exports = {
  fetchFolderDocuments, getOneDriveConfigSummary, isConfigured,
  resetOneDriveCache, searchOneDrive, searchOneDriveDetailed
};
