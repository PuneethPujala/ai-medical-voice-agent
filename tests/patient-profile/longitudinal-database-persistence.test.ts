/**
 * Live PostgreSQL Longitudinal Fact Persistence & Lineage Integration Battery
 *
 * Verifies against a real PostgreSQL datastore (Neon serverless or local test DB):
 * 1. Schema & stored procedure installation (record_or_supersede_patient_longitudinal_fact)
 * 2. Visit 1: Baseline insertion into patient_longitudinal_facts table
 * 3. Exact Turn Idempotency: Duplicate delivery returns existing row without creating duplicate DB rows
 * 4. Atomic Baseline Superseding: Visit 2 updates baseline, atomically superseding Visit 1 in a single statement
 * 5. Retrieval from datastore: getActiveFacts and getFactHistory across simulated client reloads
 * 6. DPDP Act Consent Fail-Closed: Operations against unconsented profiles fail closed in database
 * 7. Tenant Isolation: Multi-user cross-access is strictly blocked at the datastore boundary
 *
 * Execution:
 *   npx tsx tests/patient-profile/longitudinal-database-persistence.test.ts
 */

import assert from "assert";
import * as dotenv from "dotenv";
import {
  assertSafeTestDatabase,
  validateTestDatabaseTarget,
  createSqlHelper,
  resolveTestDatabaseUrl,
} from "../../lib/security/test-db-guard";
import { runLongitudinalMigrations } from "../../scripts/run-longitudinal-migrations";
import {
  LongitudinalFactService,
  ConsentRequiredError,
  ProfileNotFoundError,
} from "../../lib/patient/longitudinal-fact-service";
import { PatientProfileService } from "../../lib/patient/patient-profile-service";
import { closeDbPool } from "../../config/db";

if (process.env.MEDVOICE_OFFLINE_TESTS === "1") {
  delete process.env.DATABASE_URL;
  delete process.env.TEST_DATABASE_URL;
} else {
  dotenv.config({ path: ".env.local" });
  if (!process.env.DATABASE_URL && !process.env.TEST_DATABASE_URL) {
    dotenv.config({ path: ".env" });
  }
}

(process.env as Record<string, string | undefined>).NODE_ENV = "test";

