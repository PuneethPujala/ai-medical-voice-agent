import { createSqlHelper, assertSafeTestDatabase } from "../lib/security/test-db-guard";
import * as dotenv from "dotenv";
import assert from "assert";

dotenv.config({ path: ".env.local" });
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: ".env" });
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("FATAL: DATABASE_URL is not set.");
  process.exit(1);
}

const sql = createSqlHelper(assertSafeTestDatabase(DATABASE_URL));

import { POST as postConsultation } from "../app/api/consultations/route";
import { GET as getConsultationById, PATCH as patchConsultationById } from "../app/api/consultations/[id]/route";
import { DEFAULT_INTERNAL_TEST_SECRET, INTERNAL_TEST_SECRET_HEADER, Role } from "../lib/auth/rbac";

(process.env as Record<string, string | undefined>).NODE_ENV = "test";
(process.env as Record<string, string | undefined>).INTERNAL_TEST_SECRET = DEFAULT_INTERNAL_TEST_SECRET;

function createTestHeaders(role: Role, userId: string, extra: Record<string, string> = {}) {
  return {
    "x-mock-role": role,
    "x-mock-user-id": userId,
    [INTERNAL_TEST_SECRET_HEADER]: DEFAULT_INTERNAL_TEST_SECRET,
    ...extra,
  };
}

