/**
 * EVIDENCE EXTRACTOR & CLINICAL SEMANTIC NORMALIZER
 * 
 * Invariants:
 * 1. ZERO RAW UTTERANCE LEAKS: Never stores user speech strings (e.g. "Uh, nothing much...") as clinical facts.
 * 2. Explicit Status: Facts are marked "present", "absent", or "unknown".
 *    "fever = absent" means denied by patient; "fever = unknown" means not yet assessed.
 * 3. Multi-Domain Entity Coverage: ENT, Respiratory, Cardiac, Neurological, GI, Constitutional.
 * 4. Pivot Signal: Flags when patient introduces a new unexpected finding (e.g. voice change)
 *    so the question planner pivots to characterize it before continuing routine checklists.
 */

import {
  ClinicalFact,
  ClinicalInterviewStateV2,
  RedFlagDomainAssessment,
  extractEpisodicSeverity,
  parseOnsetDimensions,
  parseAbdominalLocations,
  extractGiAssociatedSymptoms,
  ABDOMINAL_LOCATION_LABELS,
} from "./clinical-state";

export interface ExtractedEvidenceResult {
  rawUtterance: string;
  intent: "symptom_report" | "answer_question" | "denial" | "clarification" | "repetition_objection" | "small_talk";
  newFacts: ClinicalFact[];
  updatedChiefComplaint?: ClinicalFact;
  symptomProfileUpdates: Partial<ClinicalInterviewStateV2["symptomProfile"]>;
  associatedSymptomsUpdates: ClinicalFact[];
  redFlagAssessments: Partial<Record<string, RedFlagDomainAssessment>>;
  deniedTopics: string[];
  newFindingsDetected: string[];
  isReaffirmation: boolean;
  requiresClarification: boolean;
}

