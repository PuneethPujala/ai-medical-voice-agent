/**
 * MedVoice Clinical Response Evaluation Framework
 * GATE 0: Data Feasibility, Licensing, Provenance & Research Ethics Audit Test Suite
 *
 * Verifies:
 * 1. Gate 0 programmatically rejects blocked, conditionally approved, and unverified datasets.
 * 2. Synthetic benchmark fixtures are permitted for Stage 1 engineering.
 * 3. Raw dataset directories and secret review mappings are strictly verified in .gitignore.
 * 4. Regulatory framework invariants (ICMR 2017, ICMR AI 2023, DPDPA 2023, forbidden self-exemption).
 */

import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import {
  loadEvalConfig,
  getDatasetRecord,
  getGovernanceRegistry,
  isGate0Cleared,
  checkDatasetAccess,
  assertGate0Cleared,
  verifyGitignoreExclusions,
  verifyDatasetGovernance,
  Gate0FeasibilityError,
} from '../../eval/src/governance/gate0-feasibility-check';

let totalTests = 0;
let passedTests = 0;

function runTest(testName: string, fn: () => void): void {
  totalTests++;
  try {
    fn();
    console.log(`  ✓ PASS: ${testName}`);
    passedTests++;
  } catch (err: any) {
    console.error(`  ✗ FAIL: ${testName}`);
    console.error(err);
    throw err;
  }
}

console.log('\n================================================================================');
console.log('MEDVOICE CLINICAL RESPONSE EVALUATION FRAMEWORK: GATE 0 AUDIT VERIFICATION');
console.log('================================================================================\n');

// -----------------------------------------------------------------------------
// Test Suite 1: Programmatic Gate 0 Rejection of Blocked & Unverified Datasets
// -----------------------------------------------------------------------------
console.log('[Suite 1: Programmatic Gate 0 Hard Gating]');

runTest('MTSamples cannot be accessed as CC0 and throws Gate0FeasibilityError', () => {
  const record = getDatasetRecord('mtsamples');
  assert(record, 'mtsamples must be registered in eval-config.json');
  assert.strictEqual(record.status, 'CONDITIONALLY_APPROVED');
  assert.strictEqual(record.gate0_cleared, false);
  assert.strictEqual(record.dataUseAgreementRequired, true);
  assert(
    !record.claimedLicense.toLowerCase().includes('authorized cc0'),
    'MTSamples must not be treated as legitimate CC0'
  );

  const check = checkDatasetAccess('mtsamples', 'ingest');
  assert.strictEqual(check.allowed, false);
  assert.strictEqual(check.status, 'CONDITIONALLY_APPROVED');
  assert(check.reason?.includes('MTSamples cannot be used under CC0'));
  assert(check.remediation?.includes('Data Use Agreement (DUA)'));

  let threw = false;
  try {
    assertGate0Cleared('mtsamples', 'ingest');
  } catch (err) {
    threw = true;
    assert(err instanceof Gate0FeasibilityError, 'Error must be instance of Gate0FeasibilityError');
    const gErr = err as Gate0FeasibilityError;
    assert.strictEqual(gErr.datasetId, 'mtsamples');
    assert.strictEqual(gErr.status, 'CONDITIONALLY_APPROVED');
    assert(gErr.message.includes('MTSamples cannot be used under CC0'));
  }
  assert(threw, 'assertGate0Cleared must throw for un-cleared MTSamples');
});

runTest('HealthCareMagic-100k throws Gate0FeasibilityError requiring IEC protocol review', () => {
  const record = getDatasetRecord('healthcaremagic_100k');
  assert(record, 'healthcaremagic_100k must be registered');
  assert.strictEqual(record.status, 'CONDITIONALLY_APPROVED');
  assert.strictEqual(record.gate0_cleared, false);
  assert.strictEqual(record.requiresIecApproval, true);
  assert.strictEqual(record.isHumanSubjectsData, true);

  const check = checkDatasetAccess('healthcaremagic_100k', 'ingest');
  assert.strictEqual(check.allowed, false);
  assert(check.reason?.includes('Institutional Ethics Committee (IEC) review'));

  let threw = false;
  try {
    assertGate0Cleared('healthcaremagic_100k', 'ingest');
  } catch (err) {
    threw = true;
    assert(err instanceof Gate0FeasibilityError);
    assert((err as Gate0FeasibilityError).message.includes('ICMR (2017)'));
  }
  assert(threw, 'assertGate0Cleared must throw for un-cleared HealthCareMagic');
});

