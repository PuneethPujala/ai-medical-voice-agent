/**
 * Milestone 6 Stage 2: Clinical Artifact Service & Transactional Signing Integration Battery
 *
 * Verifies all 16 clinical artifact lifecycle and transactional invariants against
 * isolated PostgreSQL (localhost:5433/medvoice_test):
 * 1. Multiple concurrent audit writers serializing on audit_chain_heads
 * 2. Cryptographic audit-chain index and hash continuity
 * 3. Audit write rollback on transaction abort
 * 4. Artifact draft creation and editing
 * 5. Automatic pending_review downgrade to draft on content modification
 * 6. Amendment lineage validation (parent signed, reason >= 10 chars, version increment)
 * 7. Amendment cancellation and replacement versioning
 * 8. Competing amendment rejection (only one active successor permitted)
 * 9. Concurrent signing serialization
 * 10. Lost-response signing retry (idempotent replay without duplicate audit event)
 * 11. Idempotency-key payload mismatch (409 IDEMPOTENCY_KEY_PAYLOAD_MISMATCH)
 * 12. Incorrect consultation/artifact associations (400 ARTIFACT_CONSULTATION_MISMATCH)
 * 13. Unauthorized clinician signing (403 UNAUTHORIZED_CLINICIAN)
 * 14. CAS version conflicts (409 CAS_CONFLICT)
 * 15. Audit datastore failure rolling back entire signing operation
 * 16. Legacy SOAP compatibility mirror updated only after signing
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import {
  assertSafeTestDatabase,
  validateTestDatabaseTarget,
} from "../../lib/security/test-db-guard";
import { getDb, closeDbPool } from "../../config/db";
import {
  createDraftArtifact,
  updateDraftArtifact,
  submitForReview,
  createAmendment,
  cancelArtifact,
  signArtifactInTransaction,
  computeCanonicalArtifactDigest,
  computeSigningAttestationDigest,
  verifyArtifactIntegrity,
  ClinicianAuthorizationError,
  ArtifactConsultationMismatchError,
  IdempotencyKeyPayloadMismatchError,
  CasConflictError,
  ArtifactNotReadyForSigningError,
  ArtifactAlreadySignedError,
  ArtifactCancelledError,
  CompetingAmendmentError,
  InvalidAmendmentLineageError,
  ArtifactImmutabilityViolationError,
} from "../../lib/consultation/clinical-artifact-service";
import {
  logAuditEventAsync,
  logAuditEventInTransaction,
  verifyAuditChain,
  __setSimulatedAuditFailure,
  clearAuditLedger,
} from "../../lib/audit/audit-logger";

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://postgres:testpass@localhost:5433/medvoice_test";

describe("Milestone 6 Stage 2: Clinical Artifact Service & Transactional Signing Battery", () => {
  let pool: Pool;
  let drizzleDb: any;

  before(async () => {
    // 1. Strict safety guard enforcement
    const targetCheck = validateTestDatabaseTarget(TEST_DB_URL);
    assert.strictEqual(
      targetCheck.safe,
      true,
      `Target database must be verified safe. Reason: ${targetCheck.reason}`
    );
    assertSafeTestDatabase(TEST_DB_URL);

    process.env.TEST_DATABASE_URL = TEST_DB_URL;
    pool = new Pool({ connectionString: TEST_DB_URL });

    // 2. Clean prior test tables
    await pool.query(`
      DROP TABLE IF EXISTS "signing_idempotency_keys" CASCADE;
      DROP TABLE IF EXISTS "clinical_artifacts" CASCADE;
      DROP TABLE IF EXISTS "consultation_snapshots" CASCADE;
      DROP TABLE IF EXISTS "audit_chain_heads" CASCADE;
      DROP TABLE IF EXISTS "audit_events" CASCADE;
      DROP TABLE IF EXISTS "consultations" CASCADE;
      DROP TRIGGER IF EXISTS trg_clinical_artifacts_immutability ON "clinical_artifacts";
      DROP FUNCTION IF EXISTS trg_enforce_clinical_artifact_immutability();
      DROP TRIGGER IF EXISTS trg_consultation_snapshots_immutability ON "consultation_snapshots";
      DROP FUNCTION IF EXISTS trg_enforce_consultation_snapshot_immutability();
    `);

    // 3. Base tables setup
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

    // 4. Ensure Migration 0006 DDL has been applied
    const ddlPath = path.join(process.cwd(), "drizzle", "0006_add_clinical_artifacts.sql");
    const ddlContent = fs.readFileSync(ddlPath, "utf-8");
    await pool.query(ddlContent);

    // 5. Connect Drizzle instance
    drizzleDb = getDb();
    assert(drizzleDb, "Drizzle client should be initialized against test database");
  });

  after(async () => {
    __setSimulatedAuditFailure(false);
    if (pool) {
      await pool.end().catch(() => {});
    }
    await closeDbPool();
  });

  beforeEach(async () => {
    __setSimulatedAuditFailure(false);
    clearAuditLedger();
  });

  // Helper to seed a clean consultation
  async function seedConsultation(id: string, caseVersion = 1): Promise<void> {
    await pool.query(
      `INSERT INTO consultations (id, user_id, doctor_id, doctor_name, case_version, status, chief_complaint, created_at)
       VALUES ($1, 'user-stage2-test', 'dr-sarah-chen', 'Dr. Sarah Chen, MD', $2, 'active', 'Chest tightness and shortness of breath', NOW())
       ON CONFLICT (id) DO UPDATE SET case_version = $2, status = 'active', soap_subjective = NULL, soap_objective = NULL, soap_assessment = NULL, soap_plan = NULL`,
      [id, caseVersion]
    );
  }

  // --------------------------------------------------------------------------
  // Test 1 & 2: Concurrent Audit Writers & Cryptographic Hash Continuity
  // --------------------------------------------------------------------------
  it("Test 1 & 2: serializes concurrent audit writes and maintains unbroken hash chain", async () => {
    const writeCount = 8;
    const writePromises = Array.from({ length: writeCount }).map((_, i) =>
      logAuditEventAsync({
        actorId: `clinician-${i}`,
        actorRole: "clinician",
        action: "CLINICAL_ARTIFACT_DRAFT_CREATED",
        resourceType: "clinical_artifact",
        resourceId: `art-concurrent-${i}`,
        metadata: { thread: i },
      })
    );

    const results = await Promise.all(writePromises);
    assert.strictEqual(results.length, writeCount);

    // Verify database rows and continuity
    const res = await pool.query(`SELECT * FROM audit_events ORDER BY index ASC`);
    const events = res.rows.map((r) => ({
      index: r.index,
      id: r.id,
      timestamp: r.timestamp,
      actorId: r.actor_id,
      actorRole: r.actor_role,
      action: r.action,
      resourceType: r.resource_type,
      resourceId: r.resource_id,
      status: r.status,
      clientIp: r.client_ip || undefined,
      metadata: r.metadata || undefined,
      previousHash: r.previous_hash,
      eventHash: r.event_hash,
    }));

    // Indices must be strictly contiguous
    for (let i = 0; i < events.length; i++) {
      assert.strictEqual(events[i].index, i, `Event at position ${i} must have index ${i}`);
      if (i > 0) {
        assert.strictEqual(
          events[i].previousHash,
          events[i - 1].eventHash,
          `Event ${i} previousHash must match event ${i - 1} eventHash`
        );
      }
    }

    // Cryptographic chain verification
    const verification = verifyAuditChain(events);
    assert.strictEqual(verification.valid, true, `Audit chain must be cryptographically valid: ${verification.reason}`);

    // Verify audit_chain_heads reflects last event
    const headRes = await pool.query(`SELECT * FROM audit_chain_heads WHERE chain_id = 'main'`);
    assert.strictEqual(headRes.rows.length, 1);
    const lastEvent = events[events.length - 1];
    assert.strictEqual(headRes.rows[0].last_event_index, lastEvent.index);
    assert.strictEqual(headRes.rows[0].last_event_hash, lastEvent.eventHash);
  });

  // --------------------------------------------------------------------------
  // Test 3: Audit Write Rollback on Transaction Abort
  // --------------------------------------------------------------------------
  it("Test 3: rolls back audit write and does not advance chain head when transaction aborts", async () => {
    const headBefore = (await pool.query(`SELECT * FROM audit_chain_heads WHERE chain_id = 'main'`)).rows[0];
    const initialIndex = headBefore.last_event_index;
    const initialHash = headBefore.last_event_hash;

    // Execute an aborted transaction
    await assert.rejects(
      async () => {
        await drizzleDb.transaction(async (tx: any) => {
          await logAuditEventInTransaction(tx, {
            actorId: "dr-abort",
            actorRole: "clinician",
            action: "CLINICAL_ARTIFACT_DRAFT_CREATED",
            resourceType: "clinical_artifact",
            resourceId: "art-will-abort",
          });
          throw new Error("FORCED_TRANSACTION_ABORT");
        });
      },
      /FORCED_TRANSACTION_ABORT/
    );

    // Verify audit_chain_heads was NOT modified
    const headAfter = (await pool.query(`SELECT * FROM audit_chain_heads WHERE chain_id = 'main'`)).rows[0];
    assert.strictEqual(headAfter.last_event_index, initialIndex);
    assert.strictEqual(headAfter.last_event_hash, initialHash);

    // Verify event was not persisted
    const eventCheck = await pool.query(`SELECT * FROM audit_events WHERE resource_id = 'art-will-abort'`);
    assert.strictEqual(eventCheck.rows.length, 0);

    // A subsequent transaction must proceed cleanly with no index gap
    const validEvent = await logAuditEventAsync({
      actorId: "dr-success",
      actorRole: "clinician",
      action: "CLINICAL_ARTIFACT_DRAFT_CREATED",
      resourceType: "clinical_artifact",
      resourceId: "art-after-abort",
    });

    assert.strictEqual(validEvent.index, initialIndex + 1);
    assert.strictEqual(validEvent.previousHash, initialHash);
  });

  // --------------------------------------------------------------------------
  // Test 4: Draft Creation and Editing
  // --------------------------------------------------------------------------
  it("Test 4: creates and updates draft artifact cleanly", async () => {
    const consultId = "c-draft-test-1";
    await seedConsultation(consultId, 1);

    // 1. Create draft
    const draft = await drizzleDb.transaction(async (tx: any) => {
      return await createDraftArtifact(tx, {
        consultationId: consultId,
        chiefComplaint: "Severe migraine",
        soapSubjective: "Patient reports 8/10 throbbing headache",
        soapObjective: "BP 130/85, neurological exam intact",
        soapAssessment: "Acute migraine without aura",
        soapPlan: "Sumatriptan 50mg, dark room rest",
        icd10Codes: ["G43.909"],
        esiScore: 3,
        actorId: "dr-sarah-chen",
        actorRole: "clinician",
      });
    });

    assert.strictEqual(draft.version, 1);
    assert.strictEqual(draft.status, "draft");
    assert.strictEqual(draft.payloadSha256, null);
    assert.strictEqual(draft.signingAttestationDigest, null);

    // 2. Update draft
    const updated = await drizzleDb.transaction(async (tx: any) => {
      return await updateDraftArtifact(tx, {
        artifactId: draft.id,
        soapSubjective: "Patient reports 9/10 throbbing headache with photophobia",
        actorId: "dr-sarah-chen",
        actorRole: "clinician",
      });
    });

    assert.strictEqual(updated.id, draft.id);
    assert.strictEqual(updated.status, "draft");
    assert.strictEqual(
      updated.soapSubjective,
      "Patient reports 9/10 throbbing headache with photophobia"
    );
  });

  // --------------------------------------------------------------------------
  // Test 5: Automatic Pending_Review Downgrade to Draft on Content Modification
  // --------------------------------------------------------------------------
  it("Test 5: automatically downgrades pending_review to draft on content modification", async () => {
    const consultId = "c-downgrade-test";
    await seedConsultation(consultId, 1);

    const draft = await drizzleDb.transaction(async (tx: any) => {
      return await createDraftArtifact(tx, {
        consultationId: consultId,
        chiefComplaint: "Pleuritic chest pain",
        soapSubjective: "Sharp pain on inspiration",
        soapObjective: "Lungs clear bilaterally, SpO2 98%",
        soapAssessment: "Suspected costochondritis",
        soapPlan: "NSAIDs and follow-up in 48h",
        actorId: "dr-sarah-chen",
        actorRole: "clinician",
      });
    });

    // Submit for review -> transitions to pending_review
    const pendingReview = await drizzleDb.transaction(async (tx: any) => {
      return await submitForReview(tx, {
        artifactId: draft.id,
        actorId: "dr-sarah-chen",
        actorRole: "clinician",
      });
    });
    assert.strictEqual(pendingReview.status, "pending_review");

    // Modify clinical content while pending_review
    const downgraded = await drizzleDb.transaction(async (tx: any) => {
      return await updateDraftArtifact(tx, {
        artifactId: draft.id,
        soapPlan: "NSAIDs, heat pack, and return precautions",
        actorId: "dr-sarah-chen",
        actorRole: "clinician",
      });
    });

    // Invariant: MUST be downgraded to 'draft'
    assert.strictEqual(downgraded.status, "draft");

    // Clinician cannot sign until resubmitting
    await assert.rejects(
      async () => {
        await drizzleDb.transaction(async (tx: any) => {
          await signArtifactInTransaction(tx, {
            consultationId: consultId,
            artifactId: draft.id,
            clinicianId: "dr-sarah-chen",
            clinicianRole: "clinician",
            idempotencyKey: "key-should-fail-draft",
            expectedCaseVersion: 1,
          });
        });
      },
      (err: any) => err instanceof ArtifactNotReadyForSigningError
    );

    // Resubmit for review
    const resubmitted = await drizzleDb.transaction(async (tx: any) => {
      return await submitForReview(tx, {
        artifactId: draft.id,
        actorId: "dr-sarah-chen",
        actorRole: "clinician",
      });
    });
    assert.strictEqual(resubmitted.status, "pending_review");
  });

  // --------------------------------------------------------------------------
  // Test 6: Amendment Lineage Validation
  // --------------------------------------------------------------------------
  it("Test 6: enforces amendment lineage rules (parent signed, reason >= 10 chars, version increment)", async () => {
    const consultId = "c-amend-lineage";
    await seedConsultation(consultId, 1);

    // Create and sign Version 1
    const v1Draft = await drizzleDb.transaction(async (tx: any) => {
      return await createDraftArtifact(tx, {
        consultationId: consultId,
        chiefComplaint: "Hypertension check",
        soapSubjective: "Asymptomatic",
        soapObjective: "BP 145/92",
        soapAssessment: "Stage 2 Essential Hypertension",
        soapPlan: "Start Lisinopril 10mg daily",
        actorId: "dr-sarah-chen",
        actorRole: "clinician",
      });
    });

    // Attempting to amend an un-signed draft must fail
    await assert.rejects(
      async () => {
        await drizzleDb.transaction(async (tx: any) => {
          await createAmendment(tx, {
            consultationId: consultId,
            amendsArtifactId: v1Draft.id,
            amendmentReason: "Valid reason for amendment here",
            actorId: "dr-sarah-chen",
            actorRole: "clinician",
          });
        });
      },
      (err: any) => err instanceof InvalidAmendmentLineageError
    );

    // Submit and sign Version 1
    await drizzleDb.transaction(async (tx: any) => {
      await submitForReview(tx, { artifactId: v1Draft.id, actorId: "dr-sarah-chen", actorRole: "clinician" });
      await signArtifactInTransaction(tx, {
        consultationId: consultId,
        artifactId: v1Draft.id,
        clinicianId: "dr-sarah-chen",
        clinicianRole: "clinician",
        idempotencyKey: "key-sign-v1",
        expectedCaseVersion: 1,
      });
    });

    // Attempting to amend with too-short reason must fail
    await assert.rejects(
      async () => {
        await drizzleDb.transaction(async (tx: any) => {
          await createAmendment(tx, {
            consultationId: consultId,
            amendsArtifactId: v1Draft.id,
            amendmentReason: "Too short",
            actorId: "dr-sarah-chen",
            actorRole: "clinician",
          });
        });
      },
      (err: any) => err instanceof InvalidAmendmentLineageError
    );

    // Create valid amendment
    const v2Amendment = await drizzleDb.transaction(async (tx: any) => {
      return await createAmendment(tx, {
        consultationId: consultId,
        amendsArtifactId: v1Draft.id,
        amendmentReason: "Updated blood pressure log from home monitoring",
        soapObjective: "BP 138/88 average from home log",
        actorId: "dr-sarah-chen",
        actorRole: "clinician",
      });
    });

    assert.strictEqual(v2Amendment.version, 2);
    assert.strictEqual(v2Amendment.amendsArtifactId, v1Draft.id);
    assert.strictEqual(v2Amendment.status, "draft");
    assert.strictEqual(v2Amendment.soapObjective, "BP 138/88 average from home log");
    assert.strictEqual(v2Amendment.soapPlan, "Start Lisinopril 10mg daily"); // Inherited from parent
  });

  // --------------------------------------------------------------------------
  // Test 7 & 8: Competing Amendments Rejection & Cancellation Replacement
  // --------------------------------------------------------------------------
  it("Test 7 & 8: rejects competing active amendments and allows replacement after cancellation", async () => {
    const consultId = "c-compete-cancel";
    await seedConsultation(consultId, 1);

    // 1. Create and sign v1
    const v1 = await drizzleDb.transaction(async (tx: any) => {
      const draft = await createDraftArtifact(tx, {
        consultationId: consultId,
        chiefComplaint: "Right knee pain",
        soapSubjective: "Twisted knee playing tennis",
        soapObjective: "Mild joint effusion, McMurray equivocal",
        soapAssessment: "Suspected medial meniscus tear",
        soapPlan: "MRI right knee, RICE protocol",
        actorId: "dr-sarah-chen",
        actorRole: "clinician",
      });
      await submitForReview(tx, { artifactId: draft.id, actorId: "dr-sarah-chen", actorRole: "clinician" });
      const signed = await signArtifactInTransaction(tx, {
        consultationId: consultId,
        artifactId: draft.id,
        clinicianId: "dr-sarah-chen",
        clinicianRole: "clinician",
        idempotencyKey: "key-sign-v1-knee",
        expectedCaseVersion: 1,
      });
      return signed.artifact;
    });

    // 2. Create first active amendment (v2)
    const v2a = await drizzleDb.transaction(async (tx: any) => {
      return await createAmendment(tx, {
        consultationId: consultId,
        amendsArtifactId: v1.id,
        amendmentReason: "First proposed amendment with updated notes",
        actorId: "dr-sarah-chen",
        actorRole: "clinician",
      });
    });

    // 3. Attempting to create a competing active amendment must be rejected
    await assert.rejects(
      async () => {
        await drizzleDb.transaction(async (tx: any) => {
          await createAmendment(tx, {
            consultationId: consultId,
            amendsArtifactId: v1.id,
            amendmentReason: "Competing simultaneous amendment attempt",
            actorId: "dr-alex-carter",
            actorRole: "clinician",
          });
        });
      },
      (err: any) => err instanceof CompetingAmendmentError || err.code === "23505"
    );

    // 4. Cancel the active amendment v2a
    const cancelled = await drizzleDb.transaction(async (tx: any) => {
      return await cancelArtifact(tx, {
        artifactId: v2a.id,
        actorId: "dr-sarah-chen",
        actorRole: "clinician",
        cancellationReason: "Discarding draft in favor of comprehensive MRI report",
      });
    });
    assert.strictEqual(cancelled.status, "cancelled");

    // 5. Now, creating replacement amendment MUST succeed
    const v2Replacement = await drizzleDb.transaction(async (tx: any) => {
      return await createAmendment(tx, {
        consultationId: consultId,
        amendsArtifactId: v1.id,
        amendmentReason: "Replacement amendment including MRI findings: complex posterior horn tear",
        soapObjective: "MRI confirmed complex posterior horn medial meniscus tear",
        actorId: "dr-sarah-chen",
        actorRole: "clinician",
      });
    });

    assert.strictEqual(v2Replacement.version, 2);
    assert.strictEqual(v2Replacement.status, "draft");
    assert.strictEqual(v2Replacement.amendsArtifactId, v1.id);
  });

  // --------------------------------------------------------------------------
  // Test 9: Concurrent Signing Serialization
  // --------------------------------------------------------------------------
  it("Test 9: serializes concurrent signing transactions and allows exactly one signature", async () => {
    const consultId = "c-concurrent-sign";
    await seedConsultation(consultId, 1);

    const draft = await drizzleDb.transaction(async (tx: any) => {
      const d = await createDraftArtifact(tx, {
        consultationId: consultId,
        chiefComplaint: "Asthma exacerbation",
        soapSubjective: "Shortness of breath for 2 days",
        soapObjective: "Expiratory wheezes bilaterally, SpO2 94%",
        soapAssessment: "Mild asthma exacerbation",
        soapPlan: "Albuterol nebulizer, oral Prednisone 40mg x 5 days",
        actorId: "dr-sarah-chen",
        actorRole: "clinician",
      });
      return await submitForReview(tx, { artifactId: d.id, actorId: "dr-sarah-chen", actorRole: "clinician" });
    });

    // Launch two simultaneous signing transactions with different idempotency keys
    const p1 = drizzleDb.transaction((tx: any) =>
      signArtifactInTransaction(tx, {
        consultationId: consultId,
        artifactId: draft.id,
        clinicianId: "dr-sarah-chen",
        clinicianRole: "clinician",
        idempotencyKey: "key-concurrent-1",
        expectedCaseVersion: 1,
      })
    );

    const p2 = drizzleDb.transaction((tx: any) =>
      signArtifactInTransaction(tx, {
        consultationId: consultId,
        artifactId: draft.id,
        clinicianId: "dr-alex-carter",
        clinicianRole: "clinician",
        idempotencyKey: "key-concurrent-2",
        expectedCaseVersion: 1,
      })
    );

    const results = await Promise.allSettled([p1, p2]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    assert.strictEqual(fulfilled.length, 1, "Exactly one signing transaction must succeed");
    assert.strictEqual(rejected.length, 1, "The competing transaction must be rejected");

    // Verify artifact is signed exactly once
    const finalArt = (await pool.query(`SELECT * FROM clinical_artifacts WHERE id = $1`, [draft.id])).rows[0];
    assert.strictEqual(finalArt.status, "signed");
  });

  // --------------------------------------------------------------------------
  // Test 10: Lost-Response Idempotent Replay
  // --------------------------------------------------------------------------
  it("Test 10: returns original signed artifact on lost-response retry without duplicate audit events", async () => {
    const consultId = "c-idemp-replay";
    await seedConsultation(consultId, 1);

    const draft = await drizzleDb.transaction(async (tx: any) => {
      const d = await createDraftArtifact(tx, {
        consultationId: consultId,
        chiefComplaint: "Strep pharyngitis",
        soapSubjective: "Sore throat, fever, no cough",
        soapObjective: "Pharyngeal erythema with tonsillar exudates",
        soapAssessment: "Streptococcal pharyngitis (Centor score 4)",
        soapPlan: "Amoxicillin 500mg TID x 10 days",
        actorId: "dr-sarah-chen",
        actorRole: "clinician",
      });
      return await submitForReview(tx, { artifactId: d.id, actorId: "dr-sarah-chen", actorRole: "clinician" });
    });

    const headBefore = (await pool.query(`SELECT * FROM audit_chain_heads WHERE chain_id = 'main'`)).rows[0];

    // First attempt: signs successfully
    const firstResult = await drizzleDb.transaction(async (tx: any) => {
      return await signArtifactInTransaction(tx, {
        consultationId: consultId,
        artifactId: draft.id,
        clinicianId: "dr-sarah-chen",
        clinicianRole: "clinician",
        idempotencyKey: "key-lost-response-123",
        expectedCaseVersion: 1,
      });
    });

    assert.strictEqual(firstResult.idempotentReplay, false);
    assert.strictEqual(firstResult.artifact.status, "signed");

    const headAfterFirst = (await pool.query(`SELECT * FROM audit_chain_heads WHERE chain_id = 'main'`)).rows[0];
    assert.strictEqual(headAfterFirst.last_event_index, headBefore.last_event_index + 1);

    // Second attempt (simulating client retry after lost network response)
    const replayResult = await drizzleDb.transaction(async (tx: any) => {
      return await signArtifactInTransaction(tx, {
        consultationId: consultId,
        artifactId: draft.id,
        clinicianId: "dr-sarah-chen",
        clinicianRole: "clinician",
        idempotencyKey: "key-lost-response-123",
        expectedCaseVersion: 1,
      });
    });

    assert.strictEqual(replayResult.idempotentReplay, true);
    assert.strictEqual(replayResult.artifact.id, firstResult.artifact.id);
    assert.strictEqual(replayResult.artifact.payloadSha256, firstResult.artifact.payloadSha256);

    // Invariant: Chain head must NOT advance on idempotent replay (no duplicate audit events)
    const headAfterReplay = (await pool.query(`SELECT * FROM audit_chain_heads WHERE chain_id = 'main'`)).rows[0];
    assert.strictEqual(headAfterReplay.last_event_index, headAfterFirst.last_event_index);
    assert.strictEqual(headAfterReplay.last_event_hash, headAfterFirst.last_event_hash);
  });

  // --------------------------------------------------------------------------
  // Test 11: Idempotency Key Payload Mismatch (409)
  // --------------------------------------------------------------------------
  it("Test 11: throws 409 IDEMPOTENCY_KEY_PAYLOAD_MISMATCH when same key reused with different payload", async () => {
    const consultId = "c-idemp-mismatch";
    await seedConsultation(consultId, 1);

    const draft = await drizzleDb.transaction(async (tx: any) => {
      const d = await createDraftArtifact(tx, {
        consultationId: consultId,
        chiefComplaint: "Urinary tract infection",
        soapSubjective: "Dysuria and urinary urgency",
        soapObjective: "Afebrile, no CVA tenderness",
        soapAssessment: "Uncomplicated cystitis",
        soapPlan: "Nitrofurantoin 100mg BID x 5 days",
        actorId: "dr-sarah-chen",
        actorRole: "clinician",
      });
      return await submitForReview(tx, { artifactId: d.id, actorId: "dr-sarah-chen", actorRole: "clinician" });
    });

    // Sign with key
    await drizzleDb.transaction(async (tx: any) => {
      await signArtifactInTransaction(tx, {
        consultationId: consultId,
        artifactId: draft.id,
        clinicianId: "dr-sarah-chen",
        clinicianRole: "clinician",
        idempotencyKey: "reused-key-mismatch-test",
        expectedCaseVersion: 1,
      });
    });

    // Replay with DIFFERENT expectedCaseVersion
    await assert.rejects(
      async () => {
        await drizzleDb.transaction(async (tx: any) => {
          await signArtifactInTransaction(tx, {
            consultationId: consultId,
            artifactId: draft.id,
            clinicianId: "dr-sarah-chen",
            clinicianRole: "clinician",
            idempotencyKey: "reused-key-mismatch-test",
            expectedCaseVersion: 99, // Mismatched parameter
          });
        });
      },
      (err: any) => err instanceof IdempotencyKeyPayloadMismatchError && err.statusCode === 409
    );
  });

  // --------------------------------------------------------------------------
  // Test 12: Consultation & Artifact Association Mismatch (400)
  // --------------------------------------------------------------------------
  it("Test 12: rejects signing when artifact does not belong to the consultation", async () => {
    await seedConsultation("c-owner-1", 1);
    await seedConsultation("c-owner-2", 1);

    const draft = await drizzleDb.transaction(async (tx: any) => {
      const d = await createDraftArtifact(tx, {
        consultationId: "c-owner-1",
        chiefComplaint: "Skin rash",
        soapSubjective: "Itchy rash on forearms",
        soapObjective: "Erythematous plaques with scaling",
        soapAssessment: "Contact dermatitis",
        soapPlan: "Hydrocortisone 1% cream",
        actorId: "dr-sarah-chen",
        actorRole: "clinician",
      });
      return await submitForReview(tx, { artifactId: d.id, actorId: "dr-sarah-chen", actorRole: "clinician" });
    });

    await assert.rejects(
      async () => {
        await drizzleDb.transaction(async (tx: any) => {
          await signArtifactInTransaction(tx, {
            consultationId: "c-owner-2", // Mismatched consultation!
            artifactId: draft.id,
            clinicianId: "dr-sarah-chen",
            clinicianRole: "clinician",
            idempotencyKey: "key-mismatch-test",
            expectedCaseVersion: 1,
          });
        });
      },
      (err: any) => err instanceof ArtifactConsultationMismatchError && err.statusCode === 400
    );
  });

  // --------------------------------------------------------------------------
  // Test 13: Unauthorized Clinician Signing (403)
  // --------------------------------------------------------------------------
  it("Test 13: rejects signing by non-clinician roles with 403", async () => {
    const consultId = "c-unauth-test";
    await seedConsultation(consultId, 1);

    const draft = await drizzleDb.transaction(async (tx: any) => {
      const d = await createDraftArtifact(tx, {
        consultationId: consultId,
        chiefComplaint: "Fatigue",
        soapSubjective: "Feeling tired for a month",
        soapObjective: "Vitals normal, pallor noted",
        soapAssessment: "Fatigue, r/o iron deficiency anemia",
        soapPlan: "Order CBC, Ferritin, TSH",
        actorId: "dr-sarah-chen",
        actorRole: "clinician",
      });
      return await submitForReview(tx, { artifactId: d.id, actorId: "dr-sarah-chen", actorRole: "clinician" });
    });

    await assert.rejects(
      async () => {
        await drizzleDb.transaction(async (tx: any) => {
          await signArtifactInTransaction(tx, {
            consultationId: consultId,
            artifactId: draft.id,
            clinicianId: "patient-123",
            clinicianRole: "patient" as any, // Unauthorized role
            idempotencyKey: "key-unauth",
            expectedCaseVersion: 1,
          });
        });
      },
      (err: any) => err instanceof ClinicianAuthorizationError && err.statusCode === 403
    );
  });

  // --------------------------------------------------------------------------
  // Test 14: CAS Version Conflicts (409)
  // --------------------------------------------------------------------------
  it("Test 14: rejects signing with 409 CAS_CONFLICT when case_version has drifted", async () => {
    const consultId = "c-cas-test";
    await seedConsultation(consultId, 3); // Consultation is at version 3

    const draft = await drizzleDb.transaction(async (tx: any) => {
      const d = await createDraftArtifact(tx, {
        consultationId: consultId,
        chiefComplaint: "Seasonal allergies",
        soapSubjective: "Sneezing, watery eyes",
        soapObjective: "Nasal mucosal edema",
        soapAssessment: "Allergic rhinitis",
        soapPlan: "Cetirizine 10mg daily",
        actorId: "dr-sarah-chen",
        actorRole: "clinician",
      });
      return await submitForReview(tx, { artifactId: d.id, actorId: "dr-sarah-chen", actorRole: "clinician" });
    });

    await assert.rejects(
      async () => {
        await drizzleDb.transaction(async (tx: any) => {
          await signArtifactInTransaction(tx, {
            consultationId: consultId,
            artifactId: draft.id,
            clinicianId: "dr-sarah-chen",
            clinicianRole: "clinician",
            idempotencyKey: "key-cas-mismatch",
            expectedCaseVersion: 1, // Stale expected version!
          });
        });
      },
      (err: any) => err instanceof CasConflictError && err.statusCode === 409
    );
  });

  // --------------------------------------------------------------------------
  // Test 15: Audit Failure Rolling Back Entire Signing Operation
  // --------------------------------------------------------------------------
  it("Test 15: rolls back entire signing transaction if audit persistence fails", async () => {
    const consultId = "c-audit-fail-test";
    await seedConsultation(consultId, 1);

    const draft = await drizzleDb.transaction(async (tx: any) => {
      const d = await createDraftArtifact(tx, {
        consultationId: consultId,
        chiefComplaint: "Acute back spasm",
        soapSubjective: "Lower back pain after lifting box",
        soapObjective: "Lumbar paraspinal tenderness, negative straight leg raise",
        soapAssessment: "Acute lumbar strain",
        soapPlan: "Cyclobenzaprine 5mg at bedtime, gentle stretching",
        actorId: "dr-sarah-chen",
        actorRole: "clinician",
      });
      return await submitForReview(tx, { artifactId: d.id, actorId: "dr-sarah-chen", actorRole: "clinician" });
    });

    // Simulate transient audit datastore failure
    __setSimulatedAuditFailure(true);

    await assert.rejects(
      async () => {
        await drizzleDb.transaction(async (tx: any) => {
          await signArtifactInTransaction(tx, {
            consultationId: consultId,
            artifactId: draft.id,
            clinicianId: "dr-sarah-chen",
            clinicianRole: "clinician",
            idempotencyKey: "key-audit-fail",
            expectedCaseVersion: 1,
          });
        });
      },
      /Simulated transient audit ledger datastore failure/
    );

    __setSimulatedAuditFailure(false);

    // Invariants: Entire transaction must have rolled back
    const artCheck = (await pool.query(`SELECT * FROM clinical_artifacts WHERE id = $1`, [draft.id])).rows[0];
    assert.strictEqual(artCheck.status, "pending_review", "Artifact must remain pending_review");
    assert.strictEqual(artCheck.signed_at, null, "signed_at must remain NULL");

    const consultCheck = (await pool.query(`SELECT * FROM consultations WHERE id = $1`, [consultId])).rows[0];
    assert.strictEqual(consultCheck.case_version, 1, "case_version must not have incremented");
    assert.strictEqual(consultCheck.soap_subjective, null, "SOAP mirror must not have been updated");
  });

  // --------------------------------------------------------------------------
  // Test 16: Legacy SOAP Mirror Updated Exclusively on Signing
  // --------------------------------------------------------------------------
  it("Test 16: updates legacy SOAP mirror only after signing, keeping it unpopulated during draft/review", async () => {
    const consultId = "c-soap-mirror";
    await seedConsultation(consultId, 1);

    // 1. Create Draft
    const draft = await drizzleDb.transaction(async (tx: any) => {
      return await createDraftArtifact(tx, {
        consultationId: consultId,
        chiefComplaint: "Otitis media",
        soapSubjective: "Left ear pain and pressure",
        soapObjective: "Erythematous bulging left tympanic membrane",
        soapAssessment: "Acute otitis media",
        soapPlan: "Amoxicillin-clavulanate 875mg BID x 7 days",
        actorId: "dr-sarah-chen",
        actorRole: "clinician",
      });
    });

    // Consult SOAP mirror must be NULL
    let cRow = (await pool.query(`SELECT soap_subjective FROM consultations WHERE id = $1`, [consultId])).rows[0];
    assert.strictEqual(cRow.soap_subjective, null);

    // 2. Submit for review
    await drizzleDb.transaction(async (tx: any) => {
      await submitForReview(tx, { artifactId: draft.id, actorId: "dr-sarah-chen", actorRole: "clinician" });
    });

    // Consult SOAP mirror must STILL be NULL
    cRow = (await pool.query(`SELECT soap_subjective FROM consultations WHERE id = $1`, [consultId])).rows[0];
    assert.strictEqual(cRow.soap_subjective, null);

    // 3. Sign artifact
    const signedResult = await drizzleDb.transaction(async (tx: any) => {
      return await signArtifactInTransaction(tx, {
        consultationId: consultId,
        artifactId: draft.id,
        clinicianId: "dr-sarah-chen",
        clinicianRole: "clinician",
        idempotencyKey: "key-soap-mirror-sign",
        expectedCaseVersion: 1,
      });
    });

    // 4. NOW consultation's legacy SOAP mirror must match the signed artifact exactly
    cRow = (await pool.query(`SELECT * FROM consultations WHERE id = $1`, [consultId])).rows[0];
    assert.strictEqual(cRow.case_version, 2);
    assert.strictEqual(cRow.status, "completed");
    assert.strictEqual(cRow.soap_subjective, "Left ear pain and pressure");
    assert.strictEqual(cRow.soap_objective, "Erythematous bulging left tympanic membrane");
    assert.strictEqual(cRow.soap_assessment, "Acute otitis media");
    assert.strictEqual(cRow.soap_plan, "Amoxicillin-clavulanate 875mg BID x 7 days");

    // Cryptographic verification of the signed artifact
    const integrityCheck = verifyArtifactIntegrity(signedResult.artifact);
    assert.strictEqual(integrityCheck.valid, true, `Artifact integrity must be verified: ${integrityCheck.reason}`);
  });
});
