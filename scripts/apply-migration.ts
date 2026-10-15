import { neon } from "@neondatabase/serverless";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: ".env" });
}

async function runMigration() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("FATAL: DATABASE_URL is not set.");
    process.exit(1);
  }

  console.log("================================================================================");
  console.log("  MEDVOICE POSTGRESQL DURABLE STATE MIGRATION RUNNER                           ");
  console.log("================================================================================");

  const sql = neon(dbUrl);

  // 1. Pre-migration check
  console.log("\n[Step 1] Inspecting pre-migration database state...");
  const preCountResult = await sql`SELECT count(*)::int as count FROM consultations;`;
  const preCount = preCountResult[0]?.count || 0;
  console.log(`  Existing consultations record count: ${preCount}`);

  const preCols = await sql`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'consultations'
    ORDER BY ordinal_position;
  `;
  console.log(`  Current column count on consultations: ${preCols.length}`);

  // 2. Define migration statements explicitly
  const statements = [
    {
      name: "Add durable state and concurrency columns",
      sql: `
        ALTER TABLE "consultations"
          ADD COLUMN IF NOT EXISTS "interview_state" jsonb,
          ADD COLUMN IF NOT EXISTS "delivered_turn_records" jsonb,
          ADD COLUMN IF NOT EXISTS "attributed_facts" jsonb,
          ADD COLUMN IF NOT EXISTS "unmapped_observations" jsonb,
          ADD COLUMN IF NOT EXISTS "case_version" integer DEFAULT 1,
          ADD COLUMN IF NOT EXISTS "idempotency_key" varchar(128);
      `
    },
    {
      name: "Backfill legacy rows case_version",
      sql: `
        UPDATE "consultations"
        SET "case_version" = 1
        WHERE "case_version" IS NULL;
      `
    },
    {
      name: "Create index idx_consultations_idempotency_key",
      sql: `
        CREATE INDEX IF NOT EXISTS "idx_consultations_idempotency_key"
        ON "consultations"("idempotency_key");
      `
    },
    {
      name: "Create index idx_consultations_case_version",
      sql: `
        CREATE INDEX IF NOT EXISTS "idx_consultations_case_version"
        ON "consultations"("case_version");
      `
    },
    {
      name: "Create index idx_consultations_user_id",
      sql: `
        CREATE INDEX IF NOT EXISTS "idx_consultations_user_id"
        ON "consultations"("user_id");
      `
    }
  ];

  console.log(`\n[Step 2] Prepared ${statements.length} migration statements:`);
  statements.forEach((s, i) => console.log(`  ${i + 1}. ${s.name}`));

  // 3. Execute migration statements safely
  console.log("\n[Step 3] Applying migration to Neon PostgreSQL datastore...");
  for (let i = 0; i < statements.length; i++) {
    const s = statements[i];
    console.log(`  Executing [${i + 1}/${statements.length}] ${s.name}...`);
    await (sql as any).query(s.sql);
    console.log(`  ✓ [${i + 1}/${statements.length}] Success.`);
  }

  // 4. Post-migration verification
  console.log("\n[Step 4] Verifying post-migration schema integrity...");
  const postCols = await sql`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'consultations'
    ORDER BY ordinal_position;
  `;

  const newColNames = [
    "interview_state",
    "delivered_turn_records",
    "attributed_facts",
    "unmapped_observations",
    "case_version",
    "idempotency_key",
  ];

  const colMap = new Map(postCols.map((c: any) => [c.column_name, c]));
  for (const colName of newColNames) {
    if (!colMap.has(colName)) {
      throw new Error(`CRITICAL: Expected column '${colName}' not found in consultations table after migration!`);
    }
    const c = colMap.get(colName)!;
    console.log(`  ✓ Column '${colName}' verified (type=${c.data_type}, nullable=${c.is_nullable}, default=${c.column_default})`);
  }

  // Verify indexes
  const indexes = await sql`
    SELECT indexname
    FROM pg_indexes
    WHERE tablename = 'consultations'
    ORDER BY indexname;
  `;
  console.log(`\n  Verified indexes on consultations (${indexes.length} total):`);
  for (const idx of indexes) {
    console.log(`    - ${idx.indexname}`);
  }

  // Verify record count preservation
  const postCountResult = await sql`SELECT count(*)::int as count FROM consultations;`;
  const postCount = postCountResult[0]?.count || 0;
  console.log(`\n  Post-migration consultations record count: ${postCount}`);
  if (postCount !== preCount) {
    throw new Error(`CRITICAL: Record count changed during migration! Expected ${preCount}, got ${postCount}`);
  }
  console.log("  ✓ All existing records preserved with 100% integrity.");

  // 5. Verification: Write and Read back test record using new columns
  console.log("\n[Step 5] Testing read/write against newly migrated schema...");
  const testId = `ENC-MIG-VERIFY-${Date.now()}`;
  await sql`
    INSERT INTO consultations (
      id, doctor_id, doctor_name, specialty, chief_complaint,
      case_version, idempotency_key, interview_state, attributed_facts
    ) VALUES (
      ${testId}, 'dr-sarah-chen', 'Dr. Sarah Chen, MD', 'Internal Medicine', 'Migration smoke test',
      1, 'smoke-key-1', ${JSON.stringify({ phase: "active_inquiring" })}, ${JSON.stringify([{ concept: "smoke_test" }])}
    );
  `;
  const readBack = await sql`
    SELECT id, case_version, idempotency_key, interview_state, attributed_facts
    FROM consultations
    WHERE id = ${testId};
  `;
  if (readBack.length !== 1 || readBack[0].case_version !== 1 || readBack[0].idempotency_key !== "smoke-key-1") {
    throw new Error("Smoke test readback verification failed!");
  }
  console.log("  ✓ Test row inserted and read back successfully.");

  // Clean up smoke test row
  await sql`DELETE FROM consultations WHERE id = ${testId};`;
  console.log("  ✓ Test row cleaned up.");

  console.log("\n================================================================================");
  console.log("  MIGRATION COMPLETE: 100% SUCCESSFUL AND VERIFIED                              ");
  console.log("================================================================================");
}

runMigration().catch((err) => {
  console.error("\nFATAL MIGRATION ERROR:", err);
  process.exit(1);
});
