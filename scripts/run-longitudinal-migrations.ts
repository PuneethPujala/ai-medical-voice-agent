import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import { Pool } from "pg";
import { neon } from "@neondatabase/serverless";
import { resolveTestDatabaseUrl, maskDatabaseUrl } from "../lib/security/test-db-guard";

dotenv.config({ path: ".env.local" });
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: ".env" });
}

export interface MigrationStatement {
  id: string;
  name: string;
  sql: string;
}

/**
 * Discrete migration statements for Longitudinal Patient Context.
 * Every DDL statement is strictly isolated as a single query to ensure full compatibility
 * with Neon serverless HTTP drivers (which process one query per request) as well as
 * standard PostgreSQL client pools.
 */
export const LONGITUDINAL_MIGRATION_STATEMENTS: MigrationStatement[] = [
  {
    id: "0004_add_patient_profile_id_consultations",
    name: "1. Add patient_profile_id column & index to consultations",
    sql: `
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'consultations' AND column_name = 'patient_profile_id'
        ) THEN
          ALTER TABLE consultations ADD COLUMN patient_profile_id VARCHAR(128);
          CREATE INDEX IF NOT EXISTS idx_consultations_patient_profile_id ON consultations(patient_profile_id);
        END IF;
      END $$;
    `,
  },
  {
    id: "0004_create_patient_longitudinal_facts_table",
    name: "2. Create patient_longitudinal_facts table",
    sql: `
      CREATE TABLE IF NOT EXISTS patient_longitudinal_facts (
        id VARCHAR(128) PRIMARY KEY,
        user_id VARCHAR(128) NOT NULL,
        patient_profile_id VARCHAR(128) NOT NULL,
        category VARCHAR(64) NOT NULL,
        concept VARCHAR(128) NOT NULL,
        reported_value TEXT NOT NULL,
        numeric_value DOUBLE PRECISION,
        unit VARCHAR(32),
        temporal_scope VARCHAR(32) NOT NULL DEFAULT 'baseline',
        lifecycle VARCHAR(32) NOT NULL DEFAULT 'active',
        verification VARCHAR(32) NOT NULL DEFAULT 'unverified',
        source_type VARCHAR(32) NOT NULL DEFAULT 'patient',
        source_consultation_id VARCHAR(128) NOT NULL,
        source_turn_id VARCHAR(128) NOT NULL,
        reported_at TIMESTAMP WITH TIME ZONE NOT NULL,
        recorded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        last_reviewed_at TIMESTAMP WITH TIME ZONE,
        supersedes_fact_id VARCHAR(128),
        superseded_by_fact_id VARCHAR(128),
        superseded_at TIMESTAMP WITH TIME ZONE
      );
    `,
  },
  {
    id: "0004_align_timestamp_timezone_types",
    name: "3. Ensure TIMESTAMP WITH TIME ZONE on patient_longitudinal_facts timestamp columns",
    sql: `
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'patient_longitudinal_facts'
            AND column_name = 'reported_at'
            AND data_type != 'timestamp with time zone'
        ) THEN
          ALTER TABLE patient_longitudinal_facts
            ALTER COLUMN reported_at TYPE TIMESTAMP WITH TIME ZONE USING reported_at AT TIME ZONE 'UTC';
        END IF;

        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'patient_longitudinal_facts'
            AND column_name = 'recorded_at'
            AND data_type != 'timestamp with time zone'
        ) THEN
          ALTER TABLE patient_longitudinal_facts
            ALTER COLUMN recorded_at TYPE TIMESTAMP WITH TIME ZONE USING recorded_at AT TIME ZONE 'UTC';
        END IF;

        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'patient_longitudinal_facts'
            AND column_name = 'last_reviewed_at'
            AND data_type != 'timestamp with time zone'
        ) THEN
          ALTER TABLE patient_longitudinal_facts
            ALTER COLUMN last_reviewed_at TYPE TIMESTAMP WITH TIME ZONE USING last_reviewed_at AT TIME ZONE 'UTC';
        END IF;

        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'patient_longitudinal_facts'
            AND column_name = 'superseded_at'
            AND data_type != 'timestamp with time zone'
        ) THEN
          ALTER TABLE patient_longitudinal_facts
            ALTER COLUMN superseded_at TYPE TIMESTAMP WITH TIME ZONE USING superseded_at AT TIME ZONE 'UTC';
        END IF;
      END $$;
    `,
  },
  {
    id: "0004_create_index_lookup",
    name: "4a. Create index idx_longitudinal_facts_lookup",
    sql: `
      CREATE INDEX IF NOT EXISTS idx_longitudinal_facts_lookup
        ON patient_longitudinal_facts(user_id, patient_profile_id, concept, lifecycle);
    `,
  },
  {
    id: "0004_create_index_idempotency_unique",
    name: "4b. Create unique index idx_longitudinal_facts_idempotency_unique",
    sql: `
      CREATE UNIQUE INDEX IF NOT EXISTS idx_longitudinal_facts_idempotency_unique
        ON patient_longitudinal_facts(patient_profile_id, source_consultation_id, source_turn_id, concept);
    `,
  },
  {
    id: "0004_create_index_one_active_baseline",
    name: "4c. Create unique index idx_one_active_baseline",
    sql: `
      CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_baseline
        ON patient_longitudinal_facts(patient_profile_id, concept)
        WHERE temporal_scope = 'baseline' AND lifecycle = 'active';
    `,
  },
  {
    id: "0004_create_procedure_record_or_supersede",
    name: "5. Create or replace record_or_supersede_patient_longitudinal_fact stored procedure",
    sql: `
      CREATE OR REPLACE FUNCTION record_or_supersede_patient_longitudinal_fact(
        p_id VARCHAR(128),
        p_user_id VARCHAR(128),
        p_patient_profile_id VARCHAR(128),
        p_category VARCHAR(64),
        p_concept VARCHAR(128),
        p_reported_value TEXT,
        p_numeric_value DOUBLE PRECISION,
        p_unit VARCHAR(32),
        p_temporal_scope VARCHAR(32),
        p_verification VARCHAR(32),
        p_source_type VARCHAR(32),
        p_source_consultation_id VARCHAR(128),
        p_source_turn_id VARCHAR(128),
        p_reported_at TIMESTAMP WITH TIME ZONE
      )
      RETURNS TABLE (
        id VARCHAR(128),
        user_id VARCHAR(128),
        patient_profile_id VARCHAR(128),
        category VARCHAR(64),
        concept VARCHAR(128),
        reported_value TEXT,
        numeric_value DOUBLE PRECISION,
        unit VARCHAR(32),
        temporal_scope VARCHAR(32),
        lifecycle VARCHAR(32),
        verification VARCHAR(32),
        source_type VARCHAR(32),
        source_consultation_id VARCHAR(128),
        source_turn_id VARCHAR(128),
        reported_at TIMESTAMP WITH TIME ZONE,
        recorded_at TIMESTAMP WITH TIME ZONE,
        last_reviewed_at TIMESTAMP WITH TIME ZONE,
        supersedes_fact_id VARCHAR(128),
        superseded_by_fact_id VARCHAR(128),
        superseded_at TIMESTAMP WITH TIME ZONE
      ) AS $$
      DECLARE
        v_consent_given BOOLEAN;
        v_existing_id VARCHAR(128);
        v_superseded_id VARCHAR(128) := NULL;
        v_now TIMESTAMP WITH TIME ZONE := NOW();
      BEGIN
        -- 1. Verify Profile Ownership & Consent
        SELECT consent_given INTO v_consent_given
        FROM patient_profiles
        WHERE patient_profiles.id = p_patient_profile_id
          AND patient_profiles.user_id = p_user_id
          AND patient_profiles.is_deleted = false;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'Profile % not found for authorized user %', p_patient_profile_id, p_user_id
            USING ERRCODE = 'P0002';
        END IF;

        IF NOT v_consent_given THEN
          RAISE EXCEPTION 'Longitudinal patient operations require affirmative consent'
            USING ERRCODE = '55000';
        END IF;

        -- 2. Advisory Transaction Lock (Serializes baseline mutations per profile + concept)
        IF p_temporal_scope = 'baseline' THEN
          PERFORM pg_advisory_xact_lock(hashtext(p_patient_profile_id || ':' || p_concept));
        END IF;

        -- 3. Idempotency Check: (patient_profile_id, source_consultation_id, source_turn_id, concept)
        SELECT plf.id INTO v_existing_id
        FROM patient_longitudinal_facts plf
        WHERE plf.patient_profile_id = p_patient_profile_id
          AND plf.source_consultation_id = p_source_consultation_id
          AND plf.source_turn_id = p_source_turn_id
          AND plf.concept = p_concept;

        IF FOUND THEN
          RETURN QUERY
          SELECT plf.id, plf.user_id, plf.patient_profile_id, plf.category, plf.concept,
                 plf.reported_value, plf.numeric_value, plf.unit, plf.temporal_scope,
                 plf.lifecycle, plf.verification, plf.source_type, plf.source_consultation_id,
                 plf.source_turn_id,
                 plf.reported_at::TIMESTAMP WITH TIME ZONE,
                 plf.recorded_at::TIMESTAMP WITH TIME ZONE,
                 plf.last_reviewed_at::TIMESTAMP WITH TIME ZONE,
                 plf.supersedes_fact_id, plf.superseded_by_fact_id,
                 plf.superseded_at::TIMESTAMP WITH TIME ZONE
          FROM patient_longitudinal_facts plf
          WHERE plf.id = v_existing_id;
          RETURN;
        END IF;

        -- 4. If Baseline: find and lock previous active baseline to supersede
        IF p_temporal_scope = 'baseline' THEN
          SELECT plf.id INTO v_superseded_id
          FROM patient_longitudinal_facts plf
          WHERE plf.patient_profile_id = p_patient_profile_id
            AND plf.user_id = p_user_id
            AND plf.concept = p_concept
            AND plf.temporal_scope = 'baseline'
            AND plf.lifecycle = 'active'
          FOR UPDATE;

          IF FOUND THEN
            UPDATE patient_longitudinal_facts
            SET lifecycle = 'superseded',
                superseded_by_fact_id = p_id,
                superseded_at = v_now
            WHERE patient_longitudinal_facts.id = v_superseded_id;
          END IF;
        END IF;

        -- 5. Insert new fact
        INSERT INTO patient_longitudinal_facts (
          id, user_id, patient_profile_id, category, concept,
          reported_value, numeric_value, unit, temporal_scope,
          lifecycle, verification, source_type, source_consultation_id,
          source_turn_id, reported_at, recorded_at, supersedes_fact_id
        ) VALUES (
          p_id, p_user_id, p_patient_profile_id, p_category, p_concept,
          p_reported_value, p_numeric_value, p_unit, p_temporal_scope,
          'active', COALESCE(p_verification, 'unverified'), COALESCE(p_source_type, 'patient'),
          p_source_consultation_id, p_source_turn_id, p_reported_at, v_now, v_superseded_id
        );

        -- 6. Return inserted row
        RETURN QUERY
        SELECT plf.id, plf.user_id, plf.patient_profile_id, plf.category, plf.concept,
               plf.reported_value, plf.numeric_value, plf.unit, plf.temporal_scope,
               plf.lifecycle, plf.verification, plf.source_type, plf.source_consultation_id,
               plf.source_turn_id,
               plf.reported_at::TIMESTAMP WITH TIME ZONE,
               plf.recorded_at::TIMESTAMP WITH TIME ZONE,
               plf.last_reviewed_at::TIMESTAMP WITH TIME ZONE,
               plf.supersedes_fact_id, plf.superseded_by_fact_id,
               plf.superseded_at::TIMESTAMP WITH TIME ZONE
        FROM patient_longitudinal_facts plf
        WHERE plf.id = p_id;
      END;
      $$ LANGUAGE plpgsql;
    `,
  },
];

