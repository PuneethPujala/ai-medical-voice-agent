/**
 * Deterministic Longitudinal Fact Extractor Acceptance Battery (Milestone 2)
 *
 * Verifies:
 * 1. Valid baseline sleep extraction (5 hours/night)
 * 2. Valid episodic sleep extraction (3 hours last night)
 * 3. Valid resting heart rate extraction (72 bpm)
 * 4. Valid functional mobility extraction (2 blocks)
 * 5. Rejection of unsupported clinical concepts (acute symptoms, chest pain)
 * 6. Rejection of denied/absent symptoms (assertionStatus === 'absent')
 * 7. Rejection of uncertain/hypothetical assertions (assertionStatus === 'uncertain')
 * 8. Rejection of third-party statements (mother's fact when target is self)
 * 9. Rejection of clinician / AI-inferred speaker sources
 * 10. Numeric parsing precision & minute-to-hour conversion
 * 11. Strict verification status guarantee (always 'unverified')
 *
 * Execution:
 *   npx tsx tests/patient-profile/longitudinal-fact-extractor.test.ts
 */

import assert from "assert";
import {
  extractLongitudinalCandidate,
  ExtractionContext,
} from "../../lib/patient/longitudinal-fact-extractor";
import { AttributedClinicalFactV3 } from "../../lib/agents/schemas";

function createMockFact(overrides?: Partial<AttributedClinicalFactV3>): AttributedClinicalFactV3 {
  return {
    id: "fact_mock_001",
    concept: "sleep_duration",
    assertionStatus: "present",
    temporality: "current",
    attribution: "patient",
    coverage: "assessed",
    sourceUtterance: "I usually sleep about 5 hours a night.",
    sourceSpeaker: "patient",
    turnId: 3,
    confidence: "calibrated_score",
    timestamp: "2026-10-05T09:30:00.000Z",
    ...overrides,
  };
}

const defaultContext: ExtractionContext = {
  targetPatientProfileId: "prof_marcus_vance",
  targetSubjectRelation: "self",
  sourceConsultationId: "consult_001",
  sourceTurnId: "turn_003",
  reportedAt: "2026-10-05T09:30:00.000Z",
};

