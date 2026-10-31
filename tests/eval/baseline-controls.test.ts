/**
 * MedVoice Clinical Response Evaluation Framework
 * Task 3: True Derangement Baseline & Consensus Calibration Cohort Test Suite
 *
 * Verifies:
 * 1. Sattolo's true derangement algorithm guarantees ZERO self-matches (\forall i, \pi(i) \ne i).
 * 2. Reproducibility under fixed random seed (seed = 42).
 * 3. Permutation conservation (exact multiset of reference texts preserved).
 * 4. Error handling when input length < 2.
 * 5. Templated baseline fallback generation.
 * 6. Dual-physician consensus cohort extraction and PHI sanitization.
 */

import assert from 'assert';
import {
  generateDerangementBaseline,
  BaselinePairRecord,
} from '../../eval/src/controls/derangement-baseline';
import {
  generateTemplatedBaseline,
  TEMPLATED_FALLBACK_DEFAULT,
} from '../../eval/src/controls/templated-baseline';
import {
  extractConsensusCohort,
  MultiPhysicianRecord,
  ConsensusPairRecord,
} from '../../eval/src/controls/consensus-cohort';
import { CuratedPairRecord } from '../../eval/src/ingestion/manifest-builder';

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

function createDummyCuratedRecord(idx: number): CuratedPairRecord {
  return {
    id: `MED-EVAL-${String(idx).padStart(4, '0')}`,
    source: 'medvoice_synthetic_fixtures',
    source_id: `SRC-${idx}`,
    sha256: `dummy-sha-${idx}`,
    chief_complaint_domain: 'Cardiovascular',
    secondary_tags: ['test'],
    physician_specialty: 'Internal Medicine',
    patient_query: `Patient query symptom presentation number ${idx}`,
    conversation_context: [],
    physician_reference: `Physician reference treatment response number ${idx}`,
    patient_word_count: 6,
    physician_word_count: 6,
    patient_fkgl: 8.0,
    physician_fkgl: 8.0,
  };
}

console.log('================================================================================');
console.log('MEDVOICE CLINICAL EVALUATION: BASELINE CONTROLS & CONSENSUS TEST SUITE');
console.log('================================================================================\n');

console.log('[Suite 1: True Derangement Baseline Algorithm (Sattolo)]');

runTest('Rejects input with fewer than 2 items (impossible derangement)', () => {
  assert.throws(
    () => generateDerangementBaseline([]),
    /Cannot generate a derangement for fewer than 2 items/i
  );

  assert.throws(
    () => generateDerangementBaseline([createDummyCuratedRecord(1)]),
    /Cannot generate a derangement for fewer than 2 items/i
  );
});

runTest('Guarantees ZERO fixed points across 10 items (small array)', () => {
  const items = Array.from({ length: 10 }, (_, i) => createDummyCuratedRecord(i + 1));
  const baseline = generateDerangementBaseline(items, 42);

  assert.strictEqual(baseline.length, 10);
  for (let i = 0; i < items.length; i++) {
    assert.strictEqual(baseline[i].id, items[i].id);
    assert.notStrictEqual(
      baseline[i].baseline_reference,
      items[i].physician_reference,
      `Fixed point detected at index ${i}! Self-match is strictly forbidden.`
    );
    assert.strictEqual(baseline[i].baseline_type, 'random_derangement');
  }
});

runTest('Guarantees ZERO fixed points across 1,000 items (benchmark scale)', () => {
  const items = Array.from({ length: 1000 }, (_, i) => createDummyCuratedRecord(i + 1));
  const baseline = generateDerangementBaseline(items, 42);

  assert.strictEqual(baseline.length, 1000);
  let fixedPoints = 0;

  for (let i = 0; i < items.length; i++) {
    if (baseline[i].baseline_reference === items[i].physician_reference) {
      fixedPoints++;
    }
  }

  assert.strictEqual(
    fixedPoints,
    0,
    `Derangement failed: found ${fixedPoints} fixed points across 1,000 items.`
  );
});

runTest('Derangement preserves permutation conservation (bijection multiset)', () => {
  const items = Array.from({ length: 50 }, (_, i) => createDummyCuratedRecord(i + 1));
  const baseline = generateDerangementBaseline(items, 42);

  const originalRefs = items.map((x) => x.physician_reference).sort();
  const derangedRefs = baseline.map((x) => x.baseline_reference).sort();

  assert.deepStrictEqual(
    derangedRefs,
    originalRefs,
    'Derangement must be a pure permutation of the original physician references.'
  );
});

runTest('Derangement is deterministic and reproducible with fixed seed', () => {
  const items = Array.from({ length: 100 }, (_, i) => createDummyCuratedRecord(i + 1));
  const run1 = generateDerangementBaseline(items, 42);
  const run2 = generateDerangementBaseline(items, 42);

  assert.deepStrictEqual(
    run1.map((r) => r.baseline_reference),
    run2.map((r) => r.baseline_reference),
    'Derangements with identical seed must produce bit-for-bit identical output.'
  );

  // Different seed produces different permutation
  const runDiff = generateDerangementBaseline(items, 999);
  assert.notDeepStrictEqual(
    run1.map((r) => r.baseline_reference),
    runDiff.map((r) => r.baseline_reference),
    'Different seeds must produce different permutations.'
  );
});

