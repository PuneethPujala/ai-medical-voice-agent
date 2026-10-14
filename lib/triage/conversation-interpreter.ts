import { PendingQuestion } from "../agents/schemas";
import { extractNumericSeverity, extractEpisodicSeverity, extractGiAssociatedSymptoms, NON_DENIABLE_SLOTS, detectQuestionTargetSlot, parseOnsetDimensions } from "./clinical-state";

export type PatientIntent =
  | "answer_pending_question"
  | "symptom_report"
  | "confirmation_or_correction"
  | "patient_objection_repetition"
  | "frequency_clarification"
  | "emotional_distress"
  | "access_barrier"
  | "emergency_inquiry"
  | "explanatory_inquiry"
  | "memory_inquiry"
  | "meta_inquiry"
  | "closing"
  | "correction"
  | "uncertainty_or_unknown"
  | "vague_answer"
  | "unrelated_statement"
  | "small_talk";

export interface SemanticInterpretation {
  rawUtterance: string;
  intent: PatientIntent;
  resolvedQuestionId?: string;
  resolvedSlot?: string;
  resolvedValue?: string;
  isConfirmationOrRepetition: boolean;
  isObjectionRepetition?: boolean;
  isCorrection?: boolean;
  correctedSlot?: string;
  correctedValue?: string;
  correctedDetail?: string;
  isUncertainty?: boolean;
  isEmergencyInquiry: boolean;
  isExplanatoryInquiry?: boolean;
  isMemoryInquiry?: boolean;
  isMetaInquiry?: boolean;
  isEmotionalDistress?: boolean;
  isAccessBarrier?: boolean;
  extractedFrequency?: string;
  extractedRiskFactors?: string;
  newEvidence: Array<{ slot: string; value: string }>;
  ambiguities: string[];
  confidence: number;
}

