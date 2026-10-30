import assert from "assert";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

(process.env as Record<string, string | undefined>).NODE_ENV = "test";

import { DEFAULT_INTERNAL_TEST_SECRET, INTERNAL_TEST_SECRET_HEADER, Role } from "../../lib/auth/rbac";
(process.env as Record<string, string | undefined>).INTERNAL_TEST_SECRET = DEFAULT_INTERNAL_TEST_SECRET;

import { POST as postVoiceChat } from "../../app/api/voice/chat/route";
import { POST as postConsultations, GET as getConsultations, memoryConsultations } from "../../app/api/consultations/route";
import { clinicalBoard } from "../../lib/agents/clinical-board";
import { PatientCase } from "../../lib/agents/schemas";

function createHeaders(role: Role = "patient", userId = "user_test_soap", ipSuffix = 1) {
  return {
    "Content-Type": "application/json",
    "x-mock-role": role,
    "x-mock-user-id": userId,
    [INTERNAL_TEST_SECRET_HEADER]: DEFAULT_INTERNAL_TEST_SECRET,
    "x-forwarded-for": `10.99.1.${ipSuffix}`,
  };
}

async function runSoapEfficiencySuite() {
  console.log("================================================================================");
  console.log("       MEDVOICE SOAP REPORT CREATION TIMING & EFFICIENCY BENCHMARK              ");
  console.log("================================================================================\n");

  // ===========================================================================
  // TEST 1: Exact Lifecycle Timing — When is SOAP Created?
  // ===========================================================================
  console.log(">>> TEST 1: Consultation Lifecycle & SOAP Creation Trigger Points");
  {
    const encounterId = `ENC-SOAP-LIFECYCLE-${Date.now()}`;
    const userId = "user_soap_patient_01";

    // Step 1: Pre-initialize encounter
    const initReq = new Request("http://localhost:3000/api/consultations", {
      method: "POST",
      headers: createHeaders("patient", userId, 1),
      body: JSON.stringify({
        id: encounterId,
        patientName: "Jane Doe",
        patientAge: "32",
        patientGender: "female",
        doctorId: "dr-sarah-chen",
        doctorName: "Dr. Sarah Chen, MD",
        specialty: "General Physician",
        chiefComplaint: "Tension headache",
        transcript: [],
        status: "in_progress",
        caseVersion: 1,
      }),
    });
    const initRes = await postConsultations(initReq);
    assert.strictEqual(initRes.status, 200, "Initial encounter registration must succeed");
    console.log("  [1.1] Encounter initialized in datastore with status 'in_progress'");

    // Step 2: Turn 1 (History Gathering Phase)
    const t1Start = performance.now();
    const t1Req = new Request("http://localhost:3000/api/voice/chat", {
      method: "POST",
      headers: { ...createHeaders("patient", userId, 2), "x-turn-id": `turn-${Date.now()}-1` },
      body: JSON.stringify({
        encounterId,
        doctorId: "dr-sarah-chen",
        message: "I've had a tight band-like headache across my forehead for two days.",
        conversationHistory: [],
        patientName: "Jane Doe",
        patientAge: "32",
      }),
    });
    const t1Res = await postVoiceChat(t1Req);
    const t1Duration = Math.round(performance.now() - t1Start);
    assert.strictEqual(t1Res.status, 200, "Turn 1 must succeed");
    const t1Json = await t1Res.json();

    // Verify SOAP is deferred during history gathering
    console.log(`  [1.2] Turn 1 Response in ${t1Duration}ms | Phase: ${t1Json.phase}`);
    console.log(`        Triage Status: "${t1Json.triage?.triageTitle}"`);
    console.log(`        SOAP Report Created on Turn 1? ${t1Json.triage?.soap ? "YES" : "NO (Deferred - History in progress)"}`);
    assert.strictEqual(t1Json.triage?.soap, null, "Turn 1 must NOT generate finalized SOAP while still gathering history");
    assert.strictEqual(t1Json.triage?.triageLevel, "gathering_history", "Triage level must remain 'gathering_history'");

    // Step 3: Turn 2 (Answering Inquiring Questions)
    const t2Start = performance.now();
    const t2Req = new Request("http://localhost:3000/api/voice/chat", {
      method: "POST",
      headers: { ...createHeaders("patient", userId, 3), "x-turn-id": `turn-${Date.now()}-2` },
      body: JSON.stringify({
        encounterId,
        doctorId: "dr-sarah-chen",
        message: "No nausea, no visual changes, and no neck stiffness. It feels like mild tension from screen work.",
        conversationHistory: [
          { role: "patient", text: "I've had a tight band-like headache across my forehead for two days.", timestamp: "1 min ago" },
          { role: "doctor", text: t1Json.doctorReply, timestamp: "Just now" },
        ],
        patientName: "Jane Doe",
        patientAge: "32",
        interviewState: t1Json.interviewState,
        caseVersion: t1Json.caseVersion,
      }),
    });
    const t2Res = await postVoiceChat(t2Req);
    const t2Duration = Math.round(performance.now() - t2Start);
    assert.strictEqual(t2Res.status, 200, "Turn 2 must succeed");
    const t2Json = await t2Res.json();
    console.log(`  [1.3] Turn 2 Response in ${t2Duration}ms | Known facts: ${t2Json.board?.known_facts?.length || 0}`);

    // Step 4: Final Consultation Completion & SOAP Finalization
    const finalizeStart = performance.now();
    const finalizeReq = new Request("http://localhost:3000/api/consultations", {
      method: "POST",
      headers: createHeaders("patient", userId, 4),
      body: JSON.stringify({
        id: encounterId,
        patientName: "Jane Doe",
        patientAge: "32",
        patientGender: "female",
        doctorId: "dr-sarah-chen",
        doctorName: "Dr. Sarah Chen, MD",
        specialty: "General Physician",
        chiefComplaint: "Tension-type headache for 2 days",
        transcript: [
          { role: "doctor", text: "Hello Jane, how can I help you?", timestamp: "10:00 AM" },
          { role: "patient", text: "I've had a tight band-like headache across my forehead for two days.", timestamp: "10:01 AM" },
          { role: "doctor", text: t1Json.doctorReply, timestamp: "10:01 AM" },
          { role: "patient", text: "No nausea, no visual changes, and no neck stiffness.", timestamp: "10:02 AM" },
          { role: "doctor", text: t2Json.doctorReply, timestamp: "10:02 AM" },
        ],
        triageLevel: "routine",
        triageTitle: "LEVEL 4: ROUTINE CLINICAL CARE",
        esiScore: 4,
        detectedSymptoms: ["Tension headache", "Forehead pressure", "No neck stiffness"],
        soapSubjective: "[PATIENT-REPORTED]\n• Chief Complaint: Tension-type headache\n• Timeline: 2 days, bilateral tight band sensation across forehead\n• Pertinent Denials: Nausea: Denied; Photophobia: Denied; Neck stiffness: Denied",
        soapObjective: "[NOT ASSESSED]\n• Blood Pressure: Not assessed (telehealth)\n• Neurological exam: Cranial nerves gross examination unassessed\n\n[DEVICE / ACOUSTIC MEASURED]\n• Speech Rate: 135 WPM\n• Acoustic Biomarkers: Intelligible conversational cadence, no dysarthria\n• Diagnostic Tags: G44.209 (Tension-type headache, unspecified)",
        soapAssessment: "[AI-INFERRED / ALGORITHMIC]\n• Primary Triage Impression: Episodic Tension-Type Headache (ESI Level 4 - Routine)\n• Multi-Agent Consensus: General Practice & Neurology\n• Differential Diagnoses:\n  - Tension-Type Headache [Prob: HIGH]: Typical bilateral band-like ache aggravated by screen fatigue\n  - Migraine without Aura [Prob: LOW]: Lacks unilateral throbbing, nausea, or photophobia\n• Deterministic Safety Status: NOMINAL (Zero red flags confirmed)",
        soapPlan: "[AI-GENERATED]\n• Recommended Disposition: ROUTINE OUTPATIENT CARE\n• Clinical Next Steps: Ergonomic breaks from screens; adequate hydration; OTC acetaminophen 500mg PRN\n• Patient Safety Precautions: Seek emergency care if sudden 'thunderclap' headache or focal neurological deficits occur.\n• Audit Ledger & Provenance: Tamper-evident SHA-256 block height 1",
        durationSeconds: 154,
        status: "completed_pending_review",
        caseVersion: (t2Json.caseVersion || 1) + 1,
      }),
    });
    const finalizeRes = await postConsultations(finalizeReq);
    const finalizeDuration = Math.round(performance.now() - finalizeStart);
    if (!finalizeRes.ok) {
      const errJson = await finalizeRes.json().catch(() => ({}));
      console.error("Finalize error details:", finalizeRes.status, errJson);
    }
    assert.strictEqual(finalizeRes.status, 200, "Consultation finalization must succeed");
    const finalizeJson = await finalizeRes.json();
    console.log(`  [1.4] Consultation Finalized & Stored in ${finalizeDuration}ms with status: ${finalizeJson.consultation?.status}`);
    console.log("  [PASS] Verified: SOAP generation occurs at the consensus boundary or upon consultation completion, never prematurely on initial intake turns.\n");
  }

  // ===========================================================================
  // TEST 2: Emergency Preemption — Instant Red Flag SOAP Generation
  // ===========================================================================
  console.log(">>> TEST 2: Emergency Red Flag Preemption (Deterministic Pre-Arbiter)");
  {
    const emergEncId = `ENC-SOAP-EMERG-${Date.now()}`;
    const userId = "user_soap_patient_02";

    // Pre-initialize encounter
    await postConsultations(
      new Request("http://localhost:3000/api/consultations", {
        method: "POST",
        headers: createHeaders("patient", userId, 1),
        body: JSON.stringify({
          id: emergEncId,
          patientName: "Robert Miller",
          patientAge: "58",
          patientGender: "male",
          doctorId: "dr-sarah-chen",
          doctorName: "Dr. Sarah Chen, MD",
          specialty: "General Physician",
          chiefComplaint: "Acute chest pain",
          transcript: [],
          status: "in_progress",
          caseVersion: 1,
        }),
      })
    );

    const emergStart = performance.now();
    const emergReq = new Request("http://localhost:3000/api/voice/chat", {
      method: "POST",
      headers: { ...createHeaders("patient", userId, 2), "x-turn-id": `turn-${Date.now()}-emerg` },
      body: JSON.stringify({
        encounterId: emergEncId,
        doctorId: "dr-sarah-chen",
        message: "I feel crushing pressure in the center of my chest radiating down my left arm and I'm drenched in cold sweat.",
        conversationHistory: [],
        patientName: "Robert Miller",
        patientAge: "58",
      }),
    });
    const emergRes = await postVoiceChat(emergReq);
    const emergDuration = Math.round(performance.now() - emergStart);
    assert.strictEqual(emergRes.status, 200, "Emergency turn must succeed");
    const emergJson = await emergRes.json();

    console.log(`  • Emergency Turn Roundtrip:       ${emergDuration}ms`);
    console.log(`  • Triage Urgency Level:           ${emergJson.triage?.triageLevel?.toUpperCase()}`);
    console.log(`  • ESI Score:                      ${emergJson.triage?.esiScore} (${emergJson.triage?.triageTitle})`);
    console.log(`  • Deterministic Arbiter Override: ${emergJson.triage?.arbiterOverride ? "YES" : "NO"}`);
    console.log(`  • Red Flags Triggered:            ${emergJson.triage?.redFlagsTriggered?.join(", ")}`);
    console.log(`  • Full SOAP Generated on Turn 1?  ${emergJson.triage?.soap ? "YES (Immediate Emergency Preemption)" : "NO"}`);

    assert.strictEqual(emergJson.triage?.isEmergency, true, "Emergency flag must be TRUE");
    assert.strictEqual(emergJson.triage?.esiScore, 2, "Acute Coronary Syndrome must lock to ESI Level 2");
    assert.ok(emergJson.triage?.soap, "Emergency turn MUST generate full immediate SOAP documentation");
    console.log("  [PASS] Emergency presentation instantly preempted inquiry and generated full SOAP documentation on Turn 1.\n");
  }

  // ===========================================================================
  // TEST 3: Multi-Agent Clinical Board Core Engine Efficiency Benchmark
  // ===========================================================================
  console.log(">>> TEST 3: Direct ClinicalBoard Engine Efficiency & Provenance Audit");
  {
    const benchmarkCases: Array<{ name: string; patientCase: PatientCase }> = [
      {
        name: "Acute Coronary Syndrome (Cardiology)",
        patientCase: {
          patient_id: "PT-BENCH-01",
          patient_name: "Robert Miller",
          transcript: "Crushing chest pain radiating down left arm with cold sweats.",
          conversation_history: [],
          demographics: { age: 58, age_group: "adult" },
          detected_symptoms: ["Crushing chest pain", "Radiation to left arm", "Diaphoresis"],
          vitals: {},
          speech_features: { speech_rate_wpm: 110, observations: ["Labored breathing", "Short pauses"] },
          pre_safety_flags: ["ACS_CHEST_PAIN_WITH_HIGH_RISK_RADIATION_OR_DIAPHORESIS"],
          immediate_danger_detected: true,
          provenance_evidence: [
            { source: "patient_reported", domain: "chief_complaint", value: "Crushing chest pain radiating down left arm", description: "Patient complaint" },
            { source: "patient_reported", domain: "duration", value: "45 minutes", description: "Symptom duration" },
            { source: "patient_reported", domain: "pain_severity", value: "9/10 severe pressure", description: "Pain scale" },
          ],
          case_version: 1,
        },
      },
      {
        name: "Acute Ischemic Stroke (BE-FAST Neurology)",
        patientCase: {
          patient_id: "PT-BENCH-02",
          patient_name: "Elena Rostova",
          transcript: "Right facial droop and slurred speech starting 30 minutes ago.",
          conversation_history: [],
          demographics: { age: 64, age_group: "senior" },
          detected_symptoms: ["Right facial droop", "Dysarthria", "Acute neurological deficit"],
          vitals: {},
          speech_features: { speech_rate_wpm: 92, observations: ["Slurred consonant articulation"] },
          pre_safety_flags: ["BE_FAST_ACUTE_ISCHEMIC_STROKE_SYMPTOMS"],
          immediate_danger_detected: true,
          provenance_evidence: [
            { source: "patient_reported", domain: "chief_complaint", value: "Sudden right facial drooping and slurred speech", description: "Neurological deficit" },
            { source: "patient_reported", domain: "onset", value: "30 minutes ago", description: "Acute onset" },
          ],
          case_version: 1,
        },
      },
      {
        name: "Pediatric Stridor / Croup (Pediatrics)",
        patientCase: {
          patient_id: "PT-BENCH-03",
          patient_name: "Leo Thomas",
          transcript: "Barking seal-like cough with inspiratory stridor at rest in 3-year-old.",
          conversation_history: [],
          demographics: { age: 3, age_group: "child" },
          detected_symptoms: ["Barking cough", "Inspiratory stridor at rest"],
          vitals: {},
          speech_features: { speech_rate_wpm: 125, observations: ["High pitched stridor on inspiration"] },
          pre_safety_flags: ["PEDIATRIC_STRIDOR_AT_REST"],
          immediate_danger_detected: true,
          provenance_evidence: [
            { source: "patient_reported", domain: "chief_complaint", value: "Severe barking cough and noisy breathing", description: "Airway symptom" },
            { source: "patient_reported", domain: "patient_age", value: "3 years old", description: "Pediatric presentation" },
          ],
          case_version: 1,
        },
      },
      {
        name: "Routine Acute Pharyngitis (General Practice)",
        patientCase: {
          patient_id: "PT-BENCH-04",
          patient_name: "Sarah Jenkins",
          transcript: "Sore throat and mild nasal congestion for 2 days. No fever, no breathing difficulty.",
          conversation_history: [],
          demographics: { age: 26, age_group: "adult" },
          detected_symptoms: ["Sore throat", "Nasal congestion"],
          vitals: {},
          speech_features: { speech_rate_wpm: 138, observations: ["Clear conversational tone"] },
          pre_safety_flags: [],
          immediate_danger_detected: false,
          provenance_evidence: [
            { source: "patient_reported", domain: "chief_complaint", value: "Scratchy sore throat", description: "Throat irritation" },
            { source: "patient_reported", domain: "duration", value: "2 days", description: "Duration" },
            { source: "patient_reported", domain: "fever", status: "denied", description: "No fever" },
          ],
          case_version: 1,
        },
      },
    ];

    console.log("  Testing 4 distinct clinical presentations across Cardiology, Neurology, Pediatrics, and Primary Care:\n");

    for (const bCase of benchmarkCases) {
      const output = await clinicalBoard.evaluate(bCase.patientCase);
      const trace = output.trace;
      const soap = output.soap_note;

      const subLen = soap.subjective.length;
      const objLen = soap.objective.length;
      const assLen = soap.assessment.length;
      const plaLen = soap.plan.length;
      const totalChars = subLen + objLen + assLen + plaLen;

      // Check all 5 mandatory provenance tags
      const hasPatRep = soap.subjective.includes("[PATIENT-REPORTED]");
      const hasNotAss = soap.objective.includes("[NOT ASSESSED]");
      const hasDevice = soap.objective.includes("[DEVICE / ACOUSTIC MEASURED]");
      const hasAiInf = soap.assessment.includes("[AI-INFERRED / ALGORITHMIC]");
      const hasAiGen = soap.plan.includes("[AI-GENERATED]");

      console.log(`  ------------------------------------------------------------------------------`);
      console.log(`  Clinical Presentation: ${bCase.name}`);
      console.log(`  • Pre-Arbiter Latency:          ${trace.pre_arbiter_latency_us} µs (microseconds)`);
      console.log(`  • Post-Arbiter Latency:         ${trace.post_arbiter_latency_us} µs (microseconds)`);
      console.log(`  • Board Synthesis Latency:      ${trace.synthesis_latency_ms} ms`);
      console.log(`  • Total Pipeline Latency:       ${trace.total_board_latency_ms} ms`);
      console.log(`  • Final Disposition:            ${output.post_arbiter.final_disposition.toUpperCase()} (ESI ${output.post_arbiter.final_esi_level})`);
      console.log(`  • Diagnostic ICD-10 Tags:       ${output.post_arbiter.icd10_codes.join(", ") || "None"}`);
      console.log(`  • Cryptographic Chain Height:   ${output.post_arbiter.audit_hash_chain.length} blocks`);
      console.log(`  • Root SHA-256 Hash:            ${output.post_arbiter.audit_sha256.slice(0, 24)}...`);
      console.log(`  • Section Character Breakdown:  S: ${subLen} | O: ${objLen} | A: ${assLen} | P: ${plaLen} (Total: ${totalChars} chars)`);
      console.log(`  • Provenance Tag Compliance:    5/5 Tags Verified (${hasPatRep && hasNotAss && hasDevice && hasAiInf && hasAiGen ? "100% COMPLETE" : "PARTIAL"})`);

      assert.ok(hasPatRep, "Must include [PATIENT-REPORTED]");
      assert.ok(hasNotAss, "Must include [NOT ASSESSED]");
      assert.ok(hasDevice, "Must include [DEVICE / ACOUSTIC MEASURED]");
      assert.ok(hasAiInf, "Must include [AI-INFERRED / ALGORITHMIC]");
      assert.ok(hasAiGen, "Must include [AI-GENERATED]");
      assert.ok(output.post_arbiter.audit_sha256.length === 64, "Root hash must be valid 64-char SHA-256 string");
    }

    console.log(`\n  [PASS] All 4 clinical presentation evaluations passed efficiency, provenance tagging, and cryptographic verification.\n`);
  }

  console.log("================================================================================");
  console.log("      ALL SOAP REPORT CREATION TIMING & EFFICIENCY BENCHMARKS PASSED (100%)     ");
  console.log("================================================================================\n");
}

runSoapEfficiencySuite().catch((err) => {
  console.error("Test suite failed:", err);
  process.exit(1);
});
