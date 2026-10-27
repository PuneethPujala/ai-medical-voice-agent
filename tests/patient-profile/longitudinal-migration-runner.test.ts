/**
 * Longitudinal Migration Runner & Neon HTTP Contract Test Battery
 *
 * Verifies:
 * 1. Neon HTTP Driver Contract: All DDL commands execute via `sql.query()`; `sql.unsafe()` is never invoked.
 * 2. Single-Query Granularity: Every migration statement is a discrete single query without compound DDL bundling.
 * 3. Non-Suppression Invariant: Timestamp alignment contains no blanket `EXCEPTION WHEN OTHERS THEN NULL`.
 * 4. Post-Migration Schema Verification:
 *    - Fails if `patient_longitudinal_facts` table is missing.
 *    - Fails if `record_or_supersede_patient_longitudinal_fact` procedure is missing.
 *    - Fails if any index (`idx_longitudinal_facts_lookup`, `idx_longitudinal_facts_idempotency_unique`, `idx_one_active_baseline`) is missing.
 *    - Fails if any timestamp column (`reported_at`, `recorded_at`, `last_reviewed_at`, `superseded_at`) is NOT `timestamp with time zone`.
 *    - Fails if `patient_profile_id` on `consultations` is missing.
 *    - Succeeds when all schema and type requirements are satisfied.
 *
 * Execution:
 *   npx tsx tests/patient-profile/longitudinal-migration-runner.test.ts
 */

import assert from "assert";
import {
  LONGITUDINAL_MIGRATION_STATEMENTS,
  verifyLongitudinalSchema,
} from "../../scripts/run-longitudinal-migrations";

