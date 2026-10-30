import assert from "node:assert/strict";
import { POST as consultPost } from "../../app/api/consultations/route";
import { PATCH as consultPatch } from "../../app/api/consultations/[id]/route";
import { ClinicalBoard } from "../../lib/agents/clinical-board";
import { DEFAULT_INTERNAL_TEST_SECRET } from "../../lib/auth/rbac";

process.env.NODE_ENV = "test";
process.env.INTERNAL_TEST_SECRET = DEFAULT_INTERNAL_TEST_SECRET;

async function runIncompleteIntakeTests() {
  console.log("================================================================================");
  console.log("    CLINICAL AUDIT SAFETY TEST: INCOMPLETE INTAKE STATE MACHINE INVARIANTS      ");
  console.log("================================================================================\n");

  const patientHeaders = {
    "Content-Type": "application/json",
    "x-test-harness-secret": DEFAULT_INTERNAL_TEST_SECRET,
    "x-mock-role": "patient",
    "x-mock-user-id": "test-patient-101",
  };

  const clinicianHeaders = {
    "Content-Type": "application/json",
    "x-test-harness-secret": DEFAULT_INTERNAL_TEST_SECRET,
    "x-mock-role": "clinician",
    "x-mock-user-id": "dr-sarah-chen",
  };

  // Test 1: Direct POST attempting to create an approved encounter with incomplete status
  console.log(">>> TEST 1: Reject immediate approval for incomplete intake");
  {
    const req = new Request("http://localhost:3000/api/consultations", {
      method: "POST",
      headers: patientHeaders,
      body: JSON.stringify({
        id: `ENC-INCOMP-TEST-01`,
        patientName: "Shane West",
        chiefComplaint: "Well hey",
        status: "approved", // Attempting to approve immediately
        triageLevel: "gathering_history",
        soapSubjective: "[INCOMPLETE DRAFT - HISTORY GATHERING]\n• Patient's recorded chief-concern text: \"Well hey\".",
      }),
    });

    const res = await consultPost(req);
    const body = await res.json();

    assert.equal(res.status, 422, "Must return HTTP 422 Unprocessable Entity");
    assert.equal(body.code, "CANNOT_APPROVE_INCOMPLETE_INTAKE", "Must return CANNOT_APPROVE_INCOMPLETE_INTAKE");
    console.log("  [PASS] Server rejected premature approval of incomplete intake with 422 CANNOT_APPROVE_INCOMPLETE_INTAKE");
  }

  // Test 2: Create initial in_progress encounter, then PATCH to approved while still incomplete
  console.log("\n>>> TEST 2: Reject PATCH transition to approved for incomplete intake");
  {
    const encId = `ENC-INCOMP-TEST-02`;
    // Initial creation as in_progress
    const createReq = new Request("http://localhost:3000/api/consultations", {
      method: "POST",
      headers: patientHeaders,
      body: JSON.stringify({
        id: encId,
        patientName: "Shane West",
        chiefComplaint: "Well hey",
        status: "incomplete_intake",
        triageLevel: "gathering_history",
        soapSubjective: "[INCOMPLETE DRAFT - HISTORY GATHERING]\n• Dialogue turns: 2",
      }),
    });

    const createRes = await consultPost(createReq);
    assert.equal(createRes.status, 200, "Initial record creation should succeed");

    // Attempt PATCH to approve
    const patchReq = new Request(`http://localhost:3000/api/consultations/${encId}`, {
      method: "PATCH",
      headers: clinicianHeaders,
      body: JSON.stringify({
        action: "approve",
        expectedVersion: 1,
      }),
    });

    const patchRes = await consultPatch(patchReq, { params: Promise.resolve({ id: encId }) });
    const patchBody = await patchRes.json();

    assert.equal(patchRes.status, 422, "Must reject PATCH approval with HTTP 422");
    assert.equal(patchBody.code, "CANNOT_APPROVE_INCOMPLETE_INTAKE");
    console.log("  [PASS] PATCH transition to approved rejected with 422 CANNOT_APPROVE_INCOMPLETE_INTAKE");
  }

  // Test 3: ClinicalBoard objective formatting never defaults to Z76.0
  console.log("\n>>> TEST 3: ClinicalBoard formatting omits unsupported Z76.0 fallback");
  {
    const board = new ClinicalBoard();
    const result = await board.evaluate({
      patient_id: "PT-TEST-ICD",
      patient_name: "Test Patient",
      transcript: "General mild throat tickle",
      conversation_history: [],
      demographics: { age: 30, age_group: "adult" },
      detected_symptoms: ["Throat tickle"],
      vitals: {},
      speech_features: {
        speech_rate_wpm: 120,
        observations: [],
        speech_pause_ratio: 0.1,
        mean_pause_duration_ms: 300,
        voice_energy_variability: 0.1,
        pitch_variability: 0.1,
        clinical_relevance: { respiratory_distress_signal: "unlikely", vocal_instability_signal: "none", confidence: 0.8 },
      },
      pre_safety_flags: [],
      immediate_danger_detected: false,
      provenance_evidence: [],
      case_version: 1,
    });

    assert.ok(!result.soap_note.objective.includes("Z76.0"), "SOAP objective must NEVER fabricate Z76.0");
    assert.ok(!result.soap_note.assessment.includes("Z76.0"), "SOAP assessment must NEVER fabricate Z76.0");
    console.log("  [PASS] Verified zero occurrences of unsupported Z76.0 fallback in ClinicalBoard output");
  }

  console.log("\n================================================================================");
  console.log("       ALL INCOMPLETE INTAKE CLINICAL SAFETY TESTS PASSED (100%)                ");
  console.log("================================================================================\n");
}

runIncompleteIntakeTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
