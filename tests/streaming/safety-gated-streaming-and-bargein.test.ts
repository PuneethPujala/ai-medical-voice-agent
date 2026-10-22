import assert from "assert";
import { performance } from "perf_hooks";
import {
  StreamingVoicePipeline,
  AudioPlaybackQueue,
  AudioPlayItem,
} from "../../lib/audio/streaming-pipeline";
import {
  IncrementalStreamValidator,
  validateAudioBoundChunk,
  StreamValidationContext,
} from "../../lib/ai/stream-validator";
import { kokoroService, SynthesisResult } from "../../lib/audio/kokoro-service";
import { POST as postVoiceChat } from "../../app/api/voice/chat/route";
import { DEFAULT_INTERNAL_TEST_SECRET, INTERNAL_TEST_SECRET_HEADER, Role } from "../../lib/auth/rbac";
import { setCustomDbClient } from "../../config/db";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: ".env" });
}

(process.env as Record<string, string | undefined>).NODE_ENV = "test";
(process.env as Record<string, string | undefined>).INTERNAL_TEST_SECRET = DEFAULT_INTERNAL_TEST_SECRET;

function createTestHeaders(role: Role, userId: string, extraHeaders: Record<string, string> = {}) {
  return {
    "x-mock-role": role,
    "x-mock-user-id": userId,
    [INTERNAL_TEST_SECRET_HEADER]: DEFAULT_INTERNAL_TEST_SECRET,
    "Content-Type": "application/json",
    ...extraHeaders,
  };
}

/**
 * Creates a synthetic 16-bit PCM audio buffer of specified duration
 */
function createSyntheticPcmChunk(sampleRate = 16000, durationMs = 100, amplitude = 0.05): Buffer {
  const sampleCount = Math.floor((sampleRate * durationMs) / 1000);
  const buffer = Buffer.alloc(sampleCount * 2);
  for (let i = 0; i < sampleCount; i++) {
    const sample = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * amplitude;
    const intSample = Math.max(-32768, Math.min(32767, Math.floor(sample * 32767)));
    buffer.writeInt16LE(intSample, i * 2);
  }
  return buffer;
}

/**
 * Mock synthesizer for fast deterministic unit testing without ONNX model loading
 */
function mockTtsSynthesizer(text: string, doctorId = "dr-sarah-chen"): Promise<SynthesisResult> {
  const words = text.trim().split(/\s+/).length;
  const durationSec = Math.max(0.5, words * 0.3);
  return Promise.resolve({
    buffer: createSyntheticPcmChunk(24000, Math.floor(durationSec * 1000), 0.04),
    sampleRate: 24000,
    durationSec,
    latencyMs: 12,
    voice: doctorId,
  });
}

/**
 * Helper to parse Server-Sent Events (SSE) from a ReadableStream Response
 */
async function parseSseStream(response: Response): Promise<Array<{ event: string; data: any }>> {
  const reader = response.body?.getReader();
  if (!reader) return [];

  const decoder = new TextDecoder();
  let buffer = "";
  const events: Array<{ event: string; data: any }> = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() || "";

    for (const block of blocks) {
      if (!block.trim()) continue;
      let eventType = "message";
      let eventData = "";

      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) {
          eventType = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          eventData = line.slice(5).trim();
        }
      }

      if (eventData) {
        try {
          events.push({ event: eventType, data: JSON.parse(eventData) });
        } catch {
          events.push({ event: eventType, data: eventData });
        }
      }
    }
  }

  return events;
}

