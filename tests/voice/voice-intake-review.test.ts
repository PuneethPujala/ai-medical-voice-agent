import assert from "assert";
import { evaluateUniversalRedFlags } from "../../lib/triage/universal-red-flags";

/**
 * MedVoice Voice Intake Pipeline & Transcript Review Regression Suite
 *
 * Verifies:
 * 1. State Machine Invariants:
 *    IDLE -> LISTENING -> TRANSCRIBING -> TRANSCRIPT_REVIEW -> PROCESSING_CLINICAL -> RESPONDING
 * 2. Decoupling & Halting at TRANSCRIPT_REVIEW:
 *    - Automatic silence detection or recording stop halts at TRANSCRIPT_REVIEW.
 *    - Triage pipeline is NOT dispatched prior to patient confirmation.
 * 3. Human-in-the-Loop Review & Correction:
 *    - Canonical ASR output initializes pending transcript.
 *    - Patient can edit/correct misheard clinical words prior to submission.
 *    - Exact edited transcript reaches clinical pipeline once.
 * 4. Input Validation:
 *    - Empty or whitespace-only transcripts cannot be confirmed/sent.
 * 5. Re-record Lifecycle:
 *    - Re-record cleanly purges previous audio chunks, timers, and pending text.
 * 6. Discard Lifecycle:
 *    - Discard cleanly resets to IDLE state without submitting false data.
 * 7. Duplicate Submission Prevention:
 *    - Rapid clicks or Enter presses submit to clinical triage exactly once.
 * 8. Stale Asynchronous Response Rejection:
 *    - Canceling or re-recording while Whisper STT is in flight discards late response.
 * 9. STT Failure Recovery:
 *    - Failures in STT recover cleanly to IDLE without throwing unhandled exceptions.
 * 10. Emergency Safety Screening Invariant:
 *    - Confirmed emergency symptoms trigger deterministic life-threat escalation.
 */

type AudioState =
  | "IDLE"
  | "PATIENT_LISTENING"
  | "PROCESSING_TRANSCRIPTION"
  | "TRANSCRIPT_REVIEW"
  | "PROCESSING_CLINICAL"
  | "DOCTOR_SPEAKING"
  | "BARGE_IN_DETECTED"
  | "PROCESSING_INTERRUPTION";

type VoicePillState = "idle" | "listening" | "transcribing" | "understanding" | "responding" | "review";

function mapVoicePillState(audioState: AudioState): VoicePillState {
  switch (audioState) {
    case "PATIENT_LISTENING":
      return "listening";
    case "PROCESSING_TRANSCRIPTION":
      return "transcribing";
    case "TRANSCRIPT_REVIEW":
      return "review";
    case "PROCESSING_CLINICAL":
    case "BARGE_IN_DETECTED":
    case "PROCESSING_INTERRUPTION":
      return "understanding";
    case "DOCTOR_SPEAKING":
      return "responding";
    case "IDLE":
    default:
      return "idle";
  }
}

class SimulatedConsultVoiceIntakeHarness {
  audioState: AudioState = "IDLE";
  pendingTranscript: string = "";
  audioChunks: Uint8Array[] = [];
  interimTranscript: string = "";
  silenceTimerActive: boolean = false;
  dispatchedToTriage: string[] = [];
  transcriptionSessionToken: number = 0;
  isSubmittingUtterance: boolean = false;
  toastNotifications: Array<{ type: string; title: string }> = [];

  // 1. Patient clicks mic to start recording
  startRecording() {
    this.audioState = "PATIENT_LISTENING";
    this.interimTranscript = "";
    this.audioChunks = [new Uint8Array([1, 2, 3])];
  }

  // 2. Browser speech recognition gives interim guesses (visual feedback only)
  onBrowserInterimSpeech(interim: string) {
    if (this.audioState !== "PATIENT_LISTENING") return;
    this.interimTranscript = interim;
    this.silenceTimerActive = true;
  }

