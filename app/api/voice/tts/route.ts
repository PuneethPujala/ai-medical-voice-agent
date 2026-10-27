import { NextResponse } from "next/server";
import { ttsDispatcher } from "@/lib/audio/tts-dispatcher";

export async function GET() {
  try {
    const warmupResult = await ttsDispatcher.warmup("dr-sarah-chen");
    return NextResponse.json({
      prewarmed: true,
      provider: "kokoro",
      latencyMs: warmupResult.latencyMs,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Warmup notice" }, { status: 500 });
  }
}

import {
  checkRateLimit,
  getClientIp,
  buildRateLimitResponse,
  RESOURCE_LIMITS,
  evaluateRateLimit,
  buildRateLimit429Response,
  RATE_LIMIT_POLICIES,
} from "@/lib/security/rate-limiter";
import { getAuthContext } from "@/lib/auth/rbac";

export async function POST(request: Request) {
  try {
    const auth = await getAuthContext(request);
    const body = await request.json();

    // 1. Abuse Protection: Distributed Rate Limiting (fail-closed on expensive neural speech compute)
    const rateLimit = await evaluateRateLimit({
      policy: RATE_LIMIT_POLICIES.VOICE_TTS,
      userId: auth.userId,
      request,
    });
    if (!rateLimit.allowed) {
      return buildRateLimit429Response(rateLimit);
    }
    const { text, doctorId = "dr-sarah-chen", speed, prewarm } = body;

    // Fast-path: Explicit non-blocking background model pre-warming
    if (prewarm) {
      const warmupResult = await ttsDispatcher.warmup(doctorId);
      return NextResponse.json({
        prewarmed: true,
        doctorId,
        latencyMs: warmupResult.latencyMs,
      });
    }

    if (!text || typeof text !== "string" || !text.trim()) {
      return NextResponse.json({ error: "Text parameter is required." }, { status: 400 });
    }

    if (text.length > RESOURCE_LIMITS.VOICE_TTS_MAX_TEXT_CHARS) {
      return NextResponse.json(
        {
          error: `Text exceeds maximum allowed length of ${RESOURCE_LIMITS.VOICE_TTS_MAX_TEXT_CHARS} characters for speech synthesis.`,
          code: "PAYLOAD_TOO_LARGE",
        },
        { status: 413 }
      );
    }

    const dispatchResult = await ttsDispatcher.dispatch(text, doctorId, speed);

    // If provider is unavailable (e.g. cloud credentials not set in dev) or failed
    if (!dispatchResult.success) {
      return NextResponse.json(dispatchResult.fallback, { status: 200 });
    }

    const { audio } = dispatchResult;
    const engineLabel = audio.provider === "kokoro" ? "Kokoro" : "Azure Speech";

    return new Response(new Uint8Array(audio.buffer), {
      status: 200,
      headers: {
        "Content-Type": audio.contentType,
        "Content-Length": audio.buffer.length.toString(),
        "X-TTS-Engine": engineLabel,
        "X-TTS-Provider": audio.provider,
        "X-TTS-Doctor-Id": doctorId,
        "X-TTS-Voice": audio.voice,
        "X-TTS-Locale": audio.locale,
        "X-TTS-Latency-Ms": audio.latencyMs.toString(),
        "X-TTS-Duration-Sec": audio.durationSec.toFixed(2),
        "X-TTS-Model-Warmup-Ms": (audio.modelLoadTimeMs ?? 0).toString(),
        "Cache-Control": "public, max-age=3600, immutable",
      },
    });
  } catch (err: any) {
    console.error("[TTS Route Critical Error]:", err?.message || err);
    return NextResponse.json(
      {
        error: err?.message || "Failed to synthesize speech.",
        fallbackRequired: true,
      },
      { status: 500 }
    );
  }
}
