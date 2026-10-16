import assert from "assert";
import { POST as postConsultation } from "../../app/api/consultations/route";
import { POST as postTelemetry } from "../../app/api/voice/telemetry/route";
import { GET as getConsultationById } from "../../app/api/consultations/[id]/route";
import { DEFAULT_INTERNAL_TEST_SECRET, INTERNAL_TEST_SECRET_HEADER, Role } from "../../lib/auth/rbac";

(process.env as Record<string, string | undefined>).NODE_ENV = "test";
(process.env as Record<string, string | undefined>).INTERNAL_TEST_SECRET = DEFAULT_INTERNAL_TEST_SECRET;

function createTestHeaders(role: Role, userId: string) {
  return {
    "x-mock-role": role,
    "x-mock-user-id": userId,
    [INTERNAL_TEST_SECRET_HEADER]: DEFAULT_INTERNAL_TEST_SECRET,
  };
}

async function runVoiceTelemetryTests() {
  console.log("=== Running Voice Playback Telemetry Lifecycle Tests ===\n");
  const testPatientA = "patient-telemetry-alice";
  const testPatientB = "patient-telemetry-mallory";
  const encounterId = `ENC-TELEMETRY-${Date.now()}`;

  // 1. Create Encounter with pending turn record
  console.log("[Test 1] Create initial encounter with turn 1 audioDeliveryStatus='pending'");
  {
    const req = new Request("https://medvoice.org/api/consultations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...createTestHeaders("patient", testPatientA),
      },
      body: JSON.stringify({
        id: encounterId,
        patientName: "Alice",
        doctorId: "dr-sarah-chen",
        doctorName: "Dr. Sarah Chen, MD",
        specialty: "General Medicine",
        deliveredTurnRecords: [
          {
            turnId: 1,
            deliveredText: "Hello Alice, what symptoms are you having?",
            conversationalAction: "INQUIRE",
            caseVersion: 1,
            audioDeliveryStatus: "pending",
          },
        ],
      }),
    });

    const res = await postConsultation(req);
    assert.strictEqual(res.status, 200);
    console.log("  ✓ Encounter created with turn 1 pending delivery");
  }

  // 2. Client reports successful playback delivery
  console.log("\n[Test 2] Client player reports 'delivered' with 3200ms playback duration");
  {
    const req = new Request("https://medvoice.org/api/voice/telemetry", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...createTestHeaders("patient", testPatientA),
      },
      body: JSON.stringify({
        encounterId,
        turnId: 1,
        status: "delivered",
        playedDurationMs: 3200,
      }),
    });

    const res = await postTelemetry(req);
    assert.strictEqual(res.status, 200);
    const json = await res.json();
    assert.strictEqual(json.success, true);
    assert.strictEqual(json.deliveryStatus, "delivered");
    assert.strictEqual(json.telemetryType, "client_reported_playback");
    assert.strictEqual(json.acousticVerificationClaimed, false, "Zero false acoustic verification claims invariant");
    console.log("  ✓ Telemetry recorded client playback without claiming biological ear verification");
  }

  // 3. Verify record was updated in datastore
  console.log("\n[Test 3] Verify updated status on consultation record");
  {
    const req = new Request(`https://medvoice.org/api/consultations/${encounterId}`, {
      headers: createTestHeaders("patient", testPatientA),
    });

    const res = await getConsultationById(req, { params: Promise.resolve({ id: encounterId }) });
    assert.strictEqual(res.status, 200);
    const json = await res.json();
    const turn1 = json.consultation.deliveredTurnRecords?.find((t: any) => t.turnId === 1);
    assert.strictEqual(turn1?.audioDeliveryStatus, "delivered");
    assert.strictEqual(turn1?.audioDeliveryResult?.playedDurationMs, 3200);
    console.log("  ✓ Record verified: turn 1 delivery status updated to 'delivered' with duration");
  }

  // 4. Unauthorized caller attempt to submit telemetry for another patient's encounter
  console.log("\n[Test 4] Unauthorized caller attempt to submit telemetry for foreign encounter rejected (403)");
  {
    const req = new Request("https://medvoice.org/api/voice/telemetry", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...createTestHeaders("patient", testPatientB), // Different user!
      },
      body: JSON.stringify({
        encounterId,
        turnId: 1,
        status: "interrupted",
      }),
    });

    const res = await postTelemetry(req);
    assert.strictEqual(res.status, 403, "Foreign caller must be rejected with 403 Forbidden");
    const json = await res.json();
    assert.strictEqual(json.code, "FORBIDDEN");
    console.log("  ✓ Encounter isolation enforced: foreign caller rejected with 403 FORBIDDEN");
  }

  // 5. Invalid status rejected
  console.log("\n[Test 5] Invalid status string rejected with 400");
  {
    const req = new Request("https://medvoice.org/api/voice/telemetry", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...createTestHeaders("patient", testPatientA),
      },
      body: JSON.stringify({
        encounterId,
        turnId: 1,
        status: "listened_by_ear", // Invalid status!
      }),
    });

    const res = await postTelemetry(req);
    assert.strictEqual(res.status, 400);
    const json = await res.json();
    assert.strictEqual(json.code, "INVALID_STATUS");
    console.log("  ✓ Invalid status rejected with 400 INVALID_STATUS");
  }

  console.log("\nAll Voice Playback Telemetry tests passed successfully!");
}

runVoiceTelemetryTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
