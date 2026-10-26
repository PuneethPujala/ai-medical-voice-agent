import assert from "assert";
import { GET as getAudit } from "../../app/api/audit/route";
import { GET as getConsultations } from "../../app/api/consultations/route";
import {
  GET as getConsultationById,
  PATCH as patchConsultationById,
  DELETE as deleteConsultationById,
} from "../../app/api/consultations/[id]/route";
import { GET as getConsultationFhir } from "../../app/api/consultations/[id]/fhir/route";
import { GET as getPatientProfiles } from "../../app/api/patient/profile/route";
import {
  GET as getPatientProfileById,
  PUT as putPatientProfileById,
  DELETE as deletePatientProfileById,
} from "../../app/api/patient/profile/[id]/route";
import { Role, DEFAULT_INTERNAL_TEST_SECRET, INTERNAL_TEST_SECRET_HEADER } from "../../lib/auth/rbac";
import { memoryConsultations } from "../../app/api/consultations/route";
import { PatientProfileService } from "../../lib/patient/patient-profile-service";
import { PatientProfile } from "../../lib/clinical-knowledge/types";

function createTestHeaders(role: Role, userId: string, extra: Record<string, string> = {}) {
  return {
    "x-mock-role": role,
    "x-mock-user-id": userId,
    [INTERNAL_TEST_SECRET_HEADER]: DEFAULT_INTERNAL_TEST_SECRET,
    "Content-Type": "application/json",
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
    caseVersion: 1,
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
    caseVersion: 1,
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

  // Profile Fixtures for Tests 7, 12, 13, 14, 15
  let mockProfiles: Record<string, PatientProfile> = {
    "prof-bob-999": {
      id: "prof-bob-999",
      userId: "patient-bob-456",
      name: "Bob Original",
      knownConditions: ["Hypertension"],
      isDeleted: false,
    } as any,
  };

  const originalGetProfile = PatientProfileService.getProfileById;
  const originalUpsertProfile = PatientProfileService.upsertProfile;
  const originalDeleteProfile = PatientProfileService.deleteProfile;

  PatientProfileService.getProfileById = async (id: string, userId: string) => {
    const p = mockProfiles[id];
    if (p && p.userId === userId && !p.isDeleted) return { ...p };
    return null;
  };

  PatientProfileService.upsertProfile = async (userId: string, data: any) => {
    const existing = mockProfiles[data.id];
    if (existing && existing.userId !== userId) {
      throw new Error("Tenant violation in upsert");
    }
    const updated = {
      ...(existing || {}),
      ...data,
      userId,
      isDeleted: false,
    };
    mockProfiles[data.id] = updated;
    return updated;
  };

  PatientProfileService.deleteProfile = async (id: string, userId: string) => {
    const p = mockProfiles[id];
    if (!p || p.userId !== userId || p.isDeleted) return false;
    p.isDeleted = true;
    return true;
  };

  try {
    // 7. Patient Profile Cross-Tenant Read
    console.log("\n[Test 7] Patient Profile Multi-Tenant Isolation Read (/api/patient/profile/[id])");
    const aliceCrossProfileRes = await getPatientProfileById(
      new Request("https://medvoice.org/api/patient/profile/prof-bob-999", {
        headers: createTestHeaders("patient", "patient-alice-123"),
      }),
      { params: Promise.resolve({ id: "prof-bob-999" }) }
    );
    assert.strictEqual(aliceCrossProfileRes.status, 404, "Alice requesting Bob's profile returns 404 NOT_FOUND");
    const crossProfJson = await aliceCrossProfileRes.json();
    assert.strictEqual(crossProfJson.profile, undefined, "Zero profile data leaked");
    console.log("  ✓ Test 7 Passed: Cross-tenant profile lookup safely non-discloses and returns 404.");

    // -------------------------------------------------------------------------
    // PART C: CROSS-TENANT MUTATION & DELETION REJECTION (P0 REQUIREMENTS)
    // -------------------------------------------------------------------------
    console.log("\n--- PART C: CROSS-TENANT MUTATION & DELETION REJECTION (STATE VERIFIED) ---");

    // 10. Cross-Tenant PATCH Consultation: Alice attempts to mutate Bob's consultation
    console.log("\n[Test 10] Cross-Tenant PATCH: Alice attempts to mutate Bob's consultation");
    const initialBobSoapSubjective = "Initial Bob subjective findings";
    testRecordB.soapSubjective = initialBobSoapSubjective;
    const initialBobVersion = testRecordB.caseVersion;

    const alicePatchBobRes = await patchConsultationById(
      new Request(`https://medvoice.org/api/consultations/${testRecordB.id}`, {
        method: "PATCH",
        headers: createTestHeaders("patient", "patient-alice-123"),
        body: JSON.stringify({
          soapSubjective: "MALICIOUS OVERWRITE BY ALICE",
          expectedVersion: initialBobVersion,
        }),
      }),
      { params: Promise.resolve({ id: testRecordB.id }) }
    );

    assert.strictEqual(alicePatchBobRes.status, 403, "Alice mutating Bob's consultation returns 403 Forbidden");
    const patchBobJson = await alicePatchBobRes.json();
    assert.strictEqual(patchBobJson.code, "FORBIDDEN", "Expected code FORBIDDEN");

    // STATE VERIFICATION: Bob's consultation MUST remain untouched in datastore
    const bobRecordInStore = memoryConsultations.find((c) => c.id === testRecordB.id);
    assert.strictEqual(bobRecordInStore?.soapSubjective, initialBobSoapSubjective, "Bob's subjective notes remain 100% untouched");
    assert.strictEqual(bobRecordInStore?.status, "approved", "Bob's status remains approved");
    assert.strictEqual(bobRecordInStore?.caseVersion, initialBobVersion, "Bob's version remains unchanged");
    console.log("  ✓ Test 10 Passed: Cross-tenant PATCH strictly denied (403) and Bob's clinical record remains unmodified.");

    // 11. Cross-Tenant DELETE Consultation: Alice attempts to delete Bob's consultation
    console.log("\n[Test 11] Cross-Tenant DELETE: Alice attempts to delete Bob's consultation");
    const aliceDeleteBobConsultRes = await deleteConsultationById(
      new Request(`https://medvoice.org/api/consultations/${testRecordB.id}`, {
        method: "DELETE",
        headers: createTestHeaders("patient", "patient-alice-123"),
      }),
      { params: Promise.resolve({ id: testRecordB.id }) }
    );

    assert.strictEqual(aliceDeleteBobConsultRes.status, 403, "Deleting consultation returns 403 Forbidden");
    // STATE VERIFICATION: Record MUST remain present
    const bobRecordStillPresent = memoryConsultations.find((c) => c.id === testRecordB.id);
    assert(Boolean(bobRecordStillPresent), "Bob's consultation record remains completely present in datastore");
    console.log("  ✓ Test 11 Passed: Cross-tenant DELETE strictly denied (403) and clinical encounter remains preserved.");

    // 12. Cross-Tenant PUT Patient Profile: Alice attempts to update Bob's profile
    console.log("\n[Test 12] Cross-Tenant PUT: Alice attempts to update Bob's patient profile");
    const alicePutBobProfileRes = await putPatientProfileById(
      new Request(`https://medvoice.org/api/patient/profile/prof-bob-999`, {
        method: "PUT",
        headers: createTestHeaders("patient", "patient-alice-123"),
        body: JSON.stringify({
          name: "Alice Malicious Update",
          knownConditions: ["Tampered Condition"],
        }),
      }),
      { params: Promise.resolve({ id: "prof-bob-999" }) }
    );

    assert.strictEqual(alicePutBobProfileRes.status, 404, "Alice updating Bob's profile returns 404 Non-disclosure");
    // STATE VERIFICATION: Bob's profile in datastore MUST be unchanged
    assert.strictEqual(mockProfiles["prof-bob-999"].name, "Bob Original", "Bob's name remains original");
    assert.deepStrictEqual(mockProfiles["prof-bob-999"].knownConditions, ["Hypertension"], "Bob's conditions remain intact");
    console.log("  ✓ Test 12 Passed: Cross-tenant profile update rejected (404) and Bob's profile state is unaltered.");

    // 13. Cross-Tenant DELETE Patient Profile: Alice attempts to delete Bob's profile
    console.log("\n[Test 13] Cross-Tenant DELETE: Alice attempts to delete Bob's patient profile");
    const aliceDeleteBobProfileRes = await deletePatientProfileById(
      new Request(`https://medvoice.org/api/patient/profile/prof-bob-999`, {
        method: "DELETE",
        headers: createTestHeaders("patient", "patient-alice-123"),
      }),
      { params: Promise.resolve({ id: "prof-bob-999" }) }
    );

    assert.strictEqual(aliceDeleteBobProfileRes.status, 404, "Alice deleting Bob's profile returns 404 Non-disclosure");
    // STATE VERIFICATION: Bob's profile MUST NOT be soft-deleted
    assert.strictEqual(mockProfiles["prof-bob-999"].isDeleted, false, "Bob's profile is NOT deleted");
    console.log("  ✓ Test 13 Passed: Cross-tenant profile deletion rejected (404) and Bob's profile remains active.");

    // 14. Unauthenticated Mutation Probing: Verify all mutation routes reject anonymous callers
    console.log("\n[Test 14] Unauthenticated Mutation Probing (401 across mutation endpoints)");
    const unauthPatchRes = await patchConsultationById(
      new Request(`https://medvoice.org/api/consultations/${testRecordB.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chiefComplaint: "Anon hack" }),
      }),
      { params: Promise.resolve({ id: testRecordB.id }) }
    );
    assert.strictEqual(unauthPatchRes.status, 401, "Unauthenticated PATCH returns 401");

    const unauthDeleteConsultRes = await deleteConsultationById(
      new Request(`https://medvoice.org/api/consultations/${testRecordB.id}`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: testRecordB.id }) }
    );
    assert.strictEqual(unauthDeleteConsultRes.status, 401, "Unauthenticated DELETE consultation returns 401");

    const unauthPutProfileRes = await putPatientProfileById(
      new Request(`https://medvoice.org/api/patient/profile/prof-bob-999`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Anon update" }),
      }),
      { params: Promise.resolve({ id: "prof-bob-999" }) }
    );
    assert.strictEqual(unauthPutProfileRes.status, 401, "Unauthenticated PUT profile returns 401");

    const unauthDeleteProfileRes = await deletePatientProfileById(
      new Request(`https://medvoice.org/api/patient/profile/prof-bob-999`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: "prof-bob-999" }) }
    );
    assert.strictEqual(unauthDeleteProfileRes.status, 401, "Unauthenticated DELETE profile returns 401");
    console.log("  ✓ Test 14 Passed: All mutation routes strictly enforce 401 Unauthorized for unauthenticated requests.");

    // 15. Authorized Owner Valid Mutations (Expected Positive Path)
    console.log("\n[Test 15] Authorized Owner Valid Mutations (200 OK + Verified State Mutation)");
    // 15a. Bob updates his own consultation
    const bobValidPatchRes = await patchConsultationById(
      new Request(`https://medvoice.org/api/consultations/${testRecordB.id}`, {
        method: "PATCH",
        headers: createTestHeaders("patient", "patient-bob-456"),
        body: JSON.stringify({
          soapSubjective: "Bob updated subjective report: acute pain now fully resolved with medication.",
          expectedVersion: testRecordB.caseVersion,
        }),
      }),
      { params: Promise.resolve({ id: testRecordB.id }) }
    );
    assert.strictEqual(bobValidPatchRes.status, 200, "Bob patching his own consultation returns 200");
    const bobPatchedJson = await bobValidPatchRes.json();
    assert.strictEqual(bobPatchedJson.consultation.soapSubjective, "Bob updated subjective report: acute pain now fully resolved with medication.");
    assert.strictEqual(testRecordB.soapSubjective, "Bob updated subjective report: acute pain now fully resolved with medication.");
    console.log("  ✓ Test 15a Passed: Authorized owner successfully patches consultation with verified state transition.");

    // 15b. Bob updates his own profile
    const bobValidPutProfileRes = await putPatientProfileById(
      new Request(`https://medvoice.org/api/patient/profile/prof-bob-999`, {
        method: "PUT",
        headers: createTestHeaders("patient", "patient-bob-456"),
        body: JSON.stringify({
          name: "Bob Valid Update",
          knownConditions: ["Hypertension", "Type 2 Diabetes"],
        }),
      }),
      { params: Promise.resolve({ id: "prof-bob-999" }) }
    );
    assert.strictEqual(bobValidPutProfileRes.status, 200, "Bob updating his own profile returns 200");
    assert.strictEqual(mockProfiles["prof-bob-999"].name, "Bob Valid Update");
    assert.deepStrictEqual(mockProfiles["prof-bob-999"].knownConditions, ["Hypertension", "Type 2 Diabetes"]);
    console.log("  ✓ Test 15b Passed: Authorized owner successfully updates own profile with verified state change.");

    // 15c. Bob soft-deletes his own profile
    const bobValidDeleteProfileRes = await deletePatientProfileById(
      new Request(`https://medvoice.org/api/patient/profile/prof-bob-999`, {
        method: "DELETE",
        headers: createTestHeaders("patient", "patient-bob-456"),
      }),
      { params: Promise.resolve({ id: "prof-bob-999" }) }
    );
    assert.strictEqual(bobValidDeleteProfileRes.status, 200, "Bob deleting his own profile returns 200");
    assert.strictEqual(mockProfiles["prof-bob-999"].isDeleted, true, "Bob's profile is marked isDeleted: true");
    console.log("  ✓ Test 15c Passed: Authorized owner successfully soft-deletes own profile.");

  } finally {
    PatientProfileService.getProfileById = originalGetProfile;
    PatientProfileService.upsertProfile = originalUpsertProfile;
    PatientProfileService.deleteProfile = originalDeleteProfile;
  }

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
