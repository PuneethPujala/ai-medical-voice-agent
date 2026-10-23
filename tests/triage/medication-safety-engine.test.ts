import assert from "assert";
import {
  screenMedicationSafety,
  extractMedicationMentions,
  DRUG_SYNONYMS_AND_BRANDS,
  EVIDENCE_BACKED_MEDICATION_RULES,
} from "../../lib/clinical-knowledge/safety-matrix";
import { PatientProfile, DrugAllergy } from "../../lib/clinical-knowledge/types";

console.log("================================================================================");
console.log("      TEST SUITE: DETERMINISTIC MEDICATION SAFETY & CONTRAINDICATION ENGINE     ");
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
// Test 1: Documented Penicillin Allergy in Patient Profile vs Prescribed Beta-Lactam
// -----------------------------------------------------------------------------
runTest("MED-01-ALLERGY-PROFILE", "Documented penicillin allergy in profile blocks Augmentin / Amoxicillin", () => {
  const profile: PatientProfile = {
    id: "pat-allergy-001",
    name: "Aarav Sharma",
    age: 34,
    allergyStatus: "confirmed",
    drugAllergies: [
      {
        drugName: "penicillin",
        reactionType: "allergy",
        severity: "severe",
        reactionDescription: "Laryngeal edema and hives",
      },
    ],
  };

  const result = screenMedicationSafety({
    patientProfile: profile,
    candidateAdvice: "You can take Augmentin 625mg twice daily for the infection.",
    encounterMedications: ["Augmentin"],
  });

  assert.strictEqual(result.isSafe, false, "Must block conflicting beta-lactam in penicillin-allergic patient");
  assert.strictEqual(result.safetyStatus, "critical_contraindication");
  const allergyAlert = result.alerts.find((a) => a.category === "allergy");
  assert.ok(allergyAlert, "Must generate an allergy category alert");
  assert.strictEqual(allergyAlert?.actionRequired, "block");
  assert.strictEqual(allergyAlert?.severity, "critical");
  assert.ok(allergyAlert?.evidenceSource?.source.includes("DailyMed") || allergyAlert?.evidenceSource?.source.includes("NLM"));
  assert.ok(allergyAlert?.evidenceSource?.limitations, "Must define explicit rule limitations");
});

// -----------------------------------------------------------------------------
// Test 2: Conversational Allergy Disclosure (Reported in Utterance) vs Proposed Agent
// -----------------------------------------------------------------------------
runTest("MED-02-ALLERGY-CONVERSATIONAL", "Dynamically disclosed allergy in utterance blocks conflicting drug", () => {
  // Empty profile, but patient discloses allergy in dialogue
  const profile: PatientProfile = {
    id: "pat-allergy-002",
    allergyStatus: "unassessed",
    drugAllergies: [],
  };

  const result = screenMedicationSafety({
    patientProfile: profile,
    patientUtterance: "I am severely allergic to penicillin. Can I take Amoxil or Mox for my throat?",
    candidateAdvice: "Mox 500mg is an option for bacterial pharyngitis.",
  });

  assert.strictEqual(result.isSafe, false, "Must reconcile conversationally disclosed allergy");
  assert.strictEqual(result.allergyStatus, "allergy_conflict");
  const alert = result.alerts.find((a) => a.category === "allergy");
  assert.ok(alert, "Must identify conversational penicillin allergy vs Amoxil/Mox");
  assert.strictEqual(alert?.severity, "critical");
});

