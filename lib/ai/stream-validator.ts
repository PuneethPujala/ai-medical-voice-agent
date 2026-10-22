/**
 * INCREMENTAL STREAM RESPONSE VALIDATOR
 *
 * Phase 2 Architectural Safety Boundary:
 * Enforces strict, chunk-level deterministic validation before ANY audio chunk
 * is dispatched to speech synthesis or reaches the patient's speaker.
 *
 * Invariants:
 * 1. Zero False Reassurance: Rejects minimization ("don't worry", "you are fine", "it's nothing").
 * 2. Zero Premature Triage Dismissal: Rejects claims that medical care is unneeded.
 * 3. Strict Subject Attribution: Enforces caller vs patient boundary (e.g. mother vs caller).
 * 4. Strict Symptom Provenance: Prevents hallucinated symptom qualities or querying negated domains.
 * 5. Diagnostic Restraint: Blocks uncertified definitive diagnoses ("you have a heart attack").
 * 6. Medication Safety: Blocks uncertified prescription administration directives.
 * 7. Emergency Directives: In emergency situations, enforces directions to local emergency
 *    services (112 / 108 / 911) and STRICTLY BARS false claims that an ambulance has been dispatched.
 * 8. Gating Action: If a chunk is invalid, it is HELD, and the pipeline engages the approved safe fallback.
 */

export interface StreamValidationContext {
  patientUtterance: string;
  targetSubject: "self" | "mother" | "child" | "third_party";
  isEmergency: boolean;
  primaryEmergencyNumber?: string; // Default: "112"
  ambulanceNumber?: string;        // Default: "108"
  accumulatedValidatedText?: string;
  isFirstChunk?: boolean;
  isFinalChunk?: boolean;
  deniedSymptoms?: string[];
  knownSymptoms?: string[];
}

export type ChunkValidationCategory =
  | "false_reassurance"
  | "triage_dismissal"
  | "attribution"
  | "provenance"
  | "diagnosis_inflation"
  | "medication_safety"
  | "false_dispatch_claim"
  | "emergency_instruction"
  | "inconsistency";

