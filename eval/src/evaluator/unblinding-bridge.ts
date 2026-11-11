/**
 * Study 3 Unblinding Bridge & CLMM Dataset Exporter
 *
 * Joins blinded evaluation outputs with decrypted secret mappings to construct
 * long-format datasets tailored for Cumulative-Link Mixed-Effects Models:
 * logit P(Y_spm <= c) = theta_c - [beta*M_m + gamma_p + delta_p*M_m + u_s + v_{sp}]
 */

import fs from 'node:fs';
import {
  EncryptedSecretPayload,
  decryptSecretMapping,
  SecretMappingRecord,
} from './blinding-engine';
import { LikertScores, SafetyFlags } from './response-parser';

export interface UnblindedCandidateRecord {
  run_id: string;
  scenario_id: string;
  perspective_id: string;
  session_id: string; // scenario_id + "_" + perspective_id (for random intercept v_{sp})
  pair_id: string;
  system: 'medvoice' | 'comparator';
  is_medvoice: 1 | 0;
  blinded_target: 'candidate_a' | 'candidate_b';
  raw_scores: LikertScores;
  adjusted_scores: LikertScores;
  safety_flags: SafetyFlags;
  capping_applied: boolean;
  capping_reasons: string[];
  justification: string;
  prompt_sha256: string;
  model_id: string;
  timestamp: string;
}

export const CLMM_SCORE_DIMENSIONS: (keyof LikertScores)[] = [
  'correctness',
  'relevance',
  'completeness',
  'uncertainty_guidelines',
  'clarity',
  'empathy',
];

/**
 * Unblinds evaluation records using the encrypted secret mapping payload and decryption key.
 */
export function unblindEvaluationRecords(
  evalRecords: any[],
  encryptedPayload: EncryptedSecretPayload,
  secretKey: string
): UnblindedCandidateRecord[] {
  const secretRecords: SecretMappingRecord[] = decryptSecretMapping(encryptedPayload, secretKey);
  const secretMap = new Map<string, SecretMappingRecord>();
  for (const s of secretRecords) {
    secretMap.set(s.sample_id, s);
    secretMap.set(s.pair_id, s);
  }

  const unblinded: UnblindedCandidateRecord[] = [];

  for (const record of evalRecords) {
    const secret = secretMap.get(record.scenario_id) || secretMap.get(record.pair_id);
    if (!secret) {
      throw new Error(
        `UNBLINDING_ERROR: No secret mapping record found for scenario_id '${record.scenario_id}' / pair_id '${record.pair_id}'.`
      );
    }

    const sessionId = `${record.scenario_id}_${record.perspective_id}`;

    // candidate_a
    const candidateASystem = secret.response_a_provenance === 'agent' ? 'medvoice' : 'comparator';
    unblinded.push({
      run_id: record.run_id,
      scenario_id: record.scenario_id,
      perspective_id: record.perspective_id,
      session_id: sessionId,
      pair_id: record.pair_id,
      system: candidateASystem,
      is_medvoice: candidateASystem === 'medvoice' ? 1 : 0,
      blinded_target: 'candidate_a',
      raw_scores: record.candidate_a.raw_scores,
      adjusted_scores: record.candidate_a.adjusted_scores,
      safety_flags: record.candidate_a.safety_flags,
      capping_applied: record.candidate_a.capping_applied,
      capping_reasons: record.candidate_a.capping_reasons,
      justification: record.candidate_a.justification,
      prompt_sha256: record.prompt_sha256,
      model_id: record.model_returned || record.model_configured,
      timestamp: record.timestamp,
    });

    // candidate_b
    const candidateBSystem = secret.response_b_provenance === 'agent' ? 'medvoice' : 'comparator';
    unblinded.push({
      run_id: record.run_id,
      scenario_id: record.scenario_id,
      perspective_id: record.perspective_id,
      session_id: sessionId,
      pair_id: record.pair_id,
      system: candidateBSystem,
      is_medvoice: candidateBSystem === 'medvoice' ? 1 : 0,
      blinded_target: 'candidate_b',
      raw_scores: record.candidate_b.raw_scores,
      adjusted_scores: record.candidate_b.adjusted_scores,
      safety_flags: record.candidate_b.safety_flags,
      capping_applied: record.candidate_b.capping_applied,
      capping_reasons: record.candidate_b.capping_reasons,
      justification: record.candidate_b.justification,
      prompt_sha256: record.prompt_sha256,
      model_id: record.model_returned || record.model_configured,
      timestamp: record.timestamp,
    });
  }

  return unblinded;
}

/**
 * Exports unblinded records into a long-format CSV file for CLMM statistical modeling.
 */
export function exportClmmLongFormatCsv(
  unblindedRecords: UnblindedCandidateRecord[],
  outputCsvPath: string
): void {
  const headers = [
    'scenario_id',
    'perspective_id',
    'session_id',
    'system',
    'is_medvoice',
    'blinded_target',
    'dimension',
    'raw_score',
    'adjusted_score',
    'capping_applied',
    'capping_reasons',
    'dangerous_omission',
    'false_reassurance',
    'emergency_delay',
    'contraindicated_advice',
    'severe_over_triage',
    'run_id',
    'prompt_sha256',
    'model_id',
    'timestamp',
  ];

  const rows: string[] = [headers.join(',')];

  for (const record of unblindedRecords) {
    for (const dim of CLMM_SCORE_DIMENSIONS) {
      const rawScore = record.raw_scores[dim];
      const adjustedScore = record.adjusted_scores[dim];
      const reasonsSafe = `"${(record.capping_reasons || []).join('; ').replace(/"/g, '""')}"`;

      const row = [
        record.scenario_id,
        record.perspective_id,
        record.session_id,
        record.system,
        record.is_medvoice,
        record.blinded_target,
        dim,
        rawScore,
        adjustedScore,
        record.capping_applied ? 1 : 0,
        reasonsSafe,
        record.safety_flags.dangerous_omission ? 1 : 0,
        record.safety_flags.false_reassurance ? 1 : 0,
        record.safety_flags.emergency_delay ? 1 : 0,
        record.safety_flags.contraindicated_advice ? 1 : 0,
        record.safety_flags.severe_over_triage ? 1 : 0,
        record.run_id,
        record.prompt_sha256,
        record.model_id,
        record.timestamp,
      ];

      rows.push(row.join(','));
    }
  }

  fs.writeFileSync(outputCsvPath, rows.join('\n') + '\n', 'utf8');
}
