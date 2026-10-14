import assert from "assert";
import { ConversationManager } from "../../lib/triage/conversation-manager";
import { clinicalDecisionEngine } from "../../lib/triage/clinical-decision-engine";
import { evaluatePreArbiter } from "../../lib/triage/pre-arbiter";
import { detectQuestionTargetSlot, isTargetSlotMatch } from "../../lib/triage/clinical-state";

(process.env as Record<string, string | undefined>).NODE_ENV = "test";

async function runQuestionStateAndRepetitionTests() {
  console.log("================================================================================");
  console.log("  MEDVOICE QUESTION-STATE TRACKING & ANTI-REPETITION REGRESSION SUITE          ");
  console.log("================================================================================");

  const cm = new ConversationManager();

  // ---------------------------------------------------------------------------
  // Case A: Repeated Question Prevention
  // ---------------------------------------------------------------------------
  console.log("\n[Case A] Repeated question prevention across consecutive turns");
  {
    let state = cm.createInitialState();
    const turns = [
      "Headache from 2 days",
      "numbness and i feel like i am dizzy too..",
      "just in my head which makes my whole nervous system like that",
      "constantly at normal level.. severe when i stand up and walk after resting for a while",
    ];

    const doctorReplies: string[] = [];
    for (const turn of turns) {
      const res = await cm.processTurn(turn, state);
      state = res.state;
      doctorReplies.push(res.doctorReply);
    }

    // Verify all doctor replies are unique (no verbatim duplicates)
    const uniqueReplies = new Set(doctorReplies);
    assert.strictEqual(
      uniqueReplies.size,
      doctorReplies.length,
      `All consecutive doctor replies must be distinct! Received duplicates: ${JSON.stringify(doctorReplies)}`
    );

    // Verify Turn 3 and Turn 4 are not the verbatim repeated inquiry
    assert.notStrictEqual(
      doctorReplies[2],
      doctorReplies[3],
      "Turn 3 and Turn 4 must not repeat the exact same inquiry!"
    );
    console.log("  ✓ PASS: Zero duplicate question phrasing across turns");
  }

  // ---------------------------------------------------------------------------
  // Case B: Partial Answer to Compound Question
  // ---------------------------------------------------------------------------
  console.log("\n[Case B] Partial answer to compound question properly updates pending question state");
  {
    let state = cm.createInitialState();
    // Turn 1: Onset
    let res = await cm.processTurn("I have a severe headache", state);
    state = res.state;

    // Doctor asks onset pattern / thunderclap inquiry
    assert(
      state.pendingQuestion !== null,
      "Doctor must establish a pending question for headache onset exploration"
    );
    const pqSlot = state.pendingQuestion!.targetSlot;
    assert.strictEqual(pqSlot, "onset_pattern", "Target slot must be onset_pattern");

    // Turn 2: Patient answers only suddenness: "It built up gradually over a couple of days"
    res = await cm.processTurn("It built up gradually over a couple of days", state);
    state = res.state;

    // Verify onset_pattern is confirmed
    assert(
      state.slots.known_facts.some(f => /ONSET_TYPE:\s*gradual|Onset pattern:\s*gradual/i.test(f)),
      "Gradual onset must be recorded in known facts"
    );
    assert(
      state.resolvedQuestions.some(q => q.resolvedSlot === "onset_pattern" || q.resolvedSlot === "onset"),
      "Pending question for onset_pattern must be moved to resolvedQuestions"
    );
    console.log("  ✓ PASS: Compound question partial answer cleanly resolves pending question");
  }

  // ---------------------------------------------------------------------------
  // Case C: Unclear Descriptive Symptom Phrasing
  // ---------------------------------------------------------------------------
  console.log("\n[Case C] Unclear descriptive symptom phrasing resolves distribution/laterality");
  {
    let state = cm.createInitialState();
    await cm.processTurn("I have had a headache for 2 days", state);
    const res2 = await cm.processTurn("numbness and i feel like i am dizzy too..", state);
    state = res2.state;

    // Doctor asks about numbness distribution
    assert(
      state.pendingQuestion !== null,
      "Doctor must set a pending question for numbness distribution"
    );
    assert(
      isTargetSlotMatch("numbness_distribution", state.pendingQuestion!.targetSlot) ||
      isTargetSlotMatch("laterality", state.pendingQuestion!.targetSlot),
      `Expected numbness_distribution or laterality, got ${state.pendingQuestion!.targetSlot}`
    );

    // Patient responds with non-focal head description
    const res3 = await cm.processTurn(
      "just in my head which makes my whole nervous system like that",
      state
    );
    state = res3.state;

    // Verify distribution is extracted as non-focal cranial, NOT dropped as unrelated
    assert(
      state.slots.known_facts.some(f => /head only|non-focal|DISTRIBUTION/i.test(f)),
      "Must record cranial non-focal distribution in known facts"
    );
    assert.strictEqual(
      (state.slots as any).laterality,
      "head only (non-focal)",
      "Laterality slot must be updated with non-focal head distribution"
    );
    console.log("  ✓ PASS: Descriptive phrasing correctly captured as non-focal distribution");
  }

  // ---------------------------------------------------------------------------
  // Case D: New Info Changing Risk / Postural Exacerbation
  // ---------------------------------------------------------------------------
  console.log("\n[Case D] Postural exacerbation updates severity and clinical risk");
  {
    let state = cm.createInitialState();
    await cm.processTurn("Headache from 2 days", state);
    await cm.processTurn("numbness and i feel like i am dizzy too..", state);
    await cm.processTurn("just in my head which makes my whole nervous system like that", state);

    // Patient describes postural worsening:
    const res4 = await cm.processTurn(
      "constantly at normal level.. severe when i stand up and walk after resting for a while",
      state
    );
    state = res4.state;

    // Verify orthostatic worsening / timing pattern is captured
    assert(
      state.slots.known_facts.some(f => /TIMING_PATTERN|severe upon standing|standing\/walking/i.test(f)),
      "Postural exacerbation must be recorded in known facts"
    );
    assert(
      state.conversationMemory!.questionsAlreadyAsked.includes("timing_pattern") ||
      state.conversationMemory!.questionsAlreadyAsked.includes("severity_pattern"),
      "timing_pattern or severity_pattern must be recorded in questionsAlreadyAsked"
    );

    // Verify the doctor does NOT hallucinate weakness or ask a redundant severity question
    assert(
      !res4.doctorReply.includes("When that weakness and numbness happens"),
      "Doctor must not ask about weakness when only numbness and postural headache was reported"
    );
    console.log("  ✓ PASS: Postural exacerbation captured without redundant severity looping");
  }

  // ---------------------------------------------------------------------------
  // Case E: Answered vs Denied Symptoms
  // ---------------------------------------------------------------------------
  console.log("\n[Case E] Answered vs denied symptoms recorded and never re-asked");
  {
    let state = cm.createInitialState();
    await cm.processTurn("I have had a sore throat for three days", state);

    // Patient explicitly denies fever and neck stiffness
    const res = await cm.processTurn("no fever at all, and no neck stiffness", state);
    state = res.state;

    // Verify denial recorded in conversation memory
    assert(
      state.conversationMemory!.deniedSymptoms.includes("fever") ||
      state.slots.known_facts.some(f => /denied:.*fever/i.test(f)),
      "Fever denial must be recorded in memory or known facts"
    );
    assert(
      state.conversationMemory!.questionsAlreadyAsked.includes("fever"),
      "fever must be added to questionsAlreadyAsked"
    );

    // Follow-up turn must not ask about fever
    const nextTurn = await cm.processTurn("it hurts when I swallow my coffee", state);
    assert(
      !nextTurn.doctorReply.toLowerCase().includes("fever"),
      "Doctor must not ask about fever after explicit denial"
    );
    console.log("  ✓ PASS: Denied symptoms recorded and never re-asked");
  }

  // ---------------------------------------------------------------------------
  // Case F: Paraphrased Repetition Detection by Anti-Repetition Shield
  // ---------------------------------------------------------------------------
  console.log("\n[Case F] Anti-Repetition Shield detects paraphrased repetition");
  {
    const candReply = "How would you describe the feeling—is it a dull ache, sharp pain, or throbbing, and is it constant or does it come and go?";
    const recentReplies = [
      "Could you tell me how the feeling is—is it a dull ache, sharp pain, or throbbing, and is it constant or coming and going?"
    ];

    const shielded = clinicalDecisionEngine.guardAgainstRepetition(
      candReply,
      recentReplies,
      "general severity inquiry"
    );

    assert.notStrictEqual(
      shielded,
      candReply,
      "Anti-Repetition Shield must reformulate when candidate matches recent replies"
    );
    assert(
      !shielded.includes("dull ache, sharp pain, or throbbing"),
      "Shielded reply must shift conversational angle away from the duplicate phrasing"
    );
    console.log("  ✓ PASS: Anti-Repetition Shield reformulates high-similarity replies");
  }

  // ---------------------------------------------------------------------------
  // Case G: Emergency Overrides Normal Question Flow
  // ---------------------------------------------------------------------------
  console.log("\n[Case G] Emergency red flags preempt normal question flow");
  {
    let state = cm.createInitialState();
    await cm.processTurn("I have a headache", state);

    // Turn 2: Patient reports sudden facial droop
    const res = await cm.processTurn("My face is suddenly drooping on the right and my arm went limp", state);
    state = res.state;

    assert.strictEqual(
      state.informationState,
      "emergency_preempted",
      "Information state must be emergency_preempted"
    );
    assert.strictEqual(
      res.action,
      "EMERGENCY_CONVENE_BOARD",
      "Action must be EMERGENCY_CONVENE_BOARD"
    );
    assert(
      state.pendingQuestion === null || state.pendingQuestion.status === "superseded",
      "Pending non-emergency question must be cleared or marked superseded"
    );
    console.log("  ✓ PASS: Emergency red flag preempts interview questions");
  }

  // ---------------------------------------------------------------------------
  // Case H: Full-Route Continuity & Monotonic State Progression
  // ---------------------------------------------------------------------------
  console.log("\n[Case H] Full-route continuity preserves question state and history");
  {
    let state = cm.createInitialState();
    const turns = [
      "Headache from 2 days",
      "numbness and i feel like i am dizzy too..",
      "just in my head which makes my whole nervous system like that",
      "constantly at normal level.. severe when i stand up and walk after resting for a while",
      "no vision changes, but bright lights bother me a bit"
    ];

    for (let i = 0; i < turns.length; i++) {
      const res = await cm.processTurn(turns[i], state);
      state = res.state;

      // Verify structuredHistory recentDoctorReplies is maintained
      assert(
        state.structuredHistory?.recentDoctorReplies,
        `recentDoctorReplies must exist on Turn ${i + 1}`
      );
      assert(
        state.structuredHistory.recentDoctorReplies.length > 0,
        `recentDoctorReplies must not be empty on Turn ${i + 1}`
      );

      // Verify questionsAlreadyAsked accumulates
      assert(
        state.conversationMemory!.questionsAlreadyAsked.length >= i,
        `questionsAlreadyAsked must accumulate across Turn ${i + 1}`
      );
    }

    // Verify final state has chief complaint and associated symptoms without hallucinated weakness
    assert(
      !state.slots.neurological_signs.includes("transient weakness and numbness"),
      "State must NEVER contain hallucinated 'transient weakness and numbness'"
    );
    assert(
      state.slots.neurological_signs.includes("numbness"),
      "State must contain genuinely reported numbness"
    );
    console.log("  ✓ PASS: Multi-turn consultation maintains consistent, non-duplicative state");
  }

  console.log("\n================================================================================");
  console.log("  ALL 8 QUESTION-STATE & ANTI-REPETITION REGRESSION CASES PASSED (100%)         ");
  console.log("================================================================================\n");
}

runQuestionStateAndRepetitionTests().catch(err => {
  console.error("Test failure:", err);
  process.exit(1);
});
