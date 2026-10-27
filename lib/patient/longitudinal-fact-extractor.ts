/**
 * Deterministic Longitudinal Fact Extractor & Normalization Gate (Milestone 2)
 *
 * Evaluates server-reconciled AttributedClinicalFactV3 records against strict clinical
 * criteria to determine eligibility for promotion into the Longitudinal Patient Context store.
 *
 * Core Invariants:
 * 1. Pure Deterministic Gate: No LLM calls, no heuristic guessing, zero hallucination surface.
 * 2. Strict Subject Attribution: Requires patient or authorized caregiver speaking for the target profile.
 * 3. Clinical Concept Registry: Only allows explicitly registered longitudinal concepts (sleep, HR, mobility).
 * 4. Temporal Classification: Explicit acute single events -> episodic; habitual/routine baselines -> baseline.
 * 5. Unverified Default: All extracted patient-reported facts are strictly marked verification: 'unverified'.
 */

import { AttributedClinicalFactV3 } from "@/lib/agents/schemas";
import {
  FactCategory,
  TemporalScope,
  RecordFactParams,
} from "./longitudinal-fact-types";

export interface ExtractionContext {
  targetPatientProfileId: string;
  targetSubjectRelation?: "self" | "parent" | "child" | "spouse" | "other";
  sourceConsultationId: string;
  sourceTurnId: string;
  reportedAt?: string;
}

export type ExtractionResult =
  | {
      eligible: true;
      factParams: RecordFactParams;
    }
  | {
      eligible: false;
      rejectionReason: string;
    };

interface ConceptDefinition {
  canonicalConcept: string;
  category: FactCategory;
  defaultUnit: string;
  aliases: string[];
}

const SUPPORTED_CONCEPTS: Record<string, ConceptDefinition> = {
  sleep_duration: {
    canonicalConcept: "usual_sleep_duration",
    category: "lifestyle_sleep",
    defaultUnit: "hours/night",
    aliases: [
      "sleep_duration",
      "usual_sleep_duration",
      "nocturnal_sleep_hours",
      "nightly_sleep",
      "sleep_hours",
    ],
  },
  resting_heart_rate: {
    canonicalConcept: "resting_heart_rate",
    category: "vital_reading",
    defaultUnit: "bpm",
    aliases: [
      "resting_heart_rate",
      "resting_pulse",
      "baseline_pulse",
      "heart_rate_resting",
    ],
  },
  functional_mobility_range: {
    canonicalConcept: "functional_mobility_range",
    category: "functional_mobility",
    defaultUnit: "blocks",
    aliases: [
      "functional_mobility_range",
      "walking_distance_capacity",
      "ambulatory_limit",
      "walking_endurance",
      "mobility_range",
    ],
  },
};

/**
 * Normalizes an incoming raw concept key to a registered canonical concept definition.
 */
function resolveConceptDefinition(rawConcept: string): ConceptDefinition | null {
  const normalized = rawConcept.trim().toLowerCase().replace(/[\s-]+/g, "_");
  for (const def of Object.values(SUPPORTED_CONCEPTS)) {
    if (def.canonicalConcept === normalized || def.aliases.includes(normalized)) {
      return def;
    }
  }
  return null;
}

/**
 * Parses numeric scalars and units from utterance text and concept context.
 */
function parseNumericObservation(
  conceptDef: ConceptDefinition,
  rawUtterance: string
): { numericValue: number; unit: string; reportedValue: string } | null {
  const text = rawUtterance.toLowerCase();

  switch (conceptDef.category) {
    case "lifestyle_sleep": {
      // Matches: "5 hours", "5.5 hrs", "5-6 hours", "about 5 hours a night"
      const sleepMatch = text.match(/(\d+(?:\.\d+)?)(?:\s*(?:-|to)\s*\d+(?:\.\d+)?)?\s*(?:hours|hrs|hr|h)\b/i);
      if (sleepMatch) {
        const val = parseFloat(sleepMatch[1]);
        if (!isNaN(val) && val >= 0 && val <= 24) {
          return {
            numericValue: val,
            unit: "hours/night",
            reportedValue: `${val} hours`,
          };
        }
      }
      // Matches: "300 minutes"
      const minMatch = text.match(/(\d+)\s*(?:minutes|mins|min)\b/i);
      if (minMatch) {
        const mins = parseInt(minMatch[1], 10);
        if (!isNaN(mins) && mins >= 0 && mins <= 1440) {
          const hours = Math.round((mins / 60) * 10) / 10;
          return {
            numericValue: hours,
            unit: "hours/night",
            reportedValue: `${hours} hours`,
          };
        }
      }
      return null;
    }

    case "vital_reading": {
      // Matches: "72 bpm", "72 beats per minute", "pulse of 72", "heart rate 72"
      const bpmMatch = text.match(/(\d{2,3})\s*(?:bpm|beats\s*(?:per|\/)\s*minute)\b/i) ||
                       text.match(/(?:pulse|heart rate|resting rate)(?:\s*(?:is|of|was|around|about)?)\s*(\d{2,3})\b/i);
      if (bpmMatch) {
        const val = parseInt(bpmMatch[1], 10);
        if (!isNaN(val) && val >= 30 && val <= 250) {
          return {
            numericValue: val,
            unit: "bpm",
            reportedValue: `${val} bpm`,
          };
        }
      }
      return null;
    }

    case "functional_mobility": {
      // Matches: "2 blocks", "100 meters", "0.5 miles", "3 flights of stairs"
      const blockMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:blocks?)\b/i);
      if (blockMatch) {
        const val = parseFloat(blockMatch[1]);
        if (!isNaN(val) && val >= 0) {
          return {
            numericValue: val,
            unit: "blocks",
            reportedValue: `${val} blocks`,
          };
        }
      }
      const distMatch = text.match(/(\d+(?:\.\d+)?)\s*(meters?|miles?|km|kilometers?)\b/i);
      if (distMatch) {
        const val = parseFloat(distMatch[1]);
        const unit = distMatch[2].toLowerCase();
        if (!isNaN(val) && val >= 0) {
          return {
            numericValue: val,
            unit,
            reportedValue: `${val} ${unit}`,
          };
        }
      }
      const stairsMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:flights?\s*(?:of\s*)?stairs?)\b/i);
      if (stairsMatch) {
        const val = parseFloat(stairsMatch[1]);
        if (!isNaN(val) && val >= 0) {
          return {
            numericValue: val,
            unit: "flights_of_stairs",
            reportedValue: `${val} flights of stairs`,
          };
        }
      }
      return null;
    }

    default:
      return null;
  }
}

