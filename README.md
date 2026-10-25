# 🩺 MedVoice AI: Clinical Voice Triage & Decision-Support System

> **A bounded, multi-specialist clinical voice platform with deterministic safety arbitration, local neural audio pipelines, and verifiable audit ledgers.**
> Designed for AI-assisted intake, triage, and clinical decision support. The system does not autonomously diagnose patients.
>
> 📄 **Scientific Research Paper**: Full publication-grade manuscript and audited concordance specification available at [docs/PAPER.md](docs/PAPER.md).

---

## 📑 Table of Contents

- [System Architecture Overview](#-system-architecture-overview)
- [Engineering Documentation Directory](#-engineering-documentation-directory)
- [Audited Technical Specifications & Code Reality](#-audited-technical-specifications--code-reality)
  - [1. Bounded Multi-Specialist Decision Architecture](#1-bounded-multi-specialist-decision-architecture)
  - [2. Deterministic Dual-Arbiter Safety Shield](#2-deterministic-dual-arbiter-safety-shield)
  - [3. Triage Benchmark & Safety Concordance](#3-triage-benchmark--safety-concordance)
  - [4. Latency Profiles & Adaptive First-Chunk TTS](#4-latency-profiles--adaptive-first-chunk-tts)
  - [5. Runtime Paralinguistic Acoustic DSP Analyzer](#5-runtime-paralinguistic-acoustic-dsp-analyzer)
  - [6. Deterministic Multi-Field Clinical RAG Engine](#6-deterministic-multi-field-clinical-rag-engine)
  - [7. Durable SHA-256 Chained Audit Ledger](#7-durable-sha-256-chained-audit-ledger)
  - [8. HL7® FHIR® R4 Bundle Export & Provenance](#8-hl7-fhir-r4-bundle-export--provenance)
  - [9. Geospatial Emergency Facility Discovery & Road Routing](#9-geospatial-emergency-facility-discovery--road-routing)
  - [10. Monotonic Barge-in Interruption](#10-monotonic-barge-in-interruption)
  - [11. Code Reality & Audit Concordance Matrix (20-Point Specification)](#11-code-reality--audit-concordance-matrix-20-point-specification)
- [Technology Stack](#-technology-stack)
- [Acoustic DSP Performance & Validation](#-acoustic-dsp-performance--validation)
- [Repository Structure](#-repository-structure)
- [Verification, Test Suites & Coverage](#-verification-test-suites--coverage)
- [Getting Started & Safe Demo Guidance](#-getting-started--safe-demo-guidance)
- [Clinical & Regulatory Boundary Disclaimers](#-clinical--regulatory-boundary-disclaimers)
- [License & Research Use](#-license--research-use)

---

## 📚 Engineering Documentation Directory

For complete architecture, clinical safety specifications, persistence models, and testing protocols, consult the dedicated documentation suite:

| Document | Description |
| :--- | :--- |
| [**`docs/ARCHITECTURE.md`**](docs/ARCHITECTURE.md) | Component architecture, trust boundaries, speech-to-text, specialist board, blackboard model, and TTS pipeline. |
| [**`docs/CLINICAL-SAFETY.md`**](docs/CLINICAL-SAFETY.md) | Deterministic emergency floors, non-downgrade invariant, universal red-flag catalog, and clinical boundaries. |
| [**`docs/DATA-AND-PERSISTENCE.md`**](docs/DATA-AND-PERSISTENCE.md) | Consultation lifecycle, SHA-256 chained audit ledger, optimistic concurrency (`caseVersion`), and Drizzle ORM migrations. |
| [**`docs/OPERATIONS.md`**](docs/OPERATIONS.md) | Deployment topology, environment configuration, empirical latency benchmarks, resilience, and release gates. |
| [**`docs/TESTING.md`**](docs/TESTING.md) | 60-suite regression inventory, deterministic coverage generation (`c8`), LCOV/Cobertura artifacts, and CI gates. |
| [**`docs/PAPER.md`**](docs/PAPER.md) | Scientific manuscript, clinical triage concordance analysis, and 20-point audit specification. |

---

## 🏛️ System Architecture Overview

MedVoice AI is architected around strict safety boundaries where non-deterministic LLM reasoning is bounded by deterministic safety arbiters, cryptographic audit chains, and auditable evidence provenance:

```mermaid
flowchart TD
    subgraph Client["Browser Runtime (Next.js / React 19)"]
        A["Microphone Input (MediaStream)"] --> B["Acoustic DSP Analyzer\n(25ms/10ms, RMS, VAD, f0)"]
        B -.->|"Observational Telemetry Only"| C["VoicePill UI & Patient State"]
        A --> D["Speech-to-Text (Whisper / ASR)"]
        M["Interactive Care Map\n(5-State Gated Location)"]
    end

    subgraph AudioEngine["Local Neural Audio Pipeline"]
        D --> E["Canonical Transcript"]
        N["Adaptive First-Chunk Chunker"] --> O["Kokoro-82M q4 CPU TTS"]
        O -->|"Streamed Audio Chunks"| P["Audio Playback Buffer (0ms Starvation)"]
    end

    subgraph SafetyShield["Deterministic Dual-Arbiter Shield"]
        E --> F["Pre-Arbiter Safety Filter\n(Deterministic Emergency Flagging)"]
        F --> G["Bounded Multi-Specialist Board\n(Internal Med, Cardio, Neuro, Peds)"]
        G <--> H["Asynchronous In-Memory Blackboard"]
        H --> I["Deterministic Lexical RAG\n(2,112 Local MedlinePlus Passages)"]
        G --> J["Post-Arbiter Safety Shield\n(Non-Downgrade & Negation Verifier)"]
    end

    subgraph DurableLedger["Durable Integrity & Export"]
        J --> K["Structured Clinical State & Provenance"]
        K --> N
        K --> L["Durable SHA-256 Audit Ledger\n(Neon PostgreSQL / Local Fallback)"]
        K --> Q["HL7 FHIR R4 Bundle Serializer\n(Encounter, Condition, Observation)"]
    end
```

---

## 🔬 Audited Technical Specifications & Code Reality

This specification documents the verified codebase implementation across clinical reasoning, safety, audio latency, and infrastructure:

### 1. Bounded Multi-Specialist Decision Architecture
* **Implementation Reality (Heuristic Decision Modules)**: Specialist modules (Lead Internist, Cardiology, Neurology, Pediatrics, ENT) operate as an in-memory heuristic coordination pattern. They execute deterministic rule filters, slot extractors, and bounded prompt templates with simulated deliberation rounds. They do **not** function as autonomous, unconstrained LLM physician agents or concurrent independent cognitive entities.
* **Diagnostic & Clinical Scoring Tools**: Clinical scoring tools (e.g., TIMI, BE-FAST, NIHSS, PEWS criteria) are **software heuristic calculation rules** evaluating patient-reported symptoms, textual survey inputs, and self-reported vital ranges. The system has **zero biological sensor connections, zero direct 12-lead ECG hardware acquisition, and zero certified medical device interfaces**. Any ECG-related parameters evaluate patient-reported verbal descriptors only and are unvalidated for acute clinical diagnosis.
* **Blackboard Model**: A bounded asynchronous in-memory clinical blackboard coordinates specialist observations, hypotheses, and clinical synthesis across bounded execution rounds (maximum 2 deliberation passes).

### 2. Deterministic Dual-Arbiter Safety Shield
* **Pre-Arbiter & Post-Arbiter**: Deterministic safety arbiters execute before and after LLM synthesis:
  - **Emergency Precedence**: High-acuity physiological presentations (e.g., acute coronary syndrome, stroke signs, severe pediatric respiratory distress) enforce an emergency floor (ESI-1 / ESI-2).
  - **Non-Downgrade Invariant**: Downstream LLM passes are cryptographically and deterministically forbidden from overriding or downgrading an emergency trigger.
  - **Missing vs. Denied Semantics**: Explicitly denies false symptom conflation (e.g., an unasked symptom is treated as `unresolved`, not `denied`).
  - **Output Sanitization & Anti-Leakage**: Clinical output sanitization filters prevent unsupported diagnostic assertions or internal prompt instructions from leaking into patient-facing verbal responses.

### 3. Triage Benchmark & Safety Concordance
* **Benchmark Scope**: The evaluation harness contains 35 standardized clinical benchmark scenarios: 22 high-acuity emergency cases and 13 non-emergency control cases across cardiac, neurological, pediatric, and general medicine domains.
* **Concordance Rate**: Achieved **100% emergency sensitivity (22/22)** on the evaluated 35-case benchmark. The system correctly separated all 22 life-threatening presentations from controls without false-negative downgrades. (Note: Evaluated on this finite test population; not a claim of universal population-level clinical accuracy).

### 4. Latency Profiles, STT Dependency & Pipeline Reality
* **Arbiter Latency**: Mean deterministic safety-arbiter latency was **0.39 ms** in local Node.js benchmarks, with **P50 at 0.14 ms**.
* **Deterministic Lexical RAG**: In-memory multi-field guideline retrieval across 2,112 passages evaluates in **4.2 ms mean** (P95: 8.1 ms).
* **Local Whisper STT Component**: CPU inference using OpenAI Whisper `base.en` (74M parameters) requires **1.0–2.5 s** warm transcription for short clinical utterances (cold start: 1.5–3.0 s, model load: ~2–4 s).
* **Kokoro-82M TTS Baseline**: Engine-level Kokoro-82M q4 CPU synthesis latency is approximately 0.93–0.96 s P50 for short 5-word inputs.
* **Adaptive First-Chunk Optimization**: To eliminate compound response lag, the audio engine adaptively partitions speech into an immediate introductory clause (4–8 words) synthesized ahead of subsequent paragraphs (TTFA: **1.1–1.6 s** with zero measured playback buffer starvation).
* **Full End-to-End Voice Latency Reality**: In a live voice consultation (Microphone $\rightarrow$ STT $\rightarrow$ Remote LLM $\rightarrow$ TTS $\rightarrow$ Playback), full conversational turn turnaround is **2.5–5.0+ seconds**. Sub-second turnaround applies **strictly** to local deterministic safety pre-arbiter evaluations and pre-cached emergency alerts. The full voice pipeline does **not** meet sub-second targets.
* **Speech-to-Text (STT) Infrastructure Status**:
  - The Next.js `/api/voice/stt` bridge implements dual-engine ASR routing:
    - **Primary Engine**: When `GROQ_API_KEY` is configured and valid, incoming audio is dispatched to **Groq Cloud Whisper (`whisper-large-v3-turbo`)** for sub-second, highly accelerated transcription.
    - **Fallback Engine**: If `GROQ_API_KEY` is absent, times out (10s abort), or returns an upstream error, the route automatically fails over to the local FastAPI Whisper microservice (`FASTAPI_URL`, default: `http://127.0.0.1:8000/api/v1/stt`) running **`openai-whisper` (`base.en`)** on CPU.
  - **Explicit Error & Anti-Hallucination Invariant**: If both Groq and local FastAPI fail or are offline, `/api/voice/stt` returns `503 Service Unavailable` with an explicit prompt for the patient to repeat. It **never** returns fabricated clinical symptoms.
  - **Active Blocker**: Live browser streaming chunk coordination and empty transcript edge-cases remain an active engineering blocker and work in progress.

### 5. Runtime Paralinguistic Acoustic DSP Analyzer
* **Microphone DSP Pipeline**: The browser runtime offloads short-term acoustic feature extraction to a dedicated `AudioWorkletNode` ([`public/worklets/acoustic-dsp-processor.js`](public/worklets/acoustic-dsp-processor.js)) running off the main UI thread with pre-allocated zero-allocation ring buffers, retaining a transparent `ScriptProcessorNode` fallback for legacy environments. Audio is framed using **25 ms analysis windows** and **10 ms hop intervals** at $16\text{ kHz}$.
* **Measured Parameters**: Real-time Root-Mean-Square (RMS) energy, dBFS calculations, energy-based Voice Activity Detection (VAD threshold: −38 dBFS), conversational pause cadence, and autocorrelation fundamental frequency ($f_0$).
* **Clinical Isolation Boundary**: Acoustic measurements serve strictly as observational telemetry in the UI and supportive evidence in clinical documentation. They are strictly isolated and are **never** used as autonomous diagnostic biomarkers or ESI triage escalators.

### 6. Deterministic Multi-Field Clinical RAG Engine
* **Corpus**: 2,112 processed MedlinePlus XML-derived passages indexed locally alongside curated clinical practice guidelines for retrieval-augmented specialist reasoning.
* **Scoring Formulation**: Retrieval executes in-memory deterministic multi-field lexical matching with domain alignment and authority weighting (no BM25 or Dense DPR vector embeddings):
  $$S(d, q) = \left( L_{\text{multi-field}}(d, q) + \Delta_{\text{domain}} \right) \times \gamma_{\text{section}} + \alpha_{\text{auth}}$$
  where:
  - $L_{\text{multi-field}}(d, q)$ calculates exact and partial token overlap across title, keywords, and passage body.
  - $\Delta_{\text{domain}}$ applies targeted clinical domain bonuses (cardiac, neuro, pediatrics, triage).
  - $\gamma_{\text{section}}$ weights primary indications vs. background reference sections.
  - $\alpha_{\text{auth}}$ enforces authority weighting for peer-reviewed guidelines.
* **Reference Categories**: Task-aware retrieval routes queries over locally curated, pre-indexed, source-tagged medical reference categories corresponding to RxNorm, DailyMed, and openFDA information domains (without unverified live HTTP external API dependencies).

### 7. Durable SHA-256 Chained Audit Ledger
* **Tamper-Evident Ledger**: A durable SHA-256 chained audit ledger records clinical state transitions, triage dispositions, arbiter decisions, and associated provenance.
* **Cryptographic Linking**: Each audit event stores monotonic index $i$, timestamp, payload hash, and `previousHash` linking directly to block $i-1$:
  $$\text{Hash}_i = \text{SHA-256}\left( i \,\|\, \text{prevHash} \,\|\, \text{timestamp} \,\|\, \text{eventType} \,\|\, \text{SHA-256}(\text{payload}) \right)$$
* **Durable Persistence**: Backed by Neon serverless PostgreSQL with transactional serialization to defend against concurrent write races, with automatic verified memory fallback for development resilience.

### 8. HL7® FHIR® R4 Bundle Export & Provenance
* **Interoperability Standard**: Generates structured HL7® FHIR® R4 `Bundle` objects containing `Patient`, `Encounter`, `Condition`, `Observation`, and `Composition` (clinical SOAP note) resources.
* **Provenance Verification**: Every clinical entity carries explicit provenance tags (`patient_reported`, `clinician_verified`, `device_measured`, or `arbiter_enforced`).
* **Paralinguistic Representation**: FHIR bundles represent verified clinical telemetry (e.g., ESI acuity); runtime acoustic telemetry is recorded as descriptive device/intake metadata rather than unstandardized standalone clinical observations.

### 9. Geospatial Emergency Facility Discovery & Road Routing
* **State Machine Architecture**: Eliminates unverified location defaults via an explicit 5-state finite state machine in `/care`:
  ```text
  LOCATION_UNKNOWN ──► LOCATION_PERMISSION_REQUESTED ──► LOCATION_RESOLVED (GPS)
         │                                                        ▲
         ▼                                                        │
  LOCATION_PERMISSION_DENIED ──► LOCATION_MANUALLY_SELECTED ──────┘
  ```
* **Strict Query Gating**: Zero hospital discovery queries fire on initial mount. Queries require verified non-null coordinates or explicit user region selection.
* **Backend Validation**: `/api/hospitals` rejects missing or out-of-range coordinates with `400 Bad Request`.
* **Routing Telemetry**: Computes driving distance, estimated road transit times, and verified Emergency Department capabilities (decoupled from direct municipal 911 dispatch).

### 10. Monotonic Barge-in Interruption
* **Session Invalidation**: Interactive speech playback utilizes monotonic playback-session token counters.
* **Low-Latency Cancellation**: When new user speech or VAD interruption is detected, the audio controller invalidates the current playback token, immediately pausing audio output and clearing queued buffers before new transcription begins.

### 11. Code Reality & Audit Concordance Matrix (20-Point Specification)

The following matrix documents the verified technical alignment across all 20 evaluated dimensions between prior claims, codebase reality, and adopted specifications (detailed in [docs/PAPER.md](docs/PAPER.md)):

> [!NOTE]
> **Status Legend & Concordance Governance**:
> - 🟢 **Resolved / In Full Concordance**: Discrepancy between historical claims and codebase reality is resolved; the adopted specification formally reflects the verified implementation, and component behavior is backed by reproducible automated tests or benchmarks. Green indicates architectural alignment, not unmeasured universal performance or clinical clearance.
> - 🟡 **Scoped / Operational Boundary**: Feature is implemented and verified under documented operational constraints (e.g., benchmark sensitivity bounds, local isolation, or decoupled routing).
> - 🔴 **Unresolved Discrepancy**: Active contradiction between specification claims and codebase execution.

| # | Topic | Status | Code Reality & Verification | Adopted Specification & Paper Language |
|:---:|:---|:---:|:---|:---|
| **1** | Multi-Agent Board | 🟢 | Software decision heuristics and prompt templates with bounded execution rounds; not autonomous physicians. | Bounded multi-specialist heuristic decision architecture comprising generalist and specialty modules with simulated deliberation. |
| **2** | Shared Blackboard | 🟢 | In-memory blackboard coordinating specialist observations with bounded execution rounds. | Bounded asynchronous in-memory clinical blackboard coordinating specialist observations and synthesis. |
| **3** | Diagnostic Tools | 🟢 | Deterministic heuristic rules evaluate patient-reported symptoms; zero 12-lead ECG sensor or hardware acquisition. | Clinical scoring tools evaluate patient-reported signs and survey inputs; ECG scoring does not imply direct 12-lead hardware acquisition. |
| **4** | Dual-Arbiter Shield | 🟢 | Deterministic pre/post arbiters enforce emergency floor, missing-vs-denied semantics, and non-downgrade. | Retained as primary safety guarantee enforcing $\text{ESI}_{\text{final}} = \min(\text{ESI}_{\text{pre}}, \text{ESI}_{\text{llm}})$. |
| **5** | Triage Concordance | 🟢 | Standardized 35-case benchmark (22 emergency cases, 13 controls): 100% emergency sensitivity (22/22), 97.1% overall accuracy (34/35), zero missed emergency cases in the benchmark, and 23 unsafe model downplays overridden by the deterministic safety arbiter. | Replaced the unqualified universal-accuracy claim with a bounded benchmark specification. Results apply to this test set only; prospective clinical validation and real-world performance remain unestablished. |
| **6** | Arbiter Latency | 🟢 | Node.js v22 CPU benchmark measurements. | Mean safety-arbiter latency was 0.39 ms in the local Node.js benchmark; P50 was 0.14 ms. |
| **7** | Kokoro-82M TTFA | 🟢 | CPU engine baseline is approximately 0.93–0.96 s P50 for short 5-word inputs. Adaptive first-chunk synthesis achieves 1.1–1.6 s TTFA for compound turns, with a reported 61.4% reduction in waiting time and no buffer starvation observed in the chunker test. | Replaced the unsupported 142 ms claim with the measured CPU latency profile and the validated adaptive chunking approach. |
| **8** | Turn-Taking & Latency | 🟢 | Dual-path latency specification: emergency preemption dispatches cached directives in under 1 ms in the reported benchmark; adaptive local TTS achieves 1.1–1.6 s first-chunk latency in reported tests. Full network-mediated conversational turnaround is documented at 2.5–5.0+ s. | Replaced the universal sub-second turn-taking claim with an explicitly scoped dual-path specification. Component-level tests and benchmarks support the reported figures; end-to-end browser and network performance remain separately scoped. |
| **9** | Paralinguistic DSP | 🟢 | AudioWorklet offloading (`acoustic-dsp-processor.js`) with zero-allocation buffers, 25 ms/10 ms framing, RMS/dBFS VAD, autocorrelation $f_0$, and ScriptProcessor fallback (50/50 parity tests). | Browser runtime extracts short-term acoustic features as observational telemetry only; not used as autonomous diagnostic biomarkers. |
| **10** | MedlinePlus RAG | 🟢 | 2,112 processed passages + curated guidelines loaded locally. | Offline MedlinePlus XML-derived passages indexed locally alongside curated clinical practice guidelines. |
| **11** | RAG Math | 🟢 | Deterministic multi-field lexical, domain, section, and authority formula verified by automated benchmark (100% MRR, 100% Hit@3; 5/5 cases). | Adopted and verified formula replaces legacy BM25/DPR: $S(d, q) = (L_{\text{multi-field}}(d, q) + \Delta_{\text{domain}}) \times \gamma_{\text{section}} + \alpha_{\text{auth}}$. |
| **12** | Medication Routing | 🟢 | Deterministic medication reconciliation, contraindication screening (DailyMed / openFDA rules), and allergy cross-checks (12/12 tests). | Task-aware retrieval routes queries over locally curated, pre-indexed source-tagged content corresponding to RxNorm, DailyMed, and openFDA categories. |
| **13** | SHA-256 Ledger | 🟢 | Durable SHA-256 chained audit records with Neon PostgreSQL persistence. | Durable SHA-256 chained audit ledger provides tamper-evident event integrity and traceability. |
| **14** | Reasoning Logging | 🟡 | Internal CoT is isolated from permanent medical records. | Records auditable clinical state transitions, triage dispositions, arbiter decisions, and associated provenance. |
| **15** | HL7 FHIR Export | 🟢 | FHIR R4 document bundle generation validated by automated tests (43/43 passed). | Generates FHIR R4 bundles validated by automated serialization, provenance, and structural tests. |
| **16** | Paralinguistic FHIR | 🟢 | Enriched HL7 FHIR R4 export with structured acoustic Observation resources (7 physical metrics, UCUM units, provenance, safety boundaries; 7/7 tests). | FHIR bundles include structured clinical observations (e.g., ESI acuity) and dedicated paralinguistic acoustic telemetry observations with validated units. |
| **17** | Emergency Dispatch | 🟡 | Care Network provides facility discovery & road routing; gated 5-state location FSM. | Geospatial Emergency Facility Discovery & Road Routing; decoupled from public 911 dispatch. |
| **18** | Barge-in Latency | 🟢 | Monotonic playback token invalidation, safety-gated SSE streaming, and cross-chunk false reassurance interception (7/7 tests). | Low-latency barge-in cancellation using monotonic playback-session invalidation, verified by automated acceptance tests. |
| **19** | Anti-Leakage | 🟢 | Sanitizers strip internal prompt tokens and unverified diagnostic labels. | Clinical output sanitization prevents selected internal/unsupported details from leaking into patient-facing responses. |
| **20** | Diagnostic Scope | 🟢 | Framed as clinical decision support/triage intake prototype. | The system is designed for AI-assisted intake, triage, and clinical decision support and does not autonomously diagnose patients. |

---

## 🛠️ Technology Stack

| Layer | Technologies |
|---|---|
| **Frontend Framework** | [Next.js 16 (App Router)](https://nextjs.org/), [React 19](https://react.dev/), [TypeScript](https://www.typescriptlang.org/) |
| **Styling & UI** | [Tailwind CSS v4](https://tailwindcss.com/), [Motion](https://motion.dev/), [Lucide React](https://lucide.dev/) |
| **Mapping & Geospatial** | [Leaflet](https://leafletjs.com/), OpenStreetMap Tile Servers, OSRM Road Routing |
| **Audio & Speech Engine** | Whisper STT, [Kokoro-82M](https://github.com/hexgrad/kokoro) (ONNX / WebAssembly CPU), Web Audio API DSP |
| **Security & Auth** | [Clerk](https://clerk.com/) Server Authentication, Role-Based Access Control (RBAC), CSP Report-Only |
| **Persistence & Audit** | [Neon PostgreSQL](https://neon.tech/) Serverless, Drizzle ORM, SHA-256 Hash Chain Ledger |
| **Healthcare Standards** | HL7® FHIR® R4, Emergency Severity Index (ESI) v4, ICD-10 Category Tagging |

---

## 📁 Repository Structure

```text
ai-medical-voice-agent/
├── app/
│   ├── _components/                # UI components (InteractiveRouteMap, VoicePill)
│   ├── api/
│   │   ├── audit/                  # Cryptographic SHA-256 audit ledger endpoint
│   │   ├── consultations/          # Consultation lifecycle & FHIR R4 export
│   │   ├── hospitals/              # Gated healthcare facility discovery
│   │   ├── route/                  # Road routing & ETA calculation
│   │   ├── triage/                 # Deterministic clinical safety triage
│   │   └── voice/                  # Voice STT, chat reasoning, and TTS routes
│   ├── care/                       # Geospatial emergency care network
│   ├── consult/                    # Live interactive clinical voice consultation
│   ├── layout.tsx                  # Root layout & global providers
│   └── page.tsx                    # Platform landing page & overview
├── lib/
│   ├── acoustic/                   # 25ms/10ms acoustic DSP analyzer & feature extraction
│   ├── agents/                     # Specialist board, schemas & orchestrator
│   ├── audio/                      # Adaptive first-chunk sentence splitter & audio pipeline
│   ├── care-network/               # Hospital RAG & facility discovery services
│   ├── fhir/                       # HL7 FHIR R4 Bundle generator & validator
│   ├── security/                   # RBAC, IDOR guards, and error detail sanitizers
│   └── triage/                     # Deterministic pre-arbiter & post-arbiter safety shields
├── scripts/                        # Automated regression suites & clinical benchmarks
├── tests/                          # Security, RBAC, durable audit & FHIR evaluation suites
├── next.config.ts                  # Security headers, CSP & Next.js configuration
├── package.json                    # Dependencies & test runners
└── README.md                       # System documentation
```

---

## 📊 Acoustic DSP Performance & Validation

MedVoice incorporates an in-memory, client-side paralinguistic acoustic DSP analyzer ([`lib/acoustic/acoustic-dsp-analyzer.ts`](lib/acoustic/acoustic-dsp-analyzer.ts)) and dedicated AudioWorklet processor ([`public/worklets/acoustic-dsp-processor.js`](public/worklets/acoustic-dsp-processor.js)) designed to extract standardized physical voice characteristics off the main UI thread without cloud egress, external API dependencies, or heavy neural networks.

> [!IMPORTANT]
> **Strict Clinical Isolation**: Acoustic measurements serve strictly as descriptive observational telemetry in the clinical encounter record and HL7® FHIR® R4 export. They **never** make autonomous clinical diagnoses, calculate disease probabilities, or alter Emergency Severity Index (ESI) triage tiers.

### 1. Mathematical Telemetry & Derived Features
The lightweight runtime processes short-term PCM frames (25 ms analysis window, 10 ms hop interval):
* **Fundamental Frequency ($F_0$)**: Extracted via normalized autocorrelation across clinical vocal registers ($60\text{ Hz} \le F_0 \le 400\text{ Hz}$) with confidence threshold gating ($\ge 0.45$). Unvoiced frames strictly yield `null` (never fabricated as $0\text{ Hz}$).
* **Root-Mean-Square (RMS) Energy & Decibels**: Short-term frame energy converted to logarithmic amplitude bounded between $-100\text{ dBFS}$ (silence floor) and $0\text{ dBFS}$ (peak).
* **Voice Activity Detection (VAD)**: Energy-based voice activity detector configured with an engineering threshold of $-38\text{ dBFS}$.
* **Conversational Pause Dynamics**: Tracks contiguous silence runs ($\ge 150\text{ ms}$) to compute total pause duration, pause count, and the dimensionless speech-to-pause ratio ($[0.0, 1.0]$).
* **Pitch & Energy Variability**: Computes the normalized **Coefficient of Variation** ($CV = \frac{\sigma}{\mu}$, dimensionless ratio, UCUM unit `{ratio}`, code `1`) across voiced frames. *Note: This represents relative dispersion, distinct from raw variance ($\text{Hz}^2$).*

---

### 2. Empirical Benchmark Suite & Commands

MedVoice provides two dedicated CLI performance harnesses, an AudioWorklet mathematical parity battery, and an automated FHIR serialization verification battery:

```bash
# 1. Synthetic Calibrated DSP Benchmark (Male/Female pitch tones, variable pauses, 1s - 30s)
npm run benchmark:acoustic

# 2. Representative Clinical Speech Benchmark (N=20 Kokoro-82M speech files + noise injection)
npm run benchmark:acoustic-real

# 3. Dedicated HL7 FHIR R4 Paralinguistic Observation Serialization & Provenance Battery
npm run test:fhir-paralinguistic

# 4. AudioWorklet Mathematical Parity & Fallback Battery (50 automated unit & lifecycle tests)
npm run test:worklet-parity
```

#### Interpretation of Real-Time Factor ($RTF$)
$$\text{RTF} = \frac{\text{Processing Time } (T_{\text{proc}})}{\text{Audio Duration } (T_{\text{audio}})}$$
* $\text{RTF} < 1.0$: Audio is processed faster than real-time playback.
* $\text{RTF} < 0.05$ (**MedVoice Engineering Gate**): Audio is processed $\ge 20\times$ faster than real-time, ensuring negligible CPU consumption.

---

### 3. Tested CPU-Only Execution Performance

*The following metrics were empirically measured on an Intel/AMD x64 development workstation running Node.js v22.22.0. Actual execution times will vary depending on device CPU clock speed and background system load.*

| Benchmark Corpus | Total Audio Duration | Total CPU Compute Time | Median Processing Latency | Median Real-Time Factor ($RTF$) | Aggregate Throughput |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Synthetic Audio (1s – 30s @ 16 kHz)** | $49.0\text{ s}$ | $298.6\text{ ms}$ | $29.4\text{ ms}$ | **0.0059** | **$164.1\times\text{ real-time}$** |
| **Clinical Speech Corpus ($N=20$ @ 16 kHz)** | $170.6\text{ s}$ | $935.1\text{ ms}$ | $47.0\text{ ms}$ | **0.0054** | **$182.4\times\text{ real-time}$** |

#### Key Engineering Findings
1. **Zero GPU Dependency**: Pure CPU processing requires only **$\sim 47\text{ ms}$** to analyze an entire $10\text{-second}$ patient utterance ($\text{RTF} \approx 0.005$). Introducing a GPU or neural paralinguistic model (e.g. Wav2Vec2/HuBERT) is computationally unjustified for basic FHIR R4 acoustic observations.
2. **Mandatory Anti-Aliased Decimation ($48\text{ kHz} \to 16\text{ kHz}$)**:
   - At native $48\text{ kHz}$ Web Audio, autocorrelation search space scales quadratically $O(N \cdot K)$, causing a $9\times$ multiplication penalty ($1,859\text{ ms}$ compute time).
   - Downsampling to $16\text{ kHz}$ with a 5-tap symmetric anti-aliasing FIR filter drops execution time to **$53\text{ ms}$** with zero loss of pitch estimation accuracy ($\pm 0.0\text{ Hz}$).
3. **Noise Robustness**: Under simulated clinical noise floors ($+25\text{ dB}$ to $+8\text{ dB SNR}$ emergency room acoustic stress), confidence-gated pitch drift remained within $\pm 2.4\text{ Hz}$ without pitch hallucinations on unvoiced intervals.

---

### 4. Critical Path Latency & Integration Boundary

```
[Patient Utterance (10s)]
       ├──► Whisper STT (350ms) ──► Groq LLM (400ms) ──► Kokoro TTS (180ms) ──► [Doctor Speaks Audio] (930ms TTFA)
       └──► [Asynchronous AudioWorklet / Worker Buffer] ──► 16kHz DSP (47ms) ──► [Populates FHIR Observation] (0ms penalty)
```

* **Decoupled Asynchronous Execution**: In the MedVoice client architecture, acoustic DSP execution is decoupled from the conversational turn-taking critical path. Voice synthesis starts immediately upon LLM token generation; acoustic features are committed to the clinical record at turn boundary.
* **Kaggle vs. Production Boundary**: Kaggle GPU notebooks are strictly reserved for **offline research experimentation** on synthetic or public benchmark speech corpora (e.g., exploring neural speech models via [`scripts/kaggle_paralinguistic_benchmark.py`](scripts/kaggle_paralinguistic_benchmark.py)). Kaggle is **not** part of MedVoice's live production or runtime architecture.
* **Corpus Provenance & Privacy**: All benchmark audio fixtures (`LAT-01` through `LAT-20`) are 100% synthetic audio files generated via local open-weights Kokoro-82M neural voices from standardized clinical text vignettes. Zero real patient biometric data or protected health information (PHI) is contained or committed.
* **Known Limitations**: Synthetic and clean audio benchmarks establish mathematical correctness and algorithmic speed. They do **not** constitute clinical validation for detecting physical vocal cord pathologies, dyspnea, or stridor.

For complete latency distributions, noise injection tables, and mathematical derivations, see the [**`reproducible-evidence-report.md`**](reproducible-evidence-report.md).

---

## 🧪 Verification, Test Suites & Coverage

MedVoice includes an automated test battery with **60 canonical verification suites** (58 offline suites, 2 live database-gated) spanning clinical safety arbiters, security RBAC, durable audit ledgers, paralinguistic DSP, and audio pipelines. For detailed breakdowns, tier definitions, and CI gates, see [**`docs/TESTING.md`**](docs/TESTING.md).

```bash
# 1. Run the Full 60-Suite Canonical Regression Battery (Isolated Offline Mode)
npm run test:battery

# 2. Run Acoustic DSP Performance & Robustness Benchmarks
npm run benchmark:acoustic      # Synthetic calibrated tone & pause matrix
npm run benchmark:acoustic-real # N=20 clinical speech corpus + noise injection

# 3. Run Deterministic Coverage Reporting (c8 via tsx)
# Produces coverage/lcov.info, coverage/cobertura-coverage.xml, and terminal summary
npm run test:coverage

# 4. Dedicated Real PostgreSQL Integration Test Harness
# Connects to live database when DATABASE_URL is set; reports explicit SKIPPED if unset
npm run test:db

# 5. Individual Test Suites (Examples)
npm run test:security        # RBAC, IDOR guards, and CSP headers
npm run test:durable-audit   # Cryptographic SHA-256 audit ledger & CAS concurrency
npm run test:goldendialogue  # 11-turn clinical dialogue & negation invariants
npm run test:voicestate      # Voice lifecycle & buffer discard
npm run test:fhir            # HL7 FHIR R4 Bundle serialization & provenance
npm run test:worklet-parity  # AudioWorklet DSP mathematical parity & fallback battery
```

### Empirical Coverage Baseline & CI Thresholds
Test coverage is instrumented via `c8` targeting maintained application code (`lib/`, `config/`, `app/api/`) and excluding test harnesses and node_modules:
- **Statements**: $\ge 60.0\%$ (Empirical Baseline: **65.37%**)
- **Branches**: $\ge 65.0\%$ (Empirical Baseline: **71.92%**)
- **Functions**: $\ge 75.0\%$ (Empirical Baseline: **81.97%**)
- **Lines**: $\ge 60.0\%$ (Empirical Baseline: **65.37%**)

---

## 🚀 Getting Started & Safe Demo Guidance

### Prerequisites
- **Node.js** >= 18.18.0 (Node.js 20 or 22 LTS recommended)
- **npm** >= 9.0.0
- *(Optional)* Access to Neon PostgreSQL connection string (`DATABASE_URL`) for durable audit persistence.

### Quick Start
1. **Clone the repository**:
   ```bash
   git clone https://github.com/PuneethPujala/ai-medical-voice-agent.git
   cd ai-medical-voice-agent
   ```
2. **Install dependencies**:
   ```bash
   npm install
   ```
3. **Configure environment variables** (create `.env.local` from template):
   ```bash
   cp .env.example .env.local
   ```
   Add your Clerk credentials and optional LLM keys:
   ```env
   # Authentication
   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_sample
   CLERK_SECRET_KEY=sk_test_sample

   # Optional Database (falls back gracefully to in-memory store if omitted)
   DATABASE_URL=postgresql://user:pass@ep-cool-db.neon.tech/neondb?sslmode=require

   # Speech & Inference (falls back to local deterministic engine if omitted)
   NVIDIA_API_KEY=your_key
   GROQ_API_KEY=your_key
   ```
4. **Run the local development server**:
   ```bash
   npm run dev
   ```
5. **Open in browser**: Navigate to [http://localhost:3000](http://localhost:3000).

### 🛡️ Safe Demonstration Guidance
When conducting product demonstrations or evaluating capabilities:
- **Use Mock Mode / Test Harness**: Set `INTERNAL_TEST_HARNESS_SECRET` in `.env.local` to execute reproducible automated test scenarios without live patient risk.
- **Simulated Presentations**: Test emergency preemption safely by saying or typing standardized test inputs (e.g. *"I have severe crushing chest pain radiating to my jaw"*). Verify that the system stops intake, locks urgency at Tier 1 / Tier 2, and displays immediate emergency medical service guidance.
- **Acoustic DSP**: Test microphone analysis in `/consult`; note that pitch and energy values displayed in the VoicePill UI are observational telemetry and do not alter the clinical triage level.

---

## ⚠️ Clinical & Regulatory Boundary Disclaimers

> **IMPORTANT CLINICAL NOTICE**
> MedVoice AI is an investigational clinical decision support and triage intake prototype designed to assist healthcare personnel with patient intake, structured clinical documentation, and emergency risk stratification.
>
> 1. **No Autonomous Diagnosis**: The platform does not make autonomous clinical diagnoses, prescribe medication, or formulate independent medical treatment plans.
> 2. **Emergency Protocol**: For suspected life-threatening medical emergencies (including crushing chest pain, symptoms of acute stroke, severe breathing difficulty, or anaphylaxis), patients must immediately call **911** (or local emergency medical services) or proceed to the nearest emergency department.
> 3. **Observational Acoustic Telemetry**: Paralinguistic speech measurements (pitch, energy, pause duration) are observational acoustic telemetry only and are not certified diagnostic biomarkers.
> 4. **Regulatory Status**: This software is not cleared or approved by the U.S. Food and Drug Administration (FDA), European Medicines Agency (EMA), or any other regulatory body as a medical device (SaMD).

---

## 📜 License & Research Use

No open-source license has currently been specified for this repository. No permission to redistribute or commercially use the code is granted by this README. For licensing or reuse inquiries, please contact the project maintainers.

MedVoice is an academic capstone research prototype. It is not intended for clinical production use, and its outputs must not replace professional medical judgment.
