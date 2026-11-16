/**
 * MedVoice AI: Phase 2 Acoustic & Speech Recognition Evaluation Framework
 * 
 * Formal architecture for Experiment 2: Audio-Level Perturbations through Whisper.
 * Measures Word Error Rate (WER), Character Error Rate (CER), and Clinically 
 * Significant Transcription Errors (CSTEs).
 * 
 * Model Stratum Note:
 * The default local runtime is configured with OpenAI Whisper `whisper_base_en` 
 * (an English-only acoustic model). Prospective evaluation of Telugu/Hindi 
 * code-switching requires the multilingual `base` or dedicated bilingual models.
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

export interface ClinicalTranscriptionIntegrityResult {
  negationLost: boolean;       // GT negative turned into TX positive (False Alarm trigger)
  symptomOmitted: boolean;     // Critical symptom dropped entirely
  lateralityInverted: boolean; // Left vs Right flip (global or site-linked)
  lateralityOmitted: boolean;  // Laterality mentioned in GT omitted in TX
  bilateralMismatch: boolean;  // Bilateral reduced to unilateral or vice versa
  polarityInverted: boolean;   // GT positive turned into TX negative (Under-triage risk)
  siteSpecificLateralityErrors?: string[];
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
    cste_violations: ClinicalTranscriptionIntegrityResult;
  };
  safety_arbiter_outcome: {
    escalation_triggered: boolean;
    concordant_with_ground_truth: boolean;
  };
}

/**
 * Standard acoustic text normalization for ASR error calculation:
 * Lowercases, strips punctuation (except apostrophes within words), and collapses whitespace.
 */
