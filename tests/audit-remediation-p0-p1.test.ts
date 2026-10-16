/**
 * MedVoice Phase 1 Comprehensive Remediation Test Suite
 *
 * Verifies P0/P1 fixes:
 * 1. Negation, Scoping & Polarity:
 *    - "no chest pain now" does not trigger acute ACS.
 *    - "no chest pain, but suffocating / cannot breathe" triggers respiratory emergency (no cross-symptom suppression).
 *    - "no chest pain, but my mother has chest pain" properly isolates caller vs third party.
 *    - "chest pain yesterday, now resolved" does not trigger acute ACS.
 *    - "I don't know whether he has a fever" does not trigger high fever override.
 *    - "Absence of dyspnea" parsed as absent and does not trigger respiratory failure J96.00.
 * 2. Clinical Differential Accuracy:
 *    - Acute appendicitis / RLQ acute abdomen identified in differential and triaged emergency (ESI 2).
 *    - Carpal tunnel / repetitive strain identified in differential and triaged routine (ESI 4).
 * 3. Consultation Lifecycle & Concurrency:
 *    - in_progress -> incomplete_intake -> completed_pending_review -> approved.
 *    - Incomplete encounters explicitly formatted with [INCOMPLETE INTAKE] without fabricated normal findings.
 *    - Downgrade of completed_pending_review rejected (409 Conflict).
 *    - Approved records are strictly immutable (409 Conflict).
 *    - Optimistic concurrency version checks enforced.
 *    - IDOR isolation: users cannot update another user's consultation.
 * 4. Truthful Dispatch & Simulation:
 *    - Pre-arrival webhook explicitly labeled simulation.
 *    - Synthesizer emergency replies contain 0 false dispatch claims and direct callers to 108/112/911.
 */

import assert from "assert";
import { evaluateSafetyArbiter } from "../lib/triage/safety-arbiter";
import { evaluatePostArbiter, parseSymptomFact } from "../lib/triage/post-arbiter";
import { clinicalBoard } from "../lib/agents/clinical-board";
import { POST as postConsultationsHandler } from "../app/api/consultations/route";
import { PATCH as patchConsultationHandler } from "../app/api/consultations/[id]/route";
import { POST as postPreArrivalHandler } from "../app/api/emergency/pre-arrival/route";
import { ClinicalSynthesizer } from "../lib/agents/synthesizer";
import { DEFAULT_INTERNAL_TEST_SECRET, INTERNAL_TEST_SECRET_HEADER } from "../lib/auth/rbac";
import { PatientCase, AgentOpinion, ClinicalConsensus } from "../lib/agents/schemas";

(process.env as any).NODE_ENV = "test";
(process.env as any).INTERNAL_TEST_SECRET = DEFAULT_INTERNAL_TEST_SECRET;

