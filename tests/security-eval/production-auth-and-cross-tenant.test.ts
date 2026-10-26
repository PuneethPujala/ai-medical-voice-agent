import assert from "assert";
import { GET as getAudit } from "../../app/api/audit/route";
import { GET as getConsultations } from "../../app/api/consultations/route";
import { GET as getConsultationById } from "../../app/api/consultations/[id]/route";
import { GET as getConsultationFhir } from "../../app/api/consultations/[id]/fhir/route";
import { GET as getPatientProfiles } from "../../app/api/patient/profile/route";
import { GET as getPatientProfileById } from "../../app/api/patient/profile/[id]/route";
import { Role, DEFAULT_INTERNAL_TEST_SECRET, INTERNAL_TEST_SECRET_HEADER } from "../../lib/auth/rbac";
import { memoryConsultations } from "../../app/api/consultations/route";
import { PatientProfileService } from "../../lib/patient/patient-profile-service";

function createTestHeaders(role: Role, userId: string, extra: Record<string, string> = {}) {
  return {
    "x-mock-role": role,
    "x-mock-user-id": userId,
    [INTERNAL_TEST_SECRET_HEADER]: DEFAULT_INTERNAL_TEST_SECRET,
    ...extra,
  };
}

async function runProductionAuthorizationSuite() {
  console.log("================================================================================");
  console.log("   PRODUCTION-MODE RBAC & CROSS-TENANT ADVERSARIAL AUTHORIZATION BATTERY        ");
  console.log("================================================================================");

  // ---------------------------------------------------------------------------
  // PART A: PRODUCTION-MODE ENFORCEMENT (NODE_ENV === "production")
  // ---------------------------------------------------------------------------
  console.log("\n--- PART A: PRODUCTION-MODE ADVERSARIAL PROBING (NODE_ENV = 'production') ---");
  const originalEnv = process.env.NODE_ENV;
  (process.env as any).NODE_ENV = "production";

  try {
    // 1. Unauthenticated Requests (No Session) -> 401 Unauthorized across all endpoints
    console.log("\n[Test 1] Missing Session / Anonymous Request Enforces 401 in Production");
    const endpoints = [
      { name: "GET /api/audit", call: () => getAudit(new Request("https://medvoice.org/api/audit")) },
      { name: "GET /api/patient/profile", call: () => getPatientProfiles(new Request("https://medvoice.org/api/patient/profile")) },
      {
        name: "GET /api/consultations/[id]",
        call: () => getConsultationById(
          new Request("https://medvoice.org/api/consultations/MED-2026-ACS-8841"),
          { params: Promise.resolve({ id: "MED-2026-ACS-8841" }) }
        ),
      },
      {
        name: "GET /api/consultations/[id]/fhir",
        call: () => getConsultationFhir(
          new Request("https://medvoice.org/api/consultations/MED-2026-ACS-8841/fhir"),
          { params: Promise.resolve({ id: "MED-2026-ACS-8841" }) }
        ),
      },
    ];

    for (const ep of endpoints) {
      const res = await ep.call();
      assert.strictEqual(res.status, 401, `${ep.name} without session must return 401`);
    }
    console.log("  ✓ Test 1 Passed: All protected endpoints enforce 401 Unauthorized when session is absent in production.");

    // 2. Forged Test Headers in Production (x-mock-role, x-test-harness-secret) -> MUST FAIL (401)
    console.log("\n[Test 2] Forged Test Headers in Production Mode (x-mock-role: admin)");
    const forgedReq = new Request("https://medvoice.org/api/audit", {
      headers: {
        "x-mock-role": "admin",
        "x-mock-user-id": "attacker-fake-admin",
        [INTERNAL_TEST_SECRET_HEADER]: DEFAULT_INTERNAL_TEST_SECRET,
      },
    });

    const resForged = await getAudit(forgedReq);
    assert.strictEqual(
      resForged.status,
      401,
      "Forged admin headers in production MUST NOT elevate privileges; returns 401"
    );
    console.log("  ✓ Test 2 Passed: Server completely ignores x-mock-role and test secrets when NODE_ENV === 'production'.");

  } finally {
    (process.env as any).NODE_ENV = originalEnv;
  }

  // ---------------------------------------------------------------------------
  // PART B: CROSS-TENANT ISOLATION MATRIX (Exercising Authentic Server Policy)
  // ---------------------------------------------------------------------------
  console.log("\n--- PART B: CROSS-TENANT ISOLATION & IDOR DEFENSE MATRIX ---");
  (process.env as any).NODE_ENV = "test";
  (process.env as any).INTERNAL_TEST_SECRET = DEFAULT_INTERNAL_TEST_SECRET;

  // Set up dedicated test fixtures in memoryConsultations
  const testRecordA = {
    id: `ENC-ALICE-${Date.now()}`,
    userId: "patient-alice-123",
    patientName: "Alice Tenant",
    doctorId: "dr-sarah-chen",
    status: "approved",
    createdAt: new Date().toISOString(),
    chiefComplaint: "Alice confidential health data",
    triageLevel: "routine",
    transcript: [],
  };
  const testRecordB = {
    id: `ENC-BOB-${Date.now()}`,
    userId: "patient-bob-456",
    patientName: "Bob Tenant",
    doctorId: "dr-sarah-chen",
    status: "approved",
    createdAt: new Date().toISOString(),
    chiefComplaint: "Bob confidential heart condition",
    triageLevel: "emergency",
    transcript: [],
  };
  memoryConsultations.push(testRecordA as any, testRecordB as any);

  // 3. Patient Alice accessing her own consultation -> 200 OK
  console.log("\n[Test 3] Patient Alice accesses her own consultation (200 OK)");
  const aliceOwnRes = await getConsultationById(
    new Request(`https://medvoice.org/api/consultations/${testRecordA.id}`, {
      headers: createTestHeaders("patient", "patient-alice-123"),
    }),
    { params: Promise.resolve({ id: testRecordA.id }) }
  );
  assert.strictEqual(aliceOwnRes.status, 200, "Patient Alice can access her own consultation");
  const aliceOwnJson = await aliceOwnRes.json();
  assert.strictEqual(aliceOwnJson.consultation.patientName, "Alice Tenant");
  console.log("  ✓ Test 3 Passed: Patient successfully accesses own consultation record.");

  // 4. Patient Alice attempting to access Patient Bob's consultation -> 403 Forbidden
  console.log("\n[Test 4] Cross-Tenant IDOR: Patient Alice requests Bob's consultation (403 Forbidden)");
  const aliceCrossConsultRes = await getConsultationById(
    new Request(`https://medvoice.org/api/consultations/${testRecordB.id}`, {
      headers: createTestHeaders("patient", "patient-alice-123"),
    }),
    { params: Promise.resolve({ id: testRecordB.id }) }
  );
  assert.strictEqual(aliceCrossConsultRes.status, 403, "Alice accessing Bob's consultation returns 403 Forbidden");
  const crossConsultJson = await aliceCrossConsultRes.json();
  assert.strictEqual(crossConsultJson.consultation, undefined, "Zero clinical data leaked in 403 body");
  console.log("  ✓ Test 4 Passed: Cross-tenant consultation read strictly rejected with 403 Forbidden.");

  // 5. Patient Alice attempting to export Patient Bob's FHIR record -> 403 OperationOutcome
  console.log("\n[Test 5] Cross-Tenant IDOR: Patient Alice exports Bob's FHIR document (403 Forbidden)");
  const aliceCrossFhirRes = await getConsultationFhir(
    new Request(`https://medvoice.org/api/consultations/${testRecordB.id}/fhir`, {
      headers: createTestHeaders("patient", "patient-alice-123"),
    }),
    { params: Promise.resolve({ id: testRecordB.id }) }
  );
  assert.strictEqual(aliceCrossFhirRes.status, 403, "Alice exporting Bob's FHIR returns 403 Forbidden");
  const crossFhirJson = await aliceCrossFhirRes.json();
  assert.strictEqual(crossFhirJson.resourceType, "OperationOutcome", "Returns FHIR OperationOutcome format");
  assert.strictEqual(crossFhirJson.entry, undefined, "Zero FHIR resource bundle leaked");
  console.log("  ✓ Test 5 Passed: Cross-tenant FHIR export strictly rejected with 403 OperationOutcome.");

  // 6. Query Parameter Tampering (?userId=patient-bob-456)
  console.log("\n[Test 6] Parameter Spoofing: Alice attempts to query Bob's records via ?userId");
  const aliceSpoofQueryRes = await getConsultations(
    new Request("https://medvoice.org/api/consultations?userId=patient-bob-456", {
      headers: createTestHeaders("patient", "patient-alice-123"),
    })
  );
  assert.strictEqual(aliceSpoofQueryRes.status, 403, "Query parameter userId spoofing rejected with 403");
  console.log("  ✓ Test 6 Passed: Server derives user scope strictly from authenticated session, rejecting spoofed query param.");

  // 7. Patient Profile Cross-Tenant Isolation
  console.log("\n[Test 7] Patient Profile Multi-Tenant Isolation (/api/patient/profile/[id])");
  const originalGetProfile = PatientProfileService.getProfileById;
  PatientProfileService.getProfileById = async (id: string, userId: string) => {
    // Only return data if caller's authenticated userId matches the profile owner
    if (id === "prof-bob-999" && userId === "patient-bob-456") {
      return { id: "prof-bob-999", userId: "patient-bob-456", name: "Bob", conditions: ["Hypertension"] } as any;
    }
    return null;
  };

  const aliceCrossProfileRes = await getPatientProfileById(
    new Request("https://medvoice.org/api/patient/profile/prof-bob-999", {
      headers: createTestHeaders("patient", "patient-alice-123"),
    }),
    { params: Promise.resolve({ id: "prof-bob-999" }) }
  );
  assert.strictEqual(aliceCrossProfileRes.status, 404, "Alice requesting Bob's profile returns 404 NOT_FOUND");
  const crossProfJson = await aliceCrossProfileRes.json();
  assert.strictEqual(crossProfJson.profile, undefined, "Zero profile data leaked");
  PatientProfileService.getProfileById = originalGetProfile;
  console.log("  ✓ Test 7 Passed: Cross-tenant profile lookup safely non-discloses and returns 404.");

  // 8. Role Authorization: Patient rejected from Audit Ledger (403 Forbidden)
  console.log("\n[Test 8] Role Boundary: Authenticated Patient rejected from /api/audit (403 Forbidden)");
  const patientAuditRes = await getAudit(
    new Request("https://medvoice.org/api/audit", {
      headers: createTestHeaders("patient", "patient-alice-123"),
    })
  );
  assert.strictEqual(patientAuditRes.status, 403, "Patient role accessing audit ledger returns 403");
  const patientAuditJson = await patientAuditRes.json();
  assert.strictEqual(patientAuditJson.code, "FORBIDDEN");
  console.log("  ✓ Test 8 Passed: Patient role denied audit ledger access with 403 FORBIDDEN.");

  // 9. Administrator Authorized Access
  console.log("\n[Test 9] Administrator Role Access (200 OK across governance routes)");
  const adminAuditRes = await getAudit(
    new Request("https://medvoice.org/api/audit", {
      headers: createTestHeaders("admin", "admin-dr-chen"),
    })
  );
  assert.strictEqual(adminAuditRes.status, 200, "Admin can inspect audit ledger");

  const adminConsultRes = await getConsultationById(
    new Request(`https://medvoice.org/api/consultations/${testRecordA.id}`, {
      headers: createTestHeaders("admin", "admin-dr-chen"),
    }),
    { params: Promise.resolve({ id: testRecordA.id }) }
  );
  assert.strictEqual(adminConsultRes.status, 200, "Admin can inspect clinical records for maintenance");
  console.log("  ✓ Test 9 Passed: Admin role access verified in accordance with documented governance policy.");

  console.log("\n================================================================================");
  console.log("  ALL PRODUCTION AUTHORIZATION & CROSS-TENANT TESTS PASSED (100% VERIFIED)      ");
  console.log("================================================================================\n");
}

runProductionAuthorizationSuite().catch((err) => {
  console.error("Fatal production authorization failure:", err);
  process.exit(1);
});
