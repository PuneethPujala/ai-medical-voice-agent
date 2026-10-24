/**
 * END-TO-END ACOUSTIC DSP TO HL7 FHIR R4 INTEGRATION TEST SUITE
 * 
 * Verifies the complete lifecycle:
 * 1. Real audio PCM analysis through in-browser DSP analyzer (extracts f0, pauses, variance).
 * 2. Server trust boundary validation (sanitizes malformed metrics, strips raw audio buffers).
 * 3. Multi-turn aggregation & turn history preservation (weighted averages, no silent overwrites).
 * 4. Voice chat dialogue turn persistence into server-authoritative encounter interviewState.
 * 5. Full consultation persistence into datastore and FHIR bundle generation.
 * 6. HL7 FHIR R4 schema, component coding, physical units (Hz, ms, {ratio}), and provenance validation.
 * 7. Privacy invariant: zero raw audio, PCM samples, or base64 data leaked into FHIR.
 * 8. Silent, unvoiced, cancelled, and unauthorized access boundary handling.
 */

import assert from "assert";
import path from "path";
import fs from "fs";
import { readWavFile } from "../../scripts/wav-reader";
import {
  AcousticDSPAnalyzer,
  analyzeAudioBufferAsync,
  validateAudioMetrics,
  aggregateTurnAudioMetrics,
  LiveAudioMetrics,
} from "../../lib/acoustic/acoustic-dsp-analyzer";
import { extractSpeechFeatures } from "../../lib/acoustic/speech-features";
import { POST as postConsultation } from "../../app/api/consultations/route";
import { GET as getConsultationFhir } from "../../app/api/consultations/[id]/fhir/route";
import { POST as postVoiceChat } from "../../app/api/voice/chat/route";
import { validateFhirR4Bundle, generateFHIRBundle } from "../../lib/fhir/bundle";
import { DEFAULT_INTERNAL_TEST_SECRET, INTERNAL_TEST_SECRET_HEADER, Role } from "../../lib/auth/rbac";

// Force test environment
(process.env as Record<string, string | undefined>).NODE_ENV = "test";
(process.env as Record<string, string | undefined>).INTERNAL_TEST_SECRET = DEFAULT_INTERNAL_TEST_SECRET;

function createTestHeaders(role: Role, userId: string, extra: Record<string, string> = {}) {
  return {
    "x-mock-role": role,
    "x-mock-user-id": userId,
    [INTERNAL_TEST_SECRET_HEADER]: DEFAULT_INTERNAL_TEST_SECRET,
    ...extra,
  };
}

let passedCount = 0;
let failedCount = 0;

async function testStep(name: string, fn: () => Promise<void> | void) {
  try {
    process.stdout.write(`  [RUNNING] ${name}... `);
    await fn();
    console.log(`✓ PASS`);
    passedCount++;
  } catch (err: any) {
    console.log(`✗ FAIL`);
    console.error(`    Error in [${name}]:`, err?.message || err);
    if (err?.stack) {
      console.error(err.stack.split("\n").slice(1, 4).join("\n"));
    }
    failedCount++;
  }
}

