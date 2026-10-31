/**
 * MedVoice Clinical Response Evaluation Framework
 * Session Isolation & State Barrier Harness
 *
 * Enforces:
 * - Fresh, pristine session initialization via conversationManager.createInitialState()
 * - Deep cloning to guarantee zero memory reference sharing across turns
 * - Programmatic session cleanliness verification
 * - Memory barrier reset between evaluation items
 */

import {
  conversationManager,
  ClinicalInterviewState,
} from '../../../lib/triage/conversation-manager';

/**
 * Creates a pristine, completely isolated ClinicalInterviewState instance.
 * Applies deep-cloning to ensure no shared memory references.
 */
export function createIsolatedSession(
  overrides?: Partial<ClinicalInterviewState>
): ClinicalInterviewState {
  // Ensure conversation manager has no sticky patient profile
  conversationManager.setPatientProfile(null);

  const baseState = conversationManager.createInitialState();
  const cloned: ClinicalInterviewState = JSON.parse(JSON.stringify(baseState));

  if (overrides) {
    return {
      ...cloned,
      ...overrides,
      slots: {
        ...cloned.slots,
        ...(overrides.slots || {}),
        associated_symptoms: [
          ...(cloned.slots.associated_symptoms || []),
          ...(overrides.slots?.associated_symptoms || []),
        ],
        neurological_signs: [
          ...(cloned.slots.neurological_signs || []),
          ...(overrides.slots?.neurological_signs || []),
        ],
        pediatric_signs: [
          ...(cloned.slots.pediatric_signs || []),
          ...(overrides.slots?.pediatric_signs || []),
        ],
        known_facts: [
          ...(cloned.slots.known_facts || []),
          ...(overrides.slots?.known_facts || []),
        ],
      },
    };
  }

  return cloned;
}

/**
 * Validates that an interview state has not been contaminated by prior turns or clinical evidence.
 */
export function verifySessionCleanliness(state: ClinicalInterviewState): boolean {
  if (!state) return false;

  const isBasePhase = state.phase === 'dormant';
  const isBaseInfo = state.informationState === 'insufficient';
  const isBaseVersion = state.caseVersion === 1;
  const noKnownFacts = Array.isArray(state.slots?.known_facts) && state.slots.known_facts.length === 0;
  const noResolvedQuestions = Array.isArray(state.resolvedQuestions) && state.resolvedQuestions.length === 0;
  const emptyTranscript = !state.cumulativeTranscript || state.cumulativeTranscript.trim() === '';

  return (
    isBasePhase &&
    isBaseInfo &&
    isBaseVersion &&
    noKnownFacts &&
    noResolvedQuestions &&
    emptyTranscript
  );
}

/**
 * Resets global and singleton session barriers between evaluation benchmark turns.
 */
export function resetSessionBarrier(): void {
  conversationManager.setPatientProfile(null);
}
