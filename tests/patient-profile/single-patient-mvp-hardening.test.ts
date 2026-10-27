/**
 * MedVoice Single-Patient MVP Hardening & Identity Acceptance Battery
 *
 * Verifies:
 * 1. Finding B: A self-profile is never created by converting a legacy dependent profile.
 * 2. Finding C: A consultation cannot reference a profile that isn't the account holder's authorized self-profile.
 * 3. Finding A: A third-party chest-pain or stroke-like report gets urgent guidance without polluting the account holder's persisted clinical history.
 * 4. Hardening Point: Comprehensive third-party detection (grandparents, siblings, partners, extended family, third-person pronouns).
 * 5. Finding D: Longitudinal memory continuity, atomic superseding, and doctor prompt re-evaluation across encounters.
 *
 * Execution:
 *   npx tsx tests/patient-profile/single-patient-mvp-hardening.test.ts
 */

import assert from "assert";
import { POST as postVoiceChat } from "../../app/api/voice/chat/route";
import { POST as postConsultation, memoryConsultations } from "../../app/api/consultations/route";
import { PatientProfileService, memoryProfiles } from "../../lib/patient/patient-profile-service";
import { LongitudinalFactService, memoryLongitudinalFacts } from "../../lib/patient/longitudinal-fact-service";
import { extractLongitudinalCandidate } from "../../lib/patient/longitudinal-fact-extractor";
import { buildDoctorSystemPrompt } from "../../lib/ai/clinical-llm";
import { ConversationManager } from "../../lib/triage/conversation-manager";
import { DEFAULT_INTERNAL_TEST_SECRET, INTERNAL_TEST_SECRET_HEADER, Role } from "../../lib/auth/rbac";
import { setCustomDbClient } from "../../config/db";

(process.env as Record<string, string | undefined>).NODE_ENV = "test";
(process.env as Record<string, string | undefined>).INTERNAL_TEST_SECRET = DEFAULT_INTERNAL_TEST_SECRET;

function createTestHeaders(role: Role, userId: string, extra: Record<string, string> = {}) {
  return {
    "x-mock-role": role,
    "x-mock-user-id": userId,
    [INTERNAL_TEST_SECRET_HEADER]: DEFAULT_INTERNAL_TEST_SECRET,
    ...extra,
  };
}

let passedCount = 0;
let failedCount = 0;

function testPass(name: string) {
  passedCount++;
  console.log(`  ✓ PASS: ${name}`);
}

function testFail(name: string, err: any) {
  failedCount++;
  console.error(`  ✗ FAIL: ${name} -`, err?.message || err);
}

