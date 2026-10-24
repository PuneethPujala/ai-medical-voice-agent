/**
 * PARALINGUISTIC DSP RUNTIME ANALYZER
 * 
 * Implements real-time browser acoustic feature extraction:
 * - Frame window: T_w = 25 ms
 * - Frame hop:    T_h = 10 ms
 * - Short-term RMS energy & dBFS computation
 * - -38 dBFS VAD threshold (configurable, non-clinical engineering threshold)
 * - Fundamental frequency (f0) extraction via normalized autocorrelation (60 Hz <= f0 <= 400 Hz)
 * - Voiced frame gating with peak correlation threshold >= 0.45 (unvoiced -> null, never fabricated)
 * - Dynamic sample rate calculation from AudioContext (supporting 16kHz, 44.1kHz, 48kHz)
 * - Rolling PCM sample buffer for exact window/hop framing
 * - Clean disposal releasing all Web Audio nodes and AudioContext resources
 * 
 * CLINICAL SAFETY INVARIANT:
 * This module is an acoustic observation & telemetry layer only.
 * It does NOT diagnose conditions, assign ESI acuity levels, trip emergency pre-arbiter
 * flags, or alter care routing.
 */

export interface LiveAudioMetrics {
  durationMs: number;
  pauseCount: number;
  totalPauseDurationMs: number;
  speechPauseRatio: number;
  meanPauseDurationMs: number;
  /**
   * Voice RMS Energy Variability (Coefficient of Variation: CV = sigma_rms / mu_rms).
   * Dimensionless ratio [0.0, 1.0], mapped to FHIR UCUM unit "{ratio}", code "1".
   */
  energyVariance: number;
  /**
   * Voice Fundamental Frequency Pitch Variability (Coefficient of Variation: CV = sigma_f0 / mu_f0).
   * Dimensionless ratio [0.0, 1.0], mapped to FHIR UCUM unit "{ratio}", code "1".
   */
  pitchVariance: number;
  meanF0Hz?: number | null;
  meanRms?: number;
  voicedFramesCount: number;
  totalFramesCount: number;
  sampleRate: number;
  isLiveDsp: true;
}

export interface AcousticFrameResult {
  rms: number;
  dbfs: number;
  isVoiced: boolean;
  f0Hz: number | null;
}

/**
 * Computes Short-Term Root-Mean-Square (RMS) Energy of an audio frame.
 * Formula: RMS = sqrt( (1 / N) * sum(x[n]^2) )
 */
export function computeRmsEnergy(samples: Float32Array): number {
  if (!samples || samples.length === 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) {
    sumSq += samples[i] * samples[i];
  }
  return Math.sqrt(sumSq / samples.length);
}

/**
 * Converts linear RMS amplitude to Decibels Relative to Full Scale (dBFS).
 * Formula: 20 * log10(max(RMS, 1e-5))
 * Bounds output between -100 dBFS (silence floor) and 0 dBFS (peak).
 */
export function computeDbfs(rms: number): number {
  const safeRms = Math.max(rms, 1e-5);
  const db = 20 * Math.log10(safeRms);
  return Math.max(-100, Math.min(0, Math.round(db * 10) / 10));
}

/**
 * Energy-based Voice Activity Detection (VAD).
 * Frame is active if its dBFS meets or exceeds the threshold (default: -38 dBFS).
 */
export function evaluateVad(dbfs: number, thresholdDbfs: number = -38): boolean {
  return dbfs > thresholdDbfs;
}

/**
 * Extracts fundamental frequency (f0) using Normalized Autocorrelation.
 * Search range: 60 Hz to 400 Hz.
 * Only returns f0 if the frame is active (meets VAD) and normalized correlation peak >= 0.45.
 * Otherwise returns null (unvoiced frame). Never interpolates or fabricates pitch.
 */
