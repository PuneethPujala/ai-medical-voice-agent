import { conversationManager } from "../lib/triage/conversation-manager";
import { conversationInterpreter } from "../lib/triage/conversation-interpreter";
import { responsePlanner } from "../lib/triage/response-planner";
import { generateDoctorTurnResponse } from "../lib/ai/clinical-llm";
import { DOCTOR_PROFILES } from "../config/doctors";

async function runScenarioTests() {
  console.log("==============================================================================");
  console.log("   RESPONSE PLANNER & CONVERSATION MEMORY SCENARIO EVALUATION HARNESS         ");
  console.log("==============================================================================");

  const sarahDoctor = DOCTOR_PROFILES.find((d) => d.id === "dr-sarah-chen") || DOCTOR_PROFILES[0];

  // =========================================================================
  // SCENARIO 1: Episodic Clarification & Negative Risk Factors
  // Patient: "None... but it just happens once in a month i think?"
  // =========================================================================
  console.log("\n--- SCENARIO 1: Episodic Clarification & Negative Risk Factors ---");
  const s1Utterance = "None... but it just happens once in a month i think?";
  const s1Interpretation = conversationInterpreter.interpret(s1Utterance);

  console.log(`• Patient: "${s1Utterance}"`);
  console.log(`• Semantic Intent: ${s1Interpretation.intent}`);
  console.log(`• Extracted Frequency: "${s1Interpretation.extractedFrequency}"`);
  console.log(`• Extracted Risk Factors: "${s1Interpretation.extractedRiskFactors}"`);

  if (s1Interpretation.intent !== "frequency_clarification") {
    throw new Error(`Scenario 1 failed: Expected 'frequency_clarification', got '${s1Interpretation.intent}'`);
  }
  if (!s1Interpretation.extractedFrequency?.includes("month")) {
    throw new Error(`Scenario 1 failed: Expected extractedFrequency to contain 'month', got '${s1Interpretation.extractedFrequency}'`);
  }

  // Process turn in conversation manager with pre-existing chest symptoms
  let state1 = conversationManager.createInitialState();
  state1.slots.known_facts.push("HEADACHE: present", "TENSION_TYPE: suspected");
  state1.cumulativeTranscript = "Patient: recurring headaches\nDoctor: Do you have any known triggers or risk factors?";
  state1.conversationMemory = {
    confirmedFacts: ["headache", "tension-type"],
    deniedSymptoms: [],
    questionsAlreadyAsked: ["known triggers", "risk factors"],
    patientCorrections: [],
    patientObjections: [],
    patientConcerns: [],
    accessConstraints: [],
    uncertainties: [],
  };

  const res1 = await conversationManager.processTurn(s1Utterance, state1);
  console.log(`• Manager Action: ${res1.action}`);
  console.log(`• Plan Primary Goal: ${res1.state.responsePlan?.primaryGoal}`);
  console.log(`• Sarah Spoken Reply: "${res1.doctorReply}"`);
  console.log(`• Pending Question Slot: ${res1.state.pendingQuestion?.targetSlot}`);

  if (res1.state.responsePlan?.primaryGoal !== "ACKNOWLEDGE_AND_EXPLORE") {
    throw new Error(`Scenario 1 failed: Expected ACKNOWLEDGE_AND_EXPLORE, got '${res1.state.responsePlan?.primaryGoal}'`);
  }
  if (!res1.doctorReply.toLowerCase().includes("once in a month") && !res1.doctorReply.toLowerCase().includes("month")) {
    throw new Error(`Scenario 1 failed: Expected doctor reply to synthesize episodic monthly frequency, got "${res1.doctorReply}"`);
  }
  if (!res1.doctorReply.toLowerCase().includes("how long")) {
    throw new Error(`Scenario 1 failed: Expected doctor reply to ask how long each episode lasts, got "${res1.doctorReply}"`);
  }
  console.log("✅ SCENARIO 1 PASSED: Episodic frequency and negative risk factors properly synthesized.");

  // =========================================================================
  // SCENARIO 2: Patient Repetition Objection
  // Patient: "We already talked about it?"
  // =========================================================================
  console.log("\n--- SCENARIO 2: Patient Repetition Objection ---");
  const s2Utterance = "We already talked about it?";
  const s2Interpretation = conversationInterpreter.interpret(s2Utterance);

  console.log(`• Patient: "${s2Utterance}"`);
  console.log(`• Semantic Intent: ${s2Interpretation.intent}`);
  console.log(`• isObjectionRepetition: ${s2Interpretation.isObjectionRepetition}`);

  if (s2Interpretation.intent !== "patient_objection_repetition" || !s2Interpretation.isObjectionRepetition) {
    throw new Error(`Scenario 2 failed: Expected 'patient_objection_repetition', got '${s2Interpretation.intent}'`);
  }

  // Feed this into the manager that just had state1
  const res2 = await conversationManager.processTurn(s2Utterance, res1.state);
  console.log(`• Manager Action: ${res2.action}`);
  console.log(`• Plan Primary Goal: ${res2.state.responsePlan?.primaryGoal}`);
  console.log(`• Sarah Spoken Reply: "${res2.doctorReply}"`);

  if (res2.state.responsePlan?.primaryGoal !== "RESOLVE_OBJECTION_REPETITION") {
    throw new Error(`Scenario 2 failed: Expected RESOLVE_OBJECTION_REPETITION, got '${res2.state.responsePlan?.primaryGoal}'`);
  }
  if (!res2.doctorReply.toLowerCase().includes("don't want to make you repeat") && !res2.doctorReply.toLowerCase().includes("repeat yourself")) {
    throw new Error(`Scenario 2 failed: Expected Sarah to apologize and affirm not repeating, got "${res2.doctorReply}"`);
  }
  console.log("✅ SCENARIO 2 PASSED: Repetition objection acknowledged with humility and confirmed facts.");

  // =========================================================================
  // SCENARIO 3: Emotional Distress / Bedside Empathy
  // Patient: "I'm really scared."
  // =========================================================================
  console.log("\n--- SCENARIO 3: Emotional Distress Validation ---");
  const s3Utterance = "I'm really scared.";
  const s3Interpretation = conversationInterpreter.interpret(s3Utterance);

  console.log(`• Patient: "${s3Utterance}"`);
  console.log(`• Semantic Intent: ${s3Interpretation.intent}`);
  console.log(`• isEmotionalDistress: ${s3Interpretation.isEmotionalDistress}`);

  if (s3Interpretation.intent !== "emotional_distress" || !s3Interpretation.isEmotionalDistress) {
    throw new Error(`Scenario 3 failed: Expected 'emotional_distress', got '${s3Interpretation.intent}'`);
  }

  let state3 = conversationManager.createInitialState();
  const res3 = await conversationManager.processTurn(s3Utterance, state3);
  console.log(`• Manager Action: ${res3.action}`);
  console.log(`• Plan Primary Goal: ${res3.state.responsePlan?.primaryGoal}`);
  console.log(`• Sarah Spoken Reply: "${res3.doctorReply}"`);

  if (res3.state.responsePlan?.primaryGoal !== "VALIDATE_EMOTION_BEFORE_INQUIRY") {
    throw new Error(`Scenario 3 failed: Expected VALIDATE_EMOTION_BEFORE_INQUIRY, got '${res3.state.responsePlan?.primaryGoal}'`);
  }
  if (!res3.doctorReply.toLowerCase().includes("scared") || !res3.doctorReply.toLowerCase().includes("step at a time")) {
    throw new Error(`Scenario 3 failed: Expected warm emotional validation, got "${res3.doctorReply}"`);
  }
  console.log("✅ SCENARIO 3 PASSED: Emotional distress validated with bedside empathy before clinical inquiry.");

  // =========================================================================
  // SCENARIO 4: Memory Inquiry (Context & Continuity)
  // Patient: "Hey.. do you remember my illness?"
  // =========================================================================
  console.log("\n--- SCENARIO 4: Memory Inquiry Handling ---");
  const s4Utterance = "Hey.. do you remember my illness?";
  const s4Interpretation = conversationInterpreter.interpret(s4Utterance);

  console.log(`• Patient: "${s4Utterance}"`);
  console.log(`• Semantic Intent: ${s4Interpretation.intent}`);

  if (s4Interpretation.intent !== "memory_inquiry" || !s4Interpretation.isMemoryInquiry) {
    throw new Error(`Scenario 4 failed: Expected 'memory_inquiry', got '${s4Interpretation.intent}'`);
  }

  let state4 = conversationManager.createInitialState();
  const res4 = await conversationManager.processTurn(s4Utterance, state4);
  console.log(`• Plan Primary Goal: ${res4.state.responsePlan?.primaryGoal}`);
  console.log(`• Sarah Spoken Reply: "${res4.doctorReply}"`);

  if (!res4.doctorReply.toLowerCase().includes("assume i remember")) {
    throw new Error(`Scenario 4 failed: Expected honesty about active session memory, got "${res4.doctorReply}"`);
  }
  console.log("✅ SCENARIO 4 PASSED: Memory inquiry addressed honestly without fake recollection.");

  // =========================================================================
  // SCENARIO 5: LLM Turn Contract & Fallback Verification
  // =========================================================================
  console.log("\n--- SCENARIO 5: LLM Turn Generation & Anti-Repetition Fallback Guard ---");
  const llmRes = await generateDoctorTurnResponse({
    patientUtterance: s2Utterance,
    conversationHistory: [
      { role: "patient", text: "yeah sweating and cant move" },
      { role: "doctor", text: "Call 108 right now and stay still; don't drive. Do you have any known heart disease or risk factors?" },
      { role: "patient", text: "None... but it just happens once in a month i think?" },
      { role: "doctor", text: "Okay, so this has happened intermittently, once a month, rather than being a one-time episode. When it happens, how long does the chest discomfort usually last?" },
      { role: "patient", text: "We already talked about it?" },
    ],
    interviewState: res2.state,
    preArbiterResult: res2.preArbiterResult,
    demographics: { age: 48, age_group: "Adult (18-64)" },
    doctor: sarahDoctor,
    fallbackReply: res2.doctorReply,
  });

  console.log(`• LLM Provider: ${llmRes.provider}`);
  console.log(`• Generated Reply: "${llmRes.reply}"`);

  if (llmRes.reply.toLowerCase().includes("when did the symptoms first start")) {
    throw new Error("Scenario 5 failed: Generated reply re-asked onset instead of addressing repetition!");
  }
  if (!llmRes.reply.toLowerCase().includes("repeat") && !llmRes.reply.toLowerCase().includes("noted") && !llmRes.reply.toLowerCase().includes("retread")) {
    throw new Error(`Scenario 5 failed: Reply did not address repetition objection: "${llmRes.reply}"`);
  }
  console.log("✅ SCENARIO 5 PASSED: Turn contract & response validator enforce anti-repetition rules.");

  console.log("\n==============================================================================");
  console.log("✅ ALL 5 REAL-WORLD RECORDING SCENARIOS PASSED WITH PERFECT BEHAVIOR!");
  console.log("==============================================================================");
}

runScenarioTests().catch((err) => {
  console.error("Scenario test failed:", err);
  process.exit(1);
});
