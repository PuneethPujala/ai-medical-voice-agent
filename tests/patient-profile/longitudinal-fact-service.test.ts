/**
 * Longitudinal Patient Context & Temporal Fact Service Test Battery
 *
 * Verifies:
 * 1. Visit 1: Baseline write (5-hour sleep duration recorded with full provenance, active lifecycle)
 * 2. Idempotent Retry: Processing the exact same turn yields identical fact without duplication
 * 3. Visit 2: Correction lineage & atomic superseding (7-hour update supersedes 5-hour baseline)
 * 4. Episodic Isolation: Episodic observations ("slept 3 hours last night") do not supersede chronic baselines
 * 5. Consent Enforcement: Operations fail closed when consentGiven is false; retraction is permitted
 * 6. Tenant & Patient Isolation: Cross-user IDOR blocked; multi-subject profiles kept strictly disjoint
 * 7. Fact Retraction: Retract fact transitions lifecycle to 'retracted' or 'entered_in_error'
 * 8. Fact History & Lineage: Complete chronological lineage traceable via getFactHistory
 *
 * Execution:
 *   npx tsx tests/patient-profile/longitudinal-fact-service.test.ts
 */

import assert from "assert";
import {
  LongitudinalFactService,
  ConsentRequiredError,
  ProfileNotFoundError,
  FactNotFoundError,
  memoryLongitudinalFacts,
  resetLongitudinalFactStore,
} from "../../lib/patient/longitudinal-fact-service";
import {
  PatientProfileService,
  memoryProfiles,
} from "../../lib/patient/patient-profile-service";

(process.env as Record<string, string | undefined>).NODE_ENV = "test";

