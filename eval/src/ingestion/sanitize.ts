/**
 * MedVoice Clinical Response Evaluation Framework
 * Ingestion Safeguards & Sanitization Engine
 *
 * Responsibilities:
 * - De-identification using PhiScrubber
 * - Validation of short vs empty queries and length bounds
 * - Linguistic and readability metrics (Word Count, FKGL)
 */

import { PhiScrubber } from '../../../lib/security/phi-scrubber';

export interface ValidationResult {
  valid: boolean;
  reason?: string;
  sanitizedQuery?: string;
  sanitizedReference?: string;
}

export const MAX_PATIENT_QUERY_CHARS = 4096;
export const MAX_PHYSICIAN_REF_CHARS = 16384;

/**
 * Sanitizes clinical text by scrubbing PHI identifiers (names, phones, emails, dates, gov IDs).
 */
export function sanitizeClinicalText(rawText: string, knownPatientName?: string): string {
  if (!rawText) return '';
  const scrubResult = PhiScrubber.scrub(rawText, knownPatientName);
  return scrubResult.sanitizedText;
}

/**
 * Counts non-empty whitespace-delimited words.
 */
export function countWords(text: string): number {
  if (!text) return 0;
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length;
}

/**
 * Counts syllables in an English word using standard heuristic rules.
 */
export function countWordSyllables(word: string): number {
  const clean = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!clean) return 0;
  if (clean.length <= 3) return 1;

  const vowelMatches = clean.match(/[aeiouy]+/g);
  let syllables = vowelMatches ? vowelMatches.length : 1;

  // Subtract silent terminal 'e' (unless ending in 'le' preceded by consonant)
  if (clean.endsWith('e') && !clean.endsWith('le') && syllables > 1) {
    syllables--;
  }

  return Math.max(1, syllables);
}

/**
 * Calculates Flesch-Kincaid Grade Level (FKGL) readability metric:
 * FKGL = 0.39 * (total_words / total_sentences) + 11.8 * (total_syllables / total_words) - 15.59
 */
export function calculateFKGL(text: string): number {
  if (!text) return 0;

  const trimmed = text.trim();
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;

  // Sentences split by terminal punctuation [.!?] or newlines
  const sentences = trimmed
    .split(/[.!?]+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const sentenceCount = Math.max(1, sentences.length);
  const wordCount = words.length;

  let totalSyllables = 0;
  for (const word of words) {
    totalSyllables += countWordSyllables(word);
  }

  const fkgl = 0.39 * (wordCount / sentenceCount) + 11.8 * (totalSyllables / wordCount) - 15.59;
  return Number(Math.max(0, fkgl).toFixed(2));
}

/**
 * Validates a clinical dialogue item against admission rules:
 * - Accepts short clinical queries ("I'm dizzy", "I have chest pain")
 * - Rejects empty / whitespace-only queries
 * - Rejects queries exceeding MAX_PATIENT_QUERY_CHARS (4096)
 * - Rejects empty / whitespace-only physician references
 */
export function validateDialogueItem(item: {
  patient_query?: string;
  query?: string;
  transcript?: string;
  physician_reference?: string;
  reference?: string;
  physician_response?: string;
}): ValidationResult {
  const query = (item.patient_query ?? item.query ?? item.transcript ?? '').trim();
  const reference = (item.physician_reference ?? item.reference ?? item.physician_response ?? '').trim();

  if (!query) {
    return {
      valid: false,
      reason: 'Patient query cannot be empty or whitespace-only.',
    };
  }

  const rawLength = (item.patient_query ?? item.query ?? item.transcript ?? '').length;
  if (rawLength > MAX_PATIENT_QUERY_CHARS) {
    return {
      valid: false,
      reason: `Patient query exceeds maximum length of ${MAX_PATIENT_QUERY_CHARS} characters (received ${rawLength}).`,
    };
  }

  if (!reference) {
    return {
      valid: false,
      reason: 'Physician reference cannot be empty or whitespace-only.',
    };
  }

  if (reference.length > MAX_PHYSICIAN_REF_CHARS) {
    return {
      valid: false,
      reason: `Physician reference exceeds maximum length of ${MAX_PHYSICIAN_REF_CHARS} characters.`,
    };
  }

  return {
    valid: true,
  };
}