// -----------------------------------------------------------------------------
// Test 3: Suspected Acute GI Bleeding vs NSAID / Aspirin (Brufen / Combiflam)
// -----------------------------------------------------------------------------
runTest("MED-03-GI-BLEED-NSAID", "Suspected upper GI bleeding blocks NSAIDs (Combiflam/Brufen/Aspirin)", () => {
  const result = screenMedicationSafety({
    patientUtterance: "I have been vomiting dark coffee-ground material and have black tarry stools. I took Combiflam for the stomach pain.",
    presentingSymptoms: ["vomiting coffee-ground material", "melena"],
    clinicalFacts: ["hematemesis", "upper_gi_bleeding"],
  });

  assert.strictEqual(result.isSafe, false, "Must block NSAIDs in active GI hemorrhage");
  assert.strictEqual(result.safetyStatus, "critical_contraindication");
  const giAlert = result.alerts.find((a) => a.category === "condition_contraindication" && a.conflictingItem.toLowerCase().includes("nsaid"));
  assert.ok(giAlert, "Must generate GI mucosal bleeding contraindication alert");
  assert.strictEqual(giAlert?.severity, "critical");
  assert.strictEqual(giAlert?.actionRequired, "block");
  assert.strictEqual(giAlert?.evidenceSource?.jurisdiction, "India (CDSCO/MoHFW)");
});

// -----------------------------------------------------------------------------
// Test 4: Suspected Dengue / Thrombocytopenia vs NSAIDs / Aspirin (MoHFW Invariant)
// -----------------------------------------------------------------------------
runTest("MED-04-DENGUE-NSAID", "Suspected dengue with thrombocytopenia blocks NSAIDs and Aspirin (MoHFW STG)", () => {
  const result = screenMedicationSafety({
    patientUtterance: "High fever for 4 days with tiny red spots on my skin and low platelets. Can I take Disprin or Brufen?",
    presentingSymptoms: ["high fever", "petechiae", "thrombocytopenia"],
    clinicalFacts: ["dengue_suspected", "thrombocytopenia"],
    candidateAdvice: "Take Disprin for the body ache.",
  });

  assert.strictEqual(result.isSafe, false, "Must prohibit Aspirin/NSAIDs in suspected dengue");
  const dengueAlert = result.alerts.find((a) => a.conflictingItem.toLowerCase().includes("dengue") || a.clinicalRationale.toLowerCase().includes("dengue"));
  assert.ok(dengueAlert, "Must flag Dengue bleeding contraindication");
  assert.strictEqual(dengueAlert?.actionRequired, "block");
  assert.ok(dengueAlert?.evidenceSource?.source.includes("NVBDCP") || dengueAlert?.evidenceSource?.source.includes("MoHFW"));
});

// -----------------------------------------------------------------------------
// Test 5: Polypharmacy Lethal Interaction: Organic Nitrates + PDE-5 Inhibitors
// -----------------------------------------------------------------------------
runTest("MED-05-POLYPHARMACY-NITRATE-PDE5", "Sorbitrate (nitrate) + Sildenafil/Viagra produces critical DDI block", () => {
  const profile: PatientProfile = {
    id: "pat-ddi-001",
    currentMedications: [
      { name: "Sorbitrate", dose: "10mg", frequency: "as needed for chest pain" },
    ],
  };

  const result = screenMedicationSafety({
    patientProfile: profile,
    patientUtterance: "I took a Viagra pill yesterday and my chest hurts so I am taking my Sorbitrate sublingual tablet.",
    encounterMedications: ["Viagra", "Sorbitrate"],
  });

  assert.strictEqual(result.isSafe, false);
  const ddiAlert = result.alerts.find((a) => a.category === "drug_interaction");
  assert.ok(ddiAlert, "Must flag Nitrate + PDE5 lethal DDI");
  assert.strictEqual(ddiAlert?.severity, "critical");
  assert.strictEqual(ddiAlert?.actionRequired, "block");
  assert.ok(ddiAlert?.clinicalRationale.toLowerCase().includes("hypotension") || ddiAlert?.clinicalRationale.toLowerCase().includes("collapse"));
});

