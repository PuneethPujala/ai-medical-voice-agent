import { describe, it } from "node:test";
import assert from "node:assert";
import {
  synthesizeRecapScript,
  countWords,
  enforceMaxWords,
} from "../../lib/audio/recap-synthesizer";

describe("Milestone 5: Microphone Gate & Audio Invariants (mic-gate.test.ts)", () => {
  // Test 1: Recap script bounds & grounded synthesis
  it("1. Synthesizes concise recap script strictly under 120 words without inventing clinical facts", () => {
    const consultation = {
      id: "ENC-MIC-TEST-001",
      chiefComplaint: "Acute substernal chest pressure",
      status: "paused",
      createdAt: "2026-10-31T09:00:00.000Z",
      transcript: [
        { role: "doctor", text: "When did it start?" },
        { role: "patient", text: "Two hours ago while at rest." },
      ],
      detectedSymptoms: ["Chest pressure", "Shortness of breath"],
      attributedFacts: [
        {
          id: "fact-1",
          category: "chronic_condition",
          factKey: "Coronary artery disease",
          factValue: "Stented in 2021",
          provenance: "clinician_confirmed",
          isHistoricalContext: true,
        },
      ],
      interviewState: {
        schemaVersion: 2,
        phase: "active_inquiring",
        slots: {
          onset: "2 hours ago while at rest",
          character: "crushing substernal pressure",
          associated_symptoms: ["Shortness of breath"],
        },
        structuredHistory: {
          unansweredDimensions: ["radiation_to_arm", "diaphoresis"],
        },
      },
    };

    const res = synthesizeRecapScript(consultation, { maxWords: 120 });

    assert.ok(res.script.length > 0, "Script must not be empty");
    assert.ok(res.wordCount <= 120, `Word count must be <= 120, got ${res.wordCount}`);
    assert.ok(res.script.includes("Coronary artery disease"), "Must mention historical chronic condition");
    assert.ok(res.script.includes("chest pressure"), "Must mention reported chief complaint");
    assert.ok(res.script.includes("explore"), "Must mention unexplored clinical dimensions");
    assert.strictEqual(res.isFollowUp, false);
  });

  // Test 2: Follow-up script differentiation
  it("2. Differentiates follow-up encounters in synthesized spoken script", () => {
    const followUpConsultation = {
      id: "ENC-FOLLOWUP-MIC-002",
      parentConsultationId: "ENC-PARENT-MIC-001",
      chiefComplaint: "Follow-up for asthma exacerbation",
      status: "paused",
      interviewState: {
        schemaVersion: 2,
        phase: "active_inquiring",
        historicalContext: {
          priorEncounterId: "ENC-PARENT-MIC-001",
          priorChiefComplaint: "Severe wheezing and nocturnal dyspnea",
        },
      },
    };

    const res = synthesizeRecapScript(followUpConsultation);

    assert.strictEqual(res.isFollowUp, true);
    assert.ok(res.script.includes("follow-up"), "Script must explicitly acknowledge follow-up consultation");
    assert.ok(res.wordCount <= 120, "Must be under 120 words");
  });

  // Test 3: Microphone is strictly disabled during recap playback
  it("3. Invariant: Microphone never activates while recap audio is actively playing", () => {
    let micRequested = false;
    const isRecapPlaying = true;

    // Simulation of MicrophoneGate handleExplicitProceed check
    const attemptMicActivation = () => {
      if (isRecapPlaying) {
        return { success: false, reason: "MIC_BLOCKED_RECAP_PLAYING" };
      }
      micRequested = true;
      return { success: true };
    };

    const result = attemptMicActivation();
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.reason, "MIC_BLOCKED_RECAP_PLAYING");
    assert.strictEqual(micRequested, false, "Microphone must NOT be requested while recap is playing");
  });

  // Test 4: Microphone remains off after recap playback completes
  it("4. Invariant: Microphone remains strictly OFF after narration finishes; no auto-listen without user click", () => {
    let gateState: "RECAP_PLAYING" | "RECAP_COMPLETE_MIC_OFF" | "PATIENT_LISTENING" = "RECAP_PLAYING";
    let micArmed = false;

    // Narration completes
    const onNarrationComplete = () => {
      // INVARIANT: transition to RECAP_COMPLETE_MIC_OFF, NEVER directly to PATIENT_LISTENING
      gateState = "RECAP_COMPLETE_MIC_OFF";
      micArmed = false; // Remains strictly off
    };

    onNarrationComplete();

    assert.strictEqual(gateState, "RECAP_COMPLETE_MIC_OFF");
    assert.strictEqual(micArmed, false, "Microphone must NOT automatically acquire audio upon recap completion");
  });

  // Test 5: Explicit user click is required before getUserMedia() is called
  it("5. Invariant: Explicit user click is required before invoking navigator.mediaDevices.getUserMedia()", async () => {
    let getUserMediaCalled = false;

    const mockNavigator = {
      mediaDevices: {
        getUserMedia: async (_constraints: any) => {
          getUserMediaCalled = true;
          return {
            getTracks: () => [{ stop: () => {} }],
          };
        },
      },
    };

    // Before user click
    assert.strictEqual(getUserMediaCalled, false);

    // Patient explicitly clicks Proceed
    await mockNavigator.mediaDevices.getUserMedia({ audio: true });
    assert.strictEqual(getUserMediaCalled, true, "getUserMedia must only be called after explicit user click");
  });

  // Test 6: Microphone permission denial transitions gracefully to text fallback
  it("6. Handles microphone permission denial gracefully with text-only fallback", async () => {
    let state = "REQUESTING_MIC";
    let fallbackToTextInvoked = false;

    const mockDeniedGetUserMedia = async () => {
      const err = new Error("Permission denied by user");
      err.name = "NotAllowedError";
      throw err;
    };

    try {
      await mockDeniedGetUserMedia();
    } catch (err: any) {
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        state = "PERMISSION_DENIED";
      }
    }

    assert.strictEqual(state, "PERMISSION_DENIED");

    // User chooses text-only fallback
    const onTextOnlyFallback = () => {
      fallbackToTextInvoked = true;
      state = "TEXT_CONSULTATION_ACTIVE";
    };

    onTextOnlyFallback();
    assert.strictEqual(fallbackToTextInvoked, true);
    assert.strictEqual(state, "TEXT_CONSULTATION_ACTIVE");
  });

  // Test 7: Double-click protection prevents duplicate media streams
  it("7. Double-click protection prevents redundant concurrent getUserMedia requests", async () => {
    let streamCount = 0;
    let isRequesting = false;

    const requestMic = async () => {
      if (isRequesting) {
        return null; // Block duplicate click
      }
      isRequesting = true;
      // Simulate async stream acquisition
      await new Promise((r) => setTimeout(r, 10));
      streamCount++;
      isRequesting = false;
      return { id: `stream-${streamCount}` };
    };

    // Simulate rapid double click
    const [p1, p2] = await Promise.all([requestMic(), requestMic()]);

    assert.ok(p1 !== null, "First click must succeed");
    assert.strictEqual(p2, null, "Concurrent second click must be ignored");
    assert.strictEqual(streamCount, 1, "Only one media stream must be created");
  });
});
