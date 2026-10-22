export type AuthorityTier =
  | "deterministic_safety"
  | "clinical_guideline"
  | "national_guideline"
  | "government_reference"
  | "medication_label"
  | "medication_identity"
  | "regulatory_adverse"
  | "peer_reviewed_evidence";

export type ClinicalSection =
  | "overview"
  | "symptoms"
  | "emergency_guidance"
  | "diagnosis"
  | "treatment"
  | "risk_factors"
  | "prevention"
  | "contraindications"
  | "interactions"
  | "adverse_events"
  | "management"
  | "referral";

export type ClinicalDomain =
  | "cardiology"
  | "neurology"
  | "pediatrics"
  | "medications"
  | "gastroenterology"
  | "pulmonology"
  | "endocrinology"
  | "infectious_disease"
  | "obstetrics_gynecology"
  | "orthopedics"
  | "dermatology"
  | "psychiatry"
  | "ent"
  | "emergency_medicine"
  | "general";

export type PopulationTag =
  | "neonate"
  | "infant"
  | "pediatric"
  | "adolescent"
  | "adult"
  | "older_adult"
  | "pregnant";

export type AcuityLevel = "emergent" | "urgent" | "routine" | "preventive";

export interface ClinicalPassage {
  id: string;
  topicId: string;
  title: string;
  section: ClinicalSection;
  source: string;
  sourceUrl?: string;
  releaseDate: string;
  authority: AuthorityTier;
  domain: ClinicalDomain;
  content: string;
  keyTerms: string[];
  relevanceScore?: number;

  // Population & context metadata (Phase 1)
  population?: PopulationTag[];
  acuity?: AcuityLevel[];
  conditions?: string[];
  country?: string;
  language?: string;
  sourceType?: "clinical_guideline" | "government_reference" | "drug_label" | "adverse_event_report" | "systematic_review" | "textbook";
  version?: string;
  reviewedAt?: string;
  reviewerSignoff?: string;
  licensingProvenance?: string;
}

export interface KnowledgeContext {
  retrievedAt: string;
  query: string;
  domain: ClinicalDomain;
  passages: ClinicalPassage[];
  authorityHierarchyApplied: boolean;
  patientContextApplied?: boolean;
}

export type MedicationTaskType = "identity" | "contraindication" | "adverse_event";

export interface MedicationQueryResult {
  task: MedicationTaskType;
  primarySource: "RxNorm" | "DailyMed" | "openFDA";
  drugName: string;
  findings: string[];
  passages: ClinicalPassage[];
}

// ─── PATIENT PROFILE ───────────────────────────────────────────────────────────

export interface PatientMedication {
  name: string;
  brandName?: string;
  rxcui?: string;
  dose?: string;
  frequency?: string;
  route?: string;
  startDate?: string;
}

export type AllergyStatus = "unassessed" | "none_known" | "confirmed";

export interface DrugAllergy {
  drugName: string;
  drugClass?: string;
  rxcui?: string;
  reactionType: "allergy" | "intolerance" | "adverse_reaction";
  severity: "mild" | "moderate" | "severe" | "anaphylaxis";
  reactionDescription?: string;
  verificationStatus?: "patient_reported" | "verified";
  lastConfirmedAt?: string;
}

export interface PatientProfile {
  id: string;
  name?: string;
  userId?: string;
  relationshipToUser?: "self" | "child" | "parent" | "spouse" | "other";
  language?: string;

  // Demographics
  yearOfBirth?: number;
  dateOfBirth?: string;
  age?: number;
  ageMonths?: number;
  ageGroup?: PopulationTag;
  sexAssignedAtBirth?: "male" | "female" | "intersex";
  gender?: "male" | "female" | "other";
  pregnancyStatus?: "pregnant" | "not_pregnant" | "unknown" | "not_applicable";
  pregnancy?: {
    isPregnant: boolean;
    gestationalWeeks?: number;
  };

  // Medical history
  knownConditions?: string[];
  conditions?: string[];
  currentMedications?: PatientMedication[];
  medications?: any[];
  allergyStatus?: AllergyStatus;
  drugAllergies?: DrugAllergy[];
  allergies?: any[];
  surgicalHistory?: string[];

  // Lifestyle & Vitals
  smokingStatus?: "current" | "former" | "never" | "unknown";
  bloodGroup?: string;
  clinicalNotes?: string;

  // Emergency & Accessibility (Optional)
  emergencyContact?: {
    name?: string;
    phone?: string;
    relationship?: string;
  };
  accessibilityPreferences?: {
    communicationStyle?: string;
    visualAccommodations?: boolean;
    hearingAccommodations?: boolean;
    notes?: string;
  };

  // DPDP Privacy Compliance
  consentGiven?: boolean;
  consentTimestamp?: string;
  isDeleted?: boolean;

  // Metadata
  createdAt?: string;
  updatedAt?: string;
}