export class EvidenceExtractor {
  /**
   * Extract normalized clinical facts from a patient utterance
   */
  public extract(
    utterance: string,
    state: ClinicalInterviewStateV2,
    lastDoctorQuestion?: string,
    lastTarget?: string
  ): ExtractedEvidenceResult {
    const text = utterance.trim();
    const lower = text.toLowerCase();
    const turnId = state.turnCount + 1;
    const timestamp = new Date().toISOString();

    const newFacts: ClinicalFact[] = [];
    const symptomProfileUpdates: Partial<ClinicalInterviewStateV2["symptomProfile"]> = {};
    const associatedSymptomsUpdates: ClinicalFact[] = [];
    const redFlagAssessments: Partial<Record<string, RedFlagDomainAssessment>> = {};
    const deniedTopics: string[] = [];
    const newFindingsDetected: string[] = [];

    let isReaffirmation = false;
    let intent: ExtractedEvidenceResult["intent"] = "symptom_report";

    // 1. Detect Repetition / Objection Intent ("I already said", "I insist", "We already talked")
    const isObjectionOrInsist = /\b(i\s+insist|already\s+said|like\s+i\s+said|told\s+you|why\s+are\s+you\s+asking\s+again|we\s+already)\b/i.test(lower);
    if (isObjectionOrInsist) {
      isReaffirmation = true;
      intent = "repetition_objection";
    }

    // 2. Detect Pure Denials ("No", "Nope", "None", "Nothing much", "Neither")
    const isNegativeStatement = /^(?:no|nope|none|nothing|nothing\s+else|nothing\s+much|not\s+really|neither|no\s+fever|no\s+pain)[.!?\s]*$/i.test(lower) ||
      /\b(nothing\s+much|nothing\s+else|no\s+trouble\s+swallowing|no\s+fever|no\s+ear\s+pain|no\s+shortness\s+of\s+breath)\b/i.test(lower);
    if (isNegativeStatement && intent !== "repetition_objection") {
      intent = "denial";
    }

    // 3. ENT & THROAT SYMPTOMS
    const hasThroatPain = /\b(throat\s+pain|sore\s+throat|throat\s+is\s+paining|throat\s+hurts?|throat\s+is\s+hurting|burning\s+throat|scratchy\s+throat)\b/i.test(lower);
    if (hasThroatPain) {
      const fact: ClinicalFact = {
        id: `fact-throat-pain-${turnId}`,
        name: "throat_pain",
        label: "Throat pain / Sore throat",
        category: "chief_complaint",
        status: "present",
        value: true,
        normalizedText: "Present (Throat pain)",
        confidence: 0.98,
        source: "patient",
        turnId,
        timestamp,
      };
      newFacts.push(fact);
    }

    // Voice change / Hoarseness
    const hasVoiceChange = /\b(voice\s+has\s+been\s+ruined|voice\s+changed|voice\s+is\s+different|lost\s+my\s+voice|hoarse|hoarseness|raspy\s+voice|hard\s+to\s+speak|difficulty\s+producing\s+voice)\b/i.test(lower);
    if (hasVoiceChange) {
      const isHoarse = /\b(hoarse|raspy|husky)\b/i.test(lower);
      const isLost = /\b(lost|cannot\s+speak|whisper|weak)\b/i.test(lower);
      const voiceDetail = isHoarse ? "Hoarseness / raspy quality" : isLost ? "Aphonia / marked vocal weakness" : "Voice changed / ruined";

      const fact: ClinicalFact = {
        id: `fact-voice-change-${turnId}`,
        name: "voice_change",
        label: "Voice change",
        category: "associated_symptom",
        status: "present",
        value: voiceDetail,
        normalizedText: voiceDetail,
        confidence: 0.96,
        source: "patient",
        turnId,
        timestamp,
      };
      newFacts.push(fact);
      associatedSymptomsUpdates.push(fact);

      if (!state.associatedSymptoms.some(s => s.name === "voice_change")) {
        newFindingsDetected.push("voice_change");
      }
    }

    // Odynophagia (Painful Swallowing) vs Dysphagia (Difficulty/Obstruction Swallowing)
    const hasPainfulSwallowing = /\b(?:hurts?|painful|pain|burning|sharp)\s+(?:when\s+(?:i\s+)?swallow|to\s+swallow|swallowing)\b/i.test(lower) ||
      /\b(?:when\s+(?:i\s+)?swallow|swallowing)\s+(?:it\s+)?(?:hurts?|is\s+painful)\b/i.test(lower) ||
      /\bodynophagia\b/i.test(lower);

    if (hasPainfulSwallowing) {
      const fact: ClinicalFact = {
        id: `fact-odynophagia-${turnId}`,
        name: "painful_swallowing",
        label: "Painful swallowing (Odynophagia)",
        category: "associated_symptom",
        status: "present",
        value: true,
        normalizedText: "Present (Painful swallowing / Odynophagia)",
        confidence: 0.98,
        source: "patient",
        turnId,
        timestamp,
      };
      newFacts.push(fact);
      associatedSymptomsUpdates.push(fact);
      newFindingsDetected.push("painful_swallowing");
    }

    // Swallowing difficulty / True Dysphagia (Mechanical or functional inability to pass liquids/food)
    const hasDysphagiaComplaint = /\b(trouble\s+swallowing|difficulty\s+swallowing|hard\s+to\s+swallow|cannot\s+swallow|can't\s+swallow|choking\s+on\s+liquids|food\s+gets?\s+stuck|unable\s+to\s+swallow|dysphagia)\b/i.test(lower);
    const isSwallowingPrompt = lastTarget === "swallowing_difficulty" ||
      /\b(swallow|swallowing|liquids|solids|saliva|dysphagia)\b/i.test(lastDoctorQuestion || state.nextBestQuestion?.suggestedPhrasing || (state as any).conversationMemory?.lastPlannedQuestion?.suggestedPhrasing || "");
    const hasDysphagiaDenial = /\b(?:no|not|neither|without|no\s+trouble|can\s+swallow\s+(?:fine|ok|normally))\s+(?:trouble\s+swallowing|difficulty\s+swallowing|problems?\s+swallowing|dysphagia)\b/i.test(lower) ||
      (/\b(?:nothing\s+with\s+that|nothing\s+like\s+that|no\s+trouble\s+with\s+that|none\s+of\s+that)\b/i.test(lower) && isSwallowingPrompt) ||
      (/^(?:no|nope|not\s+really|neither|none|nothing|nothing\s+with\s+that|nothing\s+like\s+that|no\s+trouble)[.!?\s]*$/i.test(lower) && isSwallowingPrompt);
    const mentionsSwallowing = hasPainfulSwallowing || hasDysphagiaComplaint || hasDysphagiaDenial || /\b(swallow|swallowing)\b/i.test(lower);

    if (hasDysphagiaComplaint && !hasDysphagiaDenial) {
      const fact: ClinicalFact = {
        id: `fact-dysphagia-${turnId}`,
        name: "swallowing_difficulty",
        label: "Swallowing difficulty (Dysphagia)",
        category: "red_flag",
        status: "present",
        value: true,
        normalizedText: "Present (Mechanical/functional difficulty swallowing)",
        confidence: 0.95,
        source: "patient",
        turnId,
        timestamp,
      };
      newFacts.push(fact);
      redFlagAssessments.swallowing = {
        domain: "swallowing",
        label: "Swallowing & saliva management",
        assessed: true,
        status: "concerning",
        finding: "Present (Difficulty swallowing)",
      };
    } else if (hasDysphagiaDenial) {
      const fact: ClinicalFact = {
        id: `fact-dysphagia-${turnId}`,
        name: "swallowing_difficulty",
        label: "Swallowing difficulty (Dysphagia)",
        category: "red_flag",
        status: "absent",
        value: false,
        normalizedText: "Denied (No difficulty swallowing fluids)",
        confidence: 0.95,
        source: "patient",
        turnId,
        timestamp,
      };
      newFacts.push(fact);
      deniedTopics.push("swallowing_difficulty");
      redFlagAssessments.swallowing = {
        domain: "swallowing",
        label: "Swallowing & saliva management",
        assessed: true,
        status: "clear",
        finding: "Denied (No difficulty swallowing)",
      };
    }

    // Fever / Chills
    const mentionsFever = /\b(fever|chills|temperature|hot\s+and\s+cold|feverish|sweats?)\b/i.test(lower);
    if (mentionsFever) {
      const isDenied = /\b(no|nope|not|neither|without|no\s+fever|haven'?t\s+had\s+(?:a\s+|any\s+)?fever|don'?t\s+have\s+(?:a\s+|any\s+)?fever)\b/i.test(lower);
      const status = isDenied ? "absent" : "present";
      const normalizedText = isDenied ? "Denied (No fever)" : "Present (Fever / chills)";

      const fact: ClinicalFact = {
        id: `fact-fever-${turnId}`,
        name: "fever",
        label: "Fever / Pyrexia",
        category: "associated_symptom",
        status,
        value: !isDenied,
        normalizedText,
        confidence: 0.94,
        source: "patient",
        turnId,
        timestamp,
      };
      newFacts.push(fact);
      associatedSymptomsUpdates.push(fact);
      if (isDenied) deniedTopics.push("fever");
    }

    // Ear pain / Otalgia
    const mentionsEarPain = /\b(ear\s+pain|earache|ears?\s+hurts?|ear\s+is\s+(?:hurting|aching|paining)|pain\s+spreads?\s+to\s+ears?|my\s+ear\s+hurts?)\b/i.test(lower);
    if (mentionsEarPain) {
      const isDenied = /\b(no|nope|not|neither|no\s+ear\s+pain)\b/i.test(lower);
      const status = isDenied ? "absent" : "present";
      const normalizedText = isDenied ? "Denied (No ear pain)" : "Present (Referred ear pain)";

      const fact: ClinicalFact = {
        id: `fact-ear-pain-${turnId}`,
        name: "ear_pain",
        label: "Ear pain (Otalgia)",
        category: "associated_symptom",
        status,
        value: !isDenied,
        normalizedText,
        confidence: 0.94,
        source: "patient",
        turnId,
        timestamp,
      };
      newFacts.push(fact);
      associatedSymptomsUpdates.push(fact);
      if (isDenied) deniedTopics.push("ear_pain");
    }

    // Airway / Stridor / Breathing difficulty
    const mentionsAirway = /\b(stridor|gasp|breathing|hard\s+to\s+breathe|throat\s+closing|choking|airway)\b/i.test(lower);
    if (mentionsAirway) {
      const isCritical = /\b(closing|stridor|choking|gasping|cannot\s+breathe)\b/i.test(lower);
      const isDenied = /\b(no|fine|breathing\s+is\s+fine|no\s+trouble\s+breathing)\b/i.test(lower);

      redFlagAssessments.airway = {
        domain: "airway",
        label: "Airway & breathing",
        assessed: true,
        status: isCritical ? "critical" : isDenied ? "clear" : "concerning",
        finding: isCritical ? "Airway distress reported" : isDenied ? "Airway clear" : "Breathing concern",
      };
    }

    // 4. CARDIOVASCULAR & CHEST SYMPTOMS
    const mentionsChest = /\b(chest|heart|sternum|angina)\b/i.test(lower);
    if (mentionsChest) {
      const isDenied = /\b(no|not|neither)\s+chest\s+pain\b/i.test(lower);
      if (!isDenied) {
        const fact: ClinicalFact = {
          id: `fact-chest-pain-${turnId}`,
          name: "chest_pain",
          label: "Chest discomfort",
          category: "chief_complaint",
          status: "present",
          value: true,
          normalizedText: "Present (Chest discomfort)",
          confidence: 0.96,
          source: "patient",
          turnId,
          timestamp,
        };
        newFacts.push(fact);
      }

      const charMatch = lower.match(/\b(tightness|pressure|squeezing|crushing|burning|sharp|heavy|elephant)\b/i);
      if (charMatch) {
        const fact: ClinicalFact = {
          id: `fact-chest-char-${turnId}`,
          name: "character",
          label: "Chest sensation",
          category: "symptom_profile",
          status: "present",
          value: charMatch[0],
          normalizedText: `${charMatch[0].charAt(0).toUpperCase() + charMatch[0].slice(1)} sensation`,
          confidence: 0.95,
          source: "patient",
          turnId,
          timestamp,
        };
        newFacts.push(fact);
        symptomProfileUpdates.character = fact;
      }
    }

    // Diaphoresis / Cold sweats
    const mentionsDiaphoresis = /\b(cold\s+sweats?|sweating|clammy|diaphoresis)\b/i.test(lower) && !/\b(no|not|neither)\s+(?:cold\s+)?sweats?\b/i.test(lower);
    if (mentionsDiaphoresis) {
      const fact: ClinicalFact = {
        id: `fact-diaphoresis-${turnId}`,
        name: "diaphoresis",
        label: "Diaphoresis / Cold sweats",
        category: "associated_symptom",
        status: "present",
        value: true,
        normalizedText: "Present (Cold sweats / diaphoresis)",
        confidence: 0.95,
        source: "patient",
        turnId,
        timestamp,
      };
      newFacts.push(fact);
      associatedSymptomsUpdates.push(fact);
    }

    // 5. NEUROLOGICAL SYMPTOMS (BE-FAST)
    if (/\b(droop|face.*droop|facial.*asymmetry)\b/i.test(lower)) {
      const isDenied = /\b(no|none|never)\b/i.test(lower);
      redFlagAssessments.neurological = {
        domain: "neurological",
        label: "Focal neurological deficit (BE-FAST)",
        assessed: true,
        status: isDenied ? "clear" : "critical",
        finding: isDenied ? "No facial droop" : "Acute facial droop reported",
      };
      if (isDenied) deniedTopics.push("facial_droop");
    }

    // 5a. HEADACHE PHOTOPHOBIA / PHONOPHOBIA
    const mentionsPhotophobia = /\b(?:sensitive\s+to\s+(?:bright\s+)?lights?|(?:bright\s+)?lights?\s+(?:bother|make|worsen)|photophob|light\s+sensitivity)\b/i.test(lower);
    const mentionsPhonophobia = /\b(?:sensitive\s+to\s+(?:loud\s+)?(?:sounds?|noise)|(?:loud\s+)?(?:sounds?|noise)\s+(?:bother|make|worsen)|phonophob|sound\s+sensitivity)\b/i.test(lower) || /\bsensitive\s+to\s+(?:bright\s+)?lights?\s+(?:or|and)\s+(?:loud\s+)?(?:sounds?|noise)\b/i.test(lower);

    if (mentionsPhotophobia) {
      const fact: ClinicalFact = {
        id: `fact-photophobia-${turnId}`,
        name: "photophobia",
        label: "Photophobia (light sensitivity)",
        category: "associated_symptom",
        status: "present",
        value: true,
        normalizedText: "Present (light sensitivity)",
        confidence: 0.94,
        source: "patient",
        turnId,
        timestamp,
      };
      newFacts.push(fact);
      associatedSymptomsUpdates.push(fact);
    }
    if (mentionsPhonophobia) {
      const fact: ClinicalFact = {
        id: `fact-phonophobia-${turnId}`,
        name: "phonophobia",
        label: "Phonophobia (sound sensitivity)",
        category: "associated_symptom",
        status: "present",
        value: true,
        normalizedText: "Present (sound sensitivity)",
        confidence: 0.94,
        source: "patient",
        turnId,
        timestamp,
      };
      newFacts.push(fact);
      associatedSymptomsUpdates.push(fact);
    }

    // 5b. ABDOMINAL / GI
    const giFindings = extractGiAssociatedSymptoms(lower);
    for (const gi of giFindings) {
      const fact: ClinicalFact = {
        id: `fact-${gi.name}-${turnId}`,
        name: gi.name,
        label: gi.label,
        category: "associated_symptom",
        status: gi.status,
        value: gi.status === "present",
        normalizedText: gi.status === "present" ? `Present (${gi.label})` : `Denied (${gi.label})`,
        confidence: 0.95,
        source: "patient",
        turnId,
        timestamp,
      };
      newFacts.push(fact);
      associatedSymptomsUpdates.push(fact);
      if (gi.status === "absent") deniedTopics.push(gi.name);
      if (gi.status === "present" && !state.associatedSymptoms.some(s => s.name === gi.name)) {
        newFindingsDetected.push(gi.name);
      }
    }

    const abdominalLocations = parseAbdominalLocations(lower);
    if (abdominalLocations.length > 0) {
      const labels = abdominalLocations.map(code => ABDOMINAL_LOCATION_LABELS[code]).join(", ");
      const locFact: ClinicalFact = {
        id: `fact-abd-loc-${turnId}`,
        name: "location",
        label: "Abdominal location",
        category: "symptom_profile",
        status: "present",
        value: labels,
        normalizedText: labels,
        confidence: 0.94,
        source: "patient",
        turnId,
        timestamp,
      };
      newFacts.push(locFact);
      symptomProfileUpdates.location = locFact;
    }

    const hasStomachPain = /\b(stomach\s+(?:ache|pain|cramp)|abdominal\s+pain|belly\s+(?:ache|pain)|tummy\s+(?:ache|pain))\b/i.test(lower);
    if (hasStomachPain) {
      const fact: ClinicalFact = {
        id: `fact-abd-pain-${turnId}`,
        name: "abdominal_pain",
        label: "Abdominal pain",
        category: "chief_complaint",
        status: "present",
        value: true,
        normalizedText: "Present (Abdominal pain)",
        confidence: 0.97,
        source: "patient",
        turnId,
        timestamp,
      };
      newFacts.push(fact);
    }

    // 6. TIMELINE, ONSET & COURSE (STRICT NORMALIZATION - NO UTTERANCE LEAKS)
    // Extract Onset
    const timeMatch = lower.match(/\b(?:since|from|about|approx\.?|roughly)?\s*(\d+\s*(?:minutes?|hours?|days?|weeks?)|morning\s+\d+\s+days?\s+ago|\d+\s+days?\s+ago|yesterday|this\s+morning|an?\s+hour|two\s+days|three\s+days)\b/i);
    if (timeMatch) {
      const cleanTime = timeMatch[0].replace(/^(?:since|from|about|roughly)\s*/i, "").trim();
      const onsetFact: ClinicalFact = {
        id: `fact-onset-${turnId}`,
        name: "onset",
        label: "Onset time",
        category: "symptom_profile",
        status: "present",
        value: cleanTime,
        normalizedText: cleanTime.startsWith("~") ? cleanTime : `~${cleanTime}`,
        confidence: 0.95,
        source: "patient",
        turnId,
        timestamp,
      };
      newFacts.push(onsetFact);
      symptomProfileUpdates.onset = onsetFact;

      // Duration can also be inferred if framed as "for X days"
      if (/\bfor\s+\d+\s+days?\b/i.test(lower) || /\bfor\s+two\s+days\b/i.test(lower)) {
        const durFact: ClinicalFact = {
          id: `fact-duration-${turnId}`,
          name: "duration",
          label: "Duration",
          category: "symptom_profile",
          status: "present",
          value: cleanTime,
          normalizedText: `~${cleanTime}`,
          confidence: 0.94,
          source: "patient",
          turnId,
          timestamp,
        };
        newFacts.push(durFact);
        symptomProfileUpdates.duration = durFact;
      }
    }

    // Extract Course (Sudden vs Gradual / Worsening)
    // Use clause-local onset evidence. A phrase such as "a sudden flash of
    // light" is a trigger, not a sudden onset of the patient's symptom.
    const parsedOnset = parseOnsetDimensions(lower);
    const hasGradual = parsedOnset.onsetPattern === "gradual";
    const hasSudden = parsedOnset.onsetPattern === "sudden";
    const hasWorsening = /\b(gradually\s+increased|got\s+worse|worsened|worse\s+today|increasing)\b/i.test(lower);

    if (hasGradual || hasSudden || hasWorsening) {
      let courseText = "Gradually worsening";
      if (hasSudden) courseText = "Sudden onset";
      else if (hasGradual && hasWorsening) courseText = "Gradually worsening over 24-48 hours";
      else if (hasGradual) courseText = "Gradual onset";

      const courseFact: ClinicalFact = {
        id: `fact-course-${turnId}`,
        name: "course",
        label: "Symptom course",
        category: "symptom_profile",
        status: "present",
        value: courseText,
        normalizedText: courseText,
        confidence: 0.95,
        source: "patient",
        turnId,
        timestamp,
      };
      newFacts.push(courseFact);
      symptomProfileUpdates.course = courseFact;
    }

    // 7. SEVERITY (0-10, including usual vs peak)
    const isSeverityPrompt = lastTarget === "severity" || /\b(severity|scale|0\s*[-–to]\s*10|zero\s*[-–to]\s*ten|how\s+severe)\b/i.test(lastDoctorQuestion || state.nextBestQuestion?.suggestedPhrasing || (state as any).conversationMemory?.lastPlannedQuestion?.suggestedPhrasing || "");
    const episodic = extractEpisodicSeverity(lower, isSeverityPrompt);
    const hasQualSeverity = /\b(mild|moderate|severe|unbearable|excruciating|tolerable)\b/i.test(lower);

    if (episodic) {
      const sevFact: ClinicalFact = {
        id: `fact-severity-${turnId}`,
        name: "severity",
        label: "Pain severity",
        category: "symptom_profile",
        status: "present",
        value: {
          baseline: episodic.baseline,
          peak: episodic.peak,
          pattern: episodic.pattern,
        },
        normalizedText: episodic.display,
        confidence: 0.96,
        source: "patient",
        turnId,
        timestamp,
      };
      newFacts.push(sevFact);
      symptomProfileUpdates.severity = sevFact;
    } else if (hasQualSeverity) {
      const qualMatch = lower.match(/\b(mild|moderate|severe|unbearable)\b/i);
      if (qualMatch) {
        const sevFact: ClinicalFact = {
          id: `fact-severity-${turnId}`,
          name: "severity",
          label: "Pain severity",
          category: "symptom_profile",
          status: "present",
          value: qualMatch[0],
          normalizedText: `${qualMatch[0].charAt(0).toUpperCase() + qualMatch[0].slice(1)} severity`,
          confidence: 0.92,
          source: "patient",
          turnId,
          timestamp,
        };
        newFacts.push(sevFact);
        symptomProfileUpdates.severity = sevFact;
      }
    }

    // 8. Handle "Nothing much" answering previous question
    if (isNegativeStatement && lastTarget && !mentionsSwallowing && !mentionsFever && !mentionsEarPain) {
      deniedTopics.push(lastTarget);
      if (lastTarget === "swallowing_difficulty") {
        redFlagAssessments.swallowing = {
          domain: "swallowing",
          label: "Swallowing & saliva management",
          assessed: true,
          status: "clear",
          finding: "Denied / Normal",
        };
      }
    }

    // Chief complaint assignment
    let updatedChiefComplaint: ClinicalFact | undefined = undefined;
    if (!state.chiefComplaint) {
      const primarySymptom = newFacts.find(f => f.category === "chief_complaint") ||
        newFacts.find(f => f.name === "painful_swallowing" || f.name === "swallowing_difficulty");
      if (primarySymptom) {
        updatedChiefComplaint = {
          ...primarySymptom,
          category: "chief_complaint",
        };
      }
    }

    return {
      rawUtterance: text,
      intent,
      newFacts,
      updatedChiefComplaint,
      symptomProfileUpdates,
      associatedSymptomsUpdates,
      redFlagAssessments,
      deniedTopics,
      newFindingsDetected,
      isReaffirmation,
      requiresClarification: false,
    };
  }
}

export const evidenceExtractor = new EvidenceExtractor();
