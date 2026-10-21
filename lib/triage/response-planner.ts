import { ClinicalInterviewState, ConversationMemory } from "./conversation-manager";
import { SemanticInterpretation } from "./conversation-interpreter";
import { PreArbiterResult } from "./pre-arbiter";
import { LocaleConfig, DEFAULT_LOCALE_CONFIG, getEmergencyDispatchInstructions } from "../config/locale";
import { extractSubfieldState, isAbdominalPresentation } from "./clinical-state";
import { evaluatePresentationDimensions } from "../clinical-knowledge/presentation-registry";
import { DimensionEvaluation } from "../clinical-knowledge/presentation-types";

export type PlanGoal =
  | "CONFIRM_CORRECTION_AND_PROCEED"
  | "ACKNOWLEDGE_AND_ADVANCE"
  | "GENTLE_CLARIFICATION"
  | "RESOLVE_OBJECTION_REPETITION"
  | "VALIDATE_EMOTION_BEFORE_INQUIRY"
  | "ADDRESS_ACCESS_BARRIER"
  | "CLARIFY_MEMORY_OR_IDENTITY"
  | "CLARIFY_CONTRADICTION"
  | "EMERGENCY_INTERVENTION"
  | "ACKNOWLEDGE_AND_EXPLORE"
  | "ADVANCE_CLINICAL_INTAKE";

export interface ResponsePlan {
  primaryGoal: PlanGoal;
  conversationalFocus: string;
  mustAvoidAsking: string[];
  nextHighValueInquiry?: {
    topic: string;
    clinicalRationale: string;
    suggestedPhrasing: string;
  };
  bedsideTone: "empathic_and_calm" | "urgent_and_directive" | "attentive_and_methodical";
  suggestedSpokenReply: string;
  evaluatedDimensions?: DimensionEvaluation[];
}

/**
 * RESPONSE PLANNER
 * 
 * Bridges the gap between raw clinical facts / safety invariants and natural doctor-patient dialogue.
 * 
 * Invariants:
 * 1. "What did this person actually communicate?" -> Interpret intent before clinical checklist.
 * 2. "What should I respond to FIRST?" -> Acknowledge, validate, apologize, or clarify before advancing.
 * 3. "What is the ONE most useful clinical thing needed next?" -> Ask at most ONE focused question.
 * 4. "Never ask for information already established or confirmed" -> Strictly enforce memory boundaries.
 */
/**
 * ANTI-DOSAGE VERBALIZATION GUARD:
 * Invariant: The verbalization/response layer must NEVER state numerical drug dosages or
 * prescribe specific drug amounts. DailyMed or drug reference text containing milligrams,
 * tablet counts, or dosing schedules must be sanitized before spoken delivery.
 */
export function sanitizeDosageVerbalization(text: string): string {
  if (!text) return text;
  // Match patterns like "500 mg", "10mg", "2 tablets", "take 1 pill every 8 hours", "650mg TDS"
  return text
    .replace(/\b\d+(?:\.\d+)?\s*(?:mg|mcg|micrograms?|milligrams?|g|grams?|ml|milliliters?|units?|iu)\b/gi, "[prescribed amount]")
    .replace(/\b(?:take|administer|consume)\s+\d+\s*(?:tablets?|capsules?|pills?|drops?)\b/gi, "take the doctor-prescribed amount");
}

