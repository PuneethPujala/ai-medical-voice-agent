import assert from "assert";
import { POST as postVoiceChat } from "../../app/api/voice/chat/route";
import { DEFAULT_INTERNAL_TEST_SECRET, INTERNAL_TEST_SECRET_HEADER, Role } from "../../lib/auth/rbac";
import { memoryConsultations } from "../../app/api/consultations/route";
import { setCustomDbClient } from "../../config/db";

(process.env as Record<string, string | undefined>).NODE_ENV = "test";

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

  console.log("================================================================================");
  console.log("      ALL 5/5 DIALOGUE STATE PERSISTENCE & CONCURRENCY TESTS PASSED            ");
  console.log("================================================================================");
}

runChatStatePersistenceTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
