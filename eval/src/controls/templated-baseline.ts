/**
 * MedVoice Clinical Response Evaluation Framework
 * Templated Dialogue Baseline Generator
 *
 * Enforces:
 * 1. Standard static clinical dialogue fallback baseline across all evaluation queries.
 * 2. Emits BaselinePairRecord with baseline_type: "templated_fallback".
 */

import { CuratedPairRecord } from '../ingestion/manifest-builder';
import { BaselinePairRecord } from './derangement-baseline';

export const TEMPLATED_FALLBACK_DEFAULT =
  "Thank you for describing your symptoms. Based on what you have reported, I recommend closely monitoring how you feel and consulting an in-person physician if your symptoms persist, worsen, or cause concern.";

/**
 * Generates a static templated response baseline for the evaluation cohort.
 *
 * @param items Array of CuratedPairRecord
 * @param templateText Optional custom template text (defaults to TEMPLATED_FALLBACK_DEFAULT)
 */
export function generateTemplatedBaseline(
  items: CuratedPairRecord[],
  templateText = TEMPLATED_FALLBACK_DEFAULT
): BaselinePairRecord[] {
  const cleanTemplate = templateText.trim();
  if (!cleanTemplate) {
    throw new Error('Template text cannot be empty or whitespace-only.');
  }

  return items.map((item) => ({
    id: item.id,
    baseline_type: 'templated_fallback',
    patient_query: item.patient_query,
    baseline_reference: cleanTemplate,
    original_reference: item.physician_reference,
  }));
}
