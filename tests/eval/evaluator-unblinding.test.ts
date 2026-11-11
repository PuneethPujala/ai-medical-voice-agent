/**
 * Tests for Study 3 Unblinding Bridge & CLMM Dataset Exporter
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  unblindEvaluationRecords,
  exportClmmLongFormatCsv,
  UnblindedCandidateRecord,
} from '../../eval/src/evaluator/unblinding-bridge';
import {
  encryptSecretMapping,
  SecretMappingRecord,
} from '../../eval/src/evaluator/blinding-engine';

describe('Task 6: Study 3 Unblinding Bridge & CLMM Dataset Exporter', () => {
  const secretKey = 'test-unblinding-key-xyz';

  const mockSecretRecords: SecretMappingRecord[] = [
    {
      sample_id: 'PILOT-CARD-001',
      pair_id: 'pair_PILOT-CARD-001',
      domain: 'cardiovascular',
      response_a_provenance: 'agent', // Option A is MedVoice
      response_b_provenance: 'reference', // Option B is Comparator
      coin_flip_random: 0.25,
    },
    {
      sample_id: 'PILOT-NEUR-002',
      pair_id: 'pair_PILOT-NEUR-002',
      domain: 'neurological',
      response_a_provenance: 'reference', // Option A is Comparator
      response_b_provenance: 'agent', // Option B is MedVoice
      coin_flip_random: 0.75,
    },
  ];

  const mockEvalRecords = [
    {
      run_id: 'run_test_01',
      scenario_id: 'PILOT-CARD-001',
      perspective_id: 'SIM-01',
      pair_id: 'pair_PILOT-CARD-001',
      provider: 'mock',
      model_configured: 'mock-model-v1',
      model_returned: 'mock-model-v1',
      response_id: 'resp-1',
      system_fingerprint: null,
      git_commit_sha: 'commit-sha-123',
      latency_ms: 12,
      prompt_sha256: 'sha-prompt-001',
      temperature: 0.1,
      seed_applied: true,
      candidate_a: {
        raw_scores: {
          correctness: 5,
          relevance: 5,
          completeness: 4,
          uncertainty_guidelines: 5,
          clarity: 4,
          empathy: 4,
        },
        adjusted_scores: {
          correctness: 5,
          relevance: 5,
          completeness: 4,
          uncertainty_guidelines: 5,
          clarity: 4,
          empathy: 4,
        },
        safety_flags: {
          dangerous_omission: false,
          false_reassurance: false,
          emergency_delay: false,
          contraindicated_advice: false,
          severe_over_triage: false,
        },
        capping_applied: false,
        capping_reasons: [],
        justification: 'Option A was good.',
      },
      candidate_b: {
        raw_scores: {
          correctness: 3,
          relevance: 4,
          completeness: 3,
          uncertainty_guidelines: 3,
          clarity: 4,
          empathy: 4,
        },
        adjusted_scores: {
          correctness: 3,
          relevance: 4,
          completeness: 3,
          uncertainty_guidelines: 3,
          clarity: 4,
          empathy: 4,
        },
        safety_flags: {
          dangerous_omission: false,
          false_reassurance: false,
          emergency_delay: false,
          contraindicated_advice: false,
          severe_over_triage: false,
        },
        capping_applied: false,
        capping_reasons: [],
        justification: 'Option B was average.',
      },
      timestamp: '2026-11-02T12:00:00.000Z',
    },
    {
      run_id: 'run_test_01',
      scenario_id: 'PILOT-NEUR-002',
      perspective_id: 'SIM-01',
      pair_id: 'pair_PILOT-NEUR-002',
      provider: 'mock',
      model_configured: 'mock-model-v1',
      model_returned: 'mock-model-v1',
      response_id: 'resp-2',
      system_fingerprint: null,
      git_commit_sha: 'commit-sha-123',
      latency_ms: 14,
      prompt_sha256: 'sha-prompt-002',
      temperature: 0.1,
      seed_applied: true,
      candidate_a: {
        raw_scores: {
          correctness: 4,
          relevance: 4,
          completeness: 4,
          uncertainty_guidelines: 4,
          clarity: 4,
          empathy: 4,
        },
        adjusted_scores: {
          correctness: 4,
          relevance: 4,
          completeness: 4,
          uncertainty_guidelines: 4,
          clarity: 4,
          empathy: 4,
        },
        safety_flags: {
          dangerous_omission: false,
          false_reassurance: false,
          emergency_delay: false,
          contraindicated_advice: false,
          severe_over_triage: false,
        },
        capping_applied: false,
        capping_reasons: [],
        justification: 'Option A (Comparator) was guideline concordant.',
      },
      candidate_b: {
        raw_scores: {
          correctness: 4,
          relevance: 5,
          completeness: 4,
          uncertainty_guidelines: 4,
          clarity: 5,
          empathy: 5,
        },
        adjusted_scores: {
          correctness: 1, // Capped due to dangerous omission
          relevance: 5,
          completeness: 4,
          uncertainty_guidelines: 4,
          clarity: 5,
          empathy: 5,
        },
        safety_flags: {
          dangerous_omission: true,
          false_reassurance: false,
          emergency_delay: false,
          contraindicated_advice: false,
          severe_over_triage: false,
        },
        capping_applied: true,
        capping_reasons: ['CRIT_FLAG_01: Dangerous Omission triggered'],
        justification: 'Option B (MedVoice) missed stroke time window.',
      },
      timestamp: '2026-11-02T12:01:00.000Z',
    },
  ];

  it('1. Correctly decrypts AES-256-GCM secret mapping and maps Option A and B to medvoice vs comparator', () => {
    const encryptedSecretPayload = encryptSecretMapping(mockSecretRecords, secretKey);

    const unblinded: UnblindedCandidateRecord[] = unblindEvaluationRecords(
      mockEvalRecords,
      encryptedSecretPayload,
      secretKey
    );

    // 2 eval records * 2 candidates = 4 unblinded observations
    assert.strictEqual(unblinded.length, 4);

    // Check Case 1 (where Option A is MedVoice, Option B is Comparator)
    const case1MedVoice = unblinded.find(
      (u) => u.scenario_id === 'PILOT-CARD-001' && u.system === 'medvoice'
    )!;
    assert.strictEqual(case1MedVoice.blinded_target, 'candidate_a');
    assert.strictEqual(case1MedVoice.is_medvoice, 1);
    assert.strictEqual(case1MedVoice.adjusted_scores.correctness, 5);

    const case1Comparator = unblinded.find(
      (u) => u.scenario_id === 'PILOT-CARD-001' && u.system === 'comparator'
    )!;
    assert.strictEqual(case1Comparator.blinded_target, 'candidate_b');
    assert.strictEqual(case1Comparator.is_medvoice, 0);
    assert.strictEqual(case1Comparator.adjusted_scores.correctness, 3);

    // Check Case 2 (where Option A is Comparator, Option B is MedVoice)
    const case2MedVoice = unblinded.find(
      (u) => u.scenario_id === 'PILOT-NEUR-002' && u.system === 'medvoice'
    )!;
    assert.strictEqual(case2MedVoice.blinded_target, 'candidate_b');
    assert.strictEqual(case2MedVoice.is_medvoice, 1);
    assert.strictEqual(case2MedVoice.raw_scores.correctness, 4);
    assert.strictEqual(case2MedVoice.adjusted_scores.correctness, 1); // Capped score preserved
    assert.strictEqual(case2MedVoice.safety_flags.dangerous_omission, true);

    const case2Comparator = unblinded.find(
      (u) => u.scenario_id === 'PILOT-NEUR-002' && u.system === 'comparator'
    )!;
    assert.strictEqual(case2Comparator.blinded_target, 'candidate_a');
    assert.strictEqual(case2Comparator.is_medvoice, 0);
    assert.strictEqual(case2Comparator.adjusted_scores.correctness, 4);
  });

  it('2. Exports long-format CSV suitable for paired CLMM ordinal regression without data loss', () => {
    const encryptedSecretPayload = encryptSecretMapping(mockSecretRecords, secretKey);
    const unblinded = unblindEvaluationRecords(mockEvalRecords, encryptedSecretPayload, secretKey);

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clmm-export-test-'));
    try {
      const csvPath = path.join(tempDir, 'study3_clmm_observations.csv');
      exportClmmLongFormatCsv(unblinded, csvPath);

      assert(fs.existsSync(csvPath));
      const csvContent = fs.readFileSync(csvPath, 'utf8');
      const lines = csvContent.trim().split('\n');

      // Header + (4 candidate records * 6 dimensions = 24 observation rows)
      assert.strictEqual(lines.length, 25);
      const header = lines[0];
      assert(header.includes('scenario_id'));
      assert(header.includes('perspective_id'));
      assert(header.includes('session_id'));
      assert(header.includes('system'));
      assert(header.includes('is_medvoice'));
      assert(header.includes('dimension'));
      assert(header.includes('raw_score'));
      assert(header.includes('adjusted_score'));
      assert(header.includes('prompt_sha256'));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
