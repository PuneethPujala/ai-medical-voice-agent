import { validateDoctorTurnResponse } from "../../lib/ai/clinical-llm";

/**
 * REGRESSION SUITE: False Emergency-Dispatch Claim Prohibition
 *
 * Clinical Invariant:
 * MedVoice is an AI clinical intake and triage decision-support system, NOT a Computer Aided
 * Dispatch (CAD) system. Falsely reassuring callers that "an ambulance is on the way" or that
 * "paramedics have been dispatched" introduces catastrophic clinical risk (patients failing to
 * dial emergency services themselves).
 *
 * Rule: ANY claim that an ambulance/paramedic/help has been dispatched, sent, or is on the way
 * must be deterministically rejected by validateDoctorTurnResponse with category "false_dispatch_claim".
 */

async function runFalseDispatchTests() {
  console.log("=== Running False Emergency-Dispatch Claim Prohibition Tests ===\n");
  let passed = 0;
  let failed = 0;

  const falseDispatchPhrasings = [
    "An ambulance is on the way.",
    "An ambulance is on its way to your home.",
    "I have dispatched an ambulance to your location.",
    "I've dispatched an ambulance.",
    "We have dispatched help to assist you.",
    "Help is on the way, please remain calm.",
    "Help is en route to your address.",
    "Paramedics are on their way right now.",
    "Paramedics have been dispatched to help you.",
    "Paramedics have been called.",
    "I called emergency services for you.",
    "I've called an ambulance for you.",
    "Emergency services have been called and will arrive shortly.",
    "Emergency services are on their way.",
    "First responders are on the way to your location.",
    "First responders have been dispatched.",
    "We sent an ambulance to you.",
    "I have contacted emergency services to dispatch a unit.",
    "Don't worry, an ambulance has been called for you."
  ];

  for (const phrase of falseDispatchPhrasings) {
    const result = validateDoctorTurnResponse(
      phrase,
      "I am having severe crushing chest pain and cannot breathe.",
      "self",
      true,
      "112",
      "108"
    );

    if (!result.isValid && result.category === "false_dispatch_claim") {
      console.log(`  [PASS] Rejected false dispatch claim: "${phrase}" -> category=${result.category}`);
      passed++;
    } else {
      console.error(`  [FAIL] Did not reject false dispatch claim: "${phrase}" -> isValid=${result.isValid}, category=${result.category}, reason=${result.reason}`);
      failed++;
    }
  }

  const validEmergencyDirectives = [
    "Please call 112 or 108 immediately for an ambulance.",
    "You must call 112 right away. This is a medical emergency.",
    "Have someone call 108 immediately or go to the nearest emergency department.",
    "This sounds like a critical emergency. Please dial 112 now for immediate medical help.",
    "Please call emergency services at 112 immediately and sit upright."
  ];

  for (const phrase of validEmergencyDirectives) {
    const result = validateDoctorTurnResponse(
      phrase,
      "I am having severe crushing chest pain and cannot breathe.",
      "self",
      true,
      "112",
      "108"
    );

    if (result.isValid) {
      console.log(`  [PASS] Permitted valid emergency directive: "${phrase}"`);
      passed++;
    } else {
      console.error(`  [FAIL] Incorrectly rejected valid emergency directive: "${phrase}" -> category=${result.category}, reason=${result.reason}`);
      failed++;
    }
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed.`);
  if (failed > 0) {
    process.exit(1);
  }
}

runFalseDispatchTests().catch((err) => {
  console.error("Test execution error:", err);
  process.exit(1);
});
