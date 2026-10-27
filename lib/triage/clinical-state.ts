/**
 * CLINICAL INTERVIEW STATE & EVIDENCE MODEL
 *
 * Invariants:
 * 1. Normalized Clinical Facts: Facts have explicit status ("present" | "absent" | "unknown"),
 *    confidence, source, and turn ID. Utterances are NEVER stored directly as clinical facts.
 * 2. Deterministic Completeness: History completeness is computed via an explicit weighted formula,
 *    not an arbitrary AI heuristic.
 * 3. Separation of Completeness and Safety: Completeness measures information gathered.
 *    Safety evaluates unresolved life-threat red flags independently.
 * 4. 3-Layer Memory Architecture:
 *    - Layer 1: Raw conversational transcript.
 *    - Layer 2: Structured clinical state (present / absent / unknown).
 *    - Layer 3: Interview memory (asked, answered, denied, do-not-repeat, next-target).
 */
import {
  CallerProfile,
  PatientProfile,
  AttributedClinicalFact,
  FactAssertionStatus,
  FactVerificationStatus,
  FactTemporalScope,
  FactSource,
  calculateAgeFromDOB,
} from "../clinical-knowledge/types";

export type {
  CallerProfile,
  PatientProfile,
  AttributedClinicalFact,
  FactAssertionStatus,
  FactVerificationStatus,
  FactTemporalScope,
  FactSource,
};
export { calculateAgeFromDOB };

export type ClinicalFactStatus = "present" | "absent" | "unknown";
export type ClinicalFactSource =
  | "device"
  | "device_measured"
  | "clinician"
  | "patient"
  | "patient_reported"
  | "tool"
  | "tool_derived"
  | "inferred"
  | "ai_inferred"
  | "agent_inferred"
  | "pre_arbiter"
  | "deterministic_pre_arbiter"
  | "not_assessed";

/**
 * EVIDENCE PROVENANCE HIERARCHY
 * DEVICE_MEASURED (5) > CLINICIAN / PRE_ARBITER (4) > PATIENT_REPORTED (3) > TOOL_DERIVED (2) > AI_INFERRED (1) > NOT_ASSESSED (0)
 */
export const PROVENANCE_HIERARCHY: Record<string, number> = {
  device: 5,
  device_measured: 5,
  clinician: 4,
  pre_arbiter: 4,
  deterministic_pre_arbiter: 4,
  patient: 3,
  patient_reported: 3,
  tool: 2,
  tool_derived: 2,
  inferred: 1,
  ai_inferred: 1,
  agent_inferred: 1,
  not_assessed: 0,
};

export function getProvenanceRank(source?: string): number {
  if (!source) return 0;
  return PROVENANCE_HIERARCHY[source.toLowerCase()] ?? 1;
}

export function isHigherOrEqualProvenance(sourceA?: string, sourceB?: string): boolean {
  return getProvenanceRank(sourceA) >= getProvenanceRank(sourceB);
}

export interface FactContradictionResult {
  winner: ClinicalFact;
  loser?: ClinicalFact;
  hasContradiction: boolean;
  resolutionRationale?: string;
}

/**
 * Reconciles conflicting or competing clinical facts regarding the same slot/symptom.
 * 1. Provenance hierarchy (Device > Clinician > Patient > Tool > AI Inferred)
 * 2. Temporal precedence (later observation breaks ties)
 */
export function reconcileConflictingFacts(existingFact: ClinicalFact, newFact: ClinicalFact): FactContradictionResult {
  const statusConflict = (existingFact.status === "present" && newFact.status === "absent") ||
                         (existingFact.status === "absent" && newFact.status === "present");

  if (!statusConflict) {
    if (getProvenanceRank(newFact.source) >= getProvenanceRank(existingFact.source)) {
      return { winner: newFact, loser: existingFact, hasContradiction: false };
    }
    return { winner: existingFact, loser: newFact, hasContradiction: false };
  }

  const rankExisting = getProvenanceRank(existingFact.source);
  const rankNew = getProvenanceRank(newFact.source);

  if (rankNew > rankExisting) {
    return {
      winner: newFact,
      loser: existingFact,
      hasContradiction: true,
      resolutionRationale: `Provenance override: ${newFact.source} (rank ${rankNew}) supersedes ${existingFact.source} (rank ${rankExisting}) for ${existingFact.name}.`
    };
  } else if (rankNew < rankExisting) {
    return {
      winner: existingFact,
      loser: newFact,
      hasContradiction: true,
      resolutionRationale: `Provenance retained: ${existingFact.source} (rank ${rankExisting}) preserved over ${newFact.source} (rank ${rankNew}) for ${existingFact.name}.`
    };
  } else {
    const isNewer = (newFact.turnId || 0) >= (existingFact.turnId || 0);
    const winner = isNewer ? newFact : existingFact;
    const loser = isNewer ? existingFact : newFact;
    return {
      winner,
      loser,
      hasContradiction: true,
      resolutionRationale: `Temporal precedence: turn ${winner.turnId ?? 0} supersedes earlier turn ${loser.turnId ?? 0} for ${existingFact.name}.`
    };
  }
}

// ─── CONTROLLED FACT RECONCILIATION LAYER ───────────────────────────────────

import { CandidateFactProposal } from "../clinical-knowledge/types";
export type { CandidateFactProposal };

export interface CandidateFactInput extends CandidateFactProposal {
  targetPatientId?: string;
  reporterId?: string;
  source?: FactSource;
  verificationStatus?: FactVerificationStatus;
  value?: any;
  normalizedText?: string;
}

export interface FactReconciliationResult {
  acceptedFacts: AttributedClinicalFact[];
  rejectedOrDiscrepant: Array<{
    candidate: CandidateFactInput;
    reason: string;
    actionTaken: "isolated_to_patient" | "flagged_uncertain" | "contradiction_flagged" | "unresolved_attribution" | "rejected";
  }>;
  profileUpdatesProposed: {
    targetPatientId: string;
    newUnverifiedConditions: string[];
    newUnverifiedMedications: string[];
    contradictionsDetected: string[];
  };
}

/**
 * Resolves a natural person reference from the LLM ("mother", "self", "child")
 * against the session's authorized caller-patient relationships.
 * The model NEVER assigns database IDs directly.
 */
export function resolveSubjectReference(
  subjectRef: string,
  caller: CallerProfile,
  targetPatient: PatientProfile
): { targetPatientId?: string; isAuthorized: boolean; resolution: "patient" | "caller" | "unresolved" } {
  const ref = (subjectRef || "self").toLowerCase().trim();

  // If reference is "self"
  if (ref === "self" || ref === "caller" || ref === "me") {
    if (caller.relationshipToPatient === "self") {
      return { targetPatientId: targetPatient.id, isAuthorized: true, resolution: "patient" };
    } else {
      // Caller speaking about their own symptoms while managing a family member
      return { targetPatientId: caller.id, isAuthorized: true, resolution: "caller" };
    }
  }

  // If reference is "mother", "mom", "parent"
  if (ref === "mother" || ref === "mom" || ref === "parent") {
    if (caller.relationshipToPatient === "child" || targetPatient.relationshipToUser === "parent" || /mother|mom/i.test(targetPatient.name || "")) {
      return { targetPatientId: targetPatient.id, isAuthorized: true, resolution: "patient" };
    }
  }

  // If reference is "child", "baby", "infant", "son", "daughter"
  if (ref === "child" || ref === "baby" || ref === "infant" || ref === "son" || ref === "daughter") {
    if (caller.relationshipToPatient === "parent" || targetPatient.relationshipToUser === "child" || (targetPatient.age != null && targetPatient.age < 18)) {
      return { targetPatientId: targetPatient.id, isAuthorized: true, resolution: "patient" };
    }
  }

  // If reference matches the target patient name
  if (targetPatient.name && ref.includes(targetPatient.name.toLowerCase())) {
    return { targetPatientId: targetPatient.id, isAuthorized: true, resolution: "patient" };
  }

  // Fallback if session is single-patient evaluation
  if (targetPatient.id && (caller.relationshipToPatient === "self" || ref === "patient")) {
    return { targetPatientId: targetPatient.id, isAuthorized: true, resolution: "patient" };
  }

  return { isAuthorized: false, resolution: "unresolved" };
}

/**
 * Fact-Specific Reconciliation (P0 Correction #2):
 * Applies clinically calibrated rules based on concept type, source, and time,
 * eliminating the simplistic global numeric scalar.
 */
export function reconcileFactSpecific(
  existingFact: AttributedClinicalFact,
  newStatus: FactAssertionStatus,
  newSource: FactSource,
  concept: string,
  turnId: number
): { winnerStatus: FactAssertionStatus; winnerSource: FactSource; isContradiction: boolean; rationale: string } {
  const lowerConcept = concept.toLowerCase();
  const isObjectiveVital = /\b(spo2|oxygen|saturation|heart_rate|pulse|blood_pressure|bp|temp|temperature)\b/.test(lowerConcept);
  const isSubjectiveSymptom = /\b(pain|ache|nausea|fatigue|tired|dizzy|dizziness|anxiety|fear|discomfort)\b/.test(lowerConcept);

  if (existingFact.assertionStatus === newStatus) {
    return { winnerStatus: newStatus, winnerSource: newSource, isContradiction: false, rationale: "Status agreement" };
  }

  // 1. Objective Physiological Measurements: Device reading outranks verbal estimate of that same vital
  if (isObjectiveVital) {
    if (newSource === "device_measured" && existingFact.source !== "device_measured") {
      return {
        winnerStatus: newStatus,
        winnerSource: newSource,
        isContradiction: true,
        rationale: `Objective biometric measurement (${newSource}) supersedes verbal estimate (${existingFact.source}) for ${concept}`
      };
    }
    if (existingFact.source === "device_measured" && newSource !== "device_measured") {
      return {
        winnerStatus: existingFact.assertionStatus,
        winnerSource: existingFact.source,
        isContradiction: true,
        rationale: `Prior objective measurement (${existingFact.source}) preserved over verbal estimate (${newSource}) for ${concept}`
      };
    }
  }

  // 2. Subjective Clinical Symptoms: Patient self-report is primary
  if (isSubjectiveSymptom) {
    if (newSource === "patient_reported") {
      return {
        winnerStatus: newStatus,
        winnerSource: newSource,
        isContradiction: true,
        rationale: `Patient subjective self-report is primary for ${concept}; cannot be overridden by external device/inference`
      };
    }
  }

  // 3. Temporal Precedence for other clinical claims
  const isNewer = turnId >= existingFact.turnId;
  return {
    winnerStatus: isNewer ? newStatus : existingFact.assertionStatus,
    winnerSource: isNewer ? newSource : existingFact.source,
    isContradiction: true,
    rationale: `Temporal precedence on ${concept}: turn ${isNewer ? turnId : existingFact.turnId} supersedes prior turn`
  };
}

