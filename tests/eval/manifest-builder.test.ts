/**
 * MedVoice Clinical Response Evaluation Framework
 * Task 1: Dataset Ingestion, De-Identification Safeguards & Manifest Builder Test Suite
 *
 * Verifies:
 * 1. Short clinical query acceptance ("I have chest pain", "I'm dizzy").
 * 2. Empty/whitespace query rejection.
 * 3. Empty physician reference rejection.
 * 4. Maximum length (4096 char limit) rejection.
 * 5. Deterministic 10-domain classification accuracy across clinical complaints.
 * 6. Physician specialty preservation or fallback to "unknown".
 * 7. SHA-256 provenance hash integrity.
 * 8. PhiScrubber de-identification sanitization.
 * 9. Gate 0 programmatic blocking when attempting to ingest uncleared sources.
 */

import assert from 'assert';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  buildEvaluationManifest,
  classifyChiefComplaintDomain,
  CuratedPairRecord,
  RawDialogueItem,
  CHIEF_COMPLAINT_DOMAINS,
  ChiefComplaintDomain,
} from '../../eval/src/ingestion/manifest-builder';
import {
  sanitizeClinicalText,
  calculateFKGL,
  countWords,
  validateDialogueItem,
} from '../../eval/src/ingestion/sanitize';
import { Gate0FeasibilityError } from '../../eval/src/governance/gate0-feasibility-check';

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
console.log('MEDVOICE CLINICAL EVALUATION: MANIFEST BUILDER & SANITIZATION TEST SUITE');
console.log('================================================================================\n');

// -----------------------------------------------------------------------------
// Suite 1: Query & Reference Sanitization and Validation
// -----------------------------------------------------------------------------
console.log('[Suite 1: Query & Reference Validation]');

runTest('Accepts valid short clinical query ("I have chest pain")', () => {
  const item: RawDialogueItem = {
    source_id: 'TEST-001',
    source: 'medvoice_synthetic_fixtures',
    patient_query: 'I have chest pain',
    physician_reference: 'Please seek emergency care immediately at the nearest hospital.',
  };
  const validation = validateDialogueItem(item);
  assert.strictEqual(validation.valid, true);
});

runTest('Accepts valid ultra-short query ("I\'m dizzy")', () => {
  const item: RawDialogueItem = {
    source_id: 'TEST-002',
    source: 'medvoice_synthetic_fixtures',
    patient_query: "I'm dizzy",
    physician_reference: 'Sit or lie down safely to prevent a fall, and monitor if your speech or balance is affected.',
  };
  const validation = validateDialogueItem(item);
  assert.strictEqual(validation.valid, true);
});

runTest('Rejects empty or whitespace-only patient query', () => {
  const item1: RawDialogueItem = {
    source_id: 'TEST-003',
    source: 'medvoice_synthetic_fixtures',
    patient_query: '',
    physician_reference: 'Drink fluids and rest.',
  };
  const val1 = validateDialogueItem(item1);
  assert.strictEqual(val1.valid, false);
  assert(val1.reason?.toLowerCase().includes('empty'));

  const item2: RawDialogueItem = {
    source_id: 'TEST-004',
    source: 'medvoice_synthetic_fixtures',
    patient_query: '   \n\t  ',
    physician_reference: 'Drink fluids and rest.',
  };
  const val2 = validateDialogueItem(item2);
  assert.strictEqual(val2.valid, false);
});

runTest('Rejects empty or whitespace-only physician reference', () => {
  const item: RawDialogueItem = {
    source_id: 'TEST-005',
    source: 'medvoice_synthetic_fixtures',
    patient_query: 'I have a sore throat for three days.',
    physician_reference: '   ',
  };
  const validation = validateDialogueItem(item);
  assert.strictEqual(validation.valid, false);
  assert(validation.reason?.toLowerCase().includes('reference'));
});

runTest('Rejects queries exceeding maximum length (4096 characters)', () => {
  const longQuery = 'A'.repeat(4097);
  const item: RawDialogueItem = {
    source_id: 'TEST-006',
    source: 'medvoice_synthetic_fixtures',
    patient_query: longQuery,
    physician_reference: 'Valid response.',
  };
  const validation = validateDialogueItem(item);
  assert.strictEqual(validation.valid, false);
  assert(validation.reason?.includes('4096'));
});

