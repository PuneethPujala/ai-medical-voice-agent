import assert from "assert";
import { generateFHIRBundle, validateFhirR4Bundle, ConsultationRecordFHIR } from "../../lib/fhir/bundle";

console.log("================================================================================");
console.log("     TEST SUITE: FHIR CONDITION TEMPORAL DECOUPLING & PROVENANCE               ");
console.log("================================================================================\n");

let passedCount = 0;
let failedCount = 0;

function runTest(testId: string, description: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ [${testId}] PASS: ${description}`);
    passedCount++;
  } catch (err: any) {
    console.error(`  ✗ [${testId}] FAIL: ${description}`);
    console.error(`    Error: ${err?.message || err}`);
    failedCount++;
  }
}

// -----------------------------------------------------------------------------
// Test 1: Condition recordedDate anchored to clinical fact / turn timestamp
// -----------------------------------------------------------------------------
runTest("COND-TEMP-01-RECORDED-DATE", "Condition recordedDate reflects when finding was established in encounter", () => {
  const recordWithFacts: ConsultationRecordFHIR = {
    id: "CONSULT-FACTS-01",
    createdAt: "2026-10-25T10:00:00.000Z",
    icd10Codes: ["R07.9"], // Chest pain
    attributedFacts: [
      {
        id: "fact-01",
        concept: "chest_pain",
        assertionStatus: "present" as const,
        temporality: "current" as const,
        attribution: "patient" as const,
        coverage: "assessed" as const,
        turnId: 2,
        sourceSpeaker: "patient" as const,
        confidence: "calibrated_score" as const,
        timestamp: "2026-10-25T10:03:45.000Z",
        sourceUtterance: "I started feeling crushing chest pain about 2 hours ago",
      },
    ],
    deliveredTurnRecords: [
      {
        turnId: 1,
        timestamp: "2026-10-25T10:00:30.000Z",
        deliveredText: "Hello, what brings you in?",
        conversationalAction: "INQUIRE",
        intendedTargets: [],
        targetResolutionStatuses: {},
        relevantEvidenceRefs: [],
        caseVersion: 1,
      },
      {
        turnId: 2,
        timestamp: "2026-10-25T10:03:45.000Z",
        deliveredText: "I understand you have chest pain.",
        conversationalAction: "ACKNOWLEDGE_AND_UPDATE",
        intendedTargets: [],
        targetResolutionStatuses: {},
        relevantEvidenceRefs: ["fact-01"],
        caseVersion: 2,
      },
    ],
  };

  const bundle = generateFHIRBundle(recordWithFacts);
  const condEntry = bundle.entry.find((e) => e.resource.resourceType === "Condition");
  assert.ok(condEntry, "Bundle must contain a Condition resource");
  const cond = condEntry.resource;

  // Invariant 1: recordedDate reflects when the clinical fact was established in the encounter (turn 2)
  assert.strictEqual(cond.recordedDate, "2026-10-25T10:03:45.000Z");

  // Invariant 2: Turn timestamp is NEVER set as onsetDateTime!
  assert.strictEqual(cond.onsetDateTime, undefined, "Turn timestamp must NEVER be used as onsetDateTime");

  // Invariant 3: Approximate narrative onset is mapped to onsetString
  assert.ok(cond.onsetString, "Narrative onset must be mapped to onsetString");
  assert.ok(cond.onsetString.includes("2 hours"), `onsetString should mention '2 hours', got '${cond.onsetString}'`);

  // Validation
  const validation = validateFhirR4Bundle(bundle as unknown as Record<string, unknown>);
  assert.strictEqual(validation.valid, true, "Bundle must satisfy FHIR R4 validation");
});

// -----------------------------------------------------------------------------
// Test 2: Condition with no narrative onset leaves onset[x] omitted
// -----------------------------------------------------------------------------
runTest("COND-TEMP-02-OMIT-UNKNOWN-ONSET", "Condition with no clinical onset evidence omits onset[x]", () => {
  const recordNoOnset: ConsultationRecordFHIR = {
    id: "CONSULT-NO-ONSET-02",
    createdAt: "2026-10-25T10:00:00.000Z",
    icd10Codes: ["R50.9"], // Fever
    attributedFacts: [
      {
        id: "fact-fever",
        concept: "fever",
        assertionStatus: "present" as const,
        temporality: "current" as const,
        attribution: "patient" as const,
        coverage: "assessed" as const,
        turnId: 1,
        sourceSpeaker: "patient" as const,
        confidence: "calibrated_score" as const,
        timestamp: "2026-10-25T10:01:10.000Z",
        sourceUtterance: "Yes, I also have a fever", // No timeline/duration mentioned
      },
    ],
  };

  const bundle = generateFHIRBundle(recordNoOnset);
  const condEntry = bundle.entry.find((e) => e.resource.resourceType === "Condition");
  assert.ok(condEntry);
  const cond = condEntry.resource;

  assert.strictEqual(cond.recordedDate, "2026-10-25T10:01:10.000Z");
  assert.strictEqual(cond.onsetDateTime, undefined, "Must NOT set onsetDateTime");
  assert.strictEqual(cond.onsetString, undefined, "Must NOT set onsetString when unknown");
  assert.strictEqual(cond.onsetPeriod, undefined, "Must NOT set onsetPeriod when unknown");
  assert.strictEqual(cond.onsetAge, undefined, "Must NOT set onsetAge when unknown");
  assert.strictEqual(cond.onsetRange, undefined, "Must NOT set onsetRange when unknown");
});

// -----------------------------------------------------------------------------
// Test 3: Backward compatibility: fallback to record.createdAt if no facts
// -----------------------------------------------------------------------------
runTest("COND-TEMP-03-LEGACY-FALLBACK", "Legacy record without attributedFacts falls back to record.createdAt", () => {
  const legacyRecord: ConsultationRecordFHIR = {
    id: "CONSULT-LEGACY-03",
    createdAt: "2026-10-25T08:30:00.000Z",
    icd10Codes: ["R07.9"],
  };

  const bundle = generateFHIRBundle(legacyRecord);
  const condEntry = bundle.entry.find((e) => e.resource.resourceType === "Condition");
  assert.ok(condEntry);
  const cond = condEntry.resource;

  assert.strictEqual(cond.recordedDate, "2026-10-25T08:30:00.000Z");
  assert.strictEqual(cond.onsetDateTime, undefined);
  assert.strictEqual(cond.onsetString, undefined);

  // Encounter.period.end must be omitted for legacy record without interaction end evidence (F8-01)
  const enc = bundle.entry.find((e) => e.resource.resourceType === "Encounter")?.resource;
  assert.ok(enc);
  assert.strictEqual(enc.period.start, "2026-10-25T08:30:00.000Z");
  assert.strictEqual(enc.period.end, undefined, "Legacy encounter without turns must omit period.end");
});

// -----------------------------------------------------------------------------
// Test 4: Medication frequency does NOT leak into Condition onset (F8-04)
// -----------------------------------------------------------------------------
runTest("COND-TEMP-04-MEDICATION-FREQUENCY-EXCLUSION", "Medication dosing frequency is strictly excluded from symptom onset", () => {
  const recordWithMeds: ConsultationRecordFHIR = {
    id: "CONSULT-MEDS-04",
    createdAt: "2026-10-25T10:00:00.000Z",
    icd10Codes: ["R50.9"], // Fever
    attributedFacts: [
      {
        id: "fact-med",
        concept: "fever",
        assertionStatus: "present" as const,
        temporality: "current" as const,
        attribution: "patient" as const,
        coverage: "assessed" as const,
        turnId: 1,
        sourceSpeaker: "patient" as const,
        confidence: "calibrated_score" as const,
        timestamp: "2026-10-25T10:01:00.000Z",
        sourceUtterance: "I have a fever and I take paracetamol every 6 hours",
      },
    ],
  };

  const bundle = generateFHIRBundle(recordWithMeds);
  const cond = bundle.entry.find((e) => e.resource.resourceType === "Condition")?.resource;
  assert.ok(cond);

  assert.strictEqual(cond.recordedDate, "2026-10-25T10:01:00.000Z");
  assert.strictEqual(cond.onsetString, undefined, "Medication frequency 'every 6 hours' must NOT be extracted as onsetString");
  assert.strictEqual(cond.onsetDateTime, undefined);
});

// -----------------------------------------------------------------------------
// Test 5: Composition.date, Bundle.timestamp, and Triage Timing Separation (F8-02, F8-03, F8-05)
// -----------------------------------------------------------------------------
runTest("COND-TEMP-05-COMPOSITION-BUNDLE-TRIAGE-SEPARATION", "Composition.date, Bundle.timestamp, and Triage observation reflect distinct semantics", () => {
  const fullRecord: ConsultationRecordFHIR = {
    id: "CONSULT-DISTINCT-05",
    createdAt: "2026-10-25T10:00:00.000Z",
    approvedAt: "2026-10-25T11:15:00.000Z", // Doctor sign-off
    bundleTimestamp: "2026-10-25T12:00:00.000Z", // Export assembly time
    triageLevel: "emergency",
    esiScore: 2,
    deliveredTurnRecords: [
      {
        turnId: 1,
        timestamp: "2026-10-25T10:00:30.000Z",
        conversationalAction: "INQUIRE",
        deliveredText: "Hello",
        intendedTargets: [],
        targetResolutionStatuses: {},
        relevantEvidenceRefs: [],
        caseVersion: 1,
      },
      {
        turnId: 2,
        timestamp: "2026-10-25T10:01:45.000Z",
        conversationalAction: "EMERGENCY_ESCALATION", // Critical triage escalation
        deliveredText: "This is a medical emergency",
        intendedTargets: [],
        targetResolutionStatuses: {},
        relevantEvidenceRefs: ["fact-cardiac"],
        caseVersion: 2,
      },
      {
        turnId: 3,
        timestamp: "2026-10-25T10:05:00.000Z",
        conversationalAction: "ACKNOWLEDGE_AND_UPDATE", // Final closing turn
        deliveredText: "Stay on the line",
        intendedTargets: [],
        targetResolutionStatuses: {},
        relevantEvidenceRefs: [],
        caseVersion: 3,
      },
    ],
  };

  const bundle = generateFHIRBundle(fullRecord);

  // 1. Bundle.timestamp represents assembly time (F8-05)
  assert.strictEqual(bundle.timestamp, "2026-10-25T12:00:00.000Z");
  assert.strictEqual(bundle.meta.lastUpdated, "2026-10-25T12:00:00.000Z");

  // 2. Composition.date represents physician sign-off / authoring time, NOT final turn (F8-02)
  const comp = bundle.entry[0].resource;
  assert.strictEqual(comp.date, "2026-10-25T11:15:00.000Z");

  // 3. Triage observation effectiveDateTime represents Turn 2 escalation time, NOT final turn 3 (F8-03)
  const triageObs = bundle.entry.find((e) => e.resource.id?.startsWith("observation-esi-"))?.resource;
  assert.ok(triageObs);
  assert.strictEqual(triageObs.effectiveDateTime, "2026-10-25T10:01:45.000Z");

  // 4. Encounter.period spans turn 1 to turn 3
  const enc = bundle.entry.find((e) => e.resource.resourceType === "Encounter")?.resource;
  assert.ok(enc);
  assert.strictEqual(enc.period?.start, "2026-10-25T10:00:00.000Z");
  assert.strictEqual(enc.period?.end, "2026-10-25T10:05:00.000Z");
});

// -----------------------------------------------------------------------------
// Test 6: Unapproved consultation exported on demand sets Composition.date to export authoring time (F8-02)
// -----------------------------------------------------------------------------
runTest("COND-TEMP-06-UNAPPROVED-COMPOSITION-DATE", "Unapproved on-demand export sets Composition.date to documentGenerationTime, NOT createdAt", () => {
  const unapprovedRecord: ConsultationRecordFHIR = {
    id: "CONSULT-UNAPPROVED-06",
    createdAt: "2026-10-20T08:00:00.000Z", // Historical consultation 5 days earlier
    // approvedAt is undefined (pending review)
    bundleTimestamp: "2026-10-25T14:30:00.000Z", // Assembled and exported on-demand today
    deliveredTurnRecords: [
      {
        turnId: 1,
        timestamp: "2026-10-20T08:00:30.000Z",
        conversationalAction: "INQUIRE",
        deliveredText: "Hello",
        intendedTargets: [],
        targetResolutionStatuses: {},
        relevantEvidenceRefs: [],
        caseVersion: 1,
      },
    ],
  };

  const bundle = generateFHIRBundle(unapprovedRecord);
  const comp = bundle.entry[0].resource;

  // Composition authoring date must reflect on-demand document generation time, NOT encounter creation
  assert.strictEqual(comp.date, "2026-10-25T14:30:00.000Z");
  assert.notStrictEqual(comp.date, unapprovedRecord.createdAt, "Must NOT conflate document authorship with encounter createdAt");
});

// -----------------------------------------------------------------------------
// Test 7: Routine consultation with no triage escalation omits Observation.effectiveDateTime (F8-03)
// -----------------------------------------------------------------------------
runTest("COND-TEMP-07-ROUTINE-TRIAGE-TIMING-OMITTED", "Routine consultation with no escalation action strictly omits triage effectiveDateTime", () => {
  const routineRecord: ConsultationRecordFHIR = {
    id: "CONSULT-ROUTINE-07",
    createdAt: "2026-10-25T10:00:00.000Z",
    triageLevel: "routine",
    esiScore: 4,
    deliveredTurnRecords: [
      {
        turnId: 1,
        timestamp: "2026-10-25T10:00:30.000Z",
        conversationalAction: "INQUIRE",
        deliveredText: "Hello, how can I help you today?",
        intendedTargets: [],
        targetResolutionStatuses: {},
        relevantEvidenceRefs: [],
        caseVersion: 1,
      },
      {
        turnId: 2,
        timestamp: "2026-10-25T10:02:00.000Z",
        conversationalAction: "ACKNOWLEDGE_AND_UPDATE",
        deliveredText: "Thank you for the information.",
        intendedTargets: [],
        targetResolutionStatuses: {},
        relevantEvidenceRefs: [],
        caseVersion: 2,
      },
    ],
  };

  const bundle = generateFHIRBundle(routineRecord);
  const triageObs = bundle.entry.find((e) => e.resource.id?.startsWith("observation-esi-"))?.resource;
  assert.ok(triageObs);

  // When no dedicated assessment or escalation event exists, effectiveDateTime must be omitted (undefined)
  assert.strictEqual(
    triageObs.effectiveDateTime,
    undefined,
    "Routine consultation without triage escalation action must omit effectiveDateTime"
  );

  // Bundle validation must pass without effectiveDateTime
  const validation = validateFhirR4Bundle(bundle as unknown as Record<string, unknown>);
  assert.strictEqual(validation.valid, true, "Bundle must satisfy FHIR R4 validation even with omitted effectiveDateTime");
});

// -----------------------------------------------------------------------------
// Test 8: Active Consultation ("in_progress") with turns and audio history (Finding 8 Correction)
// -----------------------------------------------------------------------------
runTest("COND-TEMP-08-ACTIVE-ENCOUNTER-IN-PROGRESS-NO-END", "Active ongoing consultation with turns maps to in-progress and strictly omits period.end", () => {
  const activeRecord: ConsultationRecordFHIR = {
    id: "CONSULT-ACTIVE-08",
    createdAt: "2026-10-25T11:00:00.000Z",
    status: "in_progress", // Active live consultation
    triageLevel: "priority",
    esiScore: 3,
    deliveredTurnRecords: [
      {
        turnId: 1,
        timestamp: "2026-10-25T11:00:30.000Z",
        conversationalAction: "INQUIRE",
        deliveredText: "Hello, what symptoms are you having?",
        intendedTargets: [],
        targetResolutionStatuses: {},
        relevantEvidenceRefs: [],
        caseVersion: 1,
      },
      {
        turnId: 2,
        timestamp: "2026-10-25T11:02:15.000Z",
        conversationalAction: "CLARIFY_AMBIGUITY",
        deliveredText: "Can you describe the tightness in your chest?",
        intendedTargets: [],
        targetResolutionStatuses: {},
        relevantEvidenceRefs: [],
        caseVersion: 2,
      },
      {
        turnId: 3,
        timestamp: "2026-10-25T11:04:45.000Z",
        conversationalAction: "ACKNOWLEDGE_AND_UPDATE",
        deliveredText: "Understood, evaluating that now.",
        intendedTargets: [],
        targetResolutionStatuses: {},
        relevantEvidenceRefs: [],
        caseVersion: 3,
      },
    ],
    audioMetricsHistory: [
      { turnIndex: 1, timestamp: "2026-10-25T11:00:35.000Z", metrics: { durationMs: 2500 } as any },
      { turnIndex: 2, timestamp: "2026-10-25T11:02:20.000Z", metrics: { durationMs: 3100 } as any },
      { turnIndex: 3, timestamp: "2026-10-25T11:04:50.000Z", metrics: { durationMs: 4200 } as any },
    ],
  };

  const bundle = generateFHIRBundle(activeRecord);
  const enc = bundle.entry.find((e) => e.resource.resourceType === "Encounter")?.resource;
  assert.ok(enc, "Bundle must contain an Encounter resource");

  // Invariant 1: FHIR Encounter.status must be "in-progress"
  assert.strictEqual(enc.status, "in-progress", "Active consultation must map to Encounter.status = 'in-progress'");

  // Invariant 2: Encounter.period.start must be present
  assert.strictEqual(enc.period?.start, "2026-10-25T11:00:00.000Z");

  // Invariant 3: Encounter.period.end MUST be absent from the serialized resource!
  assert.strictEqual(enc.period?.end, undefined, "Active encounter with turns must NEVER fabricate an end timestamp");
  assert.strictEqual("end" in enc.period, false, "period.end key must not exist on active Encounter");

  // Invariant 4: Must satisfy FHIR R4 validation
  const validation = validateFhirR4Bundle(bundle as unknown as Record<string, unknown>);
  assert.strictEqual(validation.valid, true, "Active bundle must be valid FHIR R4");
});

// -----------------------------------------------------------------------------
// Test 9: Completed Consultation with reliable end-event evidence
// -----------------------------------------------------------------------------
runTest("COND-TEMP-09-COMPLETED-ENCOUNTER-WITH-END", "Completed consultation with turns maps to finished and sets period.end to latest event", () => {
  const completedRecord: ConsultationRecordFHIR = {
    id: "CONSULT-COMPLETED-09",
    createdAt: "2026-10-25T10:00:00.000Z",
    status: "completed_pending_review", // Finalized encounter
    deliveredTurnRecords: [
      {
        turnId: 1,
        timestamp: "2026-10-25T10:00:30.000Z",
        conversationalAction: "INQUIRE",
        deliveredText: "Hello",
        intendedTargets: [],
        targetResolutionStatuses: {},
        relevantEvidenceRefs: [],
        caseVersion: 1,
      },
      {
        turnId: 2,
        timestamp: "2026-10-25T10:06:15.000Z", // Final turn
        conversationalAction: "ACKNOWLEDGE_AND_UPDATE",
        deliveredText: "Care plan generated.",
        intendedTargets: [],
        targetResolutionStatuses: {},
        relevantEvidenceRefs: [],
        caseVersion: 2,
      },
    ],
  };

  const bundle = generateFHIRBundle(completedRecord);
  const enc = bundle.entry.find((e) => e.resource.resourceType === "Encounter")?.resource;
  assert.ok(enc);

  assert.strictEqual(enc.status, "finished", "Completed consultation must map to Encounter.status = 'finished'");
  assert.strictEqual(enc.period?.start, "2026-10-25T10:00:00.000Z");
  assert.strictEqual(enc.period?.end, "2026-10-25T10:06:15.000Z", "Finished encounter with turns must set period.end to latest turn");
});

// -----------------------------------------------------------------------------
// Test 10: Completed Consultation without reliable end-event evidence
// -----------------------------------------------------------------------------
runTest("COND-TEMP-10-COMPLETED-ENCOUNTER-NO-TURNS-OMITS-END", "Completed consultation without turn events omits period.end", () => {
  const completedNoEventsRecord: ConsultationRecordFHIR = {
    id: "CONSULT-COMPLETED-NO-EVENTS-10",
    createdAt: "2026-10-25T10:00:00.000Z",
    status: "completed_pending_review",
    deliveredTurnRecords: [],
    audioMetricsHistory: [],
  };

  const bundle = generateFHIRBundle(completedNoEventsRecord);
  const enc = bundle.entry.find((e) => e.resource.resourceType === "Encounter")?.resource;
  assert.ok(enc);

  assert.strictEqual(enc.status, "finished");
  assert.strictEqual(enc.period?.start, "2026-10-25T10:00:00.000Z");
  assert.strictEqual(enc.period?.end, undefined, "Finished encounter without events must omit period.end");
});

// -----------------------------------------------------------------------------
// Test 11: Unrecognized legacy status explicitly maps to unknown and omits period.end
// -----------------------------------------------------------------------------
runTest("COND-TEMP-11-UNRECOGNIZED-LEGACY-STATUS", "Unrecognized or legacy status maps to unknown and omits period.end", () => {
  const legacyUnknownRecord: ConsultationRecordFHIR = {
    id: "CONSULT-LEGACY-11",
    createdAt: "2026-10-25T10:00:00.000Z",
    status: "legacy_draft_unverified", // Custom / unrecognized status
    deliveredTurnRecords: [
      {
        turnId: 1,
        timestamp: "2026-10-25T10:01:00.000Z",
        conversationalAction: "INQUIRE",
        deliveredText: "Hello",
        intendedTargets: [],
        targetResolutionStatuses: {},
        relevantEvidenceRefs: [],
        caseVersion: 1,
      },
    ],
  };

  const bundle = generateFHIRBundle(legacyUnknownRecord);
  const enc = bundle.entry.find((e) => e.resource.resourceType === "Encounter")?.resource;
  assert.ok(enc);

  assert.strictEqual(enc.status, "unknown", "Unrecognized status must map to Encounter.status = 'unknown'");
  assert.strictEqual(enc.period?.end, undefined, "Unrecognized status must omit period.end");
});

console.log("\n================================================================================");
console.log(`  CONDITION TEMPORAL BATTERY: ${passedCount} PASSED, ${failedCount} FAILED`);
console.log("================================================================================\n");

if (failedCount > 0) {
  process.exit(1);
}
