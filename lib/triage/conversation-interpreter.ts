import { PendingQuestion } from "../agents/schemas";
import { extractNumericSeverity, extractEpisodicSeverity, extractGiAssociatedSymptoms, NON_DENIABLE_SLOTS, detectQuestionTargetSlot, parseOnsetDimensions } from "./clinical-state";
import { FactProposal } from "./fact-types";

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
  proposals?: FactProposal[];
  ambiguities: string[];
  confidence: number;
}

/**
 * Scans a lowercase utterance for a regex match that is NOT negated within its local clause.
 * Evaluates preceding clause tokens (after clause boundaries like '.', ';', '!', '?', 'but', 'however', 'yet')
 * for negation tokens ('no', 'not', 'without', 'neither', 'never', 'denies', 'deny', 'free of'),
 * as well as post-positioned resolution phrases ('yesterday but not now', 'resolved', 'gone').
 */
export function findNonNegatedMatch(lowerText: string, regex: RegExp, windowChars = 55): RegExpExecArray | null {
  regex.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(lowerText)) !== null) {
    const startIndex = match.index;
    const preceding = lowerText.slice(Math.max(0, startIndex - windowChars), startIndex);
    const lastBoundary = Math.max(
      preceding.lastIndexOf("."),
      preceding.lastIndexOf(";"),
      preceding.lastIndexOf("!"),
      preceding.lastIndexOf("?"),
      preceding.search(/\b(?:but|however|yet)\b/i)
    );
    const clausePrefix = lastBoundary >= 0 ? preceding.slice(lastBoundary) : preceding;
    const preNegated = /\b(?:no|not|without|neither|never|denies|deny|free\s+of)\b/i.test(clausePrefix);

    const following = lowerText.slice(startIndex, Math.min(lowerText.length, startIndex + 50));
    const postNegated = /\b(?:yesterday|past|earlier|before)\b.*?\b(?:not\s+now|resolved|gone|settled)\b/i.test(following) ||
                        /^[a-z\s,]{0,30}\b(?:not\s+now|is\s+gone|has\s+resolved|resolved|gone|settled)\b/i.test(following);

    if (!preNegated && !postNegated) {
      return match;
    }
  }
  return null;
}

export class ConversationInterpreter {
  public interpret(
    utterance: string,
    pendingQuestion: PendingQuestion | null = null,
    currentSlots: Record<string, any> = {},
    isEmergencyActive = false
  ): SemanticInterpretation {
    const result = this.internalInterpret(utterance, pendingQuestion, currentSlots, isEmergencyActive);
    result.proposals = this.generateFactProposals(result, utterance, pendingQuestion, currentSlots);
    return result;
  }