// -----------------------------------------------------------------------------
// Suite 2: Readability Metrics (FKGL & Word Count)
// -----------------------------------------------------------------------------
console.log('\n[Suite 2: Readability & Text Hygiene]');

runTest('Calculates accurate word count', () => {
  assert.strictEqual(countWords('I have severe crushing chest pain'), 6);
  assert.strictEqual(countWords(""), 0);
  assert.strictEqual(countWords("   word1   word2 \n word3 "), 3);
});

runTest('Calculates valid Flesch-Kincaid Grade Level', () => {
  const text = 'The patient presented to the clinic with acute dyspnea and bilateral lower extremity edema.';
  const fkgl = calculateFKGL(text);
  assert(typeof fkgl === 'number');
  assert(fkgl > 0);
  assert(!isNaN(fkgl));

  // Ultra-short query should not produce NaN
  const shortFkgl = calculateFKGL("I'm dizzy");
  assert(typeof shortFkgl === 'number');
  assert(!isNaN(shortFkgl));
});

// -----------------------------------------------------------------------------
// Suite 3: PhiScrubber De-Identification
// -----------------------------------------------------------------------------
console.log('\n[Suite 3: PhiScrubber De-Identification Safeguards]');

runTest('Scrubs patient names, phone numbers, emails, and dates via PhiScrubber', () => {
  const rawText = 'My name is John Doe, my phone number is 9876543210 and email is john.doe@example.com, visited on 12/04/2026.';
  const sanitized = sanitizeClinicalText(rawText);

  assert(!sanitized.includes('9876543210'), 'Phone number must be scrubbed');
  assert(!sanitized.includes('john.doe@example.com'), 'Email must be scrubbed');
  assert(!sanitized.includes('12/04/2026'), 'Date must be scrubbed');
  assert(sanitized.includes('[PHI_PHONE_'), 'Must include PHI_PHONE token');
  assert(sanitized.includes('[PHI_EMAIL_'), 'Must include PHI_EMAIL token');
  assert(sanitized.includes('[PHI_DATE_'), 'Must include PHI_DATE token');
});

// -----------------------------------------------------------------------------
// Suite 4: Deterministic 10-Domain Classification
// -----------------------------------------------------------------------------
console.log('\n[Suite 4: 10-Domain Chief Complaint Classification]');

runTest('All 10 domains are present in domain registry', () => {
  assert.strictEqual(CHIEF_COMPLAINT_DOMAINS.length, 10);
  const expected: ChiefComplaintDomain[] = [
    'Cardiovascular',
    'Respiratory',
    'Neurological',
    'Gastrointestinal',
    'Dermatological',
    'Musculoskeletal',
    'General Medicine',
    'Medication Related',
    'Chronic Disease',
    'Other',
  ];
  for (const domain of expected) {
    assert(CHIEF_COMPLAINT_DOMAINS.includes(domain), `Domain ${domain} must be registered`);
  }
});

runTest('Accurately classifies representative cases for each domain', () => {
  const cases: Array<{ text: string; expected: ChiefComplaintDomain }> = [
    { text: 'Severe crushing chest pain radiating to the left arm and jaw with palpitations', expected: 'Cardiovascular' },
    { text: 'Shortness of breath, wheezing, and severe persistent cough with phlegm', expected: 'Respiratory' },
    { text: 'Sudden weakness on the left side of face, numbness, and slurred speech', expected: 'Neurological' },
    { text: 'Intense abdominal cramping, bloody diarrhea, and persistent vomiting', expected: 'Gastrointestinal' },
    { text: 'Red itchy rash and hives spreading across both arms with blisters', expected: 'Dermatological' },
    { text: 'Lower back pain radiating down leg and severe swollen knee joint', expected: 'Musculoskeletal' },
    { text: 'High grade fever with chills, body aches, fatigue, and night sweats', expected: 'General Medicine' },
    { text: 'Experienced severe allergic reaction and nausea after taking amoxicillin antibiotic dose', expected: 'Medication Related' },
    { text: 'My blood sugar has been over 300 mg/dL all week with high HbA1c and diabetes history', expected: 'Chronic Disease' },
    { text: 'General query about clinic parking and operating hours', expected: 'Other' },
  ];

  for (const testCase of cases) {
    const domain = classifyChiefComplaintDomain(testCase.text);
    assert.strictEqual(
      domain,
      testCase.expected,
      `Expected "${testCase.expected}" for query "${testCase.text}", got "${domain}"`
    );
  }
});

