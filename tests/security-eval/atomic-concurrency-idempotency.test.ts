import assert from "assert";
import { POST as postConsultation } from "../../app/api/consultations/route";
import { PATCH as patchConsultationById, GET as getConsultationById } from "../../app/api/consultations/[id]/route";
import { DEFAULT_INTERNAL_TEST_SECRET, INTERNAL_TEST_SECRET_HEADER, Role } from "../../lib/auth/rbac";
import { neon } from "@neondatabase/serverless";
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

async function runAtomicConcurrencyTests() {
  console.log("================================================================================");
  console.log("  REAL POSTGRESQL ATOMIC CAS & UNIQUE IDEMPOTENCY HARNESS                     ");
  console.log("================================================================================");

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.warn("⚠️  SKIPPED: DATABASE_URL not set. Real PostgreSQL datastore required for live CAS tests.");
    console.warn("   Passing in offline/mock CI environment.");
    return;
  }

  const sql = neon(dbUrl);
  const cleanupIds: string[] = [];
  const cleanupKeys: string[] = [];

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Atomic Compare-and-Swap on Concurrent Updates from Same Version
    // -------------------------------------------------------------------------
    console.log("\n[Test 1] Atomic Compare-And-Swap (CAS) on simultaneous updates (caseVersion=1 -> 2)");
    const encId1 = `ENC-CAS-${Date.now()}`;
    const testPatient1 = "patient-cas-alice";
    cleanupIds.push(encId1);

    // Step 1a: Create encounter at caseVersion: 1
    const createReq1 = new Request("https://medvoice.org/api/consultations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...createTestHeaders("patient", testPatient1),
      },
      body: JSON.stringify({
        id: encId1,
        patientName: "Alice CAS",
        doctorId: "dr-sarah-chen",
        doctorName: "Dr. Sarah Chen, MD",
        specialty: "Internal Medicine",
        chiefComplaint: "Severe migraine",
        caseVersion: 1,
        idempotencyKey: `init-key-${encId1}`,
      }),
    });

    const createRes1 = await postConsultation(createReq1);
    assert.strictEqual(createRes1.status, 200, "Initial insert succeeds with 200");

    // Step 1b: Fire two simultaneous updates proposing caseVersion: 2
    const updatePromises = [1, 2].map((callerNum) => {
      const req = new Request(`https://medvoice.org/api/consultations/${encId1}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...createTestHeaders("patient", testPatient1),
        },
        body: JSON.stringify({
          caseVersion: 2,
          soapPlan: `Plan proposed by concurrent caller ${callerNum}`,
        }),
      });
      return patchConsultationById(req, { params: Promise.resolve({ id: encId1 }) });
    });

    const [resA, resB] = await Promise.all(updatePromises);
    const statuses = [resA.status, resB.status].sort();

    console.log(`  Update statuses: Caller A=${resA.status}, Caller B=${resB.status}`);
    assert.deepStrictEqual(
      statuses,
      [200, 409],
      "Exactly one simultaneous update must succeed (200), and exactly one must fail with conflict (409)"
    );

    const conflictRes = resA.status === 409 ? resA : resB;
    const conflictJson = await conflictRes.json();
    assert.strictEqual(conflictJson.code, "CONCURRENCY_CONFLICT", "Conflict response reports CONCURRENCY_CONFLICT");

    // Step 1c: Check final database state via direct SQL
    const rows1 = await sql`SELECT case_version, soap_plan FROM consultations WHERE id = ${encId1};`;
    assert.strictEqual(rows1.length, 1);
    assert.strictEqual(rows1[0].case_version, 2, "Database case_version advanced to 2 exactly once");
    console.log("  ✓ Atomic CAS verified: Exactly one update committed, second update rejected with 409 CONCURRENCY_CONFLICT.");

    // -------------------------------------------------------------------------
    // TEST 2: Database-Enforced Unique Idempotency with Differing Request IDs
    // -------------------------------------------------------------------------
    console.log("\n[Test 2] Simultaneous POSTs with DIFFERENT IDs but SAME owner and idempotencyKey");
    const sharedKey2 = `idem-cross-id-${Date.now()}`;
    const testPatient2 = "patient-idem-bob";
    const reqIdA = `ENC-DIFF-A-${Date.now()}`;
    const reqIdB = `ENC-DIFF-B-${Date.now()}`;
    cleanupIds.push(reqIdA, reqIdB);
    cleanupKeys.push(sharedKey2);

    const postPromises = [reqIdA, reqIdB].map((rId, i) => {
      const req = new Request("https://medvoice.org/api/consultations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...createTestHeaders("patient", testPatient2),
        },
        body: JSON.stringify({
          id: rId,
          patientName: "Bob Idempotent",
          doctorId: "dr-sarah-chen",
          doctorName: "Dr. Sarah Chen, MD",
          specialty: "Internal Medicine",
          chiefComplaint: "Chest pressure iteration " + i,
          idempotencyKey: sharedKey2,
        }),
      });
      return postConsultation(req);
    });

    const [postResA, postResB] = await Promise.all(postPromises);
    assert.strictEqual(postResA.status, 200, "First concurrent POST returns 200");
    assert.strictEqual(postResB.status, 200, "Second concurrent POST returns 200");

    const jsonA = await postResA.json();
    const jsonB = await postResB.json();

    const oneIsRetry = jsonA.isIdempotentRetry || jsonB.isIdempotentRetry;
    assert.strictEqual(oneIsRetry, true, "At least one response reports isIdempotentRetry: true");

    // Direct SQL check: only ONE row must exist in Neon DB with that idempotencyKey
    const dbKeyRows = await sql`
      SELECT id, user_id, idempotency_key 
      FROM consultations 
      WHERE user_id = ${testPatient2} AND idempotency_key = ${sharedKey2};
    `;
    assert.strictEqual(dbKeyRows.length, 1, "Database unique constraint strictly guarantees exactly 1 row committed");
    console.log(`  ✓ Database-enforced idempotency verified: Exactly 1 row committed to Neon DB (${dbKeyRows[0].id}); second caller returned idempotent retry.`);

    // -------------------------------------------------------------------------
    // TEST 3: Multi-Tenant Key Isolation: Different Users with Same Key
    // -------------------------------------------------------------------------
    console.log("\n[Test 3] Tenant Isolation: Different users using the SAME idempotencyKey");
    const tenantKey = `tenant-shared-key-${Date.now()}`;
    const userAlice = "tenant-user-alice";
    const userCharlie = "tenant-user-charlie";
    const encAlice = `ENC-ALICE-${Date.now()}`;
    const encCharlie = `ENC-CHARLIE-${Date.now()}`;
    cleanupIds.push(encAlice, encCharlie);
    cleanupKeys.push(tenantKey);

    const reqAlice = new Request("https://medvoice.org/api/consultations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...createTestHeaders("patient", userAlice),
      },
      body: JSON.stringify({
        id: encAlice,
        patientName: "Alice Tenant",
        doctorId: "dr-sarah-chen",
        doctorName: "Dr. Sarah Chen, MD",
        specialty: "Internal Medicine",
        chiefComplaint: "Alice complaint",
        idempotencyKey: tenantKey,
      }),
    });

    const reqCharlie = new Request("https://medvoice.org/api/consultations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...createTestHeaders("patient", userCharlie),
      },
      body: JSON.stringify({
        id: encCharlie,
        patientName: "Charlie Tenant",
        doctorId: "dr-marcus-vance",
        doctorName: "Dr. Marcus Vance, MD",
        specialty: "Cardiology",
        chiefComplaint: "Charlie complaint",
        idempotencyKey: tenantKey,
      }),
    });

    const [resAlice, resCharlie] = await Promise.all([
      postConsultation(reqAlice),
      postConsultation(reqCharlie),
    ]);

    assert.strictEqual(resAlice.status, 200, "Alice POST succeeds (200)");
    assert.strictEqual(resCharlie.status, 200, "Charlie POST succeeds (200)");

    // Assert zero cross-tenant leak: Alice cannot see Charlie's data and vice-versa
    const jsonAlice = await resAlice.json();
    const jsonCharlie = await resCharlie.json();
    assert.strictEqual(jsonAlice.consultation.userId, userAlice);
    assert.strictEqual(jsonCharlie.consultation.userId, userCharlie);
    assert.notStrictEqual(jsonAlice.consultation.id, jsonCharlie.consultation.id);

    // Direct SQL check: two separate records exist, each partitioned by user_id
    const tenantRows = await sql`
      SELECT id, user_id, idempotency_key 
      FROM consultations 
      WHERE idempotency_key = ${tenantKey};
    `;
    assert.strictEqual(tenantRows.length, 2, "Both tenants safely hold their own isolated records with matching key");
    console.log("  ✓ Tenant isolation verified: Keys partitioned by user_id; zero cross-tenant leakage or collision.");

    // -------------------------------------------------------------------------
    // TEST 4: Material Payload Mismatch on Idempotent Key Replay
    // -------------------------------------------------------------------------
    console.log("\n[Test 4] Payload Mismatch Detection on Repeated Idempotency Key");
    const mismatchReq = new Request("https://medvoice.org/api/consultations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...createTestHeaders("patient", userAlice),
      },
      body: JSON.stringify({
        id: `ENC-MISMATCH-${Date.now()}`,
        patientName: "Alice Tenant",
        doctorId: "dr-arthur-pendelton", // Conflicting doctor!
        doctorName: "Dr. Arthur Pendelton, MD",
        specialty: "Neurology",
        chiefComplaint: "Completely different acute symptom",
        idempotencyKey: tenantKey, // Replaying Alice's key with conflicting intent
      }),
    });

    const mismatchRes = await postConsultation(mismatchReq);
    assert.strictEqual(mismatchRes.status, 422, "Conflicting payload with same idempotencyKey must be rejected (422)");
    const mismatchJson = await mismatchRes.json();
    assert.strictEqual(mismatchJson.code, "IDEMPOTENCY_PAYLOAD_MISMATCH");
    console.log("  ✓ Payload mismatch guard verified: Conflicting critical parameters rejected with 422 IDEMPOTENCY_PAYLOAD_MISMATCH.");

    console.log("\n================================================================================");
    console.log("  ALL ATOMIC CAS & DATABASE-ENFORCED IDEMPOTENCY TESTS PASSED (100% VERIFIED)  ");
    console.log("================================================================================");
  } finally {
    console.log("\nCleaning up test encounters from Neon datastore...");
    if (cleanupIds.length > 0) {
      for (const id of cleanupIds) {
        await sql`DELETE FROM consultations WHERE id = ${id};`;
      }
    }
    if (cleanupKeys.length > 0) {
      for (const key of cleanupKeys) {
        await sql`DELETE FROM consultations WHERE idempotency_key = ${key};`;
      }
    }
    console.log("Cleanup complete. Zero test rows leaked.");
  }
}

runAtomicConcurrencyTests().catch((err) => {
  console.error("\nFATAL TEST FAILURE:", err);
  process.exit(1);
});
