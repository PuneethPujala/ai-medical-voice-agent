import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import {
  computeNormalizedSha256,
  computeFileSha256,
} from '../../eval/src/robustness/harness/run-robustness-suite';

test('Safety Engine Hashing & Cross-Platform Line Ending Integrity', async (t) => {
  await t.test('1. LF and CRLF representations of identical source produce identical hashes', () => {
    const lfSource = 'export const RED_FLAGS = [\n  "chest pain",\n  "shortness of breath"\n];\n';
    const crlfSource = 'export const RED_FLAGS = [\r\n  "chest pain",\r\n  "shortness of breath"\r\n];\r\n';

    const lfHash = computeNormalizedSha256(lfSource);
    const crlfHash = computeNormalizedSha256(crlfSource);

    assert.equal(lfHash, crlfHash);
    assert.equal(typeof lfHash, 'string');
    assert.equal(lfHash.length, 64);
  });

  await t.test('2. Normalized hash of universal-red-flags.ts matches canonical baseline hash', () => {
    const filePath = path.resolve('lib/triage/universal-red-flags.ts');
    const hash = computeFileSha256(filePath);
    assert.equal(hash, '8b0031c51bfea3753405d29cbf5956047af70335dd409ef697923350effd6ec4');
  });

  await t.test('3. Normalized hash of safety-arbiter.ts matches canonical baseline hash', () => {
    const filePath = path.resolve('lib/triage/safety-arbiter.ts');
    const hash = computeFileSha256(filePath);
    assert.equal(hash, '26f244fa42b3f043cf1f51dbe4be0f8f17fe3b0a57a01afda10b2e0d494ce639');
  });

  await t.test('4. Subtle semantic changes produce distinct hashes (collision/tamper resistance)', () => {
    const original = 'const x = 1;\n';
    const tampered = 'const x = 2;\n';

    assert.notEqual(computeNormalizedSha256(original), computeNormalizedSha256(tampered));
  });
});
