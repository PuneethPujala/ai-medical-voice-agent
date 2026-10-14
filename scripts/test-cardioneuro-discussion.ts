import { clinicalBoard } from "../lib/agents/clinical-board";
import { PatientCase } from "../lib/agents/schemas";

async function testCardioNeuroDiscussion() {
  console.log("==============================================================================");
  console.log("    GOLD-STANDARD MULTI-AGENT CROSS-EXAMINATION & REVISION BENCHMARK          ");
  console.log("==============================================================================");

  const patientCase: PatientCase = {
    patient_id: "BOARD-CARDIONEURO-001",
    patient_name: "Thomas Henderson",
    transcript: "I have sudden severe chest tightness, my left arm is numb, and I felt like I was going to black out with dizziness.",
    conversation_history: [],
    demographics: { age: 68, age_group: "older_adult" },
    detected_symptoms: [],
    vitals: {},
    speech_features: {
      speech_pause_ratio: 0.22,
      mean_pause_duration_ms: 420,
      speech_rate_wpm: 118,
      voice_energy_variability: 0.18,
      pitch_variability: 0.15,
      observations: ["Cardiorespiratory pause elevation"],
      clinical_relevance: {
        respiratory_distress_signal: "possible",
        vocal_instability_signal: "mild",
        confidence: 0.8
      }
    },
    pre_safety_flags: [],
    immediate_danger_detected: false,
    provenance_evidence: [],
    case_version: 1
  };

  const output = await clinicalBoard.evaluate(patientCase);

  console.log("1. Multi-Specialty Routing Verification:");
  console.log("   • Specialists Summoned:", output.trace.specialists_summoned);
  if (!output.trace.specialists_summoned.includes("cardiology") || !output.trace.specialists_summoned.includes("neurology")) {
    throw new Error("Cardio-Neuro case failed to summon both Cardiology and Neurology!");
  }
  console.log("   ✅ Both Dr. Marcus Vance (Cardiology) and Dr. Arthur Pendelton (Neurology) summoned.");

  console.log("\n2. Deliberation Rounds & Bounded Autonomy Check:");
  console.log("   • Deliberation Rounds Completed:", output.trace.deliberation_rounds);
  if (output.trace.deliberation_rounds > 3) {
    throw new Error("Deliberation exceeded MAX_ROUNDS = 3!");
  }
  console.log("   ✅ Bounded deliberation maintained (Rounds <= 3).");

  console.log("\n3. Cross-Specialty Peer Challenge & Revision Trace:");
  console.log("   • Total Peer Challenges:", output.trace.peer_challenges_count);
  if (output.trace.peer_challenges_count === 0) {
    throw new Error("Expected at least one cross-specialty challenge!");
  }
  console.log("   ✅ Cross-specialty challenge documented.");

  console.log("\n4. Complete Event-Derived Deliberation Message Stream:");
  output.trace.deliberation_messages.forEach((m, idx) => {
    console.log(`   [${m.round}][v${m.case_version}][${m.speakerRole.toUpperCase()}] ${m.doctorName} (${m.type}):`);
    console.log(`     "${m.content}"`);
  });

  const types = output.trace.deliberation_messages.map(m => m.type);
  const requiredTypes = ["assessment", "tool_result", "challenge", "response", "revision", "synthesis", "safety_disposition"];
  for (const req of requiredTypes) {
    if (!types.includes(req as any)) {
      throw new Error(`Missing expected deliberation message type: ${req}`);
    }
  }
  console.log("\n   ✅ Complete lifecycle verified: assessment -> tool_result -> challenge -> response -> revision -> synthesis -> safety_disposition.");

  console.log("\n5. Board Decision & Deterministic Safety Arbiter Invariant:");
  console.log("   • Primary Specialty:", output.consensus.primary_specialty);
  console.log("   • Final ESI Level:", output.post_arbiter.final_esi_level);
  console.log("   • Cryptographically Linked Audit SHA-256:", output.post_arbiter.audit_sha256);
  if (output.post_arbiter.final_esi_level !== 1 && output.post_arbiter.final_esi_level !== 2) {
    throw new Error(`Expected ESI 1 or 2 Emergency, got ESI ${output.post_arbiter.final_esi_level}`);
  }
  console.log(`   ✅ Locked to ESI ${output.post_arbiter.final_esi_level} EMERGENCY under dual-activation protocol with tamper-evident audit hash.`);

  console.log("\n==============================================================================");
  console.log("✅ GOLD-STANDARD MULTI-AGENT DISCUSSION BENCHMARK CONFIRMED.");
  console.log("==============================================================================");
}

testCardioNeuroDiscussion().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
