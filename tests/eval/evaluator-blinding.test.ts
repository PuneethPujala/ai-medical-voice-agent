/**
 * Tests for Blinding, Balanced Strata Allocation & AES-256-GCM Encrypted Secret Mapping
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  stripProvenance,
  createSeededRng,
  generateCryptographicSeed,
  allocateBlindedPair,
  stratifiedAllocateBatch,
  encryptSecretMapping,
  decryptSecretMapping,
  SecretMappingRecord,
} from '../../eval/src/evaluator/blinding-engine';

describe('Task 2: Blinding, Balanced Strata Allocation & Encrypted Secret Mapping', () => {
  it('1. Provenance stripping removes system/doctor speaker tags while preserving clinical content', () => {
    const rawAgentResponse =
      'Dr. Sarah Chen: You should consult your doctor immediately. If your physician prescribed aspirin, do not stop taking it without a doctor review.';
    const rawReferenceResponse =
      'Physician: Please check with your doctor before taking medication. A physician evaluation is indicated.';

    const cleanedAgent = stripProvenance(rawAgentResponse);
    const cleanedReference = stripProvenance(rawReferenceResponse);

    // Persona/speaker prefix removed
    assert(!cleanedAgent.startsWith('Dr. Sarah Chen:'));
    assert(!cleanedReference.startsWith('Physician:'));

    // Meaningful clinical words preserved
    assert(cleanedAgent.includes('consult your doctor immediately'));
    assert(cleanedAgent.includes('physician prescribed aspirin'));
    assert(cleanedReference.includes('check with your doctor'));
    assert(cleanedReference.includes('physician evaluation is indicated'));
  });

  it('2. Identical normalization rules apply to typographical quotes, dashes, and whitespace for both candidates', () => {
    const inputWithSmartQuotes = '“Take your ‘medication’ — do not delay.”';
    const cleaned = stripProvenance(inputWithSmartQuotes);

    assert.strictEqual(cleaned, '"Take your \'medication\' - do not delay."');
  });

  it('3. Mulberry32 PRNG with seed 42 produces deterministic allocation for repeatable unit tests', () => {
    const rng1 = createSeededRng(42);
    const rng2 = createSeededRng(42);

    const values1 = Array.from({ length: 10 }, () => rng1());
    const values2 = Array.from({ length: 10 }, () => rng2());

    assert.deepStrictEqual(values1, values2);
  });

  it('4. Cryptographic random generator produces distinct uint32 seeds for experiments', () => {
    const seed1 = generateCryptographicSeed();
    const seed2 = generateCryptographicSeed();

    assert(typeof seed1 === 'number');
    assert(typeof seed2 === 'number');
    assert(seed1 >= 0 && seed1 <= 0xffffffff);
    assert.notStrictEqual(seed1, seed2);
  });

  it('5. Stratified allocation achieves balanced A/B distribution across clinical domain strata', () => {
    const scenarios = [
      { id: 'SCEN-01', domain: 'cardiovascular' },
      { id: 'SCEN-02', domain: 'cardiovascular' },
      { id: 'SCEN-03', domain: 'cardiovascular' },
      { id: 'SCEN-04', domain: 'cardiovascular' },
      { id: 'SCEN-05', domain: 'respiratory' },
      { id: 'SCEN-06', domain: 'respiratory' },
      { id: 'SCEN-07', domain: 'respiratory' },
      { id: 'SCEN-08', domain: 'respiratory' },
    ];

    const { blindedPairs, secretRecords } = stratifiedAllocateBatch(
      scenarios,
      (scen) => ({
        agentResponse: `Agent response for ${scen.id}`,
        referenceResponse: `Reference response for ${scen.id}`,
      }),
      42
    );

    assert.strictEqual(blindedPairs.length, 8);
    assert.strictEqual(secretRecords.length, 8);

    // Check balance within cardiovascular stratum (4 items -> exactly 2 Option A = agent, 2 Option A = reference)
    const cardioRecords = secretRecords.filter((r) => r.domain === 'cardiovascular');
    const cardioAgentA = cardioRecords.filter((r) => r.response_a_provenance === 'agent').length;
    assert.strictEqual(cardioAgentA, 2);

    // Check balance within respiratory stratum (4 items -> exactly 2 Option A = agent, 2 Option A = reference)
    const respRecords = secretRecords.filter((r) => r.domain === 'respiratory');
    const respAgentA = respRecords.filter((r) => r.response_a_provenance === 'agent').length;
    assert.strictEqual(respAgentA, 2);
  });

  it('6. Encrypts secret mapping via AES-256-GCM and decrypts accurately with key, failing on invalid key', () => {
    const records: SecretMappingRecord[] = [
      {
        sample_id: 'samp_001',
        pair_id: 'pair_001',
        domain: 'cardiovascular',
        response_a_provenance: 'agent',
        response_b_provenance: 'reference',
        coin_flip_random: 0.234,
      },
      {
        sample_id: 'samp_002',
        pair_id: 'pair_002',
        domain: 'neurological',
        response_a_provenance: 'reference',
        response_b_provenance: 'agent',
        coin_flip_random: 0.812,
      },
    ];

    const secretKey = 'my-super-secret-key-for-eval-run-12345';
    const encryptedPayload = encryptSecretMapping(records, secretKey);

    assert.strictEqual(encryptedPayload.version, 'aes-256-gcm-v1');
    assert(encryptedPayload.iv.length === 24); // 12 bytes in hex = 24 chars
    assert(encryptedPayload.authTag.length === 32); // 16 bytes in hex = 32 chars
    assert(encryptedPayload.ciphertext.length > 0);

    // Decrypt with valid key
    const decrypted = decryptSecretMapping(encryptedPayload, secretKey);
    assert.deepStrictEqual(decrypted, records);

    // Decrypt with wrong key should throw
    assert.throws(() => {
      decryptSecretMapping(encryptedPayload, 'wrong-password-key');
    });
  });

  it('7. Tampering with AES-256-GCM authentication tag or ciphertext throws authentication failure without data leakage', () => {
    const records: SecretMappingRecord[] = [
      {
        sample_id: 'samp_001',
        pair_id: 'pair_001',
        domain: 'cardiovascular',
        response_a_provenance: 'agent',
        response_b_provenance: 'reference',
        coin_flip_random: 0.123,
      },
    ];

    const secretKey = 'tamper-test-key-98765';
    const encryptedPayload = encryptSecretMapping(records, secretKey);

    // Tamper with authentication tag by flipping characters in the hex string
    const tamperedTag =
      encryptedPayload.authTag.slice(0, -2) +
      (encryptedPayload.authTag.slice(-2) === 'aa' ? 'bb' : 'aa');
    const tamperedTagPayload = { ...encryptedPayload, authTag: tamperedTag };

    assert.throws(
      () => {
        decryptSecretMapping(tamperedTagPayload, secretKey);
      },
      (err: any) => {
        // Must fail at cipher authentication
        return err instanceof Error;
      }
    );

    // Tamper with ciphertext by flipping characters in the hex string
    const tamperedCiphertext =
      encryptedPayload.ciphertext.slice(0, -2) +
      (encryptedPayload.ciphertext.slice(-2) === 'aa' ? 'bb' : 'aa');
    const tamperedCipherPayload = { ...encryptedPayload, ciphertext: tamperedCiphertext };

    assert.throws(
      () => {
        decryptSecretMapping(tamperedCipherPayload, secretKey);
      },
      (err: any) => {
        return err instanceof Error;
      }
    );
  });
});