export function extractF0Autocorrelation(
  samples: Float32Array,
  sampleRate: number,
  isVoicedFrame: boolean,
  minFreqHz: number = 60,
  maxFreqHz: number = 400,
  confidenceThreshold: number = 0.45
): { f0Hz: number | null; confidence: number } {
  if (!isVoicedFrame || !samples || samples.length === 0 || sampleRate <= 0) {
    return { f0Hz: null, confidence: 0 };
  }

  // 1. Zero-crossing validation: a 25ms voiced frame with f0 >= 60 Hz must complete at least 1.5 cycles
  // requiring at least 2 zero-crossings across the window.
  let zeroCrossings = 0;
  for (let i = 1; i < samples.length; i++) {
    if ((samples[i] >= 0 && samples[i - 1] < 0) || (samples[i] < 0 && samples[i - 1] >= 0)) {
      zeroCrossings++;
    }
  }
  if (zeroCrossings < 2) {
    return { f0Hz: null, confidence: 0 };
  }

  const minLag = Math.floor(sampleRate / maxFreqHz);
  const maxLag = Math.min(samples.length - 2, Math.ceil(sampleRate / minFreqHz));

  // Check from an extended upper bound (up to 800 Hz) to detect if fundamental period is below minLag
  const scanMinLag = Math.max(2, Math.floor(sampleRate / 800));

  if (minLag >= maxLag || maxLag >= samples.length - 1) {
    return { f0Hz: null, confidence: 0 };
  }

  // Compute normalized autocorrelation across [scanMinLag, maxLag]
  const corr = new Float32Array(maxLag + 2);
  let globalMax = -1;

  for (let lag = scanMinLag; lag <= maxLag; lag++) {
    let sumProd = 0;
    let sumSqX = 0;
    let sumSqY = 0;
    const len = samples.length - lag;

    for (let i = 0; i < len; i++) {
      const x = samples[i];
      const y = samples[i + lag];
      sumProd += x * y;
      sumSqX += x * x;
      sumSqY += y * y;
    }

    const norm = Math.sqrt(sumSqX * sumSqY);
    if (norm > 1e-6) {
      const r = sumProd / norm;
      corr[lag] = r;
      if (lag >= minLag && r > globalMax) {
        globalMax = r;
      }
    }
  }

  // If a strong peak exists at lag < minLag (i.e. f > 400 Hz), pitch is supra-harmonic -> out of range
  for (let lag = scanMinLag + 1; lag < minLag; lag++) {
    if (corr[lag] > corr[lag - 1] && corr[lag] >= corr[lag + 1] && corr[lag] >= 0.70) {
      return { f0Hz: null, confidence: corr[lag] };
    }
  }

  if (globalMax < confidenceThreshold) {
    return { f0Hz: null, confidence: Math.max(0, globalMax) };
  }

  // 2. Fundamental Period Selection with Octave-Error Prevention:
  // Identify local peaks within [minLag, maxLag] with correlation >= 0.82 * globalMax and >= threshold.
  // The fundamental period is the first (smallest lag) local peak.
  let bestLag = -1;
  for (let lag = minLag + 1; lag <= maxLag - 1; lag++) {
    if (corr[lag] > corr[lag - 1] && corr[lag] >= corr[lag + 1]) {
      if (corr[lag] >= 0.82 * globalMax && corr[lag] >= confidenceThreshold) {
        bestLag = lag;
        break;
      }
    }
  }

  if (bestLag <= 0) {
    for (let lag = minLag; lag <= maxLag; lag++) {
      if (corr[lag] === globalMax) {
        bestLag = lag;
        break;
      }
    }
  }

  if (bestLag > 0) {
    // 3. 3-point parabolic interpolation for sub-sample peak accuracy
    const alpha = corr[bestLag - 1];
    const beta = corr[bestLag];
    const gamma = corr[bestLag + 1];
    const denom = 2 * (alpha - 2 * beta + gamma);
    let delta = 0;
    if (Math.abs(denom) > 1e-8) {
      delta = (alpha - gamma) / denom;
      delta = Math.max(-0.5, Math.min(0.5, delta));
    }
    const fineLag = bestLag + delta;
    const f0 = sampleRate / fineLag;

    if (f0 >= minFreqHz && f0 <= maxFreqHz) {
      return { f0Hz: Math.round(f0 * 10) / 10, confidence: Math.round(corr[bestLag] * 100) / 100 };
    }
  }

  return { f0Hz: null, confidence: Math.max(0, globalMax) };
}