console.log('\n[Suite 2: Templated Fallback Baseline]');

runTest('Generates templated baseline with standard clinical fallback', () => {
  const items = Array.from({ length: 5 }, (_, i) => createDummyCuratedRecord(i + 1));
  const templated = generateTemplatedBaseline(items);

  assert.strictEqual(templated.length, 5);
  for (let i = 0; i < items.length; i++) {
    assert.strictEqual(templated[i].id, items[i].id);
    assert.strictEqual(templated[i].baseline_type, 'templated_fallback');
    assert.strictEqual(templated[i].baseline_reference, TEMPLATED_FALLBACK_DEFAULT);
    assert.strictEqual(templated[i].original_reference, items[i].physician_reference);
  }
});

runTest('Supports custom fallback template text', () => {
  const items = [createDummyCuratedRecord(1)];
  const custom = 'Thank you for reaching out. Please describe your symptoms in more detail.';
  const templated = generateTemplatedBaseline(items, custom);

  assert.strictEqual(templated[0].baseline_reference, custom);
});

console.log('\n[Suite 3: Dual-Physician Consensus Cohort Extraction]');

runTest('Extracts valid consensus pairs from multi-physician threads', () => {
  const threads: MultiPhysicianRecord[] = [
    {
      thread_id: 'THREAD-001',
      patient_query: 'I have severe lower back pain radiating down my left leg for 3 days.',
      physician_responses: [
        {
          doctor_id: 'DOC-A',
          specialty: 'Orthopedics',
          text: 'This presentation is suggestive of lumbar radiculopathy or sciatica. Consider NSAIDs and gentle physical therapy. Call your physician if you develop bowel or bladder symptoms.',
        },
        {
          doctor_id: 'DOC-B',
          specialty: 'Neurology',
          text: 'The distribution indicates sciatic nerve compression. Rest, ice, and oral anti-inflammatory medications are recommended first-line. Seek immediate emergency evaluation if saddle numbness occurs.',
        },
      ],
    },
    {
      thread_id: 'THREAD-002',
      patient_query: 'Single physician thread only.',
      physician_responses: [
        {
          doctor_id: 'DOC-C',
          text: 'This is an isolated response without peer confirmation.',
        },
      ],
    },
  ];

  const consensus = extractConsensusCohort(threads);

  assert.strictEqual(consensus.length, 1, 'Only threads with >= 2 physicians should be extracted');
  const record: ConsensusPairRecord = consensus[0];

  assert.strictEqual(record.thread_id, 'THREAD-001');
  assert(record.physician_reference_a.includes('lumbar radiculopathy'));
  assert(record.physician_reference_b.includes('sciatic nerve compression'));
  assert.strictEqual(record.physician_a_specialty, 'Orthopedics');
  assert.strictEqual(record.physician_b_specialty, 'Neurology');
  assert.strictEqual(record.sha256.length, 64, 'Must compute 64-char SHA-256 provenance hash');
});

runTest('Consensus cohort applies PhiScrubber de-identification to both physician answers', () => {
  const threads: MultiPhysicianRecord[] = [
    {
      thread_id: 'THREAD-PHI',
      patient_query: 'Question',
      physician_responses: [
        {
          doctor_id: 'DOC-1',
          text: 'Hello John Doe, you can reach me at 555-123-4567 regarding your symptoms.',
        },
        {
          doctor_id: 'DOC-2',
          text: 'You may also email me at doctor@clinic.org for follow-up.',
        },
      ],
    },
  ];

  const consensus = extractConsensusCohort(threads);
  assert.strictEqual(consensus.length, 1);
  assert(!consensus[0].physician_reference_a.includes('555-123-4567'));
  assert(consensus[0].physician_reference_a.includes('[PHI_PHONE_'));
  assert(!consensus[0].physician_reference_b.includes('doctor@clinic.org'));
  assert(consensus[0].physician_reference_b.includes('[PHI_EMAIL_'));
});

runTest('Rejects threads with empty or whitespace-only answers', () => {
  const threads: MultiPhysicianRecord[] = [
    {
      thread_id: 'THREAD-EMPTY',
      patient_query: 'Query',
      physician_responses: [
        { doctor_id: 'DOC-1', text: 'Valid answer here.' },
        { doctor_id: 'DOC-2', text: '   \n  ' },
      ],
    },
  ];

  const consensus = extractConsensusCohort(threads);
  assert.strictEqual(consensus.length, 0, 'Threads with invalid second response must be omitted');
});

console.log('\n================================================================================');
console.log(`ALL ${totalTests} TESTS EXECUTED SUCCESSFULLY (${passedTests}/${totalTests} PASSED)`);
console.log('================================================================================\n');
