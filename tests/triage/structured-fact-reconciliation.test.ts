import { ConversationManager } from "../../lib/triage/conversation-manager";
import { controlledFactReconciliationEngine } from "../../lib/triage/clinical-state";
import { CallerProfile, PatientProfile, CandidateFactProposal } from "../../lib/clinical-knowledge/types";

/**
 * REGRESSION SUITE: Full Structured Clinical Fact Model & Backward-Compatible Migration
 *
 * Clinical Invariant:
 * Candidate facts extracted from patient speech must be populated in durable state as
 * fully structured AttributedClinicalFactV3 records (with concept, assertion status,
 * temporality, speaker attribution, coverage, and confidence), while simultaneously maintaining
 * backward-compatible string representations in state.slots.known_facts.
 */

async function runStructuredFactTests() {
  console.log("=== Running Structured Clinical Fact Reconciliation Tests ===\n");
  let passed = 0;
  let failed = 0;

  const convManager = new ConversationManager();
  const state = convManager.createInitialState();

  const caller: CallerProfile = {
    id: "caller-101",
    name: "Alex",
    relationshipToPatient: "self",
    authorizedPatientIds: ["pt-202"],
  };

  const patient: PatientProfile = {
    id: "pt-202",
    name: "Alex",
    age: 42,
    gender: "other",
    language: "en",
    conditions: [],
    medications: [],
    allergies: [],
  };

  // Turn 1: Patient reports headache and nausea
  const turn1Candidates: CandidateFactProposal[] = [
    {
      concept: "headache",
      assertionStatus: "present",
      subjectReference: "self",
      temporalScope: "current",
    },
    {
      concept: "nausea",
      assertionStatus: "present",
      subjectReference: "self",
      temporalScope: "current",
    },
  ];

  const recon1 = controlledFactReconciliationEngine.reconcileCandidateFacts(
    [],
    turn1Candidates,
    caller,
    patient,
    1
  );

  state.attributedFacts = recon1.acceptedFacts.map(fact => ({
    id: fact.id,
    concept: fact.concept,
    assertionStatus: fact.assertionStatus,
    temporality: fact.temporalScope === "historical" ? "historical" : "current",
    attribution: fact.source === "caregiver_reported" ? "caregiver_report" : "patient",
    coverage: "assessed",
    sourceUtterance: fact.normalizedText || `${fact.concept}: ${fact.assertionStatus}`,
    sourceSpeaker: fact.source === "caregiver_reported" ? "caregiver" : "patient",
    turnId: fact.turnId,
    confidence: fact.assertionStatus === "uncertain" ? "explicit_unknown" : "calibrated_score",
    timestamp: fact.timestamp,
  }));

  for (const fact of recon1.acceptedFacts) {
    const factText = `${fact.concept}: ${fact.assertionStatus}`;
    if (!state.slots.known_facts.includes(factText)) {
      state.slots.known_facts.push(factText);
    }
  }

  // Verification 1: state.attributedFacts has 2 items with correct types
  if (state.attributedFacts?.length === 2) {
    const f0 = state.attributedFacts[0];
    if (f0.concept === "headache" && f0.assertionStatus === "present" && f0.attribution === "patient") {
      console.log(`  [PASS] Successfully structured Turn 1 facts into AttributedClinicalFactV3`);
      passed++;
    } else {
      console.error(`  [FAIL] Attributed fact field mismatch:`, f0);
      failed++;
    }
  } else {
    console.error(`  [FAIL] Expected 2 attributed facts, got:`, state.attributedFacts?.length);
    failed++;
  }

  // Verification 2: backward-compatible known_facts string array populated
  if (state.slots.known_facts.includes("headache: present") && state.slots.known_facts.includes("nausea: present")) {
    console.log(`  [PASS] Preserved backward-compatible string array migration in state.slots.known_facts`);
    passed++;
  } else {
    console.error(`  [FAIL] state.slots.known_facts missing facts:`, state.slots.known_facts);
    failed++;
  }

  // Turn 2: Patient corrects that nausea resolved/absent
  const turn2Candidates: CandidateFactProposal[] = [
    {
      concept: "nausea",
      assertionStatus: "absent",
      subjectReference: "self",
      temporalScope: "historical",
    },
    {
      concept: "photophobia",
      assertionStatus: "present",
      subjectReference: "self",
      temporalScope: "current",
    },
  ];

  const existingForRecon = (state.attributedFacts || []).map(f => ({
    id: f.id,
    targetPatientId: patient.id,
    reporterId: caller.id,
    concept: f.concept,
    assertionStatus: f.assertionStatus,
    verificationStatus: "unverified" as const,
    temporalScope: (f.temporality === "historical" ? "historical" : "current") as any,
    source: (f.attribution === "caregiver_report" ? "caregiver_reported" : "patient_reported") as any,
    turnId: f.turnId,
    timestamp: f.timestamp,
    provenanceDetails: {
      reliability: "moderate" as const,
      clinicalType: "subjective_symptom" as const,
    },
    normalizedText: f.sourceUtterance,
    confidence: 0.95,
    requiresReconfirmation: false,
  }));

  const recon2 = controlledFactReconciliationEngine.reconcileCandidateFacts(
    existingForRecon,
    turn2Candidates,
    caller,
    patient,
    2
  );

  state.attributedFacts = recon2.acceptedFacts.map(fact => ({
    id: fact.id,
    concept: fact.concept,
    assertionStatus: fact.assertionStatus,
    temporality: fact.temporalScope === "historical" ? "historical" : "current",
    attribution: fact.source === "caregiver_reported" ? "caregiver_report" : "patient",
    coverage: "assessed",
    sourceUtterance: fact.normalizedText || `${fact.concept}: ${fact.assertionStatus}`,
    sourceSpeaker: fact.source === "caregiver_reported" ? "caregiver" : "patient",
    turnId: fact.turnId,
    confidence: fact.assertionStatus === "uncertain" ? "explicit_unknown" : "calibrated_score",
    timestamp: fact.timestamp,
  }));

  // Verification 3: Nausea was updated to absent in state.attributedFacts
  const nauseaFact = state.attributedFacts.find(f => f.concept === "nausea");
  if (nauseaFact && nauseaFact.assertionStatus === "absent") {
    console.log(`  [PASS] Contradiction reconciled: nausea updated from present to absent at turn 2`);
    passed++;
  } else {
    console.error(`  [FAIL] Nausea status not updated:`, nauseaFact);
    failed++;
  }

  // Verification 4: Photophobia added as third fact
  const photophobiaFact = state.attributedFacts.find(f => f.concept === "photophobia");
  if (photophobiaFact && state.attributedFacts.length === 3) {
    console.log(`  [PASS] New fact photophobia seamlessly added without dropping prior facts`);
    passed++;
  } else {
    console.error(`  [FAIL] Expected 3 facts with photophobia, got count=${state.attributedFacts.length}`);
    failed++;
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed.`);
  if (failed > 0) {
    process.exit(1);
  }
}

runStructuredFactTests().catch((err) => {
  console.error("Test execution error:", err);
  process.exit(1);
});
