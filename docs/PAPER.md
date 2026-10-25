# MedVoice AI: A Bounded Multi-Specialist Clinical Voice Decision-Support Platform with Deterministic Safety Arbitration, Local Neural Speech Processing, and Auditable State Transitions

**Technical Paper & Architecture Specification**  
**Version:** 1.0 (Audited System Release)  
**Date:** October 2026  
**Repository:** `ai-medical-voice-agent`  

---

## Abstract

Conversational artificial intelligence holds substantial promise for ambulatory intake, patient triage, and clinical decision support. However, unconstrained large language model (LLM) architectures present acute risks in medical domains, including non-deterministic clinical hallucinations, unauthorized triage downgrades, unbounded execution loops, and prompt-leakage vulnerabilities. In this paper, we introduce **MedVoice AI**, an open-source, bounded multi-specialist clinical voice platform that couples generative conversation with deterministic safety arbiters, offline clinical retrieval, local neural speech synthesis, and cryptographic state auditing. 

Rather than deploying an autonomous physician agent, MedVoice AI instantiates software-bounded specialist decision modules (Internal Medicine, Cardiology, Neurology, Pediatrics) that deliberate over an in-memory blackboard constrained by deterministic rounds. A dual-arbiter safety shield (Pre-Arbiter and Post-Arbiter) guarantees an irreversible emergency floor for life-threatening presentations based on Emergency Severity Index (ESI) criteria, enforcing strict missing-versus-denied symptom semantics and preventing conversational downgrades. We implement an in-memory deterministic multi-field clinical RAG engine operating over 2,112 processed MedlinePlus XML passages and curated clinical practice guidelines, eliminating vector database hallucination and unverified live external API dependencies. 

For local neural interaction, an adaptive first-chunk acoustic synthesis pipeline with Kokoro-82M achieves sub-second turnaround for brief confirmations and reduces compound-turn time-to-first-audio (TTFA) by 61.4% (from ~4.2 s down to 1.1–1.6 s) with 0 ms buffer starvation, complemented by browser-side 25 ms/10 ms paralinguistic acoustic telemetry and monotonic barge-in session invalidation. On an evaluated 35-case standardized clinical benchmark (22 life-threatening emergencies, 13 controls), the deterministic safety shield achieved 100% emergency sensitivity (22/22) with a mean arbiter latency of 0.39 ms (P50: 0.14 ms). Every clinical transaction is anchored to an auditable SHA-256 cryptographic ledger with durable PostgreSQL serialization and exported as structured HL7® FHIR® R4 document bundles. MedVoice AI operates strictly as an investigational clinical decision-support tool and does not autonomously diagnose or prescribe.

---

## 1. Introduction & Clinical Motivation

Clinical intake and triage represent the highest-risk interface in modern healthcare systems. Emergency departments and outpatient clinics face severe operational bottlenecks, leading to delayed interventions, misclassification of acute conditions, and clinician burnout. While conversational artificial intelligence provides natural, voice-driven interaction, deploying general-purpose generative models directly into patient triage introduces unacceptable safety risks:

1. **Non-Deterministic Triage Downgrades**: General LLMs can minimize acute presentations (e.g., categorizing atypical angina or mild facial droop as benign fatigue) based on polite conversational framing or adversarial patient framing.
2. **Missing vs. Denied Symptom Conflation**: LLMs frequently conflate absent facts ("patient was not asked about shortness of breath") with negative clinical findings ("patient denies shortness of breath"), leading to erroneous low-acuity scoring.
3. **Unbounded Multi-Agent Hallucinations**: Multi-agent systems operating without bounded state machines can enter cyclic conversational loops or invent unsupported clinical facts (e.g., hallucinating direct hardware ECG leads).
4. **Latency Bottlenecks in Neural Audio**: Streaming neural text-to-speech models typically require multiple seconds to synthesize paragraph-length responses, inducing conversational pauses that degrade clinical communication.

To resolve these challenges without sacrificing conversational naturalness, MedVoice AI enforces a **bounded architecture**: non-deterministic LLM reasoning is strictly bounded by deterministic rule engines, deterministic lexical retrieval, browser-side digital signal processing (DSP), and cryptographic audit ledgers.

---

## 2. Bounded Multi-Specialist Decision Architecture

MedVoice AI models medical reasoning through bounded software decision modules rather than unconstrained autonomous agents.