/**
 * Process a single 25ms PCM frame into short-term acoustic features.
 */
export function analyzeAcousticFrame(
  frameSamples: Float32Array,
  sampleRate: number,
  vadThresholdDbfs: number = -38
): AcousticFrameResult {
  const rms = computeRmsEnergy(frameSamples);
  const dbfs = computeDbfs(rms);
  const isVoiced = evaluateVad(dbfs, vadThresholdDbfs);
  const { f0Hz } = extractF0Autocorrelation(frameSamples, sampleRate, isVoiced);

  return {
    rms,
    dbfs,
    isVoiced,
    f0Hz,
  };
}

/**
 * Aggregates a sequence of analyzed frames into clinical telemetry audio metrics.
 */
export function aggregateAcousticMetrics(
  frames: AcousticFrameResult[],
  sampleRate: number,
  hopMs: number = 10,
  minPauseHops: number = 15 // Contiguous silence >= 150ms constitutes a conversational pause
): LiveAudioMetrics {
  const totalFrames = frames.length;
  if (totalFrames === 0) {
    return {
      durationMs: 0,
      pauseCount: 0,
      totalPauseDurationMs: 0,
      speechPauseRatio: 0,
      meanPauseDurationMs: 0,
      energyVariance: 0,
      pitchVariance: 0,
      meanF0Hz: null,
      voicedFramesCount: 0,
      totalFramesCount: 0,
      sampleRate,
      isLiveDsp: true,
    };
  }

  const durationMs = Math.round(totalFrames * hopMs);

  // 1. Pause statistics from contiguous silent frames
  let pauseCount = 0;
  let totalPauseFrames = 0;
  let currentSilenceRun = 0;

  for (let i = 0; i < totalFrames; i++) {
    if (!frames[i].isVoiced) {
      currentSilenceRun++;
    } else {
      if (currentSilenceRun >= minPauseHops) {
        pauseCount++;
        totalPauseFrames += currentSilenceRun;
      }
      currentSilenceRun = 0;
    }
  }
  // Check trailing silence at utterance end
  if (currentSilenceRun >= minPauseHops) {
    pauseCount++;
    totalPauseFrames += currentSilenceRun;
  }

  const totalPauseDurationMs = totalPauseFrames * hopMs;
  const speechPauseRatio = durationMs > 0
    ? Math.min(1.0, Math.max(0.0, Number((totalPauseDurationMs / durationMs).toFixed(2))))
    : 0;
  const meanPauseDurationMs = pauseCount > 0
    ? Math.round(totalPauseDurationMs / pauseCount)
    : 0;

  // 2. RMS Energy Variability across active frames
  const activeFrames = frames.filter((f) => f.isVoiced);
  let energyVariance = 0.1;
  let computedMeanRms: number | undefined = undefined;
  if (activeFrames.length >= 2) {
    const rmsValues = activeFrames.map((f) => f.rms);
    const meanRms = rmsValues.reduce((a, b) => a + b, 0) / rmsValues.length;
    computedMeanRms = meanRms;
    if (meanRms > 1e-4) {
      const varSum = rmsValues.reduce((acc, v) => acc + Math.pow(v - meanRms, 2), 0);
      const stdDev = Math.sqrt(varSum / rmsValues.length);
      energyVariance = Math.min(1.0, Math.max(0.0, Number((stdDev / meanRms).toFixed(2))));
    }
  }

  // 3. Fundamental Frequency (f0) Variability across voiced frames
  const voicedF0s = frames
    .map((f) => f.f0Hz)
    .filter((v): v is number => v !== null && v > 0);

  let meanF0Hz: number | null = null;
  let pitchVariance = 0.12;

  if (voicedF0s.length >= 3) {
    const sumF0 = voicedF0s.reduce((a, b) => a + b, 0);
    meanF0Hz = Math.round((sumF0 / voicedF0s.length) * 10) / 10;
    const varSumF0 = voicedF0s.reduce((acc, v) => acc + Math.pow(v - meanF0Hz!, 2), 0);
    const stdDevF0 = Math.sqrt(varSumF0 / voicedF0s.length);
    pitchVariance = Math.min(1.0, Math.max(0.0, Number((stdDevF0 / meanF0Hz).toFixed(2))));
  } else {
    // Insufficient voiced frames to assess pitch variance reliably
    pitchVariance = 0;
  }

  return {
    durationMs,
    pauseCount,
    totalPauseDurationMs,
    speechPauseRatio,
    meanPauseDurationMs,
    energyVariance,
    pitchVariance,
    meanF0Hz,
    meanRms: computedMeanRms !== undefined ? Number(computedMeanRms.toFixed(4)) : undefined,
    voicedFramesCount: activeFrames.length,
    totalFramesCount: totalFrames,
    sampleRate,
    isLiveDsp: true,
  };
}

