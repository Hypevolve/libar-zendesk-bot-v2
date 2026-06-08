/**
 * Manual OneDrive → Vector Knowledge Sync
 *
 * Usage: node scripts/sync-kb.js [--force]
 *
 * Requires valid .env with OneDrive credentials and vector DB config.
 */
require("dotenv").config();

const knowledgeService = require("../services/knowledgeService");
const log = require("../config/logger");

const force = process.argv.includes("--force");

async function main() {
  log.info("manual_sync_start", { force });
  try {
    const result = await knowledgeService.syncVectorKnowledgeFromOneDrive({ force });
    log.info("manual_sync_complete", {
      indexed: result.indexedDocuments,
      skipped: result.skippedDocuments,
      deleted: result.deletedDocuments,
      errors: result.errors?.length || 0
    });
    console.log("\nSync complete:");
    console.log(`  Indexed:   ${result.indexedDocuments}`);
    console.log(`  Skipped:   ${result.skippedDocuments}`);
    console.log(`  Deleted:   ${result.deletedDocuments}`);
    console.log(`  Errors:    ${result.errors?.length || 0}`);
    if (result.errors?.length) {
      console.log("\nErrors:");
      result.errors.forEach((e, i) => console.log(`  ${i + 1}. ${e}`));
    }
  } catch (err) {
    log.error("manual_sync_failed", { message: err.message });
    console.error("Sync failed:", err.message);
    process.exit(1);
  }
}

main();
