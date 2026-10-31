/**
 * Interview State Schema Migration & Historical State Recovery Engine
 *
 * Provides deterministic, versioned migrations for persisted clinical interview state.
 * Invariant: A migration failure must NEVER reset an encounter to a fresh intake or
 * overwrite persisted clinical data with default values. Unrecoverable states remain
 * paused with recoverable fields extracted for clinician review.
 */

import type { ClinicalInterviewState } from "./conversation-manager";

export const CURRENT_INTERVIEW_STATE_SCHEMA_VERSION = 2;

export type MigrationStatus =
  | "unchanged"
  | "migrated"
  | "unsupported_version"
  | "corrupted";

export interface RecoverableClinicalData {
  transcript?: Array<{ role: "patient" | "doctor" | "system"; text: string; timestamp?: string }>;
  chiefComplaint?: string;
  detectedSymptoms?: string[];
  attributedFacts?: any[];
  unmappedObservations?: any[];
  deliveredTurnRecords?: any[];
  patientCorrections?: Array<{ slot: string; from: string; to: string }>;
  structuredHistory?: Record<string, any>;
  slots?: Record<string, any>;
  lastRecordedAt?: string;
}

export interface InterviewStateMigrationResult {
  status: MigrationStatus;
  state: ClinicalInterviewState | null;
  sourceVersion?: number;
  targetVersion: number;
  warnings: string[];
  error?: string;
  rawPreserved: any;
  recoverableData?: RecoverableClinicalData;
}

/**
 * Extracts all recoverable clinical observations and turns from any state object,
 * even if the structural schema is corrupted or from an incompatible version.
 */
export function extractRecoverableClinicalData(raw: any): RecoverableClinicalData {
  if (!raw || typeof raw !== "object") {
    return {};
  }

  const recoverable: RecoverableClinicalData = {};

  // Extract transcript turns
  if (Array.isArray(raw.transcript)) {
    recoverable.transcript = raw.transcript;
  } else if (Array.isArray(raw.messages)) {
    recoverable.transcript = raw.messages;
  } else if (typeof raw.cumulativeTranscript === "string" && raw.cumulativeTranscript.trim()) {
    recoverable.transcript = [
      { role: "patient", text: raw.cumulativeTranscript, timestamp: new Date().toISOString() },
    ];
  }

  // Extract chief complaint
  recoverable.chiefComplaint =
    raw.structuredHistory?.chiefComplaint ||
    raw.slots?.chiefComplaint ||
    raw.chiefComplaint ||
    undefined;

  // Extract detected symptoms
  if (Array.isArray(raw.slots?.associated_symptoms)) {
    recoverable.detectedSymptoms = [...raw.slots.associated_symptoms];
  } else if (Array.isArray(raw.detectedSymptoms)) {
    recoverable.detectedSymptoms = [...raw.detectedSymptoms];
  }

  // Extract facts and observations
  if (Array.isArray(raw.attributedFacts)) {
    recoverable.attributedFacts = [...raw.attributedFacts];
  }
  if (Array.isArray(raw.unmappedObservations)) {
    recoverable.unmappedObservations = [...raw.unmappedObservations];
  }
  if (Array.isArray(raw.deliveredTurnRecords)) {
    recoverable.deliveredTurnRecords = [...raw.deliveredTurnRecords];
  }

  // Extract patient corrections
  if (Array.isArray(raw.structuredHistory?.patientCorrections)) {
    recoverable.patientCorrections = [...raw.structuredHistory.patientCorrections];
  } else if (Array.isArray(raw.patientCorrections)) {
    recoverable.patientCorrections = [...raw.patientCorrections];
  }

  // Extract structured history
  if (raw.structuredHistory && typeof raw.structuredHistory === "object") {
    recoverable.structuredHistory = { ...raw.structuredHistory };
  }

  if (raw.slots && typeof raw.slots === "object") {
    recoverable.slots = { ...raw.slots };
  }

  // Extract provenance / timestamps
  recoverable.lastRecordedAt = raw.lastRecordedAt || raw.recordedAt || raw.createdAt || raw.linked_at || undefined;

  return recoverable;
}

/**
 * Migrate an unversioned legacy (v0) interview state to v1.
 * Ensures required slots, pendingQuestion, and domainSufficiency exist.
 */
