/**
 * MedVoice Context-Aware Chatbot Integration & Non-Interrogation Battery
 *
 * Verifies:
 * 1. Profile prompt assembly with Non-Interrogation Doctrine (Rule 6)
 * 2. Missing data discipline (No initial questionnaire; age asked only when clinically pertinent)
 * 3. Confirmed clinical history utilization (profile conditions & meds factored in without redundant questions)
 * 4. Multi-subject attribution (Caregiver vs Patient identity separation)
 * 5. Deterministic safety arbiter preemption over profile data (Universal red flags take 100% precedence)
 *
 * Execution:
 *   npx tsx tests/patient-profile/context-aware-chat.test.ts
 */

import { buildDoctorSystemPrompt } from "../../lib/ai/clinical-llm";
import { PatientProfileService, memoryProfiles } from "../../lib/patient/patient-profile-service";
import { evaluateUniversalRedFlags } from "../../lib/triage/universal-red-flags";
import { PatientProfile, CallerProfile } from "../../lib/clinical-knowledge/types";

let passedCount = 0;
let failedCount = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    passedCount++;
    console.log(`  ✓ PASS: ${testName}`);
  } else {
    failedCount++;
    console.error(`  ✗ FAIL: ${testName}${detail ? ` - ${detail}` : ""}`);
  }
}

