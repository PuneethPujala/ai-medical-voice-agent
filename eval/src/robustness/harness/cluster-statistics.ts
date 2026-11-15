/**
 * Cluster-Aware Statistical Analysis Engine for Clinical Robustness
 * 
 * Corrects for intra-cluster correlation among paraphrases derived from 
 * the same parent clinical scenario using cluster bootstrap resampling.
 */

import { RobustnessEvaluationRecord, ClusteredMetrics } from '../types';

export function calculateClusterMetrics(
  records: RobustnessEvaluationRecord[],
  parentConditionMap: Record<string, string>,
  bootstrapIterations = 2000,
  randomSeed = 42
): ClusteredMetrics {
  // 1. Group records by parent_scenario_id
  const clusterMap: Record<string, RobustnessEvaluationRecord[]> = {};
  for (const r of records) {
    if (!clusterMap[r.parent_scenario_id]) {
      clusterMap[r.parent_scenario_id] = [];
    }
    clusterMap[r.parent_scenario_id].push(r);
  }

  const clusterIds = Object.keys(clusterMap);
  const clusterSensitivities: number[] = [];
  const failureBreakdown: ClusteredMetrics['failure_breakdown_by_parent'] = {};

  for (const cid of clusterIds) {
    const clusterRecords = clusterMap[cid];
    const emergentCases = clusterRecords.filter((x) => x.expected_escalation);

    if (emergentCases.length === 0) continue;

    const escalated = emergentCases.filter((x) => x.actual_escalation).length;
    const sens = escalated / emergentCases.length;
    clusterSensitivities.push(sens);

    const missed = emergentCases.filter((x) => !x.actual_escalation).map((x) => x.test_case_id);
    failureBreakdown[cid] = {
      parent_condition: parentConditionMap[cid] || "Unknown Emergency",
      variants_tested: emergentCases.length,
      variants_escalated: escalated,
      recall_percent: Number((sens * 100).toFixed(1)),
      missed_variants: missed,
    };
  }

  const meanSensitivity = clusterSensitivities.length > 0
    ? clusterSensitivities.reduce((a, b) => a + b, 0) / clusterSensitivities.length
    : 0;

  // Intra-cluster variance computation
  const clusterVariance = clusterSensitivities.length > 1
    ? clusterSensitivities.reduce((acc, s) => acc + Math.pow(s - meanSensitivity, 2), 0) / (clusterSensitivities.length - 1)
    : 0;

  // 2. Cluster Bootstrap Resampling (resample parent clusters with replacement)
  let s = randomSeed % 2147483647;
  if (s <= 0) s += 2147483646;
  const lcgRng = () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };

  const bootstrapMeans: number[] = [];
  const kClusters = clusterSensitivities.length;

  if (kClusters > 1) {
    for (let b = 0; b < bootstrapIterations; b++) {
      let bSum = 0;
      for (let i = 0; i < kClusters; i++) {
        const sampledIdx = Math.floor(lcgRng() * kClusters);
        bSum += clusterSensitivities[sampledIdx];
      }
      bootstrapMeans.push(bSum / kClusters);
    }
    bootstrapMeans.sort((a, b) => a - b);
  }

  const ciLowerIdx = Math.floor(bootstrapMeans.length * 0.025);
  const ciUpperIdx = Math.floor(bootstrapMeans.length * 0.975);

  const ci95Lower = bootstrapMeans.length > 0 ? bootstrapMeans[ciLowerIdx] * 100 : meanSensitivity * 100;
  const ci95Upper = bootstrapMeans.length > 0 ? bootstrapMeans[ciUpperIdx] * 100 : meanSensitivity * 100;

  return {
    total_cases: records.length,
    total_clusters: kClusters,
    observed_cluster_sensitivity: Number((meanSensitivity * 100).toFixed(1)),
    cluster_ci95_lower: Number(ci95Lower.toFixed(1)),
    cluster_ci95_upper: Number(ci95Upper.toFixed(1)),
    intra_cluster_variance: Number(clusterVariance.toFixed(4)),
    failure_breakdown_by_parent: failureBreakdown,
  };
}
