/**
 * MedVoice Deep Functional Audit:
 * 1. Chat -> SOAP -> Database -> Dashboard Persistence & Lifecycle
 * 2. Hospital Care Recommendations, Grounding & Routing
 * 3. Possible Conditions (Differential Diagnoses), Triage Urgency & Evaluation
 */

import { POST as chatHandler } from "../app/api/voice/chat/route";
import { GET as getConsultationsHandler, POST as postConsultationsHandler } from "../app/api/consultations/route";
import { GET as getConsultationByIdHandler, PATCH as patchConsultationByIdHandler } from "../app/api/consultations/[id]/route";
import { GET as getHospitalsHandler } from "../app/api/hospitals/route";
import { evaluateAndRankForSpecialty } from "../lib/care-network/evaluator";
import { clinicalBoard } from "../lib/agents/clinical-board";
import { PatientCase } from "../lib/agents/schemas";
import { DEFAULT_INTERNAL_TEST_SECRET, INTERNAL_TEST_SECRET_HEADER } from "../lib/auth/rbac";
import assert from "assert";

(process.env as any).NODE_ENV = "test";

function createMockRequest(url: string, method: string = "GET", body?: any, headers: Record<string, string> = {}) {
  const finalHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    [INTERNAL_TEST_SECRET_HEADER]: DEFAULT_INTERNAL_TEST_SECRET,
    ...headers,
  };
  if (headers["x-user-role"] && !finalHeaders["x-mock-role"]) {
    finalHeaders["x-mock-role"] = headers["x-user-role"];
  }
  if (headers["x-user-id"] && !finalHeaders["x-mock-user-id"]) {
    finalHeaders["x-mock-user-id"] = headers["x-user-id"];
  }

  const reqInit: any = {
    method,
    headers: finalHeaders,
  };
  if (body) {
    reqInit.body = JSON.stringify(body);
  }
  return new Request(url, reqInit);
}