export interface SchemaVerificationReport {
  tableExists: boolean;
  procedureExists: boolean;
  indexesVerified: string[];
  timestampColumnsVerified: Record<string, string>;
  consultationColumnExists: boolean;
}

/**
 * Rigorously inspects and verifies the post-migration database state.
 * Validates that all tables, stored functions, indexes, and expected column data types
 * (specifically TIMESTAMP WITH TIME ZONE) are properly applied without silent failures.
 */
export async function verifyLongitudinalSchema(
  executeQuery: (sql: string) => Promise<any[]>
): Promise<SchemaVerificationReport> {
  // 1. Table existence check
  const tableCheck = await executeQuery(`
    SELECT table_name FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'patient_longitudinal_facts';
  `);
  if (!tableCheck || tableCheck.length === 0) {
    throw new Error("Verification failed: 'patient_longitudinal_facts' table was not created.");
  }

  // 2. Stored function check
  const funcCheck = await executeQuery(`
    SELECT proname FROM pg_proc WHERE proname = 'record_or_supersede_patient_longitudinal_fact';
  `);
  if (!funcCheck || funcCheck.length === 0) {
    throw new Error("Verification failed: 'record_or_supersede_patient_longitudinal_fact' function was not created.");
  }

  // 3. Index checks
  const expectedIndexes = [
    "idx_longitudinal_facts_lookup",
    "idx_longitudinal_facts_idempotency_unique",
    "idx_one_active_baseline",
  ];
  const indexRows = await executeQuery(`
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'patient_longitudinal_facts';
  `);
  const foundIndexes = new Set(indexRows.map((r: any) => r.indexname));
  const verifiedIndexes: string[] = [];
  for (const expectedIdx of expectedIndexes) {
    if (!foundIndexes.has(expectedIdx)) {
      throw new Error(`Verification failed: Expected index '${expectedIdx}' was not found on 'patient_longitudinal_facts'.`);
    }
    verifiedIndexes.push(expectedIdx);
  }

  // 4. Timestamp columns data type check (must be strictly 'timestamp with time zone')
  const expectedTimestampCols = [
    "reported_at",
    "recorded_at",
    "last_reviewed_at",
    "superseded_at",
  ];
  const columnRows = await executeQuery(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'patient_longitudinal_facts';
  `);
  const colTypeMap = new Map<string, string>(
    columnRows.map((r: any) => [r.column_name, r.data_type])
  );
  const verifiedTimestamps: Record<string, string> = {};
  for (const col of expectedTimestampCols) {
    const actualType = colTypeMap.get(col);
    if (!actualType) {
      throw new Error(`Verification failed: Column '${col}' was not found in 'patient_longitudinal_facts'.`);
    }
    if (actualType !== "timestamp with time zone") {
      throw new Error(
        `Verification failed: Column '${col}' has data_type '${actualType}', expected 'timestamp with time zone'.`
      );
    }
    verifiedTimestamps[col] = actualType;
  }

  // 5. Consultation column check
  const consultColCheck = await executeQuery(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'consultations' AND column_name = 'patient_profile_id';
  `);
  const consultationColumnExists = Boolean(consultColCheck && consultColCheck.length > 0);
  if (!consultationColumnExists) {
    throw new Error("Verification failed: Column 'patient_profile_id' was not found on 'consultations' table.");
  }

  return {
    tableExists: true,
    procedureExists: true,
    indexesVerified: verifiedIndexes,
    timestampColumnsVerified: verifiedTimestamps,
    consultationColumnExists: true,
  };
}

