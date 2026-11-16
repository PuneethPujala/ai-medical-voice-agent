import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateClinicalTranscriptionIntegrity,
  computeWordErrorRate,
  computeCharacterErrorRate,
  normalizeAcousticTranscript,
} from '../../eval/src/robustness/harness/acoustic-evaluation-framework';

test('Acoustic & Transcription Clinical Integrity Battery', async (t) => {
  await t.test('1. Unilateral laterality inversion: Left -> Right', () => {
    const res = evaluateClinicalTranscriptionIntegrity(
      'Patient reports severe left sided chest pain radiating to jaw.',
      'Patient reports severe right sided chest pain radiating to jaw.',
      ['chest pain'],
      []
    );
    assert.equal(res.lateralityInverted, true);
    assert.equal(res.lateralityOmitted, false);
    assert.equal(res.bilateralMismatch, false);
    assert.equal(res.symptomOmitted, false);
    assert.equal(res.negationLost, false);
  });

  await t.test('2. Unilateral laterality inversion: Right -> Left', () => {
    const res = evaluateClinicalTranscriptionIntegrity(
      'Acute weakness in the right arm and leg.',
      'Acute weakness in the left arm and leg.',
      ['weakness'],
      [],
      ['right']
    );
    assert.equal(res.lateralityInverted, true);
    assert.equal(res.lateralityOmitted, false);
    assert.equal(res.bilateralMismatch, false);
  });

  await t.test('3. Bilateral reduction to unilateral left (Bilateral Mismatch)', () => {
    const res = evaluateClinicalTranscriptionIntegrity(
      'Patient presents with bilateral leg swelling and shortness of breath.',
      'Patient presents with left leg swelling and shortness of breath.',
      ['leg swelling', 'shortness of breath'],
      [],
      ['bilateral']
    );
    assert.equal(res.bilateralMismatch, true);
    assert.equal(res.lateralityInverted, false);
    assert.equal(res.lateralityOmitted, false);
  });

  await t.test('4. Bilateral reduction to unilateral right using "both"', () => {
    const res = evaluateClinicalTranscriptionIntegrity(
      'Numbness in both hands and feet.',
      'Numbness in right hand and foot.',
      ['numbness'],
      []
    );
    assert.equal(res.bilateralMismatch, true);
    assert.equal(res.lateralityInverted, false);
    assert.equal(res.lateralityOmitted, false);
  });

  await t.test('5. Unilateral expansion to bilateral (Bilateral Mismatch)', () => {
    const res = evaluateClinicalTranscriptionIntegrity(
      'Sudden loss of vision in the left eye.',
      'Sudden loss of vision in both eyes.',
      ['loss of vision'],
      [],
      ['left']
    );
    assert.equal(res.bilateralMismatch, true);
    assert.equal(res.lateralityInverted, false);
    assert.equal(res.lateralityOmitted, false);
  });

  await t.test('6. Laterality omission: GT unilateral left, TX omits laterality', () => {
    const res = evaluateClinicalTranscriptionIntegrity(
      'Severe pain in the left shoulder.',
      'Severe pain in the shoulder.',
      ['shoulder'],
      [],
      ['left']
    );
    assert.equal(res.lateralityOmitted, true);
    assert.equal(res.lateralityInverted, false);
    assert.equal(res.bilateralMismatch, false);
  });

  await t.test('7. Laterality omission: GT bilateral, TX omits laterality', () => {
    const res = evaluateClinicalTranscriptionIntegrity(
      'Bilateral lung crackles observed on auscultation.',
      'Lung crackles observed on auscultation.',
      ['crackles'],
      [],
      ['bilateral']
    );
    assert.equal(res.lateralityOmitted, true);
    assert.equal(res.lateralityInverted, false);
    assert.equal(res.bilateralMismatch, false);
  });

  await t.test('8. Preserved bilateral laterality: No laterality error', () => {
    const res = evaluateClinicalTranscriptionIntegrity(
      'Patient has bilateral pitting edema in both legs.',
      'Patient has bilateral pitting edema in both legs.',
      ['pitting edema'],
      [],
      ['bilateral']
    );
    assert.equal(res.lateralityInverted, false);
    assert.equal(res.lateralityOmitted, false);
    assert.equal(res.bilateralMismatch, false);
  });

  await t.test('9. Negation lost detection (False Alarm trigger)', () => {
    const res = evaluateClinicalTranscriptionIntegrity(
      'General routine follow-up. I have no chest pain and no shortness of breath.',
      'General routine follow-up. I have chest pain and shortness of breath.',
      [],
      ['no chest pain', 'no shortness of breath']
    );
    assert.equal(res.negationLost, true);
    assert.equal(res.symptomOmitted, false);
  });

  await t.test('10. Critical symptom omitted detection (Under-triage risk)', () => {
    const res = evaluateClinicalTranscriptionIntegrity(
      'Sudden crushing chest pressure radiating into left arm with diaphoresis.',
      'Sudden left arm with diaphoresis.',
      ['crushing chest pressure'],
      []
    );
    assert.equal(res.symptomOmitted, true);
  });

  await t.test('11. Word Error Rate calculation correctness', () => {
    assert.equal(computeWordErrorRate('the patient has fever', 'the patient has fever'), 0);
    // 1 substitution out of 4 words = 0.25
    assert.equal(computeWordErrorRate('the patient has fever', 'the patient has coughing'), 0.25);
    // 1 deletion out of 4 words = 0.25
    assert.equal(computeWordErrorRate('the patient has fever', 'the patient has'), 0.25);
    // 1 insertion out of 4 words = 0.25
    assert.equal(computeWordErrorRate('the patient has fever', 'the patient now has fever'), 0.25);
    // Empty strings
    assert.equal(computeWordErrorRate('', ''), 0);
    assert.equal(computeWordErrorRate('one', ''), 1);
  });

  await t.test('12. Character Error Rate (CER) calculation correctness', () => {
    assert.equal(computeCharacterErrorRate('cough', 'cough'), 0);
    // 1 substitution ('c' -> 't') out of 5 chars = 0.2
    assert.equal(computeCharacterErrorRate('cough', 'tough'), 0.2);
    // 1 insertion ('s') out of 5 chars = 0.2
    assert.equal(computeCharacterErrorRate('cough', 'coughs'), 0.2);
    // 1 deletion ('h') out of 5 chars = 0.2
    assert.equal(computeCharacterErrorRate('cough', 'coug'), 0.2);
    // Empty string edge cases
    assert.equal(computeCharacterErrorRate('', ''), 0);
    assert.equal(computeCharacterErrorRate('a', ''), 1);
  });

  await t.test('13. Polarity inversion: Positive symptom negated in transcription', () => {
    const res = evaluateClinicalTranscriptionIntegrity(
      'The patient has severe chest pain and diaphoresis.',
      'The patient denies severe chest pain and diaphoresis.',
      ['chest pain'],
      []
    );
    assert.equal(res.polarityInverted, true);
    assert.equal(res.symptomOmitted, false);
  });

  await t.test('14. Negation equivalent rephrasing: Semantic polarity preserved (No negation lost)', () => {
    const res = evaluateClinicalTranscriptionIntegrity(
      'Patient reports no chest pain and no fever.',
      'Patient reports denies chest pain and without fever.',
      [],
      ['no chest pain']
    );
    assert.equal(res.negationLost, false);
  });

  await t.test('15. Site-specific laterality swap detection', () => {
    const res = evaluateClinicalTranscriptionIntegrity(
      'Patient reports weakness in left arm and numbness in right leg.',
      'Patient reports weakness in right arm and numbness in right leg.',
      ['weakness', 'numbness'],
      []
    );
    assert.equal(res.lateralityInverted, true);
    assert.ok(res.siteSpecificLateralityErrors && res.siteSpecificLateralityErrors.length > 0);
  });

  await t.test('16. Sentence boundary negation isolation (Prevents cross-sentence leakage)', () => {
    const res = evaluateClinicalTranscriptionIntegrity(
      'No fever. The patient has chest pain.',
      'No fever. The patient denies chest pain.',
      ['chest pain'],
      []
    );
    assert.equal(res.polarityInverted, true);
    assert.equal(res.symptomOmitted, false);
  });

  await t.test('17. Polarity-aware laterality extraction (Excludes denied side from bilateral synthesis)', () => {
    const res = evaluateClinicalTranscriptionIntegrity(
      'Pain in the left arm, no pain in the right arm.',
      'Pain in the right arm, no pain in the left arm.',
      ['pain'],
      []
    );
    assert.equal(res.lateralityInverted, true);
    assert.equal(res.bilateralMismatch, false);
  });
});