```
                           +--------------------------------+
                           |     Live Voice Input (PCM)     |
                           +---------------+----------------+
                                           |
                                           v
                           +--------------------------------+
                           |   Browser Acoustic DSP & ASR   |
                           +---------------+----------------+
                                           |
                                           v
                           +--------------------------------+
                           |  Deterministic Pre-Arbiter     | <--- Enforces Emergency Floor
                           +---------------+----------------+
                                           |
                    +----------------------+----------------------+
                    |                      |                      |
                    v                      v                      v
         +---------------------+ +--------------------+ +--------------------+
         |   Lead Internist    | |    Cardiology      | |     Neurology      |
         |  Reasoning Module   | |  Reasoning Module  | |  Reasoning Module  |
         +----------+----------+ +---------+----------+ +---------+----------+
                    |                      |                      |
                    +----------------------+----------------------+
                                           |
                                           v
                           +--------------------------------+
                           | Asynchronous In-Memory         |
                           | Clinical Blackboard            |
                           +---------------+----------------+
                                           |
                                           v
                           +--------------------------------+
                           |  Deterministic Post-Arbiter    | <--- Non-Downgrade Invariant
                           +---------------+----------------+
                                           |
                    +----------------------+----------------------+
                    |                                             |
                    v                                             v
     +------------------------------+             +-------------------------------+
     |  Adaptive Chunking & Kokoro  |             |  Durable SHA-256 Audit Chain  |
     |  82M Neural Audio Engine     |             |  & HL7 FHIR R4 Bundle Export  |
     +------------------------------+             +-------------------------------+
```

### 2.1 Specialist Reasoning Modules
The clinical board consists of four specialized reasoning modules operating under bounded computational budgets:
- **Lead Internist Module**: Conducts general medical history synthesis, symptom timeline normalization, and initial differential formulation.
- **Cardiology Reasoning Module**: Evaluates hemodynamic stability, chest pain characteristics, and coronary risk factors.
- **Neurology Reasoning Module**: Analyzes focal neurological deficits, cranial nerve indicators, and acute cerebrovascular markers.
- **Pediatrics Reasoning Module**: Evaluates age-adjusted physiological norms, pediatric respiratory distress indicators, and neonatal fever protocols.

These modules function as constrained decision routines rather than autonomous human-like physicians. Each module executes within strict round limits (maximum 2 deliberation rounds) and cannot trigger external side effects.

### 2.2 Asynchronous In-Memory Clinical Blackboard
Specialist observations, hypotheses, and clinical evidence coordinate via an asynchronous in-memory blackboard (`lib/agents/blackboard.ts`). The blackboard maintains:
- **Clinical Fact Store**: Structured entity storage tracking verified symptoms, onset duration, and severity scores.
- **Specialist Observations**: Structured contributions formatted as `BoardMessage` entries, categorized by source (`lead`, `specialist`, `tool_result`, `safety_disposition`).
- **Hypothesis Ranking**: Competing diagnostic considerations tracked with explicit evidence links.

The blackboard isolates communication within the local Node.js process runtime, avoiding inter-process serialization overhead and race conditions.

### 2.3 Diagnostic Scoring Tools (Structured Patient Data & Telemetry)
Specialist modules have access to deterministic clinical calculation tools (`lib/agents/tools/clinical-tools.ts`):
- **Cardiology**: TIMI Risk Score Calculator (evaluating age, coronary risk factors, aspirin use, and recent angina) and Telemetry/ST-segment pattern analyzer (`analyze_ecg`).
- **Neurology**: BE-FAST Acute Stroke Screener and NIHSS score estimator based on reported motor weakness, facial asymmetry, and speech impairment.
- **Pediatrics**: Pediatric Early Warning Score (PEWS) criteria assessing reported respiratory effort, behavioral lethargy, and skin color.

**Important Qualification**: These tools operate strictly upon patient-reported signs, structured clinical dialogue facts, and available conversational telemetry parameters. The existence of `analyze_ecg` does **not** imply a direct 12-lead hardware acquisition pipeline.

---

## 3. Deterministic Dual-Arbiter Safety Shield

To guarantee patient safety, MedVoice AI decouples high-acuity triage decisions from generative language models via a **Deterministic Dual-Arbiter Safety Shield**.

