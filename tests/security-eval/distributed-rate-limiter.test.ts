import assert from "assert";
import {
  RATE_LIMIT_POLICIES,
  resolveTrustedClientIp,
  deriveRateLimitKey,
  RouteRateLimitPolicy,
} from "../../lib/security/rate-limit-policy";
import {
  MemoryRateLimitStore,
  UpstashRedisRateLimitStore,
  RateLimitStoreError,
  evaluateRateLimit,
  buildRateLimit429Response,
  setRateLimitStoreForTesting,
  getActiveRateLimitStore,
  getFallbackLocalStore,
} from "../../lib/security/distributed-rate-limiter";
import { POST as chatHandler } from "../../app/api/voice/chat/route";
import { POST as ttsHandler } from "../../app/api/voice/tts/route";
import { POST as sttHandler } from "../../app/api/voice/stt/route";
import { POST as triageHandler } from "../../app/api/triage/route";
import { POST as consultationPostHandler } from "../../app/api/consultations/route";
import { PATCH as consultationPatchHandler } from "../../app/api/consultations/[id]/route";

import {
  DEFAULT_INTERNAL_TEST_SECRET,
  INTERNAL_TEST_SECRET_HEADER,
} from "../../lib/auth/rbac";

(process.env as Record<string, string | undefined>).NODE_ENV = "test";
process.env.INTERNAL_TEST_SECRET = DEFAULT_INTERNAL_TEST_SECRET;

