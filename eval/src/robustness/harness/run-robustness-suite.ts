/**
 * MedVoice AI: Phase 2 Robustness & Adversarial Generalization Test Harness
 * 
 * Executes the 345-case adversarial and perturbation evaluation matrix against
 * the FROZEN commit 000abeb baseline engine.
 * 
 * Invariants:
 * 1. ZERO modification to `lib/triage/universal-red-flags.ts`.
 * 2. Full classification of all failures into the failure ledger.
 * 3. Cluster-aware sensitivity calculation over the 29 parent emergency clusters.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { evaluateSafetyArbiter } from '../../../../lib/triage/safety-arbiter';
import {
  RobustnessTestCase,
  RobustnessEvaluationRecord,
  SafetyDecision,
  RobustnessFailureLedger,
  FailureClassification,
} from '../types';
import { calculateClusterMetrics } from './cluster-statistics';

const fixturesDir = path.resolve('eval/src/robustness/fixtures');

export function computeNormalizedSha256(content: string): string {
  const normalized = content.replace(/\r\n?/g, '\n');
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

export function computeFileSha256(filePath: string): string {
  const content = fs.readFileSync(filePath, 'utf8');
  return computeNormalizedSha256(content);
}

function loadFixtures(filename: string): RobustnessTestCase[] {
  const filePath = path.join(fixturesDir, filename);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

async function runRobustnessBattery() {
  console.log('================================================================================');
  console.log('  MEDVOICE AI: PHASE 2 ADVERSARIAL & ROBUSTNESS GENERALIZATION BATTERY          ');
  console.log('  Target Corpus: 345 Test Cases across 5 Rigorous Evaluation Tracks            ');
  console.log('  Baseline Engine: Commit 000abeb (FROZEN — EMPIRICAL FAILURE DISCOVERY MODE)   ');
  console.log('================================================================================\n');

  // Verify frozen safety engine integrity via source file SHA-256 hashes against frozen baseline 000abeb
  // Uses canonical LF line ending normalization to remain OS-agnostic across Linux CI (LF) and Windows (CRLF)
  const EXPECTED_ENGINE_HASHES = {
    universalRedFlags: '8b0031c51bfea3753405d29cbf5956047af70335dd409ef697923350effd6ec4',
    safetyArbiter: '26f244fa42b3f043cf1f51dbe4be0f8f17fe3b0a57a01afda10b2e0d494ce639',
  };

  const redFlagsPath = path.resolve('lib/triage/universal-red-flags.ts');
  const safetyArbiterPath = path.resolve('lib/triage/safety-arbiter.ts');
  const redFlagsSha = computeFileSha256(redFlagsPath);
  const safetyArbiterSha = computeFileSha256(safetyArbiterPath);

  const isRedFlagsMatch = redFlagsSha === EXPECTED_ENGINE_HASHES.universalRedFlags;
  const isSafetyArbiterMatch = safetyArbiterSha === EXPECTED_ENGINE_HASHES.safetyArbiter;
  const engineVerified = isRedFlagsMatch && isSafetyArbiterMatch;

  console.log(`[Safety Engine Integrity Audit]:`);
  console.log(`  • universal-red-flags.ts SHA-256: ${redFlagsSha} [${isRedFlagsMatch ? 'VERIFIED MATCH' : 'MISMATCH'}]`);
  console.log(`  • safety-arbiter.ts      SHA-256: ${safetyArbiterSha} [${isSafetyArbiterMatch ? 'VERIFIED MATCH' : 'MISMATCH'}]\n`);

  if (!engineVerified) {
    throw new Error(
      `[CRITICAL INVARIANT VIOLATION] Frozen safety engine integrity check failed!\n` +
      `  universal-red-flags.ts: expected ${EXPECTED_ENGINE_HASHES.universalRedFlags}, got ${redFlagsSha}\n` +
      `  safety-arbiter.ts:      expected ${EXPECTED_ENGINE_HASHES.safetyArbiter}, got ${safetyArbiterSha}`
    );
  }

  const canonical29 = loadFixtures('canonical_emergencies_29.json');
  const paraphrases145 = loadFixtures('adversarial_paraphrases_145.json');
  const controls21 = loadFixtures('non_emergency_controls_21.json');
  const perturbations100 = loadFixtures('text_perturbations_100.json');
  const negation50 = loadFixtures('negation_ambiguity_suite_50.json');

  const allTestCases: RobustnessTestCase[] = [
    ...canonical29,
    ...paraphrases145,
    ...controls21,
    ...perturbations100,
    ...negation50,
  ];

  console.log(`Loaded ${allTestCases.length} total test cases across 5 tracks:`);
  console.log(`  • Track A: Canonical Emergencies        : ${canonical29.length} cases`);
  console.log(`  • Track B: Colloquial Paraphrases       : ${paraphrases145.length} cases (across 29 clusters)`);
  console.log(`  • Track C: Non-Emergency Controls      : ${controls21.length} cases`);
  console.log(`  • Track D: Synthetic Text Perturbations : ${perturbations100.length} cases (20 parents x 5 variants)`);
  console.log(`  • Track E: Negation & Ambiguity Suite   : ${negation50.length} cases\n`);

  const evaluationRecords: RobustnessEvaluationRecord[] = [];
  const parentConditionMap: Record<string, string> = {};

  for (const c of canonical29) {
    parentConditionMap[c.parent_scenario_id] = c.target_emergency_condition;
  }

  let l1Misses = 0;
  let arbiterLayer1Misses = 0;
  let negationLeakages = 0;
  let falseAlarms = 0;

  for (let i = 0; i < allTestCases.length; i++) {
    const tc = allTestCases[i];

    // Evaluate deterministic safety arbiter against baseline engine
    const arbiterResult = evaluateSafetyArbiter({
      rawText: tc.patient_utterance,
      llmSuggestedLevel: 'routine', // Stress test with simulated adverse downplay
    });

    const actualEscalation = arbiterResult.isEmergency;
    const isConcordant = actualEscalation === tc.expected_emergency_escalation;

    let failureClass: FailureClassification | undefined = undefined;
    let failureReason: string | undefined = undefined;

    if (!isConcordant) {
      if (tc.expected_emergency_escalation && !actualEscalation) {
        // Emergency presentation missed
        if (tc.track === 'B_COLLOQUIAL') {
          failureClass = 'L1_DETECTION_GAP';
          failureReason = `Colloquial / indirect phrasing not captured by Layer 1 regex: "${tc.patient_utterance}"`;
          l1Misses++;
          arbiterLayer1Misses++;
        } else if (tc.track === 'D_PERTURBATION') {
          failureClass = 'PHONETIC_CORRUPTION_MISS';
          failureReason = `Text perturbation or typo broke keyword matching: "${tc.patient_utterance}"`;
          l1Misses++;
          arbiterLayer1Misses++;
        } else {
          failureClass = 'ARBITER_LAYER1_MISS';
          failureReason = `Canonical emergency presentation missed by Layer 1 arbiter: "${tc.patient_utterance}"`;
          arbiterLayer1Misses++;
        }
      } else if (!tc.expected_emergency_escalation && actualEscalation) {
        // Non-emergency falsely escalated
        if (tc.track === 'E_NEGATION') {
          failureClass = 'NEGATION_LEAKAGE';
          failureReason = `Negated or 3rd-party term triggered false emergency: "${tc.patient_utterance}"`;
          negationLeakages++;
        } else {
          failureClass = 'OVER_TRIAGE_FALSE_ALARM';
          failureReason = `Non-emergent control over-triaged to emergency: "${tc.patient_utterance}"`;
          falseAlarms++;
        }
      }
    }

    const safetyDecision: SafetyDecision = {
      emergencyEscalationRequired: actualEscalation,
      highRiskPresentation: actualEscalation || arbiterResult.redFlagsTriggered.length > 0,
      establishedAcuityFloor: actualEscalation ? 'HIGH_RISK' : 'NONE',
      escalationReasons: arbiterResult.redFlagsTriggered,
      arbiterOverrideApplied: arbiterResult.arbiterOverride,
      esiLevel: null, // Decoupled: Arbiter establishes safety floor, not formal ESI triage
      esiAssessmentStatus: 'NOT_ASSESSED',
      decisionLatencyMs: arbiterResult.latencyMs,
      unresolvedRedFlags: arbiterResult.unresolvedRedFlags,
      universalRedFlagsTriggered: (arbiterResult.universalRedFlagResult?.firedRules || []).map((r) => r.ruleId),
      auditTimestamp: new Date().toISOString(),
    };

    evaluationRecords.push({
      test_case_id: tc.test_case_id,
      parent_scenario_id: tc.parent_scenario_id,
      track: tc.track,
      variant_type: tc.variant_type,
      patient_utterance: tc.patient_utterance,
      expected_escalation: tc.expected_emergency_escalation,
      actual_escalation: actualEscalation,
      is_concordant: isConcordant,
      failure_classification: failureClass,
      failure_reason: failureReason,
      safety_decision: safetyDecision,
    });
  }

  // Track-level aggregations
  const trackA = evaluationRecords.filter((r) => r.track === 'A_CANONICAL');
  const trackB = evaluationRecords.filter((r) => r.track === 'B_COLLOQUIAL');
  const trackC = evaluationRecords.filter((r) => r.track === 'C_CONTROL');
  const trackD = evaluationRecords.filter((r) => r.track === 'D_PERTURBATION');
  const trackE = evaluationRecords.filter((r) => r.track === 'E_NEGATION');

  const recA = (trackA.filter((r) => r.is_concordant).length / trackA.length) * 100;
  const recB = (trackB.filter((r) => r.is_concordant).length / trackB.length) * 100;
  const specC = (trackC.filter((r) => r.is_concordant).length / trackC.length) * 100;
  const recD = (trackD.filter((r) => r.is_concordant).length / trackD.length) * 100;
  const specE = (trackE.filter((r) => r.is_concordant).length / trackE.length) * 100;

  // Clustered analysis on Track B alone (Paraphrases across the 29 parent clusters)
  const clusteredMetrics = calculateClusterMetrics(
    trackB,
    parentConditionMap,
    2000,
    42
  );

  const failures = evaluationRecords.filter((r) => !r.is_concordant);

  console.log('='.repeat(80));
  console.log('                      PHASE 2 ROBUSTNESS EVALUATION REPORT');
  console.log('='.repeat(80));
  console.log(`  Total Cases Evaluated            : ${evaluationRecords.length}`);
  console.log(`  Total Concordant Cases           : ${evaluationRecords.length - failures.length} (${(((evaluationRecords.length - failures.length) / evaluationRecords.length) * 100).toFixed(1)}%)`);
  console.log(`  Total Documented Failures        : ${failures.length} (Cataloged in failure ledger)`);
  console.log('-'.repeat(80));
  console.log('  TRACK-BY-TRACK PERFORMANCE BREAKDOWN:');
  console.log(`    • Track A: Canonical Emergencies        : ${recA.toFixed(1)}% recall (${trackA.filter((r) => r.is_concordant).length}/${trackA.length})`);
  console.log(`    • Track B: Colloquial Paraphrases       : ${recB.toFixed(1)}% recall (${trackB.filter((r) => r.is_concordant).length}/${trackB.length})`);
  console.log(`    • Track C: Non-Emergency Controls      : ${specC.toFixed(1)}% specificity (${trackC.filter((r) => r.is_concordant).length}/${trackC.length})`);
  console.log(`    • Track D: Synthetic Text Perturbations : ${recD.toFixed(1)}% recall (${trackD.filter((r) => r.is_concordant).length}/${trackD.length}) [Synthetic lexical/character perturbations, non-acoustic]`);
  console.log(`    • Track E: Negation & Ambiguity Suite   : ${specE.toFixed(1)}% specificity (${trackE.filter((r) => r.is_concordant).length}/${trackE.length})`);
  console.log('-'.repeat(80));
  console.log('  CLUSTERED SENSITIVITY ANALYSIS (M = 29 Parent Clusters, Cluster Bootstrap 2000 Iterations):');
  console.log(`    • Observed Mean Cluster Sensitivity    : ${clusteredMetrics.observed_cluster_sensitivity}%`);
  console.log(`    • Cluster 95% Confidence Interval       : [${clusteredMetrics.cluster_ci95_lower}%, ${clusteredMetrics.cluster_ci95_upper}%]`);
  console.log(`    • Between-Cluster Variance             : ${clusteredMetrics.between_cluster_variance}`);
  console.log('-'.repeat(80));
  console.log('  OBSERVED FAILURE TAXONOMY:');
  console.log(`    • Layer 1 Regex Gaps (Colloquial Misses): ${l1Misses}`);
  console.log(`    • Deterministic Arbiter Misses (L1)    : ${arbiterLayer1Misses}`);
  console.log(`    • Negation Leakage (False Alarms)      : ${negationLeakages}`);
  console.log(`    • Non-Emergency Over-Triage False Alarm: ${falseAlarms}`);
  console.log('='.repeat(80) + '\n');

  // Build Failure Ledger Artifact
  const ledger: RobustnessFailureLedger = {
    evaluation_id: `ROBUSTNESS-EVAL-${Date.now()}`,
    timestamp: new Date().toISOString(),
    baseline_commit: '000abeb',
    engine_integrity: {
      universal_red_flags_sha256: redFlagsSha,
      safety_arbiter_sha256: safetyArbiterSha,
      engine_frozen_verified: true,
    },
    total_evaluated: evaluationRecords.length,
    total_failures: failures.length,
    summary_metrics: {
      canonical_emergencies_recall: Number(recA.toFixed(1)),
      colloquial_paraphrases_recall: Number(recB.toFixed(1)),
      non_emergency_specificity: Number(specC.toFixed(1)),
      negation_test_specificity: Number(specE.toFixed(1)),
      perturbation_test_recall: Number(recD.toFixed(1)),
      l1_regex_miss_count: l1Misses,
      arbiter_layer1_miss_count: arbiterLayer1Misses,
      negation_leakage_count: negationLeakages,
    },
    clustered_sensitivity_analysis: clusteredMetrics,
    cataloged_failures: failures,
  };

  const resultsDir = path.resolve('eval/results');
  if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });

  const ledgerPath = path.join(resultsDir, 'robustness_failure_ledger.json');
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2), 'utf8');
  console.log(`[Audit Evidence Artifact] Saved complete failure ledger to: ${ledgerPath}\n`);
}

if (process.argv[1] && process.argv[1].includes('run-robustness-suite')) {
  runRobustnessBattery().catch((err) => {
    console.error('Robustness battery execution failed:', err);
    process.exit(1);
  });
}
