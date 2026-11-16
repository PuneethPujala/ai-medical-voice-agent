import { RobustnessTrack, RobustnessTestCase } from './types';
import { CandidateFactProposal } from '../../../lib/clinical-knowledge/types';

export type Phase2bAblationConfigId =
  | 'C1_L1_BASELINE'
  | 'C2_EVIDENCE_EXTRACTOR'
  | 'C3_CLINICAL_BOARD'
  | 'C4_PRODUCTION_RUNTIME'
  | 'C4A_FIXTURE_ASSISTED_ORACLE';

export interface StageExecutionResult {
  config_id: Phase2bAblationConfigId;
  config_label?: string;
  escalated: boolean;
  triage_level: string;
  disposition: string;
  esi_level: number | null;
  facts_introduced: string[];
  overrides_applied: boolean;
  latency_ms: number;
  metadata?: Record<string, any>;
}

export interface Phase2bCaseRecord {
  test_case_id: string;
  parent_scenario_id: string;
  track: RobustnessTrack;
  clinical_domain: string;
  target_emergency_condition: string;
  expected_emergency: boolean;
  patient_utterance: string;

  c1_l1_baseline: StageExecutionResult;
  c2_evidence_extractor: StageExecutionResult;
  c3_clinical_board: StageExecutionResult;
  c4a_fixture_assisted: StageExecutionResult;
  c4_production_runtime: StageExecutionResult; // Backward-compatible alias

  // Incremental analysis flags
  c1_baseline_miss: boolean;
  rescued_by_c2: boolean;
  rescued_by_c3: boolean;
  rescued_by_c4: boolean;
  false_escalation_in_c2: boolean;
  false_escalation_in_c3: boolean;
  false_escalation_in_c4: boolean;
}

export interface LatencyMetric {
  mean_ms: number;
  p50_ms: number;
  p95_ms: number;
}

export interface TrackPerformance {
  total: number;
  c1_escalated: number;
  c1_rate: number;
  c2_escalated: number;
  c2_rate: number;
  c3_escalated: number;
  c3_rate: number;
  c4_escalated: number;
  c4_rate: number;
}

export interface Phase2bAblationLedger {
  evaluation_id: string;
  timestamp: string;
  baseline_engine_commit: string;
  engine_hashes: {
    universal_red_flags_sha256: string;
    safety_arbiter_sha256: string;
  };
  total_cases_evaluated: number;
  tracks: {
    track_a_canonical: TrackPerformance;
    track_b_colloquial: TrackPerformance;
    track_c_controls: TrackPerformance;
    track_d_perturbation: TrackPerformance;
    track_e_negation: TrackPerformance;
  };
  rescue_analysis: {
    total_c1_track_b_misses: number; // Baseline 108 misses
    rescued_by_c2: number;
    rescued_by_c2_rate: number;
    rescued_by_c3: number;
    rescued_by_c3_rate: number;
    rescued_by_c4: number;
    rescued_by_c4_rate: number;
    unrescued_count: number;
  };
  false_escalation_analysis: {
    track_c_controls: {
      c1_false_alarms: number;
      c2_false_alarms: number;
      c3_false_alarms: number;
      c4_false_alarms: number;
    };
    track_e_negation: {
      c1_false_alarms: number;
      c2_false_alarms: number;
      c3_false_alarms: number;
      c4_false_alarms: number;
    };
  };
  adverse_downplay_test: {
    total_adversarial_simulations: number;
    c3_post_arbiter_overrides: number;
    c4_post_arbiter_overrides: number;
    forced_downplay_recovery: {
      total_simulations: number;
      c3_recovery_count: number;
      c3_recovery_rate: number;
      c4_recovery_count: number;
      c4_recovery_rate: number;
    };
    non_downgrade_invariant: {
      tested_cohort_description: string;
      total_direct_arbiter_positive_cases: number;
      total_emergency_cases_checked?: number; // Backward-compatible alias
      c3_invariant_violations: number;
      c4a_invariant_violations: number;
      c4_invariant_violations?: number; // Backward-compatible alias
      invariant_strictly_maintained: boolean;
    };
    invariant_maintained: boolean;
  };
  latency_profiles: {
    c1_l1_baseline: LatencyMetric;
    c2_evidence_extractor: LatencyMetric;
    c3_clinical_board: LatencyMetric;
    c4a_fixture_assisted: LatencyMetric;
    c4_production_runtime: LatencyMetric; // Backward-compatible alias
  };
  records: Phase2bCaseRecord[];
}