runTest('MedDialog Original (UCSD) is conditionally approved but blocked from raw ingestion', () => {
  const record = getDatasetRecord('meddialog_original');
  assert(record, 'meddialog_original must be registered');
  assert.strictEqual(record.status, 'CONDITIONALLY_APPROVED');
  assert.strictEqual(record.gate0_cleared, false);
  assert.strictEqual(record.requiresIecApproval, true);

  let threw = false;
  try {
    assertGate0Cleared('meddialog_original', 'ingest');
  } catch (err) {
    threw = true;
    assert(err instanceof Gate0FeasibilityError);
  }
  assert(threw, 'assertGate0Cleared must throw for un-cleared MedDialog original');
});

runTest('MedDialog Repackaged (OpenMed / HF mirror) is BLOCKED with tainted provenance', () => {
  const record = getDatasetRecord('meddialog_repackaged');
  assert(record, 'meddialog_repackaged must be registered');
  assert.strictEqual(record.status, 'BLOCKED');
  assert.strictEqual(record.gate0_cleared, false);

  const check = checkDatasetAccess('meddialog_repackaged', 'ingest');
  assert.strictEqual(check.allowed, false);
  assert.strictEqual(check.status, 'BLOCKED');
  assert(check.reason?.includes('taint'));

  let threw = false;
  try {
    assertGate0Cleared('meddialog_repackaged', 'ingest');
  } catch (err) {
    threw = true;
    assert(err instanceof Gate0FeasibilityError);
    assert((err as Gate0FeasibilityError).status === 'BLOCKED');
  }
  assert(threw, 'assertGate0Cleared must throw for BLOCKED MedDialog repackaged mirror');
});

runTest('Unregistered / unverified dataset is rejected with UNKNOWN status', () => {
  const check = checkDatasetAccess('unregistered_clinical_dump_2026', 'ingest');
  assert.strictEqual(check.allowed, false);
  assert.strictEqual(check.status, 'UNKNOWN');
  assert(check.reason?.includes('unverified'));

  let threw = false;
  try {
    assertGate0Cleared('unregistered_clinical_dump_2026', 'ingest');
  } catch (err) {
    threw = true;
    assert(err instanceof Gate0FeasibilityError);
    assert.strictEqual((err as Gate0FeasibilityError).status, 'UNKNOWN');
  }
  assert(threw, 'assertGate0Cleared must throw for unverified dataset');
});

// -----------------------------------------------------------------------------
// Test Suite 2: Synthetic Fixtures & Approved Reference Cleared for Stage 1
// -----------------------------------------------------------------------------
console.log('\n[Suite 2: Synthetic Fixtures & Approved Reference for Stage 1]');

runTest('MedVoice synthetic clinical benchmark fixtures are APPROVED and cleared (gate0_cleared: true)', () => {
  const record = getDatasetRecord('medvoice_synthetic_fixtures');
  assert(record, 'medvoice_synthetic_fixtures must be registered');
  assert.strictEqual(record.status, 'APPROVED');
  assert.strictEqual(record.gate0_cleared, true);
  assert.strictEqual(record.isHumanSubjectsData, false);
  assert.strictEqual(record.dataUseAgreementRequired, false);
  assert.strictEqual(record.requiresIecApproval, false);

  // Check programmatic access
  const check = checkDatasetAccess('medvoice_synthetic_fixtures', 'ingest');
  assert.strictEqual(check.allowed, true);
  assert.strictEqual(check.gate0Cleared, true);

  const benchmarkCheck = checkDatasetAccess('medvoice_synthetic_fixtures', 'benchmark');
  assert.strictEqual(benchmarkCheck.allowed, true);

  // Does not throw
  assertGate0Cleared('medvoice_synthetic_fixtures', 'ingest');
  assert.strictEqual(isGate0Cleared('medvoice_synthetic_fixtures'), true);
});

runTest('MedlinePlus XML reference knowledge is APPROVED and cleared for RAG', () => {
  const record = getDatasetRecord('medlineplus_xml');
  assert(record, 'medlineplus_xml must be registered');
  assert.strictEqual(record.status, 'APPROVED');
  assert.strictEqual(record.gate0_cleared, true);
  assert.strictEqual(record.isHumanSubjectsData, false);

  assertGate0Cleared('medlineplus_xml', 'read');
  assert.strictEqual(isGate0Cleared('medlineplus_xml'), true);
});

// -----------------------------------------------------------------------------
// Test Suite 3: Repository Air-Gap & Gitignore Verification
// -----------------------------------------------------------------------------
console.log('\n[Suite 3: Air-Gap & .gitignore Exclusion Verification]');

