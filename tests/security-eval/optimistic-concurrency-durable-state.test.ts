import assert from "assert";
import { POST as postConsultation } from "../../app/api/consultations/route";
import { GET as getConsultationById, PATCH as patchConsultationById } from "../../app/api/consultations/[id]/route";
import { DEFAULT_INTERNAL_TEST_SECRET, INTERNAL_TEST_SECRET_HEADER, Role } from "../../lib/auth/rbac";

(process.env as Record<string, string | undefined>).NODE_ENV = "test";

function createTestHeaders(role: Role, userId: string) {
  return {
    "x-mock-role": role,
    "x-mock-user-id": userId,
    [INTERNAL_TEST_SECRET_HEADER]: DEFAULT_INTERNAL_TEST_SECRET,
  };
}

async function runOptimisticConcurrencyTests() {
  console.log("=== Running Optimistic Concurrency & Durable State Tests ===\n");
  const testPatient = "patient-concurrency-test";
  const encounterId = `ENC-CONCURRENCY-${Date.now()}`;
  const initialIdempotencyKey = `idem-key-${Date.now()}`;

  // 1. Initial Insert with durable encounter state and caseVersion: 1
  console.log("[Test 1] Create encounter with durable state and caseVersion=1");
  {
    const req = new Request("https://medvoice.org/api/consultations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...createTestHeaders("patient", testPatient),
      },
      body: JSON.stringify({
        id: encounterId,
        patientName: "Test Patient",
        doctorId: "dr-sarah-chen",
        doctorName: "Dr. Sarah Chen, MD",
        specialty: "Internal Medicine",
        chiefComplaint: "Severe headache and dizziness",
        triageLevel: "routine",
        caseVersion: 1,
        idempotencyKey: initialIdempotencyKey,
        interviewState: { phase: "active_inquiring", caseVersion: 1, slots: { onset: "2 days" } },
        deliveredTurnRecords: [
          { turnId: 1, deliveredText: "Hello, what symptoms are you having?", conversationalAction: "INQUIRE", caseVersion: 1 }
        ],
        attributedFacts: [
          { id: "fact-1", concept: "headache", assertionStatus: "present", temporality: "current", attribution: "patient" }
        ],
        unmappedObservations: [
          { id: "obs-1", rawEvidence: "feels weird all over", status: "unverified_proposal", turnId: 1 }
        ],
      }),
    });

    const res = await postConsultation(req);
    assert.strictEqual(res.status, 200, "Initial POST should succeed with 200");
    const json = await res.json();
    assert.strictEqual(json.success, true);
    assert.strictEqual(json.consultation.caseVersion, 1);
    assert.strictEqual(json.consultation.idempotencyKey, initialIdempotencyKey);
    assert.strictEqual(json.consultation.attributedFacts?.length, 1);
    assert.strictEqual(json.consultation.unmappedObservations?.length, 1);
    console.log("  ✓ Encounter initialized with structured facts, observations, and caseVersion=1");
  }

  // 2. Idempotent Retry of initial insert
  console.log("\n[Test 2] Idempotent retry with matching idempotencyKey");
  {
    const req = new Request("https://medvoice.org/api/consultations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...createTestHeaders("patient", testPatient),
      },
      body: JSON.stringify({
        id: encounterId,
        idempotencyKey: initialIdempotencyKey,
        doctorId: "dr-sarah-chen",
        doctorName: "Dr. Sarah Chen, MD",
        specialty: "Internal Medicine",
      }),
    });

    const res = await postConsultation(req);
    assert.strictEqual(res.status, 200);
    const json = await res.json();
    assert.strictEqual(json.success, true);
    assert.strictEqual(json.isIdempotentRetry, true);
    console.log("  ✓ Idempotent retry detected and safely returned without duplicate mutation");
  }

  // 3. Update with valid caseVersion: 2
  console.log("\n[Test 3] Update encounter advancing to caseVersion=2");
  {
    const req = new Request("https://medvoice.org/api/consultations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...createTestHeaders("patient", testPatient),
      },
      body: JSON.stringify({
        id: encounterId,
        caseVersion: 2,
        idempotencyKey: `idem-key-turn2-${Date.now()}`,
        doctorId: "dr-sarah-chen",
        doctorName: "Dr. Sarah Chen, MD",
        specialty: "Internal Medicine",
        attributedFacts: [
          { id: "fact-1", concept: "headache", assertionStatus: "present", temporality: "current", attribution: "patient" },
          { id: "fact-2", concept: "dizziness", assertionStatus: "present", temporality: "current", attribution: "patient" },
        ],
      }),
    });

    const res = await postConsultation(req);
    assert.strictEqual(res.status, 200);
    const json = await res.json();
    assert.strictEqual(json.success, true);
    assert.strictEqual(json.consultation.caseVersion, 2);
    assert.strictEqual(json.consultation.attributedFacts?.length, 2);
    console.log("  ✓ Encounter successfully advanced to caseVersion=2 with updated attributed facts");
  }

  // 4. Stale concurrency collision: submitting caseVersion: 1 when record is at 2 must reject with 409
  console.log("\n[Test 4] Stale concurrency check: submitting caseVersion=1 rejects with 409");
  {
    const req = new Request("https://medvoice.org/api/consultations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...createTestHeaders("patient", testPatient),
      },
      body: JSON.stringify({
        id: encounterId,
        caseVersion: 1, // Stale!
        doctorId: "dr-sarah-chen",
        doctorName: "Dr. Sarah Chen, MD",
        specialty: "Internal Medicine",
      }),
    });

    const res = await postConsultation(req);
    assert.strictEqual(res.status, 409, "Stale caseVersion must return 409 Conflict");
    const json = await res.json();
    assert.strictEqual(json.code, "CONCURRENCY_CONFLICT");
    console.log("  ✓ Stale caseVersion rejected with 409 CONCURRENCY_CONFLICT");
  }

  // 5. PATCH endpoint concurrency check
  console.log("\n[Test 5] PATCH /api/consultations/:id optimistic concurrency check");
  {
    const req = new Request(`https://medvoice.org/api/consultations/${encounterId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...createTestHeaders("patient", testPatient),
      },
      body: JSON.stringify({
        caseVersion: 1, // Stale!
        soapPlan: "Rest and hydration",
      }),
    });

    const res = await patchConsultationById(req, { params: Promise.resolve({ id: encounterId }) });
    assert.strictEqual(res.status, 409, "Stale caseVersion on PATCH must return 409 Conflict");
    const json = await res.json();
    assert.strictEqual(json.code, "CONCURRENCY_CONFLICT");
    console.log("  ✓ Stale PATCH update rejected with 409 CONCURRENCY_CONFLICT");
  }

  console.log("\nAll Optimistic Concurrency & Durable State tests passed successfully!");
}

runOptimisticConcurrencyTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
