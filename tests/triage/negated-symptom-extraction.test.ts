import assert from "assert";
import { ConversationInterpreter } from "../../lib/triage/conversation-interpreter";

console.log("================================================================================");
console.log("      TEST SUITE: NEGATED SYMPTOM & NEUROLOGICAL SIGN EXTRACTION                ");
console.log("================================================================================\n");

const interpreter = new ConversationInterpreter();

interface TestCase {
  id: string;
  utterance: string;
  mustNotContainEvidence: Array<{ slot: string; value: string }>;
  mustContainEvidence?: Array<{ slot: string; value: string }>;
  description: string;
}

const testCases: TestCase[] = [
  {
    id: "REG-A-ACS-SWEAT",
    utterance: "Chest pain without any sweating or cold sweats",
    mustNotContainEvidence: [
      { slot: "associated_symptoms", value: "cold sweats/diaphoresis" }
    ],
    description: "Regression A: Diaphoresis denied after 'without any' must not be extracted as positive",
  },
  {
    id: "REG-B-NEURO-DENIES",
    utterance: "I have a cold with a mild headache, denies any trouble speaking, stiff neck, or weakness",
    mustNotContainEvidence: [
      { slot: "neurological_signs", value: "speech difficulty" },
      { slot: "neurological_signs", value: "neck stiffness" },
      { slot: "neurological_signs", value: "weakness" }
    ],
    mustContainEvidence: [
      { slot: "chief_complaint", value: "headache" }
    ],
    description: "Regression B: Multiple neurological red flags denied after 'denies any' must not be extracted",
  },
  {
    id: "REG-C-MIXED-POLARITY-SWEAT-NAUSEA",
    utterance: "No sweating, but I feel nauseated",
    mustNotContainEvidence: [
      { slot: "associated_symptoms", value: "cold sweats/diaphoresis" }
    ],
    mustContainEvidence: [
      { slot: "associated_symptoms", value: "nausea" }
    ],
    description: "Mixed polarity: Denied sweating must be suppressed while post-conjunction nausea is preserved",
  },
  {
    id: "REG-D-SELECTIVE-WEAKNESS-DROOP",
    utterance: "I deny weakness but have facial drooping",
    mustNotContainEvidence: [
      { slot: "neurological_signs", value: "weakness" }
    ],
    mustContainEvidence: [
      { slot: "neurological_signs", value: "facial droop" }
    ],
    description: "Selective negation: Denied weakness must not suppress positive facial droop",
  },
  {
    id: "REG-E-COMPOUND-NEITHER-NUMB-SPEECH",
    utterance: "Neither numbness nor difficulty speaking",
    mustNotContainEvidence: [
      { slot: "neurological_signs", value: "numbness" },
      { slot: "neurological_signs", value: "speech difficulty" }
    ],
    description: "Compound negation: 'Neither ... nor' must suppress both symptoms",
  },
  {
    id: "REG-F-POSITIVE-CONTROL-WEAK-SWEAT",
    utterance: "I have weakness and sweating",
    mustNotContainEvidence: [],
    mustContainEvidence: [
      { slot: "neurological_signs", value: "weakness" },
      { slot: "associated_symptoms", value: "cold sweats/diaphoresis" }
    ],
    description: "Positive control: Confirmed weakness and sweating must both be extracted as positive",
  },
  {
    id: "REG-G-HISTORICAL-WEAKNESS",
    utterance: "I had weakness yesterday, but not now",
    mustNotContainEvidence: [
      { slot: "neurological_signs", value: "weakness" }
    ],
    description: "Historical negation: 'had weakness yesterday, but not now' must not be active present weakness",
  },
  {
    id: "REG-H-PHOTOPHOBIA-STIFF-NECK",
    utterance: "I have a headache, without any light sensitivity or stiff neck",
    mustNotContainEvidence: [
      { slot: "associated_symptoms", value: "photophobia" },
      { slot: "neurological_signs", value: "neck stiffness" }
    ],
    mustContainEvidence: [
      { slot: "chief_complaint", value: "headache" }
    ],
    description: "Headache red flags: Denied photophobia and stiff neck must not be extracted",
  },
  {
    id: "REG-I-FACIAL-DROOP-NEGATED",
    utterance: "Severe headache, but no facial droop",
    mustNotContainEvidence: [
      { slot: "neurological_signs", value: "facial droop" }
    ],
    mustContainEvidence: [
      { slot: "chief_complaint", value: "headache" }
    ],
    description: "Stroke red flag: Denied facial droop must not be extracted",
  },
  {
    id: "REG-J-VOICE-CHANGE-NEGATED",
    utterance: "Sore throat with fever, no voice change",
    mustNotContainEvidence: [
      { slot: "associated_symptoms", value: "voice change" }
    ],
    mustContainEvidence: [
      { slot: "chief_complaint", value: "throat pain" }
    ],
    description: "Airway red flag: Denied voice change must not be extracted",
  },
  {
    id: "REG-K-EMERGENCY-PRESERVATION",
    utterance: "No sweating, but severe crushing chest pain",
    mustNotContainEvidence: [
      { slot: "associated_symptoms", value: "cold sweats/diaphoresis" }
    ],
    mustContainEvidence: [
      { slot: "character", value: "crushing" }
    ],
    description: "Emergency preservation: Denied sweating must not suppress positive crushing chest pain character",
  },
  {
    id: "REG-L-HISTORICAL-WEAKNESS-COMMA",
    utterance: "I had weakness, but not now",
    mustNotContainEvidence: [
      { slot: "neurological_signs", value: "weakness" }
    ],
    description: "Historical negation with comma: 'had weakness, but not now' must not be extracted",
  }
];

let failedCount = 0;
let passedCount = 0;

for (const tc of testCases) {
  const result = interpreter.interpret(tc.utterance, {} as any);
  const evidence = result.newEvidence || [];

  let testPassed = true;
  const failureReasons: string[] = [];

  // Check forbidden extractions
  for (const forbidden of tc.mustNotContainEvidence) {
    const found = evidence.find(e => e.slot === forbidden.slot && e.value === forbidden.value);
    if (found) {
      testPassed = false;
      failureReasons.push(`Falsely extracted negated symptom [${forbidden.slot}: '${forbidden.value}']`);
    }
  }

  // Check required positive extractions
  if (tc.mustContainEvidence) {
    for (const required of tc.mustContainEvidence) {
      const found = evidence.find(e => e.slot === required.slot && e.value === required.value);
      if (!found) {
        testPassed = false;
        failureReasons.push(`Failed to extract valid positive symptom [${required.slot}: '${required.value}']`);
      }
    }
  }

  if (testPassed) {
    passedCount++;
    console.log(`  ✓ [PASS] ${tc.id}: ${tc.description}`);
  } else {
    failedCount++;
    console.error(`  ✗ [FAIL] ${tc.id}: ${tc.description}`);
    for (const r of failureReasons) {
      console.error(`       -> ${r}`);
    }
  }
}

console.log("\n================================================================================");
console.log(` RESULTS: ${passedCount} passed, ${failedCount} failed of ${testCases.length} total tests`);
console.log("================================================================================\n");

if (failedCount > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