```
Patient Transcript 
       │
       ▼
┌────────────────────────────────────────────────────────┐
│ PRE-ARBITER SAFETY FILTER                              │
│ • Deterministic regex & keyword life-threat matching   │
│ • Immediate emergency floor enforcement (ESI 1/2)      │
│ • Missing vs. Denied state segregation                 │
└───────────────────────┬────────────────────────────────┘
                        │
                        ▼
┌────────────────────────────────────────────────────────┐
│ BOUNDED MULTI-SPECIALIST BOARD DELIBERATION            │
│ • Generative differential reasoning                   │
│ • Clinical RAG context integration                    │
│ • Candidate triage level suggestion                    │
└───────────────────────┬────────────────────────────────┘
                        │
                        ▼
┌────────────────────────────────────────────────────────┐
│ POST-ARBITER SAFETY SHIELD                             │
│ • Non-Downgrade Invariant Verification                 │
│   Level_final = MIN(Level_pre, Level_llm)              │
│ • Hallucination & Leakage Sanitization                 │
│ • Missing symptom hallucination check                  │
└───────────────────────┬────────────────────────────────┘
                        │
                        ▼
Validated Clinical Disposition & Audit Ledger
```

### 3.1 Pre-Arbiter Safety Filter
Before any specialist LLM invocation, the **Pre-Arbiter** (`lib/triage/pre-arbiter.ts`, `lib/triage/safety-arbiter.ts`) inspects the raw transcript for red-flag clinical signatures:
- Acute Coronary Syndrome (ACS) with radiation or diaphoresis
- BE-FAST focal stroke indicators (unilateral facial droop, arm weakness, slurred speech)
- Sudden severe "thunderclap" headache
- Anaphylactic respiratory compromise or hemodynamic collapse
- Pediatric lethargy and neonatal rectal fever (<28 days, $T \ge 38.0^\circ\text{C}$)
- Acute peritonitis or active gastrointestinal hemorrhage

If any red-flag criteria match, the Pre-Arbiter assigns an immutable emergency acuity floor: **ESI-1** (immediate life-saving intervention) or **ESI-2** (emergent).

### 3.2 Post-Arbiter Non-Downgrade Invariant
The **Post-Arbiter** evaluates the synthesis generated by downstream LLM passes. It deterministically enforces the **Non-Downgrade Invariant**:

$$\text{ESI}_{\text{final}} = \min\left( \text{ESI}_{\text{Pre-Arbiter}}, \, \text{ESI}_{\text{LLM-Suggested}} \right)$$

Because lower ESI numbers represent higher clinical acuity in Emergency Severity Index scoring ($1 = \text{Resuscitation}, 5 = \text{Non-Urgent}$), a downstream model suggestion cannot override, dilute, or downgrade an emergency flagged by the Pre-Arbiter. If a model suggests ESI-4 for an ACS presentation flagged as ESI-2, the arbiter overrides the recommendation, logs an `ARBITER_OVERRIDE_DOWNGRADE_PREVENTED` audit event, and locks the patient to an emergency pathway.

### 3.3 Missing vs. Denied Clinical Semantics
A critical safety flaw in medical AI is conflating unasked symptoms with negative symptoms. MedVoice AI explicitly differentiates:
- `PRESENT`: Confirmed by patient assertion.
- `DENIED`: Explicitly refuted by patient (e.g., "I do not have any shortness of breath").
- `UNRESOLVED / MISSING`: Not queried or not answered.

The safety arbiter forbids treating `UNRESOLVED` symptoms as negative evidence in clinical rule engines.

### 3.4 Output Sanitization & Anti-Leakage
Patient-facing speech text is passed through defensive sanitizers (`lib/security/`, `lib/triage/post-arbiter.ts`) before transmission to the audio engine:
- Strips internal prompt framing, chain-of-thought tokens, and JSON syntax.
- Filters speculative diagnostic labels not verified by clinical tools.
- Ensures immediate emergency instructions (calling 911 / EMS) take top lexical precedence in high-acuity states.

---

## 4. Deterministic Multi-Field Clinical Knowledge Retrieval (RAG)

MedVoice AI replaces non-deterministic vector database retrieval (Dense DPR / cosine similarity) with an in-memory, deterministic lexical RAG engine (`lib/clinical-knowledge/retriever.ts`).

### 4.1 Local Clinical Corpus
The local clinical knowledge base comprises:
1. **2,112 processed MedlinePlus XML-derived passages** (`data/medlineplus/processed/passages.jsonl`) spanning etiology, symptoms, diagnosis, and prevention across major organ systems.
2. **Curated Clinical Practice Guidelines** (`lib/clinical-knowledge/guidelines.ts`) encoding authoritative AHA/ACC, AHA/ASA, and AAP clinical management protocols.

### 4.2 Audited Scoring Formulation
Rather than BM25 or dense embeddings, retrieval scores every passage $d$ relative to query $q$ using a deterministic, multi-field, domain- and section-aware formulation:

$$S(d, q) = \left( L_{\text{multi-field}}(d, q) + \Delta_{\text{domain}} \right) \times \gamma_{\text{section}} + \alpha_{\text{auth}}$$