async function runContextAwareChatTests() {
  console.log("==================================================================");
  console.log("TEST SUITE 2: CONTEXT-AWARE CHATBOT & NON-INTERROGATION DOCTRINE");
  console.log("==================================================================");

  memoryProfiles.clear();
  const caregiverId = "user_caregiver_chat_test";

  // Setup test profiles
  const selfProfile = await PatientProfileService.upsertProfile(caregiverId, {
    name: "Marcus Vance",
    relationshipToUser: "self",
    age: 42,
    sexAssignedAtBirth: "male",
    knownConditions: ["Mild Asthma"],
    currentMedications: [{ name: "Albuterol Inhaler", dose: "90mcg", frequency: "as needed" }],
    allergyStatus: "none_known"
  });

  const motherProfile = await PatientProfileService.upsertProfile(caregiverId, {
    name: "Eleanor Vance",
    relationshipToUser: "parent",
    dateOfBirth: "1948-03-12",
    age: 78,
    sexAssignedAtBirth: "female",
    knownConditions: ["Type 2 Diabetes", "Hypertension"],
    currentMedications: [
      { name: "Metformin", dose: "500mg", frequency: "twice daily" },
      { name: "Amlodipine", dose: "5mg", frequency: "daily" }
    ],
    allergyStatus: "confirmed",
    drugAllergies: [{ drugName: "Penicillin", severity: "severe", reactionType: "allergy", reactionDescription: "Hives and swelling" }],
    emergencyContact: { name: "Marcus Vance", phone: "+1-555-0199", relationship: "Son" }
  });

  const childProfile = await PatientProfileService.upsertProfile(caregiverId, {
    name: "Leo Vance",
    relationshipToUser: "child",
    dateOfBirth: "2021-08-15",
    age: 5,
    sexAssignedAtBirth: "male",
    knownConditions: ["Eczema"]
  });

  // -----------------------------------------------------------------------------
  // Test 1: Context-Aware Profile Prompt Assembly
  // -----------------------------------------------------------------------------
  console.log("\n[Group 1] Context-Aware Profile System Prompt Assembly");
  try {
    const promptWithProfile = buildDoctorSystemPrompt(
      undefined,
      [],
      selfProfile,
      {
        id: "caller_marcus",
        name: "Marcus Vance",
        relationshipToPatient: "self"
      },
      "self"
    );

    assert(promptWithProfile.includes("PATIENT PROFILE LAYER"), "System prompt contains PATIENT PROFILE LAYER");
    assert(promptWithProfile.includes("Marcus Vance"), "Patient name included in prompt context");
    assert(promptWithProfile.includes("42 years old"), "Patient age accurately formatted in prompt context");
    assert(promptWithProfile.includes("Mild Asthma"), "Known condition injected into LLM context");
    assert(promptWithProfile.includes("Albuterol Inhaler"), "Current medication injected into LLM context");
    assert(promptWithProfile.includes("CONTEXT-AWARE PROFILE DOCTRINE"), "Prompt includes Rule 6: Context-Aware Profile Doctrine");
  } catch (err: any) {
    assert(false, "Profile prompt assembly failed", err.message);
  }

  // -----------------------------------------------------------------------------
  // Test 2: Non-Interrogation Doctrine & Missing Data Discipline
  // -----------------------------------------------------------------------------
  console.log("\n[Group 2] Non-Interrogation Invariant & Missing Data Discipline");
  try {
    // Construct partial profile with missing fields (e.g. unknown DOB, no surgical history, no allergies)
    const partialProfile: PatientProfile = {
      id: "partial_profile_001",
      userId: "user_partial",
      name: "Jordan Lee",
      relationshipToUser: "self",
      language: "en",
      knownConditions: ["Migraine"],
      currentMedications: [],
      drugAllergies: [],
      surgicalHistory: []
    };

    const partialPrompt = buildDoctorSystemPrompt(
      undefined,
      [],
      partialProfile,
      { id: "caller_jordan", name: "Jordan Lee", relationshipToPatient: "self" },
      "self"
    );

    assert(
      partialPrompt.includes("Do NOT conduct a intake questionnaire or interrogate the patient for blank profile fields"),
      "Explicit directive against intake questionnaires on conversation start"
    );
    assert(
      partialPrompt.includes("Focus exclusively on their chief complaint"),
      "Instruction to focus on chief complaint rather than administrative gaps"
    );
    assert(
      partialPrompt.includes("Ask for missing clinical factors (such as age or pregnancy status) ONLY when clinically pertinent"),
      "Age requested only when clinically pertinent with rationale"
    );
    assert(
      partialPrompt.includes("Always state the clinical reason why you are asking"),
      "Mandate for stating clinical justification when asking for missing demographic context"
    );
  } catch (err: any) {
    assert(false, "Non-interrogation prompt check failed", err.message);
  }

  // -----------------------------------------------------------------------------
  // Test 3: Confirmed Clinical History Utilization
  // -----------------------------------------------------------------------------
  console.log("\n[Group 3] Confirmed Clinical History Utilization");
  try {
    const motherPrompt = buildDoctorSystemPrompt(
      undefined,
      [],
      motherProfile,
      { id: "caller_marcus", name: "Marcus Vance", relationshipToPatient: "child" },
      "mother"
    );

    assert(motherPrompt.includes("Eleanor Vance"), "Mother's name in prompt");
    assert(motherPrompt.includes("Type 2 Diabetes"), "Mother's diabetes present in prompt");
    assert(motherPrompt.includes("Penicillin (severe: Hives and swelling)"), "Drug allergy details with severity present");
    assert(
      motherPrompt.includes("Seamlessly use confirmed profile facts"),
      "Directive to seamlessly use confirmed profile facts"
    );
    assert(
      motherPrompt.includes("Do NOT ask 'Do you have diabetes?' if the profile already confirms diabetes"),
      "Explicit rule prohibiting asking for already-confirmed conditions"
    );
    assert(
      motherPrompt.includes("Patient corrections always override stored profile facts"),
      "Patient verbal correction takes precedence over stored profile"
    );
  } catch (err: any) {
    assert(false, "Confirmed history prompt test failed", err.message);
  }

  // -----------------------------------------------------------------------------
  // Test 4: Single-Patient Identity Invariant & Third-Party Record Isolation
  // -----------------------------------------------------------------------------
  console.log("\n[Group 4] Single-Patient Identity Invariant & Third-Party Record Isolation");
  try {
    // Scenario A: Caller speaks for themselves
    const selfResolution = await PatientProfileService.resolveTargetPatientProfile(
      caregiverId,
      "I have had a mild dry cough for three days",
      undefined,
      "self"
    );
    assert(selfResolution.inferredSubject === "self", "Self utterance infers 'self' subject");
    assert(selfResolution.profile?.name === "Marcus Vance", "Self utterance resolves caller's locked self profile");
    assert(!selfResolution.thirdPartyDetected, "No third-party detected for self utterance");

    // Scenario B: Caller mentions their mother (Single-Patient Model: Profile remains locked to self)
    const motherResolution = await PatientProfileService.resolveTargetPatientProfile(
      caregiverId,
      "My mother has a fever and her blood sugar reading is 240 this morning",
      undefined,
      undefined
    );
    assert(motherResolution.inferredSubject === "self", "Mother utterance keeps active subject locked to 'self'");
    assert(motherResolution.profile?.name === "Marcus Vance", "Mother utterance preserves caller's self profile");
    assert(motherResolution.thirdPartyDetected === true, "Mother mention accurately flags thirdPartyDetected: true");
    assert(motherResolution.thirdPartyRelation === "mother", "Identifies thirdPartyRelation as 'mother'");

    // Scenario C: Caller mentions their child (Profile remains locked to self)
    const childResolution = await PatientProfileService.resolveTargetPatientProfile(
      caregiverId,
      "My child Leo broke out in a rash on his arms",
      undefined,
      undefined
    );
    assert(childResolution.inferredSubject === "self", "Child utterance keeps active subject locked to 'self'");
    assert(childResolution.profile?.name === "Marcus Vance", "Child utterance preserves caller's self profile");
    assert(childResolution.thirdPartyDetected === true, "Child mention accurately flags thirdPartyDetected: true");
    assert(childResolution.thirdPartyRelation === "child", "Identifies thirdPartyRelation as 'child'");

    // Scenario D: Prompt injection of third-party clinical boundary
    const boundaryPrompt = buildDoctorSystemPrompt({
      patientProfile: selfProfile,
      callerProfile: {
        id: "caller_marcus",
        name: "Marcus Vance",
        relationshipToPatient: "self"
      },
      inferredSubject: "self",
      thirdPartyMention: "mother"
    });
    assert(
      boundaryPrompt.includes("THIRD-PARTY CLINICAL CONTEXT & PATIENT RECORD BOUNDARY"),
      "Doctor prompt includes THIRD-PARTY CLINICAL CONTEXT & PATIENT RECORD BOUNDARY"
    );
    assert(
      boundaryPrompt.includes("DO NOT record or attribute these symptoms to the account holder's personal health record"),
      "Doctor prompt contains strict instruction not to attribute third-party symptoms to account holder"
    );
    assert(
      boundaryPrompt.includes("concerns about someone else (mother)"),
      "Doctor prompt specifies the mentioned third-party relationship (mother)"
    );
  } catch (err: any) {
    assert(false, "Subject attribution test failed", err.message);
  }

  // -----------------------------------------------------------------------------
  // Test 5: Deterministic Safety Arbiter Precedence Over Profile
  // -----------------------------------------------------------------------------
  console.log("\n[Group 5] Deterministic Safety Arbiter Precedence Over Profile");
  try {
    // Even if the profile describes a healthy 42yo or an elderly diabetic,
    // universal red flags must trigger EMERGENCY_NOW deterministically.

    const testEmergencies = [
      { text: "There is an elephant sitting on my chest and I cannot breathe", expect: "EMERGENCY_NOW" },
      { text: "My mother suddenly cannot speak properly and her face is drooping", expect: "EMERGENCY_NOW" },
      { text: "Ate prawns, now her lips and tongue are swelling and she is wheezing", expect: "EMERGENCY_NOW" },
      { text: "He drank pesticide and is having seizures", expect: "EMERGENCY_NOW" },
      { text: "The bleeding will not stop and I feel faint", expect: "EMERGENCY_NOW" }
    ];

    for (const testCase of testEmergencies) {
      const screenResult = evaluateUniversalRedFlags({ rawText: testCase.text });
      assert(
        screenResult.level === "EMERGENCY_NOW",
        `Emergency '${testCase.text.slice(0, 35)}...' triggers EMERGENCY_NOW immediately`
      );
      assert(
        screenResult.firedRules.length > 0,
        `Emergency fires deterministic safety rules (${screenResult.firedRules.map(r => r.ruleId).join(", ")})`
      );
    }
  } catch (err: any) {
    assert(false, "Deterministic safety arbiter precedence test failed", err.message);
  }

  // -----------------------------------------------------------------------------
  // Final Reconciliation
  // -----------------------------------------------------------------------------
  console.log("\n==================================================================");
  console.log(`SUMMARY: ${passedCount} passed, ${failedCount} failed`);
  console.log("==================================================================");

  if (failedCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runContextAwareChatTests().catch((err) => {
  console.error("Test execution fatal crash:", err);
  process.exit(1);
});