async function runLiveLongitudinalDbTests() {
  console.log("================================================================================");
  console.log("  REAL POSTGRESQL LONGITUDINAL PATIENT FACT PERSISTENCE BATTERY               ");
  console.log("================================================================================");

  const dbUrl = resolveTestDatabaseUrl();
  if (!dbUrl) {
    if (process.env.REQUIRE_LIVE_DB === "true") {
      throw new Error("FATAL: REQUIRE_LIVE_DB is true, but DATABASE_URL is missing!");
    }
    console.warn("⚠️  SKIPPED: DATABASE_URL not configured. Real PostgreSQL datastore required.");
    console.warn("   Skipping live datastore verification in offline/mock environment.");
    return;
  }

  const targetCheck = validateTestDatabaseTarget(dbUrl);
  if (!targetCheck.safe) {
    if (process.env.REQUIRE_LIVE_DB === "true") {
      throw new Error(`\n❌ [TEST DATABASE SAFETY GUARD] ${targetCheck.reason}\n`);
    }
    console.warn("⚠️  SKIPPED: Live database test skipped due to safety guard:");
    console.warn(`   ${targetCheck.reason}`);
    console.warn("   To run against live DB, provide an isolated test datastore via TEST_DATABASE_URL.");
    return;
  }

  assertSafeTestDatabase(dbUrl);
  const sql = createSqlHelper(dbUrl);

  const testUserIdAlice = `test_usr_alice_${Date.now()}`;
  const testUserIdBob = `test_usr_bob_${Date.now()}`;
  const cleanupUserIds = [testUserIdAlice, testUserIdBob];

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

  try {
    // 0. Ensure schema & stored procedure are installed and verified
    console.log("\n[Setup] Running longitudinal migrations on isolated test database...");
    const migrationReport = await runLongitudinalMigrations(dbUrl);
    assert(migrationReport, "Migration report returned");
    assert.strictEqual(migrationReport.tableExists, true, "Table exists");
    assert.strictEqual(migrationReport.procedureExists, true, "Procedure exists");
    assert.strictEqual(migrationReport.indexesVerified.length, 3, "All 3 indexes verified");
    assert.strictEqual(migrationReport.timestampColumnsVerified.reported_at, "timestamp with time zone");
    assert.strictEqual(migrationReport.timestampColumnsVerified.recorded_at, "timestamp with time zone");
    assert.strictEqual(migrationReport.timestampColumnsVerified.last_reviewed_at, "timestamp with time zone");
    assert.strictEqual(migrationReport.timestampColumnsVerified.superseded_at, "timestamp with time zone");
    testPass("Schema, indexes, stored procedure, and timestamp with time zone verified on live PostgreSQL");

    // 1. Seed Alice profile with DPDP consent in real database
    console.log("\n[Test 1] Visit 1: Record Initial Sleep Baseline into PostgreSQL");
    const aliceProfile = await PatientProfileService.upsertProfile(testUserIdAlice, {
      name: "Alice Vance",
      relationshipToUser: "self",
      age: 42,
      consentGiven: true,
    });
    assert(aliceProfile.id, "Alice profile created in database");

    const fact1 = await LongitudinalFactService.recordFact(testUserIdAlice, {
      patientProfileId: aliceProfile.id,
      category: "lifestyle_sleep",
      concept: "usual_sleep_duration",
      reportedValue: "about 5 hours a night",
      numericValue: 5,
      unit: "hours/night",
      temporalScope: "baseline",
      sourceConsultationId: "consult_visit1_001",
      sourceTurnId: "turn_1",
    });

    assert.strictEqual(fact1.lifecycle, "active");
    assert.strictEqual(fact1.reportedValue, "about 5 hours a night");
    assert.strictEqual(fact1.numericValue, 5);

    // Verify row directly in PostgreSQL
    const rows1 = await sql`
      SELECT id, lifecycle, reported_value, numeric_value, temporal_scope, supersedes_fact_id
      FROM patient_longitudinal_facts
      WHERE id = ${fact1.id}
    `;
    assert.strictEqual(rows1.length, 1, "Exactly one row exists in PostgreSQL for Fact 1");
    assert.strictEqual(rows1[0].lifecycle, "active");
    assert.strictEqual(Number(rows1[0].numeric_value), 5);
    assert.strictEqual(rows1[0].temporal_scope, "baseline");
    testPass("Visit 1 baseline fact written to real PostgreSQL with active lifecycle");

    // 2. Exact Turn Idempotency
    console.log("\n[Test 2] Idempotency: Re-recording Identical Consultation Turn Replays Existing Fact");
    const fact1Replay = await LongitudinalFactService.recordFact(testUserIdAlice, {
      patientProfileId: aliceProfile.id,
      category: "lifestyle_sleep",
      concept: "usual_sleep_duration",
      reportedValue: "about 5 hours a night",
      numericValue: 5,
      unit: "hours/night",
      temporalScope: "baseline",
      sourceConsultationId: "consult_visit1_001",
      sourceTurnId: "turn_1",
    });

    assert.strictEqual(fact1Replay.id, fact1.id, "Replay returns identical fact ID");
    const countAfterReplay = await sql`
      SELECT count(*)::int as count
      FROM patient_longitudinal_facts
      WHERE patient_profile_id = ${aliceProfile.id} AND concept = 'usual_sleep_duration'
    `;
    assert.strictEqual(countAfterReplay[0].count, 1, "Zero duplicate rows created on turn retry");
    testPass("Exact turn replay is completely idempotent in PostgreSQL");

    // 3. Atomic Baseline Superseding in Visit 2
    console.log("\n[Test 3] Visit 2: Atomic Baseline Superseding (5h -> 7h)");
    const fact2 = await LongitudinalFactService.recordFact(testUserIdAlice, {
      patientProfileId: aliceProfile.id,
      category: "lifestyle_sleep",
      concept: "usual_sleep_duration",
      reportedValue: "about 7 hours a night after CPAP therapy",
      numericValue: 7,
      unit: "hours/night",
      temporalScope: "baseline",
      sourceConsultationId: "consult_visit2_002",
      sourceTurnId: "turn_3",
    });

    assert.strictEqual(fact2.lifecycle, "active");
    assert.strictEqual(fact2.supersedesFactId, fact1.id, "Fact 2 references superseded Fact 1");

    // Check PostgreSQL state for both rows
    const oldFactRow = await sql`
      SELECT lifecycle, superseded_by_fact_id, superseded_at
      FROM patient_longitudinal_facts
      WHERE id = ${fact1.id}
    `;
    assert.strictEqual(oldFactRow[0].lifecycle, "superseded", "Fact 1 is marked superseded in DB");
    assert.strictEqual(oldFactRow[0].superseded_by_fact_id, fact2.id, "Fact 1 superseded_by points to Fact 2");
    assert(oldFactRow[0].superseded_at, "superseded_at timestamp is populated");

    const newFactRow = await sql`
      SELECT lifecycle, supersedes_fact_id
      FROM patient_longitudinal_facts
      WHERE id = ${fact2.id}
    `;
    assert.strictEqual(newFactRow[0].lifecycle, "active", "Fact 2 is active in DB");
    assert.strictEqual(newFactRow[0].supersedes_fact_id, fact1.id, "Fact 2 supersedes points to Fact 1");

    // Check unique active baseline index enforcement
    const activeBaselines = await sql`
      SELECT count(*)::int as count
      FROM patient_longitudinal_facts
      WHERE patient_profile_id = ${aliceProfile.id}
        AND concept = 'usual_sleep_duration'
        AND temporal_scope = 'baseline'
        AND lifecycle = 'active'
    `;
    assert.strictEqual(activeBaselines[0].count, 1, "Exactly 1 active baseline exists in DB");
    testPass("Visit 2 atomically supersedes Visit 1 baseline in PostgreSQL with full lineage");

    // 4. Data retrieval from PostgreSQL
    console.log("\n[Test 4] Retrieval: getActiveFacts & getFactHistory from PostgreSQL");
    const activeFacts = await LongitudinalFactService.getActiveFacts(testUserIdAlice, aliceProfile.id);
    assert.strictEqual(activeFacts.length, 1, "Only active facts returned by getActiveFacts");
    assert.strictEqual(activeFacts[0].id, fact2.id);
    assert.strictEqual(activeFacts[0].reportedValue, "about 7 hours a night after CPAP therapy");

    const history = await LongitudinalFactService.getFactHistory(testUserIdAlice, aliceProfile.id, "usual_sleep_duration");
    assert.strictEqual(history.length, 2, "Complete 2-fact history returned by getFactHistory");
    assert.strictEqual(history[0].id, fact2.id, "Latest fact appears first");
    assert.strictEqual(history[1].id, fact1.id, "Previous superseded fact appears second");
    assert.strictEqual(history[1].supersededByFactId, fact2.id);
    testPass("getActiveFacts and getFactHistory read accurately from PostgreSQL");

    // 5. DPDP Consent Enforcement in Database
    console.log("\n[Test 5] DPDP Act Consent Fail-Closed Invariant");
    const unconsentedProfile = await PatientProfileService.upsertProfile(testUserIdAlice, {
      name: "Unconsented Relative",
      relationshipToUser: "other",
      age: 30,
      consentGiven: false,
    });

    let consentBlocked = false;
    try {
      await LongitudinalFactService.recordFact(testUserIdAlice, {
        patientProfileId: unconsentedProfile.id,
        category: "lifestyle_sleep",
        concept: "usual_sleep_duration",
        reportedValue: "6 hours",
        temporalScope: "baseline",
        sourceConsultationId: "consult_unconsented",
        sourceTurnId: "turn_1",
      });
    } catch (err: any) {
      if (err instanceof ConsentRequiredError || err.message?.includes("affirmative consent")) {
        consentBlocked = true;
      }
    }
    assert.strictEqual(consentBlocked, true, "Writing facts without consent throws ConsentRequiredError");
    testPass("Database operations fail closed when patient consent is not granted");

    // 6. Tenant & Profile Isolation
    console.log("\n[Test 6] Tenant Datastore Boundary & IDOR Prevention");
    let crossTenantBlocked = false;
    try {
      await LongitudinalFactService.recordFact(testUserIdBob, {
        patientProfileId: aliceProfile.id, // Bob attempting to mutate Alice's profile
        category: "lifestyle_sleep",
        concept: "usual_sleep_duration",
        reportedValue: "hacked",
        temporalScope: "baseline",
        sourceConsultationId: "consult_malicious",
        sourceTurnId: "turn_1",
      });
    } catch (err: any) {
      if (err instanceof ProfileNotFoundError || err.message?.includes("not found")) {
        crossTenantBlocked = true;
      }
    }
    assert.strictEqual(crossTenantBlocked, true, "Cross-user profile access blocked at service/DB boundary");
    testPass("Cross-tenant profile mutation strictly prevented in database");

  } catch (err) {
    testFail("PostgreSQL Longitudinal Persistence Suite", err);
  } finally {
    // Cleanup test data
    console.log("\n[Cleanup] Cleaning up test records from PostgreSQL...");
    try {
      for (const uid of cleanupUserIds) {
        await sql`DELETE FROM patient_longitudinal_facts WHERE user_id = ${uid};`;
        await sql`DELETE FROM patient_profiles WHERE user_id = ${uid};`;
      }
      console.log("  ✓ Test records purged.");
    } catch (cleanupErr) {
      console.warn("  ⚠️  Cleanup failed:", cleanupErr);
    }
    if (sql.end) {
      await sql.end();
    }
    await closeDbPool();
  }

  console.log("================================================================================");
  console.log(`  BATTERY SUMMARY: ${passed} PASSED, ${failed} FAILED (TOTAL: ${passed + failed})`);
  console.log("================================================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module || process.argv[1]?.endsWith("longitudinal-database-persistence.test.ts")) {
  runLiveLongitudinalDbTests().catch((err) => {
    console.error("Fatal error in live PostgreSQL longitudinal test:", err);
    process.exit(1);
  });
}
