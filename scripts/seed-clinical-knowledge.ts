/**
 * MedlinePlus Clinical Knowledge Ingestion & Seeding CLI Script
 * 
 * Idempotently batch-inserts MedlinePlus guideline passages from
 * data/medlineplus/processed/passages.jsonl into PostgreSQL via Drizzle ORM
 * (clinicalKnowledgePassagesTable).
 * 
 * Usage:
 *   npx tsx scripts/seed-clinical-knowledge.ts
 *   npx tsx scripts/seed-clinical-knowledge.ts --batch-size=200 --dry-run
 */

import fs from "fs";
import path from "path";
import readline from "readline";
import { getDb } from "@/config/db";
import { clinicalKnowledgePassagesTable } from "@/config/schema";

interface MedlinePlusRawEntry {
  id: string;
  topicId: string;
  title: string;
  section?: string;
  source?: string;
  sourceUrl?: string;
  releaseDate?: string;
  authority?: string;
  content: string;
  keyTerms?: string[];
  embedding?: number[];
}

async function seedClinicalKnowledge() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes("--dry-run");
  const batchSizeArg = args.find((a) => a.startsWith("--batch-size="));
  const batchSize = batchSizeArg ? parseInt(batchSizeArg.split("=")[1], 10) : 100;

  console.log("==============================================================================");
  console.log("       MEDVOICE AI: CLINICAL KNOWLEDGE DATABASE SEEDING ENGINE                 ");
  console.log("==============================================================================");

  if (isDryRun) {
    console.log("⚡ Mode: DRY RUN (Database mutations simulated, no records written)\n");
  }

  const filePath = path.join(process.cwd(), "data", "medlineplus", "processed", "passages.jsonl");
  if (!fs.existsSync(filePath)) {
    console.error(`❌ Error: Source file not found at ${filePath}`);
    process.exit(1);
  }

  if (!process.env.DATABASE_URL && !isDryRun) {
    console.warn("⚠️ Notice: DATABASE_URL is not set in environment. Skipping database seeding.");
    console.warn("   The application will gracefully use the local JSONL index reader.\n");
    return;
  }

  const db = !isDryRun ? getDb() : null;
  if (!db && !isDryRun) {
    console.warn("⚠️ Notice: Unable to obtain database client. Skipping database seeding.\n");
    return;
  }

  console.log(`📂 Ingesting passages from: ${filePath}`);
  console.log(`📦 Batch Size: ${batchSize} records per transaction\n`);

  const fileStream = fs.createReadStream(filePath, { encoding: "utf-8" });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  let totalParsed = 0;
  let totalInserted = 0;
  let batch: Array<{
    passageId: string;
    topicId: string;
    title: string;
    section: string;
    text: string;
    url: string | null;
    keywords: string[];
    embedding: number[] | null;
  }> = [];

  const flushBatch = async () => {
    if (batch.length === 0) return;

    if (!isDryRun && db) {
      try {
        await db
          .insert(clinicalKnowledgePassagesTable)
          .values(batch)
          .onConflictDoNothing({ target: clinicalKnowledgePassagesTable.passageId });
        totalInserted += batch.length;
      } catch (err: any) {
        console.error(`❌ Batch insert failed around record ${totalParsed}:`, err?.message || err);
      }
    } else {
      totalInserted += batch.length;
    }

    process.stdout.write(`\r  ✓ Processed: ${totalParsed.toLocaleString()} passages (${totalInserted.toLocaleString()} committed)...`);
    batch = [];
  };

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const parsed: MedlinePlusRawEntry = JSON.parse(trimmed);
      totalParsed++;

      batch.push({
        passageId: parsed.id,
        topicId: parsed.topicId || "general",
        title: parsed.title ? parsed.title.slice(0, 500) : "Clinical Passage",
        section: parsed.section ? parsed.section.slice(0, 250) : "overview",
        text: parsed.content || "",
        url: parsed.sourceUrl ? parsed.sourceUrl.slice(0, 1000) : null,
        keywords: Array.isArray(parsed.keyTerms) ? parsed.keyTerms : [],
        embedding: Array.isArray(parsed.embedding) ? parsed.embedding : null,
      });

      if (batch.length >= batchSize) {
        await flushBatch();
      }
    } catch (parseErr) {
      console.warn(`⚠️ Warning: Failed to parse JSONL line at offset ${totalParsed}:`, parseErr);
    }
  }

  // Flush remaining rows
  await flushBatch();

  console.log("\n\n==============================================================================");
  console.log(`✅ CLINICAL KNOWLEDGE INGESTION COMPLETE`);
  console.log(`   • Total Passages Parsed   : ${totalParsed.toLocaleString()}`);
  console.log(`   • Records Seeded / Synced : ${totalInserted.toLocaleString()}`);
  console.log(`   • Target Table            : clinical_knowledge_passages`);
  console.log("==============================================================================\n");
}

seedClinicalKnowledge().catch((err) => {
  console.error("Fatal error during clinical knowledge seeding:", err);
  process.exit(1);
});