  private internalInterpret(
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

    // 3.14 Detect Uncertainty / Unknown ("I don't know", "Not really sure", "Hard to tell", "can't tell")
    const isUncertainty =
      /^(?:i\s+don'?t\s+know|not\s+sure|hard\s+to\s+tell|no\s+idea|can'?t\s+remember|not\s+really\s+sure|really\s+not\s+sure)[.!?\s]*$/i.test(lower) ||
      /\b(i\s+don'?t\s+know|not\s+(?:really\s+)?sure|(?:really\s+)?not\s+sure|hard\s+to\s+(?:say|tell)|can(?:not|'?t)\s+tell|cannot\s+say|no\s+idea|can'?t\s+remember)\b/i.test(lower);
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

      // Check Weakness / Numbness Distribution & Laterality slot
      if (targetSlot === "weakness_distribution" || targetSlot === "numbness_distribution" || targetSlot === "laterality") {
        const isHead = /\b(?:just\s+(?:in\s+my\s+)?head|only\s+(?:in\s+my\s+)?head|in\s+(?:my\s+)?head|cranial)\b/i.test(lower);
        const isSystemic = /\b(?:whole\s+(?:nervous\s+)?system|whole\s+body|all\s+over|everywhere|generalized)\b/i.test(lower);
        const isOneSided = /\b(?:one\s+side|left|right|unilateral|single\s+side)\b/i.test(lower);
        const isBothSided = /\b(?:both\s+sides|both|bilateral|symmetrical)\b/i.test(lower);

        let val = text;
        if (isHead && isSystemic) {
          val = "cranial sensation affecting whole nervous system (non-focal)";
        } else if (isHead) {
          val = "head only (non-focal)";
        } else if (isOneSided) {
          val = "unilateral (one-sided)";
        } else if (isBothSided || isSystemic) {
          val = "bilateral / generalized";
        }

        return {
          rawUtterance: text,
          intent: "answer_pending_question",
          resolvedQuestionId: pendingQuestion.id,
          resolvedSlot: targetSlot,
          resolvedValue: val,
          isConfirmationOrRepetition: false,
          isEmergencyInquiry: false,
          newEvidence: [{ slot: targetSlot, value: val }],
          ambiguities: [],
          confidence: 0.94,
        };
      }

      // Check Neurological Signs slot
      if (targetSlot === "neurological_signs") {
        const signs: string[] = [];
        if (/\b(droop|face|facial|asymmetry)\b/i.test(lower)) signs.push("facial droop");
        if (/\b(weak|weakness|cannot\s+lift|drift|paralysis|arm|leg)\b/i.test(lower) && !/\b(no\s+weak|neither)\b/i.test(lower)) {
          signs.push("limb weakness");
        }
        if (/\b(numb|numbness|pins\s+and\s+needles|tingl(?:ing|e)?)\b/i.test(lower) && !/\b(no\s+numb|neither)\b/i.test(lower)) {
          signs.push("numbness");
        }
        if (/\b(slur|speech|talk|words)\b/i.test(lower)) signs.push("speech difficulty");
        if (/\b(vision|blurry|double\s+vision|diplopia)\b/i.test(lower)) signs.push("vision changes");
        if (/\b(dizz|dizzy|lightheaded|vertigo)\b/i.test(lower)) signs.push("dizziness");
        if (/\b(neck\s+stiff|stiff\s+neck|nuchal\s+rigidity)\b/i.test(lower)) signs.push("neck stiffness");
        if (/\b(photophob|light\s+sensitiv|bright\s+lights?\s+(?:really\s+)?(?:hurt|bother)|lights?\s+(?:hurt|bother))\b/i.test(lower)) signs.push("photophobia");

        const isExplicitDenial = /^(?:no|none|neither|nope|normal|denies)[.!?\s]*$/i.test(lower);
        const val = isExplicitDenial ? "denied" : signs.length > 0 ? signs.join(", ") : text;

        return {
          rawUtterance: text,
          intent: "answer_pending_question",
          resolvedQuestionId: pendingQuestion.id,
          resolvedSlot: "neurological_signs",
          resolvedValue: val,
          isConfirmationOrRepetition: false,
          isEmergencyInquiry: false,
          newEvidence: signs.map(s => ({ slot: "neurological_signs", value: s })),
          ambiguities: [],
          confidence: 0.92,
        };
      }

      // Check Timing Pattern / Severity Pattern slot
      if (targetSlot === "timing_pattern" || targetSlot === "severity_pattern") {
        const isConstant = /\b(constant|constantly|all\s+the\s+time|continuous|never\s+stops)\b/i.test(lower);
        const isIntermittent = /\b(comes\s+and\s+goes|intermittent|in\s+waves|episodic|spasms?)\b/i.test(lower);
        const isPostural = /\b(stand|walk|getting\s+up|sitting\s+down|upright|resting)\b/i.test(lower);

        let val = text;
        if (isConstant && isPostural) {
          val = "constant baseline, severe upon standing or walking after resting";
        } else if (isConstant) {
          val = "constant";
        } else if (isIntermittent) {
          val = "intermittent / comes and goes";
        }

        return {
          rawUtterance: text,
          intent: "answer_pending_question",
          resolvedQuestionId: pendingQuestion.id,
          resolvedSlot: targetSlot,
          resolvedValue: val,
          isConfirmationOrRepetition: false,
          isEmergencyInquiry: false,
          newEvidence: [{ slot: targetSlot, value: val }],
          ambiguities: [],
          confidence: 0.94,
        };
      }
    }

