import assert from "assert";
import { spawn, ChildProcess } from "child_process";
import { POST as postVoiceStt } from "../../app/api/voice/stt/route";

/**
 * Live End-to-End STT Integration Test:
 * Spawns the local FastAPI microservice on test port 8765,
 * verifies health readiness, forwards an audio request through the Next.js route,
 * executes real local Whisper transcription on CPU, and cleanly shuts down.
 */
async function runLiveE2eSttTest() {
  console.log("================================================================================");
  console.log("       LIVE END-TO-END FASTAPI WHISPER STT INTEGRATION TEST (PORT 8765)         ");
  console.log("================================================================================\n");

  const TEST_PORT = 8765;
  const TEST_FASTAPI_URL = `http://127.0.0.1:${TEST_PORT}`;
  let serverProcess: ChildProcess | null = null;

  try {
    console.log(`[1/4] Spawning FastAPI server on port ${TEST_PORT}...`);
    serverProcess = spawn(
      "python",
      ["-m", "uvicorn", "backend.main:app", "--host", "127.0.0.1", "--port", String(TEST_PORT)],
      {
        cwd: process.cwd(),
        env: { ...process.env, PORT: String(TEST_PORT) },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    // Poll for server health readiness (up to 15 seconds)
    console.log("[2/4] Waiting for FastAPI server readiness...");
    let isReady = false;
    const start = Date.now();
    while (Date.now() - start < 15000) {
      try {
        const res = await fetch(`${TEST_FASTAPI_URL}/api/v1/stt/health`);
        if (res.ok) {
          const healthJson = await res.json();
          if (healthJson.status === "online") {
            isReady = true;
            break;
          }
        }
      } catch {
        // Retry
      }
      await new Promise((r) => setTimeout(r, 400));
    }

    assert.ok(isReady, `FastAPI server failed to become ready on ${TEST_FASTAPI_URL} within 15 seconds`);
    console.log("  [PASS] FastAPI server is online and responding at /api/v1/stt/health\n");

    // Configure Next.js STT route to target this test server
    process.env.FASTAPI_URL = TEST_FASTAPI_URL;

    console.log("[3/5] Verifying STT health readiness & model pre-warmup...");
    const healthRes = await fetch(`${TEST_FASTAPI_URL}/api/v1/stt/health`);
    const healthData = await healthRes.json();
    assert.strictEqual(healthData.status, "online", "Health status is online");
    assert.strictEqual(healthData.external_network_egress, false, "External network egress is strictly disabled");
    assert.strictEqual(healthData.hipaa_safe, undefined, "HIPAA compliance claim removed in favor of verifiable technical facts");

    // Pre-warm the model
    const warmupRes = await fetch(`${TEST_FASTAPI_URL}/api/v1/stt/warmup`, { method: "POST" });
    const warmupData = await warmupRes.json();
    assert.strictEqual(warmupData.status, "success", "Warmup successful");
    assert.strictEqual(warmupData.model_ready, true, "Whisper model loaded into memory");
    console.log("  [PASS] STT model readiness and zero external egress verified.\n");

    console.log("[4/5] Reading real spoken audio fixture ('tests/fixtures/spoken_chest_pain.wav')...");
    const fs = await import("fs");
    const path = await import("path");
    const fixturePath = path.join(process.cwd(), "tests", "fixtures", "spoken_chest_pain.wav");
    assert.ok(fs.existsSync(fixturePath), `Spoken audio fixture not found at ${fixturePath}`);
    const audioBuffer = fs.readFileSync(fixturePath);
    const audioBlob = new Blob([audioBuffer], { type: "audio/wav" });
    console.log(`  Read ${audioBuffer.byteLength} bytes of spoken audio ('I have severe chest pain').`);

    console.log("[5/5] Sending audio to Next.js route (/api/voice/stt)...");
    const formData = new FormData();
    formData.append("file", audioBlob, "patient_chest_pain.wav");

    const req = new Request("http://localhost:3000/api/voice/stt", {
      method: "POST",
      body: formData,
      headers: { "x-forwarded-for": "10.0.2.1" },
    });

    const startTime = Date.now();
    const res = await postVoiceStt(req);
    const elapsed = Date.now() - startTime;

    assert.strictEqual(res.status, 200, `Next.js route returned status ${res.status}`);
    const resJson = await res.json();

    console.log(`\n  Transcription Response (${elapsed}ms total):`, JSON.stringify(resJson, null, 2));
    assert.strictEqual(resJson.status, "success", "Response status is 'success'");
    assert.strictEqual(resJson.engine, "whisper_base_en", "Engine identifier is 'whisper_base_en'");
    assert.strictEqual(typeof resJson.transcript, "string", "Transcript string returned");

    // CRITICAL TRANSCRIPTION VALIDATION:
    const transcriptText = resJson.transcript.trim();
    assert.ok(transcriptText.length > 0, "CRITICAL FAILURE: Transcription returned empty text for spoken audio!");
    assert.strictEqual(resJson.isEmpty, false, "resJson.isEmpty must be false for recognized speech");
    assert.ok(
      transcriptText.toLowerCase().includes("chest pain"),
      `Expected 'chest pain' in recognized transcript, but got: '${transcriptText}'`
    );

    console.log(`\n  [PASS] Real Speech Recognized Accurately: "${transcriptText}"`);
    console.log("================================================================================");
    console.log("            LIVE E2E REAL SPEECH TRANSCRIPTION VERIFICATION SUCCESSFUL         ");
    console.log("================================================================================\n");
  } finally {
    if (serverProcess) {
      console.log("Cleaning up FastAPI background server process...");
      serverProcess.kill("SIGTERM");
      try {
        if (serverProcess.pid) {
          spawn("taskkill", ["/pid", String(serverProcess.pid), "/f", "/t"]);
        }
      } catch {
        // ignore
      }
    }
  }
}

runLiveE2eSttTest().catch((err) => {
  console.error("Live E2E STT test failed:", err);
  process.exit(1);
});
