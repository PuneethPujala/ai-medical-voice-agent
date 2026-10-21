/**
 * Clinical Speech-to-Text Contextual Reconciler
 *
 * Verifies and aligns raw Whisper ASR transcriptions with the live browser preview
 * and preceding clinical doctor inquiry context.
 *
 * Clinical Invariant:
 * Resolves acoustic ambiguities (e.g., "graduating" vs "gradually", "doll" vs "dull",
 * "chase" vs "chest") by cross-referencing the doctor's active clinical inquiry
 * and verified live Web Speech stream tokens.
 */

export interface ReconcileOptions {
  whisperText: string;
  previewText?: string;
  doctorLastQuestion?: string;
  currentSymptoms?: string[];
}

export interface ReconcileResult {
  transcript: string;
  rawWhisperText: string;
  rawPreviewText?: string;
  wasReconciled: boolean;
  isAmbiguous?: boolean;
  ambiguityReason?: string;
  requiresPatientConfirmation?: boolean;
  reconciliationNotes?: string[];
}

const CLINICAL_COMMON_CORRECTIONS: Record<string, string> = {
  graduating: "gradually",
  graduate: "gradual",
  doll: "dull",
  chase: "chest",
  nasa: "nausea",
  coffees: "coughing",
  cough: "cough",
  coffin: "coughing",
  throbbing: "throbbing",
  sore: "sore",
  fleas: "freeze",
  flea: "fever",
  feather: "fever",
  bleed: "bleeding",
};

/**
 * Opposing clinical meanings that must NEVER be cross-replaced,
 * even if phonetic edit distance or context tokens match.
 */
const CLINICAL_ANTONYM_PAIRS: [string, string][] = [
  ["sudden", "gradual"],
  ["suddenly", "gradually"],
  ["mild", "severe"],
  ["yes", "no"],
  ["left", "right"],
  ["sharp", "dull"],
  ["improving", "worsening"],
  ["constant", "intermittent"],
  ["present", "absent"],
  ["acute", "chronic"],
];

function areAntonyms(wordA: string, wordB: string): boolean {
  const a = wordA.toLowerCase();
  const b = wordB.toLowerCase();
  return CLINICAL_ANTONYM_PAIRS.some(
    ([x, y]) => (a === x && b === y) || (a === y && b === x)
  );
}

/**
 * Calculates Levenshtein edit distance between two strings
 */
function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[m][n];
}

/**
 * Reconciles Whisper ASR output with live browser preview and doctor's inquiry context
 */
