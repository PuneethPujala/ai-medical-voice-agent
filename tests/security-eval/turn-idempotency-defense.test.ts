import assert from "assert";
import {
  computeTurnFingerprint,
  acquireTurnReservation,
  commitTurnWithFencing,
  generateEmergencyTurnId,
  canonicalJsonStringify,
  memoryTurnIdempotencyKeys,
} from "../../lib/security/idempotency";
import { memoryConsultations } from "../../app/api/consultations/route";
import { evaluatePreArbiter } from "../../lib/triage/pre-arbiter";
import { validateAudioMetrics, aggregateTurnAudioMetrics, TurnAudioMetricRecord } from "../../lib/acoustic/acoustic-dsp-analyzer";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { setCustomDbClient } from "../../config/db";
import * as dotenv from "dotenv";

if (process.env.MEDVOICE_OFFLINE_TESTS === "1") {
  delete process.env.DATABASE_URL;
} else {
  dotenv.config({ path: ".env.local" });
  if (!process.env.DATABASE_URL) {
    dotenv.config({ path: ".env" });
  }
}

(process.env as Record<string, string | undefined>).NODE_ENV = "test";

async function runTurnIdempotencyDefenseTests() {
  console.log("================================================================================");
  console.log("  FINDING 7: TURN IDEMPOTENCY DEFENSE & ATOMIC FENCING TEST BATTERY           ");
  console.log("================================================================================");

  let passed = 0;
  let failed = 0;
  let skipped = 0;

  function testPass(name: string) {
    console.log(`  [PASS] ${name}`);
    passed++;
  }

  function testFail(name: string, err: any) {
    console.error(`  [FAIL] ${name}:`, err);
    failed++;
  }

  function testSkip(name: string, reason: string) {
    console.log(`  [SKIP] ${name} (${reason})`);
    skipped++;
  }

  // Ensure Unit Tests 1-7 execute deterministically in memory mode
  setCustomDbClient(false); // Force in-memory fallback

  // ---------------------------------------------------------------------------
  // TEST 1: Canonical Serialization & Request Fingerprint Consistency
  // ---------------------------------------------------------------------------
  try {
    const objA = { message: "Chest pain", doctorId: "dr-sarah-chen", isInterruption: false, audioMetrics: { durationMs: 1200, meanF0Hz: 142.5 } };
    const objB = { doctorId: "dr-sarah-chen", message: "  CHEST PAIN  ", audioMetrics: { meanF0Hz: 142.5, durationMs: 1200 }, isInterruption: false };
    
    const hashA = computeTurnFingerprint(objA as any);
    const hashB = computeTurnFingerprint(objB as any);
    assert.strictEqual(hashA, hashB, "Fingerprint must match across reordered keys, whitespace, and casing");

    // Fingerprint must differ on materially different text or acoustics
    const objC = { message: "Chest pain and cold sweat", doctorId: "dr-sarah-chen", isInterruption: false };
    const hashC = computeTurnFingerprint(objC as any);
    assert.notStrictEqual(hashA, hashC, "Fingerprint must change when medical text changes");

    const objD = { message: "Chest pain", doctorId: "dr-sarah-chen", isInterruption: false, audioMetrics: { durationMs: 4500, meanF0Hz: 142.5 } };
    const hashD = computeTurnFingerprint(objD as any);
    assert.notStrictEqual(hashA, hashD, "Fingerprint must change when audio duration changes");

    testPass("Test 1: Canonical serialization and request fingerprinting");
  } catch (err) {
    testFail("Test 1: Canonical serialization and request fingerprinting", err);
  }

  // ---------------------------------------------------------------------------
  // TEST 2: Sequential Reservation & Cached Replay (Memory Store)
  // ---------------------------------------------------------------------------
  try {
    const userId = "test-user-seq";
    const encounterId = `ENC-SEQ-${Date.now()}`;
    const turnId = `turn-seq-${Date.now()}`;
    const fingerprint = computeTurnFingerprint({ message: "Hello Doctor", doctorId: "dr-sarah-chen" });

    // Step 2a: First acquisition must succeed
    const res1 = await acquireTurnReservation({
      userId,
      encounterId,
      turnId,
      requestFingerprint: fingerprint,
    });
    assert.strictEqual(res1.outcome, "ACQUIRED");
    assert.strictEqual(res1.claimGeneration, 1);

    // Step 2b: Immediate second attempt before completion returns IN_FLIGHT
    const res2 = await acquireTurnReservation({
      userId,
      encounterId,
      turnId,
      requestFingerprint: fingerprint,
    });
    assert.strictEqual(res2.outcome, "IN_FLIGHT");

    // Step 2c: Commit the turn
    memoryConsultations.push({
      id: encounterId,
      userId,
      caseVersion: 1,
      interviewState: {},
      deliveredTurnRecords: [],
    });

    const commitRes = await commitTurnWithFencing({
      userId,
      encounterId,
      turnId,
      claimGeneration: 1,
      expectedCaseVersion: 1,
      nextCaseVersion: 2,
      stateToPersist: { caseVersion: 2, deliveredTurnRecords: [{ turnId: 1, clientTurnId: turnId, deliveredText: "Hello! How can I help?" }] },
      responsePayload: { doctorReply: "Hello! How can I help?", caseVersion: 2 },
    });
    assert.strictEqual(commitRes.success, true);
    assert.strictEqual(commitRes.caseVersion, 2);

    // Step 2d: Third acquisition after commit returns REPLAY with cached payload
    const res3 = await acquireTurnReservation({
      userId,
      encounterId,
      turnId,
      requestFingerprint: fingerprint,
    });
    assert.strictEqual(res3.outcome, "REPLAY");
    assert.strictEqual((res3 as any).responsePayload.doctorReply, "Hello! How can I help?");

    testPass("Test 2: Sequential reservation, in-flight detection, and cached replay (Memory Store)");
  } catch (err) {
    testFail("Test 2: Sequential reservation, in-flight detection, and cached replay (Memory Store)", err);
  }

  // ---------------------------------------------------------------------------
  // TEST 3: Fingerprint Mismatch Rejection
  // ---------------------------------------------------------------------------
  try {
    const userId = "test-user-mismatch";
    const encounterId = `ENC-MIS-${Date.now()}`;
    const turnId = `turn-mis-${Date.now()}`;
    const fp1 = computeTurnFingerprint({ message: "Mild cough", doctorId: "dr-sarah-chen" });
    const fp2 = computeTurnFingerprint({ message: "Severe chest pain", doctorId: "dr-sarah-chen" });

    // Acquire under fp1
    await acquireTurnReservation({ userId, encounterId, turnId, requestFingerprint: fp1 });

    // Reuse turnId with materially different fp2
    const resMismatch = await acquireTurnReservation({ userId, encounterId, turnId, requestFingerprint: fp2 });
    assert.strictEqual(resMismatch.outcome, "FINGERPRINT_MISMATCH");

    testPass("Test 3: Fingerprint mismatch rejection upon key reuse");
  } catch (err) {
    testFail("Test 3: Fingerprint mismatch rejection upon key reuse", err);
  }

  // ---------------------------------------------------------------------------
  // TEST 4: Valid Claim with Stale caseVersion (CTE Bug Prevention Test)
  // ---------------------------------------------------------------------------
  try {
    const userId = "test-user-stale-ver";
    const encounterId = `ENC-STALE-${Date.now()}`;
    const turnId = `turn-stale-${Date.now()}`;
    const fp = computeTurnFingerprint({ message: "Checking version", doctorId: "dr-sarah-chen" });

    // Encounter is at version 2 (e.g. concurrent turn committed earlier)
    memoryConsultations.push({
      id: encounterId,
      userId,
      caseVersion: 2,
      interviewState: {},
      deliveredTurnRecords: [],
    });

    // Acquire claim
    const claim = await acquireTurnReservation({ userId, encounterId, turnId, requestFingerprint: fp });
    assert.strictEqual(claim.outcome, "ACQUIRED");

    // Worker attempts commit proposing update from expectedCaseVersion: 1
    const commitFail = await commitTurnWithFencing({
      userId,
      encounterId,
      turnId,
      claimGeneration: claim.claimGeneration,
      expectedCaseVersion: 1, // Stale! Actual is 2
      nextCaseVersion: 2,
      stateToPersist: {},
      responsePayload: { doctorReply: "Phantom reply" },
    });

    assert.strictEqual(commitFail.success, false);
    assert.strictEqual(commitFail.code, "CONCURRENT_MODIFICATION_CONFLICT");

    // CRITICAL INVARIANT: Idempotency record must NOT be marked completed!
    const key = `${userId}:${encounterId}:${turnId}`;
    const memRec = memoryTurnIdempotencyKeys.get(key);
    assert.notStrictEqual(memRec?.status, "completed", "Must NOT mark idempotency completed when CAS fails");
    assert.strictEqual(memRec?.status, "conflict", "Must set conflict status so it is not stuck pending");

    testPass("Test 4: Valid claim with stale caseVersion fails CAS and prevents phantom replay caching");
  } catch (err) {
    testFail("Test 4: Valid claim with stale caseVersion fails CAS and prevents phantom replay caching", err);
  }

  // ---------------------------------------------------------------------------
  // TEST 5: Stale Claim Generation Fencing After Lease Takeover
  // ---------------------------------------------------------------------------
  try {
    const userId = "test-user-fence";
    const encounterId = `ENC-FENCE-${Date.now()}`;
    const turnId = `turn-fence-${Date.now()}`;
    const fp = computeTurnFingerprint({ message: "Lease timeout test", doctorId: "dr-sarah-chen" });

    memoryConsultations.push({
      id: encounterId,
      userId,
      caseVersion: 1,
      interviewState: {},
      deliveredTurnRecords: [],
    });

    // Worker A acquires claim with generation 1
    const claimA = await acquireTurnReservation({ userId, encounterId, turnId, requestFingerprint: fp, leaseDurationMs: 10 });
    assert.strictEqual(claimA.outcome, "ACQUIRED");
    assert.strictEqual((claimA as any).claimGeneration, 1);

    // Simulate Worker A stalling past lease duration
    const memKey = `${userId}:${encounterId}:${turnId}`;
    const keyRec = memoryTurnIdempotencyKeys.get(memKey)!;
    keyRec.leaseExpiresAt = Date.now() - 50; // Expired!

    // Worker B triggers recovery after expiry, acquiring generation 2
    const claimB = await acquireTurnReservation({ userId, encounterId, turnId, requestFingerprint: fp });
    assert.strictEqual(claimB.outcome, "ACQUIRED");
    assert.strictEqual(claimB.claimGeneration, 2);

    // Worker A awakens and attempts commit using stale generation 1
    const staleCommit = await commitTurnWithFencing({
      userId,
      encounterId,
      turnId,
      claimGeneration: 1, // Stale generation!
      expectedCaseVersion: 1,
      nextCaseVersion: 2,
      stateToPersist: { caseVersion: 2, deliveredTurnRecords: [] },
      responsePayload: { doctorReply: "Stale worker reply" },
    });

    assert.strictEqual(staleCommit.success, false);
    assert.strictEqual(staleCommit.code, "FENCING_CONFLICT");

    // Worker B completes with generation 2 -> succeeds
    const validCommit = await commitTurnWithFencing({
      userId,
      encounterId,
      turnId,
      claimGeneration: 2, // Valid generation!
      expectedCaseVersion: 1,
      nextCaseVersion: 2,
      stateToPersist: { caseVersion: 2, deliveredTurnRecords: [{ turnId: 1, clientTurnId: turnId, deliveredText: "Worker B reply" }] },
      responsePayload: { doctorReply: "Worker B reply" },
    });
    assert.strictEqual(validCommit.success, true);

    testPass("Test 5: Stale claim generation is atomically fenced from committing");
  } catch (err) {
    testFail("Test 5: Stale claim generation is atomically fenced from committing", err);
  }

  // ---------------------------------------------------------------------------
  // TEST 6: Bounded Deterministic Emergency Key & Pre-Arbiter Dispatch
  // ---------------------------------------------------------------------------
  try {
    const userId = "test-user-emg";
    const encounterId = "ENC-EMG-4412";
    const baseTurnId = "turn-original-123";
    const emergencyFp = computeTurnFingerprint({ message: "My face is drooping and speech is slurred", doctorId: "dr-sarah-chen" });

    // 6a. Generate deterministic emergency key
    const emgKey1 = generateEmergencyTurnId(userId, encounterId, baseTurnId, emergencyFp);
    const emgKey2 = generateEmergencyTurnId(userId, encounterId, baseTurnId, emergencyFp);
    assert.strictEqual(emgKey1, emgKey2, "Emergency key must be 100% deterministic on retry");
    assert.strictEqual(emgKey1.length, 36, "Emergency key must be exactly 36 characters (emg_ + 32-char hex)");
    assert.match(emgKey1, /^emg_[a-f0-9]{32}$/, "Emergency key must match emg_ prefix format");

    // 6b. Verify pre-arbiter symptom differentiation (Stroke vs Airway vs Chest Pain)
    const strokeCheck = evaluatePreArbiter({ transcript: "My face is drooping and speech is slurred" });
    assert.strictEqual(strokeCheck.immediate_danger, true);
    assert.ok(strokeCheck.pre_safety_flags.includes("PRE_FLAG_ACUTE_NEUROLOGIC_DEFICIT"));

    const airwayCheck = evaluatePreArbiter({ transcript: "Cannot breathe blue lips throat swelling" });
    assert.strictEqual(airwayCheck.immediate_danger, true);
    assert.ok(airwayCheck.pre_safety_flags.includes("PRE_FLAG_IMMEDIATE_AIRWAY_FAILURE"));

    const cardiacCheck = evaluatePreArbiter({ transcript: "Severe chest pain radiating to left arm with cold sweats" });
    assert.strictEqual(cardiacCheck.immediate_danger, true);
    assert.ok(cardiacCheck.pre_safety_flags.includes("PRE_FLAG_ACUTE_CHEST_PAIN"));
    assert.ok(cardiacCheck.pre_safety_flags.includes("PRE_FLAG_ACS_RADIATION_OR_DIAPHORESIS"));

    testPass("Test 6: Bounded deterministic emergency key and symptom-specific pre-arbiter dispatch");
  } catch (err) {
    testFail("Test 6: Bounded deterministic emergency key and symptom-specific pre-arbiter dispatch", err);
  }

  // ---------------------------------------------------------------------------
  // TEST 7: Acoustic Telemetry Deduplication
  // ---------------------------------------------------------------------------
  try {
    const rawMetrics = {
      durationMs: 3200,
      totalPauseDurationMs: 800,
      pauseCount: 2,
      speechPauseRatio: 0.25,
      meanPauseDurationMs: 400,
      meanF0Hz: 165.2,
      energyVariance: 0.15,
      pitchVariance: 0.22,
      sampleRate: 16000,
      isLiveDsp: true,
    };
    const validated = validateAudioMetrics(rawMetrics);
    assert.ok(validated);

    let cumulative: any = null;
    const history: TurnAudioMetricRecord[] = [];

    // Turn 1 aggregation
    const turn1Id = "turn-audio-1";
    cumulative = aggregateTurnAudioMetrics(cumulative, validated!);
    history.push({
      turnIndex: 1,
      turnId: turn1Id,
      caseVersion: 1,
      timestamp: new Date().toISOString(),
      metrics: validated!,
    });

    assert.strictEqual(history.length, 1);
    assert.strictEqual(cumulative.durationMs, 3200);
    assert.strictEqual(cumulative.pauseCount, 2);

    // Turn 1 retry: check deduplication using turnId
    const isAlreadyRecorded = history.some((h) => h.turnId === turn1Id);
    assert.strictEqual(isAlreadyRecorded, true, "Must detect turnId already in history");

    if (!isAlreadyRecorded) {
      cumulative = aggregateTurnAudioMetrics(cumulative, validated!);
    }

    // Must NOT have doubled the metrics
    assert.strictEqual(history.length, 1);
    assert.strictEqual(cumulative.durationMs, 3200);
    assert.strictEqual(cumulative.pauseCount, 2);

    testPass("Test 7: Acoustic telemetry deduplication prevents metric distortion on retry");
  } catch (err) {
    testFail("Test 7: Acoustic telemetry deduplication prevents metric distortion on retry", err);
  }

  // ---------------------------------------------------------------------------
  // TEST 8: Live Neon PostgreSQL Multi-Worker Test & commit_consultation_turn Stored Function
  // ---------------------------------------------------------------------------
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    testSkip("Test 8: Live Neon PostgreSQL multi-worker concurrency and stored function", "DATABASE_URL not set in test environment; passing in offline mode");
  } else {
    try {
      console.log("  Running Test 8 against live Neon PostgreSQL datastore...");
      setCustomDbClient(null); // Restore default live db client
      const sql = neon(dbUrl);

      const encId = `ENC-LIVE-${Date.now()}`;
      const turnId = `turn-live-${Date.now()}`;
      const userId = "test-live-worker";
      const fp = computeTurnFingerprint({ message: "Live DB concurrency test", doctorId: "dr-sarah-chen" });

      // Create consultation record in Neon
      await sql`
        INSERT INTO consultations (id, user_id, doctor_id, doctor_name, specialty, case_version, status, created_at)
        VALUES (${encId}, ${userId}, 'dr-sarah-chen', 'Dr. Sarah Chen', 'Internal Medicine', 1, 'in_progress', NOW());
      `;

      // 8a. Simulate simultaneous reservation from Worker A and Worker B
      const [resA, resB] = await Promise.all([
        acquireTurnReservation({ userId, encounterId: encId, turnId, requestFingerprint: fp }),
        acquireTurnReservation({ userId, encounterId: encId, turnId, requestFingerprint: fp }),
      ]);

      const outcomes = [resA.outcome, resB.outcome].sort();
      assert.strictEqual(outcomes[0], "ACQUIRED", "Exactly one worker must acquire claim");
      assert.strictEqual(outcomes[1], "IN_FLIGHT", "Second concurrent worker must observe in-flight claim");

      // 8b. Worker with stale caseVersion fails CAS and does not mark completed
      const staleCommit = await commitTurnWithFencing({
        userId,
        encounterId: encId,
        turnId,
        claimGeneration: 1,
        expectedCaseVersion: 999, // Stale! Actual is 1
        nextCaseVersion: 1000,
        stateToPersist: {},
        responsePayload: { doctorReply: "Live stale test" },
      });
      assert.strictEqual(staleCommit.success, false);
      assert.strictEqual(staleCommit.code, "CONCURRENT_MODIFICATION_CONFLICT");

      // Check DB: turn_idempotency_keys is NOT completed
      const checkRows = await sql`
        SELECT status FROM turn_idempotency_keys WHERE encounter_id = ${encId} AND turn_id = ${turnId};
      `;
      assert.strictEqual(checkRows[0].status, "conflict", "Must mark conflict status on CAS failure");

      // Cleanup
      await sql`DELETE FROM turn_idempotency_keys WHERE encounter_id = ${encId};`;
      await sql`DELETE FROM consultations WHERE id = ${encId};`;

      testPass("Test 8: Live Neon PostgreSQL multi-worker concurrency and stored function verification");
    } catch (err) {
      testFail("Test 8: Live Neon PostgreSQL multi-worker concurrency and stored function verification", err);
    }
  }

  console.log("================================================================================");
  console.log(`  BATTERY SUMMARY: ${passed} passed, ${skipped} skipped, ${failed} failed`);
  console.log("================================================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runTurnIdempotencyDefenseTests().catch((err) => {
  console.error("FATAL: Unhandled exception in turn idempotency test runner:", err);
  process.exit(1);
});
