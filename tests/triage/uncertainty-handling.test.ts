import assert from "assert";
import { ConversationInterpreter } from "../../lib/triage/conversation-interpreter";
import { PendingQuestion } from "../../lib/agents/schemas";

console.log("================================================================================");
console.log("      TEST SUITE: CLINICAL UNCERTAINTY & EPISTEMIC STATUS HANDLING             ");
console.log("================================================================================\n");

const interpreter = new ConversationInterpreter();

interface TestCase {
  id: string;
  utterance: string;
  pendingQuestion?: PendingQuestion | null;
  description: string;
  validate: (result: ReturnType<typeof interpreter.interpret>) => { passed: boolean; message?: string };
}

const testCases: TestCase[] = [
  {
    id: "UNC-01-HEDGED-FEVER",
    utterance: "Maybe I have a slight fever.",
    description: "Hedged subjective fever must be extracted as uncertain, not dropped or confirmed",
    validate: (res) => {
      const feverProp = res.proposals?.find(p => p.concept === "fever" || p.concept === "subjective_fever");
      const feverEv = res.newEvidence.find(e => e.slot === "fever" || e.slot === "subjective_fever");
      if (!feverProp && !feverEv) {
        return { passed: false, message: "Fever was completely dropped from evidence and proposals" };
      }
      if (feverProp && feverProp.assertionStatus !== "uncertain") {
        return { passed: false, message: `Expected assertionStatus 'uncertain' for hedged fever, got '${feverProp.assertionStatus}'` };
      }
      return { passed: true };
    },
  },
  {
    id: "UNC-02-APPROX-TIMELINE-SEVERITY-TRAP",
    utterance: "I think it started about three days ago.",
    description: "Approximate timeline must extract onset/duration and MUST NOT falsely extract 3/10 severity",
    validate: (res) => {
      const sevEv = res.newEvidence.find(e => e.slot === "severity");
      const sevProp = res.proposals?.find(p => p.concept === "severity");
      if (sevEv || sevProp) {
        return { passed: false, message: `Falsely extracted severity '${sevEv?.value || sevProp?.value}' from timeline 'about three days ago'` };
      }
      const onsetEv = res.newEvidence.find(e => e.slot === "onset" || e.slot === "duration");
      const onsetProp = res.proposals?.find(p => p.concept === "onset" || p.concept === "duration");
      if (!onsetEv && !onsetProp) {
        return { passed: false, message: "Onset/duration was not extracted from 'about three days ago'" };
      }
      return { passed: true };
    },
  },
  {
    id: "UNC-03-HEDGED-NEURO-WEAKNESS",
    utterance: "I might have some weakness, but I'm not sure.",
    description: "Hedged weakness must preserve concept 'weakness' with assertionStatus 'uncertain', not generic 'clinical_symptom'",
    validate: (res) => {
      const weakProp = res.proposals?.find(p => p.concept === "weakness" || p.concept === "neurological_signs");
      const weakEv = res.newEvidence.find(e => e.slot === "weakness" || e.slot === "neurological_signs");
      if (!weakProp && !weakEv) {
        return { passed: false, message: "Weakness was dropped or pigeonholed into generic 'clinical_symptom'" };
      }
      const prop = weakProp || res.proposals?.[0];
      if (prop && prop.assertionStatus !== "uncertain") {
        return { passed: false, message: `Expected assertionStatus 'uncertain' for hedged weakness, got '${prop.assertionStatus}'` };
      }
      return { passed: true };
    },
  },
  {
    id: "UNC-04-HEDGED-VOICE-HOARSENESS",
    utterance: "My voice sounds a little hoarse, but maybe it's just dry.",
    description: "Hedged voice change must be captured as uncertain associated symptom",
    validate: (res) => {
      const voiceProp = res.proposals?.find(p => p.concept === "voice_character" || p.concept === "associated_symptoms" || p.concept === "voice_change");
      const voiceEv = res.newEvidence.find(e => e.slot === "voice_character" || e.slot === "associated_symptoms");
      if (!voiceProp && !voiceEv) {
        return { passed: false, message: "Voice change was not extracted" };
      }
      const prop = voiceProp || res.proposals?.find(p => p.concept.includes("voice"));
      if (prop && prop.assertionStatus !== "uncertain") {
        return { passed: false, message: `Expected assertionStatus 'uncertain' for hedged voice, got '${prop?.assertionStatus}'` };
      }
      return { passed: true };
    },
  },
  {
    id: "UNC-05-HEDGED-CHEST-PRESSURE",
    utterance: "I feel a weird flutter or pressure, I'm not really sure how to describe it.",
    description: "Ambiguous chest pressure/flutter must be captured with uncertainty noted",
    validate: (res) => {
      const charProp = res.proposals?.find(p => p.concept === "character" || p.concept === "chest_pain");
      const charEv = res.newEvidence.find(e => e.slot === "character" || e.slot === "chest_pain");
      if (!charProp && !charEv) {
        return { passed: false, message: "Pressure/flutter was not extracted" };
      }
      const prop = charProp || res.proposals?.[0];
      if (prop && prop.assertionStatus !== "uncertain") {
        return { passed: false, message: `Expected assertionStatus 'uncertain', got '${prop?.assertionStatus}'` };
      }
      return { passed: true };
    },
  },
  {
    id: "UNC-06-APPROX-HOURS-DURATION",
    utterance: "It has been going on for maybe two or three hours.",
    description: "Approximate hourly duration must NOT extract 2/10 or 3/10 severity",
    validate: (res) => {
      const sevEv = res.newEvidence.find(e => e.slot === "severity");
      const sevProp = res.proposals?.find(p => p.concept === "severity");
      if (sevEv || sevProp) {
        return { passed: false, message: `Falsely extracted severity '${sevEv?.value || sevProp?.value}' from duration 'two or three hours'` };
      }
      const durEv = res.newEvidence.find(e => e.slot === "duration" || e.slot === "onset");
      if (!durEv) {
        return { passed: false, message: "Duration was not extracted from 'two or three hours'" };
      }
      return { passed: true };
    },
  },
  {
    id: "UNC-07-QUESTION-FEVER-HEDGED",
    utterance: "Not sure, maybe a little warm.",
    pendingQuestion: {
      id: "q-fever",
      targetSlot: "fever",
      question: "Do you have a fever?",
      purpose: "Assess infection",
      askedBy: "sarah",
      doctorName: "Dr. Sarah",
      patientFacingSpeaker: "sarah",
      required: false,
      priority: "normal",
      status: "pending",
      createdAt: new Date().toISOString(),
      caseVersion: 1,
    },
    description: "Answering fever question with 'Not sure, maybe a little warm' must NOT be classified as denied",
    validate: (res) => {
      const feverEv = res.newEvidence.find(e => e.slot === "fever");
      const feverProp = res.proposals?.find(p => p.concept === "fever");
      if (feverEv?.value === "denied" || feverProp?.assertionStatus === "absent") {
        return { passed: false, message: "Falsely classified hedged fever as 'denied' / 'absent'" };
      }
      if (feverProp && feverProp.assertionStatus !== "uncertain") {
        return { passed: false, message: `Expected assertionStatus 'uncertain', got '${feverProp.assertionStatus}'` };
      }
      return { passed: true };
    },
  },
  {
    id: "UNC-08-POSITIVE-CONTROL-DEFINITIVE-FEVER",
    utterance: "I measured my temperature with a thermometer and it is 102 degrees.",
    description: "Positive control: Confirmed measured fever must be 'present' with high confidence",
    validate: (res) => {
      const feverProp = res.proposals?.find(p => p.concept === "fever");
      const feverEv = res.newEvidence.find(e => e.slot === "fever");
      if (!feverProp && !feverEv) {
        return { passed: false, message: "Confirmed fever was not extracted" };
      }
      if (feverProp && feverProp.assertionStatus !== "present") {
        return { passed: false, message: `Expected assertionStatus 'present' for confirmed fever, got '${feverProp.assertionStatus}'` };
      }
      return { passed: true };
    },
  },
  {
    id: "UNC-09-POSITIVE-CONTROL-DEFINITIVE-WEAKNESS",
    utterance: "I suddenly cannot lift my left arm at all, it is completely weak and falling down.",
    description: "Positive control: Definitive stroke weakness must be 'present', not uncertain",
    validate: (res) => {
      const weakProp = res.proposals?.find(p => p.concept === "weakness" || p.concept === "neurological_signs");
      const weakEv = res.newEvidence.find(e => e.slot === "weakness" || e.slot === "neurological_signs");
      if (!weakProp && !weakEv) {
        return { passed: false, message: "Definitive weakness was not extracted" };
      }
      if (weakProp && weakProp.assertionStatus !== "present") {
        return { passed: false, message: `Expected assertionStatus 'present' for definite weakness, got '${weakProp.assertionStatus}'` };
      }
      return { passed: true };
    },
  },
  {
    id: "UNC-10-NEGATIVE-CONTROL-DENIAL-FEVER",
    utterance: "No fever at all, I feel cool.",
    description: "Negative control: Explicit fever denial must be 'absent', not uncertain",
    validate: (res) => {
      const feverProp = res.proposals?.find(p => p.concept === "fever");
      const feverEv = res.newEvidence.find(e => e.slot === "fever");
      if (feverProp && feverProp.assertionStatus === "uncertain") {
        return { passed: false, message: "Explicit denial of fever was falsely classified as uncertain" };
      }
      if (feverEv && feverEv.value !== "denied" && feverEv.value !== "none reported") {
        return { passed: false, message: `Expected denied fever, got '${feverEv.value}'` };
      }
      return { passed: true };
    },
  },
  {
    id: "UNC-11-NEGATIVE-CONTROL-DENIAL-WEAKNESS",
    utterance: "No weakness and no numbness in my arms or legs.",
    description: "Negative control: Explicit neuro denial must be 'absent', not uncertain",
    validate: (res) => {
      const weakProp = res.proposals?.find(p => p.concept === "weakness" || (p.concept === "neurological_signs" && p.value === "weakness"));
      if (weakProp && weakProp.assertionStatus === "uncertain") {
        return { passed: false, message: "Explicit denial of weakness was falsely classified as uncertain" };
      }
      if (weakProp && weakProp.assertionStatus === "present") {
        return { passed: false, message: "Denied weakness was falsely extracted as present" };
      }
      return { passed: true };
    },
  },
  {
    id: "UNC-12-CONFIRMED-SEVERITY-RATING",
    utterance: "My pain is an 8 out of 10.",
    description: "Positive control: Confirmed numeric severity rating 8/10 must be preserved as present",
    validate: (res) => {
      const sevEv = res.newEvidence.find(e => e.slot === "severity");
      const sevProp = res.proposals?.find(p => p.concept === "severity");
      if (!sevEv && !sevProp) {
        return { passed: false, message: "Numeric severity 8/10 was not extracted" };
      }
      if (sevProp && sevProp.assertionStatus !== "present") {
        return { passed: false, message: `Expected assertionStatus 'present' for explicit 8/10, got '${sevProp.assertionStatus}'` };
      }
      if ((sevEv && sevEv.value !== "8/10") || (sevProp && sevProp.value !== "8/10")) {
        return { passed: false, message: `Expected '8/10', got ev='${sevEv?.value}', prop='${sevProp?.value}'` };
      }
      return { passed: true };
    },
  },
];

let passedCount = 0;
let failedCount = 0;

for (const tc of testCases) {
  const result = interpreter.interpret(tc.utterance, tc.pendingQuestion || null);
  const outcome = tc.validate(result);

  if (outcome.passed) {
    passedCount++;
    console.log(`  ✓ [PASS] ${tc.id}: ${tc.description}`);
  } else {
    failedCount++;
    console.error(`  ✗ [FAIL] ${tc.id}: ${tc.description}`);
    console.error(`       -> ${outcome.message}`);
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