    // 6. Generic Symptom Report
    const extracted: Array<{ slot: string; value: string }> = [];
    const opportunisticSev = extractEpisodicSeverity(lower)?.display || extractNumericSeverity(lower);
    if (opportunisticSev) {
      extracted.push({ slot: "severity", value: opportunisticSev });
    }
        const charRegex = /\b(tightness|pressure|squeezing|crushing|burning|sharp|heavy|elephant|cramp(?:ing)?|colic(?:ky)?|spasm|gnawing)\b/gi;
    const matchedChar = findNonNegatedMatch(lower, charRegex);
    if (matchedChar) {
      extracted.push({ slot: "character", value: matchedChar[1] });
    }
    if (findNonNegatedMatch(lower, /throat\s+pain|sore\s+throat|throat\s+is\s+paining|throat\s+hurts?/gi)) {
      extracted.push({ slot: "chief_complaint", value: "throat pain" });
    }
    if (findNonNegatedMatch(lower, /stomach\s+ache|stomach\s+pain|abdominal\s+pain|belly\s+ache/gi)) {
      extracted.push({ slot: "chief_complaint", value: "abdominal pain" });
    }
    if (findNonNegatedMatch(lower, /headache|migraine|head\s+pain/gi)) {
      extracted.push({ slot: "chief_complaint", value: "headache" });
    }
    if (findNonNegatedMatch(lower, /voice\s+has\s+been\s+ruined|voice\s+changed|voice\s+is\s+different|lost\s+my\s+voice|hoarse|hoarseness/gi)) {
      extracted.push({ slot: "associated_symptoms", value: "voice change" });
    }
    if (findNonNegatedMatch(lower, /sweat|clammy|diaphoresis/gi)) {
      extracted.push({ slot: "associated_symptoms", value: "cold sweats/diaphoresis" });
    }
    for (const gi of extractGiAssociatedSymptoms(lower)) {
      if (gi.status === "present") {
        extracted.push({ slot: "associated_symptoms", value: gi.name === "diarrhea" ? "diarrhea" : gi.name.replace(/_/g, " ") });
      }
    }
    if (findNonNegatedMatch(lower, /droop|facial\s+droop/gi)) {
      extracted.push({ slot: "neurological_signs", value: "facial droop" });
    }
    if (findNonNegatedMatch(lower, /slur|trouble\s+speaking|difficulty\s+speaking|slurred/gi)) {
      extracted.push({ slot: "neurological_signs", value: "speech difficulty" });
    }
    const dizzyRegex = /\b(dizzy|dizziness|lightheaded)\b/gi;
    const matchedDizzy = findNonNegatedMatch(lower, dizzyRegex);
    if (matchedDizzy) {
      const isPostural = /\b(when\s+i\s+stand|after\s+i\s+sat|standing\s+up|getting\s+up|sitting\s+for\s+long)\b/i.test(lower);
      extracted.push({
        slot: "character",
        value: isPostural ? "postural dizziness upon standing" : "dizziness"
      });
      extracted.push({ slot: "associated_symptoms", value: "dizziness" });
      if (isPostural) {
        extracted.push({ slot: "onset", value: "intermittent upon standing after prolonged sitting" });
      }
    }
    // Independent extraction for weakness vs numbness — NEVER conflate!
    if (findNonNegatedMatch(lower, /\b(weak|weakness|cannot\s+lift|arm\s+weak|leg\s+weak|drift|paralysis)\b/gi)) {
      extracted.push({ slot: "neurological_signs", value: "weakness" });
    }
    if (findNonNegatedMatch(lower, /\b(numb|numbness|pins\s+and\s+needles|tingl(?:ing|e)?)\b/gi)) {
      extracted.push({ slot: "neurological_signs", value: "numbness" });
    }
    if (findNonNegatedMatch(lower, /\b(neck\s+stiff|stiff\s+neck|nuchal\s+rigidity)\b/gi)) {
      extracted.push({ slot: "neurological_signs", value: "neck stiffness" });
    }
    if (findNonNegatedMatch(lower, /\b(photophob|light\s+sensitiv|bright\s+lights?\s+(?:really\s+)?(?:hurt|bother)|lights?\s+(?:hurt|bother))\b/gi)) {
      extracted.push({ slot: "associated_symptoms", value: "photophobia" });
    }
    // Positional exacerbation / orthostatic headache pattern
    if (/\b(?:severe\s+when\s+i\s+stand|worse\s+when\s+standing|standing\s+up\s+and\s+walk)\b/i.test(lower)) {
      extracted.push({ slot: "severity_pattern", value: "constant baseline, severe upon standing/walking" });
      extracted.push({ slot: "orthostatic_exacerbation", value: "worsens standing or walking after resting" });
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

  private generateFactProposals(
    interp: SemanticInterpretation,
    rawText: string,
    pendingQuestion: PendingQuestion | null,
    currentSlots: Record<string, any>
  ): FactProposal[] {
    const proposals: FactProposal[] = [];
    const text = rawText.trim();
    const lower = text.toLowerCase();

    // 1. Multi-clause temporal progression detector (e.g. "mild for two days, but an hour ago it suddenly became unbearable")
    const contrastMatch = text.match(/^(.*?)\b(?:but|however|yet|until|and\s+then)\b(.*?)$/i);
    if (contrastMatch) {
      const clause1 = contrastMatch[1].trim();
      const clause2 = contrastMatch[2].trim();
      const lower1 = clause1.toLowerCase();
      const lower2 = clause2.toLowerCase();

      const isClause1Baseline = /\b(mild|dull|days?|weeks?|slowly|gradual(?:ly)?)\b/i.test(lower1);
      const isClause2Acute = /\b(unbearable|sudden(?:ly)?|explosion|worse|severe|hours?|minutes?|10\/10)\b/i.test(lower2);

      if (isClause1Baseline && isClause2Acute) {
        // Extract baseline facts from clause 1
        const dur1 = lower1.match(/\b(?:for\s+)?(\d+\s*(?:days?|weeks?|months?)|a\s+day\s+or\s+two)\b/i);
        const sev1 = lower1.match(/\b(mild|dull|moderate|slight)\b/i);
        if (sev1) {
          proposals.push({
            concept: "headache_severity",
            value: `${sev1[0]} (baseline)`,
            assertionStatus: "present",
            temporalScope: "baseline",
            rawSnippet: clause1,
            clinicalRationale: "Subacute baseline intensity",
          });
        }
        if (dur1) {
          proposals.push({
            concept: "headache_duration",
            value: dur1[0],
            assertionStatus: "present",
            temporalScope: "baseline",
            rawSnippet: clause1,
          });
        }

        // Extract acute worsening facts from clause 2
        const sev2 = lower2.match(/\b(unbearable|severe|excruciating|terrible|intense|10\/10)\b/i);
        const onset2 = lower2.match(/\b(sudden(?:ly)?|all\s+at\s+once|like\s+a\s+clap)\b/i);
        const time2 = lower2.match(/\b(?:about\s+)?(?:an?|\d+)\s*(?:hours?|minutes?)\s*ago\b/i);

        if (sev2) {
          proposals.push({
            concept: "headache_severity",
            value: `${sev2[0]} (acute worsening)`,
            assertionStatus: "present",
            temporalScope: "acute_worsening",
            rawSnippet: clause2,
            clinicalRationale: "Severe acute crescendo escalation",
          });
        }
        if (onset2) {
          proposals.push({
            concept: "headache_onset_pattern",
            value: "sudden",
            assertionStatus: "present",
            temporalScope: "acute_worsening",
            rawSnippet: clause2,
          });
        }
        if (time2) {
          proposals.push({
            concept: "headache_acute_onset_time",
            value: time2[0],
            assertionStatus: "present",
            temporalScope: "acute_worsening",
            rawSnippet: clause2,
          });
        }
      }
    }

    // 2. Patient Correction / Retraction
    if (interp.isCorrection && interp.correctedSlot && interp.correctedValue) {
      proposals.push({
        concept: interp.correctedSlot,
        value: interp.correctedValue,
        assertionStatus: "present",
        temporalScope: "current",
        isCorrection: true,
        rawSnippet: rawText,
        clinicalRationale: interp.correctedDetail,
      });
    }

    // 3. Epistemic Uncertainty
    if (interp.isUncertainty || interp.intent === "uncertainty_or_unknown") {
      const target = pendingQuestion?.targetSlot || "clinical_symptom";
      proposals.push({
        concept: target,
        value: "uncertain",
        assertionStatus: "uncertain",
        temporalScope: "current",
        rawSnippet: rawText,
        uncertaintyReason: "Patient expressed uncertainty or unconfirmed timeline",
      });
    }

    // 4. Evidence extracted from standard clinical interpretation
    for (const ev of interp.newEvidence) {
      const isDenied = ev.value === "denied" || ev.value === "none reported";
      // Avoid duplicate if already covered by multi-clause or correction
      if (!proposals.some(p => p.concept === ev.slot)) {
        proposals.push({
          concept: ev.slot,
          value: ev.value,
          assertionStatus: isDenied ? "absent" : "present",
          temporalScope: "current",
          rawSnippet: rawText,
        });
      }
    }

    return proposals;
  }
}

export const conversationInterpreter = new ConversationInterpreter();
