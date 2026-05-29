/**
 * Integration test stub for OneDrive Service
 * Mocks MS Graph responses. Run with real credentials for live tests.
 */
const oneDriveService = require("../services/oneDriveService");
const { searchOneDriveDetailed } = oneDriveService;

function assert(cond, msg) { if (!cond) throw new Error(`FAIL: ${msg}`); }

async function runTests() {
  // 1. Config check
  const config = oneDriveService.getOneDriveConfigSummary();
  console.log("OneDrive config:", JSON.stringify(config, null, 2));
  assert(typeof config.enabled === "boolean", "enabled is boolean");
  assert(config.clientSecretPreview === "***" || config.clientSecretPreview.includes("***"), "secret masked");

  // 2. isConfigured
  const configured = oneDriveService.isConfigured();
  if (!configured) {
    console.log("SKIP: OneDrive not configured. Set ONEDRIVE_TENANT_ID, CLIENT_ID, CLIENT_SECRET, and DRIVE_ID+FOLDER_ID or FOLDER_URL to run live tests.");
    return;
  }

  // Live test: fetch documents
  console.log("Fetching OneDrive folder documents…");
  const docs = await oneDriveService.fetchFolderDocuments();
  assert(Array.isArray(docs), "fetch returns array");
  console.log(`Fetched ${docs.length} documents`);

  if (docs.length > 0) {
    const first = docs[0];
    assert(first.id && first.title && first.body !== undefined, "doc has required fields");
    assert(first.source === "onedrive", "source is onedrive");
    console.log(`First doc: "${first.title}" (${first.body.length} chars)`);
  }

  // Live test: search
  if (docs.length > 0) {
    const result = await searchOneDriveDetailed("dostava", { taskIntent: "delivery" });
    if (result) {
      assert(result.context && result.context.length > 0, "search context returned");
      assert(Array.isArray(result.articles), "articles array");
      assert(result.topScore >= 0, "topScore >= 0");
      console.log(`Search result: ${result.totalMatches} matches, top score ${result.topScore}`);
    } else {
      console.log("Search returned null — no matching documents.");
    }
  }

  // 3. Reset cache
  oneDriveService.resetOneDriveCache();
  console.log("Cache reset.");
}

runTests().then(() => console.log("integration.oneDrive.test.js — done ✓")).catch((e) => { console.error(e.message); process.exit(1); });
