import assert from "assert";
import { generateFHIRBundle, validateFhirR4Bundle, ConsultationRecordFHIR } from "../../lib/fhir/bundle";
import { LiveAudioMetrics } from "../../lib/acoustic/acoustic-dsp-analyzer";

console.log("================================================================================");
console.log("     TEST SUITE: HL7 FHIR R4 PARALINGUISTIC ACOUSTIC OBSERVATION ENRICHMENT    ");
console.log("================================================================================\n");

let passedCount = 0;
let failedCount = 0;

function runTest(testId: string, description: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ [${testId}] PASS: ${description}`);
    passedCount++;
  } catch (err: any) {
    console.error(`  ✗ [${testId}] FAIL: ${description}`);
    console.error(`    Error: ${err?.message || err}`);
    failedCount++;
  }
}

const baseRecord: ConsultationRecordFHIR = {
  id: "CONSULT-ACOUSTIC-001",
  patientName: "Devi Raman",
  patientGender: "female",
  patientAge: 42,
  doctorId: "dr-sarah-chen",
  doctorName: "Dr. Sarah Chen, MD",
  specialty: "General Physician",
  chiefComplaint: "Shortness of breath and vocal fatigue when speaking",
  triageLevel: "priority",
  triageTitle: "ESI LEVEL 3: URGENT — ACUTE DYSPNEA EVALUATION",
  esiScore: 3,
  icd10Codes: ["R06.02"],
  detectedSymptoms: ["Shortness of breath", "Vocal fatigue"],
  soapSubjective: "Patient reports worsening breathlessness over 2 days with intermittent voice tiredness.",
  soapObjective: "Remote acoustic telemetry captured via browser Web Audio DSP.",
  soapAssessment: "Acute dyspnea, ESI Level 3 priority triage.",
  soapPlan: "Urgent in-person clinical assessment, pulse oximetry, chest auscultation.",
  createdAt: "2026-10-22T10:00:00.000Z",
};

const sampleAudioMetrics: LiveAudioMetrics = {
  durationMs: 5400,
  pauseCount: 4,
  totalPauseDurationMs: 1620,
  speechPauseRatio: 0.30,
  meanPauseDurationMs: 405,
  energyVariance: 0.24,
  pitchVariance: 0.19,
  meanF0Hz: 198.4,
  voicedFramesCount: 378,
  totalFramesCount: 540,
  sampleRate: 16000,
  isLiveDsp: true,
};

const sampleSpeechFeatures = {
  speech_pause_ratio: 0.30,
  mean_pause_duration_ms: 405,
  speech_rate_wpm: 115,
  voice_energy_variability: 0.24,
  pitch_variability: 0.19,
  observations: ["Frequent conversational pauses with elevated pause-to-speech ratio"],
  clinical_relevance: {
    respiratory_distress_signal: "possible" as const,
    vocal_instability_signal: "mild" as const,
    confidence: 0.65,
  },
};

// -----------------------------------------------------------------------------
// Test 1: Real Measurement Mapping from DSP Telemetry into FHIR Observation
// -----------------------------------------------------------------------------
runTest("FHIR-PARA-01-REAL-MEASUREMENT-MAPPING", "Actual DSP metrics map into a structured FHIR R4 Observation resource", () => {
  const recordWithAcoustics: ConsultationRecordFHIR = {
    ...baseRecord,
    audioMetrics: sampleAudioMetrics,
    speechFeatures: sampleSpeechFeatures,
  };

  const bundle = generateFHIRBundle(recordWithAcoustics);
  const acousticEntry = bundle.entry.find((e) => e.resource.id?.startsWith("observation-acoustic-"));

  assert.ok(acousticEntry, "Bundle must contain an acoustic Observation resource");
  const obs = acousticEntry.resource;
  assert.strictEqual(obs.resourceType, "Observation");
  assert.strictEqual(obs.status, "final");

  // Category must be 'exam' per FHIR clinical observation conventions
  assert.strictEqual(obs.category?.[0]?.coding?.[0]?.code, "exam");
  assert.strictEqual(obs.category?.[0]?.coding?.[0]?.system, "http://terminology.hl7.org/CodeSystem/observation-category");

  // Code must identify acoustic voice analysis panel using project's canonical CodeSystem
  const panelCoding = obs.code?.coding?.find((c: any) => c.system === "https://medvoice.health/fhir/CodeSystem/acoustic-metrics" && c.code === "voice-paralinguistic-panel");
  assert.ok(panelCoding, "Must include canonical CodeSystem panel coding (voice-paralinguistic-panel)");
  assert.strictEqual(panelCoding.display, "MedVoice Acoustic & Paralinguistic Speech Telemetry Panel");

  // Regress: Unverified or unrelated LOINC codes (e.g. 80437-7 'Employer country') must NEVER be used
  const illegalLoincPanel = obs.code?.coding?.find((c: any) => c.system === "http://loinc.org" && c.code === "80437-7");
  assert.strictEqual(illegalLoincPanel, undefined, "Must NOT include unrelated LOINC 80437-7");

  // Regress: Every coding on observation must have matching system and intended display semantics
  for (const cod of obs.code?.coding || []) {
    assert.ok(cod.system && cod.code && cod.display, "Every coding must define system, code, and display");
    assert.strictEqual(cod.system, "https://medvoice.health/fhir/CodeSystem/acoustic-metrics", "Panel coding system must be canonical acoustic-metrics");
  }

  assert.ok(Array.isArray(obs.component), "Must contain component array for individual metrics");
  assert.ok(obs.component.length >= 4, "Must contain at least 4 measured acoustic components");
});

// -----------------------------------------------------------------------------
// Test 2: Standard Units and Coding Identifiers (UCUM & Canonical CodeSystem)
// -----------------------------------------------------------------------------
runTest("FHIR-PARA-02-UNITS-AND-CODING", "Acoustic components retain real physical units and valid terminology identifiers", () => {
  const record: ConsultationRecordFHIR = {
    ...baseRecord,
    audioMetrics: sampleAudioMetrics,
    speechFeatures: sampleSpeechFeatures,
  };

  const bundle = generateFHIRBundle(record);
  const obs = bundle.entry.find((e) => e.resource.id?.startsWith("observation-acoustic-"))?.resource;
  assert.ok(obs);

  // 1. Fundamental frequency component
  const f0Comp = obs.component.find((c: any) =>
    c.code.coding.some((cod: any) => cod.code === "mean-f0")
  );
  assert.ok(f0Comp, "Must have fundamental frequency component");
  assert.strictEqual(f0Comp.valueQuantity.value, 198.4);
  assert.strictEqual(f0Comp.valueQuantity.unit, "Hz");
  assert.strictEqual(f0Comp.valueQuantity.system, "http://unitsofmeasure.org");
  assert.strictEqual(f0Comp.valueQuantity.code, "Hz");

  const f0Coding = f0Comp.code.coding.find((c: any) => c.code === "mean-f0");
  assert.strictEqual(f0Coding.system, "https://medvoice.health/fhir/CodeSystem/acoustic-metrics");
  assert.strictEqual(f0Coding.display, "Mean fundamental frequency (f0)");

  // Regress: Unverified LOINC 80436-9 ('Past employer postal code') must NEVER be attached to f0
  const illegalLoincF0 = f0Comp.code.coding.find((c: any) => c.system === "http://loinc.org" && c.code === "80436-9");
  assert.strictEqual(illegalLoincF0, undefined, "Must NOT include unrelated LOINC 80436-9");

  // Verify all component codings strictly match canonical system and have matching semantics
  for (const comp of obs.component) {
    for (const cod of comp.code.coding) {
      assert.strictEqual(cod.system, "https://medvoice.health/fhir/CodeSystem/acoustic-metrics", "Component coding must use canonical acoustic-metrics system");
      assert.ok(cod.display && cod.display.length > 5, "Component display must describe the metric meaningfully");
    }
  }

  // 2. Speech rate component
  const rateComp = obs.component.find((c: any) =>
    c.code.coding.some((cod: any) => cod.code === "speech-rate")
  );
  assert.ok(rateComp, "Must have speech rate component");
  assert.strictEqual(rateComp.valueQuantity.value, 115);
  assert.strictEqual(rateComp.valueQuantity.unit, "{words}/min");
  assert.strictEqual(rateComp.valueQuantity.system, "http://unitsofmeasure.org");

  // 3. Pause duration component
  const pauseComp = obs.component.find((c: any) =>
    c.code.coding.some((cod: any) => cod.code === "mean-pause-duration")
  );
  assert.ok(pauseComp, "Must have mean pause duration component");
  assert.strictEqual(pauseComp.valueQuantity.value, 405);
  assert.strictEqual(pauseComp.valueQuantity.unit, "ms");
  assert.strictEqual(pauseComp.valueQuantity.system, "http://unitsofmeasure.org");

  // 4. Speech pause ratio component
  const ratioComp = obs.component.find((c: any) =>
    c.code.coding.some((cod: any) => cod.code === "speech-pause-ratio")
  );
  assert.ok(ratioComp, "Must have speech-pause ratio component");
  assert.strictEqual(ratioComp.valueQuantity.value, 0.30);
  assert.strictEqual(ratioComp.valueQuantity.unit, "{ratio}");
  assert.strictEqual(ratioComp.valueQuantity.code, "1");
});

// -----------------------------------------------------------------------------
// Test 3: Provenance Metadata (Method, Device, Timestamps)
// -----------------------------------------------------------------------------
runTest("FHIR-PARA-03-MEASUREMENT-PROVENANCE", "Captures measurement timestamp, DSP method, and analyzer device details", () => {
  const record: ConsultationRecordFHIR = {
    ...baseRecord,
    audioMetrics: sampleAudioMetrics,
    speechFeatures: sampleSpeechFeatures,
  };

  const bundle = generateFHIRBundle(record);
  const obs = bundle.entry.find((e) => e.resource.id?.startsWith("observation-acoustic-"))?.resource;
  assert.ok(obs);

  assert.strictEqual(obs.effectiveDateTime, "2026-10-22T10:00:00.000Z");
  assert.ok(obs.issued, "Must have an issued timestamp");
  assert.ok(obs.method?.text?.includes("DSP") || obs.method?.coding?.[0]?.display?.includes("DSP"), "Must record DSP method");
  assert.ok(obs.device?.display?.includes("MedVoice"), "Must record analyzer device/software description");
});

// -----------------------------------------------------------------------------
// Test 4: Missing or Unvoiced Measurements: Zero-Fabrication Prevention
// -----------------------------------------------------------------------------
runTest("FHIR-PARA-04-MISSING-MEASUREMENTS", "Unvoiced or missing measurements must NOT be fabricated as 0 Hz or false values", () => {
  // Scenario: Audio was unvoiced (whisper or non-periodic sound), so meanF0Hz is null
  const unvoicedMetrics: LiveAudioMetrics = {
    ...sampleAudioMetrics,
    meanF0Hz: null,
    pitchVariance: 0,
  };

  const record: ConsultationRecordFHIR = {
    ...baseRecord,
    audioMetrics: unvoicedMetrics,
    speechFeatures: {
      ...sampleSpeechFeatures,
      pitch_variability: 0,
    },
  };

  const bundle = generateFHIRBundle(record);
  const obs = bundle.entry.find((e) => e.resource.id?.startsWith("observation-acoustic-"))?.resource;
  assert.ok(obs);

  // Must NOT contain an f0 component with 0 Hz!
  const zeroF0 = obs.component.find((c: any) =>
    c.code.coding.some((cod: any) => cod.code === "mean-f0") && c.valueQuantity?.value === 0
  );
  assert.strictEqual(zeroF0, undefined, "Must NOT fabricate 0 Hz for unvoiced frames");

  // Record with NO acoustic metrics must not create any acoustic observation entry
  const recordWithoutAudio: ConsultationRecordFHIR = { ...baseRecord };
  const cleanBundle = generateFHIRBundle(recordWithoutAudio);
  const noAcoustic = cleanBundle.entry.find((e) => e.resource.id?.startsWith("observation-acoustic-"));
  assert.strictEqual(noAcoustic, undefined, "Record without audioMetrics must not generate phantom acoustic observation");
});

// -----------------------------------------------------------------------------
// Test 5: Privacy Preservation: Zero Raw Audio or Binary Payload Leak
// -----------------------------------------------------------------------------
runTest("FHIR-PARA-05-PRIVACY-NO-RAW-AUDIO", "Raw audio buffers, PCM arrays, or base64 samples are not leaked into FHIR bundle", () => {
  const record: ConsultationRecordFHIR = {
    ...baseRecord,
    audioMetrics: sampleAudioMetrics,
    speechFeatures: sampleSpeechFeatures,
  };

  const bundleJson = JSON.stringify(generateFHIRBundle(record));

  assert.ok(!bundleJson.includes("Float32Array"), "Must not leak raw typed arrays");
  assert.ok(!bundleJson.includes("audio/wav;base64"), "Must not leak raw base64 audio");
  assert.ok(!bundleJson.includes("data:audio"), "Must not leak audio data URIs");
  assert.ok(!bundleJson.includes("pcmBuffer"), "Must not leak internal PCM buffers");
});

// -----------------------------------------------------------------------------
// Test 6: Clinical Boundaries: Acoustic Metrics Cannot Silently Become Diagnoses
// -----------------------------------------------------------------------------
runTest("FHIR-PARA-06-CLINICAL-BOUNDARIES", "Acoustic disruption cannot autonomously create diagnoses or elevate ESI level", () => {
  // High pause ratio and severe vocal instability
  const severeDisruptionMetrics: LiveAudioMetrics = {
    ...sampleAudioMetrics,
    speechPauseRatio: 0.52,
    meanPauseDurationMs: 950,
  };

  const severeSpeechFeatures = {
    ...sampleSpeechFeatures,
    speech_pause_ratio: 0.52,
    speech_rate_wpm: 60,
    clinical_relevance: {
      respiratory_distress_signal: "severe" as const,
      vocal_instability_signal: "pronounced" as const,
      confidence: 0.90,
    },
  };

  const record: ConsultationRecordFHIR = {
    ...baseRecord,
    triageLevel: "priority",
    esiScore: 3,
    audioMetrics: severeDisruptionMetrics,
    speechFeatures: severeSpeechFeatures,
  };

  const bundle = generateFHIRBundle(record);
  const obs = bundle.entry.find((e) => e.resource.id?.startsWith("observation-acoustic-"))?.resource;
  assert.ok(obs);

  // Must contain an explicit observational note reminding clinicians of non-diagnostic boundary
  assert.ok(
    obs.note?.some((n: any) => n.text?.toLowerCase().includes("does not establish clinical diagnoses")),
    "Observation must contain explicit non-diagnostic safety boundary note"
  );

  // ESI score must remain determined by clinical triage, not acoustic metric alone
  const esiObs = bundle.entry.find((e) => e.resource.id?.startsWith("observation-esi-"))?.resource;
  assert.strictEqual(esiObs?.valueInteger, 3, "Acoustic telemetry must not autonomously override ESI score to ESI 1");

  // No phantom Condition resources generated purely from acoustic features
  const conditions = bundle.entry.filter((e) => e.resource.resourceType === "Condition");
  for (const cond of conditions) {
    assert.notStrictEqual(cond.resource.code?.coding?.[0]?.code, "ACOUSTIC_DISTRESS");
  }
});

// -----------------------------------------------------------------------------
// Test 7: Bundle Structural Integrity & Reference Validations
// -----------------------------------------------------------------------------
runTest("FHIR-PARA-07-BUNDLE-INTEGRITY", "Enriched bundle passes validateFhirR4Bundle and satisfies all reference contracts", () => {
  const record: ConsultationRecordFHIR = {
    ...baseRecord,
    audioMetrics: sampleAudioMetrics,
    speechFeatures: sampleSpeechFeatures,
  };

  const bundle = generateFHIRBundle(record);
  const validation = validateFhirR4Bundle(bundle as unknown as Record<string, unknown>);

  if (!validation.valid) {
    console.error("Validation issues:", validation.issues);
  }
  assert.strictEqual(validation.valid, true, "Enriched bundle must pass full FHIR R4 validation");

  const acousticEntry = bundle.entry.find((e) => e.resource.id?.startsWith("observation-acoustic-"));
  assert.ok(acousticEntry);

  // Check references
  assert.strictEqual(acousticEntry.resource.subject?.reference, `Patient/patient-CONSULT-ACOUSTIC-001`);
  assert.strictEqual(acousticEntry.resource.encounter?.reference, `Encounter/encounter-CONSULT-ACOUSTIC-001`);

  // Composition must reference or summarize acoustic findings in the Objective section
  const composition = bundle.entry[0].resource;
  const objectiveSection = composition.section?.find((s: any) => s.title?.toLowerCase().includes("objective"));
  assert.ok(objectiveSection, "Composition must contain Objective section");
  assert.ok(
    objectiveSection.text?.div?.includes("observation-acoustic-") ||
    objectiveSection.text?.div?.includes("Hz") ||
    objectiveSection.text?.div?.includes("WPM") ||
    objectiveSection.text?.div?.includes("Acoustic"),
    "Composition Objective section must summarize or reference acoustic telemetry"
  );
});

console.log("\n================================================================================");
console.log(`  FHIR PARALINGUISTIC OBSERVATION BATTERY: ${passedCount} PASSED, ${failedCount} FAILED`);
console.log("================================================================================\n");

if (failedCount > 0) {
  process.exit(1);
} else {
  console.log("ALL FHIR PARALINGUISTIC OBSERVATION TESTS PASSED SUCCESSFULLY! ✅");
  process.exit(0);
}