export interface ChunkValidationResult {
  isValid: boolean;
  action: "APPROVE_FOR_SYNTHESIS" | "HOLD_AND_FALLBACK";
  category?: ChunkValidationCategory;
  reason?: string;
  approvedText?: string;
  fallbackReply?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// REGEX INVARIANTS & PATTERNS
// ─────────────────────────────────────────────────────────────────────────────

const FALSE_REASSURANCE_PATTERNS: RegExp[] = [
  /\b(?:don'?t\s+worry|nothing\s+to\s+worry\s+about)\b/i,
  /\b(?:you|she|he|they|your\s+(?:mother|mom|child|father|parent|dad|baby|son|daughter))\s*(?:'re|\s+(?:are|is|will\s+be))\s+(?:completely\s+|totally\s+|just\s+)?(?:fine|okay|alright)\b/i,
  /\b(?:it'?s|it\s+is)\s+(?:probably\s+|likely\s+|certainly\s+)?nothing\s+(?:serious|to\s+worry\s+about)?\b/i,
  /\b(?:there\s+is\s+nothing\s+(?:to\s+worry\s+about|wrong|serious))\b/i,
  /\b(?:this\s+is\s+(?:completely\s+)?harmless|harmless\s+condition|benign\s+condition)\b/i,
  /\b(?:everything\s+(?:is|will\s+be)\s+(?:completely\s+|totally\s+)?(?:okay|fine|alright))\b/i,
  /\b(?:no\s+need\s+to\s+(?:worry|panic|stress|be\s+alarmed|fret))\b/i,
  /\b(?:you\s+will\s+be\s+just\s+fine|rest\s+assured\s+it'?s\s+nothing|you\s+have\s+nothing\s+to\s+worry\s+about)\b/i,
];

const PREMATURE_DISMISSAL_PATTERNS: RegExp[] = [
  /\b(?:no\s+need\s+(?:to\s+(?:see|visit|consult|go\s+to)|for)\s+(?:a\s+)?(?:doctor|hospital|physician|clinic|er|emergency\s+room))\b/i,
  /\b(?:(?:don'?t|doesn'?t|do\s+not|does\s+not)\s+need\s+(?:emergency|urgent|medical|hospital)\s+(?:care|attention|evaluation|visit))\b/i,
  /\b(?:(?:you|she|he)\s+can\s+(?:just\s+)?(?:ignore|dismiss)\s+this)\b/i,
  /\b(?:just\s+go\s+(?:back\s+)?to\s+sleep)\b/i,
  /\b(?:no\s+medical\s+attention\s+(?:is\s+)?needed)\b/i,
  /\b(?:definitely\s+not\s+an\s+emergency)\b/i,
  /\b(?:(?:you|she|he)\s+can\s+wait\s+(?:and\s+see|until)\s+(?:tomorrow|next\s+week))\b/i,
  /\b(?:no\s+reason\s+to\s+seek\s+(?:urgent\s+|emergency\s+)?(?:care|attention))\b/i,
];

// MANDATORY RULE: Never claim or imply an ambulance was dispatched
const FALSE_DISPATCH_PATTERNS: RegExp[] = [
  /\b(?:an?\s+ambulance\s+has\s+been\s+dispatched|ambulance\s+is\s+(?:already\s+)?(?:on\s+the\s+way|coming|dispatched|en\s+route))\b/i,
  /\b(?:(?:dispatched|sending|called|summoned|alerted)\s+(?:an?\s+)?(?:ambulance|paramedics|emergency\s+services|ems|first\s+responders))\b/i,
  /\b(?:help\s+is\s+(?:on\s+the\s+way|coming)|we\s+have\s+sent\s+(?:an?\s+ambulance|help|a\s+paramedic|paramedics))\b/i,
  /\b(?:emergency\s+services\s+(?:have\s+been\s+notified|are\s+on\s+the\s+way|have\s+been\s+called|are\s+coming))\b/i,
  /\b(?:i(?:'ve|\s+have)\s+(?:called|dispatched|contacted)\s+(?:an?\s+ambulance|emergency\s+services|paramedics)\s+for\s+you)\b/i,
];

const DEFINITIVE_DIAGNOSIS_PATTERNS: RegExp[] = [
  /\b(?:you\s+have|she\s+has|he\s+has|your\s+\w+\s+has|the\s+patient\s+has|diagnosed\s+with|confirmed|definitely?)\s+(?:a\s+)?(?:heart\s+attack|myocardial\s+infarction|stroke|hypoglycemia|appendicitis|meningitis|pulmonary\s+embolism)\b/i,
  /\b(?:you\s+are|she\s+is|he\s+is)\s+having\s+(?:a\s+)?(?:heart\s+attack|stroke|myocardial\s+infarction|pulmonary\s+embolism)\b/i,
  /\bthis\s+is\s+(?:definitely|certainly|confirmed\s+to\s+be)\s+(?:a\s+)?(?:heart\s+attack|stroke|myocardial\s+infarction)\b/i,
];

const PRESCRIPTION_DIRECTIVE_PATTERNS: RegExp[] = [
  /\b(?:take|give|administer|swallow|chew)\s+(?:her|him|the\s+patient)?\s*(?:an?\s+)?(?:aspirin|nitroglycerin|metformin|antibiotic|ibuprofen)\b/i,
];

/**
 * Validates a candidate audio-bound text chunk before speech synthesis.
 */
export function validateAudioBoundChunk(
  chunk: string,
  context: StreamValidationContext
): ChunkValidationResult {
  const cleanChunk = chunk.trim();
  if (!cleanChunk) {
    return {
      isValid: false,
      action: "HOLD_AND_FALLBACK",
      reason: "Empty audio chunk.",
      fallbackReply: getDefaultSafeFallback(context),
    };
  }

  const primaryNum = context.primaryEmergencyNumber || "112";
  const ambNum = context.ambulanceNumber || "108";
  const lowerChunk = cleanChunk.toLowerCase();
  const lowerUtterance = (context.patientUtterance || "").toLowerCase();
  const deniedList = (context.deniedSymptoms || []).map((s) => s.toLowerCase());
  const combinedText = context.accumulatedValidatedText
    ? `${context.accumulatedValidatedText} ${cleanChunk}`.trim()
    : cleanChunk;

  // 1. CRITICAL: False Ambulance Dispatch Claim Guard (Checked on chunk and cross-chunk combined text)
  for (const pattern of FALSE_DISPATCH_PATTERNS) {
    if (pattern.test(cleanChunk) || pattern.test(combinedText)) {
      return {
        isValid: false,
        action: "HOLD_AND_FALLBACK",
        category: "false_dispatch_claim",
        reason: "Claimed ambulance or emergency vehicle was dispatched. Directives must instruct caller to contact emergency services directly.",
        fallbackReply: `Please call ${primaryNum} or ${ambNum} immediately for emergency medical assistance.`,
      };
    }
  }

  // 2. CRITICAL: False Reassurance Guard (Disallow minimization of symptoms, including cross-chunk splits)
  for (const pattern of FALSE_REASSURANCE_PATTERNS) {
    if (pattern.test(cleanChunk) || pattern.test(combinedText)) {
      return {
        isValid: false,
        action: "HOLD_AND_FALLBACK",
        category: "false_reassurance",
        reason: "Offered false clinical reassurance or symptom minimization before complete evaluation.",
        fallbackReply: getDefaultSafeFallback(context),
      };
    }
  }

  // 3. CRITICAL: Premature Triage Dismissal Guard (Checked on chunk and cross-chunk combined text)
  for (const pattern of PREMATURE_DISMISSAL_PATTERNS) {
    if (pattern.test(cleanChunk) || pattern.test(combinedText)) {
      return {
        isValid: false,
        action: "HOLD_AND_FALLBACK",
        category: "triage_dismissal",
        reason: "Prematurely dismissed need for clinical evaluation.",
        fallbackReply: getDefaultSafeFallback(context),
      };
    }
  }

  // 4. Attribution Integrity Guard (Caller vs Third-Party)
  if (context.targetSubject !== "self") {
    // Block attributing patient's symptoms directly to the caller
    if (
      /\b(?:in\s+your\s+(?:chest|abdomen|stomach|belly|head|throat)|your\s+(?:chest\s+pain|stomach\s+pain|belly\s+pain|heart|shaking|sweating|arm\s+weakness|face\s+droop|fever|breathing|symptoms?|pain|seizure))\b/i.test(
        cleanChunk
      ) ||
      /\b(?:do\s+you\s+have|are\s+you\s+experiencing|have\s+you\s+felt)\s+(?:any\s+|the\s+|this\s+)?(?:chest\s+pain|pain|weakness|fever|breathing\s+trouble)\b/i.test(
        cleanChunk
      )
    ) {
      const subjectName = context.targetSubject === "mother" ? "mother" : context.targetSubject === "child" ? "child" : "patient";
      return {
        isValid: false,
        action: "HOLD_AND_FALLBACK",
        category: "attribution",
        reason: `Transposed patient identity: attributed ${subjectName}'s symptoms directly to caller.`,
        fallbackReply: getDefaultSafeFallback(context),
      };
    }

    // When chunk discusses clinical symptoms, ensure it references the correct third party
    const referencesSymptom = /\b(?:pain|weakness|droop|stroke|arm|face|drooping|breathing|symptom|fever|seizure|vomiting|cramp)\b/i.test(
      cleanChunk
    );

    if (context.targetSubject === "mother") {
      if (referencesSymptom && !/\b(?:mother|she|her|mom)\b/i.test(cleanChunk)) {
        return {
          isValid: false,
          action: "HOLD_AND_FALLBACK",
          category: "attribution",
          reason: "Missing third-party attribution: chunk discusses mother's symptoms without referencing the patient.",
          fallbackReply: `Is your mother able to speak or lift her arms right now?`,
        };
      }
    } else if (context.targetSubject === "child") {
      if (referencesSymptom && !/\b(?:child|son|daughter|kid|baby|toddler|he|she|him|her)\b/i.test(cleanChunk)) {
        return {
          isValid: false,
          action: "HOLD_AND_FALLBACK",
          category: "attribution",
          reason: "Missing third-party attribution: chunk discusses child's symptoms without referencing the child.",
          fallbackReply: `How is your child breathing right now, and is he or she responsive?`,
        };
      }
    } else if (context.targetSubject === "third_party") {
      if (referencesSymptom && !/\b(?:he|she|him|her|they|them|patient|father|dad|husband|wife|brother|sister|parent)\b/i.test(cleanChunk)) {
        return {
          isValid: false,
          action: "HOLD_AND_FALLBACK",
          category: "attribution",
          reason: "Missing third-party attribution: chunk discusses third-party symptoms without referencing the patient.",
          fallbackReply: `Can you tell me how the patient is currently doing?`,
        };
      }
    }
  }

  // 5. Symptom Provenance Guard (No invented symptom qualities or querying negated domains)
  if (/\bchest\s+pain\b/i.test(lowerUtterance) && !/\b(?:tight|pressure|crushing|squeezing)\b/i.test(lowerUtterance)) {
    if (/\b(?:tight\s+(?:pressure|pain|sensation)|crushing\s+(?:pressure|pain|chest\s+pain)|heavy\s+elephant)\b/i.test(cleanChunk)) {
      return {
        isValid: false,
        action: "HOLD_AND_FALLBACK",
        category: "provenance",
        reason: "Hallucinated unsupported symptom quality (invented 'tight pressure' when only 'chest pain' was stated).",
        fallbackReply: `Can you describe what the chest pain feels like, and does it spread anywhere else?`,
      };
    }
  }

  // Negation Provenance: patient explicitly denied chest pain
  const chestDenied =
    deniedList.includes("chest_pain") ||
    deniedList.includes("chest pain") ||
    /\b(?:don'?t\s+have|do\s+not\s+have|no)\s+chest\s+pain\b/i.test(lowerUtterance) ||
    /\bno\s+pain\s+in\s+(?:my\s+)?chest\b/i.test(lowerUtterance);

  if (chestDenied) {
    if (/\b(?:left\s+arm|jaw\s+pain|radiation\s+to\s+arm|heart\s+attack|coronary|angina)\b/i.test(cleanChunk)) {
      return {
        isValid: false,
        action: "HOLD_AND_FALLBACK",
        category: "provenance",
        reason: "Queried negated cardiac domain when patient explicitly denied chest pain.",
        fallbackReply: `Where in your abdomen is the pain located, and how long has it been occurring?`,
      };
    }
  }

  // Negation Provenance: patient explicitly denied fever
  const feverDenied =
    deniedList.includes("fever") ||
    (/\bno\s+fever\b/i.test(lowerUtterance) && !/\bfever\b/i.test(lowerUtterance.replace(/\bno\s+fever\b/g, ""))) ||
    /\b(?:don'?t|do\s+not|haven'?t)\s+(?:have|had)\s+(?:a\s+)?fever\b/i.test(lowerUtterance);

  if (feverDenied) {
    if (/\b(?:because\s+of\s+your\s+fever|your\s+fever|feverish)\b/i.test(cleanChunk)) {
      return {
        isValid: false,
        action: "HOLD_AND_FALLBACK",
        category: "provenance",
        reason: "Asserted fever when patient explicitly denied fever.",
        fallbackReply: `Thank you for clarifying. Have you noticed any other symptoms besides the pain?`,
      };
    }
    if (/\b(?:worsening|getting\s+worse|rapidly\s+progressing)\b/i.test(cleanChunk)) {
      return {
        isValid: false,
        action: "HOLD_AND_FALLBACK",
        category: "provenance",
        reason: "Hallucinated unsupported worsening trajectory on negated symptom.",
        fallbackReply: getDefaultSafeFallback(context),
      };
    }
  }

  // 6. Diagnostic Restraint Guard
  for (const pattern of DEFINITIVE_DIAGNOSIS_PATTERNS) {
    if (pattern.test(cleanChunk)) {
      return {
        isValid: false,
        action: "HOLD_AND_FALLBACK",
        category: "diagnosis_inflation",
        reason: "Issued uncertified definitive medical diagnosis instead of triage assessment.",
        fallbackReply: getDefaultSafeFallback(context),
      };
    }
  }

  // 7. Medication Safety Guard
  for (const pattern of PRESCRIPTION_DIRECTIVE_PATTERNS) {
    if (pattern.test(cleanChunk)) {
      if (!/\b(?:if\s+you\s+have|consult\s+doctor|prescribed\s+by)\b/i.test(cleanChunk)) {
        return {
          isValid: false,
          action: "HOLD_AND_FALLBACK",
          category: "medication_safety",
          reason: "Issued uncertified prescription directive.",
          fallbackReply: getDefaultSafeFallback(context),
        };
      }
    }
  }

  // 8. Chunk Consistency Guard (Against accumulated prior turn text)
  if (context.accumulatedValidatedText) {
    const prevText = context.accumulatedValidatedText;
    // If prior chunks established third-party context, reject transposing to caller in second chunk
    if (
      context.targetSubject !== "self" &&
      /\b(?:in\s+your\s+chest|your\s+(?:pain|fever|weakness))\b/i.test(cleanChunk)
    ) {
      return {
        isValid: false,
        action: "HOLD_AND_FALLBACK",
        category: "inconsistency",
        reason: "Inconsistent subject attribution across streaming chunks: transposed to caller mid-turn.",
        fallbackReply: getDefaultSafeFallback(context),
      };
    }
  }

  // 9. Emergency Active Policy
  if (context.isEmergency) {
    // If this is the first audio chunk, it MUST NOT contradict the emergency or offer casual banter or routine delay
    const isCasualBanter = /\b(?:tell\s+me\s+more|let'?s\s+explore|how\s+long\s+has\s+your\s+day\s+been|take\s+it\s+easy|routine\s+appointment|schedule\s+a\s+visit\s+next\s+week)\b/i.test(
      cleanChunk
    );
    if (isCasualBanter) {
      return {
        isValid: false,
        action: "HOLD_AND_FALLBACK",
        category: "emergency_instruction",
        reason: "Offered non-urgent conversational exploration or down-triage while acute emergency condition is active.",
        fallbackReply: `This requires immediate emergency medical evaluation. Please call ${primaryNum} or ${ambNum} or go to the nearest emergency room immediately.`,
      };
    }

    // In emergency mode, if this is the final chunk and no emergency number has been uttered anywhere, reject
    if (context.isFinalChunk) {
      const fullTurnText = `${context.accumulatedValidatedText || ""} ${cleanChunk}`.trim();
      if (!new RegExp(`\\b(${primaryNum}|${ambNum}|emergency|hospital)\\b`, "i").test(fullTurnText)) {
        return {
          isValid: false,
          action: "HOLD_AND_FALLBACK",
          category: "emergency_instruction",
          reason: "Completed response lacked approved emergency contact directive.",
          fallbackReply: `Please call ${primaryNum} or ${ambNum} or proceed to the nearest emergency department right away.`,
        };
      }
    }
  }

  // All safety checks passed
  return {
    isValid: true,
    action: "APPROVE_FOR_SYNTHESIS",
    approvedText: cleanChunk,
  };
}

function getDefaultSafeFallback(context: StreamValidationContext): string {
  const primaryNum = context.primaryEmergencyNumber || "112";
  const ambNum = context.ambulanceNumber || "108";

  if (context.isEmergency) {
    return `This could indicate an urgent medical situation. Please call ${primaryNum} or ${ambNum} or go to the nearest emergency room right away.`;
  }

  if (context.targetSubject === "mother") {
    return `Can you tell me more about how your mother is feeling and when these symptoms began?`;
  }

  if (context.targetSubject === "child") {
    return `How is your child feeling right now, and are they able to drink fluids?`;
  }

  return `Can you describe where the discomfort feels strongest and when it first started?`;
}

/**
 * Stateful incremental validator for multi-chunk streaming turns
 */
export class IncrementalStreamValidator {
  private context: StreamValidationContext;
  private validatedChunks: string[] = [];
  private fallbackEngaged: boolean = false;
  private rejectionRecord: { reason: string; category: ChunkValidationCategory } | null = null;

  constructor(context: StreamValidationContext) {
    this.context = { ...context };
  }

  public updateContext(partial: Partial<StreamValidationContext>): void {
    this.context = { ...this.context, ...partial };
  }

  public getContext(): StreamValidationContext {
    return this.context;
  }

  public isFallbackEngaged(): boolean {
    return this.fallbackEngaged;
  }

  public getRejectionRecord(): { reason: string; category: ChunkValidationCategory } | null {
    return this.rejectionRecord;
  }

  public getValidatedText(): string {
    return this.validatedChunks.join(" ");
  }

  /**
   * Evaluates the next incoming candidate text chunk.
   */
  public evaluateNextChunk(chunk: string, isFinalChunk = false): ChunkValidationResult {
    if (this.fallbackEngaged) {
      return {
        isValid: false,
        action: "HOLD_AND_FALLBACK",
        reason: "Stream already routed to approved fallback due to prior chunk rejection.",
        fallbackReply: getDefaultSafeFallback(this.context),
      };
    }

    const isFirstChunk = this.validatedChunks.length === 0;
    const result = validateAudioBoundChunk(chunk, {
      ...this.context,
      accumulatedValidatedText: this.getValidatedText(),
      isFirstChunk,
      isFinalChunk,
    });

    if (result.isValid && result.approvedText) {
      this.validatedChunks.push(result.approvedText);
    } else {
      this.fallbackEngaged = true;
      if (result.category && result.reason) {
        this.rejectionRecord = { reason: result.reason, category: result.category };
      }
    }

    return result;
  }
}
