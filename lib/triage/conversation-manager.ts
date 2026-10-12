import { AgentRequest, PendingQuestion, PatientCase } from "../agents/schemas";
import { evaluatePreArbiter, PreArbiterResult } from "./pre-arbiter";
import { CardiologyAgent } from "../agents/specialists/cardiology-agent";
import { NeurologyAgent } from "../agents/specialists/neurology-agent";
import { PediatricsAgent } from "../agents/specialists/pediatrics-agent";
import { OtolaryngologyAgent } from "../agents/specialists/ent-agent";
import { ConversationInterpreter } from "./conversation-interpreter";
import { LocaleConfig, DEFAULT_LOCALE_CONFIG, getEmergencyDispatchInstructions } from "../config/locale";
import { clinicalDecisionEngine } from "./clinical-decision-engine";
import { responsePlanner, ResponsePlan } from "./response-planner";
import { extractSubfieldState, extractNumericSeverity, extractEpisodicSeverity, extractGiAssociatedSymptoms, parseAbdominalLocations, ABDOMINAL_LOCATION_LABELS, NON_DENIABLE_SLOTS, parseOnsetDimensions, isAbdominalPresentation, controlledFactReconciliationEngine } from "./clinical-state";
import { PatientProfile, CallerProfile, ConversationalAction, ServerTurnTelemetry, CandidateFactProposal } from "../clinical-knowledge/types";
import { PresentationContext } from "../clinical-knowledge/presentation-types";
import { presentationClassifier } from "../clinical-knowledge/presentation-classifier";
import { generateDoctorTurnResponse } from "../ai/clinical-llm";
import { DOCTOR_PROFILES } from "../../config/doctors";

export interface ConversationMemory {
  confirmedFacts: string[];
  deniedSymptoms: string[];
  questionsAlreadyAsked: string[];
  askedTopics?: string[];
  lastDoctorQuestion?: string;
  patientCorrections: Array<{ target: string; value: string }>;
  patientObjections: string[];
  patientConcerns: string[];
  accessConstraints: string[];
  frequencyPattern?: string;
  durationPattern?: string;
  riskFactors?: string;
  uncertainties: string[];
  slotAskCount?: Record<string, number>;
}

export interface DomainSufficiencyStatus {
  status: "inactive" | "gathering" | "sufficient";
  missing: string[];
}

export interface ClinicalInterviewState {
  phase: "dormant" | "active_inquiring" | "deliberating" | "decided";
  informationState: "insufficient" | "sufficient_for_specialist" | "sufficient_for_decision" | "emergency_preempted";
  caseVersion: number;
  slots: {
    onset?: string;
    onset_pattern?: string;
    duration?: string;
    acute_worsening?: boolean;
    character?: string;
    location?: string;
    radiation?: string;
    exertional?: boolean | string;
    severity?: string;
    baseline_severity?: string;
    peak_severity?: string;
    severity_pattern?: "constant" | "intermittent";
    associated_symptoms: string[];
    neurological_signs: string[];
    pediatric_signs: string[];
    known_facts: string[];
  };
  pendingQuestion: PendingQuestion | null;
  agentRequests: AgentRequest[];
  resolvedQuestions: Array<{
    questionId: string;
    askedBy: string;
    question: string;
    patientAnswer: string;
    resolvedSlot: string;
    slotValue: string;
  }>;
  domainSufficiency: {
    general: DomainSufficiencyStatus;
    cardiology: DomainSufficiencyStatus;
    neurology: DomainSufficiencyStatus;
    pediatrics: DomainSufficiencyStatus;
  };
  cumulativeTranscript: string;
  emergencyDialogueState?: {
    acknowledged: boolean;
    domain: "neurology" | "cardiology" | "respiratory" | "pediatric" | "general";
    turnsCompleted: number;
    addressedSymptoms: string[];
  };
  structuredHistory?: {
    chiefComplaint?: string;
    timeline: {
      anchor?: string;
      duration?: string;
      isSudden?: boolean;
      temporalShiftDetected?: boolean;
      temporalShiftDescription?: string;
    };
    unansweredDimensions: string[];
    patientCorrections: Array<{ slot: string; from: string; to: string }>;
    patientQuestions: string[];
    recentDoctorReplies: string[];
    turnCount: number;
    accessConstraints?: {
      financial?: boolean;
      remoteLocation?: boolean;
      transportation?: "available" | "unavailable" | "unknown";
      caregiverAvailable?: boolean;
      locationPermission?: "granted" | "denied" | "unknown";
      userLocation?: { latitude?: number; longitude?: number; city?: string };
    };
    evidenceStatus?: {
      enoughForDisposition: boolean;
      missingKeyDimensions: string[];
      clinicalConfidence: "insufficient" | "moderate" | "high";
      dispositionTier: "emergency" | "urgent_evaluation" | "routine_evaluation" | "self_care_with_monitoring" | "insufficient_information";
    };
    nearbyHospitals?: any[];
  };
  conversationMemory?: ConversationMemory;
  responsePlan?: ResponsePlan;
  patientProfile?: PatientProfile;
  presentationContext?: PresentationContext;
}

export interface ConversationTurnResult {
  action: "ASK_PATIENT" | "CLARIFY" | "CONVENE_BOARD" | "EMERGENCY_CONVENE_BOARD";
  doctorReply: string;
  doctorName: string;
  specialty: string;
  doctorAvatar?: string;
  activeAgentRequest?: AgentRequest;
  state: ClinicalInterviewState;
  preArbiterResult: any;
  telemetry?: ServerTurnTelemetry;
  conversationalAction?: ConversationalAction;
  understoodContext?: string;
  candidateFacts?: CandidateFactProposal[];
}

export interface ProcessTurnOptions {
  enableLiveGeneration?: boolean;
  callerProfile?: CallerProfile;
  patientProfile?: PatientProfile;
  conversationHistory?: Array<{ role: "patient" | "doctor" | "assistant"; text?: string; content?: string }>;
}

/**
 * CONVERSATIONAL STATE MANAGER & TRAFFIC CONTROLLER
 * Invariants:
 * 1. Pre-Arbiter runs on EVERY turn (Safety > Conversational State > Specialist Reasoning).
 * 2. Specialists emit AgentRequests; Sarah remains the sole patient-facing voice.
 * 3. Pending questions are resolved semantically; confirmations ("I said head?") never loop.
 * 4. Case version propagates and invalidates stale questions on emergency shifts.
 */
export class ConversationManager {
  private cardiology = new CardiologyAgent();
  private neurology = new NeurologyAgent();
  private pediatrics = new PediatricsAgent();
  private ent = new OtolaryngologyAgent();
  private interpreter = new ConversationInterpreter();
  private patientProfile: PatientProfile | null = null;

  public setPatientProfile(profile: PatientProfile | null) {
    this.patientProfile = profile;
  }

  public getPatientProfile(): PatientProfile | null {
    return this.patientProfile;
  }

  /**
   * Initialize a fresh interview state
   */
  public createInitialState(): ClinicalInterviewState {
    return {
      phase: "dormant",
      informationState: "insufficient",
      caseVersion: 1,
      slots: {
        associated_symptoms: [],
        neurological_signs: [],
        pediatric_signs: [],
        known_facts: []
      },
      pendingQuestion: null,
      agentRequests: [],
      resolvedQuestions: [],
      domainSufficiency: {
        general: { status: "gathering", missing: ["onset", "character"] },
        cardiology: { status: "inactive", missing: [] },
        neurology: { status: "inactive", missing: [] },
        pediatrics: { status: "inactive", missing: [] }
      },
      cumulativeTranscript: "",
      emergencyDialogueState: {
        acknowledged: false,
        domain: "general",
        turnsCompleted: 0,
        addressedSymptoms: []
      },
      structuredHistory: {
        chiefComplaint: undefined,
        timeline: {},
        unansweredDimensions: [
          "onset_time",
          "sudden_vs_gradual",
          "speech_difficulty",
          "visual_deficit",
          "severe_headache",
          "leg_mobility"
        ],
        patientCorrections: [],
        patientQuestions: [],
        recentDoctorReplies: [],
        turnCount: 0,
        accessConstraints: {
          financial: false,
          remoteLocation: false,
          transportation: "unknown",
          caregiverAvailable: undefined,
          locationPermission: "unknown",
        },
        evidenceStatus: {
          enoughForDisposition: false,
          missingKeyDimensions: ["onset", "character", "severity", "progression"],
          clinicalConfidence: "insufficient",
          dispositionTier: "insufficient_information",
        },
        nearbyHospitals: [],
      },
      conversationMemory: {
        confirmedFacts: [],
        deniedSymptoms: [],
        questionsAlreadyAsked: [],
        askedTopics: [],
        patientCorrections: [],
        patientObjections: [],
        patientConcerns: [],
        accessConstraints: [],
        uncertainties: [],
      },
      presentationContext: {
        active: [],
        supporting: [],
      },
    };
  }