export class ResponsePlanner {
  public plan(
    patientUtterance: string,
    semantic: SemanticInterpretation,
    state: ClinicalInterviewState,
    preArbiterResult: PreArbiterResult,
    conversationHistory: Array<{ role: string; text?: string; content?: string }> = [],
    localeConfig: LocaleConfig = DEFAULT_LOCALE_CONFIG
  ): ResponsePlan {
    const textLower = patientUtterance.toLowerCase();
    if (state.slots) {
      if (!Array.isArray(state.slots.neurological_signs)) {
        state.slots.neurological_signs = typeof state.slots.neurological_signs === "string"
          ? [state.slots.neurological_signs]
          : [];
      }
      if (!Array.isArray(state.slots.associated_symptoms)) {
        state.slots.associated_symptoms = typeof state.slots.associated_symptoms === "string"
          ? [state.slots.associated_symptoms]
          : [];
      }
      if (!Array.isArray(state.slots.known_facts)) {
        state.slots.known_facts = typeof state.slots.known_facts === "string"
          ? [state.slots.known_facts]
          : [];
      }
    }

    const memory: ConversationMemory = state.conversationMemory || {
      confirmedFacts: state.slots.known_facts || [],
      deniedSymptoms: [],
      questionsAlreadyAsked: [],
      patientCorrections: [],
      patientObjections: [],
      patientConcerns: [],
      accessConstraints: [],
      uncertainties: [],
    };

    const isEmergency = preArbiterResult.immediate_danger || state.informationState === "emergency_preempted";
    const ambulanceNum = localeConfig.alternateEmergencyNumbers?.[0] || "108";

    // 1. EMERGENCY INVARIANT: If immediate danger is present, safety directive is non-negotiable
    if (isEmergency) {
      const dispatchInstructions = getEmergencyDispatchInstructions(localeConfig);
      return {
        primaryGoal: "EMERGENCY_INTERVENTION",
        conversationalFocus: "A deterministic life-threat invariant is active. Direct patient to stay seated, avoid exertion, and contact emergency ambulance immediately.",
        mustAvoidAsking: ["onset", "routine questions", "scheduling", "lengthy history"],
        bedsideTone: "urgent_and_directive",
        suggestedSpokenReply: dispatchInstructions,
      };
    }

    // 2. PATIENT OBJECTION / REPETITION ("We already talked about it?", "a minute like i said before?")
    if (semantic.intent === "patient_objection_repetition" || semantic.isObjectionRepetition) {
      const isDurationRepetition = /\b(minute|hour|second|duration|time)\b/i.test(patientUtterance) ||
        Boolean(semantic.newEvidence?.some(e => e.slot === "duration"));

      if (isDurationRepetition) {
        const dur = state.slots.duration || "about a minute";
        return {
          primaryGoal: "RESOLVE_OBJECTION_REPETITION",
          conversationalFocus: `Acknowledge that the patient previously mentioned the duration (${dur}) and validate it with humility. Clarify the distribution of weakness/numbness (unilateral vs bilateral) rather than repeating any covered topics.`,
          mustAvoidAsking: [...memory.questionsAlreadyAsked, "duration", "how long", "onset", "facial drooping", "speech difficulty"],
          bedsideTone: "empathic_and_calm",
          suggestedSpokenReply: `Thank you for bearing with me — about a minute each time, noted. When you feel that weakness or numbness, is it on one side of your body or both?`,
        };
      }

      const isThroatOrVoiceRepetition = /\b(throat|voice|insist)\b/i.test(textLower) ||
        state.slots.known_facts.some(f => /throat|voice/i.test(f));
      if (isThroatOrVoiceRepetition) {
        return {
          primaryGoal: "RESOLVE_OBJECTION_REPETITION",
          conversationalFocus: "Acknowledge patient's reaffirmed symptoms (throat pain and voice change) with humility. Reassure them that these are noted, and ask a single unasked safety or severity question without repeating previous questions.",
          mustAvoidAsking: [...memory.questionsAlreadyAsked, "voice change", "how long", "onset"],
          bedsideTone: "empathic_and_calm",
          suggestedSpokenReply: "Understood, and we have the throat pain and voice change clearly recorded. On a scale from zero to ten, how severe is the throat pain right now?",
        };
      }

      const known = memory.confirmedFacts.length > 0
        ? memory.confirmedFacts.slice(0, 3).join(", ")
        : "the symptoms we've covered";

      const frequency = memory.frequencyPattern || state.slots.duration || "";
      const refSnippet = frequency ? `that this occurs ${frequency}` : known;

      return {
        primaryGoal: "RESOLVE_OBJECTION_REPETITION",
        conversationalFocus: `Acknowledge with humility that the patient noticed repetition. Explicitly state: "You're right — I don't want to make you repeat yourself." Reassure them that you already noted ${refSnippet}, and clarify what part they feel is being retreaded or what they'd like to focus on.`,
        mustAvoidAsking: [...memory.questionsAlreadyAsked, "frequency", "known heart disease", "onset"],
        bedsideTone: "empathic_and_calm",
        suggestedSpokenReply: `You're right — I don't want to make you repeat yourself. I have noted ${refSnippet}. What part are you feeling like we're retreading, or is there a specific concern you'd like us to focus on?`,
      };
    }

    // 2.5 PATIENT CONTRADICTION / CORRECTION ("Actually it started yesterday", "No, left arm")
    if (semantic.intent === "correction" || semantic.isCorrection) {
      const detail = semantic.correctedDetail || "your updated information";
      const slot = semantic.correctedSlot || "corrected_fact";
      return {
        primaryGoal: "CONFIRM_CORRECTION_AND_PROCEED",
        conversationalFocus: `Acknowledge the patient's correction (${detail}) with clarity, gratitude, and reassurance. Do not ask for the old or new value again; confirm the updated fact and continue clinical intake.`,
        mustAvoidAsking: [...memory.questionsAlreadyAsked, slot, "onset", "when did it start"],
        bedsideTone: "attentive_and_methodical",
        suggestedSpokenReply: `Got it, thank you for clarifying — noted ${detail}. Has the discomfort been getting worse, improving, or staying about the same?`,
      };
    }

    // 2.55 UNRECONCILED CONTRADICTION CLARIFICATION
    const unclarifiedContradiction = state.contextState?.currentView.contradictions?.find(c => c.requiresClarification);
    if (unclarifiedContradiction) {
      const conceptDisplay = unclarifiedContradiction.concept.replace(/_/g, " ");
      return {
        primaryGoal: "CLARIFY_CONTRADICTION",
        conversationalFocus: `Politely clarify contradictory patient information for ${conceptDisplay} without being accusatory.`,
        mustAvoidAsking: ["medical interrogation"],
        bedsideTone: "empathic_and_calm",
        suggestedSpokenReply: `I want to make sure I understand your symptoms accurately. Earlier we recorded one detail, but just now you mentioned something different regarding ${conceptDisplay}. Could you clarify how you are feeling right now?`,
      };
    }

    // 2.6 UNCERTAINTY / PATIENT SAYS "I DON'T KNOW"
    if (semantic.intent === "uncertainty_or_unknown" || semantic.isUncertainty) {
      return {
        primaryGoal: "ACKNOWLEDGE_AND_ADVANCE",
        conversationalFocus: "Acknowledge that the patient does not know or is unsure with warm reassurance, avoid badgering them for that detail, and move smoothly to the next unasked clinical question.",
        mustAvoidAsking: [...memory.questionsAlreadyAsked, state.pendingQuestion?.targetSlot || "unknown_topic"],
        bedsideTone: "empathic_and_calm",
        suggestedSpokenReply: "That's completely fine — you don't have to know for sure. Let's focus on what you're noticing right now. Does it feel constant, or does it come and go?",
      };
    }

    // 2.7 VAGUE ANSWER ("a bit", "kind of")
    if (semantic.intent === "vague_answer") {
      return {
        primaryGoal: "GENTLE_CLARIFICATION",
        conversationalFocus: "Gently clarify the patient's vague response without sounding interrogative.",
        mustAvoidAsking: memory.questionsAlreadyAsked,
        bedsideTone: "empathic_and_calm",
        suggestedSpokenReply: "Take your time. Does it feel constant throughout the day, or does it come and go?",
      };
    }

    // 3. EMOTIONAL DISTRESS ("I'm really scared", "Am I going to die?")
    if (semantic.intent === "emotional_distress" || semantic.isEmotionalDistress) {
      return {
        primaryGoal: "VALIDATE_EMOTION_BEFORE_INQUIRY",
        conversationalFocus: "Validate the patient's fear/anxiety first with human bedside warmth. Do NOT ask checklist onset or severity questions. Invite them to breathe and share what feels most uncomfortable right now.",
        mustAvoidAsking: ["onset", "duration", "severity score", "numeric ratings"],
        bedsideTone: "empathic_and_calm",
        suggestedSpokenReply: "I hear you, and it's completely understandable to feel scared right now. Let's take this one step at a time together. Tell me what feels most uncomfortable right now.",
      };
    }

    // 4. FREQUENCY / INTERMITTENT CLARIFICATION + NEGATIVE RISK FACTORS
    // e.g. "None... but it just happens once in a month i think?"
    if (semantic.intent === "frequency_clarification" || semantic.extractedFrequency || semantic.extractedRiskFactors) {
      const freq = semantic.extractedFrequency || "about once a month";
      const hasNoneRisk = Boolean(semantic.extractedRiskFactors || /\bnone\b/i.test(textLower));

      const focus = hasNoneRisk
        ? `Acknowledge that there are no known prior heart issues, and validate the episodic intermittent pattern (${freq}) rather than a one-time constant episode.`
        : `Acknowledge the intermittent episodic pattern (${freq}).`;

      return {
        primaryGoal: "ACKNOWLEDGE_AND_EXPLORE",
        conversationalFocus: focus,
        mustAvoidAsking: ["known heart disease", "cardiac risk factors", "frequency", "how often"],
        nextHighValueInquiry: {
          topic: "episode_duration",
          clinicalRationale: "Establish how long each intermittent chest discomfort episode lasts to differentiate angina from musculoskeletal spasm, gastroesophageal reflux, or microvascular spasms.",
          suggestedPhrasing: "When it happens, how long does the chest discomfort usually last?",
        },
        bedsideTone: "attentive_and_methodical",
        suggestedSpokenReply: `Okay, so this has happened intermittently, ${freq}, rather than being a one-time episode. When it happens, how long does the chest discomfort usually last?`,
      };
    }

    // 5. ACCESS BARRIERS (Financial, Remote Outskirts, Transportation)
    if (semantic.intent === "access_barrier" || semantic.isAccessBarrier || state.structuredHistory?.accessConstraints?.financial) {
      return {
        primaryGoal: "ADDRESS_ACCESS_BARRIER",
        conversationalFocus: `Acknowledge the financial or distance barrier with genuine empathy. Reassure them that government district hospitals and 108 emergency transport provide care under public health standards without excessive private hospital costs.`,
        mustAvoidAsking: ["insurance policy", "payment method"],
        nextHighValueInquiry: {
          topic: "emergency_care_accessibility",
          clinicalRationale: "Connect patient to accessible public care facilities while confirming safety.",
          suggestedPhrasing: `We can guide you to government district hospitals or assist you in contacting the ${ambulanceNum} emergency ambulance service where standard public rates apply. Would you like to review nearby public care options?`,
        },
        bedsideTone: "empathic_and_calm",
        suggestedSpokenReply: `I understand that costs are a heavy worry, especially when you are feeling unwell. Public district hospitals and the ${ambulanceNum} ambulance service operate under standard public healthcare rates. Let's make sure you get safe medical attention without worrying about expensive private fees.`,
      };
    }

    // 6. MEMORY / CONTEXT QUERY ("Hey.. do you remember my illness?")
    if (semantic.intent === "memory_inquiry" || semantic.isMemoryInquiry) {
      const knownSymptoms = memory.confirmedFacts.filter(f => !f.toLowerCase().includes("greeting"));
      if (knownSymptoms.length > 0) {
        return {
          primaryGoal: "CLARIFY_MEMORY_OR_IDENTITY",
          conversationalFocus: `Summarize the symptoms already recorded in this active consultation (${knownSymptoms.join(", ")}), and ask what has changed since then.`,
          mustAvoidAsking: ["unrelated onset"],
          bedsideTone: "attentive_and_methodical",
          suggestedSpokenReply: `Yes — I have that context from our current consultation. We noted ${knownSymptoms.join(", ")}. What has changed since we last discussed it, or what would you like us to evaluate?`,
        };
      } else {
        return {
          primaryGoal: "CLARIFY_MEMORY_OR_IDENTITY",
          conversationalFocus: "Honestly and warmly clarify that you can follow everything in this consultation, but no illness has been described yet in this session, and ask what illness or symptoms they are referring to.",
          mustAvoidAsking: ["When did the symptoms first start?"],
          bedsideTone: "attentive_and_methodical",
          suggestedSpokenReply: "I can follow what we've discussed in this consultation, but I don't want to assume I remember a condition you haven't described here. What illness or symptoms are you referring to?",
        };
      }
    }

    // 7. META / IDENTITY QUERY ("Who are you?", "Are you real?", "Is this private?")
    if (semantic.intent === "meta_inquiry" || semantic.isMetaInquiry) {
      let reply = "I'm Dr. Sarah Chen, lead physician for MedVoice AI. I work alongside our clinical board to evaluate your symptoms safely. How can I help you today?";
      if (/private|confidential|secure/i.test(textLower)) {
        reply = "Yes, your consultation is processed securely under clinical privacy standards. What symptoms or medical concerns brought you in today?";
      }
      return {
        primaryGoal: "CLARIFY_MEMORY_OR_IDENTITY",
        conversationalFocus: "Directly and warmly answer the patient's procedural or identity question before inquiring about symptoms.",
        mustAvoidAsking: ["medical interrogation"],
        bedsideTone: "empathic_and_calm",
        suggestedSpokenReply: reply,
      };
    }

    // 8. GENERAL CLINICAL INTAKE: DYNAMIC NEXT-ACTION SELECTION
    const subfields = extractSubfieldState(state.slots, state.slots.known_facts, state.conversationMemory);
    const hasChest = Boolean(state.slots.location === "chest" || /\b(chest|heart|sternum|angina|substernal)\b/i.test(state.cumulativeTranscript));
    const hasAbdomen = isAbdominalPresentation(state.cumulativeTranscript) ||
      Boolean(state.slots.location && /abdom|stomach|belly|quadrant|periumbilical|epigastr/i.test(String(state.slots.location)));
    const neuroSigns = Array.isArray(state.slots?.neurological_signs)
      ? state.slots.neurological_signs
      : typeof state.slots?.neurological_signs === "string"
      ? [state.slots.neurological_signs]
      : [];
    const hasNeuro = Boolean(neuroSigns.length > 0 || /\b(headache|dizz|droop|weak|speech)\b/i.test(state.cumulativeTranscript));
    const hasThroat = Boolean(state.slots.location === "throat" || /\b(throat|swallow|pharyngitis|voice)\b/i.test(state.cumulativeTranscript));
    const hasFatigue = /\b(tired|fatigue|exhaust|malaise|weakness|low energy)\b/i.test(state.cumulativeTranscript) ||
      state.slots.known_facts.some(f => /tired|fatigue/i.test(f));

    const slotAskCount = memory.slotAskCount || {};
    const askedQuestions = new Set(memory.questionsAlreadyAsked.map(q => q.toLowerCase()));
    const deniedSymptoms = new Set((memory.deniedSymptoms || []).map(d => d.toLowerCase()));
    const isTopicAddressed = (topic: string): boolean => {
      const topLower = topic.toLowerCase();
      // Generic slot repetition guard: if asked 2 or more times without being filled, mark exhausted!
      if ((slotAskCount[topLower] || 0) >= 2) return true;
      if (topLower === "weakness_distribution" || topLower === "numbness_distribution" || topLower === "laterality") {
        return askedQuestions.has("weakness_distribution") ||
          askedQuestions.has("numbness_distribution") ||
          askedQuestions.has("laterality") ||
          Boolean((state.slots as any).laterality) ||
          state.slots.known_facts.some(f => /laterality|distribution|head only|bilateral|unilateral|one side|both sides/i.test(f)) ||
          Boolean(memory.askedTopics && memory.askedTopics.some(t => /distribution|laterality/i.test(t)));
      }
      if (topLower === "timing_pattern" || topLower === "severity_pattern") {
        return askedQuestions.has("timing_pattern") ||
          askedQuestions.has("severity_pattern") ||
          state.slots.known_facts.some(f => /constant|intermittent|comes and goes|severity_pattern|timing_pattern/i.test(f));
      }
      if (topLower === "weakness" || topLower === "neurological_weakness") {
        return askedQuestions.has("weakness") ||
          askedQuestions.has("neurological_weakness") ||
          deniedSymptoms.has("weakness") ||
          deniedSymptoms.has("unilateral weakness") ||
          state.slots.known_facts.some(f => /weakness:\s*(?:absent|no)|no weakness/i.test(f));
      }
      if (topLower === "facial_droop") {
        return askedQuestions.has("facial_droop") ||
          deniedSymptoms.has("facial droop") ||
          deniedSymptoms.has("facial drooping") ||
          state.slots.known_facts.some(f => /droop|facial:\s*absent/i.test(f));
      }
      if (topLower === "speech_difficulty") {
        return askedQuestions.has("speech_difficulty") ||
          deniedSymptoms.has("speech") ||
          deniedSymptoms.has("speech difficulty") ||
          state.slots.known_facts.some(f => /speech:\s*absent/i.test(f));
      }
      if (topLower === "neurological_signs") {
        return askedQuestions.has("neurological_signs") ||
          (isTopicAddressed("weakness") && isTopicAddressed("facial_droop") && isTopicAddressed("speech_difficulty"));
      }
      if (topLower === "onset_pattern") {
        return subfields.onset.onsetPattern !== "unknown" || (slotAskCount[topLower] || 0) >= 2;
      }
      if (topLower === "onset_time") {
        return Boolean(subfields.onset.duration) || (slotAskCount[topLower] || 0) >= 2;
      }
      if (topLower === "onset") {
        return subfields.onset.isResolved || (slotAskCount[topLower] || 0) >= 2;
      }
      if (askedQuestions.has(topLower)) return true;
      if (deniedSymptoms.has(topLower)) return true;
      if (memory.askedTopics && memory.askedTopics.includes(topLower)) return true;
      if (memory.doNotRepeat && memory.doNotRepeat.includes(topLower)) return true;
      if (state.resolvedQuestions && state.resolvedQuestions.some(q => q.resolvedSlot === topLower)) return true;
      if (topLower === "location" || topLower === "abdominal_location") {
        return Boolean(state.slots.location) || state.slots.known_facts.some(f => /^Abdominal location:/i.test(f));
      }
      if (topLower === "associated_symptoms" || topLower === "associated_general") {
        return state.slots.associated_symptoms.length > 0;
      }
      if (state.slots.known_facts.some(f => f.toLowerCase().includes(topLower) && !/^ONSET_AND_LOCATION:/i.test(f))) return true;
      const slotVal = (state.slots as any)[topic];
      if (Array.isArray(slotVal)) {
        if (slotVal.length > 0) return true;
      } else if (slotVal) {
        return true;
      }
      if (topic === "fever" && (deniedSymptoms.has("fever") || state.slots.known_facts.some(f => /fever/i.test(f)) || state.cumulativeTranscript.toLowerCase().includes("no fever"))) return true;
      if (topic === "postural_dizziness" && (state.slots.known_facts.some(f => /dizz|lightheaded/i.test(f)) || state.cumulativeTranscript.toLowerCase().includes("dizz") || state.cumulativeTranscript.toLowerCase().includes("lightheaded"))) return true;
      if (topic === "oral_intake" && (state.slots.known_facts.some(f => /water|drink|eat|intake/i.test(f)) || state.cumulativeTranscript.toLowerCase().includes("drinking much water"))) return true;
      if (topic === "red_flag_screen" && (state.cumulativeTranscript.toLowerCase().includes("no chest pain") || state.cumulativeTranscript.toLowerCase().includes("no shortness of breath"))) return true;
      return false;
    };

    const REPHRASED_PHRASINGS: Record<string, string> = {
      onset_pattern: "Just to clarify, did your symptoms begin all at once out of nowhere, or did they develop slowly over time?",
      onset_time: "To help me understand the timeline better, roughly when did you first notice this starting?",
      onset: "To help me understand the timeline better, roughly when did this first begin?",
      swallowing_difficulty: "Just to make sure I have this completely right—are you able to swallow liquids and saliva normally, or does it feel stuck or painful?",
      fever: "Have you felt feverish, hot to the touch, or experienced any temperature spikes or chills?",
      character: "To help me understand better, how would you describe the feeling — would you say it's more of an ache, a burning sensation, or a sharp pressure?",
      severity: "On a scale from 0 to 10 where 10 is the worst discomfort imaginable, roughly where would you rate it right now?",
      radiation: "Does the discomfort stay in one spot, or do you feel it spreading to your shoulder, arm, back, or neck?",
      exertional: "Does this happen mainly when you're exerting yourself physically, or does it also happen while sitting quietly?",
      associated_symptoms: "Along with that, have you noticed any other symptoms like cold sweating, nausea, or shortness of breath?",
      abdominal_location: "Where in your abdomen does the pain feel strongest — upper, lower, right, left, around the navel, or all over?",
      location: "Where in your abdomen does the pain feel strongest — upper, lower, right, left, around the navel, or all over?",
      vomiting: "Have you had any vomiting with this?",
      gi_associated: "Have you had any vomiting, fever, or blood in your stool?",
      blood_in_stool: "Have you noticed any blood in your stool?",
      ear_pain: "Has that pain spread up into your ears at all?",
      course: "Over the last day or two, has the symptom progression been worsening, getting better, or remaining about the same?",
      neurological_signs: "Just to be thorough, have you noticed any weakness in your arms or legs?",
      weakness: "Have you noticed any weakness in your arms or legs?",
      facial_droop: "Have you noticed any facial drooping or unevenness in your smile?",
      speech_difficulty: "Have you had any trouble speaking clearly or difficulty finding your words?",
    };

    let nextInquiry: { topic: string; clinicalRationale: string; suggestedPhrasing: string } | undefined = undefined;

    if (preArbiterResult?.universal_red_flag_result?.discriminatorQuestion) {
      const dq = preArbiterResult.universal_red_flag_result.discriminatorQuestion;
      if (!isTopicAddressed(dq.intent) && !isTopicAddressed(dq.ruleId)) {
        nextInquiry = {
          topic: dq.intent,
          clinicalRationale: `Universal red-flag screen discriminator for rule ${dq.ruleId}`,
          suggestedPhrasing: dq.text,
        };
      }
    }

    if (!nextInquiry && hasChest) {
      if (!subfields.characterSeverity.character && !isTopicAddressed("character")) {
        nextInquiry = {
          topic: "character",
          clinicalRationale: "Differentiate pressure/squeezing from sharp or pleuritic pain.",
          suggestedPhrasing: "Could you describe what the discomfort feels like — is it a tight pressure, squeezing, burning, or a sharp pain?",
        };
      } else if (!subfields.onset.isResolved) {
        if (subfields.onset.duration && subfields.onset.onsetPattern === "unknown" && !isTopicAddressed("onset_pattern")) {
          nextInquiry = {
            topic: "onset_pattern",
            clinicalRationale: "Establish whether chest discomfort onset was sudden or gradual.",
            suggestedPhrasing: "Did that chest discomfort come on suddenly, or did it build up gradually?",
          };
        } else if (!subfields.onset.duration && subfields.onset.onsetPattern !== "unknown" && !isTopicAddressed("onset_time") && !isTopicAddressed("onset")) {
          nextInquiry = {
            topic: "onset_time",
            clinicalRationale: "Establish onset timeline of chest discomfort.",
            suggestedPhrasing: "When did that chest discomfort first begin?",
          };
        } else if (!subfields.onset.duration && subfields.onset.onsetPattern === "unknown" && !isTopicAddressed("onset")) {
          nextInquiry = {
            topic: "onset",
            clinicalRationale: "Establish onset acuity and timeline.",
            suggestedPhrasing: "When did this begin, and did it start suddenly or build up gradually?",
          };
        }
      } else if (!state.slots.radiation && !isTopicAddressed("radiation")) {
        nextInquiry = {
          topic: "radiation",
          clinicalRationale: "Screen for radiation into left arm, jaw, neck, or back.",
          suggestedPhrasing: "Does that chest discomfort travel anywhere, such as into your left arm, jaw, neck, or back?",
        };
      } else if (!state.slots.exertional && !isTopicAddressed("exertional")) {
        nextInquiry = {
          topic: "exertional",
          clinicalRationale: "Determine exertional vs rest ischemia.",
          suggestedPhrasing: "Does this discomfort happen when you're physically active, or does it happen while resting?",
        };
      } else if (state.slots.associated_symptoms.length === 0 && !isTopicAddressed("associated_symptoms")) {
        nextInquiry = {
          topic: "associated_symptoms",
          clinicalRationale: "Screen for diaphoresis, dyspnea, nausea, and presyncope.",
          suggestedPhrasing: "Are you feeling any shortness of breath, cold sweating, nausea, or lightheadedness alongside it?",
        };
      }
    } else if (hasAbdomen || state.presentationContext?.primary === "ABDOMINAL_PAIN" || state.presentationContext?.active.some(a => a.id === "ABDOMINAL_PAIN")) {
      const hasGiFact = (name: string) =>
        state.slots.associated_symptoms.some(s => s.toLowerCase().includes(name)) ||
        state.slots.known_facts.some(f => f.toLowerCase().includes(name)) ||
        deniedSymptoms.has(name);

      // --- PRESENTATION CONTEXT & DIMENSION REGISTRY EVALUATION ---
      // Invariant: PresentationContext describes what clinical presentation is active;
      // ClinicalState remains the only source of truth for patient-reported findings.
      const evaluatedAbdominalDims = evaluatePresentationDimensions(
        "ABDOMINAL_PAIN",
        state.slots,
        state.slots.known_facts,
        Array.from(deniedSymptoms)
      );

      const locDim = evaluatedAbdominalDims.find(d => d.dimension.id === "location");
      const charDim = evaluatedAbdominalDims.find(d => d.dimension.id === "character");
      const sevDim = evaluatedAbdominalDims.find(d => d.dimension.id === "severity");
      const vomitDim = evaluatedAbdominalDims.find(d => d.dimension.id === "vomiting");
      const feverDim = evaluatedAbdominalDims.find(d => d.dimension.id === "fever");
      const bleedDim = evaluatedAbdominalDims.find(d => d.dimension.id === "gi_bleeding");
      const diarrheaDim = evaluatedAbdominalDims.find(d => d.dimension.id === "diarrhea");

      if (locDim?.status === "unresolved" && !isTopicAddressed("abdominal_location") && !isTopicAddressed("location")) {
        nextInquiry = {
          topic: "abdominal_location",
          clinicalRationale: locDim.dimension.clinicalRationale,
          suggestedPhrasing: locDim.dimension.suggestedPhrasing,
        };
      } else if (!subfields.onset.isResolved) {
        if (subfields.onset.duration && subfields.onset.onsetPattern === "unknown" && !isTopicAddressed("onset_pattern")) {
          nextInquiry = {
            topic: "onset_pattern",
            clinicalRationale: "Establish whether abdominal pain began suddenly or built up gradually.",
            suggestedPhrasing: "Did the abdominal pain start suddenly, or did it build up gradually?",
          };
        } else if (!subfields.onset.duration && subfields.onset.onsetPattern !== "unknown" && !isTopicAddressed("onset_time") && !isTopicAddressed("onset")) {
          nextInquiry = {
            topic: "onset_time",
            clinicalRationale: "Establish how long the abdominal pain has been present.",
            suggestedPhrasing: "Roughly how long have you had this abdominal pain?",
          };
        } else if (!subfields.onset.duration && subfields.onset.onsetPattern === "unknown" && !isTopicAddressed("onset")) {
          nextInquiry = {
            topic: "onset_time",
            clinicalRationale: "Establish the timeline of abdominal pain.",
            suggestedPhrasing: "When did this abdominal pain first begin?",
          };
        }
      } else if (charDim?.status === "unresolved" && !subfields.characterSeverity.character && !isTopicAddressed("character")) {
        nextInquiry = {
          topic: "character",
          clinicalRationale: charDim.dimension.clinicalRationale,
          suggestedPhrasing: charDim.dimension.suggestedPhrasing,
        };
      } else if (sevDim?.status === "unresolved" && !subfields.characterSeverity.severity && !isTopicAddressed("severity")) {
        nextInquiry = {
          topic: "severity",
          clinicalRationale: sevDim.dimension.clinicalRationale,
          suggestedPhrasing: sevDim.dimension.suggestedPhrasing,
        };
      } else if (vomitDim?.status === "unresolved" && !hasGiFact("vomiting") && !isTopicAddressed("vomiting")) {
        nextInquiry = {
          topic: "vomiting",
          clinicalRationale: vomitDim.dimension.clinicalRationale,
          suggestedPhrasing: vomitDim.dimension.suggestedPhrasing,
        };
      } else if (feverDim?.status === "unresolved" && !hasGiFact("fever") && !isTopicAddressed("fever")) {
        nextInquiry = {
          topic: "fever",
          clinicalRationale: feverDim.dimension.clinicalRationale,
          suggestedPhrasing: feverDim.dimension.suggestedPhrasing,
        };
      } else if (bleedDim?.status === "unresolved" && !hasGiFact("blood_in_stool") && !hasGiFact("blood in stool") && !isTopicAddressed("blood_in_stool")) {
        nextInquiry = {
          topic: "blood_in_stool",
          clinicalRationale: bleedDim.dimension.clinicalRationale,
          suggestedPhrasing: bleedDim.dimension.suggestedPhrasing,
        };
      } else if (diarrheaDim?.status === "unresolved" && !hasGiFact("diarrhea") && !isTopicAddressed("diarrhea")) {
        nextInquiry = {
          topic: "diarrhea",
          clinicalRationale: diarrheaDim.dimension.clinicalRationale,
          suggestedPhrasing: diarrheaDim.dimension.suggestedPhrasing,
        };
      }

      // Check co-active supporting presentations (e.g. ACUTE_DIARRHEA for stool frequency & hydration risk)
      if (!nextInquiry && state.presentationContext?.active.some(a => a.id === "ACUTE_DIARRHEA")) {
        const diarrheaDims = evaluatePresentationDimensions(
          "ACUTE_DIARRHEA",
          state.slots,
          state.slots.known_facts,
          Array.from(deniedSymptoms)
        );
        const freqDim = diarrheaDims.find(d => d.dimension.id === "frequency");
        const hydrationDim = diarrheaDims.find(d => d.dimension.id === "hydration_status");
        const bloodDim = diarrheaDims.find(d => d.dimension.id === "blood_mucus");

        if (freqDim?.status === "unresolved" && !isTopicAddressed("frequency") && !isTopicAddressed("stool_frequency") && !state.slots.known_facts.some(f => /frequency|times\s+(?:a\s+day|in\s+the\s+past\s+24)/i.test(f))) {
          nextInquiry = {
            topic: "stool_frequency",
            clinicalRationale: freqDim.dimension.clinicalRationale,
            suggestedPhrasing: freqDim.dimension.suggestedPhrasing,
          };
        } else if (hydrationDim?.status === "unresolved" && !isTopicAddressed("hydration") && !isTopicAddressed("hydration_status") && !state.slots.known_facts.some(f => /hydration|fluids|urinat/i.test(f))) {
          nextInquiry = {
            topic: "hydration",
            clinicalRationale: hydrationDim.dimension.clinicalRationale,
            suggestedPhrasing: hydrationDim.dimension.suggestedPhrasing,
          };
        } else if (bloodDim?.status === "unresolved" && !hasGiFact("blood_in_stool") && !isTopicAddressed("blood_in_stool")) {
          nextInquiry = {
            topic: "blood_in_stool",
            clinicalRationale: bloodDim.dimension.clinicalRationale,
            suggestedPhrasing: bloodDim.dimension.suggestedPhrasing,
          };
        }
      }

      // Check safety screens from ABDOMINAL_PAIN if other dimensions are addressed
      if (!nextInquiry) {
        const rigidDim = evaluatedAbdominalDims.find(d => d.dimension.id === "rigid_abdomen");
        const syncopeDim = evaluatedAbdominalDims.find(d => d.dimension.id === "syncope_collapse");
        if (rigidDim?.status === "unresolved" && !isTopicAddressed("rigid_abdomen") && !state.slots.known_facts.some(f => /rigid|guarding|hard\s+belly/i.test(f))) {
          nextInquiry = {
            topic: "rigid_abdomen",
            clinicalRationale: rigidDim.dimension.clinicalRationale,
            suggestedPhrasing: rigidDim.dimension.suggestedPhrasing,
          };
        } else if (syncopeDim?.status === "unresolved" && !isTopicAddressed("syncope") && !state.slots.known_facts.some(f => /faint|dizz|lightheaded|syncope/i.test(f))) {
          nextInquiry = {
            topic: "syncope",
            clinicalRationale: syncopeDim.dimension.clinicalRationale,
            suggestedPhrasing: syncopeDim.dimension.suggestedPhrasing,
          };
        }
      }
    } else if (hasNeuro) {
      const isWeaknessUncertain = (memory.uncertainties && memory.uncertainties.includes("weakness")) ||
        neuroSigns.some(s => /weak.*uncertain/i.test(s)) ||
        state.slots.known_facts.some(f => /weakness:\s*uncertain/i.test(f));
      const weaknessReported = neuroSigns.some(s => /weak|drift|paralysis|cannot lift/i.test(s)) && !isWeaknessUncertain;
      const numbnessReported = neuroSigns.some(s => /numb|pins|tingl/i.test(s));
      const lateralityAddressed = isTopicAddressed("weakness_distribution") ||
        isTopicAddressed("numbness_distribution") ||
        isTopicAddressed("laterality") ||
        Boolean((state.slots as any).laterality) ||
        state.slots.known_facts.some(f => /laterality|distribution|head only|bilateral|unilateral|one side|both sides/i.test(f));

      if (isWeaknessUncertain && !isTopicAddressed("weakness")) {
        nextInquiry = {
          topic: "weakness",
          clinicalRationale: "Clarify whether patient has true motor weakness (difficulty lifting limbs or moving).",
          suggestedPhrasing: "Regarding the weakness you mentioned, are you having trouble lifting your arm or moving your leg?",
        };
      } else if (weaknessReported && !lateralityAddressed) {
        nextInquiry = {
          topic: "weakness_distribution",
          clinicalRationale: "Clarify whether weakness is unilateral (focal stroke/TIA) or bilateral/generalized.",
          suggestedPhrasing: "When that weakness happens, is it on one side of your body, or on both sides?",
        };
      } else if (numbnessReported && !lateralityAddressed) {
        nextInquiry = {
          topic: "numbness_distribution",
          clinicalRationale: "Clarify whether numbness is unilateral/focal or non-focal/generalized.",
          suggestedPhrasing: "Is that numbness on one side of your body or both sides, or where do you feel it?",
        };
      } else if (neuroSigns.length === 0 && !isTopicAddressed("weakness")) {
        nextInquiry = {
          topic: "weakness",
          clinicalRationale: "Screen for focal limb weakness / hemiparesis.",
          suggestedPhrasing: "Have you noticed any weakness in your arms or legs?",
        };
      } else if (neuroSigns.length === 0 && !isTopicAddressed("facial_droop")) {
        nextInquiry = {
          topic: "facial_droop",
          clinicalRationale: "Screen for acute facial droop or facial asymmetry.",
          suggestedPhrasing: "Have you noticed any facial drooping or unevenness in your smile?",
        };
      } else if (neuroSigns.length === 0 && !isTopicAddressed("speech_difficulty")) {
        nextInquiry = {
          topic: "speech_difficulty",
          clinicalRationale: "Screen for dysarthria or speech difficulty.",
          suggestedPhrasing: "Have you had any trouble speaking clearly or difficulty finding your words?",
        };
      } else if (!state.slots.duration && !isTopicAddressed("duration") && !memory.durationPattern) {
        nextInquiry = {
          topic: "duration",
          clinicalRationale: "Establish episode duration to differentiate transient orthostasis from persistent deficits.",
          suggestedPhrasing: "When these episodes happen, roughly how long does each one last?",
        };
      } else if (!subfields.onset.isResolved) {
        if (subfields.onset.duration && subfields.onset.onsetPattern === "unknown" && !isTopicAddressed("onset_pattern")) {
          nextInquiry = {
            topic: "onset_pattern",
            clinicalRationale: "Establish whether neurological symptoms began suddenly (concerning for vascular event) or gradually.",
            suggestedPhrasing: "Did it come on suddenly, or did it gradually get worse?",
          };
        } else if (!subfields.onset.duration && subfields.onset.onsetPattern !== "unknown" && !isTopicAddressed("onset_time") && !isTopicAddressed("onset")) {
          nextInquiry = {
            topic: "onset_time",
            clinicalRationale: "Establish timeline of neurological symptoms.",
            suggestedPhrasing: "Roughly when did you first notice these neurological symptoms?",
          };
        } else if (!subfields.onset.duration && subfields.onset.onsetPattern === "unknown" && !isTopicAddressed("onset")) {
          nextInquiry = {
            topic: "onset",
            clinicalRationale: "Establish symptom timeline and progression.",
            suggestedPhrasing: "When did you first notice these symptoms?",
          };
        }
      } else if (!isTopicAddressed("timing_pattern") && !state.slots.known_facts.some(f => /constant|intermittent|comes and goes|severity_pattern/i.test(f))) {
        nextInquiry = {
          topic: "timing_pattern",
          clinicalRationale: "Clarify whether headache and sensory symptoms are constant or fluctuate/come and go.",
          suggestedPhrasing: "Does the headache feel constant, or does it come and go in waves?",
        };
      } else if (!isTopicAddressed("orthostatic_exacerbation") && !state.slots.known_facts.some(f => /stand|walk|postur|position|lying down/i.test(f))) {
        nextInquiry = {
          topic: "orthostatic_exacerbation",
          clinicalRationale: "Check if headache or dizziness worsens upon standing or walking (orthostatic/positional headache).",
          suggestedPhrasing: "Does the headache or dizziness get worse when you stand up or walk around?",
        };
      } else if (!isTopicAddressed("red_flag_screen") && !state.slots.known_facts.some(f => /neck stiffness|vision changes/i.test(f))) {
        nextInquiry = {
          topic: "red_flag_screen",
          clinicalRationale: "Screen for secondary headache red flags (neck stiffness).",
          suggestedPhrasing: "Have you noticed any stiff neck alongside this?",
        };
      }
    } else {
      const hasVoiceChange = /\b(voice\s+has\s+been\s+ruined|voice\s+changed|voice\s+is\s+different|lost\s+my\s+voice|hoarse|hoarseness)\b/i.test(patientUtterance) ||
        state.slots.associated_symptoms.some(s => /voice/i.test(s));
      const hasThroat = /\b(throat|swallow)\b/i.test(patientUtterance) ||
        state.slots.known_facts.some(f => /throat/i.test(f));

      // Check for painful swallowing (odynophagia)
      const hasOdynophagia = /\b(?:hurts?|painful|pain|burning|sharp)\s+(?:when\s+(?:i\s+)?swallow|to\s+swallow|swallowing)\b/i.test(patientUtterance) ||
        state.slots.known_facts.some(f => /odynophagia|painful\s+swallowing/i.test(f)) ||
        state.slots.associated_symptoms.some(s => /painful\s+swallowing/i.test(s));
      const swallowingAssessed = isTopicAddressed("swallowing_difficulty") || isTopicAddressed("dysphagia");

      // Pivot to new voice change finding if just reported
      if (hasVoiceChange && !isTopicAddressed("voice_character")) {
        nextInquiry = {
          topic: "voice_character",
          clinicalRationale: "Patient communicated a voice change. Differentiate hoarseness / laryngitis from aphonia or upper airway difficulty.",
          suggestedPhrasing: "The voice change is useful to know. Is it more like hoarseness, weakness, or difficulty producing your voice?",
        };
      } else if (hasOdynophagia && !swallowingAssessed) {
        nextInquiry = {
          topic: "swallowing_difficulty",
          clinicalRationale: "Patient reported painful swallowing (odynophagia); screen specifically for mechanical obstruction or inability to swallow fluids (true dysphagia).",
          suggestedPhrasing: "When you say it hurts to swallow, are you still able to swallow liquids and saliva normally?",
        };
      } else if (!subfields.onset.isResolved) {
        if (subfields.onset.duration && subfields.onset.onsetPattern === "unknown" && !isTopicAddressed("onset_pattern")) {
          nextInquiry = {
            topic: "onset_pattern",
            clinicalRationale: "Timeline/duration is established; determine whether onset was sudden or built up gradually.",
            suggestedPhrasing: "Did it come on suddenly, or did it gradually get worse?",
          };
        } else if (!subfields.onset.duration && subfields.onset.onsetPattern !== "unknown" && !isTopicAddressed("onset_time") && !isTopicAddressed("onset")) {
          nextInquiry = {
            topic: "onset_time",
            clinicalRationale: "Onset pattern is established; determine timeline / how long symptoms have persisted.",
            suggestedPhrasing: "Roughly how long have you had this, or when did it begin?",
          };
        } else if (!subfields.onset.duration && subfields.onset.onsetPattern === "unknown" && !isTopicAddressed("onset")) {
          nextInquiry = {
            topic: "onset",
            clinicalRationale: "Establish symptom timeline and progression.",
            suggestedPhrasing: "Could you tell me roughly when this began?",
          };
        }
      } else if (hasThroat && !state.slots.known_facts.some(f => /course/i.test(f)) && !isTopicAddressed("course")) {
        nextInquiry = {
          topic: "course",
          clinicalRationale: "Establish course and progression of throat symptoms.",
          suggestedPhrasing: "Has the throat pain been getting worse, improving, or staying about the same?",
        };
      } else if (hasThroat && !isTopicAddressed("swallowing_difficulty")) {
        const hasOdynophagia = state.slots.known_facts.some(f => /odynophagia|painful\s+swallowing/i.test(f)) ||
          state.slots.associated_symptoms.some(s => /painful\s+swallowing/i.test(s));
        nextInquiry = {
          topic: "swallowing_difficulty",
          clinicalRationale: hasOdynophagia
            ? "Patient reported painful swallowing (odynophagia); screen specifically for mechanical obstruction or inability to swallow fluids (true dysphagia)."
            : "Screen for red-flag dysphagia, peritonsillar abscess, and upper airway compromise.",
          suggestedPhrasing: hasOdynophagia
            ? "I understand that swallowing is painful. Despite the pain, are you still able to swallow liquids and keep them down without choking?"
            : "Have you had any difficulty swallowing liquids or your own saliva?",
        };
      } else if (hasThroat && !isTopicAddressed("fever")) {
        nextInquiry = {
          topic: "fever",
          clinicalRationale: "Screen for systemic infection and bacterial pharyngitis.",
          suggestedPhrasing: "Have you had a fever or chills?",
        };
      } else if (!subfields.characterSeverity.character && !isTopicAddressed("character")) {
        nextInquiry = {
          topic: "character",
          clinicalRationale: hasFatigue ? "Assess functional impact and quality of fatigue." : "Establish symptom sensation and quality.",
          suggestedPhrasing: hasFatigue
            ? "Could you describe what this fatigue feels like — does it make it hard to get out of bed, or is it a general exhaustion?"
            : "Could you describe what the sensation feels like — is it sharp, burning, dull, or a tight pressure?",
        };
      } else if (!subfields.characterSeverity.severity && !isTopicAddressed("severity")) {
        nextInquiry = {
          topic: "severity",
          clinicalRationale: "Quantify symptom pain or fatigue intensity.",
          suggestedPhrasing: "How severe is that discomfort right now on a scale from zero to ten?",
        };
      } else if (hasFatigue && !isTopicAddressed("postural_dizziness")) {
        nextInquiry = {
          topic: "postural_dizziness",
          clinicalRationale: "Screen for orthostatic hypotension, dehydration, and lightheadedness in fatigue.",
          suggestedPhrasing: "Do you feel lightheaded or dizzy when you stand up quickly?",
        };
      } else if (hasFatigue && !isTopicAddressed("oral_intake")) {
        nextInquiry = {
          topic: "oral_intake",
          clinicalRationale: "Assess hydration and oral caloric intake.",
          suggestedPhrasing: "How has your fluid and food intake been since this started — have you been drinking plenty of water?",
        };
      } else if (hasFatigue && !isTopicAddressed("red_flag_screen")) {
        nextInquiry = {
          topic: "red_flag_screen",
          clinicalRationale: "Screen for cardiopulmonary and neurological red flags in fatigue.",
          suggestedPhrasing: "Are you having any shortness of breath or chest pain?",
        };
      } else if (hasThroat && !isTopicAddressed("ear_pain")) {
        nextInquiry = {
          topic: "ear_pain",
          clinicalRationale: "Screen for referred otalgia.",
          suggestedPhrasing: "Are you feeling any ear pain or pain radiating to your ears?",
        };
      } else if (subfields.episodic.isEpisodic) {
        if (!subfields.episodic.episodeDuration && !isTopicAddressed("duration")) {
          nextInquiry = {
            topic: "duration",
            clinicalRationale: "Frequency is known; quantify duration of individual episodes.",
            suggestedPhrasing: "When these episodes happen, roughly how long does each one last?",
          };
        } else if (!subfields.episodic.frequency && !isTopicAddressed("frequency")) {
          nextInquiry = {
            topic: "frequency",
            clinicalRationale: "Episode duration is known; quantify frequency of occurrence.",
            suggestedPhrasing: "How often do these episodes tend to occur?",
          };
        }
      }
    }

    // --- GENERIC PRESENTATION CONTEXT & DIMENSION REGISTRY INQUIRY ---
    // If nextInquiry hasn't been set by specialized branches or if an active presentation has unresolved dimensions:
    if (!nextInquiry && state.presentationContext?.active && state.presentationContext.active.length > 0) {
      // Prioritize primary presentation, then supporting presentations
      const presOrder = [
        ...(state.presentationContext.primary ? [state.presentationContext.primary] : []),
        ...state.presentationContext.supporting,
        ...state.presentationContext.active.map(a => a.id),
      ];
      const seenPres = new Set<string>();

      for (const presId of presOrder) {
        if (seenPres.has(presId)) continue;
        seenPres.add(presId);

        const evaluated = evaluatePresentationDimensions(
          presId,
          state.slots,
          state.slots.known_facts,
          Array.from(deniedSymptoms)
        );

        // Sort dimensions: core_history -> associated -> safety_screen
        const orderedDims = [
          ...evaluated.filter(d => d.dimension.type === "core_history"),
          ...evaluated.filter(d => d.dimension.type === "associated"),
          ...evaluated.filter(d => d.dimension.type === "safety_screen"),
        ];

        const unresolved = orderedDims.find(d => {
          if (d.status !== "unresolved") return false;
          const dimSlot = d.dimension.evaluatorSlot;
          const dimId = d.dimension.id;
          if (isTopicAddressed(dimSlot) || isTopicAddressed(dimId)) return false;
          if (state.slots.known_facts.some(f => f.toLowerCase().includes(dimId.toLowerCase()) || f.toLowerCase().includes(dimSlot.toLowerCase()))) return false;
          return true;
        });

        if (unresolved) {
          nextInquiry = {
            topic: unresolved.dimension.evaluatorSlot || unresolved.dimension.id,
            clinicalRationale: unresolved.dimension.clinicalRationale,
            suggestedPhrasing: unresolved.dimension.suggestedPhrasing,
          };
          break;
        }
      }
    }

    const defaultPhrasing = nextInquiry?.suggestedPhrasing ||
      (hasAbdomen
        ? "Where in your abdomen does the pain feel strongest — upper, lower, right, left, around the navel, or all over?"
        : "Could you tell me a little more about what you're experiencing?");

    const mustAvoid = [...memory.questionsAlreadyAsked];
    if (subfields.onset.duration) {
      mustAvoid.push("onset", "when did it begin", "when did this begin", "how long have you had", "started a week");
    }
    if (subfields.onset.onsetPattern !== "unknown") {
      mustAvoid.push("onset_pattern", "started suddenly", "built up gradually");
    }
    if (subfields.characterSeverity.severity) {
      mustAvoid.push("severity", "scale from zero to ten", "0-10");
    }
    if (subfields.characterSeverity.character) {
      mustAvoid.push("character", "describe what it feels like");
    }
    if (subfields.episodic.frequency) {
      mustAvoid.push("frequency", "how often");
    }
    if (subfields.episodic.episodeDuration) {
      mustAvoid.push("how long does each one last");
    }
    if (state.slots.location || state.slots.known_facts.some(f => /^Abdominal location:/i.test(f))) {
      mustAvoid.push("abdominal_location", "location", "where in your abdomen");
    }
    if (state.slots.associated_symptoms.some(s => /diarrh|loose/i.test(s))) {
      mustAvoid.push("associated_symptoms", "what else you've been noticing", "any other symptoms");
    }

    const allEvaluatedDims: DimensionEvaluation[] = [];
    if (state.presentationContext?.active) {
      for (const activePres of state.presentationContext.active) {
        allEvaluatedDims.push(
          ...evaluatePresentationDimensions(
            activePres.id,
            state.slots,
            state.slots.known_facts,
            Array.from(deniedSymptoms)
          )
        );
      }
    }

    return {
      primaryGoal: "ADVANCE_CLINICAL_INTAKE",
      conversationalFocus: `Directly acknowledge what the patient just stated. If they shared a new finding, validate it naturally. Then ask ONE high-yield question: ${nextInquiry?.topic || "clarification"}.`,
      mustAvoidAsking: Array.from(new Set(mustAvoid)),
      nextHighValueInquiry: nextInquiry,
      bedsideTone: "attentive_and_methodical",
      suggestedSpokenReply: sanitizeDosageVerbalization(defaultPhrasing),
      evaluatedDimensions: allEvaluatedDims.length > 0 ? allEvaluatedDims : undefined,
    };
  }
}

export const responsePlanner = new ResponsePlanner();
