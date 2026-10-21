/**
 * WHOLE-CONVERSATION BEHAVIORAL STRESS TEST SUITE
 *
 * Comprehensive end-to-end verification of the 4-layer context-aware architecture:
 * Layer 1: Speech Understanding & Acoustic Reconciliation
 * Layer 2: Fact Commitment Engine & Dual Clinical State
 * Layer 3: Dynamic Response Planning & Goal Governance
 * Layer 4: Independent Deterministic Safety Arbiter
 *
 * 7 Mandatory Behavioral Stress Scenarios:
 * 1. Late symptom addition (Turn 1 -> 2 -> 3 late complaint)
 * 2. Correction propagation (Non-destructive ledger & supersedesFactId)
 * 3. Temporal progression (Multi-temporal baseline + acute worsening coexistence)
 * 4. Epistemic uncertainty transition (Non-binary clinical uncertainty)
 * 5. Acoustic context divergence (TranscriptReconciler polar safeguards & patient confirmation)
 * 6. Real concurrency collision (HTTP 409 detection, optimistic version synchronization & recovery)
 * 7. Emergency preemption during contradiction (P0 safety preemption over dialogue goals)
 */

import assert from "node:assert/strict";
import { POST as postConsultation } from "../../app/api/consultations/route";
import { POST as postVoiceChat } from "../../app/api/voice/chat/route";
import { conversationManager, ClinicalInterviewState } from "../../lib/triage/conversation-manager";
import { conversationInterpreter } from "../../lib/triage/conversation-interpreter";
import { FactCommitEngine } from "../../lib/triage/fact-commit-engine";
import {
  createInitialConversationContextState,
  ConversationContextState,
  FactProposal,
} from "../../lib/triage/fact-types";
import { responsePlanner } from "../../lib/triage/response-planner";
import { reconcileClinicalTranscript } from "../../lib/audio/transcript-reconciler";
import { evaluatePreArbiter } from "../../lib/triage/pre-arbiter";
import { INTERNAL_TEST_SECRET_HEADER, DEFAULT_INTERNAL_TEST_SECRET } from "../../lib/auth/rbac";

// Set test environment for authorized internal harness execution
(process.env as Record<string, string | undefined>).NODE_ENV = "test";
(process.env as Record<string, string | undefined>).INTERNAL_TEST_SECRET = DEFAULT_INTERNAL_TEST_SECRET;

function createHeaders(userId: string = "stress-test-patient-101"): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-mock-role": "patient",
    "x-mock-user-id": userId,
    [INTERNAL_TEST_SECRET_HEADER]: DEFAULT_INTERNAL_TEST_SECRET,
  };
}

function logTurnTrace(turnNum: number, trace: {
  rawInput: string;
  interpretedProposals: FactProposal[];
  ledgerLength: number;
  newFactsCount: number;
  activeFactsCount: number;
  plannerGoal: string;
  bedsideTone: string;
  suggestedReplySnippet: string;
  immediateDanger: boolean;
  preFlags: string[];
  caseVersion: number;
}) {
  console.log(`\n  [Turn ${turnNum} Trace]`);
  console.log(`  |- rawInput: "${trace.rawInput}"`);
  console.log(`  |- interpretedProposals (${trace.interpretedProposals.length}): ${trace.interpretedProposals.map(p => `${p.concept}=${p.value} (${p.temporalScope || "current"})`).join("; ") || "none"}`);
  console.log(`  |- ledger: total=${trace.ledgerLength}, newlyCommitted=${trace.newFactsCount}, activeConcepts=${trace.activeFactsCount}`);
  console.log(`  |- planner: goal=${trace.plannerGoal}, tone=${trace.bedsideTone}`);
  console.log(`  |- doctorSpoken: "${trace.suggestedReplySnippet.slice(0, 80)}..."`);
  console.log(`  |- safety: immediateDanger=${trace.immediateDanger}, flags=[${trace.preFlags.join(", ") || "none"}]`);
  console.log(`  |- caseVersion: ${trace.caseVersion}`);
}

