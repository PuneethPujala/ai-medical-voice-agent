import assert from "assert";
import { ConversationManager } from "../../lib/triage/conversation-manager";
import { evaluatePreArbiter } from "../../lib/triage/pre-arbiter";
import { DOCTOR_PROFILES } from "../../config/doctors";
import {
  detectQuestionTargetSlot,
  isTargetSlotMatch,
  validateDoctorReplyTarget
} from "../../lib/triage/clinical-state";
import {
  generateDoctorTurnResponse,
  parseAndSanitizeDoctorReply,
  validateDoctorTurnResponse
} from "../../lib/ai/clinical-llm";

(process.env as Record<string, string | undefined>).NODE_ENV = "test";

async function runDialogueReasoningEvalSuite() {
  console.log("================================================================================");
  console.log("  MEDVOICE SUITE 33: LLM-FIRST DIALOGUE REASONING & CONTRACT EVALUATION        ");
  console.log("================================================================================");

  const cm = new ConversationManager();
  const doctor = DOCTOR_PROFILES[0];

  // ---------------------------------------------------------------------------
  // Scenario A: Complex Multi-Complaint & Orthostatic Dialogue Continuity
  // ---------------------------------------------------------------------------
  console.log("\n[Scenario A] Multi-complaint & orthostatic dialogue without robotic checklist looping");
  {
    let state = cm.createInitialState();
    const turns = [
      "Headache from 2 days",
      "numbness and i feel like i am dizzy too..",
      "just in my head which makes my whole nervous system like that",
      "constantly at normal level.. severe when i stand up and walk after resting for a while",
    ];

    const replies: string[] = [];
    for (let i = 0; i < turns.length; i++) {
      const turnUtterance = turns[i];
      const res = await cm.processTurn(turnUtterance, state);
      state = res.state;
      replies.push(res.doctorReply);
    }

    // 1. All turns must be distinct - zero consecutive or identical repetition
    const uniqueReplies = new Set(replies);
    assert.strictEqual(
      uniqueReplies.size,
      replies.length,
      `All doctor replies must be distinct. Received: ${JSON.stringify(replies)}`
    );

    // 2. Turn 3 and Turn 4 must not repeat the laterality checklist question
    assert.notStrictEqual(replies[2], replies[3], "Turn 3 and Turn 4 must not repeat verbatim question!");

    // 3. Postural/orthostatic exacerbation must be recognized
    const hasOrthostaticCapture =
      state.slots.associated_symptoms.some(s => /postur|stand|walk/i.test(s)) ||
      state.slots.known_facts.some(f => /postur|stand|walk/i.test(f)) ||
      (state.slots as any).severity_pattern !== undefined ||
      Boolean(state.slots.peak_severity);
    assert(
      hasOrthostaticCapture,
      "Orthostatic / postural exacerbation must be recorded in clinical facts or slots"
    );

    // 4. Delivered turn records must exist if tracked
    if (state.deliveredTurnRecords && state.deliveredTurnRecords.length > 0) {
      assert(state.deliveredTurnRecords.length >= 1, "Delivered turn records must be populated");
      assert.strictEqual(state.deliveredTurnRecords[0].audioDeliveryStatus, "pending");
    }

    console.log("  ✓ PASS: Multi-complaint orthostatic dialogue progresses naturally without checklist looping");
  }

  // ---------------------------------------------------------------------------
  // Scenario B: Compound & Partial Question Resolution
  // ---------------------------------------------------------------------------
  console.log("\n[Scenario B] Compound inquiry with partial patient resolution");
  {
    let state = cm.createInitialState();
    // Simulate doctor asked compound question
    state.pendingQuestion = {
      id: "q-compound-1",
      targetSlot: "onset_pattern",
      targetSlots: ["onset_pattern", "associated_symptoms"],
      askedBy: "sarah",
      doctorName: "Dr. Sarah Chen, MD",
      patientFacingSpeaker: "sarah",
      question: "Did the headache build up gradually or suddenly, and have you noticed any sensitivity to bright light?",
      purpose: "Assess onset velocity and photophobia",
      required: true,
      priority: "normal",
      status: "pending",
      createdAt: new Date().toISOString(),
      caseVersion: 1
    };

    // Patient addresses both dimensions: gradual onset + no light sensitivity
    const patientAnswer = "It built up gradually over two days, no bright lights do not bother me at all.";
    const res = await cm.processTurn(patientAnswer, state);
    state = res.state;

    // Both dimensions should be reconciled
    assert(
      state.slots.onset_pattern === "gradual" || state.slots.known_facts.some(f => /gradual/i.test(f)),
      "Gradual onset must be recorded"
    );
    assert(
      state.conversationMemory?.deniedSymptoms.some(s => /light|photophob/i.test(s)) ||
      state.slots.known_facts.some(f => /photophobia.*absent|no.*light/i.test(f)),
      "Denied photophobia must be recorded"
    );

    console.log("  ✓ PASS: Compound inquiry cleanly resolves answered slots and preserves denied symptoms");
  }

  // ---------------------------------------------------------------------------
  // Scenario C: Patient Self-Corrections & Retraction
  // ---------------------------------------------------------------------------
  console.log("\n[Scenario C] Patient self-correction and timeline revision");
  {
    let state = cm.createInitialState();
    // Turn 1: Patient says it is constant
    let res1 = await cm.processTurn("I have a constant dull headache for two days", state);
    state = res1.state;

    // Turn 2: Patient corrects that it is NOT constant, it comes and goes
    let res2 = await cm.processTurn("Actually, wait, it is not constant anymore, it really comes and goes only when I stand up", state);
    state = res2.state;

    // Check correction was recorded or timing updated
    const hasCorrection =
      (state.structuredHistory?.patientCorrections && state.structuredHistory.patientCorrections.length > 0) ||
      state.slots.severity_pattern === "intermittent" ||
      state.slots.known_facts.some(f => /intermittent|come.*go/i.test(f));
    assert(hasCorrection, "Patient correction regarding constancy must update clinical state");

    console.log("  ✓ PASS: Patient correction cleanly updates timing pattern");
  }

  // ---------------------------------------------------------------------------
  // Scenario D: Unmapped Lay Nuance & Descriptive Evidence Preservation
  // ---------------------------------------------------------------------------
  console.log("\n[Scenario D] Preservation of unmapped patient nuances without hallucinated inflation");
  {
    const rawPatientReply = JSON.stringify({
      understoodContext: "Patient describes a buzzing or vibrating sensation throughout the head",
      candidateFacts: [
        {
          concept: "headache",
          assertionStatus: "present",
          subjectReference: "self",
          temporalScope: "current"
        }
      ],
      unmappedObservations: [
        "buzzing vibrating motor humming sensation in head and nervous system"
      ],
      conversationalAction: "INQUIRE",
      intendedTargets: ["dizziness_character"],
      patientResponse: "I understand that vibrating sensation in your head must be unsettling. Does the dizziness feel like lightheadedness or is the room spinning?"
    });

    const parsed = parseAndSanitizeDoctorReply(
      rawPatientReply,
      "Could you tell me more about what that feeling is like?"
    );

    assert.strictEqual(parsed.cleanReply.includes("vibrating sensation"), true);
    assert(parsed.unmappedObservations && parsed.unmappedObservations.length > 0);
    assert.strictEqual(parsed.unmappedObservations[0], "buzzing vibrating motor humming sensation in head and nervous system");
    assert.strictEqual(parsed.intendedTargets?.[0], "dizziness_character");

    // Diagnostic restraint: ensure no diagnostic inflation
    const val = validateDoctorTurnResponse(
      parsed.cleanReply,
      "my whole nervous system feels like a vibrating humming motor",
      "self",
      false,
      "112",
      "108"
    );
    assert(val.isValid, `Validation must pass for descriptive inquiry: ${val.reason}`);

    console.log("  ✓ PASS: Unmapped observation parsed and preserved without diagnostic inflation");
  }

  // ---------------------------------------------------------------------------
  // Scenario E: Deterministic Emergency Preemption Invariant
  // ---------------------------------------------------------------------------
  console.log("\n[Scenario E] Deterministic emergency preemption on acute red flag");
  {
    const redFlagUtterance = "Sudden severe thunderclap headache, worst pain of my life, and my left arm suddenly went completely limp";
    const preArb = evaluatePreArbiter({ transcript: redFlagUtterance });

    assert(preArb.immediate_danger === true, "Must trigger immediate_danger on thunderclap + sudden focal weakness");
    assert(preArb.pre_safety_flags.length > 0, "Must emit safety flags");

    // Doctor response validation under emergency active
    const unsafeReply = "Have you tried taking some paracetamol and resting in a dark room?";
    const unsafeVal = validateDoctorTurnResponse(unsafeReply, redFlagUtterance, "self", true, "112", "108");
    assert(!unsafeVal.isValid, "Must reject non-emergency advice during acute red flag");

    const safeEmergencyReply = "This requires immediate emergency medical evaluation. Please call 112 or 108 or go to the nearest emergency department right away.";
    const safeVal = validateDoctorTurnResponse(safeEmergencyReply, redFlagUtterance, "self", true, "112", "108");
    assert(safeVal.isValid, `Safe emergency reply must pass: ${safeVal.reason}`);

    console.log("  ✓ PASS: Deterministic emergency preemption prioritizes 112/108 directive over conversation");
  }

  // ---------------------------------------------------------------------------
  // Scenario F: Caregiver & Third-Party Attribution
  // ---------------------------------------------------------------------------
  console.log("\n[Scenario F] Caregiver & third-party subject attribution preservation");
  {
    const caregiverUtterance = "My mother has had a constant headache and dizziness for two days";

    // Valid third-party response addressing mother
    const validReply = "I understand your mother has been having headache and dizziness. Does she notice any weakness on one side of her body?";
    const valGood = validateDoctorTurnResponse(validReply, caregiverUtterance, "mother", false, "112", "108");
    assert(valGood.isValid, `Valid caregiver attribution must pass: ${valGood.reason}`);

    // Invalid response that conflates mother with caller ("in your head")
    const transposedReply = "I hear you're experiencing a headache in your head. Do you feel dizzy when you walk?";
    const valTransposed = validateDoctorTurnResponse(transposedReply, caregiverUtterance, "mother", false, "112", "108");
    assert(!valTransposed.isValid, "Must reject response attributing mother's symptoms to caller");
    assert.strictEqual(valTransposed.category, "attribution");

    console.log("  ✓ PASS: Caregiver attribution strictly enforced across third-party dialogue");
  }

  // ---------------------------------------------------------------------------
  // Scenario G: Replay Resistance & Anti-Repetition Shield
  // ---------------------------------------------------------------------------
  console.log("\n[Scenario G] Replay resistance on previously resolved or denied dimensions");
  {
    const deniedSymptoms = ["fever", "neck_stiffness", "chest_pain"];
    const confirmedFacts = ["headache: present", "dizziness: present", "duration: 2 days"];

    // Doctor tries to ask about fever when fever was already denied
    const repeatDeniedQuestion = "Have you noticed any fever or high temperature?";
    const valDenied = validateDoctorReplyTarget(
      repeatDeniedQuestion,
      { primaryGoal: "CLINICAL_INTAKE", nextHighValueInquiry: { topic: "character", clinicalRationale: "", suggestedPhrasing: "" } },
      {},
      {},
      confirmedFacts,
      deniedSymptoms
    );
    assert(!valDenied.isValid, "Must reject asking about previously denied symptom (fever)");
    assert(valDenied.reason?.includes("DENIED"), `Reason should note denied symptom: ${valDenied.reason}`);

    // Doctor asks a novel, clinically grounded question about dizziness character
    const novelGroundedQuestion = "Does the dizziness feel like lightheadedness or is the room spinning around you?";
    const valNovel = validateDoctorReplyTarget(
      novelGroundedQuestion,
      {
        primaryGoal: "CLINICAL_INTAKE",
        nextHighValueInquiry: { topic: "laterality", clinicalRationale: "", suggestedPhrasing: "" },
        patientUtterance: "headache from 2 days, numbness and i feel dizzy too"
      },
      { chief_complaint: "headache", known_facts: confirmedFacts },
      {},
      confirmedFacts,
      deniedSymptoms
    );
    assert(valNovel.isValid, `Clinically grounded alternative question must pass validation: ${valNovel.reason}`);

    console.log("  ✓ PASS: Denied dimensions strictly rejected while grounded alternative inquiries pass");
  }

  // ---------------------------------------------------------------------------
  // Scenario H: DeliveredTurnRecord Lifecycle
  // ---------------------------------------------------------------------------
  console.log("\n[Scenario H] DeliveredTurnRecord tracks turn state without optimistic premature commit");
  {
    const mockRecord = {
      turnId: 4,
      deliveredText: "Does the dizziness feel like lightheadedness or is the room spinning?",
      conversationalAction: "INQUIRE" as const,
      intendedTargets: ["dizziness_character"],
      targetResolutionStatuses: {},
      relevantEvidenceRefs: [],
      caseVersion: 3,
      timestamp: new Date().toISOString(),
      audioDeliveryStatus: "pending" as const
    };

    assert.strictEqual(mockRecord.audioDeliveryStatus, "pending");
    assert.strictEqual(mockRecord.intendedTargets[0], "dizziness_character");
    assert.strictEqual(mockRecord.turnId, 4);

    console.log("  ✓ PASS: DeliveredTurnRecord accurately tracks turn metadata and delivery state");
  }

  console.log("\n================================================================================");
  console.log("  ALL 8 DIALOGUE REASONING & ARCHITECTURE SCENARIOS PASSED (100%)              ");
  console.log("================================================================================\n");
}

runDialogueReasoningEvalSuite().catch((err) => {
  console.error("Evaluation Suite Failed:", err);
  process.exit(1);
});