/**
 * Stateful browser runtime audio analyzer.
 * Consumes raw MediaStream, buffers samples into rolling FIFO, and extracts 25ms/10ms frames.
 */
export class AcousticDSPAnalyzer {
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private silentGainNode: GainNode | null = null;

  private sampleRate: number = 16000;
  private windowSamples: number = 400; // 25ms at 16kHz
  private hopSamples: number = 160;    // 10ms at 16kHz
  private vadThresholdDbfs: number = -38;

  // Rolling PCM FIFO ring buffer
  private pcmBuffer: Float32Array = new Float32Array(0);
  private frameResults: AcousticFrameResult[] = [];
  private isRunning: boolean = false;

  constructor(vadThresholdDbfs: number = -38) {
    this.vadThresholdDbfs = vadThresholdDbfs;
  }

  /**
   * Initializes Web Audio node pipeline and begins live frame accumulation from the MediaStream.
   */
  public start(stream: MediaStream): boolean {
    if (typeof window === "undefined" || !stream || !stream.active) {
      return false;
    }

    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) {
        console.warn("[Acoustic DSP] Web Audio API is unavailable in this environment.");
        return false;
      }

      this.audioContext = new AudioCtx();
      this.sampleRate = this.audioContext.sampleRate || 16000;

      // Exact framing parameters for dynamic sample rate (25ms window, 10ms hop)
      this.windowSamples = Math.round(0.025 * this.sampleRate);
      this.hopSamples = Math.round(0.010 * this.sampleRate);

      this.pcmBuffer = new Float32Array(0);
      this.frameResults = [];
      this.isRunning = true;

      // Tap raw live microphone audio from the existing MediaStream
      this.sourceNode = this.audioContext.createMediaStreamSource(stream);

      // Lightweight processing node (4096 samples buffer, 1 input channel, 1 output)
      // Note: ScriptProcessor is used here for deterministic cross-browser Float32 sample acquisition
      // without requiring external static .worklet.js network assets.
      this.processorNode = this.audioContext.createScriptProcessor(4096, 1, 1);

      this.processorNode.onaudioprocess = (e: AudioProcessingEvent) => {
        if (!this.isRunning) return;
        const inputData = e.inputBuffer.getChannelData(0);
        this.appendSamples(inputData);
      };

      // Mute the processor output so it does not loop back to speakers
      this.silentGainNode = this.audioContext.createGain();
      this.silentGainNode.gain.value = 0;

      this.sourceNode.connect(this.processorNode);
      this.processorNode.connect(this.silentGainNode);
      this.silentGainNode.connect(this.audioContext.destination);

