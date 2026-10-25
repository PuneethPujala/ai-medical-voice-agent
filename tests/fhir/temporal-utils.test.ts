import assert from "assert";
import {
  normalizeIsoTimestamp,
  calculateEncounterPeriod,
  resolveAcousticTemporalSpan,
  extractNarrativeOnset,
  resolveTriageAssessmentTimestamp,
  mapEncounterStatus,
} from "../../lib/fhir/temporal-utils";

console.log("================================================================================");
console.log("             TEST SUITE: FHIR TEMPORAL PROVENANCE UTILITIES                    ");
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
// Test 1: Normalize valid ISO string and timezone offsets to canonical UTC ISO (Z)
// -----------------------------------------------------------------------------
runTest("TEMP-01-NORMALIZE-UTC", "Normalizes timezone offset (+05:30) to canonical UTC ISO string (Z)", () => {
  const normalized = normalizeIsoTimestamp("2026-10-25T15:30:00+05:30");
  assert.strictEqual(normalized, "2026-10-25T10:00:00.000Z");
});

runTest("TEMP-02-NORMALIZE-DATE-OBJ", "Normalizes Date object to canonical UTC ISO string (Z)", () => {
  const d = new Date("2026-10-25T10:00:00.000Z");
  const normalized = normalizeIsoTimestamp(d);
  assert.strictEqual(normalized, "2026-10-25T10:00:00.000Z");
});

// -----------------------------------------------------------------------------
// Test 2: Invalid or empty timestamp fallback
// -----------------------------------------------------------------------------
runTest("TEMP-03-FALLBACK-ON-INVALID", "Uses fallback when primary timestamp is invalid", () => {
  const fallback = "2026-10-25T10:00:00.000Z";
  assert.strictEqual(normalizeIsoTimestamp("invalid-date", fallback), fallback);
  assert.strictEqual(normalizeIsoTimestamp(undefined, fallback), fallback);
  assert.strictEqual(normalizeIsoTimestamp(null, fallback), fallback);
});

runTest("TEMP-04-NO-CURRENT-TIME-FABRICATION", "Does not fabricate new Date() when both ts and fallback are missing/invalid", () => {
  const res = normalizeIsoTimestamp("invalid-date", "also-invalid");
  assert.strictEqual(res, "");
});

// -----------------------------------------------------------------------------
// Test 3: Calculate Encounter Period from turn records (Refinement 1)
// -----------------------------------------------------------------------------
runTest("TEMP-05-ENCOUNTER-PERIOD-TURNS", "Calculates Encounter.period spanning first event to last turn event (not approvedAt)", () => {
  const turns = [
    { turnId: 1, timestamp: "2026-10-25T10:00:00.000Z" },
    { turnId: 2, timestamp: "2026-10-25T10:05:00.000Z" },
  ];
  const period = calculateEncounterPeriod({
    createdAt: "2026-10-25T09:59:50.000Z",
    approvedAt: "2026-10-25T10:20:00.000Z", // Doctor review happened 15 mins later
    deliveredTurnRecords: turns as any,
  });

  assert.strictEqual(period.start, "2026-10-25T09:59:50.000Z");
  // Crucial Refinement 1: Encounter interaction end must be the latest clinical encounter event, NOT approvedAt
  assert.strictEqual(period.end, "2026-10-25T10:05:00.000Z");
});

runTest("TEMP-06-ENCOUNTER-PERIOD-AUDIO-CONFIRMED", "Uses confirmed audio delivery timestamp if later than turn record", () => {
  const turns = [
    {
      turnId: 1,
      timestamp: "2026-10-25T10:00:00.000Z",
      audioDeliveryResult: { confirmedAt: "2026-10-25T10:00:05.000Z" },
    },
    {
      turnId: 2,
      timestamp: "2026-10-25T10:05:00.000Z",
      audioDeliveryResult: { confirmedAt: "2026-10-25T10:05:08.500Z" },
    },
  ];
  const period = calculateEncounterPeriod({
    createdAt: "2026-10-25T10:00:00.000Z",
    status: "completed_pending_review",
    deliveredTurnRecords: turns as any,
  });

  assert.strictEqual(period.start, "2026-10-25T10:00:00.000Z");
  assert.strictEqual(period.end, "2026-10-25T10:05:08.500Z");
});

