/**
 * FHIR R4 TEMPORAL PROVENANCE UTILITIES
 *
 * Provides deterministic ISO-8601 UTC timestamp parsing, validation, and period
 * calculations for HL7® FHIR® R4 exports.
 *
 * Clinical Invariants:
 * 1. Encounter.period: Spans actual patient-agent conversational turns; doctor
 *    approval (approvedAt) is a governance timestamp and is not equated with interaction end.
 * 2. Observation.effective[x]: Multi-turn cumulative telemetry emits effectivePeriod;
 *    single-turn emits effectiveDateTime. Ingest time is preserved without claiming
 *    exact vocalization timing.
 * 3. Condition.recordedDate vs onset[x]: Condition.recordedDate documents when MedVoice
 *    established the finding; Condition.onset[x] captures clinical disease onset and is
 *    never conflated with turn recording timestamp.
 */

import { TurnAudioMetricRecord } from "../acoustic/acoustic-dsp-analyzer";
import { DeliveredTurnRecord, AttributedClinicalFactV3 } from "../agents/schemas";

export type FhirEncounterStatus = "in-progress" | "finished" | "cancelled" | "unknown";

export interface EncounterPeriodParams {
  createdAt?: string | Date | null;
  approvedAt?: string | Date | null;
  status?: string | null;
  deliveredTurnRecords?: DeliveredTurnRecord[];
  audioMetricsHistory?: TurnAudioMetricRecord[];
}

export interface AcousticTemporalSpan {
  isMultiTurn: boolean;
  effectiveDateTime?: string;
  effectivePeriod?: {
    start: string;
    end: string;
  };
}

/**
 * Maps MedVoice consultation lifecycle status to standardized FHIR R4 Encounter.status.
 *
 * Clinical Rules:
 * - Active consultation ("in_progress", "in-progress", "active") -> "in-progress"
 * - Completed consultation ("completed_pending_review", "approved", "completed", "finished") -> "finished"
 * - Cancelled or abandoned consultation ("cancelled", "abandoned") -> "cancelled"
 * - If status is missing or unrecognized, do NOT assume finished:
 *   - If approvedAt exists, a physician has formally reviewed and signed off -> "finished"
 *   - Otherwise -> "unknown"
 */
export function mapEncounterStatus(
  status?: string | null,
  approvedAt?: string | Date | null
): FhirEncounterStatus {
  if (status && typeof status === "string") {
    const s = status.toLowerCase().trim();
    if (s === "in_progress" || s === "in-progress" || s === "active") {
      return "in-progress";
    }
    if (
      s === "completed_pending_review" ||
      s === "approved" ||
      s === "completed" ||
      s === "finished"
    ) {
      return "finished";
    }
    if (s === "cancelled" || s === "abandoned") {
      return "cancelled";
    }
    return "unknown";
  }

  // Legacy records without an explicit status field:
  // If approvedAt is present, a physician has reviewed and closed the encounter
  if (approvedAt) {
    const normApp = normalizeIsoTimestamp(approvedAt);
    if (normApp) return "finished";
  }

  return "unknown";
}

/**
 * Normalizes any valid date string, Date object, or timestamp with offset (+05:30)
 * into a canonical ISO-8601 UTC representation (Z).
 *
 * Returns fallback if input is missing or invalid.
 * Never invents current system time (new Date()) if both input and fallback are invalid.
 */
export function normalizeIsoTimestamp(
  ts?: string | Date | null,
  fallback?: string | Date | null
): string {
  if (ts !== undefined && ts !== null && ts !== "") {
    const d = typeof ts === "string" ? new Date(ts) : ts;
    if (!isNaN(d.getTime())) {
      return d.toISOString();
    }
  }

  if (fallback !== undefined && fallback !== null && fallback !== "") {
    const fb = typeof fallback === "string" ? new Date(fallback) : fallback;
    if (!isNaN(fb.getTime())) {
      return fb.toISOString();
    }
  }

  return "";
}