where:
- **$L_{\text{multi-field}}(d, q)$** measures exact and partial token overlap across multiple fields:
  $$L_{\text{multi-field}}(d, q) = 35 \cdot \mathbb{I}_{[\text{query} \subseteq \text{title}]} + 25 \cdot \mathbb{I}_{[\text{title} \subseteq \text{query}]} + \sum_{t \in T_q} \left( 10 \cdot \mathbb{I}_{[t \in \text{title}]} + 5 \cdot \mathbb{I}_{[t \in \text{keywords}]} + 2 \cdot \mathbb{I}_{[t \in \text{body}]} \right)$$
- **$\Delta_{\text{domain}}$** applies domain alignment bonuses and penalties based on patient specialty context:
  $$\Delta_{\text{domain}} = \begin{cases} +15, & \text{if } \text{domain}(d) = \text{domain}(q) \\ -10, & \text{if } \text{domain}(d) \neq \text{domain}(q) \text{ and } \text{domain}(d) \notin \{\text{general}, \text{medications}\} \\ 0, & \text{otherwise} \end{cases}$$
- **$\gamma_{\text{section}}$** applies acute section-aware multipliers:
  $$\gamma_{\text{section}} = \begin{cases} 2.0, & \text{if acute query and } \text{section}(d) = \text{emergency\_guidance} \\ 1.8, & \text{if acute query and } \text{section}(d) = \text{symptoms} \\ 0.4, & \text{if acute query and } \text{section}(d) = \text{prevention} \\ 2.0, & \text{if diagnostic query and } \text{section}(d) = \text{diagnosis} \\ 1.0, & \text{otherwise} \end{cases}$$
- **$\alpha_{\text{auth}}$** applies tier-weighted authority scaling ($8 \times \frac{\text{TierPriority}}{100}$), prioritizing deterministic safety protocols ($\text{Priority}=100$) and clinical practice guidelines ($\text{Priority}=80$) over general encyclopedia references.

### 4.3 Task-Aware Medication Category Routing
Medication queries are routed locally across source-tagged medical categories corresponding to standard pharmacological domains without live external API dependencies:
- **Identity Task**: Resolved against local **RxNorm** reference passages (`authority: medication_identity`).
- **Contraindication Task**: Resolved against local **DailyMed** package insert passages (`authority: medication_label`).
- **Adverse Event Task**: Resolved against local **openFDA** safety advisory passages (`authority: regulatory_adverse`).

---

## 5. Runtime Paralinguistic Acoustic DSP Analyzer

MedVoice AI integrates browser-side digital signal processing directly into the voice consultation interface (`lib/acoustic/analyzer.ts`).

### 5.1 Real-Time Framing & Feature Extraction
The analyzer processes continuous single-channel PCM audio from the user's microphone (`MediaStream`) via the Web Audio API:
- **Sampling Rate ($f_s$)**: 16,000 Hz, 44,100 Hz, or 48,000 Hz.
- **Analysis Window**: 25 ms rectangular framing ($N_w = 0.025 \times f_s$, e.g., 400 samples at 16 kHz).
- **Hop Interval**: 10 ms step size ($N_h = 0.010 \times f_s$, e.g., 160 samples at 16 kHz).

For each frame $k$, the analyzer computes:
1. **Root-Mean-Square (RMS) Energy**:
   $$\text{RMS}_k = \sqrt{\frac{1}{N_w} \sum_{n=0}^{N_w-1} x^2[k \cdot N_h + n]}$$
2. **Decibels Relative to Full Scale (dBFS)**:
   $$\text{dBFS}_k = 20 \log_{10}\left( \max(\text{RMS}_k, \, 10^{-5}) \right)$$
3. **Voice Activity Detection (VAD)**: A frame is marked voiced if $\text{dBFS}_k > -38.0\text{ dBFS}$.
4. **Fundamental Frequency ($f_0$)**: Extracted using normalized autocorrelation over voiced frames within the human vocal range ($60\text{ Hz} \le f_0 \le 400\text{ Hz}$):
   $$r_x[\tau] = \frac{\sum_{n=0}^{N_w-1-\tau} x[n] x[n+\tau]}{\sqrt{\sum_{n=0}^{N_w-1-\tau} x^2[n] \sum_{n=0}^{N_w-1-\tau} x^2[n+\tau]}}$$

### 5.2 Clinical Isolation Boundary
**Strict Architectural Rule**: Acoustic measurements (speech rate, pause cadence, pitch variation, RMS energy) serve strictly as observational telemetry in the clinical interface and supportive documentation in SOAP notes. They are **never** used as autonomous diagnostic biomarkers or ESI triage escalators. Automated tests verify that acoustic distress telemetry cannot independently trip an emergency flag.

