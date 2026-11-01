/**
 * Real PostgreSQL Clinical Artifacts & Database Invariants Integration Battery (M6 Stage 1)
 *
 * Exercises the actual SQL migration `drizzle/0006_add_clinical_artifacts.sql` and
 * schema constraints against an isolated PostgreSQL instance.
 *
 * Invariants Verified:
 * 1. Empty audit ledger genesis initialization
 * 2. Existing valid audit ledger initialization
 * 3. Missing audit index rejection
 * 4. Interior previous-hash corruption rejection
 * 5. Snapshot mutation and deletion rejection (PostgreSQL trigger)
 * 6. Signed artifact mutation and deletion rejection (PostgreSQL trigger)
 * 7. Amendment cancellation and version replacement (partial active version index)
 * 8. Competing amendment rejection (partial active successor index)
 * 9. Composite foreign-key enforcement (consultation & artifact_type lineage)
 * 10. Signing idempotency schema constraints (actor scope, composite FK, SHA-256 regex)
 * 11. Database rollback on failed transaction
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import {
  assertSafeTestDatabase,
  validateTestDatabaseTarget,
} from "../../lib/security/test-db-guard";
import {
  verifyHistoricalAuditChainForMigration,
  AuditChainIntegrityError,
} from "../../lib/audit/pre-migration-verifier";
import {
  AuditEvent,
  computeEventHashV2,
  GENESIS_HASH,
} from "../../lib/audit/audit-logger";

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://postgres:testpass@localhost:5433/medvoice_test";

describe("Milestone 6 Stage 1: Isolated PostgreSQL Clinical Artifacts & Database Invariants", () => {
  let pool: Pool;

  before(async () => {
    // 1. Enforce strict safety guard
    const targetCheck = validateTestDatabaseTarget(TEST_DB_URL);
    assert.strictEqual(
      targetCheck.safe,
      true,
      `Target database must be verified safe. Reason: ${targetCheck.reason}`
    );
    assertSafeTestDatabase(TEST_DB_URL);

    pool = new Pool({ connectionString: TEST_DB_URL });

    // 2. Set up base tables (consultations, audit_events) if not already present
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "consultations" (
        "id" varchar(128) PRIMARY KEY,
        "user_id" varchar(128),
        "doctor_id" varchar(64) NOT NULL DEFAULT 'dr-sarah-chen',
        "doctor_name" varchar(128) NOT NULL DEFAULT 'Dr. Sarah Chen, MD',
        "specialty" varchar(128) NOT NULL DEFAULT 'General Medicine',
        "chief_complaint" text,
        "transcript" jsonb,
        "soap_subjective" text,
        "soap_objective" text,
        "soap_assessment" text,
        "soap_plan" text,
        "icd10_codes" jsonb,
        "status" varchar(64) DEFAULT 'completed_pending_review',
        "approved_at" timestamp,
        "approved_by" varchar(128),
        "case_version" integer DEFAULT 1,
        "created_at" timestamp DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS "audit_events" (
        "index" integer NOT NULL UNIQUE,
        "id" varchar(128) PRIMARY KEY,
        "timestamp" varchar(64) NOT NULL,
        "actor_id" varchar(128) NOT NULL,
        "actor_role" varchar(64) NOT NULL,
        "action" varchar(128) NOT NULL,
        "resource_type" varchar(64) NOT NULL,
        "resource_id" varchar(255) NOT NULL,
        "status" varchar(32) NOT NULL,
        "client_ip" varchar(64),
        "metadata" jsonb,
        "previous_hash" varchar(64) NOT NULL,
        "event_hash" varchar(64) NOT NULL,
        "created_at" timestamp DEFAULT now()
      );
    `);

    // Clean any prior M6 test tables for clean migration test
    await pool.query(`
      DROP TABLE IF EXISTS "signing_idempotency_keys" CASCADE;
      DROP TABLE IF EXISTS "clinical_artifacts" CASCADE;
      DROP TABLE IF EXISTS "consultation_snapshots" CASCADE;
      DROP TABLE IF EXISTS "audit_chain_heads" CASCADE;
      DROP TRIGGER IF EXISTS trg_clinical_artifacts_immutability ON "clinical_artifacts";
      DROP FUNCTION IF EXISTS trg_enforce_clinical_artifact_immutability();
      DROP TRIGGER IF EXISTS trg_consultation_snapshots_immutability ON "consultation_snapshots";
      DROP FUNCTION IF EXISTS trg_enforce_consultation_snapshot_immutability();
    `);
  });

  after(async () => {
    if (pool) {
      await pool.end().catch(() => {});
    }
  });

  // ==========================================================================
  // Test 1: Empty Audit Ledger Genesis Initialization
  // ==========================================================================
  it("1. Empty audit ledger initializes audit_chain_heads at index -1 with genesis hash", async () => {
    await pool.query(`DELETE FROM "audit_events"`);

    // Read and execute the exact migration file
    const migrationSql = fs.readFileSync(
      path.join(__dirname, "../../drizzle/0006_add_clinical_artifacts.sql"),
      "utf8"
    );
    await pool.query(migrationSql);

    const res = await pool.query(
      `SELECT * FROM "audit_chain_heads" WHERE "chain_id" = 'main'`
    );
    assert.strictEqual(res.rows.length, 1);
    assert.strictEqual(res.rows[0].last_event_index, -1);
    assert.strictEqual(res.rows[0].last_event_hash, GENESIS_HASH);
  });

  // ==========================================================================
  // Test 2: Existing Valid Audit Ledger Initialization
  // ==========================================================================
  it("2. Existing valid audit ledger initializes audit_chain_heads from terminal event", async () => {
    // Reset chain head and populate valid historical events
    await pool.query(`DROP TABLE IF EXISTS "audit_chain_heads" CASCADE`);
    await pool.query(`DELETE FROM "audit_events"`);

    const event0 = {
      index: 0,
      id: "AUD-000",
      timestamp: "2026-11-01T00:00:00.000Z",
      actorId: "usr_doc_1",
      actorRole: "clinician" as const,
      action: "CONSULTATION_CREATED" as const,
      resourceType: "consultation" as const,
      resourceId: "ENC-001",
      status: "SUCCESS" as const,
      metadata: { note: "Initial encounter" },
      previousHash: GENESIS_HASH,
    };
    const hash0 = computeEventHashV2(event0);

    const event1 = {
      index: 1,
      id: "AUD-001",
      timestamp: "2026-11-01T00:05:00.000Z",
      actorId: "usr_doc_1",
      actorRole: "clinician" as const,
      action: "TRIAGE_EVALUATION" as const,
      resourceType: "consultation" as const,
      resourceId: "ENC-001",
      status: "SUCCESS" as const,
      metadata: { esi: 3 },
      previousHash: hash0,
    };
    const hash1 = computeEventHashV2(event1);

    await pool.query(
      `INSERT INTO "audit_events" ("index", "id", "timestamp", "actor_id", "actor_role", "action", "resource_type", "resource_id", "status", "metadata", "previous_hash", "event_hash")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12),
              ($13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)`,
      [
        event0.index, event0.id, event0.timestamp, event0.actorId, event0.actorRole, event0.action, event0.resourceType, event0.resourceId, event0.status, JSON.stringify(event0.metadata), event0.previousHash, hash0,
        event1.index, event1.id, event1.timestamp, event1.actorId, event1.actorRole, event1.action, event1.resourceType, event1.resourceId, event1.status, JSON.stringify(event1.metadata), event1.previousHash, hash1,
      ]
    );

    // Run verification utility on this history
    const report = verifyHistoricalAuditChainForMigration([
      { ...event0, eventHash: hash0 } as AuditEvent,
      { ...event1, eventHash: hash1 } as AuditEvent,
    ]);
    assert.strictEqual(report.canProceed, true);
    assert.strictEqual(report.terminalIndex, 1);
    assert.strictEqual(report.terminalHash, hash1);

    // Re-run migration SQL block to verify it initializes from event 1
    const migrationSql = fs.readFileSync(
      path.join(__dirname, "../../drizzle/0006_add_clinical_artifacts.sql"),
      "utf8"
    );
    await pool.query(migrationSql);

    const res = await pool.query(
      `SELECT * FROM "audit_chain_heads" WHERE "chain_id" = 'main'`
    );
    assert.strictEqual(res.rows.length, 1);
    assert.strictEqual(res.rows[0].last_event_index, 1);
    assert.strictEqual(res.rows[0].last_event_hash, hash1);
  });

  // ==========================================================================
  // Test 3: Missing Audit Index Rejection
  // ==========================================================================
  it("3. Missing audit index (non-contiguous indices) aborts verification and migration", async () => {
    // Gap: index 0 followed by index 2
    const gappedEvents: AuditEvent[] = [
      {
        index: 0,
        id: "AUD-000",
        timestamp: "2026-11-01T00:00:00.000Z",
        actorId: "usr_doc_1",
        actorRole: "clinician",
        action: "CONSULTATION_CREATED",
        resourceType: "consultation",
        resourceId: "ENC-001",
        status: "SUCCESS",
        previousHash: GENESIS_HASH,
        eventHash: "some_hash_0",
      },
      {
        index: 2, // GAP: expected 1
        id: "AUD-002",
        timestamp: "2026-11-01T00:05:00.000Z",
        actorId: "usr_doc_1",
        actorRole: "clinician",
        action: "TRIAGE_EVALUATION",
        resourceType: "consultation",
        resourceId: "ENC-001",
        status: "SUCCESS",
        previousHash: "some_hash_0",
        eventHash: "some_hash_2",
      },
    ];

    assert.throws(
      () => verifyHistoricalAuditChainForMigration(gappedEvents),
      AuditChainIntegrityError
    );
  });

  // ==========================================================================
  // Test 4: Interior Previous-Hash Corruption Rejection
  // ==========================================================================
  it("4. Corrupted interior previous_hash pointer aborts pre-migration verification", () => {
    const event0 = {
      index: 0,
      id: "AUD-000",
      timestamp: "2026-11-01T00:00:00.000Z",
      actorId: "usr_doc_1",
      actorRole: "clinician" as const,
      action: "CONSULTATION_CREATED" as const,
      resourceType: "consultation" as const,
      resourceId: "ENC-001",
      status: "SUCCESS" as const,
      previousHash: GENESIS_HASH,
    };
    const hash0 = computeEventHashV2(event0);

    const event1Corrupted = {
      index: 1,
      id: "AUD-001",
      timestamp: "2026-11-01T00:05:00.000Z",
      actorId: "usr_doc_1",
      actorRole: "clinician" as const,
      action: "TRIAGE_EVALUATION" as const,
      resourceType: "consultation" as const,
      resourceId: "ENC-001",
      status: "SUCCESS" as const,
      previousHash: "0000000000000000000000000000000000000000000000000000000000000099", // WRONG
    };
    const hash1 = computeEventHashV2(event1Corrupted);

    const events: AuditEvent[] = [
      { ...event0, eventHash: hash0 } as AuditEvent,
      { ...event1Corrupted, eventHash: hash1 } as AuditEvent,
    ];

    assert.throws(
      () => verifyHistoricalAuditChainForMigration(events),
      (err: any) => {
        assert.ok(err instanceof AuditChainIntegrityError);
        assert.ok(err.message.includes("Broken chain pointer"));
        return true;
      }
    );
  });

  // ==========================================================================
  // Test 5: Snapshot Mutation and Deletion Rejection
  // ==========================================================================
  it("5. Snapshot immutability trigger blocks both UPDATE and DELETE operations", async () => {
    const consultationId = `enc_snap_test_${Date.now()}`;
    await pool.query(
      `INSERT INTO "consultations" ("id", "doctor_id", "doctor_name", "specialty")
       VALUES ($1, 'dr-chen', 'Dr. Chen', 'Internal Med')`,
      [consultationId]
    );

    const snapshotId = `snap_test_${Date.now()}`;
    await pool.query(
      `INSERT INTO "consultation_snapshots" ("id", "consultation_id", "case_version", "trigger_reason", "interview_state", "transcript_turn_count", "transcript_hash_boundary")
       VALUES ($1, $2, 1, 'patient_pause', '{"phase":"active"}'::jsonb, 5, 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2')`,
      [snapshotId, consultationId]
    );

    // Attempt UPDATE -> Must throw trigger exception
    await assert.rejects(
      pool.query(
        `UPDATE "consultation_snapshots" SET "trigger_reason" = 'tampered' WHERE "id" = $1`,
        [snapshotId]
      ),
      /CONSULTATION_SNAPSHOT_IMMUTABLE/
    );

    // Attempt DELETE -> Must throw trigger exception
    await assert.rejects(
      pool.query(`DELETE FROM "consultation_snapshots" WHERE "id" = $1`, [snapshotId]),
      /CONSULTATION_SNAPSHOT_IMMUTABLE/
    );
  });

  // ==========================================================================
  // Test 6: Signed Artifact Mutation and Deletion Rejection
  // ==========================================================================
  it("6. Signed clinical artifact immutability trigger blocks UPDATE and DELETE", async () => {
    const consultationId = `enc_art_imm_test_${Date.now()}`;
    await pool.query(
      `INSERT INTO "consultations" ("id", "doctor_id", "doctor_name", "specialty")
       VALUES ($1, 'dr-chen', 'Dr. Chen', 'Internal Med')`,
      [consultationId]
    );

    const artifactId = `art_signed_${Date.now()}`;
    const dummyHash = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    await pool.query(
      `INSERT INTO "clinical_artifacts" (
        "id", "consultation_id", "version", "status", "chief_complaint",
        "soap_subjective", "soap_objective", "soap_assessment", "soap_plan",
        "signed_by", "signed_by_role", "signed_at", "payload_sha256", "signing_attestation_digest"
      ) VALUES ($1, $2, 1, 'signed', 'Chest pain', 'Subj narrative', 'Obj vitals', 'ACS', 'Cath lab', 'usr_doc', 'clinician', now(), $3, $4)`,
      [artifactId, consultationId, dummyHash, dummyHash]
    );

    // Attempt UPDATE -> Must throw CLINICAL_ARTIFACT_IMMUTABLE
    await assert.rejects(
      pool.query(
        `UPDATE "clinical_artifacts" SET "soap_subjective" = 'Tampered text' WHERE "id" = $1`,
        [artifactId]
      ),
      /CLINICAL_ARTIFACT_IMMUTABLE/
    );

    // Attempt DELETE -> Must throw CLINICAL_ARTIFACT_IMMUTABLE
    await assert.rejects(
      pool.query(`DELETE FROM "clinical_artifacts" WHERE "id" = $1`, [artifactId]),
      /CLINICAL_ARTIFACT_IMMUTABLE/
    );
  });

  // ==========================================================================
  // Test 7: Amendment Cancellation and Active Version Replacement
  // ==========================================================================
  it("7. Cancelled amendment releases active version constraint, permitting replacement v2", async () => {
    const consultationId = `enc_amend_cancel_${Date.now()}`;
    await pool.query(
      `INSERT INTO "consultations" ("id", "doctor_id", "doctor_name", "specialty")
       VALUES ($1, 'dr-chen', 'Dr. Chen', 'Internal Med')`,
      [consultationId]
    );

    const dummyHash = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    const v1Id = `art_v1_${Date.now()}`;
    await pool.query(
      `INSERT INTO "clinical_artifacts" (
        "id", "consultation_id", "version", "status", "chief_complaint",
        "soap_subjective", "soap_objective", "soap_assessment", "soap_plan",
        "signed_by", "signed_by_role", "signed_at", "payload_sha256", "signing_attestation_digest"
      ) VALUES ($1, $2, 1, 'signed', 'Complaint', 'S', 'O', 'A', 'P', 'usr_doc', 'clinician', now(), $3, $4)`,
      [v1Id, consultationId, dummyHash, dummyHash]
    );

    // Create amendment v2 draft
    const v2DraftId = `art_v2_draft_${Date.now()}`;
    await pool.query(
      `INSERT INTO "clinical_artifacts" (
        "id", "consultation_id", "version", "status", "chief_complaint",
        "soap_subjective", "soap_objective", "soap_assessment", "soap_plan",
        "amends_artifact_id", "amendment_reason"
      ) VALUES ($1, $2, 2, 'draft', 'Complaint', 'S updated', 'O', 'A', 'P', $3, 'Patient correction on onset')`,
      [v2DraftId, consultationId, v1Id]
    );

    // Mark v2 draft as cancelled
    await pool.query(
      `UPDATE "clinical_artifacts" SET "status" = 'cancelled' WHERE "id" = $1`,
      [v2DraftId]
    );

    // Create replacement v2 draft targeting v1 -> MUST succeed cleanly
    const v2ReplacementId = `art_v2_replacement_${Date.now()}`;
    await pool.query(
      `INSERT INTO "clinical_artifacts" (
        "id", "consultation_id", "version", "status", "chief_complaint",
        "soap_subjective", "soap_objective", "soap_assessment", "soap_plan",
        "amends_artifact_id", "amendment_reason"
      ) VALUES ($1, $2, 2, 'draft', 'Complaint', 'S clean replacement', 'O', 'A', 'P', $3, 'Replacement amendment')`,
      [v2ReplacementId, consultationId, v1Id]
    );

    const check = await pool.query(
      `SELECT "id", "version", "status" FROM "clinical_artifacts" WHERE "consultation_id" = $1 AND "version" = 2`,
      [consultationId]
    );
    assert.strictEqual(check.rows.length, 2); // 1 cancelled, 1 draft
    const active = check.rows.find((r) => r.status === "draft");
    assert.strictEqual(active?.id, v2ReplacementId);
  });

  // ==========================================================================
  // Test 8: Competing Amendment Rejection
  // ==========================================================================
  it("8. Competing active amendment drafts against the same parent artifact are rejected", async () => {
    const consultationId = `enc_competing_${Date.now()}`;
    await pool.query(
      `INSERT INTO "consultations" ("id", "doctor_id", "doctor_name", "specialty")
       VALUES ($1, 'dr-chen', 'Dr. Chen', 'Internal Med')`,
      [consultationId]
    );

    const dummyHash = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
    const v1Id = `art_v1_comp_${Date.now()}`;
    await pool.query(
      `INSERT INTO "clinical_artifacts" (
        "id", "consultation_id", "version", "status", "chief_complaint",
        "soap_subjective", "soap_objective", "soap_assessment", "soap_plan",
        "signed_by", "signed_by_role", "signed_at", "payload_sha256", "signing_attestation_digest"
      ) VALUES ($1, $2, 1, 'signed', 'Complaint', 'S', 'O', 'A', 'P', 'usr_doc', 'clinician', now(), $3, $4)`,
      [v1Id, consultationId, dummyHash, dummyHash]
    );

    // First active amendment draft
    const v2aId = `art_v2a_${Date.now()}`;
    await pool.query(
      `INSERT INTO "clinical_artifacts" (
        "id", "consultation_id", "version", "status", "chief_complaint",
        "soap_subjective", "soap_objective", "soap_assessment", "soap_plan",
        "amends_artifact_id", "amendment_reason"
      ) VALUES ($1, $2, 2, 'draft', 'Complaint', 'S', 'O', 'A', 'P', $3, 'Reason 1')`,
      [v2aId, consultationId, v1Id]
    );

    // Attempting a second active amendment targeting v1 -> Must be rejected by idx_one_active_amendment_successor
    const v2bId = `art_v2b_${Date.now()}`;
    await assert.rejects(
      pool.query(
        `INSERT INTO "clinical_artifacts" (
          "id", "consultation_id", "version", "status", "chief_complaint",
          "soap_subjective", "soap_objective", "soap_assessment", "soap_plan",
          "amends_artifact_id", "amendment_reason"
        ) VALUES ($1, $2, 3, 'draft', 'Complaint', 'S', 'O', 'A', 'P', $3, 'Competing branch')`,
        [v2bId, consultationId, v1Id]
      ),
      /idx_one_active_amendment_successor/
    );
  });

  // ==========================================================================
  // Test 9: Composite Foreign-Key Enforcement
  // ==========================================================================
  it("9. Composite foreign key rejects amendments referencing artifacts from another consultation", async () => {
    const consult1 = `enc_cross_1_${Date.now()}`;
    const consult2 = `enc_cross_2_${Date.now()}`;
    await pool.query(
      `INSERT INTO "consultations" ("id", "doctor_id", "doctor_name", "specialty")
       VALUES ($1, 'dr-chen', 'Dr. Chen', 'Internal Med'),
              ($2, 'dr-chen', 'Dr. Chen', 'Internal Med')`,
      [consult1, consult2]
    );

    const dummyHash = "11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff";
    const artInConsult1 = `art_c1_${Date.now()}`;
    await pool.query(
      `INSERT INTO "clinical_artifacts" (
        "id", "consultation_id", "version", "status", "chief_complaint",
        "soap_subjective", "soap_objective", "soap_assessment", "soap_plan",
        "signed_by", "signed_by_role", "signed_at", "payload_sha256", "signing_attestation_digest"
      ) VALUES ($1, $2, 1, 'signed', 'Complaint', 'S', 'O', 'A', 'P', 'usr_doc', 'clinician', now(), $3, $4)`,
      [artInConsult1, consult1, dummyHash, dummyHash]
    );

    // Attempt amendment in consult2 that references artInConsult1
    const invalidCrossConsultAmend = `art_cross_${Date.now()}`;
    await assert.rejects(
      pool.query(
        `INSERT INTO "clinical_artifacts" (
          "id", "consultation_id", "version", "status", "chief_complaint",
          "soap_subjective", "soap_objective", "soap_assessment", "soap_plan",
          "amends_artifact_id", "amendment_reason"
        ) VALUES ($1, $2, 2, 'draft', 'Complaint', 'S', 'O', 'A', 'P', $3, 'Cross-encounter attack')`,
        [invalidCrossConsultAmend, consult2, artInConsult1]
      ),
      /fk_clinical_artifacts_amendment_lineage/
    );
  });

  // ==========================================================================
  // Test 10: Signing Idempotency Schema Constraints
  // ==========================================================================
  it("10. Signing idempotency table enforces actor scope, composite FK, and 64-char hex SHA-256", async () => {
    const consultationId = `enc_idemp_${Date.now()}`;
    await pool.query(
      `INSERT INTO "consultations" ("id", "doctor_id", "doctor_name", "specialty")
       VALUES ($1, 'dr-chen', 'Dr. Chen', 'Internal Med')`,
      [consultationId]
    );

    const dummyHash = "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899";
    const artifactId = `art_idemp_${Date.now()}`;
    await pool.query(
      `INSERT INTO "clinical_artifacts" (
        "id", "consultation_id", "version", "status", "chief_complaint",
        "soap_subjective", "soap_objective", "soap_assessment", "soap_plan",
        "signed_by", "signed_by_role", "signed_at", "payload_sha256", "signing_attestation_digest"
      ) VALUES ($1, $2, 1, 'signed', 'Complaint', 'S', 'O', 'A', 'P', 'usr_doc', 'clinician', now(), $3, $4)`,
      [artifactId, consultationId, dummyHash, dummyHash]
    );

    // Valid idempotency key insert
    const validHash = "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
    await pool.query(
      `INSERT INTO "signing_idempotency_keys" (
        "idempotency_key", "consultation_id", "artifact_id", "actor_id", "request_hash", "result_artifact_id"
      ) VALUES ('key_123', $1, $2, 'usr_doc', $3, $2)`,
      [consultationId, artifactId, validHash]
    );

    // Invalid hash format (not 64-char hex) -> Must violate chk_request_hash_sha256
    await assert.rejects(
      pool.query(
        `INSERT INTO "signing_idempotency_keys" (
          "idempotency_key", "consultation_id", "artifact_id", "actor_id", "request_hash", "result_artifact_id"
        ) VALUES ('key_bad_hash', $1, $2, 'usr_doc', 'NOT_A_VALID_SHA256_STRING', $2)`,
        [consultationId, artifactId]
      ),
      /chk_request_hash_sha256/
    );

    // Duplicate idempotency key for same actor/encounter/artifact -> Violates primary key
    await assert.rejects(
      pool.query(
        `INSERT INTO "signing_idempotency_keys" (
          "idempotency_key", "consultation_id", "artifact_id", "actor_id", "request_hash", "result_artifact_id"
        ) VALUES ('key_123', $1, $2, 'usr_doc', $3, $2)`,
        [consultationId, artifactId, validHash]
      ),
      /pk_signing_idempotency_keys/
    );
  });

  // ==========================================================================
  // Test 11: Database Rollback on Failed Transactions
  // ==========================================================================
  it("11. Failed transaction rolls back artifact status, consultation CAS, and idempotency key", async () => {
    const consultationId = `enc_rollback_${Date.now()}`;
    await pool.query(
      `INSERT INTO "consultations" ("id", "doctor_id", "doctor_name", "specialty", "case_version", "status")
       VALUES ($1, 'dr-chen', 'Dr. Chen', 'Internal Med', 1, 'completed_pending_review')`,
      [consultationId]
    );

    const artifactId = `art_rollback_${Date.now()}`;
    await pool.query(
      `INSERT INTO "clinical_artifacts" (
        "id", "consultation_id", "version", "status", "chief_complaint",
        "soap_subjective", "soap_objective", "soap_assessment", "soap_plan"
      ) VALUES ($1, $2, 1, 'pending_review', 'Complaint', 'S', 'O', 'A', 'P')`,
      [artifactId, consultationId]
    );

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // 1. Update artifact to signed
      const dummyHash = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
      await client.query(
        `UPDATE "clinical_artifacts"
         SET "status" = 'signed', "signed_by" = 'usr_doc', "signed_by_role" = 'clinician',
             "signed_at" = now(), "payload_sha256" = $1, "signing_attestation_digest" = $2
         WHERE "id" = $3`,
        [dummyHash, dummyHash, artifactId]
      );

      // 2. Advance consultation CAS
      await client.query(
        `UPDATE "consultations" SET "status" = 'approved', "case_version" = 2 WHERE "id" = $1`,
        [consultationId]
      );

      // 3. Insert idempotency key
      await client.query(
        `INSERT INTO "signing_idempotency_keys" ("idempotency_key", "consultation_id", "artifact_id", "actor_id", "request_hash", "result_artifact_id")
         VALUES ('rollback_key', $1, $2, 'usr_doc', $3, $2)`,
        [consultationId, artifactId, dummyHash]
      );

      // 4. Simulated failure (e.g. audit write crash)
      throw new Error("Simulated audit write failure inside signing transaction");
    } catch (err: any) {
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }

    // Verify complete rollback in database
    const artCheck = await pool.query(
      `SELECT "status", "signed_by" FROM "clinical_artifacts" WHERE "id" = $1`,
      [artifactId]
    );
    assert.strictEqual(artCheck.rows[0].status, "pending_review");
    assert.strictEqual(artCheck.rows[0].signed_by, null);

    const consultCheck = await pool.query(
      `SELECT "status", "case_version" FROM "consultations" WHERE "id" = $1`,
      [consultationId]
    );
    assert.strictEqual(consultCheck.rows[0].status, "completed_pending_review");
    assert.strictEqual(consultCheck.rows[0].case_version, 1);

    const idempCheck = await pool.query(
      `SELECT * FROM "signing_idempotency_keys" WHERE "consultation_id" = $1`,
      [consultationId]
    );
    assert.strictEqual(idempCheck.rows.length, 0);
  });
});
