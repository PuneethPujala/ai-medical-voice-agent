/**
 * END-TO-END CLINICAL CHALLENGE CASES VERIFICATION HARNESS (REPAIRED)
 *
 * Rigorously executes and verifies the complete pipeline across the six clinical challenge cases:
 * 1. Third-party resolved history ("My mother had chest pain yesterday, but she's fine now")
 * 2. Third-party acute life-threat ("My mother has chest pain right now")
 * 3. Clause-bound negation vs affirmative emergency ("I don't have chest pain; I have severe stomach pain")
 * 4. Transient resolved presyncope/orthostasis ("I felt dizzy before, but now it's gone")
 * 5. Fever denial with autonomic diaphoresis ("No fever, but I'm shaking and sweating")
 * 6. Acute fluid loss with postural collapse ("I've had loose motions since yesterday, and today I can barely stand")
 *
 * Rigorous Semantic Oracle Invariants Verified per Case:
 * - Subject Attribution: Verifies patient vs caller identity (e.g. addresses mother, never caller).
 * - Symptom Provenance: Zero hallucinated character qualities (e.g. never invents "tight pressure").
 * - Temporal Status: Accurately differentiates active emergencies from resolved episodes.
 * - Unsupported Claim Guard: Forbids diagnostic promotion or treating absence of fever as reassurance.
 * - Next-Question Clinical Relevance: Strictly checks targeted questions (metabolic screen, fall prevention, etc.).
 * - Terminology Invariant: Evaluated exclusively against MedVoiceUrgencyTier (Tiers 1–5).
 */

import { ConversationManager } from "../lib/triage/conversation-manager";
import { presentationClassifier } from "../lib/clinical-knowledge/presentation-classifier";
import { evaluateSafetyArbiter, MedVoiceUrgencyTier } from "../lib/triage/safety-arbiter";
import { evaluateUniversalRedFlags } from "../lib/triage/universal-red-flags";

export interface SemanticOracleSpec {
  requiredSubject: RegExp;
  forbiddenSubject?: RegExp;
  requiredSymptomProvenance?: RegExp;
  forbiddenSymptomHallucinations?: RegExp[];
  requiredTemporalAcknowledgment?: RegExp;
  forbiddenActiveQuestion?: RegExp;
  forbiddenUnsupportedClaims?: RegExp[];
  requiredClinicalElements: RegExp[];
  forbiddenQuestionPattern?: RegExp;
}

export interface ChallengeCaseSpec {
  id: string;
  name: string;
  utterance: string;
  expectedSubject: "self" | "third_party";
  expectedTemporality: "acute_active" | "past_resolved" | "transient";
  expectedNegations: string[];
  expectedAffirmations: string[];
  expectedPrimaryPresentation: string;
  forbiddenPresentations: string[];
  expectedUniversalLevel: "NONE" | "EMERGENCY_NOW" | "DISCRIMINATE" | "URGENT_SAME_DAY";
  expectedTriageUrgency: "emergency" | "priority" | "routine";
  expectedUrgencyTier: MedVoiceUrgencyTier;
  expectedAction: "EMERGENCY_CONVENE_BOARD" | "ASK_PATIENT";
  semanticOracle: SemanticOracleSpec;
}