export interface ContraindicationAlert {
  category:
    | "allergy"
    | "drug_interaction"
    | "pregnancy"
    | "pediatric_warning"
    | "condition_contraindication"
    | "unknown_substance"
    | "duplicate_therapy";
  triggerItem: string;
  conflictingItem: string;
  severity: "critical" | "warning" | "review_needed";
  clinicalRationale: string;
  actionRequired: "block" | "warn" | "flag_for_review";
  evidenceSource?: {
    ruleId?: string;
    source: string;
    sourceUrl?: string;
    jurisdiction?: "India (CDSCO/MoHFW)" | "US (FDA/DailyMed)" | "Global (WHO/NLM)";
    retrievalDate?: string;
    limitations?: string;
  };
}

// ─── CURRENT ENCOUNTER ─────────────────────────────────────────────────────────

export interface CurrentEncounter {
  chiefComplaint?: string;
  onset?: string;
  duration?: string;
  location?: string;
  character?: string;
  severity?: string;
  associatedSymptoms: string[];
  exposures: string[];
  recentMedications: string[];
}

// ─── CONTEXT-AWARE QUERY ───────────────────────────────────────────────────────

export interface ContextAwareQuery {
  query: string;
  domain?: ClinicalDomain;
  patient?: PatientProfile;
  encounter?: CurrentEncounter;
  targetSection?: ClinicalSection;
  topK?: number;
  minScore?: number;
}

// ─── 3-TIER CONTEXT: CALLER PROFILE & ATTRIBUTED FACTS ───────────────────────

export interface CallerProfile {
  id: string;
  name?: string;
  relationshipToPatient: "self" | "child" | "parent" | "spouse" | "caregiver" | "third_party";
  authorizedPatientIds?: string[];
  preferredLanguage?: string;
  telephonyMetadata?: {
    callerId?: string;
    channel?: string;
  };
  consentGiven?: boolean;
  consentTimestamp?: string;
}

export type FactAssertionStatus = "present" | "absent" | "uncertain";
export type FactVerificationStatus = "unverified" | "clinician_confirmed" | "device_verified";
export type FactTemporalScope = "current" | "historical" | "unknown";
export type FactSource = "patient_reported" | "caregiver_reported" | "device_measured" | "clinician" | "ai_inferred";

export interface CandidateFactProposal {
  concept: string;
  assertionStatus: FactAssertionStatus;
  subjectReference: "self" | "mother" | "father" | "child" | "spouse" | "caregiver" | "other";
  temporalScope?: FactTemporalScope;
  notes?: string;
}

export interface AttributedClinicalFact {
  id: string;
  targetPatientId: string;       // Assigned strictly by server after resolving subjectReference
  reporterId: string;            // Assigned strictly by server from caller session
  concept: string;               // Clinical concept (e.g. "diabetes", "dark_urine")
  assertionStatus: FactAssertionStatus;
  verificationStatus: FactVerificationStatus;
  temporalScope: FactTemporalScope;
  source: FactSource;
  turnId: number;
  timestamp: string;
  provenanceDetails?: {
    reliability: "high" | "moderate" | "low";
    clinicalType: "objective_vital" | "subjective_symptom" | "observed_behavior" | "historical_record";
    resolutionRationale?: string;
  };
  value?: any;
  normalizedText?: string;
  confidence?: number;
  requiresReconfirmation?: boolean;
  notes?: string;
}

export type ConversationalAction =
  | "INQUIRE"
  | "ANSWER_QUESTION"
  | "ACKNOWLEDGE_CORRECTION"
  | "EXPLAIN_CLINICAL_RATIONALE"
  | "SUMMARIZE_AND_CHECK"
  | "EMERGENCY_DIRECTIVE"
  | "PROVIDE_SUPPORT"
  | "CONVENE_BOARD";

export interface ServerTurnTelemetry {
  provider: "groq" | "nvidia" | "fallback" | "safety_arbiter_deterministic";
  model: string;
  responseProvenance?: "llm_generative_dialogue" | "validated_fallback" | "deterministic_safety_arbiter";
  liveGenerated: boolean;
  latencyMs: number;
  fallbackUsed: boolean;
  fallbackReason?: string;
  telemetryIntegrityHash: string;
  timestamp: string;
}

/**
 * Calculates patient age dynamically from Date of Birth (DOB) at turn execution.
 * Prevents stale age drift across encounters.
 */
export function calculateAgeFromDOB(
  dobString: string,
  referenceDate: Date = new Date()
): { years: number; months: number; totalMonths: number } {
  const birthDate = new Date(dobString);
  if (isNaN(birthDate.getTime())) {
    return { years: 0, months: 0, totalMonths: 0 };
  }

  let years = referenceDate.getFullYear() - birthDate.getFullYear();
  let months = referenceDate.getMonth() - birthDate.getMonth();
  const days = referenceDate.getDate() - birthDate.getDate();

  if (days < 0) {
    months--;
  }

  if (months < 0) {
    years--;
    months += 12;
  }

  const totalMonths = Math.max(0, years * 12 + months);
  return {
    years: Math.max(0, years),
    months: Math.max(0, months),
    totalMonths,
  };
}

