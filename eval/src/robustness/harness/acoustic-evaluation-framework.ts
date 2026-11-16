/**
 * MedVoice AI: Phase 2 Acoustic & Speech Recognition Evaluation Framework
 * 
 * Formal architecture for Experiment 2: Audio-Level Perturbations through Whisper.
 * Measures Word Error Rate (WER), Character Error Rate (CER), and Clinically 
 * Significant Transcription Errors (CSTEs).
 */

export interface AcousticTestScenario {
  scenario_id: string;
  parent_scenario_id: string;
  audio_path: string;
  ground_truth_transcript: string;
  acoustic_condition: {
    snr_db?: number;              // Signal-to-Noise Ratio (e.g. 20dB clean, 10dB moderate, 0dB severe)
    noise_type?: "ambient_domestic" | "traffic_outdoor" | "hospital_alarm" | "clean";
    accent_or_dialect: "indian_english_general" | "telugu_code_switch" | "hindi_code_switch" | "us_general";
    codec: "pcm_16khz" | "opus_webrtc" | "mp3";
    speech_rate_wpm?: number;
  };
  clinical_target: {
    critical_symptoms: string[];
    critical_negations: string[];
    critical_lateralities?: ("left" | "right" | "bilateral")[];
  };
}

export interface AcousticEvaluationResult {
  scenario_id: string;
  ground_truth: string;
  transcription: string;
  transcription_telemetry: {
    avg_logprob?: number;
    no_speech_prob?: number;
    model_version: string;
  };
  metrics: {
    wer: number;                 // Word Error Rate
    cer: number;                 // Character Error Rate
    cste_violations: {
      negation_lost: boolean;    // "No chest pain" transcribed as "Chest pain" (False Alarm)
      symptom_omitted: boolean;  // Critical emergency descriptor dropped
      laterality_inverted: boolean; // Left vs Right flip
      laterality_omitted: boolean;  // Laterality mentioned in GT was omitted in TX
      bilateral_mismatch: boolean;  // Bilateral in GT reduced to unilateral in TX, or unilateral expanded to bilateral
    };
  };
  safety_arbiter_outcome: {
    escalation_triggered: boolean;
    concordant_with_ground_truth: boolean;
  };
}

export function computeWordErrorRate(reference: string, hypothesis: string): number {
  const refWords = reference.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const hypWords = hypothesis.toLowerCase().trim().split(/\s+/).filter(Boolean);

  if (refWords.length === 0) return hypWords.length === 0 ? 0 : 1;

  const dp: number[][] = Array.from({ length: refWords.length + 1 }, () =>
    new Array(hypWords.length + 1).fill(0)
  );

  for (let i = 0; i <= refWords.length; i++) dp[i][0] = i;
  for (let j = 0; j <= hypWords.length; j++) dp[0][j] = j;

  for (let i = 1; i <= refWords.length; i++) {
    for (let j = 1; j <= hypWords.length; j++) {
      if (refWords[i - 1] === hypWords[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(
          dp[i - 1][j],     // deletion
          dp[i][j - 1],     // insertion
          dp[i - 1][j - 1]  // substitution
        );
      }
    }
  }

  return dp[refWords.length][hypWords.length] / refWords.length;
}

export function evaluateClinicalTranscriptionIntegrity(
  groundTruth: string,
  transcription: string,
  criticalSymptoms: string[],
  criticalNegations: string[],
  criticalLateralities?: ("left" | "right" | "bilateral")[]
): {
  negationLost: boolean;
  symptomOmitted: boolean;
  lateralityInverted: boolean;
  lateralityOmitted: boolean;
  bilateralMismatch: boolean;
} {
  const lowerGt = groundTruth.toLowerCase();
  const lowerTx = transcription.toLowerCase();

  let negationLost = false;
  for (const neg of criticalNegations) {
    if (lowerGt.includes(neg.toLowerCase()) && !lowerTx.includes(neg.toLowerCase())) {
      negationLost = true;
    }
  }

  let symptomOmitted = false;
  for (const sym of criticalSymptoms) {
    if (lowerGt.includes(sym.toLowerCase()) && !lowerTx.includes(sym.toLowerCase())) {
      symptomOmitted = true;
    }
  }

  const bilateralRegex = /\b(bilateral|bilaterally|both)\b/i;
  const leftRegex = /\bleft\b/i;
  const rightRegex = /\bright\b/i;

  const gtHasBilateral =
    (criticalLateralities && criticalLateralities.includes('bilateral')) ||
    bilateralRegex.test(lowerGt) ||
    (leftRegex.test(lowerGt) && rightRegex.test(lowerGt));
  const gtHasLeft =
    (criticalLateralities && criticalLateralities.includes('left')) || leftRegex.test(lowerGt);
  const gtHasRight =
    (criticalLateralities && criticalLateralities.includes('right')) || rightRegex.test(lowerGt);

  const txHasBilateral =
    bilateralRegex.test(lowerTx) || (leftRegex.test(lowerTx) && rightRegex.test(lowerTx));
  const txHasLeft = leftRegex.test(lowerTx);
  const txHasRight = rightRegex.test(lowerTx);

  let lateralityInverted = false;
  let lateralityOmitted = false;
  let bilateralMismatch = false;

  const gtHasAnyLaterality = gtHasBilateral || gtHasLeft || gtHasRight;
  const txHasAnyLaterality = txHasBilateral || txHasLeft || txHasRight;

  if (gtHasAnyLaterality && !txHasAnyLaterality) {
    lateralityOmitted = true;
  }

  if (gtHasBilateral) {
    // Ground truth is bilateral
    if (txHasAnyLaterality && !txHasBilateral) {
      // Reduced to unilateral left or right
      bilateralMismatch = true;
    }
  } else if (gtHasLeft && !gtHasRight) {
    // Ground truth is unilateral left
    if (txHasBilateral) {
      bilateralMismatch = true;
    } else if (txHasRight && !txHasLeft) {
      lateralityInverted = true;
    }
  } else if (gtHasRight && !gtHasLeft) {
    // Ground truth is unilateral right
    if (txHasBilateral) {
      bilateralMismatch = true;
    } else if (txHasLeft && !txHasRight) {
      lateralityInverted = true;
    }
  }

  return {
    negationLost,
    symptomOmitted,
    lateralityInverted,
    lateralityOmitted,
    bilateralMismatch,
  };
}
