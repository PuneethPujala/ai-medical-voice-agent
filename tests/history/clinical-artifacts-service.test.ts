/**
 * Milestone 6 Stage 2: Clinical Artifact Service & Transactional Signing Integration Battery
 *
 * Verifies all clinical artifact lifecycle and transactional invariants against
 * isolated PostgreSQL (localhost:5433/medvoice_test):
 * 1. Concurrent audit writers serializing on audit_chain_heads
 * 2. Cryptographic audit-chain index and hash continuity
 * 3. Audit write rollback on transaction abort
 * 4. In-memory audit fallback safety boundary (production fail-closed)
 * 5. Artifact draft creation and editing
 * 6. Automatic pending_review downgrade to draft on content modification
 * 7. Amendment lineage validation (parent signed, reason >= 10 chars, version increment)
 * 8. Competing amendment rejection (only one active successor permitted)
 * 9. Amendment cancellation and replacement versioning
 * 10. Concurrent signing serialization (exactly one signature commits)
 * 11. Lost-response signing retry (idempotent replay without duplicate audit event)
 * 12. Idempotency-key payload mismatch (409 IDEMPOTENCY_KEY_PAYLOAD_MISMATCH)
 * 13. Consultation & artifact association mismatch (400 ARTIFACT_CONSULTATION_MISMATCH)
 * 14. Unauthorized clinician role rejection (403 UNAUTHORIZED_CLINICIAN)
 * 15. Unassigned clinician care relationship rejection (403 UNAUTHORIZED_CLINICIAN)
 * 16. CAS version conflicts (409 CAS_CONFLICT)
 * 17. Audit datastore failure rolling back entire signing operation
 * 18. Consultation status transitions to 'approved' and legacy SOAP mirror updated only after signing
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
  isMemoryAuditFallbackPermitted,
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
        "doctor_id" varchar(64),
        "doctor_name" varchar(128) DEFAULT 'Dr. Sarah Chen, MD',
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
  async function seedConsultation(id: string, caseVersion = 1, doctorId: string | null = "dr-sarah-chen"): Promise<void> {
    await pool.query(
      `INSERT INTO consultations (id, user_id, doctor_id, doctor_name, case_version, status, chief_complaint, created_at)
       VALUES ($1, 'user-stage2-test', $3, 'Dr. Sarah Chen, MD', $2, 'completed_pending_review', 'Chest tightness and shortness of breath', NOW())
       ON CONFLICT (id) DO UPDATE SET case_version = $2, doctor_id = $3, status = 'completed_pending_review', soap_subjective = NULL, soap_objective = NULL, soap_assessment = NULL, soap_plan = NULL`,
      [id, caseVersion, doctorId]
    );
  }

  // --------------------------------------------------------------------------
  // Test 1: Concurrent Audit Writers
  // --------------------------------------------------------------------------
  it("Test 1: serializes concurrent audit writes via audit_chain_heads FOR UPDATE", async () => {
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

    const res = await pool.query(`SELECT * FROM audit_events ORDER BY index ASC`);
    assert.strictEqual(res.rows.length, writeCount);
    for (let i = 0; i < res.rows.length; i++) {
      assert.strictEqual(res.rows[i].index, i, `Event ${i} must have index ${i}`);
    }
  });

  // --------------------------------------------------------------------------
  // Test 2: Cryptographic Audit-Chain Continuity
  // --------------------------------------------------------------------------
  it("Test 2: verifies cryptographic previous-hash continuity across all logged events", async () => {
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

    const verification = verifyAuditChain(events);
    assert.strictEqual(verification.valid, true, `Audit chain must be cryptographically valid: ${verification.reason}`);

    const headRes = await pool.query(`SELECT * FROM audit_chain_heads WHERE chain_id = 'main'`);
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

    const headAfter = (await pool.query(`SELECT * FROM audit_chain_heads WHERE chain_id = 'main'`)).rows[0];
    assert.strictEqual(headAfter.last_event_index, initialIndex);
    assert.strictEqual(headAfter.last_event_hash, initialHash);

    const eventCheck = await pool.query(`SELECT * FROM audit_events WHERE resource_id = 'art-will-abort'`);
    assert.strictEqual(eventCheck.rows.length, 0);

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
  // Test 4: In-Memory Audit Fallback Safety Boundary
  // --------------------------------------------------------------------------
  it("Test 4: strictly enforces that production or durable-required audit events fail closed without memory fallback", () => {
    const origEnv = process.env.NODE_ENV;
    try {
      // In production, fallback must always be false
      (process.env as any).NODE_ENV = "production";
      assert.strictEqual(isMemoryAuditFallbackPermitted(false), false, "Production must never permit in-memory audit fallback");
      assert.strictEqual(isMemoryAuditFallbackPermitted(true), false, "Production with requireDurable must never permit in-memory fallback");

      // In non-production with requireDurable=true, fallback must be false
      (process.env as any).NODE_ENV = "development";
      assert.strictEqual(isMemoryAuditFallbackPermitted(true), false, "requireDurable=true must never permit in-memory fallback");
    } finally {
      (process.env as any).NODE_ENV = origEnv;
    }
  });

  // --------------------------------------------------------------------------
  // Test 5: Draft Creation and Editing
  // --------------------------------------------------------------------------
  it("Test 5: creates and updates draft artifact cleanly", async () => {
    const consultId = "c-draft-test-1";
    await seedConsultation(consultId, 1);

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
  // Test 6: Automatic Pending_Review Downgrade to Draft on Content Modification
  // --------------------------------------------------------------------------
  it("Test 6: automatically downgrades pending_review to draft on content modification", async () => {
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
  // Test 7: Amendment Lineage Validation
  // --------------------------------------------------------------------------
  it("Test 7: enforces amendment lineage rules (parent signed, reason >= 10 chars, version increment)", async () => {
    const consultId = "c-amend-lineage";
    await seedConsultation(consultId, 1);

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
    assert.strictEqual(v2Amendment.soapPlan, "Start Lisinopril 10mg daily");
  });

  // --------------------------------------------------------------------------
  // Test 8: Competing Amendments Rejection
  // --------------------------------------------------------------------------
  it("Test 8: rejects competing active amendments against the same parent artifact", async () => {
    const consultId = "c-compete-test";
    await seedConsultation(consultId, 1);

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

    // Create first active amendment (v2)
    await drizzleDb.transaction(async (tx: any) => {
      return await createAmendment(tx, {
        consultationId: consultId,
        amendsArtifactId: v1.id,
        amendmentReason: "First proposed amendment with updated notes",
        actorId: "dr-sarah-chen",
        actorRole: "clinician",
      });
    });

    // Competing active amendment attempt must be rejected
    await assert.rejects(
      async () => {
        await drizzleDb.transaction(async (tx: any) => {
          await createAmendment(tx, {
            consultationId: consultId,
            amendsArtifactId: v1.id,
            amendmentReason: "Competing simultaneous amendment attempt",
            actorId: "dr-sarah-chen",
            actorRole: "clinician",
          });
        });
      },
      (err: any) => err instanceof CompetingAmendmentError || err.code === "23505"
    );
  });

  // --------------------------------------------------------------------------
  // Test 9: Amendment Cancellation and Replacement
  // --------------------------------------------------------------------------
  it("Test 9: allows replacement amendment version after cancelling previous draft", async () => {
    const consultId = "c-cancel-replace";
    await seedConsultation(consultId, 1);

    const v1 = await drizzleDb.transaction(async (tx: any) => {
      const draft = await createDraftArtifact(tx, {
        consultationId: consultId,
        chiefComplaint: "Ankle sprain",
        soapSubjective: "Inversion injury",
        soapObjective: "Lateral malleolus tenderness, weight-bearing tolerated",
        soapAssessment: "Grade 1 lateral ankle sprain",
        soapPlan: "Ankle brace, ice, elevation",
        actorId: "dr-sarah-chen",
        actorRole: "clinician",
      });
      await submitForReview(tx, { artifactId: draft.id, actorId: "dr-sarah-chen", actorRole: "clinician" });
      const signed = await signArtifactInTransaction(tx, {
        consultationId: consultId,
        artifactId: draft.id,
        clinicianId: "dr-sarah-chen",
        clinicianRole: "clinician",
        idempotencyKey: "key-sign-v1-ankle",
        expectedCaseVersion: 1,
      });
      return signed.artifact;
    });

    const v2a = await drizzleDb.transaction(async (tx: any) => {
      return await createAmendment(tx, {
        consultationId: consultId,
        amendsArtifactId: v1.id,
        amendmentReason: "Initial amendment before imaging",
        actorId: "dr-sarah-chen",
        actorRole: "clinician",
      });
    });

    // Cancel v2a
    const cancelled = await drizzleDb.transaction(async (tx: any) => {
      return await cancelArtifact(tx, {
        artifactId: v2a.id,
        actorId: "dr-sarah-chen",
        actorRole: "clinician",
        cancellationReason: "Cancelling to incorporate full X-ray findings",
      });
    });
    assert.strictEqual(cancelled.status, "cancelled");

    // Creating replacement amendment MUST succeed
    const v2Replacement = await drizzleDb.transaction(async (tx: any) => {
      return await createAmendment(tx, {
        consultationId: consultId,
        amendsArtifactId: v1.id,
        amendmentReason: "Replacement amendment: X-ray confirmed negative for fracture",
        soapObjective: "X-ray negative for acute osseous abnormality",
        actorId: "dr-sarah-chen",
        actorRole: "clinician",
      });
    });

    assert.strictEqual(v2Replacement.version, 2);
    assert.strictEqual(v2Replacement.status, "draft");
    assert.strictEqual(v2Replacement.amendsArtifactId, v1.id);
  });

  // --------------------------------------------------------------------------
  // Test 10: Concurrent Signing Serialization
  // --------------------------------------------------------------------------
  it("Test 10: serializes concurrent signing transactions and allows exactly one signature", async () => {
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
        clinicianId: "dr-sarah-chen",
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

    const finalArt = (await pool.query(`SELECT * FROM clinical_artifacts WHERE id = $1`, [draft.id])).rows[0];
    assert.strictEqual(finalArt.status, "signed");
  });

  // --------------------------------------------------------------------------
  // Test 11: Lost-Response Idempotent Replay
  // --------------------------------------------------------------------------
  it("Test 11: returns original signed artifact on lost-response retry without duplicate audit events", async () => {
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

    const headAfterReplay = (await pool.query(`SELECT * FROM audit_chain_heads WHERE chain_id = 'main'`)).rows[0];
    assert.strictEqual(headAfterReplay.last_event_index, headAfterFirst.last_event_index);
    assert.strictEqual(headAfterReplay.last_event_hash, headAfterFirst.last_event_hash);
  });

  // --------------------------------------------------------------------------
  // Test 12: Idempotency Key Payload Mismatch (409)
  // --------------------------------------------------------------------------
  it("Test 12: throws 409 IDEMPOTENCY_KEY_PAYLOAD_MISMATCH when same key reused with different payload", async () => {
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

    await assert.rejects(
      async () => {
        await drizzleDb.transaction(async (tx: any) => {
          await signArtifactInTransaction(tx, {
            consultationId: consultId,
            artifactId: draft.id,
            clinicianId: "dr-sarah-chen",
            clinicianRole: "clinician",
            idempotencyKey: "reused-key-mismatch-test",
            expectedCaseVersion: 99,
          });
        });
      },
      (err: any) => err instanceof IdempotencyKeyPayloadMismatchError && err.statusCode === 409
    );
  });

  // --------------------------------------------------------------------------
  // Test 13: Consultation & Artifact Association Mismatch (400)
  // --------------------------------------------------------------------------
  it("Test 13: rejects signing when artifact does not belong to the consultation", async () => {
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
            consultationId: "c-owner-2",
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
  // Test 14: Unauthorized Clinician Role Rejection (403)
  // --------------------------------------------------------------------------
  it("Test 14: rejects signing by non-clinician roles with 403", async () => {
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
            clinicianRole: "patient" as any,
            idempotencyKey: "key-unauth",
            expectedCaseVersion: 1,
          });
        });
      },
      (err: any) => err instanceof ClinicianAuthorizationError && err.statusCode === 403
    );
  });

  // --------------------------------------------------------------------------
  // Test 15a: Correctly Assigned Clinician Signing
  // --------------------------------------------------------------------------
  it("Test 15a: allows correctly assigned clinician to sign their consultation", async () => {
    const consultId = "c-assigned-doc-ok";
    await seedConsultation(consultId, 1, "dr-sarah-chen");

    const draft = await drizzleDb.transaction(async (tx: any) => {
      const d = await createDraftArtifact(tx, {
        consultationId: consultId,
        chiefComplaint: "Follow-up hypertension",
        soapSubjective: "No headaches, tolerating medication well",
        soapObjective: "BP 122/78 sitting, HR 70 regular",
        soapAssessment: "Essential hypertension well controlled",
        soapPlan: "Continue Lisinopril 10mg daily",
        actorId: "dr-sarah-chen",
        actorRole: "clinician",
      });
      return await submitForReview(tx, { artifactId: d.id, actorId: "dr-sarah-chen", actorRole: "clinician" });
    });

    const signed = await drizzleDb.transaction(async (tx: any) => {
      return await signArtifactInTransaction(tx, {
        consultationId: consultId,
        artifactId: draft.id,
        clinicianId: "dr-sarah-chen",
        clinicianRole: "clinician",
        idempotencyKey: "key-assigned-ok",
        expectedCaseVersion: 1,
      });
    });

    assert.strictEqual(signed.artifact.status, "signed");
    assert.strictEqual(signed.artifact.signedBy, "dr-sarah-chen");
  });

  // --------------------------------------------------------------------------
  // Test 15b: Clinician Assigned to Another Doctor (403)
  // --------------------------------------------------------------------------
  it("Test 15b: rejects signing when clinician is assigned to another doctor", async () => {
    const consultId = "c-other-doc-fail";
    await seedConsultation(consultId, 1, "dr-sarah-chen"); // Assigned to dr-sarah-chen

    const draft = await drizzleDb.transaction(async (tx: any) => {
      const d = await createDraftArtifact(tx, {
        consultationId: consultId,
        chiefComplaint: "Dizziness",
        soapSubjective: "Lightheaded on standing",
        soapObjective: "Orthostatic vitals positive",
        soapAssessment: "Orthostatic hypotension",
        soapPlan: "Hydration, compression stockings",
        actorId: "dr-sarah-chen",
        actorRole: "clinician",
      });
      return await submitForReview(tx, { artifactId: d.id, actorId: "dr-sarah-chen", actorRole: "clinician" });
    });

    // dr-alex-carter is NOT dr-sarah-chen
    await assert.rejects(
      async () => {
        await drizzleDb.transaction(async (tx: any) => {
          await signArtifactInTransaction(tx, {
            consultationId: consultId,
            artifactId: draft.id,
            clinicianId: "dr-alex-carter",
            clinicianRole: "clinician",
            idempotencyKey: "key-other-doc-fail",
            expectedCaseVersion: 1,
          });
        });
      },
      (err: any) =>
        err instanceof ClinicianAuthorizationError &&
        err.statusCode === 403 &&
        err.message.includes("not the assigned physician")
    );
  });

  // --------------------------------------------------------------------------
  // Test 15c: No Assigned Physician (null) - Fail-Closed Rejection (403)
  // --------------------------------------------------------------------------
  it("Test 15c: rejects signing when consultation has NO assigned physician (null) - strict fail-closed", async () => {
    const consultId = "c-null-doc-fail";
    await seedConsultation(consultId, 1, null); // Unassigned encounter (null doctor_id)

    const draft = await drizzleDb.transaction(async (tx: any) => {
      const d = await createDraftArtifact(tx, {
        consultationId: consultId,
        chiefComplaint: "Unassigned triage check",
        soapSubjective: "Patient self-reported cough",
        soapObjective: "Vitals unrecorded",
        soapAssessment: "Upper respiratory infection",
        soapPlan: "Supportive care",
        actorId: "dr-sarah-chen",
        actorRole: "clinician",
      });
      return await submitForReview(tx, { artifactId: d.id, actorId: "dr-sarah-chen", actorRole: "clinician" });
    });

    // Even though dr-sarah-chen is a valid clinician, the encounter lacks an assigned care relationship
    await assert.rejects(
      async () => {
        await drizzleDb.transaction(async (tx: any) => {
          await signArtifactInTransaction(tx, {
            consultationId: consultId,
            artifactId: draft.id,
            clinicianId: "dr-sarah-chen",
            clinicianRole: "clinician",
            idempotencyKey: "key-null-doc-fail",
            expectedCaseVersion: 1,
          });
        });
      },
      (err: any) =>
        err instanceof ClinicianAuthorizationError &&
        err.statusCode === 403 &&
        err.message.includes("not the assigned physician") &&
        err.message.includes("assigned: 'none'")
    );
  });

  // --------------------------------------------------------------------------
  // Test 15d: Missing / Empty Assignment Field - Fail-Closed Rejection (403)
  // --------------------------------------------------------------------------
  it("Test 15d: rejects signing when consultation assignment field is empty string - fail-closed", async () => {
    const consultId = "c-empty-doc-fail";
    await seedConsultation(consultId, 1, ""); // Empty string doctor_id

    const draft = await drizzleDb.transaction(async (tx: any) => {
      const d = await createDraftArtifact(tx, {
        consultationId: consultId,
        chiefComplaint: "Triage check empty assignment",
        soapSubjective: "Sore throat",
        soapObjective: "Pharyngeal erythema",
        soapAssessment: "Viral pharyngitis",
        soapPlan: "Warm gargle",
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
            idempotencyKey: "key-empty-doc-fail",
            expectedCaseVersion: 1,
          });
        });
      },
      (err: any) =>
        err instanceof ClinicianAuthorizationError &&
        err.statusCode === 403 &&
        err.message.includes("not the assigned physician")
    );
  });

  // --------------------------------------------------------------------------
  // Test 15e: Explicit Admin Override with Audit Trail
  // --------------------------------------------------------------------------
  it("Test 15e: allows administrator to sign unassigned or other doctor's encounter with explicit audit override flag", async () => {
    const consultId = "c-admin-override";
    await seedConsultation(consultId, 1, "dr-sarah-chen"); // Assigned to dr-sarah-chen

    const draft = await drizzleDb.transaction(async (tx: any) => {
      const d = await createDraftArtifact(tx, {
        consultationId: consultId,
        chiefComplaint: "Emergency escalation",
        soapSubjective: "Patient transferred to ICU",
        soapObjective: "Intubated and sedated",
        soapAssessment: "Septic shock secondary to pneumonia",
        soapPlan: "Broad spectrum IV antibiotics, vasopressors",
        actorId: "dr-sarah-chen",
        actorRole: "clinician",
      });
      return await submitForReview(tx, { artifactId: d.id, actorId: "dr-sarah-chen", actorRole: "clinician" });
    });

    // Medical Director / Administrator signs with explicit admin role
    const adminSigned = await drizzleDb.transaction(async (tx: any) => {
      return await signArtifactInTransaction(tx, {
        consultationId: consultId,
        artifactId: draft.id,
        clinicianId: "admin-chief-medical-officer",
        clinicianRole: "admin",
        idempotencyKey: "key-admin-override-test",
        expectedCaseVersion: 1,
      });
    });

    assert.strictEqual(adminSigned.artifact.status, "signed");
    assert.strictEqual(adminSigned.artifact.signedBy, "admin-chief-medical-officer");
    assert.strictEqual(adminSigned.artifact.signedByRole, "admin");

    // Verify audit event reflects administrative override
    const auditRes = await pool.query(
      `SELECT metadata FROM audit_events WHERE resource_id = $1 AND action = 'CLINICAL_ARTIFACT_SIGNED'`,
      [draft.id]
    );
    assert.strictEqual(auditRes.rows.length, 1);
    assert.strictEqual(auditRes.rows[0].metadata.isAdministrativeOverride, true);
    assert.strictEqual(auditRes.rows[0].metadata.assignedDoctorId, "dr-sarah-chen");
  });

  // --------------------------------------------------------------------------
  // Test 16: CAS Version Conflicts (409)
  // --------------------------------------------------------------------------
  it("Test 16: rejects signing with 409 CAS_CONFLICT when case_version has drifted", async () => {
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
  // Test 17: Audit Failure Rolling Back Entire Signing Operation
  // --------------------------------------------------------------------------
  it("Test 17: rolls back entire signing transaction if audit persistence fails", async () => {
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

    const artCheck = (await pool.query(`SELECT * FROM clinical_artifacts WHERE id = $1`, [draft.id])).rows[0];
    assert.strictEqual(artCheck.status, "pending_review", "Artifact must remain pending_review");
    assert.strictEqual(artCheck.signed_at, null, "signed_at must remain NULL");

    const consultCheck = (await pool.query(`SELECT * FROM consultations WHERE id = $1`, [consultId])).rows[0];
    assert.strictEqual(consultCheck.case_version, 1, "case_version must not have incremented");
    assert.strictEqual(consultCheck.soap_subjective, null, "SOAP mirror must not have been updated");
  });

  // --------------------------------------------------------------------------
  // Test 18: Established Status 'approved' and Legacy SOAP Mirror Updated Exclusively on Signing
  // --------------------------------------------------------------------------
  it("Test 18: transitions consultation status to 'approved' and updates legacy SOAP mirror only after signing", async () => {
    const consultId = "c-soap-mirror";
    await seedConsultation(consultId, 1);

    // Initial state is 'completed_pending_review'
    let cRow = (await pool.query(`SELECT status, soap_subjective FROM consultations WHERE id = $1`, [consultId])).rows[0];
    assert.strictEqual(cRow.status, "completed_pending_review");
    assert.strictEqual(cRow.soap_subjective, null);

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

    cRow = (await pool.query(`SELECT status, soap_subjective FROM consultations WHERE id = $1`, [consultId])).rows[0];
    assert.strictEqual(cRow.status, "completed_pending_review", "Status must remain completed_pending_review during draft");
    assert.strictEqual(cRow.soap_subjective, null);

    // 2. Submit for review
    await drizzleDb.transaction(async (tx: any) => {
      await submitForReview(tx, { artifactId: draft.id, actorId: "dr-sarah-chen", actorRole: "clinician" });
    });

    cRow = (await pool.query(`SELECT status, soap_subjective FROM consultations WHERE id = $1`, [consultId])).rows[0];
    assert.strictEqual(cRow.status, "completed_pending_review", "Status must remain completed_pending_review while pending review");
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

    // 4. Invariant: consultation status MUST transition to established 'approved' status (NOT 'completed')
    cRow = (await pool.query(`SELECT * FROM consultations WHERE id = $1`, [consultId])).rows[0];
    assert.strictEqual(cRow.case_version, 2);
    assert.strictEqual(cRow.status, "approved", "Status MUST be 'approved' in accordance with MedVoice lifecycle semantics");
    assert.strictEqual(cRow.approved_by, "dr-sarah-chen");
    assert(cRow.approved_at !== null, "approved_at must be populated on signing");
    assert.strictEqual(cRow.soap_subjective, "Left ear pain and pressure");
    assert.strictEqual(cRow.soap_objective, "Erythematous bulging left tympanic membrane");
    assert.strictEqual(cRow.soap_assessment, "Acute otitis media");
    assert.strictEqual(cRow.soap_plan, "Amoxicillin-clavulanate 875mg BID x 7 days");

    // Cryptographic verification of the signed artifact
    const integrityCheck = verifyArtifactIntegrity(signedResult.artifact);
    assert.strictEqual(integrityCheck.valid, true, `Artifact integrity must be verified: ${integrityCheck.reason}`);
  });
});
