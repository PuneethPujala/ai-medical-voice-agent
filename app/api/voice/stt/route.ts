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
import { reconcileClinicalTranscript } from "@/lib/audio/transcript-reconciler";

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

    const maxAudioBytes = RESOURCE_LIMITS.VOICE_STT_MAX_AUDIO_BYTES;
    // Envelope margin for multipart headers/boundaries (256 KB)
    const maxIngressPayloadBytes = maxAudioBytes + 256 * 1024;

    // 2. Early Ingress Rejection: Check Content-Length header if declared
    const contentLengthHeader = request.headers.get("content-length");
    if (contentLengthHeader) {
      const contentLength = parseInt(contentLengthHeader, 10);
      if (!isNaN(contentLength) && contentLength > maxIngressPayloadBytes) {
        return NextResponse.json(
          {
            error: `Audio file exceeds maximum allowed size of ${maxAudioBytes / (1024 * 1024)} MB.`,
            code: "PAYLOAD_TOO_LARGE",
          },
          { status: 413 }
        );
      }
    }

    // 3. Streaming Bounded Consumption:
    // Protect against unbounded memory buffering for chunked / unannounced streams
    let formData: FormData;
    if (request.body) {
      let totalBytes = 0;
      let exceeded = false;

      const limiter = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          totalBytes += chunk.byteLength;
          if (totalBytes > maxIngressPayloadBytes) {
            exceeded = true;
            controller.error(new Error("PAYLOAD_TOO_LARGE"));
            return;
          }
          controller.enqueue(chunk);
        },
      });

      try {
        const requestInit: RequestInit & { duplex?: string } = {
          method: request.method,
          headers: request.headers,
          body: request.body.pipeThrough(limiter),
          duplex: "half",
        };
        const boundedRequest = new Request(request.url, requestInit);
        formData = await boundedRequest.formData();
      } catch (streamErr: any) {
        if (exceeded || streamErr?.message === "PAYLOAD_TOO_LARGE" || streamErr?.message?.includes("PAYLOAD_TOO_LARGE")) {
          return NextResponse.json(
            {
              error: `Audio file exceeds maximum allowed size of ${maxAudioBytes / (1024 * 1024)} MB.`,
              code: "PAYLOAD_TOO_LARGE",
            },
            { status: 413 }
          );
        }
        return NextResponse.json(
          {
            error: "Malformed multipart form data payload.",
            code: "MALFORMED_MULTIPART",
          },
          { status: 400 }
        );
      }
    } else {
      try {
        formData = await request.formData();
      } catch {
        return NextResponse.json(
          {
            error: "Malformed multipart form data payload.",
            code: "MALFORMED_MULTIPART",
          },
          { status: 400 }
        );
      }
    }

    const file = formData.get("file") as File | Blob | null;
    const prompt = (formData.get("prompt") as string) || (formData.get("context") as string) || "";
    const preview = (formData.get("preview") as string) || "";

    if (!file || (file instanceof Blob && file.size === 0)) {
      return NextResponse.json(
        { error: "Audio buffer is empty. Please speak clearly into the microphone." },
        { status: 400 }
      );
    }

    // 4. Abuse Protection: Reject oversized audio uploads before memory buffer / ASR processing
    if (file instanceof Blob && file.size > maxAudioBytes) {
      return NextResponse.json(
        {
          error: `Audio file exceeds maximum allowed size of ${maxAudioBytes / (1024 * 1024)} MB.`,
          code: "PAYLOAD_TOO_LARGE",
        },
        { status: 413 }
      );
    }

    // Forward multipart form data to FastAPI STT service with local fallback failover
    const fileName = (file as any).name || "utterance.webm";
    const primaryUrl = getFastApiSttUrl();
    const localFallbackUrl = "http://127.0.0.1:8000/api/v1/stt";
    const candidateUrls = [primaryUrl];
    if (primaryUrl !== localFallbackUrl) {
      candidateUrls.push(localFallbackUrl);
    }

    let sttResult: { ok: boolean; status: number; data?: any; errorDetail?: string } | null = null;

    for (let i = 0; i < candidateUrls.length; i++) {
      const targetUrl = candidateUrls[i];
      const isPrimary = i === 0;
      const hasFallback = candidateUrls.length > 1 && isPrimary;
      // 5s timeout on remote primary if local fallback is available; 15s otherwise
      const timeoutMs = hasFallback ? 5000 : 15000;

      const backendForm = new FormData();
      backendForm.append("file", file, fileName);
      if (prompt) {
        backendForm.append("prompt", prompt);
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(targetUrl, {
          method: "POST",
          body: backendForm,
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const detail = errorData.detail || `FastAPI STT returned status ${response.status}`;
          console.warn(`FastAPI STT at ${targetUrl} returned status ${response.status}: ${detail}`);
          if (hasFallback && response.status >= 500) {
            console.warn(`Failing over to local FastAPI STT at ${localFallbackUrl}...`);
            continue;
          }
          sttResult = { ok: false, status: response.status, errorDetail: detail };
          break;
        }

        const data = await response.json();
        sttResult = { ok: true, status: 200, data };
        break;
      } catch (fetchErr: any) {
        clearTimeout(timeoutId);
        const isAbort = fetchErr.name === "AbortError";
        console.warn(`FastAPI STT attempt at ${targetUrl} failed: ${fetchErr?.message || (isAbort ? "Timed out" : "Unknown error")}`);
        if (hasFallback) {
          console.warn(`Failing over to local FastAPI STT at ${localFallbackUrl}...`);
          continue;
        }
        sttResult = {
          ok: false,
          status: isAbort ? 504 : 503,
          errorDetail: isAbort ? "Transcription request timed out." : (fetchErr?.message || "Local Whisper ASR service unavailable."),
        };
        break;
      }
    }

    if (!sttResult || !sttResult.ok) {
      const status = sttResult?.status || 503;
      const detail = sttResult?.errorDetail || "Whisper STT service unavailable";
      if (status === 504) {
        return NextResponse.json(
          { error: "Transcription request timed out. Please try speaking again." },
          { status: 504 }
        );
      }
      return NextResponse.json(
        {
          error: "Speech-to-text recognition failed. Please repeat your statement.",
          detail: sanitizeErrorDetails(detail),
        },
        { status }
      );
    }

    const data = sttResult.data;
    const rawTranscript = (data.transcript || "").trim();

    // Clinical Context Reconciliation
    const reconciled = reconcileClinicalTranscript({
      whisperText: rawTranscript,
      previewText: preview,
      doctorLastQuestion: prompt,
    });

    const finalTranscript = reconciled.transcript;

    return NextResponse.json({
      status: "success",
      transcript: finalTranscript,
      rawWhisper: rawTranscript,
      rawPreview: preview,
      wasReconciled: reconciled.wasReconciled,
      isAmbiguous: Boolean(reconciled.isAmbiguous),
      requiresPatientConfirmation: Boolean(reconciled.requiresPatientConfirmation),
      ambiguityReason: reconciled.ambiguityReason,
      reconciliationNotes: reconciled.reconciliationNotes,
      engine: data.engine || "whisper_base_en",
      isEmpty: finalTranscript.length === 0,
    });
  } catch (err: any) {
    console.error("STT route error:", err);
    return NextResponse.json(
      { error: "Internal error processing speech audio." },
      { status: 500 }
    );
  }
}