export class ControlledFactReconciliationEngine {
  public reconcileCandidateFacts(
    existingFacts: AttributedClinicalFact[],
    candidates: CandidateFactInput[],
    caller: CallerProfile,
    targetPatient: PatientProfile,
    turnId: number
  ): FactReconciliationResult {
    const acceptedFacts: AttributedClinicalFact[] = [...existingFacts];
    const rejectedOrDiscrepant: FactReconciliationResult["rejectedOrDiscrepant"] = [];
    const newUnverifiedConditions: string[] = [];
    const newUnverifiedMedications: string[] = [];
    const contradictionsDetected: string[] = [];

    const nowIso = new Date().toISOString();

    for (const cand of candidates) {
      // Server-Side Person Reference Resolution:
      // The model provides subjectReference ("mother", "self", "child");
      // The server validates and assigns targetPatientId and reporterId.
      const resolution = resolveSubjectReference(cand.subjectReference || "self", caller, targetPatient);
      if (!resolution.isAuthorized || !resolution.targetPatientId) {
        rejectedOrDiscrepant.push({
          candidate: cand,
          reason: `Unresolved subjectReference '${cand.subjectReference}': caller is not authorized for target patient in this session`,
          actionTaken: "unresolved_attribution"
        });
        continue;
      }

      const targetId = resolution.targetPatientId;
      const reporterId = caller.id;
      const conceptKey = cand.concept.trim().toLowerCase();

      const isCallerReportingThirdParty = caller.relationshipToPatient !== "self" && targetId !== caller.id;
      const factSource: FactSource = cand.source || (isCallerReportingThirdParty ? "caregiver_reported" : "patient_reported");

      // Uncertainty Guard: Speculative statements remain flagged as uncertain & unverified
      const isUncertain = cand.assertionStatus === "uncertain" || /\b(think|might|maybe|not\s*sure|possible|guess)\b/i.test(cand.notes || "");
      const assertionStatus: FactAssertionStatus = isUncertain ? "uncertain" : cand.assertionStatus;
      const verificationStatus: FactVerificationStatus = cand.verificationStatus || "unverified";

      // Fact-Specific Reconciliation with existing facts
      const existingMatch = acceptedFacts.find(f => f.targetPatientId === targetId && f.concept.toLowerCase() === conceptKey);
      if (existingMatch) {
        const specRecon = reconcileFactSpecific(existingMatch, assertionStatus, factSource, cand.concept, turnId);
        if (specRecon.isContradiction) {
          contradictionsDetected.push(specRecon.rationale);
          rejectedOrDiscrepant.push({
            candidate: cand,
            reason: specRecon.rationale,
            actionTaken: "contradiction_flagged"
          });

          existingMatch.assertionStatus = specRecon.winnerStatus;
          existingMatch.source = specRecon.winnerSource;
          existingMatch.turnId = turnId;
          existingMatch.notes = specRecon.rationale;
          continue;
        }
      }

      const newFact: AttributedClinicalFact = {
        id: `fact-${targetId}-${conceptKey.replace(/[^a-z0-9]/g, "_")}-${turnId}-${Date.now().toString(36)}`,
        targetPatientId: targetId,
        reporterId,
        concept: cand.concept,
        assertionStatus,
        verificationStatus,
        temporalScope: cand.temporalScope || "current",
        source: factSource,
        turnId,
        timestamp: nowIso,
        provenanceDetails: {
          reliability: isUncertain ? "low" : factSource === "device_measured" ? "high" : "moderate",
          clinicalType: /\b(spo2|temp|pulse|bp)\b/i.test(conceptKey) ? "objective_vital" :
                        /\b(pain|nausea|fatigue)\b/i.test(conceptKey) ? "subjective_symptom" : "observed_behavior",
        },
        value: cand.value,
        normalizedText: cand.normalizedText || (cand as any).evidenceSpan || (cand as any).sourceUtterance || `${cand.concept}: ${assertionStatus}`,
        confidence: isUncertain ? 0.6 : 0.95,
        requiresReconfirmation: isUncertain,
        notes: cand.notes,
      };

      acceptedFacts.push(newFact);

      // Controlled Patient Profile Persistence:
      // Only confirmed, certain assertions are proposed for profile persistence
      if (assertionStatus === "present" && !isUncertain && targetId === targetPatient.id) {
        if (conceptKey.includes("diabet") || conceptKey.includes("hypertens") || conceptKey.includes("asthma") || conceptKey.includes("heart")) {
          newUnverifiedConditions.push(cand.concept);
        } else if (conceptKey.includes("pill") || conceptKey.includes("insulin") || conceptKey.includes("medication") || conceptKey.includes("metformin")) {
          newUnverifiedMedications.push(cand.concept);
        }
      } else if (isUncertain) {
        rejectedOrDiscrepant.push({
          candidate: cand,
          reason: `Uncertain fact retained in encounter state; barred from auto-updating verified patient profile`,
          actionTaken: "flagged_uncertain"
        });
      }
    }

    return {
      acceptedFacts,
      rejectedOrDiscrepant,
      profileUpdatesProposed: {
        targetPatientId: targetPatient.id,
        newUnverifiedConditions,
        newUnverifiedMedications,
        contradictionsDetected
      }
    };
  }
}

export const controlledFactReconciliationEngine = new ControlledFactReconciliationEngine();

export interface ClinicalFact {
  id: string;
  name: string; // e.g. "throat_pain", "voice_change", "onset", "course", "severity", "dysphagia", "fever", "ear_pain"
  label: string; // Human-readable label: "Throat pain", "Voice change / Hoarseness", "Difficulty swallowing"
  category: "chief_complaint" | "symptom_profile" | "associated_symptom" | "red_flag" | "relevant_history";
  status: ClinicalFactStatus;
  value: any;
  normalizedText: string; // e.g. "2 days ago", "Gradually worsening", "Present (hoarseness)", "Denied"
  confidence: number;
  source: ClinicalFactSource;
  turnId: number;
  timestamp: string;
}

export interface RedFlagDomainAssessment {
  domain: "airway" | "swallowing" | "breathing" | "cardiac" | "neurological" | "bleeding";
  label: string;
  assessed: boolean;
  status: "clear" | "concerning" | "critical" | "pending";
  finding?: string;
  rationale?: string;
}

export interface ClinicalHistoryCompletenessBreakdown {
  chiefComplaint: { weight: number; earned: number; established: boolean; label: string };
  onsetTimeline: { weight: number; earned: number; established: boolean; label: string };
  courseProgression: { weight: number; earned: number; established: boolean; label: string };
  characterSeverity: { weight: number; earned: number; established: boolean; label: string };
  associatedSymptoms: { weight: number; earned: number; established: boolean; label: string };
  redFlagScreening: { weight: number; earned: number; established: boolean; label: string };
}

export interface ClinicalHistoryCompleteness {
  score: number; // 0 to 100
  percentageString: string; // e.g. "67%"
  formula: string;
  breakdown: ClinicalHistoryCompletenessBreakdown;
}

export interface ClinicalSafetyAssessment {
  status: "safe" | "screening_incomplete" | "warning_monitor" | "immediate_emergency";
  label: string;
  assessedCount: number;
  totalDomains: number;
  redFlagsTriggered: string[];
  immediateDanger: boolean;
}

export interface InterviewMemoryState {
  askedTopics: string[]; // Topics asked by doctor
  answeredTopics: string[]; // Topics answered by patient
  deniedTopics: string[]; // Symptoms patient explicitly denied
  acknowledgedFindings: string[]; // Findings already acknowledged (prevents "I hear" looping)
  doNotRepeat: string[]; // Topics blocked from re-asking
  patientObjections: string[];
  patientQuestions: string[];
  recentDoctorQuestions: string[];
  lastQuestionTarget?: string;
}

export interface ClinicalInterviewStateV2 {
  caseVersion: number;
  turnCount: number;
  chiefComplaint: ClinicalFact | null;
  symptomProfile: {
    onset: ClinicalFact | null;
    duration: ClinicalFact | null;
    course: ClinicalFact | null;
    severity: ClinicalFact | null;
    character: ClinicalFact | null;
    location: ClinicalFact | null;
  };
  establishedFacts: ClinicalFact[]; // All facts with status "present" or "absent"
  associatedSymptoms: ClinicalFact[];
  redFlags: Record<string, RedFlagDomainAssessment>;
  interviewMemory: InterviewMemoryState;
  nextBestQuestion: {
    target: string;
    label: string;
    clinicalRationale: string;
    suggestedPhrasing: string;
  } | null;
  completeness: ClinicalHistoryCompleteness;
  safety: ClinicalSafetyAssessment;
}

export const HISTORY_WEIGHTS = {
  chiefComplaint: 20,
  onsetTimeline: 15,
  courseProgression: 15,
  characterSeverity: 15,
  associatedSymptoms: 15,
  redFlagScreening: 20,
};

/**
 * Completeness may arrive as a 0–1 fraction (intake) or a 0–100 percentage (board).
 * Never multiply an already-percent value by 100 (that produced figures such as 8800%).
 */
export function normalizeCompletenessPercent(raw: number | null | undefined): number {
  if (raw === null || raw === undefined || !Number.isFinite(Number(raw))) return 0;
  const n = Number(raw);
  if (n < 0) return 0;
  if (n <= 1) return Math.min(100, Math.max(0, Math.round(n * 100)));
  return Math.min(100, Math.max(0, Math.round(n)));
}

/**
 * Deterministically compute history completeness score based on validated clinical facts.
 */
