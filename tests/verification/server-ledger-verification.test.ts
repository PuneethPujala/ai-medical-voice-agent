import assert from "node:assert/strict";
import { POST as consultPost, memoryConsultations } from "../../app/api/consultations/route";
import { GET as verifyGet } from "../../app/api/consultations/[id]/verify/route";
import { DEFAULT_INTERNAL_TEST_SECRET } from "../../lib/auth/rbac";
import { computeCanonicalConsultationDigest } from "../../lib/audit/audit-logger";
import { getDb } from "../../config/db";
import { consultationsTable } from "../../config/schema";
import { eq } from "drizzle-orm";

(process.env as Record<string, string | undefined>).NODE_ENV = "test";
process.env.INTERNAL_TEST_SECRET = DEFAULT_INTERNAL_TEST_SECRET;

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  (!process.env.CI ? "postgresql://postgres:testpass@localhost:5433/medvoice_test" : undefined);

if (TEST_DB_URL && !process.env.TEST_DATABASE_URL) {
  (process.env as Record<string, string | undefined>).TEST_DATABASE_URL = TEST_DB_URL;
}

async function runVerificationTests() {
  console.log("================================================================================");
  console.log("   CRYPTOGRAPHIC AUDIT LEDGER & CONSULTATION VERIFICATION TEST SUITE           ");
  console.log("================================================================================\n");

  const patientId = `patient-verify-${Date.now()}`;
  const encounterId = `ENC-VERIFY-${Date.now()}`;

  const patientHeaders = {
    "Content-Type": "application/json",
    "x-test-harness-secret": DEFAULT_INTERNAL_TEST_SECRET,
    "x-mock-role": "patient",
    "x-mock-user-id": patientId,
  };

  const otherPatientHeaders = {
    "Content-Type": "application/json",
    "x-test-harness-secret": DEFAULT_INTERNAL_TEST_SECRET,
    "x-mock-role": "patient",
    "x-mock-user-id": "unauthorized-patient-999",
  };

  // --------------------------------------------------------------------------
  // TEST 1: Create consultation and verify server audit ledger
  // --------------------------------------------------------------------------
  console.log(">>> TEST 1: Consultation creation and audit ledger verification");
  {
    const createReq = new Request("http://localhost:3000/api/consultations", {
      method: "POST",
      headers: patientHeaders,
      body: JSON.stringify({
        id: encounterId,
        patientName: "Alice Walker",
        patientGender: "female",
        doctorId: "dr-sarah-chen",
        doctorName: "Dr. Sarah Chen, MD",
        specialty: "General Physician",
        chiefComplaint: "Severe recurring migraine for three days",
        status: "in_progress",
        triageLevel: "gathering_history",
        caseVersion: 1,
      }),
    });

    const createRes = await consultPost(createReq);
    assert.equal(createRes.status, 200, "Consultation creation should succeed");

    const verifyReq = new Request(`http://localhost:3000/api/consultations/${encounterId}/verify`, {
      method: "GET",
      headers: patientHeaders,
    });

    const verifyRes = await verifyGet(verifyReq, {
      params: Promise.resolve({ id: encounterId }),
    });

    assert.equal(verifyRes.status, 200, "Verify endpoint returned 200");
    const verifyData = await verifyRes.json();

    assert.equal(verifyData.success, true, "Verify response reports success");
    assert.equal(verifyData.status, "VERIFIED", "Status is VERIFIED");
    assert.ok(verifyData.computedDigest, "Computed digest is present");
    assert.equal(
      verifyData.recordedDigest,
      verifyData.computedDigest,
      "Recorded digest matches freshly computed digest"
    );
    console.log(`  [PASS] Successfully verified encounter ${encounterId} against server audit ledger`);
  }

  // --------------------------------------------------------------------------
  // TEST 2: Tamper detection (MISMATCH)
  // --------------------------------------------------------------------------
  console.log("\n>>> TEST 2: Tamper detection when consultation contents are altered");
  {
    // Find record in memory or DB and mutate it
    const memRecord = memoryConsultations.find((c) => c.id === encounterId);
    if (memRecord) {
      memRecord.chiefComplaint = "TAMPERED: Patient claims no symptoms at all";
    }
    const dbClient = getDb();
    if (dbClient) {
      await dbClient
        .update(consultationsTable)
        .set({ chiefComplaint: "TAMPERED: Patient claims no symptoms at all" })
        .where(eq(consultationsTable.id, encounterId));
    }

    const verifyReq = new Request(`http://localhost:3000/api/consultations/${encounterId}/verify`, {
      method: "GET",
      headers: patientHeaders,
    });

    const verifyRes = await verifyGet(verifyReq, {
      params: Promise.resolve({ id: encounterId }),
    });

    assert.equal(verifyRes.status, 200, "Verify endpoint returned 200");
    const verifyData = await verifyRes.json();

    assert.equal(verifyData.status, "MISMATCH", "Status is MISMATCH when content is tampered");
    assert.notEqual(
      verifyData.computedDigest,
      verifyData.recordedDigest,
      "Computed digest differs from sealed ledger digest"
    );
    console.log("  [PASS] Correctly detected payload mismatch against sealed audit ledger");

    // Restore for remaining tests
    if (memRecord) {
      memRecord.chiefComplaint = "Severe recurring migraine for three days";
    }
    if (dbClient) {
      await dbClient
        .update(consultationsTable)
        .set({ chiefComplaint: "Severe recurring migraine for three days" })
        .where(eq(consultationsTable.id, encounterId));
    }
  }

  // --------------------------------------------------------------------------
  // TEST 3: Cross-tenant isolation (IDOR protection on verify endpoint)
  // --------------------------------------------------------------------------
  console.log("\n>>> TEST 3: IDOR protection on verification endpoint");
  {
    const verifyReq = new Request(`http://localhost:3000/api/consultations/${encounterId}/verify`, {
      method: "GET",
      headers: otherPatientHeaders,
    });

    const verifyRes = await verifyGet(verifyReq, {
      params: Promise.resolve({ id: encounterId }),
    });

    assert.equal(verifyRes.status, 403, "Other patient receives 403 Forbidden");
    console.log("  [PASS] Unauthorized cross-tenant verification attempt blocked with 403");
  }

  // --------------------------------------------------------------------------
  // TEST 4: Missing audit digest yields UNAVAILABLE
  // --------------------------------------------------------------------------
  console.log("\n>>> TEST 4: Consultation without audit digest yields UNAVAILABLE");
  {
    const unrecordedId = `ENC-UNRECORDED-${Date.now()}`;
    memoryConsultations.push({
      id: unrecordedId,
      userId: patientId,
      patientName: "Bob Ross",
      doctorId: "dr-sarah-chen",
      doctorName: "Dr. Sarah Chen, MD",
      specialty: "General Physician",
      chiefComplaint: "Routine checkup",
      status: "in_progress",
      triageLevel: "gathering_history",
      caseVersion: 1,
    } as any);

    const verifyReq = new Request(`http://localhost:3000/api/consultations/${unrecordedId}/verify`, {
      method: "GET",
      headers: patientHeaders,
    });

    const verifyRes = await verifyGet(verifyReq, {
      params: Promise.resolve({ id: unrecordedId }),
    });

    assert.equal(verifyRes.status, 200, "Verify endpoint returned 200");
    const verifyData = await verifyRes.json();

    assert.equal(verifyData.status, "UNAVAILABLE", "Status is UNAVAILABLE when no ledger digest exists");
    console.log("  [PASS] Unaudited record returns UNAVAILABLE without false claim");
  }

  console.log("\n================================================================================");
  console.log("      ALL SERVER LEDGER VERIFICATION TESTS PASSED (100%)                        ");
  console.log("================================================================================");
}

runVerificationTests().catch((err) => {
  console.error("Verification test suite failed:", err);
  process.exit(1);
});
