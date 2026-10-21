import { KokoroTTS } from "kokoro-js";

/**
 * Deterministic Doctor Profile to Kokoro Voice Mapping
 * Redesigned around voice character, regional accent, and calibrated speed.
 */
export const DOCTOR_KOKORO_VOICES: Record<string, string> = {
  "dr-sarah-chen": "af_sarah", // Warm, conversational, calm American female
  "dr-marcus-vance": "am_michael", // Authoritative, focused American male cardiologist
  "dr-elena-rostova": "bf_emma", // Gentle, compassionate British female pediatrician
  "dr-arthur-pendelton": "bm_george", // Methodical, analytical British male neurologist
  "dr-anna-bennett": "af_nicole", // Warm, compassionate American female dermatologist
};

export function resolveAuthoritativeVoice(doctorId?: string): string {
  if (doctorId && DOCTOR_KOKORO_VOICES[doctorId]) {
    return DOCTOR_KOKORO_VOICES[doctorId];
  }
  return DEFAULT_PATIENT_FACING_VOICE;
}

export function resolveAuthoritativeSpeed(doctorId?: string): number {
  const SPEED_MAP: Record<string, number> = {
    "dr-sarah-chen": 0.96,
    "dr-marcus-vance": 0.92,
    "dr-elena-rostova": 0.97,
    "dr-arthur-pendelton": 0.90,
    "dr-anna-bennett": 0.98,
  };
  if (doctorId && SPEED_MAP[doctorId]) {
    return SPEED_MAP[doctorId];
  }
  return 0.96;
}

export const DEFAULT_PATIENT_FACING_VOICE = "af_sarah";

export interface SynthesisResult {
  buffer: Buffer;
  sampleRate: number;
  durationSec: number;
  latencyMs: number;
  voice: string;
}

/**
 * Convert Float32Array PCM samples to a standard 16-bit PCM WAV Buffer
 */
export function floatTo16BitPCM(float32Array: Float32Array, sampleRate = 24000): Buffer {
  const numChannels = 1;
  const bytesPerSample = 2; // 16-bit PCM
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = float32Array.length * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF Chunk Descriptor
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);

  // "fmt " Sub-chunk
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
  buffer.writeUInt16LE(1, 20); // AudioFormat (1 for PCM)
  buffer.writeUInt16LE(numChannels, 22); // NumChannels
  buffer.writeUInt32LE(sampleRate, 24); // SampleRate
  buffer.writeUInt32LE(byteRate, 28); // ByteRate
  buffer.writeUInt16LE(blockAlign, 32); // BlockAlign
  buffer.writeUInt16LE(16, 34); // BitsPerSample (16-bit)

  // "data" Sub-chunk
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  let offset = 44;
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    buffer.writeInt16LE(s < 0 ? s * 0x8000 : s * 0x7fff, offset);
    offset += 2;
  }

  return buffer;
}

/**
 * Server-Side Kokoro TTS Model Singleton
 */
class KokoroService {
  private ttsInstance: KokoroTTS | null = null;
  private loadingPromise: Promise<KokoroTTS> | null = null;
  private modelLoadTimeMs: number | null = null;
  private warmupPromise: Promise<void> | null = null;
  private isWarmedUp: boolean = false;

  public isReady(): boolean {
    return this.ttsInstance !== null && this.isWarmedUp;
  }

  public getModelLoadTimeMs(): number | null {
    return this.modelLoadTimeMs;
  }

  /**
   * Non-blocking background warmup: loads model singleton, populates ONNX memory buffers,
   * and loads voice tensor so the first clinical response achieves immediate sub-second TTFA.
   */
  public async warmup(doctorId: string = "dr-sarah-chen"): Promise<{ warm: boolean; latencyMs: number }> {
    if (this.isWarmedUp) {
      return { warm: true, latencyMs: 0 };
    }

    if (this.warmupPromise) {
      await this.warmupPromise;
      return { warm: true, latencyMs: 0 };
    }

    const t0 = performance.now();
    this.warmupPromise = (async () => {
      try {
        const tts = await this.getModel();
        const voice = resolveAuthoritativeVoice(doctorId);
        // Fast 1-word dummy inference forces ONNX kernel compilation, allocator initialization, and voice tensor load
        await tts.generate("ready", { voice: voice as any, speed: 1.0 });
        this.isWarmedUp = true;
        console.log(`[Kokoro TTS Singleton] Background warmup complete in ${(performance.now() - t0).toFixed(1)}ms (Voice: ${voice})`);
      } catch (err) {
        console.warn("[Kokoro TTS Singleton] Background warmup non-fatal notice:", err);
      } finally {
        this.warmupPromise = null;
      }
    })();

    await this.warmupPromise;
    return { warm: true, latencyMs: Math.round(performance.now() - t0) };
  }