export function calculateHistoryCompleteness(
  chiefComplaint: ClinicalFact | null,
  symptomProfile: ClinicalInterviewStateV2["symptomProfile"],
  associatedSymptoms: ClinicalFact[],
  redFlags: Record<string, RedFlagDomainAssessment>
): ClinicalHistoryCompleteness {
  const ccEstablished = Boolean(chiefComplaint && chiefComplaint.status === "present");
  const onsetEstablished = Boolean(symptomProfile.onset && symptomProfile.onset.status !== "unknown");
  const courseEstablished = Boolean(symptomProfile.course && symptomProfile.course.status !== "unknown");
  
  // Character or severity established (at least one)
  const charOrSevEstablished = Boolean(
    (symptomProfile.character && symptomProfile.character.status !== "unknown") ||
    (symptomProfile.severity && symptomProfile.severity.status !== "unknown")
  );

  // Associated symptoms (at least 1 evaluated, present or denied)
  const evaluatedAssociatedCount = associatedSymptoms.filter(f => f.status !== "unknown").length;
  const assocEstablished = evaluatedAssociatedCount > 0;

  // Red flags assessed count
  const redFlagList = Object.values(redFlags);
  const assessedRedFlagsCount = redFlagList.filter(rf => rf.assessed).length;
  const redFlagRatio = redFlagList.length > 0 ? assessedRedFlagsCount / redFlagList.length : 0;

  const earnedCC = ccEstablished ? HISTORY_WEIGHTS.chiefComplaint : 0;
  const earnedOnset = onsetEstablished ? HISTORY_WEIGHTS.onsetTimeline : 0;
  const earnedCourse = courseEstablished ? HISTORY_WEIGHTS.courseProgression : 0;
  const earnedChar = charOrSevEstablished ? HISTORY_WEIGHTS.characterSeverity : 0;
  const earnedAssoc = assocEstablished ? Math.min(HISTORY_WEIGHTS.associatedSymptoms, evaluatedAssociatedCount * 7.5) : 0;
  const earnedRedFlag = Math.round(redFlagRatio * HISTORY_WEIGHTS.redFlagScreening);

  const rawScore = earnedCC + earnedOnset + earnedCourse + earnedChar + earnedAssoc + earnedRedFlag;
  const finalScore = normalizeCompletenessPercent(rawScore);

  return {
    score: finalScore,
    percentageString: `${finalScore}%`,
    formula: `CC(${earnedCC}/${HISTORY_WEIGHTS.chiefComplaint}) + Onset(${earnedOnset}/${HISTORY_WEIGHTS.onsetTimeline}) + Course(${earnedCourse}/${HISTORY_WEIGHTS.courseProgression}) + Char/Sev(${earnedChar}/${HISTORY_WEIGHTS.characterSeverity}) + Assoc(${earnedAssoc}/${HISTORY_WEIGHTS.associatedSymptoms}) + RedFlags(${earnedRedFlag}/${HISTORY_WEIGHTS.redFlagScreening})`,
    breakdown: {
      chiefComplaint: {
        weight: HISTORY_WEIGHTS.chiefComplaint,
        earned: earnedCC,
        established: ccEstablished,
        label: chiefComplaint ? chiefComplaint.label : "Chief complaint",
      },
      onsetTimeline: {
        weight: HISTORY_WEIGHTS.onsetTimeline,
        earned: earnedOnset,
        established: onsetEstablished,
        label: symptomProfile.onset?.normalizedText || "Onset & timeline",
      },
      courseProgression: {
        weight: HISTORY_WEIGHTS.courseProgression,
        earned: earnedCourse,
        established: courseEstablished,
        label: symptomProfile.course?.normalizedText || "Course & progression",
      },
      characterSeverity: {
        weight: HISTORY_WEIGHTS.characterSeverity,
        earned: earnedChar,
        established: charOrSevEstablished,
        label: symptomProfile.severity?.normalizedText || symptomProfile.character?.normalizedText || "Character & severity",
      },
      associatedSymptoms: {
        weight: HISTORY_WEIGHTS.associatedSymptoms,
        earned: earnedAssoc,
        established: assocEstablished,
        label: `${evaluatedAssociatedCount} associated symptom(s) assessed`,
      },
      redFlagScreening: {
        weight: HISTORY_WEIGHTS.redFlagScreening,
        earned: earnedRedFlag,
        established: assessedRedFlagsCount >= 2,
        label: `${assessedRedFlagsCount}/${redFlagList.length} red-flag domains screened`,
      },
    },
  };
}

/**
 * Evaluate safety independently of history completeness.
 */
export function evaluateClinicalSafety(
  redFlags: Record<string, RedFlagDomainAssessment>,
  immediateDangerDetected = false,
  preSafetyFlags: string[] = []
): ClinicalSafetyAssessment {
  const redFlagList = Object.values(redFlags);
  const assessedCount = redFlagList.filter(rf => rf.assessed).length;
  const totalDomains = redFlagList.length;

  if (immediateDangerDetected || preSafetyFlags.length > 0) {
    return {
      status: "immediate_emergency",
      label: "Critical life-threat detected — immediate emergency response active",
      assessedCount,
      totalDomains,
      redFlagsTriggered: preSafetyFlags,
      immediateDanger: true,
    };
  }

  const concerningDomains = redFlagList.filter(rf => rf.status === "concerning" || rf.status === "critical");
  if (concerningDomains.length > 0) {
    return {
      status: "warning_monitor",
      label: `Alert: ${concerningDomains.map(d => d.label).join(", ")} flagged for clinical attention`,
      assessedCount,
      totalDomains,
      redFlagsTriggered: concerningDomains.map(d => d.label),
      immediateDanger: false,
    };
  }

  if (assessedCount < 2) {
    return {
      status: "screening_incomplete",
      label: `Screening incomplete (${assessedCount}/${totalDomains} assessed)`,
      assessedCount,
      totalDomains,
      redFlagsTriggered: [],
      immediateDanger: false,
    };
  }

  return {
    status: "safe",
    label: `Standard risk (${assessedCount}/${totalDomains} red-flag domains cleared)`,
    assessedCount,
    totalDomains,
    redFlagsTriggered: [],
    immediateDanger: false,
  };
}

/**
 * Create fresh interview state v2
 */
export function createInitialInterviewStateV2(): ClinicalInterviewStateV2 {
  const defaultRedFlags: Record<string, RedFlagDomainAssessment> = {
    airway: { domain: "airway", label: "Airway & breathing", assessed: false, status: "pending" },
    swallowing: { domain: "swallowing", label: "Swallowing & saliva management", assessed: false, status: "pending" },
    breathing: { domain: "breathing", label: "Respiratory distress", assessed: false, status: "pending" },
    cardiac: { domain: "cardiac", label: "Acute coronary / hemodynamic", assessed: false, status: "pending" },
    neurological: { domain: "neurological", label: "Focal neurological deficit (BE-FAST)", assessed: false, status: "pending" },
    bleeding: { domain: "bleeding", label: "Active hemorrhage / hemoptysis", assessed: false, status: "pending" },
  };

  const initialCompleteness = calculateHistoryCompleteness(null, {
    onset: null,
    duration: null,
    course: null,
    severity: null,
    character: null,
    location: null,
  }, [], defaultRedFlags);

  const initialSafety = evaluateClinicalSafety(defaultRedFlags, false, []);

  return {
    caseVersion: 1,
    turnCount: 0,
    chiefComplaint: null,
    symptomProfile: {
      onset: null,
      duration: null,
      course: null,
      severity: null,
      character: null,
      location: null,
    },
    establishedFacts: [],
    associatedSymptoms: [],
    redFlags: defaultRedFlags,
    interviewMemory: {
      askedTopics: [],
      answeredTopics: [],
      deniedTopics: [],
      acknowledgedFindings: [],
      doNotRepeat: [],
      patientObjections: [],
      patientQuestions: [],
      recentDoctorQuestions: [],
    },
    nextBestQuestion: null,
    completeness: initialCompleteness,
    safety: initialSafety,
  };
}

/**
 * SUB-FIELD LEVEL CLINICAL STATE MODEL
 * 
 * Prevents repeating already-resolved portions of compound categories.
 * Breaks down compound categories into independently resolved atomic facts:
 * - Onset / Timeline: duration vs onsetPattern (sudden vs gradual)
 * - Character & Severity: character vs numeric severity
 * - Episodic: episodeDuration vs frequency
 */
export interface SubfieldClinicalState {
  onset: {
    duration?: string;
    onsetPattern?: "sudden" | "gradual" | "unknown";
    isResolved: boolean;
  };
  characterSeverity: {
    character?: string;
    severity?: string;
    isResolved: boolean;
  };
  episodic: {
    isEpisodic?: boolean;
    frequency?: string;
    episodeDuration?: string;
    isResolved: boolean;
  };
}

export interface ParsedOnset {
  onsetTime?: string;
  onsetPattern?: "sudden" | "gradual";
  acuteWorsening?: boolean;
}

/**
 * Robust Onset Parser with Negation Handling & Indic Multilingual Support
 * 
 * Invariants:
 * 1. Negated suddenness ("wasn't sudden", "didn't come on suddenly") MUST NOT resolve to sudden.
 * 2. Onset timeline ("yesterday", "3 days") answers "when" and must NEVER be conflated with sudden vs gradual.
 * 3. Supports English, Hinglish ("achanak", "dheere dheere"), and Telugu transliteration ("ventane", "mellaga").
 */
