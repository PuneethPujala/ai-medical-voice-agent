import { conversationManager } from "../lib/triage/conversation-manager";
import { evidenceExtractor } from "../lib/triage/evidence-extractor";
import { createInitialInterviewStateV2 } from "../lib/triage/clinical-state";

async function main() {
  console.log("===============================================================================");
  console.log("   TESTING MULTI-CLAUSE CLINICAL STATE & EVIDENCE PIPELINE");
  console.log("===============================================================================\n");

  // --- PART 1: Evidence Extractor Verification ---
  console.log("--- PART 1: Evidence Extractor ---");
  const v2 = createInitialInterviewStateV2();
  const ext1 = evidenceExtractor.extract("I have had a bad sore throat for two days.", v2);
  console.log("Turn 1 Extracted Facts:", ext1.newFacts.map(f => `${f.name}: ${f.normalizedText || f.value}`));

  const ext2 = evidenceExtractor.extract(
    "It hurts when I swallow saliva. No fever. Pain is about 6 out of 10.",
    v2,
    "Could you tell me when this began, and whether it started suddenly or built up gradually?",
    "course"
  );
  console.log("Turn 2 Extracted Facts:", ext2.newFacts.map(f => `${f.name}: ${f.normalizedText || f.value}`));
  console.log("Turn 2 Denied Topics:", ext2.deniedTopics);

  const hasOdynophagia = ext2.newFacts.some(f => f.name === "painful_swallowing" && f.status === "present");
  const hasDysphagia = ext2.newFacts.some(f => f.name === "swallowing_difficulty");
  const hasFeverDenied = ext2.deniedTopics.includes("fever") || ext2.newFacts.some(f => f.name === "fever" && f.status === "absent");
  const sevVal = ext2.symptomProfileUpdates.severity?.value;
  const hasSeverity = sevVal === 6 || (typeof sevVal === "object" && sevVal?.baseline === 6) || ext2.symptomProfileUpdates.severity?.normalizedText === "6/10";

  console.log(`- Odynophagia detected present: ${hasOdynophagia ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`- Dysphagia NOT falsely marked: ${!hasDysphagia ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`- Fever denied: ${hasFeverDenied ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`- Severity 6/10 extracted: ${hasSeverity ? "✅ PASS" : "❌ FAIL"}`);

  if (!hasOdynophagia || hasDysphagia || !hasFeverDenied || !hasSeverity) {
    console.error("❌ Part 1 Failed");
    process.exit(1);
  }

  // --- PART 2: Conversation Manager Turn Execution ---
  console.log("\n--- PART 2: Conversation Manager 2-Turn Flow ---");
  const state1 = conversationManager.createInitialState();
  const res1 = await conversationManager.processTurn("I have had a bad sore throat for two days.", state1);
  console.log("Doctor Turn 1 Reply:", res1.doctorReply);
  console.log("Pending Question after Turn 1:", res1.state.pendingQuestion?.targetSlot);

  const res2 = await conversationManager.processTurn(
    "It hurts when I swallow saliva. No fever. Pain is about 6 out of 10.",
    res1.state
  );
  console.log("\nDoctor Turn 2 Reply:", res2.doctorReply);
  console.log("Turn 2 Slots Severity:", res2.state.slots.severity);
  console.log("Turn 2 Known Facts:", res2.state.slots.known_facts);
  console.log("Turn 2 Denied Symptoms:", res2.state.conversationMemory?.deniedSymptoms);

  const cmSeverityOk = res2.state.slots.severity === "6/10";
  const cmFeverDeniedOk = res2.state.conversationMemory?.deniedSymptoms.includes("fever") ||
    res2.state.slots.known_facts.some(f => /denied:\s*fever/i.test(f));
  const cmOdynoOk = res2.state.slots.known_facts.some(f => /odynophagia/i.test(f));
  const cmContextAwareOk = /painful|swallow liquids|keep them down/i.test(res2.doctorReply);
  const cmNoDysphagiaDenial = !res2.state.conversationMemory?.deniedSymptoms.includes("swallowing_difficulty");

  console.log(`- Severity recorded as 6/10: ${cmSeverityOk ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`- Fever recorded as denied: ${cmFeverDeniedOk ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`- Odynophagia recorded: ${cmOdynoOk ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`- Dysphagia NOT falsely denied: ${cmNoDysphagiaDenial ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`- Doctor reply is context-aware: ${cmContextAwareOk ? "✅ PASS" : "❌ FAIL"}`);

  if (!cmSeverityOk || !cmFeverDeniedOk || !cmOdynoOk || !cmNoDysphagiaDenial || !cmContextAwareOk) {
    console.error("❌ Part 2 Failed");
    process.exit(1);
  }

  // --- PART 3: Live API Route Call ---
  console.log("\n--- PART 3: Live API Endpoint (/api/voice/chat) ---");
  try {
    const apiRes1 = await fetch("http://localhost:3000/api/voice/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "I have had a bad sore throat for two days.",
        conversationHistory: [],
      })
    });
    const data1 = await apiRes1.json();
    console.log("API Turn 1 Missing Dims:", data1.board.missing_dimensions);

    const apiRes2 = await fetch("http://localhost:3000/api/voice/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "It hurts when I swallow saliva. No fever. Pain is about 6 out of 10.",
        interviewState: data1.interviewState,
        conversationHistory: [
          { role: "user", content: "I have had a bad sore throat for two days." },
          { role: "assistant", content: data1.doctorReply },
        ],
      })
    });
    const data2 = await apiRes2.json();
    console.log("\nAPI Turn 2 Doctor Reply:", data2.doctorReply);
    console.log("API Turn 2 Missing Dims:", data2.board.missing_dimensions);
    console.log("API Turn 2 Known Facts:", data2.board.known_facts);

    const missingFever = data2.board.missing_dimensions.includes("Fever / chills");
    const missingSeverity = data2.board.missing_dimensions.includes("Pain severity (0-10)");
    const missingDysphagia = data2.board.missing_dimensions.includes("Difficulty swallowing (saliva/fluids)");

    console.log(`- 'Fever / chills' removed from missing dims: ${!missingFever ? "✅ PASS" : "❌ FAIL"}`);
    console.log(`- 'Pain severity (0-10)' removed from missing dims: ${!missingSeverity ? "✅ PASS" : "❌ FAIL"}`);
    console.log(`- 'Difficulty swallowing (saliva/fluids)' retained until fluid intake confirmed: ${missingDysphagia ? "✅ PASS" : "❌ FAIL"}`);

    if (missingFever || missingSeverity || !missingDysphagia) {
      console.error("❌ Part 3 Failed");
      process.exit(1);
    }

    console.log("\n===============================================================================");
    console.log("   ✅ ALL CLINICAL EVIDENCE EXTRACTION & INTAKE TESTS PASSED!");
    console.log("===============================================================================\n");
  } catch (err) {
    console.warn("API check encountered error:", err);
  }
}

main().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
