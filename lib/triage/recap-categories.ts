/**
 * Grounded Clinical Recap Categorization Engine
 *
 * Derives factual, grounded clinical progress categories from persisted
 * consultation records and interview states.
 *
 * Invariants:
 * 1. Strictly eliminates synthetic or unvalidated percentage completeness
 *    metrics (e.g. "75% complete") in favor of clinically grounded categories.
 * 2. Excludes superseded and retracted facts from active summaries.
 * 3. Historical symptoms and baseline diagnoses from prior encounters remain
 *    strictly partitioned under Previously Reported and NEVER become current findings.
 * 4. Distinguishes historical/unconfirmed medications from active medications.
 * 5. Unknown or unassessed clinical domains (e.g. allergies, family history)
 *    are NEVER rendered as negative findings (e.g. unassessed allergy is NOT "No allergies").
 * 6. Distinguishes Resume ("Changes Since Pause") from Linked Follow-Up ("Changes Since Last Visit").
 * 7. Distinguishes occurredAt (event onset time) from recordedAt (dialogue recording time).
 */

export type GroundedRecapProvenance =
  | "patient_reported"
  | "model_extracted"
  | "clinician_confirmed"
  | "parent_encounter"
  | "historical_record";

export interface GroundedRecapItem {
  id: string;
  label: string;
  value?: string;
  domain?: string;
  provenance: GroundedRecapProvenance;
  confirmationStatus?: "unconfirmed" | "confirmed" | "reconciliation_needed";
  recordedAt?: string;
  occurredAt?: string;
  sourceEncounterId?: string;
  isHistorical?: boolean;
}

export interface StillToExploreDimension {
  id: string;
  dimension: string;
  clinicalRationale: string;
  domain: string;
  assessmentState: "unassessed" | "partially_assessed" | "unknown";
}

export interface GroundedRecapCategories {
  isFollowUp: boolean;
  recapTitle: string;
  recapSubtitle: string;
  changesSectionLabel: string;
  previouslyReported: GroundedRecapItem[];
  informationDiscussed: GroundedRecapItem[];
  stillToExplore: StillToExploreDimension[];
  changesSincePause: {
    sectionLabel: string;
    prompt: string;
    existingAddenda: Array<{
      id: string;
      text: string;
      timestamp: string;
      correctionOfTurnId?: string;
    }>;
  };
}

/**
 * Maps raw slot key to a clinical dimension label
 */
function formatSlotLabel(slotKey: string): string {
  const map: Record<string, string> = {
    onset: "Onset & Timeline",
    onset_pattern: "Onset Pattern",
    duration: "Episode Duration",
    character: "Symptom Quality / Character",
    location: "Location",
    radiation: "Radiation / Spread",
    severity: "Severity & Intensity",
    baseline_severity: "Baseline Severity",
    peak_severity: "Peak Severity",
    laterality: "Laterality",
  };
  return map[slotKey] || slotKey.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
}

/**
 * Extracts the 4 grounded clinical categories from a consultation object
 */
