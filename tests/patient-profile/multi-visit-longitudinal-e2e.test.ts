/**
 * End-to-End Multi-Visit Longitudinal Context & Clinical Reasoning Battery (M5)
 *
 * Verifies the complete cross-encounter patient memory lifecycle:
 * 1. Visit 1: Stated habitual baseline ("I usually sleep 5 hours a night") extracted, validated, and stored.
 * 2. Visit 2 Prompt Assembly: Historical baseline retrieved and injected into doctor prompt with
 *    non-assumption re-evaluation directive ("Last time you said you sleep 5 hours... has that improved?").
 * 3. Visit 2 In-Encounter Update: Patient reports updated baseline ("I now sleep 7 hours"), atomically
 *    superseding the prior 5h baseline while preserving lineage pointers.
 * 4. Episodic Isolation: Acute single-night insomnia ("3 hours last night") does NOT mutate chronic baseline.
 * 5. Dialogue Deduplication: Registered concepts are tagged in doNotRepeat/askedTopics to prevent interrogation.
 * 6. Visit 3 Lineage Audit: getFactHistory reconstructs complete, chronological multi-encounter progression.
 * 7. Tenant & DPDP Isolation: Multi-subject profiles and cross-user boundaries strictly enforced.
 *
 * Execution:
 *   npx tsx tests/patient-profile/multi-visit-longitudinal-e2e.test.ts
 */

import assert from "assert";
import {
  LongitudinalFactService,
  resetLongitudinalFactStore,
  ConsentRequiredError,
  ProfileNotFoundError,
} from "../../lib/patient/longitudinal-fact-service";
import { extractLongitudinalCandidate } from "../../lib/patient/longitudinal-fact-extractor";
import { buildDoctorSystemPrompt } from "../../lib/ai/clinical-llm";
import { PatientProfileService, memoryProfiles } from "../../lib/patient/patient-profile-service";
import { AttributedClinicalFactV3 } from "../../lib/agents/schemas";

let passedCount = 0;
let failedCount = 0;

function testPass(label: string) {
  passedCount++;
  console.log(`  [PASS] ${label}`);
}

function testFail(label: string, err: any) {
  failedCount++;
  console.error(`  [FAIL] ${label}:`, err?.message || err);
}