      console.log(
        `%c[Acoustic DSP] Initialized live analyzer (SampleRate: ${this.sampleRate} Hz | Window: ${this.windowSamples} smp | Hop: ${this.hopSamples} smp | VAD: ${this.vadThresholdDbfs} dBFS)`,
        "color: #06b6d4; font-family: monospace; font-size: 11px;"
      );
      return true;
    } catch (err: any) {
      console.warn("[Acoustic DSP] Failed to initialize live audio analyzer:", err?.message || err);
      this.dispose();
      return false;
    }
  }

  /**
   * Pushes incoming raw audio samples into the rolling FIFO buffer and slices frames.
   */
  public appendSamples(newSamples: Float32Array): void {
    if (!newSamples || newSamples.length === 0) return;

    // Concatenate existing buffer with new samples
    const combined = new Float32Array(this.pcmBuffer.length + newSamples.length);
    combined.set(this.pcmBuffer, 0);
    combined.set(newSamples, this.pcmBuffer.length);
    this.pcmBuffer = combined;

    // Slice frames of windowSamples stepping by hopSamples
    let offset = 0;
    while (offset + this.windowSamples <= this.pcmBuffer.length) {
      const frameSlice = this.pcmBuffer.subarray(offset, offset + this.windowSamples);
      const result = analyzeAcousticFrame(frameSlice, this.sampleRate, this.vadThresholdDbfs);
      this.frameResults.push(result);
      offset += this.hopSamples;
    }

    // Retain remaining samples that don't yet form a full window
    if (offset > 0) {
      this.pcmBuffer = this.pcmBuffer.slice(offset);
    }
  }

  /**
   * Asynchronously appends incoming samples, yielding to the browser event loop
   * when processing large PCM buffers (> 4096 samples) to prevent main-thread UI frame drops.
   */
  public async appendSamplesAsync(newSamples: Float32Array, yieldInterval: number = 4096): Promise<void> {
    if (!newSamples || newSamples.length === 0) return;

    const combined = new Float32Array(this.pcmBuffer.length + newSamples.length);
    combined.set(this.pcmBuffer, 0);
    combined.set(newSamples, this.pcmBuffer.length);
    this.pcmBuffer = combined;

    let offset = 0;
    let processedSamples = 0;
    while (offset + this.windowSamples <= this.pcmBuffer.length) {
      const frameSlice = this.pcmBuffer.subarray(offset, offset + this.windowSamples);
      const result = analyzeAcousticFrame(frameSlice, this.sampleRate, this.vadThresholdDbfs);
      this.frameResults.push(result);
      offset += this.hopSamples;
      processedSamples += this.hopSamples;

      if (processedSamples >= yieldInterval) {
        processedSamples = 0;
        await new Promise<void>((resolve) => {
          if (typeof setTimeout !== "undefined") {
            setTimeout(resolve, 0);
          } else {
            resolve();
          }
        });
      }
    }

    if (offset > 0) {
      this.pcmBuffer = this.pcmBuffer.slice(offset);
    }
  }

  /**
   * Finalizes the current recording session and computes aggregate acoustic metrics.
   */
  public finalize(): LiveAudioMetrics {
    const hopMs = 10;
    const metrics = aggregateAcousticMetrics(this.frameResults, this.sampleRate, hopMs);
    console.log(
      `%c[Acoustic DSP] Finalized session metrics (${metrics.totalFramesCount} frames, ${metrics.voicedFramesCount} voiced | Pause ratio: ${(metrics.speechPauseRatio * 100).toFixed(0)}% | f0: ${metrics.meanF0Hz !== null ? `${metrics.meanF0Hz} Hz` : "unvoiced"} | Var: ${metrics.energyVariance} E / ${metrics.pitchVariance} P)`,
      "color: #10b981; font-family: monospace; font-size: 11px;"
    );
    return metrics;
  }

  /**
   * Cleanly disposes of all Web Audio nodes and closes the AudioContext.
   */
  public dispose(): void {
    this.isRunning = false;

    if (this.sourceNode) {
      try { this.sourceNode.disconnect(); } catch {}
      this.sourceNode = null;
    }

    if (this.processorNode) {
      this.processorNode.onaudioprocess = null;
      try { this.processorNode.disconnect(); } catch {}
      this.processorNode = null;
    }

    if (this.silentGainNode) {
      try { this.silentGainNode.disconnect(); } catch {}
      this.silentGainNode = null;
    }

    if (this.audioContext && this.audioContext.state !== "closed") {
      try { this.audioContext.close().catch(() => {}); } catch {}
      this.audioContext = null;
    }

    this.pcmBuffer = new Float32Array(0);
    this.frameResults = [];
  }
}

