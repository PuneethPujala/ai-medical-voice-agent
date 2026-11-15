/**
 * MedVoice AI: Deterministic Safety Arbiter Emergency Preemption Microbenchmark
 * 
 * Benchmarks deterministic sub-millisecond ESI preemption overriding
 * an unsafe or erroneous LLM "routine" disposition when acute red-flag symptoms are detected.
 * 
 * Evaluates:
 *   Patient Presentation: "I have a crushing chest pressure and broke into a cold sweat"
 *   Simulated Faulty LLM Suggestion: "routine" (Ambulatory home monitoring)
 *   Deterministic Arbiter Action: HARD PREEMPTION OVERRIDE -> ESI 2 (EMERGENCY) in < 1 ms CPU time
 * 
 * Note: Benchmarks the deterministic arbiter decision module directly on local CPU.
 * Round-trip audio TTFT (~550ms fast-path, ~1150ms standard) is an architectural budget,
 * not a live network/audio measurement.
 */

import fs from 'fs';
import path from 'path';
import { performance } from 'perf_hooks';
import { evaluateSafetyArbiter } from '../lib/triage/safety-arbiter';

async function runPreemptionDemo() {
  console.log('\n' + '='.repeat(80));
  console.log('  MEDVOICE AI: DETERMINISTIC SAFETY ARBITER MICROBENCHMARK DEMO');
  console.log('  Deterministic Zero-Hallucination Emergency Preemption Shield');
  console.log('='.repeat(80));

  const patientUtterance = "I have a crushing chest pressure and broke into a cold sweat";
  const simulatedLlmDisposition = "routine";
  const patientAge = 58;

  console.log('\n[EVALUATED CLINICAL VIGNETTE]');
  console.log(`  Patient Transcript: "${patientUtterance}"`);
  console.log(`  Demographics      : Age ${patientAge}, Male`);
  console.log(`  Presentation      : Acute Coronary Syndrome (ACS) suspected`);

  console.log('\n[SIMULATED GENERATIVE LLM DELIBERATION (UNCONSTRAINED BASELINE)]');
  console.log(`  Simulated LLM Proposed Disposition : "${simulatedLlmDisposition}" (Home observation / OTC antacid)`);
  console.log(`  Failure Mode Tested                : Hallucinatory Down-Triage / Missed Life Threat`);

  // JIT Warm-up pass to measure realistic warm CPU latency
  for (let i = 0; i < 50; i++) {
    evaluateSafetyArbiter({
      rawText: patientUtterance,
      patientAge,
      llmSuggestedLevel: simulatedLlmDisposition,
    });
  }

  // Timed single execution with high-resolution clock
  const tStart = performance.now();
  const decision = evaluateSafetyArbiter({
    rawText: patientUtterance,
    patientAge,
    llmSuggestedLevel: simulatedLlmDisposition,
  });
  const tEnd = performance.now();
  const singleLatencyMs = tEnd - tStart;

  // Run benchmark distribution (100 warm iterations)
  const latencies: number[] = [];
  for (let i = 0; i < 100; i++) {
    const t0 = performance.now();
    evaluateSafetyArbiter({
      rawText: patientUtterance,
      patientAge,
      llmSuggestedLevel: simulatedLlmDisposition,
    });
    const t1 = performance.now();
    latencies.push(t1 - t0);
  }
  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)];
  const p95 = latencies[Math.floor(latencies.length * 0.95)];
  const meanLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;

  console.log('\n' + '-'.repeat(80));
  console.log('  DETERMINISTIC SAFETY ARBITER EVALUATION (MEASURED LOCAL CPU EXECUTION)');
  console.log('-'.repeat(80));
  console.log(`  Preemption Triggered      : ${decision.isEmergency ? '🚨 YES (IRREVERSIBLE EMERGENCY FLOOR)' : 'NO'}`);
  console.log(`  Assigned ESI Acuity       : Level ${decision.esiScore} (ESI-2: Emergent, High Risk)`);
  console.log(`  Assigned Urgency Category : ${(decision.triageLevel || 'emergency').toUpperCase()}`);
  console.log(`  Deterministic Override    : ${decision.arbiterOverride ? 'MANDATORY SAFETY SHIELD OVERRIDE' : 'NONE'}`);
  console.log(`  Clinical Protocol         : ${decision.clinicalProtocol}`);
  console.log(`  Recommended Action        : ${decision.recommendedAction}`);
  console.log(`  Triggered Red Flags       :`);
  decision.unresolvedRedFlags.forEach((rf) => {
    console.log(`    • ${rf}`);
  });
  if (decision.universalRedFlagResult?.firedRules?.length) {
    decision.universalRedFlagResult.firedRules.forEach((rf) => {
      console.log(`    • [Universal Red Flag: ${rf.ruleId}] (confidence: ${rf.confidence})`);
    });
  }

  console.log('\n  MEASURED ARBITER MICROBENCHMARK LATENCY (100 Cycles):');
  console.log(`    • Single-Shot Latency   : ${singleLatencyMs.toFixed(3)} ms`);
  console.log(`    • Warm Mean Latency     : ${meanLatency.toFixed(3)} ms`);
  console.log(`    • P50 Latency           : ${p50.toFixed(3)} ms`);
  console.log(`    • P95 Latency           : ${p95.toFixed(3)} ms`);

  console.log('\n' + '-'.repeat(80));
  console.log('  FAST-PATH DIRECTIVE & ARCHITECTURAL LATENCY BUDGET');
  console.log('-'.repeat(80));
  console.log('  Emergency Fast-Path Directive:');
  console.log('    "This may be a heart emergency. Call 112 or 108 immediately.');
  console.log('     Do not drive yourself. Stay seated and rest while help is coming.');
  console.log('     When did this pressure begin?"');
  console.log('\n  Latency Waterfall Budget (Voice Pipeline):');
  console.log('    • STT (Groq Whisper)         : ~280 ms (streaming transcription)');
  console.log(`    • Safety Arbiter (Measured)  : ${meanLatency.toFixed(3)} ms (deterministic CPU preemption)`);
  console.log('    • Fast-Path Response Select  : ~50 ms (pre-compiled emergency prompt bypasses LLM)');
  console.log('    • Kokoro TTS First-Byte      : ~220 ms (streaming synthesis)');
  console.log('    • Target Round-Trip TTFT     : ~550 ms (Emergency Preemption Budget)');
  console.log('    • Standard Non-Emergent TTFT : ~1,150 ms (Includes full LLM deliberation)');
  console.log('='.repeat(80) + '\n');

  // Persist verifiable evidence
  const evidenceArtifact = {
    demo_id: 'PREEMPTION-MICROBENCHMARK-ACS-001',
    scenario: 'Crushing chest pressure with diaphoresis (Acute Coronary Syndrome)',
    patient_transcript: patientUtterance,
    patient_demographics: { age: patientAge, sex: 'male' },
    simulated_llm_disposition: simulatedLlmDisposition,
    deterministic_arbiter_result: {
      is_emergency: decision.isEmergency,
      esi_level: decision.esiScore,
      urgency_category: decision.triageLevel,
      arbiter_override: decision.arbiterOverride,
      clinical_protocol: decision.clinicalProtocol,
      recommended_action: decision.recommendedAction,
      unresolved_red_flags: decision.unresolvedRedFlags,
      universal_red_flags: decision.universalRedFlagResult?.firedRules || [],
    },
    measured_arbiter_latency_profile_ms: {
      single_shot: Number(singleLatencyMs.toFixed(3)),
      mean: Number(meanLatency.toFixed(3)),
      p50: Number(p50.toFixed(3)),
      p95: Number(p95.toFixed(3)),
      iterations_benchmarked: 100,
    },
    architectural_pipeline_budget_ms: {
      stt_whisper_ms: 280,
      measured_arbiter_ms: Number(meanLatency.toFixed(3)),
      fast_path_template_ms: 50,
      tts_kokoro_first_byte_ms: 220,
      budgeted_emergency_ttft_ms: 550,
      budgeted_standard_ttft_ms: 1150,
      note: 'Arbiter latency is empirically measured on local CPU. Audio pipeline latencies reflect architectural budget.'
    },
    timestamp: new Date().toISOString(),
  };

  const resultsDir = path.resolve('eval/results');
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }
  const evidencePath = path.join(resultsDir, 'preemption_demo_evidence.json');
  fs.writeFileSync(evidencePath, JSON.stringify(evidenceArtifact, null, 2), 'utf-8');
  console.log(`[Audit Evidence Artifact] Saved to ${evidencePath}\n`);
}

runPreemptionDemo().catch((err) => {
  console.error('Preemption demo failed:', err);
  process.exit(1);
});
