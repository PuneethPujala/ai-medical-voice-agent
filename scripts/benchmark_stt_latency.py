"""
STT Latency Benchmark Script
Measures cold load time and warm inference latencies across clip lengths:
1s, 3s, 5s, 10s.

METHODOLOGICAL SPECIFICATION:
1. Warmup / Model Load Exclusion:
   The Whisper model is loaded in Phase 1 and cached as a singleton. Warm inference
   measurements in Phase 2 strictly exclude model initialization and disk loading.
2. Measurement Scope:
   Each sample measures transcribe_audio_bytes (audio writing -> Whisper CPU forward pass -> cleanup).
   This measures local processing latency; it excludes HTTP transport, FastAPI multipart parsing,
   and Next.js proxying (which are separately verified in live-e2e-stt.test.ts).
3. Audio Duration Generation:
   create_pcm_wav generates synthetic 16kHz 16-bit mono PCM buffers with alternating acoustic
   amplitude values representing voiced audio of precise duration.
4. Percentile Estimation:
   Calculated using numpy.percentile with standard linear interpolation across N samples.
5. System Scope Disclaimer:
   STT latency is only one component of the full conversational voice pipeline (which also
   comprises VAD, LLM response generation, TTS synthesis, and client audio playback).
   STT speed alone does NOT establish that end-to-end conversational voice targets are met.
"""
import sys
import os
import time
import io
import wave
import struct
import numpy as np

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from backend.services.audio_service import transcribe_audio_bytes, get_whisper_model

def create_pcm_wav(duration_sec: float, sample_rate: int = 16000) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        num_frames = int(duration_sec * sample_rate)
        # Alternate between amplitude values to simulate acoustic signal
        frames = struct.pack(f"<{num_frames}h", *([1500 if (i // 50) % 2 == 0 else -1500 for i in range(num_frames)]))
        w.writeframes(frames)
    return buf.getvalue()

def run_benchmarks():
    print("=" * 75)
    print("       LOCAL WHISPER (base.en) CPU LATENCY EMPIRICAL BENCHMARK       ")
    print("=" * 75)

    # 1. Measure Cold Start / Model Load
    print("\n[Phase 1] Measuring Cold Model Load Latency...")
    t0 = time.time()
    model = get_whisper_model("base.en")
    cold_load_sec = time.time() - t0
    print(f"  Cold Model Load Time: {cold_load_sec:.3f} s ({cold_load_sec * 1000:.1f} ms)")

    # 2. Benchmark by Clip Length
    # Use N=15 for shorter clips, N=10 for 10s clip to manage test duration
    configs = [
        (1.0, 15),
        (3.0, 15),
        (5.0, 15),
        (10.0, 10),
    ]
    results = {}

    print(f"\n[Phase 2] Measuring Warm Inference Latency (Model pre-loaded in RAM)...")
    for duration, num_runs in configs:
        wav_bytes = create_pcm_wav(duration)
        latencies = []
        for run_idx in range(num_runs):
            t_start = time.time()
            transcribe_audio_bytes(wav_bytes, filename=f"bench_{duration}s.wav", model_name="base.en")
            t_elapsed = (time.time() - t_start) * 1000 # ms
            latencies.append(t_elapsed)

        lat_arr = np.array(latencies)
        p50 = float(np.percentile(lat_arr, 50))
        p90 = float(np.percentile(lat_arr, 90))
        p95 = float(np.percentile(lat_arr, 95))
        min_v = float(np.min(lat_arr))
        max_v = float(np.max(lat_arr))

        results[duration] = {
            "num_runs": num_runs,
            "p50_ms": round(p50, 1),
            "p90_ms": round(p90, 1),
            "p95_ms": round(p95, 1),
            "min_ms": round(min_v, 1),
            "max_ms": round(max_v, 1),
        }
        print(f"  Clip {duration:4.1f}s (N={num_runs:2d}) | P50: {p50:6.1f} ms | P90: {p90:6.1f} ms | P95: {p95:6.1f} ms | Range: [{min_v:.0f} - {max_v:.0f} ms]")

    print("\n" + "=" * 75)
    print("LATENCY SUMMARY TABLE (Local CPU Inference, Zero Cloud Transmission):")
    print("-" * 75)
    print(f"{'Clip Length':<12} | {'Samples':<8} | {'Median (P50)':<13} | {'P95 Latency':<13} | {'Realtime Factor (RTF)':<15}")
    print("-" * 75)
    for dur, data in results.items():
        rtf = (data['p50_ms'] / 1000.0) / dur
        print(f"{str(dur) + ' sec':<12} | N={data['num_runs']:<6} | {str(data['p50_ms']) + ' ms':<13} | {str(data['p95_ms']) + ' ms':<13} | {rtf:.2f}x audio duration")
    print("-" * 75)
    print("\nNOTE: STT is only one segment of the full pipeline. End-to-end turnaround also includes")
    print("audio capture, VAD framing, LLM completion, and speech synthesis.")

if __name__ == "__main__":
    run_benchmarks()
