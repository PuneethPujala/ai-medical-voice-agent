import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_INTERNAL_TEST_SECRET } from "@/lib/auth/rbac";

(process.env as Record<string, string | undefined>).NODE_ENV = "test";
process.env.INTERNAL_TEST_SECRET = DEFAULT_INTERNAL_TEST_SECRET;

import { POST as createConsultation } from "@/app/api/consultations/route";
import { GET as getConsultationById } from "@/app/api/consultations/[id]/route";

function makePatientHeaders(userId: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-test-harness-secret": DEFAULT_INTERNAL_TEST_SECRET,
    "x-mock-role": "patient",
    "x-mock-user-id": userId,
  };
}

describe("Linked Follow-Up Consultations & Lineage Invariants", () => {
  const patientA = `patient-followup-owner-${Date.now()}`;
  const patientB = `patient-followup-intruder-${Date.now()}`;
  const parentId = `ENC-PARENT-COMPLETED-${Date.now()}`;
  const pausedParentId = `ENC-PARENT-PAUSED-${Date.now()}`;
  const followUpId = `ENC-FOLLOWUP-NEW-${Date.now()}`;

  it("1. Setup: Creates completed parent consultation and paused encounter for patient A", async () => {
    // 1. Completed parent consultation
    const completedParent = {
      id: parentId,
      patientName: "Lineage Test Patient",
      doctorId: "dr-sarah-chen",
      doctorName: "Dr. Sarah Chen, MD",
      specialty: "Interventional Cardiology",
      chiefComplaint: "Resolved chest tightness after initial nitroglycerin",
      status: "completed_pending_review",
      soapSubjective: "Initial symptoms controlled.",
      soapObjective: "Baseline ECG normal.",
      soapAssessment: "Atypical angina.",
      soapPlan: "Schedule follow-up stress test.",
      caseVersion: 1,
      durationSeconds: 300,
      transcript: [
        { role: "doctor", text: "How is your chest feeling now?", timestamp: "10:00 AM" },
        { role: "patient", text: "Much better after resting.", timestamp: "10:01 AM" },
      ],
    };

    const res1 = await createConsultation(
      new Request("http://localhost:3000/api/consultations", {
        method: "POST",
        headers: makePatientHeaders(patientA),
        body: JSON.stringify(completedParent),
      })
    );
    assert.strictEqual(res1.status, 200, "Should create completed parent encounter");

    // 2. Paused encounter (ineligible for follow-up)
    const pausedParent = {
      id: pausedParentId,
      patientName: "Lineage Test Patient",
      doctorId: "dr-sarah-chen",
      doctorName: "Dr. Sarah Chen, MD",
      specialty: "Interventional Cardiology",
      chiefComplaint: "Incomplete intake",
      status: "paused",
      caseVersion: 1,
      transcript: [{ role: "doctor", text: "Hello", timestamp: "10:00 AM" }],
    };

    const res2 = await createConsultation(
      new Request("http://localhost:3000/api/consultations", {
        method: "POST",
        headers: makePatientHeaders(patientA),
        body: JSON.stringify(pausedParent),
      })
    );
    assert.strictEqual(res2.status, 200, "Should create paused encounter");
  });

  it("2. Creates linked follow-up with distinct ID and relational link to parent", async () => {
    const followUpPayload = {
      id: followUpId,
      parentConsultationId: parentId,
      patientName: "Lineage Test Patient",
      doctorId: "dr-sarah-chen",
      doctorName: "Dr. Sarah Chen, MD",
      specialty: "Interventional Cardiology",
      chiefComplaint: "Follow-up visit for cardiology checkup after stress test",
      status: "paused",
      caseVersion: 1,
      transcript: [
        { role: "doctor", text: "Welcome back for your scheduled cardiology follow-up.", timestamp: "02:00 PM" },
      ],
      attributedFacts: [
        {
          factId: "fact-hist-1",
          concept: "baseline_chest_tightness",
          reportedValue: "Resolved after nitroglycerin",
          sourceConsultationId: parentId,
        },
      ],
    };

    const res = await createConsultation(
      new Request("http://localhost:3000/api/consultations", {
        method: "POST",
        headers: makePatientHeaders(patientA),
        body: JSON.stringify(followUpPayload),
      })
    );

    assert.strictEqual(res.status, 200, "Should create linked follow-up");
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.consultation.id, followUpId, "Follow-up must have its own distinct ID");
    assert.notStrictEqual(data.consultation.id, parentId, "Follow-up ID must differ from parent ID");
    assert.strictEqual(data.consultation.parentConsultationId, parentId, "Must store relational parent link");
  });

  it("3. Parent consultation remains strictly unmutated after follow-up is created", async () => {
    const res = await getConsultationById(
      new Request(`http://localhost:3000/api/consultations/${parentId}`, {
        method: "GET",
        headers: makePatientHeaders(patientA),
      }),
      { params: Promise.resolve({ id: parentId }) }
    );

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.consultation.id, parentId);
    assert.strictEqual(data.consultation.status, "completed_pending_review", "Parent status must remain unchanged");
    assert.strictEqual(data.consultation.caseVersion, 1, "Parent caseVersion must remain unchanged");
    assert.strictEqual(data.consultation.transcript.length, 2, "Parent transcript turns must remain unchanged");
  });

  it("4. Carried-forward historical facts are stamped with source: 'parent_encounter'", async () => {
    const res = await getConsultationById(
      new Request(`http://localhost:3000/api/consultations/${followUpId}`, {
        method: "GET",
        headers: makePatientHeaders(patientA),
      }),
      { params: Promise.resolve({ id: followUpId }) }
    );

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    const facts = data.consultation.attributedFacts || [];
    assert.ok(facts.length > 0, "Must contain carried-forward facts");
    const historicalFact = facts.find((f: any) => f.factId === "fact-hist-1");
    assert.ok(historicalFact, "Historical fact must be present");
    assert.strictEqual(historicalFact.source, "parent_encounter", "Must be stamped with source: 'parent_encounter'");
    assert.strictEqual(historicalFact.isHistoricalContext, true, "Must be tagged with isHistoricalContext: true");
  });

  it("5. Rejects follow-up to paused/incomplete parent with 422 PARENT_NOT_COMPLETED", async () => {
    const invalidFollowUp = {
      id: `ENC-INVALID-FOLLOWUP-${Date.now()}`,
      parentConsultationId: pausedParentId,
      doctorId: "dr-sarah-chen",
      doctorName: "Dr. Sarah Chen, MD",
      specialty: "Interventional Cardiology",
      status: "paused",
    };

    const res = await createConsultation(
      new Request("http://localhost:3000/api/consultations", {
        method: "POST",
        headers: makePatientHeaders(patientA),
        body: JSON.stringify(invalidFollowUp),
      })
    );

    assert.strictEqual(res.status, 422, "Follow-up to paused parent must be rejected with 422");
    const data = await res.json();
    assert.strictEqual(data.code, "PARENT_NOT_COMPLETED");
  });

  it("6. Rejects follow-up to non-existent parent with 404 PARENT_NOT_FOUND", async () => {
    const ghostParentId = `ENC-GHOST-PARENT-${Date.now()}`;
    const invalidFollowUp = {
      id: `ENC-FOLLOWUP-GHOST-${Date.now()}`,
      parentConsultationId: ghostParentId,
      doctorId: "dr-sarah-chen",
      doctorName: "Dr. Sarah Chen, MD",
      specialty: "Interventional Cardiology",
      status: "paused",
    };

    const res = await createConsultation(
      new Request("http://localhost:3000/api/consultations", {
        method: "POST",
        headers: makePatientHeaders(patientA),
        body: JSON.stringify(invalidFollowUp),
      })
    );

    assert.strictEqual(res.status, 404, "Follow-up to non-existent parent must return 404");
    const data = await res.json();
    assert.strictEqual(data.code, "PARENT_NOT_FOUND");
  });

  it("7. Cross-tenant isolation: Patient B cannot link a follow-up to Patient A's parent encounter (403)", async () => {
    const maliciousFollowUp = {
      id: `ENC-ATTACKER-FOLLOWUP-${Date.now()}`,
      parentConsultationId: parentId, // Belongs to Patient A!
      doctorId: "dr-sarah-chen",
      doctorName: "Dr. Sarah Chen, MD",
      specialty: "Interventional Cardiology",
      status: "paused",
    };

    const res = await createConsultation(
      new Request("http://localhost:3000/api/consultations", {
        method: "POST",
        headers: makePatientHeaders(patientB),
        body: JSON.stringify(maliciousFollowUp),
      })
    );

    assert.strictEqual(res.status, 403, "Cross-tenant follow-up must be rejected with 403");
  });

  it("8. Lineage validation: Rejects self-referencing (parentConsultationId === id) with 400", async () => {
    const selfRefId = `ENC-SELF-REF-${Date.now()}`;
    const selfRefPayload = {
      id: selfRefId,
      parentConsultationId: selfRefId,
      doctorId: "dr-sarah-chen",
      doctorName: "Dr. Sarah Chen, MD",
      specialty: "Interventional Cardiology",
      status: "paused",
    };

    const res = await createConsultation(
      new Request("http://localhost:3000/api/consultations", {
        method: "POST",
        headers: makePatientHeaders(patientA),
        body: JSON.stringify(selfRefPayload),
      })
    );

    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.code, "CIRCULAR_LINEAGE_PROHIBITED");
  });

  it("9. Idempotency: Retrying follow-up creation returns existing encounter without duplicating", async () => {
    const retryKey = `idem-followup-retry-${Date.now()}`;
    const initialFollowUp = {
      id: `ENC-IDEM-FOLLOWUP-${Date.now()}`,
      parentConsultationId: parentId,
      idempotencyKey: retryKey,
      doctorId: "dr-sarah-chen",
      doctorName: "Dr. Sarah Chen, MD",
      specialty: "Interventional Cardiology",
      chiefComplaint: "Idempotent follow-up test",
      status: "paused",
    };

    const res1 = await createConsultation(
      new Request("http://localhost:3000/api/consultations", {
        method: "POST",
        headers: makePatientHeaders(patientA),
        body: JSON.stringify(initialFollowUp),
      })
    );
    assert.strictEqual(res1.status, 200);

    // Retry with same payload and idempotencyKey
    const res2 = await createConsultation(
      new Request("http://localhost:3000/api/consultations", {
        method: "POST",
        headers: makePatientHeaders(patientA),
        body: JSON.stringify(initialFollowUp),
      })
    );
    assert.strictEqual(res2.status, 200);
    const data2 = await res2.json();
    assert.strictEqual(data2.isIdempotentRetry, true);
    assert.strictEqual(data2.consultation.id, initialFollowUp.id);
  });
});