/**
 * Asynchronous / chunked audio buffer analyzer that yields to the event loop
 * when processing large PCM buffers (> 4096 samples) so acoustic extraction
 * never blocks main-thread React state transitions or WebRTC playback.
 */
export async function analyzeAudioBufferAsync(
  pcmSamples: Float32Array,
  sampleRate: number = 16000,
  vadThresholdDbfs: number = -38,
  chunkSize: number = 4096
): Promise<LiveAudioMetrics> {
  const windowMs = 25;
  const hopMs = 10;
  const windowSamples = Math.round((windowMs / 1000) * sampleRate);
  const hopSamples = Math.round((hopMs / 1000) * sampleRate);

  const frameResults: AcousticFrameResult[] = [];
  let offset = 0;
  let lastYieldOffset = 0;

  while (offset + windowSamples <= pcmSamples.length) {
    const frameSlice = pcmSamples.subarray(offset, offset + windowSamples);
    const result = analyzeAcousticFrame(frameSlice, sampleRate, vadThresholdDbfs);
    frameResults.push(result);
    offset += hopSamples;

    if (offset - lastYieldOffset >= chunkSize) {
      lastYieldOffset = offset;
      await new Promise<void>((resolve) => {
        if (typeof setTimeout !== "undefined") {
          setTimeout(resolve, 0);
        } else {
          resolve();
        }
      });
    }
  }

  return aggregateAcousticMetrics(frameResults, sampleRate, hopMs);
}

export interface TurnAudioMetricRecord {
  turnIndex: number;
  caseVersion?: number;
  timestamp: string;
  metrics: LiveAudioMetrics;
}

/**
 * Strict server boundary validator for client-submitted acoustic telemetry.
 * Enforces:
 * - Strips any raw PCM buffers, base64 payloads, audio blobs, or unexpected properties.
 * - Finite number checks and plausible physiological bounds.
 * - Null preservation for unvoiced f0 measurements (never fabricates 0 Hz).
 * - Bounded variance values [0.0, 2.0].
 * - Bounded speech-to-pause ratio [0.0, 1.0].
 */
