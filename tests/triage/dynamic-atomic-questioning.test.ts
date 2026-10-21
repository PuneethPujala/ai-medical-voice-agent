import assert from "assert";
import { responsePlanner, ResponsePlanner } from "../../lib/triage/response-planner";
import {
  detectQuestionTargetSlots,
  validateDoctorReplyTarget,
  ClinicalInterviewStateV2,
} from "../../lib/triage/clinical-state";
import { PreArbiterResult } from "../../lib/triage/pre-arbiter";
import { SemanticInterpretation } from "../../lib/triage/conversation-interpreter";
import { DEFAULT_LOCALE_CONFIG } from "../../lib/config/locale";

console.log("================================================================================");
console.log("      TEST SUITE: DYNAMIC ATOMIC FOLLOW-UP QUESTIONING & INVARIANTS             ");
console.log("================================================================================\n");

function createMockState(overrides: Partial<any> = {}): any {
  return {
    phase: "active_inquiring",
    informationState: "insufficient",
    caseVersion: 1,
    slots: {
      associated_symptoms: [],
      neurological_signs: [],
      pediatric_signs: [],
      known_facts: [],
      ...(overrides.slots || {}),
    },
    conversationMemory: {
      confirmedFacts: [],
      deniedSymptoms: [],
      questionsAlreadyAsked: [],
      patientCorrections: [],
      patientObjections: [],
      patientConcerns: [],
      accessConstraints: [],
      uncertainties: [],
      ...(overrides.conversationMemory || {}),
    },
    cumulativeTranscript: overrides.cumulativeTranscript || "",
    ...overrides,
  };
}

const emptySemantic: SemanticInterpretation = {
  rawUtterance: "",
  intent: "symptom_report",
  isConfirmationOrRepetition: false,
  isEmergencyInquiry: false,
  newEvidence: [],
  ambiguities: [],
  confidence: 0.9,
};

const neutralPreArbiter: PreArbiterResult = {
  immediate_danger: false,
  pre_safety_flags: [],
  suggested_specialists: [],
  latency_us: 100,
};

interface TestResult {
  id: string;
  name: string;
  passed: boolean;
  message?: string;
}

const results: TestResult[] = [];

// -----------------------------------------------------------------------------
// Scenario 1: Possible weakness, not yet confirmed -> Focused atomic question
// -----------------------------------------------------------------------------
{
  const state = createMockState({
    slots: {
      neurological_signs: ["weakness (uncertain)"],
      known_facts: ["weakness: uncertain"],
    },
    conversationMemory: {
      uncertainties: ["weakness"],
      questionsAlreadyAsked: [],
      deniedSymptoms: [],
    },
    cumulativeTranscript: "I might have some weakness, but I'm not sure.",
  });

  const plan = responsePlanner.plan(
    "I might have some weakness, but I'm not sure.",
    emptySemantic,
    state,
    neutralPreArbiter,
    [],
    DEFAULT_LOCALE_CONFIG
  );

  const targets = detectQuestionTargetSlots(plan.suggestedSpokenReply);
  const isWeaknessTarget = plan.nextHighValueInquiry?.topic === "weakness" ||
                           plan.nextHighValueInquiry?.topic === "neurological_weakness" ||
                           targets.includes("weakness");
  const isAtomic = targets.length === 1;

  if (!isWeaknessTarget) {
    results.push({
      id: "SCENARIO-1-FOCUSED-WEAKNESS",
      name: "Possible weakness must trigger focused question resolving weakness",
      passed: false,
      message: `Expected next inquiry on weakness, got topic='${plan.nextHighValueInquiry?.topic}', targets=[${targets.join(", ")}]`,
    });
  } else if (!isAtomic) {
    results.push({
      id: "SCENARIO-1-FOCUSED-WEAKNESS",
      name: "Possible weakness question must be atomic (not compound)",
      passed: false,
      message: `Question asked multiple targets: [${targets.join(", ")}]: '${plan.suggestedSpokenReply}'`,
    });
  } else {
    results.push({
      id: "SCENARIO-1-FOCUSED-WEAKNESS",
      name: "Possible weakness triggers focused atomic question",
      passed: true,
    });
  }
}

