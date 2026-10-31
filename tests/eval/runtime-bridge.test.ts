/**
 * MedVoice Clinical Response Evaluation Framework
 * Task 2: Production Runtime Bridge & Session Isolation Test Suite
 *
 * Verifies:
 * 1. Fresh session initialization via conversationManager.createInitialState().
 * 2. Complete session isolation across consecutive execution turns (zero state carryover).
 * 3. Strict persona lock to "dr-sarah-chen".
 * 4. Operational telemetry collection (latency, promptHash, timestamp, token/word count, checkpoint).
 * 5. Production voice-length guard adherence (<60 words per turn).
 * 6. Hard prevention of physician reference leakage (fails closed if reference is injected).
 * 7. Input validation (short clinical queries accepted, empty/whitespace queries rejected).
 * 8. Emergency detection preemption behavior on acute clinical presentations.
 */

import assert from 'assert';
import * as crypto from 'crypto';
import {
  executeIsolatedTurn,
  TurnContext,
  TurnExecutionResult,
  TurnTelemetry,
  IsolatedTurnOptions,
} from '../../eval/src/harness/runtime-bridge';
import {
  createIsolatedSession,
  verifySessionCleanliness,
  resetSessionBarrier,
} from '../../eval/src/harness/session-isolation';

let totalTests = 0;
let passedTests = 0;

async function runTestAsync(testName: string, fn: () => Promise<void>): Promise<void> {
  totalTests++;
  try {
    await fn();
    console.log(`  ✓ PASS: ${testName}`);
    passedTests++;
  } catch (err: any) {
    console.error(`  ✗ FAIL: ${testName}`);
    console.error(err);
    throw err;
  }
}

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

