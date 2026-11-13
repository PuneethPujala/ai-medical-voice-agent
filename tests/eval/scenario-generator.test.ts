/**
 * MedVoice Phase 1 Scenario Generator Test Suite (Gate 1 Infrastructure)
 *
 * Verifies:
 * 1. Hard Gate 1 guard: throws Gate1AuthorizationError when GATE1_AUTHORIZED is unset.
 * 2. Test-fixture mode: permits non-clinical test scenario generation for offline verification.
 * 3. Exact 200-item sizing: produces exactly 20 scenarios per domain across all 10 registered domains.
 * 4. Schema conformity: 100% of generated scenarios pass validateClinicalScenario().
 * 5. Balanced acuity distribution: verifies emergent, urgent, and routine representations.
 * 6. Cryptographic determinism: identical seed produces identical SHA-256 hash.
 * 7. Dataset manifest generation: produces schema-compliant entry for approved_datasets.json.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  generateScenarioBatch,
  assertGate1Authorization,
  Gate1AuthorizationError,
  REGISTERED_CLINICAL_DOMAINS,
  computeScenariosSha256,
  createApprovedDatasetManifestEntry,
} from '../../eval/src/harness/scenario-generator';
import { validateClinicalScenario } from '../../eval/src/schema/scenario-schema';

describe('Gate 1: Scenario Generator Infrastructure & Governance Guards', () => {
  it('1. Gate 1 Guard: throws Gate1AuthorizationError when investigator authorization is absent', () => {
    const prevAuth = process.env.GATE1_AUTHORIZED;
    const prevMedvoiceAuth = process.env.MEDVOICE_GATE1_INVESTIGATOR_AUTHORIZED;
    delete process.env.GATE1_AUTHORIZED;
    delete process.env.MEDVOICE_GATE1_INVESTIGATOR_AUTHORIZED;

    try {
      assert.throws(
        () => {
          assertGate1Authorization();
        },
        (err: any) => {
          assert(err instanceof Gate1AuthorizationError);
          assert.strictEqual(err.code, 'GATE1_AUTHORIZATION_REQUIRED');
          assert(err.message.includes('GATE1_AUTHORIZATION_REQUIRED'));
          return true;
        }
      );

      // Attempting to generate clinical scenarios without testFixtureMode must also throw
      assert.throws(
        () => {
          generateScenarioBatch({ testFixtureMode: false });
        },
        (err: any) => {
          assert(err instanceof Gate1AuthorizationError);
          return true;
        }
      );
    } finally {
      if (prevAuth !== undefined) process.env.GATE1_AUTHORIZED = prevAuth;
      if (prevMedvoiceAuth !== undefined) process.env.MEDVOICE_GATE1_INVESTIGATOR_AUTHORIZED = prevMedvoiceAuth;
    }
  });

  it('2. Test-fixture mode: allows non-clinical scenario generation without authorization', () => {
    const prevAuth = process.env.GATE1_AUTHORIZED;
    delete process.env.GATE1_AUTHORIZED;

    try {
      const batch = generateScenarioBatch({
        testFixtureMode: true,
        perDomainCount: 2, // 2 per domain = 20 total for fast test
        seed: 42,
      });

      assert.strictEqual(batch.testFixtureMode, true);
      assert.strictEqual(batch.totalGenerated, 20);
      assert.strictEqual(batch.scenarios.length, 20);
    } finally {
      if (prevAuth !== undefined) process.env.GATE1_AUTHORIZED = prevAuth;
    }
  });

  it('3. Generates exactly 200 scenarios across 10 registered domains (20 per domain)', () => {
    const batch = generateScenarioBatch({
      testFixtureMode: true,
      perDomainCount: 20,
      seed: 12345,
    });

    assert.strictEqual(batch.totalGenerated, 200);
    assert.strictEqual(batch.scenarios.length, 200);

    // Verify all 10 registered domains are present with exactly 20 scenarios each
    for (const domain of REGISTERED_CLINICAL_DOMAINS) {
      assert.strictEqual(
        batch.domainCounts[domain],
        20,
        `Domain ${domain} must have exactly 20 scenarios`
      );
    }
  });

  it('4. 100% of generated scenarios conform to ClinicalScenario v1.2.0 schema', () => {
    const batch = generateScenarioBatch({
      testFixtureMode: true,
      perDomainCount: 5, // 50 scenarios
      seed: 999,
    });

    for (const scen of batch.scenarios) {
      const validation = validateClinicalScenario(scen);
      assert.strictEqual(
        validation.valid,
        true,
        `Scenario ${scen.scenario_id} failed schema validation: ${JSON.stringify(validation.issues)}`
      );
      assert.strictEqual(scen.provenance.schema_version, '1.2.0');
      assert.strictEqual(scen.provenance.provenance_type, 'synthetic_authored');
      // Verify anti-fabrication invariant: synthetic data must NOT assert deidentification
      assert.strictEqual('deidentification_verified' in scen.provenance, false);
    }
  });

  it('5. Generates balanced acuity distribution across emergent, urgent, and routine', () => {
    const batch = generateScenarioBatch({
      testFixtureMode: true,
      perDomainCount: 20,
      seed: 42,
    });

    // In 20 items per domain: 6 emergent (30%), 6 urgent (30%), 8 routine (40%)
    // Across 10 domains: 60 emergent, 60 urgent, 80 routine
    assert.strictEqual(batch.acuityCounts.emergent, 60);
    assert.strictEqual(batch.acuityCounts.urgent, 60);
    assert.strictEqual(batch.acuityCounts.routine, 80);
    assert.strictEqual(
      batch.acuityCounts.emergent + batch.acuityCounts.urgent + batch.acuityCounts.routine,
      200
    );
  });

  it('6. Cryptographic determinism: same seed produces identical SHA-256 hash', () => {
    const batch1 = generateScenarioBatch({
      testFixtureMode: true,
      perDomainCount: 10,
      seed: 42,
    });

    const batch2 = generateScenarioBatch({
      testFixtureMode: true,
      perDomainCount: 10,
      seed: 42,
    });

    assert.strictEqual(batch1.contentSha256, batch2.contentSha256);
    assert.strictEqual(batch1.scenarios[0].scenario_id, batch2.scenarios[0].scenario_id);
    assert.strictEqual(
      batch1.scenarios[0].patient_profile.age,
      batch2.scenarios[0].patient_profile.age
    );

    // Different seed produces different output
    const batch3 = generateScenarioBatch({
      testFixtureMode: true,
      perDomainCount: 10,
      seed: 43,
    });

    assert.notStrictEqual(batch1.contentSha256, batch3.contentSha256);
  });

  it('7. Creates compliant approved_datasets.json manifest entry', () => {
    const batch = generateScenarioBatch({
      testFixtureMode: true,
      perDomainCount: 2,
      seed: 42,
    });

    const entry = createApprovedDatasetManifestEntry(
      'synthetic-test-v1.0.0',
      '1.0.0',
      'eval/data/test/test-scenarios.json',
      batch.scenarios,
      'Test fixture dataset for automated testing.'
    );

    assert.strictEqual(entry.dataset_id, 'synthetic-test-v1.0.0');
    assert.strictEqual(entry.dataset_version, '1.0.0');
    assert.strictEqual(entry.scenario_count, 20);
    assert.strictEqual(entry.approved_scenario_ids.length, 20);
    assert.strictEqual(entry.quarantined_from_benchmarks, true);
    assert.strictEqual(entry.sha256, batch.contentSha256);
  });
});