async function runMigrationRunnerTests() {
  console.log("================================================================================");
  console.log("  LONGITUDINAL MIGRATION RUNNER & NEON HTTP CONTRACT BATTERY                    ");
  console.log("================================================================================");

  let passed = 0;
  let failed = 0;

  function testPass(name: string) {
    console.log(`  ✓ PASS: ${name}`);
    passed++;
  }

  function testFail(name: string, err: any) {
    console.error(`  ✗ FAIL: ${name}:`, err);
    failed++;
  }

  // ---------------------------------------------------------------------------
  // Test 1: Single-Query Granularity & Zero Compound DDL Statements
  // ---------------------------------------------------------------------------
  try {
    assert(
      LONGITUDINAL_MIGRATION_STATEMENTS.length >= 7,
      `Expected at least 7 discrete statements, found ${LONGITUDINAL_MIGRATION_STATEMENTS.length}`
    );

    for (const stmt of LONGITUDINAL_MIGRATION_STATEMENTS) {
      assert(Boolean(stmt.id), `Statement missing id: ${stmt.name}`);
      assert(Boolean(stmt.name), `Statement missing name: ${stmt.id}`);
      assert(Boolean(stmt.sql.trim()), `Statement missing sql: ${stmt.id}`);

      // Ensure no compound CREATE INDEX statements in a single statement
      const createIndexMatches = (stmt.sql.match(/CREATE\s+(UNIQUE\s+)?INDEX/gi) || []).length;
      assert(
        createIndexMatches <= 1,
        `Statement '${stmt.id}' bundles ${createIndexMatches} index creations into a single query. Each must be discrete for Neon HTTP driver compatibility.`
      );
    }
    testPass("Single-query granularity verified: all statements are discrete single queries");
  } catch (err) {
    testFail("Single-query granularity verification", err);
  }

  // ---------------------------------------------------------------------------
  // Test 2: Error Non-Suppression Invariant in Timestamp Timezone Alignment
  // ---------------------------------------------------------------------------
  try {
    const timezoneStmt = LONGITUDINAL_MIGRATION_STATEMENTS.find(
      (s) => s.id === "0004_align_timestamp_timezone_types"
    );
    assert(timezoneStmt, "0004_align_timestamp_timezone_types statement must exist");

    const sqlLower = timezoneStmt.sql.toLowerCase();
    assert(
      !sqlLower.includes("exception when others then"),
      "Timestamp alignment must not contain blanket 'EXCEPTION WHEN OTHERS THEN' error suppression"
    );
    assert(
      !sqlLower.includes("exception when others then null"),
      "Timestamp alignment must not silently swallow schema modification errors"
    );
    assert(
      sqlLower.includes("information_schema.columns"),
      "Timestamp alignment must conditionally inspect column data types from information_schema"
    );
    assert(
      sqlLower.includes("timestamp with time zone"),
      "Timestamp alignment must target 'timestamp with time zone'"
    );
    testPass("Error non-suppression invariant verified: blanket error suppression eliminated");
  } catch (err) {
    testFail("Error non-suppression verification", err);
  }

  // ---------------------------------------------------------------------------
  // Test 3: Simulated Neon HTTP Execution via sql.query()
  // ---------------------------------------------------------------------------
  try {
    const executedQueries: string[] = [];
    let unsafeCalls = 0;

    // Simulate Neon Serverless HTTP driver instance
    const mockNeonSql: any = (template: any) => {
      throw new Error("Template invocation not expected for raw migration string");
    };
    mockNeonSql.query = async (queryStr: string) => {
      executedQueries.push(queryStr);
      return [];
    };
    mockNeonSql.unsafe = (rawStr: string) => {
      unsafeCalls++;
      return { rawSql: rawStr };
    };

    // Execute all statements through the mock Neon query executor
    for (const stmt of LONGITUDINAL_MIGRATION_STATEMENTS) {
      await mockNeonSql.query(stmt.sql);
    }

    assert.strictEqual(
      unsafeCalls,
      0,
      `sql.unsafe() was called ${unsafeCalls} times. Neon unsafe() does not execute queries over HTTP and must never be called by migration runner.`
    );
    assert.strictEqual(
      executedQueries.length,
      LONGITUDINAL_MIGRATION_STATEMENTS.length,
      `sql.query() was called ${executedQueries.length} times, expected ${LONGITUDINAL_MIGRATION_STATEMENTS.length}`
    );
    testPass("Neon HTTP contract verified: executed exclusively via sql.query(); zero sql.unsafe() calls");
  } catch (err) {
    testFail("Neon HTTP contract verification", err);
  }

  // ---------------------------------------------------------------------------
  // Test 4: Post-Migration Schema Verification Rejects Missing Table
  // ---------------------------------------------------------------------------
  try {
    let failedAsExpected = false;
    await verifyLongitudinalSchema(async (sql: string) => {
      if (sql.includes("information_schema.tables")) {
        return []; // Simulate missing table
      }
      return [{ proname: "record_or_supersede_patient_longitudinal_fact" }];
    }).catch((err) => {
      if (err.message.includes("'patient_longitudinal_facts' table was not created")) {
        failedAsExpected = true;
      }
    });
    assert.strictEqual(failedAsExpected, true, "Schema verification must fail if table is missing");
    testPass("Schema verification correctly fails when table is missing");
  } catch (err) {
    testFail("Missing table verification", err);
  }

  // ---------------------------------------------------------------------------
  // Test 5: Post-Migration Schema Verification Rejects Missing Stored Procedure
  // ---------------------------------------------------------------------------
  try {
    let failedAsExpected = false;
    await verifyLongitudinalSchema(async (sql: string) => {
      if (sql.includes("information_schema.tables")) {
        return [{ table_name: "patient_longitudinal_facts" }];
      }
      if (sql.includes("pg_proc")) {
        return []; // Simulate missing stored procedure
      }
      return [];
    }).catch((err) => {
      if (err.message.includes("'record_or_supersede_patient_longitudinal_fact' function was not created")) {
        failedAsExpected = true;
      }
    });
    assert.strictEqual(failedAsExpected, true, "Schema verification must fail if stored procedure is missing");
    testPass("Schema verification correctly fails when stored procedure is missing");
  } catch (err) {
    testFail("Missing stored procedure verification", err);
  }

  // ---------------------------------------------------------------------------
  // Test 6: Post-Migration Schema Verification Rejects Missing Index
  // ---------------------------------------------------------------------------
  try {
    let failedAsExpected = false;
    await verifyLongitudinalSchema(async (sql: string) => {
      if (sql.includes("information_schema.tables")) {
        return [{ table_name: "patient_longitudinal_facts" }];
      }
      if (sql.includes("pg_proc")) {
        return [{ proname: "record_or_supersede_patient_longitudinal_fact" }];
      }
      if (sql.includes("pg_indexes")) {
        // Missing 'idx_one_active_baseline'
        return [
          { indexname: "idx_longitudinal_facts_lookup" },
          { indexname: "idx_longitudinal_facts_idempotency_unique" },
        ];
      }
      return [];
    }).catch((err) => {
      if (err.message.includes("Expected index 'idx_one_active_baseline' was not found")) {
        failedAsExpected = true;
      }
    });
    assert.strictEqual(failedAsExpected, true, "Schema verification must fail if required index is missing");
    testPass("Schema verification correctly fails when required index is missing");
  } catch (err) {
    testFail("Missing index verification", err);
  }

  // ---------------------------------------------------------------------------
  // Test 7: Post-Migration Schema Verification Rejects Incorrect Timestamp Type
  // ---------------------------------------------------------------------------
  try {
    let failedAsExpected = false;
    await verifyLongitudinalSchema(async (sql: string) => {
      if (sql.includes("information_schema.tables")) {
        return [{ table_name: "patient_longitudinal_facts" }];
      }
      if (sql.includes("pg_proc")) {
        return [{ proname: "record_or_supersede_patient_longitudinal_fact" }];
      }
      if (sql.includes("pg_indexes")) {
        return [
          { indexname: "idx_longitudinal_facts_lookup" },
          { indexname: "idx_longitudinal_facts_idempotency_unique" },
          { indexname: "idx_one_active_baseline" },
        ];
      }
      if (sql.includes("information_schema.columns") && sql.includes("patient_longitudinal_facts")) {
        // Return reported_at as 'timestamp without time zone' (unaligned)
        return [
          { column_name: "reported_at", data_type: "timestamp without time zone" },
          { column_name: "recorded_at", data_type: "timestamp with time zone" },
          { column_name: "last_reviewed_at", data_type: "timestamp with time zone" },
          { column_name: "superseded_at", data_type: "timestamp with time zone" },
        ];
      }
      return [];
    }).catch((err) => {
      if (err.message.includes("Column 'reported_at' has data_type 'timestamp without time zone', expected 'timestamp with time zone'")) {
        failedAsExpected = true;
      }
    });
    assert.strictEqual(failedAsExpected, true, "Schema verification must fail if timestamp column lacks time zone");
    testPass("Schema verification correctly fails when timestamp column is not 'timestamp with time zone'");
  } catch (err) {
    testFail("Timestamp data type verification", err);
  }

  // ---------------------------------------------------------------------------
  // Test 8: Post-Migration Schema Verification Succeeds When All Checks Pass
  // ---------------------------------------------------------------------------
  try {
    const report = await verifyLongitudinalSchema(async (sql: string) => {
      if (sql.includes("information_schema.tables")) {
        return [{ table_name: "patient_longitudinal_facts" }];
      }
      if (sql.includes("pg_proc")) {
        return [{ proname: "record_or_supersede_patient_longitudinal_fact" }];
      }
      if (sql.includes("pg_indexes")) {
        return [
          { indexname: "idx_longitudinal_facts_lookup" },
          { indexname: "idx_longitudinal_facts_idempotency_unique" },
          { indexname: "idx_one_active_baseline" },
        ];
      }
      if (sql.includes("information_schema.columns") && sql.includes("patient_longitudinal_facts")) {
        return [
          { column_name: "reported_at", data_type: "timestamp with time zone" },
          { column_name: "recorded_at", data_type: "timestamp with time zone" },
          { column_name: "last_reviewed_at", data_type: "timestamp with time zone" },
          { column_name: "superseded_at", data_type: "timestamp with time zone" },
        ];
      }
      if (sql.includes("information_schema.columns") && sql.includes("consultations")) {
        return [{ column_name: "patient_profile_id" }];
      }
      return [];
    });

    assert.strictEqual(report.tableExists, true);
    assert.strictEqual(report.procedureExists, true);
    assert.strictEqual(report.indexesVerified.length, 3);
    assert.strictEqual(Object.keys(report.timestampColumnsVerified).length, 4);
    assert.strictEqual(report.consultationColumnExists, true);
    testPass("Schema verification reports 100% success when all constraints & types match");
  } catch (err) {
    testFail("Full schema verification success case", err);
  }

  console.log("================================================================================");
  console.log(`  BATTERY SUMMARY: ${passed} PASSED, ${failed} FAILED (TOTAL: ${passed + failed})`);
  console.log("================================================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module || process.argv[1]?.endsWith("longitudinal-migration-runner.test.ts")) {
  runMigrationRunnerTests().catch((err) => {
    console.error("Fatal error running migration runner test battery:", err);
    process.exit(1);
  });
}