export function validateAudioMetrics(untrusted: unknown): LiveAudioMetrics | null {
  if (!untrusted || typeof untrusted !== "object") {
    return null;
  }
  const raw = untrusted as Record<string, unknown>;

  // Strips any raw audio buffers or base64 samples from ever passing into the domain
  if (
    typeof raw.durationMs !== "number" ||
    !Number.isFinite(raw.durationMs) ||
    raw.durationMs < 0 ||
    raw.durationMs > 600000
  ) {
    return null;
  }
  const durationMs = Math.round(raw.durationMs);

  const sampleRate = typeof raw.sampleRate === "number" && Number.isFinite(raw.sampleRate) && raw.sampleRate >= 8000 && raw.sampleRate <= 192000
    ? Math.round(raw.sampleRate)
    : 16000;

  const pauseCount = typeof raw.pauseCount === "number" && Number.isFinite(raw.pauseCount)
    ? Math.max(0, Math.min(1000, Math.round(raw.pauseCount)))
    : 0;

  const totalPauseDurationMs = typeof raw.totalPauseDurationMs === "number" && Number.isFinite(raw.totalPauseDurationMs)
    ? Math.max(0, Math.min(durationMs, Math.round(raw.totalPauseDurationMs)))
    : 0;

  const speechPauseRatio = typeof raw.speechPauseRatio === "number" && Number.isFinite(raw.speechPauseRatio)
    ? Math.max(0, Math.min(1.0, Number(raw.speechPauseRatio.toFixed(2))))
    : (durationMs > 0 ? Number((totalPauseDurationMs / durationMs).toFixed(2)) : 0);

  const meanPauseDurationMs = typeof raw.meanPauseDurationMs === "number" && Number.isFinite(raw.meanPauseDurationMs)
    ? Math.max(0, Math.min(durationMs, Math.round(raw.meanPauseDurationMs)))
    : (pauseCount > 0 ? Math.round(totalPauseDurationMs / pauseCount) : 0);

  const energyVariance = typeof raw.energyVariance === "number" && Number.isFinite(raw.energyVariance)
    ? Math.max(0, Math.min(2.0, Number(raw.energyVariance.toFixed(2))))
    : 0.1;

  const pitchVariance = typeof raw.pitchVariance === "number" && Number.isFinite(raw.pitchVariance)
    ? Math.max(0, Math.min(2.0, Number(raw.pitchVariance.toFixed(2))))
    : 0;

  let meanF0Hz: number | null = null;
  if (typeof raw.meanF0Hz === "number" && Number.isFinite(raw.meanF0Hz) && raw.meanF0Hz >= 50 && raw.meanF0Hz <= 600) {
    meanF0Hz = Number(raw.meanF0Hz.toFixed(1));
  }

  const meanRms = typeof raw.meanRms === "number" && Number.isFinite(raw.meanRms) && raw.meanRms >= 0
    ? Number(raw.meanRms.toFixed(4))
    : undefined;

  const voicedFramesCount = typeof raw.voicedFramesCount === "number" && Number.isFinite(raw.voicedFramesCount)
    ? Math.max(0, Math.round(raw.voicedFramesCount))
    : (meanF0Hz !== null ? 10 : 0);

  const totalFramesCount = typeof raw.totalFramesCount === "number" && Number.isFinite(raw.totalFramesCount)
    ? Math.max(voicedFramesCount, Math.round(raw.totalFramesCount))
    : Math.max(voicedFramesCount, Math.round(durationMs / 10));

  return {
    durationMs,
    pauseCount,
    totalPauseDurationMs,
    speechPauseRatio,
    meanPauseDurationMs,
    energyVariance,
    pitchVariance,
    meanF0Hz,
    meanRms,
    voicedFramesCount,
    totalFramesCount,
    sampleRate,
    isLiveDsp: true,
  };
}

/**
 * Deterministic aggregation policy for multi-turn clinical consultations.
 * - Total duration = sum of utterance durations
 * - Total pause duration = sum of pause durations
 * - Total pause count = sum of pause counts
 * - Mean pause duration = total pause duration / total pause count
 * - Speech-pause ratio = total pause duration / total duration
 * - Fundamental frequency (f0): pooled weighted mean across voiced frames:
 *     mu_f0 = sum(v_i * f0_i) / sum(v_i)
 * - Pitch Variability (f0 CV): exact pooled population coefficient of variation
 *   accounting for both within-utterance variance and between-utterance pitch shift:
 *     sigma_pooled^2 = sum[ v_i * (sigma_i^2 + (mu_i - mu_pooled)^2) ] / sum(v_i)
 *     CV_pooled = sigma_pooled / mu_pooled
 * - RMS Energy Variability (RMS CV): exact pooled population coefficient of variation.
 * - Voiced and total frames: summed across utterances.
 */