// -----------------------------------------------------------------------------
// Scenario 2: Weakness already denied -> Never repeat weakness question
// -----------------------------------------------------------------------------
{
  const state = createMockState({
    slots: {
      neurological_signs: [],
      known_facts: ["weakness: absent"],
    },
    conversationMemory: {
      deniedSymptoms: ["weakness", "unilateral weakness"],
      questionsAlreadyAsked: ["weakness", "neurological_weakness"],
    },
    cumulativeTranscript: "No weakness at all. I have a headache.",
  });

  const plan = responsePlanner.plan(
    "No weakness at all. I have a headache.",
    emptySemantic,
    state,
    neutralPreArbiter,
    [],
    DEFAULT_LOCALE_CONFIG
  );

  const question = plan.suggestedSpokenReply.toLowerCase();
  const asksWeaknessAgain = /\bweakness\b/i.test(question) ||
                            plan.nextHighValueInquiry?.topic === "weakness" ||
                            plan.nextHighValueInquiry?.topic === "neurological_weakness";

  if (asksWeaknessAgain) {
    results.push({
      id: "SCENARIO-2-NO-REPEATED-DENIED",
      name: "Weakness already denied must not be repeated",
      passed: false,
      message: `Repeated denied weakness question: '${plan.suggestedSpokenReply}'`,
    });
  } else {
    results.push({
      id: "SCENARIO-2-NO-REPEATED-DENIED",
      name: "Weakness already denied is not repeated",
      passed: true,
    });
  }
}

// -----------------------------------------------------------------------------
// Scenario 3: Weakness and onset both unknown -> Select high-impact red flag first
// -----------------------------------------------------------------------------
{
  const state = createMockState({
    slots: {
      known_facts: ["headache: present"],
    },
    conversationMemory: {
      confirmedFacts: ["headache: present"],
      deniedSymptoms: [],
      questionsAlreadyAsked: [],
    },
    cumulativeTranscript: "I have a headache.",
  });

  const plan = responsePlanner.plan(
    "I have a headache.",
    emptySemantic,
    state,
    neutralPreArbiter,
    [],
    DEFAULT_LOCALE_CONFIG
  );

  // In a headache presentation where both onset character (thunderclap risk) and neurological
  // red flags are unassessed, high-impact triage screen (onset_pattern or weakness) must be asked,
  // NOT routine low-impact outpatient questions like "Do you have insurance" or "rating 0-10".
  const highImpactTopics = ["onset_pattern", "headache_onset_character", "weakness", "neurological_signs", "red_flag_screen"];
  const selectedTopic = plan.nextHighValueInquiry?.topic || "";
  const isHighImpact = highImpactTopics.includes(selectedTopic);

  if (!isHighImpact) {
    results.push({
      id: "SCENARIO-3-TRIAGE-PRIORITY",
      name: "High-impact red flag / triage-altering inquiry must precede routine details",
      passed: false,
      message: `Selected low-impact topic '${selectedTopic}' instead of high-impact triage question`,
    });
  } else {
    results.push({
      id: "SCENARIO-3-TRIAGE-PRIORITY",
      name: "High-impact red flag / triage-altering inquiry is prioritized",
      passed: true,
    });
  }
}