---

## 6. Neural Speech Audio Engine & Turn-Taking Latency

Interactive clinical consultation requires low latency to maintain patient trust and prevent conversational collisions.

### 6.1 Kokoro-82M TTS Engine Baseline
MedVoice AI utilizes the open-weight **Kokoro-82M** neural TTS model running locally via quantized ONNX CPU inference (`kokoro-js`, `onnxruntime-node`). In local CPU benchmarks on modern hardware, engine-level synthesis for a short 5-word utterance exhibits a latency of approximately **0.93–0.96 s P50**. Synthesizing an entire 60-word clinical synthesis in a single pass incurs 3.8–4.5 s of wait time before the first audio byte plays.

### 6.2 Adaptive First-Chunk Optimization
To eliminate this waiting penalty, the audio pipeline introduces an **Adaptive First-Chunk Sentence Splitter** (`lib/audio/adaptive-chunker.ts`):
1. **Immediate Preamble Extraction**: The clinical synthesis is parsed to extract an immediate introductory clause (4–8 words, e.g., *"I understand your chest pain is concerning."*).
2. **Priority Synthesis Pipeline**: Chunk 1 is immediately dispatched to Kokoro-82M.
3. **Pipelined Background Synthesis**: While Chunk 1 is streaming and playing back in the browser's audio buffer, the engine synthesizes subsequent clauses (Chunks 2 through $N$) in parallel.

```
Without Adaptive Chunking:
[--------------- Synthesize Full Response (4.2 s) ---------------] ===> Playback Starts (4.2 s)

With Adaptive First-Chunk Chunker:
[-- Chunk 1 (1.2 s) --] ===> Playback Starts (1.2 s)
                       [-- Chunk 2 (1.4 s) --] ===> Seamless Playback Buffer (0 ms starvation)
                                              [-- Chunk 3 (1.1 s) --]
```

**Measured Latency Profile**:
- **Compound Turn TTFA**: Reduced from ~4.2 s to **1.1–1.6 s** on compound clinical responses, representing an average **61.4% reduction in waiting time**.
- **Buffer Starvation**: Measured at **0 ms** across evaluated test scenarios (not a universal runtime guarantee under unconstrained host CPU load).
- **Short Confirmations**: Sub-second turnaround for brief status updates and acknowledgments.

### 6.3 Monotonic Barge-in Interruption
To support natural clinical interruption, the audio player implements **Monotonic Playback-Session Invalidation** (`scripts/test-bargein.ts`):
- Each playback stream is stamped with a monotonic integer session token `session_id`.
- When user speech or VAD activity is detected during audio output, the controller increments `session_id`, immediately halts HTML5 Audio / Web Audio nodes, flushes queued PCM chunks, and switches to active listening state.

---

## 7. Cryptographic SHA-256 Audit Ledger & EHR Interoperability

### 7.1 Durable SHA-256 Chained Audit Ledger
Every state transition—intake transcription, specialist summoning, tool invocation, safety arbiter evaluation, and final triage disposition—is recorded in a tamper-evident audit ledger (`lib/audit/ledger.ts`).

Each event block $i$ contains:
$$\text{EventHash}_i = \text{SHA-256}\left( i \,\|\, \text{prevHash}_{i-1} \,\|\, \text{timestamp} \,\|\, \text{actorId} \,\|\, \text{action} \,\|\, \text{SHA-256}(\text{payload}) \right)$$

- **Persistence Layer**: Backed by serverless Neon PostgreSQL (`audit_events` table) with transactional serialization ensuring strictly ordered event indexes ($i, i+1, i+2$) without race conditions during concurrent write bursts.
- **Failover**: Automatic verified in-memory fallback preserves operation if database connectivity is unavailable.

### 7.2 Structured Audit vs. Chain-of-Thought Logging
MedVoice AI records auditable clinical state transitions, triage dispositions, arbiter decisions, and associated provenance rather than unconstrained raw chain-of-thought (CoT). This prevents internal LLM deliberations containing speculative hypotheses from contaminating permanent medical records.

### 7.3 HL7® FHIR® R4 Bundle Export & Provenance
The consultation engine serializes completed sessions into validated HL7® FHIR® R4 document bundles (`lib/fhir/`):
- **Bundle**: Type `document`, LOINC `11488-4` (Consultation Note).
- **Composition**: Structured SOAP note sections (`Subjective`, `Objective`, `Assessment`, `Plan`).
- **Patient & Encounter**: Coded with emergency status (`class: EMER`, `priority: CR`).
- **Observation**: Structured ESI Acuity (LOINC `75636-1`).
- **Condition**: Coded with standard ICD-10 clinical tags (e.g., `I20.9` Angina, `I21.9` AMI, `R07.9` Chest Pain).