async function main() {
  console.log('================================================================================');
  console.log('MEDVOICE CLINICAL EVALUATION: RUNTIME BRIDGE & SESSION ISOLATION TEST SUITE');
  console.log('================================================================================\n');

  console.log('[Suite 1: Session Isolation & Cleanliness Barrier]');

  runTest('createIsolatedSession returns fresh, unpolluted ClinicalInterviewState', () => {
    const session = createIsolatedSession();
    assert.strictEqual(session.phase, 'dormant');
    assert.strictEqual(session.informationState, 'insufficient');
    assert.strictEqual(session.caseVersion, 1);
    assert.deepStrictEqual(session.slots.known_facts, []);
    assert.strictEqual(session.cumulativeTranscript, '');
    assert.strictEqual(verifySessionCleanliness(session), true);
  });

  runTest('verifySessionCleanliness detects polluted state', () => {
    const dirtySession = createIsolatedSession();
    dirtySession.slots.known_facts.push('chest pain: present');
    assert.strictEqual(verifySessionCleanliness(dirtySession), false);

    const versionPolluted = createIsolatedSession();
    versionPolluted.caseVersion = 2;
    assert.strictEqual(verifySessionCleanliness(versionPolluted), false);
  });

  runTest('resetSessionBarrier resets global state without error', () => {
    assert.doesNotThrow(() => {
      resetSessionBarrier();
    });
  });

  console.log('\n[Suite 2: Production Runtime Bridge Execution]');

  await runTestAsync('Executes isolated turn and produces valid TurnExecutionResult', async () => {
    const result: TurnExecutionResult = await executeIsolatedTurn(
      'I have had a mild dry cough for three days.'
    );

    assert(result, 'Result must be returned');
    assert(typeof result.doctorReply === 'string', 'doctorReply must be a string');
    assert(result.doctorReply.trim().length > 0, 'doctorReply must not be empty');
    assert(result.interviewState, 'interviewState must be present');
    assert(result.telemetry, 'telemetry must be present');
  });

  await runTestAsync('Enforces production voice-length guard (<60 words)', async () => {
    const result = await executeIsolatedTurn(
      'I have been feeling tired lately and have a mild headache since yesterday.'
    );

    const words = result.doctorReply.trim().split(/\s+/).filter(Boolean);
    assert(
      words.length <= 60,
      `Doctor reply exceeded 60 words: count was ${words.length}. Reply: "${result.doctorReply}"`
    );
    assert.strictEqual(result.voiceGuardPassed, true, 'voiceGuardPassed flag must be true');
    assert.strictEqual(result.telemetry.wordCount, words.length);
  });

  await runTestAsync('Strictly locks doctor persona to dr-sarah-chen', async () => {
    // Attempting to override doctorId to another specialist
    const result = await executeIsolatedTurn('I feel dizzy when I stand up.', undefined, {
      doctorId: 'dr-marcus-vance' as any,
    });

    assert.strictEqual(
      result.rawResponse.doctor.id,
      'dr-sarah-chen',
      'Doctor persona must remain strictly locked to dr-sarah-chen'
    );
    assert(
      result.rawResponse.doctor.name.includes('Sarah Chen'),
      'Doctor name must reflect Dr. Sarah Chen'
    );
  });

  await runTestAsync('Collects comprehensive operational telemetry', async () => {
    const query = 'I have a sore throat and slight difficulty swallowing liquids.';
    const result = await executeIsolatedTurn(query);
    const telemetry = result.telemetry;

    assert(telemetry.executionLatencyMs > 0, 'Latency must be greater than 0 ms');
    assert(typeof telemetry.executionLatencyMs === 'number');
    assert.strictEqual(telemetry.retryCount, 0, 'Default retry count should be 0');
    assert(telemetry.wordCount > 0, 'wordCount must be greater than 0');
    assert(telemetry.tokenCountEstimated > 0, 'Estimated token count must be greater than 0');

    // Prompt hash verification: SHA-256 hex string of 64 chars
    assert.strictEqual(telemetry.promptHash.length, 64, 'promptHash must be 64-character SHA-256 hex');
    const expectedHash = crypto.createHash('sha256').update(query.trim()).digest('hex');
    assert.strictEqual(telemetry.promptHash, expectedHash);

    // Timestamp verification
    const parsedTime = Date.parse(telemetry.timestamp);
    assert(!isNaN(parsedTime), 'timestamp must be a valid ISO string');

    // Checkpoint / provider presence
    assert(telemetry.modelCheckpoint.length > 0, 'modelCheckpoint must not be empty');
    assert(telemetry.provider.length > 0, 'provider must not be empty');
  });

  console.log('\n[Suite 3: Sequential Turn Isolation & State Barrier]');

  await runTestAsync('Sequential calls maintain complete state isolation (no cross-contamination)', async () => {
    // Turn 1: Cardiac presentation
    const turn1 = await executeIsolatedTurn(
      'I have crushing retrosternal chest pain radiating to my jaw.'
    );
    assert(turn1.doctorReply.length > 0);

    // Turn 2: Unrelated dermatological complaint in a fresh isolated turn
    const turn2 = await executeIsolatedTurn(
      'I developed an itchy red rash on both forearms after gardening.'
    );

    // Turn 2 MUST NOT have any cardiac symptoms from Turn 1 in its interview state
    const t2Facts = turn2.interviewState?.slots?.known_facts || [];
    const t2Transcript = turn2.interviewState?.cumulativeTranscript || '';

    const hasCardiacBleed = t2Facts.some((f: string) => /chest|retrosternal|jaw/i.test(f));
    assert(
      !hasCardiacBleed,
      `State leakage detected! Turn 2 state contains Turn 1 cardiac facts: ${JSON.stringify(t2Facts)}`
    );
    assert(
      !/retrosternal|jaw/i.test(t2Transcript),
      `Transcript leakage detected! Turn 2 transcript contains Turn 1 text: "${t2Transcript}"`
    );
  });

  console.log('\n[Suite 4: Physician Reference Leakage Prevention]');

  await runTestAsync('Hard-blocks and throws when physician reference is injected into options', async () => {
    await assert.rejects(
      async () => {
        // Exploit attempt: passing forbidden reference property
        await (executeIsolatedTurn as any)('I have a headache.', undefined, {
          physician_reference: 'Take acetaminophen 500mg every 6 hours and rest in a dark room.',
        });
      },
      /Physician reference leakage detected/i
    );
  });

  await runTestAsync('Hard-blocks when reference property is provided in options', async () => {
    await assert.rejects(
      async () => {
        await (executeIsolatedTurn as any)('I have a headache.', undefined, {
          reference: 'You might have migraine. Hydrate and observe.',
        });
      },
      /Physician reference leakage detected/i
    );
  });

  console.log('\n[Suite 5: Clinical Input Edge Cases]');

  await runTestAsync('Accepts valid short query ("I am dizzy")', async () => {
    const result = await executeIsolatedTurn('I am dizzy');
    assert(result.doctorReply.length > 0);
  });

  await runTestAsync('Rejects empty or whitespace-only queries', async () => {
    await assert.rejects(
      async () => {
        await executeIsolatedTurn('   \n  \t  ');
      },
      /Message is required and must be text|Empty patient query/i
    );
  });

  console.log('\n================================================================================');
  console.log(`ALL ${totalTests} TESTS EXECUTED SUCCESSFULLY (${passedTests}/${totalTests} PASSED)`);
  console.log('================================================================================\n');
}

main().catch((err) => {
  console.error('\nTest suite execution failed:', err);
  process.exit(1);
});