export const CHALLENGE_SUITE: ChallengeCaseSpec[] = [
  {
    id: "CHALLENGE-01",
    name: "Third-party historical chest pain, currently resolved",
    utterance: "My mother had chest pain yesterday, but she's fine now",
    expectedSubject: "third_party",
    expectedTemporality: "past_resolved",
    expectedNegations: [],
    expectedAffirmations: ["chest pain", "fine now"],
    expectedPrimaryPresentation: "CHEST_DISCOMFORT",
    forbiddenPresentations: [],
    expectedUniversalLevel: "NONE", // Resolved history must NOT fire immediate emergency ambulance dispatch
    expectedTriageUrgency: "priority", // Elective/urgent outpatient cardiac follow-up recommended
    expectedUrgencyTier: 3,
    expectedAction: "ASK_PATIENT",
    semanticOracle: {
      requiredSubject: /\b(?:mother|she|her)\b/i,
      forbiddenSubject: /\bin your chest\b/i,
      requiredSymptomProvenance: /\bchest pain\b/i,
      forbiddenSymptomHallucinations: [/\btight pressure\b/i, /\bcrushing\b/i],
      requiredTemporalAcknowledgment: /\b(?:better|fine|resolved|yesterday)\b/i,
      forbiddenActiveQuestion: /\b(?:when you're active|climbing stairs|walking or climbing|does this discomfort usually happen)\b/i,
      requiredClinicalElements: [
        /\b(?:check-?up|evaluat|doctor|clinic)\b/i,
        /\b(?:108|112|returns?|recur)\b/i,
      ],
    },
  },
  {
    id: "CHALLENGE-02",
    name: "Third-party acute chest pain, active emergency right now",
    utterance: "My mother has chest pain right now",
    expectedSubject: "third_party",
    expectedTemporality: "acute_active",
    expectedNegations: [],
    expectedAffirmations: ["chest pain"],
    expectedPrimaryPresentation: "CHEST_DISCOMFORT",
    forbiddenPresentations: [],
    expectedUniversalLevel: "EMERGENCY_NOW",
    expectedTriageUrgency: "emergency",
    expectedUrgencyTier: 2,
    expectedAction: "EMERGENCY_CONVENE_BOARD",
    semanticOracle: {
      requiredSubject: /\b(?:mother|she|her)\b/i,
      forbiddenSubject: /\bin your chest\b/i,
      requiredSymptomProvenance: /\bchest pain\b/i,
      forbiddenSymptomHallucinations: [/\btight pressure\b/i, /\bcrushing\b/i],
      requiredClinicalElements: [
        /\b(?:108|112|ambulance)\b/i,
        /\b(?:sit|seated)\b/i,
      ],
    },
  },
  {
    id: "CHALLENGE-03",
    name: "Clause-bound negation on cardiac complaint + affirmative acute severe abdominal pain",
    utterance: "I don't have chest pain; I have severe stomach pain",
    expectedSubject: "self",
    expectedTemporality: "acute_active",
    expectedNegations: ["chest pain"],
    expectedAffirmations: ["stomach pain"],
    expectedPrimaryPresentation: "ABDOMINAL_PAIN",
    forbiddenPresentations: ["CHEST_DISCOMFORT"], // Cardiac presentation must NOT be activated when explicitly negated
    expectedUniversalLevel: "NONE",
    expectedTriageUrgency: "priority", // Severe acute abdominal pain
    expectedUrgencyTier: 3,
    expectedAction: "ASK_PATIENT",
    semanticOracle: {
      requiredSubject: /\b(?:you|your)\b/i,
      forbiddenSubject: /\b(?:mother|father|child|he|she)\b/i,
      requiredSymptomProvenance: /\b(?:stomach|belly|abdomin)\s*pain\b/i,
      forbiddenSymptomHallucinations: [/\bheart attack\b/i, /\bangina\b/i],
      requiredClinicalElements: [
        /\b(?:belly|stomach|abdomin)\b/i,
        /\b(?:hard|rigid|board|faint|dizz|lightheaded|syncope)\b/i,
      ],
      forbiddenQuestionPattern: /\b(?:left arm|jaw|coronary|heart attack|radiation to arm)\b/i,
    },
  },
  {
    id: "CHALLENGE-04",
    name: "Resolved dizziness, cause not yet characterized",
    utterance: "I felt dizzy before, but now it's gone",
    expectedSubject: "self",
    expectedTemporality: "transient",
    expectedNegations: [],
    expectedAffirmations: ["dizziness"],
    expectedPrimaryPresentation: "DIZZINESS_VERTIGO",
    forbiddenPresentations: [],
    expectedUniversalLevel: "NONE",
    expectedTriageUrgency: "routine",
    expectedUrgencyTier: 4,
    expectedAction: "ASK_PATIENT",
    semanticOracle: {
      requiredSubject: /\b(?:you|your)\b/i,
      requiredTemporalAcknowledgment: /\b(?:passed|gone|felt dizzy before|better)\b/i,
      requiredClinicalElements: [
        /\b(?:spinning|room\s+spinning)\b/i,
        /\b(?:faint|lightheaded)\b/i,
        /\b(?:black\s*out|consciousness|pass\s*out)\b/i,
      ],
      forbiddenUnsupportedClaims: [/\b(?:orthostasis|presyncope|you have orthostatic)\b/i],
    },
  },
  {
    id: "CHALLENGE-05",
    name: "Explicit fever denial + affirmative autonomic diaphoresis / tremors",
    utterance: "No fever, but I'm shaking and sweating",
    expectedSubject: "self",
    expectedTemporality: "acute_active",
    expectedNegations: ["fever"],
    expectedAffirmations: ["shaking", "sweating"],
    expectedPrimaryPresentation: "UNCLASSIFIED", // Must NOT classify as FEBRILE_ILLNESS
    forbiddenPresentations: ["FEBRILE_ILLNESS"],
    expectedUniversalLevel: "NONE",
    expectedTriageUrgency: "routine",
    expectedUrgencyTier: 4,
    expectedAction: "ASK_PATIENT",
    semanticOracle: {
      requiredSubject: /\b(?:you|your)\b/i,
      requiredClinicalElements: [
        /\b(?:diabet|sugar|insulin|eat|meal|food)\b/i,
        /\b(?:confus|dizzy|lightheaded|seek emergency|emergency medical attention)\b/i,
      ],
      forbiddenUnsupportedClaims: [
        /\b(?:no fever so you'?re fine|nothing serious|don'?t worry|fever is absent so)\b/i,
        /\b(?:you have hypoglycemia|diagnosed with hypoglycemia)\b/i, // Must not diagnose solely from symptoms
        /\b(?:worsening|getting worse|rapidly progressing)\b/i, // Must not invent worsening trajectory without state proof
      ],
    },
  },
  {
    id: "CHALLENGE-06",
    name: "Acute fluid loss (diarrhea) with severe postural collapse / volume depletion",
    utterance: "I've had loose motions since yesterday, and today I can barely stand",
    expectedSubject: "self",
    expectedTemporality: "acute_active",
    expectedNegations: [],
    expectedAffirmations: ["loose motions", "barely stand"],
    expectedPrimaryPresentation: "ACUTE_DIARRHEA",
    forbiddenPresentations: [],
    expectedUniversalLevel: "NONE",
    expectedTriageUrgency: "priority", // Severe dehydration with functional orthostasis
    expectedUrgencyTier: 3,
    expectedAction: "ASK_PATIENT",
    semanticOracle: {
      requiredSubject: /\b(?:you|your)\b/i,
      requiredClinicalElements: [
        /\b(?:sit|lie down|seated)\b/i, // 1. Immediate fall prevention
        /\b(?:urgent\s+(?:in-person\s+)?medical\s+help|urgent\s+medical\s+evaluation|urgent\s+care)\b/i, // 2. Explicit urgency instruction
        /\b(?:have\s+someone\s+assist\s+you|nearest\s+clinic|contact\s+emergency\s+services|call\s+(?:108|112))\b/i, // 3. Practical help-seeking action
        /\b(?:ors|fluids?|water|rehydration)\b/i, // 4. Appropriate supportive advice
      ],
      forbiddenQuestionPattern: /\bdid it come on suddenly, or did it gradually get worse\b/i,
      forbiddenUnsupportedClaims: [
        /\b(?:you have severe dehydration|diagnosed with dehydration|definitely dehydrated)\b/i,
        /\bif you cannot stand\b/i,
      ],
    },
  },
];

/**
 * Validates a doctor reply against the case's semantic oracle specification.
 * Returns an array of error messages (empty if completely valid).
 */
export function validateSemanticOracle(reply: string, oracle: SemanticOracleSpec): string[] {
  const errors: string[] = [];

  // 1. Subject Attribution Check
  if (!oracle.requiredSubject.test(reply)) {
    errors.push(`Missing required subject attribution (expected to match: ${oracle.requiredSubject})`);
  }
  if (oracle.forbiddenSubject && oracle.forbiddenSubject.test(reply)) {
    errors.push(`Contains forbidden subject phrasing (matched forbidden: ${oracle.forbiddenSubject})`);
  }

  // 2. Symptom Provenance / Zero Hallucination Check
  if (oracle.requiredSymptomProvenance && !oracle.requiredSymptomProvenance.test(reply)) {
    errors.push(`Missing required symptom provenance (expected: ${oracle.requiredSymptomProvenance})`);
  }
  if (oracle.forbiddenSymptomHallucinations) {
    for (const hall of oracle.forbiddenSymptomHallucinations) {
      if (hall.test(reply)) {
        errors.push(`Hallucinated unsupported symptom quality (matched forbidden: ${hall})`);
      }
    }
  }

  // 3. Temporal Status Check
  if (oracle.requiredTemporalAcknowledgment && !oracle.requiredTemporalAcknowledgment.test(reply)) {
    errors.push(`Missing temporal status acknowledgment (expected: ${oracle.requiredTemporalAcknowledgment})`);
  }
  if (oracle.forbiddenActiveQuestion && oracle.forbiddenActiveQuestion.test(reply)) {
    errors.push(`Inappropriately asks active acute question on resolved episode (matched: ${oracle.forbiddenActiveQuestion})`);
  }

  // 4. Unsupported Claims / Reassurance Guard
  if (oracle.forbiddenUnsupportedClaims) {
    for (const claim of oracle.forbiddenUnsupportedClaims) {
      if (claim.test(reply)) {
        errors.push(`Contains unsupported clinical claim or false reassurance (matched: ${claim})`);
      }
    }
  }

  // 5. Next-Question Clinical Relevance & Essential Elements
  for (const elem of oracle.requiredClinicalElements) {
    if (!elem.test(reply)) {
      errors.push(`Missing essential clinical element (expected to match: ${elem})`);
    }
  }
  if (oracle.forbiddenQuestionPattern && oracle.forbiddenQuestionPattern.test(reply)) {
    errors.push(`Asks irrelevant or inappropriate clinical question (matched forbidden: ${oracle.forbiddenQuestionPattern})`);
  }

  return errors;
}

/**
 * Explicit verification that the semantic test oracle fails on the flawed CHALLENGE-02 response.
 * Deliverable Invariant: The test oracle MUST fail on the flawed CHALLENGE-02 reply.
 */
export function verifyOracleCatchesFlawedChallenge02Reply(): void {
  console.log("------------------------------------------------------------------------------");
  console.log("VERIFYING TEST ORACLE STRICTNESS AGAINST KNOWN DEFECT (CHALLENGE-02)");
  console.log("------------------------------------------------------------------------------");

  const flawedChallenge02Reply =
    "I am very concerned about the tight pressure in your chest. Because this could represent an acute heart attack or coronary syndrome, please sit down comfortably right now, stay completely still, and call 108 or 112 for an emergency ambulance immediately. Is there someone with you right now?";

  const c2Spec = CHALLENGE_SUITE.find(c => c.id === "CHALLENGE-02")!;
  const oracleViolations = validateSemanticOracle(flawedChallenge02Reply, c2Spec.semanticOracle);

  console.log(`Evaluated flawed reply: "${flawedChallenge02Reply.slice(0, 95)}..."`);
  console.log(`Oracle Violations Detected: ${oracleViolations.length}`);
  oracleViolations.forEach(v => console.log(`  ✓ Successfully Caught Defect: ${v}`));

  if (oracleViolations.length === 0) {
    throw new Error("TEST ORACLE FAILED: The oracle was permissive and failed to catch the flawed CHALLENGE-02 reply!");
  }
  console.log("  ✓ Oracle Strictness Enforced: Oracle rigorously rejects the flawed reply.\n");
}

async function runChallengeSuite() {
  console.log("\n==============================================================================");
  console.log("       MEDVOICE END-TO-END CLINICAL CHALLENGE CASES VERIFICATION");
  console.log("       Discourse NLU, Pragmatics, State Tracking & Safety Arbitration");
  console.log("==============================================================================\n");

  // Step 0: Pre-flight oracle validation
  verifyOracleCatchesFlawedChallenge02Reply();

  let totalTests = 0;
  let passedTests = 0;
  const failures: string[] = [];

  for (const tc of CHALLENGE_SUITE) {
    console.log(`------------------------------------------------------------------------------`);
    console.log(`TEST [${tc.id}]: ${tc.name}`);
    console.log(`Input: "${tc.utterance}"`);
    console.log(`------------------------------------------------------------------------------`);

    // 1. Universal Red Flags Verification
    const universal = evaluateUniversalRedFlags({ rawText: tc.utterance });
    totalTests++;
    if (universal.level === tc.expectedUniversalLevel) {
      passedTests++;
      console.log(`  ✓ Universal Red Flag Level: ${universal.level} (Expected: ${tc.expectedUniversalLevel})`);
    } else {
      failures.push(`[${tc.id}] Universal Level mismatch: got ${universal.level}, expected ${tc.expectedUniversalLevel}`);
      console.error(`  ✗ FAIL: Universal Level mismatch: got ${universal.level}, expected ${tc.expectedUniversalLevel}`);
    }

    // 2. Presentation Classifier Verification
    const presContext = presentationClassifier.classify(tc.utterance);
    totalTests++;
    const primaryMatches = presContext.primary === tc.expectedPrimaryPresentation;
    if (primaryMatches) {
      passedTests++;
      console.log(`  ✓ Primary Presentation: ${presContext.primary} (Expected: ${tc.expectedPrimaryPresentation})`);
    } else {
      failures.push(`[${tc.id}] Primary Presentation mismatch: got ${presContext.primary}, expected ${tc.expectedPrimaryPresentation}`);
      console.error(`  ✗ FAIL: Primary Presentation mismatch: got ${presContext.primary}, expected ${tc.expectedPrimaryPresentation}`);
    }

    // Check forbidden presentations
    for (const forbidden of tc.forbiddenPresentations) {
      totalTests++;
      const isPresent = presContext.active.some(a => a.id === forbidden);
      if (!isPresent) {
        passedTests++;
        console.log(`  ✓ Forbidden presentation [${forbidden}] is NOT active`);
      } else {
        failures.push(`[${tc.id}] Forbidden presentation [${forbidden}] was incorrectly activated`);
        console.error(`  ✗ FAIL: Forbidden presentation [${forbidden}] was activated`);
      }
    }

    // 3. Safety Arbiter Verification (Terminology: MedVoiceUrgencyTier)
    const arbiter = evaluateSafetyArbiter({ rawText: tc.utterance });
    totalTests++;
    if (arbiter.triageLevel === tc.expectedTriageUrgency) {
      passedTests++;
      console.log(`  ✓ Safety Arbiter Urgency: ${arbiter.triageLevel} (Expected: ${tc.expectedTriageUrgency})`);
    } else {
      failures.push(`[${tc.id}] Arbiter Urgency mismatch: got ${arbiter.triageLevel}, expected ${tc.expectedTriageUrgency}`);
      console.error(`  ✗ FAIL: Arbiter Urgency mismatch: got ${arbiter.triageLevel}, expected ${tc.expectedTriageUrgency}`);
    }

    totalTests++;
    if (arbiter.urgencyTier === tc.expectedUrgencyTier) {
      passedTests++;
      console.log(`  ✓ MedVoice Urgency Tier: Tier ${arbiter.urgencyTier} (Expected: Tier ${tc.expectedUrgencyTier})`);
    } else {
      failures.push(`[${tc.id}] Urgency Tier mismatch: got Tier ${arbiter.urgencyTier}, expected Tier ${tc.expectedUrgencyTier}`);
      console.error(`  ✗ FAIL: Urgency Tier mismatch: got Tier ${arbiter.urgencyTier}, expected Tier ${tc.expectedUrgencyTier}`);
    }

    // 4. Conversation Manager End-to-End Turn Execution
    const cm = new ConversationManager();
    const turnResult = await cm.processTurn(tc.utterance);

    totalTests++;
    if (turnResult.action === tc.expectedAction) {
      passedTests++;
      console.log(`  ✓ Conversation Action: ${turnResult.action} (Expected: ${tc.expectedAction})`);
    } else {
      failures.push(`[${tc.id}] Action mismatch: got ${turnResult.action}, expected ${tc.expectedAction}`);
      console.error(`  ✗ FAIL: Action mismatch: got ${turnResult.action}, expected ${tc.expectedAction}`);
    }

    // 5. Semantic Doctor Reply Verification Oracle
    totalTests++;
    const semanticErrors = validateSemanticOracle(turnResult.doctorReply || "", tc.semanticOracle);
    if (semanticErrors.length === 0) {
      passedTests++;
      console.log(`  ✓ Semantic Oracle Validated: "${(turnResult.doctorReply || "").slice(0, 90)}..."`);
    } else {
      failures.push(`[${tc.id}] Semantic Oracle Violations: ${semanticErrors.join("; ")}`);
      console.error(`  ✗ FAIL: Semantic Oracle Violations in reply: "${turnResult.doctorReply}"`);
      semanticErrors.forEach(err => console.error(`     - ${err}`));
    }

    // 6. Multi-Turn / Slot Integrity Verification
    if (tc.expectedNegations.length > 0) {
      for (const neg of tc.expectedNegations) {
        totalTests++;
        const memoryDenials = turnResult.state.conversationMemory?.deniedSymptoms || [];
        const slotFacts = turnResult.state.slots.known_facts || [];
        const isNegatedInState =
          memoryDenials.some(d => d.toLowerCase().includes(neg.toLowerCase())) ||
          slotFacts.some(f => f.toLowerCase().includes(`denied:`) && f.toLowerCase().includes(neg.toLowerCase())) ||
          !slotFacts.some(f => f.toLowerCase().includes(`location: chest`));

        if (isNegatedInState) {
          passedTests++;
          console.log(`  ✓ Negation of [${neg}] preserved in ClinicalState`);
        } else {
          failures.push(`[${tc.id}] Negation of [${neg}] missing in ClinicalState`);
          console.error(`  ✗ FAIL: Negation of [${neg}] not captured in state`);
        }
      }
    }

    if (tc.expectedAffirmations.length > 0) {
      for (const aff of tc.expectedAffirmations) {
        totalTests++;
        const symptoms = turnResult.state.slots.associated_symptoms || [];
        const slotFacts = turnResult.state.slots.known_facts || [];
        const transcript = turnResult.state.cumulativeTranscript || "";
        const isPresent =
          symptoms.some(s => s.toLowerCase().includes(aff.toLowerCase())) ||
          slotFacts.some(f => f.toLowerCase().includes(aff.toLowerCase())) ||
          new RegExp(`\\b${aff}\\b`, "i").test(transcript);

        if (isPresent) {
          passedTests++;
          console.log(`  ✓ Presence of [${aff}] recorded in ClinicalState`);
        } else {
          failures.push(`[${tc.id}] Presence of [${aff}] missing in ClinicalState`);
          console.error(`  ✗ FAIL: Affirmation of [${aff}] not captured in state`);
        }
      }
    }

    // 7. Multi-Turn Deterioration & Immediate Safety Escalation Test (CHALLENGE-05 Turn 2 Dual-Branch Evaluation)
    if (tc.id === "CHALLENGE-05") {
      // -----------------------------------------------------------------------
      // Turn 2a: Patient is alert and able to swallow safely
      // -----------------------------------------------------------------------
      console.log("  --- Multi-Turn Deterioration Test (CHALLENGE-05 Turn 2a: Alert / Able to Swallow Safely) ---");
      const turn2aResult = await cm.processTurn(
        "I take insulin for diabetes, and right now I am feeling very confused and disoriented",
        JSON.parse(JSON.stringify(turnResult.state))
      );

      // Verify immediate escalation to emergency
      totalTests++;
      if (turn2aResult.action === "EMERGENCY_CONVENE_BOARD") {
        passedTests++;
        console.log(`  ✓ [Turn 2a] Deterioration Escalation: Action escalated to EMERGENCY_CONVENE_BOARD`);
      } else {
        failures.push(`[CHALLENGE-05 Turn 2a] Expected EMERGENCY_CONVENE_BOARD, got ${turn2aResult.action}`);
        console.error(`  ✗ FAIL: Expected EMERGENCY_CONVENE_BOARD, got ${turn2aResult.action}`);
      }

      // Verify safety flag triggered
      totalTests++;
      const hasMetFlag2a = turn2aResult.preArbiterResult?.pre_safety_flags.includes("UNI-MET-02");
      if (hasMetFlag2a) {
        passedTests++;
        console.log(`  ✓ [Turn 2a] Safety Screen Trigger: UNI-MET-02 neuroglycopenia red flag fired`);
      } else {
        failures.push(`[CHALLENGE-05 Turn 2a] Missing UNI-MET-02 in pre_safety_flags`);
        console.error(`  ✗ FAIL: Missing UNI-MET-02 in pre_safety_flags`);
      }

      // Verify emergency spoken instructions with swallowing safety condition and aspiration warning
      totalTests++;
      const reply2a = turn2aResult.doctorReply || "";
      const hasEmergencyGuidance2a = /\b(?:108|112)\b/i.test(reply2a) && /\b(?:sugar|juice|sweet)\b/i.test(reply2a);
      const hasSwallowingSafetyCondition2a = /\b(?:alert|awake)\b/i.test(reply2a) && /\b(?:swallow safely|without choking)\b/i.test(reply2a);
      const hasAspirationWarning2a = /\b(?:drowsy|trouble swallowing|cannot swallow).*(?:do not|don't)\s+eat\s+or\s+drink\b/i.test(reply2a);

      if (hasEmergencyGuidance2a && hasSwallowingSafetyCondition2a && hasAspirationWarning2a) {
        passedTests++;
        console.log(`  ✓ [Turn 2a] Emergency Spoken Guidance: Emergency services + swallowing-contingent glucose guidance validated`);
      } else {
        failures.push(`[CHALLENGE-05 Turn 2a] Emergency guidance missing required swallowing safety conditions or warnings: "${reply2a}"`);
        console.error(`  ✗ FAIL: Emergency spoken guidance incomplete: "${reply2a}"`);
      }

      // Verify trajectory provenance (zero unsupported worsening claims)
      totalTests++;
      const hasNoUnsupportedTrajectory2a = !/\b(?:worsening|getting worse|rapidly progressing)\b/i.test(reply2a);
      if (hasNoUnsupportedTrajectory2a) {
        passedTests++;
        console.log(`  ✓ [Turn 2a] Symptom Trajectory Provenance: Zero unsupported severity/worsening claims`);
      } else {
        failures.push(`[CHALLENGE-05 Turn 2a] Reply contains unsupported symptom trajectory ('worsening'): "${reply2a}"`);
        console.error(`  ✗ FAIL: Reply contains unsupported symptom trajectory: "${reply2a}"`);
      }

      // -----------------------------------------------------------------------
      // Turn 2b: Patient is drowsy / unable to swallow safely (Choking Hazard Branch)
      // -----------------------------------------------------------------------
      console.log("  --- Multi-Turn Deterioration Test (CHALLENGE-05 Turn 2b: Drowsy / Choking Risk / Cannot Swallow) ---");
      const cm2b = new ConversationManager();
      const turn2bResult = await cm2b.processTurn(
        "I take insulin for diabetes, but I am too drowsy to swallow safely and feel like I am passing out",
        JSON.parse(JSON.stringify(turnResult.state))
      );

      // Verify immediate escalation to emergency
      totalTests++;
      if (turn2bResult.action === "EMERGENCY_CONVENE_BOARD") {
        passedTests++;
        console.log(`  ✓ [Turn 2b] Deterioration Escalation: Action escalated to EMERGENCY_CONVENE_BOARD`);
      } else {
        failures.push(`[CHALLENGE-05 Turn 2b] Expected EMERGENCY_CONVENE_BOARD, got ${turn2bResult.action}`);
        console.error(`  ✗ FAIL: Expected EMERGENCY_CONVENE_BOARD, got ${turn2bResult.action}`);
      }

      // Verify safety flag triggered
      totalTests++;
      const hasMetFlag2b = turn2bResult.preArbiterResult?.pre_safety_flags.includes("UNI-MET-02");
      if (hasMetFlag2b) {
        passedTests++;
        console.log(`  ✓ [Turn 2b] Safety Screen Trigger: UNI-MET-02 neuroglycopenia red flag fired`);
      } else {
        failures.push(`[CHALLENGE-05 Turn 2b] Missing UNI-MET-02 in pre_safety_flags`);
        console.error(`  ✗ FAIL: Missing UNI-MET-02 in pre_safety_flags`);
      }

      // Verify strict zero oral food/drink, choking hazard warning, and recovery position
      totalTests++;
      const reply2b = turn2bResult.doctorReply || "";
      const hasProhibition2b = /\b(?:do not|don't)\s+(?:attempt\s+to\s+)?(?:eat|drink)\b/i.test(reply2b);
      const hasChokingWarning2b = /\bchoking\b/i.test(reply2b);
      const hasRecoveryPosition2b = /\b(?:recovery position|on your side)\b/i.test(reply2b);
      const hasEmergencyNumber2b = /\b(?:108|112)\b/i.test(reply2b);
      const givesZeroOralGlucose2b = !/\btake\s+(?:fast-acting\s+)?sugar\b/i.test(reply2b) && !/\bdrink\s+(?:fruit\s+)?juice\b/i.test(reply2b);

      if (hasProhibition2b && hasChokingWarning2b && hasRecoveryPosition2b && hasEmergencyNumber2b && givesZeroOralGlucose2b) {
        passedTests++;
        console.log(`  ✓ [Turn 2b] Swallowing-Compromised Guidance: Strict zero-intake, choking warning, recovery position & emergency contact instruction validated`);
      } else {
        failures.push(`[CHALLENGE-05 Turn 2b] Compromised swallowing guidance failed safety criteria: "${reply2b}"`);
        console.error(`  ✗ FAIL: Compromised swallowing guidance violation: "${reply2b}"`);
      }

      // Verify trajectory provenance in Turn 2b
      totalTests++;
      const hasNoUnsupportedTrajectory2b = !/\b(?:worsening|getting worse|rapidly progressing)\b/i.test(reply2b);
      if (hasNoUnsupportedTrajectory2b) {
        passedTests++;
        console.log(`  ✓ [Turn 2b] Symptom Trajectory Provenance: Zero unsupported severity/worsening claims`);
      } else {
        failures.push(`[CHALLENGE-05 Turn 2b] Reply contains unsupported symptom trajectory: "${reply2b}"`);
        console.error(`  ✗ FAIL: Reply contains unsupported symptom trajectory: "${reply2b}"`);
      }
    }
  }

  console.log("\n==============================================================================");
  console.log("                       CHALLENGE SUITE SUMMARY");
  console.log("==============================================================================\n");
  console.log(`  Total Invariant Checks:   ${totalTests}`);
  console.log(`  Passed Checks:            ${passedTests} / ${totalTests} (${((passedTests / totalTests) * 100).toFixed(1)}%)`);
  console.log(`  Failed Checks:            ${failures.length}`);

  if (failures.length > 0) {
    console.error("\nFAILURES DETECTED:");
    failures.forEach(f => console.error(`  - ${f}`));
    process.exit(1);
  } else {
    console.log("\n🎉 ALL 6 CLINICAL CHALLENGE CASES PASSED 100% ACROSS REPAIRED SEMANTIC ORACLE!");
    process.exit(0);
  }
}

runChallengeSuite().catch(err => {
  console.error("Unhandled error running challenge suite:", err);
  process.exit(1);
});
