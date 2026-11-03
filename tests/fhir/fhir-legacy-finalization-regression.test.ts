import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateFHIRBundle, evaluateClinicalFinalization, ConsultationRecordFHIR } from "@/lib/fhir/bundle";
import { GET as fhirGet } from "@/app/api/consultations/[id]/fhir/route";
import { GET as verifyGet } from "@/app/api/consultations/[id]/verify/route";
import { DEFAULT_INTERNAL_TEST_SECRET } from "@/lib/auth/rbac";
import { memoryConsultations } from "@/app/api/consultations/route";

(process.env as Record<string, string | undefined>).NODE_ENV = "test";
process.env.INTERNAL_TEST_SECRET = DEFAULT_INTERNAL_TEST_SECRET;

describe("FHIR R4 Finalization & Verification Clinician Identity Regression Suite", () => {
  // ==========================================================================
  // PART 1: FHIR Clinical Finalization Policy Invariants
  // ==========================================================================

  it("1. Legacy approved + gathering_history is NOT final (must be preliminary, no attester)", () => {
    const legacyIncomplete: ConsultationRecordFHIR = {
      id: "ENC-LEGACY-INC-01",
      patientName: "Test Patient",
      status: "approved",
      triageLevel: "gathering_history",
      triageTitle: "Clinical History Gathering",
      soapSubjective: "[IN PROGRESS DRAFT - GATHERING HISTORY]\nChief Concern: Severe headache",
      soapObjective: "[IN PROGRESS] History gathering in progress.",
      soapAssessment: "[IN PROGRESS] Clinical evaluation in progress. Differential diagnosis deferred.",
      soapPlan: "[IN PROGRESS] Continue clinical intake dialogue.",
      approvedAt: "2026-10-20T05:34:42.000Z",
      approvedBy: "Legacy User",
    };

    const evalResult = evaluateClinicalFinalization(legacyIncomplete);
    assert.equal(evalResult.isFinal, false, "Must not be considered final");
    assert.equal(evalResult.attesterEligible, false, "Must not be eligible for attester");

    const bundle = generateFHIRBundle(legacyIncomplete);
    const composition = bundle.entry.find((e: any) => e.resource.resourceType === "Composition")?.resource;
    assert.ok(composition, "Composition resource must exist");
    assert.equal(composition!.status, "preliminary", "Composition status must be preliminary");
    assert.equal(composition!.attester, undefined, "Attester block must NOT be present");
  });

  it("2. Legacy approved + provisional SOAP content is NOT final", () => {
    const legacyProvisionalSoap: ConsultationRecordFHIR = {
      id: "ENC-LEGACY-PROV-02",
      patientName: "Test Patient",
      status: "approved",
      triageLevel: "routine",
      triageTitle: "Routine Triage",
      soapSubjective: "Patient reports tension headache.",
      soapObjective: "Vitals normal.",
      soapAssessment: "Clinical evaluation in progress. Differential diagnosis deferred.",
      soapPlan: "Supportive care.",
      approvedAt: "2026-10-20T05:34:42.000Z",
      approvedBy: "Legacy User",
    };

    const evalResult = evaluateClinicalFinalization(legacyProvisionalSoap);
    assert.equal(evalResult.isFinal, false, "Must be rejected due to deferred differential diagnosis");

    const bundle = generateFHIRBundle(legacyProvisionalSoap);
    const composition = bundle.entry.find((e: any) => e.resource.resourceType === "Composition")?.resource;
    assert.ok(composition);
    assert.equal(composition!.status, "preliminary");
    assert.equal(composition!.attester, undefined);
  });

  it("3. Signed M6 artifact qualifies as authoritative final with professional attester", () => {
    const modernSignedRecord: ConsultationRecordFHIR = {
      id: "ENC-M6-SIGNED-03",
      patientName: "Test Patient",
      status: "approved",
      triageLevel: "priority",
      triageTitle: "Priority Cardiac Evaluation",
      esiScore: 3,
      hasSignedArtifact: true,
      signingAttestationDigest: "a".repeat(64),
      soapSubjective: "Patient presents with exertional angina relieved by rest.",
      soapObjective: "BP 138/86, HR 78 bpm, SpO2 98%. ECG unremarkable.",
      soapAssessment: "Atypical angina pectoris. Recommend outpatient stress echocardiogram.",
      soapPlan: "1. Outpatient cardiology referral within 72h.\n2. Sublingual nitroglycerin PRN.",
      approvedAt: "2026-10-25T10:00:00.000Z",
      approvedBy: "Dr. Sarah Chen, MD",
      doctorId: "dr-sarah-chen",
      doctorName: "Dr. Sarah Chen, MD",
    };

    const evalResult = evaluateClinicalFinalization(modernSignedRecord);
    assert.equal(evalResult.isFinal, true, "Signed artifact must be evaluated as final");
    assert.equal(evalResult.source, "signed_artifact");
    assert.equal(evalResult.attesterEligible, true);

    const bundle = generateFHIRBundle(modernSignedRecord);
    const composition = bundle.entry.find((e: any) => e.resource.resourceType === "Composition")?.resource;
    assert.ok(composition);
    assert.equal(composition!.status, "final", "Composition status must be final");
    assert.ok(composition!.attester && composition!.attester.length > 0, "Attester block must exist");
    assert.equal(composition!.attester[0].mode, "professional");
    assert.equal(composition!.attester[0].party.reference, "Practitioner/dr-sarah-chen");

    const triageObs = bundle.entry.find((e: any) => e.resource.resourceType === "Observation" && e.resource.id?.includes("esi"))?.resource;
    if (triageObs) {
      assert.equal(triageObs.status, "final", "Triage Observation status must be final");
    }
  });

  it("4. Genuinely completed legacy record qualifies as final under legacy compatibility policy", () => {
    const legacyGenuinelyComplete: ConsultationRecordFHIR = {
      id: "ENC-LEGACY-COMPLETE-04",
      patientName: "Test Patient",
      status: "approved",
      triageLevel: "priority",
      triageTitle: "Priority Orthopedic Evaluation",
      esiScore: 3,
      soapSubjective: "Patient reports twisting right ankle while jogging 4 hours ago with immediate swelling and pain on weight bearing.",
      soapObjective: "Lateral malleolar edema and tenderness. Intact sensation and distal capillary refill <2s.",
      soapAssessment: "Suspected acute right lateral ankle sprain (Grade II). Low likelihood of fracture by Ottawa Ankle Rules.",
      soapPlan: "RICE protocol (Rest, Ice, Compression, Elevation). Weight bearing as tolerated in air-cast splint. Follow-up in 7 days.",
      approvedAt: "2026-09-15T14:30:00.000Z",
      approvedBy: "Dr. Sarah Chen, MD",
      doctorId: "dr-sarah-chen",
      doctorName: "Dr. Sarah Chen, MD",
    };

    const evalResult = evaluateClinicalFinalization(legacyGenuinelyComplete);
    assert.equal(evalResult.isFinal, true, "Genuinely complete legacy record should be accepted as final");
    assert.equal(evalResult.source, "legacy_completed");

    const bundle = generateFHIRBundle(legacyGenuinelyComplete);
    const composition = bundle.entry.find((e: any) => e.resource.resourceType === "Composition")?.resource;
    assert.ok(composition);
    assert.equal(composition!.status, "final");
    assert.ok(composition!.attester && composition!.attester.length > 0, "Attester block should be attached for verified complete legacy record");
  });

  it("5. Incomplete, in-progress, or unapproved records NEVER receive final practitioner attestation", () => {
    const unapprovedRecord: ConsultationRecordFHIR = {
      id: "ENC-UNAPPROVED-05",
      patientName: "Test Patient",
      status: "in_progress",
      triageLevel: "routine",
      soapSubjective: "Mild cough for one day.",
      soapAssessment: "Likely early viral illness.",
      soapPlan: "Supportive care.",
    };

    const evalResult = evaluateClinicalFinalization(unapprovedRecord);
    assert.equal(evalResult.isFinal, false);
    assert.equal(evalResult.attesterEligible, false);

    const bundle = generateFHIRBundle(unapprovedRecord);
    const composition = bundle.entry.find((e: any) => e.resource.resourceType === "Composition")?.resource;
    assert.ok(composition);
    assert.equal(composition!.status, "preliminary");
    assert.equal(composition!.attester, undefined, "Unapproved record must not have an attester");
  });

  // ==========================================================================
  // PART 2: Verification Route Clinician Identity Mapping & RBAC Invariants
  // ==========================================================================

  const testConsultId = `ENC-VERIFY-RBAC-${Date.now()}`;
  const testConsultIdFallback = `ENC-VERIFY-FALLBACK-${Date.now()}`;
  const testConsultIdUnassigned = `ENC-VERIFY-UNASSIGNED-${Date.now()}`;
  const ownerPatientId = `patient-owner-${Date.now()}`;

  // Seed test consultation into memory store with physician profile doctorId
  memoryConsultations.push({
    id: testConsultId,
    userId: ownerPatientId,
    patientName: "Arthur Dent",
    doctorId: "dr-sarah-chen", // Physician profile ID
    doctorName: "Dr. Sarah Chen, MD",
    specialty: "Interventional Cardiology",
    chiefComplaint: "Substernal chest tightness",
    status: "in_progress",
    triageLevel: "priority",
    caseVersion: 1,
  } as any);

  // Seed test consultation where doctorId was recorded as Clerk userId
  memoryConsultations.push({
    id: testConsultIdFallback,
    userId: ownerPatientId,
    patientName: "Ford Prefect",
    doctorId: "clerk_user_clinician_fallback", // Clerk user ID recorded as doctorId
    doctorName: "Dr. Fallback Clinician, MD",
    specialty: "General Practice",
    chiefComplaint: "Routine checkup",
    status: "in_progress",
    triageLevel: "routine",
    caseVersion: 1,
  } as any);

  // Seed test consultation with unassigned doctor
  memoryConsultations.push({
    id: testConsultIdUnassigned,
    userId: ownerPatientId,
    patientName: "Tricia McMillan",
    doctorId: null, // No assigned clinician
    doctorName: null,
    specialty: null,
    chiefComplaint: "Persistent headache",
    status: "in_progress",
    triageLevel: "routine",
    caseVersion: 1,
  } as any);

  it("6. Correctly assigned clinician using physician profile ID (auth.doctorId) is authorized", async () => {
    const req = new Request(`http://localhost:3000/api/consultations/${testConsultId}/verify`, {
      method: "GET",
      headers: {
        "x-test-harness-secret": DEFAULT_INTERNAL_TEST_SECRET,
        "x-mock-role": "clinician",
        "x-mock-user-id": "clerk_user_clinician_789", // Clerk user ID differs from physician profile ID
        "x-mock-doctor-id": "dr-sarah-chen", // Matched physician profile ID
      },
    });

    const res = await verifyGet(req, { params: Promise.resolve({ id: testConsultId }) });
    assert.equal(res.status, 200, "Assigned clinician with matching profile ID must be authorized (200)");
    const data = await res.json();
    assert.equal(data.success, true);
  });

  it("7. Correctly assigned clinician using userId fallback is authorized", async () => {
    const req = new Request(`http://localhost:3000/api/consultations/${testConsultIdFallback}/verify`, {
      method: "GET",
      headers: {
        "x-test-harness-secret": DEFAULT_INTERNAL_TEST_SECRET,
        "x-mock-role": "clinician",
        "x-mock-user-id": "clerk_user_clinician_fallback", // Matches record.doctorId
        // auth.doctorId is omitted/undefined
      },
    });

    const res = await verifyGet(req, { params: Promise.resolve({ id: testConsultIdFallback }) });
    assert.equal(res.status, 200, "Assigned clinician matching record.doctorId via userId fallback must be authorized (200)");
    const data = await res.json();
    assert.equal(data.success, true);
  });

  it("8. Wrong clinician is denied (403 FORBIDDEN)", async () => {
    const req = new Request(`http://localhost:3000/api/consultations/${testConsultId}/verify`, {
      method: "GET",
      headers: {
        "x-test-harness-secret": DEFAULT_INTERNAL_TEST_SECRET,
        "x-mock-role": "clinician",
        "x-mock-user-id": "clerk_user_clinician_999",
        "x-mock-doctor-id": "dr-marcus-vance", // Different doctor
      },
    });

    const res = await verifyGet(req, { params: Promise.resolve({ id: testConsultId }) });
    assert.equal(res.status, 403, "Wrong clinician must be denied (403)");
    const data = await res.json();
    assert.equal(data.code, "FORBIDDEN");
  });

  it("9. Unassigned clinician is denied (403 FORBIDDEN)", async () => {
    const req = new Request(`http://localhost:3000/api/consultations/${testConsultIdUnassigned}/verify`, {
      method: "GET",
      headers: {
        "x-test-harness-secret": DEFAULT_INTERNAL_TEST_SECRET,
        "x-mock-role": "clinician",
        "x-mock-user-id": "clerk_user_clinician_any",
        "x-mock-doctor-id": "dr-any-physician",
      },
    });

    const res = await verifyGet(req, { params: Promise.resolve({ id: testConsultIdUnassigned }) });
    assert.equal(res.status, 403, "Unassigned clinician on unassigned record must be denied (403)");
    const data = await res.json();
    assert.equal(data.code, "FORBIDDEN");
  });

  it("10. Fallback cannot introduce authorization bypass via identity mismatch", async () => {
    // Clinician trying to access record with doctorId="dr-sarah-chen", but clinician's userId="dr-marcus-vance"
    const req = new Request(`http://localhost:3000/api/consultations/${testConsultId}/verify`, {
      method: "GET",
      headers: {
        "x-test-harness-secret": DEFAULT_INTERNAL_TEST_SECRET,
        "x-mock-role": "clinician",
        "x-mock-user-id": "dr-marcus-vance", // Mismatched userId
        "x-mock-doctor-id": "dr-marcus-vance", // Mismatched doctorId
      },
    });

    const res = await verifyGet(req, { params: Promise.resolve({ id: testConsultId }) });
    assert.equal(res.status, 403, "Mismatched clinician credentials must be strictly denied (403)");
  });

  it("11. Admin without explicit audit permission is denied (403 FORBIDDEN)", async () => {
    const adminReq = new Request(`http://localhost:3000/api/consultations/${testConsultId}/verify`, {
      method: "GET",
      headers: {
        "x-test-harness-secret": DEFAULT_INTERNAL_TEST_SECRET,
        "x-mock-role": "admin",
        "x-mock-user-id": "platform-admin-unprivileged",
        "x-mock-permissions": "analytics:read,consultations:approve", // Lacks audit:verify, audit:read, system:read
      },
    });

    const adminRes = await verifyGet(adminReq, { params: Promise.resolve({ id: testConsultId }) });
    assert.equal(adminRes.status, 403, "Admin without explicit audit permission must be denied (403)");
    const data = await adminRes.json();
    assert.equal(data.code, "FORBIDDEN");
  });

  it("12. Admin with required explicit audit permission (audit:verify) is authorized (200)", async () => {
    const adminReq = new Request(`http://localhost:3000/api/consultations/${testConsultId}/verify`, {
      method: "GET",
      headers: {
        "x-test-harness-secret": DEFAULT_INTERNAL_TEST_SECRET,
        "x-mock-role": "admin",
        "x-mock-user-id": "platform-admin-01",
        "x-mock-permissions": "audit:verify,system:read",
      },
    });

    const adminRes = await verifyGet(adminReq, { params: Promise.resolve({ id: testConsultId }) });
    assert.equal(adminRes.status, 200, "Platform admin with audit:verify must be authorized (200)");
  });

  it("13. Demo mode access cannot reach real patient records", async () => {
    const demoReq = new Request(`http://localhost:3000/api/consultations/${testConsultId}/verify`, {
      method: "GET",
      headers: {
        "x-test-harness-secret": DEFAULT_INTERNAL_TEST_SECRET,
        "x-mock-role": "patient",
        "x-mock-user-id": "unauthenticated", // Demo caller
      },
    });

    const demoRes = await verifyGet(demoReq, { params: Promise.resolve({ id: testConsultId }) });
    assert.ok(
      demoRes.status === 401 || demoRes.status === 403,
      `Demo caller without valid owner match must fail closed with 401 or 403 (got ${demoRes.status})`
    );
  });
});