async function runE2EAcousticTests() {
  console.log("================================================================================");
  console.log("       MEDVOICE END-TO-END ACOUSTIC DSP TO HL7 FHIR R4 INTEGRATION TEST        ");
  console.log("================================================================================\n");

  const patientId = "patient-acoustic-e2e-001";
  const foreignPatientId = "patient-intruder-999";
  const encounterId = `ENC-ACOUSTIC-${Date.now()}`;

  // ---------------------------------------------------------------------------
  // Test 1: Real PCM Audio Analysis Through Actual DSP Analyzer
  // ---------------------------------------------------------------------------
  let realAudioMetrics: LiveAudioMetrics | null = null;
  await testStep("1. Real PCM audio analysis produces valid DSP telemetry", async () => {
    // Locate standardized clinical audio fixture
    const wavPath = path.resolve(process.cwd(), "data/test-audio/benchmark_samples/LAT-01.wav");
    assert.ok(fs.existsSync(wavPath), `WAV fixture must exist at: ${wavPath}`);

    const { samples, sampleRate } = readWavFile(wavPath);
    assert.ok(samples.length > 0, "PCM sample array must not be empty");
    assert.ok(sampleRate >= 8000 && sampleRate <= 48000, `Sample rate must be standard audio rate, got ${sampleRate}`);

    // Analyze using async chunked audio buffer analyzer
    const startTime = performance.now();
    realAudioMetrics = await analyzeAudioBufferAsync(samples, sampleRate);
    const dspElapsedMs = performance.now() - startTime;

    assert.ok(realAudioMetrics, "Metrics must be generated from audio");
    assert.ok(realAudioMetrics.durationMs > 2000, `Duration must exceed 2s, got ${realAudioMetrics.durationMs}ms`);
    assert.strictEqual(realAudioMetrics.sampleRate, sampleRate);
    assert.ok(realAudioMetrics.totalFramesCount !== undefined && realAudioMetrics.totalFramesCount > 100, "Must process more than 100 frames");
    assert.ok(realAudioMetrics.voicedFramesCount !== undefined && realAudioMetrics.voicedFramesCount > 10, "Must detect voiced speech frames");
    assert.ok(
      realAudioMetrics.meanF0Hz !== null &&
      realAudioMetrics.meanF0Hz !== undefined &&
      realAudioMetrics.meanF0Hz > 60 &&
      realAudioMetrics.meanF0Hz < 350,
      `Mean f0 must fall within human speech range (60-350 Hz), got: ${realAudioMetrics.meanF0Hz}`
    );
    assert.ok(
      realAudioMetrics.speechPauseRatio >= 0.0 && realAudioMetrics.speechPauseRatio <= 1.0,
      `Speech-pause ratio must be bounded [0, 1], got: ${realAudioMetrics.speechPauseRatio}`
    );
    assert.strictEqual(realAudioMetrics.isLiveDsp, true);
    console.log(`\n    -> Audio analyzed in ${dspElapsedMs.toFixed(1)}ms (Duration: ${realAudioMetrics.durationMs}ms, f0: ${realAudioMetrics.meanF0Hz} Hz, Pause ratio: ${realAudioMetrics.speechPauseRatio})`);
  });

  // ---------------------------------------------------------------------------
  // Test 2: Telemetry Trust Boundary & Injection Attack Stripping
  // ---------------------------------------------------------------------------
  await testStep("2. Server trust boundary strips raw audio and validates bounds", () => {
    // Attack payload containing injected raw audio buffer and invalid bounds
    const maliciousPayload = {
      durationMs: 5000,
      sampleRate: 16000,
      pauseCount: 3,
      totalPauseDurationMs: 1200,
      speechPauseRatio: 0.24,
      meanPauseDurationMs: 400,
      energyVariance: 0.21,
      pitchVariance: 0.18,
      meanF0Hz: 184.2,
      voicedFramesCount: 320,
      totalFramesCount: 500,
      isLiveDsp: true,
      // Injected illegal attributes attempting to leak raw audio into the datastore:
      rawAudio: new Float32Array([0.1, 0.2, 0.3]),
      pcmBuffer: "BASE64_PCM_AUDIO_DATA_PAYLOAD_HERE",
      audioBlob: { size: 1024, type: "audio/webm" },
      unauthorizedClinicalTag: "DIAGNOSED_ASTHMA_EMERGENCY",
    };

    const sanitized = validateAudioMetrics(maliciousPayload);
    assert.ok(sanitized, "Sanitizer must return sanitized object for valid numeric metrics");
    assert.strictEqual("rawAudio" in (sanitized as any), false, "Must strip rawAudio");
    assert.strictEqual("pcmBuffer" in (sanitized as any), false, "Must strip pcmBuffer");
    assert.strictEqual("audioBlob" in (sanitized as any), false, "Must strip audioBlob");
    assert.strictEqual("unauthorizedClinicalTag" in (sanitized as any), false, "Must strip unauthorizedClinicalTag");
    assert.strictEqual(sanitized.meanF0Hz, 184.2);

    // Negative / infinite bounds testing
    assert.strictEqual(validateAudioMetrics({ durationMs: -500 }), null, "Negative duration must be rejected");
    assert.strictEqual(validateAudioMetrics({ durationMs: Infinity }), null, "Infinite duration must be rejected");
    assert.strictEqual(validateAudioMetrics(null), null, "Null payload must return null");

    // Out-of-bounds f0 must be rejected to null, preserving unvoiced state without fabricating 0 Hz
    const outOfBoundsF0 = validateAudioMetrics({ durationMs: 2000, meanF0Hz: 1200 }); // 1200 Hz is supra-human
    assert.strictEqual(outOfBoundsF0, null, "Supra-human f0 must be rejected as invalid telemetry");

    // Partial payload must NOT invent energyVariance or pitchVariance or synthetic frame counts
    const partialPayload = validateAudioMetrics({ durationMs: 3000 });
    assert.ok(partialPayload !== null);
    assert.strictEqual(partialPayload.energyVariance, null, "Missing energyVariance must remain null, never fabricated as 0.1");
    assert.strictEqual(partialPayload.pitchVariance, null, "Missing pitchVariance must remain null, never fabricated as 0");
    assert.strictEqual(partialPayload.voicedFramesCount, undefined, "Missing voicedFramesCount must not be synthesized");
    assert.strictEqual(partialPayload.totalFramesCount, undefined, "Missing totalFramesCount must not be synthesized");
    assert.strictEqual(partialPayload.isLiveDsp, false, "Absent isLiveDsp must default to false, never asserted as true");

    // Crafted attack claiming isLiveDsp: true with invalid telemetry must still be rejected
    const craftedAttack = validateAudioMetrics({
      durationMs: 3000,
      isLiveDsp: true,
      meanF0Hz: 9999, // invalid pitch
    });
    assert.strictEqual(craftedAttack, null, "Claimed isLiveDsp: true must not bypass physiological bounds validation");

    // Extract speech features without audio duration: punctuation must NOT fabricate measured acoustic values
    const textOnlyFeatures = extractSpeechFeatures({
      transcriptText: "Hello doctor, I have a headache... and fever? Yes!",
      wordCount: 9,
    });
    assert.strictEqual(textOnlyFeatures.speech_rate_wpm, null, "Text-only input must have null measured speech_rate_wpm");
    assert.strictEqual(textOnlyFeatures.speech_pause_ratio, null, "Punctuation must not synthesize measured speech_pause_ratio");
    assert.strictEqual(textOnlyFeatures.mean_pause_duration_ms, null, "Punctuation must not synthesize measured mean_pause_duration_ms");
    assert.strictEqual(textOnlyFeatures.voice_energy_variability, null, "Missing acoustic telemetry must leave voice_energy_variability null");
    assert.strictEqual(textOnlyFeatures.pitch_variability, null, "Missing acoustic telemetry must leave pitch_variability null");
    assert.strictEqual(textOnlyFeatures.dialogue_pacing_wpm, 130, "Provides nominal dialogue_pacing_wpm configuration for turn pacing, never claimed as measured speech rate");
  });

  // ---------------------------------------------------------------------------
  // Test 3: Multi-Utterance Aggregation & Turn History
  // ---------------------------------------------------------------------------
  let multiTurnAggregate: LiveAudioMetrics | null = null;
  await testStep("3. Multi-turn aggregation preserves weighted metrics without overwriting", () => {
    const turn1: LiveAudioMetrics = {
      durationMs: 4000,
      pauseCount: 2,
      totalPauseDurationMs: 800,
      speechPauseRatio: 0.20,
      meanPauseDurationMs: 400,
      energyVariance: 0.15,
      pitchVariance: 0.12,
      meanF0Hz: 160.0,
      voicedFramesCount: 200,
      totalFramesCount: 400,
      sampleRate: 16000,
      isLiveDsp: true,
    };

    const turn2: LiveAudioMetrics = {
      durationMs: 6000,
      pauseCount: 4,
      totalPauseDurationMs: 1800,
      speechPauseRatio: 0.30,
      meanPauseDurationMs: 450,
      energyVariance: 0.25,
      pitchVariance: 0.20,
      meanF0Hz: 190.0,
      voicedFramesCount: 300,
      totalFramesCount: 600,
      sampleRate: 16000,
      isLiveDsp: true,
    };

    multiTurnAggregate = aggregateTurnAudioMetrics(turn1, turn2);

    assert.strictEqual(multiTurnAggregate.durationMs, 10000, "Total duration must sum both turns (4000 + 6000 = 10000)");
    assert.strictEqual(multiTurnAggregate.pauseCount, 6, "Total pause count must sum both turns (2 + 4 = 6)");
    assert.strictEqual(multiTurnAggregate.totalPauseDurationMs, 2600, "Total pause duration must sum (800 + 1800 = 2600)");
    assert.strictEqual(multiTurnAggregate.speechPauseRatio, 0.26, "Aggregated pause ratio must equal 2600 / 10000 = 0.26");
    assert.strictEqual(multiTurnAggregate.meanPauseDurationMs, Math.round(2600 / 6), "Mean pause duration must be 433ms");

    // Weighted mean f0: (160 * 200 + 190 * 300) / 500 = (32000 + 57000) / 500 = 89000 / 500 = 178.0 Hz
    assert.strictEqual(multiTurnAggregate.meanF0Hz, 178.0, "Weighted f0 must equal 178.0 Hz");
    assert.strictEqual(multiTurnAggregate.voicedFramesCount, 500);
    assert.strictEqual(multiTurnAggregate.totalFramesCount, 1000);
  });

  // ---------------------------------------------------------------------------
  // Test 4: End-to-End Voice Chat API Persistence & State Preservation
  // ---------------------------------------------------------------------------
  let consultationInterviewState: any = null;
  await testStep("4. /api/voice/chat accepts audioMetrics and attaches them to durable interviewState", async () => {
    assert.ok(realAudioMetrics, "Must have real audio metrics from Test 1");

    // Initialize encounter in datastore (status: "in_progress") exactly as ensureServerEncounter does
    const initReq = new Request("https://medvoice.org/api/consultations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...createTestHeaders("patient", patientId),
      },
      body: JSON.stringify({
        id: encounterId,
        patientName: "Puneeth Paralinguistics",
        doctorId: "dr-sarah-chen",
        doctorName: "Dr. Sarah Chen, MD",
        specialty: "Internal Medicine",
        chiefComplaint: "Acute chest tightness and difficulty breathing",
        status: "in_progress",
        durationSeconds: 0,
      }),
    });
    const initRes = await postConsultation(initReq);
    assert.strictEqual(initRes.status, 200, "Encounter pre-initialization must return 200 OK");

    const reqTurn1 = new Request("https://medvoice.org/api/voice/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...createTestHeaders("patient", patientId),
      },
      body: JSON.stringify({
        encounterId,
        doctorId: "dr-sarah-chen",
        message: "I have had severe chest tightness and difficulty catching my breath since morning.",
        conversationHistory: [],
        patientName: "Puneeth Paralinguistics",
        userId: patientId,
        audioMetrics: realAudioMetrics,
      }),
    });

    const resTurn1 = await postVoiceChat(reqTurn1);
    assert.strictEqual(resTurn1.status, 200, `Voice chat must return 200 OK, got ${resTurn1.status}`);

    const resJson = await resTurn1.json();
    assert.ok(resJson.interviewState, "Response must include interviewState");
    consultationInterviewState = resJson.interviewState;

    // Verify audio_metrics are attached to the server interviewState
    assert.ok(consultationInterviewState.audio_metrics, "interviewState must carry audio_metrics");
    assert.strictEqual(consultationInterviewState.audio_metrics.sampleRate, realAudioMetrics.sampleRate);
    assert.strictEqual(consultationInterviewState.audio_metrics.isLiveDsp, true);
    assert.strictEqual(consultationInterviewState.audio_metrics.meanF0Hz, realAudioMetrics.meanF0Hz);

    // Verify turn history
    assert.ok(Array.isArray(consultationInterviewState.audio_metrics_history), "Must maintain audio_metrics_history");
    assert.strictEqual(consultationInterviewState.audio_metrics_history.length, 1);
    assert.strictEqual(consultationInterviewState.audio_metrics_history[0].turnIndex, 1);

    // Verify speech features are derived from the real audio metrics
    assert.ok(consultationInterviewState.speech_features, "Must carry speech_features");
    assert.strictEqual(consultationInterviewState.speech_features.speech_pause_ratio, realAudioMetrics.speechPauseRatio);
  });

  // ---------------------------------------------------------------------------
  // Test 5: Full Consultation Persistence & FHIR Bundle Generation
  // ---------------------------------------------------------------------------
  let exportedFhirBundle: any = null;
  await testStep("5. Consultation finalization persists encounter and exports HL7 FHIR R4 paralinguistic observation", async () => {
    // 5a. Persist the consultation via POST /api/consultations
    const saveReq = new Request("https://medvoice.org/api/consultations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...createTestHeaders("patient", patientId),
      },
      body: JSON.stringify({
        id: encounterId,
        patientName: "Puneeth Paralinguistics",
        patientAge: "38",
        patientGender: "male",
        doctorId: "dr-sarah-chen",
        doctorName: "Dr. Sarah Chen, MD",
        specialty: "Internal Medicine",
        chiefComplaint: "Acute chest tightness and difficulty breathing",
        transcript: [
          { role: "patient", text: "I have had severe chest tightness and difficulty catching my breath.", timestamp: "10:00" },
          { role: "doctor", text: "I am evaluating your symptoms right now.", timestamp: "10:01" },
        ],
        triageLevel: "priority",
        triageTitle: "ESI LEVEL 3: URGENT — ACUTE CHEST TIGHTNESS EVALUATION",
        status: "completed_pending_review",
        durationSeconds: 180,
        interviewState: consultationInterviewState,
        audioMetrics: consultationInterviewState.audio_metrics,
        speechFeatures: consultationInterviewState.speech_features,
      }),
    });

    const saveRes = await postConsultation(saveReq);
    assert.strictEqual(saveRes.status, 200, `POST /api/consultations must succeed with 200 OK, got ${saveRes.status}`);
    const saveJson = await saveRes.json();
    assert.strictEqual(saveJson.success, true);
    assert.strictEqual(saveJson.consultation.id, encounterId);

    // 5b. Request FHIR R4 export via GET /api/consultations/[id]/fhir
    const fhirReq = new Request(`https://medvoice.org/api/consultations/${encounterId}/fhir`, {
      method: "GET",
      headers: createTestHeaders("patient", patientId),
    });

    const fhirRes = await getConsultationFhir(fhirReq, {
      params: Promise.resolve({ id: encounterId }),
    });

    assert.strictEqual(fhirRes.status, 200, `FHIR export must return 200 OK, got ${fhirRes.status}`);
    assert.ok(
      fhirRes.headers.get("Content-Type")?.includes("application/fhir+json"),
      "Must return application/fhir+json content type"
    );

    exportedFhirBundle = await fhirRes.json();
    assert.strictEqual(exportedFhirBundle.resourceType, "Bundle");
    assert.strictEqual(exportedFhirBundle.type, "document");

    // 5c. Validate presence and structure of Paralinguistic Acoustic Observation
    const acousticEntry = exportedFhirBundle.entry.find((e: any) =>
      e.resource?.id?.startsWith("observation-acoustic-")
    );
    assert.ok(acousticEntry, "FHIR Bundle MUST contain an acoustic Observation resource");
    const obs = acousticEntry.resource;

    assert.strictEqual(obs.resourceType, "Observation");
    assert.strictEqual(obs.status, "final");
    assert.strictEqual(obs.category?.[0]?.coding?.[0]?.code, "exam");
    assert.strictEqual(obs.code?.coding?.[0]?.system, "https://medvoice.health/fhir/CodeSystem/acoustic-metrics");
    assert.strictEqual(obs.code?.coding?.[0]?.code, "voice-paralinguistic-panel");

    // Validate Provenance: Device & Method accurately reflect client-reported telemetry ingest
    assert.ok(obs.device?.display?.includes("MedVoice"), "Device must describe MedVoice telemetry ingest module");
    assert.strictEqual(obs.method?.coding?.[0]?.code, "client-reported-dsp-telemetry");

    // Validate Components and UCUM units
    const components = obs.component;
    assert.ok(Array.isArray(components) && components.length >= 5, "Must contain at least 5 acoustic components");

    // Component: Mean fundamental frequency (f0)
    const f0Comp = components.find((c: any) => c.code?.coding?.[0]?.code === "mean-f0");
    assert.ok(f0Comp, "Must have mean-f0 component");
    assert.strictEqual(f0Comp.valueQuantity?.unit, "Hz");
    assert.strictEqual(f0Comp.valueQuantity?.code, "Hz");
    assert.strictEqual(f0Comp.valueQuantity?.system, "http://unitsofmeasure.org");
    assert.strictEqual(f0Comp.valueQuantity?.value, realAudioMetrics!.meanF0Hz);

    // Component: Conversational Pause Ratio
    const pauseComp = components.find((c: any) => c.code?.coding?.[0]?.code === "speech-pause-ratio");
    assert.ok(pauseComp, "Must have speech-pause-ratio component");
    assert.strictEqual(pauseComp.valueQuantity?.unit, "{ratio}");
    assert.strictEqual(pauseComp.valueQuantity?.code, "1");

    // Component: Pitch variability (f0 CV)
    const pitchComp = components.find((c: any) => c.code?.coding?.[0]?.code === "pitch-variability");
    assert.ok(pitchComp, "Must have pitch-variability component");
    assert.strictEqual(pitchComp.valueQuantity?.unit, "{ratio}");
    assert.strictEqual(pitchComp.valueQuantity?.code, "1");

    // Validate FHIR R4 structural schema validation
    const validation = validateFhirR4Bundle(exportedFhirBundle);
    assert.strictEqual(validation.valid, true, `Exported bundle must pass HL7 FHIR R4 validation: ${JSON.stringify(validation.issues)}`);
  });

  // ---------------------------------------------------------------------------
  // Test 6: Privacy Guard & Zero Raw Audio Leakage
  // ---------------------------------------------------------------------------
  await testStep("6. Privacy guard: Exported FHIR bundle contains ZERO raw audio, PCM samples, or base64 data", () => {
    assert.ok(exportedFhirBundle, "Must have exported bundle from Test 5");
    const jsonStr = JSON.stringify(exportedFhirBundle);

    // Verify zero binary leakage
    assert.strictEqual(jsonStr.includes("data:audio"), false, "Must not contain data:audio URI");
    assert.strictEqual(jsonStr.includes("Float32Array"), false, "Must not contain Float32Array");
    assert.strictEqual(jsonStr.includes("Int16Array"), false, "Must not contain Int16Array");
    assert.strictEqual(jsonStr.includes("audio/wav"), false, "Must not contain audio/wav MIME attachments");
    assert.strictEqual(jsonStr.includes("audio/webm"), false, "Must not contain audio/webm MIME attachments");
    assert.strictEqual(jsonStr.includes("pcmBuffer"), false, "Must not contain pcmBuffer key");
  });

  // ---------------------------------------------------------------------------
  // Test 7: Silent, Unvoiced, and Missing Measurement Handling
  // ---------------------------------------------------------------------------
  await testStep("7. Silent and unvoiced recordings omit f0 rather than fabricating 0 Hz", async () => {
    // Generate synthetic silent buffer (pure zeros)
    const silenceBuffer = new Float32Array(16000 * 2); // 2 seconds of digital silence
    const silentMetrics = await analyzeAudioBufferAsync(silenceBuffer, 16000);

    assert.strictEqual(silentMetrics.meanF0Hz, null, "Silent buffer must produce null meanF0Hz (never 0 Hz)");
    assert.strictEqual(silentMetrics.voicedFramesCount, 0, "Silent buffer has 0 voiced frames");

    // Bundle generation with unvoiced metrics
    const unvoicedRecord = {
      id: "ENC-SILENT-TEST",
      patientName: "Silent Patient",
      triageLevel: "routine" as const,
      audioMetrics: silentMetrics,
    };
    const unvoicedBundle = generateFHIRBundle(unvoicedRecord);
    const unvoicedObs = unvoicedBundle.entry.find((e: any) => e.resource?.id?.startsWith("observation-acoustic-"))?.resource;

    if (unvoicedObs) {
      const f0Comp = unvoicedObs.component?.find((c: any) => c.code?.coding?.[0]?.code === "mean-f0");
      assert.strictEqual(f0Comp, undefined, "Unvoiced f0 must NOT be present as a component; must never fabricate 0 Hz");
      const pitchVarComp = unvoicedObs.component?.find((c: any) => c.code?.coding?.[0]?.code === "pitch-variability");
      assert.strictEqual(pitchVarComp, undefined, "Unvoiced recording must NOT emit pitch-variability component");
    }

    // Partial telemetry without energy variability must omit energy-variability component in FHIR
    const partialRecord = {
      id: "ENC-PARTIAL-TEST",
      patientName: "Partial Patient",
      triageLevel: "routine" as const,
      audioMetrics: {
        durationMs: 4000,
        pauseCount: 2,
        totalPauseDurationMs: 800,
        speechPauseRatio: 0.20,
        meanPauseDurationMs: 400,
        sampleRate: 16000,
        energyVariance: null,
        pitchVariance: null,
      },
    };
    const partialBundle = generateFHIRBundle(partialRecord);
    const partialObs = partialBundle.entry.find((e: any) => e.resource?.id?.startsWith("observation-acoustic-"))?.resource;
    assert.ok(partialObs, "Partial telemetry still emits acoustic observation for available metrics");
    const partialEnergyComp = partialObs.component?.find((c: any) => c.code?.coding?.[0]?.code === "energy-variability");
    assert.strictEqual(partialEnergyComp, undefined, "Missing energyVariance must NOT produce FHIR component");
    const partialPitchComp = partialObs.component?.find((c: any) => c.code?.coding?.[0]?.code === "pitch-variability");
    assert.strictEqual(partialPitchComp, undefined, "Missing pitchVariance must NOT produce FHIR component");

    // Text-only intake without any microphone capture: Observation is cleanly omitted
    const textOnlyRecord = {
      id: "ENC-TEXT-ONLY-TEST",
      patientName: "Text Only Patient",
      triageLevel: "routine" as const,
    };
    const textOnlyBundle = generateFHIRBundle(textOnlyRecord);
    const textOnlyObs = textOnlyBundle.entry.find((e: any) => e.resource?.id?.startsWith("observation-acoustic-"));
    assert.strictEqual(textOnlyObs, undefined, "Text-only consultation must omit acoustic Observation resource completely");
  });

  // ---------------------------------------------------------------------------
  // Test 8: Tenant Isolation, IDOR Prevention & Conversational Path Latency
  // ---------------------------------------------------------------------------
  await testStep("8. Tenant isolation enforced (403 for unauthorized patient) & zero conversational latency blocking", async () => {
    // Unauthorized foreign patient attempting to export patient A's FHIR bundle
    const foreignReq = new Request(`https://medvoice.org/api/consultations/${encounterId}/fhir`, {
      method: "GET",
      headers: createTestHeaders("patient", foreignPatientId),
    });

    const foreignRes = await getConsultationFhir(foreignReq, {
      params: Promise.resolve({ id: encounterId }),
    });

    assert.strictEqual(foreignRes.status, 403, `IDOR attack must be rejected with 403 Forbidden, got ${foreignRes.status}`);

    // Conversational fast-path latency measurement: Server dialogue request processing overhead
    // (validateAudioMetrics + extractSpeechFeatures + aggregateTurnAudioMetrics)
    const t0 = performance.now();
    const validated = validateAudioMetrics(realAudioMetrics);
    const features = extractSpeechFeatures({
      transcriptText: "I am feeling short of breath",
      durationMs: validated?.durationMs,
      pauseCount: validated?.pauseCount,
      totalPauseDurationMs: validated?.totalPauseDurationMs,
      speechPauseRatio: validated?.speechPauseRatio,
      meanPauseDurationMs: validated?.meanPauseDurationMs,
      isLiveDsp: true,
    });
    const aggregated = aggregateTurnAudioMetrics(validated, validated!);
    const totalProcessingMs = performance.now() - t0;

    // Must be well within conversational real-time threshold (< 10ms for non-blocking server execution)
    assert.ok(totalProcessingMs < 10, `Server-side acoustic telemetry path took ${totalProcessingMs.toFixed(3)}ms, expected < 10ms`);
    console.log(`\n    -> Conversational request processing overhead: ${totalProcessingMs.toFixed(3)}ms (imperceptible CPU overhead)`);
  });

  console.log("\n================================================================================");
  console.log(`  E2E ACOUSTIC INTEGRATION BATTERY: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log("================================================================================\n");

  if (failedCount > 0) {
    process.exit(1);
  } else {
    console.log("ALL END-TO-END ACOUSTIC DSP TO FHIR INTEGRATION TESTS PASSED! ✅\n");
  }
}

runE2EAcousticTests().catch((err) => {
  console.error("Fatal test runner exception:", err);
  process.exit(1);
});