/**
 * Calculates Encounter.period ({ start, end }) based on real clinical interaction timestamps
 * and authoritative consultation lifecycle status.
 *
 * Clinical Invariants:
 * 1. approvedAt is a clinician sign-off timestamp and must NOT be used as the encounter interaction end.
 * 2. Active encounters (in-progress) or unfinished encounters (unknown, cancelled) must strictly
 *    OMIT period.end, regardless of how many dialogue turns or acoustic measurements have occurred.
 * 3. Completed encounters (finished) emit period.end spanning to the latest reliable confirmed interaction
 *    event only when one is available. If no reliable end can be established, period.end is omitted.
 * 4. Never fabricates a zero-length duration by defaulting end to start.
 */
export function calculateEncounterPeriod(params: EncounterPeriodParams): {
  start: string;
  end?: string;
} {
  const normCreated = normalizeIsoTimestamp(params.createdAt);

  const eventTimestamps: number[] = [];

  if (params.deliveredTurnRecords && Array.isArray(params.deliveredTurnRecords)) {
    for (const turn of params.deliveredTurnRecords) {
      if (turn.timestamp) {
        const t = new Date(turn.timestamp).getTime();
        if (!isNaN(t)) eventTimestamps.push(t);
      }
      if (turn.audioDeliveryResult?.confirmedAt) {
        const ct = new Date(turn.audioDeliveryResult.confirmedAt).getTime();
        if (!isNaN(ct)) eventTimestamps.push(ct);
      }
    }
  }

  if (params.audioMetricsHistory && Array.isArray(params.audioMetricsHistory)) {
    for (const audio of params.audioMetricsHistory) {
      if (audio.timestamp) {
        const t = new Date(audio.timestamp).getTime();
        if (!isNaN(t)) eventTimestamps.push(t);
      }
    }
  }

  let startTimeStr = normCreated;
  if (eventTimestamps.length > 0) {
    const minEventTime = Math.min(...eventTimestamps);
    if (!normCreated) {
      startTimeStr = new Date(minEventTime).toISOString();
    } else {
      const createdTime = new Date(normCreated).getTime();
      startTimeStr = new Date(Math.min(createdTime, minEventTime)).toISOString();
    }
  }

  const fhirStatus = mapEncounterStatus(params.status, params.approvedAt);

  let endTimeStr: string | undefined = undefined;

  // Clinical Invariant (Finding 8 Lifecycle Correction):
  // 1. For active or unfinished encounters (in-progress, unknown, cancelled),
  //    omit period.end, regardless of how many turns or audio measurements exist.
  // 2. For completed encounters ("finished"), use the latest reliable interaction-end
  //    event only when one is available. If no reliable end event exists, omit period.end.
  if (fhirStatus === "finished" && eventTimestamps.length > 0) {
    const maxEventTime = Math.max(...eventTimestamps);
    endTimeStr = new Date(maxEventTime).toISOString();
  }

  return {
    start: startTimeStr || new Date(0).toISOString(),
    ...(endTimeStr ? { end: endTimeStr } : {}),
  };
}

/**
 * Resolves acoustic temporal representation.
 *
 * Clinical Refinement 2:
 * For multi-turn cumulative telemetry, emits Observation.effectivePeriod spanning
 * earliest to latest measurement ingest timestamp.
 * For single-turn telemetry, emits Observation.effectiveDateTime.
 */
export function resolveAcousticTemporalSpan(
  history?: TurnAudioMetricRecord[],
  fallback?: string | Date | null
): AcousticTemporalSpan {
  if (history && Array.isArray(history) && history.length > 0) {
    const validTimestamps = history
      .map((h) => ({
        timestamp: h.timestamp,
        timeMs: new Date(h.timestamp).getTime(),
      }))
      .filter((h) => !isNaN(h.timeMs))
      .sort((a, b) => a.timeMs - b.timeMs);

    if (validTimestamps.length >= 2) {
      return {
        isMultiTurn: true,
        effectivePeriod: {
          start: new Date(validTimestamps[0].timeMs).toISOString(),
          end: new Date(validTimestamps[validTimestamps.length - 1].timeMs).toISOString(),
        },
      };
    } else if (validTimestamps.length === 1) {
      return {
        isMultiTurn: false,
        effectiveDateTime: new Date(validTimestamps[0].timeMs).toISOString(),
      };
    }
  }

  const fallbackNorm = normalizeIsoTimestamp(fallback);
  return {
    isMultiTurn: false,
    effectiveDateTime: fallbackNorm || undefined,
  };
}