async function runWholeConversationStressSuite() {
  console.log("\n================================================================================");
  console.log("       MEDVOICE WHOLE-CONVERSATION BEHAVIORAL STRESS-TEST BATTERY               ");
  console.log("================================================================================\n");

  // ============================================================================
  // SCENARIO 1: Late Symptom Addition across Multi-Turn Consultation
  // ============================================================================
  console.log(">>> SCENARIO 1: Late Symptom Addition (Turn 1 -> Turn 2 -> Turn 3 late add)...");
  {
    let state = conversationManager.createInitialState();

    // Turn 1: Initial chief complaint
    const turn1Input = "I've had a headache for two days.";
    const interp1 = conversationInterpreter.interpret(turn1Input, null, state.slots);
    const turn1Res = await conversationManager.processTurn(turn1Input, state, { age: 35, age_group: "adult", age_source: "profile" });
    state = turn1Res.state;

    logTurnTrace(1, {
      rawInput: turn1Input,
      interpretedProposals: interp1.proposals || [],
      ledgerLength: state.contextState?.ledger.length || 0,
      newFactsCount: state.contextState?.ledger.length || 0,
      activeFactsCount: Object.keys(state.contextState?.currentView.factsByConcept || {}).length,
      plannerGoal: state.responsePlan?.primaryGoal || "EXPLORE_SYMPTOM",
      bedsideTone: state.responsePlan?.bedsideTone || "empathic_and_attentive",
      suggestedReplySnippet: turn1Res.doctorReply,
      immediateDanger: turn1Res.preArbiterResult.immediate_danger,
      preFlags: turn1Res.preArbiterResult.pre_safety_flags,
      caseVersion: state.caseVersion,
    });

    assert.ok(state.slots.known_facts.some(f => /headache|onset/i.test(f)), "Turn 1 recorded headache");
    assert.strictEqual(turn1Res.preArbiterResult.immediate_danger, false, "No immediate danger on gradual headache");

    // Turn 2: Answering severity question
    const turn2Input = "It is a dull ache, around a 4 out of 10.";
    const interp2 = conversationInterpreter.interpret(turn2Input, state.pendingQuestion, state.slots);
    const prevLedgerCount = state.contextState?.ledger.length || 0;
    const turn2Res = await conversationManager.processTurn(turn2Input, state, { age: 35, age_group: "adult", age_source: "profile" });
    state = turn2Res.state;

    logTurnTrace(2, {
      rawInput: turn2Input,
      interpretedProposals: interp2.proposals || [],
      ledgerLength: state.contextState?.ledger.length || 0,
      newFactsCount: (state.contextState?.ledger.length || 0) - prevLedgerCount,
      activeFactsCount: Object.keys(state.contextState?.currentView.factsByConcept || {}).length,
      plannerGoal: state.responsePlan?.primaryGoal || "EXPLORE_SYMPTOM",
      bedsideTone: state.responsePlan?.bedsideTone || "empathic_and_attentive",
      suggestedReplySnippet: turn2Res.doctorReply,
      immediateDanger: turn2Res.preArbiterResult.immediate_danger,
      preFlags: turn2Res.preArbiterResult.pre_safety_flags,
      caseVersion: state.caseVersion,
    });

    assert.ok(state.slots.character || state.slots.severity, "Turn 2 captured character/severity");

    // Turn 3: Late addition of stiff neck & photophobia
    const turn3Input = "Also my neck has become very stiff and bright lights really hurt my eyes.";
    const interp3 = conversationInterpreter.interpret(turn3Input, state.pendingQuestion, state.slots);
    const prevLedgerCount3 = state.contextState?.ledger.length || 0;
    const turn3Res = await conversationManager.processTurn(turn3Input, state, { age: 35, age_group: "adult", age_source: "profile" });
    state = turn3Res.state;

    logTurnTrace(3, {
      rawInput: turn3Input,
      interpretedProposals: interp3.proposals || [],
      ledgerLength: state.contextState?.ledger.length || 0,
      newFactsCount: (state.contextState?.ledger.length || 0) - prevLedgerCount3,
      activeFactsCount: Object.keys(state.contextState?.currentView.factsByConcept || {}).length,
      plannerGoal: state.responsePlan?.primaryGoal || "EXPLORE_SYMPTOM",
      bedsideTone: state.responsePlan?.bedsideTone || "empathic_and_attentive",
      suggestedReplySnippet: turn3Res.doctorReply,
      immediateDanger: turn3Res.preArbiterResult.immediate_danger,
      preFlags: turn3Res.preArbiterResult.pre_safety_flags,
      caseVersion: state.caseVersion,
    });

    // Verification of late addition
    assert.ok(state.slots.associated_symptoms.includes("photophobia"), "Photophobia captured into associated symptoms");
    assert.ok(state.slots.known_facts.some(f => /photophobia/i.test(f)), "Photophobia recorded in known facts");
    assert.ok((state.contextState?.ledger.length || 0) > prevLedgerCount3, "Ledger appended late symptom records");
    console.log("  [PASS] Scenario 1: Late symptom addition cleanly integrated across turns without dropping facts.\n");
  }

  // ============================================================================
  // SCENARIO 2: Non-Destructive Patient Correction Propagation
  // ============================================================================
  console.log(">>> SCENARIO 2: Non-Destructive Patient Correction Propagation...");
  {
    let contextState = createInitialConversationContextState();

    // Turn 1: Patient reports left arm pain
    const proposal1: FactProposal = {
      concept: "pain_location",
      value: "left arm",
      assertionStatus: "present",
      temporalScope: "current",
      rawSnippet: "My left arm started hurting two hours ago",
    };
    const commit1 = FactCommitEngine.commit(contextState, [proposal1], 1, "patient_reported");
    contextState = commit1.nextState;

    const initialFact = contextState.currentView.factsByConcept["pain_location"]?.[0];
    assert.ok(initialFact, "Initial fact recorded");
    assert.strictEqual(initialFact.value, "left arm");
    const originalFactId = initialFact.id;

    // Turn 2: Patient corrects to right arm
    const correctionProposal: FactProposal = {
      concept: "pain_location",
      value: "right arm",
      assertionStatus: "present",
      temporalScope: "current",
      isCorrection: true,
      rawSnippet: "Wait, sorry doctor, I meant my right arm, not the left arm",
      clinicalRationale: "Patient corrected anatomical location",
    };
    const commit2 = FactCommitEngine.commit(contextState, [correctionProposal], 2, "patient_reported");
    contextState = commit2.nextState;

    // Verify non-destructive ledger properties:
    assert.strictEqual(contextState.ledger.length, 2, "Ledger preserved both original and correction records");

    // Original record must still exist in ledger but marked superseded
    const originalInLedger = contextState.ledger.find(f => f.id === originalFactId);
    assert.ok(originalInLedger, "Original record still present in immutable ledger");
    assert.strictEqual(originalInLedger.supersededByTurn, 2, "Original record linked to superseding turn");

    // New record must point back via supersedesFactId
    const correctionInLedger = contextState.ledger.find(f => f.supersedesFactId === originalFactId);
    assert.ok(correctionInLedger, "Correction record has supersedesFactId pointing to original fact");
    assert.strictEqual(correctionInLedger.value, "right arm");

    // Current active view must show ONLY right arm
    const activeFacts = contextState.currentView.factsByConcept["pain_location"];
    assert.strictEqual(activeFacts.length, 1, "Current view contains only one active location fact");
    assert.strictEqual(activeFacts[0].value, "right arm", "Current view updated to right arm");

    // Response planner confirms correction
    const semanticCorrection = {
      rawUtterance: "Wait, sorry doctor, I meant my right arm, not the left arm",
      intent: "correction" as const,
      isConfirmationOrRepetition: false,
      isCorrection: true,
      correctedSlot: "location",
      correctedValue: "right arm",
      correctedDetail: "right arm rather than left arm",
      isEmergencyInquiry: false,
      newEvidence: [{ slot: "location", value: "right arm" }],
      ambiguities: [],
      confidence: 0.95,
    };
    const mockState = conversationManager.createInitialState();
    mockState.contextState = contextState;
    mockState.slots.location = "right arm";

    const preArb = evaluatePreArbiter({ transcript: "pain in right arm", demographics: { age: 40, age_group: "adult" } } as any);
    const plan = responsePlanner.plan(semanticCorrection.rawUtterance, semanticCorrection, mockState, preArb);

    console.log(`  |- correction goal: ${plan.primaryGoal}`);
    console.log(`  |- correction tone: ${plan.bedsideTone}`);
    console.log(`  |- suggestedSpokenReply: "${plan.suggestedSpokenReply}"`);

    assert.strictEqual(plan.primaryGoal, "CONFIRM_CORRECTION_AND_PROCEED");
    assert.ok(plan.mustAvoidAsking.includes("location"));
    console.log("  [PASS] Scenario 2: Patient correction cleanly propagated with provenance preserved.\n");
  }

  // ============================================================================
  // SCENARIO 3: Temporal Progression (Baseline + Acute Worsening Coexistence)
  // ============================================================================
  console.log(">>> SCENARIO 3: Temporal Progression (Multi-Temporal Coexistence)...");
  {
    let contextState = createInitialConversationContextState();
    const utterance = "I've had a mild headache for two days, but an hour ago it suddenly became unbearable.";

    const interp = conversationInterpreter.interpret(utterance, null, {});
    assert.ok(interp.proposals && interp.proposals.length >= 3, "Multi-clause splitting extracted temporal proposals");

    const commit = FactCommitEngine.commit(contextState, interp.proposals, 1, "patient_reported");
    contextState = commit.nextState;

    const severityFacts = contextState.currentView.factsByConcept["headache_severity"] || [];
    console.log(`  |- headache_severity facts count: ${severityFacts.length}`);
    severityFacts.forEach(f => console.log(`     * temporalScope: ${f.temporalScope}, value: "${f.value}", raw: "${f.rawSnippet}"`));

    // Invariant: Both baseline and acute worsening MUST coexist
    const baselineFact = severityFacts.find(f => f.temporalScope === "baseline");
    const acuteFact = severityFacts.find(f => f.temporalScope === "acute_worsening");
    assert.ok(baselineFact, "Baseline mild headache preserved");
    assert.ok(acuteFact, "Acute worsening unbearable headache preserved");
    assert.notStrictEqual(baselineFact.value, acuteFact.value);

    // Verify onset pattern
    const onsetFacts = contextState.currentView.factsByConcept["headache_onset_pattern"] || [];
    const acuteOnset = onsetFacts.find(f => f.temporalScope === "acute_worsening");
    assert.ok(acuteOnset, "Acute onset pattern sudden preserved");
    assert.strictEqual(acuteOnset.value, "sudden");

    // PreArbiter safety check on the acute worsening
    const preArb = evaluatePreArbiter({ transcript: utterance, demographics: { age: 30, age_group: "adult" } } as any);
    console.log(`  |- preArbiter flags: [${preArb.pre_safety_flags.join(", ")}]`);
    console.log("  [PASS] Scenario 3: Baseline and acute crescendo escalation coexist without data loss.\n");
  }

  // ============================================================================
  // SCENARIO 4: Epistemic Uncertainty & Non-Binary Onset Preservation
  // ============================================================================
  console.log(">>> SCENARIO 4: Epistemic Uncertainty Transition...");
  {
    let contextState = createInitialConversationContextState();
    const utterance = "I'm really not sure if it's getting worse or staying the same, I honestly can't tell.";

    const interp = conversationInterpreter.interpret(utterance, { id: "q1", askedBy: "Doctor", question: "Is it getting worse?", targetSlot: "progression" } as any, {});
    assert.ok(interp.isUncertainty || interp.intent === "uncertainty_or_unknown", "Uncertainty intent recognized");

    const commit = FactCommitEngine.commit(contextState, interp.proposals || [], 1, "patient_reported");
    contextState = commit.nextState;

    console.log(`  |- activeUncertainties count: ${contextState.currentView.activeUncertainties.length}`);
    assert.ok(contextState.currentView.activeUncertainties.length > 0, "Uncertainty recorded in activeUncertainties list");
    const unc = contextState.currentView.activeUncertainties[0];
    assert.strictEqual(unc.concept, "progression");
    const factRec = contextState.currentView.factsByConcept["progression"]?.[0];
    assert.ok(factRec, "Fact record for progression exists in currentView");
    assert.strictEqual(factRec.assertionStatus, "uncertain");

    // Response planner execution
    const mockState = conversationManager.createInitialState();
    mockState.contextState = contextState;
    mockState.pendingQuestion = { id: "q1", askedBy: "Doctor", question: "Is it getting worse?", targetSlot: "progression" } as any;

    const preArb = evaluatePreArbiter({ transcript: utterance, demographics: { age: 45, age_group: "adult" } } as any);
    const plan = responsePlanner.plan(utterance, interp, mockState, preArb);

    console.log(`  |- planner goal: ${plan.primaryGoal}`);
    console.log(`  |- tone: ${plan.bedsideTone}`);
    console.log(`  |- suggestedSpokenReply: "${plan.suggestedSpokenReply}"`);

    assert.strictEqual(plan.primaryGoal, "ACKNOWLEDGE_AND_ADVANCE");
    assert.strictEqual(plan.bedsideTone, "empathic_and_calm");
    assert.ok(plan.suggestedSpokenReply.includes("completely fine") || plan.suggestedSpokenReply.includes("don't have to know"));
    console.log("  [PASS] Scenario 4: Epistemic uncertainty preserved without forcing binary selection.\n");
  }

  // ============================================================================
  // SCENARIO 5: Acoustic Context Divergence & Patient Confirmation Safeguard
  // ============================================================================
  console.log(">>> SCENARIO 5: Acoustic Context Divergence & Safeguards...");
  {
    // Test 5A: Known clinical mishearing with context alignment
    const doctorPrompt = "Did the headache start suddenly, or did it come on gradually?";
    const whisperAcoustic = "It came on graduating.";
    const browserPreview = "It came on gradually.";

    const resultA = reconcileClinicalTranscript({
      whisperText: whisperAcoustic,
      previewText: browserPreview,
      doctorLastQuestion: doctorPrompt,
      currentSymptoms: ["headache"],
    });

    console.log(`  |- 5A Raw Whisper: "${resultA.rawWhisperText}"`);
    console.log(`  |- 5A Reconciled: "${resultA.transcript}"`);
    console.log(`  |- 5A Notes: ${resultA.reconciliationNotes?.join("; ")}`);
    assert.strictEqual(resultA.transcript, "It came on gradually.");
    assert.strictEqual(resultA.wasReconciled, true);

    // Test 5B: Clinical polarity divergence (Antonym conflict: sudden vs gradual)
    const whisperOpposing = "It started suddenly.";
    const previewOpposing = "It started gradually.";

    const resultB = reconcileClinicalTranscript({
      whisperText: whisperOpposing,
      previewText: previewOpposing,
      doctorLastQuestion: doctorPrompt,
      currentSymptoms: ["headache"],
    });

    console.log(`  |- 5B Opposing inputs: Whisper="${resultB.rawWhisperText}" vs Preview="${resultB.rawPreviewText}"`);
    console.log(`  |- 5B IsAmbiguous: ${resultB.isAmbiguous}, requiresPatientConfirmation: ${resultB.requiresPatientConfirmation}`);
    console.log(`  |- 5B Ambiguity reason: "${resultB.ambiguityReason}"`);

    assert.strictEqual(resultB.isAmbiguous, true, "Polar antonym conflict flagged as ambiguous");
    assert.strictEqual(resultB.requiresPatientConfirmation, true, "Requires patient confirmation rather than silent replacement");
    assert.ok(resultB.transcript.includes("suddenly"), "Whisper raw audio is preserved without flipping to opposite");
    console.log("  [PASS] Scenario 5: Acoustic reconciliation aligns context while safeguarding against polar mutation.\n");
  }

  // ============================================================================
  // SCENARIO 6: Real Concurrency Collision & Optimistic Version Synchronization
  // ============================================================================
  console.log(">>> SCENARIO 6: Concurrency Collision & Self-Healing Verification...");
  {
    const encounterId = `ENC-STRESS-${Date.now().toString().slice(-6)}`;
    const userId = "patient-stress-concurrency";

    // 1. Initialize consultation encounter
    const initReq = new Request("http://localhost:3000/api/consultations", {
      method: "POST",
      headers: createHeaders(userId),
      body: JSON.stringify({
        id: encounterId,
        patientName: "Stress Test Patient",
        patientAge: "35",
        patientGender: "female",
        doctorId: "dr-sarah-chen",
        doctorName: "Dr. Sarah Chen, MD",
        specialty: "General Medicine",
        chiefComplaint: "Severe dizziness",
        transcript: [],
        status: "in_progress",
        caseVersion: 1,
      }),
    });
    const initRes = await postConsultation(initReq);
    const initData = await initRes.json();
    assert.strictEqual(initRes.status, 200);
    console.log(`  |- Initialized encounter ${encounterId} with caseVersion: ${initData.consultation?.caseVersion || 1}`);

    // 2. Legitimate Turn 1 processes
    const chat1Req = new Request("http://localhost:3000/api/voice/chat", {
      method: "POST",
      headers: createHeaders(userId),
      body: JSON.stringify({
        encounterId,
        doctorId: "dr-sarah-chen",
        message: "I feel dizzy whenever I stand up.",
        conversationHistory: [{ role: "patient", text: "I feel dizzy whenever I stand up." }],
        caseVersion: 1,
      }),
    });
    const chat1Res = await postVoiceChat(chat1Req);
    const chat1Data = await chat1Res.json();
    assert.strictEqual(chat1Res.status, 200);
    const turn1Version = chat1Data.caseVersion;
    console.log(`  |- Turn 1 chat succeeded, server advanced caseVersion to: ${turn1Version}`);

    // Persist Turn 1 to datastore
    const persist1Req = new Request("http://localhost:3000/api/consultations", {
      method: "POST",
      headers: createHeaders(userId),
      body: JSON.stringify({
        id: encounterId,
        caseVersion: turn1Version + 1,
        interviewState: chat1Data.interviewState,
        status: "in_progress",
      }),
    });
    const persist1Res = await postConsultation(persist1Req);
    const persist1Data = await persist1Res.json();
    assert.strictEqual(persist1Res.status, 200);
    const currentDatastoreVersion = persist1Data.consultation?.caseVersion;
    console.log(`  |- Datastore persisted Turn 1, current datastore caseVersion: ${currentDatastoreVersion}`);

    // 3. INJECT STALE CONCURRENCY COLLISION: Client submits using stale version (1)
    console.log(`  |- Injecting stale client collision (submitting version 1 when server is at ${currentDatastoreVersion})...`);
    const staleReq = new Request("http://localhost:3000/api/voice/chat", {
      method: "POST",
      headers: createHeaders(userId),
      body: JSON.stringify({
        encounterId,
        doctorId: "dr-sarah-chen",
        message: "Also feeling slightly sick.",
        caseVersion: 1, // Stale!
      }),
    });
    const staleRes = await postVoiceChat(staleReq);
    const staleData = await staleRes.json();

    console.log(`  |- Stale response status: ${staleRes.status}, code: ${staleData.code}, expectedVersion: ${staleData.expectedVersion}`);
    assert.strictEqual(staleRes.status, 409, "Server strictly rejects stale caseVersion with HTTP 409");
    assert.strictEqual(staleData.code, "CONCURRENT_MODIFICATION_CONFLICT");
    assert.strictEqual(staleData.expectedVersion, currentDatastoreVersion, "Server communicates authoritative current version");

    // 4. CLIENT SELF-HEALING RECOVERY: Synchronize ref to expectedVersion and retry
    console.log(`  |- Executing self-healing recovery with synchronized version ${staleData.expectedVersion}...`);
    const healedReq = new Request("http://localhost:3000/api/voice/chat", {
      method: "POST",
      headers: createHeaders(userId),
      body: JSON.stringify({
        encounterId,
        doctorId: "dr-sarah-chen",
        message: "Also feeling slightly sick.",
        caseVersion: staleData.expectedVersion,
      }),
    });
    const healedRes = await postVoiceChat(healedReq);
    const healedData = await healedRes.json();
    assert.strictEqual(healedRes.status, 200, "Self-healing retry succeeded with HTTP 200");
    console.log(`  |- Self-healing successful! New server caseVersion: ${healedData.caseVersion}`);
    console.log("  [PASS] Scenario 6: Atomic version isolation and self-healing recovery verified.\n");
  }

  // ============================================================================
  // SCENARIO 7: Emergency Preemption During Contradiction Resolution
  // ============================================================================
  console.log(">>> SCENARIO 7: Priority 0 Emergency Preemption During Contradiction...");
  {
    // Step 1: Set up state with an unclarified clinical contradiction
    let state = conversationManager.createInitialState();
    let contextState = createInitialConversationContextState();

    // Fact 1: Headache duration reported as 2 days
    const p1: FactProposal = {
      concept: "headache_duration",
      value: "2 days",
      assertionStatus: "present",
      temporalScope: "current",
      rawSnippet: "I've had a headache for two days",
    };
    // Fact 2: In the same conversation, patient says "It actually started two weeks ago"
    const p2: FactProposal = {
      concept: "headache_duration",
      value: "2 weeks",
      assertionStatus: "present",
      temporalScope: "current",
      rawSnippet: "It actually started two weeks ago",
    };

    const commitRes = FactCommitEngine.commit(contextState, [p1, p2], 1, "patient_reported");
    state.contextState = commitRes.nextState;

    // Verify contradiction is flagged and pending clarification
    assert.ok(state.contextState.currentView.contradictions.length > 0, "Contradiction recorded in state");
    const contra = state.contextState.currentView.contradictions[0];
    assert.strictEqual(contra.requiresClarification, true);
    console.log(`  |- Initial state has unclarified contradiction: concept=${contra.concept}, description="${contra.description}"`);

    // In a non-emergency turn, ResponsePlanner would clarify this contradiction
    const nonEmergencyInterp = conversationInterpreter.interpret("I'm just resting", null, state.slots);
    const nonEmergencyPreArb = evaluatePreArbiter({ transcript: "I've had a headache for two days, actually started two weeks ago", demographics: { age: 35, age_group: "adult" } } as any);
    const nonEmergencyPlan = responsePlanner.plan("I'm just resting", nonEmergencyInterp, state, nonEmergencyPreArb);
    console.log(`  |- Non-emergency goal under contradiction: ${nonEmergencyPlan.primaryGoal}`);
    assert.strictEqual(nonEmergencyPlan.primaryGoal, "CLARIFY_CONTRADICTION", "Normal goal is CLARIFY_CONTRADICTION");

    // Step 2: Now patient reports sudden catastrophic red flag (facial droop + unilateral paralysis)
    const emergencyUtterance = "Doctor, my face is drooping and my left arm is completely paralyzed!";
    console.log(`  |- Acute red flag reported: "${emergencyUtterance}"`);

    const turnRes = await conversationManager.processTurn(emergencyUtterance, state, { age: 50, age_group: "adult", age_source: "profile" });

    logTurnTrace(2, {
      rawInput: emergencyUtterance,
      interpretedProposals: turnRes.state.contextState?.ledger.slice(-2).map(f => ({ concept: f.concept, value: f.value, assertionStatus: f.assertionStatus, rawSnippet: f.rawSnippet })) || [],
      ledgerLength: turnRes.state.contextState?.ledger.length || 0,
      newFactsCount: 2,
      activeFactsCount: Object.keys(turnRes.state.contextState?.currentView.factsByConcept || {}).length,
      plannerGoal: turnRes.state.responsePlan?.primaryGoal || "EMERGENCY_INTERVENTION",
      bedsideTone: turnRes.state.responsePlan?.bedsideTone || "urgent_and_directive",
      suggestedReplySnippet: turnRes.doctorReply,
      immediateDanger: turnRes.preArbiterResult.immediate_danger,
      preFlags: turnRes.preArbiterResult.pre_safety_flags,
      caseVersion: turnRes.state.caseVersion,
    });

    // CRITICAL SAFETY ASSERTIONS:
    assert.strictEqual(turnRes.preArbiterResult.immediate_danger, true, "Deterministic Safety Arbiter triggered immediate_danger");
    assert.ok(turnRes.preArbiterResult.pre_safety_flags.includes("PRE_FLAG_ACUTE_NEUROLOGIC_DEFICIT"), "Neurologic deficit flag raised");
    assert.strictEqual(turnRes.action, "EMERGENCY_CONVENE_BOARD", "ConversationManager executed EMERGENCY_CONVENE_BOARD");
    assert.strictEqual(turnRes.state.informationState, "emergency_preempted", "Information state set to emergency_preempted");

    // Invariant: The system MUST NOT attempt to clarify the contradiction when a life-threat is active!
    assert.notStrictEqual(turnRes.state.responsePlan?.primaryGoal, "CLARIFY_CONTRADICTION", "Contradiction clarification strictly preempted");
    assert.ok(
      /(?:urgent|emergency|stroke|ambulance|112|108|911)/i.test(turnRes.doctorReply),
      "Doctor reply immediately directs to urgent/emergency evaluation"
    );

    console.log("  [PASS] Scenario 7: Priority 0 Emergency Arbiter strictly preempts contradiction clarification.\n");
  }

  console.log("================================================================================");
  console.log("       ALL 7 WHOLE-CONVERSATION BEHAVIORAL STRESS SCENARIOS PASSED 100%         ");
  console.log("================================================================================\n");
}

runWholeConversationStressSuite().catch((err) => {
  console.error("FATAL ERROR in Whole-Conversation Stress Suite:", err);
  process.exit(1);
});
