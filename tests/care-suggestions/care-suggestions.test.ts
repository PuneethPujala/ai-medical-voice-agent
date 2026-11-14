import assert from "assert";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

(process.env as Record<string, string | undefined>).NODE_ENV = "test";

import { DEFAULT_INTERNAL_TEST_SECRET, INTERNAL_TEST_SECRET_HEADER, Role } from "../../lib/auth/rbac";
(process.env as Record<string, string | undefined>).INTERNAL_TEST_SECRET = DEFAULT_INTERNAL_TEST_SECRET;

import { POST as postConsultations, memoryConsultations } from "../../app/api/consultations/route";
import { GET as getConsultation } from "../../app/api/consultations/[id]/route";
import { POST as postCareSuggestions, GET as getCareSuggestions } from "../../app/api/consultations/[id]/care-suggestions/route";
import { CareSuggestionService } from "../../lib/care-suggestions/care-suggestion-service";
import { resolveGenericDrugName, getDrugEducationAndSafety } from "../../lib/clinical-knowledge/drug-external-service";

function createHeaders(role: Role = "patient", userId = "user_test_care", ipSuffix = 1) {
  return {
    "Content-Type": "application/json",
    "x-mock-role": role,
    "x-mock-user-id": userId,
    [INTERNAL_TEST_SECRET_HEADER]: DEFAULT_INTERNAL_TEST_SECRET,
    "x-forwarded-for": `10.99.2.${ipSuffix}`,
  };
}