// -----------------------------------------------------------------------------
// Suite 5: Manifest Builder Core Functionality
// -----------------------------------------------------------------------------
console.log('\n[Suite 5: Manifest Builder & CuratedPairRecord Generation]');

runTest('Builds valid CuratedPairRecord manifest from raw synthetic fixtures', () => {
  const rawItems: RawDialogueItem[] = [
    {
      source_id: 'SYNTH-001',
      source: 'medvoice_synthetic_fixtures',
      patient_query: 'I have crushing chest pain and shortness of breath.',
      physician_reference: 'Immediate medical evaluation in an emergency department is required.',
      physician_specialty: 'Cardiology',
      secondary_tags: ['emergency', 'chest_pain'],
    },
    {
      source_id: 'SYNTH-002',
      source: 'medvoice_synthetic_fixtures',
      patient_query: 'I have an itchy red rash on my forearms after gardening.',
      physician_reference: 'This looks like contact dermatitis. Apply cold compresses and avoid scratching.',
      // physician_specialty omitted -> should fallback to "unknown"
    },
  ];

  const result = buildEvaluationManifest(rawItems);
  assert.strictEqual(result.totalProcessed, 2);
  assert.strictEqual(result.totalValid, 2);
  assert.strictEqual(result.totalRejected, 0);
  assert.strictEqual(result.records.length, 2);

  const rec1 = result.records[0];
  assert.strictEqual(rec1.id, 'MED-EVAL-0001');
  assert.strictEqual(rec1.source, 'medvoice_synthetic_fixtures');
  assert.strictEqual(rec1.source_id, 'SYNTH-001');
  assert.strictEqual(rec1.chief_complaint_domain, 'Cardiovascular');
  assert.strictEqual(rec1.physician_specialty, 'Cardiology');
  assert(rec1.patient_word_count > 0);
  assert(rec1.physician_word_count > 0);
  assert(rec1.patient_fkgl >= 0);
  assert(rec1.physician_fkgl >= 0);

  // Fallback specialty check
  const rec2 = result.records[1];
  assert.strictEqual(rec2.physician_specialty, 'unknown');
  assert.strictEqual(rec2.chief_complaint_domain, 'Dermatological');
});

runTest('Verifies SHA-256 hash provenance integrity', () => {
  const rawItem: RawDialogueItem = {
    source_id: 'SYNTH-003',
    source: 'medvoice_synthetic_fixtures',
    patient_query: 'Throat pain and difficulty swallowing.',
    physician_reference: 'Hydrate well and consult for possible strep pharyngitis.',
  };

  const result = buildEvaluationManifest([rawItem]);
  const record = result.records[0];

  const expectedHash = crypto
    .createHash('sha256')
    .update(`${record.patient_query.trim()}::${record.physician_reference.trim()}`)
    .digest('hex');

  assert.strictEqual(record.sha256, expectedHash, 'SHA256 must match cryptographic hash of query + reference');
});

runTest('Ensures ZERO automated ESI inference for Track A', () => {
  const rawItem: RawDialogueItem = {
    source_id: 'SYNTH-004',
    source: 'medvoice_synthetic_fixtures',
    patient_query: 'Severe headache and stiff neck.',
    physician_reference: 'Emergency evaluation needed for meningitis rule-out.',
  };

  const result = buildEvaluationManifest([rawItem]);
  const record = result.records[0] as any;

  // Track A records must not contain automated ESI inference fields
  assert.strictEqual(record.esi, undefined);
  assert.strictEqual(record.expectedEsi, undefined);
  assert.strictEqual(record.acuity_esi, undefined);
});

