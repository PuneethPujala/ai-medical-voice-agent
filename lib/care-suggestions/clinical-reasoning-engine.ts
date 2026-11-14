/**
 * CLINICAL REASONING & SYMPTOM INTELLIGENCE ENGINE
 *
 * Invariants:
 * 1. SYMPTOM-SPECIFIC REASONING: Formulates nuanced clinical summaries, warning signs, and follow-up
 *    plans tailored to the patient's actual presenting symptoms, rather than generic boilerplate.
 * 2. DIMENSION EXTRACTION: Extracts onset, onset pattern (gradual vs sudden), duration, episodic severity
 *    (initial vs current/peak), character/quality, location/laterality, and temporal pattern.
 * 3. 4-WAY FINDING CATEGORIZATION:
 *    - Confirmed Negatives: Explicitly denied by the patient (e.g., "no vision changes, weakness, speech difficulty, nausea or vomiting").
 *    - Positive Symptoms: Explicitly reported by the patient.
 *    - Unanswered Questions: Inquired by clinician/AI but left unaddressed by the patient.
 *    - Unclear / Ambiguous Responses: Patient expressed doubt, uncertainty, or vague approximations.
 * 4. NO UNANSWERED-AS-NEGATIVE CONFLATION: Unanswered questions are NEVER converted into negative findings.
 * 5. CONVERSATION CONTEXT & DEDUPLICATION: Tracks answered topics across the encounter and suppresses
 *    redundant follow-up questions for findings already resolved.
 * 6. EVIDENCE-FAITHFUL SUMMARY: Strictly reflects patient statements without hallucinating unsupported clinical facts.
 * 7. SEVERITY-ALIGNED FOLLOW-UP: Recommends urgent (<24h) assessment for severe or persistent symptoms (e.g., 6-7/10
 *    headache for 5 hours) rather than delayed generic follow-up.
 * 8. EMERGENCY INVARIANT: Emergency life-threat rules and classifications cannot be downgraded.
 */

import { PatientProfile } from "@/lib/clinical-knowledge/types";
import { RedFlagResult } from "@/lib/triage/universal-red-flags";

export interface ClinicalSymptomProfile {
  primarySymptom: string;
  domain: "neurology" | "cardiology" | "respiratory" | "gastroenterology" | "infectious" | "general";
  
  // Dimensional characteristics
  onsetPattern: "gradual" | "sudden" | "unknown";
  duration: string;
  durationHours?: number;
  initialSeverity?: string;
  currentSeverity?: string;
  severityScore: number;
  severityPattern: "intermittent" | "constant" | "episodic" | "worsening" | "stable" | "unknown";
  character?: string;
  location?: string;
  laterality?: "left" | "right" | "bilateral" | "unilateral";

  // Finding classification
  positiveSymptoms: string[];
  confirmedNegatives: string[];
  unansweredQuestions: string[];
  unclearResponses: string[];
  
  // Conversation tracking
  answeredTopics: string[];

  // Missing telemetry & questions
  missingTelemetry: string[];
  targetedClarificationQuestions: string[];

  // Risk profile
  isHighSeverity: boolean;
  hasRedFlags: boolean;
  redFlagFeatures: string[];
}

export interface DialogueTurn {
  role: string;
  text: string;
  timestamp?: string;
}

