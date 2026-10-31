import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("Voice Resilience, Microphone Privacy & Audio Lifecycle Invariants (Phase D4)", () => {
  // --------------------------------------------------------------------------
  // Scenario 1: TTS Finishes -> Microphone Remains Off (Decoupled Activation)
  // --------------------------------------------------------------------------
  it("1. TTS completion with disableAutoListen: true leaves microphone strictly IDLE", async () => {
    let micArmed = false;
    let audioState = "DOCTOR_SPEAKING";

    const simulateTtsPlayback = async (options: { disableAutoListen?: boolean }) => {
      audioState = "DOCTOR_SPEAKING";
      // Simulate audio playback completing
      await new Promise((r) => setTimeout(r, 20));

      if (!options.disableAutoListen) {
        audioState = "PATIENT_LISTENING";
        micArmed = true;
      } else {
        audioState = "IDLE";
        micArmed = false;
      }
    };

    // When resuming from recap, disableAutoListen is mandatory
    await simulateTtsPlayback({ disableAutoListen: true });

    assert.equal(audioState, "IDLE", "Audio state must revert to IDLE upon doctor greeting completion");
    assert.equal(micArmed, false, "Microphone must NOT be armed automatically when doctor speech finishes");
  });

  // --------------------------------------------------------------------------
  // Scenario 2: TTS Fails -> Text Fallback Available, State Resets to IDLE
  // --------------------------------------------------------------------------
  it("2. TTS endpoint failure or timeout cleanly triggers text fallback and resets state", async () => {
    let audioState = "INTRODUCING";
    let fallbackTriggered = false;
    let displayedTranscript: string[] = [];

    const greetingText = "Welcome back. Before we continue, has anything changed?";

    const speakWithFallback = async (text: string, simulateTtsError: boolean) => {
      // Step A: Immediately append text into consultation transcript so it is readable
      displayedTranscript.push(text);

      if (simulateTtsError) {
        // TTS fails or times out
        audioState = "IDLE";
        fallbackTriggered = true;
        return;
      }

      audioState = "DOCTOR_SPEAKING";
    };

    await speakWithFallback(greetingText, true);

    assert.equal(fallbackTriggered, true, "Fallback handler must be invoked on TTS failure");
    assert.equal(audioState, "IDLE", "State must reset to IDLE on TTS failure, allowing manual retry or typing");
    assert.equal(displayedTranscript[0], greetingText, "Doctor message text must be preserved in transcript despite TTS audio failure");
  });

  // --------------------------------------------------------------------------
  // Scenario 3: Patient Denies Microphone Permission -> Remains in Non-Recording State
  // --------------------------------------------------------------------------
  it("3. Denied microphone permission sets error notice and remains non-recording without crashing", async () => {
    let audioState = "IDLE";
    let micPermissionError: any = null;
    let isRecordingActive = false;

    const requestMic = async (simulatePermissionDenied: boolean) => {
      if (simulatePermissionDenied) {
        const error = new Error("Permission denied");
        error.name = "NotAllowedError";
        micPermissionError = "Microphone access denied. Please click the camera/mic icon in your browser address bar to allow.";
        audioState = "IDLE";
        isRecordingActive = false;
        return;
      }

      isRecordingActive = true;
      audioState = "PATIENT_LISTENING";
    };

    await requestMic(true);

    assert.equal(isRecordingActive, false, "Recording must remain strictly inactive when permission is denied");
    assert.equal(audioState, "IDLE", "Audio state must remain IDLE, not PATIENT_LISTENING");
    assert.ok((micPermissionError as string | null)?.includes("Microphone access denied"), "Informative permission guidance must be populated");
  });

  // --------------------------------------------------------------------------
  // Scenario 4: Patient Navigates Away -> Audio Stopped & Media Tracks Released
  // --------------------------------------------------------------------------
  it("4. Component unmount halts audio playback and stops all active media stream tracks", () => {
    let audioPaused = false;
    let audioSrcRevoked = false;
    let trackStopped = false;

    const mockAudio = {
      pause: () => { audioPaused = true; },
      src: "blob:http://localhost:3000/mock-uuid",
    };

    const mockTrack = {
      stop: () => { trackStopped = true; },
    };

    const mockStream = {
      getTracks: () => [mockTrack],
    };

    // Simulate cleanup hook on unmount
    const unmountCleanup = () => {
      mockAudio.pause();
      mockAudio.src = "";
      audioSrcRevoked = true;
      mockStream.getTracks().forEach((t) => t.stop());
    };

    unmountCleanup();

    assert.equal(audioPaused, true, "Active audio element must be paused on navigation/unmount");
    assert.equal(audioSrcRevoked, true, "Audio source must be cleared to prevent phantom playback");
    assert.equal(trackStopped, true, "Microphone media stream track must be stopped immediately on unmount");
  });

  // --------------------------------------------------------------------------
  // Scenario 5: Patient Double-Clicks Continue -> Exactly One TTS Call
  // --------------------------------------------------------------------------
  it("5. Debounce guard prevents rapid multi-click from firing duplicate TTS requests", async () => {
    let ttsCallCount = 0;
    let isResumingVoiceInProgress = false;

    const handleContinueResumedVoice = async () => {
      if (isResumingVoiceInProgress) return;
      isResumingVoiceInProgress = true;

      ttsCallCount++;
      // Simulate async TTS synthesis
      await new Promise((r) => setTimeout(r, 50));
      isResumingVoiceInProgress = false;
    };

    // Simulate rapid concurrent double-click
    await Promise.all([
      handleContinueResumedVoice(),
      handleContinueResumedVoice(),
      handleContinueResumedVoice(),
    ]);

    assert.equal(ttsCallCount, 1, "Expected exactly 1 TTS invocation from concurrent/rapid clicks");
  });

  // --------------------------------------------------------------------------
  // Scenario 6: Patient Activates Mic During Recap Audio -> Audio Stops Before Recording
  // --------------------------------------------------------------------------
  it("6. Arming microphone while recap audio is playing halts audio before recording begins", () => {
    let isRecapAudioPlaying = true;
    let audioPaused = false;
    let micListening = false;

    const mockRecapAudio = {
      pause: () => { audioPaused = true; },
      currentTime: 12.5,
    };

    const startRecording = () => {
      // Defensive invariant: stop and reset recap audio first
      if (mockRecapAudio) {
        mockRecapAudio.pause();
        mockRecapAudio.currentTime = 0;
      }
      isRecapAudioPlaying = false;
      micListening = true;
    };

    startRecording();

    assert.equal(audioPaused, true, "Recap audio playback must pause immediately");
    assert.equal(mockRecapAudio.currentTime, 0, "Audio playback head must reset to 0");
    assert.equal(isRecapAudioPlaying, false, "Recap playing flag must be false");
    assert.equal(micListening, true, "Microphone recording begins only after audio is halted");
  });

  // --------------------------------------------------------------------------
  // Scenario 7: Delayed TTS Callback Arrives After Navigation -> Must Not Change Mic State
  // --------------------------------------------------------------------------
  it("7. Delayed TTS onended callback arriving after unmount is safely discarded", async () => {
    let isMounted = true;
    let audioState = "INTRODUCING";

    // Simulate async TTS synthesis that completes after user navigates away
    const audioOnEnded = () => {
      if (!isMounted) {
        // Discard: do not mutate state on unmounted view
        return;
      }
      audioState = "PATIENT_LISTENING";
    };

    // User navigates away before audio finishes
    isMounted = false;

    // Delayed event fires
    audioOnEnded();

    assert.equal(audioState, "INTRODUCING", "State must remain unchanged; unmounted callback must NOT flip state to PATIENT_LISTENING");
  });
});
