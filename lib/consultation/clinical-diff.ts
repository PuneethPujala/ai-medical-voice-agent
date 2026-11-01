/**
 * Clinical Document Diff Engine
 * Computes deterministic, word- and line-level semantic diffs between clinical artifact versions.
 * Normalizes harmless formatting/whitespace differences while precisely highlighting clinical additions and removals.
 */

export interface DiffChunk {
  type: "added" | "removed" | "unchanged";
  value: string;
}

export interface ArrayDiffResult {
  added: string[];
  removed: string[];
  unchanged: string[];
}

export interface SectionDiff {
  section: string;
  hasChanges: boolean;
  baseText: string;
  targetText: string;
  chunks: DiffChunk[];
}

export interface ArtifactDiffReport {
  baseVersion: number;
  targetVersion: number;
  amendmentReason?: string | null;
  hasClinicalChanges: boolean;
  chiefComplaint: SectionDiff;
  subjective: SectionDiff;
  objective: SectionDiff;
  assessment: SectionDiff;
  plan: SectionDiff;
  icd10Codes: {
    hasChanges: boolean;
    base: string[];
    target: string[];
    diff: ArrayDiffResult;
  };
  esiScore: {
    hasChanges: boolean;
    base?: number | null;
    target?: number | null;
  };
}

/**
 * Normalizes clinical text for safe comparison:
 * - Converts CRLF to LF
 * - Trims trailing whitespace per line
 * - Normalizes multiple blank lines to a single blank line
 */
export function normalizeClinicalText(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Tokenizes text into words and delimiters (punctuation, newlines, spaces).
 */
function tokenizeText(text: string): string[] {
  if (!text) return [];
  // Tokenize preserving whitespace and punctuation
  const tokens = text.match(/\w+|[^\w\s]+|\s+/g);
  return tokens || [];
}

/**
 * Computes Longest Common Subsequence (LCS) matrix for two token arrays.
 */
function computeLCSMatrix(tokensA: string[], tokensB: string[]): number[][] {
  const m = tokensA.length;
  const n = tokensB.length;
  const matrix: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (tokensA[i - 1] === tokensB[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1] + 1;
      } else {
        matrix[i][j] = Math.max(matrix[i - 1][j], matrix[i][j - 1]);
      }
    }
  }
  return matrix;
}

/**
 * Computes word-level diff between two clinical texts.
 */
export function diffClinicalText(oldText: string, newText: string): DiffChunk[] {
  const normOld = normalizeClinicalText(oldText);
  const normNew = normalizeClinicalText(newText);

  if (normOld === normNew) {
    return [{ type: "unchanged", value: normNew }];
  }

  const tokensA = tokenizeText(normOld);
  const tokensB = tokenizeText(normNew);

  const matrix = computeLCSMatrix(tokensA, tokensB);
  let i = tokensA.length;
  let j = tokensB.length;

  const rawChunks: DiffChunk[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && tokensA[i - 1] === tokensB[j - 1]) {
      rawChunks.push({ type: "unchanged", value: tokensA[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || matrix[i][j - 1] >= matrix[i - 1][j])) {
      rawChunks.push({ type: "added", value: tokensB[j - 1] });
      j--;
    } else if (i > 0 && (j === 0 || matrix[i][j - 1] < matrix[i - 1][j])) {
      rawChunks.push({ type: "removed", value: tokensA[i - 1] });
      i--;
    }
  }

  rawChunks.reverse();

  // Merge consecutive chunks of the same type for compact rendering
  const merged: DiffChunk[] = [];
  for (const chunk of rawChunks) {
    if (merged.length > 0 && merged[merged.length - 1].type === chunk.type) {
      merged[merged.length - 1].value += chunk.value;
    } else {
      merged.push({ ...chunk });
    }
  }

  return merged;
}

/**
 * Computes additions and removals between two string arrays (e.g. ICD-10 codes).
 */
export function diffArray(base: string[] = [], target: string[] = []): ArrayDiffResult {
  const baseSet = new Set(base);
  const targetSet = new Set(target);

  const added = target.filter((item) => !baseSet.has(item));
  const removed = base.filter((item) => !targetSet.has(item));
  const unchanged = target.filter((item) => baseSet.has(item));

  return { added, removed, unchanged };
}

/**
 * Computes a full section diff comparison.
 */
function createSectionDiff(sectionName: string, baseVal: string = "", targetVal: string = ""): SectionDiff {
  const normBase = normalizeClinicalText(baseVal);
  const normTarget = normalizeClinicalText(targetVal);
  const hasChanges = normBase !== normTarget;
  const chunks: DiffChunk[] = hasChanges
    ? diffClinicalText(normBase, normTarget)
    : [{ type: "unchanged", value: normTarget }];

  return {
    section: sectionName,
    hasChanges,
    baseText: normBase,
    targetText: normTarget,
    chunks,
  };
}

/**
 * Computes full semantic diff report between two clinical artifacts.
 */
export function computeArtifactDiff(base: any, target: any): ArtifactDiffReport {
  const chiefComplaint = createSectionDiff("Chief Complaint", base.chiefComplaint, target.chiefComplaint);
  const subjective = createSectionDiff("Subjective", base.soapSubjective, target.soapSubjective);
  const objective = createSectionDiff("Objective", base.soapObjective, target.soapObjective);
  const assessment = createSectionDiff("Assessment", base.soapAssessment, target.soapAssessment);
  const plan = createSectionDiff("Plan", base.soapPlan, target.soapPlan);

  const baseCodes = Array.isArray(base.icd10Codes) ? base.icd10Codes : [];
  const targetCodes = Array.isArray(target.icd10Codes) ? target.icd10Codes : [];
  const icdDiff = diffArray(baseCodes, targetCodes);
  const icdHasChanges = icdDiff.added.length > 0 || icdDiff.removed.length > 0;

  const baseEsi = base.esiScore ?? null;
  const targetEsi = target.esiScore ?? null;
  const esiHasChanges = baseEsi !== targetEsi;

  const hasClinicalChanges =
    chiefComplaint.hasChanges ||
    subjective.hasChanges ||
    objective.hasChanges ||
    assessment.hasChanges ||
    plan.hasChanges ||
    icdHasChanges ||
    esiHasChanges;

  return {
    baseVersion: Number(base.version || 1),
    targetVersion: Number(target.version || 2),
    amendmentReason: target.amendmentReason || null,
    hasClinicalChanges,
    chiefComplaint,
    subjective,
    objective,
    assessment,
    plan,
    icd10Codes: {
      hasChanges: icdHasChanges,
      base: baseCodes,
      target: targetCodes,
      diff: icdDiff,
    },
    esiScore: {
      hasChanges: esiHasChanges,
      base: baseEsi,
      target: targetEsi,
    },
  };
}