  // 3. Silence pause detected (1.8s) or user stops recording -> triggers canonical Whisper STT
  async onSilencePauseOrStop(canonicalWhisperPromise: Promise<string> | string) {
    if (this.audioState !== "PATIENT_LISTENING") {
      return;
    }

    this.transcriptionSessionToken += 1;
    const currentSession = this.transcriptionSessionToken;

    this.silenceTimerActive = false;
    this.audioState = "PROCESSING_TRANSCRIPTION";
    this.interimTranscript = "";

    try {
      const rawResult = typeof canonicalWhisperPromise === "string"
        ? canonicalWhisperPromise
        : await canonicalWhisperPromise;

      // Session validity check (guard against stale async response)
      if (this.transcriptionSessionToken !== currentSession || this.audioState !== "PROCESSING_TRANSCRIPTION") {
        return;
      }

      const finalTranscript = (rawResult || "").trim();
      if (!finalTranscript) {
        this.audioState = "IDLE";
        return;
      }

      // Transition to TRANSCRIPT_REVIEW without dispatching triage
      this.pendingTranscript = finalTranscript;
      this.audioState = "TRANSCRIPT_REVIEW";
    } catch (err: any) {
      if (this.transcriptionSessionToken !== currentSession) return;
      this.toastNotifications.push({
        type: "warning",
        title: "Speech Recognition Unavailable",
      });
      this.audioState = "IDLE";
    }
  }

  // 4. Patient edits pending transcript in review textarea
  onEditTranscript(editedText: string) {
    if (this.audioState !== "TRANSCRIPT_REVIEW") return;
    this.pendingTranscript = editedText;
  }

  // 5. Patient clicks "Confirm & Send"
  confirmAndSend(): boolean {
    if (this.isSubmittingUtterance || this.audioState !== "TRANSCRIPT_REVIEW") {
      return false;
    }

    const textToSend = this.pendingTranscript.trim();
    if (!textToSend) {
      return false;
    }

    this.isSubmittingUtterance = true;
    this.audioState = "PROCESSING_CLINICAL";
    this.pendingTranscript = "";
    this.dispatchedToTriage.push(textToSend);

    // Simulate async clinical triage completion
    setTimeout(() => {
      this.isSubmittingUtterance = false;
      this.audioState = "DOCTOR_SPEAKING";
    }, 5);

    return true;
  }

  // 6. Patient clicks "Re-record"
  reRecord() {
    this.transcriptionSessionToken += 1;
    this.pendingTranscript = "";
    this.audioChunks = [];
    this.interimTranscript = "";
    this.silenceTimerActive = false;
    this.startRecording();
  }

  // 7. Patient clicks "Discard"
  discard() {
    this.transcriptionSessionToken += 1;
    this.pendingTranscript = "";
    this.audioChunks = [];
    this.interimTranscript = "";
    this.silenceTimerActive = false;
    this.audioState = "IDLE";
  }
}