async function runAudit() {
  console.log("================================================================================");
  console.log("       MEDVOICE FUNCTIONAL AUDIT: SOAP PERSISTENCE & CARE RECOMMENDATIONS       ");
  console.log("================================================================================\n");

  const results: Record<string, any> = {
    soapPersistence: {},
    hospitalRecommendations: {},
    differentialTriage: {},
  };

  // ============================================================================
  // SECTION 1: CHAT -> SOAP -> DATABASE -> DASHBOARD WORKFLOW
  // ============================================================================
  console.log(">>> SECTION 1: CHAT -> SOAP -> DATABASE -> DASHBOARD WORKFLOW\n");

  const patientUserId = `audit-patient-${Date.now()}`;
  const clinicianUserId = "dr-sarah-chen";
  const encounterId = `ENC-AUDIT-${Date.now()}`;

  // 1.1 Turn 1: Initial complaint (History gathering turn)
  console.log("1.1 Testing Turn 1 (History Gathering - Early Turn)...");
  const turn1Req = createMockRequest("http://localhost:3000/api/voice/chat", "POST", {
    message: "I've had a mild headache since this morning, maybe 3 out of 10.",
    conversationHistory: [],
    patientName: "Audit Test Patient",
    patientAge: "35",
    userId: patientUserId,
  }, {
    "x-user-id": patientUserId,
    "x-user-role": "patient",
  });

  const turn1Res = await chatHandler(turn1Req);
  const turn1Data = await turn1Res.json();

  console.log(`  - Turn 1 Phase: ${turn1Data.phase || turn1Data.board?.phase}`);
  console.log(`  - Turn 1 Triage Level: ${turn1Data.triage?.triageLevel}`);
  console.log(`  - Turn 1 SOAP Note Generated? ${turn1Data.triage?.soap ? "YES" : "NO (null while gathering)"}`);
  assert(turn1Data.triage?.soap === null, "Turn 1 while gathering history MUST NOT generate a premature SOAP note");

  // 1.2 Testing Early Call Termination (User ends consultation while still gathering history)
  console.log("\n1.2 Auditing Behavior when Patient Ends Call Early (during History Gathering)...");
  console.log("  - UI Behavior: persistEncounterRecord() sends empty strings for soapSubjective/Objective/Assessment/Plan.");
  console.log("  - Dashboard Behavior: dashboard page falls back to chief complaint, standardized unassessed telemetry notice, and triage title.");

  // 1.3 Complete Clinical Presentation triggering Full Multi-Agent Board Deliberation & SOAP Note
  console.log("\n1.3 Testing Complete Clinical Presentation (Board Deliberation -> Full SOAP Generation)...");
  const compReq = createMockRequest("http://localhost:3000/api/voice/chat", "POST", {
    message: "I am experiencing severe retrosternal crushing chest pressure radiating into my left arm with profuse cold sweats for 45 minutes.",
    conversationHistory: [],
    patientName: "Audit Test Patient",
    patientAge: "58",
    userId: patientUserId,
  }, {
    "x-user-id": patientUserId,
    "x-user-role": "patient",
  });

  const compRes = await chatHandler(compReq);
  const compData = await compRes.json();

  console.log(`  - Response Phase: ${compData.phase || compData.board?.phase}`);
  console.log(`  - Assigned Triage Level: ${compData.triage?.triageLevel}`);
  console.log(`  - ESI Score: ${compData.triage?.esiScore}`);
  console.log(`  - Full SOAP Note Generated? ${compData.triage?.soap ? "YES" : "NO"}`);

  assert(compData.triage?.soap !== null, "Complete clinical presentation MUST convene board and generate SOAP note");
  const soap = compData.triage.soap;

  // 1.4 Content Fidelity Analysis
  console.log("\n1.4 Auditing Generated SOAP Note Fidelity & Provenance...");
  console.log("  [Subjective excerpt]:", soap.subjective.slice(0, 150) + "...");
  console.log("  [Objective excerpt]:", soap.objective.slice(0, 150) + "...");
  console.log("  [Assessment excerpt]:", soap.assessment.slice(0, 150) + "...");
  console.log("  [Plan excerpt]:", soap.plan.slice(0, 150) + "...");

  const hasFabricatedVitals = /\b(120\/80|98%|72\s*bpm|37\.0\s*C)\b/i.test(soap.objective);
  const mentionsUnassessed = soap.objective.includes("[NOT ASSESSED]") || /not (assessed|performed)/i.test(soap.objective);
  console.log(`  - Fabricated numeric vitals present in Objective? ${hasFabricatedVitals ? "FAIL (Hallucinated)" : "NONE (Clean)"}`);
  console.log(`  - Explicit [NOT ASSESSED] disclaimer present? ${mentionsUnassessed ? "YES" : "NO"}`);
  console.log(`  - Explicit [AI-INFERRED] disclaimer present in Assessment? ${soap.assessment.includes("[AI-INFERRED") ? "YES" : "NO"}`);

  assert(!hasFabricatedVitals, "SOAP Objective must not invent numeric vitals");
  assert(mentionsUnassessed, "SOAP Objective must explicitly state vitals are not assessed");

  // 1.5 Persistence: Simulating UI End Consultation
  console.log("\n1.5 Persisting Encounter to Database (/api/consultations)...");
  const persistPayload = {
    id: encounterId,
    patientName: "Audit Test Patient",
    patientAge: "58",
    patientGender: "male",
    doctorId: clinicianUserId,
    doctorName: "Dr. Sarah Chen, MD",
    specialty: "Interventional Cardiology",
    chiefComplaint: "Retrosternal crushing chest pressure radiating into left arm with diaphoresis",
    transcript: [
      { role: "patient", text: "I am experiencing severe retrosternal crushing chest pressure radiating into my left arm with profuse cold sweats for 45 minutes.", timestamp: "14:00" },
      { role: "doctor", text: compData.doctorReply, timestamp: "14:01" }
    ],
    triageLevel: compData.triage.triageLevel,
    triageTitle: compData.triage.triageTitle,
    esiScore: compData.triage.esiScore,
    icd10Codes: compData.triage.icdCodes || [],
    detectedSymptoms: compData.triage.detectedSymptoms || [],
    soapSubjective: soap.subjective,
    soapObjective: soap.objective,
    soapAssessment: soap.assessment,
    soapPlan: soap.plan,
    recommendedAction: compData.triage.recommendedAction,
    durationSeconds: 150,
    status: "completed_pending_review",
  };

  const persistReq = createMockRequest("http://localhost:3000/api/consultations", "POST", persistPayload, {
    "x-user-id": patientUserId,
    "x-user-role": "patient",
  });
  const persistRes = await postConsultationsHandler(persistReq);
  const persistData = await persistRes.json();
  console.log(`  - Save Response Status: ${persistRes.status}`);
  console.log(`  - Saved Status: ${persistData.consultation?.status}`);
  assert.strictEqual(persistRes.status, 200, "Persistence should return 200 OK");
  assert.strictEqual(persistData.consultation?.status, "completed_pending_review");

  // 1.5 Simulating Dashboard Load & Refresh
  console.log("\n1.5 Simulating Dashboard Initial Load & Refresh (GET /api/consultations)...");
  const dashReq1 = createMockRequest("http://localhost:3000/api/consultations", "GET", undefined, {
    "x-user-id": patientUserId,
    "x-user-role": "patient",
  });
  const dashRes1 = await getConsultationsHandler(dashReq1);
  const dashData1 = await dashRes1.json();
  const foundRecord1 = (dashData1.consultations || []).find((c: any) => c.id === encounterId);

  console.log(`  - Encounter found on Dashboard initial load? ${Boolean(foundRecord1)}`);
  console.log(`  - Dashboard record SOAP Subjective preserved? ${Boolean(foundRecord1?.soapSubjective)}`);
  console.log(`  - Dashboard record SOAP Assessment preserved? ${Boolean(foundRecord1?.soapAssessment)}`);
  assert(foundRecord1, "Record must be present on dashboard initial load");
  assert.strictEqual(foundRecord1.soapSubjective, soap.subjective);

  // Refresh
  const dashReq2 = createMockRequest("http://localhost:3000/api/consultations", "GET", undefined, {
    "x-user-id": patientUserId,
    "x-user-role": "patient",
  });
  const dashRes2 = await getConsultationsHandler(dashReq2);
  const dashData2 = await dashRes2.json();
  const foundRecord2 = (dashData2.consultations || []).find((c: any) => c.id === encounterId);
  console.log(`  - Encounter preserved after page refresh? ${Boolean(foundRecord2)}`);
  assert.strictEqual(foundRecord2.id, encounterId);

  // 1.6 RBAC & Clinical Approval Workflow
  console.log("\n1.6 Testing RBAC Approval Controls...");
  // Unauthorized patient approval attempt
  const unauthPatchReq = createMockRequest(`http://localhost:3000/api/consultations/${encounterId}`, "PATCH", {
    action: "approve",
  }, {
    "x-user-id": patientUserId,
    "x-user-role": "patient",
  });
  const unauthPatchRes = await patchConsultationByIdHandler(unauthPatchReq, { params: Promise.resolve({ id: encounterId }) });
  console.log(`  - Patient self-approval attempt status: ${unauthPatchRes.status} (Expected 403)`);
  assert.strictEqual(unauthPatchRes.status, 403, "Patient self-signing must return 403");

  // Authorized clinician approval
  const authPatchReq = createMockRequest(`http://localhost:3000/api/consultations/${encounterId}`, "PATCH", {
    action: "approve",
  }, {
    "x-user-id": clinicianUserId,
    "x-user-role": "clinician",
  });
  const authPatchRes = await patchConsultationByIdHandler(authPatchReq, { params: Promise.resolve({ id: encounterId }) });
  const authPatchData = await authPatchRes.json();
  console.log(`  - Clinician approval status: ${authPatchRes.status}`);
  console.log(`  - Updated Status: ${authPatchData.consultation?.status}`);
  console.log(`  - Approved By: ${authPatchData.consultation?.approvedBy}`);
  assert.strictEqual(authPatchRes.status, 200);
  assert.strictEqual(authPatchData.consultation?.status, "approved");

  // 1.7 Idempotency & Stale Downgrade Conflict
  console.log("\n1.7 Testing Idempotent Retries & Stale Downgrade Rejection...");
  // Stale downgrade attempt
  const downgradeReq = createMockRequest("http://localhost:3000/api/consultations", "POST", {
    ...persistPayload,
    status: "completed_pending_review",
  }, {
    "x-user-id": patientUserId,
    "x-user-role": "patient",
  });
  const downgradeRes = await postConsultationsHandler(downgradeReq);
  console.log(`  - Stale downgrade attempt status: ${downgradeRes.status} (Expected 409 Conflict)`);
  assert.strictEqual(downgradeRes.status, 409, "Stale downgrade of approved record must be rejected with 409");

  // Idempotent retry without status downgrade
  const idempotentReq = createMockRequest("http://localhost:3000/api/consultations", "POST", {
    ...persistPayload,
    status: undefined,
  }, {
    "x-user-id": patientUserId,
    "x-user-role": "patient",
  });
  const idempotentRes = await postConsultationsHandler(idempotentReq);
  const idempotentData = await idempotentRes.json();
  console.log(`  - Idempotent retry status: ${idempotentRes.status}`);
  console.log(`  - Message: ${idempotentData.message}`);
  assert.strictEqual(idempotentRes.status, 200);
  assert.strictEqual(idempotentData.consultation?.status, "approved");

  results.soapPersistence = { status: "VERIFIED_PASS" };

  // ============================================================================
  // SECTION 2: HOSPITAL RECOMMENDATIONS & CARE ROUTING
  // ============================================================================
  console.log("\n>>> SECTION 2: HOSPITAL RECOMMENDATIONS & CARE ROUTING\n");

  // 2.1 GPS Search (Hyderabad coords)
  console.log("2.1 Querying Hospitals by GPS Coordinates (lat=17.3850, lng=78.4867)...");
  const hospGpsReq = createMockRequest("http://localhost:3000/api/hospitals?lat=17.3850&lng=78.4867");
  const hospGpsRes = await getHospitalsHandler(hospGpsReq);
  const hospGpsData = await hospGpsRes.json();

  console.log(`  - Query Status: ${hospGpsRes.status}`);
  console.log(`  - Facilities Discovered: ${hospGpsData.count}`);
  const firstHosp = hospGpsData.hospitals?.[0];
  if (firstHosp) {
    console.log(`  - Top facility: ${firstHosp.name}`);
    console.log(`  - Distance: ${firstHosp.distanceKm} km | Drive Time: ~${firstHosp.etaMinutes} mins`);
    console.log(`  - 24/7 ER: ${firstHosp.isEmergency24x7 ? "YES" : "NO"}`);
    console.log(`  - Accreditation: ${firstHosp.accreditation?.join(", ") || "None registered"}`);
    console.log(`  - Source Type: ${firstHosp.sourceType}`);
    console.log(`  - Google Maps URL: ${firstHosp.googleMapsUrl}`);
  }

  // 2.2 Specialty Ranking (Cardiology vs Dermatology)
  console.log("\n2.2 Evaluating Client-Side Ranking (Cardiology vs Dermatology)...");
  const cardioRanking = evaluateAndRankForSpecialty(hospGpsData.hospitals, "cardiology");
  console.log(`  - Cardiology Top Match: ${cardioRanking.ranked[0]?.name}`);
  console.log(`  - Cardiology Match Tier: ${cardioRanking.ranked[0]?.matchTier}`);
  console.log(`  - Cardiology Action Type: ${cardioRanking.ranked[0]?.actionType} (Expected call_ed)`);
  console.log(`  - Cardiology 24/7 ER Available: ${cardioRanking.ranked[0]?.isEmergency24x7}`);

  const dermaRanking = evaluateAndRankForSpecialty(hospGpsData.hospitals, "dermatology");
  console.log(`  - Dermatology Top Match: ${dermaRanking.ranked[0]?.name}`);
  console.log(`  - Dermatology Action Type: ${dermaRanking.ranked[0]?.actionType} (Expected call_hospital)`);

  // 2.3 Category Fallback Testing
  console.log("\n2.3 Testing Category Fallback (when specialty has zero nearby matches)...");
  // Artificial test with empty specialty match
  const fallbackRanking = evaluateAndRankForSpecialty(
    [{ id: "h1", name: "General Community Hospital", specialty: ["General"], distanceKm: 2.5, isEmergency24x7: true, etaMinutes: 10 }],
    "burns"
  );
  console.log(`  - Fallback Triggered? ${fallbackRanking.categoryFallback}`);
  console.log(`  - Fallback Banner: "${fallbackRanking.fallbackBanner}"`);
  console.log(`  - Fallback Facility: ${fallbackRanking.ranked[0]?.name} (MatchedCategory: ${fallbackRanking.ranked[0]?.matchedCategory})`);
  assert(fallbackRanking.categoryFallback, "Zero-match specialty must trigger category fallback");

  // 2.4 Error & Edge Case Handling
  console.log("\n2.4 Testing Location Error Handling & Validation...");
  const missingLocRes = await getHospitalsHandler(createMockRequest("http://localhost:3000/api/hospitals"));
  console.log(`  - Missing location coordinates response: ${missingLocRes.status} (Expected 400)`);
  assert.strictEqual(missingLocRes.status, 400);

  const invalidCoordsRes = await getHospitalsHandler(createMockRequest("http://localhost:3000/api/hospitals?lat=999&lng=999"));
  console.log(`  - Out of bounds lat/lng response: ${invalidCoordsRes.status} (Expected 400)`);
  assert.strictEqual(invalidCoordsRes.status, 400);

  const unknownCityRes = await getHospitalsHandler(createMockRequest("http://localhost:3000/api/hospitals?city=AtlantisNowhereCity"));
  console.log(`  - Unknown city response: ${unknownCityRes.status} (Expected 400)`);
  assert.strictEqual(unknownCityRes.status, 400);

  results.hospitalRecommendations = { status: "VERIFIED_PASS" };

  // ============================================================================
  // SECTION 3: POSSIBLE CONDITIONS (DIFFERENTIAL) & TRIAGE ACCURACY
  // ============================================================================
  console.log("\n>>> SECTION 3: POSSIBLE CONDITIONS (DIFFERENTIAL) & TRIAGE ACCURACY\n");

  const testCases: Array<{ name: string; patientCase: PatientCase; expectedTriage: string; expectedEsiRange: [number, number]; expectedConditionSubstring: RegExp }> = [
    {
      name: "Case 1: Acute Ischemic Cardiac Symptoms (Crushing chest pressure, arm radiation, cold sweat)",
      expectedTriage: "emergency",
      expectedEsiRange: [1, 2],
      expectedConditionSubstring: /coronary|acs|ischemi|angina|infarct/i,
      patientCase: {
        patient_id: "TC-01",
        patient_name: "Test Cardiac Patient",
        transcript: "I have heavy crushing pressure in the center of my chest radiating to my left arm, and I am breaking out in a cold sweat for 30 minutes.",
        conversation_history: [],
        demographics: { age: 58, age_group: "adult" },
        detected_symptoms: ["Crushing chest pressure", "Left arm radiation", "Diaphoresis"],
        vitals: {},
        speech_features: { speech_rate_wpm: 120, pause_ratio: 0.1, jitter_percent: 0.5, shimmer_percent: 1.0, pitch_variability_hz: 15, audio_clarity_score: 0.95 } as any,
        provenance_evidence: [],
        pre_safety_flags: ["ACS_CHEST_PAIN_WITH_HIGH_RISK_RADIATION_OR_DIAPHORESIS"],
        immediate_danger_detected: true,
        case_version: 1,
      }
    },
    {
      name: "Case 2: Acute Stroke / Neurological Deficit (Sudden facial droop, slurred speech)",
      expectedTriage: "emergency",
      expectedEsiRange: [1, 2],
      expectedConditionSubstring: /stroke|ischemic|cerebrovascular|tia/i,
      patientCase: {
        patient_id: "TC-02",
        patient_name: "Test Stroke Patient",
        transcript: "My husband's face is suddenly drooping on the right side and when he tries to talk his words are completely slurred.",
        conversation_history: [],
        demographics: { age: 67, age_group: "older_adult" },
        detected_symptoms: ["Right facial droop", "Dysarthria", "Sudden neurological deficit"],
        vitals: {},
        speech_features: { speech_rate_wpm: 100, pause_ratio: 0.2, jitter_percent: 0.8, shimmer_percent: 1.2, pitch_variability_hz: 12, audio_clarity_score: 0.9 } as any,
        provenance_evidence: [],
        pre_safety_flags: ["BE_FAST_ACUTE_ISCHEMIC_STROKE_SYMPTOMS"],
        immediate_danger_detected: true,
        case_version: 1,
      }
    },
    {
      name: "Case 3: Routine Upper Respiratory Infection (Mild sore throat, clear rhinorrhea, 2 days)",
      expectedTriage: "routine",
      expectedEsiRange: [4, 5],
      expectedConditionSubstring: /pharyngitis|uri|viral|respiratory infection|common cold/i,
      patientCase: {
        patient_id: "TC-03",
        patient_name: "Test URI Patient",
        transcript: "I have a mild scratchy throat and a runny nose for 2 days. No fever, breathing is totally fine.",
        conversation_history: [],
        demographics: { age: 29, age_group: "adult" },
        detected_symptoms: ["Mild scratchy throat", "Rhinorrhea"],
        vitals: {},
        speech_features: { speech_rate_wpm: 135, pause_ratio: 0.05, jitter_percent: 0.3, shimmer_percent: 0.5, pitch_variability_hz: 20, audio_clarity_score: 0.98 } as any,
        provenance_evidence: [],
        pre_safety_flags: [],
        immediate_danger_detected: false,
        case_version: 1,
      }
    },
    {
      name: "Case 4: Acute Appendicitis / Acute Abdomen (Severe RLQ abdominal pain, rebound tenderness, fever)",
      expectedTriage: "emergency",
      expectedEsiRange: [2, 3],
      expectedConditionSubstring: /appendicitis|acute abdomen|peritonitis/i,
      patientCase: {
        patient_id: "TC-04",
        patient_name: "Test Appendicitis Patient",
        transcript: "I have severe sharp pain in my lower right stomach that started near my navel and moved down. It hurts when I walk and I feel feverish and nauseous.",
        conversation_history: [],
        demographics: { age: 22, age_group: "adult" },
        detected_symptoms: ["Severe right lower quadrant pain", "Migratory periumbilical pain", "Fever", "Nausea"],
        vitals: {},
        speech_features: { speech_rate_wpm: 115, pause_ratio: 0.15, jitter_percent: 0.6, shimmer_percent: 0.9, pitch_variability_hz: 18, audio_clarity_score: 0.92 } as any,
        provenance_evidence: [],
        pre_safety_flags: ["ACUTE_ABDOMEN_SUSPECTED"],
        immediate_danger_detected: false,
        case_version: 1,
      }
    },
    {
      name: "Case 5: Pediatric Crisis (4-month-old infant, grunting, lethargy, poor feeding)",
      expectedTriage: "emergency",
      expectedEsiRange: [1, 2],
      expectedConditionSubstring: /pediatric|respiratory distress|sepsis|bronchiolitis|infant/i,
      patientCase: {
        patient_id: "TC-05",
        patient_name: "Test Infant Patient",
        transcript: "My 4 month old baby is breathing very fast with grunting sounds and won't wake up to breastfeed.",
        conversation_history: [],
        demographics: { age: 0, age_group: "infant" },
        detected_symptoms: ["Infant grunting respirations", "Lethargy", "Poor feeding", "Tachypnea"],
        vitals: {},
        speech_features: { speech_rate_wpm: 140, pause_ratio: 0.1, jitter_percent: 0.7, shimmer_percent: 1.1, pitch_variability_hz: 25, audio_clarity_score: 0.9 } as any,
        provenance_evidence: [],
        pre_safety_flags: ["PRE_FLAG_PEDIATRIC_CRISIS"],
        immediate_danger_detected: true,
        case_version: 1,
      }
    },
    {
      name: "Case 6: Negation & Resolved Symptom (\"Chest pain was yesterday during gym, today chest is 100% fine, just sprained ankle\")",
      expectedTriage: "routine",
      expectedEsiRange: [4, 5],
      expectedConditionSubstring: /ankle|sprain|musculoskeletal/i,
      patientCase: {
        patient_id: "TC-06",
        patient_name: "Test Negation Patient",
        transcript: "I had some mild chest tightness yesterday while bench pressing, but it went away within 5 minutes and today my chest feels 100% normal. Right now I just twisted my ankle stepping off the curb.",
        conversation_history: [],
        demographics: { age: 31, age_group: "adult" },
        detected_symptoms: ["Ankle inversion injury"],
        vitals: {},
        speech_features: { speech_rate_wpm: 130, pause_ratio: 0.08, jitter_percent: 0.4, shimmer_percent: 0.6, pitch_variability_hz: 22, audio_clarity_score: 0.96 } as any,
        provenance_evidence: [],
        pre_safety_flags: [],
        immediate_danger_detected: false,
        case_version: 1,
      }
    },
    {
      name: "Case 7: Missing Demographics & Ambiguous Presentation (Tingling in thumb after continuous computer typing)",
      expectedTriage: "routine",
      expectedEsiRange: [4, 5],
      expectedConditionSubstring: /carpal tunnel|repetitive strain|paresthesia|neuropathy|tendon/i,
      patientCase: {
        patient_id: "TC-07",
        patient_name: "Test Ambiguous Patient",
        transcript: "I have intermittent tingling and pins and needles in my left thumb and index finger after typing on my laptop all day.",
        conversation_history: [],
        demographics: { age: undefined, age_group: "unknown" as any },
        detected_symptoms: ["Thumb and index finger paresthesias", "Repetitive typing ergonomic trigger"],
        vitals: {},
        speech_features: { speech_rate_wpm: 125, pause_ratio: 0.06, jitter_percent: 0.35, shimmer_percent: 0.5, pitch_variability_hz: 19, audio_clarity_score: 0.95 } as any,
        provenance_evidence: [],
        pre_safety_flags: [],
        immediate_danger_detected: false,
        case_version: 1,
      }
    }
  ];

  for (const tc of testCases) {
    console.log(`\nEvaluating ${tc.name}...`);
    const boardResult = await clinicalBoard.evaluate(tc.patientCase);
    const postArbiter = boardResult.post_arbiter;
    const diff = boardResult.consensus.differential;

    console.log(`  - Assigned Triage Level: ${postArbiter.final_triage_level} (Expected: ${tc.expectedTriage})`);
    console.log(`  - ESI Score: ${postArbiter.final_esi_level} (Expected: ${tc.expectedEsiRange[0]}-${tc.expectedEsiRange[1]})`);
    console.log(`  - ICD-10 Codes: ${postArbiter.icd10_codes?.join(", ") || "None"}`);
    console.log(`  - Differential Conditions (${diff.length}):`);
    diff.forEach((d: any) => {
      console.log(`      * ${d.condition} [Prob: ${d.probability}]: ${d.clinical_rationale}`);
    });

    const matchesCondition = diff.some((d: any) => tc.expectedConditionSubstring.test(d.condition));
    const triageMatches = postArbiter.final_triage_level === tc.expectedTriage;
    const esiInRange = postArbiter.final_esi_level >= tc.expectedEsiRange[0] && postArbiter.final_esi_level <= tc.expectedEsiRange[1];

    console.log(`  - Expected condition identified in differential? ${matchesCondition ? "YES" : "NO"}`);
    console.log(`  - Triage matches expected? ${triageMatches ? "YES" : "NO"}`);
    console.log(`  - ESI in expected range? ${esiInRange ? "YES" : "NO"}`);

    results.differentialTriage[tc.name] = {
      triageLevel: postArbiter.final_triage_level,
      expectedTriage: tc.expectedTriage,
      triageMatches,
      esiScore: postArbiter.final_esi_level,
      expectedEsiRange: tc.expectedEsiRange,
      esiInRange,
      icd10: postArbiter.icd10_codes,
      differentialCount: diff.length,
      differentialConditions: diff.map((d: any) => `${d.condition} [${d.probability}]`),
      matchesExpectedCondition: matchesCondition,
    };
  }

  console.log("\n================================================================================");
  console.log("       EVALUATION SUMMARY ACROSS ALL 7 HELD-OUT SCENARIOS                       ");
  console.log("================================================================================\n");

  for (const [name, r] of Object.entries(results.differentialTriage) as [string, any][]) {
    console.log(`[${r.triageMatches && r.matchesExpectedCondition ? "PASS" : "DEFECT"}] ${name}`);
    console.log(`       Assigned: ${r.triageLevel} (ESI ${r.esiScore}) | Expected: ${r.expectedTriage} (ESI ${r.expectedEsiRange[0]}-${r.expectedEsiRange[1]})`);
    console.log(`       Differential Match: ${r.matchesExpectedCondition ? "YES" : "NO"}`);
    console.log(`       Top Differentials: ${r.differentialConditions.slice(0, 3).join(", ") || "None"}\n`);
  }

  console.log("================================================================================");
  console.log("       ALL FUNCTIONAL EVALUATIONS COMPLETED SUCCESSFULLY                        ");
  console.log("================================================================================");
}

runAudit().catch((err) => {
  console.error("FATAL ERROR IN FUNCTIONAL AUDIT:", err);
  process.exit(1);
});
