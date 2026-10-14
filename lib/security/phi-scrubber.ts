// lib/security/phi-scrubber.ts

export interface ScrubResult {
  sanitizedText: string;
  vault: ReadonlyMap<string, string>;
  redactionCount: number;
}

interface PatternRule {
  label: string;
  regex: RegExp;
}

// Ordered from most specific to broadest to prevent partial-match collisions
const PHI_PATTERNS: PatternRule[] = [
  { label: 'EMAIL', regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g },
  // Phone numbers (International / US / India 10-digit mobile)
  { label: 'PHONE', regex: /(?:\+?\d{1,3}[\s-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}\b|\b[6-9]\d{9}\b/g },
  // Government / National ID patterns (SSN, 12-digit numeric IDs, ABHA, PAN)
  { label: 'GOV_ID', regex: /\b(?:\d{3}-\d{2}-\d{4}|\d{4}[\s-]?\d{4}[\s-]?\d{4}|[A-Z]{5}\d{4}[A-Z])\b/g },
  // Explicit Dates (MM/DD/YYYY, DD-MM-YYYY, YYYY-MM-DD)
  { label: 'DATE', regex: /\b(?:\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})\b/g },
  // Explicit Self-Identification ("my name is ...", "I am [First Last]")
  { label: 'PATIENT_NAME', regex: /\b(?<=(?:my name is|i am|this is|patient name is)\s+)([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/gi },
];

export class PhiScrubber {
  /**
   * Replaces PHI entities with deterministic placeholders ([PHI_PHONE_1])
   * while preserving clinical symptoms, dosages, and durations.
   */
  static scrub(rawText: string, knownPatientName?: string): ScrubResult {
    if (!rawText) {
      return { sanitizedText: '', vault: new Map(), redactionCount: 0 };
    }

    const vault = new Map<string, string>();
    let sanitizedText = rawText;
    let counter = 0;

    // 1. Redact authenticated user's known profile name if provided
    if (knownPatientName && knownPatientName.trim().length > 2) {
      const escapedName = knownPatientName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const nameRegex = new RegExp(`\\b${escapedName}\\b`, 'gi');
      sanitizedText = sanitizedText.replace(nameRegex, (match) => {
        counter++;
        const token = `[PHI_KNOWN_NAME_${counter}]`;
        vault.set(token, match);
        return token;
      });
    }

    // 2. Apply regex NER patterns
    for (const rule of PHI_PATTERNS) {
      sanitizedText = sanitizedText.replace(rule.regex, (match) => {
        // Avoid double-scrubbing existing tokens
        if (match.startsWith('[PHI_')) return match;
        counter++;
        const token = `[PHI_${rule.label}_${counter}]`;
        vault.set(token, match);
        return token;
      });
    }

    return {
      sanitizedText,
      vault,
      redactionCount: counter,
    };
  }

  /**
   * Re-hydrates placeholders if the response is being rendered strictly
   * back to the authenticated patient's UI session.
   */
  static rehydrate(llmOutput: string, vault: ReadonlyMap<string, string>): string {
    if (!llmOutput || !vault || vault.size === 0) return llmOutput;
    let restored = llmOutput;
    for (const [token, originalValue] of vault.entries()) {
      restored = restored.replaceAll(token, originalValue);
    }
    return restored;
  }
}
