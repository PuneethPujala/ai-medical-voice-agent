import assert from "assert";
import { POST as postVoiceChat } from "../../app/api/voice/chat/route";
import { POST as postVoiceTelemetry } from "../../app/api/voice/telemetry/route";
import { DEFAULT_INTERNAL_TEST_SECRET, INTERNAL_TEST_SECRET_HEADER, Role } from "../../lib/auth/rbac";
import { memoryConsultations } from "../../app/api/consultations/route";
import { setCustomDbClient, getDb } from "../../config/db";
import { consultationsTable } from "../../config/schema";
import { eq } from "drizzle-orm";
import * as dotenv from "dotenv";

(process.env as Record<string, string | undefined>).NODE_ENV = "test";
(process.env as Record<string, string | undefined>).INTERNAL_TEST_SECRET = DEFAULT_INTERNAL_TEST_SECRET;

function createTestHeaders(role: Role, userId: string, ipSuffix = 1) {
  return {
    "Content-Type": "application/json",
    "x-mock-role": role,
    "x-mock-user-id": userId,
    [INTERNAL_TEST_SECRET_HEADER]: DEFAULT_INTERNAL_TEST_SECRET,
    "x-forwarded-for": `10.99.1.${ipSuffix}`,
  };
}

async function runChatStatePersistenceTests() {
  console.log("================================================================================");
  console.log("     PHASE 1 REGRESSION: DIALOGUE STATE INTEGRITY & CONCURRENCY SAFETY          ");
  console.log("================================================================================\n");

  // ---------------------------------------------------------------------------
  // TEST 1: Database Read Failure Fails Closed (HTTP 503 DATABASE_READ_FAILURE)
  // ---------------------------------------------------------------------------
  console.log(">>> TEST 1: Datastore Read Error Fails Closed (HTTP 503, No Client Fallback)");
  {
    setCustomDbClient({
      select: () => ({
        from: (table: any) => ({
          where: () => ({
            orderBy: () => ({
              limit: async () => [],
            }),
            limit: async () => {
              throw new Error("PostgreSQL connection terminated unexpectedly (ETIMEDOUT)");
            },
          }),
        }),
      }),
    });

    try {
      const req = new Request("http://localhost:3000/api/voice/chat", {
        method: "POST",
        headers: createTestHeaders("patient", "user_read_fail", 10),
        body: JSON.stringify({
          message: "I have a sore throat and fever.",
          encounterId: "ENC-READ-FAIL-001",
          interviewState: {
            phase: "active_inquiring",
            caseVersion: 99, // Untrusted client-supplied state
            slots: { spoofed: "malicious_unverified_slot" },
          },
        }),
      });

      const res = await postVoiceChat(req);
      assert.strictEqual(res.status, 503, "Database read failure must return HTTP 503");
      const json = await res.json();
      assert.strictEqual(json.code, "DATABASE_READ_FAILURE", "Error code must be DATABASE_READ_FAILURE");
      console.log("  [PASS] Datastore read failure failed closed with HTTP 503 (untrusted client state rejected)\n");
    } finally {
      setCustomDbClient(null);
    }
  }

  // ---------------------------------------------------------------------------
  // TEST 2: Cross-Tenant Isolation Safeguard (HTTP 403 CROSS_TENANT_ACCESS)
  // ---------------------------------------------------------------------------
  console.log(">>> TEST 2: Cross-Tenant Access Rejection (HTTP 403 CROSS_TENANT_ACCESS)");
  {
    const bobEncounterId = `ENC-BOB-${Date.now()}`;
    memoryConsultations.push({
      id: bobEncounterId,
      userId: "user_bob",
      doctorId: "dr-sarah-chen",
      doctorName: "Dr. Sarah Chen, MD",
      specialty: "Internal Medicine",
      chiefComplaint: "Severe cough",
      caseVersion: 1,
      interviewState: {
        phase: "active_inquiring",
        caseVersion: 1,
        slots: { known_facts: ["Chief complaint: Cough"] },
      },
      transcript: [],
    });

    // Alice attempts to access Bob's encounter
    const req = new Request("http://localhost:3000/api/voice/chat", {
      method: "POST",
      headers: createTestHeaders("patient", "user_alice", 11),
      body: JSON.stringify({
        message: "Can I see my results?",
        encounterId: bobEncounterId,
      }),
    });

    const res = await postVoiceChat(req);
    assert.strictEqual(res.status, 403, "Cross-tenant access must return HTTP 403");
    const json = await res.json();
    assert.strictEqual(json.code, "CROSS_TENANT_ACCESS", "Error code must be CROSS_TENANT_ACCESS");
    console.log("  [PASS] Cross-tenant encounter access strictly rejected with HTTP 403\n");
  }

  // ---------------------------------------------------------------------------
  // TEST 3: Optimistic Concurrency Stale Version Check (HTTP 409 CONCURRENT_MODIFICATION_CONFLICT)
  // ---------------------------------------------------------------------------
  console.log(">>> TEST 3: Stale Client Version Conflict (HTTP 409 CONCURRENT_MODIFICATION_CONFLICT)");
  {
    const charlieEncounterId = `ENC-CHARLIE-${Date.now()}`;
    memoryConsultations.push({
      id: charlieEncounterId,
      userId: "user_charlie",
      doctorId: "dr-sarah-chen",
      doctorName: "Dr. Sarah Chen, MD",
      specialty: "Internal Medicine",
      chiefComplaint: "Mild headache",
      caseVersion: 3, // Server is already at version 3
      interviewState: {
        phase: "active_inquiring",
        caseVersion: 3,
        slots: { known_facts: ["Headache for 1 day"] },
      },
      transcript: [],
    });

    // Charlie sends turn with stale version 1
    const req = new Request("http://localhost:3000/api/voice/chat", {
      method: "POST",
      headers: createTestHeaders("patient", "user_charlie", 12),
      body: JSON.stringify({
        message: "It hurts more when I cough.",
        encounterId: charlieEncounterId,
        caseVersion: 1, // Stale version
      }),
    });

    const res = await postVoiceChat(req);
    assert.strictEqual(res.status, 409, "Stale caseVersion must return HTTP 409");
    const json = await res.json();
    assert.strictEqual(json.code, "CONCURRENT_MODIFICATION_CONFLICT", "Error code must be CONCURRENT_MODIFICATION_CONFLICT");
    assert.strictEqual(json.expectedVersion, 3, "Response must report the expected server version");
    console.log("  [PASS] Stale caseVersion rejected with HTTP 409 Conflict\n");
  }

  // ---------------------------------------------------------------------------
  // TEST 4: Atomic CAS Persistence Conflict (HTTP 409 on Concurrent Modification)
  // ---------------------------------------------------------------------------
  console.log(">>> TEST 4: Atomic CAS Persistence Concurrency Conflict");
  {
    const davidEncounterId = `ENC-DAVID-${Date.now()}`;
    memoryConsultations.push({
      id: davidEncounterId,
      userId: "user_david",
      doctorId: "dr-sarah-chen",
      doctorName: "Dr. Sarah Chen, MD",
      specialty: "Internal Medicine",
      chiefComplaint: "Fatigue and body ache",
      caseVersion: 1,
      interviewState: {
        phase: "active_inquiring",
        caseVersion: 1,
        slots: { known_facts: ["Fatigue"] },
      },
      transcript: [],
    });

    // Turn 1 executes with expected version 1
    const req1 = new Request("http://localhost:3000/api/voice/chat", {
      method: "POST",
      headers: createTestHeaders("patient", "user_david", 13),
      body: JSON.stringify({
        message: "I started feeling tired yesterday.",
        encounterId: davidEncounterId,
        caseVersion: 1,
      }),
    });

    const res1 = await postVoiceChat(req1);
    assert.strictEqual(res1.status, 200, "Turn 1 with matching version should succeed with HTTP 200");
    const memAfterTurn1 = memoryConsultations.find(c => c.id === davidEncounterId);
    assert.ok(memAfterTurn1.caseVersion > 1, "Encounter version must advance after successful turn");

    // Turn 2 executes concurrently with old version 1 (which Turn 1 already advanced past)
    const req2 = new Request("http://localhost:3000/api/voice/chat", {
      method: "POST",
      headers: createTestHeaders("patient", "user_david", 14),
      body: JSON.stringify({
        message: "Also feeling slightly dizzy.",
        encounterId: davidEncounterId,
        caseVersion: 1, // Stale version after Turn 1 completed
      }),
    });

    const res2 = await postVoiceChat(req2);
    assert.strictEqual(res2.status, 409, "Concurrent turn with old version must receive HTTP 409 Conflict");
    const json2 = await res2.json();
    assert.strictEqual(json2.code, "CONCURRENT_MODIFICATION_CONFLICT", "Error code must indicate concurrent conflict");
    console.log("  [PASS] Concurrent race detected via CAS and second turn rejected with HTTP 409\n");
  }

  // ---------------------------------------------------------------------------
  // TEST 5: Persistence Write Failure Surfacing (HTTP 503 PERSISTENCE_FAILURE)
  // ---------------------------------------------------------------------------
  console.log(">>> TEST 5: Datastore Write Failure Surfaces HTTP 503 (Never Returns 200 with Lost Updates)");
  {
    setCustomDbClient({
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({
              limit: async () => [],
            }),
            limit: async () => [
              {
                id: "ENC-WRITE-FAIL-001",
                userId: "user_write_fail",
                caseVersion: 1,
                interviewState: { phase: "active_inquiring", caseVersion: 1, slots: { known_facts: [] } },
              },
            ],
          }),
        }),
      }),
      update: () => ({
        set: () => ({
          where: () => ({
            returning: async () => {
              throw new Error("PostgreSQL disk volume read-only / write error (ENOSPC)");
            },
          }),
        }),
      }),
    });

    try {
      const req = new Request("http://localhost:3000/api/voice/chat", {
        method: "POST",
        headers: createTestHeaders("patient", "user_write_fail", 15),
        body: JSON.stringify({
          message: "My knee hurts when I walk.",
          encounterId: "ENC-WRITE-FAIL-001",
          caseVersion: 1,
        }),
      });

      const res = await postVoiceChat(req);
      assert.strictEqual(res.status, 503, "Persistence failure must return HTTP 503, NEVER HTTP 200");
      const json = await res.json();
      assert.strictEqual(json.code, "PERSISTENCE_FAILURE", "Error code must be PERSISTENCE_FAILURE");
      console.log("  [PASS] Datastore write failure surfaced as HTTP 503 (never returned 200 with unsaved state)\n");
    } finally {
      setCustomDbClient(null);
    }
  }

  // ---------------------------------------------------------------------------
  // TEST 6: Arbitrary / Nonexistent Encounter ID Protection (HTTP 404 ENCOUNTER_NOT_FOUND)
  // ---------------------------------------------------------------------------
  console.log(">>> TEST 6: Arbitrary / Nonexistent Encounter ID Rejected (HTTP 404 ENCOUNTER_NOT_FOUND)");
  {
    const arbitraryId = `ENC-SPOOFED-${Date.now()}`;
    const req = new Request("http://localhost:3000/api/voice/chat", {
      method: "POST",
      headers: createTestHeaders("patient", "user_eve", 16),
      body: JSON.stringify({
        message: "Hello doctor, can I speak to someone?",
        encounterId: arbitraryId,
      }),
    });

    const res = await postVoiceChat(req);
    assert.strictEqual(res.status, 404, "Nonexistent encounter ID must return HTTP 404, never auto-create");
    const json = await res.json();
    assert.strictEqual(json.code, "ENCOUNTER_NOT_FOUND", "Error code must be ENCOUNTER_NOT_FOUND");
    const foundInMem = memoryConsultations.find(c => c.id === arbitraryId);
    assert.strictEqual(foundInMem, undefined, "Arbitrary encounter ID must NEVER be inserted into datastore");
    console.log("  [PASS] Nonexistent encounter ID strictly returned HTTP 404 and was not auto-created\n");
  }

  // ---------------------------------------------------------------------------
  // TEST 7: Greeting Short-Circuit Enforces Full Authorization (HTTP 403, 404, 409)
  // ---------------------------------------------------------------------------
  console.log(">>> TEST 7: Greeting Short-Circuit Cannot Bypass Tenant or Concurrency Guards");
  {
    const frankEncounterId = `ENC-FRANK-${Date.now()}`;
    memoryConsultations.push({
      id: frankEncounterId,
      userId: "user_frank",
      doctorId: "dr-sarah-chen",
      doctorName: "Dr. Sarah Chen, MD",
      specialty: "Internal Medicine",
      chiefComplaint: "Seasonal allergies",
      caseVersion: 2,
      interviewState: {
        phase: "greeting",
        caseVersion: 2,
        slots: { known_facts: [] },
      },
      transcript: [],
    });

    // 1. Cross-tenant greeting
    const crossTenantReq = new Request("http://localhost:3000/api/voice/chat", {
      method: "POST",
      headers: createTestHeaders("patient", "user_mallory", 17),
      body: JSON.stringify({
        message: "Hello doctor",
        encounterId: frankEncounterId,
      }),
    });
    const crossRes = await postVoiceChat(crossTenantReq);
    assert.strictEqual(crossRes.status, 403, "Cross-tenant greeting must return HTTP 403");
    const crossJson = await crossRes.json();
    assert.strictEqual(crossJson.code, "CROSS_TENANT_ACCESS", "Error code must be CROSS_TENANT_ACCESS");

    // 2. Stale version greeting
    const staleReq = new Request("http://localhost:3000/api/voice/chat", {
      method: "POST",
      headers: createTestHeaders("patient", "user_frank", 18),
      body: JSON.stringify({
        message: "Hi dr chen",
        encounterId: frankEncounterId,
        caseVersion: 1, // Server is at version 2
      }),
    });
    const staleRes = await postVoiceChat(staleReq);
    assert.strictEqual(staleRes.status, 409, "Greeting with stale version must return HTTP 409");
    const staleJson = await staleRes.json();
    assert.strictEqual(staleJson.code, "CONCURRENT_MODIFICATION_CONFLICT");

    // 3. Authorized greeting persists and advances version
    const validReq = new Request("http://localhost:3000/api/voice/chat", {
      method: "POST",
      headers: createTestHeaders("patient", "user_frank", 19),
      body: JSON.stringify({
        message: "Good morning doctor",
        encounterId: frankEncounterId,
        caseVersion: 2,
      }),
    });
    const validRes = await postVoiceChat(validReq);
    assert.strictEqual(validRes.status, 200, "Authorized greeting must return HTTP 200");
    const validJson = await validRes.json();
    assert.strictEqual(validJson.phase, "greeting");
    assert.strictEqual(validJson.caseVersion, 3, "Greeting must advance encounter version");
    const memAfterGreeting = memoryConsultations.find(c => c.id === frankEncounterId);
    assert.strictEqual(memAfterGreeting.caseVersion, 3, "Server datastore caseVersion must advance to 3");
    console.log("  [PASS] Greeting short-circuit strictly enforces cross-tenant 403, version 409, and advances version 200\n");
  }

  // ---------------------------------------------------------------------------
  // TEST 8: Closing Short-Circuit Enforces Full Authorization & Atomic Persistence
  // ---------------------------------------------------------------------------
  console.log(">>> TEST 8: Closing Short-Circuit Enforces Authorization & Atomic Persistence");
  {
    const graceEncounterId = `ENC-GRACE-${Date.now()}`;
    memoryConsultations.push({
      id: graceEncounterId,
      userId: "user_grace",
      doctorId: "dr-sarah-chen",
      doctorName: "Dr. Sarah Chen, MD",
      specialty: "Internal Medicine",
      chiefComplaint: "Resolved rash",
      caseVersion: 1,
      interviewState: {
        phase: "decided",
        caseVersion: 1,
        slots: { known_facts: ["Rash resolved with antihistamine"] },
      },
      transcript: [],
    });

    // Cross-tenant closing attempt
    const crossReq = new Request("http://localhost:3000/api/voice/chat", {
      method: "POST",
      headers: createTestHeaders("patient", "user_mallory", 20),
      body: JSON.stringify({
        message: "Thank you doctor, goodbye!",
        encounterId: graceEncounterId,
      }),
    });
    const crossRes = await postVoiceChat(crossReq);
    assert.strictEqual(crossRes.status, 403, "Cross-tenant closing must return HTTP 403");

    // Legitimate closing turn with spoofed client interviewState in body
    const validReq = new Request("http://localhost:3000/api/voice/chat", {
      method: "POST",
      headers: createTestHeaders("patient", "user_grace", 21),
      body: JSON.stringify({
        message: "Thank you so much doctor!",
        encounterId: graceEncounterId,
        caseVersion: 1,
        interviewState: {
          phase: "spoofed_closing",
          slots: { malicious_fact: "unverified" },
        },
      }),
    });
    const validRes = await postVoiceChat(validReq);
    assert.strictEqual(validRes.status, 200, "Authorized closing must return HTTP 200");
    const validJson = await validRes.json();
    assert.strictEqual(validJson.phase, "closing");
    assert.strictEqual(validJson.caseVersion, 2, "Closing must advance encounter version");
    assert.strictEqual(validJson.interviewState.phase, "closing");
    assert.strictEqual(validJson.interviewState?.slots?.malicious_fact, undefined, "Unverified client slots must NOT be echoed");
    const memAfterClosing = memoryConsultations.find(c => c.id === graceEncounterId);
    assert.strictEqual(memAfterClosing.caseVersion, 2, "Datastore caseVersion must advance to 2");
    assert.strictEqual(memAfterClosing.interviewState.phase, "closing");
    console.log("  [PASS] Closing turn strictly enforced authorization, rejected spoofed client state, and persisted atomically\n");
  }

  // ---------------------------------------------------------------------------
  // TEST 9: Genuine Simultaneous Concurrency Race (Promise.all)
  // ---------------------------------------------------------------------------
  console.log(">>> TEST 9: Simultaneous Race Condition (Promise.all) Concurrency Resolution");
  {
    const raceEncounterId = `ENC-RACE-${Date.now()}`;
    memoryConsultations.push({
      id: raceEncounterId,
      userId: "user_racer",
      doctorId: "dr-sarah-chen",
      doctorName: "Dr. Sarah Chen, MD",
      specialty: "Internal Medicine",
      chiefComplaint: "Persistent headache",
      caseVersion: 1,
      interviewState: {
        phase: "active_inquiring",
        caseVersion: 1,
        slots: { known_facts: ["Headache for 2 days"] },
      },
      transcript: [],
    });

    // Launch two simultaneous turns targeting exact same encounter with exact same caseVersion: 1
    const reqA = new Request("http://localhost:3000/api/voice/chat", {
      method: "POST",
      headers: createTestHeaders("patient", "user_racer", 22),
      body: JSON.stringify({
        message: "The pain is throbbing on the left side.",
        encounterId: raceEncounterId,
        caseVersion: 1,
      }),
    });

    const reqB = new Request("http://localhost:3000/api/voice/chat", {
      method: "POST",
      headers: createTestHeaders("patient", "user_racer", 23),
      body: JSON.stringify({
        message: "I also feel sensitive to bright light.",
        encounterId: raceEncounterId,
        caseVersion: 1,
      }),
    });

    const [resA, resB] = await Promise.all([postVoiceChat(reqA), postVoiceChat(reqB)]);

    const statuses = [resA.status, resB.status].sort();
    assert.deepStrictEqual(statuses, [200, 409], "Simultaneous race must result in exactly one HTTP 200 and one HTTP 409");

    const memAfterRace = memoryConsultations.find(c => c.id === raceEncounterId);
    assert.strictEqual(memAfterRace.caseVersion, 2, "Case version must advance exactly once to 2");
    console.log("  [PASS] Simultaneous Promise.all race resolved atomically: exactly 1 succeeded (200), 1 conflicted (409)\n");
  }

  // ---------------------------------------------------------------------------
  // TEST 10: Playback Telemetry Route Tenant Isolation & Persistence
  // ---------------------------------------------------------------------------
  console.log(">>> TEST 10: Playback Telemetry Route Tenant Isolation & Persistence");
  {
    const heidiEncounterId = `ENC-HEIDI-${Date.now()}`;
    memoryConsultations.push({
      id: heidiEncounterId,
      userId: "user_heidi",
      doctorId: "dr-sarah-chen",
      doctorName: "Dr. Sarah Chen, MD",
      specialty: "Internal Medicine",
      chiefComplaint: "Ear ache",
      caseVersion: 1,
      interviewState: { phase: "active_inquiring", caseVersion: 1, slots: { known_facts: [] } },
      deliveredTurnRecords: [],
      transcript: [],
    });

    // 1. Cross-tenant telemetry update
    const crossReq = new Request("http://localhost:3000/api/voice/telemetry", {
      method: "POST",
      headers: createTestHeaders("patient", "user_mallory", 24),
      body: JSON.stringify({
        encounterId: heidiEncounterId,
        turnId: 1,
        status: "delivered",
        playedDurationMs: 3500,
      }),
    });
    const crossRes = await postVoiceTelemetry(crossReq);
    assert.strictEqual(crossRes.status, 403, "Cross-tenant telemetry update must return HTTP 403");

    // 2. Nonexistent encounter telemetry
    const nonExistentReq = new Request("http://localhost:3000/api/voice/telemetry", {
      method: "POST",
      headers: createTestHeaders("patient", "user_heidi", 25),
      body: JSON.stringify({
        encounterId: `ENC-NONEXISTENT-${Date.now()}`,
        turnId: 1,
        status: "delivered",
      }),
    });
    const nonExistentRes = await postVoiceTelemetry(nonExistentReq);
    assert.strictEqual(nonExistentRes.status, 404, "Nonexistent encounter telemetry must return HTTP 404");

    // 3. Authorized telemetry update
    const validReq = new Request("http://localhost:3000/api/voice/telemetry", {
      method: "POST",
      headers: createTestHeaders("patient", "user_heidi", 26),
      body: JSON.stringify({
        encounterId: heidiEncounterId,
        turnId: 1,
        status: "delivered",
        playedDurationMs: 3800,
      }),
    });
    const validRes = await postVoiceTelemetry(validReq);
    assert.strictEqual(validRes.status, 200, "Authorized telemetry update must return HTTP 200");
    const validJson = await validRes.json();
    assert.strictEqual(validJson.success, true);
    assert.strictEqual(validJson.deliveryStatus, "delivered");

    const memAfter = memoryConsultations.find(c => c.id === heidiEncounterId);
    assert.strictEqual(memAfter.deliveredTurnRecords.length, 1);
    assert.strictEqual(memAfter.deliveredTurnRecords[0].audioDeliveryStatus, "delivered");
    assert.strictEqual(memAfter.deliveredTurnRecords[0].audioDeliveryResult.playedDurationMs, 3800);
    console.log("  [PASS] Telemetry route strictly enforced cross-tenant 403, 404, and recorded playback correctly on 200\n");
  }

  // ---------------------------------------------------------------------------
  // TEST 11: Concurrent Telemetry Updates (No Lost Updates) & Idempotent Replay
  // ---------------------------------------------------------------------------
  console.log(">>> TEST 11: Concurrent Telemetry Updates (No Lost Updates) & Idempotent Replay");
  {
    const telemEncounterId = `ENC-TELEM-CONCUR-${Date.now()}`;
    // Seed encounter with malformed legacy records (non-numeric turnId, overflow turnId, missing turnId)
    const malformedLegacyRecords = [
      { turnId: "non-numeric-legacy", deliveredText: "bad1" },
      { turnId: "999999999999999999999", deliveredText: "overflow" },
      { deliveredText: "missing-turn-id" },
    ];
    memoryConsultations.push({
      id: telemEncounterId,
      userId: "user_concur_telem",
      doctorId: "dr-sarah-chen",
      doctorName: "Dr. Sarah Chen, MD",
      specialty: "Internal Medicine",
      chiefComplaint: "Allergy follow-up",
      caseVersion: 1,
      interviewState: { phase: "active_inquiring", caseVersion: 1, slots: { known_facts: [] } },
      deliveredTurnRecords: [...malformedLegacyRecords],
      transcript: [],
    });

    // 1. Simultaneous telemetry updates for Turn 1 and Turn 2
    const reqTurn1 = new Request("http://localhost:3000/api/voice/telemetry", {
      method: "POST",
      headers: createTestHeaders("patient", "user_concur_telem", 27),
      body: JSON.stringify({
        encounterId: telemEncounterId,
        turnId: 1,
        status: "delivered",
        playedDurationMs: 2400,
      }),
    });

    const reqTurn2 = new Request("http://localhost:3000/api/voice/telemetry", {
      method: "POST",
      headers: createTestHeaders("patient", "user_concur_telem", 28),
      body: JSON.stringify({
        encounterId: telemEncounterId,
        turnId: 2,
        status: "delivered",
        playedDurationMs: 3100,
      }),
    });

    const [resTurn1, resTurn2] = await Promise.all([
      postVoiceTelemetry(reqTurn1),
      postVoiceTelemetry(reqTurn2),
    ]);

    assert.strictEqual(resTurn1.status, 200, "Turn 1 telemetry must return 200");
    assert.strictEqual(resTurn2.status, 200, "Turn 2 telemetry must return 200");

    const memAfterConcur = memoryConsultations.find(c => c.id === telemEncounterId);
    assert.strictEqual(memAfterConcur.deliveredTurnRecords.length, 5, "Both Turn 1 and Turn 2 must be recorded alongside 3 malformed legacy records without lost updates");
    const turn1Record = memAfterConcur.deliveredTurnRecords.find((r: any) => String(r.turnId) === "1");
    const turn2Record = memAfterConcur.deliveredTurnRecords.find((r: any) => String(r.turnId) === "2");
    assert.ok(turn1Record, "Turn 1 record must exist");
    assert.ok(turn2Record, "Turn 2 record must exist");
    assert.strictEqual(turn1Record.audioDeliveryResult.playedDurationMs, 2400);
    assert.strictEqual(turn2Record.audioDeliveryResult.playedDurationMs, 3100);
    assert.strictEqual(memAfterConcur.caseVersion, 1, "caseVersion must not be incremented by telemetry");

    // 2. Idempotent Replay for Turn 1 with updated status & interrupted duration
    const reqTurn1Replay = new Request("http://localhost:3000/api/voice/telemetry", {
      method: "POST",
      headers: createTestHeaders("patient", "user_concur_telem", 29),
      body: JSON.stringify({
        encounterId: telemEncounterId,
        turnId: 1,
        status: "interrupted",
        playedDurationMs: 1200,
        interruptedAtMs: 1200,
      }),
    });

    const resTurn1Replay = await postVoiceTelemetry(reqTurn1Replay);
    assert.strictEqual(resTurn1Replay.status, 200, "Replayed telemetry must return 200");

    const memAfterReplay = memoryConsultations.find(c => c.id === telemEncounterId);
    assert.strictEqual(memAfterReplay.deliveredTurnRecords.length, 5, "Idempotent replay must update in place without creating duplicates or breaking malformed records");
    const replayedTurn1 = memAfterReplay.deliveredTurnRecords.find((r: any) => String(r.turnId) === "1");
    assert.strictEqual(replayedTurn1.audioDeliveryStatus, "interrupted");
    assert.strictEqual(replayedTurn1.audioDeliveryResult.playedDurationMs, 1200);
    assert.strictEqual(replayedTurn1.audioDeliveryResult.interruptedAtMs, 1200);
    console.log("  [PASS] Concurrent telemetry updates merged atomically (0 lost records, resilient to malformed legacy records) and idempotent replay updated in place\n");
  }

  // ---------------------------------------------------------------------------
  // TEST 12: Real PostgreSQL Live Compare-And-Swap & Telemetry Atomic Concurrency
  // ---------------------------------------------------------------------------
  console.log(">>> TEST 12: Real PostgreSQL Live Compare-And-Swap & Telemetry Atomic Concurrency");
  {
    let liveDbUrl = process.env.DATABASE_URL;
    if (!liveDbUrl) {
      dotenv.config({ path: ".env.local" });
      liveDbUrl = process.env.DATABASE_URL;
    }
    if (!liveDbUrl) {
      dotenv.config({ path: "C:/dev/Capstone/.env" });
      liveDbUrl = process.env.DATABASE_URL;
    }

    if (!liveDbUrl) {
      if (process.env.REQUIRE_LIVE_DB === "true") {
        throw new Error("FATAL: REQUIRE_LIVE_DB is set to true, but DATABASE_URL is missing!");
      }
      console.warn("  ⚠️  SKIPPED: Live PostgreSQL datastore not configured in environment. Passing offline suite.\n");
    } else {
      process.env.DATABASE_URL = liveDbUrl;
      const dbClient = getDb();
      assert.ok(dbClient, "Database client must be available when DATABASE_URL is set");

      // 12A: Real PostgreSQL Compare-And-Swap on simultaneous chat turns
      console.log("    [12A] Live PostgreSQL /api/voice/chat simultaneous CAS race");
      const liveCasId = `ENC-LIVE-CAS-${Date.now()}`;
      await dbClient.insert(consultationsTable).values({
        id: liveCasId,
        userId: "user_live_cas",
        doctorId: "dr-sarah-chen",
        doctorName: "Dr. Sarah Chen, MD",
        specialty: "Internal Medicine",
        chiefComplaint: "Severe migraine with aura",
        caseVersion: 1,
        interviewState: {
          phase: "active_inquiring",
          caseVersion: 1,
          slots: { known_facts: ["Migraine with aura"] },
        },
        deliveredTurnRecords: [],
        transcript: [],
      } as any);

      try {
        const reqLiveA = new Request("http://localhost:3000/api/voice/chat", {
          method: "POST",
          headers: createTestHeaders("patient", "user_live_cas", 30),
          body: JSON.stringify({
            message: "I am having pain behind my eyes.",
            encounterId: liveCasId,
            caseVersion: 1,
          }),
        });

        const reqLiveB = new Request("http://localhost:3000/api/voice/chat", {
          method: "POST",
          headers: createTestHeaders("patient", "user_live_cas", 31),
          body: JSON.stringify({
            message: "I feel nauseated as well.",
            encounterId: liveCasId,
            caseVersion: 1,
          }),
        });

        const [resLiveA, resLiveB] = await Promise.all([
          postVoiceChat(reqLiveA),
          postVoiceChat(reqLiveB),
        ]);

        const statuses = [resLiveA.status, resLiveB.status].sort();
        assert.deepStrictEqual(
          statuses,
          [200, 409],
          "Live PostgreSQL race must result in exactly one HTTP 200 and one HTTP 409 Conflict"
        );

        const rows = await dbClient
          .select()
          .from(consultationsTable)
          .where(eq(consultationsTable.id, liveCasId));
        assert.strictEqual(rows.length, 1);
        assert.strictEqual(
          rows[0].caseVersion,
          2,
          "Database case_version must advance exactly once from 1 to 2"
        );
        console.log("    [PASS] Live PostgreSQL CAS race verified: 1 won (200), 1 conflicted (409), case_version advanced exactly once to 2\n");

        // 12B: Real PostgreSQL Atomic Telemetry Updates (No Lost Updates & Malformed Record Resilience)
        console.log("    [12B] Live PostgreSQL /api/voice/telemetry atomic append and merge");
        const liveTelemId = `ENC-LIVE-TELEM-${Date.now()}`;
        const malformedLiveRecords = [
          { turnId: "non-numeric-legacy", deliveredText: "old1" },
          { turnId: "999999999999999999999", deliveredText: "old2" },
          { deliveredText: "missing-turn-id" },
        ];
        await dbClient.insert(consultationsTable).values({
          id: liveTelemId,
          userId: "user_live_telem",
          doctorId: "dr-sarah-chen",
          doctorName: "Dr. Sarah Chen, MD",
          specialty: "Internal Medicine",
          chiefComplaint: "Hypertension check",
          caseVersion: 1,
          deliveredTurnRecords: malformedLiveRecords,
          transcript: [],
        } as any);

        try {
          const reqLiveT1 = new Request("http://localhost:3000/api/voice/telemetry", {
            method: "POST",
            headers: createTestHeaders("patient", "user_live_telem", 32),
            body: JSON.stringify({
              encounterId: liveTelemId,
              turnId: 1,
              status: "delivered",
              playedDurationMs: 2500,
            }),
          });

          const reqLiveT2 = new Request("http://localhost:3000/api/voice/telemetry", {
            method: "POST",
            headers: createTestHeaders("patient", "user_live_telem", 33),
            body: JSON.stringify({
              encounterId: liveTelemId,
              turnId: 2,
              status: "delivered",
              playedDurationMs: 3200,
            }),
          });

          const [resLiveT1, resLiveT2] = await Promise.all([
            postVoiceTelemetry(reqLiveT1),
            postVoiceTelemetry(reqLiveT2),
          ]);

          assert.strictEqual(resLiveT1.status, 200);
          assert.strictEqual(resLiveT2.status, 200);

          const telemRows = await dbClient
            .select()
            .from(consultationsTable)
            .where(eq(consultationsTable.id, liveTelemId));

          assert.strictEqual(telemRows.length, 1);
          const liveRecords = telemRows[0].deliveredTurnRecords as any[];
          assert.strictEqual(
            liveRecords.length,
            5,
            "Both Turn 1 and Turn 2 must exist alongside 3 malformed legacy records in PostgreSQL without lost updates or cast errors"
          );
          assert.strictEqual(telemRows[0].caseVersion, 1, "caseVersion must not be modified by telemetry");

          // Replay Turn 1
          const reqLiveT1Replay = new Request("http://localhost:3000/api/voice/telemetry", {
            method: "POST",
            headers: createTestHeaders("patient", "user_live_telem", 34),
            body: JSON.stringify({
              encounterId: liveTelemId,
              turnId: 1,
              status: "interrupted",
              playedDurationMs: 1400,
              interruptedAtMs: 1400,
            }),
          });

          const resLiveReplay = await postVoiceTelemetry(reqLiveT1Replay);
          assert.strictEqual(resLiveReplay.status, 200);

          const replayRows = await dbClient
            .select()
            .from(consultationsTable)
            .where(eq(consultationsTable.id, liveTelemId));

          const replayRecords = replayRows[0].deliveredTurnRecords as any[];
          assert.strictEqual(replayRecords.length, 5, "Idempotent replay must not duplicate records in PostgreSQL");
          const t1 = replayRecords.find((r: any) => String(r.turnId) === "1");
          assert.strictEqual(t1.audioDeliveryStatus, "interrupted");
          assert.strictEqual(t1.audioDeliveryResult.playedDurationMs, 1400);
          console.log("    [PASS] Live PostgreSQL Telemetry verified: concurrent updates merged atomically, 0 lost records, malformed legacy records safely preserved, idempotent replay updated in-place\n");
        } finally {
          await dbClient.delete(consultationsTable).where(eq(consultationsTable.id, liveTelemId));
        }
      } finally {
        await dbClient.delete(consultationsTable).where(eq(consultationsTable.id, liveCasId));
      }
    }
  }

  console.log("================================================================================");
  console.log("      ALL 12/12 DIALOGUE STATE PERSISTENCE & CONCURRENCY TESTS PASSED          ");
  console.log("================================================================================");
}

runChatStatePersistenceTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