export class ConversationInterpreter {
  public interpret(
    utterance: string,
    pendingQuestion: PendingQuestion | null = null,
    currentSlots: Record<string, any> = {},
    isEmergencyActive = false
  ): SemanticInterpretation {
    const text = utterance.trim();
    const lower = text.toLowerCase();

    // 1. Detect Small Talk / Greetings
    const hasClinicalKeywords = /\b(pain|tightness|pressure|ache|hurt|droop|stroke|fever|cough|breath|dizzy|numb|bleeding|nausea|vomit|symptom|chest|arm|head|stomach|belly|throat|rash|swelling)\b/i.test(lower);
    if (
      !hasClinicalKeywords &&
      (/^(hello|hi|hey|good\s+(morning|afternoon|evening)|can\s+you\s+hear\s+me|testing|greetings)[.!?\s]*$/i.test(lower) ||
       /\b(can\s+you\s+hear\s+me|mic\s+check|testing\s+one\s+two)\b/i.test(lower) ||
       /^(hello|hi|hey)\b.*?\b(doctor|dr|can\s+you\s+hear\s+me)\b/i.test(lower) ||
       (text.length <= 25 && /\b(hello|hi|hey|greetings)\b/i.test(lower)))
    ) {
      return {
        rawUtterance: text,
        intent: "small_talk",
        isConfirmationOrRepetition: false,
        isEmergencyInquiry: false,
        newEvidence: [],
        ambiguities: [],
        confidence: 0.95,
      };
    }

    // 2. Detect Closing / Thank you
    if (
      !hasClinicalKeywords &&
      (/\b(thank\s+you|thanks|thank\s+you\s+so\s+much|ok\s+thanks|bye|goodbye|have\s+a\s+good\s+(?:day|night))\b/i.test(lower) ||
       /^(thank\s+you|thanks|bye|goodbye)\b/i.test(lower))
    ) {
      return {
        rawUtterance: text,
        intent: "closing",
        isConfirmationOrRepetition: false,
        isEmergencyInquiry: false,
        newEvidence: [],
        ambiguities: [],
        confidence: 0.98,
      };
    }

    // 3. Detect Emergency Inquiries (frantic action/help questions)
    const emergencyInquiryPattern =
      /\b(what\s+(do|should)\s+i\s+do|no\s+one\s+(is\s+)?around|alone|nobody\s+here|who\s+(do|can)\s+i\s+call|should\s+i\s+(take|call)|is\s+an?\s+ambulance|help\s+me|what\s+now)\b/i;
    const isEmergencyQuestion = emergencyInquiryPattern.test(lower);

    if (isEmergencyQuestion) {
      return {
        rawUtterance: text,
        intent: "emergency_inquiry",
        isConfirmationOrRepetition: false,
        isEmergencyInquiry: true,
        newEvidence: [],
        ambiguities: [],
        confidence: 0.95,
      };
    }

    // 3.5 Detect Explanatory Inquiries ("why is that?", "what could cause this?", "why does it feel like...")
    const explanatoryPattern =
      /\b(why\s+(?:is\s+that|is\s+it|does\s+it|would\s+it|am\s+i|do\s+i)|what\s+(?:causes?|is\s+causing|could\s+(?:this|it)\s+be)|what\s+does\s+that\s+mean|could\s+this\s+be|what\s+is\s+happening)\b/i;
    const isExplanatoryQuestion = explanatoryPattern.test(lower);

    if (isExplanatoryQuestion && !isEmergencyQuestion) {
      return {
        rawUtterance: text,
        intent: "explanatory_inquiry",
        isConfirmationOrRepetition: false,
        isEmergencyInquiry: false,
        isExplanatoryInquiry: true,
        newEvidence: [],
        ambiguities: [],
        confidence: 0.94,
      };
    }

    // 3.6 Detect Memory / Continuity Inquiries ("do you remember my illness?", "do you remember me?", "what did I say earlier?")
    const memoryPattern =
      /\b(do\s+you\s+(?:remember|recall|know)|did\s+you\s+(?:forget|remember)|what\s+did\s+i\s+(?:say|tell\s+you)|remember\s+(?:me|my\s+(?:illness|condition|symptoms?|problem|case|history)))\b/i;
    const isMemoryQuestion = memoryPattern.test(lower);

    if (isMemoryQuestion && !isEmergencyQuestion) {
      return {
        rawUtterance: text,
        intent: "memory_inquiry",
        isConfirmationOrRepetition: false,
        isEmergencyInquiry: false,
        isMemoryInquiry: true,
        newEvidence: [],
        ambiguities: [],
        confidence: 0.95,
      };
    }

    // 3.7 Detect Meta / Identity Inquiries ("who are you?", "are you a real doctor?", "is this private?")
    const metaPattern =
      /\b(who\s+are\s+you|are\s+you\s+(?:a\s+real\s+doctor|an?\s+ai|human|a\s+robot)|how\s+does\s+this\s+work|is\s+this\s+(?:private|confidential|secure|safe))\b/i;
    const isMetaQuestion = metaPattern.test(lower);

    if (isMetaQuestion && !isEmergencyQuestion) {
      return {
        rawUtterance: text,
        intent: "meta_inquiry",
        isConfirmationOrRepetition: false,
        isEmergencyInquiry: false,
        isMetaInquiry: true,
        newEvidence: [],
        ambiguities: [],
        confidence: 0.94,
      };
    }

    // 3.8 Detect Patient Repetition Objection ("We already talked about it?", "I already answered that", "Didn't I already say...", "a minute like i said before?", "I insist...")
    const repetitionObjectionPattern =
      /\b(i\s+insist|we\s+already\s+(?:talked|spoke|discussed|went\s+over|covered|said|cleared)|i\s+already\s+(?:said|told\s+you|answered|mentioned)|why\s+(?:do\s+you|are\s+you)\s+(?:ask|asking)\s+(?:again|that\s+again)|didn'?t\s+i\s+already|already\s+answered|you\s+already\s+asked|like\s+i\s+said(?:\s+before)?|as\s+i\s+said(?:\s+before)?)\b/i;
    const isRepetitionObjection = repetitionObjectionPattern.test(lower);

    if (isRepetitionObjection && !isEmergencyQuestion) {
      const durationInObjection = lower.match(/\b(?:for\s+)?(\d+\s*(?:minutes?|hours?|seconds?|days?)|a\s+minute|few\s+seconds|few\s+minutes)\b/i);
      const newEv: Array<{ slot: string; value: string }> = [];
      if (durationInObjection) {
        newEv.push({ slot: "duration", value: `approx. ${durationInObjection[0]}` });
      }

      return {
        rawUtterance: text,
        intent: "patient_objection_repetition",
        isConfirmationOrRepetition: true,
        isObjectionRepetition: true,
        isEmergencyInquiry: false,
        newEvidence: newEv,
        ambiguities: [],
        confidence: 0.96,
      };
    }

    // 3.9 Detect Emotional Distress / Fear ("I'm really scared", "Am I going to die?", "I'm terrified")
    const emotionPattern =
      /\b(really\s+scared|so\s+scared|terrified|panicking|freaking\s+out|im\s+scared|i\s+am\s+scared|am\s+i\s+going\s+to\s+(?:die|be\s+okay)|so\s+worried|im\s+afraid|i\s+feel\s+helpless)\b/i;
    const isEmotionalDistress = emotionPattern.test(lower);

    if (isEmotionalDistress && !isEmergencyQuestion) {
      return {
        rawUtterance: text,
        intent: "emotional_distress",
        isConfirmationOrRepetition: false,
        isEmergencyInquiry: false,
        isEmotionalDistress: true,
        newEvidence: [],
        ambiguities: [],
        confidence: 0.95,
      };
    }

    // 3.10 Detect Negative Answers / Symptom Denials ("Nothing else I guess?", "Nope none", "No", "None")
    const isNegativeResponse =
      /^(?:no|nope|none|nothing|nothing\s+else|nothing\s+with\s+that|nothing\s+like\s+that|no\s+trouble\s+with\s+that|no\s+problem\s+with\s+that|none\s+of\s+that|no\s+other\s+symptoms?|none\s+of\s+those|not\s+really|i\s+don'?t\s+think\s+so)[.!?\s]*$/i.test(lower) ||
      /\b(nothing\s+else(?:\s+i\s+guess)?|nope\s+none|nothing\s+with\s+that|nothing\s+like\s+that|no\s+trouble\s+with\s+that|no\s+weakness|no\s+droop|no\s+vision|neither|none\s+of\s+those)\b/i.test(lower);

    if (isNegativeResponse && !isEmergencyQuestion) {
      let slotTarget = pendingQuestion?.targetSlot;
      // Architectural rule: NON_DENIABLE_SLOTS can NEVER be resolved as "denied".
      // Re-associate with the doctor's actual spoken question if available:
      if (!slotTarget || NON_DENIABLE_SLOTS.has(slotTarget)) {
        const detectedFromQ = detectQuestionTargetSlot(pendingQuestion?.question || "");
        slotTarget = !NON_DENIABLE_SLOTS.has(detectedFromQ) ? detectedFromQ : "associated_symptoms";
      }
      return {
        rawUtterance: text,
        intent: "answer_pending_question",
        resolvedQuestionId: pendingQuestion?.id,
        resolvedSlot: slotTarget,
        resolvedValue: "denied",
        isConfirmationOrRepetition: false,
        isEmergencyInquiry: false,
        newEvidence: [{ slot: slotTarget, value: "denied" }],
        ambiguities: [],
        confidence: 0.95,
      };
    }

    // 3.11 Detect Access Constraints ("poor", "can't afford", "no money", "outskirts", "can't drive")
    const accessBarrierPattern =
      /\b(poor|can'?t\s+afford|cannot\s+afford|no\s+money|too\s+expensive|no\s+insurance|cost\s+too\s+much|remote|outskirts|village|far\s+away|cannot\s+drive|no\s+car|no\s+ride)\b/i;
    const isAccessBarrier = accessBarrierPattern.test(lower);

    if (isAccessBarrier && !isEmergencyQuestion && !hasClinicalKeywords) {
      return {
        rawUtterance: text,
        intent: "access_barrier",
        isConfirmationOrRepetition: false,
        isEmergencyInquiry: false,
        isAccessBarrier: true,
        newEvidence: [],
        ambiguities: [],
        confidence: 0.93,
      };
    }

    // 3.12 Detect Frequency / Intermittent Pattern & Negative Risk Factors
    // e.g. "None... but it just happens once in a month i think?"
    const frequencyMatch = lower.match(/\b(once\s+(?:in\s+a\s+|a\s+)?month|every\s+(?:day|week|month)|comes\s+and\s+goes|happens?\s+(?:sometimes|occasionally|rarely|once\s+in\s+a\s+while|intermittent(?:ly)?|\d+\s+times?\s+a\s+(?:month|week|year)))\b/i);
    const hasNoneRisk = /\b(none|no\s+heart\s+disease|no\s+history|no\s+prior|never\s+had\s+heart|no\s+risk\s+factors)\b/i.test(lower);

    if ((frequencyMatch || hasNoneRisk) && !isEmergencyQuestion) {
      const extracted: Array<{ slot: string; value: string }> = [];
      let freqVal: string | undefined = undefined;
      let riskVal: string | undefined = undefined;

      if (frequencyMatch) {
        freqVal = frequencyMatch[0];
        extracted.push({ slot: "frequency", value: `intermittent (${frequencyMatch[0]})` });
      }
      if (hasNoneRisk) {
        riskVal = "none reported";
        extracted.push({ slot: "risk_factors", value: "none reported" });
      }

      return {
        rawUtterance: text,
        intent: "frequency_clarification",
        isConfirmationOrRepetition: false,
        isEmergencyInquiry: false,
        extractedFrequency: freqVal,
        extractedRiskFactors: riskVal,
        newEvidence: extracted,
        ambiguities: [],
        confidence: 0.94,
      };
    }

    // 3.13 Detect Patient Contradiction / Correction ("Actually it started yesterday, not 2 days ago", "No wait, my left arm")
    const isCorrectionPattern =
      /\b(actually\s+(?:it|it's|it\s+started|i\s+meant|not)|no\s+(?:wait|actually|i\s+meant)|wait\s+(?:no|actually)|instead\s+of|scratch\s+that|i\s+mean|correction)\b/i;
    if (isCorrectionPattern.test(lower)) {
      let correctedSlot: string | undefined = undefined;
      let correctedValue: string | undefined = undefined;
      let correctedDetail: string = "your updated details";

      const timeCorrection = lower.match(/\b(yesterday|today|this\s+morning|\d+\s*(?:minutes?|hours?|days?|weeks?))\b/i);
      const radCorrection = lower.match(/\b(left\s+arm|right\s+arm|arm|jaw|neck|back|shoulder|head)\b/i);

      if (timeCorrection) {
        correctedSlot = "onset";
        correctedValue = timeCorrection[0];
        correctedDetail = `that it started ${timeCorrection[0]}`;
      } else if (radCorrection) {
        correctedSlot = "radiation";
        correctedValue = radCorrection[0];
        correctedDetail = `that it moves to your ${radCorrection[0]}`;
      }

      return {
        rawUtterance: text,
        intent: "correction",
        isConfirmationOrRepetition: true,
        isCorrection: true,
        isEmergencyInquiry: false,
        correctedSlot,
        correctedValue,
        correctedDetail,
        newEvidence: correctedSlot && correctedValue ? [{ slot: correctedSlot, value: correctedValue }] : [],
        ambiguities: [],
        confidence: 0.95,
      };
    }

    // 3.14 Detect Uncertainty / Unknown ("I don't know", "Not really sure", "Hard to tell")
    const isUncertainty =
      /^(?:i\s+don'?t\s+know|not\s+sure|hard\s+to\s+tell|no\s+idea|can'?t\s+remember|not\s+really\s+sure)[.!?\s]*$/i.test(lower) ||
      /\b(i\s+don'?t\s+know|not\s+really\s+sure|hard\s+to\s+say|cannot\s+tell)\b/i.test(lower);
    if (isUncertainty) {
      return {
        rawUtterance: text,
        intent: "uncertainty_or_unknown",
        isConfirmationOrRepetition: false,
        isUncertainty: true,
        isEmergencyInquiry: false,
        newEvidence: [],
        ambiguities: [],
        confidence: 0.93,
      };
    }

    // 3.15 Detect Vague Answers ("a bit", "kind of", "sort of", "a little")
    const isVague = /^(?:a\s+bit|kind\s+of|sort\s+of|a\s+little|somewhat|maybe|not\s+much)[.!?\s]*$/i.test(lower);
    if (isVague) {
      return {
        rawUtterance: text,
        intent: "vague_answer",
        isConfirmationOrRepetition: false,
        isEmergencyInquiry: false,
        newEvidence: [],
        ambiguities: ["Symptom intensity / character is unquantified"],
        confidence: 0.88,
      };
    }

    // 4. Detect Confirmation / Repetition / Clarification of already stated fact
    const isConfirmation =
      /^(i\s+said|like\s+i\s+said|as\s+i\s+said|already\s+told\s+you|i\s+told\s+you|yes\s+head|i\s+said\s+head\??)\b/i.test(lower) ||
      /\b(i\s+said\s+[a-z]+|\bhead\?|\byes\b|\bcorrect\b|\bthats\s+right\b)/i.test(lower);

    if (isConfirmation && (currentSlots.radiation || currentSlots.onset || currentSlots.character)) {
      return {
        rawUtterance: text,
        intent: "confirmation_or_correction",
        isConfirmationOrRepetition: true,
        isEmergencyInquiry: false,
        newEvidence: [],
        ambiguities: [],
        confidence: 0.92,
      };
    }

    // 5. Detect Answers to Pending Questions
    if (pendingQuestion && pendingQuestion.status === "pending") {
      const targetSlot = pendingQuestion.targetSlot;

      // Check Radiation slot
      if (targetSlot === "radiation") {
        const radMatch = lower.match(/\b(head|arm|left\s+arm|shoulder|jaw|back|neck|chest|nowhere|no\s+radiation|stays\s+in\s+chest)\b/i);
        if (radMatch || lower.includes("to my head") || lower.includes("down my arm")) {
          const val = lower.includes("head") ? "head" : radMatch ? radMatch[1] : "arm";
          return {
            rawUtterance: text,
            intent: "answer_pending_question",
            resolvedQuestionId: pendingQuestion.id,
            resolvedSlot: "radiation",
            resolvedValue: val,
            isConfirmationOrRepetition: false,
            isEmergencyInquiry: false,
            newEvidence: [{ slot: "radiation", value: val }],
            ambiguities: [],
            confidence: 0.94,
          };
        }
      }

      // Check Exertional slot
      if (targetSlot === "exertional") {
        if (/stairs|walking|active|exercise|effort|moving/i.test(lower)) {
          return {
            rawUtterance: text,
            intent: "answer_pending_question",
            resolvedQuestionId: pendingQuestion.id,
            resolvedSlot: "exertional",
            resolvedValue: "positive (exertional: climbing stairs/active)",
            isConfirmationOrRepetition: false,
            isEmergencyInquiry: false,
            newEvidence: [{ slot: "exertional", value: "positive" }],
            ambiguities: [],
            confidence: 0.92,
          };
        }
        if (/rest|sitting|lying|relaxed|couch|tv|bed/i.test(lower)) {
          return {
            rawUtterance: text,
            intent: "answer_pending_question",
            resolvedQuestionId: pendingQuestion.id,
            resolvedSlot: "exertional",
            resolvedValue: "negative (at rest)",
            isConfirmationOrRepetition: false,
            isEmergencyInquiry: false,
            newEvidence: [{ slot: "exertional", value: "negative" }],
            ambiguities: [],
            confidence: 0.92,
          };
        }
      }

      // Check Onset slot
      if (targetSlot === "onset") {
        const parsedOnset = parseOnsetDimensions(lower);
        let val = parsedOnset.onsetTime || parsedOnset.onsetPattern;
        if (val && parsedOnset.acuteWorsening) {
          val = `${val}, acute worsening`;
        }
        if (val) {
          return {
            rawUtterance: text,
            intent: "answer_pending_question",
            resolvedQuestionId: pendingQuestion.id,
            resolvedSlot: "onset",
            resolvedValue: val,
            isConfirmationOrRepetition: false,
            isEmergencyInquiry: false,
            newEvidence: [{ slot: "onset", value: val }],
            ambiguities: [],
            confidence: 0.9,
          };
        }
      }

      // Check Voice Character slot
      if (targetSlot === "voice_character") {
        const isHoarse = /\b(hoarse|raspy|husky|scratchy)\b/i.test(lower);
        const isLoss = /\b(hard|cannot|can't|loss|lost|producing|struggling|whisper|weak)\b/i.test(lower);
        const val = isHoarse ? "hoarseness" : isLoss ? "difficulty producing voice" : text;
        return {
          rawUtterance: text,
          intent: "answer_pending_question",
          resolvedQuestionId: pendingQuestion.id,
          resolvedSlot: "voice_character",
          resolvedValue: val,
          isConfirmationOrRepetition: false,
          isEmergencyInquiry: false,
          newEvidence: [{ slot: "voice_character", value: val }],
          ambiguities: [],
          confidence: 0.94,
        };
      }

      // Check Swallowing Difficulty slot
      if (targetSlot === "swallowing_difficulty") {
        const isDenied = /\b(no|nope|not|neither|no\s+trouble|can\s+swallow|fine)\b/i.test(lower);
        const val = isDenied ? "denied" : "difficulty swallowing";
        return {
          rawUtterance: text,
          intent: "answer_pending_question",
          resolvedQuestionId: pendingQuestion.id,
          resolvedSlot: "swallowing_difficulty",
          resolvedValue: val,
          isConfirmationOrRepetition: false,
          isEmergencyInquiry: false,
          newEvidence: [{ slot: "swallowing_difficulty", value: val }],
          ambiguities: [],
          confidence: 0.95,
        };
      }

      // Check Fever slot
      if (targetSlot === "fever") {
        const isDenied = /\b(no|nope|not|neither|haven'?t|no\s+fever)\b/i.test(lower);
        const val = isDenied ? "denied" : "fever reported";
        return {
          rawUtterance: text,
          intent: "answer_pending_question",
          resolvedQuestionId: pendingQuestion.id,
          resolvedSlot: "fever",
          resolvedValue: val,
          isConfirmationOrRepetition: false,
          isEmergencyInquiry: false,
          newEvidence: [{ slot: "fever", value: val }],
          ambiguities: [],
          confidence: 0.95,
        };
      }

      // Check Severity slot
      if (targetSlot === "severity") {
        const val = extractNumericSeverity(lower, true) || text;
        return {
          rawUtterance: text,
          intent: "answer_pending_question",
          resolvedQuestionId: pendingQuestion.id,
          resolvedSlot: "severity",
          resolvedValue: val,
          isConfirmationOrRepetition: false,
          isEmergencyInquiry: false,
          newEvidence: [{ slot: "severity", value: val }],
          ambiguities: [],
          confidence: 0.93,
        };
      }
    }

    // 6. Generic Symptom Report
    const extracted: Array<{ slot: string; value: string }> = [];
    const opportunisticSev = extractEpisodicSeverity(lower)?.display || extractNumericSeverity(lower);
    if (opportunisticSev) {
      extracted.push({ slot: "severity", value: opportunisticSev });
    }
    if (/chest|tightness|pressure|crushing|squeezing/i.test(lower)) {
      extracted.push({ slot: "character", value: "tightness/pressure" });
    }
    if (/throat\s+pain|sore\s+throat|throat\s+is\s+paining|throat\s+hurts?/i.test(lower)) {
      extracted.push({ slot: "chief_complaint", value: "throat pain" });
    }
    if (/stomach\s+ache|stomach\s+pain|abdominal\s+pain|belly\s+ache/i.test(lower)) {
      extracted.push({ slot: "chief_complaint", value: "abdominal pain" });
    }
    if (/voice\s+has\s+been\s+ruined|voice\s+changed|voice\s+is\s+different|lost\s+my\s+voice|hoarse|hoarseness/i.test(lower)) {
      extracted.push({ slot: "associated_symptoms", value: "voice change" });
    }
    if (/sweat|clammy|diaphoresis/i.test(lower)) {
      extracted.push({ slot: "associated_symptoms", value: "cold sweats/diaphoresis" });
    }
    for (const gi of extractGiAssociatedSymptoms(lower)) {
      if (gi.status === "present") {
        extracted.push({ slot: "associated_symptoms", value: gi.name === "diarrhea" ? "diarrhea" : gi.name.replace(/_/g, " ") });
      }
    }
    if (/droop|facial\s+droop/i.test(lower)) {
      extracted.push({ slot: "neurological_signs", value: "facial droop" });
    }
    if (/slur|trouble\s+speaking|difficulty\s+speaking|slurred/i.test(lower)) {
      extracted.push({ slot: "neurological_signs", value: "speech difficulty" });
    }
    if (/dizzy|dizziness|lightheaded/i.test(lower)) {
      const isPostural = /\b(when\s+i\s+stand|after\s+i\s+sat|standing\s+up|getting\s+up|sitting\s+for\s+long)\b/i.test(lower);
      extracted.push({
        slot: "character",
        value: isPostural ? "postural dizziness upon standing" : "dizziness"
      });
      if (isPostural) {
        extracted.push({ slot: "onset", value: "intermittent upon standing after prolonged sitting" });
      }
    }
    if (/\b(weak|weakness|numb|numbness)\b/i.test(lower) && !lower.includes("no weak") && !lower.includes("no numb")) {
      extracted.push({ slot: "neurological_signs", value: "transient weakness and numbness" });
    }
    const durationMatch = lower.match(/\b(?:for\s+)?(\d+\s*(?:minutes?|hours?|seconds?|days?)|a\s+minute|few\s+seconds|few\s+minutes)\b/i);
    if (durationMatch) {
      extracted.push({ slot: "duration", value: `approx. ${durationMatch[0]}` });
    }
    if (/like\s+everytime|every\s+time/i.test(lower)) {
      extracted.push({ slot: "frequency", value: "occurs essentially every time upon standing" });
    }

    return {
      rawUtterance: text,
      intent: "symptom_report",
      isConfirmationOrRepetition: false,
      isEmergencyInquiry: false,
      newEvidence: extracted,
      ambiguities: [],
      confidence: 0.85,
    };
  }
}

export const conversationInterpreter = new ConversationInterpreter();