export function parseOnsetDimensions(text: string): ParsedOnset {
  const textLower = text.toLowerCase();

  // 1. Timeline / Duration extraction
  let onsetTime: string | undefined = undefined;
  const timeMatch = textLower.match(
    /\b(?:since|from|about|approx\.?|roughly)?\s*(\d+\s*(?:minutes?|hours?|days?|weeks?|months?|mins?|hrs?)|morning\s+\d+\s+days?\s+ago|\d+\s+days?\s+ago|yesterday|this\s+morning|last\s+night|an?\s+hour|twenty\s+minutes|thirty\s+minutes|a\s+week|(?:one|two|three|four|five|six|seven)\s+days?|kal\s+se|aaj\s+subah\s+se|do\s+din\s+se|parso\s+se|ninna\s+nunchi|ee\s+roju\s+podduna\s+nunchi|rendu\s+rojuluga)\b/i
  );
  if (timeMatch) {
    onsetTime = timeMatch[0].replace(/^(?:since|from|about|roughly)\s*/i, "").trim();
  }

  // 2. Clause decomposition for context-aware onset vs trigger vs acute worsening
  // Split on sentence boundaries, contrasting conjunctions, commas, and temporal transitions
  const rawClauses = textLower.split(/(?:[,.!?;]|\b(?:but|however|yet|although|though|whereas|instead|then|after\s+that)\b)/i)
    .map(c => c.trim())
    .filter(Boolean);

  let hasExplicitGradualOnset = false;
  let hasExplicitSuddenOnset = false;
  let hasAcuteWorsening = false;
  let hasNegatedSuddenness = false;

  for (const clause of rawClauses) {
    // Check if suddenness is negated in this clause
    const clauseSuddenNegated =
      /\b(?:not|wasn't|was\s+not|didn't|did\s+not|never|neither|no)\s+(?:come\s+on\s+|start\s+|feel\s+|happen\s+|begin\s+)?(?:sudden(?:ly)?|abrupt(?:ly)?|out\s+of\s+nowhere)\b/i.test(clause) ||
      /\b(?:sudden(?:ly)?|abrupt(?:ly)?)\s*(?:nahi|kadhu|ledu)\b/i.test(clause);
    if (clauseSuddenNegated) {
      hasNegatedSuddenness = true;
    }

    // Check if "sudden" in this clause describes a TRIGGER, VISUAL FLASH, EXTERNAL EVENT, or HYPOTHETICAL
    // e.g. "sudden flash", "sudden light", "sudden noise", "sudden sound", "sudden movement", "maybe a sudden flash could cause"
    const isSuddenTriggerOrContext =
      /\b(?:sudden(?:ly)?|abrupt(?:ly)?)\s+(?:flash|light|noise|sound|jerk|movement|move|bang|pop|glare|stimul\w*)\b/i.test(clause) ||
      /\b(?:flash|light|noise|sound|jerk|movement)\s+(?:was\s+)?sudden\b/i.test(clause) ||
      /\b(?:maybe|could\s+be|might\s+be|caused?\s+by|trigger(?:ed)?\s+by)\s+(?:a\s+)?sudden\b/i.test(clause) ||
      /\bsudden\s+(?:\w+\s+)?(?:could|might|can)\s+cause\b/i.test(clause);

    // Check if "sudden" in this clause describes ACUTE WORSENING of an existing symptom
    // e.g. "then suddenly became severe", "suddenly got worse", "next day suddenly became too bad"
    const isSuddenWorsening =
      /\b(?:then|next\s+day|later|subsequently|after\s+that|suddenly)\s+(?:became|got|turned|grew|spiked)\s+(?:severe|worse|bad|intense|unbearable|too\s+bad)\b/i.test(clause) ||
      /\bsuddenly\s+(?:worsened|increased|became\s+(?:severe|worse|too\s+bad))\b/i.test(clause) ||
      /\b(?:became|got|turned|grew)\s+(?:severe|worse|bad|intense|unbearable|too\s+bad)\s+(?:suddenly|abruptly|all\s+of\s+a\s+sudden)\b/i.test(clause);

    // Check if this clause explicitly describes GRADUAL onset of symptom
    // e.g. "built up gradually", "started gradually", "came on slowly", "gradual onset", "slowly over time", "gradually got worse"
    const isGradualOnset =
      /\b(?:built?\s+up\s+gradual(?:ly)?|gradual(?:ly)?\s+built?\s+up|came\s+on\s+gradual(?:ly)?|started\s+gradual(?:ly)?|began\s+gradual(?:ly)?|crept\s+up\s+slowly)\b/i.test(clause) ||
      (/\b(?:gradual(?:ly)?|slowly|over\s+time|dheere\s+dheere|mellaga)\b/i.test(clause) && /\b(?:built?\s+up|start\w*|beg\w*|came\s+on|increas\w*|worsen\w*|develop\w*|got\s+worse|became\s+worse)\b/i.test(clause));

    if (isGradualOnset) {
      hasExplicitGradualOnset = true;
    }

    if (isSuddenWorsening) {
      hasAcuteWorsening = true;
    }

    // Check for TRUE sudden onset of symptom in this clause
    // (not negated, not a trigger/external stimulus like a flash, not just a worsening of an already gradual symptom)
    if (!clauseSuddenNegated && !isSuddenTriggerOrContext) {
      const hasSuddenOnsetTerm =
        /\b(?:started\s+sudden(?:ly)?|began\s+sudden(?:ly)?|came\s+on\s+sudden(?:ly)?|hit\s+me\s+sudden(?:ly)?|struck\s+sudden(?:ly)?)\b/i.test(clause) ||
        /\b(?:sudden(?:ly)?\s+started|sudden(?:ly)?\s+began|sudden(?:ly)?\s+came\s+on)\b/i.test(clause) ||
        /\b(?:thunderclap|clap\s+of\s+thunder|all\s+at\s+once|all\s+of\s+a\s+sudden|out\s+of\s+nowhere)\b/i.test(clause) ||
        /\b(?:ekdum\s+se|achanak(?:\s+se)?|turant|jhatke\s+se|ventane|akasmaathuga)\b/i.test(clause);

      // Standalone "sudden" or "suddenly" without trigger context
      const genericSudden = /\b(?:sudden(?:ly)?|abrupt(?:ly)?)\b/i.test(clause);

      if (hasSuddenOnsetTerm) {
        if (!isSuddenWorsening) {
          hasExplicitSuddenOnset = true;
        }
      } else if (genericSudden && !isSuddenWorsening) {
        // If the clause does not describe an onset of symptom (e.g. "sudden flash"), do not count it
        if (!isSuddenTriggerOrContext) {
          hasExplicitSuddenOnset = true;
        }
      }
    }
  }

  // Determine final onsetPattern and acuteWorsening:
  let onsetPattern: "sudden" | "gradual" | undefined = undefined;
  let acuteWorsening: boolean | undefined = undefined;

  // Gradual onset takes precedence if explicitly stated (or if sudden was negated)
  if (hasExplicitGradualOnset || hasNegatedSuddenness) {
    onsetPattern = "gradual";
    // If it started gradually but then experienced acute worsening, preserve both!
    acuteWorsening = hasAcuteWorsening;
  } else if (hasExplicitSuddenOnset) {
    onsetPattern = "sudden";
    acuteWorsening = true;
  } else if (hasAcuteWorsening) {
    // If only acute worsening was mentioned without initial gradual, it still indicates sudden worsening
    onsetPattern = "sudden";
    acuteWorsening = true;
  }

  return {
    onsetTime,
    onsetPattern,
    acuteWorsening,
  };
}

export function extractSubfieldState(
  slots: Record<string, any> = {},
  knownFacts: string[] = [],
  conversationMemory?: any
): SubfieldClinicalState {
  // 1. Onset & Timeline subfields
  let onsetDuration = slots.duration || slots.onset;
  if (!onsetDuration) {
    const onsetFact = knownFacts.find(f => /^(?:ONSET|Duration):\s*(.+)/i.test(f));
    if (onsetFact) {
      const match = onsetFact.match(/^(?:ONSET|Duration):\s*(.+)/i);
      if (match) onsetDuration = match[1].trim();
    }
  }
  let isDurationValid = false;
  if (onsetDuration && !/^(?:sudden|gradual|unknown)$/i.test(String(onsetDuration).trim())) {
    isDurationValid = true;
  }

  let pattern: "sudden" | "gradual" | "unknown" = "unknown";
  if (slots.acute_worsening === true) pattern = "sudden";
  else if (slots.acute_worsening === false) pattern = "gradual";
  else {
    const typeFact = knownFacts.find(f => /ONSET_(?:TYPE|PATTERN):\s*(sudden|gradual)/i.test(f) || /Course:\s*(sudden|gradual)/i.test(f));
    if (typeFact) {
      pattern = /sudden/i.test(typeFact) ? "sudden" : "gradual";
    } else if ((slots as any).onset_pattern) {
      pattern = (slots as any).onset_pattern === "sudden" ? "sudden" : "gradual";
    } else if (knownFacts.some(f => /sudden\s+onset/i.test(f))) {
      pattern = "sudden";
    } else if (knownFacts.some(f => /gradual/i.test(f))) {
      pattern = "gradual";
    } else if (slots.onset && /\b(?:not|wasn't|didn't|never|no)\s+(?:come\s+on\s+)?sudden/i.test(String(slots.onset))) {
      pattern = "gradual";
    } else if (slots.onset && /\bsudden(?:ly)?\b/i.test(String(slots.onset))) {
      pattern = "sudden";
    } else if (slots.onset && /\bgradual(?:ly)?\b/i.test(String(slots.onset))) {
      pattern = "gradual";
    }
  }

  // 2. Character & Severity subfields
  let character = slots.character;
  if (!character) {
    const charFact = knownFacts.find(f => /^CHARACTER:\s*(.+)/i.test(f));
    if (charFact) character = charFact.replace(/^CHARACTER:\s*/i, "").trim();
  }

  let severity = slots.severity ? extractNumericSeverity(slots.severity) || slots.severity : undefined;
  if (!severity) {
    const sevFact = knownFacts.find(f => /^SEVERITY:\s*(.+)/i.test(f) || /\b([0-9]|10)\/10\b/i.test(f));
    if (sevFact) {
      const match = sevFact.match(/\b([0-9]|10)\/10\b/i);
      severity = match ? match[0] : extractNumericSeverity(sevFact) || sevFact.replace(/^SEVERITY:\s*/i, "").trim();
    } else {
      for (const fact of knownFacts) {
        const extracted = extractNumericSeverity(fact);
        if (extracted) {
          severity = extracted;
          break;
        }
      }
    }
  }

  // 3. Episodic subfields
  const freq = conversationMemory?.frequencyPattern ||
    knownFacts.find(f => /^Frequency:\s*(.+)/i.test(f))?.replace(/^Frequency:\s*/i, "").trim();
  const isEpisodic = Boolean(freq || /episode/i.test(conversationMemory?.durationPattern || ""));
  const episodeDur = conversationMemory?.durationPattern || (isEpisodic ? slots.duration : undefined);

  return {
    onset: {
      duration: isDurationValid ? String(onsetDuration) : undefined,
      onsetPattern: pattern,
      isResolved: Boolean(isDurationValid && pattern !== "unknown")
    },
    characterSeverity: {
      character: character ? String(character) : undefined,
      severity: severity ? String(severity) : undefined,
      isResolved: Boolean(character && severity)
    },
    episodic: {
      isEpisodic,
      frequency: freq ? String(freq) : undefined,
      episodeDuration: episodeDur ? String(episodeDur) : undefined,
      isResolved: Boolean(freq && episodeDur)
    }
  };
}

