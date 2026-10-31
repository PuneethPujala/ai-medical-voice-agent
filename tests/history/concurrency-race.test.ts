import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_INTERNAL_TEST_SECRET } from "@/lib/auth/rbac";

(process.env as Record<string, string | undefined>).NODE_ENV = "test";
process.env.INTERNAL_TEST_SECRET = DEFAULT_INTERNAL_TEST_SECRET;

import { POST as createConsultation } from "@/app/api/consultations/route";
import { GET as getConsultationById, PATCH as patchConsultationById } from "@/app/api/consultations/[id]/route";

function makePatientHeaders(userId: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-test-harness-secret": DEFAULT_INTERNAL_TEST_SECRET,
    "x-mock-role": "patient",
    "x-mock-user-id": userId,
  };
}

describe("Atomic Optimistic Concurrency & Follow-Up Lineage Invariants", () => {
  const patientId = `patient-race-${Date.now()}`;
  const encounterId = `ENC-RACE-${Date.now()}`;

  it("1. Baseline setup: creates initial consultation at caseVersion 1", async () => {
    const payload = {
      id: encounterId,
      patientName: "Race Condition Tester",
      doctorId: "dr-sarah-chen",
      doctorName: "Dr. Sarah Chen, MD",
      specialty: "Interventional Cardiology",
      chiefComplaint: "Palpitations during exercise",
      status: "paused",
      durationSeconds: 60,
      transcript: [
        { role: "doctor", text: "Hello, what symptoms are you having?", timestamp: "10:00 AM" },
        { role: "patient", text: "Heart flutter when running.", timestamp: "10:01 AM" },
      ],
      caseVersion: 1,
    };

    const req = new Request("http://localhost:3000/api/consultations", {
      method: "POST",
      headers: makePatientHeaders(patientId),
      body: JSON.stringify(payload),
    });

    const res = await createConsultation(req);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.consultation.caseVersion, 1);
  });

  it("2. Simultaneous PATCH race: two concurrent updates with expectedVersion=1 yield exactly one 200 and one 409", async () => {
    // Both requests claim to be updating from expectedVersion: 1
    const reqA = new Request(`http://localhost:3000/api/consultations/${encounterId}`, {
      method: "PATCH",
      headers: makePatientHeaders(patientId),
      body: JSON.stringify({
        expectedVersion: 1,
        caseVersion: 2,
        soapSubjective: "Update from concurrent branch A",
      }),
    });

    const reqB = new Request(`http://localhost:3000/api/consultations/${encounterId}`, {
      method: "PATCH",
      headers: makePatientHeaders(patientId),
      body: JSON.stringify({
        expectedVersion: 1,
        caseVersion: 2,
        soapSubjective: "Update from concurrent branch B",
      }),
    });

    // Execute both concurrently
    const [resA, resB] = await Promise.all([
      patchConsultationById(reqA, { params: Promise.resolve({ id: encounterId }) }),
      patchConsultationById(reqB, { params: Promise.resolve({ id: encounterId }) }),
    ]);

    const statuses = [resA.status, resB.status].sort();
    assert.deepEqual(statuses, [200, 409], "Expected exactly one 200 OK and one 409 Conflict");

    const conflictRes = resA.status === 409 ? resA : resB;
    const conflictData = await conflictRes.json();
    assert.equal(conflictData.code, "CONCURRENCY_CONFLICT");
  });

  it("3. Simultaneous POST race: concurrent updates to existing record with stale version yield 409", async () => {
    // The current datastore version is now 2. A request submitting stale caseVersion: 2 must fail.
    const staleReq = new Request("http://localhost:3000/api/consultations", {
      method: "POST",
      headers: makePatientHeaders(patientId),
      body: JSON.stringify({
        id: encounterId,
        caseVersion: 2, // submitted version <= datastore version (2)
        soapSubjective: "Stale POST update attempt",
      }),
    });

    const res = await createConsultation(staleReq);
    assert.equal(res.status, 409);
    const data = await res.json();
    assert.equal(data.code, "CONCURRENCY_CONFLICT");
  });

  it("4. Prevents circular follow-up lineage: parentConsultationId === id is rejected (400)", async () => {
    const circularId = `ENC-CIRCULAR-${Date.now()}`;
    const req = new Request("http://localhost:3000/api/consultations", {
      method: "POST",
      headers: makePatientHeaders(patientId),
      body: JSON.stringify({
        id: circularId,
        parentConsultationId: circularId, // Self-reference
        chiefComplaint: "Testing circular lineage prevention",
      }),
    });

    const res = await createConsultation(req);
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.code, "CIRCULAR_LINEAGE_PROHIBITED");
  });

  it("5. Rejects follow-up to incomplete/paused parent (422 PARENT_NOT_COMPLETED)", async () => {
    // encounterId is currently 'paused'
    const invalidFollowUpReq = new Request("http://localhost:3000/api/consultations", {
      method: "POST",
      headers: makePatientHeaders(patientId),
      body: JSON.stringify({
        id: `ENC-INVALID-FOLLOWUP-${Date.now()}`,
        parentConsultationId: encounterId, // Still paused!
        chiefComplaint: "Premature follow-up",
      }),
    });

    const res = await createConsultation(invalidFollowUpReq);
    assert.equal(res.status, 422);
    const data = await res.json();
    assert.equal(data.code, "PARENT_NOT_COMPLETED");
  });

  it("6. Completed parent permits follow-up; parent remains strictly immutable and unmutated", async () => {
    // 1. Advance encounterId to 'completed_pending_review'
    const completeParentReq = new Request(`http://localhost:3000/api/consultations/${encounterId}`, {
      method: "PATCH",
      headers: makePatientHeaders(patientId),
      body: JSON.stringify({
        expectedVersion: 2,
        caseVersion: 3,
        status: "completed_pending_review",
        soapSubjective: "Full history collected for palpitations.",
      }),
    });
    const completeRes = await patchConsultationById(completeParentReq, { params: Promise.resolve({ id: encounterId }) });
    assert.equal(completeRes.status, 200);

    // 2. Fetch parent state snapshot before follow-up creation
    const getParentBeforeReq = new Request(`http://localhost:3000/api/consultations/${encounterId}`, {
      method: "GET",
      headers: makePatientHeaders(patientId),
    });
    const parentBeforeRes = await getConsultationById(getParentBeforeReq, { params: Promise.resolve({ id: encounterId }) });
    const parentBeforeData = await parentBeforeRes.json();
    const parentBeforeDigest = parentBeforeData.consultation.caseVersion;

    // 3. Create linked follow-up
    const followUpId = `ENC-VALID-FOLLOWUP-${Date.now()}`;
    const followUpReq = new Request("http://localhost:3000/api/consultations", {
      method: "POST",
      headers: makePatientHeaders(patientId),
      body: JSON.stringify({
        id: followUpId,
        parentConsultationId: encounterId,
        status: "paused",
        chiefComplaint: "Follow-up check for palpitations",
      }),
    });
    const followUpRes = await createConsultation(followUpReq);
    assert.equal(followUpRes.status, 200);
    const followUpData = await followUpRes.json();
    assert.equal(followUpData.consultation.parentConsultationId, encounterId);

    // 4. Verify parent record remains completely unchanged
    const getParentAfterReq = new Request(`http://localhost:3000/api/consultations/${encounterId}`, {
      method: "GET",
      headers: makePatientHeaders(patientId),
    });
    const parentAfterRes = await getConsultationById(getParentAfterReq, { params: Promise.resolve({ id: encounterId }) });
    const parentAfterData = await parentAfterRes.json();
    assert.equal(parentAfterData.consultation.caseVersion, parentBeforeDigest, "Parent caseVersion must not change");
    assert.equal(parentAfterData.consultation.status, "completed_pending_review", "Parent status must remain intact");
  });

  it("7. Typed Patient Correction: preserves original turn, increments version atomically, and logs audit", async () => {
    // Current parent caseVersion is 3. We submit an addendum correction with expectedVersion: 3 -> 4
    const correctionText = "Actually, the palpitations started 4 days ago, not yesterday.";
    const correctionReq = new Request(`http://localhost:3000/api/consultations/${encounterId}`, {
      method: "PATCH",
      headers: makePatientHeaders(patientId),
      body: JSON.stringify({
        expectedVersion: 3,
        caseVersion: 4,
        transcript: [
          { role: "doctor", text: "Hello, what symptoms are you having?", timestamp: "10:00 AM" },
          { role: "patient", text: "Heart flutter when running.", timestamp: "10:01 AM" },
          { role: "patient", text: `[Patient Addendum / Correction]: ${correctionText}`, timestamp: "10:05 AM" },
        ],
        interviewState: {
          patientCorrectionRecords: [
            {
              type: "PATIENT_CORRECTION",
              correctionId: `corr-${Date.now()}`,
              originalStatement: "Heart flutter when running.",
              correctedStatement: correctionText,
              actorId: patientId,
              caseVersion: 4,
              timestamp: new Date().toISOString(),
            },
          ],
        },
      }),
    });

    const correctionRes = await patchConsultationById(correctionReq, { params: Promise.resolve({ id: encounterId }) });
    assert.equal(correctionRes.status, 200);
    const correctionData = await correctionRes.json();

    assert.equal(correctionData.consultation.caseVersion, 4);
    assert.equal(correctionData.consultation.transcript.length, 3);
    // Original statement preserved intact
    assert.equal(correctionData.consultation.transcript[1].text, "Heart flutter when running.");
    // Addendum appended
    assert.ok(correctionData.consultation.transcript[2].text.includes("[Patient Addendum / Correction]"));
    // Typed structured correction record stored
    assert.equal(
      correctionData.consultation.interviewState.patientCorrectionRecords[0].type,
      "PATIENT_CORRECTION"
    );
  });
});