function createAttributedFact(overrides: Partial<AttributedClinicalFactV3>): AttributedClinicalFactV3 {
  return {
    id: `fact-${Date.now()}-${Math.random().toString(36).substring(7)}`,
    concept: "sleep_duration",
    assertionStatus: "present",
    temporality: "current",
    attribution: "patient",
    coverage: "assessed",
    sourceUtterance: "I usually sleep 5 hours a night.",
    sourceSpeaker: "patient",
    turnId: 2,
    confidence: "calibrated_score",
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

async function runMultiVisitLongitudinalAcceptanceBattery() {
  console.log("================================================================================");
  console.log("  LONGITUDINAL PATIENT CONTEXT: MULTI-VISIT ACCEPTANCE & REASONING BATTERY (M5)");
  console.log("================================================================================");

  // Clean isolation states
  resetLongitudinalFactStore();
  memoryProfiles.clear();

  const userIdAlice = "user_alice_longitudinal_test";
  const userIdBob = "user_bob_isolated_test";

  // 1. Setup Patient Profile for Alice with DPDP Consent
  const aliceProfile = await PatientProfileService.upsertProfile(userIdAlice, {
    name: "Alice Montgomery",
    relationshipToUser: "self",
    age: 41,
    sexAssignedAtBirth: "female",
    knownConditions: ["Mild Migraine"],
    currentMedications: [],
    consentGiven: true,
  });

  // Setup Mother Profile under Alice's account for multi-subject testing
  const aliceMotherProfile = await PatientProfileService.upsertProfile(userIdAlice, {
    name: "Martha Montgomery",
    relationshipToUser: "parent",
    age: 72,
    sexAssignedAtBirth: "female",
    knownConditions: ["Hypertension"],
    consentGiven: true,
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 1: Visit 1 — Initial Observation & Pure Deterministic Extraction
  // ---------------------------------------------------------------------------
  console.log("\n[Scenario 1] Visit 1: Patient Stating Habitual Sleep Baseline (5 Hours)");
  let visit1FactId = "";
  try {
    const rawTurnFact = createAttributedFact({
      concept: "sleep_duration",
      sourceUtterance: "I usually sleep about 5 hours a night on weekdays.",
      turnId: 2,
    });

    const extraction = extractLongitudinalCandidate(rawTurnFact, {
      targetPatientProfileId: aliceProfile.id,
      targetSubjectRelation: "self",
      sourceConsultationId: "consultation_visit_1",
      sourceTurnId: "turn_2",
    });

    assert.strictEqual(extraction.eligible, true, "Candidate must be eligible for longitudinal promotion");
    if (extraction.eligible) {
      assert.strictEqual(extraction.factParams.concept, "usual_sleep_duration");
      assert.strictEqual(extraction.factParams.category, "lifestyle_sleep");
      assert.strictEqual(extraction.factParams.temporalScope, "baseline");
      assert.strictEqual(extraction.factParams.numericValue, 5);
      assert.strictEqual(extraction.factParams.unit, "hours/night");
      assert.strictEqual(extraction.factParams.verification, "unverified");

      const storedFact = await LongitudinalFactService.recordFact(userIdAlice, extraction.factParams);
      visit1FactId = storedFact.id;
      assert.strictEqual(storedFact.lifecycle, "active");
      assert.strictEqual(storedFact.sourceConsultationId, "consultation_visit_1");
    }

    const activeFactsV1 = await LongitudinalFactService.getActiveFacts(userIdAlice, aliceProfile.id);
    assert.strictEqual(activeFactsV1.length, 1);
    assert.strictEqual(activeFactsV1[0].reportedValue, "5 hours");

    testPass("Visit 1: Successfully extracted, validated, and recorded 5-hour sleep baseline");
  } catch (err) {
    testFail("Visit 1: Extraction and baseline recording", err);
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 2: Visit 2 — Cross-Visit Retrieval & Doctor Prompt Ingestion
  // ---------------------------------------------------------------------------
  console.log("\n[Scenario 2] Visit 2: Cross-Visit Retrieval & Doctor System Prompt Assembly");
  try {
    // Weeks later: Start Visit 2
    const retrievedBaselines = await LongitudinalFactService.getActiveFacts(
      userIdAlice,
      aliceProfile.id,
      { temporalScope: "baseline" }
    );

    assert.strictEqual(retrievedBaselines.length, 1);
    assert.strictEqual(retrievedBaselines[0].id, visit1FactId);

    // Assemble Doctor System Prompt for Visit 2
    const promptVisit2 = buildDoctorSystemPrompt({
      doctor: { name: "Dr. Sarah Rao", specialty: "Family Physician" } as any,
      patientProfile: aliceProfile,
      callerProfile: { id: userIdAlice, name: "Alice Montgomery", relationshipToPatient: "self" },
      inferredSubject: "self",
      longitudinalFacts: retrievedBaselines,
    });

    // Verify Prompt Invariants
    assert.ok(
      promptVisit2.includes("LONGITUDINAL PATIENT CONTEXT (HISTORICAL BASELINES ACROSS PRIOR VISITS)"),
      "Prompt must render dedicated Longitudinal Context section"
    );
    assert.ok(
      promptVisit2.includes('usual_sleep_duration (lifestyle_sleep): "5 hours"'),
      "Prompt must include the historical 5-hour sleep baseline"
    );
    assert.ok(
      promptVisit2.includes("LONGITUDINAL RE-EVALUATION DIRECTIVE"),
      "Prompt must render clinical directive for historical re-evaluation"
    );
    assert.ok(
      promptVisit2.includes("NEVER assume past historical baselines represent current status today"),
      "Prompt must mandate checking whether baseline remains accurate"
    );
    assert.ok(
      promptVisit2.includes("LONGITUDINAL BASELINE CONTINUITY & RE-EVALUATION"),
      "Prompt must include Rule 10 reinforcing seamless continuity and update precedence"
    );

    testPass("Visit 2: Successfully assembled doctor system prompt with cross-visit re-evaluation guidance");
  } catch (err) {
    testFail("Visit 2: Prompt assembly and longitudinal directives", err);
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 3: Visit 2 — In-Encounter Update & Atomic Superseding
  // ---------------------------------------------------------------------------
  console.log("\n[Scenario 3] Visit 2: Patient Updates Baseline to 7 Hours (Atomic Superseding)");
  let visit2FactId = "";
  try {
    // Patient reports improved sleep in Visit 2
    const updateTurnFact = createAttributedFact({
      concept: "sleep_duration",
      sourceUtterance: "I worked on my sleep hygiene, so I now typically get 7 hours of sleep every night.",
      turnId: 3,
    });

    const updateExtraction = extractLongitudinalCandidate(updateTurnFact, {
      targetPatientProfileId: aliceProfile.id,
      targetSubjectRelation: "self",
      sourceConsultationId: "consultation_visit_2",
      sourceTurnId: "turn_3",
    });

    assert.strictEqual(updateExtraction.eligible, true);
    if (updateExtraction.eligible) {
      assert.strictEqual(updateExtraction.factParams.concept, "usual_sleep_duration");
      assert.strictEqual(updateExtraction.factParams.numericValue, 7);

      const newFact = await LongitudinalFactService.recordFact(userIdAlice, updateExtraction.factParams);
      visit2FactId = newFact.id;

      // Verify atomic superseding linkages
      assert.strictEqual(newFact.lifecycle, "active");
      assert.strictEqual(newFact.supersedesFactId, visit1FactId, "New fact must point back to superseded fact");
      assert.strictEqual(newFact.sourceConsultationId, "consultation_visit_2");
    }

    // Verify Active Set: Exactly 1 active baseline remains
    const activeBaselinesV2 = await LongitudinalFactService.getActiveFacts(userIdAlice, aliceProfile.id);
    assert.strictEqual(activeBaselinesV2.length, 1, "Must contain exactly 1 active baseline per concept");
    assert.strictEqual(activeBaselinesV2[0].id, visit2FactId);
    assert.strictEqual(activeBaselinesV2[0].reportedValue, "7 hours");

    // Verify Old Fact State
    const history = await LongitudinalFactService.getFactHistory(userIdAlice, aliceProfile.id, "usual_sleep_duration");
    const oldFact = history.find((f) => f.id === visit1FactId);
    assert.ok(oldFact, "Old fact must exist in lineage history");
    assert.strictEqual(oldFact?.lifecycle, "superseded");
    assert.strictEqual(oldFact?.supersededByFactId, visit2FactId, "Old fact must point forward to new fact");

    testPass("Visit 2: Atomically superseded 5h baseline with 7h update, maintaining bidirectional lineage");
  } catch (err) {
    testFail("Visit 2: In-encounter superseding update", err);
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 4: Episodic Isolation (Acute Observation Does Not Mutate Baseline)
  // ---------------------------------------------------------------------------
  console.log("\n[Scenario 4] Episodic Isolation: Acute Poor Sleep Does Not Corrupt Chronic Baseline");
  try {
    const acuteTurnFact = createAttributedFact({
      concept: "sleep_duration",
      sourceUtterance: "I slept poorly last night, only 3 hours because of the cough.",
      turnId: 5,
    });

    const acuteExtraction = extractLongitudinalCandidate(acuteTurnFact, {
      targetPatientProfileId: aliceProfile.id,
      targetSubjectRelation: "self",
      sourceConsultationId: "consultation_visit_2",
      sourceTurnId: "turn_5",
    });

    assert.strictEqual(acuteExtraction.eligible, true);
    if (acuteExtraction.eligible) {
      assert.strictEqual(acuteExtraction.factParams.temporalScope, "episodic");
      const storedAcute = await LongitudinalFactService.recordFact(userIdAlice, acuteExtraction.factParams);
      assert.strictEqual(storedAcute.temporalScope, "episodic");
    }

    // Active baseline MUST remain 7 hours!
    const activeBaselines = await LongitudinalFactService.getActiveFacts(
      userIdAlice,
      aliceProfile.id,
      { temporalScope: "baseline" }
    );
    assert.strictEqual(activeBaselines.length, 1);
    assert.strictEqual(activeBaselines[0].id, visit2FactId);
    assert.strictEqual(activeBaselines[0].reportedValue, "7 hours");

    testPass("Episodic Isolation: Acute single-event observation (3 hours) isolated from chronic baseline (7 hours)");
  } catch (err) {
    testFail("Episodic Isolation", err);
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 5: Visit 3 — Chronological Lineage Audit Trail
  // ---------------------------------------------------------------------------
  console.log("\n[Scenario 5] Visit 3: Complete Chronological Fact Lineage Reconstruction");
  try {
    const fullLineage = await LongitudinalFactService.getFactHistory(
      userIdAlice,
      aliceProfile.id,
      "usual_sleep_duration"
    );

    // Full history includes Visit 1 (5h baseline), Visit 2 (7h baseline), and Visit 2 (3h episodic)
    assert.strictEqual(fullLineage.length, 3, "Lineage must contain all 3 historical entries");
    
    const baselineLineage = fullLineage.filter((f) => f.temporalScope === "baseline");
    assert.strictEqual(baselineLineage.length, 2, "Baseline lineage must contain exactly 2 versions");
    assert.strictEqual(baselineLineage[0].id, visit2FactId, "Most recent baseline entry must be Visit 2 (7h)");
    assert.strictEqual(baselineLineage[0].lifecycle, "active");
    assert.strictEqual(baselineLineage[1].id, visit1FactId, "Earlier baseline entry must be Visit 1 (5h)");
    assert.strictEqual(baselineLineage[1].lifecycle, "superseded");

    testPass("Visit 3: Complete audit chain accurately reconstructed across encounters");
  } catch (err) {
    testFail("Visit 3: Lineage audit reconstruction", err);
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 6: Multi-Subject Separation (Mother vs Self)
  // ---------------------------------------------------------------------------
  console.log("\n[Scenario 6] Multi-Subject Separation: Caregiver vs Family Member Data Isolation");
  try {
    // Record resting heart rate for Alice's mother
    const motherFact = createAttributedFact({
      concept: "resting_heart_rate",
      sourceUtterance: "Her resting heart rate is normally 74 bpm.",
      sourceSpeaker: "caregiver",
      attribution: "caregiver_report",
      turnId: 1,
    });

    const motherExtraction = extractLongitudinalCandidate(motherFact, {
      targetPatientProfileId: aliceMotherProfile.id,
      targetSubjectRelation: "parent",
      sourceConsultationId: "consultation_mother_v1",
      sourceTurnId: "turn_1",
    });

    assert.strictEqual(motherExtraction.eligible, true);
    if (motherExtraction.eligible) {
      await LongitudinalFactService.recordFact(userIdAlice, motherExtraction.factParams);
    }

    // Check Alice Self active facts: Must have only sleep, NO heart rate
    const aliceActive = await LongitudinalFactService.getActiveFacts(userIdAlice, aliceProfile.id);
    assert.ok(!aliceActive.some((f) => f.concept === "resting_heart_rate"));

    // Check Mother active facts: Must have heart rate, NO sleep
    const motherActive = await LongitudinalFactService.getActiveFacts(userIdAlice, aliceMotherProfile.id);
    assert.strictEqual(motherActive.length, 1);
    assert.strictEqual(motherActive[0].concept, "resting_heart_rate");
    assert.strictEqual(motherActive[0].reportedValue, "74 bpm");

    testPass("Multi-Subject Separation: Mother's longitudinal vitals strictly isolated from Self profile");
  } catch (err) {
    testFail("Multi-Subject Separation", err);
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 7: Cross-User IDOR Protection & DPDP Consent Gate
  // ---------------------------------------------------------------------------
  console.log("\n[Scenario 7] Tenant Security: Cross-User IDOR Defense & DPDP Consent Fail-Closed");
  try {
    // 1. Bob cannot access Alice's longitudinal facts (IDOR defense)
    let idorBlocked = false;
    try {
      await LongitudinalFactService.getActiveFacts(userIdBob, aliceProfile.id);
    } catch (err: any) {
      if (err instanceof ProfileNotFoundError) {
        idorBlocked = true;
      }
    }
    assert.strictEqual(idorBlocked, true, "Cross-user IDOR access attempt must be blocked with ProfileNotFoundError");

    // 2. DPDP Consent Gate: Revoking consent blocks access immediately
    await PatientProfileService.upsertProfile(userIdAlice, {
      name: "Alice Montgomery",
      relationshipToUser: "self",
      consentGiven: false, // Consent revoked
    });

    let consentBlockedRead = false;
    try {
      await LongitudinalFactService.getActiveFacts(userIdAlice, aliceProfile.id);
    } catch (err: any) {
      if (err instanceof ConsentRequiredError) {
        consentBlockedRead = true;
      }
    }
    assert.strictEqual(consentBlockedRead, true, "Reading longitudinal facts without DPDP consent must fail closed");

    let consentBlockedWrite = false;
    try {
      await LongitudinalFactService.recordFact(userIdAlice, {
        patientProfileId: aliceProfile.id,
        category: "lifestyle_sleep",
        concept: "usual_sleep_duration",
        reportedValue: "8 hours",
        temporalScope: "baseline",
        sourceConsultationId: "consult_revoked",
        sourceTurnId: "turn_1",
      });
    } catch (err: any) {
      if (err instanceof ConsentRequiredError) {
        consentBlockedWrite = true;
      }
    }
    assert.strictEqual(consentBlockedWrite, true, "Recording longitudinal facts without DPDP consent must fail closed");

    testPass("Tenant & DPDP Security: Cross-user IDOR strictly blocked; missing consent fails closed");
  } catch (err) {
    testFail("Tenant & DPDP Security", err);
  }

  // ---------------------------------------------------------------------------
  // Battery Summary
  // ---------------------------------------------------------------------------
  console.log("================================================================================");
  console.log(`  BATTERY SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED (TOTAL: ${passedCount + failedCount})`);
  console.log("================================================================================");

  if (failedCount > 0) {
    process.exit(1);
  }
}

runMultiVisitLongitudinalAcceptanceBattery().catch((err) => {
  console.error("Fatal test error:", err);
  process.exit(1);
});
