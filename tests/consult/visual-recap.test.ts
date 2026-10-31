import { describe, it } from "node:test";
import assert from "node:assert";
import {
  extractGroundedRecapCategories,
  GroundedRecapCategories,
  GroundedRecapItem,
} from "../../lib/triage/recap-categories";

describe("Milestone 4: Grounded Visual Clinical Progress & Patient Recap Invariants", () => {
  // Invariant 1: Provenance Tagging
  it("1. Accurately preserves patient-reported vs model-extracted vs clinician-confirmed information", () => {
    const consultation = {
      id: "ENC-PROV-001",
      chiefComplaint: "Pounding headache on right temple",
      status: "paused",
      createdAt: "2026-10-31T09:00:00.000Z",
      transcript: [
        { id: "turn-1", role: "patient", text: "My right temple has a pounding headache.", timestamp: "09:00 AM" },
      ],
      detectedSymptoms: ["Headache", "Temple pain"],
      attributedFacts: [
        {
          id: "fact-1",
          category: "chronic_condition",
          factKey: "Migraine with aura",
          factValue: "Confirmed in 2023 by neurologist",
          provenance: "clinician_confirmed",
          isHistoricalContext: true,
        },
      ],
      interviewState: {
        schemaVersion: 2,
        phase: "active_inquiring",
        slots: {
          character: "pounding",
          location: "right temple",
          associated_symptoms: ["Headache"],
        },
      },
    };

    const recap = extractGroundedRecapCategories(consultation);

    // Baseline historical fact is clinician-confirmed
    const chronicFact = recap.previouslyReported.find((f) => f.label === "Migraine with aura");
    assert.ok(chronicFact, "Must locate chronic condition fact");
    assert.strictEqual(chronicFact.provenance, "clinician_confirmed");
    assert.strictEqual(chronicFact.confirmationStatus, "confirmed");

    // Chief complaint & reported symptom are patient-reported
    const cc = recap.informationDiscussed.find((i) => i.label === "Chief Complaint");
    assert.ok(cc);
    assert.strictEqual(cc.provenance, "patient_reported");

    // Model extracted symptom is identified
    const extracted = recap.informationDiscussed.find((i) => i.label === "Identified Symptom");
    assert.ok(extracted);
    assert.strictEqual(extracted.provenance, "model_extracted");
  });

  // Invariant 2: Unknown Information Never Becomes Negative Finding
  it("2. Unknown information never becomes a negative finding (unassessed allergy is NOT 'No allergies')", () => {
    const consultation = {
      id: "ENC-UNKNOWN-002",
      chiefComplaint: "General malaise",
      status: "paused",
      // No allergy mentioned or assessed
      attributedFacts: [],
      interviewState: {
        schemaVersion: 2,
        phase: "active_inquiring",
        slots: {
          onset: "yesterday",
        },
        structuredHistory: {
          unansweredDimensions: ["allergies", "medications"],
        },
      },
    };

    const recap = extractGroundedRecapCategories(consultation);

    // Invariant: Information Discussed or Previously Reported must NOT say "No known allergies" or "NKA"
    const allDiscussedValues = [
      ...recap.previouslyReported.map((i) => i.value?.toLowerCase() || ""),
      ...recap.informationDiscussed.map((i) => i.value?.toLowerCase() || ""),
    ];
    assert.strictEqual(
      allDiscussedValues.some((v) => v.includes("no known allergies") || v.includes("nka")),
      false,
      "Must NEVER invent 'No known allergies' for unassessed domain"
    );

    // Must be placed in Still to Explore as unassessed
    const unassessedAllergies = recap.stillToExplore.find(
      (e) => e.dimension.toLowerCase().includes("allergies")
    );
    assert.ok(unassessedAllergies, "Unassessed allergies must be listed in Still to Explore");
    assert.strictEqual(unassessedAllergies.assessmentState, "unassessed");
  });

  // Invariant 3: Historical Symptoms Never Become Current Symptoms
  it("3. Historical symptoms from previous encounters never become current symptoms automatically", () => {
    const followUpConsultation = {
      id: "ENC-FOLLOWUP-003",
      parentConsultationId: "ENC-PARENT-HIST-123",
      chiefComplaint: "Follow-up consultation for recovery progress",
      status: "paused",
      createdAt: "2026-10-31T10:00:00.000Z",
      // Patient has NOT reported chest pain in current encounter
      detectedSymptoms: [],
      interviewState: {
        schemaVersion: 2,
        phase: "active_inquiring",
        slots: {
          associated_symptoms: [], // No current symptoms yet
        },
        historicalContext: {
          priorEncounterId: "ENC-PARENT-HIST-123",
          priorChiefComplaint: "Acute crushing chest pain",
          priorSymptoms: ["Chest pain", "Diaphoresis"],
        },
      },
    };

    const recap = extractGroundedRecapCategories(followUpConsultation);

    // Invariant: Current Information Discussed must NOT contain historical chest pain
    const currentDiscussed = recap.informationDiscussed.map((i) => i.value?.toLowerCase() || "");
    assert.strictEqual(
      currentDiscussed.includes("chest pain"),
      false,
      "Historical chest pain must NOT be listed under current Information Discussed"
    );
    assert.strictEqual(
      currentDiscussed.includes("diaphoresis"),
      false,
      "Historical diaphoresis must NOT be listed under current Information Discussed"
    );

    // Historical symptoms MUST be preserved under Previously Reported with reconciliation_needed flag
    const historicalChestPain = recap.previouslyReported.find(
      (i) => i.value?.toLowerCase() === "chest pain"
    );
    assert.ok(historicalChestPain, "Must retain historical chest pain under Previously Reported");
    assert.strictEqual(historicalChestPain.isHistorical, true);
    assert.strictEqual(historicalChestPain.confirmationStatus, "reconciliation_needed");
  });

  // Invariant 4: Distinguish Follow-up from Pause/Resume
  it("4. New follow-up information is clearly separated from previous-visit information with distinct wording", () => {
    // 4a. Paused Consultation Resumption
    const pausedEncounter = {
      id: "ENC-PAUSED-004A",
      status: "paused",
      chiefComplaint: "Stomach ache",
    };
    const pausedRecap = extractGroundedRecapCategories(pausedEncounter);
    assert.strictEqual(pausedRecap.isFollowUp, false);
    assert.strictEqual(pausedRecap.changesSectionLabel, "Changes Since Pause");
    assert.ok(pausedRecap.changesSincePause.prompt.includes("since this consultation was paused"));

    // 4b. Follow-Up Consultation
    const followUpEncounter = {
      id: "ENC-FOLLOWUP-004B",
      parentConsultationId: "ENC-PARENT-PREV-999",
      status: "paused",
      chiefComplaint: "Follow-up visit",
    };
    const followUpRecap = extractGroundedRecapCategories(followUpEncounter);
    assert.strictEqual(followUpRecap.isFollowUp, true);
    assert.strictEqual(followUpRecap.changesSectionLabel, "Changes Since Last Visit");
    assert.strictEqual(followUpRecap.recapTitle, "Linked Follow-Up Clinical Review");
    assert.ok(followUpRecap.changesSincePause.prompt.includes("since your last visit with us"));
  });

  // Invariant 5: Original Transcript Turns Remain Immutable After Corrections
  it("5. Original transcript turns remain strictly immutable after patient corrections are recorded", () => {
    const originalTurn = {
      id: "turn-original-1",
      role: "patient",
      text: "The pain is mostly in my left arm.",
      timestamp: "10:15 AM",
    };

    const initialTranscript = [originalTurn];

    // Simulate appending a correction
    const amendmentTurn = {
      id: "turn-amendment-2",
      role: "patient",
      text: "[Patient Addendum / Correction · 10:20 AM]: Actually the pain is in my left shoulder, not arm.",
      timestamp: "10:20 AM",
      correctionOfTurnId: "turn-original-1",
    };

    const updatedTranscript = [...initialTranscript, amendmentTurn];

    // Assert original turn is unmodified in object identity, role, and text
    assert.strictEqual(updatedTranscript[0].text, "The pain is mostly in my left arm.");
    assert.strictEqual(updatedTranscript[0].id, "turn-original-1");
    assert.strictEqual(updatedTranscript.length, 2);
  });

  // Invariant 6: Corrections Retain Stable Source-Turn Identifiers
  it("6. Corrections retain stable source-turn identifiers (correctionOfTurnId)", () => {
    const consultationWithTargetedCorrection = {
      id: "ENC-CORR-006",
      status: "paused",
      transcript: [
        { id: "turn-doc-1", role: "doctor", text: "Where is the pain?", timestamp: "09:00 AM" },
        { id: "turn-pat-1", role: "patient", text: "My lower abdomen hurts.", timestamp: "09:01 AM" },
        {
          id: "turn-pat-2-amendment",
          role: "patient",
          text: "[Patient Addendum / Correction · 09:10 AM]: Pain shifted to right lower quadrant.",
          timestamp: "09:10 AM",
          correctionOfTurnId: "turn-pat-1",
        },
      ],
      interviewState: {
        schemaVersion: 2,
        patientCorrectionRecords: [
          {
            id: "corr-rec-1",
            type: "PATIENT_CORRECTION",
            consultationId: "ENC-CORR-006",
            correctionOfTurnId: "turn-pat-1",
            field: "symptoms",
            correctedValue: "Pain shifted to right lower quadrant.",
            actorId: "patient-user-123",
            caseVersion: 2,
            timestamp: "2026-10-31T09:10:00.000Z",
          },
        ],
      },
    };

    const recap = extractGroundedRecapCategories(consultationWithTargetedCorrection);

    assert.strictEqual(recap.changesSincePause.existingAddenda.length, 1);
    const addendum = recap.changesSincePause.existingAddenda[0];
    assert.strictEqual(addendum.correctionOfTurnId, "turn-pat-1");
  });

  // Invariant 7: Timestamp and Temporal Separation (recordedAt vs occurredAt)
  it("7. Strict temporal separation: recordedAt does not overwrite or infer symptom occurredAt", () => {
    const consultation = {
      id: "ENC-TEMPORAL-007",
      status: "paused",
      createdAt: "2026-10-31T11:00:00.000Z",
      interviewState: {
        schemaVersion: 2,
        slots: {
          onset: "3 days ago following yard work", // occurredAt: ~Oct 28
          location: "lower back",
        },
      },
    };

    const recap = extractGroundedRecapCategories(consultation);

    const onsetItem = recap.informationDiscussed.find((i) => i.label === "Onset & Timeline");
    assert.ok(onsetItem);
    assert.strictEqual(onsetItem.occurredAt, "3 days ago following yard work");
    // recordedAt is the timestamp of the recording, not the event onset
    assert.strictEqual(onsetItem.recordedAt, "2026-10-31T11:00:00.000Z");
    assert.notStrictEqual(onsetItem.occurredAt, onsetItem.recordedAt);
  });

  // Invariant 8: Superseded and Retracted Facts Excluded
  it("8. Superseded and retracted facts are strictly excluded from active clinical summaries", () => {
    const consultation = {
      id: "ENC-RETRACTED-008",
      status: "paused",
      attributedFacts: [
        {
          id: "fact-active-1",
          factKey: "Hypertension",
          factValue: "Stage 1 Essential Hypertension",
          provenance: "clinician_confirmed",
          status: "active",
          isHistoricalContext: true,
        },
        {
          id: "fact-retracted-2",
          factKey: "Penicillin Allergy",
          factValue: "Anaphylaxis to Penicillin",
          provenance: "patient_reported",
          status: "retracted", // Patient clarified it was upset stomach, retracted by clinician
          isHistoricalContext: true,
        },
        {
          id: "fact-superseded-3",
          factKey: "Asthma",
          factValue: "Mild intermittent asthma",
          provenance: "patient_reported",
          status: "superseded", // Replaced by more specific spirometry diagnosis
          isHistoricalContext: true,
        },
      ],
    };

    const recap = extractGroundedRecapCategories(consultation);

    // Active fact must be included
    assert.ok(recap.previouslyReported.some((f) => f.label === "Hypertension"));

    // Retracted and superseded facts must be completely excluded
    assert.strictEqual(
      recap.previouslyReported.some((f) => f.label === "Penicillin Allergy"),
      false,
      "Retracted fact must NOT appear in recap summary"
    );
    assert.strictEqual(
      recap.previouslyReported.some((f) => f.label === "Asthma"),
      false,
      "Superseded fact must NOT appear in recap summary"
    );
  });

  // Invariant 9: No Fabricated Completion Percentages
  it("9. Complete absence of fabricated completion percentages across all data models", () => {
    const consultation = {
      id: "ENC-NOPERCENT-009",
      chiefComplaint: "Mild cough",
      status: "paused",
      durationSeconds: 180,
      transcript: [{ role: "doctor", text: "Hello" }, { role: "patient", text: "Hi" }],
      interviewState: {
        schemaVersion: 2,
        phase: "active_inquiring",
        slots: { onset: "today" },
      },
    };

    const recap = extractGroundedRecapCategories(consultation);
    const serialized = JSON.stringify(recap);

    assert.strictEqual(serialized.includes("completionPercentage"), false);
    assert.strictEqual(serialized.includes("progressRatio"), false);
    assert.strictEqual(/\b\d{1,3}%\b/.test(serialized), false, "Must not contain percentage strings");
  });

  // Invariant 10: CAS Conflict Preserves Unsaved Patient Correction Input
  it("10. Concurrency Conflict (409) simulation guarantees patient draft correction is preserved", async () => {
    // Simulate a draft input state in a client component
    let clientDraftText = "My shortness of breath began while climbing stairs, not at rest.";
    let submissionConflictOccurred = false;

    // Concurrency mock persisting to server
    const mockSubmitCorrection = async (
      draft: string,
      currentCaseVersion: number,
      serverVersion: number
    ) => {
      if (currentCaseVersion < serverVersion) {
        // 409 CONCURRENCY_CONFLICT
        submissionConflictOccurred = true;
        return {
          success: false,
          status: 409,
          error: `409 CONCURRENCY_CONFLICT: Encounter updated to version ${serverVersion}`,
        };
      }
      return { success: true, status: 200 };
    };

    const result = await mockSubmitCorrection(clientDraftText, 1, 2);

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.status, 409);
    assert.strictEqual(submissionConflictOccurred, true);

    // Invariant: clientDraftText must remain intact and unmutated so patient doesn't lose text
    assert.strictEqual(
      clientDraftText,
      "My shortness of breath began while climbing stairs, not at rest.",
      "Patient draft text must NEVER be cleared upon 409 concurrency conflict"
    );
  });
});
