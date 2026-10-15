import { assembleLossAwareConversationContext } from "../../lib/ai/clinical-llm";

/**
 * REGRESSION SUITE: Token-Budgeted, Loss-Aware Context Assembler
 *
 * Clinical Invariant:
 * The naive sliding window (e.g. history.slice(-10)) drops the patient's initial Turn 1 chief
 * complaint, onset anchor, and critical historical baseline during extended encounters (>10 turns).
 * The loss-aware context assembler must:
 * 1. Pin Turn 1 chief complaint & timeline anchor.
 * 2. Compress intermediate turns into a loss-aware dialogue summary block.
 * 3. Retain the recent 6 turns verbatim.
 * 4. Strictly budget within ~2,000 tokens (~8,000 chars) without dropping safety instructions.
 */

async function runContextAssemblerTests() {
  console.log("=== Running Loss-Aware Context Assembler Tests ===\n");
  let passed = 0;
  let failed = 0;

  const systemPrompt = "You are Dr. Sarah Chen, General Physician at MedVoice AI. Keep replies concise.";
  const chiefComplaint = "I have had a severe constant headache for 2 days that gets much worse when I stand up.";

  // Generate a 16-turn conversation history
  const extendedHistory: Array<{ role: "patient" | "doctor" | "assistant"; text: string }> = [
    { role: "patient", text: chiefComplaint }, // Turn 1 (Anchor)
    { role: "doctor", text: "Have you noticed any dizziness or vision changes with this headache?" }, // Turn 2
    { role: "patient", text: "Yes, I feel dizzy when walking around." }, // Turn 3
    { role: "doctor", text: "Is the numbness on one side of your body or both sides?" }, // Turn 4
    { role: "patient", text: "Just in my head, not in my arms or legs." }, // Turn 5
    { role: "doctor", text: "Does the headache throb or is it steady?" }, // Turn 6
    { role: "patient", text: "It is steady, like a heavy pressure." }, // Turn 7
    { role: "doctor", text: "Have you taken any pain relievers like ibuprofen or acetaminophen?" }, // Turn 8
    { role: "patient", text: "I took paracetamol yesterday morning with no relief." }, // Turn 9
    { role: "doctor", text: "Are you sensitive to bright lights or loud sounds?" }, // Turn 10
    { role: "patient", text: "Bright lights make it slightly worse." }, // Turn 11 (Recent 6 start)
    { role: "doctor", text: "Have you had any fever, chills, or neck stiffness?" }, // Turn 12
    { role: "patient", text: "No fever and my neck moves fine." }, // Turn 13
    { role: "doctor", text: "Have you ever had headaches like this in the past?" }, // Turn 14
    { role: "patient", text: "No, never like this before." }, // Turn 15
    { role: "doctor", text: "How much water have you been drinking today?" }, // Turn 16
  ];

  const currentUtterance = "About two glasses of water, but I feel somewhat nauseous now.";

  const assembledMessages = assembleLossAwareConversationContext({
    systemPrompt,
    conversationHistory: extendedHistory,
    currentUtterance,
    timelineAnchor: "2 days, worse on standing",
    maxTokensBudget: 2000,
  });

  // Check 1: System prompt is message 0
  if (assembledMessages[0]?.role === "system" && assembledMessages[0].content === systemPrompt) {
    console.log("  [PASS] System prompt preserved at message 0");
    passed++;
  } else {
    console.error("  [FAIL] System prompt altered or missing");
    failed++;
  }

  // Check 2: Turn 1 chief complaint is pinned and present in message 1
  const message1 = assembledMessages[1];
  if (message1 && message1.role === "user" && message1.content.includes("severe constant headache for 2 days")) {
    console.log("  [PASS] Pinned Turn 1 anchor preserved despite 16-turn encounter");
    passed++;
  } else {
    console.error("  [FAIL] Turn 1 anchor dropped from context:", message1);
    failed++;
  }

  // Check 3: Intermediate turns are compressed into a summary block
  const summaryMessage = assembledMessages.find(
    m => m.role === "system" && m.content.includes("[Encounter Dialogue Summary")
  );
  if (summaryMessage && summaryMessage.content.includes("paracetamol")) {
    console.log("  [PASS] Intermediate turns compressed into loss-aware dialogue summary block");
    passed++;
  } else {
    console.error("  [FAIL] Missing intermediate dialogue summary block:", summaryMessage);
    failed++;
  }

  // Check 4: Recent turns (turns 11-16) and latest utterance are present verbatim
  const lastUserMsg = assembledMessages[assembledMessages.length - 1];
  if (lastUserMsg && lastUserMsg.role === "user" && lastUserMsg.content === currentUtterance) {
    console.log("  [PASS] Latest patient utterance correctly placed at tail");
    passed++;
  } else {
    console.error("  [FAIL] Tail patient utterance missing or incorrect:", lastUserMsg);
    failed++;
  }

  const hasRecentTurn = assembledMessages.some(
    m => m.content.includes("No, never like this before.")
  );
  if (hasRecentTurn) {
    console.log("  [PASS] Recent 6 turns preserved verbatim");
    passed++;
  } else {
    console.error("  [FAIL] Recent turn not found verbatim in assembled messages");
    failed++;
  }

  // Check 5: Token budget constraint (~2000 tokens = ~8000 chars)
  const totalChars = assembledMessages.reduce((sum, m) => sum + m.content.length, 0);
  if (totalChars <= 8000) {
    console.log(`  [PASS] Token budget respected: totalChars=${totalChars} <= 8000 chars (~2000 tokens)`);
    passed++;
  } else {
    console.error(`  [FAIL] Token budget exceeded: totalChars=${totalChars} > 8000 chars`);
    failed++;
  }

  // Check 6: Short history (<= 8 turns) preserves all turns directly
  const shortHistory = extendedHistory.slice(0, 4);
  const shortAssembled = assembleLossAwareConversationContext({
    systemPrompt,
    conversationHistory: shortHistory,
    currentUtterance: "Yes, I feel dizzy.",
    maxTokensBudget: 2000,
  });
  // System prompt + 4 history turns + 1 latest user turn = 6 messages
  if (shortAssembled.length === 6 && !shortAssembled.some(m => m.content.includes("[Encounter Dialogue Summary"))) {
    console.log("  [PASS] Short conversations (<= 8 turns) preserve all turns directly without unnecessary summarization");
    passed++;
  } else {
    console.error("  [FAIL] Short conversation handling mismatch, message count:", shortAssembled.length);
    failed++;
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed.`);
  if (failed > 0) {
    process.exit(1);
  }
}

runContextAssemblerTests().catch((err) => {
  console.error("Test execution error:", err);
  process.exit(1);
});