runTest("TEMP-07-ENCOUNTER-PERIOD-LEGACY-FALLBACK", "Fallback for legacy consultation without turns preserves start and OMITS end (F8-01)", () => {
  const period = calculateEncounterPeriod({
    createdAt: "2026-10-25T10:00:00.000Z",
  });
  assert.strictEqual(period.start, "2026-10-25T10:00:00.000Z");
  assert.strictEqual(period.end, undefined, "period.end must be omitted when no reliable interaction end event exists");
});

runTest("TEMP-07B-ENCOUNTER-PERIOD-ACTIVE-OMITS-END-DESPITE-TURNS", "Active consultation with multiple turns & audio metrics strictly omits period.end", () => {
  const threeTurns = [
    { turnId: 1, timestamp: "2026-10-25T11:00:30.000Z", deliveredText: "Hello" },
    { turnId: 2, timestamp: "2026-10-25T11:02:15.000Z", deliveredText: "Tell me about the pain" },
    { turnId: 3, timestamp: "2026-10-25T11:04:45.000Z", deliveredText: "Evaluating your chest symptoms" },
  ];
  const audioHistory = [
    { turnIndex: 1, timestamp: "2026-10-25T11:00:35.000Z", metrics: { durationMs: 2500 } },
    { turnIndex: 2, timestamp: "2026-10-25T11:02:20.000Z", metrics: { durationMs: 3100 } },
    { turnIndex: 3, timestamp: "2026-10-25T11:04:50.000Z", metrics: { durationMs: 4200 } },
  ];

  const period = calculateEncounterPeriod({
    createdAt: "2026-10-25T11:00:00.000Z",
    status: "in_progress", // Active consultation ongoing
    deliveredTurnRecords: threeTurns as any,
    audioMetricsHistory: audioHistory as any,
  });

  assert.strictEqual(period.start, "2026-10-25T11:00:00.000Z");
  // CRITICAL REQUIREMENT: Active encounter MUST NOT set period.end even though turns & audio exist!
  assert.strictEqual(period.end, undefined, "Active encounter with turns must NEVER fabricate encounter closure");
});

runTest("TEMP-07C-COMPLETED-WITH-RELIABLE-END", "Completed consultation with turns emits period.end matching latest event", () => {
  const turns = [
    { turnId: 1, timestamp: "2026-10-25T10:00:00.000Z" },
    { turnId: 2, timestamp: "2026-10-25T10:08:30.000Z" },
  ];
  const period = calculateEncounterPeriod({
    createdAt: "2026-10-25T09:59:00.000Z",
    status: "completed_pending_review",
    deliveredTurnRecords: turns as any,
  });

  assert.strictEqual(period.start, "2026-10-25T09:59:00.000Z");
  assert.strictEqual(period.end, "2026-10-25T10:08:30.000Z");
});

runTest("TEMP-07D-COMPLETED-WITHOUT-RELIABLE-END", "Completed consultation without interaction events omits period.end", () => {
  const period = calculateEncounterPeriod({
    createdAt: "2026-10-25T10:00:00.000Z",
    status: "completed_pending_review",
    deliveredTurnRecords: [],
    audioMetricsHistory: [],
  });

  assert.strictEqual(period.start, "2026-10-25T10:00:00.000Z");
  assert.strictEqual(period.end, undefined, "Completed encounter without turns must omit period.end");
});

runTest("TEMP-07E-UNRECOGNIZED-LEGACY-STATUS-OMITS-END", "Unrecognized or legacy status without approval omits period.end even with turns", () => {
  const turns = [
    { turnId: 1, timestamp: "2026-10-25T10:00:00.000Z" },
    { turnId: 2, timestamp: "2026-10-25T10:05:00.000Z" },
  ];
  const period = calculateEncounterPeriod({
    createdAt: "2026-10-25T10:00:00.000Z",
    status: "legacy_draft_unknown",
    deliveredTurnRecords: turns as any,
  });

  assert.strictEqual(period.start, "2026-10-25T10:00:00.000Z");
  assert.strictEqual(period.end, undefined, "Unrecognized status must not be assumed finished");
});