/**
 * Extracts approximate narrative onset (e.g. "~2 days", "3 hours ago") from clinical text.
 * Returns undefined if no narrative duration/onset is present.
 *
 * Clinical Refinement (F8-04):
 * Requires clear temporal language indicating symptom onset or duration.
 * Strictly excludes medication frequencies ("every 8 hours") and routine activity durations ("walked 30 minutes").
 */
export function extractNarrativeOnset(text?: string): string | undefined {
  if (!text) return undefined;

  const lower = text.toLowerCase();

  // Negative exclusion checks for medication dosing and routine activity durations
  const isMedicationFrequency =
    /\b(?:every|each)\s+\d+\s*(?:minute|hour|day|week|month)s?\b/i.test(lower) ||
    /\b(?:take|taken|taking|dose|dosing|pill|tablet|capsule|medication|medicine)\s+(?:every|each|\d+\s*times)\b/i.test(lower);

  const isRoutineActivity =
    /\b(?:walk(?:ed)?|sleep|slept|rest(?:ed)?|wait(?:ed)?|ran|run|exercis(?:ed)?)\s+for\s+\d+\s*(?:minute|hour|day)s?\b/i.test(lower);

  if (isMedicationFrequency || isRoutineActivity) {
    // Only permit extraction if there is an explicit symptom onset verb elsewhere in the text
    const explicitOnsetMatch = text.match(/(?:started|began|onset)\s+(?:about|approximately|~)?\s*\d+\s*(?:minute|hour|day|week|month)s?\s+ago/i);
    if (explicitOnsetMatch) {
      return explicitOnsetMatch[0].trim();
    }
    return undefined;
  }

  // Positive onset / duration patterns
  const patterns = [
    // "started 2 hours ago", "began 3 days ago", "onset ~2 days ago"
    /(?:started|began|onset)\s+(?:about|approximately|~)?\s*\d+\s*(?:minute|hour|day|week|month)s?\s+ago/i,
    // "about 2 hours ago", "3 days ago", "1 week ago"
    /(?:about|approximately|~)?\s*\d+\s*(?:minute|hour|day|week|month)s?\s+ago/i,
    // "for 3 days", "for about 2 hours", "for ~2 days" (symptom duration)
    /\bfor\s+(?:about|approximately|~)?\s*\d+\s*(?:minute|hour|day|week|month)s?(?:\s+now)?\b/i,
    // "since yesterday", "since this morning", "since 2 days ago"
    /\bsince\s+(?:yesterday|this morning|last night|\d+\s*(?:days?|weeks?|months?)\s*ago|\w+\s*(?:morning|afternoon|evening))\b/i,
    // "symptoms began yesterday", "pain started this morning"
    /(?:started|began|onset)\s+(?:yesterday|this morning|last night)/i,
    // "~2 days duration", "duration: 3 days"
    /(?:duration[:\s]+)?(?:about|approximately|~)?\s*\d+\s*(?:minute|hour|day|week|month)s?\s+duration\b/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[0].trim();
    }
  }
  return undefined;
}

export interface TriageTimestampParams {
  deliveredTurnRecords?: DeliveredTurnRecord[];
  createdAt?: string | Date | null;
  triageLevel?: string;
  esiScore?: number;
}