async function runLongitudinalExtractorTests() {
  console.log("================================================================================");
  console.log("  LONGITUDINAL FACT EXTRACTOR & NORMALIZATION GATE BATTERY (M2)               ");
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

  // ---------------------------------------------------------------------------
  // 1. Valid Baseline Sleep Extraction (5 hours/night)
  // ---------------------------------------------------------------------------
  try {
    const fact = createMockFact({
      concept: "sleep_duration",
      sourceUtterance: "I usually sleep about 5 hours a night.",
    });

    const result = extractLongitudinalCandidate(fact, defaultContext);
    assert.strictEqual(result.eligible, true);
    if (result.eligible) {
      assert.strictEqual(result.factParams.concept, "usual_sleep_duration");
      assert.strictEqual(result.factParams.category, "lifestyle_sleep");
      assert.strictEqual(result.factParams.numericValue, 5);
      assert.strictEqual(result.factParams.unit, "hours/night");
      assert.strictEqual(result.factParams.temporalScope, "baseline");
      assert.strictEqual(result.factParams.verification, "unverified");
    }

    testPass("Extraction 1: Habitual sleep report ('5 hours a night') extracted as baseline");
  } catch (err) {
    testFail("Extraction 1: Habitual sleep report ('5 hours a night') extracted as baseline", err);
  }

  // ---------------------------------------------------------------------------
  // 2. Valid Episodic Sleep Extraction ("slept 3 hours last night")
  // ---------------------------------------------------------------------------
  try {
    const fact = createMockFact({
      concept: "sleep_duration",
      sourceUtterance: "I only slept 3 hours last night because of the coughing.",
    });

    const result = extractLongitudinalCandidate(fact, defaultContext);
    assert.strictEqual(result.eligible, true);
    if (result.eligible) {
      assert.strictEqual(result.factParams.numericValue, 3);
      assert.strictEqual(result.factParams.temporalScope, "episodic");
    }

    testPass("Extraction 2: Single acute observation ('3 hours last night') classified as episodic");
  } catch (err) {
    testFail("Extraction 2: Single acute observation ('3 hours last night') classified as episodic", err);
  }

  // ---------------------------------------------------------------------------
  // 3. Valid Resting Heart Rate Extraction (72 bpm)
  // ---------------------------------------------------------------------------
  try {
    const fact = createMockFact({
      concept: "resting_heart_rate",
      sourceUtterance: "My resting heart rate is usually around 72 bpm on my watch.",
    });

    const result = extractLongitudinalCandidate(fact, defaultContext);
    assert.strictEqual(result.eligible, true);
    if (result.eligible) {
      assert.strictEqual(result.factParams.concept, "resting_heart_rate");
      assert.strictEqual(result.factParams.category, "vital_reading");
      assert.strictEqual(result.factParams.numericValue, 72);
      assert.strictEqual(result.factParams.unit, "bpm");
      assert.strictEqual(result.factParams.temporalScope, "baseline");
    }

    testPass("Extraction 3: Vital reading ('72 bpm') normalized with canonical unit");
  } catch (err) {
    testFail("Extraction 3: Vital reading ('72 bpm') normalized with canonical unit", err);
  }

  // ---------------------------------------------------------------------------
  // 4. Valid Functional Mobility Extraction (2 blocks)
  // ---------------------------------------------------------------------------
  try {
    const fact = createMockFact({
      concept: "functional_mobility_range",
      sourceUtterance: "I can usually walk 2 blocks before feeling out of breath.",
    });

    const result = extractLongitudinalCandidate(fact, defaultContext);
    assert.strictEqual(result.eligible, true);
    if (result.eligible) {
      assert.strictEqual(result.factParams.concept, "functional_mobility_range");
      assert.strictEqual(result.factParams.category, "functional_mobility");
      assert.strictEqual(result.factParams.numericValue, 2);
      assert.strictEqual(result.factParams.unit, "blocks");
      assert.strictEqual(result.factParams.temporalScope, "baseline");
    }

    testPass("Extraction 4: Functional mobility ('2 blocks') recognized and classified as baseline");
  } catch (err) {
    testFail("Extraction 4: Functional mobility ('2 blocks') recognized and classified as baseline", err);
  }

  // ---------------------------------------------------------------------------
  // 5. Rejection of Unsupported Clinical Concepts (Acute symptoms)
  // ---------------------------------------------------------------------------
  try {
    const fact = createMockFact({
      concept: "acute_chest_pain",
      sourceUtterance: "I have crushing chest pain for 40 minutes.",
    });

    const result = extractLongitudinalCandidate(fact, defaultContext);
    assert.strictEqual(result.eligible, false);
    if (!result.eligible) {
      assert.ok(result.rejectionReason.includes("not registered for longitudinal persistence"));
    }

    testPass("Rejection 5: Acute clinical symptom ('acute_chest_pain') rejected from longitudinal promotion");
  } catch (err) {
    testFail("Rejection 5: Acute clinical symptom ('acute_chest_pain') rejected from longitudinal promotion", err);
  }

  // ---------------------------------------------------------------------------
  // 6. Rejection of Denied/Absent Symptoms (assertionStatus === 'absent')
  // ---------------------------------------------------------------------------
  try {
    const fact = createMockFact({
      concept: "sleep_duration",
      assertionStatus: "absent",
      sourceUtterance: "I do not have trouble sleeping.",
    });

    const result = extractLongitudinalCandidate(fact, defaultContext);
    assert.strictEqual(result.eligible, false);
    if (!result.eligible) {
      assert.ok(result.rejectionReason.includes("assertionStatus is 'absent'"));
    }

    testPass("Rejection 6: Denied assertion ('absent') strictly rejected");
  } catch (err) {
    testFail("Rejection 6: Denied assertion ('absent') strictly rejected", err);
  }

  // ---------------------------------------------------------------------------
  // 7. Rejection of Uncertain Assertions (assertionStatus === 'uncertain')
  // ---------------------------------------------------------------------------
  try {
    const fact = createMockFact({
      concept: "sleep_duration",
      assertionStatus: "uncertain",
      sourceUtterance: "Maybe I sleep 5 hours, I'm not really sure.",
    });

    const result = extractLongitudinalCandidate(fact, defaultContext);
    assert.strictEqual(result.eligible, false);
    if (!result.eligible) {
      assert.ok(result.rejectionReason.includes("assertionStatus is 'uncertain'"));
    }

    testPass("Rejection 7: Uncertain observation ('uncertain') strictly rejected");
  } catch (err) {
    testFail("Rejection 7: Uncertain observation ('uncertain') strictly rejected", err);
  }

  // ---------------------------------------------------------------------------
  // 8. Rejection of Third-Party Statements (Mother's statement when target is self)
  // ---------------------------------------------------------------------------
  try {
    const fact = createMockFact({
      concept: "sleep_duration",
      sourceUtterance: "My mother sleeps only 4 hours a night.",
    });

    const result = extractLongitudinalCandidate(fact, {
      ...defaultContext,
      targetSubjectRelation: "self",
    });
    assert.strictEqual(result.eligible, false);
    if (!result.eligible) {
      assert.ok(result.rejectionReason.includes("third-party relative"));
    }

    testPass("Rejection 8: Third-party relative statement prevented from leaking into self profile");
  } catch (err) {
    testFail("Rejection 8: Third-party relative statement prevented from leaking into self profile", err);
  }

  // ---------------------------------------------------------------------------
  // 9. Rejection of Clinician / AI-Inferred Speaker Sources
  // ---------------------------------------------------------------------------
  try {
    const fact = createMockFact({
      concept: "sleep_duration",
      sourceSpeaker: "clinician",
      sourceUtterance: "Patient appears to sleep 6 hours.",
    });

    const result = extractLongitudinalCandidate(fact, defaultContext);
    assert.strictEqual(result.eligible, false);
    if (!result.eligible) {
      assert.ok(result.rejectionReason.includes("Source speaker is 'clinician'"));
    }

    testPass("Rejection 9: Clinician / AI-inferred observation rejected from patient-reported promotion");
  } catch (err) {
    testFail("Rejection 9: Clinician / AI-inferred observation rejected from patient-reported promotion", err);
  }

  // ---------------------------------------------------------------------------
  // 10. Numeric Parsing Precision: Minutes-to-Hours Conversion
  // ---------------------------------------------------------------------------
  try {
    const fact = createMockFact({
      concept: "sleep_duration",
      sourceUtterance: "I usually get around 300 minutes of sleep each night.",
    });

    const result = extractLongitudinalCandidate(fact, defaultContext);
    assert.strictEqual(result.eligible, true);
    if (result.eligible) {
      assert.strictEqual(result.factParams.numericValue, 5); // 300 / 60 = 5
      assert.strictEqual(result.factParams.unit, "hours/night");
      assert.strictEqual(result.factParams.reportedValue, "5 hours");
    }

    testPass("Precision 10: Correctly converted '300 minutes' to 5.0 hours/night");
  } catch (err) {
    testFail("Precision 10: Correctly converted '300 minutes' to 5.0 hours/night", err);
  }

  // ---------------------------------------------------------------------------
  // 11. Strict Verification Status Guarantee ('unverified')
  // ---------------------------------------------------------------------------
  try {
    const fact = createMockFact({
      concept: "sleep_duration",
      sourceUtterance: "I sleep 7 hours.",
    });

    const result = extractLongitudinalCandidate(fact, defaultContext);
    assert.strictEqual(result.eligible, true);
    if (result.eligible) {
      assert.strictEqual(result.factParams.verification, "unverified", "Must strictly be unverified");
    }

    testPass("Guarantee 11: Verification status strictly initialized to 'unverified'");
  } catch (err) {
    testFail("Guarantee 11: Verification status strictly initialized to 'unverified'", err);
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

runLongitudinalExtractorTests().catch((err) => {
  console.error("FATAL in longitudinal fact extractor tests:", err);
  process.exit(1);
});
