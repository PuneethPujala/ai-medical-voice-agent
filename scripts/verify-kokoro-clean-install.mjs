import assert from "node:assert";

async function verifyKokoroTts() {
  console.log("1. Testing Node ESM import of kokoro-js...");
  const kokoro = await import("kokoro-js");
  assert(kokoro.KokoroTTS, "KokoroTTS class should be exported");
  console.log("✓ KokoroTTS class imported successfully via Node ESM.");

  console.log("2. Testing live authenticated /api/voice/tts endpoint...");
  const res = await fetch("http://localhost:3000/api/voice/tts", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-test-harness-secret": "medvoice-test-harness-auth-token-9f8a3c2e-secure-32ch",
      "x-mock-role": "patient",
      "x-mock-user-id": "test-patient-browser-user",
    },
    body: JSON.stringify({
      text: "Kokoro TTS installation lifecycle verification passed.",
      voice: "af_heart",
    }),
  });

  assert.strictEqual(res.status, 200, `Expected HTTP 200, got ${res.status}`);
  const contentType = res.headers.get("content-type");
  assert(
    contentType && contentType.includes("audio/wav"),
    `Expected audio/wav content-type, got ${contentType}`
  );

  const arrayBuffer = await res.arrayBuffer();
  assert(arrayBuffer.byteLength > 1000, `Audio payload too small: ${arrayBuffer.byteLength} bytes`);
  console.log(`✓ Kokoro TTS returned valid audio/wav payload (${arrayBuffer.byteLength} bytes).`);
}

verifyKokoroTts().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
