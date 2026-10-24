import assert from "assert";
import { POST as postVoiceStt } from "../../app/api/voice/stt/route";
import { RESOURCE_LIMITS } from "../../lib/security/rate-limiter";

/**
 * Next.js Voice STT API Route (/api/voice/stt) Integration & Safety Regression Suite
 * Tests:
 * 1. Rejection of missing / empty audio files (HTTP 400)
 * 2. Rejection of oversized audio payloads > 25MB (HTTP 413)
 * 3. Graceful handling of backend service failure / offline (HTTP 503)
 * 4. Transparent forwarding of FastAPI transcription results (HTTP 200)
 * 5. Preservation of zero-fabrication safety invariant
 */
async function runVoiceSttTestSuite() {
  console.log("================================================================================");
  console.log("        MEDVOICE NEXT.JS SPEECH-TO-TEXT (/api/voice/stt) TEST BATTERY          ");
  console.log("================================================================================\n");

  // TEST 1: Rejection of empty file
  {
    console.log(">>> TEST 1: Rejection of Empty Audio File (HTTP 400)");
    const formData = new FormData();
    formData.append("file", new Blob([], { type: "audio/wav" }), "empty.wav");

    const req = new Request("http://localhost:3000/api/voice/stt", {
      method: "POST",
      body: formData,
      headers: { "x-forwarded-for": "10.0.1.1" },
    });

    const res = await postVoiceStt(req);
    assert.strictEqual(res.status, 400, "Empty audio buffer rejected with HTTP 400");
    const json = await res.json();
    assert.ok(json.error.includes("empty"), "Error message informs client that buffer is empty");
    console.log("  [PASS] Empty audio payload rejected with HTTP 400\n");
  }

  // TEST 2: Rejection of oversized audio payload (> 25MB)
  {
    console.log(">>> TEST 2: Rejection of Oversized Audio Upload (HTTP 413)");
    const oversizedBytes = new Uint8Array(RESOURCE_LIMITS.VOICE_STT_MAX_AUDIO_BYTES + 1024);
    const formData = new FormData();
    formData.append("file", new Blob([oversizedBytes], { type: "audio/wav" }), "large.wav");

    const req = new Request("http://localhost:3000/api/voice/stt", {
      method: "POST",
      body: formData,
      headers: { "x-forwarded-for": "10.0.1.2" },
    });

    const res = await postVoiceStt(req);
    assert.strictEqual(res.status, 413, "Oversized audio rejected with HTTP 413");
    const json = await res.json();
    assert.strictEqual(json.code, "PAYLOAD_TOO_LARGE", "Error code is PAYLOAD_TOO_LARGE");
    console.log("  [PASS] Oversized audio rejected with HTTP 413\n");
  }

  // TEST 3: Honest handling of offline / unavailable FastAPI microservice (HTTP 503)
  {
    console.log(">>> TEST 3: Honest Error on Backend Offline (HTTP 503, No Fabricated Text)");
    // Point FASTAPI_URL to an unreachable local port to test offline recovery
    const originalUrl = process.env.FASTAPI_URL;
    process.env.FASTAPI_URL = "http://127.0.0.1:59999"; // Non-existent port

    try {
      const validAudio = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00]); // "RIFF"
      const formData = new FormData();
      formData.append("file", new Blob([validAudio], { type: "audio/wav" }), "speech.wav");

      const req = new Request("http://localhost:3000/api/voice/stt", {
        method: "POST",
        body: formData,
        headers: { "x-forwarded-for": "10.0.1.3" },
      });

      const res = await postVoiceStt(req);
      assert.strictEqual(res.status, 503, "Offline backend returns HTTP 503");
      const json = await res.json();
      assert.ok(
        json.error.includes("failed") || json.detail?.includes("unavailable"),
        "Error message clearly states recognition failure or service unavailable"
      );
      assert.strictEqual(json.transcript, undefined, "CRITICAL SAFETY: No fabricated transcript returned");
      console.log("  [PASS] Offline service returns HTTP 503 without fabricated symptoms\n");
    } finally {
      process.env.FASTAPI_URL = originalUrl;
    }
  }

  // TEST 4: Successful response forwarding with mock fetch
  {
    console.log(">>> TEST 4: Successful STT Transcription Forwarding (HTTP 200)");
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async (input: any, init?: any) => {
      return new Response(
        JSON.stringify({
          status: "success",
          transcript: "I have had severe chest pain for twenty minutes.",
          engine: "whisper_base_en",
          is_empty: false,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    };

    try {
      const sampleAudio = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00]);
      const formData = new FormData();
      formData.append("file", new Blob([sampleAudio], { type: "audio/wav" }), "patient_voice.wav");

      const req = new Request("http://localhost:3000/api/voice/stt", {
        method: "POST",
        body: formData,
        headers: { "x-forwarded-for": "10.0.1.4" },
      });

      const res = await postVoiceStt(req);
      assert.strictEqual(res.status, 200, "Successful transcription returns HTTP 200");
      const json = await res.json();
      assert.strictEqual(json.status, "success", "Response status is success");
      assert.strictEqual(json.transcript, "I have had severe chest pain for twenty minutes.", "Exact transcript returned");
      assert.strictEqual(json.engine, "whisper_base_en", "Engine identifier matches whisper_base_en");
      assert.strictEqual(json.isEmpty, false, "isEmpty is false");
      console.log("  [PASS] Successful transcription correctly formatted and returned\n");
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  // TEST 5: FastAPI Error Propagation (e.g. HTTP 415 unsupported format)
  {
    console.log(">>> TEST 5: FastAPI Error Propagation (HTTP 415)");
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          detail: "Unsupported audio format: '.exe'. Allowed extensions: .wav, .webm",
        }),
        {
          status: 415,
          headers: { "Content-Type": "application/json" },
        }
      );
    };

    try {
      const formData = new FormData();
      formData.append("file", new Blob([new Uint8Array([1, 2, 3])], { type: "application/octet-stream" }), "malicious.exe");

      const req = new Request("http://localhost:3000/api/voice/stt", {
        method: "POST",
        body: formData,
        headers: { "x-forwarded-for": "10.0.1.5" },
      });

      const res = await postVoiceStt(req);
      assert.strictEqual(res.status, 415, "FastAPI 415 status code preserved");
      const json = await res.json();
      assert.ok(json.error.includes("failed"), "Sanitized error returned to client");
      console.log("  [PASS] FastAPI error status cleanly propagated\n");
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  // TEST 6: Bounded stream rejection on unannounced chunked transfer > 25MB (HTTP 413)
  {
    console.log(">>> TEST 6: Bounded Stream Interception on Chunked Transfer (HTTP 413)");
    const maxPayload = RESOURCE_LIMITS.VOICE_STT_MAX_AUDIO_BYTES + 256 * 1024;
    const chunkSize = 1024 * 1024; // 1 MB chunks
    let bytesSent = 0;

    const stream = new ReadableStream({
      pull(controller) {
        if (bytesSent > maxPayload + chunkSize) {
          controller.close();
          return;
        }
        controller.enqueue(new Uint8Array(chunkSize));
        bytesSent += chunkSize;
      },
    });

    const req = new Request("http://localhost:3000/api/voice/stt", {
      method: "POST",
      body: stream,
      headers: {
        "content-type": "multipart/form-data; boundary=----StreamBoundaryXYZ",
        "x-forwarded-for": "10.0.1.6",
      },
      duplex: "half",
    } as RequestInit & { duplex?: string });

    const res = await postVoiceStt(req);
    assert.strictEqual(res.status, 413, "Chunked streaming exceeding limit rejected with HTTP 413");
    const json = await res.json();
    assert.strictEqual(json.code, "PAYLOAD_TOO_LARGE", "Error code is PAYLOAD_TOO_LARGE");
    console.log("  [PASS] Chunked stream exceeding 25MB intercepted and aborted with HTTP 413\n");
  }

  // TEST 7: Malformed multipart form data handling (HTTP 400)
  {
    console.log(">>> TEST 7: Malformed Multipart Body Handling (HTTP 400)");
    const corruptBody = new TextEncoder().encode("Not a valid multipart payload -- missing boundaries");
    const req = new Request("http://localhost:3000/api/voice/stt", {
      method: "POST",
      body: corruptBody,
      headers: {
        "content-type": "multipart/form-data; boundary=----MissingBoundary",
        "x-forwarded-for": "10.0.1.7",
      },
      duplex: "half",
    } as RequestInit & { duplex?: string });

    const res = await postVoiceStt(req);
    assert.strictEqual(res.status, 400, "Corrupt multipart payload rejected with HTTP 400");
    const json = await res.json();
    assert.strictEqual(json.code, "MALFORMED_MULTIPART", "Error code is MALFORMED_MULTIPART");
    console.log("  [PASS] Malformed multipart rejected cleanly with HTTP 400\n");
  }

  console.log("================================================================================");
  console.log("      ALL 7/7 NEXT.JS VOICE STT INTEGRATION TESTS PASSED                       ");
  console.log("================================================================================");
}

runVoiceSttTestSuite().catch((err) => {
  console.error("Voice STT test failure:", err);
  process.exit(1);
});