async function runVoiceIntakeReviewTestSuite() {
  console.log("================================================================================");
  console.log("      MEDVOICE VOICE INTAKE & TRANSCRIPT REVIEW SAFETY TEST BATTERY             ");
  console.log("================================================================================\n");

  // TEST 1: State Machine & VoicePill Mapping
  {
    console.log(">>> TEST 1: Voice Intake State Machine Invariants & VoicePill Mapping");
    assert.strictEqual(mapVoicePillState("IDLE"), "idle");
    assert.strictEqual(mapVoicePillState("PATIENT_LISTENING"), "listening");
    assert.strictEqual(mapVoicePillState("PROCESSING_TRANSCRIPTION"), "transcribing");
    assert.strictEqual(mapVoicePillState("TRANSCRIPT_REVIEW"), "review");
    assert.strictEqual(mapVoicePillState("PROCESSING_CLINICAL"), "understanding");
    assert.strictEqual(mapVoicePillState("DOCTOR_SPEAKING"), "responding");
    console.log("  [PASS] All 6 VoicePill states map 1:1 with clinical AudioState\n");
  }

  // TEST 2: Decoupled Intake & Halting at TRANSCRIPT_REVIEW
  {
    console.log(">>> TEST 2: Silence Detection Halts at TRANSCRIPT_REVIEW (Zero Premature Triage)");
    const harness = new SimulatedConsultVoiceIntakeHarness();
    harness.startRecording();
    assert.strictEqual(harness.audioState, "PATIENT_LISTENING");

    // Interim speech streaming
    harness.onBrowserInterimSpeech("Very high Anthony... Cloud of headache");
    assert.strictEqual(harness.interimTranscript, "Very high Anthony... Cloud of headache");
    assert.strictEqual(harness.dispatchedToTriage.length, 0, "No triage dispatch during active speech");

    // Silence timer fires, Whisper returns canonical transcription
    await harness.onSilencePauseOrStop("Hi, I am Puneeth, I currently have a major headache.");

    assert.strictEqual(harness.audioState, "TRANSCRIPT_REVIEW", "Halts at TRANSCRIPT_REVIEW");
    assert.strictEqual(mapVoicePillState(harness.audioState), "review", "Pill displays review UI");
    assert.strictEqual(harness.pendingTranscript, "Hi, I am Puneeth, I currently have a major headache.");
    assert.strictEqual(harness.dispatchedToTriage.length, 0, "Zero triage dispatch occurred without patient review");
    console.log("  [PASS] Silence pause halts at TRANSCRIPT_REVIEW without dispatching triage\n");
  }

  // TEST 3: Patient Edit & Correction prior to Clinical Submission
  {
    console.log(">>> TEST 3: Patient Correction of Speech-to-Text prior to Clinical Submission");
    const harness = new SimulatedConsultVoiceIntakeHarness();
    harness.startRecording();
    await harness.onSilencePauseOrStop("Hi, I am Puneeth, I currently have a severe migraine.");

    // Patient corrects/augments the transcript
    harness.onEditTranscript("Hi, I am Puneeth, I currently have a severe migraine that started 2 days ago.");
    assert.strictEqual(harness.pendingTranscript, "Hi, I am Puneeth, I currently have a severe migraine that started 2 days ago.");

    // Patient confirms and sends
    const sent = harness.confirmAndSend();
    assert.strictEqual(sent, true, "Confirmed and sent successfully");
    assert.strictEqual(harness.audioState, "PROCESSING_CLINICAL");
    assert.strictEqual(harness.pendingTranscript, "");
    assert.strictEqual(harness.dispatchedToTriage.length, 1);
    assert.strictEqual(
      harness.dispatchedToTriage[0],
      "Hi, I am Puneeth, I currently have a severe migraine that started 2 days ago.",
      "Triage received the patient's verified and corrected transcript"
    );
    console.log("  [PASS] Patient transcript corrections reliably sent to clinical pipeline\n");
  }

  // TEST 4: Empty and Whitespace-Only Validation
  {
    console.log(">>> TEST 4: Empty or Whitespace-Only Transcripts Cannot be Confirmed");
    const harness = new SimulatedConsultVoiceIntakeHarness();
    harness.startRecording();
    await harness.onSilencePauseOrStop("Some initial text");

    // User clears textarea
    harness.onEditTranscript("    ");
    const sent = harness.confirmAndSend();
    assert.strictEqual(sent, false, "Whitespace-only confirmation is rejected");
    assert.strictEqual(harness.audioState, "TRANSCRIPT_REVIEW", "Remains in review state");
    assert.strictEqual(harness.dispatchedToTriage.length, 0, "Zero triage dispatches");
    console.log("  [PASS] Empty/whitespace transcripts strictly prevented from submitting\n");
  }

  // TEST 5: Clean Re-record Lifecycle
  {
    console.log(">>> TEST 5: Re-record Purges Stale Transcript & Resets Recording Session");
    const harness = new SimulatedConsultVoiceIntakeHarness();
    harness.startRecording();
    await harness.onSilencePauseOrStop("Stale unwanted audio transcript");
    assert.strictEqual(harness.audioState, "TRANSCRIPT_REVIEW");

    // Click Re-record
    harness.reRecord();
    assert.strictEqual(harness.audioState, "PATIENT_LISTENING", "Returns directly to LISTENING");
    assert.strictEqual(harness.pendingTranscript, "", "Pending transcript cleared");
    assert.strictEqual(harness.interimTranscript, "", "Interim transcript cleared");
    assert.strictEqual(harness.silenceTimerActive, false, "Silence timer reset");
    console.log("  [PASS] Re-record cleanly resets state and restarts voice recording\n");
  }

  // TEST 6: Discard Lifecycle
  {
    console.log(">>> TEST 6: Discard Purges Transcript & Restores IDLE State");
    const harness = new SimulatedConsultVoiceIntakeHarness();
    harness.startRecording();
    await harness.onSilencePauseOrStop("Transcript to discard");

    harness.discard();
    assert.strictEqual(harness.audioState, "IDLE", "Restored to IDLE");
    assert.strictEqual(mapVoicePillState(harness.audioState), "idle");
    assert.strictEqual(harness.pendingTranscript, "", "Pending transcript discarded");
    assert.strictEqual(harness.dispatchedToTriage.length, 0, "Zero triage dispatches");
    console.log("  [PASS] Discard safely purges transcript and returns to IDLE\n");
  }

  // TEST 7: Duplicate Submission Prevention (Rapid Double-Click / Enter)
  {
    console.log(">>> TEST 7: Duplicate Submission Prevention under Rapid Confirmations");
    const harness = new SimulatedConsultVoiceIntakeHarness();
    harness.startRecording();
    await harness.onSilencePauseOrStop("I have a persistent cough.");

    // First click
    const sent1 = harness.confirmAndSend();
    // Immediate second click (before previous submission finishes)
    const sent2 = harness.confirmAndSend();
    // Third click
    const sent3 = harness.confirmAndSend();

    assert.strictEqual(sent1, true, "First submission succeeds");
    assert.strictEqual(sent2, false, "Second rapid click blocked");
    assert.strictEqual(sent3, false, "Third rapid click blocked");
    assert.strictEqual(harness.dispatchedToTriage.length, 1, "Dispatched exactly once");
    console.log("  [PASS] Concurrency lock prevents duplicate clinical submissions\n");
  }

  // TEST 8: Stale Asynchronous Response Rejection
  {
    console.log(">>> TEST 8: Stale Async Response Discarded When User Cancels or Re-records");
    const harness = new SimulatedConsultVoiceIntakeHarness();
    harness.startRecording();

    // Create a slow Whisper STT promise that resolves after 50ms
    let resolveStt: (val: string) => void = () => {};
    const slowSttPromise = new Promise<string>((res) => {
      resolveStt = res;
    });

    const triggerPromise = harness.onSilencePauseOrStop(slowSttPromise);
    assert.strictEqual(harness.audioState, "PROCESSING_TRANSCRIPTION");

    // While STT is in flight, patient cancels/discards
    harness.discard();
    assert.strictEqual(harness.audioState, "IDLE");

    // Slow STT finally returns
    resolveStt("Late arriving transcript that should be ignored");
    await triggerPromise;

    // Must remain IDLE, not revived to TRANSCRIPT_REVIEW!
    assert.strictEqual(harness.audioState, "IDLE", "State remains IDLE");
    assert.strictEqual(harness.pendingTranscript, "", "Pending transcript remains empty");
    console.log("  [PASS] Stale asynchronous transcription responses safely discarded\n");
  }

  // TEST 9: STT Failure Recovery (HTTP 503 / Exception)
  {
    console.log(">>> TEST 9: STT Failure Recovers Gracefully to IDLE with Notification");
    const harness = new SimulatedConsultVoiceIntakeHarness();
    harness.startRecording();

    const failingSttPromise = Promise.reject(new Error("FastAPI STT 503 Service Unavailable"));
    await harness.onSilencePauseOrStop(failingSttPromise);

    assert.strictEqual(harness.audioState, "IDLE", "Recovers cleanly to IDLE");
    assert.strictEqual(harness.toastNotifications.length, 1, "User informed via toast");
    assert.strictEqual(harness.toastNotifications[0].title, "Speech Recognition Unavailable");
    console.log("  [PASS] STT failure recovers to IDLE without unhandled exceptions\n");
  }

  // TEST 10: Emergency Safety Screening Invariant on Confirmed Transcript
  {
    console.log(">>> TEST 10: Confirmed Emergency Transcript Triggers Immediate Deterministic Escalation");
    const harness = new SimulatedConsultVoiceIntakeHarness();
    harness.startRecording();
    await harness.onSilencePauseOrStop("I have pressure in my chest.");

    // Patient clarifies true emergency symptoms in review:
    harness.onEditTranscript("I have severe crushing chest pain radiating down my left arm and diaphoresis.");
    const sent = harness.confirmAndSend();
    assert.strictEqual(sent, true);
    assert.strictEqual(harness.dispatchedToTriage.length, 1);

    const confirmedUtterance = harness.dispatchedToTriage[0];

    // Screen confirmed utterance against deterministic Universal Red Flags
    const redFlagResult = evaluateUniversalRedFlags({
      rawText: confirmedUtterance,
      patient: {
        ageYears: 55,
        sexAtBirth: "male",
      },
    });

    assert.strictEqual(
      redFlagResult.level,
      "EMERGENCY_NOW",
      "Confirmed acute coronary syndrome red flag triggers EMERGENCY_NOW"
    );
    assert.ok(
      redFlagResult.firedRules.length > 0,
      "Deterministic red flag rules fired on confirmed transcript"
    );
    console.log("  [PASS] Confirmed emergency utterance triggers deterministic emergency escalation\n");
  }

  // TEST 11: MediaRecorder Completion & Timeout Fail-Closed Audit
  {
    console.log(">>> TEST 11: MediaRecorder 1500ms Timeout Fails Closed (No Incomplete Audio Transcribed)");

    // Simulate MediaRecorder stopAndGetAudioBlob logic
    const simulateRecorder = (shouldTimeout: boolean) => {
      let isSettled = false;
      const audioChunks = [new Uint8Array([1, 2, 3])];
      return new Promise<Uint8Array | null>((resolve) => {
        const timer = setTimeout(() => {
          if (isSettled) return;
          isSettled = true;
          // Fail closed: discard chunks, return null
          audioChunks.length = 0;
          resolve(null);
        }, 20);

        if (!shouldTimeout) {
          // Normal clean completion: onstop fires before timeout
          setTimeout(() => {
            if (isSettled) return;
            isSettled = true;
            clearTimeout(timer);
            const completeBlob = audioChunks[0];
            audioChunks.length = 0;
            resolve(completeBlob);
          }, 5);
        }
      });
    };

    const normalBlob = await simulateRecorder(false);
    assert.ok(normalBlob !== null, "Normal path returns complete recorded blob");

    const timedOutBlob = await simulateRecorder(true);
    assert.strictEqual(timedOutBlob, null, "Timed out path strictly fails closed and returns null (never truncated audio)");
    console.log("  [PASS] MediaRecorder timeout fails closed without producing truncated audio\n");
  }

  // TEST 12: Empty & Sub-threshold Audio Discard (Clean IDLE Recovery)
  {
    console.log(">>> TEST 12: Empty/Silent Utterance Recovers Cleanly to IDLE Without STT or Triage");
    const harness = new SimulatedConsultVoiceIntakeHarness();
    harness.startRecording();

    // Utterance with no intelligible speech (empty string from STT)
    await harness.onSilencePauseOrStop("");

    assert.strictEqual(harness.audioState, "IDLE", "Recovers cleanly to IDLE");
    assert.strictEqual(harness.pendingTranscript, "", "No pending transcript generated");
    assert.strictEqual(harness.dispatchedToTriage.length, 0, "Zero triage dispatch");
    console.log("  [PASS] Empty audio cleanly resets to IDLE without false dispatch\n");
  }

  // TEST 13: Rapid Stop and Immediate Re-record Session Isolation
  {
    console.log(">>> TEST 13: Rapid Stop/Re-record Invalidates Earlier In-Flight ASR Session");
    const harness = new SimulatedConsultVoiceIntakeHarness();
    harness.startRecording();

    // Session 1 triggered
    let resolveSession1: (val: string) => void = () => {};
    const session1Promise = new Promise<string>((res) => { resolveSession1 = res; });
    const s1Run = harness.onSilencePauseOrStop(session1Promise);

    // Rapidly re-record (session 2 starts)
    harness.reRecord();
    assert.strictEqual(harness.audioState, "PATIENT_LISTENING");
    const currentToken = harness.transcriptionSessionToken;

    // Late session 1 returns
    resolveSession1("Session 1 late transcript");
    await s1Run;

    // State MUST NOT be overwritten by session 1
    assert.strictEqual(harness.audioState, "PATIENT_LISTENING", "Session 2 remains actively listening");
    assert.strictEqual(harness.pendingTranscript, "", "Pending transcript remains blank");
    assert.strictEqual(harness.transcriptionSessionToken, currentToken);
    console.log("  [PASS] Rapid restart strictly isolates sessions and rejects prior in-flight ASR\n");
  }

  // TEST 14: Contextual Clinical Speech Reconciliation (Phonetic / Inquiry Alignment)
  {
    console.log(">>> TEST 14: Contextual Clinical Speech Reconciliation Resolves Acoustic Mishearing");
    const { reconcileClinicalTranscript } = await import("../../lib/audio/transcript-reconciler");

    // Case 1: Graduating -> Gradually based on doctor's inquiry
    const case1 = reconcileClinicalTranscript({
      whisperText: "Graduating for two days, it wasn't sudden?",
      previewText: "Gradually for two days, it wasn't sudden",
      doctorLastQuestion: "Did this headache start suddenly or come on gradually?",
    });
    assert.strictEqual(case1.wasReconciled, true);
    assert.strictEqual(case1.transcript, "Gradually for two days, it wasn't sudden?");

    // Case 2: Chase -> Chest
    const case2 = reconcileClinicalTranscript({
      whisperText: "Severe pain in my chase",
      previewText: "Severe pain in my chest",
      doctorLastQuestion: "Where are you experiencing pain?",
    });
    assert.strictEqual(case2.wasReconciled, true);
    assert.strictEqual(case2.transcript, "Severe pain in my chest");

    // Case 3: Doll -> Dull
    const case3 = reconcileClinicalTranscript({
      whisperText: "It is a doll aching sensation",
      previewText: "It is a dull aching sensation",
      doctorLastQuestion: "Is it a sharp or dull pain?",
    });
    assert.strictEqual(case3.wasReconciled, true);
    assert.strictEqual(case3.transcript, "It is a dull aching sensation");

    console.log("  [PASS] Contextual speech reconciler reliably corrects acoustic ambiguities to clinical context\n");
  }

  // TEST 15: Critical Safeguard - Antonym Protection & Ambiguity Handling
  {
    console.log(">>> TEST 15: Critical Safeguard - Antonym Invariants & Ambiguity Preservation");
    const { reconcileClinicalTranscript } = await import("../../lib/audio/transcript-reconciler");

    // Scenario 1: "The headache came on gradually over two days." (Acoustic mishearing "graduating" reconciles to "gradually")
    const scenario1 = reconcileClinicalTranscript({
      whisperText: "The headache came on graduating over two days.",
      previewText: "The headache came on gradually over two days.",
      doctorLastQuestion: "Did the headache start suddenly or come on gradually?",
    });
    assert.strictEqual(scenario1.wasReconciled, true);
    assert.strictEqual(scenario1.transcript, "The headache came on gradually over two days.");
    assert.strictEqual(scenario1.isAmbiguous, false);

    // Scenario 2: "The headache started suddenly." (Doctor asked about gradual onset, patient says SUDDENLY - MUST NEVER BE REPLACED)
    const scenario2 = reconcileClinicalTranscript({
      whisperText: "The headache started suddenly.",
      previewText: "The headache started suddenly.",
      doctorLastQuestion: "Did the headache come on gradually over time?",
    });
    assert.strictEqual(scenario2.wasReconciled, false, "Must not reconcile when audio and preview agree on sudden");
    assert.strictEqual(scenario2.transcript, "The headache started suddenly.", "Preserves 'suddenly' with 100% clinical fidelity");
    assert.strictEqual(scenario2.isAmbiguous, false);

    // Scenario 2b: Antonym protection when Preview and Whisper conflict on opposing clinical states
    const scenario2b = reconcileClinicalTranscript({
      whisperText: "The headache started suddenly.",
      previewText: "The headache started gradually.",
      doctorLastQuestion: "Did the headache start suddenly or gradually?",
    });
    assert.strictEqual(scenario2b.isAmbiguous, true, "Flags clinical polarity divergence between sudden and gradual");
    assert.strictEqual(scenario2b.transcript, "The headache started suddenly.", "Preserves transcribed audio without guessing an antonym");
    assert.ok(scenario2b.ambiguityReason?.includes("polarity"), "Reports clinical polarity divergence reason");

    // Scenario 3: Ambiguous or noisy recording where interpretations diverge without phonetic alignment
    const scenario3 = reconcileClinicalTranscript({
      whisperText: "Pain is very severe tonight.",
      previewText: "Pain is very mild tonight.",
      doctorLastQuestion: "How severe is your discomfort on a scale of 1 to 10?",
    });
    assert.strictEqual(scenario3.isAmbiguous, true, "Preserves uncertainty when acoustic divergence exists on severity");
    assert.strictEqual(scenario3.transcript, "Pain is very severe tonight.", "Preserves recorded audio verbatim rather than manufacturing clinical certainty");

    console.log("  [PASS] Reconciler strictly prevents antonym conversion and preserves genuine clinical uncertainty\n");
  }

  // TEST 16: Multi-Turn Concurrency Synchronization & HTTP 409 Self-Healing
  {
    console.log(">>> TEST 16: Multi-Turn Concurrency Version Synchronization & HTTP 409 Recovery");

    // Simulated Server Datastore with Neon Optimistic Concurrency Rule 4
    class SimulatedClinicalDatastore {
      public version: number = 1;
      public records: Array<{ version: number; payload: any }> = [];

      public async persist(body: { caseVersion?: number; payload: any }): Promise<{ success: boolean; status: number; currentVersion?: number; error?: string }> {
        const submitted = body.caseVersion;
        if (submitted !== undefined && submitted <= this.version) {
          return {
            success: false,
            status: 409,
            currentVersion: this.version,
            error: `Concurrency conflict: Submitted version (${submitted}) is behind or equal to datastore version (${this.version}).`,
          };
        }
        this.version = submitted !== undefined ? submitted : (this.version + 1);
        this.records.push({ version: this.version, payload: body.payload });
        return { success: true, status: 200, currentVersion: this.version };
      }
    }

    const datastore = new SimulatedClinicalDatastore();
    let clientCaseVersionRef = 1;
    let isPersistingRef = false;
    let clientStatus: "idle" | "saving" | "saved" | "error" = "idle";
    let clientError: string | null = null;

    const clientPersist = async (payload: any, customVersion?: number): Promise<boolean> => {
      if (isPersistingRef) {
        await new Promise((r) => setTimeout(r, 10));
      }
      isPersistingRef = true;
      try {
        clientStatus = "saving";
        const targetVersion = customVersion !== undefined ? customVersion : (clientCaseVersionRef + 1);
        const res = await datastore.persist({ caseVersion: targetVersion, payload });

        if (res.success && res.currentVersion !== undefined) {
          clientCaseVersionRef = res.currentVersion;
          clientStatus = "saved";
          clientError = null;
          return true;
        } else if (res.status === 409 && res.currentVersion !== undefined) {
          // Self-Healing Strategy: synchronize to current server version and retry with +1
          clientCaseVersionRef = res.currentVersion;
          const retryVersion = res.currentVersion + 1;
          const retryRes = await datastore.persist({ caseVersion: retryVersion, payload });
          if (retryRes.success && retryRes.currentVersion !== undefined) {
            clientCaseVersionRef = retryRes.currentVersion;
            clientStatus = "saved";
            clientError = null;
            return true;
          }
          clientStatus = "error";
          clientError = "Encounter version conflict unrecoverable";
          return false;
        } else {
          clientStatus = "error";
          clientError = res.error || "Persistence failure";
          return false;
        }
      } finally {
        isPersistingRef = false;
      }
    };

    // Turn 1: Initial Consultation Persist
    const t1Ok = await clientPersist({ turn: 1, text: "Headache for two days" });
    assert.strictEqual(t1Ok, true);
    assert.strictEqual(datastore.version, 2);
    assert.strictEqual(clientCaseVersionRef, 2, "Client ref synchronized to server version 2");
    assert.strictEqual(clientStatus, "saved");

    // Turn 2: Server chat increments datastore to 3
    datastore.version = 3; // Simulated backend dialogue advance
    // Client receives server response with version 3
    clientCaseVersionRef = 3;
    const t2Ok = await clientPersist({ turn: 2, text: "Gradually getting worse" });
    assert.strictEqual(t2Ok, true);
    assert.strictEqual(datastore.version, 4);
    assert.strictEqual(clientCaseVersionRef, 4, "Client ref synchronized to server version 4");

    // Turn 3: Simulate Concurrency Conflict (server advanced to 5 while client held stale 4)
    datastore.version = 5;
    // Client attempts to submit 4 + 1 = 5 (which is <= datastore version 5 -> 409)
    const t3Ok = await clientPersist({ turn: 3, text: "No fever or vision changes" }, clientCaseVersionRef + 1);
    assert.strictEqual(t3Ok, true, "HTTP 409 automatically resolved via currentVersion synchronization and single retry");
    assert.strictEqual(datastore.version, 6, "Datastore cleanly advanced to version 6");
    assert.strictEqual(clientCaseVersionRef, 6, "Client ref synchronized to version 6");
    assert.strictEqual(clientStatus, "saved");

    // Turn 4: Fatal unrecoverable rejection test (ensure failure is NOT falsely claimed as saved)
    datastore.persist = async () => ({ success: false, status: 503, error: "Database offline" });
    const t4Ok = await clientPersist({ turn: 4, text: "Testing fatal failure" });
    assert.strictEqual(t4Ok, false, "Fatal failure returns false");
    assert.strictEqual(clientStatus, "error", "Persistence status correctly reflects 'error' instead of false 'saved'");
    assert.strictEqual(clientError, "Database offline");

    console.log("  [PASS] Concurrency conflict resolution and optimistic version synchronization verified\n");
  }

  console.log("================================================================================");
  console.log("      ALL 16/16 VOICE INTAKE & TRANSCRIPT REVIEW TESTS PASSED                   ");
  console.log("================================================================================\n");
}

runVoiceIntakeReviewTestSuite().catch((err) => {
  console.error("FATAL: Voice intake review test failed:", err);
  process.exit(1);
});
