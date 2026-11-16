# MedVoice AI: Academic Research Paper & Technical Specification

The complete, publication-grade academic research paper and technical architecture specification is available at:

👉 [docs/PAPER.md](docs/PAPER.md)

### Overview of Paper Sections:
- **Abstract & System Overview**
- **1. Introduction & Clinical Motivation**
- **2. Bounded Multi-Specialist Decision Architecture**
  - Specialist Reasoning Modules (Internal Med, Cardio, Neuro, Peds)
  - Asynchronous In-Memory Clinical Blackboard
  - Diagnostic Scoring Tools & Telemetry (No Direct ECG Hardware Acquisition)
- **3. Deterministic Dual-Arbiter Safety Shield**
  - Pre-Arbiter Emergency Floor & Post-Arbiter Non-Downgrade Invariant
  - Missing vs. Denied Clinical Semantics
  - Output Sanitization & Prompt-Leakage Defense
- **4. Deterministic Multi-Field Clinical Knowledge Retrieval (RAG)**
  - Local MedlinePlus (2,112 passages) & Curated Practice Guidelines
  - Audited Deterministic Equation replacing BM25/DPR: $S(d, q) = (L_{\text{multi-field}}(d, q) + \Delta_{\text{domain}}) \times \gamma_{\text{section}} + \alpha_{\text{auth}}$
  - Task-Aware Medication Category Routing (RxNorm, DailyMed, openFDA)
- **5. Runtime Paralinguistic Acoustic DSP Analyzer**
  - 25ms/10ms Framing, RMS dBFS, -38 dBFS VAD, $f_0$ Autocorrelation
  - Strict Clinical Isolation as Observational Telemetry
- **6. Neural Speech Audio Engine & Turn-Taking Latency**
  - Kokoro-82M q4 CPU Latency Baseline (0.93–0.96s P50)
  - Adaptive First-Chunk TTFA Reduction (61.4% drop to 1.1–1.6s) with 0ms starvation
  - Monotonic Barge-In Interruption Session Invalidation
- **7. Cryptographic SHA-256 Audit Ledger & EHR Interoperability**
  - Durable PostgreSQL (Neon) Hash Chain Persistence & Race-Free Serialization
  - Structured Clinical State Logging vs Unrestricted CoT
  - HL7 FHIR R4 Bundle Document Serializer & Provenance (43/43 tests)
- **8. Geospatial Emergency Facility Discovery & Road Routing**
  - 5-State Explicit Location FSM & Gated Queries
  - Decoupled from municipal 911 dispatch
- **9. Empirical Evaluation & System Benchmarks**
  - 35-Case Clinical Benchmark (22 Emergency / 13 Control): 100% Sensitivity (22/22)
  - Mean Arbiter Latency: 0.39ms (P50: 0.14ms)
  - RAG Benchmark: 100% MRR, 100% Recall@3
  - 9.4 Expanded Pilot Cohort Safety & Semantic Calibration ($N=50$, $t=4.084$, $p < 0.001$)
  - 9.5 End-to-End Voice Pipeline Latency Waterfall (~1.15s TTFT)
  - 9.6 Deterministic Arbiter Adversarial & Colloquial Robustness ($N=345$, 125 Cataloged Failures)
- **10. Threats to Validity & Limitations**
- **11. Audit Concordance: Code Reality vs. Claims (All 20 Audited Criteria)**
- **12. Regulatory & Clinical Boundary Disclaimers (Non-Autonomous Diagnosis)**
- **13. Conclusion**

