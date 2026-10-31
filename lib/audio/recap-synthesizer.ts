/**
 * Grounded Clinical Recap Narration Synthesizer
 *
 * Generates concise, clinically grounded, and evidence-bounded narration scripts
 * for Kokoro TTS playback from verified consultation categories.
 *
 * Invariants:
 * 1. Maximum 120 words (enforced deterministically).
 * 2. Strict provenance separation: Historical baseline vs Current intake.
 * 3. Never infers symptom resolution or clinical diagnosis without evidence.
 * 4. Communicates unknown/unassessed dimensions explicitly.
 * 5. Uses local Kokoro TTS pipeline with zero external paid APIs.
 */

import {
  extractGroundedRecapCategories,
  GroundedRecapCategories,
} from "../triage/recap-categories";

export interface RecapScriptResult {
  script: string;
  wordCount: number;
  isFollowUp: boolean;
  groundedDataPoints: number;
}

/**
 * Counts words in a string
 */
export function countWords(text: string): number {
  if (!text || typeof text !== "string") return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Deterministically condenses or truncates a script to strictly fit within maxWords
 */
export function enforceMaxWords(text: string, maxWords: number = 120): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) {
    return text.trim();
  }
  return words.slice(0, maxWords).join(" ") + "...";
}

/**
 * Synthesizes a clinically grounded spoken recap script under 120 words
 */
export function synthesizeRecapScript(
  consultation: any,
  options: { maxWords?: number; doctorName?: string } = {}
): RecapScriptResult {
  const maxWords = options.maxWords || 120;
  const categories: GroundedRecapCategories = extractGroundedRecapCategories(consultation);
  const isFollowUp = categories.isFollowUp;

  const parts: string[] = [];
  let groundedCount = 0;

  // 1. Introduction / Greeting
  if (isFollowUp) {
    parts.push("Welcome back for your follow-up consultation.");
  } else {
    parts.push("Welcome back. Here is a brief summary of where we left off.");
  }

  // 2. Previously Reported (Baseline / Historical)
  if (categories.previouslyReported.length > 0) {
    const historicalItems = categories.previouslyReported.slice(0, 2);
    const descriptions = historicalItems.map((item) => {
      groundedCount++;
      if (item.domain === "medical_history" || item.domain === "chronic_condition") {
        return `history of ${item.label}`;
      }
      if (item.domain === "prior_encounter") {
        return `previous visit for ${item.value}`;
      }
      return `${item.label}: ${item.value}`;
    });
    parts.push(`From your medical history, we have recorded your ${descriptions.join(" and ")}.`);
  }

  // 3. Information Discussed (Current intake data)
  if (categories.informationDiscussed.length > 0) {
    const cc = categories.informationDiscussed.find((i) => i.domain === "chief_complaint");
    const onset = categories.informationDiscussed.find((i) => i.label === "Onset & Timeline");
    const symptoms = categories.informationDiscussed.filter(
      (i) => i.domain === "symptom" && i.label !== "Chief Complaint"
    );

    const intakeParts: string[] = [];
    if (cc && cc.value) {
      groundedCount++;
      intakeParts.push(`your reported concern is ${cc.value}`);
    }
    if (onset && onset.value && onset.value.toLowerCase() !== "unknown / not specified") {
      groundedCount++;
      intakeParts.push(`with onset ${onset.value}`);
    }
    if (symptoms.length > 0) {
      const symList = symptoms.slice(0, 2).map((s) => s.value).filter(Boolean);
      if (symList.length > 0) {
        groundedCount += symList.length;
        intakeParts.push(`along with ${symList.join(" and ")}`);
      }
    }

    if (intakeParts.length > 0) {
      parts.push(`In your intake, ${intakeParts.join(", ")}.`);
    }
  }

  // 4. Still to Explore (Unassessed Gaps)
  if (categories.stillToExplore.length > 0) {
    const pendingNames = categories.stillToExplore
      .slice(0, 2)
      .map((e) => e.dimension)
      .join(" and ");
    groundedCount++;
    parts.push(`We still need to explore your ${pendingNames}.`);
  }

  // 5. Prompt for Changes & Microphone Protection Reminder
  if (isFollowUp) {
    parts.push("Please verify if any symptoms have changed since your last visit before we begin.");
  } else {
    parts.push("Please confirm if anything has changed since we paused. When ready, tap Proceed to Consultation to activate your microphone.");
  }

  // Join and enforce maxWords boundary
  const fullScript = parts.join(" ");
  const boundedScript = enforceMaxWords(fullScript, maxWords);
  const wordCount = countWords(boundedScript);

  return {
    script: boundedScript,
    wordCount,
    isFollowUp,
    groundedDataPoints: groundedCount,
  };
}
