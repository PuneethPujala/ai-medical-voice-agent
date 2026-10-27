/**
 * Longitudinal Patient Context & Temporal Fact Contract
 *
 * Defines structured, time-aware patient observations recorded across clinical encounters.
 * Governs life-cycle state transitions, provenance, verification, and baseline superseding.
 */

export type FactLifecycle =
  | "active"
  | "superseded"
  | "retracted"
  | "entered_in_error";

export type FactVerification =
  | "unverified"
  | "patient_confirmed"
  | "clinician_confirmed";

export type FactCategory =
  | "lifestyle_sleep"
  | "functional_mobility"
  | "vital_reading"
  | "symptom_baseline";

export type TemporalScope = "baseline" | "episodic";

export type SourceType = "patient" | "caregiver" | "clinician" | "device";

export interface LongitudinalPatientFact {
  id: string;
  userId: string;
  patientProfileId: string;

  category: FactCategory;
  concept: string; // Normalized clinical concept, e.g. "usual_sleep_duration"
  reportedValue: string; // Patient-stated value, e.g. "5 hours"
  numericValue?: number | null; // Normalized numeric scalar, e.g. 5
  unit?: string | null; // e.g. "hours/night"

  temporalScope: TemporalScope;
  lifecycle: FactLifecycle;
  verification: FactVerification;

  sourceType: SourceType;
  sourceConsultationId: string;
  sourceTurnId: string;

  reportedAt: string; // ISO 8601: When observation occurred / was stated
  recordedAt: string; // ISO 8601: When datastore committed the record
  lastReviewedAt?: string | null;

  supersedesFactId?: string | null;
  supersededByFactId?: string | null;
  supersededAt?: string | null;
}

export interface RecordFactParams {
  patientProfileId: string;
  category: FactCategory;
  concept: string;
  reportedValue: string;
  numericValue?: number | null;
  unit?: string | null;
  temporalScope: TemporalScope;
  sourceType?: SourceType;
  sourceConsultationId: string;
  sourceTurnId: string;
  reportedAt?: string;
  verification?: FactVerification;
}

export interface SupersedeFactParams extends RecordFactParams {
  targetFactId?: string; // Optional: specify target fact ID to supersede, otherwise matches on active baseline concept
}

export interface RetractFactParams {
  patientProfileId: string;
  factId: string;
  reason?: string;
  enteredInError?: boolean;
}

export interface QueryFactsOptions {
  category?: FactCategory;
  lifecycle?: FactLifecycle;
  temporalScope?: TemporalScope;
  includeHistory?: boolean;
}