export function normalizeAcousticTranscript(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Computes Word Error Rate (WER) using Levenshtein distance on words.
 */
export function computeWordErrorRate(reference: string, hypothesis: string): number {
  const normRef = normalizeAcousticTranscript(reference);
  const normHyp = normalizeAcousticTranscript(hypothesis);

  const refWords = normRef.split(/\s+/).filter(Boolean);
  const hypWords = normHyp.split(/\s+/).filter(Boolean);

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

/**
 * Computes Character Error Rate (CER) using Levenshtein distance on characters.
 */
export function computeCharacterErrorRate(reference: string, hypothesis: string): number {
  const normRef = normalizeAcousticTranscript(reference);
  const normHyp = normalizeAcousticTranscript(hypothesis);

  if (normRef.length === 0) return normHyp.length === 0 ? 0 : 1;

  const dp: number[][] = Array.from({ length: normRef.length + 1 }, () =>
    new Array(normHyp.length + 1).fill(0)
  );

  for (let i = 0; i <= normRef.length; i++) dp[i][0] = i;
  for (let j = 0; j <= normHyp.length; j++) dp[0][j] = j;

  for (let i = 1; i <= normRef.length; i++) {
    for (let j = 1; j <= normHyp.length; j++) {
      if (normRef[i - 1] === normHyp[j - 1]) {
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

  return dp[normRef.length][normHyp.length] / normRef.length;
}

const NEGATION_PATTERNS = [
  'no',
  'not',
  'denies',
  'denying',
  'denied',
  'without',
  'free of',
  'rules out',
  'negative for',
  'never had',
  'has not',
  'have not',
  "doesn't have",
  "don't have",
];

function hasNegationPrefix(text: string, targetPhrase: string): boolean {
  const lowerText = text.toLowerCase();
  const lowerTarget = targetPhrase.toLowerCase();
  const idx = lowerText.indexOf(lowerTarget);
  if (idx === -1) return false;

  // Look back up to 40 characters or 4 words preceding target phrase
  const windowStart = Math.max(0, idx - 40);
  const preceding = lowerText.slice(windowStart, idx);

  for (const neg of NEGATION_PATTERNS) {
    const regex = new RegExp(`\\b${neg}\\b`, 'i');
    if (regex.test(preceding)) {
      return true;
    }
  }
  return false;
}

const ANATOMICAL_SITES = [
  'arm',
  'leg',
  'eye',
  'side',
  'shoulder',
  'hand',
  'foot',
  'ear',
  'lung',
  'flank',
  'temple',
  'chest',
];

interface SiteLateralityMap {
  [site: string]: 'left' | 'right' | 'bilateral';
}

function extractSiteLateralities(text: string): SiteLateralityMap {
  const map: SiteLateralityMap = {};
  const lower = text.toLowerCase();

  for (const site of ANATOMICAL_SITES) {
    const sitePattern = site === 'foot' ? '(?:foot|feet)' : `${site}s?`;
    const bilateralRegex = new RegExp(`\\b(bilateral|both)\\s+[a-z\\s]{0,15}\\b${sitePattern}\\b|\\b${sitePattern}\\b[a-z\\s]{0,15}\\b(bilateral|both)\\b`, 'i');
    const leftRegex = new RegExp(`\\bleft\\s+[a-z\\s]{0,15}\\b${sitePattern}\\b|\\b${sitePattern}\\b[a-z\\s]{0,15}\\bleft\\b`, 'i');
    const rightRegex = new RegExp(`\\bright\\s+[a-z\\s]{0,15}\\b${sitePattern}\\b|\\b${sitePattern}\\b[a-z\\s]{0,15}\\bright\\b`, 'i');

    if (bilateralRegex.test(lower) || (leftRegex.test(lower) && rightRegex.test(lower))) {
      map[site] = 'bilateral';
    } else if (leftRegex.test(lower)) {
      map[site] = 'left';
    } else if (rightRegex.test(lower)) {
      map[site] = 'right';
    }
  }

  return map;
}

/**
 * Evaluates clinically significant transcription errors (CSTEs) with semantic polarity
 * and site-specific laterality linking.
 */
export function evaluateClinicalTranscriptionIntegrity(
  groundTruth: string,
  transcription: string,
  criticalSymptoms: string[],
  criticalNegations: string[],
  criticalLateralities?: ('left' | 'right' | 'bilateral')[]
): ClinicalTranscriptionIntegrityResult {
  const lowerGt = groundTruth.toLowerCase();
  const lowerTx = transcription.toLowerCase();

  let negationLost = false;
  let polarityInverted = false;

  // 1. Check critical negations in ground truth
  for (const neg of criticalNegations) {
    const cleanNegConcept = neg.replace(/^(no|not|denies|without)\s+/i, '').trim();
    if (lowerGt.includes(cleanNegConcept)) {
      const gtNegated = hasNegationPrefix(lowerGt, cleanNegConcept) || lowerGt.includes(neg.toLowerCase());
      const txNegated = hasNegationPrefix(lowerTx, cleanNegConcept);

      // If GT had negation, but TX lost the negation cue (asserted positively)
      if (gtNegated && !txNegated && lowerTx.includes(cleanNegConcept)) {
        negationLost = true;
      }
    }
  }

  // 2. Check critical symptoms in ground truth for omission or polarity inversion
  let symptomOmitted = false;
  for (const sym of criticalSymptoms) {
    const symLower = sym.toLowerCase();
    if (lowerGt.includes(symLower)) {
      if (!lowerTx.includes(symLower)) {
        symptomOmitted = true;
      } else {
        // Symptom is present in TX, check if polarity was inverted (GT positive -> TX negated)
        const gtNegated = hasNegationPrefix(lowerGt, symLower);
        const txNegated = hasNegationPrefix(lowerTx, symLower);

        if (!gtNegated && txNegated) {
          polarityInverted = true;
        }
      }
    }
  }

  // 3. Site-specific laterality evaluation
  const gtSiteMap = extractSiteLateralities(groundTruth);
  const txSiteMap = extractSiteLateralities(transcription);

  let lateralityInverted = false;
  let lateralityOmitted = false;
  let bilateralMismatch = false;
  const siteSpecificLateralityErrors: string[] = [];

  for (const site of Object.keys(gtSiteMap)) {
    const gtLat = gtSiteMap[site];
    const txLat = txSiteMap[site];

    if (!txLat) {
      lateralityOmitted = true;
      siteSpecificLateralityErrors.push(`Omitted laterality for site: ${site} (GT: ${gtLat})`);
    } else if (gtLat !== txLat) {
      if (
        (gtLat === 'bilateral' && (txLat === 'left' || txLat === 'right')) ||
        (txLat === 'bilateral' && (gtLat === 'left' || gtLat === 'right'))
      ) {
        bilateralMismatch = true;
        siteSpecificLateralityErrors.push(`Bilateral mismatch for ${site}: GT=${gtLat} vs TX=${txLat}`);
      } else if (
        (gtLat === 'left' && txLat === 'right') ||
        (gtLat === 'right' && txLat === 'left')
      ) {
        lateralityInverted = true;
        siteSpecificLateralityErrors.push(`Inverted laterality for ${site}: GT=${gtLat} vs TX=${txLat}`);
      }
    }
  }

  // Fallback to global laterality if no anatomical sites matched but explicit laterality cues exist
  if (Object.keys(gtSiteMap).length === 0) {
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

    const gtHasAnyLaterality = gtHasBilateral || gtHasLeft || gtHasRight;
    const txHasAnyLaterality = txHasBilateral || txHasLeft || txHasRight;

    if (gtHasAnyLaterality && !txHasAnyLaterality) {
      lateralityOmitted = true;
    }

    if (gtHasBilateral) {
      if (txHasAnyLaterality && !txHasBilateral) bilateralMismatch = true;
    } else if (gtHasLeft && !gtHasRight) {
      if (txHasBilateral) bilateralMismatch = true;
      else if (txHasRight && !txHasLeft) lateralityInverted = true;
    } else if (gtHasRight && !gtHasLeft) {
      if (txHasBilateral) bilateralMismatch = true;
      else if (txHasLeft && !txHasRight) lateralityInverted = true;
    }
  }

  return {
    negationLost,
    symptomOmitted,
    lateralityInverted,
    lateralityOmitted,
    bilateralMismatch,
    polarityInverted,
    ...(siteSpecificLateralityErrors.length > 0 ? { siteSpecificLateralityErrors } : {}),
  };
}
