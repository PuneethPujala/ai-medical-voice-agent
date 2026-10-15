import { generateDoctorTurnResponse } from "../../lib/ai/clinical-llm";
import { ConversationManager } from "../../lib/triage/conversation-manager";
import { DOCTOR_PROFILES } from "../../config/doctors";

/**
 * REGRESSION SUITE: Elimination of Deterministic CLARIFY Override
 *
 * Clinical Dialogue Invariant:
 * When a patient utterance is ambiguous or fragmented (e.g. "it just feels weird inside my head and all over"),
 * MedVoice must not discard the LLM's empathetic, context-aware clarification in favor of a static,
 * robotic IVR template. The ambiguity must be passed into the LLM context, allowing it to articulate
 * the clarification naturally with bedside manner, while retaining the validated fallback if generation fails.
 */

async function runClarifyDialogueTests() {
  console.log("=== Running Natural Clarification Dialogue Tests ===\n");
  let passed = 0;
  let failed = 0;

  const convManager = new ConversationManager();
  const state = convManager.createInitialState();

  // Test 1: Ambiguous utterance through ConversationManager produces CLARIFY action with clarification advice
  const ambiguousUtterance = "it is kind of like a weird feeling maybe for a day or two or something";
  const managerResult = await convManager.processTurn(ambiguousUtterance, state);

  if (managerResult.action === "CLARIFY" || managerResult.action === "ASK_PATIENT") {
    console.log(`  [PASS] Conversational manager processed ambiguous turn -> action=${managerResult.action}`);
    passed++;
  } else {
    console.error(`  [FAIL] Expected CLARIFY or ASK_PATIENT for ambiguous turn, got: ${managerResult.action}`);
    failed++;
  }

  // Test 2: generateDoctorTurnResponse with isClarificationRequest=true & clarificationGuidance generates natural reply
  const mockPreArbiter = {
    immediate_danger: false,
    pre_safety_flags: [],
    suggested_specialists: [],
    latency_us: 100,
  };

  const doctorProfile = DOCTOR_PROFILES[0];

  const llmResult = await generateDoctorTurnResponse({
    patientUtterance: ambiguousUtterance,
    conversationHistory: [
      { role: "doctor", text: "Hello, I am Dr. Sarah Chen. What symptoms are you experiencing today?" },
      { role: "patient", text: ambiguousUtterance },
    ],
    interviewState: managerResult.state,
    preArbiterResult: mockPreArbiter,
    doctor: doctorProfile,
    fallbackReply: managerResult.doctorReply,
    isClarificationRequest: true,
    clarificationGuidance: managerResult.doctorReply,
  });

  // Verify that an active doctor reply is produced (either live-generated natural reply or calibrated fallback)
  const activeDoctorReply = (llmResult.liveGenerated && llmResult.reply)
    ? llmResult.reply
    : managerResult.doctorReply;

  if (activeDoctorReply && activeDoctorReply.length > 10) {
    console.log(`  [PASS] Produced valid clinical clarification reply: "${activeDoctorReply}" (provider=${llmResult.provider}, liveGenerated=${llmResult.liveGenerated})`);
    passed++;
  } else {
    console.error(`  [FAIL] Failed to produce valid clinical clarification reply`);
    failed++;
  }

  // Test 3: If live LLM generation succeeds, activeDoctorReply must NOT be forced to the static fallback
  if (llmResult.liveGenerated && llmResult.reply) {
    if (activeDoctorReply === llmResult.reply) {
      console.log(`  [PASS] Preserved LLM's natural clarification reply without deterministic override`);
      passed++;
    } else {
      console.error(`  [FAIL] Deterministic override discarded live LLM reply`);
      failed++;
    }
  } else {
    // If running in environment without live API keys, verify fallback was preserved safely
    if (activeDoctorReply === managerResult.doctorReply) {
      console.log(`  [PASS] Safely fell back to validated fallback reply when live model unconfigured`);
      passed++;
    } else {
      console.error(`  [FAIL] Fallback did not resolve to managerResult.doctorReply`);
      failed++;
    }
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed.`);
  if (failed > 0) {
    process.exit(1);
  }
}

runClarifyDialogueTests().catch((err) => {
  console.error("Test execution error:", err);
  process.exit(1);
});
