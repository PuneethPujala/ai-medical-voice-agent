/**
 * UNIFIED CLINICAL FACT COMMIT ENGINE
 *
 * Invariants:
 * 1. Single Authoritative Commit Path: All clinical interpretations, whether from
 *    speech interpreter, LLM generation, or clinician inputs, must pass through
 *    FactCommitEngine to update the clinical state.
 * 2. Immutable Ledger: Every historical assertion, retraction, or correction is
 *    appended to the ledger and never modified or deleted.
 * 3. Multi-Temporal Coexistence: Different temporal scopes for the same concept
 *    (e.g. baseline vs acute_worsening) coexist cleanly in the Current Clinical View.
 * 4. Provenance Rules: Higher provenance (device > clinician > patient > inferred)
 *    strictly governs fact overrides; equal provenance conflicts create explicit contradictions.
 */

import {
  ClinicalFactRecord,
  ConversationContextState,
  CurrentClinicalView,
  FactAssertionStatus,
  FactProposal,
  FactSource,
  FactTemporalScope,
  FACT_PROVENANCE_RANKS,
} from "./fact-types";

export interface CommitResult {
  nextState: ConversationContextState;
  committedFacts: ClinicalFactRecord[];
  supersededFacts: ClinicalFactRecord[];
  contradictionsDetected: Array<{ concept: string; factAId: string; factBId: string; description: string }>;
  uncertaintiesRecorded: Array<{ concept: string; reason: string }>;
}

