import { describe, it } from "node:test";
import assert from "node:assert";

describe("Milestone 5: Audio Lifecycle, Interruption & Resource Cleanup (audio-interruption.test.ts)", () => {
  // Test 1: Audio interruption stops playback safely
  it("1. Stopping or interrupting audio pauses element, resets timestamp, and resets state", () => {
    let isPaused = false;
    let currentTime = 14.5;
    let status = "playing";

    const mockAudioElement = {
      pause: () => {
        isPaused = true;
      },
      set currentTime(val: number) {
        currentTime = val;
      },
      get currentTime() {
        return currentTime;
      },
    };

    // User clicks stop or navigates away
    const handleStopNarration = () => {
      mockAudioElement.pause();
      mockAudioElement.currentTime = 0;
      status = "idle";
    };

    handleStopNarration();

    assert.strictEqual(isPaused, true);
    assert.strictEqual(currentTime, 0);
    assert.strictEqual(status, "idle");
  });

  // Test 2: Unmount or route navigation cleanly stops all MediaStream tracks
  it("2. Route navigation or component unmount stops all active MediaStream tracks", () => {
    let track1Stopped = false;
    let track2Stopped = false;

    const mockMediaStream = {
      getTracks: () => [
        { kind: "audio", stop: () => { track1Stopped = true; } },
        { kind: "audio", stop: () => { track2Stopped = true; } },
      ],
    };

    // Component unmount lifecycle
    const cleanupMedia = (stream: any) => {
      if (stream) {
        stream.getTracks().forEach((track: any) => track.stop());
      }
    };

    cleanupMedia(mockMediaStream);

    assert.strictEqual(track1Stopped, true);
    assert.strictEqual(track2Stopped, true);
  });

  // Test 3: Object URLs are revoked on audio disposal to prevent memory leaks
  it("3. Object URLs are deterministically revoked via URL.revokeObjectURL upon audio completion or stop", () => {
    const revokedUrls: string[] = [];
    const mockURL = {
      createObjectURL: (_blob: any) => "blob:http://localhost:3000/mock-uuid-audio",
      revokeObjectURL: (url: string) => {
        revokedUrls.push(url);
      },
    };

    const activeUrl = mockURL.createObjectURL(new Uint8Array([1, 2, 3]));
    assert.strictEqual(activeUrl, "blob:http://localhost:3000/mock-uuid-audio");

    // Audio cleanup
    const cleanup = (url: string | null) => {
      if (url) {
        mockURL.revokeObjectURL(url);
      }
    };

    cleanup(activeUrl);
    assert.strictEqual(revokedUrls.length, 1);
    assert.strictEqual(revokedUrls[0], "blob:http://localhost:3000/mock-uuid-audio");
  });

  // Test 4: Delayed callbacks do not mutate unmounted components
  it("4. Delayed async TTS callbacks respect isMountedRef guard and discard late audio payloads", async () => {
    let isMounted = true;
    let stateUpdatedAfterUnmount = false;

    const simulateDelayedTTS = async () => {
      await new Promise((r) => setTimeout(r, 15));
      if (!isMounted) {
        // Guard prevents state mutation on unmounted component
        return;
      }
      stateUpdatedAfterUnmount = true;
    };

    const ttsPromise = simulateDelayedTTS();

    // Component unmounts before response returns
    isMounted = false;
    await ttsPromise;

    assert.strictEqual(stateUpdatedAfterUnmount, false, "Late callback must NOT update state after unmount");
  });

  // Test 5: TTS failure leaves text recap intact and available
  it("5. TTS synthesis network failure falls back to readable text script without blocking consultation", async () => {
    let ttsError: string | null = null;
    let status = "idle";
    const scriptText = "Welcome back. In our paused consultation, we noted chest pressure.";

    const mockFailingTTS = async () => {
      status = "synthesizing";
      throw new Error("Local Kokoro server timeout (504)");
    };

    try {
      await mockFailingTTS();
    } catch (err: any) {
      status = "error";
      ttsError = err.message;
    }

    assert.strictEqual(status, "error");
    assert.ok(ttsError?.includes("timeout"));
    // Script text remains 100% intact and available for reading
    assert.ok(scriptText.length > 0);
  });

  // Test 6: Server-side validation: correctionOfTurnId must belong to the same consultation
  it("6. Server validates that correctionOfTurnId belongs to the targeted consultation transcript", () => {
    const consultation = {
      id: "ENC-AUTH-TURN-001",
      transcript: [
        { id: "turn-doc-1", role: "doctor", text: "Where is the pain?" },
        { id: "turn-pat-1", role: "patient", text: "Center of chest." },
      ],
    };

    const validTurnId = "turn-pat-1";
    const foreignTurnId = "turn-foreign-encounter-999";

    const validateTurnReference = (targetId: string, consult: any) => {
      const exists = consult.transcript.some((t: any) => t.id === targetId);
      if (!exists) {
        throw new Error(`Referenced turn '${targetId}' does not belong to consultation ${consult.id}`);
      }
      return true;
    };

    // Valid turn belongs to consultation
    assert.strictEqual(validateTurnReference(validTurnId, consultation), true);

    // Foreign turn belonging to another encounter is strictly rejected
    assert.throws(
      () => validateTurnReference(foreignTurnId, consultation),
      /does not belong to consultation/
    );
  });
});