/**
 * Resolves the clinically authentic timestamp for an ESI triage assessment.
 *
 * Clinical Invariant (F8-03):
 * Triage assessment timing reflects when the clinical acuity was evaluated or escalated
 * (e.g. EMERGENCY_ESCALATION or CONVENE_BOARD turn actions).
 * It never assumes Turn 1 or an unrelated closing turn was the assessment event.
 * If no reliable assessment or escalation event timestamp exists in the record lifecycle,
 * returns undefined so the optional FHIR Observation.effectiveDateTime field can be omitted
 * without fabricating precision.
 */
export function resolveTriageAssessmentTimestamp(params: TriageTimestampParams): string | undefined {
  const { deliveredTurnRecords } = params;

  if (deliveredTurnRecords && Array.isArray(deliveredTurnRecords) && deliveredTurnRecords.length > 0) {
    // 1. Look for explicit emergency escalation or board convening turn
    const escalationTurn = deliveredTurnRecords.find(
      (t) =>
        t.conversationalAction === "EMERGENCY_ESCALATION" ||
        t.conversationalAction === "CONVENE_BOARD"
    );
    if (escalationTurn?.timestamp) {
      const norm = normalizeIsoTimestamp(escalationTurn.timestamp);
      if (norm) return norm;
    }
  }

  // When no dedicated assessment or escalation event timestamp exists, omit rather than invent precision.
  return undefined;
}

/**
 * Decouples Condition recordedDate from clinical onset[x].
 *
 * Clinical Refinement 3:
 * Condition.recordedDate represents when MedVoice first documented the condition in the encounter.
 * Condition.onset[x] represents when the patient developed symptoms:
 * - If narrative onset exists, emits onsetString.
 * - Never emits turn recording timestamp as onsetDateTime.
 */
export function resolveConditionTemporal(params: {
  code: string;
  display?: string;
  attributedFacts?: AttributedClinicalFactV3[];
  deliveredTurnRecords?: DeliveredTurnRecord[];
  timelineNarrative?: string;
  fallbackTimestamp?: string;
}): {
  recordedDate: string;
  onsetString?: string;
} {
  const { code, display, attributedFacts, deliveredTurnRecords, timelineNarrative, fallbackTimestamp } = params;

  let recordedDate: string | undefined = undefined;
  let onsetString: string | undefined = undefined;

  // 1. Look for matching attributed clinical fact
  if (attributedFacts && Array.isArray(attributedFacts) && attributedFacts.length > 0) {
    const cleanCode = code.toLowerCase().replace(/[^a-z0-9]/g, "");
    const cleanDisplay = (display || "").toLowerCase();

    const matchedFact =
      attributedFacts.find((f) => {
        const c = (f.concept || "").toLowerCase().replace(/[^a-z0-9]/g, "");
        const words = (f.concept || "").toLowerCase().split(/[_\s]+/);
        return (
          c.includes(cleanCode) ||
          cleanCode.includes(c) ||
          (cleanDisplay && words.some((w) => w.length > 3 && cleanDisplay.includes(w)))
        );
      }) || attributedFacts[0]; // Fall back to primary finding if concept token matching is ambiguous

    if (matchedFact) {
      if (matchedFact.timestamp) {
        recordedDate = normalizeIsoTimestamp(matchedFact.timestamp);
      } else if (matchedFact.turnId && deliveredTurnRecords) {
        const turn = deliveredTurnRecords.find((t) => t.turnId === matchedFact.turnId);
        if (turn?.timestamp) {
          recordedDate = normalizeIsoTimestamp(turn.timestamp);
        }
      }

      if (matchedFact.sourceUtterance) {
        onsetString = extractNarrativeOnset(matchedFact.sourceUtterance);
      }
    }
  }

  // 2. Check timeline narrative if onsetString not yet found
  if (!onsetString && timelineNarrative) {
    onsetString = extractNarrativeOnset(timelineNarrative);
  }

  // 3. Fallback recordedDate
  if (!recordedDate) {
    recordedDate = normalizeIsoTimestamp(fallbackTimestamp);
  }

  return {
    recordedDate: recordedDate || new Date(0).toISOString(),
    ...(onsetString ? { onsetString } : {}),
  };
}