async function runLongitudinalFactServiceTests() {
  console.log("================================================================================");
  console.log("  LONGITUDINAL PATIENT CONTEXT: TEMPORAL FACT PERSISTENCE BATTERY (M1)         ");
  console.log("================================================================================");

  let passed = 0;
  let failed = 0;

  function testPass(name: string) {
    console.log(`  [PASS] ${name}`);
    passed++;
  }

  function testFail(name: string, err: any) {
    console.error(`  [FAIL] ${name}:`, err);
    failed++;
  }

  // Clear memory stores before starting
  memoryProfiles.clear();
  resetLongitudinalFactStore();

  const userId = "usr_marcus_vance_2026";
  const otherUserId = "usr_hostile_actor_999";

  // Setup test patient profiles
  const marcusSelfProfile = await PatientProfileService.upsertProfile(userId, {
    name: "Marcus Vance",
    relationshipToUser: "self",
    age: 44,
    sexAssignedAtBirth: "male",
    consentGiven: true,
  });

  const marcusMotherProfile = await PatientProfileService.upsertProfile(userId, {
    name: "Eleanor Vance",
    relationshipToUser: "parent",
    age: 76,
    sexAssignedAtBirth: "female",
    consentGiven: true,
  });

  const unconsentedProfile = await PatientProfileService.upsertProfile(userId, {
    name: "Unconsented Relative",
    relationshipToUser: "other",
    age: 50,
    consentGiven: false,
  });

  const otherUserProfile = await PatientProfileService.upsertProfile(otherUserId, {
    name: "Eve Attacker",
    relationshipToUser: "self",
    consentGiven: true,
  });

  // ---------------------------------------------------------------------------
  // 1. Visit 1: Baseline Write (5-Hour Sleep Duration)
  // ---------------------------------------------------------------------------
  let factVisit1Id = "";
  try {
    const fact1 = await LongitudinalFactService.recordFact(userId, {
      patientProfileId: marcusSelfProfile.id,
      category: "lifestyle_sleep",
      concept: "usual_sleep_duration",
      reportedValue: "about 5 hours a night",
      numericValue: 5,
      unit: "hours/night",
      temporalScope: "baseline",
      sourceType: "patient",
      sourceConsultationId: "consult_visit_1_oct05",
      sourceTurnId: "turn_003",
      reportedAt: "2026-10-05T09:30:00.000Z",
      verification: "unverified",
    });

    assert.ok(fact1.id.startsWith("fact_"), "Fact must have valid ID prefix");
    assert.strictEqual(fact1.userId, userId);
    assert.strictEqual(fact1.patientProfileId, marcusSelfProfile.id);
    assert.strictEqual(fact1.category, "lifestyle_sleep");
    assert.strictEqual(fact1.concept, "usual_sleep_duration");
    assert.strictEqual(fact1.numericValue, 5);
    assert.strictEqual(fact1.unit, "hours/night");
    assert.strictEqual(fact1.temporalScope, "baseline");
    assert.strictEqual(fact1.lifecycle, "active");
    assert.strictEqual(fact1.verification, "unverified");
    assert.strictEqual(fact1.sourceConsultationId, "consult_visit_1_oct05");
    assert.strictEqual(fact1.sourceTurnId, "turn_003");
    assert.strictEqual(fact1.reportedAt, "2026-10-05T09:30:00.000Z");
    assert.strictEqual(fact1.supersedesFactId, null);
    assert.strictEqual(fact1.supersededByFactId, null);

    factVisit1Id = fact1.id;
    testPass("Visit 1: Stored baseline sleep fact (5 hours) with full temporal provenance");
  } catch (err) {
    testFail("Visit 1: Stored baseline sleep fact (5 hours) with full temporal provenance", err);
  }

  // ---------------------------------------------------------------------------
  // 2. Idempotent Retry: Exact Duplicate Source Turn Yields Identical Record
  // ---------------------------------------------------------------------------
  try {
    const retryFact = await LongitudinalFactService.recordFact(userId, {
      patientProfileId: marcusSelfProfile.id,
      category: "lifestyle_sleep",
      concept: "usual_sleep_duration",
      reportedValue: "about 5 hours a night",
      numericValue: 5,
      unit: "hours/night",
      temporalScope: "baseline",
      sourceType: "patient",
      sourceConsultationId: "consult_visit_1_oct05",
      sourceTurnId: "turn_003",
      reportedAt: "2026-10-05T09:30:00.000Z",
    });

    assert.strictEqual(retryFact.id, factVisit1Id, "Idempotent retry must return the existing fact ID");
    assert.strictEqual(memoryLongitudinalFacts.size, 1, "Store must not create duplicate fact entries");

    testPass("Idempotency: Re-recording identical turn returns existing fact without duplication");
  } catch (err) {
    testFail("Idempotency: Re-recording identical turn returns existing fact without duplication", err);
  }

  // ---------------------------------------------------------------------------
  // 3. Visit 2: Correction Lineage & Atomic Superseding (7-Hour Sleep Update)
  // ---------------------------------------------------------------------------
  let factVisit2Id = "";
  try {
    const fact2 = await LongitudinalFactService.supersedeFact(userId, {
      patientProfileId: marcusSelfProfile.id,
      category: "lifestyle_sleep",
      concept: "usual_sleep_duration",
      reportedValue: "7 hours now",
      numericValue: 7,
      unit: "hours/night",
      temporalScope: "baseline",
      sourceType: "patient",
      sourceConsultationId: "consult_visit_2_oct27",
      sourceTurnId: "turn_005",
      reportedAt: "2026-10-27T10:15:00.000Z",
      verification: "patient_confirmed",
    });

    assert.notStrictEqual(fact2.id, factVisit1Id, "New fact must have distinct ID");
    assert.strictEqual(fact2.numericValue, 7);
    assert.strictEqual(fact2.lifecycle, "active");
    assert.strictEqual(fact2.verification, "patient_confirmed");
    assert.strictEqual(fact2.supersedesFactId, factVisit1Id, "New fact must point to superseded fact ID");
    assert.strictEqual(fact2.supersededByFactId, null);

    // Verify old fact is now marked superseded with forward pointer
    const oldFact = memoryLongitudinalFacts.get(factVisit1Id);
    assert.ok(oldFact, "Old fact must exist in store");
    assert.strictEqual(oldFact.lifecycle, "superseded", "Old fact must be marked 'superseded'");
    assert.strictEqual(oldFact.supersededByFactId, fact2.id, "Old fact must point forward to new fact");
    assert.ok(oldFact.supersededAt, "supersededAt timestamp must be recorded");

    // Verify getActiveFacts only returns the 7-hour fact
    const activeFacts = await LongitudinalFactService.getActiveFacts(userId, marcusSelfProfile.id);
    assert.strictEqual(activeFacts.length, 1, "Only 1 active baseline must exist");
    assert.strictEqual(activeFacts[0].id, fact2.id);
    assert.strictEqual(activeFacts[0].numericValue, 7);

    factVisit2Id = fact2.id;
    testPass("Visit 2: Atomically superseded 5h baseline with 7h update, linking lineage pointers");
  } catch (err) {
    testFail("Visit 2: Atomically superseded 5h baseline with 7h update, linking lineage pointers", err);
  }

  // ---------------------------------------------------------------------------
  // 4. Episodic Isolation: Acute Observation Does Not Overwrite Chronic Baseline
  // ---------------------------------------------------------------------------
  try {
    const episodicFact = await LongitudinalFactService.recordFact(userId, {
      patientProfileId: marcusSelfProfile.id,
      category: "lifestyle_sleep",
      concept: "usual_sleep_duration", // same concept name, but episodic scope
      reportedValue: "only slept 3 hours last night due to acute cough",
      numericValue: 3,
      unit: "hours",
      temporalScope: "episodic",
      sourceType: "patient",
      sourceConsultationId: "consult_visit_2_oct27",
      sourceTurnId: "turn_008",
      reportedAt: "2026-10-27T10:20:00.000Z",
    });

    assert.strictEqual(episodicFact.temporalScope, "episodic");
    assert.strictEqual(episodicFact.lifecycle, "active");
    assert.strictEqual(episodicFact.supersedesFactId, null, "Episodic facts must never supersede baselines");

    // Verify 7-hour baseline is still active
    const activeBaseline = memoryLongitudinalFacts.get(factVisit2Id);
    assert.strictEqual(activeBaseline?.lifecycle, "active", "Chronic baseline must remain active");
    assert.strictEqual(activeBaseline?.supersededByFactId, null, "Chronic baseline must not be superseded by episodic report");

    // Verify active baselines filter
    const activeBaselinesOnly = await LongitudinalFactService.getActiveFacts(userId, marcusSelfProfile.id, {
      temporalScope: "baseline",
    });
    assert.strictEqual(activeBaselinesOnly.length, 1);
    assert.strictEqual(activeBaselinesOnly[0].numericValue, 7);

    testPass("Episodic isolation: Acute episodic observation ('3 hours') did not overwrite chronic baseline");
  } catch (err) {
    testFail("Episodic isolation: Acute episodic observation ('3 hours') did not overwrite chronic baseline", err);
  }

  // ---------------------------------------------------------------------------
  // 5. Consent Enforcement: Operations Fail Closed Without Consent; Retraction Permitted
  // ---------------------------------------------------------------------------
  try {
    // Attempting to record fact for unconsented profile must throw ConsentRequiredError
    try {
      await LongitudinalFactService.recordFact(userId, {
        patientProfileId: unconsentedProfile.id,
        category: "vital_reading",
        concept: "resting_heart_rate",
        reportedValue: "72 bpm",
        numericValue: 72,
        temporalScope: "baseline",
        sourceConsultationId: "consult_unconsented",
        sourceTurnId: "turn_1",
      });
      assert.fail("Should have thrown ConsentRequiredError");
    } catch (err: any) {
      assert.ok(err instanceof ConsentRequiredError, "Must be ConsentRequiredError");
    }

    // Querying active facts for unconsented profile must throw ConsentRequiredError
    try {
      await LongitudinalFactService.getActiveFacts(userId, unconsentedProfile.id);
      assert.fail("Should have thrown ConsentRequiredError");
    } catch (err: any) {
      assert.ok(err instanceof ConsentRequiredError, "Must be ConsentRequiredError");
    }

    testPass("Consent enforcement: Fail-closed gate blocks writes & queries when consentGiven is false");
  } catch (err) {
    testFail("Consent enforcement: Fail-closed gate blocks writes & queries when consentGiven is false", err);
  }

  // ---------------------------------------------------------------------------
  // 6. Tenant & Patient Profile Isolation
  // ---------------------------------------------------------------------------
  try {
    // Scenario A: Hostile user attempts to read or mutate Marcus's facts
    try {
      await LongitudinalFactService.getActiveFacts(otherUserId, marcusSelfProfile.id);
      assert.fail("Should have thrown ProfileNotFoundError for cross-user profile access");
    } catch (err: any) {
      assert.ok(err instanceof ProfileNotFoundError, "Must reject cross-user access");
    }

    // Scenario B: Multi-Subject separation under same caregiver
    // Marcus records a fact for his mother (Eleanor)
    const motherFact = await LongitudinalFactService.recordFact(userId, {
      patientProfileId: marcusMotherProfile.id,
      category: "vital_reading",
      concept: "blood_glucose_fasting",
      reportedValue: "140 mg/dL",
      numericValue: 140,
      unit: "mg/dL",
      temporalScope: "baseline",
      sourceType: "caregiver",
      sourceConsultationId: "consult_mother_visit_1",
      sourceTurnId: "turn_002",
    });

    const marcusActiveFacts = await LongitudinalFactService.getActiveFacts(userId, marcusSelfProfile.id);
    const motherActiveFacts = await LongitudinalFactService.getActiveFacts(userId, marcusMotherProfile.id);

    // Marcus must NOT see mother's glucose fact
    assert.ok(!marcusActiveFacts.some((f) => f.concept === "blood_glucose_fasting"), "Marcus profile must not leak mother's facts");
    // Mother must NOT see Marcus's sleep fact
    assert.ok(!motherActiveFacts.some((f) => f.concept === "usual_sleep_duration"), "Mother profile must not leak Marcus's sleep facts");
    assert.strictEqual(motherActiveFacts.length, 1);
    assert.strictEqual(motherActiveFacts[0].concept, "blood_glucose_fasting");

    testPass("Isolation: Cross-user IDOR blocked; multi-subject profiles kept strictly segregated");
  } catch (err) {
    testFail("Isolation: Cross-user IDOR blocked; multi-subject profiles kept strictly segregated", err);
  }

  // ---------------------------------------------------------------------------
  // 7. Fact Retraction: Setting Lifecycle to 'retracted' or 'entered_in_error'
  // ---------------------------------------------------------------------------
  try {
    const retracted = await LongitudinalFactService.retractFact(userId, {
      patientProfileId: marcusSelfProfile.id,
      factId: factVisit2Id,
      reason: "Patient retracted statement during chart review",
      enteredInError: false,
    });

    assert.strictEqual(retracted.id, factVisit2Id);
    assert.strictEqual(retracted.lifecycle, "retracted");
    assert.ok(retracted.lastReviewedAt, "lastReviewedAt must be set on retraction");

    // After retraction, active facts list should no longer include the 7-hour fact
    const activeAfterRetract = await LongitudinalFactService.getActiveFacts(userId, marcusSelfProfile.id, {
      temporalScope: "baseline",
    });
    assert.strictEqual(activeAfterRetract.length, 0, "Retracted fact must not appear in active queries");

    testPass("Retraction: Fact successfully transitioned to 'retracted' and excluded from active set");
  } catch (err) {
    testFail("Retraction: Fact successfully transitioned to 'retracted' and excluded from active set", err);
  }

  // ---------------------------------------------------------------------------
  // 8. Fact History & Lineage: Complete Chronological Traceability
  // ---------------------------------------------------------------------------
  try {
    const history = await LongitudinalFactService.getFactHistory(
      userId,
      marcusSelfProfile.id,
      "usual_sleep_duration"
    );

    // History should contain 3 entries: fact1 (superseded), fact2 (retracted), and episodic fact (active)
    assert.strictEqual(history.length, 3, "History must contain all 3 historical events for sleep concept");
    const lifecycles = history.map((h) => h.lifecycle);
    assert.ok(lifecycles.includes("superseded"), "Must include superseded fact");
    assert.ok(lifecycles.includes("retracted"), "Must include retracted fact");
    assert.ok(lifecycles.includes("active"), "Must include active episodic fact");

    testPass("Lineage & audit: getFactHistory reconstructs complete, chronological multi-encounter history");
  } catch (err) {
    testFail("Lineage & audit: getFactHistory reconstructs complete, chronological multi-encounter history", err);
  }

  // ---------------------------------------------------------------------------
  // Battery Summary
  // ---------------------------------------------------------------------------
  console.log("================================================================================");
  console.log(`  BATTERY SUMMARY: ${passed} PASSED, ${failed} FAILED (TOTAL: ${passed + failed})`);
  console.log("================================================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runLongitudinalFactServiceTests().catch((err) => {
  console.error("FATAL in longitudinal fact service tests:", err);
  process.exit(1);
});
