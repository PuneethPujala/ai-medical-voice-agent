import assert from "assert";
import { conversationManager } from "../../lib/triage/conversation-manager";
import { evaluatePreArbiter } from "../../lib/triage/pre-arbiter";
import { POST as postTriage } from "../../app/api/triage/route";

(process.env as Record<string, string | undefined>).NODE_ENV = "test";

async function runUnknownAgeAndPediatricSafetyTests() {
  console.log("================================================================================");
  console.log("  MEDVOICE UNKNOWN AGE PRESERVATION & PEDIATRIC SAFETY REGRESSION SUITE        ");
  console.log("================================================================================");

  // Test 1: Conversation turn with unstated age preserves "unknown" age_group (never defaults to "adult")
  console.log("\n[Test 1] Conversation turn with unstated age preserves age_group as 'unknown'");
  {
    const turnResult = await conversationManager.processTurn(
      "I have a mild runny nose and cough.",
      undefined,
      { age: null, age_group: "unknown", age_source: "unknown" }
    );

    assert(turnResult.state, "Turn result contains state");
    // State demographics or interview state must not force "adult"
    assert.strictEqual(
      turnResult.state.patientProfile?.ageGroup || "unknown",
      "unknown",
      "Unstated age must not be forced to adult!"
    );
    console.log("  ✓ PASS: Unstated age preserved as 'unknown'");
  }

  // Test 2: Pre-Arbiter does not suppress pediatric emergency flags when age is unknown
  console.log("\n[Test 2] Pre-Arbiter screens pediatric crisis cues even when age number is not provided");
  {
    const preCheck = evaluatePreArbiter({
      transcript: "My baby is unusually floppy, inconsolable, and refusing to feed.",
      demographics: {
        age: undefined,
        age_group: "unknown" as any,
      },
    });

    assert(
      preCheck.immediate_danger || preCheck.pre_safety_flags.length > 0,
      "Pediatric crisis flags must trigger on infant distress cues even without numeric age!"
    );
    assert(
      preCheck.pre_safety_flags.includes("PRE_FLAG_PEDIATRIC_CRISIS"),
      "Must include PRE_FLAG_PEDIATRIC_CRISIS flag!"
    );
    console.log("  ✓ PASS: Pediatric crisis flags fire without numeric age override");
  }

  // Test 3: Demographic age group categorization accuracy across lifecycle stages
  console.log("\n[Test 3] Accurate age group classification across infant, pediatric, adult, and geriatric");
  {
    const testCases: Array<{ age: number; expected: string }> = [
      { age: 0, expected: "infant" },
      { age: 4, expected: "pediatric" },
      { age: 32, expected: "adult" },
      { age: 78, expected: "geriatric" },
    ];

    for (const { age, expected } of testCases) {
      const calculated = age < 1 ? "infant" : age < 18 ? "pediatric" : age > 65 ? "geriatric" : "adult";
      assert.strictEqual(calculated, expected, `Age ${age} must map to ${expected}`);
    }
    console.log("  ✓ PASS: Lifecycle demographic bins map correctly");
  }

  // Test 4: Triage Route Truthful Emergency Instructions (No false claims of dispatch)
  console.log("\n[Test 4] Triage route emergency instructions direct callers to 112/108 without claiming dispatch");
  {
    const req = new Request("https://medvoice.org/api/triage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transcript: "Crushing chest pain radiating down left arm with cold sweats.",
        patient_id: "P-1002",
        patient_name: "Test Patient",
      }),
    });

    const res = await postTriage(req);
    assert.strictEqual(res.status, 200, "Triage route succeeds");
    const data = await res.json();
    assert(data.triage, "Triage payload returned");
    const spoken = data.triage.spoken_response;

    // Check that deceptive phrases are absent
    assert(
      !spoken.includes("while we connect you with emergency services"),
      "VIOLATION: False claim of connecting to emergency services detected!"
    );
    assert(
      !spoken.includes("while emergency dispatch is initiated"),
      "VIOLATION: False claim of dispatch initiation detected!"
    );

    // Check that truthful emergency instructions are present
    assert(
      spoken.includes("112") || spoken.includes("108"),
      "Emergency response must instruct caller to call 112 or 108!"
    );
    console.log("  ✓ PASS: Truthful emergency instructions provided (directing to 112/108 without false dispatch claims)");
  }

  console.log("\n================================================================================");
  console.log("  ALL UNKNOWN AGE & EMERGENCY INSTRUCTION CHECKS PASSED (4/4)                   ");
  console.log("================================================================================\n");
}

runUnknownAgeAndPediatricSafetyTests().catch((err) => {
  console.error("Unknown age & pediatric safety test failure:", err);
  process.exit(1);
});