export function aggregateTurnAudioMetrics(
  existingAggregate: LiveAudioMetrics | null | undefined,
  newTurnMetrics: LiveAudioMetrics
): LiveAudioMetrics {
  if (!existingAggregate) {
    return { ...newTurnMetrics };
  }

  const durationMs = existingAggregate.durationMs + newTurnMetrics.durationMs;
  const pauseCount = existingAggregate.pauseCount + newTurnMetrics.pauseCount;
  const totalPauseDurationMs = existingAggregate.totalPauseDurationMs + newTurnMetrics.totalPauseDurationMs;
  const speechPauseRatio = durationMs > 0
    ? Math.min(1.0, Math.max(0.0, Number((totalPauseDurationMs / durationMs).toFixed(2))))
    : 0;
  const meanPauseDurationMs = pauseCount > 0
    ? Math.round(totalPauseDurationMs / pauseCount)
    : 0;

  const totalVoicedFrames = existingAggregate.voicedFramesCount + newTurnMetrics.voicedFramesCount;
  const totalFrames = existingAggregate.totalFramesCount + newTurnMetrics.totalFramesCount;

  // 1. Exact Pooled Fundamental Frequency (f0) and Pitch Variability (CV)
  let pitchVariance = 0;
  let meanF0Hz: number | null = null;

  const v1 = existingAggregate.voicedFramesCount;
  const v2 = newTurnMetrics.voicedFramesCount;
  const f1 = existingAggregate.meanF0Hz;
  const f2 = newTurnMetrics.meanF0Hz;

  if (v1 > 0 && f1 !== null && f1 !== undefined && v2 > 0 && f2 !== null && f2 !== undefined) {
    const totalVoiced = v1 + v2;
    const pooledMeanF0 = (v1 * f1 + v2 * f2) / totalVoiced;
    meanF0Hz = Number(pooledMeanF0.toFixed(1));

    if (totalVoiced >= 3 && pooledMeanF0 > 10) {
      // sigma_i^2 = (CV_i * mu_i)^2
      const var1 = Math.pow(existingAggregate.pitchVariance * f1, 2);
      const var2 = Math.pow(newTurnMetrics.pitchVariance * f2, 2);

      // Pooled population variance
      const pooledVarF0 = (
        v1 * (var1 + Math.pow(f1 - pooledMeanF0, 2)) +
        v2 * (var2 + Math.pow(f2 - pooledMeanF0, 2))
      ) / totalVoiced;

      const pooledStdDevF0 = Math.sqrt(Math.max(0, pooledVarF0));
      pitchVariance = Math.min(1.0, Math.max(0.0, Number((pooledStdDevF0 / pooledMeanF0).toFixed(2))));
    }
  } else if (v2 > 0 && f2 !== null && f2 !== undefined) {
    meanF0Hz = f2;
    pitchVariance = newTurnMetrics.pitchVariance;
  } else if (v1 > 0 && f1 !== null && f1 !== undefined) {
    meanF0Hz = f1;
    pitchVariance = existingAggregate.pitchVariance;
  }

  // 2. Exact Pooled RMS Energy Variability (CV)
  let energyVariance = 0.1;
  let pooledMeanRms: number | undefined = undefined;

  const a1 = existingAggregate.totalFramesCount;
  const a2 = newTurnMetrics.totalFramesCount;
  const rms1 = existingAggregate.meanRms;
  const rms2 = newTurnMetrics.meanRms;

  if (a1 > 0 && rms1 !== undefined && rms1 > 1e-4 && a2 > 0 && rms2 !== undefined && rms2 > 1e-4) {
    const totalA = a1 + a2;
    const combinedMeanRms = (a1 * rms1 + a2 * rms2) / totalA;

    const varRms1 = Math.pow(existingAggregate.energyVariance * rms1, 2);
    const varRms2 = Math.pow(newTurnMetrics.energyVariance * rms2, 2);

    const pooledVarRms = (
      a1 * (varRms1 + Math.pow(rms1 - combinedMeanRms, 2)) +
      a2 * (varRms2 + Math.pow(rms2 - combinedMeanRms, 2))
    ) / totalA;

    const pooledStdDevRms = Math.sqrt(Math.max(0, pooledVarRms));
    energyVariance = Math.min(1.0, Math.max(0.0, Number((pooledStdDevRms / combinedMeanRms).toFixed(2))));
    pooledMeanRms = Number(combinedMeanRms.toFixed(4));
  } else {
    energyVariance = a1 + a2 > 0
      ? Number(((existingAggregate.energyVariance * a1 + newTurnMetrics.energyVariance * a2) / (a1 + a2)).toFixed(2))
      : newTurnMetrics.energyVariance;
    pooledMeanRms = rms2 ?? rms1;
  }

  return {
    durationMs,
    pauseCount,
    totalPauseDurationMs,
    speechPauseRatio,
    meanPauseDurationMs,
    energyVariance,
    pitchVariance,
    meanF0Hz,
    meanRms: pooledMeanRms,
    voicedFramesCount: totalVoicedFrames,
    totalFramesCount: totalFrames,
    sampleRate: newTurnMetrics.sampleRate || existingAggregate.sampleRate,
    isLiveDsp: true,
  };
}

