"""
STT Latency Benchmark Script
Measures cold load time and warm inference latencies across clip lengths:
1s, 3s, 5s, 10s.
Reports median, P90, and P95 latencies.
"""
import sys
import os
import time
import io
import wave
import struct

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
    print("=" * 70)
    print("       LOCAL WHISPER (base.en) CPU LATENCY EMPIRICAL BENCHMARK       ")
    print("=" * 70)

    # 1. Measure Cold Start / Model Load
    print("\n[Phase 1] Measuring Cold Model Load Latency...")
    t0 = time.time()
    model = get_whisper_model("base.en")
    cold_load_sec = time.time() - t0
    print(f"  Cold Model Load Time: {cold_load_sec:.3f} s ({cold_load_sec * 1000:.1f} ms)")

    # 2. Benchmark by Clip Length
    clip_durations = [1.0, 3.0, 5.0, 10.0]
    num_runs = 5
    results = {}

    print(f"\n[Phase 2] Measuring Warm Inference Latency ({num_runs} iterations per clip length)...")
    for duration in clip_durations:
        wav_bytes = create_pcm_wav(duration)
        latencies = []
        for run_idx in range(num_runs):
            t_start = time.time()
            transcribe_audio_bytes(wav_bytes, filename=f"bench_{duration}s.wav", model_name="base.en")
            t_elapsed = (time.time() - t_start) * 1000 # ms
            latencies.append(t_elapsed)

        latencies.sort()
        p50 = latencies[len(latencies) // 2]
        p90 = latencies[int(len(latencies) * 0.9)]
        p95 = latencies[-1] # max for 5 runs

        results[duration] = {
            "p50_ms": round(p50, 1),
            "p90_ms": round(p90, 1),
            "p95_ms": round(p95, 1),
            "min_ms": round(latencies[0], 1),
            "max_ms": round(latencies[-1], 1),
        }
        print(f"  Clip {duration:4.1f}s | Median (P50): {p50:6.1f} ms | P90: {p90:6.1f} ms | P95: {p95:6.1f} ms | Range: [{latencies[0]:.0f} - {latencies[-1]:.0f} ms]")

    print("\n" + "=" * 70)
    print("LATENCY SUMMARY TABLE (Local CPU Inference, No Cloud Transmission):")
    print("-" * 70)
    print(f"{'Clip Length':<15} | {'Median (P50)':<15} | {'P95 Latency':<15} | {'Realtime Factor (RTF)':<15}")
    print("-" * 70)
    for dur, data in results.items():
        rtf = (data['p50_ms'] / 1000.0) / dur
        print(f"{str(dur) + ' sec':<15} | {str(data['p50_ms']) + ' ms':<15} | {str(data['p95_ms']) + ' ms':<15} | {rtf:.2f}x audio duration")
    print("-" * 70)

if __name__ == "__main__":
    run_benchmarks()