// -----------------------------------------------------------------------------
// Test 6: Duplicate Therapy & Cumulative Hepatotoxicity (Dolo + Combiflam)
// -----------------------------------------------------------------------------
runTest("MED-06-DUPLICATE-PARACETAMOL", "Concurrent Dolo-650 + Combiflam triggers duplicate paracetamol warning", () => {
  const result = screenMedicationSafety({
    patientUtterance: "I am taking Dolo 650 every 4 hours and also took Combiflam twice today for my back pain.",
  });

  const duplicateAlert = result.alerts.find((a) => a.category === "duplicate_therapy" || a.category === "drug_interaction");
  assert.ok(duplicateAlert, "Must flag duplicate paracetamol warning");
  assert.strictEqual(duplicateAlert?.severity, "warning");
  assert.ok(duplicateAlert?.clinicalRationale.toLowerCase().includes("paracetamol") || duplicateAlert?.clinicalRationale.toLowerCase().includes("hepatotox"));
});

// -----------------------------------------------------------------------------
// Test 7: Preserving Uncertainty: Unidentified Substance Triggers review_needed
// -----------------------------------------------------------------------------
runTest("MED-07-UNCERTAIN-MEDICATION", "Unidentified substance ('blue pill', 'heart tablet') triggers review_needed, never safe", () => {
  const result = screenMedicationSafety({
    patientUtterance: "I took a small blue pill for my heart this morning, but I don't know the name of it.",
  });

  assert.strictEqual(result.isSafe, false, "Must not claim safe when an unidentified medicine was ingested");
  assert.strictEqual(result.safetyStatus, "review_needed");
  assert.strictEqual(result.requiresClinicianReview, true);
  const unknownAlert = result.alerts.find((a) => a.category === "unknown_substance");
  assert.ok(unknownAlert, "Must generate unknown_substance alert");
  assert.strictEqual(unknownAlert?.actionRequired, "flag_for_review");
  assert.strictEqual(unknownAlert?.severity, "review_needed");
});

// -----------------------------------------------------------------------------
// Test 8: Missing / Unverified Allergy Information Status
// -----------------------------------------------------------------------------
runTest("MED-08-MISSING-ALLERGY-INFO", "Unverified allergy status flags incomplete reconciliation without false all-clear", () => {
  const profile: PatientProfile = {
    id: "pat-no-allergy-record",
    allergyStatus: "unassessed",
    drugAllergies: [],
  };

  const result = screenMedicationSafety({
    patientProfile: profile,
    patientUtterance: "Can I take an antibiotic for my cough?",
  });

  assert.strictEqual(result.allergyStatus, "unverified");
  assert.ok(
    result.limitationsDisclaimer.toLowerCase().includes("allergy") ||
    result.blockedReason?.toLowerCase().includes("allergy") ||
    result.safetyStatus === "review_needed" ||
    result.requiresClinicianReview === true,
    "Must acknowledge unverified allergy status"
  );
});

// -----------------------------------------------------------------------------
// Test 9: Bounded Advisory: Directs Withholding & Reconciliation; Never Prescribes
// -----------------------------------------------------------------------------
runTest("MED-09-BOUNDED-ADVISORY", "Alert directives must never prescribe or order unilateral discontinuation of chronic therapy", () => {
  const profile: PatientProfile = {
    id: "pat-chronic-001",
    currentMedications: [{ name: "Telmisartan", dose: "40mg", frequency: "daily" }],
  };

  const result = screenMedicationSafety({
    patientProfile: profile,
    patientUtterance: "I am pregnant, around 10 weeks. I take Telmisartan 40mg every day for hypertension.",
    clinicalFacts: ["confirmed_pregnancy"],
  });

  assert.strictEqual(result.isSafe, false);
  const pregAlert = result.alerts.find((a) => a.category === "pregnancy");
  assert.ok(pregAlert, "Must flag ACEI/ARB teratogenicity in pregnancy");
  // Verification of bounded language: does not say "change dose to X" or "take medication Y instead"
  assert.ok(!pregAlert?.clinicalRationale.toLowerCase().includes("prescribe"));
  assert.ok(!pregAlert?.clinicalRationale.toLowerCase().includes("take labetalol 100mg"));
  assert.ok(pregAlert?.clinicalRationale.toLowerCase().includes("obstetric") || pregAlert?.clinicalRationale.toLowerCase().includes("physician") || pregAlert?.clinicalRationale.toLowerCase().includes("teratogen"));
});