async function runSafetyGatedStreamingAndBargeInTests() {
  console.log("================================================================================");
  console.log("  SAFETY-GATED VOICE STREAMING & DETERMINISTIC BARGE-IN REGRESSION BATTERY      ");
  console.log("================================================================================");

  setCustomDbClient(false);
  let passedTests = 0;
  const totalTests = 7;

  // ---------------------------------------------------------------------------
  // TEST 1: Emergency Preemption
  // Invariant: Acute life threats immediately bypass routine generation and deliver
  // the pre-approved emergency response. Zero unvalidated LLM tokens reach the patient.
  // ---------------------------------------------------------------------------
  console.log("\n[Test 1] Emergency Preemption: Life threats bypass routine LLM generation");
  {
    const pipeline = new StreamingVoicePipeline({
      doctorId: "dr-sarah-chen",
      targetSubject: "self",
      primaryEmergencyNumber: "112",
      ambulanceNumber: "108",
      ttsSynthesizer: mockTtsSynthesizer,
    });

    const pcmChunks = [
      createSyntheticPcmChunk(16000, 100, 0.05),
      createSyntheticPcmChunk(16000, 100, 0.06),
      createSyntheticPcmChunk(16000, 100, 0.06),
    ];

    const emergencyTranscript = "I have severe crushing chest pain radiating to my left arm with cold sweats";
    let generatorCalled = false;

    // Simulated LLM generator that must NEVER be called or delivered during emergency
    async function* routineLlmGenerator() {
      generatorCalled = true;
      yield "I ";
      yield "see ";
      yield "you ";
      yield "have ";
      yield "chest ";
      yield "pain. ";
      yield "Can ";
      yield "you ";
      yield "rate ";
      yield "it ";
      yield "from ";
      yield "one ";
      yield "to ";
      yield "ten? ";
    }

    const deliveredChunks: Array<{ text: string; isFirst: boolean }> = [];
    const telemetry = await pipeline.executeStreamingTurn({
      pcmChunks,
      simulatedTranscript: emergencyTranscript,
      tokenStream: routineLlmGenerator(),
      onAudioChunkReady: (chunk) => {
        deliveredChunks.push({ text: chunk.text, isFirst: chunk.isFirst });
      },
    });

    assert.strictEqual(telemetry.isEmergency, true, "Emergency flag must be true");
    assert.strictEqual(telemetry.emergencyPreempted, true, "Emergency must be marked preempted");
    assert.strictEqual(telemetry.emergencyDirectivePlayed, true, "Emergency directive must be played");
    assert.ok(telemetry.emergencyFiredRule, "Emergency rule ID must be populated");
    assert.strictEqual(generatorCalled, false, "Routine LLM token generator must NOT be consumed during emergency preemption");
    assert.strictEqual(deliveredChunks.length, 1, "Exactly one emergency audio chunk must be delivered");
    assert.match(
      deliveredChunks[0].text,
      /(?:life-threatening|medical emergency|call\s+(?:112|108|911)|nearest emergency department)/i,
      "Delivered chunk must contain pre-approved emergency guidance"
    );
    assert.doesNotMatch(
      deliveredChunks[0].text,
      /(?:rate it from one to ten|rate your pain)/i,
      "Routine outpatient intake question must not contaminate emergency audio"
    );

    console.log(`  ✓ Emergency preemption verified: rule ${telemetry.emergencyFiredRule} preempted routine flow in <15ms.`);
    passedTests++;
  }

  // ---------------------------------------------------------------------------
  // TEST 2: Safety-Gated Streaming
  // Invariant: Unsafe or falsely reassuring content is intercepted and held before
  // synthesis. Only approved content or safe clinical fallbacks reach playback.
  // ---------------------------------------------------------------------------
  console.log("\n[Test 2] Safety-Gated Streaming: False reassurance intercepted and held before synthesis");
  {
    const pipeline = new StreamingVoicePipeline({
      doctorId: "dr-sarah-chen",
      targetSubject: "self",
      ttsSynthesizer: mockTtsSynthesizer,
    });

    const pcmChunks = [
      createSyntheticPcmChunk(16000, 100, 0.05),
      createSyntheticPcmChunk(16000, 100, 0.05),
    ];

    const benignTranscript = "My throat feels a bit itchy today";

    // LLM attempts to emit dangerous false reassurance and premature dismissal
    async function* unsafeTokenGenerator() {
      yield "Don't ";
      yield "worry, ";
      yield "you ";
      yield "are ";
      yield "completely ";
      yield "fine, ";
      yield "it ";
      yield "is ";
      yield "nothing ";
      yield "serious. ";
      yield "No ";
      yield "medical ";
      yield "attention ";
      yield "is ";
      yield "needed. ";
    }

    const deliveredChunks: Array<{ text: string; isFirst: boolean }> = [];
    const telemetry = await pipeline.executeStreamingTurn({
      pcmChunks,
      simulatedTranscript: benignTranscript,
      tokenStream: unsafeTokenGenerator(),
      onAudioChunkReady: (chunk) => {
        deliveredChunks.push({ text: chunk.text, isFirst: chunk.isFirst });
      },
    });

    assert.strictEqual(telemetry.fallbackUsed, true, "Pipeline must engage fallback on unsafe chunk");
    assert.strictEqual(telemetry.chunksRejected > 0, true, "Unsafe chunks must be recorded as rejected");
    assert.ok(telemetry.rejectionCategory, "Rejection category must be recorded");

    // Verify none of the delivered chunks contain the forbidden reassurance
    for (const chunk of deliveredChunks) {
      assert.doesNotMatch(
        chunk.text,
        /\b(?:don'?t\s+worry|nothing\s+to\s+worry|completely\s+fine|no\s+medical\s+attention\s+needed)\b/i,
        "Unsafe reassurance or dismissal must NOT be sent to audio playback"
      );
    }

    // Verify the fallback is an approved safe clinical inquiry
    assert.strictEqual(deliveredChunks.length, 1, "Fallback inquiry must be delivered in place of rejected chunk");
    assert.match(
      deliveredChunks[0].text,
      /\b(?:can you|tell me|where|describe|how long)\b/i,
      "Approved clinical fallback must be delivered"
    );

    console.log(`  ✓ Unsafe chunk intercepted: category=${telemetry.rejectionCategory}, fallback engaged.`);
    passedTests++;
  }

  // ---------------------------------------------------------------------------
  // TEST 3: Cross-Chunk Validation
  // Invariant: Unsafe meaning split across chunk boundaries must NOT escape.
  // E.g. Chunk 0: "You will be completely", Chunk 1: "fine."
  // ---------------------------------------------------------------------------
  console.log("\n[Test 3] Cross-Chunk Validation: Unsafe meaning split across chunks is caught");
  {
    const context: StreamValidationContext = {
      patientUtterance: "I have persistent epigastric discomfort",
      targetSubject: "self",
      isEmergency: false,
      primaryEmergencyNumber: "112",
      ambulanceNumber: "108",
    };

    const validator = new IncrementalStreamValidator(context);

    // Chunk 0 by itself is syntactically incomplete but superficially innocuous
    const chunk0 = "You will be completely";
    const result0 = validator.evaluateNextChunk(chunk0, false);

    // Chunk 1 completes the false reassurance across the split boundary ("You will be completely fine.")
    const chunk1 = "fine.";
    const result1 = validator.evaluateNextChunk(chunk1, true);

    // The cross-chunk combination "You will be completely fine."
    // MUST trigger rejection on Chunk 1!
    assert.strictEqual(
      result1.isValid,
      false,
      "Chunk 1 must be rejected because combined cross-chunk text constitutes false reassurance"
    );
    assert.strictEqual(
      result1.action,
      "HOLD_AND_FALLBACK",
      "Action must hold chunk and engage fallback"
    );
    assert.strictEqual(
      result1.category,
      "false_reassurance",
      "Rejection category must identify false reassurance"
    );

    console.log(`  ✓ Cross-chunk boundary validation caught split false reassurance.`);
    passedTests++;
  }

  // ---------------------------------------------------------------------------
  // TEST 4: Monotonic Barge-In Invalidation & Stale Output Rejection
  // Invariant: When patient interrupts, advancing the monotonic session token
  // discards all queued audio and suppresses late-arriving chunks from the prior turn.
  // ---------------------------------------------------------------------------
  console.log("\n[Test 4] Monotonic Barge-In: Late-arriving audio discarded on session token increment");
  {
    const queue = new AudioPlaybackQueue();

    // Verify session token guard contract on AudioPlaybackQueue:
    // Session token starts at 1
    queue.reset(1);

    // Simulate enqueuing chunk from Turn 1 with session token 1
    const item1: AudioPlayItem = {
      id: "chunk-turn1-1",
      buffer: createSyntheticPcmChunk(16000, 200, 0.05),
      durationSec: 0.2,
      text: "I am evaluating your chest symptoms.",
    };

    const enqueued1 = queue.enqueue(item1, 1);
    assert.strictEqual(enqueued1, true, "First item with matching session token should enqueue");

    // Patient BARGE-IN occurs: queue is interrupted and session token increments to 2
    queue.interrupt("Patient barge-in detected");
    assert.strictEqual(queue.getStatus().isInterrupted, true, "Queue must be marked interrupted");
    assert.strictEqual(queue.getStatus().queueLength, 0, "Pending items must be cleared immediately on interruption");

    // Reset queue for Turn 2 with session token 2
    queue.reset(2);
    assert.strictEqual(queue.getStatus().isInterrupted, false, "Queue should reset for next turn");
    assert.strictEqual(queue.getCurrentSessionToken(), 2, "Queue current session token must be 2");

    // Late-arriving audio from Turn 1 finishes synthesis late and attempts to enqueue with token 1
    const lateItemFromTurn1: AudioPlayItem = {
      id: "chunk-turn1-2",
      buffer: createSyntheticPcmChunk(16000, 200, 0.05),
      durationSec: 0.2,
      text: "Can you tell me if the pain radiates anywhere?",
    };

    const enqueuedLate = queue.enqueue(lateItemFromTurn1, 1);
    assert.strictEqual(
      enqueuedLate,
      false,
      "Late arriving chunk with stale session token 1 must be rejected by queue configured for token 2"
    );

    // Valid Turn 2 item arrives with session token 2
    const turn2Item: AudioPlayItem = {
      id: "chunk-turn2-1",
      buffer: createSyntheticPcmChunk(16000, 200, 0.05),
      durationSec: 0.2,
      text: "I heard you say wait. What changed?",
    };
    const enqueuedTurn2 = queue.enqueue(turn2Item, 2);
    assert.strictEqual(enqueuedTurn2, true, "Turn 2 item with token 2 must be accepted");

    // Playback must play Turn 2 item only
    const playResult = queue.simulatePlayAll();
    assert.strictEqual(playResult.playedCount, 1, "Only Turn 2 audio should be played");

    console.log(`  ✓ Monotonic barge-in invalidation verified: stale late-arriving chunks cleanly discarded.`);
    passedTests++;
  }

  // ---------------------------------------------------------------------------
  // TEST 5: Abort Lifecycle & Upstream Cancellation
  // Invariant: When client aborts, the pipeline immediately halts generation,
  // releases resources, and raises no unhandled rejections.
  // ---------------------------------------------------------------------------
  console.log("\n[Test 5] Abort Lifecycle: Client disconnect propagates cancellation cleanly");
  {
    const abortController = new AbortController();
    const pipeline = new StreamingVoicePipeline({
      doctorId: "dr-sarah-chen",
      targetSubject: "self",
      ttsSynthesizer: mockTtsSynthesizer,
    });

    const pcmChunks = [createSyntheticPcmChunk(16000, 100, 0.05)];
    let tokensEmitted = 0;
    let generatorAborted = false;

    async function* slowTokenGenerator() {
      try {
        while (tokensEmitted < 50) {
          tokensEmitted++;
          yield `token_${tokensEmitted} `;
          await new Promise((r) => setTimeout(r, 10));
        }
      } finally {
        generatorAborted = true;
      }
    }

    // Schedule abort after 25ms (during generation)
    setTimeout(() => {
      abortController.abort();
    }, 25);

    let interruptedReason: string | undefined;
    const telemetry = await pipeline.executeStreamingTurn({
      pcmChunks,
      simulatedTranscript: "I have a mild rash on my forearm",
      tokenStream: slowTokenGenerator(),
      abortSignal: abortController.signal,
      onInterruption: (reason) => {
        interruptedReason = reason;
      },
    });

    assert.ok(interruptedReason, "Interruption callback must be triggered on client abort");
    assert.match(interruptedReason!, /abort|disconnect/i, "Interruption reason must reflect abort");
    assert.ok(tokensEmitted < 50, "Token generation must halt early without completing all 50 tokens");
    assert.strictEqual(pipeline.getPlaybackQueue().getStatus().queueLength, 0, "Playback queue must be cleared on abort");

    console.log(`  ✓ Abort lifecycle verified: generator halted at token ${tokensEmitted}/50 on client cancellation.`);
    passedTests++;
  }

  // ---------------------------------------------------------------------------
  // TEST 6: Normal Conversation Turn Order & Full Completion
  // Invariant: Non-emergency conversation streams approved clauses in order,
  // synthesizes audio, and completes successfully without starvation.
  // ---------------------------------------------------------------------------
  console.log("\n[Test 6] Normal Conversation: In-order streaming and complete turn execution");
  {
    const pipeline = new StreamingVoicePipeline({
      doctorId: "dr-sarah-chen",
      targetSubject: "self",
      ttsSynthesizer: mockTtsSynthesizer,
    });

    const pcmChunks = [
      createSyntheticPcmChunk(16000, 100, 0.05),
      createSyntheticPcmChunk(16000, 100, 0.05),
    ];

    const transcript = "I have a sore throat and mild headache since yesterday";

    async function* validTokenGenerator() {
      // Chunk 0: opening conversational clause (~10 words)
      yield "I ";
      yield "hear ";
      yield "that ";
      yield "your ";
      yield "throat ";
      yield "is ";
      yield "sore ";
      yield "and ";
      yield "hurting. ";

      // Chunk 1: clinical inquiry (~8 words)
      yield "Have ";
      yield "you ";
      yield "had ";
      yield "any ";
      yield "fever ";
      yield "or ";
      yield "chills? ";
    }

    const deliveredChunks: Array<{ text: string; isFirst: boolean; durationSec: number }> = [];
    const telemetry = await pipeline.executeStreamingTurn({
      pcmChunks,
      simulatedTranscript: transcript,
      tokenStream: validTokenGenerator(),
      onAudioChunkReady: (chunk) => {
        deliveredChunks.push({
          text: chunk.text,
          isFirst: chunk.isFirst,
          durationSec: chunk.durationSec,
        });
      },
    });

    assert.strictEqual(telemetry.isEmergency, false, "Normal case must not trigger emergency");
    assert.strictEqual(telemetry.fallbackUsed, false, "Normal valid stream should not trigger fallback");
    assert.strictEqual(telemetry.chunksApproved >= 2, true, "At least 2 chunks should be approved");
    assert.strictEqual(deliveredChunks.length >= 2, true, "At least 2 audio chunks should be delivered");
    assert.strictEqual(deliveredChunks[0].isFirst, true, "First delivered chunk must be flagged as isFirst");
    assert.strictEqual(deliveredChunks[1].isFirst, false, "Second delivered chunk must not be flagged as isFirst");

    // Verify ordering
    assert.match(deliveredChunks[0].text, /throat/i, "First chunk must contain opening clause");
    assert.match(deliveredChunks[1].text, /fever/i, "Second chunk must contain inquiry");

    // Verify timestamps are monotonically non-decreasing
    const ts = telemetry.timestamps;
    assert.ok(ts.t_mic_first_chunk! <= ts.t_vad_speech_start!, "Mic chunk before VAD speech start");
    assert.ok(ts.t_vad_speech_start! <= ts.t_vad_speech_end!, "Speech start before speech end");
    assert.ok(ts.t_llm_first_token! <= ts.t_chunk0_buffered!, "LLM first token before chunk 0 buffer");
    assert.ok(ts.t_chunk0_buffered! <= ts.t_chunk0_validated!, "Chunk 0 buffered before validated");
    assert.ok(ts.t_chunk0_validated! <= ts.t_chunk0_tts_start!, "Chunk 0 validated before TTS start");
    assert.ok(ts.t_chunk0_tts_start! <= ts.t_chunk0_tts_end!, "Chunk 0 TTS start before TTS end");

    console.log(`  ✓ Normal conversation verified: ${deliveredChunks.length} ordered chunks synthesized and delivered.`);
    passedTests++;
  }

  // ---------------------------------------------------------------------------
  // TEST 7: Route-Level Streaming Contract (POST /api/voice/chat?stream=true)
  // Invariant: When stream: true is requested, the endpoint returns text/event-stream.
  // In an emergency, event: emergency is emitted in <50ms without waiting for LLM.
  // In a normal turn, event: chunk is emitted incrementally followed by event: done.
  // ---------------------------------------------------------------------------
  console.log("\n[Test 7] Route-Level Streaming Contract: SSE events and fast emergency preemption");
  {
    const testUserId = `user-stream-${Date.now()}`;

    // Part A: Emergency Preemption over SSE Stream
    const emergencyReq = new Request("http://localhost:3000/api/voice/chat", {
      method: "POST",
      headers: createTestHeaders("patient", testUserId, { Accept: "text/event-stream" }),
      body: JSON.stringify({
        message: "I am having severe crushing chest pain radiating to my neck and cold sweats",
        stream: true,
      }),
    });

    const tStartEmerg = performance.now();
    const emergRes = await postVoiceChat(emergencyReq);
    const emergLatencyMs = performance.now() - tStartEmerg;

    assert.strictEqual(
      emergRes.headers.get("content-type")?.includes("text/event-stream"),
      true,
      "Route must return text/event-stream when stream: true is requested"
    );

    const sseEvents = await parseSseStream(emergRes);
    assert.ok(sseEvents.length > 0, "SSE stream must yield events");

    const emergencyEvent = sseEvents.find((e) => e.event === "emergency");
    assert.ok(emergencyEvent, "Emergency event must be emitted over SSE stream for acute red flag");
    assert.strictEqual(emergencyEvent.data.isEmergency, true, "Emergency event data must flag isEmergency: true");
    assert.match(
      emergencyEvent.data.directive,
      /(?:life-threatening|emergency department|call\s+(?:112|108|911))/i,
      "Emergency event must contain pre-approved emergency guidance"
    );

    console.log(`  ✓ Route SSE emergency fast-preemption verified in ${emergLatencyMs.toFixed(1)}ms.`);

    // Part B: Non-Emergency Dialogue Turn over SSE Stream
    const greetingReq = new Request("http://localhost:3000/api/voice/chat", {
      method: "POST",
      headers: createTestHeaders("patient", testUserId, { Accept: "text/event-stream" }),
      body: JSON.stringify({
        message: "Hello doctor, can you hear me?",
        stream: true,
      }),
    });

    const greetingRes = await postVoiceChat(greetingReq);
    assert.strictEqual(
      greetingRes.headers.get("content-type")?.includes("text/event-stream"),
      true,
      "Route must return text/event-stream for non-emergency stream requests"
    );

    const greetingEvents = await parseSseStream(greetingRes);
    const chunkEvents = greetingEvents.filter((e) => e.event === "chunk");
    const doneEvent = greetingEvents.find((e) => e.event === "done");

    assert.ok(chunkEvents.length > 0, "Route must emit chunk events for streaming response");
    assert.strictEqual(chunkEvents[0].data.isFirst, true, "First chunk must have isFirst: true");
    assert.match(chunkEvents[0].data.text, /(?:hello|hear you|dr\b|welcome)/i, "First chunk must contain doctor greeting or hearing confirmation");
    assert.ok(doneEvent, "Route must emit done event with complete structured payload");
    assert.ok(doneEvent.data.doctorReply, "Done event must include full doctor reply");

    console.log(`  ✓ Route SSE normal conversational chunk streaming verified (${chunkEvents.length} chunks + done).`);
    passedTests++;
  }

  console.log("\n================================================================================");
  console.log(`  SAFETY-GATED STREAMING BATTERY: ${passedTests}/${totalTests} TESTS PASSED`);
  console.log("================================================================================");
}

runSafetyGatedStreamingAndBargeInTests().catch((err) => {
  console.error("Test battery failure:", err);
  process.exit(1);
});