export async function runLongitudinalMigrations(dbUrl?: string): Promise<SchemaVerificationReport | undefined> {
  const targetUrl = dbUrl || resolveTestDatabaseUrl() || process.env.DATABASE_URL;

  if (!targetUrl) {
    if (process.env.REQUIRE_LIVE_DB === "true") {
      throw new Error("FATAL: REQUIRE_LIVE_DB is true, but no DATABASE_URL or TEST_DATABASE_URL found in environment!");
    }
    console.log("ℹ️  No DATABASE_URL configured. Skipping longitudinal PostgreSQL migration runner.");
    return undefined;
  }

  console.log("================================================================================");
  console.log("  MEDVOICE LONGITUDINAL PATIENT CONTEXT MIGRATION RUNNER (0004)                 ");
  console.log("================================================================================");
  console.log(`Target Database: ${maskDatabaseUrl(targetUrl)}`);

  const migrationFilePath = path.join(process.cwd(), "migrations", "longitudinal_patient_context.sql");
  if (!fs.existsSync(migrationFilePath)) {
    throw new Error(`Migration file not found at: ${migrationFilePath}`);
  }

  const isNeonCloud = targetUrl.includes(".neon.tech") || targetUrl.startsWith("https://");
  let report: SchemaVerificationReport;

  if (isNeonCloud) {
    console.log("Datastore Type: Neon Serverless HTTP Driver");
    const sql = neon(targetUrl);

    // In Neon Serverless HTTP driver, execute SQL strings over the wire using sql.query(stmt).
    // Note: sql.unsafe() is for query template interpolation and does NOT execute queries.
    for (let i = 0; i < LONGITUDINAL_MIGRATION_STATEMENTS.length; i++) {
      const stmt = LONGITUDINAL_MIGRATION_STATEMENTS[i];
      console.log(`Executing [${i + 1}/${LONGITUDINAL_MIGRATION_STATEMENTS.length}] ${stmt.name}...`);
      await (sql as any).query(stmt.sql);
      console.log(`  ✓ Applied.`);
    }

    console.log("\n[Step 2] Executing rigorous post-migration schema and type verification...");
    report = await verifyLongitudinalSchema(async (queryStr: string) => {
      return (sql as any).query(queryStr);
    });
  } else {
    console.log("Datastore Type: PostgreSQL Connection Pool (pg.Pool)");
    const pool = new Pool({ connectionString: targetUrl });
    try {
      for (let i = 0; i < LONGITUDINAL_MIGRATION_STATEMENTS.length; i++) {
        const stmt = LONGITUDINAL_MIGRATION_STATEMENTS[i];
        console.log(`Executing [${i + 1}/${LONGITUDINAL_MIGRATION_STATEMENTS.length}] ${stmt.name}...`);
        await pool.query(stmt.sql);
        console.log(`  ✓ Applied.`);
      }

      console.log("\n[Step 2] Executing rigorous post-migration schema and type verification...");
      report = await verifyLongitudinalSchema(async (queryStr: string) => {
        const res = await pool.query(queryStr);
        return res.rows;
      });
    } finally {
      await pool.end().catch(() => {});
    }
  }

  console.log("  ✓ Verified: table 'patient_longitudinal_facts' exists.");
  console.log("  ✓ Verified: procedure 'record_or_supersede_patient_longitudinal_fact' exists.");
  report.indexesVerified.forEach((idx) => console.log(`  ✓ Verified index: ${idx}`));
  Object.entries(report.timestampColumnsVerified).forEach(([col, type]) => {
    console.log(`  ✓ Verified column '${col}': ${type}`);
  });
  console.log("  ✓ Verified column 'patient_profile_id' on consultations table.");

  console.log("================================================================================");
  console.log("  LONGITUDINAL PATIENT CONTEXT MIGRATION APPLIED & VERIFIED SUCCESSFULLY         ");
  console.log("================================================================================\n");

  return report;
}

if (require.main === module || process.argv[1]?.endsWith("run-longitudinal-migrations.ts")) {
  runLongitudinalMigrations().catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
}
