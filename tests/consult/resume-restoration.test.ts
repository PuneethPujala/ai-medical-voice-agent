import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_INTERNAL_TEST_SECRET } from "@/lib/auth/rbac";

(process.env as Record<string, string | undefined>).NODE_ENV = "test";
process.env.INTERNAL_TEST_SECRET = DEFAULT_INTERNAL_TEST_SECRET;

import {
  migrateInterviewState,
  CURRENT_INTERVIEW_STATE_SCHEMA_VERSION,
  extractRecoverableClinicalData,
} from "@/lib/triage/interview-state-migration";
import { GET as getConsultationById, PATCH as patchConsultationById } from "@/app/api/consultations/[id]/route";
import { POST as createConsultation } from "@/app/api/consultations/route";

function makePatientHeaders(userId: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-test-harness-secret": DEFAULT_INTERNAL_TEST_SECRET,
    "x-mock-role": "patient",
    "x-mock-user-id": userId,
  };
}

function makeClinicianHeaders(userId: string = "dr-sarah-chen"): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-test-harness-secret": DEFAULT_INTERNAL_TEST_SECRET,
    "x-mock-role": "clinician",
    "x-mock-user-id": userId,
  };
}

describe("Consultation Resume & Versioned Interview-State Migration Invariants", () => {
  const patientA = `patient-resume-test-${Date.now()}`;
  const patientB = `patient-attacker-${Date.now()}`;
  const encounterId = `ENC-RESUME-MIGRATION-${Date.now()}`;
  const signedEncounterId = `ENC-RESUME-SIGNED-${Date.now()}`;

  // ============================================================================
  // UNIT TESTS: Interview State Migration Engine
  // ============================================================================
  it("1. Current-version (v2) state restores with status 'unchanged' and no modifications", () => {
    const v2State = {
      schemaVersion: 2,
      phase: "active_inquiring",
      informationState: "insufficient",
      caseVersion: 2,
      slots: {
        onset: "2 hours ago",
        associated_symptoms: ["sweating", "nausea"],
        neurological_signs: [],
        pediatric_signs: [],
        known_facts: [],
      },
      pendingQuestion: null,
      agentRequests: [],
      resolvedQuestions: [],
      domainSufficiency: {
        general: { status: "gathering", missing: ["character"] },
        cardiology: { status: "gathering", missing: ["radiation"] },
        neurology: { status: "inactive", missing: [] },
        pediatrics: { status: "inactive", missing: [] },
      },
      cumulativeTranscript: "Patient reports sudden onset symptoms.",
      structuredHistory: {
        chiefComplaint: "Substernal chest tightness",
        timeline: { duration: "2 hours" },
        unansweredDimensions: ["character"],
        patientCorrections: [],
        patientQuestions: [],
        recentDoctorReplies: [],
        turnCount: 3,
      },
      attributedFacts: [],
      unmappedObservations: [],
      deliveredTurnRecords: [],
    };

    const result = migrateInterviewState(v2State);
    assert.strictEqual(result.status, "unchanged");
    assert.strictEqual(result.targetVersion, CURRENT_INTERVIEW_STATE_SCHEMA_VERSION);
    assert.strictEqual(result.state?.slots.onset, "2 hours ago");
    assert.deepStrictEqual(result.state?.slots.associated_symptoms, ["sweating", "nausea"]);
  });

  it("2. Supported older version (v1) migrates correctly to v2, populating missing collections", () => {
    const v1State = {
      schemaVersion: 1,
      phase: "active_inquiring",
      informationState: "insufficient",
      caseVersion: 1,
      slots: {
        onset: "yesterday",
        associated_symptoms: ["cough"],
      },
      // v1 lacks structuredHistory, attributedFacts, unmappedObservations, deliveredTurnRecords
      customExperimentalTag: "telemetry_abc_123",
    };

    const result = migrateInterviewState(v1State);
    assert.strictEqual(result.status, "migrated");
    assert.strictEqual(result.sourceVersion, 1);
    assert.strictEqual(result.targetVersion, CURRENT_INTERVIEW_STATE_SCHEMA_VERSION);
    assert.ok(result.state?.structuredHistory, "Must populate structuredHistory");
    assert.ok(Array.isArray(result.state?.attributedFacts), "Must initialize attributedFacts array");
    assert.ok(Array.isArray(result.state?.deliveredTurnRecords), "Must initialize deliveredTurnRecords array");
    assert.strictEqual((result.state as any)?._unrecognizedFields?.customExperimentalTag, "telemetry_abc_123", "Must preserve unrecognized experimental keys");
  });

  it("3. Unversioned legacy (v0) state migrates through legacy compatibility path", () => {
    const v0Legacy = {
      // Missing schemaVersion and version tags completely
      phase: "active_inquiring",
      slots: {
        onset: "3 days ago",
      },
      cumulativeTranscript: "Initial discussion about knee pain.",
    };

    const result = migrateInterviewState(v0Legacy);
    assert.strictEqual(result.status, "migrated");
    assert.strictEqual(result.sourceVersion, 0);
    assert.strictEqual(result.targetVersion, CURRENT_INTERVIEW_STATE_SCHEMA_VERSION);
    assert.strictEqual(result.state?.slots.onset, "3 days ago");
    assert.ok(Array.isArray(result.state?.slots.associated_symptoms));
    assert.ok(result.state?.domainSufficiency);
  });

  it("4. Future / unsupported version (v3) is NOT downgraded or overwritten", () => {
    const futureV3State = {
      schemaVersion: 3,
      futureField: "advanced_quantum_triage",
      chiefComplaint: "Future diagnostic query",
      transcript: [{ role: "patient", text: "Future turn record", timestamp: "12:00 PM" }],
    };

    const result = migrateInterviewState(futureV3State);
    assert.strictEqual(result.status, "unsupported_version");
    assert.strictEqual(result.sourceVersion, 3);
    assert.strictEqual(result.state, null, "Must not return mutated state for unsupported future version");
    assert.strictEqual(result.error, "FUTURE_SCHEMA_VERSION_UNSUPPORTED");
    assert.strictEqual(result.recoverableData?.chiefComplaint, "Future diagnostic query");
    assert.strictEqual(result.recoverableData?.transcript?.length, 1);
  });

  it("5. Corrupted / malformed state enters safe recovery path without resetting to default intake", () => {
    const corruptedInput = null;
    const result = migrateInterviewState(corruptedInput);
    assert.strictEqual(result.status, "corrupted");
    assert.strictEqual(result.state, null);
    assert.strictEqual(result.error, "CORRUPTED_INTERVIEW_STATE");
  });

  it("6. Migration failure preserves recoverable clinical data (symptoms, facts, turns)", () => {
    const malformedStateWithData = {
      version: 99, // unsupported future
      slots: {
        chiefComplaint: "Severe migraine with photophobia",
        associated_symptoms: ["Photophobia", "Nausea", "Visual aura"],
      },
      transcript: [
        { role: "doctor", text: "When did the headache begin?", timestamp: "10:00 AM" },
        { role: "patient", text: "About three hours ago.", timestamp: "10:01 AM" },
      ],
      attributedFacts: [
        { factId: "fact-1", concept: "photophobia", reportedValue: "true" },
      ],
    };

    const recoverable = extractRecoverableClinicalData(malformedStateWithData);
    assert.strictEqual(recoverable.chiefComplaint, "Severe migraine with photophobia");
    assert.strictEqual(recoverable.detectedSymptoms?.length, 3);
    assert.strictEqual(recoverable.transcript?.length, 2);
    assert.strictEqual(recoverable.attributedFacts?.length, 1);
  });

  // ============================================================================
  // INTEGRATION TESTS: Consultation Resume Endpoint & State Machine Protections
  // ============================================================================
  it("7. Seed: Creates paused consultation for resumption testing", async () => {
    const payload = {
      id: encounterId,
      patientName: "Resume Test Patient",
      doctorId: "dr-sarah-chen",
      doctorName: "Dr. Sarah Chen, MD",
      specialty: "Interventional Cardiology",
      chiefComplaint: "Mild exertional shortness of breath",
      status: "paused",
      durationSeconds: 120,
      transcript: [
        { role: "doctor", text: "Hello, what symptoms are you having?", timestamp: "10:00 AM" },
        { role: "patient", text: "Shortness of breath when climbing stairs.", timestamp: "10:01 AM" },
      ],
      interviewState: {
        schemaVersion: 1, // Will be migrated on resume
        phase: "active_inquiring",
        slots: {
          onset: "2 days ago",
          associated_symptoms: ["mild dyspnea"],
        },
      },
      caseVersion: 1,
    };

    const req = new Request("http://localhost:3000/api/consultations", {
      method: "POST",
      headers: makePatientHeaders(patientA),
      body: JSON.stringify(payload),
    });

    const res = await createConsultation(req);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.consultation.status, "paused");
    assert.strictEqual(data.consultation.caseVersion, 1);
  });

  it("8. Resuming paused consultation retrieves identical encounter ID, caseVersion, and migrated state", async () => {
    const req = new Request(`http://localhost:3000/api/consultations/${encounterId}`, {
      method: "GET",
      headers: makePatientHeaders(patientA),
    });

    const res = await getConsultationById(req, { params: Promise.resolve({ id: encounterId }) });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.consultation.id, encounterId, "Encounter ID must match exactly");
    assert.strictEqual(data.consultation.caseVersion, 1);
    assert.strictEqual(data.consultation.status, "paused");
    assert.strictEqual(data.consultation.transcript.length, 2);

    // Verify migration on resume
    const migration = migrateInterviewState(data.consultation.interviewState);
    assert.strictEqual(migration.status, "migrated");
    assert.strictEqual(migration.targetVersion, CURRENT_INTERVIEW_STATE_SCHEMA_VERSION);
  });

  it("9. Clinician-signed encounter locks against resumption", async () => {
    // 1. Create completed encounter
    const payload = {
      id: signedEncounterId,
      patientName: "Signed Patient",
      doctorId: "dr-sarah-chen",
      doctorName: "Dr. Sarah Chen, MD",
      specialty: "Interventional Cardiology",
      chiefComplaint: "Resolved palpitations",
      status: "completed_pending_review",
      soapSubjective: "Patient reports past palpitations, now resolved.",
      soapObjective: "Normal ECG.",
      soapAssessment: "Benign palpitations.",
      soapPlan: "Follow up as needed.",
      caseVersion: 1,
      transcript: [{ role: "doctor", text: "Exam complete.", timestamp: "11:00 AM" }],
    };

    const createReq = new Request("http://localhost:3000/api/consultations", {
      method: "POST",
      headers: makePatientHeaders(patientA),
      body: JSON.stringify(payload),
    });
    const createRes = await createConsultation(createReq);
    assert.strictEqual(createRes.status, 200);

    // 2. Clinician signs encounter
    const patchReq = new Request(`http://localhost:3000/api/consultations/${signedEncounterId}`, {
      method: "PATCH",
      headers: makeClinicianHeaders("dr-sarah-chen"),
      body: JSON.stringify({
        action: "approve",
        status: "approved",
      }),
    });
    const patchRes = await patchConsultationById(patchReq, { params: Promise.resolve({ id: signedEncounterId }) });
    assert.strictEqual(patchRes.status, 200);
    const approvedData = await patchRes.json();
    assert.strictEqual(approvedData.consultation.status, "approved");

    // 3. Attempting to resume or modify approved record returns 409
    const resumeAttemptReq = new Request(`http://localhost:3000/api/consultations/${signedEncounterId}`, {
      method: "PATCH",
      headers: makePatientHeaders(patientA),
      body: JSON.stringify({
        status: "paused",
        caseVersion: 1,
      }),
    });
    const resumeRes = await patchConsultationById(resumeAttemptReq, { params: Promise.resolve({ id: signedEncounterId }) });
    assert.strictEqual(resumeRes.status, 409, "Must return 409 STATUS_CONFLICT on attempt to resume signed encounter");
  });

  it("10. IDOR Protection: Patient B cannot access Patient A's consultation for resume (403)", async () => {
    const req = new Request(`http://localhost:3000/api/consultations/${encounterId}`, {
      method: "GET",
      headers: makePatientHeaders(patientB),
    });

    const res = await getConsultationById(req, { params: Promise.resolve({ id: encounterId }) });
    assert.strictEqual(res.status, 403, "Non-owner patient must be denied access with 403");
  });

  it("11. Concurrency Conflict: Two simultaneous resume sessions updating from caseVersion 1 yield one success and one 409", async () => {
    // Session 1 updates with expectedVersion: 1 -> advances to version 2
    const session1Req = new Request(`http://localhost:3000/api/consultations/${encounterId}`, {
      method: "PATCH",
      headers: makePatientHeaders(patientA),
      body: JSON.stringify({
        expectedVersion: 1,
        durationSeconds: 150,
      }),
    });

    const session1Res = await patchConsultationById(session1Req, { params: Promise.resolve({ id: encounterId }) });
    assert.strictEqual(session1Res.status, 200, "Session 1 must succeed");
    const session1Data = await session1Res.json();
    assert.strictEqual(session1Data.consultation.caseVersion, 2);

    // Session 2 (stale) tries to update with expectedVersion: 1 -> 409 CONCURRENCY_CONFLICT
    const session2Req = new Request(`http://localhost:3000/api/consultations/${encounterId}`, {
      method: "PATCH",
      headers: makePatientHeaders(patientA),
      body: JSON.stringify({
        expectedVersion: 1,
        durationSeconds: 160,
      }),
    });

    const session2Res = await patchConsultationById(session2Req, { params: Promise.resolve({ id: encounterId }) });
    assert.strictEqual(session2Res.status, 409, "Session 2 must receive 409 CONCURRENCY_CONFLICT");
    const session2Data = await session2Res.json();
    assert.strictEqual(session2Data.code, "CONCURRENCY_CONFLICT");
  });
});
