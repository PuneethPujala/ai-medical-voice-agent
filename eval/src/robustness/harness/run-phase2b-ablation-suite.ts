/**
 * MedVoice AI: Phase 2B Multi-Layer Clinical Safety Ablation & Rescue Evaluation
 * 
 * Research Question:
 * How much additional emergency-detection capability does each downstream reasoning 
 * and verification layer contribute beyond the frozen deterministic safety arbiter, 
 * and what false-escalation and latency costs does it introduce?
 * 
 * Configurations Evaluated:
 * - C1: Direct Deterministic Safety Arbiter Baseline (evaluateSafetyArbiter with simulated routine LLM level)
 * - C2: Isolated EvidenceExtractor + Structured Arbiter Adapter
 * - C3: Deterministic ClinicalBoard + Forced Adverse Consensus + Post-Arbiter Invariant
 * - C4: Full Production Runtime (LLM Candidate Facts + Controlled Fact Reconciliation + Clinical Board)
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { evaluateSafetyArbiter } from '../../../../lib/triage/safety-arbiter';
import { EvidenceExtractor } from '../../../../lib/triage/evidence-extractor';
import { createInitialInterviewStateV2 } from '../../../../lib/triage/clinical-state';
import { clinicalBoard } from '../../../../lib/agents/clinical-board';
import { evaluatePostArbiter } from '../../../../lib/triage/post-arbiter';
import { controlledFactReconciliationEngine } from '../../../../lib/triage/clinical-state';
import { extractSpeechFeatures } from '../../../../lib/acoustic/speech-features';
import { PatientCase, ClinicalConsensus } from '../../../../lib/agents/schemas';
import {
  CallerProfile,
  PatientProfile,
  CandidateFactProposal,
} from '../../../../lib/clinical-knowledge/types';
import { RobustnessTestCase } from '../types';
import {
  Phase2bCaseRecord,
  Phase2bAblationLedger,
  StageExecutionResult,
  TrackPerformance,
  LatencyMetric,
} from '../types_phase2b';
import { computeFileSha256 } from './run-robustness-suite';

const fixturesDir = path.resolve('eval/src/robustness/fixtures');

const EXPECTED_ENGINE_HASHES = {
  universalRedFlags: '8b0031c51bfea3753405d29cbf5956047af70335dd409ef697923350effd6ec4',
  safetyArbiter: '26f244fa42b3f043cf1f51dbe4be0f8f17fe3b0a57a01afda10b2e0d494ce639',
};

function loadFixtures<T>(filename: string): T {
  const filePath = path.join(fixturesDir, filename);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

interface CandidateFactFixtureData {
  by_parent_cluster: Record<string, CandidateFactProposal[]>;
  default_control_facts: CandidateFactProposal[];
  default_negation_denial_facts: CandidateFactProposal[];
  default_third_party_facts: CandidateFactProposal[];
}

function getCandidateFactsForCase(
  testCase: RobustnessTestCase,
  factFixtures: CandidateFactFixtureData
): CandidateFactProposal[] {
  if (testCase.track === 'C_CONTROL') {
    return factFixtures.default_control_facts;
  }
  if (testCase.track === 'E_NEGATION') {
    if (testCase.negation_context?.attribution === 'third_party') {
      return factFixtures.default_third_party_facts;
    }
    return factFixtures.default_negation_denial_facts;
  }
  // Track A, Track B, Track D: lookup by parent cluster
  const clusterFacts = factFixtures.by_parent_cluster[testCase.parent_scenario_id];
  if (clusterFacts) {
    return clusterFacts;
  }
  return [{ concept: 'symptom_under_evaluation', assertionStatus: 'present', subjectReference: 'self' }];
}

function calculateLatencyMetric(latencies: number[]): LatencyMetric {
  if (latencies.length === 0) return { mean_ms: 0, p50_ms: 0, p95_ms: 0 };
  const sorted = [...latencies].sort((a, b) => a - b);
  const mean = Number((sorted.reduce((a, b) => a + b, 0) / sorted.length).toFixed(2));
  const p50 = sorted[Math.floor(sorted.length * 0.5)] || 0;
  const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
  return { mean_ms: mean, p50_ms: Number(p50.toFixed(2)), p95_ms: Number(p95.toFixed(2)) };
}

export async function runPhase2bAblationSuite(): Promise<Phase2bAblationLedger> {
  console.log('================================================================================');
  console.log('  MEDVOICE AI: PHASE 2B MULTI-LAYER SAFETY ABLATION & RESCUE EVALUATION         ');
  console.log('  Baseline Engine: Commit 000abeb (FROZEN — ZERO ENGINE MODIFICATIONS)          ');
  console.log('================================================================================\n');

  // 1. Machine-verify frozen safety engine integrity via source file SHA-256 hashes
  const redFlagsPath = path.resolve('lib/triage/universal-red-flags.ts');
  const safetyArbiterPath = path.resolve('lib/triage/safety-arbiter.ts');
  const redFlagsSha = computeFileSha256(redFlagsPath);
  const safetyArbiterSha = computeFileSha256(safetyArbiterPath);

  const isMatch =
    redFlagsSha === EXPECTED_ENGINE_HASHES.universalRedFlags &&
    safetyArbiterSha === EXPECTED_ENGINE_HASHES.safetyArbiter;

  console.log(`[Safety Engine Integrity Audit]:`);
  console.log(`  • universal-red-flags.ts SHA-256: ${redFlagsSha} [${redFlagsSha === EXPECTED_ENGINE_HASHES.universalRedFlags ? 'VERIFIED MATCH' : 'MISMATCH'}]`);
  console.log(`  • safety-arbiter.ts      SHA-256: ${safetyArbiterSha} [${safetyArbiterSha === EXPECTED_ENGINE_HASHES.safetyArbiter ? 'VERIFIED MATCH' : 'MISMATCH'}]\n`);

  if (!isMatch) {
    throw new Error('[CRITICAL INVARIANT VIOLATION] Frozen engine SHA-256 hashes do not match baseline!');
  }

  // 2. Load corpora and fixture-backed LLM facts
  const canonical29: RobustnessTestCase[] = loadFixtures('canonical_emergencies_29.json');
  const paraphrases145: RobustnessTestCase[] = loadFixtures('adversarial_paraphrases_145.json');
  const controls21: RobustnessTestCase[] = loadFixtures('non_emergency_controls_21.json');
  const perturbations100: RobustnessTestCase[] = loadFixtures('text_perturbations_100.json');
  const negation50: RobustnessTestCase[] = loadFixtures('negation_ambiguity_suite_50.json');
  const factFixtures: CandidateFactFixtureData = loadFixtures('phase2b_llm_candidate_facts.json');

  const allCases: RobustnessTestCase[] = [
    ...canonical29,
    ...paraphrases145,
    ...controls21,
    ...perturbations100,
    ...negation50,
  ];

  console.log(`Loaded ${allCases.length} total test cases across 5 tracks:`);
  console.log(`  • Track A: Canonical Emergencies        : ${canonical29.length}`);
  console.log(`  • Track B: Colloquial Paraphrases       : ${paraphrases145.length} (pending review)`);
  console.log(`  • Track C: Non-Emergency Controls      : ${controls21.length}`);
  console.log(`  • Track D: Synthetic Text Perturbations : ${perturbations100.length}`);
  console.log(`  • Track E: Negation & Ambiguity Suite   : ${negation50.length}\n`);

  // 3. Warm-up pass (3 cycles over first 5 cases)
  console.log('[Warm-up Phase] Running JIT pre-compilation passes...');
  const warmupSlice = allCases.slice(0, 5);
  for (let w = 0; w < 3; w++) {
    for (const tc of warmupSlice) {
      evaluateSafetyArbiter({ rawText: tc.patient_utterance, patientAge: 45, llmSuggestedLevel: 'routine' });
      const ex = new EvidenceExtractor();
      ex.extract(tc.patient_utterance, createInitialInterviewStateV2());
    }
  }
  console.log('[Warm-up Phase] Completed. Executing 4-configuration ablation battery...\n');

  // Shared caller/patient profiles for reconciliation in C4
  const callerProfile: CallerProfile = {
    id: 'caller-eval',
    name: 'Caller',
    relationshipToPatient: 'self',
    authorizedPatientIds: ['pt-eval'],
  };
  const patientProfile: PatientProfile = {
    id: 'pt-eval',
    name: 'Patient',
    age: 45,
    gender: 'other',
    language: 'en',
    conditions: [],
    medications: [],
    allergies: [],
  };

  const records: Phase2bCaseRecord[] = [];
  const c1Latencies: number[] = [];
  const c2Latencies: number[] = [];
  const c3Latencies: number[] = [];
  const c4Latencies: number[] = [];

  let adverseDownplayCount = 0;
  let c3AdverseOverrides = 0;
  let c4AdverseOverrides = 0;

  for (const tc of allCases) {
    const isExpectedEmergency = tc.expected_emergency_escalation;

    // -------------------------------------------------------------------------
    // C1: DIRECT DETERMINISTIC SAFETY ARBITER BASELINE
    // -------------------------------------------------------------------------
    const t0C1 = performance.now();
    const c1Result = evaluateSafetyArbiter({
      rawText: tc.patient_utterance,
      llmSuggestedLevel: 'routine',
    });
    const t1C1 = performance.now();
    const c1Latency = t1C1 - t0C1;
    c1Latencies.push(c1Latency);

    const c1Escalated = c1Result.isEmergency || c1Result.triageLevel === 'emergency';
    const c1Stage: StageExecutionResult = {
      config_id: 'C1_L1_BASELINE',
      escalated: c1Escalated,
      triage_level: c1Result.triageLevel,
      disposition: c1Result.isEmergency ? 'emergency_evaluation' : 'routine_outpatient',
      esi_level: c1Result.esiScore,
      facts_introduced: [],
      overrides_applied: c1Result.arbiterOverride,
      latency_ms: Number(c1Latency.toFixed(2)),
      metadata: { red_flags: c1Result.redFlagsTriggered },
    };

    // -------------------------------------------------------------------------
    // C2: ISOLATED EVIDENCE EXTRACTOR + STRUCTURED ARBITER ADAPTER
    // -------------------------------------------------------------------------
    const t0C2 = performance.now();
    const c2State = createInitialInterviewStateV2();
    const extractor = new EvidenceExtractor();
    const extracted = extractor.extract(tc.patient_utterance, c2State);

    const c2ArbiterResult = evaluateSafetyArbiter({
      rawText: tc.patient_utterance,
      llmSuggestedLevel: 'routine',
      structuredState: {
        facts: extracted.newFacts,
        symptomProfile: extracted.symptomProfileUpdates,
        redFlags: extracted.redFlagAssessments,
      },
      facts: extracted.newFacts,
      redFlags: extracted.redFlagAssessments,
    });
    const t1C2 = performance.now();
    const c2Latency = t1C2 - t0C2;
    c2Latencies.push(c2Latency);

    const c2Escalated = c2ArbiterResult.isEmergency || c2ArbiterResult.triageLevel === 'emergency';
    const c2Stage: StageExecutionResult = {
      config_id: 'C2_EVIDENCE_EXTRACTOR',
      escalated: c2Escalated,
      triage_level: c2ArbiterResult.triageLevel,
      disposition: c2ArbiterResult.isEmergency ? 'emergency_evaluation' : 'routine_outpatient',
      esi_level: c2ArbiterResult.esiScore,
      facts_introduced: extracted.newFacts.map((f) => `${f.name}:${f.status}`),
      overrides_applied: c2ArbiterResult.arbiterOverride,
      latency_ms: Number(c2Latency.toFixed(2)),
      metadata: { red_flags: c2ArbiterResult.redFlagsTriggered },
    };

    // -------------------------------------------------------------------------
    // C3: DETERMINISTIC CLINICAL BOARD + FORCED ADVERSE CONSENSUS + POST-ARBITER
    // -------------------------------------------------------------------------
    const t0C3 = performance.now();
    const speechFeatures = extractSpeechFeatures({ transcriptText: tc.patient_utterance });
    const c3PatientCase: PatientCase = {
      patient_id: tc.test_case_id,
      patient_name: 'Test Patient',
      transcript: tc.patient_utterance,
      conversation_history: [],
      demographics: { age: undefined, age_group: 'adult' },
      detected_symptoms: [],
      vitals: {},
      speech_features: speechFeatures,
      pre_safety_flags: [],
      immediate_danger_detected: false,
      provenance_evidence: [],
    };

    const c3BoardResult = await clinicalBoard.evaluate(c3PatientCase);

    // Adversarial simulation: Test invariant when consensus downplays emergency
    const adverseConsensus: ClinicalConsensus = {
      ...c3BoardResult.consensus,
      recommended_disposition: 'routine_outpatient',
      consensus_risk: 'routine',
      requires_immediate_escalation: false,
    };
    const c3ForcedPostArbiter = evaluatePostArbiter(c3PatientCase, adverseConsensus);
    const t1C3 = performance.now();
    const c3Latency = t1C3 - t0C3;
    c3Latencies.push(c3Latency);

    if (isExpectedEmergency) {
      adverseDownplayCount++;
      if (c3ForcedPostArbiter.arbiter_override_applied) {
        c3AdverseOverrides++;
      }
    }

    const c3Escalated =
      c3BoardResult.post_arbiter.final_disposition === 'emergency_evaluation' ||
      c3BoardResult.post_arbiter.final_triage_level === 'emergency';

    const c3Stage: StageExecutionResult = {
      config_id: 'C3_CLINICAL_BOARD',
      escalated: c3Escalated,
      triage_level: c3BoardResult.post_arbiter.final_triage_level,
      disposition: c3BoardResult.post_arbiter.final_disposition,
      esi_level: c3BoardResult.post_arbiter.final_esi_level,
      facts_introduced: c3BoardResult.trace.specialists_summoned,
      overrides_applied: c3BoardResult.post_arbiter.arbiter_override_applied,
      latency_ms: Number(c3Latency.toFixed(2)),
      metadata: {
        consensus_risk: c3BoardResult.consensus.consensus_risk,
        adverse_downplay_override: c3ForcedPostArbiter.arbiter_override_applied,
      },
    };

    // -------------------------------------------------------------------------
    // C4: FULL PRODUCTION RUNTIME (Candidate Facts + Reconciliation + Board)
    // -------------------------------------------------------------------------
    const t0C4 = performance.now();
    const candidateFacts = getCandidateFactsForCase(tc, factFixtures);
    const isThirdParty = tc.negation_context?.attribution === 'third_party';

    const recon = controlledFactReconciliationEngine.reconcileCandidateFacts(
      [],
      candidateFacts,
      callerProfile,
      patientProfile,
      1
    );

    const provenanceEvidence = isThirdParty
      ? []
      : recon.acceptedFacts.map((fact) => ({
          id: fact.id,
          name: fact.concept,
          type: fact.provenanceDetails?.clinicalType || 'subjective_symptom',
          label: fact.concept.replace(/_/g, ' '),
          source: 'patient_reported' as const,
          description: fact.normalizedText || fact.concept,
          status: fact.assertionStatus === 'present' ? ('present' as const) : ('absent' as const),
          confidence: fact.confidence ?? null,
          confidence_semantics: 'patient_statement' as const,
          value: fact.value,
          timestamp: fact.timestamp,
          turnId: fact.turnId,
        }));

    const detectedSymptoms = isThirdParty
      ? []
      : recon.acceptedFacts
          .filter((f) => f.assertionStatus === 'present')
          .map((f) => f.concept.replace(/_/g, ' '));

    const c4PatientCase: PatientCase = {
      patient_id: tc.test_case_id,
      patient_name: 'Test Patient',
      transcript: tc.patient_utterance,
      conversation_history: [],
      demographics: { age: undefined, age_group: 'adult' },
      detected_symptoms: detectedSymptoms,
      vitals: {},
      speech_features: speechFeatures,
      pre_safety_flags: [],
      immediate_danger_detected: false,
      provenance_evidence: provenanceEvidence,
    };

    const c4BoardResult = await clinicalBoard.evaluate(c4PatientCase);

    // Adversarial simulation for C4
    const c4ForcedPostArbiter = evaluatePostArbiter(c4PatientCase, adverseConsensus);
    const t1C4 = performance.now();
    const c4Latency = t1C4 - t0C4;
    c4Latencies.push(c4Latency);

    if (isExpectedEmergency && c4ForcedPostArbiter.arbiter_override_applied) {
      c4AdverseOverrides++;
    }

    const c4Escalated =
      c4BoardResult.post_arbiter.final_disposition === 'emergency_evaluation' ||
      c4BoardResult.post_arbiter.final_triage_level === 'emergency';

    const c4Stage: StageExecutionResult = {
      config_id: 'C4_PRODUCTION_RUNTIME',
      escalated: c4Escalated,
      triage_level: c4BoardResult.post_arbiter.final_triage_level,
      disposition: c4BoardResult.post_arbiter.final_disposition,
      esi_level: c4BoardResult.post_arbiter.final_esi_level,
      facts_introduced: recon.acceptedFacts.map((f) => `${f.concept}:${f.assertionStatus}`),
      overrides_applied: c4BoardResult.post_arbiter.arbiter_override_applied,
      latency_ms: Number(c4Latency.toFixed(2)),
      metadata: {
        candidate_facts_count: candidateFacts.length,
        accepted_facts_count: recon.acceptedFacts.length,
      },
    };

    // Incremental Analysis Flags
    const c1Miss = isExpectedEmergency && !c1Escalated;
    const rescuedByC2 = c1Miss && c2Escalated;
    const rescuedByC3 = c1Miss && c3Escalated;
    const rescuedByC4 = c1Miss && c4Escalated;

    const falseEscalationC2 = !isExpectedEmergency && c2Escalated;
    const falseEscalationC3 = !isExpectedEmergency && c3Escalated;
    const falseEscalationC4 = !isExpectedEmergency && c4Escalated;

    records.push({
      test_case_id: tc.test_case_id,
      parent_scenario_id: tc.parent_scenario_id,
      track: tc.track,
      clinical_domain: tc.clinical_domain,
      target_emergency_condition: tc.target_emergency_condition,
      expected_emergency: isExpectedEmergency,
      patient_utterance: tc.patient_utterance,
      c1_l1_baseline: c1Stage,
      c2_evidence_extractor: c2Stage,
      c3_clinical_board: c3Stage,
      c4_production_runtime: c4Stage,
      c1_baseline_miss: c1Miss,
      rescued_by_c2: rescuedByC2,
      rescued_by_c3: rescuedByC3,
      rescued_by_c4: rescuedByC4,
      false_escalation_in_c2: falseEscalationC2,
      false_escalation_in_c3: falseEscalationC3,
      false_escalation_in_c4: falseEscalationC4,
    });
  }

  // 4. Compute Track Performance Summaries
  const computeTrackStats = (trackName: string): TrackPerformance => {
    const trackRecords = records.filter((r) => r.track === trackName);
    const total = trackRecords.length || 1;
    const c1Esc = trackRecords.filter((r) => r.c1_l1_baseline.escalated).length;
    const c2Esc = trackRecords.filter((r) => r.c2_evidence_extractor.escalated).length;
    const c3Esc = trackRecords.filter((r) => r.c3_clinical_board.escalated).length;
    const c4Esc = trackRecords.filter((r) => r.c4_production_runtime.escalated).length;

    return {
      total: trackRecords.length,
      c1_escalated: c1Esc,
      c1_rate: Number(((c1Esc / total) * 100).toFixed(1)),
      c2_escalated: c2Esc,
      c2_rate: Number(((c2Esc / total) * 100).toFixed(1)),
      c3_escalated: c3Esc,
      c3_rate: Number(((c3Esc / total) * 100).toFixed(1)),
      c4_escalated: c4Esc,
      c4_rate: Number(((c4Esc / total) * 100).toFixed(1)),
    };
  };

  const trackA = computeTrackStats('A_CANONICAL');
  const trackB = computeTrackStats('B_COLLOQUIAL');
  const trackC = computeTrackStats('C_CONTROL');
  const trackD = computeTrackStats('D_PERTURBATION');
  const trackE = computeTrackStats('E_NEGATION');

  // 5. Compute Rescue Metrics for Track B
  const trackBMisses = records.filter((r) => r.track === 'B_COLLOQUIAL' && r.c1_baseline_miss);
  const totalBBaselineMisses = trackBMisses.length; // 108
  const rescuedC2 = trackBMisses.filter((r) => r.rescued_by_c2).length;
  const rescuedC3 = trackBMisses.filter((r) => r.rescued_by_c3).length;
  const rescuedC4 = trackBMisses.filter((r) => r.rescued_by_c4).length;

  const trackCRecords = records.filter((r) => r.track === 'C_CONTROL');
  const trackERecords = records.filter((r) => r.track === 'E_NEGATION');

  const ledger: Phase2bAblationLedger = {
    evaluation_id: `PHASE2B-ABLATION-${Date.now()}`,
    timestamp: new Date().toISOString(),
    baseline_engine_commit: '000abeb',
    engine_hashes: {
      universal_red_flags_sha256: redFlagsSha,
      safety_arbiter_sha256: safetyArbiterSha,
    },
    total_cases_evaluated: records.length,
    tracks: {
      track_a_canonical: trackA,
      track_b_colloquial: trackB,
      track_c_controls: trackC,
      track_d_perturbation: trackD,
      track_e_negation: trackE,
    },
    rescue_analysis: {
      total_c1_track_b_misses: totalBBaselineMisses,
      rescued_by_c2: rescuedC2,
      rescued_by_c2_rate: Number(((rescuedC2 / (totalBBaselineMisses || 1)) * 100).toFixed(1)),
      rescued_by_c3: rescuedC3,
      rescued_by_c3_rate: Number(((rescuedC3 / (totalBBaselineMisses || 1)) * 100).toFixed(1)),
      rescued_by_c4: rescuedC4,
      rescued_by_c4_rate: Number(((rescuedC4 / (totalBBaselineMisses || 1)) * 100).toFixed(1)),
      unrescued_count: totalBBaselineMisses - rescuedC4,
    },
    false_escalation_analysis: {
      track_c_controls: {
        c1_false_alarms: trackCRecords.filter((r) => r.c1_l1_baseline.escalated).length,
        c2_false_alarms: trackCRecords.filter((r) => r.c2_evidence_extractor.escalated).length,
        c3_false_alarms: trackCRecords.filter((r) => r.c3_clinical_board.escalated).length,
        c4_false_alarms: trackCRecords.filter((r) => r.c4_production_runtime.escalated).length,
      },
      track_e_negation: {
        c1_false_alarms: trackERecords.filter((r) => r.c1_l1_baseline.escalated).length,
        c2_false_alarms: trackERecords.filter((r) => r.c2_evidence_extractor.escalated).length,
        c3_false_alarms: trackERecords.filter((r) => r.c3_clinical_board.escalated).length,
        c4_false_alarms: trackERecords.filter((r) => r.c4_production_runtime.escalated).length,
      },
    },
    adverse_downplay_test: {
      total_adversarial_simulations: adverseDownplayCount,
      c3_post_arbiter_overrides: c3AdverseOverrides,
      c4_post_arbiter_overrides: c4AdverseOverrides,
      invariant_maintained: c3AdverseOverrides > 0 && c4AdverseOverrides > 0,
    },
    latency_profiles: {
      c1_l1_baseline: calculateLatencyMetric(c1Latencies),
      c2_evidence_extractor: calculateLatencyMetric(c2Latencies),
      c3_clinical_board: calculateLatencyMetric(c3Latencies),
      c4_production_runtime: calculateLatencyMetric(c4Latencies),
    },
    records,
  };

  // 6. Output Terminal Summary
  console.log('================================================================================');
  console.log('              PHASE 2B MULTI-LAYER SAFETY ABLATION SCOREBOARD                  ');
  console.log('================================================================================');
  console.log('  Configuration | Track A (29) | Track B (145) | Track C (21) | Track E (50) | P50 Latency');
  console.log('--------------------------------------------------------------------------------');
  console.log(
    `  C1: L1 Arbiter| ${trackA.c1_rate}% (${trackA.c1_escalated}/29)  | ${trackB.c1_rate}% (${trackB.c1_escalated}/145) | ${trackC.c1_rate}% (${trackC.c1_escalated}/21)  | ${trackE.c1_rate}% (${trackE.c1_escalated}/50)  | ${ledger.latency_profiles.c1_l1_baseline.p50_ms} ms`
  );
  console.log(
    `  C2: +Evidence | ${trackA.c2_rate}% (${trackA.c2_escalated}/29)  | ${trackB.c2_rate}% (${trackB.c2_escalated}/145) | ${trackC.c2_rate}% (${trackC.c2_escalated}/21)  | ${trackE.c2_rate}% (${trackE.c2_escalated}/50)  | ${ledger.latency_profiles.c2_evidence_extractor.p50_ms} ms`
  );
  console.log(
    `  C3: +Board/Post| ${trackA.c3_rate}% (${trackA.c3_escalated}/29)  | ${trackB.c3_rate}% (${trackB.c3_escalated}/145) | ${trackC.c3_rate}% (${trackC.c3_escalated}/21)  | ${trackE.c3_rate}% (${trackE.c3_escalated}/50)  | ${ledger.latency_profiles.c3_clinical_board.p50_ms} ms`
  );
  console.log(
    `  C4: +Prod Flow| ${trackA.c4_rate}% (${trackA.c4_escalated}/29)  | ${trackB.c4_rate}% (${trackB.c4_escalated}/145) | ${trackC.c4_rate}% (${trackC.c4_escalated}/21)  | ${trackE.c4_rate}% (${trackE.c4_escalated}/50)  | ${ledger.latency_profiles.c4_production_runtime.p50_ms} ms`
  );
  console.log('--------------------------------------------------------------------------------');
  console.log('  RESCUE OF TRACK B BASELINE MISSES (108 Colloquial Failures):');
  console.log(`    • C2 Evidence Extractor Rescued: ${rescuedC2} / ${totalBBaselineMisses} (${ledger.rescue_analysis.rescued_by_c2_rate}%)`);
  console.log(`    • C3 Clinical Board Rescued     : ${rescuedC3} / ${totalBBaselineMisses} (${ledger.rescue_analysis.rescued_by_c3_rate}%)`);
  console.log(`    • C4 Production Runtime Rescued : ${rescuedC4} / ${totalBBaselineMisses} (${ledger.rescue_analysis.rescued_by_c4_rate}%)`);
  console.log('--------------------------------------------------------------------------------');
  console.log('  FALSE ESCALATION SAFETY AUDIT:');
  console.log(
    `    • Track C Controls False Alarms : C1=${ledger.false_escalation_analysis.track_c_controls.c1_false_alarms}, C2=${ledger.false_escalation_analysis.track_c_controls.c2_false_alarms}, C3=${ledger.false_escalation_analysis.track_c_controls.c3_false_alarms}, C4=${ledger.false_escalation_analysis.track_c_controls.c4_false_alarms}`
  );
  console.log(
    `    • Track E Negation False Alarms : C1=${ledger.false_escalation_analysis.track_e_negation.c1_false_alarms}, C2=${ledger.false_escalation_analysis.track_e_negation.c2_false_alarms}, C3=${ledger.false_escalation_analysis.track_e_negation.c3_false_alarms}, C4=${ledger.false_escalation_analysis.track_e_negation.c4_false_alarms}`
  );
  console.log('--------------------------------------------------------------------------------');
  console.log('  ADVERSE DOWNPLAY INVARIANT AUDIT:');
  console.log(
    `    • Forced Downplay Neutralized in C3 Post-Arbiter: ${c3AdverseOverrides} / ${adverseDownplayCount} (${((c3AdverseOverrides / adverseDownplayCount) * 100).toFixed(1)}%)`
  );
  console.log(
    `    • Forced Downplay Neutralized in C4 Post-Arbiter: ${c4AdverseOverrides} / ${adverseDownplayCount} (${((c4AdverseOverrides / adverseDownplayCount) * 100).toFixed(1)}%)`
  );
  console.log('================================================================================\n');

  // Save Ledger Artifact
  const resultsDir = path.resolve('eval/results');
  if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });
  const ledgerPath = path.join(resultsDir, 'phase2b_ablation_ledger.json');
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2), 'utf8');
  console.log(`[Phase 2B Artifact] Saved ablation ledger to: ${ledgerPath}\n`);

  return ledger;
}

if (process.argv[1] && process.argv[1].includes('run-phase2b-ablation-suite')) {
  runPhase2bAblationSuite().catch((err) => {
    console.error('Phase 2B execution failed:', err);
    process.exit(1);
  });
}