async function runRealNeonVerification() {
  console.log("================================================================================");
  console.log("  REAL NEON POSTGRESQL CONCURRENCY, IDEMPOTENCY & AUTHORIZATION HARNESS       ");
  console.log("================================================================================");

  const testPatient = "patient-puneeth-neon-test";
  const assignedDoctor = "dr-sarah-chen";
  const unauthorizedDoctor = "dr-marcus-vance";
  const raceEncounterId = `ENC-NEON-RACE-${Date.now()}`;

  const createdIds: string[] = [raceEncounterId];

  try {
    // -------------------------------------------------------------------------
    // 1. Real Concurrent POSTs against Neon
    // -------------------------------------------------------------------------
    console.log("\n[Test 1] 5 Concurrent POSTs with identical encounter ID against real Neon DB");
    const concurrentRequests = Array.from({ length: 5 }, (_, i) => {
      const req = new Request("https://medvoice.org/api/consultations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...createTestHeaders("patient", testPatient),
        },
        body: JSON.stringify({
          id: raceEncounterId,
          patientName: "Concurrent Neon Patient",
          doctorId: assignedDoctor,
          doctorName: "Dr. Sarah Chen, MD",
          specialty: "Internal Medicine",
          chiefComplaint: "Concurrent Neon Test complaint",
          triageLevel: "routine",
          status: "completed_pending_review",
          durationSeconds: 150,
        }),
      });
      return postConsultation(req);
    });

    const responses = await Promise.all(concurrentRequests);
    for (const res of responses) {
      assert.strictEqual(res.status, 200, "All concurrent requests resolve with 200 OK");
      const json = await res.json();
      assert.strictEqual(json.success, true, "Response reports success: true");
    }

    // Direct SQL check on Neon PostgreSQL
    const liveRows = await sql`
      SELECT id, user_id, doctor_id, status, approved_at, approved_by 
      FROM consultations 
      WHERE id = ${raceEncounterId};
    `;

    assert.strictEqual(liveRows.length, 1, "Exactly 1 row exists in Neon database for this encounter ID");
    assert.strictEqual(liveRows[0].user_id, testPatient, "Persisted user_id matches authenticated patient");
    assert.strictEqual(liveRows[0].doctor_id, assignedDoctor, "Persisted doctor_id matches assigned doctor");
    assert.strictEqual(liveRows[0].status, "completed_pending_review", "Initial status in Neon is completed_pending_review");
    assert.strictEqual(liveRows[0].approved_at, null, "approved_at is null in Neon");
    console.log("  ✓ 5 concurrent POSTs resolved idempotently; exactly 1 row committed to Neon DB");

    // -------------------------------------------------------------------------
    // 2. Authorization: Patient cannot self-approve note in Neon
    // -------------------------------------------------------------------------
    console.log("\n[Test 2] Authorization: Uncredentialed patient cannot sign note");
    const patientSignReq = new Request(`https://medvoice.org/api/consultations/${raceEncounterId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...createTestHeaders("patient", testPatient),
      },
      body: JSON.stringify({ action: "approve" }),
    });
    const patientSignRes = await patchConsultationById(patientSignReq, { params: Promise.resolve({ id: raceEncounterId }) });
    assert.strictEqual(patientSignRes.status, 403, "Patient self-signing rejected with 403 Forbidden");
    const patientSignJson = await patientSignRes.json();
    assert.strictEqual(patientSignJson.code, "FORBIDDEN_SIGNING_AUTHORITY");
    console.log("  ✓ Patient self-signing strictly rejected with 403 FORBIDDEN_SIGNING_AUTHORITY");

    // -------------------------------------------------------------------------
    // 3. Authorization: Unauthorized clinician (not assigned) cannot approve note
    // -------------------------------------------------------------------------
    console.log("\n[Test 3] Authorization: Unauthorized clinician cannot approve unassigned encounter");
    const unauthDocReq = new Request(`https://medvoice.org/api/consultations/${raceEncounterId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...createTestHeaders("clinician", unauthorizedDoctor),
      },
      body: JSON.stringify({ action: "approve" }),
    });
    const unauthDocRes = await patchConsultationById(unauthDocReq, { params: Promise.resolve({ id: raceEncounterId }) });
    assert.strictEqual(unauthDocRes.status, 403, "Unassigned clinician approval rejected with 403 Forbidden");
    const unauthDocJson = await unauthDocRes.json();
    assert.strictEqual(unauthDocJson.code, "FORBIDDEN_CARE_RELATIONSHIP");
    console.log("  ✓ Unassigned clinician rejected with 403 FORBIDDEN_CARE_RELATIONSHIP");

    // -------------------------------------------------------------------------
    // 4. Authorization: Assigned clinician approves note in Neon
    // -------------------------------------------------------------------------
    console.log("\n[Test 4] Authorization & Mutation: Assigned clinician approves encounter in Neon DB");
    const authDocReq = new Request(`https://medvoice.org/api/consultations/${raceEncounterId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...createTestHeaders("clinician", assignedDoctor),
      },
      body: JSON.stringify({
        action: "approve",
        soapPlan: "Prescription signed: Amoxicillin 500mg tid x 7d.",
      }),
    });
    const authDocRes = await patchConsultationById(authDocReq, { params: Promise.resolve({ id: raceEncounterId }) });
    assert.strictEqual(authDocRes.status, 200, "Assigned clinician approval succeeds with 200 OK");
    const authDocJson = await authDocRes.json();
    assert.strictEqual(authDocJson.consultation.status, "approved");
    assert.strictEqual(authDocJson.consultation.approvedBy, assignedDoctor);

    // Direct SQL verification of approved row in Neon
    const approvedRows = await sql`
      SELECT id, status, approved_at, approved_by, soap_plan 
      FROM consultations 
      WHERE id = ${raceEncounterId};
    `;
    assert.strictEqual(approvedRows[0].status, "approved", "Neon row status is updated to 'approved'");
    assert.notStrictEqual(approvedRows[0].approved_at, null, "Neon row approved_at is recorded");
    assert.strictEqual(approvedRows[0].approved_by, assignedDoctor, "Neon row approved_by matches clinician");
    assert.ok(approvedRows[0].soap_plan.includes("Amoxicillin"), "Neon row soap_plan persisted");
    console.log("  ✓ Direct Neon SQL confirms encounter is 'approved', with approved_by and approved_at");

    // -------------------------------------------------------------------------
    // 5. State Machine: Stale downgrade attempt rejected with 409 Conflict
    // -------------------------------------------------------------------------
    console.log("\n[Test 5] State Machine: Stale downgrade attempt on approved note rejected with 409");
    const staleDowngradeReq = new Request("https://medvoice.org/api/consultations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...createTestHeaders("patient", testPatient),
      },
      body: JSON.stringify({
        id: raceEncounterId,
        status: "completed_pending_review",
        chiefComplaint: "Stale downgrade retry",
      }),
    });
    const staleDowngradeRes = await postConsultation(staleDowngradeReq);
    assert.strictEqual(staleDowngradeRes.status, 409, "Downgrade rejected with 409 Conflict");
    const staleDowngradeJson = await staleDowngradeRes.json();
    assert.strictEqual(staleDowngradeJson.code, "STATUS_CONFLICT");
    console.log("  ✓ Downgrade attempt rejected with 409 STATUS_CONFLICT");

    // -------------------------------------------------------------------------
    // 6. Stale Draft Retry: Retrying without status does not mutate approved clinical note
    // -------------------------------------------------------------------------
    console.log("\n[Test 6] Stale Draft Retry: Unapproved draft retries do not mutate signed clinical content");
    const staleRetryReq = new Request("https://medvoice.org/api/consultations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...createTestHeaders("patient", testPatient),
      },
      body: JSON.stringify({
        id: raceEncounterId,
        soapPlan: "Malicious or stale overwrite attempt",
      }),
    });
    const staleRetryRes = await postConsultation(staleRetryReq);
    assert.strictEqual(staleRetryRes.status, 200, "Idempotent response returned");
    const checkPostRow = await sql`
      SELECT status, soap_plan FROM consultations WHERE id = ${raceEncounterId};
    `;
    assert.strictEqual(checkPostRow[0].status, "approved", "Status remains 'approved'");
    assert.ok(checkPostRow[0].soap_plan.includes("Amoxicillin"), "Clinical note was NOT overwritten by stale retry");
    console.log("  ✓ Stale draft retry handled idempotently without mutating approved note");

    // -------------------------------------------------------------------------
    // 7. Audit Ledger in Neon DB: Verify CONSULTATION_APPROVED event is persisted
    // -------------------------------------------------------------------------
    console.log("\n[Test 7] Audit Trail: Verify audit_events in Neon PostgreSQL");
    const auditRows = await sql`
      SELECT id, action, actor_id, actor_role, status, resource_id 
      FROM audit_events 
      WHERE resource_id = ${raceEncounterId}
      ORDER BY index DESC;
    `;
    console.log(`  Found ${auditRows.length} audit event(s) in Neon DB for ${raceEncounterId}:`);
    for (const r of auditRows) {
      console.log(`    - ${r.action} by ${r.actor_id} (${r.actor_role}): ${r.status}`);
    }
    const hasApprovalAudit = auditRows.some((r) => r.action === "CONSULTATION_APPROVED" && r.status === "SUCCESS");
    assert.ok(hasApprovalAudit, "CONSULTATION_APPROVED audit event persisted in Neon DB");
    console.log("  ✓ CONSULTATION_APPROVED event verified in Neon PostgreSQL audit_events table");

    console.log("\n================================================================================");
    console.log("  ALL REAL NEON DB CONCURRENCY, IDEMPOTENCY & AUTHORIZATION INVARIANTS PASSED! ");
    console.log("================================================================================");
  } finally {
    // Clean up created test row to keep production database clean
    console.log("\nCleaning up test artifacts from Neon DB...");
    for (const id of createdIds) {
      await sql`DELETE FROM consultations WHERE id = ${id};`;
      await sql`DELETE FROM audit_events WHERE resource_id = ${id};`;
    }
    console.log("Clean up complete. Zero test rows leaked.");
  }
}

runRealNeonVerification().catch((err) => {
  console.error("Neon DB verification failed:", err);
  process.exit(1);
});