function createMockRequest(url: string, method: string = "POST", body?: any, headers: Record<string, string> = {}) {
  const finalHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    [INTERNAL_TEST_SECRET_HEADER]: DEFAULT_INTERNAL_TEST_SECRET,
    ...headers,
  };
  const role = headers["x-mock-role"] || (headers["x-user-role"] === "doctor" ? "clinician" : headers["x-user-role"]);
  if (role) {
    finalHeaders["x-mock-role"] = role;
  }
  const uid = headers["x-mock-user-id"] || headers["x-user-id"];
  if (uid) {
    finalHeaders["x-mock-user-id"] = uid;
  }

  return new Request(url, {
    method,
    headers: finalHeaders,
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function runTests() {
  console.log("================================================================================");
  console.log("      MEDVOICE PHASE 1 AUDIT REMEDIATION REGRESSION TEST SUITE                  ");
  console.log("================================================================================\n");

  let totalChecks = 0;
  let passedChecks = 0;

  function check(name: string, assertion: boolean, detail?: string) {
    totalChecks++;
    if (assertion) {
      passedChecks++;
      console.log(`  ✓ PASS: ${name}`);
    } else {
      console.error(`  ✗ FAIL: ${name} ${detail ? `(${detail})` : ""}`);
      throw new Error(`Assertion failed: ${name}`);
    }
  }

  // ============================================================================
  // GROUP 1: NEGATION, SCOPING, ATTRIBUTION & TEMPORALITY
  // ============================================================================
  console.log(">>> GROUP 1: NEGATION, SCOPING, ATTRIBUTION & TEMPORALITY\n");

  // 1.1 "no chest pain now"
  const resNoChest = evaluateSafetyArbiter({
    rawText: "I have a mild runny nose, no chest pain now, breathing easily.",
  });
  check("1.1 'no chest pain now' does not activate chestPain or emergency ESI 2",
    !resNoChest.isEmergency && resNoChest.esiScore >= 4,
    `ESI: ${resNoChest.esiScore}, Emergency: ${resNoChest.isEmergency}`
  );

  // 1.2 "no chest pain, but suffocating / cannot breathe" -> NON-SUPPRESSION OF PRESENT RED FLAGS
  const resNoChestWithDyspnea = evaluateSafetyArbiter({
    rawText: "I have no chest pain, but I am suffocating, fighting for breath, and cannot breathe.",
  });
  check("1.2 'no chest pain, but cannot breathe' MUST escalate to emergency (ESI <= 2) without being suppressed",
    resNoChestWithDyspnea.isEmergency && resNoChestWithDyspnea.esiScore <= 2,
    `ESI: ${resNoChestWithDyspnea.esiScore}, Emergency: ${resNoChestWithDyspnea.isEmergency}`
  );

  // 1.3 "no chest pain, but my mother has chest pain" -> ATTRIBUTION ISOLATION
  const resCallerVsMother = evaluateSafetyArbiter({
    rawText: "I am feeling fine with a mild cough and no chest pain, but my mother has chest pain.",
  });
  check("1.3 'my mother has chest pain' isolates symptom to mother, caller remains non-emergency",
    !resCallerVsMother.isEmergency && resCallerVsMother.esiScore >= 4,
    `ESI: ${resCallerVsMother.esiScore}, Red flags: ${resCallerVsMother.redFlagsTriggered.join(", ")}`
  );

  // 1.4 "chest pain yesterday, now resolved" -> TEMPORALITY
  const resResolvedChest = evaluateSafetyArbiter({
    rawText: "I had chest pain yesterday while working out, now resolved completely, today chest is 100% fine, but I twisted my ankle.",
  });
  check("1.4 'chest pain yesterday, now resolved' does not trigger acute ACS ESI 2",
    !resResolvedChest.isEmergency && resResolvedChest.esiScore >= 4,
    `ESI: ${resResolvedChest.esiScore}, Red flags: ${resResolvedChest.redFlagsTriggered.join(", ")}`
  );

  // 1.5 "I don't know whether he has a fever" -> UNCERTAINTY
  const resUncertainFever = evaluateSafetyArbiter({
    rawText: "Patient feels tired, I don't know whether he has a fever or not.",
  });
  check("1.5 'I don't know whether he has a fever' does not trigger acute fever red flag",
    !resUncertainFever.redFlagsTriggered.some(f => f.includes("FEVER")),
    `Red flags: ${resUncertainFever.redFlagsTriggered.join(", ")}`
  );

  // 1.6 "Absence of dyspnea" in Post-Arbiter
  const factAbsence = parseSymptomFact("Absence of dyspnea");
  check("1.6a parseSymptomFact('Absence of dyspnea') maps to status: 'absent'",
    factAbsence.status === "absent" && factAbsence.concept.toLowerCase().includes("dyspnea"),
    `Status: ${factAbsence.status}, Concept: ${factAbsence.concept}`
  );

  const mockConsensus: ClinicalConsensus = {
    consensus_risk: "routine",
    recommended_disposition: "routine_outpatient",
    orchestrator_summary: "Routine cold",
    primary_specialty: "Internal Medicine",
    synthesized_reply_narrative: "Routine care",
    key_findings: [],
    differential: [],
    conflicts: [],
    requires_immediate_escalation: false,
    active_specialists: ["primary-care"],
    deliberation_rounds_completed: 1,
    deliberation_messages: [],
  };

  const postArbiterAbsence = evaluatePostArbiter({
    patient_id: "TEST-NEG-01",
    patient_name: "Test Patient",
    transcript: "Mild cough for 2 days. Absence of dyspnea.",
    conversation_history: [],
    demographics: { age: 35, age_group: "adult" },
    detected_symptoms: ["Absence of dyspnea"],
    vitals: {},
    speech_features: {} as any,
    provenance_evidence: [],
    pre_safety_flags: [],
    immediate_danger_detected: false,
    case_version: 1,
  }, mockConsensus);

  check("1.6b Post-Arbiter with 'Absence of dyspnea' preserves routine disposition without respiratory failure override",
    postArbiterAbsence.final_triage_level === "routine" && !postArbiterAbsence.arbiter_override_applied,
    `Level: ${postArbiterAbsence.final_triage_level}, Override: ${postArbiterAbsence.arbiter_override_applied}`
  );

  // ============================================================================
  // GROUP 2: CLINICAL DIFFERENTIAL ACCURACY (AUDIT CASES 4, 6 & 7)
  // ============================================================================
  console.log("\n>>> GROUP 2: CLINICAL DIFFERENTIAL ACCURACY\n");

  // 2.1 Acute Appendicitis / Acute Abdomen
  const appendicitisCase: PatientCase = {
    patient_id: "TC-04-TEST",
    patient_name: "Test Appendicitis Patient",
    transcript: "I have severe sharp pain in my lower right stomach that started near my navel and moved down. It hurts when I walk and I feel feverish and nauseous with rebound tenderness.",
    conversation_history: [],
    demographics: { age: 22, age_group: "adult" },
    detected_symptoms: ["Severe right lower quadrant pain", "Migratory periumbilical pain", "Fever", "Nausea"],
    vitals: {},
    speech_features: {} as any,
    provenance_evidence: [],
    pre_safety_flags: ["ACUTE_ABDOMEN_SUSPECTED"],
    immediate_danger_detected: false,
    case_version: 1,
  };
  const appendicitisRes = await clinicalBoard.evaluate(appendicitisCase);
  const diffApp = appendicitisRes.consensus.differential;
  const hasAppDiff = diffApp.some(d => /appendicitis|acute abdomen|peritonitis/i.test(d.condition));
  check("2.1 Acute Appendicitis identified in multi-agent differential",
    hasAppDiff,
    `Differentials: ${diffApp.map(d => d.condition).join(", ")}`
  );
  check("2.1b Acute Appendicitis triaged as emergency (ESI 2)",
    appendicitisRes.post_arbiter.final_triage_level === "emergency" && appendicitisRes.post_arbiter.final_esi_level === 2,
    `Level: ${appendicitisRes.post_arbiter.final_triage_level}, ESI: ${appendicitisRes.post_arbiter.final_esi_level}`
  );

  // 2.2 Carpal Tunnel / Repetitive Strain Injury
  const carpalCase: PatientCase = {
    patient_id: "TC-07-TEST",
    patient_name: "Test Carpal Patient",
    transcript: "I have intermittent tingling and pins and needles in my left thumb and index finger after typing on my laptop all day.",
    conversation_history: [],
    demographics: { age: undefined, age_group: "unknown" as any },
    detected_symptoms: ["Thumb and index finger paresthesias", "Repetitive typing ergonomic trigger"],
    vitals: {},
    speech_features: {} as any,
    provenance_evidence: [],
    pre_safety_flags: [],
    immediate_danger_detected: false,
    case_version: 1,
  };
  const carpalRes = await clinicalBoard.evaluate(carpalCase);
  const diffCarpal = carpalRes.consensus.differential;
  const hasCarpalDiff = diffCarpal.some(d => /carpal tunnel|repetitive strain|paresthesia|neuropathy/i.test(d.condition));
  check("2.2 Carpal Tunnel / Repetitive Strain identified in differential",
    hasCarpalDiff,
    `Differentials: ${diffCarpal.map(d => d.condition).join(", ")}`
  );
  check("2.2b Carpal Tunnel triaged as routine (ESI 4)",
    carpalRes.post_arbiter.final_triage_level === "routine" && carpalRes.post_arbiter.final_esi_level >= 4,
    `Level: ${carpalRes.post_arbiter.final_triage_level}, ESI: ${carpalRes.post_arbiter.final_esi_level}`
  );

  // ============================================================================
  // GROUP 3: CONSULTATION LIFECYCLE & CONCURRENCY
  // ============================================================================
  console.log("\n>>> GROUP 3: CONSULTATION LIFECYCLE & CONCURRENCY\n");

  const testUserId = `patient-lifecycle-${Date.now()}`;
  const encId = `ENC-LIFECYCLE-${Date.now()}`;

  // 3.1 Initial Turn Autosave -> status: "in_progress"
  const draftReq = createMockRequest("http://localhost:3000/api/consultations", "POST", {
    id: encId,
    patientName: "Lifecycle Test Patient",
    doctorId: "dr-sarah-chen",
    doctorName: "Dr. Sarah Chen, MD",
    specialty: "Internal Medicine",
    chiefComplaint: "Mild throat irritation",
    transcript: [{ role: "patient", text: "My throat is scratchy", timestamp: "10:00 AM" }],
    status: "in_progress",
    version: 1,
  }, {
    "x-user-id": testUserId,
    "x-user-role": "patient",
  });
  const draftRes = await postConsultationsHandler(draftReq);
  const draftData = await draftRes.json();
  check("3.1 Turn autosave persists draft with status 'in_progress'",
    draftRes.status === 200 && draftData.consultation?.status === "in_progress",
    `Status: ${draftRes.status}, Consultation status: ${draftData.consultation?.status}`
  );

  // 3.2 Early Exit -> status: "incomplete_intake" with [INCOMPLETE INTAKE] formatting
  const earlyExitReq = createMockRequest("http://localhost:3000/api/consultations", "POST", {
    id: encId,
    patientName: "Lifecycle Test Patient",
    doctorId: "dr-sarah-chen",
    doctorName: "Dr. Sarah Chen, MD",
    specialty: "Internal Medicine",
    chiefComplaint: "Mild throat irritation",
    transcript: [{ role: "patient", text: "My throat is scratchy", timestamp: "10:00 AM" }],
    soapSubjective: "[INCOMPLETE INTAKE - GATHERING HISTORY]\nChief Concern: Mild throat irritation\nDialogue turns recorded: 1. Patient ended consultation prior to formal multi-agent clinical consensus.",
    soapObjective: "[INCOMPLETE INTAKE] Telemetry and physical examination unassessed.",
    soapAssessment: "[INCOMPLETE INTAKE] Intake terminated prior to multi-agent deliberation. Differential diagnosis deferred.",
    soapPlan: "[INCOMPLETE INTAKE] Recommend re-initiating full clinical intake or scheduling an in-person evaluation.",
    status: "incomplete_intake",
    version: 2,
  }, {
    "x-user-id": testUserId,
    "x-user-role": "patient",
  });
  const earlyExitRes = await postConsultationsHandler(earlyExitReq);
  const earlyExitData = await earlyExitRes.json();
  check("3.2 Early exit transitions to 'incomplete_intake' without claiming completed review",
    earlyExitRes.status === 200 && earlyExitData.consultation?.status === "incomplete_intake",
    `Status: ${earlyExitRes.status}, Record status: ${earlyExitData.consultation?.status}`
  );
  check("3.2b Early exit preserves explicit [INCOMPLETE INTAKE] note formatting",
    earlyExitData.consultation?.soapAssessment?.includes("[INCOMPLETE INTAKE]"),
    `Assessment: ${earlyExitData.consultation?.soapAssessment}`
  );

  // 3.3 Completion of Deliberation -> status: "completed_pending_review"
  const completedReq = createMockRequest("http://localhost:3000/api/consultations", "POST", {
    id: encId,
    patientName: "Lifecycle Test Patient",
    doctorId: "dr-sarah-chen",
    doctorName: "Dr. Sarah Chen, MD",
    specialty: "Internal Medicine",
    chiefComplaint: "Mild throat irritation",
    transcript: [{ role: "patient", text: "My throat is scratchy", timestamp: "10:00 AM" }],
    soapSubjective: "Patient reports scratchy throat.",
    soapObjective: "Afebrile, no red flags.",
    soapAssessment: "Viral pharyngitis",
    soapPlan: "Supportive care, hydration.",
    status: "completed_pending_review",
    version: 3,
  }, {
    "x-user-id": testUserId,
    "x-user-role": "patient",
  });
  const completedRes = await postConsultationsHandler(completedReq);
  const completedData = await completedRes.json();
  check("3.3 Full intake transitions to 'completed_pending_review'",
    completedRes.status === 200 && completedData.consultation?.status === "completed_pending_review",
    `Status: ${completedRes.status}, Record status: ${completedData.consultation?.status}`
  );

  // 3.4 Downgrade Protection: attempting to downgrade completed_pending_review back to in_progress is rejected
  const downgradeReq = createMockRequest("http://localhost:3000/api/consultations", "POST", {
    id: encId,
    status: "in_progress",
    version: 4,
  }, {
    "x-user-id": testUserId,
    "x-user-role": "patient",
  });
  const downgradeRes = await postConsultationsHandler(downgradeReq);
  check("3.4 Stale downgrade of 'completed_pending_review' to 'in_progress' rejected with 409 Conflict",
    downgradeRes.status === 409,
    `Status: ${downgradeRes.status}`
  );

  // 3.5 Clinician Approval -> status: "approved"
  const approveReq = createMockRequest(`http://localhost:3000/api/consultations/${encId}`, "PATCH", {
    id: encId,
    status: "approved",
    action: "approve",
  }, {
    "x-user-id": "dr-sarah-chen",
    "x-user-role": "clinician",
  });
  const approveRes = await patchConsultationHandler(approveReq, { params: Promise.resolve({ id: encId }) });
  const approveData = await approveRes.json();
  check("3.5 Clinician approves and signs consultation (status: 'approved')",
    approveRes.status === 200 && approveData.consultation?.status === "approved",
    `Status: ${approveRes.status}, Record status: ${approveData.consultation?.status}`
  );

  // 3.6 Immutability of Approved Record: edits and downgrades rejected with 409 Conflict
  const tamperReq = createMockRequest(`http://localhost:3000/api/consultations/${encId}`, "PATCH", {
    id: encId,
    status: "completed_pending_review",
    soapAssessment: "Tampered diagnosis",
    action: "update",
  }, {
    "x-user-id": testUserId,
    "x-user-role": "patient",
  });
  const tamperRes = await patchConsultationHandler(tamperReq, { params: Promise.resolve({ id: encId }) });
  check("3.6 Approved record is strictly immutable (downgrade/modification returns 409 Conflict)",
    tamperRes.status === 409,
    `Status: ${tamperRes.status}`
  );

  // 3.7 Concurrency Conflict: older version rejected
  const conflictReq = createMockRequest("http://localhost:3000/api/consultations", "POST", {
    id: `ENC-CONCURRENCY-${Date.now()}`,
    patientName: "Concurrency Test",
    doctorId: "dr-sarah-chen",
    doctorName: "Dr. Sarah Chen, MD",
    specialty: "Internal Medicine",
    status: "in_progress",
    version: 1,
  }, {
    "x-user-id": testUserId,
    "x-user-role": "patient",
  });
  const cRes1 = await postConsultationsHandler(conflictReq);
  const cData1 = await cRes1.json();
  const cEncounterId = cData1.consultation.id;

  // Now submit with an older version (version: 0)
  const staleVerReq = createMockRequest("http://localhost:3000/api/consultations", "POST", {
    id: cEncounterId,
    status: "in_progress",
    version: 0, // stale!
  }, {
    "x-user-id": testUserId,
    "x-user-role": "patient",
  });
  const staleVerRes = await postConsultationsHandler(staleVerReq);
  check("3.7 Optimistic concurrency rejects stale version (409 Conflict)",
    staleVerRes.status === 409,
    `Status: ${staleVerRes.status}`
  );

  // 3.8 IDOR Isolation: User B cannot modify User A's encounter
  const idorReq = createMockRequest("http://localhost:3000/api/consultations", "POST", {
    id: cEncounterId,
    status: "in_progress",
    version: 2,
  }, {
    "x-user-id": `malicious-attacker-${Date.now()}`,
    "x-user-role": "patient",
  });
  const idorRes = await postConsultationsHandler(idorReq);
  check("3.8 Cross-tenant IDOR attack rejected with 403 Forbidden",
    idorRes.status === 403,
    `Status: ${idorRes.status}`
  );

  // ============================================================================
  // GROUP 4: TRUTHFUL DISPATCH & SIMULATION INTEGRITY
  // ============================================================================
  console.log("\n>>> GROUP 4: TRUTHFUL DISPATCH & SIMULATION INTEGRITY\n");

  // 4.1 Synthesizer Emergency Spoken Narratives contain zero false dispatch claims
  const dummyOpinions: AgentOpinion[] = [
    {
      agent: "cardiology-vance",
      doctor_name: "Dr. Marcus Vance, MD",
      specialty: "Cardiology",
      deliberation_round: 1,
      primary_hypothesis: "Acute STEMI",
      concerns: ["STEMI"],
      evidence: ["Chest pressure"],
      evidence_for: ["Chest pressure"],
      evidence_against: [],
      missing_evidence: [],
      tool_invocations: [],
      challenges_issued: [],
      challenges_received: [],
      risk_level: "high",
      recommended_actions: ["Immediate 12-lead ECG"],
      confidence: 0.95,
      confidence_semantics: "uncalibrated_model_score",
      requires_escalation: true,
      speech_observations_evaluated: [],
      clinical_protocol: "Cardiology Resuscitation Protocol",
      retrieved_citations: []
    }
  ];

  const synthesizerInstance = new ClinicalSynthesizer();
  const synthRes = await synthesizerInstance.synthesize(
    {
      patient_id: "SYNTH-TEST-01",
      patient_name: "Test Cardiac",
      transcript: "Crushing chest pain radiating to arm",
      conversation_history: [],
      demographics: { age: 60, age_group: "adult" },
      detected_symptoms: ["Crushing chest pain"],
      vitals: {},
      speech_features: {} as any,
      provenance_evidence: [],
      pre_safety_flags: ["ACS_CHEST_PAIN"],
      immediate_danger_detected: true,
      case_version: 1,
    },
    dummyOpinions,
    "Critical cardiac emergency",
    ["cardiology-vance"],
    1
  );

  const spokenNarrative = synthRes.consensus.synthesized_reply_narrative;
  const hasFalseDispatchClaim = /dispatched right away|initiating emergency stroke protocols|ambulance to you immediately/i.test(spokenNarrative);
  const instructsCallingEmergency = /108|112|911|dial|call/i.test(spokenNarrative);

  check("4.1 Spoken emergency narrative contains ZERO false ambulance dispatch claims",
    !hasFalseDispatchClaim,
    `Spoken narrative: "${spokenNarrative}"`
  );
  check("4.1b Spoken emergency narrative directs caller to dial 108/112/911 immediately",
    instructsCallingEmergency,
    `Spoken narrative: "${spokenNarrative}"`
  );

  // 4.2 Emergency Pre-Arrival API Response explicitly labeled Simulation
  const preArrivalReq = createMockRequest("http://localhost:3000/api/emergency/pre-arrival", "POST", {
    consultationId: encId,
    patientId: testUserId,
    timestamp: new Date().toISOString(),
    esiScore: 2,
    triageLevel: "emergency",
    triageTitle: "ESI LEVEL 2: EMERGENT — Suspected Acute Coronary Syndrome (ACS)",
    icd10Codes: ["I21.9"],
    chiefComplaint: "Acute STEMI Chest Pressure",
    redFlagsTriggered: ["ACS_CHEST_PAIN"],
    targetHospitalName: "Apollo Health City Jubilee Hills",
    etaMinutes: 10,
  }, {
    "x-user-id": "dr-sarah-chen",
    "x-user-role": "doctor",
  });
  const preArrivalRes = await postPreArrivalHandler(preArrivalReq);
  const preArrivalData = await preArrivalRes.json();

  check("4.2 Pre-arrival hospital webhook payload includes isSimulation: true",
    preArrivalRes.status === 200 && preArrivalData.isSimulation === true,
    `Status: ${preArrivalRes.status}, isSimulation: ${preArrivalData.isSimulation}`
  );
  check("4.2b Pre-arrival hospital webhook includes explicit simulation disclaimer notice",
    typeof preArrivalData.simulationNotice === "string" && preArrivalData.simulationNotice.includes("SIMULATION ONLY"),
    `Notice: "${preArrivalData.simulationNotice}"`
  );

  console.log("\n================================================================================");
  console.log(`      ALL ${passedChecks}/${totalChecks} REGRESSION CHECKS PASSED SUCCESSFULLY              `);
  console.log("================================================================================\n");
}

runTests().catch((err) => {
  console.error("FATAL ERROR IN REGRESSION TEST SUITE:", err);
  process.exit(1);
});