// -----------------------------------------------------------------------------
// Scenario 4: Patient corrects earlier answer -> Reconsiders next question
// -----------------------------------------------------------------------------
{
  const state = createMockState({
    slots: {
      onset: "2 hours ago",
      known_facts: ["onset: 2 hours ago (corrected)"],
    },
    conversationMemory: {
      confirmedFacts: ["onset: 2 hours ago"],
      questionsAlreadyAsked: ["onset_time", "onset"],
      patientCorrections: [{ target: "onset", value: "2 hours ago" }],
    },
    cumulativeTranscript: "Actually it started 2 hours ago, not yesterday.",
  });

  const correctionSemantic: SemanticInterpretation = {
    ...emptySemantic,
    intent: "confirmation_or_correction",
    isCorrection: true,
    correctedSlot: "onset",
    correctedValue: "2 hours ago",
  };

  const plan = responsePlanner.plan(
    "Actually it started 2 hours ago, not yesterday.",
    correctionSemantic,
    state,
    neutralPreArbiter,
    [],
    DEFAULT_LOCALE_CONFIG
  );

  // Must acknowledge correction and advance to next unasked dimension (e.g. course or character),
  // NOT re-ask when it started!
  const reAsksOnset = plan.nextHighValueInquiry?.topic === "onset" ||
                      plan.nextHighValueInquiry?.topic === "onset_time" ||
                      /\bwhen\s+did\s+(?:this|it)\s+start\b/i.test(plan.suggestedSpokenReply);

  if (reAsksOnset) {
    results.push({
      id: "SCENARIO-4-CORRECTION-ADAPTATION",
      name: "Patient correction must update state and not re-ask corrected slot",
      passed: false,
      message: `Re-asked corrected onset slot: '${plan.suggestedSpokenReply}'`,
    });
  } else {
    results.push({
      id: "SCENARIO-4-CORRECTION-ADAPTATION",
      name: "Patient correction acknowledged and next question adapts smoothly",
      passed: true,
    });
  }
}

// -----------------------------------------------------------------------------
// Scenario 5: Red flag establishes emergency -> Escalate immediately without routine inquiry
// -----------------------------------------------------------------------------
{
  const emergencyPreArbiter: PreArbiterResult = {
    immediate_danger: true,
    pre_safety_flags: ["chest_pain_with_red_flags"],
    suggested_specialists: [],
    latency_us: 100,
  };

  const state = createMockState({
    slots: {
      known_facts: ["crushing chest pain", "cold sweats"],
    },
    cumulativeTranscript: "I have crushing chest pain and cold sweats.",
  });

  const plan = responsePlanner.plan(
    "I have crushing chest pain and cold sweats.",
    emptySemantic,
    state,
    emergencyPreArbiter,
    [],
    DEFAULT_LOCALE_CONFIG
  );

  const isEmergencyGoal = plan.primaryGoal === "EMERGENCY_INTERVENTION";
  const asksRoutineQuestions = plan.suggestedSpokenReply.includes("0 to 10") ||
                               plan.suggestedSpokenReply.includes("scale") ||
                               plan.suggestedSpokenReply.includes("when did this begin");

  if (!isEmergencyGoal || asksRoutineQuestions) {
    results.push({
      id: "SCENARIO-5-IMMEDIATE-ESCALATION",
      name: "Emergency red flag must trigger immediate directive without delay for routine questions",
      passed: false,
      message: `Did not escalate immediately. primaryGoal='${plan.primaryGoal}', reply='${plan.suggestedSpokenReply}'`,
    });
  } else {
    results.push({
      id: "SCENARIO-5-IMMEDIATE-ESCALATION",
      name: "Emergency red flag triggers immediate disposition directive",
      passed: true,
    });
  }
}

