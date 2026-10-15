import { NextResponse } from "next/server";

export const runtime = "nodejs";

function getFastApiSttUrl(): string {
  const base = process.env.FASTAPI_URL || "http://127.0.0.1:8000";
  return base.endsWith("/api/v1/stt") ? base : `${base.replace(/\/+$/, "")}/api/v1/stt`;
}

/**
 * Canonical Whisper Speech-to-Text Bridge
 * 
 * Receives recorded patient audio chunks/utterances from the browser,
 * forwards them to the local FastAPI Whisper ASR engine (base.en),
 * and returns the transcribed text.
 * 
 * CLINICAL SAFETY INVARIANT:
 * If transcription fails or audio is corrupted, returns an explicit error
 * so the client prompts the patient to repeat. NEVER returns fabricated clinical symptoms.
 */
import {
  checkRateLimit,
  getClientIp,
  buildRateLimitResponse,
  RESOURCE_LIMITS,
} from "@/lib/security/rate-limiter";
import { sanitizeErrorDetails } from "@/lib/security/error-sanitizer";

export async function POST(request: Request) {
  try {
    // 1. Abuse Protection: Rate limit per client IP
    const clientIp = getClientIp(request);
    const rateLimit = checkRateLimit(
      `voice_stt:${clientIp}`,
      RESOURCE_LIMITS.VOICE_STT_RATE_LIMIT_PER_MINUTE,
      60000
    );
    if (!rateLimit.allowed) {
      return buildRateLimitResponse(rateLimit, "/api/voice/stt");
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | Blob | null;

    if (!file || (file instanceof Blob && file.size === 0)) {
      return NextResponse.json(
        { error: "Audio buffer is empty. Please speak clearly into the microphone." },
        { status: 400 }
      );
    }

    // 2. Abuse Protection: Reject oversized audio uploads before memory buffer / ASR processing
    if (file instanceof Blob && file.size > RESOURCE_LIMITS.VOICE_STT_MAX_AUDIO_BYTES) {
      return NextResponse.json(
        {
          error: `Audio file exceeds maximum allowed size of ${RESOURCE_LIMITS.VOICE_STT_MAX_AUDIO_BYTES / (1024 * 1024)} MB.`,
          code: "PAYLOAD_TOO_LARGE",
        },
        { status: 413 }
      );
    }

    // Forward multipart form data to FastAPI STT service
    const backendForm = new FormData();
    const fileName = (file as any).name || "utterance.webm";
    backendForm.append("file", file, fileName);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s turn timeout

    try {
      const response = await fetch(getFastApiSttUrl(), {
        method: "POST",
        body: backendForm,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const detail = errorData.detail || `FastAPI STT returned status ${response.status}`;
        console.error("FastAPI Whisper STT Error:", detail);
        return NextResponse.json(
          {
            error: "Speech-to-text recognition failed. Please repeat your statement.",
            detail: sanitizeErrorDetails(detail),
          },
          { status: response.status }
        );
      }

      const data = await response.json();
      const transcript = (data.transcript || "").trim();

      return NextResponse.json({
        status: "success",
        transcript,
        engine: data.engine || "whisper_base_en",
        isEmpty: transcript.length === 0,
      });
    } catch (fetchErr: any) {
      clearTimeout(timeoutId);
      if (fetchErr.name === "AbortError") {
        return NextResponse.json(
          { error: "Transcription request timed out. Please try speaking again." },
          { status: 504 }
        );
      }
      console.error("Failed to connect to FastAPI Whisper service:", fetchErr?.message);
      return NextResponse.json(
        {
          error: "Local Whisper ASR service unavailable. Please ensure the backend is running.",
          detail: sanitizeErrorDetails(fetchErr?.message),
        },
        { status: 503 }
      );
    }
  } catch (err: any) {
    console.error("STT route error:", err);
    return NextResponse.json(
      { error: "Internal error processing speech audio." },
      { status: 500 }
    );
  }
}