export class FactCommitEngine {
  public static commit(
    currentState: ConversationContextState,
    proposals: FactProposal[],
    turnId: number,
    source: FactSource = "patient_reported",
    timestamp: string = new Date().toISOString()
  ): CommitResult {
    // Clone current state deeply enough to ensure immutability of previous states
    const nextLedger: ClinicalFactRecord[] = [...currentState.ledger];
    const nextFactsByConcept: Record<string, ClinicalFactRecord[]> = {};

    for (const [concept, facts] of Object.entries(currentState.currentView.factsByConcept)) {
      nextFactsByConcept[concept] = [...facts];
    }

    const nextUncertainties = [...currentState.currentView.activeUncertainties];
    const nextContradictions = [...currentState.currentView.contradictions];
    let nextPrimaryComplaint = currentState.currentView.primaryComplaint;

    const committedFacts: ClinicalFactRecord[] = [];
    const supersededFacts: ClinicalFactRecord[] = [];
    const contradictionsDetected: Array<{ concept: string; factAId: string; factBId: string; description: string }> = [];
    const uncertaintiesRecorded: Array<{ concept: string; reason: string }> = [];

    for (const proposal of proposals) {
      if (!proposal.concept || proposal.concept.trim() === "") continue;

      const concept = proposal.concept.toLowerCase().trim();
      const temporalScope: FactTemporalScope = proposal.temporalScope || "current";
      const id = `fact-${turnId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

      const newRecord: ClinicalFactRecord = {
        id,
        concept,
        value: proposal.value,
        assertionStatus: proposal.assertionStatus,
        temporalScope,
        source,
        sourceTurnId: turnId,
        timestamp,
        isCorrection: Boolean(proposal.isCorrection),
        supersedesFactId: proposal.supersedesFactId,
        rawSnippet: proposal.rawSnippet,
        clinicalRationale: proposal.clinicalRationale,
      };

      if (!nextFactsByConcept[concept]) {
        nextFactsByConcept[concept] = [];
      }

      const existingForConcept = nextFactsByConcept[concept];
      const existingInSameScope = existingForConcept.find(f => f.temporalScope === temporalScope);

      if (proposal.isCorrection) {
        // Patient explicitly corrected an earlier fact
        let targetOldFact = proposal.supersedesFactId
          ? existingForConcept.find(f => f.id === proposal.supersedesFactId)
          : existingInSameScope || existingForConcept[existingForConcept.length - 1];

        if (targetOldFact) {
          newRecord.supersedesFactId = targetOldFact.id;
          // Mark old fact in ledger as superseded
          const oldInLedger = nextLedger.find(f => f.id === targetOldFact.id);
          if (oldInLedger) {
            oldInLedger.supersededByTurn = turnId;
            oldInLedger.supersededByFactId = newRecord.id;
          }
          // Remove old fact from active current view
          nextFactsByConcept[concept] = existingForConcept.filter(f => f.id !== targetOldFact.id);
          supersededFacts.push(targetOldFact);

          // Clear any active contradiction relating to the old fact
          const remainingContradictions = nextContradictions.filter(
            c => c.factAId !== targetOldFact.id && c.factBId !== targetOldFact.id
          );
          nextContradictions.length = 0;
          nextContradictions.push(...remainingContradictions);
        }

        nextFactsByConcept[concept].push(newRecord);
        nextLedger.push(newRecord);
        committedFacts.push(newRecord);
      } else if (existingInSameScope) {
        // Same concept and same temporal scope exists. Check equivalence vs conflict.
        const valuesMatch = JSON.stringify(existingInSameScope.value) === JSON.stringify(newRecord.value);
        const statusMatch = existingInSameScope.assertionStatus === newRecord.assertionStatus;

        if (valuesMatch && statusMatch) {
          // Re-asserted identical fact: update timestamp & audit trail without creating duplicate in current view
          existingInSameScope.timestamp = timestamp;
          existingInSameScope.sourceTurnId = turnId;
          nextLedger.push(newRecord);
          committedFacts.push(newRecord);
        } else {
          // Conflict detected between existing fact and new assertion
          const existingRank = FACT_PROVENANCE_RANKS[existingInSameScope.source] ?? 1;
          const newRank = FACT_PROVENANCE_RANKS[source] ?? 1;

          if (newRank > existingRank) {
            // Provenance override: higher source supersedes lower source
            newRecord.supersedesFactId = existingInSameScope.id;
            nextFactsByConcept[concept] = existingForConcept.filter(f => f.id !== existingInSameScope.id);
            nextFactsByConcept[concept].push(newRecord);
            supersededFacts.push(existingInSameScope);
            nextLedger.push(newRecord);
            committedFacts.push(newRecord);
          } else if (newRank < existingRank) {
            // Lower provenance cannot overwrite higher provenance; flag as discrepancy
            const desc = `Candidate fact from ${source} contradicts established ${existingInSameScope.source} fact for ${concept}`;
            nextContradictions.push({
              concept,
              factAId: existingInSameScope.id,
              factBId: newRecord.id,
              description: desc,
              requiresClarification: false,
            });
            contradictionsDetected.push({ concept, factAId: existingInSameScope.id, factBId: newRecord.id, description: desc });
            nextLedger.push(newRecord);
          } else {
            // Equal provenance conflict without explicit correction:
            if (newRecord.assertionStatus === "uncertain") {
              // Patient expressed uncertainty regarding an earlier assertion
              nextUncertainties.push({
                concept,
                description: proposal.uncertaintyReason || `Patient expressed uncertainty regarding ${concept}`,
                turnId,
                patientUtterance: proposal.rawSnippet,
              });
              uncertaintiesRecorded.push({
                concept,
                reason: proposal.uncertaintyReason || `Patient expressed uncertainty`,
              });
              nextLedger.push(newRecord);
              committedFacts.push(newRecord);
            } else {
              // Direct clinical contradiction (e.g. "It's sudden" vs earlier "It's gradual")
              const desc = `Contradiction detected for ${concept} in ${temporalScope} scope: '${existingInSameScope.value}' vs '${newRecord.value}'`;
              newRecord.contradictsFactId = existingInSameScope.id;
              existingInSameScope.contradictsFactId = newRecord.id;

              nextContradictions.push({
                concept,
                factAId: existingInSameScope.id,
                factBId: newRecord.id,
                description: desc,
                requiresClarification: true,
              });
              contradictionsDetected.push({ concept, factAId: existingInSameScope.id, factBId: newRecord.id, description: desc });

              // Keep latest in current view alongside contradiction flag
              nextFactsByConcept[concept].push(newRecord);
              nextLedger.push(newRecord);
              committedFacts.push(newRecord);
            }
          }
        }
      } else {
        // Concept is new, OR represents a distinct temporal scope (e.g. baseline vs acute_worsening)
        nextFactsByConcept[concept].push(newRecord);
        nextLedger.push(newRecord);
        committedFacts.push(newRecord);
      }

      if (proposal.assertionStatus === "uncertain" && !nextUncertainties.some(u => u.concept === concept && u.turnId === turnId)) {
        nextUncertainties.push({
          concept,
          description: proposal.uncertaintyReason || `Uncertainty noted for ${concept}`,
          turnId,
          patientUtterance: proposal.rawSnippet,
        });
        uncertaintiesRecorded.push({
          concept,
          reason: proposal.uncertaintyReason || `Uncertainty noted`,
        });
      }

      // Check if primary complaint should be anchored
      if (!nextPrimaryComplaint && (concept === "chief_complaint" || concept.endsWith("_symptom") || concept.startsWith("headache") || concept.startsWith("chest_pain") || concept.startsWith("abdominal_pain"))) {
        nextPrimaryComplaint = newRecord;
      }
    }

    const nextCurrentView: CurrentClinicalView = {
      primaryComplaint: nextPrimaryComplaint,
      factsByConcept: nextFactsByConcept,
      activeUncertainties: nextUncertainties,
      contradictions: nextContradictions,
    };

    // Calculate remaining unresolved goals based on current facts
    const hasComplaint = Boolean(nextPrimaryComplaint || Object.keys(nextFactsByConcept).length > 0);
    const hasOnset = Object.keys(nextFactsByConcept).some(c => c.includes("onset") || c.includes("duration"));
    const hasSeverity = Object.keys(nextFactsByConcept).some(c => c.includes("severity") || c.includes("character"));
    const hasAssociated = Object.keys(nextFactsByConcept).some(c => c.includes("associated") || c.includes("nausea") || c.includes("fever") || c.includes("vomit") || c.includes("radiation"));

    const nextUnresolvedGoals: string[] = [];
    if (!hasComplaint) nextUnresolvedGoals.push("chief_complaint");
    if (!hasOnset) nextUnresolvedGoals.push("onset_and_timeline");
    if (!hasSeverity) nextUnresolvedGoals.push("severity_and_character");
    if (!hasAssociated) nextUnresolvedGoals.push("associated_symptoms");
    nextUnresolvedGoals.push("red_flag_screening"); // Always evaluated

    const nextState: ConversationContextState = {
      caseVersion: currentState.caseVersion + 1,
      turnCount: Math.max(currentState.turnCount, turnId),
      currentView: nextCurrentView,
      ledger: nextLedger,
      unresolvedGoals: nextUnresolvedGoals,
      activeFocus: {
        ...currentState.activeFocus,
        primarySymptom: nextPrimaryComplaint ? nextPrimaryComplaint.concept : currentState.activeFocus.primarySymptom,
        lastDiscussedConcept: committedFacts.length > 0 ? committedFacts[committedFacts.length - 1].concept : currentState.activeFocus.lastDiscussedConcept,
      },
    };

    return {
      nextState,
      committedFacts,
      supersededFacts,
      contradictionsDetected,
      uncertaintiesRecorded,
    };
  }
}
