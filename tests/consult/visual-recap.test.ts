import { describe, it } from "node:test";
import assert from "node:assert";
import {
  extractGroundedRecapCategories,
  GroundedRecapCategories,
  GroundedRecapItem,
} from "../../lib/triage/recap-categories";

describe("Milestone 4: Grounded Visual Clinical Progress & Patient Recap Invariants", () => {
  it("1. Accurately extracts and categorizes grounded clinical domains without fake percentages", () => {
    const mockConsultation = {
      id: "ENC-TEST-M4-001",
      patientName: "Jane Doe",
      chiefComplaint: "Severe throbbing headache with photophobia",
      status: "paused",
      createdAt: "2026-10-31T09:30:00.000Z",
      durationSeconds: 145,
      transcript: [
        { role: "doctor", text: "When did your headache start?", timestamp: "09:30 AM" },
        { role: "patient", text: "It started suddenly about 3 hours ago.", timestamp: "09:31 AM" },
        { role: "doctor", text: "Are you feeling sensitive to bright light?", timestamp: "09:31 AM" },
        { role: "patient", text: "Yes, lights make it much worse.", timestamp: "09:32 AM" },
      ],
      detectedSymptoms: ["Headache", "Photophobia"],
      attributedFacts: [
        {
          id: "fact-hist-1",
          category: "chronic_condition",
          factKey: "Migraine history",
          factValue: "Diagnosed with episodic migraine in 2024",
          provenance: "clinician_confirmed",
          isHistoricalContext: true,
        },
      ],
      interviewState: {
        schemaVersion: 2,
        phase: "active_inquiring",
        caseVersion: 2,
        slots: {
          onset: "3 hours ago",
          onset_pattern: "sudden",
          character: "throbbing",
          location: "unilateral frontal",
          associated_symptoms: ["Photophobia"],
          known_facts: ["Takes sumatriptan as needed"],
        },
        resolvedQuestions: [
          {
            questionId: "q-light-sens",
            askedBy: "Attending Neurologist",
            question: "Are you feeling sensitive to bright light?",
            patientAnswer: "Yes, lights make it much worse.",
            resolvedSlot: "associated_symptoms",
            slotValue: "Photophobia",
          },
        ],
        structuredHistory: {
          chiefComplaint: "Severe throbbing headache with photophobia",
          timeline: { anchor: "3 hours ago", isSudden: true },
          unansweredDimensions: ["radiation", "nausea_vomiting", "neck_stiffness"],
        },
      },
    };

    const recap: GroundedRecapCategories = extractGroundedRecapCategories(mockConsultation);

    // Invariant 1: Four distinct grounded categories exist
    assert.ok(recap.previouslyReported, "Previously Reported category must exist");
    assert.ok(recap.informationDiscussed, "Information Discussed category must exist");
    assert.ok(recap.stillToExplore, "Still to Explore category must exist");
    assert.ok(recap.changesSincePause, "Changes Since Pause category must exist");

    // Invariant 2: Previously Reported contains historical facts with provenance
    assert.strictEqual(recap.previouslyReported.length, 1);
    assert.strictEqual(recap.previouslyReported[0].label, "Migraine history");
    assert.strictEqual(recap.previouslyReported[0].provenance, "clinician_confirmed");

    // Invariant 3: Information Discussed captures chief complaint, slots, and symptoms
    const labels = recap.informationDiscussed.map((item) => item.label);
    assert.ok(labels.includes("Chief Complaint"), "Must include chief complaint");
    assert.ok(labels.includes("Onset & Timeline"), "Must include onset");
    assert.ok(labels.includes("Symptom Quality / Character"), "Must include character");
    assert.ok(labels.includes("Location"), "Must include location");

    // Verify all items have valid provenance tags
    for (const item of recap.informationDiscussed) {
      assert.ok(
        ["patient_reported", "model_extracted", "clinician_confirmed", "parent_encounter"].includes(
          item.provenance
        ),
        `Item ${item.label} must have valid clinical provenance, got ${item.provenance}`
      );
    }

    // Invariant 4: Still to Explore captures unanswered dimensions and unassessed slots
    const exploreDimensions = recap.stillToExplore.map((e) => e.dimension.toLowerCase());
    assert.ok(exploreDimensions.some((d) => d.includes("neck stiffness")), "Must note unassessed neck stiffness");
    assert.ok(exploreDimensions.some((d) => d.includes("severity") || d.includes("intensity")), "Must note missing severity slot");

    // Invariant 5: Anti-pattern guard - strictly NO fake percentage metrics in object
    const serialized = JSON.stringify(recap);
    assert.strictEqual(
      serialized.includes("completionPercentage"),
      false,
      "Must NOT contain fake completionPercentage"
    );
    assert.strictEqual(
      serialized.includes("progressRatio"),
      false,
      "Must NOT contain fake progressRatio"
    );
    assert.strictEqual(
      /\b\d{1,3}%\b/.test(serialized),
      false,
      "Must NOT contain fabricated percentage strings (e.g. 75%)"
    );
  });

  it("2. Handles follow-up encounters with parent encounter provenance in Previously Reported", () => {
    const followUpConsultation = {
      id: "ENC-FOLLOWUP-002",
      parentConsultationId: "ENC-PARENT-001",
      patientName: "John Smith",
      chiefComplaint: "Follow-up for persistent knee swelling",
      status: "paused",
      createdAt: "2026-10-31T10:00:00.000Z",
      durationSeconds: 60,
      transcript: [],
      detectedSymptoms: ["Knee swelling"],
      interviewState: {
        schemaVersion: 2,
        phase: "active_inquiring",
        caseVersion: 1,
        slots: {
          location: "Right knee",
          associated_symptoms: ["Joint warmth"],
        },
        historicalContext: {
          priorEncounterId: "ENC-PARENT-001",
          provenance: "parent_encounter_history",
          priorChiefComplaint: "Acute right knee effusion after sporting injury",
          priorDiagnoses: ["Meniscal tear suspect"],
        },
      },
    };

    const recap = extractGroundedRecapCategories(followUpConsultation);

    // Should include parent encounter context in Previously Reported with parent_encounter provenance
    const prevItems = recap.previouslyReported;
    assert.ok(prevItems.length >= 1, "Must contain previously reported facts from parent encounter");
    assert.strictEqual(prevItems[0].provenance, "parent_encounter");
    assert.strictEqual(prevItems[0].sourceEncounterId, "ENC-PARENT-001");
  });

  it("3. Extracts existing patient addenda from transcript into Changes Since Pause", () => {
    const consultationWithAddendum = {
      id: "ENC-ADDENDUM-003",
      patientName: "Alex Roe",
      chiefComplaint: "Right flank pain",
      status: "paused",
      createdAt: "2026-10-31T08:00:00.000Z",
      durationSeconds: 120,
      transcript: [
        { role: "doctor", text: "Does the pain radiate to the groin?", timestamp: "08:01 AM" },
        { role: "patient", text: "No, staying in the flank.", timestamp: "08:02 AM" },
        {
          role: "patient",
          text: "[Patient Addendum / Correction · 08:15 AM]: Pain has now started spreading towards the lower abdomen.",
          timestamp: "08:15 AM",
        },
      ],
      detectedSymptoms: ["Flank pain"],
      interviewState: {
        schemaVersion: 2,
        phase: "active_inquiring",
        caseVersion: 2,
        slots: {
          location: "Right flank",
        },
      },
    };

    const recap = extractGroundedRecapCategories(consultationWithAddendum);

    assert.strictEqual(recap.changesSincePause.existingAddenda.length, 1);
    assert.ok(recap.changesSincePause.existingAddenda[0].text.includes("spreading towards the lower abdomen"));
  });

  it("4. Gracefully degrades on minimal / sparse consultation record without crashing", () => {
    const minimalConsultation = {
      id: "ENC-MINIMAL-004",
      status: "paused",
    };

    const recap = extractGroundedRecapCategories(minimalConsultation);

    assert.ok(Array.isArray(recap.previouslyReported));
    assert.ok(Array.isArray(recap.informationDiscussed));
    assert.ok(Array.isArray(recap.stillToExplore));
    assert.ok(recap.stillToExplore.length > 0, "Sparse consultation should list essential unexplored dimensions");
    assert.ok(recap.changesSincePause.prompt.length > 0);
  });
});
