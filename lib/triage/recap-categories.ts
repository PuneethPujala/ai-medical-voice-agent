/**
 * Grounded Clinical Recap Categorization Engine
 *
 * Derives factual, grounded clinical progress categories from persisted
 * consultation records and interview states.
 *
 * Invariant: Strictly eliminates synthetic or unvalidated percentage completeness
 * metrics (e.g. "75% complete") in favor of clinically accurate, category-grounded
 * summaries:
 * 1. Previously Reported (Longitudinal & historical facts)
 * 2. Information Discussed (Explored clinical slots & symptoms)
 * 3. Still to Explore (Missing triage dimensions & unassessed areas)
 * 4. Changes Since Pause (Patient addenda & reassessment prompt)
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
  timestamp?: string;
  sourceEncounterId?: string;
}

export interface StillToExploreDimension {
  id: string;
  dimension: string;
  clinicalRationale: string;
  domain: string;
}

export interface GroundedRecapCategories {
  previouslyReported: GroundedRecapItem[];
  informationDiscussed: GroundedRecapItem[];
  stillToExplore: StillToExploreDimension[];
  changesSincePause: {
    prompt: string;
    existingAddenda: Array<{
      id: string;
      text: string;
      timestamp: string;
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

  // =========================================================================
  // 1. Previously Reported (Longitudinal history, chronic conditions, parent encounter)
  // =========================================================================
  const previouslyReported: GroundedRecapItem[] = [];

  // 1a. Attributed longitudinal facts marked as historical context
  for (const fact of attributedFacts) {
    if (
      fact.isHistoricalContext ||
      fact.source === "parent_encounter" ||
      fact.category === "chronic_condition" ||
      fact.category === "allergy" ||
      fact.category === "medication"
    ) {
      previouslyReported.push({
        id: fact.id || `fact-${previouslyReported.length + 1}`,
        label: fact.factKey || fact.domain || "Historical Health Fact",
        value: fact.factValue || fact.value || String(fact),
        domain: fact.domain || fact.category || "medical_history",
        provenance: (fact.provenance as GroundedRecapProvenance) || "clinician_confirmed",
        timestamp: fact.recordedAt || fact.createdAt,
        sourceEncounterId: fact.sourceEncounterId || fact.consultationId,
      });
    }
  }

  // 1b. Historical context from linked follow-up
  if (historicalContext.priorEncounterId || consultation.parentConsultationId) {
    const parentId = historicalContext.priorEncounterId || consultation.parentConsultationId;
    if (historicalContext.priorChiefComplaint) {
      previouslyReported.push({
        id: `prior-cc-${parentId}`,
        label: "Prior Encounter Baseline",
        value: historicalContext.priorChiefComplaint,
        domain: "prior_encounter",
        provenance: "parent_encounter",
        sourceEncounterId: parentId,
      });
    }
    if (Array.isArray(historicalContext.priorDiagnoses)) {
      for (const diag of historicalContext.priorDiagnoses) {
        previouslyReported.push({
          id: `prior-diag-${diag}`,
          label: "Previous Clinical Assessment",
          value: diag,
          domain: "prior_diagnosis",
          provenance: "parent_encounter",
          sourceEncounterId: parentId,
        });
      }
    }
    // If no explicit prior items were added, add the parent reference card
    if (previouslyReported.length === 0) {
      previouslyReported.push({
        id: `parent-ref-${parentId}`,
        label: "Linked Prior Consultation",
        value: `Follow-up to encounter ${parentId}`,
        domain: "prior_encounter",
        provenance: "parent_encounter",
        sourceEncounterId: parentId,
      });
    }
  }

  // 1c. Known facts from interviewState slots if still empty
  if (previouslyReported.length === 0 && Array.isArray(slots.known_facts)) {
    for (const kf of slots.known_facts) {
      previouslyReported.push({
        id: `kf-${previouslyReported.length + 1}`,
        label: "Baseline Health Fact",
        value: kf,
        domain: "baseline",
        provenance: "patient_reported",
      });
    }
  }

  // =========================================================================
  // 2. Information Discussed (Current intake data, explored slots, symptoms)
  // =========================================================================
  const informationDiscussed: GroundedRecapItem[] = [];

  // 2a. Chief Complaint
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
    });
  }

  // 2b. Explored clinical slots
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
      informationDiscussed.push({
        id: `slot-${key}`,
        label: formatSlotLabel(key),
        value: String(slots[key]),
        domain: "symptom_characteristic",
        provenance: "patient_reported",
      });
    }
  }

  // 2c. Associated symptoms discussed
  const associatedList = Array.isArray(slots.associated_symptoms) ? slots.associated_symptoms : [];
  for (const sym of associatedList) {
    if (!informationDiscussed.some((i) => i.value === sym)) {
      informationDiscussed.push({
        id: `sym-${sym}`,
        label: "Reported Symptom",
        value: sym,
        domain: "symptom",
        provenance: "patient_reported",
      });
    }
  }

  // 2d. Detected symptoms from classifier
  for (const sym of detectedSymptoms) {
    if (!informationDiscussed.some((i) => i.value?.toLowerCase() === sym.toLowerCase())) {
      informationDiscussed.push({
        id: `det-${sym}`,
        label: "Identified Symptom",
        value: sym,
        domain: "symptom",
        provenance: "model_extracted",
      });
    }
  }

  // =========================================================================
  // 3. Still to Explore (Missing triage dimensions & unassessed clinical areas)
  // =========================================================================
  const stillToExplore: StillToExploreDimension[] = [];

  // 3a. Explicit unanswered dimensions from clinical history
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
      });
    }
  }

  // =========================================================================
  // 4. Changes Since Pause (Patient addenda & reassurance prompt)
  // =========================================================================
  const existingAddenda: Array<{ id: string; text: string; timestamp: string }> = [];

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
      });
    }
  }

  return {
    previouslyReported,
    informationDiscussed,
    stillToExplore,
    changesSincePause: {
      prompt:
        "Has your condition, pain, or discomfort intensified, spread, or changed since this consultation was paused? You can record an amendment before resuming voice mode.",
      existingAddenda,
    },
  };
}
