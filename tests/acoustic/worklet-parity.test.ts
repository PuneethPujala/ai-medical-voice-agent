/**
 * ==============================================================================
 * MEDVOICE AUDIOWORKLET DSP CORRECTNESS, NUMERICAL PARITY & FALLBACK TEST SUITE
 * ==============================================================================
 *
 * Verifies:
 * 1. Direct execution of the real `public/worklets/acoustic-dsp-processor.js` code
 *    inside a VM sandbox with simulated AudioWorkletProcessor environment.
 * 2. Framing and numerical parity against offline reference functions across
 *    silence, periodic tones, and speech-with-pause signals.
 * 3. Variable block sizes (64, 128, 256, 512, 1024, irregular 120/250) and sample rates.
 * 4. MessagePort protocol lifecycle (INIT, READY, FRAME_BATCH, FINALIZE, RESET, DISPOSE).
 * 5. Flush of remaining frames (< 10 frames) on finalization.
 * 6. AcousticDSPAnalyzer fallback to ScriptProcessor and single-path execution.
 * 7. Synchronous vs Asynchronous finalization semantics.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as vm from "node:vm";
import {
  analyzeAcousticFrame,
  aggregateAcousticMetrics,
  computeRmsEnergy,
  computeDbfs,
  evaluateVad,
  extractF0Autocorrelation,
  getAcousticWorkletUrl,
  AcousticDSPAnalyzer,
  LiveAudioMetrics,
  AcousticFrameResult,
} from "../../lib/acoustic/acoustic-dsp-analyzer";

// ----------------------------------------------------------------------------
// Test Utilities & Synthetic Audio Generators
// ----------------------------------------------------------------------------

function generateSilence(durationSec: number, sampleRate: number): Float32Array {
  const numSamples = Math.round(durationSec * sampleRate);
  return new Float32Array(numSamples);
}

function generateSineWave(freqHz: number, durationSec: number, sampleRate: number, amplitude: number = 0.5): Float32Array {
  const numSamples = Math.round(durationSec * sampleRate);
  const buffer = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    buffer[i] = amplitude * Math.sin((2 * Math.PI * freqHz * i) / sampleRate);
  }
  return buffer;
}

function generateSpeechLikePattern(sampleRate: number): Float32Array {
  // 500ms voiced (150Hz + 300Hz harmonic) + 300ms silence + 500ms voiced (200Hz)
  const part1 = Math.round(0.5 * sampleRate);
  const pause = Math.round(0.3 * sampleRate);
  const part2 = Math.round(0.5 * sampleRate);

  const total = new Float32Array(part1 + pause + part2);

  // Part 1: 150 Hz voiced speech
  for (let i = 0; i < part1; i++) {
    const t = i / sampleRate;
    total[i] = 0.4 * Math.sin(2 * Math.PI * 150 * t) + 0.15 * Math.sin(2 * Math.PI * 300 * t);
  }
  // Pause: zeroes
  // Part 2: 200 Hz voiced speech
  for (let i = 0; i < part2; i++) {
    const t = i / sampleRate;
    total[part1 + pause + i] = 0.45 * Math.sin(2 * Math.PI * 200 * t) + 0.1 * Math.sin(2 * Math.PI * 400 * t);
  }

  return total;
}

// ----------------------------------------------------------------------------
// AudioWorkletProcessor VM Harness
// ----------------------------------------------------------------------------

interface WorkletMessage {
  type: string;
  [key: string]: any;
}

class MockMessagePort {
  public onmessage: ((event: { data: WorkletMessage }) => void) | null = null;
  public sentMessages: WorkletMessage[] = [];
  public peer: MockMessagePort | null = null;

  postMessage(data: WorkletMessage) {
    this.sentMessages.push(data);
    if (this.peer && this.peer.onmessage) {
      // Synchronous delivery for deterministic test execution
      this.peer.onmessage({ data });
    }
  }
}

function createWorkletHarness(): {
  ProcessorClass: any;
  instantiate: (sampleRate?: number, vadThresholdDbfs?: number) => {
    processor: any;
    processorPort: MockMessagePort;
    clientPort: MockMessagePort;
    receivedClientMessages: WorkletMessage[];
  };
} {
  const workletPath = path.resolve(process.cwd(), "public/worklets/acoustic-dsp-processor.js");
  if (!fs.existsSync(workletPath)) {
    throw new Error(`Worklet file not found at ${workletPath}`);
  }

  const workletSource = fs.readFileSync(workletPath, "utf-8");

  let registeredProcessorName: string | null = null;
  let RegisteredProcessorClass: any = null;

  class BaseAudioWorkletProcessor {
    public port: MockMessagePort;
    constructor(options?: any) {
      this.port = new MockMessagePort();
    }
  }

  const sandbox = {
    AudioWorkletProcessor: BaseAudioWorkletProcessor,
    registerProcessor: (name: string, processorCtor: any) => {
      registeredProcessorName = name;
      RegisteredProcessorClass = processorCtor;
    },
    Float32Array,
    Math,
    console: {
      log: () => {},
      warn: () => {},
      error: () => {},
    },
  };

  const context = vm.createContext(sandbox);
  vm.runInContext(workletSource, context, { filename: "acoustic-dsp-processor.js" });

  if (!RegisteredProcessorClass) {
    throw new Error("Failed to register AudioWorkletProcessor inside VM sandbox.");
  }

  return {
    ProcessorClass: RegisteredProcessorClass,
    instantiate: (sampleRate = 16000, vadThresholdDbfs = -38) => {
      const processor = new RegisteredProcessorClass();
      const clientPort = new MockMessagePort();
      const processorPort = processor.port as MockMessagePort;

      // Link two-way ports
      processorPort.peer = clientPort;
      clientPort.peer = processorPort;

      const receivedClientMessages: WorkletMessage[] = [];
      clientPort.onmessage = (event) => {
        receivedClientMessages.push(event.data);
      };

      // Send INIT
      clientPort.postMessage({
        type: "INIT",
        sampleRate,
        vadThresholdDbfs,
      });

      return {
        processor,
        processorPort,
        clientPort,
        receivedClientMessages,
      };
    },
  };
}

// ----------------------------------------------------------------------------
// Test Runner
// ----------------------------------------------------------------------------

async function runBattery() {
  console.log("================================================================================");
  console.log("     MEDVOICE AUDIOWORKLET DSP PARITY & CORRECTNESS VERIFICATION BATTERY        ");
  console.log("================================================================================\n");

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`  ✓ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${testName}${detail ? ` -> ${detail}` : ""}`);
      failed++;
    }
  }

  const harness = createWorkletHarness();

  // --------------------------------------------------------------------------
  // TEST GROUP 1: Processor-Unit Execution & Protocol Lifecycle
  // --------------------------------------------------------------------------
  console.log("[GROUP 1] AudioWorkletProcessor Real Implementation & Lifecycle Contract");

  {
    const { processor, clientPort, receivedClientMessages } = harness.instantiate(16000, -38);

    assert(
      receivedClientMessages.some((m) => m.type === "READY" && m.sampleRate === 16000),
      "Worklet processor loads from disk and acknowledges INIT with READY handshake",
      `Received: ${JSON.stringify(receivedClientMessages[0])}`
    );

    // Invalid / unexpected message robustness
    clientPort.postMessage({ type: "NON_EXISTENT_OPCODE", payload: 12345 });
    clientPort.postMessage(null as any);
    clientPort.postMessage({} as any);

    assert(
      processor.isRunning === true,
      "Processor ignores malformed and unknown message types without crashing or corrupting state"
    );

    // RESET command
    clientPort.postMessage({ type: "RESET" });
    assert(
      receivedClientMessages.some((m) => m.type === "RESET_COMPLETE"),
      "Processor correctly executes RESET and signals RESET_COMPLETE"
    );

    // DISPOSE command
    clientPort.postMessage({ type: "DISPOSE" });
    assert(
      processor.isRunning === false,
      "Processor marks isRunning=false upon receiving DISPOSE"
    );

    const postDisposeOutput = processor.process([[new Float32Array(128)]], [[new Float32Array(128)]]);
    assert(
      postDisposeOutput === false,
      "Processor process() returns false after DISPOSE to notify audio render thread to terminate node"
    );
  }

  // --------------------------------------------------------------------------
  // TEST GROUP 2: Numerical Parity with Silence Input
  // --------------------------------------------------------------------------
  console.log("\n[GROUP 2] Framing & Numerical Parity: Silence Signal");

  {
    const sampleRate = 16000;
    const silence = generateSilence(1.0, sampleRate); // 1.0 second silence
    const { processor, clientPort, receivedClientMessages } = harness.instantiate(sampleRate, -38);

    // Feed in 128-sample chunks
    const chunkSize = 128;
    for (let i = 0; i < silence.length; i += chunkSize) {
      const slice = silence.subarray(i, i + chunkSize);
      processor.process([[slice]], [[new Float32Array(slice.length)]]);
    }

    clientPort.postMessage({ type: "FINALIZE" });

    // Compare with offline reference
    const offlineFrames: AcousticFrameResult[] = [];
    const windowSamples = Math.round(0.025 * sampleRate);
    const hopSamples = Math.round(0.010 * sampleRate);
    for (let offset = 0; offset + windowSamples <= silence.length; offset += hopSamples) {
      const frameSlice = silence.subarray(offset, offset + windowSamples);
      offlineFrames.push(analyzeAcousticFrame(frameSlice, sampleRate, -38));
    }
    const offlineMetrics = aggregateAcousticMetrics(offlineFrames, sampleRate, 10);

    const finalMsg = receivedClientMessages.find((m) => m.type === "FINAL_METRICS");
    const workletMetrics: LiveAudioMetrics = finalMsg?.metrics;

    assert(
      Boolean(workletMetrics) && workletMetrics.totalFramesCount === offlineMetrics.totalFramesCount,
      "Worklet and offline reference extract identical number of frames from silence",
      `Worklet frames: ${workletMetrics?.totalFramesCount}, Offline frames: ${offlineMetrics.totalFramesCount}`
    );

    assert(
      workletMetrics.voicedFramesCount === 0 && offlineMetrics.voicedFramesCount === 0,
      "Worklet and offline reference agree on 0 voiced frames for silence"
    );

    assert(
      workletMetrics.meanF0Hz === null && offlineMetrics.meanF0Hz === null,
      "Worklet and offline reference both emit null f0 (no fabricated 0 Hz) for silence"
    );

    assert(
      workletMetrics.energyVariance === null && offlineMetrics.energyVariance === null,
      "Worklet and offline reference both emit null energyVariance for silence"
    );

    assert(
      workletMetrics.speechPauseRatio === 1.0 && offlineMetrics.speechPauseRatio === 1.0,
      "Worklet and offline reference agree on 100% pause ratio for silence"
    );
  }

  // --------------------------------------------------------------------------
  // TEST GROUP 3: Voiced Periodic Signal Parity (150 Hz Pure Tone)
  // --------------------------------------------------------------------------
  console.log("\n[GROUP 3] Framing & Numerical Parity: 150 Hz Periodic Voiced Tone");

  {
    const sampleRate = 16000;
    const tone = generateSineWave(150, 1.0, sampleRate, 0.5); // 1.0s of 150 Hz tone
    const { processor, clientPort, receivedClientMessages } = harness.instantiate(sampleRate, -38);

    const chunkSize = 128;
    for (let i = 0; i < tone.length; i += chunkSize) {
      const slice = tone.subarray(i, i + chunkSize);
      processor.process([[slice]], [[new Float32Array(slice.length)]]);
    }

    clientPort.postMessage({ type: "FINALIZE" });

    // Offline reference
    const offlineFrames: AcousticFrameResult[] = [];
    const windowSamples = Math.round(0.025 * sampleRate);
    const hopSamples = Math.round(0.010 * sampleRate);
    for (let offset = 0; offset + windowSamples <= tone.length; offset += hopSamples) {
      const frameSlice = tone.subarray(offset, offset + windowSamples);
      offlineFrames.push(analyzeAcousticFrame(frameSlice, sampleRate, -38));
    }
    const offlineMetrics = aggregateAcousticMetrics(offlineFrames, sampleRate, 10);

    const finalMsg = receivedClientMessages.find((m) => m.type === "FINAL_METRICS");
    const workletMetrics: LiveAudioMetrics = finalMsg?.metrics;

    assert(
      Boolean(workletMetrics) && workletMetrics.voicedFramesCount === offlineMetrics.voicedFramesCount,
      "Worklet voiced frame count matches offline reference exactly for voiced tone",
      `Worklet voiced: ${workletMetrics?.voicedFramesCount}, Offline voiced: ${offlineMetrics.voicedFramesCount}`
    );

    const pitchDelta = Math.abs((workletMetrics?.meanF0Hz ?? 0) - (offlineMetrics.meanF0Hz ?? 0));
    assert(
      pitchDelta <= 0.1,
      "Worklet mean f0 matches offline reference within 0.1 Hz tolerance",
      `Worklet f0: ${workletMetrics?.meanF0Hz} Hz, Offline f0: ${offlineMetrics.meanF0Hz} Hz, delta: ${pitchDelta} Hz`
    );

    const energyVarDelta = Math.abs((workletMetrics?.energyVariance ?? 0) - (offlineMetrics.energyVariance ?? 0));
    assert(
      energyVarDelta <= 0.02,
      "Worklet energy variance matches offline reference within 0.02 tolerance",
      `Worklet: ${workletMetrics?.energyVariance}, Offline: ${offlineMetrics.energyVariance}`
    );

    const pitchVarDelta = Math.abs((workletMetrics?.pitchVariance ?? 0) - (offlineMetrics.pitchVariance ?? 0));
    assert(
      pitchVarDelta <= 0.02,
      "Worklet pitch variance matches offline reference within 0.02 tolerance",
      `Worklet: ${workletMetrics?.pitchVariance}, Offline: ${offlineMetrics.pitchVariance}`
    );
  }

  // --------------------------------------------------------------------------
  // TEST GROUP 4: Speech-Like Input with Pause Dynamics
  // --------------------------------------------------------------------------
  console.log("\n[GROUP 4] Framing & Parity: Conversational Speech Pattern with Pause Dynamics");

  {
    const sampleRate = 16000;
    const speechPattern = generateSpeechLikePattern(sampleRate);
    const { processor, clientPort, receivedClientMessages } = harness.instantiate(sampleRate, -38);

    const chunkSize = 128;
    for (let i = 0; i < speechPattern.length; i += chunkSize) {
      const slice = speechPattern.subarray(i, i + chunkSize);
      processor.process([[slice]], [[new Float32Array(slice.length)]]);
    }

    clientPort.postMessage({ type: "FINALIZE" });

    // Offline reference
    const offlineFrames: AcousticFrameResult[] = [];
    const windowSamples = Math.round(0.025 * sampleRate);
    const hopSamples = Math.round(0.010 * sampleRate);
    for (let offset = 0; offset + windowSamples <= speechPattern.length; offset += hopSamples) {
      const frameSlice = speechPattern.subarray(offset, offset + windowSamples);
      offlineFrames.push(analyzeAcousticFrame(frameSlice, sampleRate, -38));
    }
    const offlineMetrics = aggregateAcousticMetrics(offlineFrames, sampleRate, 10);

    const finalMsg = receivedClientMessages.find((m) => m.type === "FINAL_METRICS");
    const workletMetrics: LiveAudioMetrics = finalMsg?.metrics;

    assert(
      workletMetrics.pauseCount === offlineMetrics.pauseCount,
      "Worklet and offline reference detect identical pause count in speech pattern",
      `Worklet pauseCount: ${workletMetrics?.pauseCount}, Offline pauseCount: ${offlineMetrics.pauseCount}`
    );

    assert(
      workletMetrics.totalPauseDurationMs === offlineMetrics.totalPauseDurationMs,
      "Worklet total pause duration matches offline reference exactly",
      `Worklet: ${workletMetrics?.totalPauseDurationMs}ms, Offline: ${offlineMetrics.totalPauseDurationMs}ms`
    );

    assert(
      Math.abs(workletMetrics.speechPauseRatio - offlineMetrics.speechPauseRatio) <= 0.01,
      "Worklet speech/pause ratio matches offline reference within 0.01",
      `Worklet ratio: ${workletMetrics?.speechPauseRatio}, Offline ratio: ${offlineMetrics.speechPauseRatio}`
    );
  }

  // --------------------------------------------------------------------------
  // TEST GROUP 5: Variable Input Block Sizes (Real-Time Buffer Safety)
  // --------------------------------------------------------------------------
  console.log("\n[GROUP 5] Variable Input Block Sizes (Dynamic Input Length Handling)");

  {
    const sampleRate = 16000;
    const tone = generateSineWave(160, 0.5, sampleRate, 0.4); // 500ms tone

    // Test different block sizes: 64, 128, 256, 512, 1024, and irregular 120 and 250
    const testBlockSizes = [64, 128, 256, 512, 1024, 120, 250];

    for (const blockSize of testBlockSizes) {
      const { processor, clientPort, receivedClientMessages } = harness.instantiate(sampleRate, -38);

      let offset = 0;
      while (offset < tone.length) {
        const end = Math.min(offset + blockSize, tone.length);
        const chunk = tone.subarray(offset, end);
        processor.process([[chunk]], [[new Float32Array(chunk.length)]]);
        offset = end;
      }

      clientPort.postMessage({ type: "FINALIZE" });

      const finalMsg = receivedClientMessages.find((m) => m.type === "FINAL_METRICS");
      const workletMetrics = finalMsg?.metrics;

      assert(
        Boolean(workletMetrics) && workletMetrics.totalFramesCount === 48,
        `Block size ${blockSize} samples produces expected 48 total frames`,
        `Extracted frames: ${workletMetrics?.totalFramesCount}`
      );
    }
  }

  // --------------------------------------------------------------------------
  // TEST GROUP 6: Multi-Sample-Rate Conformance (16 kHz, 44.1 kHz, 48 kHz)
  // --------------------------------------------------------------------------
  console.log("\n[GROUP 6] Dynamic Sample Rate Conformance (16 kHz, 44.1 kHz, 48 kHz)");

  {
    const sampleRates = [16000, 44100, 48000];

    for (const sr of sampleRates) {
      const { processor, clientPort, receivedClientMessages } = harness.instantiate(sr, -38);
      const tone = generateSineWave(150, 0.5, sr, 0.5);

      const readyMsg = receivedClientMessages.find((m) => m.type === "READY");
      const expectedWindow = Math.round(0.025 * sr);
      const expectedHop = Math.round(0.010 * sr);

      assert(
        readyMsg?.windowSamples === expectedWindow && readyMsg?.hopSamples === expectedHop,
        `Sample rate ${sr} Hz initializes window=${expectedWindow} and hop=${expectedHop} samples`,
        `Actual: window=${readyMsg?.windowSamples}, hop=${readyMsg?.hopSamples}`
      );

      // Process in 128-sample blocks
      for (let i = 0; i < tone.length; i += 128) {
        const slice = tone.subarray(i, Math.min(i + 128, tone.length));
        processor.process([[slice]], [[new Float32Array(slice.length)]]);
      }

      clientPort.postMessage({ type: "FINALIZE" });

      const finalMsg = receivedClientMessages.find((m) => m.type === "FINAL_METRICS");
      const pitch = finalMsg?.metrics?.meanF0Hz;

      assert(
        typeof pitch === "number" && Math.abs(pitch - 150) <= 2.0,
        `Sample rate ${sr} Hz extracts accurate pitch (150 Hz tone -> ${pitch} Hz)`
      );
    }
  }

  // --------------------------------------------------------------------------
  // TEST GROUP 7: Sub-Batch Flush on Finalization (< 10 Frames)
  // --------------------------------------------------------------------------
  console.log("\n[GROUP 7] Sub-Batch Telemetry Flush on Finalization (< 10 Frames)");

  {
    const sampleRate = 16000;
    // Exactly 5 frames: 400 window + 4 * 160 hops = 1040 samples
    const shortAudio = generateSineWave(180, 1040 / sampleRate, sampleRate, 0.4);
    const { processor, clientPort, receivedClientMessages } = harness.instantiate(sampleRate, -38);

    // Process chunk
    processor.process([[shortAudio]], [[new Float32Array(shortAudio.length)]]);

    // Since only 5 frames accumulated (< 10 threshold), no FRAME_BATCH should have been dispatched during process()
    const frameBatchesBeforeFinalize = receivedClientMessages.filter((m) => m.type === "FRAME_BATCH");
    assert(
      frameBatchesBeforeFinalize.length === 0,
      "Processor throttles intermediate frames (< 10 frames) to prevent postMessage thrashing"
    );

    // Send FINALIZE
    clientPort.postMessage({ type: "FINALIZE" });

    // Upon FINALIZE, flushRemainingFrames() MUST emit the pending frames before FINAL_METRICS
    const frameBatchesAfterFinalize = receivedClientMessages.filter((m) => m.type === "FRAME_BATCH");
    const finalMetricsMsg = receivedClientMessages.find((m) => m.type === "FINAL_METRICS");

    assert(
      frameBatchesAfterFinalize.length === 1 && frameBatchesAfterFinalize[0].frames.length === 5,
      "FINALIZE flushes sub-batch of 5 remaining frames before final metrics",
      `Flushed frames: ${frameBatchesAfterFinalize[0]?.frames?.length}`
    );

    assert(
      finalMetricsMsg?.totalFrames === 5 && finalMetricsMsg?.metrics?.totalFramesCount === 5,
      "FINAL_METRICS accurately reflects all 5 frames including flushed remainder"
    );
  }

  // --------------------------------------------------------------------------
  // TEST GROUP 8: AcousticDSPAnalyzer Fallback Integration & Lifecycle Safety
  // --------------------------------------------------------------------------
  console.log("\n[GROUP 8] AcousticDSPAnalyzer Fallback Integration & Lifecycle Safety");

  {
    // Test deployment URL resolution
    const originalEnv = process.env.NEXT_PUBLIC_BASE_PATH;
    process.env.NEXT_PUBLIC_BASE_PATH = "/my-subpath";
    assert(
      getAcousticWorkletUrl() === "/my-subpath/worklets/acoustic-dsp-processor.js",
      "getAcousticWorkletUrl() correctly prepends NEXT_PUBLIC_BASE_PATH"
    );
    process.env.NEXT_PUBLIC_BASE_PATH = "/another-path/";
    assert(
      getAcousticWorkletUrl() === "/another-path/worklets/acoustic-dsp-processor.js",
      "getAcousticWorkletUrl() strips trailing slash from NEXT_PUBLIC_BASE_PATH"
    );
    delete process.env.NEXT_PUBLIC_BASE_PATH;
    assert(
      getAcousticWorkletUrl() === "/worklets/acoustic-dsp-processor.js",
      "getAcousticWorkletUrl() defaults to root /worklets/ path when basePath is absent"
    );
    if (originalEnv) process.env.NEXT_PUBLIC_BASE_PATH = originalEnv;

    // Analyzer fallback in environment lacking Web Audio
    const analyzer = new AcousticDSPAnalyzer();
    assert(
      analyzer.isWorkletActive() === false,
      "AcousticDSPAnalyzer starts with isWorkletActive() = false"
    );

    // Verify safe handling of appendSamples when not running
    const testSamples = new Float32Array(500);
    analyzer.appendSamples(testSamples);
    assert(
      analyzer.getFrameResults().length === 1,
      "appendSamples() processes frames directly into local buffer"
    );

    const finalizedMetrics = analyzer.finalize();
    assert(
      typeof finalizedMetrics.durationMs === "number" && finalizedMetrics.totalFramesCount === 1,
      "Synchronous finalize() returns valid LiveAudioMetrics object"
    );

    analyzer.dispose();
    assert(
      analyzer.getFrameResults().length === 0,
      "dispose() clears internal frame results and resets state"
    );
  }

  // --------------------------------------------------------------------------
  // TEST GROUP 9: Synchronous vs Asynchronous Finalization Semantics
  // --------------------------------------------------------------------------
  console.log("\n[GROUP 9] Synchronous vs Asynchronous Finalization Semantics");

  {
    const analyzer = new AcousticDSPAnalyzer();

    // 1. Synchronous finalize() on unstarted or empty analyzer returns safe baseline metrics
    const syncEmpty = analyzer.finalize();
    assert(
      syncEmpty.durationMs === 0 && syncEmpty.voicedFramesCount === 0 && syncEmpty.meanF0Hz === null,
      "Synchronous finalize() on empty analyzer returns valid zeroed baseline metrics without error"
    );

    // 2. Asynchronous finalizeAsync() on fallback pipeline resolves immediately to identical metrics
    const asyncEmpty = await analyzer.finalizeAsync(100);
    assert(
      asyncEmpty.durationMs === 0 && asyncEmpty.totalFramesCount === 0,
      "Asynchronous finalizeAsync() on fallback pipeline resolves with parity to synchronous finalize()"
    );

    // 3. Simulated worklet state: verify that finalize() consumes accumulated frames
    // If frames were streamed via FRAME_BATCH, both finalize() and finalizeAsync() can aggregate them
    const dummyVoicedFrame: AcousticFrameResult = {
      rms: 0.1,
      dbfs: -20,
      isVoiced: true,
      f0Hz: 150,
    };

    // Simulate appending frames directly as if received from FRAME_BATCH
    (analyzer as any).frameResults.push(dummyVoicedFrame, dummyVoicedFrame, dummyVoicedFrame);
    (analyzer as any).sampleRate = 16000;

    const syncWithFrames = analyzer.finalize();
    assert(
      syncWithFrames.totalFramesCount === 3 && syncWithFrames.meanF0Hz === 150,
      "Synchronous finalize() aggregates all frames already received over MessagePort without blocking"
    );

    // 4. finalizeAsync timeout safety: if worklet does not acknowledge in time, REJECTS instead of passing partial telemetry
    (analyzer as any).isUsingWorklet = true;
    (analyzer as any).workletNode = {
      port: {
        postMessage: () => {}, // Intentionally does not reply
        onmessage: null,
      },
      disconnect: () => {},
    };

    const startTime = Date.now();
    let caughtTimeoutError: any = null;
    try {
      await analyzer.finalizeAsync(50);
    } catch (err: any) {
      caughtTimeoutError = err;
    }
    const elapsed = Date.now() - startTime;

    assert(
      elapsed >= 45 && Boolean(caughtTimeoutError) && caughtTimeoutError.message.includes("timed out"),
      "finalizeAsync() rejects cleanly with timeout error rather than presenting incomplete telemetry",
      `Elapsed: ${elapsed}ms, Error: ${caughtTimeoutError?.message}`
    );

    assert(
      (analyzer as any).lastFinalMetrics === null,
      "lastFinalMetrics remains null on timeout rejection, preventing stale partial metrics persistence"
    );

    analyzer.dispose();
  }

  // --------------------------------------------------------------------------
  // TEST GROUP 10: Production Recording-Stop Flow & Frame Completeness
  // --------------------------------------------------------------------------
  console.log("\n[GROUP 10] Production Recording-Stop Flow: finalizeAsync() Frame Completeness");

  {
    const sampleRate = 16000;
    // Exactly 7 frames of voiced tone (less than 10-frame batch threshold)
    // 400 window + 6 * 160 hops = 1360 samples
    const shortUtterance = generateSineWave(180, 1360 / sampleRate, sampleRate, 0.4);

    const { processor, clientPort } = harness.instantiate(sampleRate, -38);

    // Create analyzer and wire its workletNode to the real processor's MessagePort
    const analyzer = new AcousticDSPAnalyzer();
    (analyzer as any).isUsingWorklet = true;
    (analyzer as any).sampleRate = sampleRate;
    (analyzer as any).workletNode = {
      port: clientPort,
      disconnect: () => {},
    };

    // Client wire: incoming messages from worklet update analyzer.frameResults
    clientPort.onmessage = (event) => {
      const data = event.data;
      if (data?.type === "FRAME_BATCH" && Array.isArray(data.frames)) {
        (analyzer as any).frameResults.push(...data.frames);
      }
    };

    // Feed audio into processor rendering thread
    processor.process([[shortUtterance]], [[new Float32Array(shortUtterance.length)]]);

    // Inspect main-thread state prior to finalization:
    // Because 7 < 10, intermediate batch has NOT been dispatched over MessagePort yet
    const unfinalizedMainThreadFrames = analyzer.getFrameResults().length;
    assert(
      unfinalizedMainThreadFrames === 0,
      "Main thread has 0 frames before finalization because 7 frames are below the 10-frame threshold",
      `Main thread frames: ${unfinalizedMainThreadFrames}`
    );

    // Now execute the EXACT recording-stop path used in app/consult/page.tsx:
    // liveAudioMetrics = await acousticAnalyzerRef.current.finalizeAsync();
    const metrics = await analyzer.finalizeAsync(250);

    assert(
      metrics.totalFramesCount === 7,
      "Production recording-stop path (await finalizeAsync) captures all 7 unbatched frames without loss",
      `Expected 7 frames, got: ${metrics.totalFramesCount}`
    );

    assert(
      analyzer.getFrameResults().length === 7,
      "Analyzer local frameResults buffer updated with the 7 flushed remainder frames"
    );

    assert(
      typeof metrics.meanF0Hz === "number" && Math.abs(metrics.meanF0Hz - 180) <= 2.0,
      "Flushed remainder frames compute accurate pitch telemetry (180 Hz)",
      `Mean f0: ${metrics.meanF0Hz} Hz`
    );

    // Idempotent calls: calling finalizeAsync again returns identical cached metrics
    const cachedMetrics = await analyzer.finalizeAsync();
    assert(
      cachedMetrics === metrics,
      "Subsequent calls to finalizeAsync() return the resolved metrics without duplicate IPC"
    );

    analyzer.dispose();
  }

  // --------------------------------------------------------------------------
  // Summary
  // --------------------------------------------------------------------------
  console.log("\n================================================================================");
  console.log(`  ACOUSTIC WORKLET PARITY BATTERY: ${passed} PASSED, ${failed} FAILED`);
  console.log("================================================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runBattery().catch((err) => {
  console.error("Unhandled error running worklet parity battery:", err);
  process.exit(1);
});
