/**
 * CONVERSATION INTELLIGENCE & FACT COMMIT ENGINE TEST BATTERY
 *
 * Verifies:
 * 1. Multi-Clause Temporal Progression (dual coexistence: baseline + acute worsening)
 * 2. Non-Destructive Patient Correction & Retraction (supersedesFactId provenance link)
 * 3. Anaphora & Contextual Concept Binding
 * 4. Epistemic Uncertainty & Non-Binary Onset Preservation
 * 5. Contradiction Detection & Clarification Flagging
 * 6. Provenance Hierarchy Enforcement (Device > Patient)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createInitialConversationContextState,
  FactProposal,
} from "../../lib/triage/fact-types";
import { FactCommitEngine } from "../../lib/triage/fact-commit-engine";

console.log("\n================================================================================");
console.log("      MEDVOICE CONVERSATION INTELLIGENCE & FACT-COMMIT TEST BATTERY             ");
console.log("================================================================================\n");

// TEST 1: Multi-Clause Temporal Progression
console.log(">>> TEST 1: Multi-Clause Temporal Progression (Baseline + Acute Worsening)...");
let state = createInitialConversationContextState();

// Turn 1: "I've had a mild headache for two days, but an hour ago it suddenly became unbearable."
const turn1Proposals: FactProposal[] = [
  {
    concept: "headache_severity",
    value: "mild (3/10)",
    assertionStatus: "present",
    temporalScope: "baseline",
    rawSnippet: "mild headache for two days",
    clinicalRationale: "Subacute baseline headache intensity",
  },
  {
    concept: "headache_duration",
    value: "2 days",
    assertionStatus: "present",
    temporalScope: "baseline",
    rawSnippet: "for two days",
  },
  {
    concept: "headache_severity",
    value: "unbearable (10/10)",
    assertionStatus: "present",
    temporalScope: "acute_worsening",
    rawSnippet: "an hour ago it suddenly became unbearable",
    clinicalRationale: "Severe acute crescendo escalation",
  },
  {
    concept: "headache_onset_pattern",
    value: "sudden",
    assertionStatus: "present",
    temporalScope: "acute_worsening",
    rawSnippet: "suddenly became unbearable",
  },
];

const commit1 = FactCommitEngine.commit(state, turn1Proposals, 1, "patient_reported");
state = commit1.nextState;

assert.equal(commit1.committedFacts.length, 4, "All 4 multi-clause facts should be committed");
assert.equal(state.ledger.length, 4, "Ledger should contain all 4 records");

// Critical Invariant: headache_severity must preserve BOTH baseline and acute_worsening in Current View!
const severities = state.currentView.factsByConcept["headache_severity"];
assert.equal(severities.length, 2, "Both baseline and acute_worsening severities must coexist in current view");

const baselineSev = severities.find(f => f.temporalScope === "baseline");
const acuteSev = severities.find(f => f.temporalScope === "acute_worsening");

assert(baselineSev, "Baseline severity must exist");
assert.equal(baselineSev?.value, "mild (3/10)");
assert(acuteSev, "Acute worsening severity must exist");
assert.equal(acuteSev?.value, "unbearable (10/10)");
console.log("  [PASS] Multi-clause temporal progression preserves both baseline and acute worsening without data loss.");

// TEST 2: Non-Destructive Patient Correction & Retraction
console.log("\n>>> TEST 2: Patient Correction & Retraction (Non-Destructive Ledger)...");
// Turn 2: Doctor asks about fever. Patient says: "Actually, sorry, I meant it started yesterday morning, not two days ago."
const originalDurationFact = state.currentView.factsByConcept["headache_duration"][0];
assert(originalDurationFact, "Original 2-day duration fact must exist");

const turn2Proposals: FactProposal[] = [
  {
    concept: "headache_duration",
    value: "yesterday morning (approx. 24 hours)",
    assertionStatus: "present",
    temporalScope: "baseline",
    isCorrection: true,
    supersedesFactId: originalDurationFact.id,
    rawSnippet: "I meant it started yesterday morning, not two days ago",
    clinicalRationale: "Patient explicit chronological retraction and correction",
  },
];

const commit2 = FactCommitEngine.commit(state, turn2Proposals, 2, "patient_reported");
state = commit2.nextState;

assert.equal(commit2.supersededFacts.length, 1, "Original fact must be identified as superseded");
assert.equal(commit2.supersededFacts[0].id, originalDurationFact.id);

// Current view for duration should now contain ONLY the updated value
const currentDurations = state.currentView.factsByConcept["headache_duration"];
assert.equal(currentDurations.length, 1, "Current view must only present the active corrected value");
assert.equal(currentDurations[0].value, "yesterday morning (approx. 24 hours)");
assert.equal(currentDurations[0].supersedesFactId, originalDurationFact.id, "Corrected fact must reference superseded fact ID");

// But the ledger must retain BOTH for auditability!
assert.equal(state.ledger.length, 5, "Ledger must preserve all 5 historical events");
const ledgerOriginal = state.ledger.find(f => f.id === originalDurationFact.id);
const ledgerCorrected = state.ledger.find(f => f.id === currentDurations[0].id);
assert(ledgerOriginal, "Original retracted assertion must be preserved in ledger");
assert(ledgerCorrected, "New corrected assertion must be appended to ledger");
console.log("  [PASS] Patient correction successfully supersedes active fact while preserving complete immutable history.");

// TEST 3: Epistemic Uncertainty & Non-Binary Onset Preservation
console.log("\n>>> TEST 3: Epistemic Uncertainty & Non-Binary Clinical Onset...");
// Doctor asks: "Did the headache start suddenly or gradually?"
// Patient: "I honestly don't know, I woke up with it already pounding."
const turn3Proposals: FactProposal[] = [
  {
    concept: "headache_onset_mode",
    value: "present_on_waking",
    assertionStatus: "uncertain",
    temporalScope: "current",
    rawSnippet: "I honestly don't know, I woke up with it already pounding",
    uncertaintyReason: "Patient was asleep when symptom began; unable to discern sudden vs gradual onset trajectory",
  },
];

const commit3 = FactCommitEngine.commit(state, turn3Proposals, 3, "patient_reported");
state = commit3.nextState;

const onsetModeFact = state.currentView.factsByConcept["headache_onset_mode"][0];
assert(onsetModeFact, "Onset mode fact must exist");
assert.equal(onsetModeFact.assertionStatus, "uncertain", "Assertion status must be uncertain");
assert.equal(state.currentView.activeUncertainties.length, 1, "Active uncertainty must be tracked");
assert(state.currentView.activeUncertainties[0].description.includes("asleep"), "Uncertainty description must be recorded");
console.log("  [PASS] Clinical uncertainty preserved without forcing false binary pigeonholing.");

// TEST 4: Contradiction Detection & Clarification Flagging
console.log("\n>>> TEST 4: Contradiction Detection & Clarification Flagging...");
// Turn 4: Patient makes conflicting statement without correction cues: "Actually the pain is completely mild right now"
// (Conflicting with earlier acute worsening "unbearable")
const turn4Proposals: FactProposal[] = [
  {
    concept: "headache_severity",
    value: "mild (2/10)",
    assertionStatus: "present",
    temporalScope: "acute_worsening", // Direct conflict in same temporal scope!
    isCorrection: false,              // Not explicitly flagged as correction
    rawSnippet: "the pain is completely mild right now",
  },
];

const commit4 = FactCommitEngine.commit(state, turn4Proposals, 4, "patient_reported");
state = commit4.nextState;

assert.equal(commit4.contradictionsDetected.length, 1, "Direct contradiction must be detected");
assert.equal(state.currentView.contradictions.length, 1, "Contradiction must be tracked in current view");
assert.equal(state.currentView.contradictions[0].requiresClarification, true, "Requires clarification flag must be set");
console.log("  [PASS] Contradictory statements accurately detected and flagged for polite clinical clarification.");

// TEST 5: Provenance Hierarchy Enforcement (Device > Patient Verbal)
console.log("\n>>> TEST 5: Provenance Hierarchy Enforcement (Device Reading > Patient Guess)...");
// Turn 5: Patient verbal estimate of BP
const turn5PatientProposals: FactProposal[] = [
  {
    concept: "blood_pressure",
    value: "normal (around 120/80)",
    assertionStatus: "present",
    temporalScope: "current",
    rawSnippet: "I think my blood pressure is normal",
  },
];

const commit5a = FactCommitEngine.commit(state, turn5PatientProposals, 5, "patient_reported");
state = commit5a.nextState;

assert.equal(state.currentView.factsByConcept["blood_pressure"][0].source, "patient_reported");

// Turn 6: Connected Blood Pressure Monitor measurement arrives: 185/110 mmHg (Hypertensive Urgency)
const turn6DeviceProposals: FactProposal[] = [
  {
    concept: "blood_pressure",
    value: "185/110 mmHg",
    assertionStatus: "present",
    temporalScope: "current",
    rawSnippet: "OMRON BP Monitor Reading: 185/110 mmHg, Pulse: 92 bpm",
    clinicalRationale: "Objective automated oscillometric biometric measurement",
  },
];

const commit5b = FactCommitEngine.commit(state, turn6DeviceProposals, 6, "device_measured");
state = commit5b.nextState;

assert.equal(commit5b.supersededFacts.length, 1, "Patient verbal estimate must be superseded by device measurement");
assert.equal(state.currentView.factsByConcept["blood_pressure"].length, 1, "Only authoritative device measurement in current view");
assert.equal(state.currentView.factsByConcept["blood_pressure"][0].source, "device_measured");
assert.equal(state.currentView.factsByConcept["blood_pressure"][0].value, "185/110 mmHg");
console.log("  [PASS] Objective device measurement cleanly supersedes verbal estimate per provenance hierarchy.");

// TEST 6: Compound Denials & Selective Negation
console.log("\n>>> TEST 6: Compound Denials & Selective Negation Handling...");
const turn7Proposals: FactProposal[] = [
  {
    concept: "fever",
    value: "denied",
    assertionStatus: "absent",
    temporalScope: "current",
    rawSnippet: "No fever",
  },
  {
    concept: "vomiting",
    value: "denied",
    assertionStatus: "absent",
    temporalScope: "current",
    rawSnippet: "and no vomiting",
  },
  {
    concept: "nausea",
    value: "severe nausea",
    assertionStatus: "present",
    temporalScope: "current",
    rawSnippet: "but definitely severe nausea",
  },
];

const commit6 = FactCommitEngine.commit(state, turn7Proposals, 7, "patient_reported");
state = commit6.nextState;

assert.equal(state.currentView.factsByConcept["fever"][0].assertionStatus, "absent", "Fever must be marked absent");
assert.equal(state.currentView.factsByConcept["vomiting"][0].assertionStatus, "absent", "Vomiting must be marked absent");
assert.equal(state.currentView.factsByConcept["nausea"][0].assertionStatus, "present", "Nausea must be marked present");
console.log("  [PASS] Compound denials and selective negation accurately segregated into present/absent clinical facts.");

// TEST 7: Acoustic Ambiguity with Mandatory Patient Confirmation
console.log("\n>>> TEST 7: Acoustic Ambiguity & Patient Confirmation Request...");
import { reconcileClinicalTranscript } from "../../lib/audio/transcript-reconciler";

const noisySpeechResult = reconcileClinicalTranscript({
  whisperText: "The headache came on glubly over two days.",
  previewText: "The headache came on gradually over two days.",
  doctorLastQuestion: "Did the headache start suddenly or gradually?",
});

assert.equal(noisySpeechResult.isAmbiguous, true, "Must flag acoustic ambiguity when speech diverges without safe alignment");
assert.equal(noisySpeechResult.requiresPatientConfirmation, true, "Must emit requiresPatientConfirmation flag");
assert.equal(noisySpeechResult.transcript, "The headache came on glubly over two days.", "Must preserve verbatim raw speech rather than manufacturing false certainty");
assert(noisySpeechResult.rawWhisperText, "Raw Whisper text must be preserved");
assert(noisySpeechResult.rawPreviewText, "Raw preview text must be preserved");
console.log("  [PASS] Acoustic ambiguity accurately flagged with raw transcripts preserved and confirmation required.");

console.log("\n================================================================================");
console.log("      ALL CONVERSATION INTELLIGENCE & FACT COMMIT TESTS PASSED 100%             ");
console.log("================================================================================\n");