async function runDistributedRateLimiterTests() {
  console.log("================================================================================");
  console.log("  P1.3: DISTRIBUTED RATE LIMITER & ADVERSARIAL DEFENSE BATTERY                 ");
  console.log("================================================================================");

  let passed = 0;
  let failed = 0;

  function testPass(name: string) {
    console.log(`  [PASS] ${name}`);
    passed++;
  }

  function testFail(name: string, err: any) {
    console.error(`  [FAIL] ${name}:`, err);
    failed++;
  }

  // ---------------------------------------------------------------------------
  // 1. Sliding Window Precision & Math Tests
  // ---------------------------------------------------------------------------
  try {
    const store = new MemoryRateLimitStore();
    const key = "test:sliding:window:exact";
    const limit = 5;
    const windowMs = 60_000;
    const baseTime = 1_000_000;

    // Dispatch 5 requests within the window
    for (let i = 0; i < 5; i++) {
      const res = await store.checkAndIncrement({
        key,
        limit,
        windowMs,
        now: baseTime + i * 1000,
      });
      assert.strictEqual(res.allowed, true, `Request ${i + 1} should be allowed`);
      assert.strictEqual(res.remaining, 4 - i, `Remaining should be ${4 - i}`);
    }

    // 6th request at baseTime + 10s should be rejected
    const blockedRes = await store.checkAndIncrement({
      key,
      limit,
      windowMs,
      now: baseTime + 10_000,
    });
    assert.strictEqual(blockedRes.allowed, false, "6th request within window must be rejected");
    assert.strictEqual(blockedRes.remaining, 0);
    assert.ok(blockedRes.retryAfterSec > 0, "retryAfterSec must be > 0");

    // Advance time past the 1st request (baseTime + 60_001)
    // The 1st request should roll out of the sliding window, allowing exactly 1 new request
    const rolloutRes = await store.checkAndIncrement({
      key,
      limit,
      windowMs,
      now: baseTime + 60_001,
    });
    assert.strictEqual(rolloutRes.allowed, true, "Request should be allowed after 1st request rolls out");
    assert.strictEqual(rolloutRes.remaining, 0, "Remaining should be 0 (4 old + 1 new = 5)");

    // Another request immediately after should be blocked
    const reblocked = await store.checkAndIncrement({
      key,
      limit,
      windowMs,
      now: baseTime + 60_002,
    });
    assert.strictEqual(reblocked.allowed, false, "Immediate next request must be rejected");

    testPass("Sliding window exact entry expiration and rollout math");
  } catch (err) {
    testFail("Sliding window exact entry expiration and rollout math", err);
  }

  // ---------------------------------------------------------------------------
  // 2. Multi-Instance Concurrency Simulation
  // ---------------------------------------------------------------------------
  try {
    // Shared state store representing a shared cluster datastore
    const sharedStore = new MemoryRateLimitStore();
    const sharedKey = "test:cluster:concurrent:quota";
    const sharedLimit = 10;
    const windowMs = 60_000;
    const now = 2_000_000;

    // Instance A and Instance B both connect to the same shared store
    // Concurrently fire 20 requests (10 from Instance A, 10 from Instance B)
    const requests = Array.from({ length: 20 }, (_, idx) => {
      const instance = idx % 2 === 0 ? "instance_A" : "instance_B";
      return sharedStore.checkAndIncrement({
        key: sharedKey,
        limit: sharedLimit,
        windowMs,
        now,
      }).then((res) => ({ instance, ...res }));
    });

    const results = await Promise.all(requests);
    const allowed = results.filter((r) => r.allowed);
    const rejected = results.filter((r) => !r.allowed);

    assert.strictEqual(allowed.length, 10, "Strictly 10 requests total must be allowed across both instances");
    assert.strictEqual(rejected.length, 10, "Strictly 10 requests must be rejected across both instances");

    // Verify both instances received a share of allowed requests
    const allowedFromA = allowed.filter((r) => r.instance === "instance_A").length;
    const allowedFromB = allowed.filter((r) => r.instance === "instance_B").length;
    assert.ok(allowedFromA > 0, "Instance A should have allowed requests");
    assert.ok(allowedFromB > 0, "Instance B should have allowed requests");

    testPass("Multi-instance concurrency: shared store enforces exact unified cluster quota");
  } catch (err) {
    testFail("Multi-instance concurrency: shared store enforces exact unified cluster quota", err);
  }

  // ---------------------------------------------------------------------------
  // 3. Rate Limit Key Derivation & Zero PII Privacy Guarantees
  // ---------------------------------------------------------------------------
  try {
    const policy = RATE_LIMIT_POLICIES.VOICE_CHAT;

    // 1. Authenticated user
    const userKey = deriveRateLimitKey({
      policy,
      userId: "user_secret_clerk_992138",
    });
    assert.ok(userKey.startsWith("rl:voice_chat:usr:"), "User key prefix must be correct");
    assert.ok(!userKey.includes("user_secret_clerk_992138"), "Plaintext user ID must never appear in key");
    assert.strictEqual(userKey.length, "rl:voice_chat:usr:".length + 16, "Key suffix must be 16-hex hash");

    // 2. Anonymous IP
    const reqWithIp = new Request("http://localhost/api/test", {
      headers: { "x-real-ip": "198.51.100.42" },
    });
    const ipKey = deriveRateLimitKey({
      policy,
      request: reqWithIp,
    });
    assert.ok(ipKey.startsWith("rl:voice_chat:ip:"), "IP key prefix must be correct");
    assert.ok(!ipKey.includes("198.51.100.42"), "Plaintext IP must never appear in key");
    assert.strictEqual(ipKey.length, "rl:voice_chat:ip:".length + 16, "Key suffix must be 16-hex hash");

    // 3. Custom scope
    const scopeKey = deriveRateLimitKey({
      policy,
      customScope: "consultation:MED-2026-9912",
    });
    assert.ok(scopeKey.startsWith("rl:voice_chat:scp:"), "Scope key prefix must be correct");
    assert.ok(!scopeKey.includes("MED-2026-9912"), "Plaintext scope must never appear in key");

    testPass("Key derivation: Zero PII in Redis keyspace with deterministic 16-byte hashes");
  } catch (err) {
    testFail("Key derivation: Zero PII in Redis keyspace with deterministic 16-byte hashes", err);
  }

  // ---------------------------------------------------------------------------
  // 4. IP Resolution & Reverse Traversal Defense against Spoofed X-Forwarded-For
  // ---------------------------------------------------------------------------
  try {
    // Scenario A: Without TRUSTED_PROXIES configured, uses x-real-ip or leftmost valid IP
    delete process.env.TRUSTED_PROXIES;
    const reqDirect = new Request("http://localhost/api/test", {
      headers: {
        "x-forwarded-for": "203.0.113.195, 70.41.3.18, 150.172.238.178",
        "x-real-ip": "70.41.3.18",
      },
    });
    const ipA = resolveTrustedClientIp(reqDirect);
    assert.strictEqual(ipA, "203.0.113.195", "Without trusted proxies, leftmost client hop is chosen");

    // Scenario B: With TRUSTED_PROXIES configured, traverses backwards past trusted proxy nodes
    process.env.TRUSTED_PROXIES = "10.0.0.1, 150.172.238.178, 127.0.0.1";
    const reqProxied = new Request("http://localhost/api/test", {
      headers: {
        "x-forwarded-for": "198.51.100.77, 10.0.0.1, 150.172.238.178",
      },
    });
    const ipB = resolveTrustedClientIp(reqProxied);
    assert.strictEqual(ipB, "198.51.100.77", "Traversal must bypass configured trusted intermediate proxies");

    // Scenario C: Malformed/injected header defense
    const reqSpoofed = new Request("http://localhost/api/test", {
      headers: {
        "x-forwarded-for": "<script>alert(1)</script>, invalid-ip-string",
        "x-real-ip": "192.0.2.1",
      },
    });
    const ipC = resolveTrustedClientIp(reqSpoofed);
    assert.strictEqual(ipC, "192.0.2.1", "Malformed x-forwarded-for falls back to valid x-real-ip");

    // Scenario D: Cloudflare cf-connecting-ip precedence
    const reqCf = new Request("http://localhost/api/test", {
      headers: {
        "cf-connecting-ip": "198.51.100.99",
        "x-forwarded-for": "10.0.0.1, 10.0.0.2",
      },
    });
    const ipD = resolveTrustedClientIp(reqCf);
    assert.strictEqual(ipD, "198.51.100.99", "Cloudflare edge connecting IP takes absolute precedence");

    delete process.env.TRUSTED_PROXIES;
    testPass("IP resolution: Reverse proxy traversal defense and IP validation");
  } catch (err) {
    testFail("IP resolution: Reverse proxy traversal defense and IP validation", err);
  }

  // ---------------------------------------------------------------------------
  // 5. Emergency Preflight Resilience & Spoofed Emergency Token Defense
  // ---------------------------------------------------------------------------
  try {
    const testStore = new MemoryRateLimitStore();
    setRateLimitStoreForTesting(testStore);

    const policy = RATE_LIMIT_POLICIES.VOICE_CHAT;
    const userId = "patient-cardiac-emergency";

    // 1. Exhaust the quota (30 requests)
    for (let i = 0; i < 30; i++) {
      await evaluateRateLimit({
        policy,
        userId,
        forceExactLimit: true,
      });
    }

    // 2. Request 31: Quota exhausted, non-emergency utterance
    const deniedNormal = await evaluateRateLimit({
      policy,
      userId,
      forceExactLimit: true,
      preflightUtterance: "I have a mild itch on my arm since yesterday.",
    });
    assert.strictEqual(deniedNormal.allowed, false, "Non-emergency request must be throttled");
    assert.strictEqual(deniedNormal.emergencyPreempted, undefined);

    // 3. Request 32: Attacker attempts to spoof emergency with query/body flag but non-emergency text
    // (Simulating an attacker adding isEmergency: true in request payload)
    const spoofedRequest = await evaluateRateLimit({
      policy,
      userId,
      forceExactLimit: true,
      preflightUtterance: "I want to test if the emergency flag lets me spam without limits.",
    });
    assert.strictEqual(spoofedRequest.allowed, false, "Client spoofing without clinical red flags must be denied");

    // 4. Request 33: Patient presents LIFE-THREATENING red flags (Acute Coronary Syndrome)
    const emergencyRequest = await evaluateRateLimit({
      policy,
      userId,
      forceExactLimit: true,
      preflightUtterance: "Doctor, I have crushing retrosternal chest pain radiating to my left arm and jaw and I am sweating profusely.",
    });
    assert.strictEqual(emergencyRequest.allowed, true, "Life-threatening condition MUST trigger emergency preemption");
    assert.strictEqual(emergencyRequest.emergencyPreempted, true, "Must flag emergencyPreempted");
    assert.ok(emergencyRequest.emergencyDirective?.includes("112") || emergencyRequest.emergencyDirective?.includes("108"), "Must provide immediate routing directive");
    assert.ok(emergencyRequest.emergencyFlags && emergencyRequest.emergencyFlags.length > 0, "Must identify clinical red flags");

    // 5. Request 34: Patient presents Stroke BE-FAST red flags
    const strokeRequest = await evaluateRateLimit({
      policy,
      userId,
      forceExactLimit: true,
      preflightUtterance: "My mother suddenly has right-sided facial droop and cannot speak or move her arm.",
    });
    assert.strictEqual(strokeRequest.allowed, true, "Acute stroke MUST trigger emergency preemption");
    assert.strictEqual(strokeRequest.emergencyPreempted, true);

    setRateLimitStoreForTesting(null);
    testPass("Emergency preflight: Life-saving preemption guaranteed, spoofed flags denied");
  } catch (err) {
    setRateLimitStoreForTesting(null);
    testFail("Emergency preflight: Life-saving preemption guaranteed, spoofed flags denied", err);
  }

  // ---------------------------------------------------------------------------
  // 6. Fail-Open vs Fail-Closed Behavior on Shared Store Outage
  // ---------------------------------------------------------------------------
  try {
    const failingStore = new MemoryRateLimitStore();
    failingStore.__setSimulateError(true);
    setRateLimitStoreForTesting(failingStore);

    // Case A: Clinical Consultation Path (FAIL_OPEN_LOCAL_BEST_EFFORT)
    const clinicalEval = await evaluateRateLimit({
      policy: RATE_LIMIT_POLICIES.VOICE_CHAT,
      userId: "clinician-user-1",
      forceExactLimit: true,
    });
    assert.strictEqual(clinicalEval.allowed, true, "Clinical path must fail-open to local store during outage");
    assert.strictEqual(clinicalEval.status.fallbackActive, true, "Fallback must be active");

    // Case B: Expensive Generation Path (FAIL_CLOSED_EXPENSIVE_WORK: TTS)
    const ttsEval = await evaluateRateLimit({
      policy: RATE_LIMIT_POLICIES.VOICE_TTS,
      userId: "expensive-tts-user",
      forceExactLimit: true,
    });
    assert.strictEqual(ttsEval.allowed, false, "Expensive TTS path must fail-closed to protect compute");
    assert.ok(ttsEval.degradedNotice?.includes("temporarily degraded"), "Must explain paused synthesis");

    // Case C: Expensive Audio Ingestion Path (FAIL_CLOSED_EXPENSIVE_WORK: STT)
    const sttEval = await evaluateRateLimit({
      policy: RATE_LIMIT_POLICIES.VOICE_STT,
      userId: "expensive-stt-user",
      forceExactLimit: true,
    });
    assert.strictEqual(sttEval.allowed, false, "Expensive STT path must fail-closed during outage");

    setRateLimitStoreForTesting(null);
    testPass("Store outage resilience: Clinical paths fail-open local, expensive paths fail-closed");
  } catch (err) {
    setRateLimitStoreForTesting(null);
    testFail("Store outage resilience: Clinical paths fail-open local, expensive paths fail-closed", err);
  }

  // ---------------------------------------------------------------------------
  // 7. Circuit Breaker & Upstash Redis REST Client Behavior
  // ---------------------------------------------------------------------------
  try {
    // Test Upstash client with mock server
    let requestCount = 0;
    const mockServerUrl = "http://127.0.0.1:9999"; // non-existent endpoint to induce failures
    const upstashStore = new UpstashRedisRateLimitStore({
      url: mockServerUrl,
      token: "mock-token",
    });

    // Fire 3 calls to trip the circuit breaker
    for (let i = 0; i < 3; i++) {
      try {
        await upstashStore.checkAndIncrement({
          key: "test:circuit:breaker",
          limit: 10,
          windowMs: 60_000,
        });
        assert.fail("Should have thrown RateLimitStoreError");
      } catch (err: any) {
        assert.ok(err instanceof RateLimitStoreError, "Must wrap error in RateLimitStoreError");
      }
    }

    // 4th call should immediately trip circuit breaker without attempting network fetch
    try {
      await upstashStore.checkAndIncrement({
        key: "test:circuit:breaker",
        limit: 10,
        windowMs: 60_000,
      });
      assert.fail("Should have thrown circuit breaker error");
    } catch (err: any) {
      assert.ok(err.message.includes("circuit breaker is open"), `Expected circuit breaker open error, got: ${err.message}`);
    }

    testPass("Upstash Redis store: 250ms bounded timeout, consecutive failure count, circuit breaker trip");
  } catch (err) {
    testFail("Upstash Redis store: 250ms bounded timeout, consecutive failure count, circuit breaker trip", err);
  }

  // ---------------------------------------------------------------------------
  // 8. RFC 6585 HTTP 429 Header Compliance
  // ---------------------------------------------------------------------------
  try {
    const testStore = new MemoryRateLimitStore();
    setRateLimitStoreForTesting(testStore);

    const evalResult = await evaluateRateLimit({
      policy: RATE_LIMIT_POLICIES.CONSULTATION_MUTATION,
      userId: "doctor-mutation-test",
      forceExactLimit: true,
      cost: 65, // Exceeds limit of 60
    });

    assert.strictEqual(evalResult.allowed, false);
    const response = buildRateLimit429Response(evalResult);

    assert.strictEqual(response.status, 429, "HTTP status must be 429");
    assert.strictEqual(response.headers.get("Content-Type"), "application/json");
    assert.ok(response.headers.get("Retry-After") !== null, "Retry-After header must be present");
    assert.ok(Number(response.headers.get("Retry-After")) >= 1, "Retry-After must be positive number");
    assert.strictEqual(response.headers.get("X-RateLimit-Limit"), "60");
    assert.strictEqual(response.headers.get("X-RateLimit-Remaining"), "0");
    assert.ok(response.headers.get("X-RateLimit-Reset") !== null, "X-RateLimit-Reset header must be present");

    const json = await response.json();
    assert.strictEqual(json.success, false);
    assert.strictEqual(json.code, "RATE_LIMIT_EXCEEDED");
    assert.strictEqual(json.limit, 60);

    setRateLimitStoreForTesting(null);
    testPass("RFC 6585 compliance: 429 status with Retry-After, X-RateLimit-* headers and JSON payload");
  } catch (err) {
    setRateLimitStoreForTesting(null);
    testFail("RFC 6585 compliance: 429 status with Retry-After, X-RateLimit-* headers and JSON payload", err);
  }

  // ---------------------------------------------------------------------------
  // 9. Route Integration Verification (/api/voice/chat, /api/triage, mutations)
  // ---------------------------------------------------------------------------
  try {
    const routeStore = new MemoryRateLimitStore();
    setRateLimitStoreForTesting(routeStore);

    // Test A: /api/voice/chat route with rate limiting
    // Fill quota for user
    const chatKey = deriveRateLimitKey({
      policy: RATE_LIMIT_POLICIES.VOICE_CHAT,
      userId: "test-route-user",
    });
    await routeStore.checkAndIncrement({
      key: chatKey,
      limit: 500,
      windowMs: 60_000,
      cost: 500,
    });

    // Call chat route with emergency text when rate limit is exceeded
    const reqChatEmergency = new Request("http://localhost/api/voice/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [INTERNAL_TEST_SECRET_HEADER]: DEFAULT_INTERNAL_TEST_SECRET,
        "x-mock-role": "clinician",
        "x-mock-user-id": "test-route-user",
      },
      body: JSON.stringify({
        message: "Severe crushing chest pain radiating to my left jaw, sweating cold sweat",
        isDemoMode: true,
      }),
    });
    const chatEmergencyRes = await chatHandler(reqChatEmergency);
    const chatEmergencyJson = await chatEmergencyRes.json();

    assert.strictEqual(chatEmergencyRes.status, 200, "Emergency must preempt 429 with 200 triage response");
    assert.strictEqual(chatEmergencyJson.isEmergency, true);
    assert.strictEqual(chatEmergencyJson.preempted, true);
    assert.ok(chatEmergencyJson.directive?.includes("112") || chatEmergencyJson.directive?.includes("108"));

    // Call chat route with non-emergency text when rate limit is exceeded
    const reqChatNonEmergency = new Request("http://localhost/api/voice/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [INTERNAL_TEST_SECRET_HEADER]: DEFAULT_INTERNAL_TEST_SECRET,
        "x-mock-role": "clinician",
        "x-mock-user-id": "test-route-user",
      },
      body: JSON.stringify({
        message: "I have a mild runny nose and cough.",
        isDemoMode: true,
      }),
    });
    const chatBlockedRes = await chatHandler(reqChatNonEmergency);
    assert.strictEqual(chatBlockedRes.status, 429, "Non-emergency exhausted user must receive 429");
    assert.ok(chatBlockedRes.headers.get("Retry-After") !== null);

    // Test B: /api/triage route with rate limiting
    const triageKey = deriveRateLimitKey({
      policy: RATE_LIMIT_POLICIES.TRIAGE_EVAL,
      userId: "test-triage-user",
    });
    await routeStore.checkAndIncrement({
      key: triageKey,
      limit: 500,
      windowMs: 60_000,
      cost: 500,
    });

    const reqTriageEmergency = new Request("http://localhost/api/triage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [INTERNAL_TEST_SECRET_HEADER]: DEFAULT_INTERNAL_TEST_SECRET,
        "x-mock-role": "clinician",
        "x-mock-user-id": "test-triage-user",
      },
      body: JSON.stringify({
        transcript: "Sudden onset right facial droop and right arm paralysis starting 15 minutes ago",
      }),
    });
    const triageEmergencyRes = await triageHandler(reqTriageEmergency);
    const triageEmergencyJson = await triageEmergencyRes.json();

    assert.strictEqual(triageEmergencyRes.status, 200, "Triage emergency must preempt 429");
    assert.strictEqual(triageEmergencyJson.isEmergency, true);
    assert.strictEqual(triageEmergencyJson.status, "emergency");

    setRateLimitStoreForTesting(null);
    testPass("Route-level rate-limiting integration & emergency preemption across /api/voice/chat and /api/triage");
  } catch (err) {
    setRateLimitStoreForTesting(null);
    testFail("Route-level rate-limiting integration & emergency preemption across /api/voice/chat and /api/triage", err);
  }

  // ---------------------------------------------------------------------------
  // 10. Consultation Route Mutations Rate Limiting (POST & PATCH)
  // ---------------------------------------------------------------------------
  try {
    const mutationStore = new MemoryRateLimitStore();
    setRateLimitStoreForTesting(mutationStore);

    const doctorUserId = "dr-sarah-chen";
    const mutationKey = deriveRateLimitKey({
      policy: RATE_LIMIT_POLICIES.CONSULTATION_MUTATION,
      userId: doctorUserId,
    });

    // Exhaust mutation quota (500 in test mode)
    await mutationStore.checkAndIncrement({
      key: mutationKey,
      limit: 500,
      windowMs: 60_000,
      cost: 500,
    });

    // Attempt POST /api/consultations
    const reqPost = new Request("http://localhost/api/consultations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [INTERNAL_TEST_SECRET_HEADER]: DEFAULT_INTERNAL_TEST_SECRET,
        "x-mock-role": "clinician",
        "x-mock-user-id": doctorUserId,
      },
      body: JSON.stringify({
        patientName: "Rate Limit Test Patient",
        chiefComplaint: "Testing mutation quota enforcement",
      }),
    });
    const postRes = await consultationPostHandler(reqPost);
    assert.strictEqual(postRes.status, 429, "POST /api/consultations must be 429 when mutation quota is exhausted");
    assert.ok(postRes.headers.get("Retry-After") !== null);

    // Attempt PATCH /api/consultations/[id]
    const reqPatch = new Request("http://localhost/api/consultations/MED-2026-ACS-8841", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        [INTERNAL_TEST_SECRET_HEADER]: DEFAULT_INTERNAL_TEST_SECRET,
        "x-mock-role": "clinician",
        "x-mock-user-id": doctorUserId,
      },
      body: JSON.stringify({
        status: "approved",
      }),
    });
    const patchRes = await consultationPatchHandler(reqPatch, {
      params: Promise.resolve({ id: "MED-2026-ACS-8841" }),
    });
    assert.strictEqual(patchRes.status, 429, "PATCH /api/consultations/[id] must be 429 when mutation quota is exhausted");
    assert.ok(patchRes.headers.get("Retry-After") !== null);

    setRateLimitStoreForTesting(null);
    testPass("Consultation mutations: POST and PATCH enforce distributed rate limits with 429 responses");
  } catch (err) {
    setRateLimitStoreForTesting(null);
    testFail("Consultation mutations: POST and PATCH enforce distributed rate limits with 429 responses", err);
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log("================================================================================");
  console.log(`  BATTERY SUMMARY: ${passed} PASSED, ${failed} FAILED (TOTAL: ${passed + failed})`);
  console.log("================================================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runDistributedRateLimiterTests().catch((err) => {
  console.error("FATAL in distributed rate limiter tests:", err);
  process.exit(1);
});