// -----------------------------------------------------------------------------
// Test 10: Safe Negative Controls: Standard Paracetamol for Mild Headache
// -----------------------------------------------------------------------------
runTest("MED-10-NEGATIVE-CONTROL-SAFE", "Appropriate Paracetamol for mild headache with verified allergies passes screening", () => {
  const profile: PatientProfile = {
    id: "pat-safe-001",
    allergyStatus: "none_known",
    drugAllergies: [],
    knownConditions: [],
  };

  const result = screenMedicationSafety({
    patientProfile: profile,
    patientUtterance: "I have a mild tension headache. Can I take one Dolo 650?",
    presentingSymptoms: ["mild headache"],
    clinicalFacts: ["mild_tension_headache"],
  });

  assert.strictEqual(result.isSafe, true, "Must pass safe negative control");
  assert.strictEqual(result.safetyStatus, "passed_deterministic_screening");
  assert.strictEqual(result.alerts.filter((a) => a.severity === "critical").length, 0);
  assert.ok(result.identifiedMedications.some((m) => m.normalizedName === "paracetamol"));
});

// -----------------------------------------------------------------------------
// Test 11: Traceable Knowledge Metadata Verification
// -----------------------------------------------------------------------------
runTest("MED-11-TRACEABLE-METADATA", "All rules and alerts include structured source, date, jurisdiction, and limitations", () => {
  assert.ok(EVIDENCE_BACKED_MEDICATION_RULES.length >= 6, "Must define at least 6 evidence-backed rules");

  for (const rule of EVIDENCE_BACKED_MEDICATION_RULES) {
    assert.ok(rule.id, "Rule must have an ID");
    assert.ok(rule.evidenceSource.source, `Rule ${rule.id} must have a source`);
    assert.ok(rule.evidenceSource.retrievalDate, `Rule ${rule.id} must have a retrievalDate`);
    assert.ok(rule.evidenceSource.jurisdiction, `Rule ${rule.id} must have a jurisdiction`);
    assert.ok(rule.evidenceSource.limitations, `Rule ${rule.id} must define limitations`);
  }
});

// -----------------------------------------------------------------------------
// Test 12: Medication Extraction & Usage Reconciliation
// -----------------------------------------------------------------------------
runTest("MED-12-RECONCILIATION-USAGE", "Distinguishes currently taking vs prescribed vs inquired vs stopped", () => {
  const sample1 = extractMedicationMentions("I am currently taking Combiflam twice a day");
  assert.strictEqual(sample1[0].usageStatus, "currently_taking");
  assert.strictEqual(sample1[0].normalizedName, "ibuprofen + paracetamol");

  const sample2 = extractMedicationMentions("The doctor prescribed Augmentin 625mg yesterday");
  assert.strictEqual(sample2[0].usageStatus, "prescribed");
  assert.strictEqual(sample2[0].normalizedName, "amoxicillin + clavulanate");

  const sample3 = extractMedicationMentions("Can I take Disprin for the chest tightness?");
  assert.strictEqual(sample3[0].usageStatus, "inquired");
  assert.strictEqual(sample3[0].normalizedName, "aspirin");

  const sample4 = extractMedicationMentions("I used to take Brufen but I stopped taking it last month");
  assert.strictEqual(sample4[0].usageStatus, "stopped");
});

console.log("\n================================================================================");
console.log(`  MEDICATION SAFETY ENGINE BATTERY: ${passedCount} PASSED, ${failedCount} FAILED`);
console.log("================================================================================\n");

if (failedCount > 0) {
  process.exit(1);
} else {
  console.log("ALL MEDICATION SAFETY TESTS PASSED SUCCESSFULLY! ✅");
  process.exit(0);
}
