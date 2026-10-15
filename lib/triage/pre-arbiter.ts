import { PatientCase, SpecialistRequest } from "../agents/schemas";
import { evaluateUniversalRedFlags, RedFlagResult } from "./universal-red-flags";

export interface PreArbiterResult {
  immediate_danger: boolean;
  pre_safety_flags: string[];
  suggested_specialists: SpecialistRequest[];
  universal_red_flag_result?: RedFlagResult;
  latency_us: number; // empirical latency in microseconds
}

/**
 * DETERMINISTIC PRE-ARBITER SAFETY SHIELD
 * 
 * Invariant: Runs before any LLM is invoked.
 * Detects immediate life-threatening physiological crises with zero LLM dependence.
 * Measures exact runtime latency in microseconds without marketing exaggerations.
 */
export function evaluatePreArbiter(patientCase: Partial<PatientCase>): PreArbiterResult {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();

  const text = (patientCase.transcript || "").toLowerCase();
  const pre_safety_flags: string[] = [];
  const suggested_specialists: SpecialistRequest[] = [];

  // Helper for lookbehind negation detection
  const negationPatterns = [
    /(?:no|denies|denied|without|never|rules?\s+out|negative\s+for|not|don'?t(?:\s+have)?|doesn'?t(?:\s+have)?|do\s+not(?:\s+have)?|does\s+not(?:\s+have)?|haven'?t(?:\s+had)?|free\s+of)(?:\s+[a-z0-9_-]+){0,4}\s+(?:or|and|\/)\s*$/i,
    /(?:no|denies|denied|without|never|rules?\s+out|negative\s+for|not|don'?t(?:\s+have)?|doesn'?t(?:\s+have)?|do\s+not(?:\s+have)?|does\s+not(?:\s+have)?|haven'?t(?:\s+had)?|free\s+of)(?:\s+[a-z0-9_-]+){0,4}\s*$/i,
  ];

  // Helper for lookbehind negation detection
  const isNegated = (keyword: string): boolean => {
    const idx = text.indexOf(keyword);
    if (idx === -1) return false;
    const windowStart = Math.max(0, idx - 70);
    const window = text.slice(windowStart, idx);
    const lastBoundary = Math.max(
      window.lastIndexOf("."),
      window.lastIndexOf(";"),
      window.lastIndexOf("!"),
      window.lastIndexOf("?"),
      window.lastIndexOf("\n"),
      window.lastIndexOf(" but ")
    );
    const effectiveWindow = lastBoundary !== -1 ? window.slice(lastBoundary) : window;
    return negationPatterns.some((pattern) => pattern.test(effectiveWindow.trim()));
  };

  const hasAffirmative = (patterns: string[]): boolean => {
    return patterns.some((p) => text.includes(p) && !isNegated(p));
  };

  const hasAffirmativeRegex = (re: RegExp): boolean => {
    const match = text.match(re);
    if (!match) return false;
    const idx = text.search(re);
    const windowStart = Math.max(0, idx - 70);
    const window = text.slice(windowStart, idx);
    const lastBoundary = Math.max(
      window.lastIndexOf("."),
      window.lastIndexOf(";"),
      window.lastIndexOf("!"),
      window.lastIndexOf("?"),
      window.lastIndexOf("\n"),
      window.lastIndexOf(" but ")
    );
    const effectiveWindow = lastBoundary !== -1 ? window.slice(lastBoundary) : window;
    return !negationPatterns.some((pattern) => pattern.test(effectiveWindow.trim()));
  };

  // Historical resolved episode filter (past symptoms currently resolved do not trigger acute preemption)
  const isPastResolved =
    /\b(?:yesterday|days?\s+ago|last\s+night|previous|past)\b/i.test(text) &&
    /\b(?:fine\s+now|gone\s+now|better\s+now|well\s+now|resolved|no\s+longer|no\s+pain\s+now)\b/i.test(text);

  // 1. Cardiovascular / Acute Coronary Syndrome (ACS) Red Flags
  const hasChestPain = !isPastResolved && (hasAffirmative([
    "chest pain", "chest pressure", "crushing chest", "heavy chest", "tightness in chest",
    "elephant on chest", "squeezing chest", "pain radiating to left arm", "substernal", "retrosternal",
    "tight pressure in the center", "tight pressure in the middle", "pressure under breastbone",
    "behind my sternum", "behind the sternum", "sternum"
  ]) || hasAffirmativeRegex(/\b(crushing|heavy|tightness|tight|pressure|squeezing)[^.,;!?\n]*(chest|sternum|breastbone)\b/i)
     || hasAffirmativeRegex(/\b(chest|sternum|breastbone)[^.,;!?\n]*(pressure|tight|squeeze|crush|heav|pain)\b/i)
     || (hasAffirmative(["breastbone", "sternum", "center of my chest", "middle of my chest"]) && hasAffirmative(["pressure", "tight", "squeezing", "heavy", "weight"])));

  const hasCardiacRadiation = hasAffirmative([
    "left arm", "jaw pain", "neck pain", "between shoulder blades", "cold sweats", "cold sweat", "sweating cold", "diaphoresis"
  ]) || hasAffirmativeRegex(/radiat[^.,;!?\n]*(left arm|arm|jaw)/i)
     || hasAffirmativeRegex(/sweat\w*\s+cold|cold\s+sweat\w*/i);

  if (hasChestPain) {
    pre_safety_flags.push("PRE_FLAG_ACUTE_CHEST_PAIN");
    if (hasCardiacRadiation) {
      pre_safety_flags.push("PRE_FLAG_ACS_RADIATION_OR_DIAPHORESIS");
    }
    suggested_specialists.push({
      specialty: "cardiology",
      reason: hasCardiacRadiation ? "Crushing chest discomfort with typical radiation" : "Thoracic pain evaluation",
      priority: "immediate",
      trigger_flags: ["PRE_FLAG_ACUTE_CHEST_PAIN"]
    });
  }

  // 2. Neurological / Acute Ischemic Stroke Red Flags (BE-FAST)
  const hasNeuroDeficit = hasAffirmative([
    "facial droop", "face drooping", "arm weakness", "slurred speech", "cannot speak",
    "sudden numbness", "loss of speech", "sudden confusion", "hemiparesis",
  ]) || hasAffirmativeRegex(/\b(facial[^.,;!?\n]*droop|face[^.,;!?\n]*droop|arm[^.,;!?\n]*weak|cannot[^.,;!?\n]*lift[^.,;!?\n]*arm|slurred[^.,;!?\n]*speech|sudden[^.,;!?\n]*numb)/i);

  if (hasNeuroDeficit) {
    pre_safety_flags.push("PRE_FLAG_ACUTE_NEUROLOGIC_DEFICIT");
    suggested_specialists.push({
      specialty: "neurology",
      reason: "Acute focal neurological deficit / BE-FAST criteria match",
      priority: "immediate",
      trigger_flags: ["PRE_FLAG_ACUTE_NEUROLOGIC_DEFICIT"]
    });
  }

  // 3. Airway / Respiratory Failure / Anaphylaxis Red Flags
  const hasAirwayCompromise = hasAffirmative([
    "cannot breathe", "stridor", "blue lips", "gasping for air", "throat swelling",
    "tongue swelling", "unable to speak full sentences", "anaphylaxis"
  ]);

  if (hasAirwayCompromise) {
    pre_safety_flags.push("PRE_FLAG_IMMEDIATE_AIRWAY_FAILURE");
  }

  // 3b. Deep Neck Space Infection / Peritonsillar Abscess (PTA) Airway Threat Red Flags
  const hasMuffledVoice = hasAffirmative([
    "muffled voice", "hot potato voice", "voice sounds muffled", "voice sounds a bit muffled",
    "something in my mouth", "potato in my mouth"
  ]) || hasAffirmativeRegex(/\b(voice.*muffled|muffled.*voice|something in.*mouth)\b/i);

  const hasSevereOdynophagiaOrAirwayThreat = hasAffirmative([
    "swallowing saliva", "swallow saliva", "cannot swallow saliva", "painful to swallow saliva",
    "hurts to swallow saliva", "drooling", "spitting saliva", "can't open mouth", "cannot open mouth",
    "trismus", "stridor", "trouble breathing", "throat swelling"
  ]) || hasAffirmativeRegex(/\b(?:swallowing\s+saliva|saliva\s+is\s+really\s+painful)\b/i);

  const hasFeverInTranscript = hasAffirmative(["fever", "temperature", "chills"]) ||
    hasAffirmativeRegex(/\b(?:10[0-9](?:\.[0-9]+)?|3[8-9]\.[0-9]|fever)\b/i);

  const hasDeepNeckInfectionRisk = (hasMuffledVoice && hasSevereOdynophagiaOrAirwayThreat && hasFeverInTranscript) ||
    (hasMuffledVoice && hasSevereOdynophagiaOrAirwayThreat);

  if (hasDeepNeckInfectionRisk) {
    pre_safety_flags.push("PRE_FLAG_DEEP_NECK_INFECTION_OR_PTA");
    suggested_specialists.push({
      specialty: "otolaryngology",
      reason: "Suspected peritonsillar abscess / deep neck space infection with potential airway compromise",
      priority: "immediate",
      trigger_flags: ["PRE_FLAG_DEEP_NECK_INFECTION_OR_PTA"]
    });
  }

  // Check speech features if provided
  if (patientCase.speech_features?.clinical_relevance?.respiratory_distress_signal === "severe") {
    pre_safety_flags.push("PRE_FLAG_ACOUSTIC_SEVERE_RESPIRATORY_DISTRESS");
  }

  // 4. Pediatric Crisis Red Flags
  const isPediatric = patientCase.demographics?.age_group === "infant" ||
                      patientCase.demographics?.age_group === "pediatric" ||
                      (patientCase.demographics?.age !== undefined && patientCase.demographics.age < 16) ||
                      hasAffirmative(["baby", "child", "infant", "newborn", "neonate", "toddler", "my son", "my daughter", "months old", "month old", "weeks old", "week old", "days old", "day old"]) ||
                      hasAffirmativeRegex(/\b\d+\s*-(?:week|month|day|year)-old\b/i) ||
                      hasAffirmativeRegex(/\b\d+\s+(?:weeks?|months?|days?|years?)\s+old\b/i);

  const hasPediatricEmergency = isPediatric && (
    hasAffirmative([
      "inconsolable", "lethargic", "floppy", "unusually floppy", "not waking up", "refusing to wake",
      "grunting", "sunken fontanelle", "fever in newborn", "high fever", "refusing to feed", "won't wake", "cannot wake"
    ]) ||
    // Any fever in a newborn / young infant (< 3 months / 12 weeks) is a pediatric medical emergency
    (hasAffirmativeRegex(/\b(?:newborn|neonate|\d+\s*-(?:day|week)-old|\d+\s+(?:days?|weeks?)\s+old)\b/i) && hasAffirmativeRegex(/\b(?:10[0-9](?:\.[0-9]+)?|38\.[0-9]|39|fever|temp(?:erature)?)\b/i))
  );

  if (isPediatric) {
    suggested_specialists.push({
      specialty: "pediatrics",
      reason: "Pediatric-specific symptom and developmental vital evaluation",
      priority: hasPediatricEmergency ? "immediate" : "routine",
      trigger_flags: hasPediatricEmergency ? ["PRE_FLAG_PEDIATRIC_CRISIS"] : []
    });
    if (hasPediatricEmergency) {
      pre_safety_flags.push("PRE_FLAG_PEDIATRIC_CRISIS");
    }
  }

  // Presentation-independent Universal Red-Flag Screen
  const pSpec = (patientCase as any).patientSpec;
  const demo = patientCase.demographics as any;
  const universalResult = evaluateUniversalRedFlags({
    rawText: text,
    cumulativeTranscript: text,
    patient: pSpec || {
      ageYears: demo?.age,
      pregnancy: demo?.is_pregnant ? { status: "pregnant" } : undefined,
      modifiers: demo?.risk_factors || [],
    }
  });

  if (universalResult.level === "EMERGENCY_NOW") {
    for (const fired of universalResult.firedRules) {
      if (!pre_safety_flags.includes(fired.ruleId)) {
        pre_safety_flags.push(fired.ruleId);
      }
    }
  }

  // Determine immediate danger threshold
  const immediate_danger = pre_safety_flags.length > 0;

  const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const latency_us = Math.max(1, Math.round((t1 - t0) * 1000));

  return {
    immediate_danger,
    pre_safety_flags,
    suggested_specialists,
    universal_red_flag_result: universalResult,
    latency_us
  };
}