runTest("TEMP-07F-MAP-ENCOUNTER-STATUS", "Maps all consultation lifecycle statuses to valid FHIR Encounter.status codes", () => {
  assert.strictEqual(mapEncounterStatus("in_progress"), "in-progress");
  assert.strictEqual(mapEncounterStatus("in-progress"), "in-progress");
  assert.strictEqual(mapEncounterStatus("active"), "in-progress");
  assert.strictEqual(mapEncounterStatus("completed_pending_review"), "finished");
  assert.strictEqual(mapEncounterStatus("approved"), "finished");
  assert.strictEqual(mapEncounterStatus("completed"), "finished");
  assert.strictEqual(mapEncounterStatus("cancelled"), "cancelled");
  assert.strictEqual(mapEncounterStatus("abandoned"), "cancelled");
  assert.strictEqual(mapEncounterStatus("unknown_custom_status"), "unknown");
  assert.strictEqual(mapEncounterStatus(undefined, undefined), "unknown");
  assert.strictEqual(mapEncounterStatus(undefined, "2026-10-25T12:00:00.000Z"), "finished");
});

// -----------------------------------------------------------------------------
// Test 4: Multi-Turn Acoustic Temporal Span (Refinement 2)
// -----------------------------------------------------------------------------
runTest("TEMP-08-ACOUSTIC-MULTI-TURN-SPAN", "Resolves multi-turn acoustic telemetry into effectivePeriod", () => {
  const audioHistory = [
    { turnIndex: 1, timestamp: "2026-10-25T10:01:00.000Z", metrics: { durationMs: 3000 } },
    { turnIndex: 2, timestamp: "2026-10-25T10:04:30.000Z", metrics: { durationMs: 4500 } },
  ];
  const span = resolveAcousticTemporalSpan(audioHistory as any, "2026-10-25T10:00:00.000Z");

  assert.strictEqual(span.isMultiTurn, true);
  assert.strictEqual(span.effectiveDateTime, undefined);
  assert.ok(span.effectivePeriod);
  assert.strictEqual(span.effectivePeriod?.start, "2026-10-25T10:01:00.000Z");
  assert.strictEqual(span.effectivePeriod?.end, "2026-10-25T10:04:30.000Z");
});

runTest("TEMP-09-ACOUSTIC-SINGLE-TURN", "Resolves single-turn acoustic telemetry into effectiveDateTime", () => {
  const audioHistory = [
    { turnIndex: 1, timestamp: "2026-10-25T10:01:00.000Z", metrics: { durationMs: 3000 } },
  ];
  const span = resolveAcousticTemporalSpan(audioHistory as any, "2026-10-25T10:00:00.000Z");

  assert.strictEqual(span.isMultiTurn, false);
  assert.strictEqual(span.effectiveDateTime, "2026-10-25T10:01:00.000Z");
  assert.strictEqual(span.effectivePeriod, undefined);
});

runTest("TEMP-10-ACOUSTIC-FALLBACK-LEGACY", "Fallback for legacy consultation without audio history", () => {
  const span = resolveAcousticTemporalSpan(undefined, "2026-10-25T10:00:00.000Z");

  assert.strictEqual(span.isMultiTurn, false);
  assert.strictEqual(span.effectiveDateTime, "2026-10-25T10:00:00.000Z");
  assert.strictEqual(span.effectivePeriod, undefined);
});