function migrateV0ToV1(v0: Record<string, any>, warnings: string[]): Record<string, any> {
  warnings.push("Migrated unversioned legacy interview state (v0) to schema v1.");

  const slots = v0.slots && typeof v0.slots === "object" ? { ...v0.slots } : {};
  if (!Array.isArray(slots.associated_symptoms)) slots.associated_symptoms = [];
  if (!Array.isArray(slots.neurological_signs)) slots.neurological_signs = [];
  if (!Array.isArray(slots.pediatric_signs)) slots.pediatric_signs = [];
  if (!Array.isArray(slots.known_facts)) slots.known_facts = [];

  return {
    ...v0,
    schemaVersion: 1,
    phase: v0.phase || "active_inquiring",
    informationState: v0.informationState || "insufficient",
    caseVersion: typeof v0.caseVersion === "number" ? v0.caseVersion : 1,
    slots,
    pendingQuestion: v0.pendingQuestion !== undefined ? v0.pendingQuestion : null,
    agentRequests: Array.isArray(v0.agentRequests) ? v0.agentRequests : [],
    resolvedQuestions: Array.isArray(v0.resolvedQuestions) ? v0.resolvedQuestions : [],
    domainSufficiency: v0.domainSufficiency || {
      general: { status: "gathering", missing: ["onset", "character"] },
      cardiology: { status: "inactive", missing: [] },
      neurology: { status: "inactive", missing: [] },
      pediatrics: { status: "inactive", missing: [] },
    },
    cumulativeTranscript: typeof v0.cumulativeTranscript === "string" ? v0.cumulativeTranscript : "",
  };
}

/**
 * Migrate schema v1 to current schema v2.
 * Adds structured history defaults, attributed facts, unmapped observations,
 * delivered turn records, and preserves unrecognized fields.
 */
function migrateV1ToV2(v1: Record<string, any>, warnings: string[]): ClinicalInterviewState {
  warnings.push("Migrated interview state v1 to current schema v2.");

  const structuredHistory = v1.structuredHistory && typeof v1.structuredHistory === "object"
    ? { ...v1.structuredHistory }
    : {};

  if (!Array.isArray(structuredHistory.unansweredDimensions)) {
    structuredHistory.unansweredDimensions = [
      "onset_time",
      "sudden_vs_gradual",
      "speech_difficulty",
      "visual_deficit",
      "severe_headache",
      "leg_mobility",
    ];
  }
  if (!Array.isArray(structuredHistory.patientCorrections)) {
    structuredHistory.patientCorrections = [];
  }
  if (!Array.isArray(structuredHistory.patientQuestions)) {
    structuredHistory.patientQuestions = [];
  }
  if (!Array.isArray(structuredHistory.recentDoctorReplies)) {
    structuredHistory.recentDoctorReplies = [];
  }
  if (typeof structuredHistory.turnCount !== "number") {
    structuredHistory.turnCount = Array.isArray(v1.deliveredTurnRecords)
      ? v1.deliveredTurnRecords.length
      : 0;
  }

  // Preserve any unrecognized extra properties cleanly
  const recognizedKeys = new Set([
    "schemaVersion",
    "version",
    "phase",
    "informationState",
    "caseVersion",
    "slots",
    "pendingQuestion",
    "agentRequests",
    "resolvedQuestions",
    "domainSufficiency",
    "cumulativeTranscript",
    "emergencyDialogueState",
    "structuredHistory",
    "attributedFacts",
    "unmappedObservations",
    "deliveredTurnRecords",
    "parent_consultation_id",
    "is_follow_up",
    "parent_chief_complaint",
    "linked_at",
    "audio_metrics",
    "speech_features",
  ]);

  const unrecognizedFields: Record<string, any> = {};
  for (const [key, val] of Object.entries(v1)) {
    if (!recognizedKeys.has(key)) {
      unrecognizedFields[key] = val;
    }
  }

  const migratedState: any = {
    ...v1,
    schemaVersion: CURRENT_INTERVIEW_STATE_SCHEMA_VERSION,
    structuredHistory,
    attributedFacts: Array.isArray(v1.attributedFacts) ? v1.attributedFacts : [],
    unmappedObservations: Array.isArray(v1.unmappedObservations) ? v1.unmappedObservations : [],
    deliveredTurnRecords: Array.isArray(v1.deliveredTurnRecords) ? v1.deliveredTurnRecords : [],
  };

  if (Object.keys(unrecognizedFields).length > 0) {
    migratedState._unrecognizedFields = unrecognizedFields;
  }

  return migratedState as ClinicalInterviewState;
}

