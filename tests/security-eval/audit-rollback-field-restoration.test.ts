import assert from "assert";
import { POST as postConsultation } from "../../app/api/consultations/route";
import { GET as getConsultationById, PATCH as patchConsultationById } from "../../app/api/consultations/[id]/route";
import { DEFAULT_INTERNAL_TEST_SECRET, INTERNAL_TEST_SECRET_HEADER, Role } from "../../lib/auth/rbac";
import { __setSimulatedAuditFailure } from "../../lib/audit/audit-logger";
import { getDb } from "../../config/db";
import { consultationsTable } from "../../config/schema";
import { eq } from "drizzle-orm";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: ".env" });
}

(process.env as Record<string, string | undefined>).NODE_ENV = "test";

function createTestHeaders(role: Role, userId: string) {
  return {
    "x-mock-role": role,
    "x-mock-user-id": userId,
    [INTERNAL_TEST_SECRET_HEADER]: DEFAULT_INTERNAL_TEST_SECRET,
  };
}

async function runAuditRollbackFieldRestorationTests() {
  console.log("================================================================================");
  console.log("  CONSULTATION PATCH AUDIT-WRITE FAILURE & FULL SNAPSHOT ROLLBACK HARNESS      ");
  console.log("================================================================================");

  const testPatient = `patient-rollback-${Date.now()}`;
  const testClinician = "dr-sarah-chen";
  const encounterId = `ENC-ROLLBACK-${Date.now()}`;
  const dbClient = getDb();

  try {
    // -------------------------------------------------------------------------
    // STEP 1: Create initial consultation with multiple baseline fields
    // -------------------------------------------------------------------------
    console.log("\n[Step 1] Creating initial consultation encounter...");
    const initPayload = {
      id: encounterId,
      patientName: "Rollback Test Patient",
      doctorId: "dr-sarah-chen",
      doctorName: "Dr. Sarah Chen, MD",
      specialty: "Internal Medicine",
      chiefComplaint: "Acute migraine with visual aura",
      triageLevel: "priority",
      status: "completed_pending_review",
      caseVersion: 1,
      soapSubjective: "Baseline Subjective: Patient reports severe throbbing headache.",
      soapObjective: "Baseline Objective: BP 120/80, HR 72, normal cranial nerve exam.",
      soapAssessment: "Baseline Assessment: Acute migraine without aura complications.",
      soapPlan: "Baseline Plan: Sumatriptan 50mg, dark room, hydration.",
      interviewState: { phase: "active_inquiring", step: 3, verifiedBaseline: true },
      deliveredTurnRecords: [{ turnIndex: 1, text: "Headache started 2 hours ago", speaker: "patient" }],
      attributedFacts: [{ factId: "f-1", name: "headache", status: "present", value: "throbbing" }],
      unmappedObservations: [{ observationId: "obs-1", rawText: "feels exhausted" }],
      idempotencyKey: `init-key-${encounterId}`,
    };

    const createReq = new Request("https://medvoice.org/api/consultations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...createTestHeaders("patient", testPatient),
      },
      body: JSON.stringify(initPayload),
    });

    const createRes = await postConsultation(createReq);
    assert.strictEqual(createRes.status, 200, "Initial consultation created with 200 OK");
    const createData = await createRes.json();
    assert.strictEqual(createData.consultation.caseVersion, 1, "Initial caseVersion is 1");
    console.log("  ✓ Initial consultation successfully created with baseline SOAP, state, and version 1.");

    // -------------------------------------------------------------------------
    // STEP 2: Normal PATCH succeeds and increments version to 2
    // -------------------------------------------------------------------------
    console.log("\n[Step 2] Executing valid clinician update (version 1 -> 2)...");
    const validPatchReq = new Request(`https://medvoice.org/api/consultations/${encounterId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...createTestHeaders("clinician", testClinician),
      },
      body: JSON.stringify({
        expectedVersion: 1,
        soapSubjective: "Clinician Confirmed Subjective: Unilateral throbbing pain.",
      }),
    });

    const validPatchRes = await patchConsultationById(validPatchReq, { params: Promise.resolve({ id: encounterId }) });
    assert.strictEqual(validPatchRes.status, 200, "Valid PATCH returns 200 OK");
    const validPatchData = await validPatchRes.json();
    assert.strictEqual(validPatchData.consultation.caseVersion, 2, "caseVersion successfully incremented to 2");
    assert.strictEqual(
      validPatchData.consultation.soapSubjective,
      "Clinician Confirmed Subjective: Unilateral throbbing pain.",
      "Subjective updated"
    );
    console.log("  ✓ Valid update successfully committed; version is now 2.");

    // -------------------------------------------------------------------------
    // STEP 3: Force Audit Ledger Failure During Multi-Field PATCH
    // -------------------------------------------------------------------------
    console.log("\n[Step 3] Forcing audit write failure during multi-field mutation...");
    __setSimulatedAuditFailure(true);

    const maliciousUpdatePayload = {
      expectedVersion: 2,
      status: "approved", // Attempt approval
      soapSubjective: "CORRUPTED: Unaudited subjective modification",
      soapObjective: "CORRUPTED: Unaudited objective modification",
      soapAssessment: "CORRUPTED: Unaudited assessment modification",
      soapPlan: "CORRUPTED: Unaudited plan modification",
      interviewState: { phase: "decided", corruptedPayload: true },
      deliveredTurnRecords: [{ turnIndex: 99, text: "UNAUSITABLE TURN", speaker: "unknown" }],
      attributedFacts: [{ factId: "f-corrupt", name: "fake_fact", status: "present", value: "invalid" }],
      unmappedObservations: [{ observationId: "obs-corrupt", rawText: "invalid observation" }],
      idempotencyKey: `corrupted-key-${Date.now()}`,
    };

    const failingPatchReq = new Request(`https://medvoice.org/api/consultations/${encounterId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...createTestHeaders("clinician", testClinician),
      },
      body: JSON.stringify(maliciousUpdatePayload),
    });

    const failingPatchRes = await patchConsultationById(failingPatchReq, { params: Promise.resolve({ id: encounterId }) });
    
    // Reset the failure trigger immediately
    __setSimulatedAuditFailure(false);

    assert.strictEqual(
      failingPatchRes.status,
      500,
      "Failed audit write must abort with 500 AUDIT_FAILURE"
    );
    const failingData = await failingPatchRes.json();
    assert.strictEqual(failingData.code, "AUDIT_FAILURE", "Expected code AUDIT_FAILURE");
    console.log("  ✓ Route caught audit failure and initiated compensating rollback with 500 AUDIT_FAILURE response.");

    // -------------------------------------------------------------------------
    // STEP 4: Verify Every Field Was Completely Restored (Zero Partial Commits)
    // -------------------------------------------------------------------------
    console.log("\n[Step 4] Verifying complete snapshot restoration across all clinical & state fields...");
    
    let currentRecord: any;
    if (dbClient) {
      const rows = await dbClient.select().from(consultationsTable).where(eq(consultationsTable.id, encounterId));
      assert.strictEqual(rows.length, 1, "Encounter exists in datastore");
      currentRecord = rows[0];
    } else {
      const getReq = new Request(`https://medvoice.org/api/consultations/${encounterId}`, {
        headers: createTestHeaders("clinician", testClinician),
      });
      const getRes = await getConsultationById(getReq, { params: Promise.resolve({ id: encounterId }) });
      const getData = await getRes.json();
      currentRecord = getData.consultation;
    }

    // 1. Status and Approval
    assert.strictEqual(
      currentRecord.status,
      "completed_pending_review",
      "Status must remain 'completed_pending_review' (NOT approved)"
    );
    assert.strictEqual(currentRecord.approvedAt, null, "approvedAt must remain null");
    assert.strictEqual(currentRecord.approvedBy, null, "approvedBy must remain null");

    // 2. Concurrency Version
    assert.strictEqual(
      currentRecord.caseVersion,
      2,
      "caseVersion must be rolled back to 2 (NOT incremented to 3)"
    );

    // 3. SOAP Sections
    assert.strictEqual(
      currentRecord.soapSubjective,
      "Clinician Confirmed Subjective: Unilateral throbbing pain.",
      "Subjective field restored"
    );
    assert.strictEqual(
      currentRecord.soapObjective,
      "Baseline Objective: BP 120/80, HR 72, normal cranial nerve exam.",
      "Objective field restored"
    );
    assert.strictEqual(
      currentRecord.soapAssessment,
      "Baseline Assessment: Acute migraine without aura complications.",
      "Assessment field restored"
    );
    assert.strictEqual(
      currentRecord.soapPlan,
      "Baseline Plan: Sumatriptan 50mg, dark room, hydration.",
      "Plan field restored"
    );

    // 4. Clinical State & Attributes
    assert.strictEqual(
      (currentRecord.interviewState as any)?.corruptedPayload,
      undefined,
      "interviewState corruption was prevented"
    );
    assert.strictEqual(
      (currentRecord.interviewState as any)?.verifiedBaseline,
      true,
      "interviewState restored to baseline"
    );

    // 5. Turns and Observations
    assert.strictEqual(
      (currentRecord.deliveredTurnRecords as any[])?.some((t: any) => t.turnIndex === 99),
      false,
      "Delivered turns corruption prevented"
    );
    assert.strictEqual(
      (currentRecord.attributedFacts as any[])?.some((f: any) => f.factId === "f-corrupt"),
      false,
      "Attributed facts corruption prevented"
    );
    assert.strictEqual(
      (currentRecord.unmappedObservations as any[])?.some((o: any) => o.observationId === "obs-corrupt"),
      false,
      "Unmapped observations corruption prevented"
    );
    assert.notStrictEqual(
      currentRecord.idempotencyKey,
      maliciousUpdatePayload.idempotencyKey,
      "idempotencyKey mutation was rolled back"
    );

    console.log("  ✓ Status and approval fields confirmed unapproved (status=completed_pending_review, approvedAt=null).");
    console.log("  ✓ Optimistic concurrency version restored to expected caseVersion=2.");
    console.log("  ✓ All 4 SOAP sections verified intact with zero partial contamination.");
    console.log("  ✓ Interview state, delivered turns, attributed facts, and unmapped observations completely restored.");

    // -------------------------------------------------------------------------
    // STEP 5: Subsequent Valid Update with Expected Version 2 Succeeds
    // -------------------------------------------------------------------------
    console.log("\n[Step 5] Verifying encounter remains healthy for subsequent valid updates...");
    const subsequentReq = new Request(`https://medvoice.org/api/consultations/${encounterId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...createTestHeaders("clinician", testClinician),
      },
      body: JSON.stringify({
        expectedVersion: 2, // Valid because version was rolled back to 2!
        soapAssessment: "Final Clinical Assessment: Migraine fully controlled.",
      }),
    });

    const subsequentRes = await patchConsultationById(subsequentReq, { params: Promise.resolve({ id: encounterId }) });
    assert.strictEqual(subsequentRes.status, 200, "Subsequent valid update succeeds with expectedVersion 2");
    const subsequentData = await subsequentRes.json();
    assert.strictEqual(subsequentData.consultation.caseVersion, 3, "caseVersion advanced to 3");
    console.log("  ✓ Encounter version sequence remained strictly deterministic: 1 -> 2 -> [rolled back] -> 3.");

    console.log("\n================================================================================");
    console.log("  ALL AUDIT ROLLBACK & FULL FIELD RESTORATION TESTS PASSED (100% VERIFIED)    ");
    console.log("================================================================================\n");
  } finally {
    // Teardown test row from database if live Neon DB is connected
    __setSimulatedAuditFailure(false);
    if (dbClient) {
      try {
        await dbClient.delete(consultationsTable).where(eq(consultationsTable.id, encounterId));
      } catch (e) {
        // ignore cleanup error
      }
    }
  }
}

runAuditRollbackFieldRestorationTests().catch((err) => {
  console.error("FATAL: Audit rollback test failed:", err);
  process.exit(1);
});
