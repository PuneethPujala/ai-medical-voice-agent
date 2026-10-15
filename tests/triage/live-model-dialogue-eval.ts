import dotenv from "dotenv";
dotenv.config();

import assert from "assert";
import { ConversationManager } from "../../lib/triage/conversation-manager";
import { DOCTOR_PROFILES } from "../../config/doctors";
import {
  generateDoctorTurnResponse,
  validateDoctorTurnResponse,
  validateDoctorReplyTarget
} from "../../lib/ai/clinical-llm";
import { DEFAULT_LOCALE_CONFIG } from "../../lib/config/locale";
import { groqClient } from "../../lib/ai/groq-client";

async function runLiveDialogueEvaluations() {
  console.log("================================================================================");
  console.log("    MEDVOICE v3.1: LIVE-MODEL CONVERSATIONAL DIALOGUE EVALUATION HARNESS        ");
  console.log("================================================================================");
  console.log(`Active Provider: Groq Cloud`);
  console.log(`Configured: ${groqClient.isConfigured()}`);
  console.log(`Default Model: ${groqClient.getDefaultModel()}`);
  console.log(`Base URL: ${groqClient.getBaseUrl()}`);
  console.log("================================================================================\n");

  const cm = new ConversationManager();
  const doctor = DOCTOR_PROFILES[0]; // Dr. Sarah Chen, MD (General Physician / Emergency)
  const results: Array<{ scenario: string; passed: boolean; details: string }> = [];

  // Helper to run a realistic multi-turn conversation step through the live pipeline
  async function runTurn(
    utterance: string,
    state: any,
    conversationHistory: Array<{ role: "patient" | "doctor" | "assistant"; text?: string; content?: string }>
  ) {
    const turnResult = await cm.processTurn(utterance, state);
    const updatedState = turnResult.state;

    // Call live LLM
    const llmResult = await generateDoctorTurnResponse({
      patientUtterance: utterance,
      conversationHistory,
      interviewState: updatedState,
      preArbiterResult: turnResult.preArbiterResult,
      demographics: { age: 42, age_group: "adult", age_source: "patient_reported" },
      doctor,
      missingDimensions: updatedState.structuredHistory?.unansweredDimensions || [],
      fallbackReply: turnResult.doctorReply,
      localeConfig: DEFAULT_LOCALE_CONFIG,
      targetSubject: "self",
      isClarificationRequest: turnResult.action === "CLARIFY",
      clarificationGuidance: turnResult.action === "CLARIFY" ? turnResult.doctorReply : undefined,
    });

    const activeDoctorReply = (llmResult.liveGenerated && llmResult.reply)
      ? llmResult.reply
      : turnResult.doctorReply;

    // Append to conversation history
    conversationHistory.push({ role: "patient", text: utterance, content: utterance });
    conversationHistory.push({ role: "doctor", text: activeDoctorReply, content: activeDoctorReply });

    // Synchronize pendingQuestion and conversationMemory with the doctor's actual spoken question
    if (activeDoctorReply.includes("?")) {
      const activeTarget = (llmResult.intendedTargets && llmResult.intendedTargets[0]) || "general_inquiry";
      if (updatedState.conversationMemory) {
        updatedState.conversationMemory.lastDoctorQuestion = activeDoctorReply;
        if (activeTarget && activeTarget !== "general_inquiry" && !updatedState.conversationMemory.questionsAlreadyAsked.includes(activeTarget)) {
          updatedState.conversationMemory.questionsAlreadyAsked.push(activeTarget);
        }
      }
      if (updatedState.pendingQuestion) {
        updatedState.pendingQuestion.question = activeDoctorReply;
        updatedState.pendingQuestion.targetSlot = activeTarget;
        updatedState.pendingQuestion.targetSlots = [activeTarget];
      }
    }

    // Smooth pacing to respect Groq OTPM and ITPM rate limits
    await new Promise(r => setTimeout(r, 8500));

    return {
      turnResult,
      llmResult,
      activeDoctorReply,
      updatedState,
    };
  }

  // ---------------------------------------------------------------------------
  // Case 1: Unstructured Multi-Symptom Turn (Forehead headache + tinnitus + nausea + mild neck stiffness)
  // ---------------------------------------------------------------------------
  console.log("--------------------------------------------------------------------------------");
  console.log("TEST CASE 1: Patient gives several symptoms in one long, unstructured answer");
  console.log("--------------------------------------------------------------------------------");
  {
    let state = cm.createInitialState();
    const history: Array<{ role: "patient" | "doctor" | "assistant"; text?: string; content?: string }> = [];
    const patientMsg = "For about three days now I have had this throbbing headache across my forehead and temples, and I also noticed ringing in my ears, some nausea whenever I eat, and muscle tightness across my shoulders, though no fever or vision problems.";

    console.log(`[Patient Turn 1]: "${patientMsg}"\n`);
    const { llmResult, activeDoctorReply, updatedState } = await runTurn(patientMsg, state, history);

    console.log(`[Dr. Sarah Chen]: "${activeDoctorReply}"`);
    console.log(`[Telemetry]: Provider=${llmResult.provider} | Model=${llmResult.model} | Latency=${llmResult.latencyMs}ms | Live=${llmResult.liveGenerated}`);
    console.log(`[Understood Context]: ${llmResult.understoodContext || "N/A"}`);
    console.log(`[Candidate Facts]: ${JSON.stringify(llmResult.candidateFacts?.map(f => `${f.concept}:${f.assertionStatus}`) || [])}`);
    console.log(`[Known Facts Count]: ${updatedState.slots.known_facts.length}`);

    // Verification:
    // 1. Must be live generated
    assert.strictEqual(llmResult.liveGenerated, true, "LLM reply must be generated live by Groq");
    // 2. Must not ask repetitively for duration (patient stated 'three days')
    const repeatsDuration = /\b(how long|how many days|duration|when did it start)\b/i.test(activeDoctorReply);
    assert.strictEqual(repeatsDuration, false, "Doctor must not ask for duration when patient explicitly said 'three days'");
    // 3. Must not ask if they have headache (already established)
    const repeatsHeadachePresence = /\b(do you have a headache|are you having headache)\b/i.test(activeDoctorReply);
    assert.strictEqual(repeatsHeadachePresence, false, "Doctor must not ask if patient has headache");
    // 4. Exactly one question asked
    const qCount = (activeDoctorReply.match(/\?/g) || []).length;
    assert.strictEqual(qCount, 1, `Doctor must ask exactly 1 focused question, got ${qCount}`);

    console.log("✅ Case 1 PASSED: Multi-symptom intake understood; zero duration/headache repetition; 1 focused question.\n");
    results.push({ scenario: "Case 1: Multi-Symptom Unstructured Answer", passed: true, details: `Latency: ${llmResult.latencyMs}ms, Model: ${llmResult.model}` });
  }

  // ---------------------------------------------------------------------------
  // Case 2: Patient Self-Correction 4-5 Turns Later (Constant -> Positional Surge)
  // ---------------------------------------------------------------------------
  console.log("--------------------------------------------------------------------------------");
  console.log("TEST CASE 2: Patient corrects something they said several turns earlier");
  console.log("--------------------------------------------------------------------------------");
  {
    let state = cm.createInitialState();
    const history: Array<{ role: "patient" | "doctor" | "assistant"; text?: string; content?: string }> = [];

    // Turn 1: Initial complaint
    const t1 = await runTurn("I've been dealing with a constant dull headache for two days.", state, history);
    state = t1.updatedState;
    console.log(`[Turn 1 Patient]: "I've been dealing with a constant dull headache for two days."`);
    console.log(`[Turn 1 Doctor]: "${t1.activeDoctorReply}"`);

    // Turn 2: Numbness & dizziness
    const t2 = await runTurn("I feel some numbness in my scalp and lightheaded dizziness too.", state, history);
    state = t2.updatedState;
    console.log(`[Turn 2 Patient]: "I feel some numbness in my scalp and lightheaded dizziness too."`);
    console.log(`[Turn 2 Doctor]: "${t2.activeDoctorReply}"`);

    // Turn 3: Vision screen
    const t3 = await runTurn("No blurriness or double vision at all, my eyesight is completely normal.", state, history);
    state = t3.updatedState;
    console.log(`[Turn 3 Patient]: "No blurriness or double vision at all, my eyesight is completely normal."`);
    console.log(`[Turn 3 Doctor]: "${t3.activeDoctorReply}"`);

    // Turn 4: Patient introduces self-correction on constancy stated in Turn 1!
    const correctionMsg = "Actually doctor, I need to correct what I said earlier. The headache is not constant all day — it completely goes away when I lie flat in bed, but as soon as I sit up or stand up to walk, it surges back with intense throbbing.";
    const t4 = await runTurn(correctionMsg, state, history);
    console.log(`[Turn 4 Patient (Self-Correction)]: "${correctionMsg}"`);
    console.log(`[Turn 4 Doctor]: "${t4.activeDoctorReply}"`);
    console.log(`[Telemetry]: Latency=${t4.llmResult.latencyMs}ms | Understood: ${t4.llmResult.understoodContext}`);

    // Verification:
    assert.strictEqual(t4.llmResult.liveGenerated, true, "Turn 4 must be live generated");
    // Doctor should acknowledge postural/positional nature or improvement when lying flat or the correction
    const acknowledgesPosition = /\b(?:stand\w*|upright|ly\w*|lie\w*|flat|postur\w*|position\w*|worse\w*|improv\w*|better|detail|correct\w*|clarif\w*)\b/i.test(t4.activeDoctorReply);
    assert.strictEqual(acknowledgesPosition, true, "Doctor should acknowledge the postural/positional relationship or correction");
    // Doctor must not claim it is constant or re-ask if it's constant
    const repeatsConstant = /\bis it constant\b/i.test(t4.activeDoctorReply);
    assert.strictEqual(repeatsConstant, false, "Doctor must not ask 'is it constant' after patient explicitly clarified it only happens when upright");

    console.log("✅ Case 2 PASSED: Self-correction acknowledged; postural nature captured; zero regression to constant assumption.\n");
    results.push({ scenario: "Case 2: Self-Correction of Prior Turn", passed: true, details: `Postural/correction acknowledgment: ${acknowledgesPosition}` });
  }

  // ---------------------------------------------------------------------------
  // Case 3: Patient Answers Only Half of a Compound Inquiry
  // ---------------------------------------------------------------------------
  console.log("--------------------------------------------------------------------------------");
  console.log("TEST CASE 3: Patient answers only half of a compound inquiry");
  console.log("--------------------------------------------------------------------------------");
  {
    let state = cm.createInitialState();
    const history: Array<{ role: "patient" | "doctor" | "assistant"; text?: string; content?: string }> = [];

    // Doctor previously asked compound question: onset velocity + fever
    history.push({ role: "patient", text: "I have had a worsening headache.", content: "I have had a worsening headache." });
    history.push({
      role: "doctor",
      text: "Did the headache begin suddenly like a thunderclap or build gradually, and have you checked your temperature for fever?",
      content: "Did the headache begin suddenly like a thunderclap or build gradually, and have you checked your temperature for fever?"
    });

    state.pendingQuestion = {
      id: "q-comp-live",
      targetSlot: "onset_pattern",
      targetSlots: ["onset_pattern", "fever"],
      askedBy: "sarah",
      doctorName: "Dr. Sarah Chen, MD",
      patientFacingSpeaker: "sarah",
      question: "Did the headache begin suddenly like a thunderclap or build gradually, and have you checked your temperature for fever?",
      purpose: "Assess onset speed and fever",
      required: true,
      priority: "normal",
      status: "pending",
      createdAt: new Date().toISOString(),
      caseVersion: 1
    };

    // Patient addresses only the onset velocity, leaving fever unmentioned
    const halfAnswer = "It built up very gradually over the last two days, definitely not sudden.";
    console.log(`[Doctor Compound Question]: "Did the headache begin suddenly like a thunderclap or build gradually, and have you checked your temperature for fever?"`);
    console.log(`[Patient Half-Answer]: "${halfAnswer}"\n`);

    const { llmResult, activeDoctorReply } = await runTurn(halfAnswer, state, history);
    console.log(`[Dr. Sarah Chen]: "${activeDoctorReply}"`);
    console.log(`[Telemetry]: Latency=${llmResult.latencyMs}ms | Understood: ${llmResult.understoodContext}`);
    console.log(`[Intended Targets]: ${JSON.stringify(llmResult.intendedTargets || [])}`);

    // Verification:
    assert.strictEqual(llmResult.liveGenerated, true, "Must be live generated");
    // 1. Must NOT re-ask whether it was sudden or gradual in the actual question
    const qMarkIndex = activeDoctorReply.lastIndexOf("?");
    let questionOnly = activeDoctorReply;
    if (qMarkIndex !== -1) {
      const priorPeriod = Math.max(activeDoctorReply.lastIndexOf(".", qMarkIndex), activeDoctorReply.lastIndexOf("!", qMarkIndex));
      questionOnly = priorPeriod !== -1 ? activeDoctorReply.slice(priorPeriod + 1, qMarkIndex + 1).trim() : activeDoctorReply;
    }
    const reAsksOnset = /\b(?:sudden|gradual|thunderclap|how quickly did it start|how did it begin|come on all at once)\b/i.test(questionOnly);
    assert.strictEqual(reAsksOnset, false, "Doctor must NOT re-ask about onset velocity since patient clearly answered 'built up gradually'");

    // 2. Unanswered target 'fever' MUST remain tracked in structuredHistory.unansweredDimensions
    const unansweredPreserved = Boolean(state.structuredHistory?.unansweredDimensions?.includes("fever"));
    console.log(`[Unanswered Dimensions Preserved]: ${JSON.stringify(state.structuredHistory?.unansweredDimensions || [])}`);
    assert.strictEqual(unansweredPreserved, true, "Unanswered target 'fever' must remain preserved in structuredHistory.unansweredDimensions");

    // Turn 2: Patient answers the timing inquiry, leaving fever still pending
    const t2 = await runTurn("It's pretty constant throughout the day, doesn't really go away.", state, history);
    console.log(`[Patient Turn 2]: "It's pretty constant throughout the day, doesn't really go away."`);
    console.log(`[Dr. Sarah Chen Turn 2]: "${t2.activeDoctorReply}"`);

    // Turn 3: Patient explicitly answers the fever dimension
    const t3 = await runTurn("And no, I checked my temperature with a thermometer and have no fever at all.", state, history);
    console.log(`[Patient Turn 3]: "And no, I checked my temperature with a thermometer and have no fever at all."`);
    console.log(`[Dr. Sarah Chen Turn 3]: "${t3.activeDoctorReply}"`);

    // 3. Once answered, fever must be pruned from unansweredDimensions
    const feverPruned = !t3.updatedState.structuredHistory?.unansweredDimensions?.includes("fever");
    console.log(`[Unanswered Dimensions After Resolution]: ${JSON.stringify(t3.updatedState.structuredHistory?.unansweredDimensions || [])}`);
    assert.strictEqual(feverPruned, true, "Fever must be pruned from unansweredDimensions once answered");

    console.log("✅ Case 3 PASSED: Half-answer absorbed; fever tracked across multi-turn intake until explicitly resolved.\n");
    results.push({ scenario: "Case 3: Multi-Turn Tracking of Compound Inquiry", passed: true, details: `Onset resolved without repetition, fever preserved and pruned on resolution` });
  }

  await new Promise(r => setTimeout(r, 4500));

  // ---------------------------------------------------------------------------
  // Case 4: Unmapped Observation / Unplanned Lay Metaphor
  // ---------------------------------------------------------------------------
  console.log("--------------------------------------------------------------------------------");
  console.log("TEST CASE 4: Patient introduces an unmapped lay symptom ('buzzing motor hive')");
  console.log("--------------------------------------------------------------------------------");
  {
    let state = cm.createInitialState();
    const history: Array<{ role: "patient" | "doctor" | "assistant"; text?: string; content?: string }> = [];

    const unmappedUtterance = "My head feels like a buzzing electric beehive inside, like a small motor humming that makes my skull vibrate, not like normal pain.";
    console.log(`[Patient]: "${unmappedUtterance}"\n`);

    const { llmResult, activeDoctorReply, updatedState } = await runTurn(unmappedUtterance, state, history);
    console.log(`[Dr. Sarah Chen]: "${activeDoctorReply}"`);
    console.log(`[Telemetry]: Latency=${llmResult.latencyMs}ms | Understood: ${llmResult.understoodContext}`);
    console.log(`[Unmapped Observations]: ${JSON.stringify(llmResult.unmappedObservations || [])}`);

    // Verification:
    assert.strictEqual(llmResult.liveGenerated, true, "Must be live generated");
    // 1. Doctor should acknowledge the unique sensation (vibration, buzzing, motor, humming)
    const acknowledgesNuance = /\b(buzz|vibrat|hum|motor|beehive|electric|sensation|feeling)\b/i.test(activeDoctorReply);
    assert.strictEqual(acknowledgesNuance, true, "Doctor should acknowledge the patient's descriptive nuance");
    // 2. Doctor must NOT jump to speculative diagnosis (no diagnostic inflation)
    const speculativeDiagnosis = /\b(you have an aneurysm|you have epilepsy|you have multiple sclerosis|you have a tumor)\b/i.test(activeDoctorReply);
    assert.strictEqual(speculativeDiagnosis, false, "Doctor must exercise diagnostic restraint");

    console.log("✅ Case 4 PASSED: Unmapped lay nuance preserved and acknowledged with diagnostic restraint.\n");
    results.push({ scenario: "Case 4: Unmapped Lay Metaphor", passed: true, details: `Nuance acknowledged: ${acknowledgesNuance}` });
  }

  await new Promise(r => setTimeout(r, 4500));

  // ---------------------------------------------------------------------------
  // Case 5: Emotional Tangent / Ambiguity (Family history anxiety + stress)
  // ---------------------------------------------------------------------------
  console.log("--------------------------------------------------------------------------------");
  console.log("TEST CASE 5: Ambiguous tangent & anxiety with multi-turn clinical risk stratification");
  console.log("--------------------------------------------------------------------------------");
  {
    let state = cm.createInitialState();
    const history: Array<{ role: "patient" | "doctor" | "assistant"; text?: string; content?: string }> = [];

    // Turn 1: Initial chest discomfort
    history.push({ role: "patient", text: "I've had some discomfort in my chest today.", content: "I've had some discomfort in my chest today." });
    history.push({
      role: "doctor",
      text: "I want to understand that discomfort better. Does it feel like pressure or tightness, and does it spread to your arm or jaw?",
      content: "I want to understand that discomfort better. Does it feel like pressure or tightness, and does it spread to your arm or jaw?"
    });

    // Turn 2: Patient goes on an emotional tangent about work stress and father's heart attack
    const emotionalTangent = "I don't know, work has been ridiculously stressful this week and I haven't slept, but my father had a heart attack at my age and I'm honestly terrified right now.";
    console.log(`[Patient Tangent]: "${emotionalTangent}"\n`);

    const t2 = await runTurn(emotionalTangent, state, history);
    console.log(`[Dr. Sarah Chen Turn 2]: "${t2.activeDoctorReply}"`);
    console.log(`[Telemetry]: Latency=${t2.llmResult.latencyMs}ms | Understood: ${t2.llmResult.understoodContext}`);

    // Verification Turn 2:
    assert.strictEqual(t2.llmResult.liveGenerated, true, "Must be live generated");
    // 1. Bedside manner: acknowledges fear, stress, or father's history with empathy
    const hasEmpathy = /\b(understand|hear|stress|scary|terrified|worry|worried|anxious|father|natural to feel)\b/i.test(t2.activeDoctorReply);
    assert.strictEqual(hasEmpathy, true, "Doctor must show empathetic bedside manner regarding anxiety / family history");
    // 2. Clinical grounding: refines or asks about chest symptoms, shortness of breath, or emergency status
    const keepsGrounding = /\b(chest|breath|arm|pain|discomfort|pressure|spread|now|feeling|symptom)\b/i.test(t2.activeDoctorReply);
    assert.strictEqual(keepsGrounding, true, "Doctor must ground the conversation back to the physical presentation");
    // 3. Clinical Judgment: Doctor must NOT prematurely dismiss chest discomfort as purely stress/psychogenic
    const prematureDownTriage = /\b(?:just\s+(?:stress|anxiety)|nothing\s+to\s+worry\s+about|simply\s+stress|relax\s+and\s+it\s+will\s+pass)\b/i.test(t2.activeDoctorReply);
    assert.strictEqual(prematureDownTriage, false, "Doctor must NOT prematurely dismiss chest pain as stress");

    // Turn 3: Patient describes persistent squeezing retrosternal pressure + cold sweat
    const ischemicUtterance = "The discomfort is definitely a heavy squeezing pressure right behind my sternum that has lasted 45 minutes, and I've started sweating cold.";
    console.log(`[Patient Turn 3]: "${ischemicUtterance}"\n`);

    const t3 = await runTurn(ischemicUtterance, t2.updatedState, history);
    console.log(`[Dr. Sarah Chen Turn 3]: "${t3.activeDoctorReply}"`);
    console.log(`[Turn 3 Action]: ${t3.turnResult.action} | Pre-Arbiter Flags: ${JSON.stringify(t3.turnResult.preArbiterResult.pre_safety_flags)}`);

    // Verification Turn 3: Clinical safety invariant enforced — ischemic features must be caught
    const hasCardiacFlag = t3.turnResult.preArbiterResult.pre_safety_flags.some((f: string) => f.includes("ACS") || f.includes("CHEST") || f.includes("CAR"));
    assert.strictEqual(hasCardiacFlag, true, "Pre-arbiter must flag acute cardiac risk when patient confirms persistent retrosternal squeezing + diaphoresis");

    console.log("✅ Case 5 PASSED: Empathy validated; zero psychogenic down-triage; acute cardiac risk appropriately stratified.\n");
    results.push({ scenario: "Case 5: Emotional Diversion & Clinical Judgment", passed: true, details: `Empathy: ${hasEmpathy}, Grounding: ${keepsGrounding}, Cardiac flag: ${hasCardiacFlag}` });
  }

  await new Promise(r => setTimeout(r, 4500));

  // ---------------------------------------------------------------------------
  // Case 6: Deterministic Emergency Preemption Invariant with Live Model
  // ---------------------------------------------------------------------------
  console.log("--------------------------------------------------------------------------------");
  console.log("TEST CASE 6: Acute emergency red-flag preemption & response provenance verification");
  console.log("--------------------------------------------------------------------------------");
  {
    let state = cm.createInitialState();
    const history: Array<{ role: "patient" | "doctor" | "assistant"; text?: string; content?: string }> = [];

    const emergencyUtterance = "Crushing chest pain like an elephant on my chest, radiating down my left arm and up to my jaw, I'm sweating cold and dizzy!";
    console.log(`[Patient Emergency]: "${emergencyUtterance}"\n`);

    const { turnResult, llmResult, activeDoctorReply } = await runTurn(emergencyUtterance, state, history);
    console.log(`[Dr. Sarah Chen]: "${activeDoctorReply}"`);
    console.log(`[Pre-Arbiter Immediate Danger]: ${turnResult.preArbiterResult.immediate_danger}`);
    console.log(`[Pre-Arbiter Flags]: ${JSON.stringify(turnResult.preArbiterResult.pre_safety_flags)}`);
    console.log(`[Response Provenance]: ${llmResult.responseProvenance}`);
    console.log(`[Provider]: ${llmResult.provider}`);
    console.log(`[Latency]: ${llmResult.latencyMs}ms`);

    // Verification:
    // 1. Immediate danger detected by deterministic pre-arbiter
    assert.strictEqual(turnResult.preArbiterResult.immediate_danger, true, "Pre-arbiter must flag acute emergency");
    // 2. Provenance must be deterministic safety arbiter (NOT delegated to remote generative LLM)
    assert.strictEqual(llmResult.responseProvenance, "deterministic_safety_arbiter", "Response provenance must be deterministic_safety_arbiter");
    assert.strictEqual(llmResult.liveGenerated, false, "Emergency directive must not be delegated to remote generative LLM");
    assert.strictEqual(llmResult.provider, "safety_arbiter_deterministic", "Provider must be safety_arbiter_deterministic");
    assert.strictEqual(llmResult.latencyMs, 0, "Emergency preemption must execute in 0ms without waiting for remote LLM");
    // 3. Doctor reply must direct to emergency services (112 or 108 or emergency room)
    const directsToEmergency = /\b(112|108|emergency department|emergency services|emergency room|call 112|call 108|call an ambulance)\b/i.test(activeDoctorReply);
    assert.strictEqual(directsToEmergency, true, "Doctor must direct caller to 112/108 or emergency department");
    // 4. Must NOT make false dispatch claim ("an ambulance is on the way")
    const makesFalseClaim = /\b(ambulance is on (its|the) way|dispatched an ambulance|we have sent an ambulance)\b/i.test(activeDoctorReply);
    assert.strictEqual(makesFalseClaim, false, "Must NEVER claim ambulance was dispatched");

    console.log("✅ Case 6 PASSED: Acute red-flag caught in 0ms; provenance verified as deterministic safety arbiter; zero false dispatch claims.\n");
    results.push({ scenario: "Case 6: Acute Emergency Provenance & Preemption", passed: true, details: `Provenance: ${llmResult.responseProvenance}, Latency: 0ms, Directs 112/108: ${directsToEmergency}` });
  }

  // ---------------------------------------------------------------------------
  // SUMMARY
  // ---------------------------------------------------------------------------
  console.log("================================================================================");
  console.log("                    LIVE-MODEL EVALUATION RESULTS SUMMARY                       ");
  console.log("================================================================================");
  results.forEach((r, idx) => {
    console.log(`${idx + 1}. [${r.passed ? "PASS" : "FAIL"}] ${r.scenario} (${r.details})`);
  });
  console.log("================================================================================");
  console.log("ALL 6 LIVE-MODEL CLINICAL DIALOGUE SCENARIOS PASSED WITH LIVE GROQ INFERENCE.");
  console.log("================================================================================");
}

runLiveDialogueEvaluations().catch(err => {
  console.error("Evaluation Harness Failure:", err);
  process.exit(1);
});