runTest('Writes output JSONL when outputJsonlPath option is provided', () => {
  const tempDir = path.resolve(__dirname, '../../eval/.tmp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  const testJsonl = path.join(tempDir, 'test-manifest.jsonl');

  const rawItems: RawDialogueItem[] = [
    {
      source_id: 'JSONL-001',
      source: 'medvoice_synthetic_fixtures',
      patient_query: 'Sudden high fever and shivering.',
      physician_reference: 'Check for dengue or malaria with complete blood count.',
    },
  ];

  const result = buildEvaluationManifest(rawItems, { outputJsonlPath: testJsonl });
  assert.strictEqual(result.manifestPath, testJsonl);
  assert(fs.existsSync(testJsonl));

  const lines = fs.readFileSync(testJsonl, 'utf-8').trim().split('\n');
  assert.strictEqual(lines.length, 1);
  const parsed = JSON.parse(lines[0]);
  assert.strictEqual(parsed.id, 'MED-EVAL-0001');
  assert.strictEqual(parsed.chief_complaint_domain, 'General Medicine');

  // Clean up
  fs.unlinkSync(testJsonl);
});

// -----------------------------------------------------------------------------
// Suite 6: Gate 0 Hard Enforcement
// -----------------------------------------------------------------------------
console.log('\n[Suite 6: Gate 0 Ingestion Hard Gating]');

runTest('Permits ingestion of approved source "medvoice_synthetic_fixtures"', () => {
  const items: RawDialogueItem[] = [
    {
      source_id: 'CLEARED-001',
      source: 'medvoice_synthetic_fixtures',
      patient_query: 'Sprained ankle while running.',
      physician_reference: 'Rest, ice, compression, elevation (RICE).',
    },
  ];
  const res = buildEvaluationManifest(items);
  assert.strictEqual(res.totalValid, 1);
});

runTest('Hard-blocks uncleared dataset "mtsamples" with Gate0FeasibilityError', () => {
  const items: RawDialogueItem[] = [
    {
      source_id: 'MTS-001',
      source: 'mtsamples',
      patient_query: 'History of present illness...',
      physician_reference: 'Diagnosis and clinical impression...',
    },
  ];

  assert.throws(
    () => {
      buildEvaluationManifest(items);
    },
    (err: any) => {
      return err instanceof Gate0FeasibilityError && err.datasetId === 'mtsamples';
    },
    'Must throw Gate0FeasibilityError when encountering uncleared mtsamples'
  );
});

runTest('Hard-blocks uncleared dataset "healthcaremagic_100k" with Gate0FeasibilityError', () => {
  const items: RawDialogueItem[] = [
    {
      source_id: 'HCM-001',
      source: 'healthcaremagic_100k',
      patient_query: 'Doctor I feel dizzy after lunch',
      physician_reference: 'You should monitor postprandial blood sugar.',
    },
  ];

  assert.throws(
    () => {
      buildEvaluationManifest(items);
    },
    (err: any) => {
      return err instanceof Gate0FeasibilityError && err.datasetId === 'healthcaremagic_100k';
    },
    'Must throw Gate0FeasibilityError when encountering healthcaremagic_100k without IEC approval'
  );
});

runTest('Hard-blocks tainted dataset "meddialog_repackaged" with Gate0FeasibilityError', () => {
  const items: RawDialogueItem[] = [
    {
      source_id: 'MDR-001',
      source: 'meddialog_repackaged',
      patient_query: 'Cough and throat pain',
      physician_reference: 'Take lozenges and hydration.',
    },
  ];

  assert.throws(
    () => {
      buildEvaluationManifest(items);
    },
    (err: any) => {
      return err instanceof Gate0FeasibilityError && err.datasetId === 'meddialog_repackaged';
    },
    'Must throw Gate0FeasibilityError for blocked meddialog_repackaged'
  );
});

runTest('Hard-blocks unverified unregistered source with Gate0FeasibilityError', () => {
  const items: RawDialogueItem[] = [
    {
      source_id: 'UNREG-001',
      source: 'unknown_scraped_dataset',
      patient_query: 'Random medical query',
      physician_reference: 'Random response',
    },
  ];

  assert.throws(
    () => {
      buildEvaluationManifest(items);
    },
    (err: any) => {
      return err instanceof Gate0FeasibilityError && err.datasetId === 'unknown_scraped_dataset';
    },
    'Must throw Gate0FeasibilityError for unverified dataset'
  );
});

console.log('\n================================================================================');
console.log(`ALL ${totalTests} TESTS EXECUTED SUCCESSFULLY (${passedTests}/${totalTests} PASSED)`);
console.log('================================================================================\n');