export function extractGroundedRecapCategories(consultation: any): GroundedRecapCategories {
  if (!consultation || typeof consultation !== "object") {
    consultation = {};
  }

  const interviewState = consultation.interviewState || {};
  const slots = interviewState.slots || {};
  const structuredHistory = interviewState.structuredHistory || {};
  const historicalContext = interviewState.historicalContext || {};
  const attributedFacts: any[] = Array.isArray(consultation.attributedFacts)
    ? consultation.attributedFacts
    : [];
  const transcript: any[] = Array.isArray(consultation.transcript) ? consultation.transcript : [];
  const detectedSymptoms: string[] = Array.isArray(consultation.detectedSymptoms)
    ? consultation.detectedSymptoms
    : [];

  // Determine workflow: Follow-Up encounter vs Resumed Paused encounter
  const isFollowUp = Boolean(
    consultation.parentConsultationId ||
    consultation.isFollowUp ||
    historicalContext.priorEncounterId ||
    historicalContext.is_follow_up
  );

  const changesSectionLabel = isFollowUp ? "Changes Since Last Visit" : "Changes Since Pause";
  const recapTitle = isFollowUp ? "Linked Follow-Up Clinical Review" : "Consultation Recap";
  const recapSubtitle = isFollowUp
    ? "Review baseline findings from your previous visit and identify what has evolved."
    : "Here is the grounded clinical recap of your intake. Review what was discussed and what remains to be explored.";
  const changesPrompt = isFollowUp
    ? "Has anything changed regarding your health, symptoms, or medications since your last visit with us? You can record an amendment before continuing."
    : "Has your condition, pain, or discomfort intensified, spread, or changed since this consultation was paused? You can record an amendment before resuming voice mode.";

  // =========================================================================
  // 1. Previously Reported (Longitudinal history, chronic conditions, parent encounter)
  // Invariants:
  // - Exclude superseded or retracted facts.
  // - Distinguish historical medications from active confirmed medications.
  // - Never assume unassessed facts are negative findings.
  // =========================================================================
  const previouslyReported: GroundedRecapItem[] = [];

  // 1a. Attributed longitudinal facts (filtering out retracted/superseded)
  for (const fact of attributedFacts) {
    // Invariant: Exclude superseded and retracted facts
    if (
      fact.status === "superseded" ||
      fact.status === "retracted" ||
      fact.isRetracted ||
      fact.isSuperseded ||
      fact.active === false
    ) {
      continue;
    }

    if (
      fact.isHistoricalContext ||
      fact.source === "parent_encounter" ||
      fact.category === "chronic_condition" ||
      fact.category === "allergy" ||
      fact.category === "medication"
    ) {
      let label = fact.factKey || fact.domain || "Historical Health Fact";
      let confirmationStatus: GroundedRecapItem["confirmationStatus"] =
        fact.provenance === "clinician_confirmed" ? "confirmed" : "unconfirmed";

      // Distinguish historical/prior medication from active confirmed medication
      if (fact.category === "medication") {
        if (fact.isCurrentMedication === false || fact.status === "historical" || fact.historicalOnly) {
          label = `Prior Medication (Historical / Unconfirmed Current)`;
          confirmationStatus = "reconciliation_needed";
        } else if (fact.provenance !== "clinician_confirmed") {
          label = `Reported Medication (Unconfirmed Current)`;
          confirmationStatus = "unconfirmed";
        } else {
          label = `Active Medication`;
        }
      }

      previouslyReported.push({
        id: fact.id || `fact-${previouslyReported.length + 1}`,
        label,
        value: fact.factValue || fact.value || String(fact),
        domain: fact.domain || fact.category || "medical_history",
        provenance: (fact.provenance as GroundedRecapProvenance) || "clinician_confirmed",
        confirmationStatus,
        recordedAt: fact.recordedAt || fact.createdAt,
        occurredAt: fact.occurredAt || fact.onset || "Historical baseline (prior to intake)",
        sourceEncounterId: fact.sourceEncounterId || fact.consultationId,
        isHistorical: true,
      });
    }
  }

  // 1b. Historical context from linked follow-up encounter
  if (historicalContext.priorEncounterId || consultation.parentConsultationId) {
    const parentId = historicalContext.priorEncounterId || consultation.parentConsultationId;
    if (historicalContext.priorChiefComplaint) {
      previouslyReported.push({
        id: `prior-cc-${parentId}`,
        label: "Prior Visit Chief Complaint",
        value: historicalContext.priorChiefComplaint,
        domain: "prior_encounter",
        provenance: "parent_encounter",
        confirmationStatus: "confirmed",
        occurredAt: "Prior consultation encounter",
        sourceEncounterId: parentId,
        isHistorical: true,
      });
    }
    if (Array.isArray(historicalContext.priorDiagnoses)) {
      for (const diag of historicalContext.priorDiagnoses) {
        if (!previouslyReported.some((item) => item.value === diag)) {
          previouslyReported.push({
            id: `prior-diag-${diag}`,
            label: "Previous Clinical Assessment",
            value: diag,
            domain: "prior_diagnosis",
            provenance: "parent_encounter",
            confirmationStatus: "confirmed",
            occurredAt: "Prior clinical assessment",
            sourceEncounterId: parentId,
            isHistorical: true,
          });
        }
      }
    }
    // Prior reported symptoms from previous encounter (strictly historical!)
    if (Array.isArray(historicalContext.priorSymptoms)) {
      for (const sym of historicalContext.priorSymptoms) {
        if (!previouslyReported.some((item) => item.value === sym)) {
          previouslyReported.push({
            id: `prior-sym-${sym}`,
            label: "Prior Encounter Symptom (Requires Reconfirmation)",
            value: sym,
            domain: "historical_symptom",
            provenance: "parent_encounter",
            confirmationStatus: "reconciliation_needed",
            occurredAt: "Prior visit episode",
            sourceEncounterId: parentId,
            isHistorical: true,
          });
        }
      }
    }
  }

  // 1c. Known facts from slots if still empty
  if (previouslyReported.length === 0 && Array.isArray(slots.known_facts)) {
    for (const kf of slots.known_facts) {
      previouslyReported.push({
        id: `kf-${previouslyReported.length + 1}`,
        label: "Baseline Health Fact",
        value: kf,
        domain: "baseline",
        provenance: "patient_reported",
        confirmationStatus: "unconfirmed",
        occurredAt: "Prior baseline",
        isHistorical: true,
      });
    }
  }

  // =========================================================================
  // 2. Information Discussed (Current intake data, explored slots, symptoms)
  // Invariant: Historical symptoms from prior encounters must NEVER appear here.
  // =========================================================================
  const informationDiscussed: GroundedRecapItem[] = [];

  // Track historical values so they do not inadvertently bleed into current findings
  const historicalValuesSet = new Set(
    previouslyReported.map((item) => (item.value || "").toLowerCase())
  );

  // 2a. Current Chief Complaint
  const chiefComplaint =
    consultation.chiefComplaint ||
    structuredHistory.chiefComplaint ||
    slots.chiefComplaint;
  if (chiefComplaint) {
    informationDiscussed.push({
      id: "cc-item",
      label: "Chief Complaint",
      value: chiefComplaint,
      domain: "chief_complaint",
      provenance: "patient_reported",
      confirmationStatus: "unconfirmed",
      recordedAt: consultation.createdAt || new Date().toISOString(),
      occurredAt: slots.onset || "Reported onset prior to consultation",
    });
  }

  // 2b. Explored clinical slots in current encounter
  const trackedSlotKeys = [
    "onset",
    "onset_pattern",
    "duration",
    "character",
    "location",
    "radiation",
    "severity",
    "laterality",
  ];

  for (const key of trackedSlotKeys) {
    if (slots[key] !== undefined && slots[key] !== null && slots[key] !== "") {
      const slotVal = String(slots[key]);
      // Invariant: Do not turn missing values into negative findings
      if (slotVal.toLowerCase() === "none" || slotVal.toLowerCase() === "no") {
        // Explicitly denied symptom in current turn
        informationDiscussed.push({
          id: `slot-${key}`,
          label: formatSlotLabel(key),
          value: `Explicitly denied: ${slotVal}`,
          domain: "denied_symptom",
          provenance: "patient_reported",
          recordedAt: consultation.createdAt,
        });
      } else {
        informationDiscussed.push({
          id: `slot-${key}`,
          label: formatSlotLabel(key),
          value: slotVal,
          domain: "symptom_characteristic",
          provenance: "patient_reported",
          recordedAt: consultation.createdAt,
          occurredAt: key === "onset" ? slotVal : (slots.onset || "Unknown / Not specified"),
        });
      }
    }
  }

  // 2c. Associated symptoms discussed in CURRENT dialogue
  const associatedList = Array.isArray(slots.associated_symptoms) ? slots.associated_symptoms : [];
  for (const sym of associatedList) {
    // Invariant: If this symptom was only from a prior encounter and not freshly reported, do not duplicate as active
    if (!informationDiscussed.some((i) => i.value === sym)) {
      informationDiscussed.push({
        id: `sym-${sym}`,
        label: "Reported Symptom",
        value: sym,
        domain: "symptom",
        provenance: "patient_reported",
        recordedAt: consultation.createdAt,
        occurredAt: slots.onset || "Unknown / Not specified",
      });
    }
  }

  // 2d. Detected symptoms from classifier in current session (excluding pure historical facts)
  for (const sym of detectedSymptoms) {
    const isAlreadyInDiscussion = informationDiscussed.some(
      (i) => i.value?.toLowerCase() === sym.toLowerCase()
    );
    // Invariant: Historical symptoms from prior visits must not be automatically injected as current active findings
    const isHistoricalFact = historicalValuesSet.has(sym.toLowerCase());

    if (!isAlreadyInDiscussion && !isHistoricalFact) {
      informationDiscussed.push({
        id: `det-${sym}`,
        label: "Identified Symptom",
        value: sym,
        domain: "symptom",
        provenance: "model_extracted",
        recordedAt: consultation.createdAt,
        occurredAt: slots.onset || "Unknown / Not specified",
      });
    }
  }

  // =========================================================================
  // 3. Still to Explore (Missing triage dimensions & unassessed clinical areas)
  // Invariant: Unassessed domains are NEVER presented as negative findings.
  // =========================================================================
  const stillToExplore: StillToExploreDimension[] = [];

  // 3a. Explicit unanswered dimensions from structured history
  const unanswered = Array.isArray(structuredHistory.unansweredDimensions)
    ? structuredHistory.unansweredDimensions
    : [];
  for (const dim of unanswered) {
    const formatted = dim.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
    stillToExplore.push({
      id: `unanswered-${dim}`,
      dimension: formatted,
      clinicalRationale: `Clarify clinical course and severity of ${formatted.toLowerCase()}`,
      domain: "unanswered_dimension",
      assessmentState: "unassessed",
    });
  }

  // 3b. Missing key triage dimensions if not explored yet
  const coreDimensionsToCheck: Array<{
    slotKey: string;
    dimension: string;
    rationale: string;
  }> = [
    {
      slotKey: "severity",
      dimension: "Severity & Functional Impact",
      rationale: "Assess pain or discomfort level (1-10) and whether it limits daily activities",
    },
    {
      slotKey: "duration",
      dimension: "Duration & Temporal Trajectory",
      rationale: "Evaluate whether episode is continuous, intermittent, or progressing",
    },
    {
      slotKey: "radiation",
      dimension: "Radiation / Spatial Spread",
      rationale: "Determine if sensation travels or radiates to adjacent anatomical areas",
    },
    {
      slotKey: "onset",
      dimension: "Onset Context & Triggers",
      rationale: "Determine sudden versus gradual onset and any exertional or situational triggers",
    },
  ];

  for (const check of coreDimensionsToCheck) {
    if (
      (slots[check.slotKey] === undefined || slots[check.slotKey] === null || slots[check.slotKey] === "") &&
      !stillToExplore.some((e) => e.dimension.toLowerCase().includes(check.dimension.toLowerCase()))
    ) {
      stillToExplore.push({
        id: `missing-${check.slotKey}`,
        dimension: check.dimension,
        clinicalRationale: check.rationale,
        domain: "core_triage",
        assessmentState: "unassessed",
      });
    }
  }

  // 3c. Unassessed clinical safety domains (e.g. allergies, medical history)
  // Invariant: Never assume absence of allergy or condition is a negative finding!
  const hasAllergyAssessed = attributedFacts.some((f) => f.category === "allergy") || slots.allergies !== undefined;
  if (!hasAllergyAssessed) {
    stillToExplore.push({
      id: "unassessed-allergies",
      dimension: "Allergies & Adverse Drug Reactions",
      clinicalRationale: "Status unassessed. Must not be assumed negative without direct clinical screening.",
      domain: "clinical_safety",
      assessmentState: "unassessed",
    });
  }

  // =========================================================================
  // 4. Changes Since Pause / Last Visit (Patient addenda & prompt)
  // Invariant: Original transcript turns remain immutable; addenda preserve turn refs.
  // =========================================================================
  const existingAddenda: Array<{
    id: string;
    text: string;
    timestamp: string;
    correctionOfTurnId?: string;
  }> = [];

  // Check transcript for typed patient addenda
  for (const msg of transcript) {
    if (msg.role === "patient" && typeof msg.text === "string") {
      if (
        msg.text.startsWith("[Patient Addendum") ||
        msg.text.startsWith("[Patient Correction") ||
        msg.text.includes("Correction ·")
      ) {
        existingAddenda.push({
          id: msg.id || `addendum-${existingAddenda.length + 1}`,
          text: msg.text,
          timestamp: msg.timestamp || new Date().toISOString(),
          correctionOfTurnId: msg.correctionOfTurnId,
        });
      }
    }
  }

  // Also check patientCorrectionRecords if present on interviewState
  const corrections = Array.isArray(interviewState.patientCorrectionRecords)
    ? interviewState.patientCorrectionRecords
    : [];
  for (const corr of corrections) {
    const text = corr.correctedValue || corr.correctedStatement;
    if (text && !existingAddenda.some((a) => a.text.includes(text))) {
      existingAddenda.push({
        id: corr.id || corr.correctionId || `corr-${existingAddenda.length + 1}`,
        text: `[Patient Addendum]: ${text}`,
        timestamp: corr.timestamp || new Date().toISOString(),
        correctionOfTurnId: corr.correctionOfTurnId,
      });
    }
  }

  return {
    isFollowUp,
    recapTitle,
    recapSubtitle,
    changesSectionLabel,
    previouslyReported,
    informationDiscussed,
    stillToExplore,
    changesSincePause: {
      sectionLabel: changesSectionLabel,
      prompt: changesPrompt,
      existingAddenda,
    },
  };
}