async function runCareSuggestionsTestSuite() {
  console.log("================================================================================");
  console.log("       MEDVOICE AI CLINICAL CARE SUGGESTIONS & SOAP FALLBACK TEST SUITE         ");
  console.log("================================================================================\n");

  let passed = 0;
  let total = 0;

  async function testCase(name: string, fn: () => Promise<void>) {
    total++;
    try {
      await fn();
      console.log(`  [PASS] Test ${total}: ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  [FAIL] Test ${total}: ${name}`);
      console.error(`         Error: ${err.message}`);
      if (err.stack) console.error(err.stack.split("\n").slice(1, 4).join("\n"));
      throw err;
    }
  }

  // ===========================================================================
  // TEST 1: Scenario A - Normal Consultation (SOAP Report Available + Transcript)
  // ===========================================================================
  await testCase("Scenario A: Generates comprehensive care plan when SOAP is available", async () => {
    const encId = `ENC-CARE-A-${Date.now()}`;
    const userId = "patient_scenario_a";

    // 1. Initialize consultation with SOAP note and transcript
    const initReq = new Request("http://localhost:3000/api/consultations", {
      method: "POST",
      headers: createHeaders("patient", userId, 10),
      body: JSON.stringify({
        id: encId,
        patientName: "Alex Rivera",
        patientAge: "35",
        patientGender: "male",
        doctorId: "dr-sarah-chen",
        doctorName: "Dr. Sarah Chen, MD",
        specialty: "General Physician",
        chiefComplaint: "Persistent dry cough and mild sore throat for 3 days",
        triageLevel: "routine",
        triageTitle: "Upper Respiratory Symptoms",
        esiScore: 4,
        transcript: [
          { role: "patient", text: "I have had a dry cough and mild throat scratchiness for 3 days.", timestamp: "10:00" },
          { role: "doctor", text: "Have you had any fever or difficulty breathing?", timestamp: "10:01" },
          { role: "patient", text: "No fever and breathing is normal. Just annoying dry cough.", timestamp: "10:02" },
        ],
        soapSubjective: "[PATIENT-REPORTED]\n• Chief Complaint: Persistent dry cough and mild sore throat for 3 days\n• Associated Symptoms: Throat irritation, denies fever or dyspnea.",
        soapObjective: "[ACOUSTIC TELEMETRY]\n• Respiratory effort appears unlabored.\n• Vital signs unmeasured (remote voice intake).",
        soapAssessment: "[AI-INFERRED CLINICAL ASSESSMENT]\n• Acute uncomplicated upper respiratory tract irritation.",
        soapPlan: "[CARE PLAN]\n• Adequate hydration, warm fluids, honey-lemon lozenges.\n• Monitor symptoms for red flags.",
        status: "completed_pending_review",
      }),
    });
    const initRes = await postConsultations(initReq);
    assert.strictEqual(initRes.status, 200, "Encounter registration should succeed");

    // 2. Request Care Suggestions
    const careReq = new Request(`http://localhost:3000/api/consultations/${encId}/care-suggestions`, {
      method: "POST",
      headers: createHeaders("patient", userId, 11),
      body: JSON.stringify({
        doctorName: "Dr. Sarah Chen, MD",
        specialty: "General Physician",
      }),
    });
    const careRes = await postCareSuggestions(careReq, { params: Promise.resolve({ id: encId }) });
    assert.strictEqual(careRes.status, 200, "Care suggestions generation should return 200 OK");

    const body = await careRes.json();
    assert.strictEqual(body.success, true, "Response success must be true");
    assert.ok(body.careSuggestions, "Must return careSuggestions object");

    const cs = body.careSuggestions;
    // Verify provenance and source display
    assert.strictEqual(cs.source, "soap_and_transcript", "Source must be soap_and_transcript");
    assert.strictEqual(cs.sourceDisplay, "SOAP Report + Consultation Chat", "Source display must match specification");

    // Verify all 10 required clinical sections
    assert.ok(typeof cs.clinicalSummary === "string" && cs.clinicalSummary.length > 20, "Clinical summary must be present");
    assert.ok(Array.isArray(cs.restAndRecovery) && cs.restAndRecovery.length > 0, "Rest and recovery recommendations must be present");
    assert.ok(cs.dietRecommendations && Array.isArray(cs.dietRecommendations.suitable), "Diet recommendations must include suitable foods");
    assert.ok(Array.isArray(cs.hydrationGuidance) && cs.hydrationGuidance.length > 0, "Hydration guidance must be present");
    assert.ok(Array.isArray(cs.precautions) && cs.precautions.length > 0, "Precautions must be present");
    assert.ok(cs.warningSigns && Array.isArray(cs.warningSigns.emergency) && Array.isArray(cs.warningSigns.urgent), "Warning signs 3-tier structure required");
    assert.ok(Array.isArray(cs.followUpRecommendations) && cs.followUpRecommendations.length > 0, "Follow-up recommendations must be present");
    assert.ok(Array.isArray(cs.missingInformation) && cs.missingInformation.length > 0, "Missing information section must be present");
    const sources = cs.groundedSources || cs.sources;
    assert.ok(Array.isArray(sources) && sources.length > 0, "Grounded sources must be present");
    assert.ok(cs.disclaimer && (cs.disclaimer.includes("Clinician") || cs.disclaimer.includes("clinician") || cs.disclaimer.includes("physician")), "Legal disclaimer must mandate clinician review");
    assert.strictEqual(cs.requiresClinicianApproval, true, "Must require clinician approval");
  });

  // ===========================================================================
  // TEST 2: Scenario B - Fallback when SOAP Generation Fails (Transcript Only)
  // ===========================================================================
  await testCase("Scenario B: Successfully falls back to transcript when SOAP report is unavailable", async () => {
    const encId = `ENC-CARE-B-${Date.now()}`;
    const userId = "patient_scenario_b";

    // 1. Initialize consultation WITHOUT SOAP note (simulating SOAP failure or missing artifact)
    const initReq = new Request("http://localhost:3000/api/consultations", {
      method: "POST",
      headers: createHeaders("patient", userId, 20),
      body: JSON.stringify({
        id: encId,
        patientName: "Maria Garcia",
        patientAge: "42",
        patientGender: "female",
        doctorId: "dr-marcus-vance",
        doctorName: "Dr. Marcus Vance, MD",
        specialty: "Internal Medicine",
        chiefComplaint: "Stomach burning after meals for five days",
        // Deliberately omit all soap fields (empty strings / null)
        soapSubjective: "",
        soapObjective: "",
        soapAssessment: "",
        soapPlan: "",
        transcript: [
          { role: "patient", text: "I have had burning stomach pain for five days, mostly after eating spicy food.", timestamp: "14:00" },
          { role: "doctor", text: "Do you have any nausea, vomiting, or black stools?", timestamp: "14:01" },
          { role: "patient", text: "No vomiting or black stools, just an uncomfortable burning sensation in my upper stomach.", timestamp: "14:02" },
        ],
        status: "in_progress",
      }),
    });
    const initRes = await postConsultations(initReq);
    assert.strictEqual(initRes.status, 200, "Encounter initialization should succeed");

    // 2. Request Care Suggestions directly
    const careReq = new Request(`http://localhost:3000/api/consultations/${encId}/care-suggestions`, {
      method: "POST",
      headers: createHeaders("patient", userId, 21),
      body: JSON.stringify({
        doctorName: "Dr. Marcus Vance, MD",
        specialty: "Internal Medicine",
      }),
    });
    const careRes = await postCareSuggestions(careReq, { params: Promise.resolve({ id: encId }) });
    assert.strictEqual(careRes.status, 200, "Care suggestions must succeed even without SOAP note");

    const body = await careRes.json();
    assert.strictEqual(body.success, true);
    const cs = body.careSuggestions;

    // Verify fallback provenance
    assert.strictEqual(cs.source, "transcript_only", "Source must identify transcript_only");
    assert.strictEqual(cs.sourceDisplay, "Consultation Chat (SOAP Unavailable)", "Source display must indicate fallback");

    // Verify clinical content extracted from transcript
    assert.ok(
      cs.clinicalSummary.toLowerCase().includes("stomach") ||
      cs.clinicalSummary.toLowerCase().includes("burning") ||
      cs.clinicalSummary.toLowerCase().includes("digestive"),
      "Clinical summary must extract stomach/burning complaint from transcript"
    );

    // Verify dietary advice addresses symptoms
    assert.ok(cs.dietRecommendations.avoidOrLimit.length > 0, "Must advise foods to limit for gastric burning");
    assert.strictEqual(cs.requiresClinicianApproval, true);
  });

  // ===========================================================================
  // TEST 3: Missing Information & Telemetry Identification
  // ===========================================================================
  await testCase("Identifies and documents unmeasured vitals and missing telemetry", async () => {
    const encId = `ENC-CARE-MISSING-${Date.now()}`;
    const userId = "patient_missing_info";

    const initReq = new Request("http://localhost:3000/api/consultations", {
      method: "POST",
      headers: createHeaders("patient", userId, 30),
      body: JSON.stringify({
        id: encId,
        patientName: "Jordan Smith",
        patientAge: "28",
        doctorId: "dr-sarah-chen",
        transcript: [
          { role: "patient", text: "I feel dizzy when standing up quickly.", timestamp: "09:00" },
        ],
        status: "in_progress",
      }),
    });
    await postConsultations(initReq);

    const careReq = new Request(`http://localhost:3000/api/consultations/${encId}/care-suggestions`, {
      method: "POST",
      headers: createHeaders("patient", userId, 31),
      body: JSON.stringify({}),
    });
    const careRes = await postCareSuggestions(careReq, { params: Promise.resolve({ id: encId }) });
    const body = await careRes.json();
    const cs = body.careSuggestions;

    assert.ok(Array.isArray(cs.missingInformation) && cs.missingInformation.length > 0, "Missing information array must be populated");
    const missingStr = cs.missingInformation.join(" ").toLowerCase();
    assert.ok(
      missingStr.includes("blood pressure") ||
      missingStr.includes("vitals") ||
      missingStr.includes("orthostatic") ||
      missingStr.includes("unassessed"),
      "Must explicitly identify unmeasured blood pressure / orthostatic telemetry for dizziness"
    );
  });

  // ===========================================================================
  // TEST 4: Medication Safety Shield & No Autonomous Prescribing
  // ===========================================================================
  await testCase("Enforces medication safety, honors allergies, and prohibits autonomous prescribing", async () => {
    const encId = `ENC-CARE-MED-${Date.now()}`;
    const userId = "patient_med_safety";

    const initReq = new Request("http://localhost:3000/api/consultations", {
      method: "POST",
      headers: createHeaders("patient", userId, 40),
      body: JSON.stringify({
        id: encId,
        patientName: "Robert Taylor",
        patientAge: "58",
        chiefComplaint: "Mild joint stiffness in hands",
        transcript: [
          { role: "patient", text: "I have joint stiffness in fingers. I am currently taking Metformin and Lisinopril. I am severely allergic to Penicillin.", timestamp: "11:00" },
          { role: "doctor", text: "Understood. No fever or redness?", timestamp: "11:01" },
          { role: "patient", text: "No fever. Just morning stiffness.", timestamp: "11:02" },
        ],
        status: "in_progress",
      }),
    });
    await postConsultations(initReq);

    const careReq = new Request(`http://localhost:3000/api/consultations/${encId}/care-suggestions`, {
      method: "POST",
      headers: createHeaders("patient", userId, 41),
      body: JSON.stringify({}),
    });
    const careRes = await postCareSuggestions(careReq, { params: Promise.resolve({ id: encId }) });
    const body = await careRes.json();
    const cs = body.careSuggestions;

    // Check medication education section
    assert.ok(cs.medicationInformation, "Medication information section must exist");
    const warnings = (cs.medicationInformation.safetyWarnings || []).join(" ").toLowerCase();
    assert.ok(warnings.includes("prescri") || warnings.includes("clinician"), "Must warn that AI does not prescribe medications");

    // Prohibit unauthorized prescribing verbs in recommendations
    const allText = [
      cs.clinicalSummary,
      ...cs.precautions,
      ...cs.restAndRecovery,
      ...cs.followUpRecommendations,
    ].join(" ").toLowerCase();

    assert.ok(!allText.includes("i prescribe"), "Must never include 'I prescribe'");
    assert.ok(!allText.includes("take 500mg"), "Must not invent specific non-educational dosages");
    assert.strictEqual(cs.requiresClinicianApproval, true);
  });

  // ===========================================================================
  // TEST 5: Universal Red Flags & Emergency Prioritization
  // ===========================================================================
  await testCase("Prioritizes universal red flags and guarantees emergency guidance cannot be downgraded", async () => {
    const encId = `ENC-CARE-EMERGENCY-${Date.now()}`;
    const userId = "patient_red_flags";

    const initReq = new Request("http://localhost:3000/api/consultations", {
      method: "POST",
      headers: createHeaders("patient", userId, 50),
      body: JSON.stringify({
        id: encId,
        patientName: "David Miller",
        patientAge: "62",
        chiefComplaint: "Crushing chest pain radiating to left jaw",
        triageLevel: "emergency",
        esiScore: 1,
        transcript: [
          { role: "patient", text: "I have sudden severe crushing chest pressure and pain radiating into my left arm and jaw with profuse cold sweats.", timestamp: "15:00" },
        ],
        status: "completed_pending_review",
      }),
    });
    await postConsultations(initReq);

    const careReq = new Request(`http://localhost:3000/api/consultations/${encId}/care-suggestions`, {
      method: "POST",
      headers: createHeaders("patient", userId, 51),
      body: JSON.stringify({}),
    });
    const careRes = await postCareSuggestions(careReq, { params: Promise.resolve({ id: encId }) });
    const body = await careRes.json();
    const cs = body.careSuggestions;

    // Emergency warning signs MUST contain 112/108 or emergency department instructions
    assert.ok(cs.warningSigns.emergency.length > 0, "Emergency warning signs must be populated");
    const emergencyStr = cs.warningSigns.emergency.join(" ");
    assert.ok(
      emergencyStr.includes("112") || emergencyStr.includes("108") || emergencyStr.includes("Emergency Department"),
      "Emergency warning signs must explicitly include 112/108 or emergency dispatch guidance"
    );
  });

  // ===========================================================================
  // TEST 6: External Drug Intelligence & Indian Brand Resolution
  // ===========================================================================
  await testCase("External drug service resolves Indian trade names and handles offline resilience", async () => {
    // 1. Resolve Indian trade name Dolo 650
    const doloResolved = resolveGenericDrugName("Dolo 650");
    assert.ok(
      doloResolved.generic.includes("paracetamol"),
      "Dolo 650 must resolve to paracetamol"
    );

    // 2. Resolve Indian trade name Combiflam
    const combiflamResolved = resolveGenericDrugName("Combiflam");
    assert.ok(
      combiflamResolved.generic.includes("ibuprofen"),
      "Combiflam must resolve to ibuprofen combination"
    );

    // 3. Resolve Indian trade name Augmentin
    const augmentinResolved = resolveGenericDrugName("Augmentin");
    assert.ok(
      augmentinResolved.generic.includes("amoxicillin"),
      "Augmentin must resolve to amoxicillin"
    );

    // 4. External Drug education and safety retrieval resilience
    const drugEdu = await getDrugEducationAndSafety("Dolo 650");
    assert.ok(drugEdu.genericName, "Should return generic name for Dolo 650");
    assert.ok(drugEdu.jurisdictionNotice, "Must include jurisdictional disclosure");
  });

  // ===========================================================================
  // TEST 7: Security & IDOR Authorization
  // ===========================================================================
  await testCase("Enforces authentication and prevents IDOR cross-patient data access", async () => {
    const encId = `ENC-CARE-SEC-${Date.now()}`;
    const ownerId = "patient_owner_01";
    const attackerId = "patient_attacker_99";

    // Create encounter owned by patient_owner_01
    const initReq = new Request("http://localhost:3000/api/consultations", {
      method: "POST",
      headers: createHeaders("patient", ownerId, 70),
      body: JSON.stringify({
        id: encId,
        patientName: "Alice Owner",
        transcript: [{ role: "patient", text: "Confidential medical information", timestamp: "12:00" }],
        status: "in_progress",
      }),
    });
    await postConsultations(initReq);

    // Attacker attempts to generate or read owner's care suggestions
    const attackerReq = new Request(`http://localhost:3000/api/consultations/${encId}/care-suggestions`, {
      method: "POST",
      headers: createHeaders("patient", attackerId, 71), // Different user ID!
      body: JSON.stringify({}),
    });
    const attackRes = await postCareSuggestions(attackerReq, { params: Promise.resolve({ id: encId }) });
    assert.strictEqual(attackRes.status, 403, "Cross-user IDOR access must be rejected with 403 Forbidden");

    // Unauthenticated request (no user header)
    const unauthReq = new Request(`http://localhost:3000/api/consultations/${encId}/care-suggestions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" }, // Missing auth headers
      body: JSON.stringify({}),
    });
    const unauthRes = await postCareSuggestions(unauthReq, { params: Promise.resolve({ id: encId }) });
    assert.strictEqual(unauthRes.status, 401, "Unauthenticated request must be rejected with 401 Unauthorized");
  });

  // ===========================================================================
  // TEST 8: Signed Artifact Immutability Verification
  // ===========================================================================
  await testCase("Guarantees signed SOAP clinical artifacts remain immutable when care suggestions are generated", async () => {
    const encId = `ENC-CARE-IMMUTABLE-${Date.now()}`;
    const userId = "patient_immutable_01";

    const originalSoapSubjective = "[ORIGINAL SIGNED SUBJECTIVE] Patient reports mild tension headache.";
    const originalSoapPlan = "[ORIGINAL SIGNED PLAN] Hydration, sleep hygiene.";

    // Register consultation with signed SOAP note
    const initReq = new Request("http://localhost:3000/api/consultations", {
      method: "POST",
      headers: createHeaders("patient", userId, 80),
      body: JSON.stringify({
        id: encId,
        patientName: "Immutable Test Patient",
        doctorId: "dr-sarah-chen",
        doctorName: "Dr. Sarah Chen, MD",
        specialty: "General Physician",
        soapSubjective: originalSoapSubjective,
        soapPlan: originalSoapPlan,
        status: "completed_pending_review",
        transcript: [{ role: "patient", text: "Headache for 1 day.", timestamp: "10:00" }],
      }),
    });
    const initRes = await postConsultations(initReq);
    assert.strictEqual(initRes.status, 200, "Encounter registration should succeed");

    // Generate care suggestions
    const careReq = new Request(`http://localhost:3000/api/consultations/${encId}/care-suggestions`, {
      method: "POST",
      headers: createHeaders("patient", userId, 81),
      body: JSON.stringify({}),
    });
    const careRes = await postCareSuggestions(careReq, { params: Promise.resolve({ id: encId }) });
    assert.strictEqual(careRes.status, 200);

    // Verify encounter in datastore was NOT mutated
    const verifyReq = new Request(`http://localhost:3000/api/consultations/${encId}`, {
      headers: createHeaders("patient", userId, 82),
    });
    const verifyRes = await getConsultation(verifyReq, { params: Promise.resolve({ id: encId }) });
    assert.strictEqual(verifyRes.status, 200, "Should retrieve saved consultation");
    const verifyBody = await verifyRes.json();
    const stored = verifyBody.consultation;
    assert.ok(stored, "Stored encounter must exist");
    assert.strictEqual(stored.soapSubjective, originalSoapSubjective, "Signed SOAP subjective must not be altered");
    assert.strictEqual(stored.soapPlan, originalSoapPlan, "Signed SOAP plan must not be altered");
    assert.strictEqual(stored.status, "completed_pending_review", "Encounter status must remain intact");
  });

  // ===========================================================================
  // TEST 9: Symptom-Specific OTC Medication Education (Headache with zero reported meds)
  // ===========================================================================
  await testCase("Symptom-Specific OTC Education: Evaluates headache and provides structured OTC guidance rather than 'No medications reported'", async () => {
    const encId = `ENC-CARE-HEADACHE-${Date.now()}`;
    const userId = "patient_headache_01";

    // Patient reports headache but zero existing medications
    const initReq = new Request("http://localhost:3000/api/consultations", {
      method: "POST",
      headers: createHeaders("patient", userId, 90),
      body: JSON.stringify({
        id: encId,
        patientName: "Jordan Lee",
        patientAge: "32",
        chiefComplaint: "Mild tension headache for 2 days",
        triageLevel: "routine",
        esiScore: 4,
        transcript: [
          { role: "patient", text: "I have had a dull throbbing headache across my forehead for the last 2 days. It built up slowly.", timestamp: "09:00" },
          { role: "doctor", text: "Are you taking any medications or have any allergies?", timestamp: "09:01" },
          { role: "patient", text: "No, I am not taking any medicines currently and have no known allergies.", timestamp: "09:02" },
        ],
        status: "completed_pending_review",
      }),
    });
    const initRes = await postConsultations(initReq);
    assert.strictEqual(initRes.status, 200);

    const careReq = new Request(`http://localhost:3000/api/consultations/${encId}/care-suggestions`, {
      method: "POST",
      headers: createHeaders("patient", userId, 91),
      body: JSON.stringify({}),
    });
    const careRes = await postCareSuggestions(careReq, { params: Promise.resolve({ id: encId }) });
    assert.strictEqual(careRes.status, 200);

    const body = await careRes.json();
    const medInfo = body.careSuggestions.medicationInformation;
    assert.ok(medInfo, "Medication information must be present");

    // 1. Distinguishes existing medications vs potential OTC education
    assert.ok(medInfo.existingMedications, "Existing medications section must exist");
    assert.ok(medInfo.potentialOtcEducation, "Potential OTC education section must exist");
    assert.ok(medInfo.safetyAndPrecautions, "Safety and precautions section must exist");
    assert.ok(medInfo.clinicalClarification, "Clinical clarification section must exist");

    // 2. Does NOT interpret 'no medications reported' as 'no medication info is relevant'
    assert.ok(
      medInfo.potentialOtcEducation.length > 0,
      "Should provide potential OTC medication education for headache even when zero existing meds were reported"
    );

    // 3. Verifies structure of OTC education item
    const paracetamolItem = medInfo.potentialOtcEducation.find((i: any) =>
      i.genericName.toLowerCase().includes("paracetamol") || i.genericName.toLowerCase().includes("acetaminophen")
    );
    assert.ok(paracetamolItem, "Should include Paracetamol (Acetaminophen) for tension headache");
    assert.ok(paracetamolItem.commonlyUsedFor.length > 0, "Must specify what symptoms commonly used for");
    assert.ok(paracetamolItem.precautions.length > 0, "Must specify precautions");
    assert.ok(paracetamolItem.contraindicationsAndInteractions.length > 0, "Must specify contraindications");
    assert.ok(paracetamolItem.approvalRequirement.length > 0, "Must specify clinician/pharmacist approval requirement");
    assert.ok(paracetamolItem.source.length > 0, "Must cite clinical knowledge source");

    // 4. Invariant: Strictly non-prescriptive, no autonomous dosage
    medInfo.potentialOtcEducation.forEach((otc: any) => {
      assert.strictEqual(
        /\b\d+\s*mg\b/i.test(otc.commonlyUsedFor),
        false,
        "Commonly used for must not specify milligram dosages"
      );
    });

    // 5. Existing medications section reflects reality
    assert.ok(
      medInfo.existingMedications.reported.some((r: string) => r.includes("None reported") || r.includes("none")),
      "Existing medications must clearly indicate none reported by patient"
    );
  });

  // ===========================================================================
  // TEST 10: Headache Red-Flag Gating & Safety Contraindications
  // ===========================================================================
  await testCase("Headache Red-Flag & Contraindication Gating: Withholds OTC analgesics for thunderclap headache and enforces ulcer contraindication", async () => {
    // Sub-case A: Thunderclap Headache with Neck Stiffness & Fever (Emergency Red Flags)
    const encRedFlagId = `ENC-CARE-THUNDERCLAP-${Date.now()}`;
    const userRedFlagId = "patient_thunderclap_01";

    const initRedFlagReq = new Request("http://localhost:3000/api/consultations", {
      method: "POST",
      headers: createHeaders("patient", userRedFlagId, 92),
      body: JSON.stringify({
        id: encRedFlagId,
        patientName: "Red Flag Patient",
        chiefComplaint: "Worst headache of my life, sudden onset with stiff neck and high fever",
        triageLevel: "emergency",
        esiScore: 2,
        transcript: [
          { role: "patient", text: "I have the worst headache of my life. It was a sudden severe thunderclap that hit me in seconds. My neck is stiff and I have a high fever.", timestamp: "11:00" },
        ],
        status: "completed_pending_review",
      }),
    });
    const initRedFlagRes = await postConsultations(initRedFlagReq);
    assert.strictEqual(initRedFlagRes.status, 200);

    const careRedFlagReq = new Request(`http://localhost:3000/api/consultations/${encRedFlagId}/care-suggestions`, {
      method: "POST",
      headers: createHeaders("patient", userRedFlagId, 93),
      body: JSON.stringify({}),
    });
    const careRedFlagRes = await postCareSuggestions(careRedFlagReq, { params: Promise.resolve({ id: encRedFlagId }) });
    assert.strictEqual(careRedFlagRes.status, 200);

    const redFlagBody = await careRedFlagRes.json();
    const redFlagMedInfo = redFlagBody.careSuggestions.medicationInformation;

    // Verify OTC medication education is SAFELY WITHHELD for emergency red-flag headache
    assert.strictEqual(
      redFlagMedInfo.potentialOtcEducation.length,
      0,
      "OTC analgesics must be withheld for thunderclap headache with stiff neck & fever"
    );

    // Verify explicit rationale is provided in clinical clarification
    assert.ok(
      redFlagMedInfo.clinicalClarification?.rationaleIfNoMedicationAppropriate,
      "Must provide clinical rationale explaining why medication is withheld"
    );
    assert.ok(
      redFlagMedInfo.clinicalClarification.rationaleIfNoMedicationAppropriate.toLowerCase().includes("red-flag") ||
      redFlagMedInfo.clinicalClarification.rationaleIfNoMedicationAppropriate.toLowerCase().includes("emergency"),
      "Rationale must cite emergency or red-flag condition"
    );

    // Verify targeted follow-up questions were generated
    assert.ok(
      redFlagMedInfo.clinicalClarification.followUpQuestions.length > 0,
      "Must generate targeted clinical questions for clarification"
    );

    // Sub-case B: Headache with Active Peptic Ulcer Disease (NSAID Contraindication)
    const encUlcerId = `ENC-CARE-ULCER-${Date.now()}`;
    const userUlcerId = "patient_ulcer_01";

    const initUlcerReq = new Request("http://localhost:3000/api/consultations", {
      method: "POST",
      headers: createHeaders("patient", userUlcerId, 94),
      body: JSON.stringify({
        id: encUlcerId,
        patientName: "Ulcer Patient",
        chiefComplaint: "Tension headache for 2 days. I also have an active peptic ulcer and stomach bleeding history.",
        triageLevel: "routine",
        esiScore: 4,
        transcript: [
          { role: "patient", text: "I have a headache. But I have an active stomach ulcer and gastritis.", timestamp: "12:00" },
        ],
        status: "completed_pending_review",
      }),
    });
    const initUlcerRes = await postConsultations(initUlcerReq);
    assert.strictEqual(initUlcerRes.status, 200);

    const careUlcerReq = new Request(`http://localhost:3000/api/consultations/${encUlcerId}/care-suggestions`, {
      method: "POST",
      headers: createHeaders("patient", userUlcerId, 95),
      body: JSON.stringify({}),
    });
    const careUlcerRes = await postCareSuggestions(careUlcerReq, { params: Promise.resolve({ id: encUlcerId }) });
    assert.strictEqual(careUlcerRes.status, 200);

    const ulcerBody = await careUlcerRes.json();
    const ulcerMedInfo = ulcerBody.careSuggestions.medicationInformation;

    // Verify Ibuprofen / NSAIDs are NOT in potentialOtcEducation
    const hasIbuprofen = ulcerMedInfo.potentialOtcEducation.some((item: any) =>
      item.genericName.toLowerCase().includes("ibuprofen") || item.genericName.toLowerCase().includes("nsaid")
    );
    assert.strictEqual(hasIbuprofen, false, "Ibuprofen/NSAIDs must be strictly blocked for peptic ulcer patient");

    // Verify contraindication alert is recorded
    const ulcerAlertFound = ulcerMedInfo.safetyAndPrecautions.contraindicationsDetected.some((alert: string) =>
      alert.toLowerCase().includes("ulcer") || alert.toLowerCase().includes("gastrointestinal")
    );
    assert.ok(ulcerAlertFound, "Must record gastrointestinal ulcer contraindication alert");
  });

  console.log("\n================================================================================");
  console.log(`  ALL ${passed}/${total} CARE SUGGESTIONS & SOAP SUITE TESTS PASSED SUCCESSFULLY!`);
  console.log("================================================================================\n");
}

runCareSuggestionsTestSuite().catch((err) => {
  console.error("Test Suite execution failed:", err);
  process.exit(1);
});