/**
 * Determines whether the statement reflects an acute single event (episodic)
 * or an ongoing, habitual routine/capacity (baseline).
 */
function classifyTemporalScope(utterance: string, factTemporality?: string): TemporalScope {
  const text = utterance.toLowerCase();

  // Explicit acute episodic markers
  const isEpisodic =
    /\b(last night|last evening|yesterday|this morning|today only|suddenly today|one time|last night only|slept poorly last night)\b/i.test(text);

  if (isEpisodic) {
    return "episodic";
  }

  // Explicit habitual / baseline markers
  const isHabitual =
    /\b(usually|normally|typically|generally|routine|every night|per night|a night|always|for (?:years|months|weeks)|baseline|on average)\b/i.test(text);

  if (isHabitual) {
    return "baseline";
  }

  // Default to fact temporality if explicitly labeled historical/current
  if (factTemporality === "historical") {
    return "baseline";
  }

  return "baseline";
}

/**
 * Pure deterministic promotion gate. Evaluates an already reconciled AttributedClinicalFactV3.
 */
export function extractLongitudinalCandidate(
  fact: AttributedClinicalFactV3,
  context: ExtractionContext
): ExtractionResult {
  // 1. Assertion status check: Must be explicitly 'present'
  if (fact.assertionStatus !== "present") {
    return {
      eligible: false,
      rejectionReason: `Fact assertionStatus is '${fact.assertionStatus}'. Only 'present' assertions qualify for longitudinal storage.`,
    };
  }

  // 2. Speaker attribution check: Must be patient or authorized caregiver
  if (fact.sourceSpeaker !== "patient" && fact.sourceSpeaker !== "caregiver") {
    return {
      eligible: false,
      rejectionReason: `Source speaker is '${fact.sourceSpeaker}'. Only direct patient or caregiver utterances qualify.`,
    };
  }

  // 3. Clinical concept registry check
  const conceptDef = resolveConceptDefinition(fact.concept);
  if (!conceptDef) {
    return {
      eligible: false,
      rejectionReason: `Concept '${fact.concept}' is not registered for longitudinal persistence.`,
    };
  }

  // 4. Third-party leakage prevention
  const utterance = (fact.sourceUtterance || "").trim();
  const lowerUtterance = utterance.toLowerCase();
  const isSelfRelation = !context.targetSubjectRelation || context.targetSubjectRelation === "self";

  if (isSelfRelation) {
    // If target profile is "self", but utterance speaks about third parties
    if (/\b(my (?:mother|father|mom|dad|son|daughter|sister|brother|husband|wife|child|friend))\b/i.test(lowerUtterance)) {
      return {
        eligible: false,
        rejectionReason: "Utterance refers to a third-party relative while target profile is 'self'.",
      };
    }
  }

  // 5. Numeric observation parsing
  const parsedObs = parseNumericObservation(conceptDef, utterance);
  if (!parsedObs) {
    return {
      eligible: false,
      rejectionReason: `Failed to extract an unambiguous numeric scalar and unit for concept '${conceptDef.canonicalConcept}'.`,
    };
  }

  // 6. Temporal scope classification
  const temporalScope = classifyTemporalScope(utterance, fact.temporality);

  // 7. Assemble validated RecordFactParams with strict 'unverified' status
  const factParams: RecordFactParams = {
    patientProfileId: context.targetPatientProfileId,
    category: conceptDef.category,
    concept: conceptDef.canonicalConcept,
    reportedValue: parsedObs.reportedValue,
    numericValue: parsedObs.numericValue,
    unit: parsedObs.unit,
    temporalScope,
    sourceType: fact.sourceSpeaker,
    sourceConsultationId: context.sourceConsultationId,
    sourceTurnId: context.sourceTurnId,
    reportedAt: context.reportedAt || fact.timestamp || new Date().toISOString(),
    verification: "unverified", // Strictly unverified
  };

  return {
    eligible: true,
    factParams,
  };
}