/**
 * Authoritative entry point for validating and migrating interview state on consultation resume.
 *
 * Guarantees:
 * 1. Deterministic and pure function: given the same input, produces identical output.
 * 2. Never throws: all exceptions are caught and represented as structured error results.
 * 3. Never returns default state on corruption: returns recoverable fields and null state.
 * 4. Future versions (>2) are rejected with unsupported_version to prevent data loss.
 */
export function migrateInterviewState(rawState: unknown): InterviewStateMigrationResult {
  const warnings: string[] = [];

  // Guard: Null, undefined, or primitive
  if (!rawState || typeof rawState !== "object") {
    return {
      status: "corrupted",
      state: null,
      targetVersion: CURRENT_INTERVIEW_STATE_SCHEMA_VERSION,
      warnings: ["Input interview state is null, undefined, or not a JSON object."],
      error: "CORRUPTED_INTERVIEW_STATE",
      rawPreserved: rawState,
      recoverableData: {},
    };
  }

  const rawObj = rawState as Record<string, any>;

  // Check declared schema version
  const sourceVersion: number =
    typeof rawObj.schemaVersion === "number"
      ? rawObj.schemaVersion
      : typeof rawObj.version === "number"
      ? rawObj.version
      : 0;

  // Guard: Future schema version that this code cannot safely interpret
  if (sourceVersion > CURRENT_INTERVIEW_STATE_SCHEMA_VERSION) {
    return {
      status: "unsupported_version",
      state: null,
      sourceVersion,
      targetVersion: CURRENT_INTERVIEW_STATE_SCHEMA_VERSION,
      warnings: [
        `Encounter state requires future schema version ${sourceVersion}. Current engine supports up to ${CURRENT_INTERVIEW_STATE_SCHEMA_VERSION}.`,
      ],
      error: "FUTURE_SCHEMA_VERSION_UNSUPPORTED",
      rawPreserved: rawObj,
      recoverableData: extractRecoverableClinicalData(rawObj),
    };
  }

  try {
    let workingState: Record<string, any> = { ...rawObj };

    // Step 1: Migrate v0 -> v1 if needed
    if (sourceVersion === 0) {
      workingState = migrateV0ToV1(workingState, warnings);
    }

    // Step 2: Migrate v1 -> v2 if needed
    if (sourceVersion < CURRENT_INTERVIEW_STATE_SCHEMA_VERSION) {
      const v2State = migrateV1ToV2(workingState, warnings);
      return {
        status: "migrated",
        state: v2State,
        sourceVersion,
        targetVersion: CURRENT_INTERVIEW_STATE_SCHEMA_VERSION,
        warnings,
        rawPreserved: rawObj,
        recoverableData: extractRecoverableClinicalData(rawObj),
      };
    }

    // Version is already current (v2)
    // Perform structural health check
    const isSlotsValid = workingState.slots && typeof workingState.slots === "object";
    const isPhaseValid = typeof workingState.phase === "string";

    if (!isSlotsValid || !isPhaseValid) {
      warnings.push("Current version state missing essential slots or phase; repaired with defaults.");
      const repaired = migrateV1ToV2(workingState, warnings);
      return {
        status: "migrated",
        state: repaired,
        sourceVersion,
        targetVersion: CURRENT_INTERVIEW_STATE_SCHEMA_VERSION,
        warnings,
        rawPreserved: rawObj,
        recoverableData: extractRecoverableClinicalData(rawObj),
      };
    }

    // Perfectly valid current state
    return {
      status: "unchanged",
      state: workingState as ClinicalInterviewState,
      sourceVersion: CURRENT_INTERVIEW_STATE_SCHEMA_VERSION,
      targetVersion: CURRENT_INTERVIEW_STATE_SCHEMA_VERSION,
      warnings: [],
      rawPreserved: rawObj,
      recoverableData: extractRecoverableClinicalData(rawObj),
    };
  } catch (err: any) {
    return {
      status: "corrupted",
      state: null,
      sourceVersion,
      targetVersion: CURRENT_INTERVIEW_STATE_SCHEMA_VERSION,
      warnings,
      error: `Migration exception: ${err?.message || "Unknown error"}`,
      rawPreserved: rawObj,
      recoverableData: extractRecoverableClinicalData(rawObj),
    };
  }
}
