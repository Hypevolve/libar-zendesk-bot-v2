#!/usr/bin/env node
/**
 * CLI: Sync OneDrive documents into the vector knowledge base.
 *
 * Usage:
 *   node scripts/sync-vector-knowledge.js [--force] [--delete-missing]
 *
 * Options:
 *   --force          Re-index documents even if their content hash hasn't changed.
 *   --delete-missing Delete chunks for documents that no longer exist in OneDrive.
 */

const vectorKnowledgeService = require("../services/vectorKnowledgeService");

async function main() {
  const force = process.argv.includes("--force");
  const deleteMissing = process.argv.includes("--delete-missing");

  console.log("Vector knowledge sync started…");
  console.log(`  force=${force}, deleteMissing=${deleteMissing}`);

  const result = await vectorKnowledgeService.syncOneDriveKnowledge({ force, deleteMissing });

  if (!result.configured) {
    console.error("Vector knowledge service is not configured.");
    console.error("Summary:", result.summary);
    process.exit(1);
  }

  console.log("\nSync result:");
  console.log(`  Documents seen:     ${result.documentsSeen}`);
  console.log(`  Indexed documents:  ${result.indexedDocuments}`);
  console.log(`  Skipped documents:  ${result.skippedDocuments}`);
  console.log(`  Deleted documents:  ${result.deletedDocuments}`);
  console.log(`  Chunks indexed:     ${result.chunksIndexed}`);

  if (result.errors.length) {
    console.error(`\nErrors (${result.errors.length}):`);
    for (const e of result.errors) {
      console.error(`  - ${e.title} (${e.documentId}): ${e.message}`);
    }
  }

  process.exit(result.success ? 0 : 1);
}

main().catch((err) => {
  console.error("Unexpected error:", err.message);
  process.exit(1);
});
