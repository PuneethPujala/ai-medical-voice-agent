import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeClopperPearsonCI,
  computeWilsonScoreCI,
} from '../../scripts/run-clinical-eval';

test('Clinical Evaluation Confidence Interval Battery', async (t) => {
  await t.test('1. 22/22 Emergent Cases Recall (100% Observed)', () => {
    const cp = computeClopperPearsonCI(22, 22);
    const wilson = computeWilsonScoreCI(22, 22);

    assert.deepEqual(cp, ['84.6%', '100.0%']);
    assert.deepEqual(wilson, ['85.1%', '100.0%']);
  });

  await t.test('2. 12/13 Control Specificity (92.3% Observed)', () => {
    const cp = computeClopperPearsonCI(12, 13);
    const wilson = computeWilsonScoreCI(12, 13);

    assert.deepEqual(cp, ['64.0%', '99.8%']);
    assert.deepEqual(wilson, ['66.7%', '98.6%']);
  });

  await t.test('3. Extreme Edge Case: 0/10 Successes', () => {
    const cp = computeClopperPearsonCI(0, 10);
    const wilson = computeWilsonScoreCI(0, 10);

    assert.equal(cp[0], '0.0%');
    assert.equal(cp[1], '30.8%');
    assert.equal(wilson[0], '0.0%');
  });

  await t.test('4. Extreme Edge Case: 10/10 Successes', () => {
    const cp = computeClopperPearsonCI(10, 10);
    const wilson = computeWilsonScoreCI(10, 10);

    assert.equal(cp[0], '69.2%');
    assert.equal(cp[1], '100.0%');
    assert.equal(wilson[1], '100.0%');
  });

  await t.test('5. Zero Trials Guard: 0/0 Handling', () => {
    const cp = computeClopperPearsonCI(0, 0);
    const wilson = computeWilsonScoreCI(0, 0);

    assert.deepEqual(cp, ['0.0%', '0.0%']);
    assert.deepEqual(wilson, ['0.0%', '0.0%']);
  });
});
