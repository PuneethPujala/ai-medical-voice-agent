import { SpeechFeatures } from "../agents/schemas";

export interface RawAudioAnalysisInput {
  durationMs?: number;
  pauseCount?: number;
  totalPauseDurationMs?: number;
  wordCount?: number;
  energyVariance?: number | null;
  pitchVariance?: number | null;
  meanF0Hz?: number | null;
  speechPauseRatio?: number;
  meanPauseDurationMs?: number;
  isLiveDsp?: boolean;
  transcriptText?: string;
}

/**
 * PARALINGUISTIC & SPEECH FEATURE EXTRACTION ENGINE
 * 
 * Invariant: Audio features are measured physiological signals and observed speech characteristics;
 * they are treated as supporting evidence, NOT standalone autonomous diagnostic authorities.
 * 
 * Pipeline: Audio Telemetry -> Measured Features -> Observed Speech Characteristics -> Possible Signal
 */
export function extractSpeechFeatures(input: RawAudioAnalysisInput): SpeechFeatures {
  const text = (input.transcriptText || "").trim();
  const wordCount = input.wordCount || (text ? text.split(/\s+/).length : 0);

  // 1. Measured Features: Strictly use observed physical acoustic measurements
  // If actual audio duration is absent, do NOT synthesize a measured duration from word count
  const hasMeasuredDuration = typeof input.durationMs === "number" && input.durationMs > 0;
  const durationMs = hasMeasuredDuration ? input.durationMs! : undefined;

  const pauseCount = typeof input.pauseCount === "number" ? input.pauseCount : undefined;
  const totalPauseDurationMs = typeof input.totalPauseDurationMs === "number" ? input.totalPauseDurationMs : undefined;

  // Speech-pause ratio and mean pause duration are computed ONLY from real acoustic telemetry
  const speech_pause_ratio = (typeof input.speechPauseRatio === "number")
    ? input.speechPauseRatio
    : (hasMeasuredDuration && totalPauseDurationMs !== undefined && durationMs! > 0
        ? Math.min(1.0, Math.max(0.0, Number((totalPauseDurationMs / durationMs!).toFixed(2))))
        : null);

  const mean_pause_duration_ms = (typeof input.meanPauseDurationMs === "number")
    ? input.meanPauseDurationMs
    : (pauseCount !== undefined && pauseCount > 0 && totalPauseDurationMs !== undefined
        ? Math.round(totalPauseDurationMs / pauseCount)
        : null);

  // Measured Speech Rate (WPM): Requires both word count and actual measured acoustic audio duration
  let speech_rate_wpm: number | null = null;
  if (hasMeasuredDuration && durationMs! > 0 && wordCount > 0) {
    const minutes = durationMs! / 60000;
    speech_rate_wpm = minutes > 0 ? Math.round(wordCount / minutes) : null;
  }

  // Default dialogue pacing rate for downstream TTS / conversational turn pacing when audio telemetry is absent.
  // Explicitly labeled as dialogue pacing configuration, NOT a measurement or estimate of the patient's speech.
  let dialogue_pacing_wpm: number | undefined = undefined;
  if (!hasMeasuredDuration) {
    dialogue_pacing_wpm = 130;
  }

  // Variabilities: Do NOT invent fallback numbers (0.14 or 0.16) when measurements are missing
  const voice_energy_variability = (input.energyVariance !== undefined && input.energyVariance !== null)
    ? Number(input.energyVariance.toFixed(2))
    : null;
  const pitch_variability = (input.pitchVariance !== undefined && input.pitchVariance !== null)
    ? Number(input.pitchVariance.toFixed(2))
    : null;

  // 2. Observed Speech Characteristics
  const observations: string[] = [];

  if (speech_pause_ratio !== null && speech_pause_ratio > 0.35) {
    observations.push("Frequent conversational pauses with elevated pause-to-speech ratio");
  }
  if (mean_pause_duration_ms !== null && mean_pause_duration_ms > 750) {
    observations.push("Prolonged inter-phrase latency / pauses exceeding 750ms");
  }
  if (speech_rate_wpm !== null && speech_rate_wpm < 85) {
    observations.push("Substantially reduced speech rate (< 85 WPM)");
  } else if (speech_rate_wpm !== null && speech_rate_wpm > 180) {
    observations.push("Rapid, pressured speech cadence (> 180 WPM)");
  }
  if ((voice_energy_variability !== null && voice_energy_variability > 0.30) || (pitch_variability !== null && pitch_variability > 0.30)) {
    observations.push("Acoustic energy volatility and pitch instability noted");
  }
  if (input.meanF0Hz && input.meanF0Hz > 0) {
    observations.push(`Mean fundamental frequency observed: ${input.meanF0Hz} Hz`);
  }

  // Check text indicators of respiratory pauses
  const hasGaspingWords = /\b(gasp|pant|cannot\s+breathe|hard\s+to\s+breathe|out\s+of\s+breath)\b/i.test(text);
  if (hasGaspingWords) {
    observations.push("Patient explicitly references respiratory difficulty");
  }

  // 3. Clinical Relevance Signal (Carefully bounded, not overclaimed)
  // SAFETY INVARIANT: Live acoustic DSP must NEVER derive "severe" respiratory distress or trigger emergency
  // escalation. Live DSP is strictly an observational telemetry layer.
  let respiratory_distress_signal: "unlikely" | "possible" | "probable" | "severe" = "unlikely";
  let vocal_instability_signal: "none" | "mild" | "pronounced" = "none";
  let confidence = 0.55;

  const effectivePauseRatio = speech_pause_ratio ?? 0;

  if (hasGaspingWords && effectivePauseRatio > 0.45 && !input.isLiveDsp) {
    respiratory_distress_signal = "severe";
    confidence = 0.88;
  } else if (hasGaspingWords || effectivePauseRatio > 0.32) {
    respiratory_distress_signal = "probable";
    confidence = 0.74;
  } else if (effectivePauseRatio > 0.22) {
    respiratory_distress_signal = "possible";
    confidence = 0.62;
  }

  const maxVariability = Math.max(
    voice_energy_variability !== null ? voice_energy_variability : 0,
    pitch_variability !== null ? pitch_variability : 0
  );
  if (maxVariability > 0.35) {
    vocal_instability_signal = "pronounced";
  } else if (maxVariability > 0.22) {
    vocal_instability_signal = "mild";
  }

  return {
    speech_pause_ratio,
    mean_pause_duration_ms,
    speech_rate_wpm,
    voice_energy_variability,
    pitch_variability,
    dialogue_pacing_wpm,
    observations,
    clinical_relevance: {
      respiratory_distress_signal,
      vocal_instability_signal,
      confidence
    }
  };
}
