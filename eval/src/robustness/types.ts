/**
 * Robustness & Adversarial Generalization Evaluation Types
 * 
 * Formal interfaces for Phase 2 robustness testing, separating:
 * 1. Operational emergency safety floor preemption (deterministic CPU layer)
 * 2. Formal multi-resource ESI assessment (triage deliberative layer)
 * 3. Clustered observation tracking by parent_scenario_id
 */

export interface SafetyDecision {
  emergencyEscalationRequired: boolean;
  highRiskPresentation: boolean;
  establishedAcuityFloor: "HIGH_RISK" | "NONE";
  escalationReasons: string[];
  arbiterOverrideApplied: boolean;

  // Formal ESI triage decoupled from binary red-flag escalation
  esiLevel: 1 | 2 | 3 | 4 | 5 | null;
  esiAssessmentStatus: "NOT_ASSESSED" | "PENDING_CLINICIAN" | "ASSESSED";
  anticipatedResources?: number;

  decisionLatencyMs: number;
  unresolvedRedFlags: string[];
  universalRedFlagsTriggered: string[];
  auditTimestamp: string;
}

export type RobustnessTrack =
  | "A_CANONICAL"
  | "B_COLLOQUIAL"
  | "C_CONTROL"
  | "D_PERTURBATION"
  | "E_NEGATION";

export interface RobustnessTestCase {
  test_case_id: string;
  parent_scenario_id: string; // Links variant back to parent clinical cluster
  track: RobustnessTrack;
  clinical_domain: string;
  target_emergency_condition: string;
  variant_type:
    | "canonical_baseline"
    | "colloquial_paraphrase"
    | "indirect_description"
    | "slang_or_vernacular"
    | "phonetic_typo"
    | "dropped_words"
    | "transcription_corruption"
    | "third_party_attribution"
    | "historical_resolved"
    | "non_emergent_control";
  patient_utterance: string;
  expected_safety_floor: "HIGH_RISK" | "NONE";
  expected_emergency_escalation: boolean;
  negation_context?: {
    is_negated: boolean;
    negation_cue?: string;
    attribution?: "self" | "third_party" | "historical";
  };
  clinical_rationale: string;
}

export type FailureClassification =
  | "L1_DETECTION_GAP"              // Layer 1 regex missed colloquial/perturbed symptom
  | "END_TO_END_UNDER_TRIAGE"       // All layers failed; emergency not escalated
  | "NEGATION_LEAKAGE"              // Negated or 3rd-party term triggered false emergency
  | "PHONETIC_CORRUPTION_MISS"      // STT typo broke detection
  | "OVER_TRIAGE_FALSE_ALARM"       // Non-emergency control inappropriately escalated
  | "SUB_ACUTE_MISCLASSIFICATION";  // Urgent/routine priority inversion

export interface RobustnessEvaluationRecord {
  test_case_id: string;
  parent_scenario_id: string;
  track: RobustnessTrack;
  variant_type: string;
  patient_utterance: string;
  expected_escalation: boolean;
  actual_escalation: boolean;
  is_concordant: boolean;
  failure_classification?: FailureClassification;
  failure_reason?: string;
  safety_decision: SafetyDecision;
}

export interface ClusteredMetrics {
  total_cases: number;
  total_clusters: number;
  observed_cluster_sensitivity: number; // Mean sensitivity across parent clusters
  cluster_ci95_lower: number;          // Cluster bootstrap 95% CI lower
  cluster_ci95_upper: number;          // Cluster bootstrap 95% CI upper
  intra_cluster_variance: number;
  failure_breakdown_by_parent: Record<string, {
    parent_condition: string;
    variants_tested: number;
    variants_escalated: number;
    recall_percent: number;
    missed_variants: string[];
  }>;
}

export interface RobustnessFailureLedger {
  evaluation_id: string;
  timestamp: string;
  baseline_commit: string;
  total_evaluated: number;
  total_failures: number;
  summary_metrics: {
    canonical_emergencies_recall: number;
    colloquial_paraphrases_recall: number;
    non_emergency_specificity: number;
    negation_test_specificity: number;
    perturbation_test_recall: number;
    l1_regex_miss_count: number;
    end_to_end_under_triage_count: number;
    negation_leakage_count: number;
  };
  clustered_sensitivity_analysis: ClusteredMetrics;
  cataloged_failures: RobustnessEvaluationRecord[];
}