  public async getModel(): Promise<KokoroTTS> {
    if (this.ttsInstance) {
      return this.ttsInstance;
    }

    if (this.loadingPromise) {
      return this.loadingPromise;
    }

    const dtype = (process.env.KOKORO_DTYPE as any) || "q4";
    console.log(`[Kokoro TTS Singleton] Initializing Kokoro-82M model in-memory cache (dtype: ${dtype}, device: cpu)...`);
    const t0 = Date.now();

    this.loadingPromise = KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
      dtype,
      device: "cpu",
    }).then((model) => {
      this.ttsInstance = model;
      this.modelLoadTimeMs = Date.now() - t0;
      console.log(`[Kokoro TTS Singleton] Kokoro-82M model ready in ${this.modelLoadTimeMs}ms (dtype: ${dtype})`);
      return model;
    });

    return this.loadingPromise;
  }

  /**
   * Synthesize text into a standard 24kHz 16-bit WAV buffer
   */
  public async synthesize(
    text: string,
    options: { voice?: string; doctorId?: string; speed?: number } = {}
  ): Promise<SynthesisResult> {
    // 1. Clean markdown and non-spoken artifacts
    const cleanText = text
      .replace(/[*_#`\[\]]/g, "")
      .replace(/<[^>]*>/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (!cleanText) {
      throw new Error("Text is empty after sanitization.");
    }

    // 2. Server-Authoritative Immutable Voice Selection
    // Invariant: Doctor identity dictates voice. Client cannot spoof or override voiceId.
    const selectedVoice = resolveAuthoritativeVoice(options.doctorId);

    if (options.voice && options.voice !== selectedVoice) {
      console.warn(
        `[Kokoro Voice Security] Client attempted to override voice to '${options.voice}' for doctor '${options.doctorId}'. Enforcing authoritative persona voice '${selectedVoice}'.`
      );
    }
    const selectedSpeed = typeof options.speed === "number" && options.speed > 0
      ? options.speed
      : resolveAuthoritativeSpeed(options.doctorId);

    // Remote GPU worker dispatch: if FASTAPI_URL or REMOTE_TTS_URL points to a remote GPU worker,
    // dispatch to GPU and fall back gracefully to local CPU if unavailable or timed out.
    const remoteBase = process.env.REMOTE_TTS_URL || process.env.FASTAPI_URL;
    if (remoteBase && !remoteBase.includes("127.0.0.1") && !remoteBase.includes("localhost")) {
      const ttsEndpoint = remoteBase.endsWith("/api/v1/tts")
        ? remoteBase
        : `${remoteBase.replace(/\/+$/, "")}/api/v1/tts`;
      try {
        const t0_remote = performance.now();
        const res = await fetch(ttsEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: cleanText,
            voice: selectedVoice,
            speed: selectedSpeed,
            doctorId: options.doctorId,
          }),
          signal: AbortSignal.timeout(5000),
        });

        if (res.ok) {
          const arrayBuf = await res.arrayBuffer();
          const latencyMs = Math.round(performance.now() - t0_remote);
          const durationSec = Math.max(0.5, arrayBuf.byteLength / (24000 * 2));
          console.log(
            `[Kokoro TTS Remote GPU] Synthesized ${durationSec.toFixed(2)}s audio on GPU in ${latencyMs}ms (Voice: ${selectedVoice})`
          );
          return {
            buffer: Buffer.from(arrayBuf),
            sampleRate: 24000,
            durationSec,
            latencyMs,
            voice: selectedVoice,
          };
        } else {
          console.warn(`[Kokoro TTS Remote GPU] Worker returned ${res.status}, failing over to local CPU.`);
        }
      } catch (remoteErr: any) {
        console.warn("[Kokoro TTS Remote GPU] Remote worker notice, using local CPU fallback:", remoteErr?.message || remoteErr);
      }
    }

    const tts = await this.getModel();
    const t0 = Date.now();

    console.log(
      `[Kokoro TTS Synthesis] Synthesizing ${cleanText.split(/\s+/).length} words for doctor: ${
        options.doctorId || "dr-sarah-chen"
      } | Voice: ${selectedVoice}`
    );

    const rawAudio = await tts.generate(cleanText, {
      voice: selectedVoice as any,
      speed: selectedSpeed,
    });

    const latencyMs = Date.now() - t0;
    const sampleRate = rawAudio.sampling_rate || 24000;
    const durationSec = rawAudio.audio.length / sampleRate;

    console.log(
      `[Kokoro TTS Success] Generated ${durationSec.toFixed(2)}s audio in ${latencyMs}ms (RTF: ${(
        latencyMs /
        (durationSec * 1000)
      ).toFixed(3)})`
    );

    const wavBuffer = floatTo16BitPCM(rawAudio.audio, sampleRate);

    return {
      buffer: wavBuffer,
      sampleRate,
      durationSec,
      latencyMs,
      voice: selectedVoice,
    };
  }
}

export const kokoroService = new KokoroService();
