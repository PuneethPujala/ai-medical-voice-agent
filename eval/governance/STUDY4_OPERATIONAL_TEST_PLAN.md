# Study 4: Controlled Operational Reliability & Latency Test Plan

**Document Version:** 1.0.0 (Phase 1 Research Authorization)
**Effective Date:** November 2, 2026
**Auditor / Lead:** MedVoice Infrastructure & Systems Working Group
**Scope:** Controlled Synthetic Benchmarking of Runtime Components, Latency Profiles & Concurrency

---

## 1. Operational Premise & Crucial Scientific Distinction

> [!IMPORTANT]
> **Scientific Classification Invariant:** Study 4 is a **controlled synthetic stress and load test** executed against the MedVoice production runtime on standardized test infrastructure.
>
> **It is NOT evidence of real-world clinical patient usage, live ambulatory deployment, or multi-center operational trial results.**
>
> All publication tables, reports, and manuscripts must explicitly label these data as *controlled offline simulation and synthetic traffic testing*.

---

## 2. Test Architecture & Component Latency Breakdown

MedVoice is an interactive voice-first clinical agent. Total user-perceived turnaround latency ($\Delta T_{\text{total}}$) is composed of five distinct sequential and overlapping pipeline stages:

```
[Patient Speaks]
       │
       ▼
1. Acoustic Audio Capture & VAD (Silero Voice Activity Detection)
       │
       ▼
2. Speech-to-Text Transcription (Whisper-Base / Large-v3) ──> ΔT_STT
       │
       ▼
3. PhiScrubber De-Identification & Safety Preemption ────────> ΔT_SafetyPre
       │
       ▼
4. Clinical Board LLM Reasoning & RAG Retrieval ────────────> ΔT_Agent
       │
       ▼
5. Neural Speech Synthesis (Kokoro-82M ONNX/WASM) ──────────> ΔT_TTS
       │
       ▼
[Audio Streams to Patient Speaker] ──────────────────────────> ΔT_Total
```

$$\Delta T_{\text{total}} = \Delta T_{\text{STT}} + \Delta T_{\text{SafetyPre}} + \Delta T_{\text{Agent}} + \Delta T_{\text{TTS}} + \Delta T_{\text{Network/IPC}}$$

---

## 3. Standardized Test Cohorts & Experimental Profiles

### 3.1 Traffic Generation (Controlled Synthetic Corpus)
* **Two-Tier Benchmark Sizing:**
  1. *Operational Pilot (Stage 1):* $N = 1,000$ synthetic interaction requests. Establishes basic stability, component latency distributions, and P50/P90 metrics.
  2. *Statistical P99 Tail Benchmark (Stage 2):* At least $N = 10,000$ representative interaction requests. Mandated before making strong P99 claims, because at $N=1,000$, P99 is governed by only ~10 observations (statistically volatile tail).
* **Turn Types:**
  1. *Short Clarifications (<10 words):* e.g., "No, I don't have fever."
  2. *Standard Narrative Turns (15–35 words):* e.g., "It started around 2 PM while walking up the stairs."
  3. *Complex Symptom Descriptions (>50 words):* Multi-symptom descriptions with comorbidities.
* **Acoustic Audio Stimuli:** Standardized pre-recorded audio WAV files (16 kHz, mono, 16-bit PCM; durations: 3s, 7s, 15s) representing clean speech, ambient clinic noise (60 dB SNR), and fragmented speech.

### 3.2 Concurrency & Load Conditions
Testing evaluates four distinct concurrency tiers on identical host hardware:
1. **Tier 1 (Single-Stream Baseline):** Concurrency = 1. Measures pure component compute overhead.
2. **Tier 2 (Moderate Clinic Load):** Concurrency = 5 parallel sessions. Simulates a multi-room triage clinic.
3. **Tier 3 (Peak Ambulatory Load):** Concurrency = 10 parallel sessions. Simulates peak morning intake.
4. **Tier 4 (Stress / Saturation Limit):** Concurrency = 25 parallel sessions. Identifies memory limits and queue degradation.

---

## 4. Key Performance Indicators & Measurement Methodology

| Component / Metric | Measurement Methodology | Target Bound (P50) | Target Bound (P95) | Target Bound (P99 at N>=10k) |
| :--- | :--- | :---: | :---: | :---: |
| **STT Latency ($\Delta T_{\text{STT}}$)** | High-resolution wall-clock timer (`performance.now()`) from audio buffer upload to final transcript string. | $< 180 \text{ ms}$ | $< 350 \text{ ms}$ | $< 600 \text{ ms}$ |
| **Safety Preemption ($\Delta T_{\text{SafetyPre}}$)** | Regex / keyword red-flag matcher and deterministic ESI preemption checks. | $< 5 \text{ ms}$ | $< 12 \text{ ms}$ | $< 25 \text{ ms}$ |
| **Agent Reasoning ($\Delta T_{\text{Agent}}$)** | Model inference timer from prompt dispatch to closing token, including RAG vector search. | $< 450 \text{ ms}$ | $< 850 \text{ ms}$ | $< 1,600 \text{ ms}$ |
| **TTS First-Audio-Chunk ($\Delta T_{\text{TTS}}$)** | Time from receiving agent text sentence to generation of first 200 ms audio chunk (streaming audio). | $< 120 \text{ ms}$ | $< 220 \text{ ms}$ | $< 400 \text{ ms}$ |
| **Total Turnaround Latency ($\Delta T_{\text{total}}$)** | User-perceived silence from end of patient speech to start of audible playback. | $< 800 \text{ ms}$ | $< 1,400 \text{ ms}$ | $< 2,200 \text{ ms}$ |
| **Memory Track Leakage** | Headless Chrome heap allocation and active `MediaStreamTrack` count after 100 consecutive turns. | **0 leaked tracks** | **$< 5\text{MB}$ heap growth** | **0 leaked tracks** |
| **Audio Interruption Recovery** | Simulating patient barge-in during active TTS playback; time to silence speaker, revoke `ObjectURL`, and listen. | $< 50 \text{ ms}$ | $< 100 \text{ ms}$ | $< 180 \text{ ms}$ |
| **HTTP Error / Timeout Rate** | Percentage of requests resulting in 5xx, timeout (>5s), or unhandled exceptions across runs. | **0.0%** | **$< 0.1\%$** | **$< 0.5\%$** |

---

## 5. Execution Environment & Telemetry Recording

* **Host Hardware Specification:** Must record exact CPU (core count, frequency), RAM, GPU/NPU availability, OS version, and Node/Python versions.
* **Warm vs. Cold Runs:** Telemetry must record the first 50 requests (cold start / JIT compilation / model loading) separately from steady-state requests (runs 51–1,000).
* **Machine-Readable Telemetry:** Telemetry data is exported as an immutable JSON ledger (`eval/output/operational_telemetry_study4.json`) containing request IDs, timestamps, component latency arrays, memory snapshots, and exit codes.