// -----------------------------------------------------------------------------
// Scenario 6: Generated question contains multiple clinical concepts -> Rejected by validator
// -----------------------------------------------------------------------------
{
  // Test 6a: Multi-concept neurological question ("weakness, numbness, or trouble speaking")
  const multiNeuro = "Do you have weakness, numbness, or trouble speaking?";
  const neuroTargets = detectQuestionTargetSlots(multiNeuro);
  const neuroValidation = validateDoctorReplyTarget(multiNeuro, {
    primaryGoal: "ADVANCE_CLINICAL_INTAKE",
    nextHighValueInquiry: { topic: "weakness", clinicalRationale: "Check weakness", suggestedPhrasing: "Do you have weakness?" },
  });

  // Test 6b: Multi-concept severity + character question
  const sevChar = "How severe is the pain on a scale from 0 to 10, and what does it feel like?";
  const sevCharTargets = detectQuestionTargetSlots(sevChar);
  const sevCharValidation = validateDoctorReplyTarget(sevChar, {
    primaryGoal: "ADVANCE_CLINICAL_INTAKE",
    nextHighValueInquiry: { topic: "severity", clinicalRationale: "Rate severity", suggestedPhrasing: "How severe is the pain?" },
  });

  // Test 6c: Multi-concept onset timeline + onset pattern question
  const onsetBoth = "Could you tell me when this began, and whether it started suddenly or built up gradually?";
  const onsetBothTargets = detectQuestionTargetSlots(onsetBoth);
  const onsetBothValidation = validateDoctorReplyTarget(onsetBoth, {
    primaryGoal: "ADVANCE_CLINICAL_INTAKE",
    nextHighValueInquiry: { topic: "onset_pattern", clinicalRationale: "Check pattern", suggestedPhrasing: "Did it start suddenly?" },
  });

  // Test 6d: Truly atomic question (Positive control)
  const atomicWeak = "Are you experiencing any weakness in your arms or legs?";
  const atomicTargets = detectQuestionTargetSlots(atomicWeak);
  const atomicValidation = validateDoctorReplyTarget(atomicWeak, {
    primaryGoal: "ADVANCE_CLINICAL_INTAKE",
    nextHighValueInquiry: { topic: "weakness", clinicalRationale: "Check weakness", suggestedPhrasing: "Are you experiencing weakness?" },
  });

  const compoundNeuroRejected = !neuroValidation.isValid;
  const compoundSevCharRejected = !sevCharValidation.isValid;
  const compoundOnsetRejected = !onsetBothValidation.isValid;
  const atomicAccepted = atomicValidation.isValid;

  if (!compoundNeuroRejected) {
    results.push({
      id: "SCENARIO-6-COMPOUND-QUESTION-REJECTION",
      name: "Compound question ('weakness, numbness, or trouble speaking') must be rejected as multi-target",
      passed: false,
      message: `Failed to reject compound neuro question: targets=[${neuroTargets.join(", ")}], validation=${JSON.stringify(neuroValidation)}`,
    });
  } else if (!compoundSevCharRejected) {
    results.push({
      id: "SCENARIO-6-COMPOUND-QUESTION-REJECTION",
      name: "Compound question ('severity + character') must be rejected as multi-target",
      passed: false,
      message: `Failed to reject compound severity+character: targets=[${sevCharTargets.join(", ")}], validation=${JSON.stringify(sevCharValidation)}`,
    });
  } else if (!compoundOnsetRejected) {
    results.push({
      id: "SCENARIO-6-COMPOUND-QUESTION-REJECTION",
      name: "Compound question ('when began + suddenly or gradually') must be rejected as multi-target",
      passed: false,
      message: `Failed to reject compound onset question: targets=[${onsetBothTargets.join(", ")}], validation=${JSON.stringify(onsetBothValidation)}`,
    });
  } else if (!atomicAccepted) {
    results.push({
      id: "SCENARIO-6-COMPOUND-QUESTION-REJECTION",
      name: "Genuinely atomic question ('weakness in arms or legs') must be accepted",
      passed: false,
      message: `Falsely rejected atomic question: ${JSON.stringify(atomicValidation)}`,
    });
  } else {
    results.push({
      id: "SCENARIO-6-COMPOUND-QUESTION-REJECTION",
      name: "Compound questions rejected and atomic questions accepted strictly",
      passed: true,
    });
  }
}

// -----------------------------------------------------------------------------
// Scoreboard & Report
// -----------------------------------------------------------------------------
let passedCount = 0;
let failedCount = 0;

for (const r of results) {
  if (r.passed) {
    passedCount++;
    console.log(`  ✓ [PASS] ${r.id}: ${r.name}`);
  } else {
    failedCount++;
    console.error(`  ✗ [FAIL] ${r.id}: ${r.name}`);
    if (r.message) console.error(`       -> ${r.message}`);
  }
}

console.log("\n================================================================================");
console.log(` RESULTS: ${passedCount} passed, ${failedCount} failed of ${results.length} total scenarios`);
console.log("================================================================================\n");

if (failedCount > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