export function reconcileClinicalTranscript(options: ReconcileOptions): ReconcileResult {
  const { whisperText = "", previewText = "", doctorLastQuestion = "", currentSymptoms = [] } = options;

  const cleanWhisper = whisperText.trim();
  const cleanPreview = previewText.trim();

  // If one source is empty, fall back to the other
  if (!cleanWhisper && cleanPreview) {
    return {
      transcript: cleanPreview,
      rawWhisperText: cleanWhisper,
      rawPreviewText: cleanPreview,
      wasReconciled: true,
      isAmbiguous: false,
      reconciliationNotes: ["Used live preview as Whisper was empty"],
    };
  }
  if (!cleanPreview && cleanWhisper) {
    return {
      transcript: cleanWhisper,
      rawWhisperText: cleanWhisper,
      rawPreviewText: cleanPreview,
      wasReconciled: false,
      isAmbiguous: false,
    };
  }
  if (!cleanWhisper && !cleanPreview) {
    return {
      transcript: "",
      rawWhisperText: "",
      rawPreviewText: "",
      wasReconciled: false,
      isAmbiguous: false,
    };
  }

  // Exact match
  if (cleanWhisper.toLowerCase() === cleanPreview.toLowerCase()) {
    return {
      transcript: cleanWhisper,
      rawWhisperText: cleanWhisper,
      rawPreviewText: cleanPreview,
      wasReconciled: false,
      isAmbiguous: false,
    };
  }

  // Extract key clinical tokens from doctor's question and current symptoms
  const clinicalContextTokens = new Set<string>();
  const extractWords = (str: string) =>
    str
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3);

  extractWords(doctorLastQuestion).forEach((w) => clinicalContextTokens.add(w));
  currentSymptoms.forEach((s) => extractWords(s).forEach((w) => clinicalContextTokens.add(w)));

  // Add standard clinical inquiry words
  const standardTerms = [
    "sudden", "suddenly", "gradual", "gradually", "headache", "chest", "pain",
    "severe", "mild", "moderate", "sharp", "dull", "throbbing", "pressure",
    "fever", "nausea", "vomiting", "dizziness", "shortness", "breath", "cough"
  ];
  standardTerms.forEach((t) => clinicalContextTokens.add(t));

  const whisperWords = cleanWhisper.split(/\s+/);
  const previewWords = cleanPreview.split(/\s+/);

  const reconciledWords: string[] = [];
  const notes: string[] = [];
  const ambiguityNotes: string[] = [];
  let reconciledAny = false;
  let isAmbiguous = false;

  for (let i = 0; i < whisperWords.length; i++) {
    const rawW = whisperWords[i];
    const cleanW = rawW.toLowerCase().replace(/[^a-z0-9]/g, "");
    const matchingP = previewWords[i] ? previewWords[i] : "";
    const cleanP = matchingP.toLowerCase().replace(/[^a-z0-9]/g, "");

    let chosenWord = rawW;

    // CLINICAL INVARIANT 1: Antonym Protection
    // Words with opposing clinical meanings (e.g. sudden vs gradual, mild vs severe, yes vs no)
    // must NEVER be cross-replaced, as that flips clinical urgency.
    if (cleanP && areAntonyms(cleanW, cleanP)) {
      isAmbiguous = true;
      ambiguityNotes.push(`Clinical polarity divergence: audio heard "${cleanW}", preview heard "${cleanP}". Preserved verbatim.`);
      reconciledWords.push(rawW);
      continue;
    }

    // Direct clinical mishearing dictionary check
    if (CLINICAL_COMMON_CORRECTIONS[cleanW]) {
      const correction = CLINICAL_COMMON_CORRECTIONS[cleanW];
      if (cleanP && areAntonyms(correction, cleanP)) {
        isAmbiguous = true;
        ambiguityNotes.push(`Correction "${correction}" contradicts preview "${cleanP}". Preserved verbatim.`);
        chosenWord = rawW;
      } else {
        // Preserve original casing and punctuation
        const isCapitalized = /^[A-Z]/.test(rawW);
        const punct = rawW.match(/[^a-zA-Z0-9]+$/)?.[0] || "";
        chosenWord = (isCapitalized ? correction.charAt(0).toUpperCase() + correction.slice(1) : correction) + punct;
        reconciledAny = true;
        notes.push(`Corrected known clinical mishearing: "${rawW}" -> "${chosenWord}"`);
      }
    } else if (cleanP && cleanW !== cleanP) {
      // Check if preview word is a recognized clinical context word while Whisper word is not
      const pInContext = clinicalContextTokens.has(cleanP);
      const wInContext = clinicalContextTokens.has(cleanW);

      if (pInContext && !wInContext) {
        // Check phonetic / edit distance compatibility (e.g. prefix match or small distance)
        const commonPrefix = cleanP.slice(0, 4) === cleanW.slice(0, 4);
        const dist = editDistance(cleanP, cleanW);
        const maxLen = Math.max(cleanP.length, cleanW.length);
        const isPhoneticallySimilar = commonPrefix || dist <= 3 || (dist / maxLen) < 0.45;

        if (isPhoneticallySimilar) {
          const isCapitalized = /^[A-Z]/.test(rawW);
          const punct = rawW.match(/[^a-zA-Z0-9]+$/)?.[0] || "";
          chosenWord = (isCapitalized ? cleanP.charAt(0).toUpperCase() + cleanP.slice(1) : cleanP) + punct;
          reconciledAny = true;
          notes.push(`Reconciled with clinical context ("${cleanP}") over acoustic mishearing ("${cleanW}")`);
        } else {
          // Significant phonetic divergence without safe alignment - flag ambiguity
          isAmbiguous = true;
          ambiguityNotes.push(`Acoustic divergence without safe phonetic alignment: "${cleanW}" vs "${cleanP}".`);
        }
      } else if (pInContext && wInContext && cleanP !== cleanW) {
        // Both words are valid clinical terms but differ (e.g. "sharp" vs "throbbing") - preserve verbatim
        isAmbiguous = true;
        ambiguityNotes.push(`Distinct clinical tokens detected ("${cleanW}" vs "${cleanP}"). Preserved verbatim.`);
      }
    }

    reconciledWords.push(chosenWord);
  }

  // If preview has more words and Whisper dropped trailing words, preserve preview's trailing words
  if (previewWords.length > whisperWords.length && previewWords.length <= whisperWords.length + 3) {
    const trailing = previewWords.slice(whisperWords.length);
    reconciledWords.push(...trailing);
    reconciledAny = true;
    notes.push(`Recovered ${trailing.length} trailing words from live preview`);
  }

  const finalTranscript = reconciledWords.join(" ").trim();
  const allNotes = [...notes, ...ambiguityNotes];

  return {
    transcript: finalTranscript,
    rawWhisperText: cleanWhisper,
    rawPreviewText: cleanPreview,
    wasReconciled: reconciledAny,
    isAmbiguous,
    requiresPatientConfirmation: isAmbiguous,
    ambiguityReason: ambiguityNotes.length > 0 ? ambiguityNotes.join("; ") : undefined,
    reconciliationNotes: allNotes.length > 0 ? allNotes : undefined,
  };
}