async function runHardeningBattery() {
  console.log("================================================================================");
  console.log("  SINGLE-PATIENT MVP HARDENING & IDENTITY ACCEPTANCE BATTERY                    ");
  console.log("================================================================================");

  // Use isolated in-memory stores for fast deterministic execution
  setCustomDbClient(false);
  memoryProfiles.clear();
  memoryConsultations.length = 0;
  memoryLongitudinalFacts.length = 0;

  // ---------------------------------------------------------------------------
  // TEST 1: Finding B — Legacy Dependent Profile Protection
  // ---------------------------------------------------------------------------
  console.log("\n[Test 1] Legacy Dependent Profile Protection: Never Convert Dependent to Self");
  try {
    const legacyUserId = `user-legacy-${Date.now()}`;

    // Seed an account that ONLY has a legacy parent profile
    const legacyParent = await PatientProfileService.upsertProfile(legacyUserId, {
      name: "Eleanor Vance (Mother)",
      relationshipToUser: "parent",
      age: 74,
      sexAssignedAtBirth: "female",
      knownConditions: ["Type 2 Diabetes"],
      clinicalNotes: "Long-standing maternal diabetic records",
      consentGiven: true,
    });

    // 1a. getSelfProfile must return null, NEVER adopting Eleanor as self
    const resolvedSelf = await PatientProfileService.getSelfProfile(legacyUserId);
    assert.strictEqual(
      resolvedSelf,
      null,
      "getSelfProfile() must return null when no self profile exists, never adopting legacy dependent profiles"
    );

    // 1b. When user creates their self profile, it must create a new record and preserve Eleanor
    const newSelf = await PatientProfileService.upsertProfile(legacyUserId, {
      name: "Marcus Vance",
      relationshipToUser: "self",
      age: 42,
      sexAssignedAtBirth: "male",
      knownConditions: ["Mild Asthma"],
      consentGiven: true,
    });

    assert.notStrictEqual(newSelf.id, legacyParent.id, "Self profile must receive its own distinct UUID");
    assert.strictEqual(newSelf.name, "Marcus Vance");
    assert.strictEqual(newSelf.relationshipToUser, "self");

    // 1c. Eleanor's legacy profile must remain completely intact
    const preservedParent = await PatientProfileService.getProfileById(legacyParent.id, legacyUserId);
    assert.ok(preservedParent, "Legacy parent profile must still exist");
    assert.strictEqual(preservedParent?.name, "Eleanor Vance (Mother)");
    assert.strictEqual(preservedParent?.relationshipToUser, "parent");
    assert.strictEqual(preservedParent?.clinicalNotes, "Long-standing maternal diabetic records");

    // 1d. List profiles returns exactly 2 distinct profiles
    const allProfiles = await PatientProfileService.listProfiles(legacyUserId);
    assert.strictEqual(allProfiles.length, 2, "Both self and legacy parent profiles coexist without overwrite");

    testPass("A self-profile is never created by converting a legacy dependent profile");
  } catch (err) {
    testFail("Legacy Dependent Profile Protection", err);
  }

  // ---------------------------------------------------------------------------
  // TEST 2: Finding C — Consultation Encounter-to-Profile Binding Consistency
  // ---------------------------------------------------------------------------
  console.log("\n[Test 2] Encounter-to-Profile Binding: Reject Non-Self Profile References");
  try {
    const userId = `user-consult-binding-${Date.now()}`;

    const selfProfile = await PatientProfileService.upsertProfile(userId, {
      name: "Sarah Jenkins",
      relationshipToUser: "self",
      age: 36,
      consentGiven: true,
    });

    const childProfile = await PatientProfileService.upsertProfile(userId, {
      name: "Timmy Jenkins (Child)",
      relationshipToUser: "child",
      age: 6,
      consentGiven: true,
    });

    // 2a. Creating a consultation referencing a non-self profile must fail with HTTP 400
    const invalidCreateReq = new Request("http://localhost:3000/api/consultations", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...createTestHeaders("patient", userId),
      },
      body: JSON.stringify({
        id: `consult-invalid-${Date.now()}`,
        patientProfileId: childProfile.id, // Non-self profile!
        patientName: "Timmy Jenkins",
      }),
    });

    const invalidCreateRes = await postConsultation(invalidCreateReq);
    assert.strictEqual(invalidCreateRes.status, 400, "Consultation referencing non-self profile must return 400");
    const invalidJson = await invalidCreateRes.json();
    assert.strictEqual(invalidJson.code, "NON_SELF_PROFILE_FORBIDDEN");

    // 2b. Creating a consultation referencing the self profile succeeds
    const validEncounterId = `consult-valid-${Date.now()}`;
    const validCreateReq = new Request("http://localhost:3000/api/consultations", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...createTestHeaders("patient", userId),
      },
      body: JSON.stringify({
        id: validEncounterId,
        patientProfileId: selfProfile.id,
        patientName: "Sarah Jenkins",
      }),
    });

    const validCreateRes = await postConsultation(validCreateReq);
    assert.strictEqual(validCreateRes.status, 200, "Consultation referencing self-profile must return 200");
    const validJson = await validCreateRes.json();
    assert.strictEqual(validJson.consultation.patientProfileId, selfProfile.id);

    // 2c. Voice route with legacy non-self encounter rejects with LEGACY_PROFILE_ENCOUNTER_REJECTED
    const legacyEncounterId = `consult-legacy-child-${Date.now()}`;
    memoryConsultations.push({
      id: legacyEncounterId,
      userId,
      patientProfileId: childProfile.id, // Legacy encounter referencing child
      caseVersion: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as any);

    const voiceRouteReq = new Request("http://localhost:3000/api/voice/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...createTestHeaders("patient", userId),
      },
      body: JSON.stringify({
        message: "Hello doctor",
        consultationId: legacyEncounterId,
      }),
    });

    const voiceRouteRes = await postVoiceChat(voiceRouteReq);
    assert.strictEqual(voiceRouteRes.status, 400, "Voice route must reject encounters bound to non-self profiles");
    const voiceJson = await voiceRouteRes.json();
    assert.strictEqual(voiceJson.code, "LEGACY_PROFILE_ENCOUNTER_REJECTED");

    testPass("A consultation cannot reference a profile that isn't the account holder's authorized self-profile");
  } catch (err) {
    testFail("Consultation-to-Profile Binding Consistency", err);
  }

  // ---------------------------------------------------------------------------
  // TEST 3: Finding A — Third-Party Emergency Guidance without History Pollution
  // ---------------------------------------------------------------------------
  console.log("\n[Test 3] Third-Party Acute Danger: Immediate Emergency Directives & Clean History");
  try {
    const userId = `user-safety-isolation-${Date.now()}`;
    const encounterId = `consult-safety-${Date.now()}`;

    const selfProfile = await PatientProfileService.upsertProfile(userId, {
      name: "Arthur Pendelton",
      relationshipToUser: "self",
      age: 50,
      consentGiven: true,
    });

    // Create consultation
    const createReq = new Request("http://localhost:3000/api/consultations", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...createTestHeaders("patient", userId),
      },
      body: JSON.stringify({
        id: encounterId,
        patientProfileId: selfProfile.id,
        patientName: "Arthur Pendelton",
      }),
    });
    await postConsultation(createReq);

    // Turn 1: Account holder reports their own mild symptom
    const turn1Req = new Request("http://localhost:3000/api/voice/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...createTestHeaders("patient", userId),
      },
      body: JSON.stringify({
        message: "I have had a mild dry cough for three days.",
        consultationId: encounterId,
        turnId: "turn_1",
      }),
    });
    const turn1Res = await postVoiceChat(turn1Req);
    assert.strictEqual(turn1Res.status, 200);

    // Verify turn 1 recorded mild cough
    const encAfterTurn1 = memoryConsultations.find(c => c.id === encounterId);
    assert.ok(encAfterTurn1?.interviewState);

    // Turn 2: Account holder reports grandmother's acute stroke & chest pain
    const turn2Req = new Request("http://localhost:3000/api/voice/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...createTestHeaders("patient", userId),
      },
      body: JSON.stringify({
        message: "My grandmother suddenly cannot speak properly, her face is drooping, and she has severe chest pain!",
        consultationId: encounterId,
        turnId: "turn_2",
      }),
    });
    const turn2Res = await postVoiceChat(turn2Req);
    assert.strictEqual(turn2Res.status, 200);
    const turn2Json = await turn2Res.json();

    // 3a. Emergency Directives: Must deliver urgent emergency instructions immediately
    assert.ok(
      turn2Json.doctorReply?.includes("112") ||
      turn2Json.doctorReply?.includes("911") ||
      turn2Json.doctorReply?.includes("emergency") ||
      turn2Json.doctorReply?.includes("Ambulance"),
      "Emergency reply must deliver immediate emergency dispatch instructions"
    );

    // 3b. Zero History Pollution: Check persisted interviewState on encounter
    const encAfterTurn2 = memoryConsultations.find(c => c.id === encounterId);
    const knownFacts = encAfterTurn2?.interviewState?.slots?.known_facts || [];
    const confirmedFacts = encAfterTurn2?.interviewState?.conversationMemory?.confirmedFacts || [];

    // Ensure Arthur's history does NOT contain grandmother's chest pain, drooping, or stroke signs
    assert.ok(!knownFacts.some((f: string) => /chest|droop|speech|stroke/i.test(f)), "Arthur's known_facts must not contain grandmother's symptoms");
    assert.ok(!confirmedFacts.some((f: string) => /chest|droop|speech|stroke/i.test(f)), "Arthur's confirmedFacts must not contain grandmother's symptoms");

    // 3c. Zero Longitudinal Fact Pollution: Check Arthur's longitudinal facts
    const arthurFacts = await LongitudinalFactService.getActiveFacts(userId, selfProfile.id);
    assert.strictEqual(
      arthurFacts.length,
      0,
      "Zero third-party facts must enter Arthur's longitudinal baseline store"
    );

    testPass("A third-party chest-pain or stroke-like report gets urgent guidance without polluting the account holder's persisted clinical history");
  } catch (err) {
    testFail("Third-Party Emergency Guidance without History Pollution", err);
  }

  // ---------------------------------------------------------------------------
  // TEST 4: Hardening Point — Comprehensive Third-Party Mention Detection
  // ---------------------------------------------------------------------------
  console.log("\n[Test 4] Expanded Third-Party Detection: Relatives, Partners & Pronouns");
  try {
    const testCases = [
      { text: "My grandfather fell down and cannot get up", expectedThirdParty: true, relation: "third_party" },
      { text: "My grandmother has a resting heart rate of 88 bpm", expectedThirdParty: true, relation: "third_party" },
      { text: "My brother is having a severe migraine", expectedThirdParty: true, relation: "third_party" },
      { text: "My sister broke out in a full-body rash", expectedThirdParty: true, relation: "third_party" },
      { text: "My husband has tight pressure in his chest", expectedThirdParty: true, relation: "third_party" },
      { text: "My wife is experiencing sharp abdominal pain", expectedThirdParty: true, relation: "third_party" },
      { text: "My aunt's blood sugar reading was 240", expectedThirdParty: true, relation: "third_party" },
      { text: "My uncle drank antifreeze accidentally", expectedThirdParty: true, relation: "third_party" },
      { text: "My roommate is wheezing and lips look blue", expectedThirdParty: true, relation: "third_party" },
      { text: "His chest hurts whenever he climbs stairs", expectedThirdParty: true, relation: "third_party" },
      { text: "Her temperature is 103 F this morning", expectedThirdParty: true, relation: "mother" },
      { text: "My child Leo has a barking cough", expectedThirdParty: true, relation: "child" },
      { text: "My mother has severe nausea and vomiting", expectedThirdParty: true, relation: "mother" },
      { text: "I have had a throbbing headache for 2 days", expectedThirdParty: false, relation: undefined },
      { text: "I sleep about 7 hours a night", expectedThirdParty: false, relation: undefined },
    ];

    for (const tc of testCases) {
      const res = await PatientProfileService.resolveTargetPatientProfile(
        "test-user",
        tc.text
      );
      assert.strictEqual(
        Boolean(res.thirdPartyDetected),
        tc.expectedThirdParty,
        `Utterance '${tc.text.slice(0, 35)}...' thirdPartyDetected should be ${tc.expectedThirdParty}`
      );
      if (tc.expectedThirdParty) {
        assert.strictEqual(
          res.thirdPartyRelation,
          tc.relation,
          `Utterance '${tc.text.slice(0, 35)}...' relation should be '${tc.relation}'`
        );
      }
      assert.strictEqual(res.inferredSubject, "self", "Target subject must remain strictly locked to 'self'");
    }

    testPass("Expanded third-party detector correctly classifies grandparents, siblings, partners, pronouns, and self utterances");
  } catch (err) {
    testFail("Expanded Third-Party Detection", err);
  }

  // ---------------------------------------------------------------------------
  // TEST 5: Finding D — End-to-End Longitudinal Memory Across Visits
  // ---------------------------------------------------------------------------
  console.log("\n[Test 5] Multi-Visit Longitudinal Continuity: Spoken Baselines, Superseding & Prompt Re-Evaluation");
  try {
    const userId = `user-longitudinal-e2e-${Date.now()}`;

    const selfProfile = await PatientProfileService.upsertProfile(userId, {
      name: "Hannah Abbott",
      relationshipToUser: "self",
      age: 29,
      consentGiven: true,
    });

    // Visit 1: Patient reports baseline sleep (5 hours)
    const turn1Fact = {
      concept: "sleep_duration",
      assertionStatus: "present" as const,
      sourceSpeaker: "patient" as const,
      attribution: "patient" as const,
      temporality: "habitual" as const,
      sourceUtterance: "I usually sleep about 5 hours a night on weekdays.",
      timestamp: "2026-09-01T10:00:00Z",
    };

    const extraction1 = extractLongitudinalCandidate(turn1Fact as any, {
      targetPatientProfileId: selfProfile.id,
      targetSubjectRelation: "self",
      sourceConsultationId: "visit_1_consult",
      sourceTurnId: "turn_2",
      reportedAt: "2026-09-01T10:00:00Z",
    });

    assert.strictEqual(extraction1.eligible, true, "Visit 1 sleep report must be eligible for baseline recording");
    assert.strictEqual(extraction1.factParams.reportedValue, "5 hours");
    assert.strictEqual(extraction1.factParams.numericValue, 5);

    const fact1 = await LongitudinalFactService.recordFact(userId, extraction1.factParams);
    assert.strictEqual(fact1.concept, "usual_sleep_duration");

    // Verify active fact in Visit 1
    const activeV1 = await LongitudinalFactService.getActiveFacts(userId, selfProfile.id);
    assert.strictEqual(activeV1.length, 1);
    assert.strictEqual(activeV1[0].reportedValue, "5 hours");

    // Visit 2: Patient updates baseline to 7 hours
    const turn2Fact = {
      concept: "sleep_duration",
      assertionStatus: "present" as const,
      sourceSpeaker: "patient" as const,
      attribution: "patient" as const,
      temporality: "habitual" as const,
      sourceUtterance: "I improved my schedule, now I sleep about 7 hours a night.",
      timestamp: "2026-10-15T14:00:00Z",
    };

    const extraction2 = extractLongitudinalCandidate(turn2Fact as any, {
      targetPatientProfileId: selfProfile.id,
      targetSubjectRelation: "self",
      sourceConsultationId: "visit_2_consult",
      sourceTurnId: "turn_3",
      reportedAt: "2026-10-15T14:00:00Z",
    });

    assert.strictEqual(extraction2.eligible, true);
    assert.strictEqual(extraction2.factParams.reportedValue, "7 hours");

    const fact2 = await LongitudinalFactService.recordFact(userId, extraction2.factParams);
    assert.strictEqual(fact2.supersedesFactId, fact1.id, "Fact 2 must point back to Fact 1 as superseded predecessor");

    // Verify active fact in Visit 2: Exactly 1 active baseline (7 hours)
    const activeV2 = await LongitudinalFactService.getActiveFacts(userId, selfProfile.id);
    assert.strictEqual(activeV2.length, 1);
    assert.strictEqual(activeV2[0].reportedValue, "7 hours", "Active baseline must be 7 hours");

    // Verify complete audit history
    const history = await LongitudinalFactService.getFactHistory(userId, selfProfile.id, "usual_sleep_duration");
    assert.strictEqual(history.length, 2, "Lineage must contain exactly 2 versions of sleep duration");
    assert.strictEqual(history[0].id, fact2.id, "Latest version is Visit 2 (7 hours)");
    assert.strictEqual(history[1].id, fact1.id, "Previous version is Visit 1 (5 hours)");

    // Visit 3: Patient opens new consultation. Doctor prompt must format longitudinal context
    const doctorPrompt = buildDoctorSystemPrompt({
      patientProfile: selfProfile,
      longitudinalFacts: activeV2.map(f => ({
        category: f.category,
        concept: f.concept,
        reportedValue: f.reportedValue,
        temporalScope: f.temporalScope,
        reportedAt: f.reportedAt,
        sourceType: f.sourceType,
      })),
      inferredSubject: "self",
    });

    assert.ok(
      doctorPrompt.includes("LONGITUDINAL PATIENT CONTEXT"),
      "Doctor prompt must include LONGITUDINAL PATIENT CONTEXT section"
    );
    assert.ok(
      doctorPrompt.includes("usual_sleep_duration") && doctorPrompt.includes('"7 hours"'),
      "Doctor prompt must include updated 7 hours baseline"
    );
    assert.ok(
      doctorPrompt.includes("LONGITUDINAL BASELINE CONTINUITY & RE-EVALUATION"),
      "Doctor prompt must include Rule 10: Longitudinal Baseline Continuity & Re-Evaluation"
    );

    testPass("A patient reports a baseline in Visit 1, updates it in Visit 2, and the verified latest baseline is retrieved in Visit 3 with doctor prompt re-evaluation");
  } catch (err) {
    testFail("Multi-Visit Longitudinal Continuity", err);
  }

  // ---------------------------------------------------------------------------
  // SUMMARY
  // ---------------------------------------------------------------------------
  console.log("\n================================================================================");
  console.log(`  BATTERY SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED (TOTAL: ${passedCount + failedCount})`);
  console.log("================================================================================");

  if (failedCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runHardeningBattery().catch((err) => {
  console.error("FATAL: Unhandled exception in hardening test battery:", err);
  process.exit(1);
});
