import assert from "assert";
import {
  GET as getConsultationById,
  PATCH as patchConsultationById,
  DELETE as deleteConsultationById,
} from "../../app/api/consultations/[id]/route";
import { memoryConsultations } from "../../app/api/consultations/route";
import { setCustomDbClient } from "../../config/db";
import { Role, DEFAULT_INTERNAL_TEST_SECRET, INTERNAL_TEST_SECRET_HEADER } from "../../lib/auth/rbac";

function createTestHeaders(role: Role, userId: string) {
  return {
    "x-mock-role": role,
    "x-mock-user-id": userId,
    [INTERNAL_TEST_SECRET_HEADER]: DEFAULT_INTERNAL_TEST_SECRET,
    "Content-Type": "application/json",
  };
}

async function runConsultationRouteRegressionBattery() {
  console.log("================================================================================");
  console.log("    CONSULTATION ROUTE BEHAVIOR, ISOLATION & REGRESSION BATTERY                ");
  console.log("================================================================================\n");

  const originalEnv = process.env.NODE_ENV;

  try {
    // -------------------------------------------------------------------------
    // 1. Production Mode: Auth Wall & Zero-Trust Defense
    // -------------------------------------------------------------------------
    console.log("[Test 1] Production Mode: Anonymous & Mock Header Rejection (401)");
    (process.env as any).NODE_ENV = "production";

    const prodMemId = `PROD-MEM-${Date.now()}`;
    memoryConsultations.push({
      id: prodMemId,
      userId: "patient-alice",
      status: "approved",
      caseVersion: 1,
    } as any);

    // Unauthenticated GET in production -> 401
    const unauthGetRes = await getConsultationById(
      new Request(`https://medvoice.org/api/consultations/${prodMemId}`),
      { params: Promise.resolve({ id: prodMemId }) }
    );
    assert.strictEqual(unauthGetRes.status, 401, "Production GET without session must return 401");

    // Forged headers in production -> 401 (test harness headers ignored in production)
    const forgedPatchRes = await patchConsultationById(
      new Request(`https://medvoice.org/api/consultations/${prodMemId}`, {
        method: "PATCH",
        headers: createTestHeaders("patient", "patient-alice"),
        body: JSON.stringify({ soapSubjective: "Update attempt" }),
      }),
      { params: Promise.resolve({ id: prodMemId }) }
    );
    assert.strictEqual(forgedPatchRes.status, 401, "Production PATCH with forged mock headers must return 401");

    const forgedDeleteRes = await deleteConsultationById(
      new Request(`https://medvoice.org/api/consultations/${prodMemId}`, {
        method: "DELETE",
        headers: createTestHeaders("patient", "patient-alice"),
      }),
      { params: Promise.resolve({ id: prodMemId }) }
    );
    assert.strictEqual(forgedDeleteRes.status, 401, "Production DELETE with forged mock headers must return 401");
    console.log("  ✓ Production mode strictly enforces 401 across all endpoints.");

    // -------------------------------------------------------------------------
    // 2. Authenticated Datastore Failure Handling (503 Service Unavailable)
    // -------------------------------------------------------------------------
    console.log("\n[Test 2] Datastore Failure Handling: Throws 503 on Connection Breakdown");
    (process.env as any).NODE_ENV = "test";
    (process.env as any).INTERNAL_TEST_SECRET = DEFAULT_INTERNAL_TEST_SECRET;

    // Simulate DB failure on lookup
    setCustomDbClient({
      select: () => {
        throw new Error("Neon connection failed: socket timeout");
      },
      insert: () => ({
        values: async () => {},
      }),
    } as any);

    const dbFailPatchRes = await patchConsultationById(
      new Request(`https://medvoice.org/api/consultations/${prodMemId}`, {
        method: "PATCH",
        headers: createTestHeaders("patient", "patient-alice"),
        body: JSON.stringify({ soapSubjective: "Update attempt" }),
      }),
      { params: Promise.resolve({ id: prodMemId }) }
    );
    assert.strictEqual(dbFailPatchRes.status, 503, "PATCH must return 503 when DB lookup fails");
    const dbFailPatchJson = await dbFailPatchRes.json();
    assert.strictEqual(dbFailPatchJson.code, "SERVICE_UNAVAILABLE");
    console.log("  ✓ Datastore lookup breakdown gracefully and safely fails closed with 503 SERVICE_UNAVAILABLE.");

    // -------------------------------------------------------------------------
    // 2. Dev/Test Mode: Legitimate In-Memory Fixtures & Concurrency
    // -------------------------------------------------------------------------
    console.log("\n[Test 3] Dev/Test Mode: In-Memory Record Mutation & Optimistic Concurrency");
    (process.env as any).NODE_ENV = "test";
    setCustomDbClient(false); // In-memory mode

    const memEncounterId = `ENC-MEM-${Date.now()}`;
    const memRecord: any = {
      id: memEncounterId,
      userId: "patient-charlie",
      patientName: "Charlie Patient",
      doctorId: "dr-sarah-chen",
      status: "completed_pending_review",
      caseVersion: 2,
      createdAt: new Date().toISOString(),
      soapSubjective: "Original Charlie complaint",
    };
    memoryConsultations.push(memRecord);

    // 3a. Legitimate PATCH by record owner
    const patchMemRes = await patchConsultationById(
      new Request(`https://medvoice.org/api/consultations/${memEncounterId}`, {
        method: "PATCH",
        headers: createTestHeaders("patient", "patient-charlie"),
        body: JSON.stringify({
          soapSubjective: "Updated Charlie complaint: symptom improved",
          expectedVersion: 2,
        }),
      }),
      { params: Promise.resolve({ id: memEncounterId }) }
    );
    assert.strictEqual(patchMemRes.status, 200, "In-memory PATCH should return 200");
    const patchedMemJson = await patchMemRes.json();
    assert.strictEqual(patchedMemJson.consultation.soapSubjective, "Updated Charlie complaint: symptom improved");
    assert.strictEqual(patchedMemJson.consultation.caseVersion, 3, "caseVersion incremented to 3");
    assert.strictEqual(memRecord.caseVersion, 3, "In-memory fixture version mutated to 3");

    // 3b. Optimistic Concurrency Conflict on In-Memory Record
    const conflictMemRes = await patchConsultationById(
      new Request(`https://medvoice.org/api/consultations/${memEncounterId}`, {
        method: "PATCH",
        headers: createTestHeaders("patient", "patient-charlie"),
        body: JSON.stringify({
          soapSubjective: "Stale update attempt",
          expectedVersion: 2, // Stale! Current version is 3
        }),
      }),
      { params: Promise.resolve({ id: memEncounterId }) }
    );
    assert.strictEqual(conflictMemRes.status, 409, "Stale expectedVersion on in-memory record returns 409 Conflict");
    console.log("  ✓ In-memory mutations support valid updates and strictly enforce optimistic locking (409).");

    // -------------------------------------------------------------------------
    // 3. Dev/Test Mode: Database-Backed Record Mutation & CAS
    // -------------------------------------------------------------------------
    console.log("\n[Test 4] Dev/Test Mode: Database-Backed Record Mutation & CAS");
    let mockDbRecord: any = {
      id: `ENC-DB-${Date.now()}`,
      userId: "patient-dana",
      patientName: "Dana Patient",
      doctorId: "dr-sarah-chen",
      status: "completed_pending_review",
      caseVersion: 5,
      soapSubjective: "Original DB subjective",
    };

    // Configure mock DB client with atomic CAS behavior
    setCustomDbClient({
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [mockDbRecord],
          }),
        }),
      }),
      insert: () => ({
        values: async () => {},
      }),
      update: () => ({
        set: (fields: any) => ({
          where: (condition: any) => ({
            returning: async () => {
              if (fields.caseVersion === mockDbRecord.caseVersion + 1) {
                Object.assign(mockDbRecord, fields);
                return [{ id: mockDbRecord.id, caseVersion: mockDbRecord.caseVersion }];
              }
              return []; // 0 rows updated -> concurrency conflict!
            },
          }),
        }),
      }),
    } as any);

    // 4a. Legitimate DB-backed record update
    const patchDbRes = await patchConsultationById(
      new Request(`https://medvoice.org/api/consultations/${mockDbRecord.id}`, {
        method: "PATCH",
        headers: createTestHeaders("patient", "patient-dana"),
        body: JSON.stringify({
          soapSubjective: "Updated DB subjective notes",
          expectedVersion: 5,
        }),
      }),
      { params: Promise.resolve({ id: mockDbRecord.id }) }
    );
    assert.strictEqual(patchDbRes.status, 200, "DB-backed PATCH returns 200");
    assert.strictEqual(mockDbRecord.caseVersion, 6, "DB record version atomically advanced to 6");

    // 4b. Cross-Tenant IDOR on DB-backed record
    const idorDbRes = await patchConsultationById(
      new Request(`https://medvoice.org/api/consultations/${mockDbRecord.id}`, {
        method: "PATCH",
        headers: createTestHeaders("patient", "attacker-mallory"),
        body: JSON.stringify({
          soapSubjective: "Attacker payload",
          expectedVersion: 6,
        }),
      }),
      { params: Promise.resolve({ id: mockDbRecord.id }) }
    );
    assert.strictEqual(idorDbRes.status, 403, "Cross-tenant mutation on DB record returns 403 Forbidden");
    assert.strictEqual(mockDbRecord.soapSubjective, "Updated DB subjective notes", "DB record unmolested");

    // 4c. Optimistic concurrency conflict on DB-backed record
    // Mock DB update returning []
    setCustomDbClient({
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [mockDbRecord],
          }),
        }),
      }),
      insert: () => ({
        values: async () => {},
      }),
      update: () => ({
        set: () => ({
          where: () => ({
            returning: async () => [], // CAS failed!
          }),
        }),
      }),
    } as any);

    const dbConflictRes = await patchConsultationById(
      new Request(`https://medvoice.org/api/consultations/${mockDbRecord.id}`, {
        method: "PATCH",
        headers: createTestHeaders("patient", "patient-dana"),
        body: JSON.stringify({
          soapSubjective: "Concurrent clash",
          expectedVersion: 6,
        }),
      }),
      { params: Promise.resolve({ id: mockDbRecord.id }) }
    );
    assert.strictEqual(dbConflictRes.status, 409, "DB CAS mismatch returns 409 Conflict");
    console.log("  ✓ Database-backed mutations enforce authorization, optimistic CAS, and cross-tenant defense.");

    // -------------------------------------------------------------------------
    // 4. Clinical Invariant: Consultations are Permanent & Non-Deletable
    // -------------------------------------------------------------------------
    console.log("\n[Test 5] Clinical Invariant: DELETE Strictly Denied on Existing Record");
    const deleteAttemptRes = await deleteConsultationById(
      new Request(`https://medvoice.org/api/consultations/${mockDbRecord.id}`, {
        method: "DELETE",
        headers: createTestHeaders("admin", "admin-user"), // Even admins cannot delete
      }),
      { params: Promise.resolve({ id: mockDbRecord.id }) }
    );
    assert.strictEqual(deleteAttemptRes.status, 403, "DELETE on existing consultation returns 403 Forbidden");
    const deleteJson = await deleteAttemptRes.json();
    assert.match(deleteJson.error, /permanent medical-legal documents and cannot be deleted/);
    console.log("  ✓ Permanent clinical record invariant enforced: DELETE returns 403 Forbidden.");

  } finally {
    (process.env as any).NODE_ENV = originalEnv;
    setCustomDbClient(null);
  }

  console.log("\n================================================================================");
  console.log("  CONSULTATION ROUTE REGRESSION: ALL 5 TEST SECTIONS PASSED (100%)              ");
  console.log("================================================================================\n");
}

runConsultationRouteRegressionBattery().catch((err) => {
  console.error("Consultation route regression battery failure:", err);
  process.exit(1);
});
