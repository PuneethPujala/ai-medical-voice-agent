/**
 * MedVoice Clinical Response Evaluation Framework
 * Dual-Physician Consensus Calibration Cohort Extractor
 *
 * Enforces:
 * 1. Extraction of threads where >=2 independent physicians answered the same patient query.
 * 2. Pairs Physician A and Physician B to establish an empirical human-human agreement benchmark.
 * 3. PhiScrubber de-identification applied to both physician responses.
 * 4. Deterministic SHA-256 provenance hash generation.
 */

import * as crypto from 'crypto';
import { sanitizeClinicalText } from '../ingestion/sanitize';

export interface PhysicianThreadAnswer {
  doctor_id?: string;
  specialty?: string;
  text: string;
}

export interface MultiPhysicianRecord {
  thread_id: string;
  patient_query: string;
  physician_responses: PhysicianThreadAnswer[];
  domain?: string;
}

export interface ConsensusPairRecord {
  id: string;
  thread_id: string;
  patient_query: string;
  physician_reference_a: string;
  physician_reference_b: string;
  physician_a_specialty: string;
  physician_b_specialty: string;
  sha256: string;
}

/**
 * Extracts paired dual-physician responses from multi-physician consultation threads.
 *
 * @param threads Array of multi-physician consultation threads
 */
export function extractConsensusCohort(
  threads: MultiPhysicianRecord[]
): ConsensusPairRecord[] {
  const records: ConsensusPairRecord[] = [];

  for (let i = 0; i < threads.length; i++) {
    const thread = threads[i];
    if (!thread || !Array.isArray(thread.physician_responses)) continue;

    // Filter valid, non-empty responses
    const validResponses = thread.physician_responses.filter(
      (resp) => resp && typeof resp.text === 'string' && resp.text.trim().length > 0
    );

    if (validResponses.length < 2) {
      continue;
    }

    const respA = validResponses[0];
    const respB = validResponses[1];

    const sanitizedQuery = sanitizeClinicalText((thread.patient_query || '').trim());
    const sanitizedRefA = sanitizeClinicalText(respA.text.trim());
    const sanitizedRefB = sanitizeClinicalText(respB.text.trim());

    if (!sanitizedRefA || !sanitizedRefB) {
      continue;
    }

    const sha256 = crypto
      .createHash('sha256')
      .update(`${sanitizedQuery}::${sanitizedRefA}::${sanitizedRefB}`)
      .digest('hex');

    const id = `CONSENSUS-${String(records.length + 1).padStart(4, '0')}`;

    records.push({
      id,
      thread_id: thread.thread_id || `THREAD-${i + 1}`,
      patient_query: sanitizedQuery,
      physician_reference_a: sanitizedRefA,
      physician_reference_b: sanitizedRefB,
      physician_a_specialty: (respA.specialty || '').trim() || 'unknown',
      physician_b_specialty: (respB.specialty || '').trim() || 'unknown',
      sha256,
    });
  }

  return records;
}
