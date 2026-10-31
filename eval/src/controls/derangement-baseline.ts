/**
 * MedVoice Clinical Response Evaluation Framework
 * True Derangement Random Baseline Generator
 *
 * Enforces:
 * 1. Sattolo's algorithm: guarantees a single uniform cyclic permutation with ZERO fixed points (\forall i, \pi(i) \ne i).
 * 2. Deterministic execution via seeded PRNG (Mulberry32).
 * 3. Permutation conservation: exact preservation of the reference response multiset.
 * 4. Fails fast if input length < 2.
 */

import { CuratedPairRecord } from '../ingestion/manifest-builder';

export interface BaselinePairRecord {
  id: string;
  baseline_type: 'random_derangement' | 'templated_fallback';
  patient_query: string;
  baseline_reference: string;
  original_reference: string;
  seed?: number;
}

/**
 * Seeded Mulberry32 pseudo-random number generator.
 */
function createMulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generates a true derangement of physician reference answers.
 * Guarantees zero self-matches (\forall i, \pi(i) \ne i).
 *
 * @param items Array of CuratedPairRecord (length >= 2)
 * @param seed Random seed for reproducibility (default: 42)
 */
export function generateDerangementBaseline(
  items: CuratedPairRecord[],
  seed = 42
): BaselinePairRecord[] {
  const n = items.length;
  if (n < 2) {
    throw new Error(
      `Cannot generate a derangement for fewer than 2 items (received ${n}). A derangement requires at least 2 distinct observations.`
    );
  }

  const rng = createMulberry32(seed);

  // Extract reference texts
  const permutedReferences = items.map((item) => item.physician_reference);

  // Sattolo's algorithm:
  // For i from n - 1 down to 1:
  //   Choose j uniformly in [0, i - 1] (strictly < i)
  //   Swap permutedReferences[i] and permutedReferences[j]
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * i); // 0 <= j < i
    const temp = permutedReferences[i];
    permutedReferences[i] = permutedReferences[j];
    permutedReferences[j] = temp;
  }

  // Safety Assertion: Verify zero fixed points
  const results: BaselinePairRecord[] = [];
  for (let i = 0; i < n; i++) {
    const originalRef = items[i].physician_reference;
    const derangedRef = permutedReferences[i];

    if (derangedRef === originalRef) {
      throw new Error(
        `Derangement invariant violation: fixed point detected at index ${i} ("${items[i].id}"). Zero self-matches allowed.`
      );
    }

    results.push({
      id: items[i].id,
      baseline_type: 'random_derangement',
      patient_query: items[i].patient_query,
      baseline_reference: derangedRef,
      original_reference: originalRef,
      seed,
    });
  }

  return results;
}