const WORD_TO_NUM: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4,
  five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

/**
 * Robust extraction for numeric pain severity ratings.
 * Covers natural variants:
 * - "8 out of 10", "8/10", "8 by 10", "maybe 8 by 10", "8 on 10", "8 of 10"
 * - "I'd say an eight", "probably an 8", "maybe an 8", "pain is an 8", "pain is 6"
 * - Targeted standalone numbers: "8" when replying to a severity scale question
 */
export function extractNumericSeverity(text: string, isSeverityPrompt: boolean = false): string | null {
  if (!text) return null;
  const lower = text.toLowerCase().trim();

  // 1. Explicit ratio patterns:
  // e.g. "8/10", "8 out of 10", "maybe 8 by 10", "8 by 10", "8 on 10", "8 of 10", "eight out of ten", "eight by ten"
  const ratioMatch = lower.match(
    /\b(?:(?:maybe|probably|around|about|like|roughly|i'd\s+say|i\s+would\s+say|pain\s+(?:level\s+)?(?:is\s+)?|severity\s+(?:is\s+)?)\s*)*(?:an?\s+)?([0-9]|10|zero|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:\/|\s*out\s+of\s*|\s*by\s*|\s*on\s*|\s*of\s*)\s*(?:10|ten)\b/i
  );
  if (ratioMatch) {
    const rawVal = ratioMatch[1].toLowerCase();
    const num = WORD_TO_NUM[rawVal] !== undefined ? WORD_TO_NUM[rawVal] : parseInt(rawVal, 10);
    if (!isNaN(num) && num >= 0 && num <= 10) {
      return `${num}/10`;
    }
  }

  // 2. Explicit pain phrases without denominator:
  // e.g. "pain is 8", "pain is an 8", "severity is 7", "hurts at an 8", "pain level 8"
  const painMatch = lower.match(
    /\b(?:pain\s+(?:level\s+)?(?:is\s+|at\s+)?|severity\s+(?:is\s+|at\s+)?|hurts?\s+(?:at\s+)?)\s*(?:about\s+|around\s+)?(?:an?\s+)?([0-9]|10|zero|one|two|three|four|five|six|seven|eight|nine|ten)\b/i
  );
  if (painMatch) {
    const rawVal = painMatch[1].toLowerCase();
    const num = WORD_TO_NUM[rawVal] !== undefined ? WORD_TO_NUM[rawVal] : parseInt(rawVal, 10);
    if (!isNaN(num) && num >= 0 && num <= 10) {
      return `${num}/10`;
    }
  }

  // 3. Conversational / qualified ratings:
  // e.g. "I'd say an eight", "probably an 8", "maybe an 8", "it's about an 8", "around an 8", "maybe 8", "probably 8"
  const qualifiedMatch = lower.match(
    /\b(?:i'd\s+say|i\s+would\s+say|probably|maybe|around|about|it's\s+about|like)\s+(?:an?\s+)?([0-9]|10|zero|one|two|three|four|five|six|seven|eight|nine|ten)\b(?!\s*(?:(?:to|or|-)\s*(?:[0-9]|10|zero|one|two|three|four|five|six|seven|eight|nine|ten)\s*)?(?:days?|hours?|weeks?|months?|minutes?|seconds?|years?|mins?|hrs?|am|pm|o'?clock|times?|episodes?|rounds?|bottles?|tablets?|pills?)\b)/i
  );
  if (qualifiedMatch) {
    const rawVal = qualifiedMatch[1].toLowerCase();
    const num = WORD_TO_NUM[rawVal] !== undefined ? WORD_TO_NUM[rawVal] : parseInt(rawVal, 10);
    if (!isNaN(num) && num >= 0 && num <= 10) {
      return `${num}/10`;
    }
  }

  // 4. Standalone number when answering a targeted severity inquiry:
  // e.g. Doctor asked: "How severe is the pain on a scale of 0 to 10?" -> Patient: "8" or "eight"
  if (isSeverityPrompt) {
    const targetedMatch = lower.match(
      /^(?:an?\s+)?([0-9]|10|zero|one|two|three|four|five|six|seven|eight|nine|ten)[.!?\s]*$/i
    );
    if (targetedMatch) {
      const rawVal = targetedMatch[1].toLowerCase();
      const num = WORD_TO_NUM[rawVal] !== undefined ? WORD_TO_NUM[rawVal] : parseInt(rawVal, 10);
      if (!isNaN(num) && num >= 0 && num <= 10) {
        return `${num}/10`;
      }
    }
  }

  return null;
}

export type AbdominalLocationCode =
  | "upper_abdomen"
  | "lower_abdomen"
  | "right_upper"
  | "right_lower"
  | "left_upper"
  | "left_lower"
  | "central_periumbilical"
  | "diffuse";

export const ABDOMINAL_LOCATION_LABELS: Record<AbdominalLocationCode, string> = {
  upper_abdomen: "upper abdomen",
  lower_abdomen: "lower abdomen",
  right_upper: "right upper quadrant",
  right_lower: "right lower quadrant",
  left_upper: "left upper quadrant",
  left_lower: "left lower quadrant",
  central_periumbilical: "central / periumbilical",
  diffuse: "diffuse",
};

export function parseAbdominalLocations(text: string): AbdominalLocationCode[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  const found = new Set<AbdominalLocationCode>();

  if (/\b(?:right\s+upper|ruq|right\s+upper\s+quadrant|under\s+(?:the\s+)?right\s+rib|liver|gallbladder)\b/i.test(lower)) {
    found.add("right_upper");
  }
  if (/\b(?:right\s+lower|rlq|right\s+lower\s+quadrant|appendix|lower\s+right)\b/i.test(lower)) {
    found.add("right_lower");
  }
  if (/\b(?:left\s+upper|luq|left\s+upper\s+quadrant|spleen)\b/i.test(lower)) {
    found.add("left_upper");
  }
  if (/\b(?:left\s+lower|llq|left\s+lower\s+quadrant|lower\s+left)\b/i.test(lower)) {
    found.add("left_lower");
  }
  if (/\b(?:around\s+(?:my\s+)?(?:belly\s*button|navel|umbilicus)|periumbilical|center\s+of\s+(?:my\s+)?(?:stomach|belly|abdomen)|central)\b/i.test(lower)) {
    found.add("central_periumbilical");
  }
  if (/\b(?:all\s+over|everywhere|whole\s+(?:stomach|belly|abdomen)|diffuse|general(?:ized)?)\b/i.test(lower)) {
    found.add("diffuse");
  }
  if (found.size === 0 && /\b(?:upper|epigastr|above\s+(?:my\s+)?belly\s*button)\b/i.test(lower)) {
    found.add("upper_abdomen");
  }
  if (found.size === 0 && /\b(?:lower|suprapubic|below\s+(?:my\s+)?belly\s*button|pelvi)\b/i.test(lower)) {
    found.add("lower_abdomen");
  }

  return [...found];
}

export function isAbdominalPresentation(text: string): boolean {
  if (!text) return false;
  return /\b(stomach|abdom|belly|gut|epigastr|umbilic)\b/i.test(text);
}

export interface GiAssociatedFinding {
  name: string;
  label: string;
  status: "present" | "absent";
}

export function extractGiAssociatedSymptoms(text: string): GiAssociatedFinding[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  const findings: GiAssociatedFinding[] = [];

  const specs: Array<{
    name: string;
    label: string;
    present: RegExp;
    absent: RegExp;
  }> = [
    {
      name: "diarrhea",
      label: "Diarrhea / loose stools",
      present: /\b(diarrh(?:oe)?a|loose\s+motions?|loose\s+stools?|watery\s+stools?|watery\s+motions?|running\s+stool|frequent\s+loose|bad\s+poop(?:ing)?)\b/i,
      absent: /\bno\s+(?:diarrh(?:oe)?a|loose\s+motions?|loose\s+stools?)\b/i,
    },
    {
      name: "vomiting",
      label: "Vomiting",
      present: /\b(vomit(?:ing|ed)?|throwing\s+up|threw\s+up|emesis)\b/i,
      absent: /\bno\s+(?:vomiting|vomit|throwing\s+up)\b/i,
    },
    {
      name: "nausea",
      label: "Nausea",
      present: /\b(nause(?:a|ated|ous)|queasy|sick\s+to\s+(?:my\s+)?stomach)\b/i,
      absent: /\bno\s+nause/i,
    },
    {
      name: "blood_in_stool",
      label: "Blood in stool",
      present: /\b(blood\s+in\s+(?:the\s+)?(?:stool|poop|motions?)|bloody\s+stool|melena|black\s+tarry|hematochezia|rectal\s+bleeding)\b/i,
      absent: /\bno\s+(?:blood\s+in\s+(?:the\s+)?(?:stool|poop)|bloody\s+stool|rectal\s+bleeding)\b/i,
    },
    {
      name: "constipation",
      label: "Constipation",
      present: /\b(constipat(?:ed|ion)|cannot\s+poop|hard\s+stools?|no\s+bowel\s+movement)\b/i,
      absent: /\bno\s+constipat/i,
    },
    {
      name: "bloating",
      label: "Bloating",
      present: /\b(bloat(?:ed|ing)?|gassy|gas\s+pain|distended)\b/i,
      absent: /\bno\s+(?:bloat|gas)\b/i,
    },
  ];

  for (const spec of specs) {
    if (spec.absent.test(lower)) {
      findings.push({ name: spec.name, label: spec.label, status: "absent" });
    } else if (spec.present.test(lower)) {
      findings.push({ name: spec.name, label: spec.label, status: "present" });
    }
  }

  return findings;
}

export interface EpisodicSeverity {
  baseline?: number;
  peak?: number;
  pattern?: "constant" | "intermittent";
  display: string;
}

function parseSeverityToken(raw: string): number | null {
  const token = raw.toLowerCase();
  const num = WORD_TO_NUM[token] !== undefined ? WORD_TO_NUM[token] : parseInt(token, 10);
  if (Number.isNaN(num) || num < 0 || num > 10) return null;
  return num;
}

export function extractAllNumericSeverities(text: string): number[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  const found: number[] = [];
  const re =
    /\b([0-9]|10|zero|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:\/|\s*out\s+of\s*|\s*by\s*|\s*on\s*|\s*of\s*)\s*(?:10|ten)\b/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(lower)) !== null) {
    const num = parseSeverityToken(match[1]);
    if (num !== null) found.push(num);
  }
  return [...new Set(found)];
}

/**
 * Preserve usual vs peak pain rather than collapsing "4/10 usually, 9/10 when sharp" to a single 4.
 */
export function extractEpisodicSeverity(text: string, isSeverityPrompt = false): EpisodicSeverity | null {
  if (!text) return null;
  const nums = extractAllNumericSeverities(text);
  const intermittent = /\b(usually|usual|typically|most\s+of\s+the\s+time|at\s+times|when\s+(?:it'?s\s+)?sharp|when\s+it\s+hurts|comes?\s+and\s+goes|flare|peak|intermittent|episodic)\b/i.test(text);

  if (nums.length >= 2) {
    const baseline = Math.min(...nums);
    const peak = Math.max(...nums);
    return {
      baseline,
      peak,
      pattern: intermittent || peak !== baseline ? "intermittent" : "constant",
      display: `${baseline}/10 usual, ${peak}/10 peak`,
    };
  }

  if (nums.length === 1) {
    return {
      baseline: nums[0],
      peak: intermittent ? undefined : nums[0],
      pattern: intermittent ? "intermittent" : "constant",
      display: `${nums[0]}/10`,
    };
  }

  const single = extractNumericSeverity(text, isSeverityPrompt);
  if (!single) return null;
  const n = parseInt(single.split("/")[0], 10);
  return {
    baseline: n,
    peak: n,
    pattern: intermittent ? "intermittent" : "constant",
    display: single,
  };
}

/**
 * Slots that represent categorical or quantitative dimensions and can NEVER be treated as denied symptoms.
 */
export const NON_DENIABLE_SLOTS = new Set([
  "onset_pattern",
  "onset",
  "onset_time",
  "course",
  "duration",
  "frequency",
  "timing_pattern",
  "severity",
  "character",
  "location",
  "abdominal_location",
  "chief_complaint",
  "patient_objection",
  "emotional_concern",
  "general_inquiry",
]);

/**
 * Detects the clinical target topic/slot of a doctor's spoken question to maintain
 * bidirectional question-to-answer integrity even if an LLM paraphrases the planned inquiry.
 * Distinguishes legitimate subfields:
 * - severity vs character
 * - onset_pattern (sudden/gradual) vs onset (duration/timeline)
 * - episodic frequency vs episodic duration
 * - odynophagia (pain on swallowing) vs swallowing_difficulty (mechanical dysphagia)
 */
export function detectQuestionTargetSlot(questionText: string, defaultSlot?: string): string {
  const lower = questionText.toLowerCase();

  // 1. Odynophagia (pain on swallowing) vs Mechanical dysphagia (trouble swallowing / fluids & saliva / choking)
  if (/hurts?\s+to\s+swallow|painful\s+to\s+swallow|pain\s+when\s+swallowing|odynophagia|hurt\s+more\s+when\s+you\s+swallow/i.test(lower)) {
    return "odynophagia";
  }
  if (/swallow(?:ing)?\s+liquids|liquids\s+and\s+saliva|difficulty\s+swallowing|trouble\s+swallowing|able\s+to\s+swallow|choking|dysphagia/i.test(lower)) {
    return "swallowing_difficulty";
  }
  if (/swallow/i.test(lower)) {
    return "swallowing_difficulty";
  }

  // 2. Ear pain / otalgia
  if (/ear\s*pain|earache|ears/i.test(lower)) return "ear_pain";

  // 3. Fever / chills
  if (/fever|chills|temperature/i.test(lower)) return "fever";

  // 4. Abdominal / GI location and associated GI facts
  if (/where\s+in\s+(?:your\s+)?(?:abdomen|stomach|belly)|feel\s+strongest|which\s+(?:part|side|quadrant)|upper\s+or\s+lower/i.test(lower)) {
    return "abdominal_location";
  }
  if (/\b(loose\s+motions?|diarrh(?:oe)?a|blood\s+in\s+(?:your\s+)?stool|vomiting|bowel)\b/i.test(lower) && /have\s+you|any\s+(?:vomiting|fever|blood)/i.test(lower)) {
    return "gi_associated";
  }
  if (/\bdiarrh(?:oe)?a|loose\s+motions?|loose\s+stools?\b/i.test(lower)) return "diarrhea";
  if (/\bvomit/i.test(lower)) return "vomiting";

  // 5. Severity (numerical scale / 0-10 / rate pain) vs Character (quality / sensation) vs Timing Pattern
  if (/scale|0\s*[-–to]\s*10|zero\s*[-–to]\s*ten|how\s+severe|severity|rate\s+your\s+pain/i.test(lower)) return "severity";
  if (/constant\s+or\s+(?:does\s+it\s+)?come\s+and\s+go|comes\s+and\s+goes|in\s+waves|intermittent/i.test(lower)) return "timing_pattern";
  if (/what\s+(?:does\s+it|it)\s+feel\s+like|sharp|dull|burning|pressure|tightness|squeezing|character|crushing|throbbing/i.test(lower)) return "character";

  // 5. Onset pattern (sudden vs gradual / clap of thunder) vs Episodic duration/frequency vs Onset timeline
  if (/clap\s+of\s+thunder|thunderclap|sudden|gradual|come\s+on\s+all\s+at\s+once|build\s+up/i.test(lower)) return "onset_pattern";
  if (/how\s+long\s+(?:does\s+each|each\s+one\s+last)|duration\s+of\s+each/i.test(lower)) return "duration";
  if (/how\s+often|how\s+many\s+times\s+a\s+(?:day|month|week)|frequency/i.test(lower)) return "frequency";
  if (/when\s+did|how\s+long\s+have\s+you\s+had|how\s+many\s+days|how\s+many\s+hours|when\s+did\s+this\s+start/i.test(lower)) return "onset";

  // Neurological laterality & weakness/numbness distribution
  if (/(?:one\s+side|both\s+sides|which\s+side|affecting\s+one\s+side|unilateral|bilateral|where\s+do\s+you\s+feel\s+it)/i.test(lower)) {
    if (/weak|weakness/i.test(lower)) return "weakness_distribution";
    if (/numb|numbness/i.test(lower)) return "numbness_distribution";
    return "laterality";
  }

  // Neurological signs & deficits
  if (/facial\s+droop|face\s+numbness|drooping/i.test(lower)) return "facial_droop";
  if (/speech|finding\s+your\s+words|speaking\s+clearly|slurr/i.test(lower)) return "speech_difficulty";
  if (!/one\s+side|both\s+sides|which\s+side/i.test(lower) && /\b(?:weakness|weak)\b/i.test(lower)) return "weakness";
  if (!/one\s+side|both\s+sides|which\s+side/i.test(lower) && /\b(?:numbness|numb)\b/i.test(lower)) return "numbness";

  // Orthostatic / postural timing
  if (/\b(?:stand(?:ing)?\s+up|sitting\s+up|lying\s+down|postur(?:e|al)|orthostatic|when\s+you\s+walk)\b/i.test(lower)) {
    return "orthostatic_timing";
  }

  // Dizziness character & vestibular signs
  if (/\b(?:dizz(?:y|iness)|lightheaded(?:ness)?|room\s+spinning|vertigo|unsteady|loss\s+of\s+balance)\b/i.test(lower)) {
    return "dizziness_character";
  }

  // 6. Voice character
  if (/\b(?:voice|hoarse|hoarseness|loss of voice|raspy voice)\b/i.test(lower)) return "voice_character";

  // 7. Course & progression
  if (/worse|better|improving|staying\s+the\s+same|course/i.test(lower)) return "course";

  // 8. Radiation (must involve spreading/radiating/traveling pain)
  if (/\b(?:radiat\w*|travel\w*|spread\w*)\b/i.test(lower)) return "radiation";

  // 9. Exertional
  if (/active|activity|exercis|stairs?|rest(?:ing)?|exert/i.test(lower)) return "exertional";

  // 10. Light/sound sensitivity (photophobia/phonophobia) → associated_symptoms
  if (/bright\s+light|light\s+(?:bother|sensitivity)|sensitive\s+to\s+(?:bright\s+)?light|photophob|loud\s+(?:sound|noise)|sound\s+(?:bother|sensitivity)|sensitive\s+to\s+(?:sound|noise)|phonophob/i.test(lower)) return "associated_symptoms";

  // 11. Generic associated symptoms
  if (/other\s+symptoms|associated|alongside/i.test(lower)) return "associated_symptoms";

  return defaultSlot || "general_inquiry";
}

/**
 * Returns every distinct clinical dimension asked in a single clinician question.
 * This intentionally treats alternatives within one dimension (for example, sudden
 * versus gradual onset) as one target, while catching bundled dimensions such as
 * onset plus light sensitivity.
 */
export function detectQuestionTargetSlots(questionText: string): string[] {
  const lower = questionText.toLowerCase();
  const targets = new Set<string>();

  const asksOnsetPattern = /clap\s+of\s+thunder|thunderclap|sudden|gradual|come\s+on\s+all\s+at\s+once|build\s+up/.test(lower);
  if (asksOnsetPattern) targets.add("onset_pattern");
  if (/when\s+(?:did|this\s+began|it\s+began|this\s+started|it\s+started)|when\s+did\s+this\s+start|how\s+long\s+have\s+you\s+had|how\s+many\s+(?:days|hours)/.test(lower)) targets.add("onset_time");
  if (/scale|0\s*[-–to]\s*10|zero\s*[-–to]\s*ten|how\s+severe|severity|rate\s+your\s+pain/.test(lower)) targets.add("severity");
  if (/constant\s+or\s+(?:does\s+it\s+)?come\s+and\s+go|comes\s+and\s+goes|in\s+waves|intermittent/.test(lower)) targets.add("timing_pattern");
  if (/what\s+(?:does\s+it|it)\s+feel\s+like|sharp|dull|burning|pressure|tightness|squeezing|character|crushing|throbbing/.test(lower)) targets.add("character");
  if (/bright\s+light|light\s+(?:bother|sensitivity)|sensitive\s+to\s+(?:bright\s+)?light|photophob|loud\s+(?:sound|noise)|sound\s+(?:bother|sensitivity)|sensitive\s+to\s+(?:sound|noise)|phonophob/.test(lower)) targets.add("associated_symptoms");
  if (/other\s+symptoms|associated|alongside/.test(lower)) targets.add("associated_symptoms");
  if (/where\s+in\s+(?:your\s+)?(?:abdomen|stomach|belly)|feel\s+strongest|which\s+(?:part|side|quadrant)|upper\s+or\s+lower/.test(lower)) {
    targets.add("abdominal_location");
  }
  if (/\bdiarrh(?:oe)?a|loose\s+motions?|loose\s+stools?/.test(lower)) targets.add("diarrhea");
  if (/\bvomit/.test(lower)) targets.add("vomiting");
  if (/blood\s+in\s+(?:your\s+)?stool|bloody\s+stool/.test(lower)) targets.add("blood_in_stool");
  if (/fever|chills|temperature/.test(lower)) targets.add("fever");
  if (/swallow(?:ing)?\s+liquids|liquids\s+and\s+saliva|difficulty\s+swallowing|trouble\s+swallowing|able\s+to\s+swallow|choking|dysphagia/.test(lower)) targets.add("swallowing_difficulty");
  if (/ear\s*pain|earache|ears/.test(lower)) targets.add("ear_pain");
  // "Did it gradually get worse?" is an onset-pattern alternative, not a
  // separate course question. Course is distinct only when no onset pattern is
  // being requested in the same sentence.
  if (!asksOnsetPattern && /worse|better|improving|staying\s+the\s+same|course/.test(lower)) targets.add("course");
  if (/\b(?:radiat\w*|travel\w*|spread\w*)\b/i.test(lower)) targets.add("radiation");
  if (/active|activity|exercis|stairs?|rest(?:ing)?|exert/.test(lower)) targets.add("exertional");
  if (/(?:one\s+side|both\s+sides|which\s+side|affecting\s+one\s+side|unilateral|bilateral)/.test(lower)) {
    if (/weak|weakness/.test(lower)) targets.add("weakness_distribution");
    else if (/numb|numbness/.test(lower)) targets.add("numbness_distribution");
    else targets.add("laterality");
  }
  if (/\b(?:dizz(?:y|iness)|lightheaded(?:ness)?|room\s+spinning|vertigo|unsteady|loss\s+of\s+balance)\b/.test(lower)) {
    targets.add("dizziness_character");
  }
  if (/\b(?:stand(?:ing)?\s+up|sitting\s+up|lying\s+down|postur(?:e|al)|orthostatic|when\s+you\s+walk)\b/.test(lower)) {
    targets.add("orthostatic_timing");
  }
  if (/facial\s+droop|face\s+numbness|drooping/.test(lower)) {
    targets.add("facial_droop");
  }
  if (/speech|finding\s+your\s+words|speaking\s+clearly|slurr/.test(lower)) {
    targets.add("speech_difficulty");
  }
  if (!targets.has("weakness_distribution") && /\b(?:weakness|weak)\b/.test(lower)) {
    targets.add("weakness");
  }
  if (!targets.has("numbness_distribution") && /\b(?:numbness|numb)\b/.test(lower)) {
    targets.add("numbness");
  }

  return [...targets];
}

/**
 * Evaluates whether a detected question slot matches the planner's expected clinical topic.
 * Enforces strict distinction between subfields (e.g. severity vs character, onset pattern vs duration).
 */
export function isTargetSlotMatch(expectedTopic: string, detectedSlot: string): boolean {
  if (!expectedTopic || !detectedSlot) return false;
  const exp = expectedTopic.toLowerCase().trim();
  const det = detectedSlot.toLowerCase().trim();

  if (exp === det) return true;

  // Onset timeline variants: "onset", "onset_time" (when did it start / duration of complaint)
  if ((exp === "onset" || exp === "onset_time") && (det === "onset" || det === "onset_time")) {
    return true;
  }

  // Onset pattern variants: "onset_pattern", "headache_onset_character"
  if ((exp === "onset_pattern" || exp === "headache_onset_character") && (det === "onset_pattern" || det === "headache_onset_character")) {
    return true;
  }

  // Neurological laterality / distribution
  const lateralityGroup = new Set([
    "weakness_distribution",
    "numbness_distribution",
    "laterality",
  ]);
  if (lateralityGroup.has(exp) && lateralityGroup.has(det)) {
    return true;
  }

  // Neurological red flag variants
  const neuroGroup = new Set([
    "neurological_signs",
    "weakness",
    "neurological_weakness",
    "facial_droop",
    "speech_difficulty",
    "numbness",
  ]);
  if (neuroGroup.has(exp) && neuroGroup.has(det)) {
    return true;
  }

  // Timing / Severity pattern
  const timingGroup = new Set(["timing_pattern", "severity_pattern"]);
  if (timingGroup.has(exp) && timingGroup.has(det)) {
    return true;
  }

  // Swallowing variants: odynophagia (painful swallowing) ↔ swallowing_difficulty ↔ dysphagia
  const swallowGroup = new Set(["swallowing_difficulty", "odynophagia", "dysphagia"]);
  if (swallowGroup.has(exp) && swallowGroup.has(det)) {
    return true;
  }

  // Associated symptoms variants: photophobia, phonophobia, light/sound sensitivity, GI
  const assocGroup = new Set([
    "associated_symptoms",
    "associated_general",
    "photophobia",
    "phonophobia",
    "photophobia_phonophobia",
    "diarrhea",
    "vomiting",
    "nausea",
    "blood_in_stool",
    "bloating",
    "constipation",
    "gi_associated",
  ]);
  if (assocGroup.has(exp) && assocGroup.has(det)) {
    return true;
  }

  if ((exp === "location" || exp === "abdominal_location") && (det === "location" || det === "abdominal_location")) {
    return true;
  }

  return false;
}

export interface TargetValidationResult {
  isValid: boolean;
  detectedTarget: string;
  reason?: string;
}

/**
 * Post-generation validator for doctor replies:
 * A. Checks if a question exists when clinical inquiry is active.
 * B. Checks if detected question target strictly matches the responsePlan's nextHighValueInquiry.topic.
 * C. Enforces that the reply does not violate responsePlan.mustAvoidAsking (both by slot and forbidden phrases).
 * D. Enforces that the reply does not repeat already-resolved subfields or denied symptoms.
 * E. Enforces that the reply does not bundle multiple clinical questions.
 */
export function validateDoctorReplyTarget(
  replyText: string,
  plan?: {
    primaryGoal?: string;
    mustAvoidAsking?: string[];
    nextHighValueInquiry?: { topic: string; clinicalRationale: string; suggestedPhrasing: string };
    patientUtterance?: string;
    strictTargetSlot?: boolean;
  },
  slots?: Record<string, any>,
  memory?: any,
  confirmedFacts?: string[],
  deniedSymptoms?: string[]
): TargetValidationResult {
  const clean = replyText.trim();
  if (!clean) {
    return { isValid: false, detectedTarget: "empty", reason: "LLM_EMPTY_REPLY" };
  }

  // A. Is there a question?
  if (!clean.includes("?")) {
    if (plan?.primaryGoal === "EMERGENCY_DISPOSITION" || plan?.primaryGoal === "VALIDATE_EMOTION_BEFORE_INQUIRY") {
      return { isValid: true, detectedTarget: "statement" };
    }
    return { isValid: false, detectedTarget: "none", reason: "LLM_NO_QUESTION_FOUND" };
  }

  // E. Does it contain multiple competing clinical questions or targets?
  const questionMarks = (clean.match(/\?/g) || []).length;
  if (questionMarks > 1) {
    return { isValid: false, detectedTarget: "multiple", reason: "LLM_MULTIPLE_QUESTIONS" };
  }

  // Extract the interrogative clause/sentence containing '?' so that empathetic acknowledgements
  // in earlier sentences do not trigger false multi-target rejections when combined with the question.
  let questionClause = clean;
  const qMarkIndex = clean.lastIndexOf("?");
  if (qMarkIndex !== -1) {
    const priorPeriod = Math.max(clean.lastIndexOf(".", qMarkIndex), clean.lastIndexOf("!", qMarkIndex));
    questionClause = priorPeriod !== -1 ? clean.slice(priorPeriod + 1, qMarkIndex + 1).trim() : clean.slice(0, qMarkIndex + 1).trim();
  }

  const distinctTargets = detectQuestionTargetSlots(questionClause);
  if (distinctTargets.length > 1) {
    // Permit closely related clinical subfields within a single focused inquiry (strictly 2 related facets)
    const isRelated =
      distinctTargets.length === 2 &&
      ((distinctTargets.includes("timing_pattern") && distinctTargets.includes("orthostatic_timing")) ||
       (distinctTargets.includes("dizziness_character") && distinctTargets.includes("orthostatic_timing")) ||
       (distinctTargets.includes("course") && distinctTargets.includes("orthostatic_timing")) ||
       (distinctTargets.includes("course") && distinctTargets.includes("triggers")) ||
       (distinctTargets.includes("course") && distinctTargets.includes("timing_pattern")) ||
       (distinctTargets.includes("weakness_distribution") && distinctTargets.includes("laterality")) ||
       (distinctTargets.includes("numbness_distribution") && distinctTargets.includes("laterality")) ||
       (distinctTargets.includes("weakness_distribution") && distinctTargets.includes("weakness")) ||
       (distinctTargets.includes("numbness_distribution") && distinctTargets.includes("numbness")) ||
       (distinctTargets.includes("weakness_distribution") && distinctTargets.includes("neurological_signs")) ||
       (distinctTargets.includes("numbness_distribution") && distinctTargets.includes("neurological_signs")));

    if (!isRelated) {
      return {
        isValid: false,
        detectedTarget: "multiple",
        reason: `LLM_MULTIPLE_CLINICAL_TARGETS: ${distinctTargets.join(", ")}`,
      };
    }
  }

  // Detect the target slot of the generated question clause
  const detectedTarget = detectQuestionTargetSlot(questionClause);

  // C. Does the generated question violate responsePlan.mustAvoidAsking?
  const mustAvoid = plan?.mustAvoidAsking || [];
  const lower = clean.toLowerCase();

  for (const item of mustAvoid) {
    const itemLower = item.toLowerCase().trim();
    if (!itemLower) continue;

    // Check direct slot match
    if (itemLower === detectedTarget || isTargetSlotMatch(itemLower, detectedTarget)) {
      return {
        isValid: false,
        detectedTarget,
        reason: `LLM_MUST_AVOID_SLOT_VIOLATION: target slot '${detectedTarget}' is in mustAvoidAsking`,
      };
    }

    // Check forbidden phrase match (for multi-word phrases within the question clause)
    if (itemLower.includes(" ") && itemLower.length >= 6 && questionClause.toLowerCase().includes(itemLower)) {
      return {
        isValid: false,
        detectedTarget,
        reason: `LLM_MUST_AVOID_PHRASE_VIOLATION: question contains forbidden phrase '${item}'`,
      };
    }
  }

  // D. Does it repeat a resolved or denied dimension?
  const denied = deniedSymptoms || memory?.deniedSymptoms || [];
  for (const d of denied) {
    const dLower = d.toLowerCase().trim();
    if (dLower === detectedTarget) {
      return {
        isValid: false,
        detectedTarget,
        reason: `LLM_REPEATED_DENIED_DIMENSION: symptom '${d}' was already denied by patient`,
      };
    }
    if (dLower.length >= 4 && lower.includes(dLower) && lower.includes("?")) {
      return {
        isValid: false,
        detectedTarget,
        reason: `LLM_REPEATED_DENIED_DIMENSION: question re-asks about denied symptom '${d}'`,
      };
    }
  }

  // Check subfields resolved (unless patient is explicitly offering a self-correction):
  const isSelfCorrection = Boolean(plan?.patientUtterance && /\b(?:correct|correction|not constant|need to correct|instead|said earlier|actually)\b/i.test(plan.patientUtterance));
  if (slots && !isSelfCorrection) {
    const subfields = extractSubfieldState(slots, confirmedFacts || slots.known_facts || [], memory);

    // If duration is resolved, cannot ask onset timeline again
    if (subfields.onset.duration && (detectedTarget === "onset" || detectedTarget === "onset_time")) {
      return {
        isValid: false,
        detectedTarget,
        reason: "LLM_REPEATED_RESOLVED_DIMENSION: onset duration is already resolved",
      };
    }

    // If onset pattern (sudden vs gradual) is resolved, cannot ask onset pattern again
    if (subfields.onset.onsetPattern !== "unknown" && detectedTarget === "onset_pattern") {
      return {
        isValid: false,
        detectedTarget,
        reason: "LLM_REPEATED_RESOLVED_DIMENSION: onset pattern is already resolved",
      };
    }

    // If severity is resolved, cannot ask severity again
    if (subfields.characterSeverity.severity && detectedTarget === "severity") {
      return {
        isValid: false,
        detectedTarget,
        reason: "LLM_REPEATED_RESOLVED_DIMENSION: pain severity is already resolved",
      };
    }

    // If character is resolved, cannot ask character again
    if (subfields.characterSeverity.character && detectedTarget === "character") {
      return {
        isValid: false,
        detectedTarget,
        reason: "LLM_REPEATED_RESOLVED_DIMENSION: symptom character is already resolved",
      };
    }

    if (slots.location && (detectedTarget === "abdominal_location" || detectedTarget === "location")) {
      return {
        isValid: false,
        detectedTarget,
        reason: "LLM_REPEATED_RESOLVED_DIMENSION: abdominal location is already resolved",
      };
    }
  }

  // F. CLINICAL RELEVANCE GUARD: Reject questions introducing unsupported symptoms or domains
  const expectedTopic = plan?.nextHighValueInquiry?.topic?.toLowerCase() || "";
  const expectedPhrasing = plan?.nextHighValueInquiry?.suggestedPhrasing?.toLowerCase() || "";
  const factsText = (confirmedFacts || slots?.known_facts || []).join(" ").toLowerCase();
  const chiefComplaint = String(slots?.chief_complaint || "").toLowerCase();
  const location = String(slots?.location || "").toLowerCase();

  const patientUtterance = plan?.patientUtterance?.toLowerCase() || "";

  // 1. Unsupported Chest Discomfort / Cardiac Radiation
  const asksChestOrCardiac = /\b(chest|precordial|substernal|angina|heart\s+attack)\b/i.test(lower) ||
    (/\b(radiat|travel|spread)\b/i.test(lower) && /\b(arm|jaw|neck|back)\b/i.test(lower));
  const hasChestSupport = location === "chest" ||
    /\b(chest|heart|angina|substernal)\b/i.test(factsText) ||
    /\b(chest|heart|angina)\b/i.test(chiefComplaint) ||
    /\b(chest|heart|angina|cardiac|coronary|infarct)\b/i.test(patientUtterance) ||
    expectedTopic === "radiation" ||
    expectedTopic === "exertional" ||
    expectedTopic === "chest" ||
    /\b(chest|heart|substernal)\b/i.test(expectedPhrasing);

  if (asksChestOrCardiac && !hasChestSupport) {
    return {
      isValid: false,
      detectedTarget: "radiation",
      reason: "LLM_UNSUPPORTED_SYMPTOM: chest discomfort or radiation is unsupported by clinical state or presenting complaint",
    };
  }

  // 2. Unsupported Neurological / Stroke Deficits
  const asksStrokeOrNeuro = /\b(facial\s+droop|slurred\s+speech|stroke|one\s+side\s+of\s+your\s+body|arm\s+(?:or\s+leg\s+)?weakness|weakness\s+in\s+your\s+arm)\b/i.test(lower);
  const hasNeuroSupport = (slots?.neurological_signs && slots.neurological_signs.length > 0) ||
    location === "head" ||
    location === "brain" ||
    /\b(stroke|headache|weakness|numbness|droop|speech|dizz)\b/i.test(factsText) ||
    /\b(stroke|headache|weakness|numbness|droop|speech|dizz)\b/i.test(chiefComplaint) ||
    /\b(stroke|headache|weakness|numbness|droop|speech|dizz|facial|arm|leg)\b/i.test(patientUtterance) ||
    expectedTopic === "weakness_distribution" ||
    expectedTopic === "neurological_signs" ||
    expectedTopic === "laterality" ||
    /\b(weakness|numbness|droop|speech)\b/i.test(expectedPhrasing);

  if (asksStrokeOrNeuro && !hasNeuroSupport) {
    return {
      isValid: false,
      detectedTarget: "neurological_signs",
      reason: "LLM_UNSUPPORTED_SYMPTOM: stroke / neurological deficit inquiry is unsupported by clinical state",
    };
  }

  // 3. Unsupported Abdominal / GI Symptoms
  const asksAbdominal = /\b(abdomen|abdominal|belly|stomach\s+pain|quadrant|bowel\s+movement)\b/i.test(lower);
  const hasAbdominalSupport = location === "abdomen" ||
    location === "stomach" ||
    /\b(abdom|belly|stomach|gut|nausea|vomit)\b/i.test(factsText) ||
    /\b(abdom|belly|stomach|gut|nausea|vomit)\b/i.test(chiefComplaint) ||
    expectedTopic.includes("abdom") ||
    /\b(abdom|belly|stomach)\b/i.test(expectedPhrasing);

  if (asksAbdominal && !hasAbdominalSupport) {
    return {
      isValid: false,
      detectedTarget: "abdominal_inquiry",
      reason: "LLM_UNSUPPORTED_SYMPTOM: abdominal/GI symptoms are unsupported by clinical state",
    };
  }

  // B. Does the detected question target match responsePlan.nextHighValueInquiry.topic or active grounded narrative?
  if (plan?.nextHighValueInquiry?.topic) {
    const expTopic = plan.nextHighValueInquiry.topic;
    if (!isTargetSlotMatch(expTopic, detectedTarget)) {
      // Check if candidate target is clinically grounded in active presentation, facts, or patient narrative
      const narrative = (((plan as any)?.patientUtterance || "") + " " + factsText + " " + chiefComplaint).toLowerCase();
      const isGrounded =
        /radiat|spread|travel|neck|shoulder|arm|jaw/i.test(detectedTarget) ||
        /character|quality|sensation|throbbing|pressure|sharp|dull/i.test(detectedTarget) ||
        /severity|scale|intensity/i.test(detectedTarget) ||
        /trigger|aggravat|reliev|worse|better|provok/i.test(detectedTarget) ||
        /nausea|vomit|eating|appetite|gi/i.test(detectedTarget) ||
        /tinnitus|ringing|ear/i.test(detectedTarget) ||
        /muscle|tension|tightness/i.test(detectedTarget) ||
        /voice|speech|swallow/i.test(detectedTarget) ||
        (detectedTarget.includes("orthostatic") && /stand|sit|walk|rest|postur/i.test(narrative)) ||
        (detectedTarget.includes("dizz") && /dizz|unsteady|spinning|lighthead/i.test(narrative)) ||
        (detectedTarget.includes("numb") && /numb|tingl|pins|sens/i.test(narrative)) ||
        (detectedTarget.includes("head") && /head|migrain/i.test(narrative)) ||
        (detectedTarget.includes("weak") && /weak|droop|heav/i.test(narrative)) ||
        (detectedTarget.includes("vision") && /vision|see|blur|sight/i.test(narrative)) ||
        (detectedTarget.includes("hearing") && /hear|ear|sound/i.test(narrative)) ||
        (detectedTarget.includes("throat") && /throat|swallow/i.test(narrative)) ||
        (detectedTarget.includes("timing") || detectedTarget.includes("pattern") || detectedTarget.includes("duration") || detectedTarget.includes("course") || detectedTarget.includes("onset")) ||
        (!Boolean((plan as any)?.strictTargetSlot) && narrative.trim().length > 0 && detectedTarget !== "none" && detectedTarget !== "empty");

      if (!isGrounded || (plan as any)?.strictTargetSlot === true) {
        return {
          isValid: false,
          detectedTarget,
          reason: `LLM_QUESTION_TARGET_MISMATCH: expected '${expTopic}', detected '${detectedTarget}'`,
        };
      }
    }
  }

  // G. FALSE EMERGENCY ESCALATION GUARD:
  // In a non-emergency intake, reject LLM replies that fabricate an emergency directive or demand immediate ambulance dispatch
  if (/\b(this is a medical emergency|life-threatening emergency|call 112 or 108 immediately|emergency transport)\b/i.test(lower)) {
    return {
      isValid: false,
      detectedTarget,
      reason: "LLM_FALSE_EMERGENCY_ESCALATION: generated emergency directive in non-emergency case",
    };
  }

  return { isValid: true, detectedTarget };
}