// -----------------------------------------------------------------------------
// Test 5: Triage Assessment Timing (F8-03)
// -----------------------------------------------------------------------------
runTest("TEMP-11-TRIAGE-TIMING-ESCALATION-TURN", "Triage timing anchors to emergency escalation turn, not closing turn", () => {
  const turns = [
    { turnId: 1, timestamp: "2026-10-25T10:00:30.000Z", conversationalAction: "INQUIRE" },
    { turnId: 2, timestamp: "2026-10-25T10:01:45.000Z", conversationalAction: "EMERGENCY_ESCALATION" },
    { turnId: 3, timestamp: "2026-10-25T10:02:15.000Z", conversationalAction: "EXPLAIN_RATIONALE" },
    { turnId: 4, timestamp: "2026-10-25T10:06:00.000Z", conversationalAction: "ACKNOWLEDGE_AND_UPDATE" }, // Call wrap-up
  ];

  const triageTs = resolveTriageAssessmentTimestamp({
    deliveredTurnRecords: turns as any,
    createdAt: "2026-10-25T10:00:00.000Z",
  });

  // Must reflect turn 2 escalation, NEVER turn 4 closing turn
  assert.strictEqual(triageTs, "2026-10-25T10:01:45.000Z");
});

runTest("TEMP-12-TRIAGE-TIMING-NO-ESCALATION-OMITTED", "Triage timing returns undefined when no triage escalation event exists", () => {
  const triageTs = resolveTriageAssessmentTimestamp({
    createdAt: "2026-10-25T10:00:00.000Z",
  });
  assert.strictEqual(triageTs, undefined, "Without turns, triage timing must be omitted (undefined)");

  const routineTurns = [
    { turnId: 1, timestamp: "2026-10-25T10:00:30.000Z", conversationalAction: "INQUIRE" },
    { turnId: 2, timestamp: "2026-10-25T10:01:00.000Z", conversationalAction: "ACKNOWLEDGE_AND_UPDATE" },
  ];
  const routineTriageTs = resolveTriageAssessmentTimestamp({
    createdAt: "2026-10-25T10:00:00.000Z",
    deliveredTurnRecords: routineTurns as any,
  });
  assert.strictEqual(routineTriageTs, undefined, "Routine conversation without escalation omits triage timestamp");
});

// -----------------------------------------------------------------------------
// Test 6: Narrative Onset Extraction Tightening (F8-04)
// -----------------------------------------------------------------------------
runTest("TEMP-13-NARRATIVE-ONSET-POSITIVE", "Extracts clear clinical onset phrases accurately", () => {
  assert.ok(extractNarrativeOnset("I have had chest pain for 3 days")?.includes("3 days"));
  assert.ok(extractNarrativeOnset("crushing pain started 2 hours ago")?.includes("2 hours"));
  assert.ok(extractNarrativeOnset("severe symptoms began yesterday")?.includes("yesterday"));
  assert.ok(extractNarrativeOnset("fever since this morning")?.includes("this morning"));
  assert.ok(extractNarrativeOnset("started feeling crushing chest pain about 2 hours ago")?.includes("2 hours"));
});

runTest("TEMP-14-NARRATIVE-ONSET-NEGATIVE-EXCLUSIONS", "Strictly rejects medication frequencies and routine activity durations", () => {
  // Medication dosing frequency must NOT be classified as disease onset
  assert.strictEqual(extractNarrativeOnset("take medication every 8 hours"), undefined);
  assert.strictEqual(extractNarrativeOnset("I take paracetamol every 4 to 6 hours"), undefined);
  assert.strictEqual(extractNarrativeOnset("take one pill every 12 hours"), undefined);

  // Routine activities must NOT be classified as disease onset
  assert.strictEqual(extractNarrativeOnset("walked for 30 minutes"), undefined);
  assert.strictEqual(extractNarrativeOnset("rested for 20 minutes"), undefined);
  assert.strictEqual(extractNarrativeOnset("waited for 15 minutes"), undefined);
});

runTest("TEMP-15-NARRATIVE-ONSET-COMPLEX-MIXED", "Extracts symptom onset when co-occurring with medication dosing", () => {
  const text = "I take metformin every 12 hours, but my severe dizziness started 2 hours ago";
  const onset = extractNarrativeOnset(text);
  assert.ok(onset);
  assert.ok(onset.includes("2 hours"));
});

console.log("\n================================================================================");
console.log(`  FHIR TEMPORAL PROVENANCE BATTERY: ${passedCount} PASSED, ${failedCount} FAILED`);
console.log("================================================================================\n");

if (failedCount > 0) {
  process.exit(1);
}
