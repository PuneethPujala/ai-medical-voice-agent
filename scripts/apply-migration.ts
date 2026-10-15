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
  console.log("  MEDVOICE POSTGRESQL DURABLE STATE & UNIQUE IDEMPOTENCY MIGRATION RUNNER      ");
  console.log("================================================================================");

  const sql = neon(dbUrl);

  // 1. Pre-migration check
  console.log("\n[Step 1] Inspecting pre-migration database state...");
  const preCountResult = await sql`SELECT count(*)::int as count FROM consultations;`;
  const preCount = preCountResult[0]?.count || 0;
  console.log(`  Existing consultations record count: ${preCount}`);

  // Check for any potential duplicates before applying unique constraint
  const dupes = await sql`
    SELECT user_id, idempotency_key, count(*) as cnt
    FROM consultations
    WHERE idempotency_key IS NOT NULL
    GROUP BY user_id, idempotency_key
    HAVING count(*) > 1;
  `;
  if (dupes.length > 0) {
    throw new Error(`CRITICAL: Found duplicate idempotency keys in consultations table! Migration aborted to avoid data corruption.`);
  }
  console.log("  ✓ Confirmed zero duplicate (user_id, idempotency_key) groups in database.");

  // 2. Define migration statements explicitly
  const statements = [
    {
      name: "0001: Add durable state and concurrency columns",
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
      name: "0001: Backfill legacy rows case_version",
      sql: `
        UPDATE "consultations"
        SET "case_version" = 1
        WHERE "case_version" IS NULL;
      `
    },
    {
      name: "0001: Create index idx_consultations_case_version",
      sql: `
        CREATE INDEX IF NOT EXISTS "idx_consultations_case_version"
        ON "consultations"("case_version");
      `
    },
    {
      name: "0001: Create index idx_consultations_user_id",
      sql: `
        CREATE INDEX IF NOT EXISTS "idx_consultations_user_id"
        ON "consultations"("user_id");
      `
    },
    {
      name: "0002: Drop non-unique idempotency_key index if present",
      sql: `
        DROP INDEX IF EXISTS "idx_consultations_idempotency_key";
      `
    },
    {
      name: "0002: Create partial unique index on (user_id, idempotency_key)",
      sql: `
        CREATE UNIQUE INDEX IF NOT EXISTS "idx_consultations_user_idempotency_unique"
        ON "consultations"("user_id", "idempotency_key")
        WHERE "idempotency_key" IS NOT NULL;
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
  const indexes = await sql`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE tablename = 'consultations'
    ORDER BY indexname;
  `;
  console.log(`\n  Verified indexes on consultations (${indexes.length} total):`);
  let hasUniqueIdempotency = false;
  for (const idx of indexes) {
    console.log(`    - ${idx.indexname}`);
    if (idx.indexname === "idx_consultations_user_idempotency_unique") {
      hasUniqueIdempotency = true;
    }
  }

  if (!hasUniqueIdempotency) {
    throw new Error("CRITICAL: idx_consultations_user_idempotency_unique not found in database post-migration!");
  }
  console.log("  ✓ Partial unique index on (user_id, idempotency_key) verified.");

  // Verify record count preservation
  const postCountResult = await sql`SELECT count(*)::int as count FROM consultations;`;
  const postCount = postCountResult[0]?.count || 0;
  console.log(`\n  Post-migration consultations record count: ${postCount}`);
  if (postCount !== preCount) {
    throw new Error(`CRITICAL: Record count changed during migration! Expected ${preCount}, got ${postCount}`);
  }
  console.log("  ✓ All existing records preserved with 100% integrity.");

  // 5. Smoke test unique constraint enforcement on duplicate idempotency key
  console.log("\n[Step 5] Testing unique constraint enforcement against duplicate idempotencyKey...");
  const testId1 = `ENC-MIG-IDEM-1-${Date.now()}`;
  const testId2 = `ENC-MIG-IDEM-2-${Date.now()}`;
  const testKey = `test-key-smoke-${Date.now()}`;
  const testUser = "smoke-test-user";

  await sql`
    INSERT INTO consultations (
      id, user_id, doctor_id, doctor_name, specialty, chief_complaint,
      case_version, idempotency_key
    ) VALUES (
      ${testId1}, ${testUser}, 'dr-sarah-chen', 'Dr. Sarah Chen, MD', 'Internal Medicine', 'Smoke test 1',
      1, ${testKey}
    );
  `;

  let caughtExpected23505 = false;
  try {
    await sql`
      INSERT INTO consultations (
        id, user_id, doctor_id, doctor_name, specialty, chief_complaint,
        case_version, idempotency_key
      ) VALUES (
        ${testId2}, ${testUser}, 'dr-sarah-chen', 'Dr. Sarah Chen, MD', 'Internal Medicine', 'Smoke test 2',
        1, ${testKey}
      );
    `;
  } catch (err: any) {
    if (err?.code === "23505" || err?.message?.includes("unique")) {
      caughtExpected23505 = true;
      console.log("  ✓ Duplicate insert under same user was strictly blocked by database (23505 unique violation).");
    } else {
      throw err;
    }
  }

  if (!caughtExpected23505) {
    throw new Error("Database failed to enforce uniqueness constraint on duplicate idempotency_key!");
  }

  // Clean up smoke test rows
  await sql`DELETE FROM consultations WHERE id IN (${testId1}, ${testId2});`;
  console.log("  ✓ Smoke test rows cleaned up.");

  console.log("\n================================================================================");
  console.log("  MIGRATION COMPLETE: 100% SUCCESSFUL AND VERIFIED                              ");
  console.log("================================================================================");
}

runMigration().catch((err) => {
  console.error("\nFATAL MIGRATION ERROR:", err);
  process.exit(1);
});