runTest('All required raw dataset directories and secret review mappings are in .gitignore', () => {
  const gitCheck = verifyGitignoreExclusions();
  if (!gitCheck.valid) {
    console.error('Missing required patterns:', gitCheck.missingPatterns);
  }
  assert.strictEqual(gitCheck.valid, true, `All patterns must be present. Missing: ${gitCheck.missingPatterns.join(', ')}`);
  assert(gitCheck.foundPatterns.length >= 8, 'Found patterns must cover all required security categories');

  // Explicit pattern assertions
  const required = [
    'eval/data/raw/',
    'data/raw/',
    'data/raw-datasets/',
    '*.raw.json',
    '*.raw.csv',
    '*review-mapping*.json',
    '*secret*',
    '*phi*',
    '*identifiable*',
  ];
  for (const p of required) {
    assert(
      gitCheck.foundPatterns.includes(p),
      `Pattern '${p}' must be verified in gitignore`
    );
  }
});

runTest('verifyGitignoreExclusions detects un-ignored dummy patterns correctly', () => {
  const result = verifyGitignoreExclusions(undefined, ['non_existent_unignored_pattern_xyz/']);
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.missingPatterns.length, 1);
  assert.strictEqual(result.missingPatterns[0], 'non_existent_unignored_pattern_xyz/');
});

// -----------------------------------------------------------------------------
// Test Suite 4: Regulatory, Ethics & Governance Schema Invariants
// -----------------------------------------------------------------------------
console.log('\n[Suite 4: Research Ethics & Regulatory Invariants]');

runTest('Configuration strictly enforces ICMR 2017, ICMR AI 2023, and DPDPA 2023 frameworks', () => {
  const config = loadEvalConfig();
  const frameworkIds = config.metadata.regulatoryFrameworks.map((f) => f.id);
  assert(frameworkIds.includes('ICMR_2017'), 'Must include ICMR 2017');
  assert(frameworkIds.includes('ICMR_AI_2023'), 'Must include ICMR AI 2023');
  assert(frameworkIds.includes('DPDPA_2023'), 'Must include DPDPA 2023');

  // Verify rejection of US 45 CFR 46.104 self-exemption
  assert(
    !frameworkIds.includes('US_45_CFR_46'),
    'Must NOT rely on US 45 CFR 46 as primary regulatory framework'
  );
});

runTest('Self-declared ethics exemption is strictly forbidden across all frameworks', () => {
  const config = loadEvalConfig();
  for (const rf of config.metadata.regulatoryFrameworks) {
    assert.strictEqual(
      rf.selfExemptionPermitted,
      false,
      `Framework ${rf.id} must forbid self-exemption`
    );
  }
  assert.strictEqual(
    config.metadata.iecSubmissionProtocol.selfDeclaredExemptionForbidden,
    true,
    'IEC protocol must explicitly forbid self-declared exemption'
  );
});

runTest('No real clinical human-subjects dataset is prematurely marked gate0_cleared: true', () => {
  const registry = getGovernanceRegistry();
  for (const ds of registry) {
    if (ds.isHumanSubjectsData) {
      assert.strictEqual(
        ds.gate0_cleared,
        false,
        `Real dataset '${ds.id}' cannot have gate0_cleared: true prior to formal IEC review`
      );
      assert.strictEqual(
        ds.requiresIecApproval,
        true,
        `Real dataset '${ds.id}' must require IEC approval`
      );
    }
  }
});

runTest('Comprehensive verifyDatasetGovernance audit validates pipeline cohorts correctly', () => {
  // Test 1: Stage 1 Engineering cohort (synthetic only) should be completely cleared
  const stage1Audit = verifyDatasetGovernance(['medvoice_synthetic_fixtures', 'medlineplus_xml']);
  assert.strictEqual(stage1Audit.overallCleared, true);
  assert.strictEqual(stage1Audit.approvedDatasets.length, 2);
  assert.strictEqual(stage1Audit.conditionallyApprovedDatasets.length, 0);
  assert.strictEqual(stage1Audit.blockedDatasets.length, 0);
  assert.strictEqual(stage1Audit.gitExclusionValid, true);
  assert.strictEqual(stage1Audit.selfExemptionForbiddenEnforced, true);

  // Test 2: Full registry audit should report overallCleared = false due to pending real datasets
  const fullAudit = verifyDatasetGovernance();
  assert.strictEqual(fullAudit.overallCleared, false);
  assert(fullAudit.approvedDatasets.includes('medvoice_synthetic_fixtures'));
  assert(fullAudit.conditionallyApprovedDatasets.includes('mtsamples'));
  assert(fullAudit.conditionallyApprovedDatasets.includes('healthcaremagic_100k'));
  assert(fullAudit.blockedDatasets.includes('meddialog_repackaged'));
  assert(fullAudit.blockedDatasets.includes('mimic_iv_notes'));
  assert.strictEqual(fullAudit.gitExclusionValid, true);
});

console.log('\n================================================================================');
console.log(`GATE 0 AUDIT VERIFICATION COMPLETE: ${passedTests}/${totalTests} TESTS PASSED (0 FAILURES)`);
console.log('================================================================================\n');
