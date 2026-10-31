import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_INTERNAL_TEST_SECRET } from "@/lib/auth/rbac";

(process.env as Record<string, string | undefined>).NODE_ENV = "test";
process.env.INTERNAL_TEST_SECRET = DEFAULT_INTERNAL_TEST_SECRET;

import { GET as getConsultations, POST as createConsultation } from "@/app/api/consultations/route";
import { GET as getConsultationById, PATCH as patchConsultationById } from "@/app/api/consultations/[id]/route";
import { GET as verifyConsultation } from "@/app/api/consultations/[id]/verify/route";
import { computeCanonicalConsultationDigest } from "@/lib/audit/audit-logger";

function makePatientHeaders(userId: string = "patient-puneeth-101"): Record<string, string> {
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

describe("Consultation History Hub & Lifecycle Separation Invariants", () => {
  const patientId = `patient-history-user-${Date.now()}`;
  const pausedEncounterId = `ENC-PAUSED-${Date.now()}`;
  const completedEncounterId = `ENC-COMPLETED-${Date.now()}`;
  const followUpEncounterId = `ENC-FOLLOWUP-${Date.now()}`;

  it("1. Saves a paused consultation with 'paused' status and preserves conversation turns", async () => {
    const payload = {
      id: pausedEncounterId,
      patientName: "Puneeth Test",
      doctorId: "dr-sarah-chen",
      doctorName: "Dr. Sarah Chen, MD",
      specialty: "Interventional Cardiology",
      chiefComplaint: "Mild intermittent chest tightness after exercise",
      status: "paused",
      durationSeconds: 95,
      transcript: [
        { role: "doctor", text: "Hello Puneeth, I'm Dr. Sarah Chen. How are you feeling today?", timestamp: "10:00 AM" },
        { role: "patient", text: "I've had this tight feeling in my chest when I jog.", timestamp: "10:01 AM" },
        { role: "doctor", text: "Does the tightness spread anywhere, like your arm or jaw?", timestamp: "10:02 AM" },
      ],
      caseVersion: 1,
    };

    const req = new Request("http://localhost:3000/api/consultations", {
      method: "POST",
      headers: makePatientHeaders(patientId),
      body: JSON.stringify(payload),
    });

    const res = await createConsultation(req);
    assert.strictEqual(res.status, 200, "Should save paused consultation");
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.consultation.status, "paused");
    assert.strictEqual(data.consultation.transcript.length, 3);
    assert.strictEqual(data.consultation.triageLevel, "gathering_history");
  });

  it("2. Blocks premature clinical approval of a paused consultation (422 CANNOT_APPROVE_INCOMPLETE_INTAKE)", async () => {
    const patchReq = new Request(`http://localhost:3000/api/consultations/${pausedEncounterId}`, {
      method: "PATCH",
      headers: makeClinicianHeaders("dr-sarah-chen"),
      body: JSON.stringify({
        action: "approve",
        status: "approved",
      }),
    });

    const res = await patchConsultationById(patchReq, { params: Promise.resolve({ id: pausedEncounterId }) });
    assert.strictEqual(res.status, 422, "Paused consultations cannot be physician-signed before completion");
    const data = await res.json();
    assert.strictEqual(data.code, "CANNOT_APPROVE_INCOMPLETE_INTAKE");
  });

  it("3. Resumes paused consultation: updates turns and increments caseVersion under same encounter ID", async () => {
    const resumedPayload = {
      id: pausedEncounterId,
      patientName: "Puneeth Test",
      doctorId: "dr-sarah-chen",
      doctorName: "Dr. Sarah Chen, MD",
      specialty: "Interventional Cardiology",
      chiefComplaint: "Mild intermittent chest tightness after exercise",
      status: "in_progress",
      durationSeconds: 160,
      caseVersion: 2,
      transcript: [
        { role: "doctor", text: "Hello Puneeth, I'm Dr. Sarah Chen. How are you feeling today?", timestamp: "10:00 AM" },
        { role: "patient", text: "I've had this tight feeling in my chest when I jog.", timestamp: "10:01 AM" },
        { role: "doctor", text: "Does the tightness spread anywhere, like your arm or jaw?", timestamp: "10:02 AM" },
        { role: "doctor", text: "Welcome back. Before we continue, I'd like to check whether anything has changed since our last conversation.", timestamp: "10:15 AM" },
        { role: "patient", text: "No, nothing changed, it only happened during running.", timestamp: "10:16 AM" },
      ],
    };

    const req = new Request("http://localhost:3000/api/consultations", {
      method: "POST",
      headers: makePatientHeaders(patientId),
      body: JSON.stringify(resumedPayload),
    });

    const res = await createConsultation(req);
    assert.strictEqual(res.status, 200, "Should update existing encounter on resume");
    const data = await res.json();
    assert.strictEqual(data.consultation.id, pausedEncounterId, "Must preserve stable encounter ID");
    assert.strictEqual(data.consultation.transcript.length, 5, "Transcript should contain all 5 turns");
  });

  it("4. Distinguishes completed intake with preliminary SOAP draft from un-generated SOAP", async () => {
    const completedPayload = {
      id: completedEncounterId,
      patientName: "Puneeth Test",
      doctorId: "dr-sarah-chen",
      doctorName: "Dr. Sarah Chen, MD",
      specialty: "Interventional Cardiology",
      chiefComplaint: "Exertional chest discomfort without radiation",
      triageLevel: "routine",
      triageTitle: "LEVEL 3: ROUTINE CLINICAL CARE",
      soapSubjective: "Patient reports mild chest tightness strictly provoked by running.",
      soapObjective: "Cardiovascular evaluation via ESI v4 arbiter. No red flags identified at rest.",
      soapAssessment: "Atypical exertional angina vs musculoskeletal strain.",
      soapPlan: "1. Outpatient stress ECG test.\n2. Rest from high-intensity workouts.",
      status: "completed_pending_review",
      durationSeconds: 240,
      transcript: [
        { role: "doctor", text: "Consultation complete.", timestamp: "10:30 AM" },
      ],
      caseVersion: 1,
    };

    const req = new Request("http://localhost:3000/api/consultations", {
      method: "POST",
      headers: makePatientHeaders(patientId),
      body: JSON.stringify(completedPayload),
    });

    const res = await createConsultation(req);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.consultation.status, "completed_pending_review");
    assert.ok(data.consultation.soapSubjective, "Completed consultation has SOAP subjective");
    assert.ok(data.consultation.soapAssessment, "Completed consultation has SOAP assessment");
  });

  it("5. Clinician signs completed consultation; signed consultation locks against modification (409 STATUS_CONFLICT)", async () => {
    // 1. Clinician signs and approves completed intake
    const patchReq = new Request(`http://localhost:3000/api/consultations/${completedEncounterId}`, {
      method: "PATCH",
      headers: makeClinicianHeaders("dr-sarah-chen"),
      body: JSON.stringify({
        action: "approve",
        status: "approved",
      }),
    });

    const approveRes = await patchConsultationById(patchReq, { params: Promise.resolve({ id: completedEncounterId }) });
    assert.strictEqual(approveRes.status, 200, "Clinician should be authorized to sign complete consultation");
    const approvedData = await approveRes.json();
    assert.strictEqual(approvedData.consultation.status, "approved");

    // 2. Attempting to downgrade or resume signed consultation fails with 409 Conflict
    const downgradeReq = new Request(`http://localhost:3000/api/consultations/${completedEncounterId}`, {
      method: "PATCH",
      headers: makePatientHeaders(patientId),
      body: JSON.stringify({
        status: "in_progress",
      }),
    });

    const conflictRes = await patchConsultationById(downgradeReq, { params: Promise.resolve({ id: completedEncounterId }) });
    assert.strictEqual(conflictRes.status, 409, "Signed clinical consultations are legally immutable");
    const conflictData = await conflictRes.json();
    assert.strictEqual(conflictData.code, "STATUS_CONFLICT");
  });

  it("6. IDOR protection: Non-owner patient is denied access to another patient's consultation (403)", async () => {
    const maliciousReq = new Request(`http://localhost:3000/api/consultations/${pausedEncounterId}`, {
      method: "GET",
      headers: makePatientHeaders("attacker-user-666"),
    });

    const res = await getConsultationById(maliciousReq, { params: Promise.resolve({ id: pausedEncounterId }) });
    assert.strictEqual(res.status, 403, "Patients cannot access another patient's encounter");
    const data = await res.json();
    assert.strictEqual(data.code, "FORBIDDEN");
  });

  it("7. Concurrency protection: Stale update rejected with 409 CONCURRENCY_CONFLICT", async () => {
    // Current caseVersion of pausedEncounterId is 2 from test 3.
    // Client A submits update expecting version 2 -> version becomes 3
    const updateReqA = new Request(`http://localhost:3000/api/consultations`, {
      method: "POST",
      headers: makePatientHeaders(patientId),
      body: JSON.stringify({
        id: pausedEncounterId,
        caseVersion: 3,
        transcript: [
          { role: "doctor", text: "Updating turns", timestamp: "10:20 AM" },
        ],
      }),
    });

    const resA = await createConsultation(updateReqA);
    assert.strictEqual(resA.status, 200, "First concurrent update succeeds");

    // Client B (stale tab) submits with stale version 2 expecting version 1 or 2
    const updateReqB = new Request(`http://localhost:3000/api/consultations`, {
      method: "POST",
      headers: makePatientHeaders(patientId),
      body: JSON.stringify({
        id: pausedEncounterId,
        caseVersion: 2,
        transcript: [
          { role: "doctor", text: "Stale concurrent turn", timestamp: "10:21 AM" },
        ],
      }),
    });

    const resB = await createConsultation(updateReqB);
    assert.strictEqual(resB.status, 409, "Stale concurrent update must be rejected with 409 Conflict");
    const conflictData = await resB.json();
    assert.strictEqual(conflictData.code, "CONCURRENCY_CONFLICT");
  });

  it("8. Linked follow-up consultation links parent with provenance; blocks cross-tenant linkage (403)", async () => {
    // 1. Authorized patient starts follow-up linked to completedEncounterId
    const followUpPayload = {
      id: followUpEncounterId,
      parentConsultationId: completedEncounterId,
      patientName: "Puneeth Test",
      doctorId: "dr-sarah-chen",
      doctorName: "Dr. Sarah Chen, MD",
      specialty: "Interventional Cardiology",
      chiefComplaint: "Follow-up check on exercise chest tightness",
      status: "in_progress",
      caseVersion: 1,
      transcript: [
        { role: "doctor", text: "Welcome back for your follow-up.", timestamp: "11:00 AM" },
      ],
    };

    const followUpReq = new Request("http://localhost:3000/api/consultations", {
      method: "POST",
      headers: makePatientHeaders(patientId),
      body: JSON.stringify(followUpPayload),
    });

    const followUpRes = await createConsultation(followUpReq);
    assert.strictEqual(followUpRes.status, 200, "Follow-up creation succeeds");
    const followUpData = await followUpRes.json();
    assert.strictEqual(followUpData.consultation.id, followUpEncounterId);
    assert.strictEqual(followUpData.consultation.interviewState?.parent_consultation_id, completedEncounterId);
    assert.strictEqual(followUpData.consultation.interviewState?.is_follow_up, true);

    // 2. Attacker patient attempts to link follow-up to another patient's completed encounter
    const attackerPayload = {
      id: `ENC-ATTACK-${Date.now()}`,
      parentConsultationId: completedEncounterId,
      patientName: "Attacker",
      doctorId: "dr-sarah-chen",
      doctorName: "Dr. Sarah Chen, MD",
      specialty: "Interventional Cardiology",
      chiefComplaint: "Snoop",
      status: "in_progress",
      caseVersion: 1,
    };

    const attackReq = new Request("http://localhost:3000/api/consultations", {
      method: "POST",
      headers: makePatientHeaders("attacker-user-999"),
      body: JSON.stringify(attackerPayload),
    });

    const attackRes = await createConsultation(attackReq);
    assert.strictEqual(attackRes.status, 403, "Cross-tenant follow-up linkage must be blocked with 403 Forbidden");
    const attackData = await attackRes.json();
    assert.strictEqual(attackData.code, "FORBIDDEN");
  });

  it("9. Verification: PATCH audit digest correctly computes against post-update state", async () => {
    // Verify that the completed encounter has a valid cryptographic audit digest matching the updated state
    const verifyReq = new Request(`http://localhost:3000/api/consultations/${completedEncounterId}/verify`, {
      method: "GET",
      headers: makeClinicianHeaders("dr-sarah-chen"),
    });

    const verifyRes = await verifyConsultation(verifyReq, { params: Promise.resolve({ id: completedEncounterId }) });
    assert.strictEqual(verifyRes.status, 200, "Ledger verification endpoint responds 200");
    const verifyData = await verifyRes.json();
    assert.strictEqual(verifyData.status, "VERIFIED", "Post-update record digest must match recorded ledger audit digest");
  });
});
