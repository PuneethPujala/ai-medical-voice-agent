/**
 * PROVENANCE-TRACKED CLINICAL FACT CONTRACT & STATE TYPES
 *
 * Invariants:
 * 1. Dual-Structure: Current Clinical View (latest valid facts by concept and temporal scope)
 *    + Append-Only Fact Ledger (immutable chronological audit trail of all assertions,
 *    clarifications, retractions, and corrections).
 * 2. Multi-Temporal Concept Support: A single concept (e.g. headache_severity) can have
 *    distinct temporal scopes (e.g. baseline: mild for 2 days vs acute_worsening: 10/10 for 1 hr).
 * 3. Non-Destructive Corrections: Corrections append new records referencing supersedesFactId,
 *    never rewriting or destroying history.
 * 4. Acoustic Truth & Uncertainty: If an utterance is ambiguous or non-binary, fact assertion
 *    is marked "uncertain" with recorded rationale, never forced into binary pigeonholes.
 */

export type FactAssertionStatus = "present" | "absent" | "uncertain";

export type FactTemporalScope = "current" | "acute_worsening" | "historical" | "baseline";

export type FactSource =
  | "patient_reported"
  | "clinician_reported"
  | "device_measured"
  | "ai_inferred"
  | "pre_arbiter";

export const FACT_PROVENANCE_RANKS: Record<FactSource, number> = {
  device_measured: 5,
  clinician_reported: 4,
  pre_arbiter: 4,
  patient_reported: 3,
  ai_inferred: 1,
};

export interface ClinicalFactRecord {
  id: string;
  concept: string;                       // e.g. "headache_severity", "headache_onset_pattern", "chest_tightness"
  value: unknown;                        // e.g. "gradual", "sudden", "8/10", "dull", true
  assertionStatus: FactAssertionStatus;
  temporalScope: FactTemporalScope;
  source: FactSource;
  sourceTurnId: number;
  timestamp: string;                     // ISO-8601
  isCorrection: boolean;
  supersedesFactId?: string;             // References earlier fact if this is an explicit correction
  supersededByTurn?: number;             // Recorded when an active fact is superseded by a correction
  supersededByFactId?: string;           // References the correction fact that superseded this record
  contradictsFactId?: string;            // References conflicting fact if unverified discrepancy
  rawSnippet?: string;                   // Patient utterance excerpt for clinical auditability
  clinicalRationale?: string;
}

export interface FactProposal {
  concept: string;
  value: unknown;
  assertionStatus: FactAssertionStatus;
  temporalScope?: FactTemporalScope;     // Defaults to "current" if omitted
  confidence?: number;
  isCorrection?: boolean;
  supersedesFactId?: string;
  rawSnippet?: string;
  clinicalRationale?: string;
  uncertaintyReason?: string;
}

export interface CurrentClinicalView {
  primaryComplaint?: ClinicalFactRecord;
  factsByConcept: Record<string, ClinicalFactRecord[]>; // Array to preserve multiple temporal scopes per concept
  activeUncertainties: Array<{
    concept: string;
    description: string;
    turnId: number;
    patientUtterance?: string;
  }>;
  contradictions: Array<{
    concept: string;
    factAId: string;
    factBId: string;
    description: string;
    requiresClarification: boolean;
  }>;
}

export interface ConversationContextState {
  caseVersion: number;
  turnCount: number;
  currentView: CurrentClinicalView;
  ledger: ClinicalFactRecord[];          // Append-only audit trail
  unresolvedGoals: string[];             // High-yield clinical goals remaining
  activeFocus: {
    primarySymptom: string;
    lastDiscussedConcept?: string;
    pendingQuestion?: {
      targetConcept: string;
      questionAsked: string;
      turnId: number;
      requiresPatientConfirmation?: boolean;
    };
  };
}

export function createInitialClinicalView(): CurrentClinicalView {
  return {
    factsByConcept: {},
    activeUncertainties: [],
    contradictions: [],
  };
}

export function createInitialConversationContextState(): ConversationContextState {
  return {
    caseVersion: 1,
    turnCount: 0,
    currentView: createInitialClinicalView(),
    ledger: [],
    unresolvedGoals: [
      "chief_complaint",
      "onset_and_timeline",
      "severity_and_character",
      "associated_symptoms",
      "red_flag_screening",
    ],
    activeFocus: {
      primarySymptom: "",
    },
  };
}