export class ClinicalReasoningEngine {
  /**
   * Performs deep conversational extraction and clinical reasoning over dialogue turns.
   */
  public static analyzeDialogue(
    transcript: DialogueTurn[],
    patientProfile?: PatientProfile | null,
    chiefComplaint?: string,
    redFlagResult?: RedFlagResult,
    esiScore?: number | null,
    triageLevel?: string
  ): ClinicalSymptomProfile {
    const patientTurns = transcript.filter((t) => t.role === "patient");
    const doctorTurns = transcript.filter((t) => t.role === "doctor" || t.role === "assistant");
    const allPatientText = patientTurns.map((t) => t.text).join(" ");
    const fullConversationText = transcript.map((t) => `${t.role}: ${t.text}`).join("\n");
    const combinedText = `${chiefComplaint || ""} ${fullConversationText}`.toLowerCase();

    // ----------------------------------------------------
    // 1. INFER PRIMARY SYMPTOM & DOMAIN
    // ----------------------------------------------------
    let primarySymptom = "discomfort";
    let domain: ClinicalSymptomProfile["domain"] = "general";

    if (/\b(headache|migraine|head pain|throbbing head|sir dard|tala noppi)\b/i.test(combinedText)) {
      primarySymptom = "headache";
      domain = "neurology";
    } else if (/\b(chest pain|chest pressure|angina|chhati me dard|gunde noppi)\b/i.test(combinedText)) {
      primarySymptom = "chest discomfort";
      domain = "cardiology";
    } else if (/\b(shortness of breath|cough|wheezing|dyspnea|saans phoolna)\b/i.test(combinedText)) {
      primarySymptom = "respiratory symptoms";
      domain = "respiratory";
    } else if (/\b(abdominal pain|stomach pain|belly ache|pet dard|loose motions|diarrhea)\b/i.test(combinedText)) {
      primarySymptom = "abdominal / GI symptoms";
      domain = "gastroenterology";
    } else if (/\b(fever|chills|high temperature|bukhar|jwaram)\b/i.test(combinedText)) {
      primarySymptom = "febrile illness";
      domain = "infectious";
    } else if (chiefComplaint) {
      primarySymptom = chiefComplaint.toLowerCase().slice(0, 50);
    }

    // ----------------------------------------------------
    // 2. EXTRACT DIMENSIONAL CHARACTERISTICS
    // ----------------------------------------------------

    // A. Onset Pattern (Gradual vs Sudden)
    let onsetPattern: ClinicalSymptomProfile["onsetPattern"] = "unknown";
    if (/\b(gradual|gradually|built up slowly|slowly|over time|dheere dheere|mellaga)\b/i.test(allPatientText)) {
      onsetPattern = "gradual";
    } else if (/\b(sudden|suddenly|thunderclap|all of a sudden|out of nowhere|instant(ly)?|achanak|ventane)\b/i.test(allPatientText)) {
      onsetPattern = "sudden";
    }

    // B. Duration Extraction
    let duration = "unspecified duration";
    let durationHours: number | undefined = undefined;

    const hourMatch = allPatientText.match(/\b(?:about|approx\.?|around|roughly)?\s*(\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve|twenty-four)\s*(?:hours?|hrs?)\b/i);
    const dayMatch = allPatientText.match(/\b(?:about|approx\.?|around|roughly)?\s*(\d+|one|two|three|four|five|six|seven)\s*(?:days?)\b/i);
    const minMatch = allPatientText.match(/\b(?:about|approx\.?|around|roughly)?\s*(\d+|twenty|thirty|forty-five)\s*(?:minutes?|mins?)\b/i);

    const wordToNum: Record<string, number> = {
      one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
      eight: 8, nine: 9, ten: 10, twelve: 12, "twenty-four": 24,
      twenty: 20, thirty: 30, "forty-five": 45,
    };

    if (hourMatch) {
      const rawVal = hourMatch[1].toLowerCase();
      const num = wordToNum[rawVal] || parseInt(rawVal, 10);
      durationHours = num;
      duration = `approximately ${hourMatch[1]} hours`;
    } else if (dayMatch) {
      const rawVal = dayMatch[1].toLowerCase();
      const num = wordToNum[rawVal] || parseInt(rawVal, 10);
      durationHours = num * 24;
      duration = `${dayMatch[1]} days`;
    } else if (minMatch) {
      const rawVal = minMatch[1].toLowerCase();
      const num = wordToNum[rawVal] || parseInt(rawVal, 10);
      durationHours = num / 60;
      duration = `${minMatch[1]} minutes`;
    } else if (/\b(yesterday|this morning|last night)\b/i.test(allPatientText)) {
      const relMatch = allPatientText.match(/\b(yesterday|this morning|last night)\b/i);
      duration = `since ${relMatch ? relMatch[1] : "recent hours"}`;
    }

    // C. Severity Progression (Initial vs Current/Later)
    let initialSeverity: string | undefined = undefined;
    let currentSeverity: string | undefined = undefined;
    let maxSeverityScore = 0;

    // Pattern for episodic progression: e.g. "started as a 7 out of 10 and now it's around a 6 out of 10"
    const progMatch = allPatientText.match(
      /\b(?:started|began|initial(?:ly)?|at first)\s+(?:at|as)?\s*(?:a\s+)?(\d{1,2})(?:\s*\/\s*10|\s+out\s+of\s+10)?[\s\S]{1,40}?(?:now|currently|later|down to|around)\s*(?:a\s+)?(\d{1,2})(?:\s*\/\s*10|\s+out\s+of\s+10)?\b/i
    );

    if (progMatch) {
      const initNum = parseInt(progMatch[1], 10);
      const currNum = parseInt(progMatch[2], 10);
      if (initNum <= 10 && currNum <= 10) {
        initialSeverity = `${initNum}/10`;
        currentSeverity = `${currNum}/10`;
        maxSeverityScore = Math.max(initNum, currNum);
      }
    }

    // Fallback single severity match if progression wasn't captured
    if (!initialSeverity && !currentSeverity) {
      const singleSevMatch = allPatientText.match(/\b(\d{1,2})\s*(?:\/\s*10|out\s+of\s+10)\b/i);
      if (singleSevMatch) {
        const val = parseInt(singleSevMatch[1], 10);
        if (val <= 10) {
          currentSeverity = `${val}/10`;
          maxSeverityScore = val;
        }
      }
    }

    // D. Character & Quality
    let character: string | undefined = undefined;
    if (/\b(pressure|pressure-like|tight band|tightness|heaviness)\b/i.test(allPatientText)) {
      character = "pressure-like";
    } else if (/\b(throbbing|pulsating|pounding|beating)\b/i.test(allPatientText)) {
      character = "throbbing";
    } else if (/\b(sharp|stabbing|piercing|knife-like)\b/i.test(allPatientText)) {
      character = "sharp";
    } else if (/\b(burning|acidic|gnawing|sour)\b/i.test(allPatientText)) {
      character = "burning";
    } else if (/\b(cramping|colicky|spasm)\b/i.test(allPatientText)) {
      character = "cramping";
    } else if (/\b(dull|ache|dull ache)\b/i.test(allPatientText)) {
      character = "dull";
    }

    // E. Location & Laterality
    let location: string | undefined = undefined;
    let laterality: ClinicalSymptomProfile["laterality"] = undefined;

    if (/\b(left(?:-|\s+)sided|left side|left temple|left forehead)\b/i.test(allPatientText)) {
      location = "left-sided";
      laterality = "left";
    } else if (/\b(right(?:-|\s+)sided|right side|right temple|right forehead)\b/i.test(allPatientText)) {
      location = "right-sided";
      laterality = "right";
    } else if (/\b(both sides|bilateral|across (?:my|the) forehead|all over)\b/i.test(allPatientText)) {
      location = "bilateral / frontal";
      laterality = "bilateral";
    } else if (/\b(back of (?:my|the) head|occipital|neck)\b/i.test(allPatientText)) {
      location = "occipital / back of head";
    } else if (/\b(behind (?:my|the) eyes?|retro-orbital)\b/i.test(allPatientText)) {
      location = "retro-orbital";
    }

    // F. Temporal Pattern
    let severityPattern: ClinicalSymptomProfile["severityPattern"] = "unknown";
    if (/\b(intermittent|comes and goes|in waves|episodic|fluctuating|not constant)\b/i.test(allPatientText)) {
      severityPattern = "intermittent";
    } else if (/\b(constant|continuous|non-stop|steady|all the time)\b/i.test(allPatientText)) {
      severityPattern = "constant";
    } else if (/\b(getting worse|worsening|escalating|increasing)\b/i.test(allPatientText)) {
      severityPattern = "worsening";
    }

    // ----------------------------------------------------
    // 3. 4-WAY CATEGORIZATION OF FINDINGS
    // ----------------------------------------------------
    const positiveSymptoms: string[] = [];
    const confirmedNegatives: string[] = [];
    const unclearResponses: string[] = [];
    const answeredTopicsSet = new Set<string>();

    // Helper: Analyze clinical findings for positive, negative, or unclear states
    const evaluateFinding = (
      conceptId: string,
      label: string,
      positiveRegex: RegExp,
      negativeRegex: RegExp,
      unclearRegex: RegExp
    ) => {
      // 1. Check if patient explicitly confirmed negative
      if (negativeRegex.test(allPatientText)) {
        confirmedNegatives.push(label);
        answeredTopicsSet.add(conceptId);
        return;
      }
      // 2. Check if patient confirmed positive
      if (positiveRegex.test(allPatientText)) {
        positiveSymptoms.push(label);
        answeredTopicsSet.add(conceptId);
        return;
      }
      // 3. Check if patient gave an unclear or ambiguous reply
      if (unclearRegex.test(allPatientText)) {
        unclearResponses.push(label);
        answeredTopicsSet.add(conceptId);
        return;
      }
    };

    // Vision changes
    evaluateFinding(
      "vision",
      "vision changes or visual disturbances",
      /\b(?:have|noticed|seeing|got)\s+(?:blurry vision|vision changes|double vision|spots|flashes)\b/i,
      /\b(?:no|don'?t have|not having|never had|without|denies)\s+(?:any\s+)?(?:vision changes|visual (?:changes|disturbances)|blurr(?:y|iness)|double vision|flashes)\b/i,
      /\b(?:maybe|not sure if|hard to tell if|a bit blurry maybe)\s+(?:vision|eyes)\b/i
    );

    // One-sided weakness or numbness
    evaluateFinding(
      "neurological_weakness",
      "weakness or numbness in arms, legs, or face",
      /\b(?:have|felt|got)\s+(?:weakness|numbness|paralysis|droop|tingling)\b/i,
      /\b(?:no|don'?t have|not having|never had|without|denies)\s+(?:any\s+)?(?:weakness|numbness|facial droop|tingling|paralysis)\b/i,
      /\b(?:not sure|maybe a little)\s+(?:weak|numb)\b/i
    );

    // Speech difficulty
    evaluateFinding(
      "speech",
      "speech difficulty or slurring",
      /\b(?:slurred speech|trouble speaking|difficulty talking|can't speak properly)\b/i,
      /\b(?:no|don'?t have|not having|never had|without|denies)\s+(?:any\s+)?(?:speech difficulty|slurred speech|trouble speaking|difficulty talking)\b/i,
      /\b(?:not sure if|maybe)\s+(?:slurring|speech)\b/i
    );

    // Nausea or vomiting
    evaluateFinding(
      "nausea_vomiting",
      "nausea or vomiting",
      /\b(?:vomited|threw up|throwing up|feeling nauseous|nausea|puking|ulti)\b/i,
      /\b(?:no|don'?t have|not having|never had|without|denies)\s+(?:any\s+)?(?:nausea|vomiting|throwing up|emesis)\b/i,
      /\b(?:a little queasy maybe|not sure if nauseous)\b/i
    );

    // Fever or chills
    evaluateFinding(
      "fever",
      "fever or chills",
      /\b(?:fever|high temp|chills|shivering|feverish|bukhar|jwaram)\b/i,
      /\b(?:no|don'?t have|not having|never had|without|denies)\s+(?:any\s+)?(?:fever|chills|high temperature|temperature)\b/i,
      /\b(?:maybe feel warm|not sure if fever)\b/i
    );

    // Neck stiffness / nuchal rigidity
    evaluateFinding(
      "neck_stiffness",
      "neck stiffness or difficulty touching chin to chest",
      /\b(?:stiff neck|neck stiffness|nuchal rigidity|hurts to bend neck)\b/i,
      /\b(?:no|don'?t have|not having|never had|without|denies)\s+(?:any\s+)?(?:neck stiffness|stiff neck|nuchal rigidity)\b/i,
      /\b(?:neck feels a little tight maybe|not sure if stiff)\b/i
    );

    // Head injury or trauma
    evaluateFinding(
      "trauma",
      "recent head injury or physical trauma",
      /\b(?:hit my head|fall|accident|concussion|head injury|impact)\b/i,
      /\b(?:no|haven'?t had|never had|without|denies)\s+(?:any\s+)?(?:head injury|trauma|fall|concussion|hitting my head)\b/i,
      /\b(?:not sure if I bumped it)\b/i
    );

    // ----------------------------------------------------
    // 4. DETECT UNANSWERED INQUIRIES (Invariant 4)
    // ----------------------------------------------------
    const unansweredQuestions: string[] = [];
    const questionTopicsMap: Array<{ topic: string; regex: RegExp; label: string }> = [
      { topic: "vision", regex: /\b(vision|sight|double vision|blurr|eyes?)\b/i, label: "Visual changes or blurring" },
      { topic: "neurological_weakness", regex: /\b(weakness|numbness|tingling|arm|leg|face droop)\b/i, label: "Focal weakness or numbness" },
      { topic: "speech", regex: /\b(speech|speaking|slurring|talk)\b/i, label: "Speech difficulty" },
      { topic: "fever", regex: /\b(fever|temperature|chills|hot)\b/i, label: "Fever or chills" },
      { topic: "neck_stiffness", regex: /\b(neck|stiff|chin to chest)\b/i, label: "Neck stiffness" },
      { topic: "nausea_vomiting", regex: /\b(nausea|vomit|throwing up|sick to your stomach)\b/i, label: "Nausea or vomiting" },
      { topic: "allergies", regex: /\b(allerg|allergic|reaction to (?:drugs|medicines))\b/i, label: "Drug allergy history" },
      { topic: "medications", regex: /\b(taking any|current medications?|prescriptions?|pills)\b/i, label: "Current medication intake" },
      { topic: "medical_history", regex: /\b(medical history|chronic conditions?|high blood pressure|diabetes|liver|kidney|ulcer)\b/i, label: "Chronic medical history" },
    ];

    // Check doctor questions: if doctor asked about a topic, but it was NOT answered (not in answeredTopicsSet)
    for (const dTurn of doctorTurns) {
      for (const qTopic of questionTopicsMap) {
        if (qTopic.regex.test(dTurn.text) && !answeredTopicsSet.has(qTopic.topic)) {
          if (!unansweredQuestions.includes(qTopic.label)) {
            unansweredQuestions.push(qTopic.label);
          }
        }
      }
    }

    // ----------------------------------------------------
    // 5. MISSING TELEMETRY & TARGETED CLARIFICATION QUESTIONS (Invariant 5)
    // ----------------------------------------------------
    const missingTelemetry: string[] = [
      "In-person physical and neurological examination unassessed (telehealth intake).",
      "Recent objective vital signs (blood pressure, heart rate, temperature) unmeasured.",
    ];

    if (!patientProfile?.drugAllergies?.length && !answeredTopicsSet.has("allergies")) {
      missingTelemetry.push("Complete drug allergy and adverse drug reaction history unverified.");
    }
    if (!patientProfile?.knownConditions?.length && !answeredTopicsSet.has("medical_history")) {
      missingTelemetry.push("Comprehensive chronic medical conditions and prior organ health unverified.");
    }

    // Generate clarification questions ONLY for unanswered or unassessed topics (Deduplication)
    const targetedQuestions: string[] = [];

    if (!answeredTopicsSet.has("trauma") && domain === "neurology") {
      targetedQuestions.push("Did you experience any recent fall, bump, or physical impact to your head prior to this?");
    }
    if (!answeredTopicsSet.has("neck_stiffness") && (domain === "neurology" || domain === "infectious")) {
      targetedQuestions.push("Can you comfortably bend your chin all the way down to touch your chest without neck stiffness?");
    }
    if (!answeredTopicsSet.has("fever")) {
      targetedQuestions.push("Have you felt unusually feverish, warm to the touch, or experienced shaking chills?");
    }
    if (!answeredTopicsSet.has("allergies") && (!patientProfile?.drugAllergies || patientProfile.drugAllergies.length === 0)) {
      targetedQuestions.push("Do you have any known allergies to paracetamol, aspirin, ibuprofen, or antibiotics?");
    }
    if (!answeredTopicsSet.has("medical_history")) {
      targetedQuestions.push("Do you have any history of high blood pressure, stomach ulcers, kidney disease, or liver conditions?");
    }

    // ----------------------------------------------------
    // 6. RED FLAG SCREENING
    // ----------------------------------------------------
    const isThunderclap = onsetPattern === "sudden" && (maxSeverityScore >= 8 || /\b(thunderclap|worst headache)\b/i.test(allPatientText));
    const hasNeuroDeficits = positiveSymptoms.some((s) => s.includes("weakness") || s.includes("speech") || s.includes("vision"));
    const hasMeningismus = positiveSymptoms.some((s) => s.includes("neck stiffness")) && positiveSymptoms.some((s) => s.includes("fever"));
    const redFlagFeatures: string[] = [];

    if (isThunderclap) redFlagFeatures.push("Sudden severe peak onset (thunderclap pattern)");
    if (hasNeuroDeficits) redFlagFeatures.push("Focal neurological symptoms reported");
    if (hasMeningismus) redFlagFeatures.push("Co-occurring fever and neck stiffness (meningism screen)");

    const isHighSeverity = maxSeverityScore >= 7 || redFlagResult?.level === "EMERGENCY_NOW" || esiScore === 1 || esiScore === 2;
    const hasRedFlags = redFlagFeatures.length > 0 || isHighSeverity || triageLevel === "emergency";

    return {
      primarySymptom,
      domain,
      onsetPattern,
      duration,
      durationHours,
      initialSeverity,
      currentSeverity,
      severityScore: maxSeverityScore,
      severityPattern,
      character,
      location,
      laterality,
      positiveSymptoms: Array.from(new Set(positiveSymptoms)),
      confirmedNegatives: Array.from(new Set(confirmedNegatives)),
      unansweredQuestions: Array.from(new Set(unansweredQuestions)),
      unclearResponses: Array.from(new Set(unclearResponses)),
      answeredTopics: Array.from(answeredTopicsSet),
      missingTelemetry: Array.from(new Set(missingTelemetry)),
      targetedClarificationQuestions: Array.from(new Set(targetedQuestions)),
      isHighSeverity,
      hasRedFlags,
      redFlagFeatures,
    };
  }

  /**
   * Generates a symptom-specific clinical summary strictly grounded in patient testimony.
   */
  public static generateClinicalSummary(
    profile: ClinicalSymptomProfile,
    soapAssessment?: string
  ): string {
    const parts: string[] = [];

    // Part 1: Presentation, Onset, and Duration
    const charDesc = profile.character ? `${profile.character} ` : "";
    const onsetDesc = profile.onsetPattern !== "unknown" ? `${profile.onsetPattern} onset` : "unspecified onset pattern";
    parts.push(
      `Patient presents with a ${charDesc}${profile.primarySymptom} characterized by a ${onsetDesc} lasting ${profile.duration}.`
    );

    // Part 2: Severity Progression & Location
    if (profile.initialSeverity && profile.currentSeverity) {
      const locDesc = profile.location ? ` localized to the ${profile.location}` : "";
      const patDesc = profile.severityPattern !== "unknown" ? ` exhibiting an ${profile.severityPattern} pattern` : "";
      parts.push(
        `Pain severity was initially rated at ${profile.initialSeverity} and later reported at ${profile.currentSeverity},${patDesc}${locDesc}.`
      );
    } else if (profile.currentSeverity) {
      const locDesc = profile.location ? ` localized to the ${profile.location}` : "";
      const patDesc = profile.severityPattern !== "unknown" ? ` with an ${profile.severityPattern} pattern` : "";
      parts.push(
        `Current pain severity is rated at ${profile.currentSeverity}${patDesc}${locDesc}.`
      );
    }

    // Part 3: Pertinent Negatives (Confirmed Denials)
    if (profile.confirmedNegatives.length > 0) {
      const negativeList = profile.confirmedNegatives.join(", ");
      parts.push(
        `Pertinent negatives confirmed by patient include no reported ${negativeList}.`
      );
    }

    // Part 4: Clinical Unknowns & Unmeasured Telemetry
    parts.push(
      "In-person physical examination, baseline cardiovascular telemetry, and comprehensive chronic medical history remain unassessed and currently unknown."
    );

    // Part 5: SOAP Assessment integration if available
    if (soapAssessment && soapAssessment.trim().length > 10) {
      parts.push(`Clinical Impression: ${soapAssessment.trim()}`);
    }

    return parts.join(" ");
  }

  /**
   * Generates tailored, symptom-specific warning signs across Routine, Urgent, and Emergency tiers.
   */
  public static generateSymptomSpecificWarningSigns(
    profile: ClinicalSymptomProfile,
    isEmergency: boolean
  ): { routine: string[]; urgent: string[]; emergency: string[] } {
    if (profile.domain === "neurology") {
      const routine = [
        "Monitor headache frequency, severity, and response to calm rest in a dark, quiet room.",
        "Maintain a headache diary noting onset time, duration, hydration, and possible environmental triggers.",
        "Track baseline daily discomfort for gradual improvement.",
      ];

      const urgent = [
        `Persistent or escalating headache intensity (exceeding ${profile.currentSeverity || "6/10"}) unresponsive to rest over the next 12-24 hours.`,
        "Headache awakening you from sleep or noticeably aggravated by coughing, straining, or bending forward.",
        "Development of new light sensitivity (photophobia), sound sensitivity, or nausea that does not resolve.",
      ];

      const emergency = [
        "Sudden 'thunderclap' headache reaching explosive peak intensity within seconds (worst headache of your life).",
        "Headache accompanied by high fever and neck stiffness (inability to bend chin down to touch chest).",
        "Focal neurological deficits: acute facial droop, one-sided arm/leg weakness, numbness, or difficulty speaking / slurred speech (Signs of Acute Stroke / BE-FAST).",
        "Sudden visual loss, double vision, or loss of consciousness.",
        "Headache following recent head trauma or fall.",
      ];

      if (isEmergency || profile.hasRedFlags) {
        emergency.unshift("CRITICAL EMERGENCY ALERT: Red-flag neurological criteria met. Seek immediate emergency evaluation (112 / 108 / 911).");
      }

      return { routine, urgent, emergency };
    }

    if (profile.domain === "cardiology") {
      return {
        routine: [
          "Rest in a comfortable, seated upright position and avoid strenuous exertion.",
          "Track resting pulse rate and avoid heavy meals or stimulant beverages.",
        ],
        urgent: [
          "Chest tightness or discomfort recurring with light walking or physical activity.",
          "New or worsening shortness of breath while lying flat.",
          "Unexplained swelling in both feet or ankles.",
        ],
        emergency: [
          "Crushing, squeezing chest pressure or pain radiating to left arm, shoulder, neck, or jaw.",
          "Chest discomfort accompanied by cold sweats (diaphoresis), dizziness, or syncope (fainting).",
          "Sudden severe shortness of breath or feeling of impending doom.",
        ],
      };
    }

    if (profile.domain === "respiratory") {
      return {
        routine: [
          "Maintain upright posture and keep room well-ventilated.",
          "Track body temperature twice daily.",
        ],
        urgent: [
          "Cough producing thick yellow or rust-colored phlegm lasting > 48 hours.",
          "Fever exceeding 101°F (38.3°C) that fails to respond to oral antipyretics.",
          "Wheezing or chest tightness when walking across a room.",
        ],
        emergency: [
          "Severe shortness of breath: struggling to complete full sentences without pausing.",
          "Stridor: harsh high-pitched whistling noise when breathing in.",
          "Cyanosis: bluish discoloration of lips, tongue, or fingertips (severe hypoxia).",
          "Acute chest pain upon deep inspiration with severe breathlessness.",
        ],
      };
    }

    if (profile.domain === "gastroenterology") {
      return {
        routine: [
          "Sip clear fluids frequently in small amounts to maintain hydration.",
          "Eat small, bland meals (crackers, rice, toast) as tolerated.",
        ],
        urgent: [
          "Persistent vomiting preventing retention of oral fluids for more than 24 hours.",
          "Pain localizing sharply to the lower right abdomen (McBurney's point screen).",
          "High fever with chills and persistent abdominal tenderness.",
        ],
        emergency: [
          "Vomiting dark coffee-ground material or bright red blood (hematemesis).",
          "Black, tarry, sticky stools (melena) indicating acute gastrointestinal bleeding.",
          "Abdomen becoming rigid, board-like, or excruciatingly tender to light touch.",
          "Severe dizziness, lightheadedness, or fainting upon standing.",
        ],
      };
    }

    // General / Outpatient fallback
    return {
      routine: [
        "Track baseline symptoms and temperature at regular intervals.",
        "Prioritize restful sleep and avoid physical or mental fatigue.",
      ],
      urgent: [
        "Symptoms persisting or progressively worsening beyond 48-72 hours without noticeable relief.",
        "Persistent high fever unresponsive to supportive measures.",
        "Inability to tolerate oral fluids or food.",
      ],
      emergency: [
        "Acute shortness of breath, severe chest pain, or loss of consciousness.",
        "Sudden facial droop, arm weakness, or slurred speech.",
        "Uncontrollable bleeding or severe disorientation.",
      ],
    };
  }

  /**
   * Generates risk-appropriate follow-up recommendations (Requirement 8 & 9).
   */
  public static generateRiskAppropriateFollowUp(
    profile: ClinicalSymptomProfile,
    doctorName: string,
    specialty: string
  ): string[] {
    const recs: string[] = [];

    // Severe or prolonged symptoms (e.g. 6-7/10 headache for ~5 hours)
    if (profile.severityScore >= 6 || (profile.durationHours && profile.durationHours >= 4 && profile.severityScore >= 5)) {
      if (profile.domain === "neurology") {
        recs.push(
          `Because you report a persistent ${profile.character ? `${profile.character} ` : ""}${profile.primarySymptom} (severity ${profile.initialSeverity || profile.currentSeverity || "6-7/10"}) lasting ${profile.duration}, an in-person clinical assessment with ${doctorName} (${specialty}) or an urgent care clinic is recommended within 24 hours rather than delaying follow-up.`
        );
        recs.push(
          "Maintain a detailed headache log recording exact times, intensity changes, and any visual or sensory symptoms to share with your physician."
        );
      } else {
        recs.push(
          `Given your reported severity of ${profile.currentSeverity || `${profile.severityScore}/10`} lasting ${profile.duration}, schedule an outpatient evaluation with ${doctorName} within 24 hours.`
        );
      }
    } else {
      recs.push(
        `Schedule a routine outpatient follow-up consultation with ${doctorName} (${specialty}) within 2-3 days if symptoms do not significantly improve.`
      );
    }

    recs.push("Bring a complete list of your current medications and this clinical summary to your in-person visit.");
    return recs;
  }
}