  /**
   * Semantic interpretation of patient utterance against pending question and clinical context.
   */
  public interpretUtterance(
    utterance: string,
    pendingQuestion: PendingQuestion | null,
    state: ClinicalInterviewState
  ): {
    intent: "answer_question" | "confirmation" | "ambiguous" | "unrelated";
    resolvedSlot?: string;
    resolvedValue?: any;
    clarificationNeeded?: string;
  } {
    const text = utterance.trim();
    const textLower = text.toLowerCase();

    // 1. Detect Confirmation / Reiteration Intent ("I said head?", "I told you head", "Yeah my head")
    const isConfirmation =
      /^is+(?:alreadys+)?(?:said|tolds+you)s+(.+?)[.!?s]*$/i.test(textLower) ||
      /(?:is+said|likes+is+said)/i.test(textLower) ||
      (text.endsWith("?") && pendingQuestion && state.slots[pendingQuestion.targetSlot as keyof typeof state.slots]);

    if (isConfirmation && pendingQuestion && state.slots[pendingQuestion.targetSlot as keyof typeof state.slots]) {
      return {
        intent: "confirmation",
        resolvedSlot: pendingQuestion.targetSlot,
        resolvedValue: state.slots[pendingQuestion.targetSlot as keyof typeof state.slots]
      };
    }

    // 2. Resolve based on Pending Question Target Slot
    if (pendingQuestion) {
      const slot = pendingQuestion.targetSlot;

      // A. RADIATION
      if (slot === "radiation") {
        // Head / Atypical
        if (/\b(?:head|my\s+head|to\s+my\s+head|into\s+my\s+head|up\s+to\s+my\s+head)\b/i.test(textLower)) {
          return { intent: "answer_question", resolvedSlot: "radiation", resolvedValue: "head" };
        }
        // Arm / Shoulder
        if (/\b(?:(?:(?:left|right)\s+)?arm|shoulder|bicep|hand|elbow)\b/i.test(textLower)) {
          const isLeft = /\bleft\b/i.test(textLower);
          return { intent: "answer_question", resolvedSlot: "radiation", resolvedValue: isLeft ? "left arm" : "arm" };
        }
        // Jaw / Neck / Throat
        if (/\b(?:jaw|neck|throat|teeth|chin)\b/i.test(textLower)) {
          return { intent: "answer_question", resolvedSlot: "radiation", resolvedValue: "jaw / neck" };
        }
        // Back / Scapula
        if (/\b(?:back|between\s+(?:my\s+)?shoulder\s+blades|spine)\b/i.test(textLower)) {
          return { intent: "answer_question", resolvedSlot: "radiation", resolvedValue: "back / interscapular" };
        }
        // None / Localized
        if (/\b(?:no|nowhere|stays?\s+(?:right\s+)?there|doesn't\s+(?:spread|travel|move)|only\s+(?:in\s+my\s+)?chest|none)\b/i.test(textLower)) {
          return { intent: "answer_question", resolvedSlot: "radiation", resolvedValue: "none (localized)" };
        }
        // Ambiguous upward
        if (/\b(?:up|upward|higher|above)\b/i.test(textLower) && !/\b(?:head|jaw|neck|arm)\b/i.test(textLower)) {
          return {
            intent: "ambiguous",
            clarificationNeeded: "When you say it moves upward, does it reach into your jaw, your neck, or up into your head?"
          };
        }
      }

      // B. ONSET, DURATION & ONSET PATTERN
      if (slot === "onset" || slot === "onset_pattern" || slot === "onset_time") {
        const parsedOnset = parseOnsetDimensions(textLower);

        if (slot === "onset_pattern") {
          if (parsedOnset.onsetPattern) {
            return {
              intent: "answer_question",
              resolvedSlot: "onset_pattern",
              resolvedValue: parsedOnset.onsetPattern
            };
          }
        }

        if (slot === "onset_time") {
          if (parsedOnset.onsetTime) {
            return {
              intent: "answer_question",
              resolvedSlot: "onset_time",
              resolvedValue: parsedOnset.onsetTime
            };
          }
        }

        if (parsedOnset.onsetTime || parsedOnset.onsetPattern) {
          const onsetVal = parsedOnset.onsetTime || parsedOnset.onsetPattern!;
          const acuteWorsening = parsedOnset.acuteWorsening;

          return {
            intent: "answer_question",
            resolvedSlot: "onset",
            resolvedValue: onsetVal + (acuteWorsening ? " (acute worsening)" : "")
          };
        }
      }

      // B.2 COURSE & PROGRESSION
      if (slot === "course") {
        const hasWorsening = /\b(?:worse|worsened|increasing|increased|getting\s+worse|built\s+up)\b/i.test(textLower);
        const hasImproving = /\b(?:better|improving|improved|getting\s+better|less|easing)\b/i.test(textLower);
        const hasSame = /\b(?:same|unchanged|about\s+the\s+same|constant|stable)\b/i.test(textLower);
        const hasGradual = /\b(?:gradual(?:ly)?|slowly|over\s+time)\b/i.test(textLower);
        const hasSudden = /\b(?:sudden(?:ly)?|abrupt(?:ly)?|out\s+of\s+nowhere)\b/i.test(textLower);

        if (hasWorsening || hasImproving || hasSame || hasGradual || hasSudden) {
          let courseVal = "gradually worsening";
          if (hasImproving) courseVal = "improving";
          else if (hasSame) courseVal = "staying about the same (stable)";
          else if (hasSudden) courseVal = "sudden onset";
          else if (hasWorsening && hasGradual) courseVal = "gradually worsening over time";
          else if (hasWorsening) courseVal = "getting worse";

          return {
            intent: "answer_question",
            resolvedSlot: "course",
            resolvedValue: courseVal,
          };
        }
      }

      // B.3 DURATION & EPISODE DURATION
      if (slot === "duration") {
        const isEpisodePrompt = /how\s+long\s+does\s+each\s+(?:one\s+)?last|each\s+episode/i.test(pendingQuestion.question || "");
        const indicatesDayOrTwo = /\b(?:for\s+)?(?:a\s+day\s+or\s+two|one\s+or\s+two\s+days|1\s*[-–]\s*2\s+days)\b/i.test(textLower);

        if (isEpisodePrompt && indicatesDayOrTwo) {
          return {
            intent: "ambiguous",
            clarificationNeeded: "Just to clarify, do you mean you've been having these episodes for a day or two, or that each individual episode lasts a day or two?"
          };
        }

        const durMatch = textLower.match(/\b(?:for\s+)?(\d+\s*(?:minutes?|hours?|seconds?|days?)|(?:one|two|three|four|five|six|seven)\s+days?|a\s+minute|few\s+seconds|few\s+minutes|a\s+day\s+or\s+two)\b/i);
        if (durMatch) {
          return {
            intent: "answer_question",
            resolvedSlot: "duration",
            resolvedValue: `approx. ${durMatch[0].replace(/^for\s+/i, "").trim()}`
          };
        }
      }

      // C. EXERTIONAL RELATIONSHIP
      if (slot === "exertional") {
        if (/\b(?:stair|stairs|climb|walk|walking|exercise|active|activity|working\s+out|moving)\b/i.test(textLower)) {
          return { intent: "answer_question", resolvedSlot: "exertional", resolvedValue: "positive (exertional: climbing stairs/active)" };
        }
        if (/\b(?:rest|resting|sitting|couch|bed|sleep|out\s+of\s+nowhere|doing\s+nothing)\b/i.test(textLower)) {
          return { intent: "answer_question", resolvedSlot: "exertional", resolvedValue: "negative (occurs at rest)" };
        }
      }

      // C.5 HEADACHE ONSET CHARACTER (thunderclap vs gradual, photophobia, phonophobia)
      if (slot === "headache_onset_character") {
        // Do not let an unrelated phrase such as "a sudden flash" overwrite an
        // explicit gradual onset. parseOnsetDimensions is clause-aware.
        const parsedOnset = parseOnsetDimensions(textLower);
        const isSudden = parsedOnset.onsetPattern === "sudden";
        const isGradual = parsedOnset.onsetPattern === "gradual";
        const hasPhotophobia = /\b(?:photophob|sensitive\s+to\s+(?:bright\s+)?lights?|(?:bright\s+)?lights?\s+(?:bother|make|made|worsen)|lights?\s+(?:bother|makes?|made|worsen)|light\s+sensitivity)\b/i.test(textLower);
        const hasPhonophobia = /\b(?:phonophob|sensitive\s+to\s+(?:loud\s+)?(?:sound|sounds|noise)|(?:loud\s+)?(?:sounds?|noise)\s+(?:bother|make|made|worsen)|sound\s+sensitivity)\b/i.test(textLower) || /\bsensitive\s+to\s+(?:bright\s+)?lights?\s+(?:or|and)\s+(?:loud\s+)?(?:sounds?|noise)\b/i.test(textLower);

        if (isSudden || isGradual || hasPhotophobia || hasPhonophobia) {
          const parts: string[] = [];
          if (isSudden) parts.push("sudden onset (thunderclap character)");
          if (isGradual) parts.push("gradual onset");
          if (hasPhotophobia) parts.push("photophobia");
          if (hasPhonophobia) parts.push("phonophobia");

          // Also populate known_facts and conversationMemory
          if (isSudden || isGradual) {
            const onsetFact = isSudden ? "Onset: sudden (thunderclap)" : "Onset: gradual";
            if (!state.slots.known_facts.includes(onsetFact)) {
              state.slots.known_facts.push(onsetFact);
            }
            state.slots.onset_pattern = parsedOnset.onsetPattern;
            state.slots.acute_worsening = parsedOnset.acuteWorsening;
            if (!state.slots.known_facts.some(f => /^ONSET_TYPE:/i.test(f))) {
              state.slots.known_facts.push(`ONSET_TYPE: ${parsedOnset.onsetPattern}`);
            }
          }
          if (hasPhotophobia) {
            const fact = "Associated: photophobia (light sensitivity)";
            if (!state.slots.known_facts.includes(fact)) {
              state.slots.known_facts.push(fact);
            }
            if (!state.slots.associated_symptoms.includes("photophobia")) {
              state.slots.associated_symptoms.push("photophobia");
            }
          }
          if (hasPhonophobia) {
            const fact = "Associated: phonophobia (sound sensitivity)";
            if (!state.slots.known_facts.includes(fact)) {
              state.slots.known_facts.push(fact);
            }
            if (!state.slots.associated_symptoms.includes("phonophobia")) {
              state.slots.associated_symptoms.push("phonophobia");
            }
          }

          // Mark slot as resolved and advance
          return {
            intent: "answer_question",
            resolvedSlot: "headache_onset_character",
            resolvedValue: parts.join(", "),
          };
        }
      }

      // C.6 LEG / NERVE — RADIATION OR BACK (sciatic screening)
      if (slot === "radiation_or_back") {
        const hasBackOrigin = /\b(?:back|lower\s+back|hip|spine|butt(?:ock)?|sciatica|shoot(?:s|ing)?\s+down)\b/i.test(textLower);
        const hasNumbness = /\b(?:numb|tingl|pins\s+and\s+needles|prickling|dead\s+feeling)\b/i.test(textLower);
        const hasWeakness = /\b(?:weak|cannot\s+lift|can't\s+lift|drop\s+foot|drag|buckle|give\s+(?:out|way))\b/i.test(textLower);
        const hasSudden = /\b(?:sudden(?:ly)?|abrupt(?:ly)?|all\s+(?:of\s+)?a\s+sudden|out\s+of\s+nowhere)\b/i.test(textLower);
        const hasGradual = /\b(?:gradual(?:ly)?|built?\s+up|slowly|over\s+time)\b/i.test(textLower);
        const hasDenial = /\b(?:no|not\s+from|doesn't|does\s+not|not\s+really|just\s+(?:in\s+)?(?:my\s+)?leg)\b/i.test(textLower) && !hasBackOrigin && !hasNumbness && !hasWeakness;

        if (hasBackOrigin || hasNumbness || hasWeakness || hasSudden || hasGradual || hasDenial) {
          const parts: string[] = [];
          if (hasBackOrigin) parts.push("radiates from back/hip");
          if (hasNumbness) parts.push("numbness/tingling present");
          if (hasWeakness) parts.push("weakness reported");
          if (hasSudden) parts.push("sudden onset");
          if (hasGradual) parts.push("gradual onset");
          if (hasDenial) parts.push("no radiation from back");

          if (hasBackOrigin) {
            const fact = "Pain radiates from back/hip (sciatic pattern)";
            if (!state.slots.known_facts.includes(fact)) state.slots.known_facts.push(fact);
          }
          if (hasNumbness || hasWeakness) {
            const fact = `Neurological: ${hasNumbness ? "numbness/tingling" : ""}${hasNumbness && hasWeakness ? " + " : ""}${hasWeakness ? "weakness" : ""}`;
            if (!state.slots.known_facts.includes(fact)) state.slots.known_facts.push(fact);
          }
          if (hasSudden || hasGradual) {
            state.slots.onset = hasSudden ? "sudden" : "gradual";
          }

          return {
            intent: "answer_question",
            resolvedSlot: "radiation_or_back",
            resolvedValue: parts.join(", "),
          };
        }
      }

      // C.7 ABDOMINAL — LOCATION (do not collapse onto onset)
      if (slot === "onset_and_location" || slot === "abdominal_location" || slot === "location") {
        const locations = parseAbdominalLocations(textLower);
        const parsedOnset = parseOnsetDimensions(textLower);

        if (locations.length > 0) {
          const labels = locations.map(code => ABDOMINAL_LOCATION_LABELS[code]);
          const locFact = `Abdominal location: ${labels.join(", ")}`;
          if (!state.slots.known_facts.includes(locFact)) state.slots.known_facts.push(locFact);
          state.slots.location = labels.join(", ");
          return {
            intent: "answer_question",
            resolvedSlot: "abdominal_location",
            resolvedValue: labels.join(", "),
          };
        }

        if (parsedOnset.onsetTime || parsedOnset.onsetPattern) {
          const onsetVal = parsedOnset.onsetTime || parsedOnset.onsetPattern!;
          return {
            intent: "answer_question",
            resolvedSlot: parsedOnset.onsetPattern && !parsedOnset.onsetTime ? "onset_pattern" : "onset",
            resolvedValue: onsetVal,
          };
        }
      }

      // D. CHARACTER / QUALITY
      if (slot === "character") {
        const charMatch = textLower.match(/\b(crushing|pressure|tightness|heavy|squeezing|sharp|stabbing|burning|throbbing|ache|dull|elephant|cramp(?:ing)?|colic(?:ky)?|spasm|gnawing)\b/i);
        if (charMatch) {
          return { intent: "answer_question", resolvedSlot: "character", resolvedValue: charMatch[0] };
        }
      }

      // E. ASSOCIATED SYMPTOMS
      if (slot === "associated_symptoms" || slot === "associated_general" || slot === "gi_associated" || slot === "diarrhea") {
        const found: string[] = [];
        if (/\b(sweat|cold\s+sweats|clammy|diaphoresis)\b/i.test(textLower)) found.push("cold sweats");
        if (/\b(breath|shortness|dyspnea|gasp)\b/i.test(textLower)) found.push("shortness of breath");
        if (/\b(dizz|lightheaded|faint|presyncope|syncope|black\s*out)\b/i.test(textLower)) found.push("dizziness");
        if (/\b(headache|head\s+hurts)\b/i.test(textLower)) found.push("headache");
        if (/\b(voice\s+change|hoarse|hoarseness)\b/i.test(textLower)) found.push("voice change");
        for (const gi of extractGiAssociatedSymptoms(textLower)) {
          if (gi.status === "present") found.push(gi.name === "diarrhea" ? "diarrhea" : gi.name.replace(/_/g, " "));
        }

        if (found.length > 0) {
          return { intent: "answer_question", resolvedSlot: "associated_symptoms", resolvedValue: found };
        }
        if (/\b(no|none|neither|nothing\s+else)\b/i.test(textLower)) {
          return { intent: "answer_question", resolvedSlot: "associated_symptoms", resolvedValue: ["none reported"] };
        }
      }

      // F. VOICE CHARACTER
      if (slot === "voice_character") {
        const isHoarse = /\b(hoarse|raspy|husky|scratchy)\b/i.test(textLower);
        const isLoss = /\b(hard|cannot|can't|loss|lost|producing|struggling|whisper|weak)\b/i.test(textLower);
        const val = isHoarse ? "hoarseness" : isLoss ? "difficulty producing voice" : "voice change / hoarse quality";
        return { intent: "answer_question", resolvedSlot: "voice_character", resolvedValue: val };
      }

      // G. SWALLOWING DIFFICULTY
      if (slot === "swallowing_difficulty") {
        const hasSpecificDenial =
          /\b(?:no|not|neither|without|no\s+trouble|no\s+problem|no\s+issue|can\s+swallow\s+(?:fine|ok|normally))\s+(?:trouble\s+swallowing|difficulty\s+swallowing|problems?\s+swallowing|dysphagia)\b/i.test(textLower) ||
          /^(?:no|nope|not\s+really|neither|none|nothing|nothing\s+with\s+that|nothing\s+like\s+that|no\s+(?:trouble|problem|issue)\s+with\s+that|none\s+of\s+that)[.!?\s]*$/i.test(textLower) ||
          /\b(?:nothing\s+with\s+that|nothing\s+like\s+that|no\s+trouble\s+with\s+that|no\s+issues?\s+with\s+that|none\s+of\s+that|swallow(?:ing)?\s+is\s+(?:fine|ok|normal)|can\s+swallow\s+(?:fine|liquids|normally))\b/i.test(textLower);
        const hasSpecificComplaint = /\b(trouble\s+swallowing|difficulty\s+swallowing|hard\s+to\s+swallow|cannot\s+swallow|can't\s+swallow|choking|dysphagia)\b/i.test(textLower);
        const hasOdynophagiaOnly = /\b(?:hurts?|painful|pain|burning|sharp)\s+(?:when\s+(?:i\s+)?swallow|to\s+swallow|swallowing)\b/i.test(textLower) ||
          /\b(?:when\s+(?:i\s+)?swallow|swallowing)\s+(?:it\s+)?(?:hurts?|is\s+painful)\b/i.test(textLower);

        if (hasOdynophagiaOnly && !hasSpecificComplaint && !hasSpecificDenial) {
          return { intent: "answer_question", resolvedSlot: "odynophagia", resolvedValue: "painful swallowing" };
        }
        if (hasSpecificComplaint) {
          return { intent: "answer_question", resolvedSlot: "swallowing_difficulty", resolvedValue: "difficulty swallowing reported" };
        }
        if (hasSpecificDenial) {
          return { intent: "answer_question", resolvedSlot: "swallowing_difficulty", resolvedValue: "denied" };
        }
      }

      // H. FEVER
      if (slot === "fever") {
        const hasSpecificDenial = /\b(no\s+fever|haven'?t\s+had\s+(?:a\s+)?fever|without\s+fever|no\s+temperature|denies\s+fever)\b/i.test(textLower) ||
          /^(?:no|nope|neither|none)[.!?\s]*$/i.test(textLower);
        const hasSpecificFever = /\b(fever|chills|temperature|feverish)\b/i.test(textLower) && !hasSpecificDenial;
        return { intent: "answer_question", resolvedSlot: "fever", resolvedValue: hasSpecificDenial ? "denied" : (hasSpecificFever ? "fever reported" : "denied") };
      }

      // I. SEVERITY
      if (slot === "severity") {
        const sevVal = extractNumericSeverity(textLower, true);
        return { intent: "answer_question", resolvedSlot: "severity", resolvedValue: sevVal || text };
      }

      // J. EAR PAIN
      if (slot === "ear_pain") {
        const hasSpecificDenial = /\b(no\s+ear\s+pain|no\s+earache|ears?\s+(?:don't|do\s+not)\s+hurt)\b/i.test(textLower) ||
          /^(?:no|nope|neither|none)[.!?\s]*$/i.test(textLower);
        const hasSpecificEar = /\b(ear\s+pain|earache|ears?\s+hurts?)\b/i.test(textLower) && !hasSpecificDenial;
        return { intent: "answer_question", resolvedSlot: "ear_pain", resolvedValue: hasSpecificDenial ? "denied" : (hasSpecificEar ? "ear pain reported" : "denied") };
      }

      // K. RASH & BLEEDING TENDENCY
      if (slot === "rash_bleeding" || slot === "rash") {
        const hasSpecificDenial = /\b(no\s+rash|no\s+bleeding|no\s+spots|no\s+bruising|denies\s+rash)\b/i.test(textLower) ||
          /^(?:no|nope|neither|none|nothing)[.!?\s]*$/i.test(textLower);
        const hasSpecificFinding = /\b(rash|spots|petechiae|bruising|bleeding|red\s+dots)\b/i.test(textLower) && !hasSpecificDenial;
        return { intent: "answer_question", resolvedSlot: "rash_bleeding", resolvedValue: hasSpecificDenial ? "denied" : (hasSpecificFinding ? "rash / bleeding tendency reported" : "denied") };
      }

      // L. TRISMUS / JAW OPENING
      if (slot === "trismus" || slot === "trismus_or_jaw_opening") {
        const hasSpecificDenial = /\b(no\s+stiffness|can\s+open\s+(?:my\s+mouth|normally|fully)|no\s+trismus|jaw\s+is\s+fine)\b/i.test(textLower) ||
          /^(?:no|nope|neither|none|can\s+open\s+fine)[.!?\s]*$/i.test(textLower);
        const hasSpecificTrismus = /\b(cannot\s+open|can't\s+open|stiff\s+jaw|limited\s+opening|painful\s+to\s+open|lockjaw|trismus)\b/i.test(textLower) && !hasSpecificDenial;
        return { intent: "answer_question", resolvedSlot: "trismus", resolvedValue: hasSpecificDenial ? "denied" : (hasSpecificTrismus ? "trismus / limited jaw opening reported" : "denied") };
      }

      // F. NEUROLOGICAL SIGNS
      if (slot === "neurological_signs") {
        const signs: string[] = [];
        if (/\b(droop|face|asymmetry)\b/i.test(textLower)) signs.push("facial droop");
        if (/\b(arm|weak|cannot\s+lift|drift|leg)\b/i.test(textLower)) signs.push("unilateral limb weakness");
        if (/\b(speech|slurr|talk|words)\b/i.test(textLower)) signs.push("slurred speech / dysarthria");
        if (signs.length > 0) {
          return { intent: "answer_question", resolvedSlot: "neurological_signs", resolvedValue: signs };
        }
        if (/\b(no|none|denies|normal)\b/i.test(textLower)) {
          return { intent: "answer_question", resolvedSlot: "neurological_signs", resolvedValue: ["none reported"] };
        }
      }
    }

    // 3. Fallback opportunistic symptom extraction if pending question wasn't directly answered
    const sevMatch = extractNumericSeverity(textLower);
    if (sevMatch) {
      return { intent: "answer_question", resolvedSlot: "severity", resolvedValue: sevMatch };
    }

    if (/\b(no\s+fever|haven'?t\s+had\s+(?:a\s+)?fever|without\s+fever|denies\s+fever)\b/i.test(textLower)) {
      return { intent: "answer_question", resolvedSlot: "fever", resolvedValue: "denied" };
    }

    if (/\b(?:hurts?|painful|pain|burning|sharp)\s+(?:when\s+(?:i\s+)?swallow|to\s+swallow|swallowing)\b/i.test(textLower) ||
        /\b(?:when\s+(?:i\s+)?swallow|swallowing)\s+(?:it\s+)?(?:hurts?|is\s+painful)\b/i.test(textLower) ||
        /\bodynophagia\b/i.test(textLower)) {
      return { intent: "answer_question", resolvedSlot: "odynophagia", resolvedValue: "painful swallowing" };
    }

    if (/\b(trouble\s+swallowing|difficulty\s+swallowing|hard\s+to\s+swallow|cannot\s+swallow|can't\s+swallow|dysphagia)\b/i.test(textLower)) {
      return { intent: "answer_question", resolvedSlot: "swallowing_difficulty", resolvedValue: "difficulty swallowing reported" };
    }

    // Check affirmative stomach / abdominal location
    if (/\b(stomach|belly|abdomen|tummy|gut)\b/i.test(textLower)) {
      const idx = textLower.search(/\b(stomach|belly|abdomen|tummy|gut)\b/i);
      const before = idx !== -1 ? textLower.substring(Math.max(0, idx - 40), idx) : "";
      if (!/\b(?:no|not|don'?t\s+have|without|denies)\b/i.test(before)) {
        return { intent: "answer_question", resolvedSlot: "abdominal_location", resolvedValue: "abdomen/stomach" };
      }
    }

    if (/\b(chest|heart|sternum|angina|palpitation)\b/i.test(textLower)) {
      const idx = textLower.search(/\b(chest|heart|sternum|angina|palpitation)\b/i);
      const before = idx !== -1 ? textLower.substring(Math.max(0, idx - 40), idx) : "";
      if (!/\b(?:no|not|don'?t\s+have|without|denies)\b/i.test(before)) {
        return { intent: "answer_question", resolvedSlot: "location", resolvedValue: "chest" };
      }
    }

    return { intent: "unrelated" };
  }

  /**
   * Coordinate the next turn: Pre-Arbiter screening -> Slot updating -> Specialist requests -> Next action
   */
  public async processTurn(
    patientUtterance: string,
    existingState?: ClinicalInterviewState,
    demographics: { age?: number | null; age_group?: any; age_source?: string } = { age: null, age_group: "unknown", age_source: "unknown" },
    localeConfig: LocaleConfig = DEFAULT_LOCALE_CONFIG,
    options?: ProcessTurnOptions
  ): Promise<ConversationTurnResult> {
    const state: ClinicalInterviewState = existingState || this.createInitialState();
    const cleanMsg = patientUtterance.trim();

    if (options?.patientProfile) {
      this.patientProfile = options.patientProfile;
      state.patientProfile = options.patientProfile;
    }

    // Update cumulative transcript
    state.cumulativeTranscript = state.cumulativeTranscript
      ? `${state.cumulativeTranscript}. ${cleanMsg}`
      : cleanMsg;

    // --- STEP 1: PRE-ARBITER DETERMINISTIC SAFETY SCREENING ON EVERY TURN ---
    // (Invariant: Safety > Conversational State > Specialist Reasoning)
    const profile = this.patientProfile || state.patientProfile;
    const pAge = (profile?.age != null && profile.age > 0)
      ? profile.age
      : (demographics?.age != null && demographics.age > 0 ? demographics.age : undefined);
    const patientSpec = {
      ageYears: pAge,
      ageMonths: profile?.ageMonths ?? (profile ? (profile.age !== undefined && profile.age < 2 ? Math.round(profile.age * 12) : undefined) : undefined),
      pregnancy: profile?.pregnancy
        ? {
            status: (profile.pregnancy.isPregnant ? "pregnant" : "not_pregnant") as any,
            weeks: profile.pregnancy.gestationalWeeks,
          }
        : undefined,
      modifiers: profile?.conditions || [],
      drugAllergies: profile?.allergies?.map(a => a.allergen) || [],
    };

    const preArbiterResult = evaluatePreArbiter({
      transcript: state.cumulativeTranscript,
      demographics: {
        age: pAge ?? undefined,
        age_group: profile && typeof profile.age === "number" ? (profile.age < 1 ? "infant" : profile.age < 16 ? "pediatric" : "adult") : (demographics.age_group || "unknown"),
      },
      patientSpec,
    } as any);

    // Ingest extracted demographics & modifiers from speech into patient profile & state
    const extDemo = preArbiterResult?.universal_red_flag_result?.extractedDemographics;
    if (extDemo) {
      const extAge = (extDemo.ageYears != null && extDemo.ageYears > 0)
        ? extDemo.ageYears
        : (extDemo.ageMonths != null && extDemo.ageMonths > 0 ? Number((extDemo.ageMonths / 12).toFixed(2)) : undefined);

      if (!state.patientProfile) {
        state.patientProfile = {
          id: "caller-" + Date.now(),
          name: "Caller",
          age: extAge ?? 0,
          gender: (extDemo.sexAtBirth === "male" || extDemo.sexAtBirth === "female" ? extDemo.sexAtBirth : "other"),
          language: "en",
          conditions: [...extDemo.modifiers],
          medications: [],
          allergies: [],
          pregnancy: {
            isPregnant: !!extDemo.isPregnant,
            gestationalWeeks: undefined,
          },
        };
      } else {
        if ((!state.patientProfile.age || state.patientProfile.age === 0) && extAge) {
          state.patientProfile.age = extAge;
        }
        if (extDemo.isPregnant && !state.patientProfile.pregnancy?.isPregnant) {
          state.patientProfile.pregnancy = {
            isPregnant: true,
            gestationalWeeks: undefined,
          };
        }
        state.patientProfile.conditions = state.patientProfile.conditions || [];
        for (const m of extDemo.modifiers) {
          if (!state.patientProfile.conditions.includes(m)) {
            state.patientProfile.conditions.push(m);
          }
        }
      }

      if (extDemo.ageYears && !state.slots.known_facts.some(f => /Patient Age:/i.test(f))) {
        state.slots.known_facts.push(`Patient Age: ${extDemo.ageYears} years`);
      } else if (extDemo.ageMonths !== undefined && !state.slots.known_facts.some(f => /Patient Age:/i.test(f))) {
        state.slots.known_facts.push(`Patient Age: ${extDemo.ageMonths} months`);
      }
      for (const m of extDemo.modifiers) {
        const fact = `Comorbidity: ${m}`;
        if (!state.slots.known_facts.includes(fact)) {
          state.slots.known_facts.push(fact);
        }
      }
    }

    // Run semantic interpreter for emergency inquiry and intent awareness
    const isEmergencyActive = state.informationState === "emergency_preempted" || preArbiterResult.immediate_danger;
    const semantic = this.interpreter.interpret(cleanMsg, state.pendingQuestion, state.slots, isEmergencyActive);

    // If patient expresses active panic / inquiry during an emergency ("what do i do? no one is around")
    if (semantic.isEmergencyInquiry || semantic.intent === "emergency_inquiry") {
      state.caseVersion++;
      state.informationState = "emergency_preempted";
      state.phase = "decided";

      if (state.pendingQuestion) {
        state.pendingQuestion.status = "superseded";
      }
      state.agentRequests.forEach(req => {
        if (req.status === "pending") req.status = "superseded";
      });

      return {
        action: "EMERGENCY_CONVENE_BOARD",
        doctorReply: getEmergencyDispatchInstructions(localeConfig),
        doctorName: "Dr. Sarah Chen, MD",
        specialty: "Internal Medicine & Critical Care Lead",
        state,
        preArbiterResult
      };
    }

    // Catastrophic life threats that immediately preempt normal history taking:
    const hasEmergencyPreemptionFlag = preArbiterResult.pre_safety_flags.some(f =>
      f === "PRE_FLAG_ACUTE_NEUROLOGIC_DEFICIT" ||
      f === "PRE_FLAG_IMMEDIATE_AIRWAY_FAILURE" ||
      f === "PRE_FLAG_DEEP_NECK_INFECTION_OR_PTA" ||
      f === "PRE_FLAG_ACS_RADIATION_OR_DIAPHORESIS" ||
      f === "PRE_FLAG_PEDIATRIC_CRISIS" ||
      f === "PRE_FLAG_ACOUSTIC_SEVERE_RESPIRATORY_DISTRESS" ||
      f.startsWith("UNI-")
    ) || /\b(unconscious|unresponsive|not\s+breathing|cardiac\s+arrest|collapsed)\b/i.test(state.cumulativeTranscript);

    if (hasEmergencyPreemptionFlag || state.informationState === "emergency_preempted") {
      // Opportunistic extraction before emergency preemption
      this.extractOpportunisticFacts(state);

      // Emergency detected mid-interview (e.g. sudden facial droop, respiratory arrest, anaphylaxis)
      state.caseVersion++;
      state.informationState = "emergency_preempted";
      state.phase = "decided";

      // Supersede all outstanding non-emergency questions
      if (state.pendingQuestion) {
        state.pendingQuestion.status = "superseded";
      }
      state.agentRequests.forEach(req => {
        if (req.status === "pending") req.status = "superseded";
      });

      // State-Aware Emergency Dialogue Engine: reacts dynamically to patient's new inputs & missing facts
      const reply = this.handleEmergencyTurn(cleanMsg, state, preArbiterResult, localeConfig);

      return {
        action: "EMERGENCY_CONVENE_BOARD",
        doctorReply: reply,
        doctorName: "Dr. Sarah Chen, MD",
        specialty: "Internal Medicine & Critical Care Lead",
        state,
        preArbiterResult
      };
    }

    // Initialize conversation memory if missing
    if (!state.conversationMemory) {
      state.conversationMemory = {
        confirmedFacts: [...state.slots.known_facts],
        deniedSymptoms: [],
        questionsAlreadyAsked: [],
        askedTopics: [],
        patientCorrections: [],
        patientObjections: [],
        patientConcerns: [],
        accessConstraints: [],
        uncertainties: [],
      };
    }
    const mem = state.conversationMemory;

    // Ingest extra semantic information into memory
    if (semantic.extractedFrequency) {
      mem.frequencyPattern = semantic.extractedFrequency;
      const fact = `Frequency: ${semantic.extractedFrequency}`;
      if (!state.slots.known_facts.includes(fact)) {
        state.slots.known_facts.push(fact);
        mem.confirmedFacts.push(fact);
      }
    }
    if (semantic.extractedRiskFactors) {
      mem.riskFactors = semantic.extractedRiskFactors;
      const fact = `Risk factors: ${semantic.extractedRiskFactors}`;
      if (!state.slots.known_facts.includes(fact)) {
        state.slots.known_facts.push(fact);
        mem.confirmedFacts.push(fact);
      }
    }
    if (semantic.isObjectionRepetition) {
      mem.patientObjections.push(cleanMsg);
    }
    if (semantic.isEmotionalDistress) {
      mem.patientConcerns.push("fear / anxiety");
    }

    // Contradiction / Correction check
    if (semantic.isCorrection && semantic.correctedSlot && semantic.correctedValue) {
      const slot = semantic.correctedSlot;
      const val = semantic.correctedValue;
      (state.slots as any)[slot] = val;
      state.slots.known_facts = state.slots.known_facts.filter(f => !f.toUpperCase().startsWith(`${slot.toUpperCase()}:`));
      state.slots.known_facts.push(`${slot.toUpperCase()}: ${val}`);
      mem.patientCorrections.push({ target: slot, value: val });
      state.caseVersion++;
    }

    // Opportunistic extraction from transcript before response planning
    this.extractOpportunisticFacts(state);

    // If an existing pending question was answered, resolve it before planning the next action
    if (state.pendingQuestion && state.pendingQuestion.status === "pending") {
      const interpretation = this.interpretUtterance(cleanMsg, state.pendingQuestion, state);
      if ((interpretation.intent === "answer_question" && interpretation.resolvedSlot) || (semantic.intent === "answer_pending_question" && semantic.resolvedSlot)) {
        const slot = interpretation.resolvedSlot || semantic.resolvedSlot!;
        const val = interpretation.resolvedValue || semantic.resolvedValue!;

        if (val === "denied" || val === "negative") {
          const questionText = state.pendingQuestion?.question?.toLowerCase() || "";
          const deniedList: string[] = [];
          if (/droop/i.test(questionText)) deniedList.push("facial drooping");
          if (/speech|words|speak|slur/i.test(questionText)) deniedList.push("speech difficulty");
          if (/vision|see|blurry/i.test(questionText)) deniedList.push("vision changes");
          if (/weakness|arms?\s+or\s+legs?/i.test(questionText)) deniedList.push("unilateral weakness");
          if (/numbness/i.test(questionText)) deniedList.push("numbness");
          if (/sweat|clammy/i.test(questionText)) deniedList.push("cold sweating");
          if (/shortness\s+of\s+breath|breathing/i.test(questionText)) deniedList.push("shortness of breath");
          if (/nausea|vomit/i.test(questionText)) deniedList.push("nausea");
          if (/swallow/i.test(questionText) || slot === "swallowing_difficulty") deniedList.push("swallowing_difficulty");
          if (/fever|chills/i.test(questionText) || slot === "fever") deniedList.push("fever");
          if (/ear/i.test(questionText) || slot === "ear_pain") deniedList.push("ear_pain");
          if (/rash|bleeding|spots|bruising/i.test(questionText) || slot === "rash_bleeding") deniedList.push("rash_bleeding");
          if (/trismus|jaw/i.test(questionText) || slot === "trismus") deniedList.push("trismus");

          if (deniedList.length === 0 && !NON_DENIABLE_SLOTS.has(slot)) {
            deniedList.push(slot);
          }

          if (deniedList.length > 0) {
            deniedList.forEach(d => {
              if (state.conversationMemory && !state.conversationMemory.deniedSymptoms.includes(d)) {
                state.conversationMemory.deniedSymptoms.push(d);
              }
              if (state.conversationMemory && !state.conversationMemory.questionsAlreadyAsked.includes(d)) {
                state.conversationMemory.questionsAlreadyAsked.push(d);
              }
            });

            const fact = `Denied: ${deniedList.join(", ")}`;
            if (!state.slots.known_facts.includes(fact)) {
              state.slots.known_facts.push(fact);
            }
          }
        } else if (slot === "associated_symptoms" && Array.isArray(val)) {
          state.slots.associated_symptoms = Array.from(new Set([...state.slots.associated_symptoms, ...val]));
          state.slots.known_facts.push(`Associated: ${val.join(", ")}`);
        } else if (slot === "neurological_signs" && Array.isArray(val)) {
          state.slots.neurological_signs = Array.from(new Set([...state.slots.neurological_signs, ...val]));
          state.slots.known_facts.push(`Neurological: ${val.join(", ")}`);
        } else if (slot === "onset_pattern") {
          const pattern = val === "sudden" ? "sudden" : "gradual";
          state.slots.acute_worsening = pattern === "sudden";
          (state.slots as any).onset_pattern = pattern;
          state.slots.known_facts.push(`ONSET_TYPE: ${pattern}`);
          if (state.conversationMemory) {
            state.conversationMemory.confirmedFacts.push(`Onset pattern: ${pattern}`);
            if (!state.conversationMemory.questionsAlreadyAsked.includes("onset_pattern")) {
              state.conversationMemory.questionsAlreadyAsked.push("onset_pattern");
            }
          }
        } else if (slot === "onset_time") {
          state.slots.onset = String(val);
          state.slots.known_facts.push(`ONSET: ${val}`);
          if (state.conversationMemory) {
            state.conversationMemory.confirmedFacts.push(`Onset: ${val}`);
            if (!state.conversationMemory.questionsAlreadyAsked.includes("onset_time")) {
              state.conversationMemory.questionsAlreadyAsked.push("onset_time");
            }
          }
        } else if (slot === "abdominal_location" || (slot === "location" && isAbdominalPresentation(cleanMsg))) {
          state.slots.location = String(val);
          const locFact = `Abdominal location: ${val}`;
          if (!state.slots.known_facts.includes(locFact)) {
            state.slots.known_facts.push(locFact);
          }
        } else if (slot === "location") {
          state.slots.location = String(val);
          const locFact = `Location: ${val}`;
          if (!state.slots.known_facts.includes(locFact)) {
            state.slots.known_facts.push(locFact);
          }
        } else if (slot !== "onset_and_location") {
          (state.slots as any)[slot] = val;
          state.slots.known_facts.push(`${slot.toUpperCase()}: ${val}`);
          if (slot === "onset") {
            const parsed = parseOnsetDimensions(String(val));
            if (parsed.onsetPattern) {
              state.slots.acute_worsening = parsed.acuteWorsening;
              (state.slots as any).onset_pattern = parsed.onsetPattern;
              if (!state.slots.known_facts.some(f => f.startsWith("ONSET_TYPE:"))) {
                state.slots.known_facts.push(`ONSET_TYPE: ${parsed.onsetPattern}`);
              }
            }
          }
        }

        state.resolvedQuestions.push({
          questionId: state.pendingQuestion.id,
          askedBy: state.pendingQuestion.askedBy,
          question: state.pendingQuestion.question,
          patientAnswer: cleanMsg,
          resolvedSlot: slot,
          slotValue: String(val)
        });
        state.pendingQuestion.status = "resolved";
        state.pendingQuestion = null;

        state.agentRequests.forEach(r => {
          if (r.targetSlot === slot && r.status === "pending") {
            r.status = "resolved";
          }
        });

        state.caseVersion++;
      } else if (interpretation.intent === "confirmation" || semantic.isConfirmationOrRepetition || semantic.intent === "confirmation_or_correction") {
        const confirmedSlot = interpretation.resolvedSlot || semantic.resolvedSlot || (state.pendingQuestion ? state.pendingQuestion.targetSlot : "information");
        const confirmedVal = interpretation.resolvedValue || semantic.resolvedValue || (state.slots as any)[confirmedSlot] || "noted";
        if (state.pendingQuestion) {
          state.pendingQuestion.status = "resolved";
          state.pendingQuestion = null;
        }
        state.caseVersion++;
        state.agentRequests.forEach(r => {
          if (r.targetSlot === confirmedSlot && r.status === "pending") r.status = "resolved";
        });
      } else if (interpretation.intent === "ambiguous" && interpretation.clarificationNeeded) {
        return {
          action: "CLARIFY",
          doctorReply: interpretation.clarificationNeeded,
          doctorName: "Dr. Sarah Chen, MD",
          specialty: "Internal Medicine & General Practice",
          state,
          preArbiterResult
        };
      }
    }

    // Refresh opportunistic facts after resolving pending answer
    this.extractOpportunisticFacts(state);

    // --- STEP 1.4: MULTI-PRESENTATION SYNDROME CLASSIFICATION ---
    // Invariant: Identifies active presentations without creating a parallel clinical state.
    const prevConcepts = [
      ...state.slots.associated_symptoms,
      ...(state.presentationContext?.active.flatMap(a => a.triggeredBy) || []),
    ];
    state.presentationContext = presentationClassifier.classify(
      cleanMsg,
      state.cumulativeTranscript,
      prevConcepts
    );

    // --- STEP 1.5: RESPONSE PLANNER EXECUTION ---
    const plan = responsePlanner.plan(cleanMsg, semantic, state, preArbiterResult, [], localeConfig);
    state.responsePlan = plan;

    // --- STEP 1.6: LIVE LLM GENERATION BRANCH ---
    if (options?.enableLiveGeneration === true) {
      // Evaluate specialists & domain sufficiency for rich LLM context
      const patientCase: PatientCase = {
        patient_id: "ACTIVE-PT",
        patient_name: "Patient",
        transcript: state.cumulativeTranscript,
        conversation_history: [],
        demographics: {
          age: demographics.age ?? undefined,
          age_group: demographics.age_group
        },
        detected_symptoms: state.slots.known_facts,
        vitals: {},
        speech_features: undefined as any,
        pre_safety_flags: preArbiterResult.pre_safety_flags,
        immediate_danger_detected: preArbiterResult.immediate_danger,
        provenance_evidence: [],
        case_version: state.caseVersion
      };

      const cardioRequests = this.cardiology.assessEvidenceNeeds(patientCase);
      const neuroRequests = this.neurology.assessEvidenceNeeds(patientCase);
      const pedsRequests = this.pediatrics.assessEvidenceNeeds(patientCase);
      const entRequests = this.ent.assessEvidenceNeeds(patientCase);

      const allSpecialistRequests = [...cardioRequests, ...neuroRequests, ...pedsRequests, ...entRequests];
      allSpecialistRequests.forEach(newReq => {
        const alreadyResolved = state.resolvedQuestions.some(q => q.resolvedSlot === newReq.targetSlot);
        const alreadyPending = state.agentRequests.some(r => r.targetSlot === newReq.targetSlot && r.status === "pending");
        const slotAlreadyHasValue = Boolean((state.slots as any)[newReq.targetSlot]);
        if (!alreadyResolved && !alreadyPending && !slotAlreadyHasValue) {
          state.agentRequests.push(newReq);
        }
      });

      const doctorProfile = DOCTOR_PROFILES[0];

      const fallbackReply = plan.suggestedSpokenReply ||
        "Could you tell me when these symptoms began, and whether they started suddenly or built up gradually?";

      const callerProfile = options.callerProfile;
      const patientProfile = options.patientProfile || state.patientProfile || this.patientProfile || undefined;
      const turnNum = (state.structuredHistory?.turnCount || 0) + 1;

      const liveResult = await generateDoctorTurnResponse({
        patientUtterance: cleanMsg,
        conversationHistory: options.conversationHistory || [
          { role: "patient", text: cleanMsg }
        ],
        interviewState: state,
        preArbiterResult,
        demographics: {
          age: pAge ?? null,
          age_group: demographics?.age_group || "unknown",
          age_source: demographics?.age_source
        },
        doctor: doctorProfile,
        missingDimensions: state.structuredHistory?.unansweredDimensions,
        fallbackReply,
        localeConfig,
        callerProfile,
        patientProfile,
        targetSubject: options.callerProfile?.relationshipToPatient === "child" ? "mother" :
                       options.callerProfile?.relationshipToPatient === "parent" ? "child" :
                       options.callerProfile?.relationshipToPatient === "self" ? "self" : "self",
        turnId: turnNum,
      });

      // Controlled fact reconciliation
      if (liveResult.candidateFacts && liveResult.candidateFacts.length > 0) {
        const callerForRecon: CallerProfile = callerProfile || {
          id: "caller-session",
          name: "Caller",
          relationshipToPatient: "self",
          authorizedPatientIds: [patientProfile?.id || "pt-session"]
        };
        const patientForRecon: PatientProfile = patientProfile || {
          id: "pt-session",
          name: "Patient",
          age: pAge ?? 35,
          gender: "other",
          language: "en",
          conditions: [],
          medications: [],
          allergies: []
        };

        const recon = controlledFactReconciliationEngine.reconcileCandidateFacts(
          [],
          liveResult.candidateFacts,
          callerForRecon,
          patientForRecon,
          state.caseVersion
        );

        for (const fact of recon.acceptedFacts) {
          const factText = `${fact.concept}: ${fact.assertionStatus}`;
          if (!state.slots.known_facts.includes(factText)) {
            state.slots.known_facts.push(factText);
          }
          if (state.conversationMemory && !state.conversationMemory.confirmedFacts.includes(factText)) {
            state.conversationMemory.confirmedFacts.push(factText);
          }
        }
      }

      if (liveResult.conversationalAction === "CONVENE_BOARD") {
        state.phase = "decided";
        state.informationState = "sufficient_for_decision";
      } else {
        state.phase = "active_inquiring";
      }

      if (!state.structuredHistory) {
        state.structuredHistory = {
          timeline: {},
          unansweredDimensions: [],
          patientCorrections: [],
          patientQuestions: [],
          recentDoctorReplies: [],
          turnCount: 0
        };
      }
      state.structuredHistory.recentDoctorReplies = state.structuredHistory.recentDoctorReplies || [];
      state.structuredHistory.recentDoctorReplies.push(liveResult.reply);
      state.structuredHistory.turnCount = turnNum;

      return {
        action: liveResult.conversationalAction === "CONVENE_BOARD" ? "CONVENE_BOARD" : "ASK_PATIENT",
        doctorReply: liveResult.reply,
        doctorName: doctorProfile.name,
        specialty: doctorProfile.specialty,
        doctorAvatar: doctorProfile.avatarUrl,
        state,
        preArbiterResult,
        telemetry: liveResult.telemetry,
        conversationalAction: liveResult.conversationalAction,
        understoodContext: liveResult.understoodContext,
        candidateFacts: liveResult.candidateFacts
      };
    }

    // Handle high-priority non-intake conversational goals:
    if (plan.primaryGoal === "CONFIRM_CORRECTION_AND_PROCEED") {
      state.phase = "active_inquiring";
      state.informationState = "insufficient";
      state.pendingQuestion = {
        id: "req-confirm-correction",
        targetSlot: "course",
        askedBy: "sarah",
        doctorName: "Dr. Sarah Chen, MD",
        patientFacingSpeaker: "sarah",
        question: plan.suggestedSpokenReply,
        purpose: "Acknowledge correction and clarify course",
        required: true,
        priority: "normal",
        status: "pending",
        createdAt: new Date().toISOString(),
        caseVersion: state.caseVersion
      };

      return {
        action: "ASK_PATIENT",
        doctorReply: plan.suggestedSpokenReply,
        doctorName: "Dr. Sarah Chen, MD",
        specialty: "Chief of Internal Medicine",
        state,
        preArbiterResult
      };
    }

    if (plan.primaryGoal === "ACKNOWLEDGE_AND_ADVANCE") {
      state.phase = "active_inquiring";
      state.informationState = "insufficient";
      state.pendingQuestion = {
        id: "req-acknowledge-advance",
        targetSlot: "timing_pattern",
        askedBy: "sarah",
        doctorName: "Dr. Sarah Chen, MD",
        patientFacingSpeaker: "sarah",
        question: plan.suggestedSpokenReply,
        purpose: "Acknowledge uncertainty and advance to timing pattern",
        required: true,
        priority: "normal",
        status: "pending",
        createdAt: new Date().toISOString(),
        caseVersion: state.caseVersion
      };

      return {
        action: "ASK_PATIENT",
        doctorReply: plan.suggestedSpokenReply,
        doctorName: "Dr. Sarah Chen, MD",
        specialty: "Chief of Internal Medicine",
        state,
        preArbiterResult
      };
    }

    if (plan.primaryGoal === "GENTLE_CLARIFICATION") {
      state.phase = "active_inquiring";
      state.informationState = "insufficient";
      state.pendingQuestion = {
        id: "req-gentle-clarification",
        targetSlot: "timing_pattern",
        askedBy: "sarah",
        doctorName: "Dr. Sarah Chen, MD",
        patientFacingSpeaker: "sarah",
        question: plan.suggestedSpokenReply,
        purpose: "Gently clarify vague symptom description",
        required: true,
        priority: "normal",
        status: "pending",
        createdAt: new Date().toISOString(),
        caseVersion: state.caseVersion
      };

      return {
        action: "ASK_PATIENT",
        doctorReply: plan.suggestedSpokenReply,
        doctorName: "Dr. Sarah Chen, MD",
        specialty: "Chief of Internal Medicine",
        state,
        preArbiterResult
      };
    }

    // Handle high-priority non-intake conversational goals:
    if (plan.primaryGoal === "RESOLVE_OBJECTION_REPETITION") {
      state.phase = "active_inquiring";
      state.informationState = "insufficient";
      state.pendingQuestion = {
        id: "req-resolve-objection",
        targetSlot: "patient_objection",
        askedBy: "sarah",
        doctorName: "Dr. Sarah Chen, MD",
        patientFacingSpeaker: "sarah",
        question: plan.suggestedSpokenReply,
        purpose: "Resolve patient objection about repetition and clarify focus",
        required: true,
        priority: "normal",
        status: "pending",
        createdAt: new Date().toISOString(),
        caseVersion: state.caseVersion
      };

      return {
        action: "ASK_PATIENT",
        doctorReply: plan.suggestedSpokenReply,
        doctorName: "Dr. Sarah Chen, MD",
        specialty: "Chief of Internal Medicine",
        state,
        preArbiterResult
      };
    }

    if (plan.primaryGoal === "VALIDATE_EMOTION_BEFORE_INQUIRY") {
      state.phase = "active_inquiring";
      state.informationState = "insufficient";
      state.pendingQuestion = {
        id: "req-validate-emotion",
        targetSlot: "emotional_concern",
        askedBy: "sarah",
        doctorName: "Dr. Sarah Chen, MD",
        patientFacingSpeaker: "sarah",
        question: plan.suggestedSpokenReply,
        purpose: "Validate emotional distress before clinical interrogation",
        required: true,
        priority: "normal",
        status: "pending",
        createdAt: new Date().toISOString(),
        caseVersion: state.caseVersion
      };

      return {
        action: "ASK_PATIENT",
        doctorReply: plan.suggestedSpokenReply,
        doctorName: "Dr. Sarah Chen, MD",
        specialty: "Chief of Internal Medicine",
        state,
        preArbiterResult
      };
    }

    if (plan.primaryGoal === "ACKNOWLEDGE_AND_EXPLORE" && plan.nextHighValueInquiry) {
      const nextTargetSlot = plan.nextHighValueInquiry.topic;
      mem.questionsAlreadyAsked.push(nextTargetSlot);
      state.phase = "active_inquiring";
      state.informationState = "insufficient";
      state.pendingQuestion = {
        id: `req-explore-${nextTargetSlot}`,
        targetSlot: nextTargetSlot,
        askedBy: "sarah",
        doctorName: "Dr. Sarah Chen, MD",
        patientFacingSpeaker: "sarah",
        question: plan.suggestedSpokenReply,
        purpose: plan.nextHighValueInquiry.clinicalRationale,
        required: true,
        priority: "normal",
        status: "pending",
        createdAt: new Date().toISOString(),
        caseVersion: state.caseVersion
      };

      return {
        action: "ASK_PATIENT",
        doctorReply: plan.suggestedSpokenReply,
        doctorName: "Dr. Sarah Chen, MD",
        specialty: "Chief of Internal Medicine",
        state,
        preArbiterResult
      };
    }

    if (plan.primaryGoal === "CLARIFY_MEMORY_OR_IDENTITY") {
      state.phase = "active_inquiring";
      state.informationState = "insufficient";
      state.pendingQuestion = {
        id: "req-clarify-chief-complaint",
        targetSlot: "chief_complaint",
        askedBy: "sarah",
        doctorName: "Dr. Sarah Chen, MD",
        patientFacingSpeaker: "sarah",
        question: plan.suggestedSpokenReply,
        purpose: "Clarify presenting illness or chief complaint",
        required: true,
        priority: "normal",
        status: "pending",
        createdAt: new Date().toISOString(),
        caseVersion: state.caseVersion
      };

      return {
        action: "ASK_PATIENT",
        doctorReply: plan.suggestedSpokenReply,
        doctorName: "Dr. Sarah Chen, MD",
        specialty: "Chief of Internal Medicine",
        state,
        preArbiterResult
      };
    }

    // --- STEP 2: CONVERSATIONAL INTERPRETATION & SLOT RESOLUTION ---
    const interpretation = this.interpretUtterance(cleanMsg, state.pendingQuestion, state);

    if (interpretation.intent === "confirmation" || semantic.isConfirmationOrRepetition || semantic.intent === "confirmation_or_correction") {
      // Patient confirmed previous statement (e.g. "I said head?")
      // Do NOT repeat the question. Acknowledge and advance!
      const confirmedSlot = interpretation.resolvedSlot || semantic.resolvedSlot || (state.pendingQuestion ? state.pendingQuestion.targetSlot : "information");
      const confirmedVal = interpretation.resolvedValue || semantic.resolvedValue || (state.slots as any)[confirmedSlot] || "noted";
      if (state.pendingQuestion) {
        state.pendingQuestion.status = "resolved";
        state.pendingQuestion = null;
      }
      state.caseVersion++;
      // Mark any matching agentRequest as resolved
      state.agentRequests.forEach(r => {
        if (r.targetSlot === confirmedSlot && r.status === "pending") r.status = "resolved";
      });
    } else if ((interpretation.intent === "answer_question" && interpretation.resolvedSlot) || (semantic.intent === "answer_pending_question" && semantic.resolvedSlot)) {
      // Successfully answered question
      const slot = interpretation.resolvedSlot || semantic.resolvedSlot!;
      const val = interpretation.resolvedValue || semantic.resolvedValue!;

      if (val === "denied" || val === "negative") {
        const questionText = state.pendingQuestion?.question?.toLowerCase() || "";
        const deniedList: string[] = [];
        if (/droop/i.test(questionText)) deniedList.push("facial drooping");
        if (/speech|words|speak|slur/i.test(questionText)) deniedList.push("speech difficulty");
        if (/vision|see|blurry/i.test(questionText)) deniedList.push("vision changes");
        if (/weakness|arms?\s+or\s+legs?/i.test(questionText)) deniedList.push("unilateral weakness");
        if (/numbness/i.test(questionText)) deniedList.push("numbness");
        if (/sweat|clammy/i.test(questionText)) deniedList.push("cold sweating");
        if (/shortness\s+of\s+breath|breathing/i.test(questionText)) deniedList.push("shortness of breath");
        if (/nausea|vomit/i.test(questionText)) deniedList.push("nausea");
        if (/swallow/i.test(questionText) || slot === "swallowing_difficulty") deniedList.push("swallowing_difficulty");
        if (/fever|chills/i.test(questionText) || slot === "fever") deniedList.push("fever");
        if (/ear/i.test(questionText) || slot === "ear_pain") deniedList.push("ear_pain");
        if (/rash|bleeding|spots|bruising/i.test(questionText) || slot === "rash_bleeding") deniedList.push("rash_bleeding");
        if (/trismus|jaw/i.test(questionText) || slot === "trismus") deniedList.push("trismus");

        if (deniedList.length === 0 && !NON_DENIABLE_SLOTS.has(slot)) {
          deniedList.push(slot);
        }

        if (deniedList.length > 0) {
          deniedList.forEach(d => {
            if (state.conversationMemory && !state.conversationMemory.deniedSymptoms.includes(d)) {
              state.conversationMemory.deniedSymptoms.push(d);
            }
            if (state.conversationMemory && !state.conversationMemory.questionsAlreadyAsked.includes(d)) {
              state.conversationMemory.questionsAlreadyAsked.push(d);
            }
          });

          const fact = `Denied: ${deniedList.join(", ")}`;
          if (!state.slots.known_facts.includes(fact)) {
            state.slots.known_facts.push(fact);
          }
        }
      } else if (slot === "associated_symptoms" && Array.isArray(val)) {
        state.slots.associated_symptoms = Array.from(new Set([...state.slots.associated_symptoms, ...val]));
        state.slots.known_facts.push(`Associated: ${val.join(", ")}`);
      } else if (slot === "neurological_signs" && Array.isArray(val)) {
        state.slots.neurological_signs = Array.from(new Set([...state.slots.neurological_signs, ...val]));
        state.slots.known_facts.push(`Neurological: ${val.join(", ")}`);
      } else if (slot === "onset_pattern") {
        const pattern = val === "sudden" ? "sudden" : "gradual";
        state.slots.acute_worsening = pattern === "sudden";
        (state.slots as any).onset_pattern = pattern;
        state.slots.known_facts.push(`ONSET_TYPE: ${pattern}`);
        if (state.conversationMemory) {
          state.conversationMemory.confirmedFacts.push(`Onset pattern: ${pattern}`);
          if (!state.conversationMemory.questionsAlreadyAsked.includes("onset_pattern")) {
            state.conversationMemory.questionsAlreadyAsked.push("onset_pattern");
          }
        }
      } else if (slot === "onset_time") {
        state.slots.onset = String(val);
        state.slots.known_facts.push(`ONSET: ${val}`);
        if (state.conversationMemory) {
          state.conversationMemory.confirmedFacts.push(`Onset: ${val}`);
          if (!state.conversationMemory.questionsAlreadyAsked.includes("onset_time")) {
            state.conversationMemory.questionsAlreadyAsked.push("onset_time");
          }
        }
      } else if (slot === "abdominal_location" || (slot === "location" && isAbdominalPresentation(cleanMsg))) {
        state.slots.location = String(val);
        const locFact = `Abdominal location: ${val}`;
        if (!state.slots.known_facts.includes(locFact)) {
          state.slots.known_facts.push(locFact);
        }
      } else if (slot === "location") {
        state.slots.location = String(val);
        const locFact = `Location: ${val}`;
        if (!state.slots.known_facts.includes(locFact)) {
          state.slots.known_facts.push(locFact);
        }
      } else if (slot !== "onset_and_location") {
        (state.slots as any)[slot] = val;
        state.slots.known_facts.push(`${slot.toUpperCase()}: ${val}`);
        if (slot === "onset") {
          const parsed = parseOnsetDimensions(String(val));
          if (parsed.onsetPattern) {
            state.slots.acute_worsening = parsed.acuteWorsening;
            (state.slots as any).onset_pattern = parsed.onsetPattern;
            if (!state.slots.known_facts.some(f => f.startsWith("ONSET_TYPE:"))) {
              state.slots.known_facts.push(`ONSET_TYPE: ${parsed.onsetPattern}`);
            }
          }
        }
      }

      // Resolve pending question
      if (state.pendingQuestion && state.pendingQuestion.targetSlot === slot) {
        state.resolvedQuestions.push({
          questionId: state.pendingQuestion.id,
          askedBy: state.pendingQuestion.askedBy,
          question: state.pendingQuestion.question,
          patientAnswer: cleanMsg,
          resolvedSlot: slot,
          slotValue: String(val)
        });
        state.pendingQuestion.status = "resolved";
        state.pendingQuestion = null;
      }

      // Mark corresponding AgentRequest as resolved
      state.agentRequests.forEach(r => {
        if (r.targetSlot === slot && r.status === "pending") {
          r.status = "resolved";
        }
      });

      state.caseVersion++;
    } else if (interpretation.intent === "ambiguous" && interpretation.clarificationNeeded) {
      // Ambiguous answer: Sarah asks for targeted clarification
      return {
        action: "CLARIFY",
        doctorReply: interpretation.clarificationNeeded,
        doctorName: "Dr. Sarah Chen, MD",
        specialty: "Internal Medicine & General Practice",
        state,
        preArbiterResult
      };
    }

    // Opportunistic extraction from transcript
    this.extractOpportunisticFacts(state);

    // --- STEP 3: SPECIALISTS OBSERVE BLACKBOARD & EMIT AGENT REQUESTS ---
    const patientCase: PatientCase = {
      patient_id: "ACTIVE-PT",
      patient_name: "Patient",
      transcript: state.cumulativeTranscript,
      conversation_history: [],
      demographics: {
        age: demographics.age ?? undefined,
        age_group: demographics.age_group
      },
      detected_symptoms: state.slots.known_facts,
      vitals: {},
      speech_features: undefined as any,
      pre_safety_flags: preArbiterResult.pre_safety_flags,
      immediate_danger_detected: preArbiterResult.immediate_danger,
      provenance_evidence: [],
      case_version: state.caseVersion
    };

    const cardioRequests = this.cardiology.assessEvidenceNeeds(patientCase);
    const neuroRequests = this.neurology.assessEvidenceNeeds(patientCase);
    const pedsRequests = this.pediatrics.assessEvidenceNeeds(patientCase);
    const entRequests = this.ent.assessEvidenceNeeds(patientCase);

    // Merge new active requests avoiding duplicates
    const allSpecialistRequests = [...cardioRequests, ...neuroRequests, ...pedsRequests, ...entRequests];
    allSpecialistRequests.forEach(newReq => {
      const alreadyResolved = state.resolvedQuestions.some(q => q.resolvedSlot === newReq.targetSlot);
      const alreadyPending = state.agentRequests.some(r => r.targetSlot === newReq.targetSlot && r.status === "pending");
      const slotAlreadyHasValue = Boolean((state.slots as any)[newReq.targetSlot]);
      const isDenied = Boolean(
        state.conversationMemory?.deniedSymptoms?.some(s =>
          s.toLowerCase() === newReq.targetSlot.toLowerCase() ||
          (newReq.targetSlot === "fever" && s.toLowerCase().includes("fever")) ||
          (newReq.targetSlot === "swallowing_difficulty" && s.toLowerCase().includes("swallow"))
        )
      );
      const isDeniedInFacts = state.slots.known_facts.some(f =>
        f.toLowerCase().includes(`denied: ${newReq.targetSlot.toLowerCase()}`) ||
        (newReq.targetSlot === "fever" && f.toLowerCase().includes("denied: fever"))
      );

      if (!alreadyResolved && !alreadyPending && !slotAlreadyHasValue && !isDenied && !isDeniedInFacts) {
        state.agentRequests.push(newReq);
      }
    });

    // Update domain sufficiency states
    if (!state.domainSufficiency) {
      state.domainSufficiency = {
        general: { status: "gathering", missing: ["onset", "character"] },
        cardiology: { status: "inactive", missing: [] },
        neurology: { status: "inactive", missing: [] },
        pediatrics: { status: "inactive", missing: [] },
      };
    }
    const hasChest = /\b(chest|heart|sternum|angina|pressure|tightness)\b/i.test(state.cumulativeTranscript);
    const hasNeuro = /\b(headache|dizz|droop|weak|numb|speech)\b/i.test(state.cumulativeTranscript);
    const hasPeds = typeof demographics.age === "number" && demographics.age < 16;

    if (hasChest) {
      const missingCardio = [];
      if (!state.slots.onset) missingCardio.push("onset");
      if (!state.slots.character) missingCardio.push("character");
      if (!state.slots.radiation) missingCardio.push("radiation");
      if (!state.slots.exertional) missingCardio.push("exertional");
      if (state.slots.associated_symptoms.length === 0) missingCardio.push("associated_symptoms");

      // Sufficient if key ischemic features (onset + character + radiation/associated) are known
      const cardioSuff = state.slots.onset !== undefined &&
        state.slots.character !== undefined &&
        (state.slots.radiation !== undefined || state.slots.associated_symptoms.length > 0);

      state.domainSufficiency.cardiology = {
        status: cardioSuff ? "sufficient" : "gathering",
        missing: missingCardio
      };
    } else {
      state.domainSufficiency.cardiology = { status: "inactive", missing: [] };
    }

    if (hasNeuro) {
      const missingNeuro = [];
      if (state.slots.neurological_signs.length === 0) missingNeuro.push("neurological_signs");
      if (!state.slots.onset) missingNeuro.push("onset");

      const neuroSuff = state.slots.neurological_signs.length > 0 && state.slots.onset !== undefined;
      state.domainSufficiency.neurology = {
        status: neuroSuff ? "sufficient" : "gathering",
        missing: missingNeuro
      };
    } else {
      state.domainSufficiency.neurology = { status: "inactive", missing: [] };
    }

    // General / Ambulatory sufficiency evaluation (specifically for fatigue / constitutional complaints):
    const hasFatigue = /\b(tired|fatigue|exhaust|malaise|weakness|low energy)\b/i.test(state.cumulativeTranscript) ||
      state.slots.known_facts.some(f => /tired|fatigue/i.test(f));
    const subfields = extractSubfieldState(state.slots, state.slots.known_facts, state.conversationMemory);

    if (hasFatigue && !hasChest && !hasNeuro) {
      const generalMissing: string[] = [];
      if (!state.slots.onset && !subfields.onset.duration) generalMissing.push("onset");
      if (!state.slots.severity && !state.slots.known_facts.some(f => /severity|\d+\/10|hard to get out of bed/i.test(f))) generalMissing.push("severity");
      const hasAssociatedScreened = state.slots.associated_symptoms.length > 0 ||
        state.slots.known_facts.some(f => /denied:.*fever|fever|cough|dizziness|lightheaded|no fever/i.test(f));
      if (!hasAssociatedScreened) generalMissing.push("associated_symptoms");

      const hasIntakeOrRedFlagsScreened = state.slots.known_facts.some(f => /water|eat|intake|fluid/i.test(f)) ||
        state.slots.known_facts.some(f => /no chest pain|chest pain denied/i.test(f)) ||
        state.slots.known_facts.length >= 6;

      const generalSuff = (state.slots.onset !== undefined || subfields.onset.duration !== undefined) &&
        (state.slots.severity !== undefined || state.slots.known_facts.some(f => /severity|\d+\/10|hard to get out of bed/i.test(f))) &&
        hasAssociatedScreened &&
        hasIntakeOrRedFlagsScreened;

      state.domainSufficiency.general = {
        status: generalSuff ? "sufficient" : "gathering",
        missing: generalMissing
      };
    } else {
      state.domainSufficiency.general = { status: "inactive", missing: [] };
    }

    // --- STEP 4: NEXT-ACTION POLICY SELECTION ---
    // If the consultation was ALREADY decided in a previous turn and patient asks a follow-up question:
    if (state.phase === "decided") {
      const decision = clinicalDecisionEngine.decideNextAction(
        clinicalDecisionEngine.classifyTurn(cleanMsg, state),
        state,
        preArbiterResult,
        localeConfig
      );
      return {
        action: "ASK_PATIENT",
        doctorReply: decision.spokenDoctorReply,
        doctorName: "Dr. Sarah Chen, MD",
        specialty: "Internal Medicine & Critical Care Lead",
        state,
        preArbiterResult
      };
    }

    // A. Check if active domains are sufficient for decision
    const activeDomains = [
      state.domainSufficiency.general,
      state.domainSufficiency.cardiology,
      state.domainSufficiency.neurology
    ].filter(d => d.status !== "inactive");

    const allActiveSufficient = activeDomains.length > 0 && activeDomains.every(d => d.status === "sufficient");

    // Comprehensive presentation bypass (e.g. benchmark vignettes)
    const isComprehensivePresentation =
      (hasChest && state.slots.onset && state.slots.character && (state.slots.radiation || state.slots.associated_symptoms.length > 0)) ||
      (hasNeuro && state.slots.neurological_signs.length >= 2 && state.slots.onset) ||
      (hasFatigue && (state.slots.onset || subfields.onset.isResolved) && (state.slots.severity || state.slots.known_facts.some(f => /severity|\d+\/10/i.test(f))) && state.slots.known_facts.length >= 4);

    if (allActiveSufficient || isComprehensivePresentation) {
      state.phase = "decided";
      state.informationState = "sufficient_for_decision";

      return {
        action: "CONVENE_BOARD",
        doctorReply: "Thank you for sharing those details with me. That gives our team what we need to evaluate your situation—give me just a moment while I consult with our clinical specialists.",
        doctorName: "Dr. Sarah Chen, MD",
        specialty: "Chief of Internal Medicine",
        state,
        preArbiterResult
      };
    }

    // B0. Check for targeted syndromic directives or clinical inquiries from clinicalDecisionEngine
    const turnClassification = clinicalDecisionEngine.classifyTurn(cleanMsg, state);
    const engineDecision = clinicalDecisionEngine.decideNextAction(
      turnClassification,
      state,
      preArbiterResult,
      localeConfig
    );

    if (engineDecision.action !== "ADVANCE_INTERVIEW") {
      state.phase = engineDecision.action === "PROVIDE_EMERGENCY_GUIDANCE" ? "decided" : "active_inquiring";
      return {
        action: engineDecision.action === "PROVIDE_EMERGENCY_GUIDANCE" ? "EMERGENCY_CONVENE_BOARD" : "ASK_PATIENT",
        doctorReply: engineDecision.spokenDoctorReply,
        doctorName: engineDecision.doctorName || "Dr. Sarah Chen, MD",
        specialty: engineDecision.specialty || "Internal Medicine & Critical Care Lead",
        state,
        preArbiterResult,
      };
    }

    // B. Check for outstanding AgentRequests
    const pendingRequests = state.agentRequests.filter(r => r.status === "pending");

    if (pendingRequests.length > 0) {
      // Pick highest urgency request
      const nextReq = pendingRequests.sort((a, b) => {
        const priorityScore = { critical: 3, high: 2, normal: 1 };
        return priorityScore[b.urgency] - priorityScore[a.urgency];
      })[0];

      state.phase = "active_inquiring";
      state.informationState = "sufficient_for_specialist";

      // Transform into Sarah's warm, natural bedside phrasing
      let sarahQuestion = nextReq.suggestedQuestion || "Could you tell me a little more about that?";
      if (nextReq.targetSlot === "exertional") {
        sarahQuestion = "Does this discomfort usually happen when you're active, such as walking or climbing stairs, or does it happen while resting?";
      } else if (nextReq.targetSlot === "radiation") {
        sarahQuestion = "Does that chest discomfort travel anywhere, such as into your left arm, jaw, neck, or back?";
      } else if (nextReq.targetSlot === "associated_symptoms") {
        sarahQuestion = "Are you experiencing any shortness of breath, cold sweating, nausea, or lightheadedness right now?";
      } else if (nextReq.targetSlot === "onset") {
        sarahQuestion = "Roughly when did you first notice these symptoms?";
      } else if (nextReq.targetSlot === "character") {
        sarahQuestion = "Could you describe what it feels like — is it a tight pressure, squeezing, burning, or a sharp pain?";
      } else if (nextReq.targetSlot === "swallowing_difficulty" && nextReq.fromAgent === "otolaryngology") {
        sarahQuestion = "When you swallow, are you able to swallow liquids and your own saliva normally, or is it too painful to swallow?";
      } else if (nextReq.targetSlot === "trismus_or_jaw_opening" && nextReq.fromAgent === "otolaryngology") {
        sarahQuestion = "Can you open your mouth completely, or does your jaw feel stiff or limited when you try to open wide?";
      }

      state.pendingQuestion = {
        id: nextReq.id,
        targetSlot: nextReq.targetSlot,
        askedBy: nextReq.fromAgent === "cardiology" ? "marcus" : nextReq.fromAgent === "neurology" ? "arthur" : nextReq.fromAgent === "otolaryngology" ? "rajiv" : "sarah",
        doctorName: nextReq.doctorName,
        patientFacingSpeaker: "sarah",
        question: sarahQuestion,
        purpose: nextReq.reason,
        required: nextReq.urgency !== "normal",
        priority: nextReq.urgency,
        status: "pending",
        createdAt: new Date().toISOString(),
        caseVersion: state.caseVersion
      };

      if (state.conversationMemory && !state.conversationMemory.questionsAlreadyAsked.includes(nextReq.targetSlot)) {
        state.conversationMemory.questionsAlreadyAsked.push(nextReq.targetSlot);
      }

      return {
        action: "ASK_PATIENT",
        doctorReply: sarahQuestion,
        doctorName: "Dr. Sarah Chen, MD",
        specialty: "Internal Medicine & General Practice",
        activeAgentRequest: nextReq,
        state,
        preArbiterResult
      };
    }

    // C. Dynamic clinical response & intake if no specialist requests yet
    state.phase = "active_inquiring";
    state.informationState = "insufficient";

    let initialDoctorReply = "When did this discomfort begin, and did it start suddenly or build up gradually?";
    let initialTargetSlot = "onset";
    let initialPurpose = "Establish onset and duration of presenting symptom";

    const msgLower = cleanMsg.toLowerCase();
    const isChestPresentation = /\b(chest|heart|sternum|angina)\b/i.test(msgLower);
    const isLegNerveMuscle = /\b(leg|calf|thigh|hamstring|quadricep|shin)\b/i.test(msgLower) &&
                            /\b(needle|digged|digging|pins|sharp|stab|cramp|spasm|shoot|burning|numb|tingl|sciatica)\b/i.test(msgLower);
    const isAbdominal = isAbdominalPresentation(msgLower);
    const isHeadache = /\b(headache|migraine|head\s+pain)\b/i.test(msgLower) && !isChestPresentation;

    if (preArbiterResult?.universal_red_flag_result?.discriminatorQuestion) {
      const dq = preArbiterResult.universal_red_flag_result.discriminatorQuestion;
      initialTargetSlot = dq.intent;
      initialPurpose = `Universal red-flag screen discriminator for rule ${dq.ruleId}`;
      initialDoctorReply = dq.text;
    } else if (isLegNerveMuscle) {
      initialTargetSlot = "radiation_or_back";
      initialPurpose = "Differentiate sciatic radiculopathy, focal muscle spasm, and peripheral nerve irritation";
      if (semantic.isExplanatoryInquiry || msgLower.includes("why")) {
        initialDoctorReply = "A sharp pain that feels like a needle digging into your leg muscles usually occurs for a few specific reasons: most commonly, it is either nerve irritation—such as the sciatic nerve or a compressed nerve root sending sharp, lancinating signals down into the muscle—or an acute, localized muscle spasm. When sensory nerves are irritated, they send sharp, needle-like signals rather than a dull ache.\n\nTo help narrow this down: does that needle-like pain shoot down from your lower back or hip, do you feel any numbness or weakness when you lift your foot, and did this start suddenly?";
      } else {
        initialDoctorReply = "I understand you're experiencing sharp, needle-like pain in your leg muscles. Does this pain shoot down from your lower back or hip, do you notice any numbness or weakness in your foot, and did it start suddenly or build up over time?";
      }
    } else if (isAbdominal && !state.slots.location && !state.slots.known_facts.some(f => /^Abdominal location:/i.test(f))) {
      initialTargetSlot = "abdominal_location";
      initialPurpose = "Localize abdominal pain to a quadrant or region";
      initialDoctorReply = "I understand you're feeling abdominal discomfort. Where in your abdomen does the pain feel strongest — upper, lower, right, left, around the navel, or all over?";
    } else if (isHeadache && extractSubfieldState(state.slots, state.slots.known_facts, state.conversationMemory).onset.onsetPattern === "unknown") {
      initialTargetSlot = "onset_pattern";
      initialPurpose = "Establish whether headache onset was sudden or gradual";
      initialDoctorReply = "I hear you regarding your headache. Did it come on all at once, or did it build up gradually?";
    } else if (state.responsePlan?.nextHighValueInquiry) {
      initialTargetSlot = state.responsePlan.nextHighValueInquiry.topic;
      initialPurpose = state.responsePlan.nextHighValueInquiry.clinicalRationale;
      initialDoctorReply = state.responsePlan.suggestedSpokenReply || state.responsePlan.nextHighValueInquiry.suggestedPhrasing;
    } else if (!isChestPresentation) {
      const subfields = extractSubfieldState(state.slots, state.slots.known_facts, state.conversationMemory);
      if (subfields.onset.isResolved) {
        const isFatigueCase = /\b(tired|fatigue|exhaust|malaise|weakness)\b/i.test(state.cumulativeTranscript);
        if (!subfields.characterSeverity.character) {
          initialTargetSlot = "character";
          initialPurpose = "Establish symptom sensation and quality";
          initialDoctorReply = isFatigueCase
            ? "Could you describe what this fatigue feels like — does it make it hard to get out of bed, or is it a general exhaustion?"
            : "Could you describe what that discomfort feels like — is it sharp, burning, dull, or a tight pressure?";
        } else if (!subfields.characterSeverity.severity) {
          initialTargetSlot = "severity";
          initialPurpose = "Establish severity of discomfort";
          initialDoctorReply = "On a scale from zero to ten, how severe would you rate this discomfort right now?";
        } else if (!state.conversationMemory?.questionsAlreadyAsked.includes("associated_symptoms")) {
          initialTargetSlot = "associated_symptoms";
          initialPurpose = "Screen for associated symptoms";
          initialDoctorReply = "Are you experiencing any other symptoms alongside this, such as fever, difficulty breathing, or dizziness?";
        } else {
          // Key intake complete! Transition to board deliberation rather than looping
          state.phase = "decided";
          state.informationState = "sufficient_for_decision";
          return {
            action: "CONVENE_BOARD",
            doctorReply: "Thank you for sharing those details with me. That gives our team what we need to evaluate your situation—give me just a moment while I consult with our clinical specialists.",
            doctorName: "Dr. Sarah Chen, MD",
            specialty: "Chief of Internal Medicine",
            state,
            preArbiterResult
          };
        }
      } else if (subfields.onset.duration && subfields.onset.onsetPattern === "unknown") {
        initialTargetSlot = "onset_pattern";
        initialPurpose = "Establish whether onset was sudden or gradual";
        initialDoctorReply = "Did it come on suddenly, or did it gradually get worse?";
      } else if (!subfields.onset.duration && subfields.onset.onsetPattern !== "unknown") {
        initialTargetSlot = "onset_time";
        initialPurpose = "Establish onset timeline";
        initialDoctorReply = "Roughly when did this begin, or how long have you had it?";
      } else {
        initialDoctorReply = "Thank you for describing what you're experiencing. Could you tell me when this began, and whether it started suddenly or built up gradually?";
      }
    }

    if (state.conversationMemory && !state.conversationMemory.questionsAlreadyAsked.includes(initialTargetSlot)) {
      state.conversationMemory.questionsAlreadyAsked.push(initialTargetSlot);
    }

    state.pendingQuestion = {
      id: `req-general-${initialTargetSlot}`,
      targetSlot: initialTargetSlot,
      askedBy: "sarah",
      doctorName: "Dr. Sarah Chen, MD",
      patientFacingSpeaker: "sarah",
      question: initialDoctorReply,
      purpose: initialPurpose,
      required: true,
      priority: "high",
      status: "pending",
      createdAt: new Date().toISOString(),
      caseVersion: state.caseVersion
    };

    return {
      action: "ASK_PATIENT",
      doctorReply: initialDoctorReply,
      doctorName: "Dr. Sarah Chen, MD",
      specialty: "Internal Medicine & General Practice",
      state,
      preArbiterResult
    };
  }

  public extractOpportunisticFacts(state: ClinicalInterviewState): void {
    if (!state.slots.duration) {
      const isEpisodePrompt = /how\s+long\s+does\s+each\s+(?:one\s+)?last|each\s+episode/i.test(state.pendingQuestion?.question || "");
      const isDayOrTwo = /\b(?:for\s+)?(?:a\s+day\s+or\s+two|one\s+or\s+two\s+days|1\s*[-–]\s*2\s+days)\b/i.test(state.cumulativeTranscript);
      if (!(isEpisodePrompt && isDayOrTwo)) {
        const durMatch = state.cumulativeTranscript.match(/\b(?:for\s+)?(\d+\s*(?:minutes?|hours?|seconds?|days?)|(?:one|two|three|four|five|six|seven)\s+days?|a\s+minute|few\s+seconds|few\s+minutes)\b/i);
        if (durMatch) {
          const cleanDur = durMatch[0].replace(/^for\s+/i, "").trim();
          state.slots.duration = `approx. ${cleanDur}`;
          if (state.conversationMemory) state.conversationMemory.durationPattern = `approx. ${cleanDur}`;
          const fact = `Duration: approx. ${cleanDur}`;
          if (!state.slots.known_facts.includes(fact)) {
            state.slots.known_facts.push(fact);
          }
        }
      }
    }
    if (!state.slots.character) {
      // Affirmative character extraction: ensure matched character word is NOT preceded by an active negation in the same clause
      const charRegex = /\b(tightness|pressure|squeezing|crushing|burning|sharp|heavy|elephant|cramp(?:ing)?|colic(?:ky)?|spasm|gnawing)\b/gi;
      let matchedChar: string | null = null;
      let charExec: RegExpExecArray | null;
      while ((charExec = charRegex.exec(state.cumulativeTranscript)) !== null) {
        const word = charExec[1];
        const startIndex = charExec.index;
        const preceding = state.cumulativeTranscript.slice(Math.max(0, startIndex - 45), startIndex);
        const lastBoundary = Math.max(
          preceding.lastIndexOf('.'),
          preceding.lastIndexOf(';'),
          preceding.lastIndexOf('!'),
          preceding.lastIndexOf('?'),
          preceding.search(/\b(?:but|however|yet)\b/i)
        );
        const clausePrefix = lastBoundary >= 0 ? preceding.slice(lastBoundary) : preceding;
        const isNegated = /\b(?:no|not|without|neither|never|denies|deny|free\s+of)\b/i.test(clausePrefix);
        if (!isNegated) {
          matchedChar = word;
          break;
        }
      }

      if (matchedChar) {
        state.slots.character = matchedChar;
        if (!state.slots.known_facts.some(f => f.startsWith("CHARACTER"))) {
          state.slots.known_facts.push(`CHARACTER: ${matchedChar}`);
        }
      } else {
        const dizzyRegex = /\b(dizzy|dizziness|lightheaded)\b/gi;
        let matchedDizzy: string | null = null;
        let dizzyExec: RegExpExecArray | null;
        while ((dizzyExec = dizzyRegex.exec(state.cumulativeTranscript)) !== null) {
          const word = dizzyExec[1];
          const startIndex = dizzyExec.index;
          const preceding = state.cumulativeTranscript.slice(Math.max(0, startIndex - 45), startIndex);
          const lastBoundary = Math.max(
            preceding.lastIndexOf('.'),
            preceding.lastIndexOf(';'),
            preceding.lastIndexOf('!'),
            preceding.lastIndexOf('?'),
            preceding.search(/\b(?:but|however|yet)\b/i)
          );
          const clausePrefix = lastBoundary >= 0 ? preceding.slice(lastBoundary) : preceding;
          const isNegated = /\b(?:no|not|without|neither|never|denies|deny|free\s+of)\b/i.test(clausePrefix);
          if (!isNegated) {
            matchedDizzy = word;
            break;
          }
        }

        if (matchedDizzy) {
          const isPostural = /\b(when\s+i\s+stand|after\s+i\s+sat|standing\s+up|getting\s+up|sitting\s+for\s+long)\b/i.test(state.cumulativeTranscript);
          state.slots.character = isPostural ? "postural dizziness upon standing after sitting" : "dizziness";
          if (!state.slots.known_facts.some(f => f.startsWith("CHARACTER"))) {
            state.slots.known_facts.push(`CHARACTER: ${state.slots.character}`);
          }
        }
      }
    }
    if (!state.slots.onset) {
      const onsetMatch = state.cumulativeTranscript.match(/\b(?:since|from|about|approx\.?|roughly)?\s*(\d+\s*(?:minutes?|hours?|days?|weeks?)|morning\s+\d+\s+days?\s+ago|\d+\s+days?\s+ago|yesterday|this\s+morning|an?\s+hour|(?:one|two|three|four|five|six|seven)\s+days?|twenty\s+minutes|thirty\s+minutes|a\s+week)\b/i);
      if (onsetMatch) {
        const cleanTime = onsetMatch[0].replace(/^(?:since|from|about|roughly)\s*/i, "").trim();
        state.slots.onset = cleanTime;
        if (!state.slots.known_facts.some(f => f.startsWith("ONSET"))) {
          state.slots.known_facts.push(`ONSET: ${cleanTime}`);
        }
      } else if (/\b(when\s+i\s+stand|standing\s+up|after\s+i\s+sat)\b/i.test(state.cumulativeTranscript)) {
        state.slots.onset = "intermittent upon standing after sitting";
        if (!state.slots.known_facts.some(f => f.startsWith("ONSET"))) {
          state.slots.known_facts.push(`ONSET: ${state.slots.onset}`);
        }
      }
    }

    // Opportunistic ENT, Voice Change & Course extraction
    if (/\b(throat\s+pain|sore\s+throat|throat\s+is\s+paining|throat\s+hurts?)\b/i.test(state.cumulativeTranscript)) {
      if (!state.slots.known_facts.some(f => /throat/i.test(f))) {
        state.slots.known_facts.push("THROAT_PAIN: present");
        if (state.structuredHistory) state.structuredHistory.chiefComplaint = "Throat pain";
      }
    }
    if (/\b(voice\s+has\s+been\s+ruined|voice\s+changed|voice\s+is\s+different|lost\s+my\s+voice|hoarse|hoarseness)\b/i.test(state.cumulativeTranscript)) {
      if (!state.slots.associated_symptoms.includes("voice change")) {
        state.slots.associated_symptoms.push("voice change");
      }
      if (!state.slots.known_facts.some(f => /voice/i.test(f))) {
        state.slots.known_facts.push("VOICE_CHANGE: present");
      }
    }
    if (/\b(gradual(?:ly)?\s+increased|got\s+worse|built\s+up|getting\s+worse|increasing)\b/i.test(state.cumulativeTranscript)) {
      if (!state.slots.known_facts.some(f => /course/i.test(f))) {
        state.slots.known_facts.push("COURSE: gradually worsening");
      }
    }

    if (!state.slots.onset_pattern) {
      const parsed = parseOnsetDimensions(state.cumulativeTranscript);
      if (parsed.onsetPattern) {
        state.slots.onset_pattern = parsed.onsetPattern;
        state.slots.acute_worsening = parsed.acuteWorsening;
        if (!state.slots.known_facts.some(f => /ONSET_(?:TYPE|PATTERN)/i.test(f))) {
          state.slots.known_facts.push(`ONSET_TYPE: ${parsed.onsetPattern}`);
        }
      }
    }

    // Headache-associated light and sound sensitivity is evidence, not merely a
    // keyword. Require a symptom relationship so a "sudden flash" is not
    // incorrectly recorded as photophobia.
    const hasPhotophobia = /\b(?:photophob|sensitive\s+to\s+(?:bright\s+)?lights?|(?:bright\s+)?lights?\s+(?:bother|make|made|worsen)|lights?\s+(?:bother|makes?|made|worsen)|light\s+sensitivity)\b/i.test(state.cumulativeTranscript);
    const hasPhonophobia = /\b(?:phonophob|sensitive\s+to\s+(?:loud\s+)?(?:sound|sounds|noise)|(?:loud\s+)?(?:sounds?|noise)\s+(?:bother|make|made|worsen)|sound\s+sensitivity)\b/i.test(state.cumulativeTranscript) || /\bsensitive\s+to\s+(?:bright\s+)?lights?\s+(?:or|and)\s+(?:loud\s+)?(?:sounds?|noise)\b/i.test(state.cumulativeTranscript);
    if (hasPhotophobia) {
      if (!state.slots.associated_symptoms.includes("photophobia")) state.slots.associated_symptoms.push("photophobia");
      if (!state.slots.known_facts.some(f => /photophobia/i.test(f))) state.slots.known_facts.push("Associated: photophobia (light sensitivity)");
    }
    if (hasPhonophobia) {
      if (!state.slots.associated_symptoms.includes("phonophobia")) state.slots.associated_symptoms.push("phonophobia");
      if (!state.slots.known_facts.some(f => /phonophobia/i.test(f))) state.slots.known_facts.push("Associated: phonophobia (sound sensitivity)");
    }

    // Opportunistic Severity Extraction (0-10, /10, "8 by 10", "pain is 6", dual usual/peak)
    const episodic = extractEpisodicSeverity(state.cumulativeTranscript);
    if (episodic) {
      const isDual = episodic.baseline !== undefined && episodic.peak !== undefined && episodic.baseline !== episodic.peak;
      if (isDual || !state.slots.severity) {
        state.slots.severity = episodic.display;
        if (episodic.baseline !== undefined) state.slots.baseline_severity = `${episodic.baseline}/10`;
        if (episodic.peak !== undefined) state.slots.peak_severity = `${episodic.peak}/10`;
        if (episodic.pattern) state.slots.severity_pattern = episodic.pattern;
        const fact = `SEVERITY: ${episodic.display}${episodic.pattern === "intermittent" ? " (intermittent)" : ""}`;
        state.slots.known_facts = state.slots.known_facts.filter(f => !f.startsWith("SEVERITY"));
        state.slots.known_facts.push(fact);
      }
    }

    // Opportunistic abdominal location
    if (!state.slots.location) {
      const locations = parseAbdominalLocations(state.cumulativeTranscript);
      if (locations.length > 0) {
        const labels = locations.map(code => ABDOMINAL_LOCATION_LABELS[code]);
        state.slots.location = labels.join(", ");
        const locFact = `Abdominal location: ${labels.join(", ")}`;
        if (!state.slots.known_facts.includes(locFact)) state.slots.known_facts.push(locFact);
      }
    }

    // Opportunistic GI associated symptoms (diarrhea / vomiting / blood in stool / etc.)
    for (const gi of extractGiAssociatedSymptoms(state.cumulativeTranscript)) {
      if (gi.status === "present") {
        const assocName = gi.name === "diarrhea" ? "diarrhea" : gi.name.replace(/_/g, " ");
        if (!state.slots.associated_symptoms.includes(assocName)) {
          state.slots.associated_symptoms.push(assocName);
        }
        const fact = `Associated: ${gi.label}`;
        if (!state.slots.known_facts.some(f => f.toLowerCase().includes(gi.name.replace(/_/g, " ")) || f.toLowerCase().includes(gi.label.toLowerCase()))) {
          state.slots.known_facts.push(fact);
        }
      } else if (state.conversationMemory && !state.conversationMemory.deniedSymptoms.includes(gi.name)) {
        state.conversationMemory.deniedSymptoms.push(gi.name);
        const fact = `Denied: ${gi.label}`;
        if (!state.slots.known_facts.includes(fact)) state.slots.known_facts.push(fact);
      }
    }

    // Never surface the compound onset+location duplicate
    state.slots.known_facts = state.slots.known_facts.filter(f => !/^ONSET_AND_LOCATION:/i.test(f));

    // Opportunistic Fever Screening (Denial vs Presence)
    const hasFeverDenial = /\b(no\s+fever|haven'?t\s+had\s+(?:a\s+)?fever|without\s+fever|no\s+temperature|denies\s+fever|no\s+fever\s+or\s+chills)\b/i.test(state.cumulativeTranscript);
    const hasFeverPresent = !hasFeverDenial && /\b(have\s+(?:a\s+)?fever|feverish|chills|high\s+temperature|fever\s+of)\b/i.test(state.cumulativeTranscript);

    if (hasFeverDenial) {
      if (state.conversationMemory && !state.conversationMemory.deniedSymptoms.includes("fever")) {
        state.conversationMemory.deniedSymptoms.push("fever");
      }
      if (state.conversationMemory && !state.conversationMemory.questionsAlreadyAsked.includes("fever")) {
        state.conversationMemory.questionsAlreadyAsked.push("fever");
      }
      if (!state.slots.known_facts.some(f => /denied:\s*fever/i.test(f))) {
        state.slots.known_facts.push("Denied: fever");
      }
    } else if (hasFeverPresent) {
      if (!state.slots.associated_symptoms.includes("fever")) {
        state.slots.associated_symptoms.push("fever");
      }
      if (!state.slots.known_facts.some(f => /^FEVER:/i.test(f))) {
        state.slots.known_facts.push("FEVER: present");
      }
    }

    // Opportunistic Swallowing: Odynophagia (painful swallowing) vs Dysphagia (mechanical obstruction / inability to pass fluids)
    const hasOdynophagia = /\b(?:hurts?|painful|pain|burning|sharp)\s+(?:when\s+(?:i\s+)?swallow|to\s+swallow|swallowing)\b/i.test(state.cumulativeTranscript) ||
      /\b(?:when\s+(?:i\s+)?swallow|swallowing)\s+(?:it\s+)?(?:hurts?|is\s+painful)\b/i.test(state.cumulativeTranscript) ||
      /\bodynophagia\b/i.test(state.cumulativeTranscript);

    if (hasOdynophagia) {
      if (!state.slots.associated_symptoms.includes("painful swallowing (odynophagia)")) {
        state.slots.associated_symptoms.push("painful swallowing (odynophagia)");
      }
      if (!state.slots.known_facts.some(f => /odynophagia|painful\s+swallowing/i.test(f))) {
        state.slots.known_facts.push("ODYNOPHAGIA: painful swallowing (saliva/food)");
      }
    }

    const hasDysphagiaComplaint = /\b(trouble\s+swallowing|difficulty\s+swallowing|hard\s+to\s+swallow|cannot\s+swallow|can't\s+swallow|choking\s+on\s+liquids|food\s+gets?\s+stuck|unable\s+to\s+swallow|dysphagia)\b/i.test(state.cumulativeTranscript);
    const hasDysphagiaDenial = /\b(?:no|not|neither|without|no\s+trouble|can\s+swallow\s+(?:fine|ok|normally))\s+(?:trouble\s+swallowing|difficulty\s+swallowing|problems?\s+swallowing|dysphagia)\b/i.test(state.cumulativeTranscript);

    if (hasDysphagiaComplaint && !hasDysphagiaDenial) {
      if (!state.slots.known_facts.some(f => /^SWALLOWING_DIFFICULTY:/i.test(f))) {
        state.slots.known_facts.push("SWALLOWING_DIFFICULTY: present (mechanical/functional)");
      }
    } else if (hasDysphagiaDenial) {
      if (state.conversationMemory && !state.conversationMemory.deniedSymptoms.includes("swallowing_difficulty")) {
        state.conversationMemory.deniedSymptoms.push("swallowing_difficulty");
      }
      if (state.conversationMemory && !state.conversationMemory.questionsAlreadyAsked.includes("swallowing_difficulty")) {
        state.conversationMemory.questionsAlreadyAsked.push("swallowing_difficulty");
      }
      if (!state.slots.known_facts.some(f => /denied:\s*swallowing_difficulty/i.test(f))) {
        state.slots.known_facts.push("Denied: swallowing_difficulty");
      }
    }

    // Opportunistic Ear Pain (Otalgia)
    const hasEarDenial = /\b(no\s+ear\s+pain|no\s+earache|ears?\s+(?:don't|do\s+not)\s+hurt|denies\s+ear\s+pain)\b/i.test(state.cumulativeTranscript);
    const hasEarPresent = !hasEarDenial && /\b(ear\s+pain|earache|ears?\s+hurts?|ear\s+is\s+(?:hurting|aching|paining)|pain\s+spreads?\s+to\s+ears?)\b/i.test(state.cumulativeTranscript);

    if (hasEarDenial) {
      if (state.conversationMemory && !state.conversationMemory.deniedSymptoms.includes("ear_pain")) {
        state.conversationMemory.deniedSymptoms.push("ear_pain");
      }
      if (state.conversationMemory && !state.conversationMemory.questionsAlreadyAsked.includes("ear_pain")) {
        state.conversationMemory.questionsAlreadyAsked.push("ear_pain");
      }
      if (!state.slots.known_facts.some(f => /denied:\s*ear_pain/i.test(f))) {
        state.slots.known_facts.push("Denied: ear_pain");
      }
    } else if (hasEarPresent) {
      if (!state.slots.associated_symptoms.includes("ear pain")) {
        state.slots.associated_symptoms.push("ear pain");
      }
      if (!state.slots.known_facts.some(f => /^EAR_PAIN:/i.test(f))) {
        state.slots.known_facts.push("EAR_PAIN: present");
      }
    }

    // Deduplicate known facts
    state.slots.known_facts = Array.from(new Set(state.slots.known_facts));

    if (/\b(weak|weakness|numb|numbness)\b/i.test(state.cumulativeTranscript) && !state.slots.neurological_signs.includes("transient weakness and numbness")) {
      state.slots.neurological_signs.push("transient weakness and numbness");
      const fact = "Reported: transient weakness and numbness";
      if (!state.slots.known_facts.includes(fact)) {
        state.slots.known_facts.push(fact);
      }
      if (state.conversationMemory && !state.conversationMemory.uncertainties.includes("weakness_distribution")) {
        state.conversationMemory.uncertainties.push("distribution of weakness/numbness (unilateral vs bilateral)");
      }
    }

    // Opportunistic Petechiae / Bleeding tendency (MoHFW Dengue Warning Signs)
    if (/\b(red\s+spots|petechiae|purpura|bleeding\s+gums|gum\s+bleeding|nosebleed|epistaxis|unusual\s+bruising)\b/i.test(state.cumulativeTranscript)) {
      if (!state.slots.known_facts.some(f => /BLEEDING_TENDENCY|petechiae/i.test(f))) {
        state.slots.known_facts.push("BLEEDING_TENDENCY: petechiae / bleeding gums present");
      }
    }

    // Opportunistic Trismus (Peritonsillar Abscess / Airway Compromise)
    if (/\b(cannot\s+open\s+mouth|hard\s+to\s+open\s+jaw|jaw\s+stiff|trismus|mouth\s+won'?t\s+open)\b/i.test(state.cumulativeTranscript)) {
      if (!state.slots.known_facts.some(f => /TRISMUS/i.test(f))) {
        state.slots.known_facts.push("TRISMUS: limited jaw opening present");
      }
    }
  }

  /**
   * Stateful Clinical Dialogue Policy:
   * Powered by clinicalDecisionEngine:
   * 1. Classifies the patient turn (intent, questions, temporal shifts, corrections, emotions).
   * 2. Maintains structured clinical state (symptoms, timeline anchors, known facts).
   * 3. Selects the next-turn clinical action decision (answers direct inquiries, advances interview).
   * 4. Enforces anti-repetition shield so the doctor never replays duplicate responses.
   */
  private handleEmergencyTurn(
    cleanMsg: string,
    state: ClinicalInterviewState,
    preArbiterResult: PreArbiterResult,
    localeConfig: LocaleConfig
  ): string {
    const classification = clinicalDecisionEngine.classifyTurn(cleanMsg, state);
    clinicalDecisionEngine.updateStructuredState(state, classification, cleanMsg);
    const decision = clinicalDecisionEngine.decideNextAction(classification, state, preArbiterResult, localeConfig);

    if (state.structuredHistory) {
      state.structuredHistory.recentDoctorReplies.push(decision.spokenDoctorReply);
      if (state.structuredHistory.recentDoctorReplies.length > 5) {
        state.structuredHistory.recentDoctorReplies.shift();
      }
    }

    return decision.spokenDoctorReply;
  }
}

export const conversationManager = new ConversationManager();