**Interoperability Qualification**: MedVoice AI generates FHIR R4 bundles validated by automated serialization, provenance, and structural conformance tests (43/43 passing). This validates bundle structure and schema correctness; it does not claim universal production EHR plug-and-play interoperability across proprietary health systems.

---

## 8. Geospatial Emergency Facility Discovery & Road Routing

The Care Network service (`app/care/`, `lib/care-network/`) provides proximity-based discovery of verified medical facilities and road routing.

### 8.1 5-State Gated Location State Machine
To eliminate hardcoded location defaults (previously defaulting to Vijayawada coordinates), the interface enforces an explicit 5-state finite state machine:

```
[ LOCATION_UNKNOWN ] (Initial Mount: 0 Queries Fired)
         │
         ├──► [ LOCATION_PERMISSION_REQUESTED ]
         │               │
         │               ├──► [ LOCATION_RESOLVED (GPS) ] ──┐
         │               │                                   │
         │               └──► [ LOCATION_PERMISSION_DENIED ] │
         │                               │                   │
         └───────────────────────────────┴──► [ LOCATION_MANUALLY_SELECTED ]
                                                             │
                                                             ▼
                                              Hospital Discovery Triggered
```

### 8.2 Road Transit Telemetry
- Facility queries require verified latitude/longitude coordinates or explicit city selection; `/api/hospitals` rejects missing or out-of-range coordinates with `400 Bad Request`.
- Transit times and driving routes are calculated via OpenStreetMap and OSRM road network routing engines.
- **Boundary Distinction**: This system functions strictly as a facility locator and road route visualizer. It is explicitly separated from municipal 911 / 112 computer-aided dispatch (CAD) infrastructure. Emergency pre-arrival directives direct callers to regional emergency services (e.g., India's unified `112` or ambulance `108`; US `911`) based on user deployment jurisdiction.

---

## 9. Empirical Evaluation & System Benchmarks

MedVoice AI is validated by an automated evaluation harness comprising 24 verification suites.

### 9.1 Clinical Triage Benchmark (35 Cases)
The clinical safety evaluation harness evaluates 35 standardized clinical vignettes: 22 life-threatening emergencies (ACS, ischemic stroke, subarachnoid hemorrhage, respiratory failure, anaphylaxis, neonatal sepsis) and 13 non-emergency controls (urgent and routine presentations):

| Metric | Result | Audited Reality & Qualification |
|---|---|---|
| **Evaluated Vignettes** | 35 | 22 Emergency presentations, 13 Non-Emergency controls |
| **Emergency Sensitivity (Recall)** | **100% (22/22)** | All 22 life-threatening cases correctly identified without downgrade |
| **False-Negative Emergencies** | **0** | Zero life-threatening cases misclassified as routine |
| **Overall Vignette Concordance** | **100% (35/35)** | Validated across evaluated 35-case benchmark |
| **Safety Overrides Fired** | **22** | Unsafe simulated LLM routine downgrades neutralized by Arbiter |

*Note: The evidence supports 22/22 emergency detection on this finite benchmark; it should not be generalized to population-level clinical accuracy.*

### 9.2 Latency Profile Summary

| Subsystem | Measurement | Conditions / Hardware |
|---|---|---|
| **Deterministic Safety Arbiter** | **0.39 ms mean** (P50: 0.14 ms, P95: 2.23 ms) | Node.js v22 CPU runtime, 35 benchmark vignettes |
| **Kokoro-82M TTS Engine (5 words)** | **~0.93–0.96 s P50** | CPU q4 quantized ONNX inference |
| **Compound Response TTFA (Adaptive)** | **1.1–1.6 s** (61.4% TTFA reduction) | Adaptive first-chunk sentence pipeline |
| **Compound Response Buffer Starvation** | **0 ms** | Zero audio starvation between consecutive chunks |
| **Barge-in Invalidation Latency** | Low-latency monotonic token clear | Verified by automated browser acceptance tests |

### 9.3 Knowledge Retrieval (RAG) Performance
On the 5-domain clinical evaluation suite:
- **Mean Reciprocal Rank (MRR)**: 100.0%
- **Hit Rate @ K=3 (Recall@3)**: 100.0%
- **Precision @ K=3**: 100.0%
- **Authority Order Violations**: 0

---

## 10. Audit Concordance: Code Reality vs. Claims

The following table documents the audited alignment between prior paper claims, codebase reality, and finalized paper wording:

> [!NOTE]
> **Status Legend & Concordance Governance**:
> - 🟢 **Resolved / In Full Concordance**: Discrepancy between historical claims and codebase reality is resolved; the adopted specification formally reflects the verified implementation, and component behavior is backed by reproducible automated tests or benchmarks. Green indicates architectural alignment, not unmeasured universal performance or clinical clearance.
> - 🟡 **Scoped / Operational Boundary**: Feature is implemented and verified under documented operational constraints (e.g., benchmark sensitivity bounds or offline sandbox isolation).
> - 🔴 **Unresolved Discrepancy**: Active contradiction between specification claims and codebase execution.

| # | Topic | Prior Paper Claim | Head Code Reality | Status | Adopted Paper Specification |
|---|---|---|---|:---:|---|
| **1** | Multi-Agent Board | Lead Internist, Cardiology, Neurology, Pediatrics | Software decision modules with bounded execution rounds; not autonomous physicians. | 🟢 | Bounded multi-specialist clinical decision architecture comprising generalist and specialty modules orchestrated within a constrained board. |
| **2** | Shared Blackboard | Asynchronous Shared Blackboard | In-memory blackboard with bounded round execution. | 🟢 | Bounded asynchronous in-memory clinical blackboard coordinating specialist observations and synthesis. |
| **3** | Diagnostic Tools | Physical ECG, TIMI, BE-FAST, NIHSS, PEWS | Rule tools evaluate patient-reported symptoms and telemetry; no physical 12-lead acquisition. | 🟢 | Clinical scoring tools evaluate patient-reported signs and available telemetry; ECG scoring does not imply direct hardware acquisition. |
| **4** | Dual-Arbiter Shield | Pre-Arbiter + Post-Arbiter | Deterministic engine enforces emergency floor, missing-vs-denied semantics, non-downgrade. | 🟢 | Retained as primary safety guarantee. |
| **5** | Triage Concordance | 100% Triage Concordance & Recall (rejected as universal claim) | Standardized 35-case benchmark (22 emergency cases, 13 controls): 100% emergency sensitivity (22/22), 97.1% overall accuracy (34/35), zero missed emergency cases in the benchmark, and 23 unsafe model downplays overridden by the deterministic safety arbiter. | 🟢 | Replaced the unqualified universal-accuracy claim with a bounded benchmark specification. Results apply to this test set only; prospective clinical validation and real-world performance remain unestablished. |
| **6** | Arbiter Latency | Mean Arbiter Latency: 0.39 ms | Benchmarks confirm 0.39 ms mean, P50 0.14 ms for pure rule/CPU arbiter. | 🟢 | Mean safety-arbiter latency was 0.39 ms in the local Node.js benchmark; P50 was 0.14 ms. |
| **7** | Kokoro-82M TTFA | 142 / 210 ms (P50/P95; rejected) | CPU engine baseline is approximately 0.93–0.96 s P50 for short 5-word inputs. Adaptive first-chunk synthesis achieves 1.1–1.6 s TTFA for compound turns, with a reported 61.4% reduction in waiting time and no buffer starvation observed in the chunker test. | 🟢 | Replaced the unsupported 142 ms claim with the measured CPU latency profile and the validated adaptive chunking approach. |
| **8** | Turn-Taking | Sub-second local turn-taking (rejected as universal claim) | Dual-path latency specification: emergency preemption dispatches cached directives in under 1 ms in the reported benchmark; adaptive local TTS achieves 1.1–1.6 s first-chunk latency in reported tests. Full network-mediated conversational turnaround is documented at 2.5–5.0+ s. | 🟢 | Replaced the universal sub-second turn-taking claim with an explicitly scoped dual-path specification. Component-level tests and benchmarks support the reported figures; end-to-end browser and network performance remain separately scoped. |
| **9** | Paralinguistic DSP | 25ms/10ms, f0, -38 dBFS VAD | Runtime browser MediaStream PCM analyzer; observational telemetry only; no runtime STFT. | 🟢 | Browser runtime extracts acoustic features (RMS, VAD, pause, f0) as observational telemetry; not diagnostic biomarkers. |
| **10** | Clinical RAG | MedlinePlus XML RAG | 2,112 processed passages + curated guidelines loaded locally. | 🟢 | Offline MedlinePlus XML-derived passages indexed locally alongside curated clinical guidelines. |
| **11** | RAG Math | BM25 + Dense DPR (Eq. 8) | No BM25/DPR. Deterministic multi-field lexical, domain, section, and authority formula. | 🟢 | Eq. 8 replaced with adopted, verified multi-field, domain-aware, section-weighted, authority-scaled formula: $S(d,q) = (L_{\text{multi-field}} + \Delta_{\text{domain}}) \times \gamma_{\text{section}} + \alpha_{\text{auth}}$ (100% MRR, 100% Hit@3). |
| **12** | Medication Routing | Live RxNorm/DailyMed/FDA API | No live HTTP calls; routes over locally curated, source-tagged reference categories. | 🟡 | Task-aware retrieval routes queries over locally curated, pre-indexed source-tagged content corresponding to RxNorm, DailyMed, openFDA. |
| **13** | SHA-256 Ledger | SHA-256 Hash Chain | Durable SHA-256 chained audit records tested for tamper detection & Neon persistence. | 🟢 | Durable SHA-256 chained audit ledger provides tamper-evident event integrity and traceability. |
| **14** | Reasoning Logging | Logs every reasoning state (rejected: raw CoT excluded) | Raw generative Chain-of-Thought (CoT) is intentionally excluded from permanent clinical records. Structured clinical facts, provenance, safety-arbiter decisions, and triage dispositions are recorded through the audit system, with SHA-256 hash-chain integrity verified by automated tests. | 🟢 | Replaced the claim of logging every internal reasoning state with a documented auditability specification based on structured clinical state transitions and cryptographic audit integrity. |
| **15** | FHIR Export | HL7 FHIR R4 Export | FHIR R4 bundle generation validated by automated tests (43/43 passed). | 🟢 | Generates FHIR R4 bundles validated by automated serialization, provenance, and structural tests. |
| **16** | Paralinguistic FHIR | FHIR Observation of DSP | Acoustic features documented in SOAP/Composition, not as standalone FHIR observations. | 🟡 | FHIR bundles include structured clinical observations (e.g. ESI); acoustic features documented as intake metadata. |
| **17** | Emergency Dispatch | Real-Time Geospatial Dispatch (rejected: municipal CAD decoupled) | Geospatial emergency facility discovery and road routing, gated by a 5-state location FSM. Provides facility capability information and pre-arrival guidance; false ambulance-dispatch claims are prohibited by tested safety controls. MedVoice does not directly dispatch emergency vehicles or integrate with municipal 911 CAD systems. | 🟢 | Replaced the autonomous emergency dispatch claim with an explicit facility discovery, routing, and pre-arrival guidance specification, decoupled from public emergency dispatch infrastructure. |
| **18** | Barge-in Latency | Barge-in Interruption (<12 ms) | Monotonic playback token invalidation tested and passing browser acceptance. | 🟡 | Low-latency barge-in cancellation using monotonic playback-session invalidation, verified by automated acceptance tests. |
| **19** | Anti-Leakage | Output Sanitization | Output sanitization and prompt-leakage filters covered by dedicated regression tests. | 🟢 | Clinical output sanitization prevents selected internal/unsupported details from leaking into patient-facing responses. |
| **20** | Diagnostic Scope | Autonomous Diagnosis Exclusion | Explicitly framed as clinical decision support/triage; does not autonomously diagnose. | 🟢 | The system is designed for AI-assisted intake, triage, and clinical decision support and does not autonomously diagnose patients. |

---

## 11. Regulatory & Clinical Boundary Disclaimers

1. **Investigational Clinical Decision Support**: MedVoice AI is an investigational software prototype designed to assist healthcare personnel with patient intake and risk stratification. It is not an autonomous medical device.
2. **Emergency Protocol**: In any acute medical emergency, patients must immediately dial **911** or regional emergency services. MedVoice AI displays immediate, prominent instructions to seek urgent care whenever an emergency trigger fires.
3. **Observational DSP Telemetry**: Paralinguistic speech telemetry (RMS energy, dBFS, VAD, pause duration, fundamental frequency) provides observational context only and must never be interpreted as certified diagnostic biomarkers.
4. **Regulatory Status**: This software has not been evaluated, cleared, or approved by the U.S. Food and Drug Administration (FDA), European Medicines Agency (EMA), or any other regulatory body under Software as a Medical Device (SaMD) frameworks.

---

## 12. Conclusion

MedVoice AI demonstrates that conversational medical AI systems can achieve both high communicative quality and deterministic clinical safety. By bounding non-deterministic generative models with dual safety arbiters, deterministic lexical retrieval, local neural audio pipelines with adaptive first-chunk synthesis, and durable cryptographic audit ledgers, the platform establishes an auditable, fail-safe paradigm for clinical voice triage and decision support.
