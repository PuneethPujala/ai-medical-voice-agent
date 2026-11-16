import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateClusterMetrics } from '../../eval/src/robustness/harness/cluster-statistics';
import { RobustnessEvaluationRecord } from '../../eval/src/robustness/types';

test('Cluster-Aware Statistical Analysis Engine Battery', async (t) => {
  await t.test('1. Pooled sensitivity equals mean cluster sensitivity when cluster sizes are balanced', () => {
    // 2 clusters, each with 2 cases (total 4)
    // Cluster 1: 2/2 detected (100%)
    // Cluster 2: 0/2 detected (0%)
    // Mean cluster sensitivity = (1.0 + 0.0) / 2 = 50.0%
    // Pooled sensitivity = 2 / 4 = 50.0%
    const mockRecords: RobustnessEvaluationRecord[] = [
      {
        test_case_id: 'C1-V1',
        parent_scenario_id: 'PARENT-1',
        track: 'B_COLLOQUIAL',
        variant_type: 'colloquial_paraphrase',
        patient_utterance: 'test',
        expected_escalation: true,
        actual_escalation: true,
        is_concordant: true,
        safety_decision: {} as any,
      },
      {
        test_case_id: 'C1-V2',
        parent_scenario_id: 'PARENT-1',
        track: 'B_COLLOQUIAL',
        variant_type: 'colloquial_paraphrase',
        patient_utterance: 'test',
        expected_escalation: true,
        actual_escalation: true,
        is_concordant: true,
        safety_decision: {} as any,
      },
      {
        test_case_id: 'C2-V1',
        parent_scenario_id: 'PARENT-2',
        track: 'B_COLLOQUIAL',
        variant_type: 'colloquial_paraphrase',
        patient_utterance: 'test',
        expected_escalation: true,
        actual_escalation: false,
        is_concordant: false,
        safety_decision: {} as any,
      },
      {
        test_case_id: 'C2-V2',
        parent_scenario_id: 'PARENT-2',
        track: 'B_COLLOQUIAL',
        variant_type: 'colloquial_paraphrase',
        patient_utterance: 'test',
        expected_escalation: true,
        actual_escalation: false,
        is_concordant: false,
        safety_decision: {} as any,
      },
    ];

    const parentMap = { 'PARENT-1': 'Heart Attack', 'PARENT-2': 'Stroke' };
    const metrics = calculateClusterMetrics(mockRecords, parentMap, 1000, 42);

    assert.equal(metrics.total_cases, 4);
    assert.equal(metrics.total_clusters, 2);
    assert.equal(metrics.observed_cluster_sensitivity, 50.0);
    // Between cluster variance for [1.0, 0.0] with mean 0.5:
    // s^2 = ((1 - 0.5)^2 + (0 - 0.5)^2) / (2 - 1) = (0.25 + 0.25) / 1 = 0.5
    assert.equal(metrics.between_cluster_variance, 0.5);
  });

  await t.test('2. Deterministic bootstrap reproducibility with constant seed', () => {
    const mockRecords: RobustnessEvaluationRecord[] = [
      {
        test_case_id: 'C1-V1',
        parent_scenario_id: 'P1',
        track: 'B_COLLOQUIAL',
        variant_type: 'colloquial_paraphrase',
        patient_utterance: 't1',
        expected_escalation: true,
        actual_escalation: true,
        is_concordant: true,
        safety_decision: {} as any,
      },
      {
        test_case_id: 'C2-V1',
        parent_scenario_id: 'P2',
        track: 'B_COLLOQUIAL',
        variant_type: 'colloquial_paraphrase',
        patient_utterance: 't2',
        expected_escalation: true,
        actual_escalation: false,
        is_concordant: false,
        safety_decision: {} as any,
      },
      {
        test_case_id: 'C3-V1',
        parent_scenario_id: 'P3',
        track: 'B_COLLOQUIAL',
        variant_type: 'colloquial_paraphrase',
        patient_utterance: 't3',
        expected_escalation: true,
        actual_escalation: true,
        is_concordant: true,
        safety_decision: {} as any,
      },
    ];

    const run1 = calculateClusterMetrics(mockRecords, {}, 500, 42);
    const run2 = calculateClusterMetrics(mockRecords, {}, 500, 42);

    assert.equal(run1.observed_cluster_sensitivity, run2.observed_cluster_sensitivity);
    assert.equal(run1.cluster_ci95_lower, run2.cluster_ci95_lower);
    assert.equal(run1.cluster_ci95_upper, run2.cluster_ci95_upper);
    assert.equal(run1.between_cluster_variance, run2.between_cluster_variance);
  });

  await t.test('3. Correctly partitions missed variants and computes cluster-specific recall', () => {
    const mockRecords: RobustnessEvaluationRecord[] = [
      {
        test_case_id: 'P1-V1',
        parent_scenario_id: 'P1',
        track: 'B_COLLOQUIAL',
        variant_type: 'colloquial_paraphrase',
        patient_utterance: 't1',
        expected_escalation: true,
        actual_escalation: true,
        is_concordant: true,
        safety_decision: {} as any,
      },
      {
        test_case_id: 'P1-V2',
        parent_scenario_id: 'P1',
        track: 'B_COLLOQUIAL',
        variant_type: 'colloquial_paraphrase',
        patient_utterance: 't2',
        expected_escalation: true,
        actual_escalation: false,
        is_concordant: false,
        safety_decision: {} as any,
      },
    ];

    const metrics = calculateClusterMetrics(mockRecords, { P1: 'Asthma' }, 100, 42);
    assert.equal(metrics.failure_breakdown_by_parent['P1'].variants_tested, 2);
    assert.equal(metrics.failure_breakdown_by_parent['P1'].variants_escalated, 1);
    assert.equal(metrics.failure_breakdown_by_parent['P1'].recall_percent, 50.0);
    assert.deepEqual(metrics.failure_breakdown_by_parent['P1'].missed_variants, ['P1-V2']);
  });
});
