# MedVoice — Release Manifest & Pilot Readiness Sign-Off Framework

> **Document Status**: Authoritative Engineering Release Manifest & Governance Gate Review  
> **Release Target**: Controlled Clinical Pilot Candidate (`v0.1.0-pilot-candidate`)  
> **Repository**: `https://github.com/PuneethPujala/ai-medical-voice-agent` (`main` branch)  
> **Classification**: Investigational Clinical Decision-Support & Ambient Voice Documentation System  

---

## 1. Executive Summary & Purpose

This document serves as the authoritative release manifest and formal readiness sign-off record for MedVoice. It consolidates all verifiable engineering, cryptographic, database, and safety evidence gathered across the platform, establishes strict release governance gates (Gate A, Gate B, and Gate C), and outlines concrete deployment boundaries.

MedVoice is designed to perform low-latency clinical voice intake, deterministic Emergency Severity Index (ESI v4) safety arbitration, multi-persona medical dialogue, FHIR R4 clinical documentation, and hospital emergency pre-arrival dispatch. 

> [!IMPORTANT]
> **Investigational Status Notice**: MedVoice is an investigational clinical decision-support and ambient documentation system. In any prospective deployment or pilot study, MedVoice must operate under continuous attending clinician oversight. It does not replace independent clinical judgment or certified medical devices.

---

## 2. Release Manifest & Codebase State

| Parameter | Authoritative Value / Manifest State | Verification Method |
| :--- | :--- | :--- |
| **Release Candidate Tag** | `v0.1.0-pilot-candidate` | Git Release Tag / Branch manifest |
| **Branch Lineage** | `main` (fully consolidated; all prior redesign branches integrated) | `git branch --contains` |
| **Public Landing Page** | **LOCKED & FROZEN** (Responsive 375px–1440px, 0px overflow, 0 console errors) | Headless Chrome CDP cross-viewport visual audit |
| **Protected Product Routes** | `/consult`, `/care`, `/profile`, `/history` (Preserved intact; protected by Clerk Auth & RBAC) | Route integrity & integration verification |
| **Primary Datastore** | Neon Serverless PostgreSQL (`@neondatabase/serverless` + `drizzle-orm`) | Live connection pool & schema constraint tests |
| **Speech & Audio Pipeline**| Kokoro ONNX Neural TTS (Client/Server) + Dual ASR (Direct Whisper / AssemblyAI) | Audio DSP & paralinguistic benchmark suites |

---

## 3. Deterministic Verification Evidence Matrix

The MedVoice verification architecture enforces automated, reproducible evidence across both isolated offline deterministic test execution and live database environments.

### 3.1. Canonical Test Battery Execution Summary

The platform defines 62 canonical test suites in `scripts/run-test-battery.ts`:

```
================================================================================
                    CANONICAL TEST BATTERY RUNTIME RESULTS                      
================================================================================
1. Offline Deterministic Mode (`npm run test:battery`):
   - Total Registered Suites:     62
   - Fully Executed & Passed:     60
   - Cleanly Skipped DB Suites:   2 (test:atomic-concurrency, test:durable-audit)
   - Failed Suites:               0
   - Exit Status:                 Code 0 (Clean Pass)
   - Isolation Guarantee:         Zero network or live DB calls; isolated deterministic environment

2. Live Database Mode (`npm run test:battery -- --with-db`):
   - Target Guard:                Enforced by `lib/security/test-db-guard.ts`
   - Safety Invariant:            Strictly rejects primary shared database ('Ai-Medical-Voice-Agent')
                                  to prevent permanent accumulation of test audit events.
   - Execution Requirement:       Requires dedicated isolated test branch (`TEST_DATABASE_URL`).
================================================================================
```

### 3.2. Specialized Security & Concurrency Verification Suites

| Verification Target | Command | Test Invariants & Behaviors Verified | Status |
| :--- | :--- | :--- | :---: |
| **Audit Checkpoint Adversarial** | `npm run test:audit-checkpoint` | 10/10 adversarial tests passing: Detects payload corruption, detects middle-event deletion, detects tail truncation, and **exposes full downstream recalculation rewrites** via signed external checkpoints (`REWRITTEN_LEDGER_DETECTED`). Rejects replay attacks and forged HMAC signatures. | 🟢 PASS |
| **Production Auth & Cross-Tenant RBAC** | `npm run test:production-auth` | 15/15 tests passing: All protected routes enforce 401 when unauthenticated in production; forged `x-mock-role: admin` headers are strictly rejected; cross-tenant reads, writes (`PATCH`), profile updates (`PUT`), and deletion attempts return 403/404 with zero data leakage and verified datastore state immutability. | 🟢 PASS |
| **Turn Idempotency Defense** | `npm run test:turn-idempotency` | 16/16 tests passing: Single-flight turn locking, rapid double-submission deduplication, atomic CAS turn fencing, and duplicate audio chunk rejection. | 🟢 PASS |
| **102-Case Adversarial Red-Flags** | `npm run test:adversarial-red-flags` | 102/102 clinical red flag cases passing: 100% recall on emergent presentations (ACS, acute stroke, respiratory distress, anaphylaxis, severe sepsis) within the automated regression set. | 🟢 PASS |
| **Acoustic Paralinguistic DSP** | `npm run test:acoustic-e2e` | End-to-end DSP analysis verifying SNR, zero-crossing rate, pitch perturbation (jitter), amplitude perturbation (shimmer), and LOINC-coded FHIR Observation mapping. | 🟢 PASS |
| **Database Target Safety Guard** | `npm run test:db` | Aborts execution when configured against primary shared database; enforces `TEST_DATABASE_URL` isolation to protect the authoritative audit ledger. | 🟢 PASS |

---

## 4. Three-Gate Release Governance Framework

To transition MedVoice from experimental code to controlled clinical pilot deployment, three sequential governance gates are established:

```mermaid
flowchart LR
    A["Gate A: Technical & Security (Provisional)"] --> B["Gate B: Clinical & Safety (In Progress)"]
    B --> C["Gate C: Pilot Authorization (Pending)"]
    C --> D["Monitored Clinical Pilot"]
```

### Gate A: Technical, Architectural & Security Verification
*Scope: Automated software guarantees, security controls, cryptographic integrity, and database consistency.*

- [x] **A1. Canonical Test Battery Coverage**: 62 registered suites execute deterministically; 60 offline suites pass cleanly with 0 failures, and 2 database suites are cleanly decoupled.
- [x] **A2. Multi-Tenant IDOR Protection**: Server-side session verification enforces strict tenant boundaries across read (`GET`, `GET /fhir`), mutation (`PATCH`, `PUT`), and deletion (`DELETE`) routes. State immutability verified under adversarial attempts.
- [x] **A3. Cryptographic Tamper-Detection Logic**: SHA-256 hash-chained audit ledger verified. Full recalculation rewrites and truncations detected via HMAC-signed checkpoint verification logic.
- [x] **A4. Zero-Trust Header Sanitization**: In `NODE_ENV === "production"`, test harness role headers (`x-mock-role`) and synthetic demo bypasses are completely discarded.
- [x] **A5. Fail-Closed Error Handling**: Database disconnects return sanitized HTTP 503 Service Unavailable without exposing internal server paths or falling back to unauthenticated mock data.
- [x] **A6. Responsive UI Stability**: Landing page is frozen; zero console errors, zero layout shifts, full keyboard navigation and reduced-motion compliance.
- [ ] **A7. Isolated Test Database Deployment**: Integration tests are protected by safety guards, but a permanent, dedicated CI/CD test branch (`TEST_DATABASE_URL`) must be formally provisioned so that live database suites can run continuously without touching the primary ledger.
- [ ] **A8. External Checkpoint Store Adapter**: Checkpoint verification logic is complete and tested, but relies on an in-memory test store (`InMemoryCheckpointStore`). An independent cloud storage adapter (e.g. AWS S3 Object Lock in Compliance Mode) and KMS key management must be deployed.
- [ ] **A9. Distributed Rate Limiting**: The current sliding-window rate limiter is process-local (`Map<string, WindowBucket>`). Multi-node or serverless scaling requires a distributed store (e.g. Upstash Redis).
- [ ] **A10. Disaster Recovery & PITR Drills**: While cold-boot cache hydration from PostgreSQL is verified, formal database snapshot, backup verification, and Point-in-Time Recovery (PITR) procedures must be tested.

> **Gate A Status: 🟡 PROVISIONAL / IN PROGRESS (Core security & authorization logic verified; isolated test database, external checkpoint storage, and distributed rate limiting pending)**

---

### Gate B: Clinical Validation & Human Factors Safeguards
*Scope: Medical accuracy, triage arbiter determinism, speech prosody safety, and clinician workflow integration.*

- [x] **B1. Deterministic ESI Urgency Arbiter**: Emergency clinical presentations (chest pain with radiation, acute neurological deficits, respiratory compromise) strictly bypass LLM reasoning and immediately trigger Emergency Department routing.
- [x] **B2. Symptom Negation Integrity**: Clinical arbiter correctly distinguishes positive findings from negated findings (e.g. "no chest pain" vs "chest pain").
- [x] **B3. Clinician Persona Invariants**: Persona voices, clinical specialties, and prosody parameters remain immutable and server-authoritative; client overrides are rejected.
- [x] **B4. Attributed Clinical Provenance**: All generated SOAP notes and FHIR R4 diagnostic resources are bound to specific timestamped dialogue turns with verifiable transcript attribution.
- [ ] **B5. Prospective Clinical Cohort Review**: Formal sign-off on 50 prospective clinical test encounters by the Chief Medical Officer / Lead Supervising Physician prior to live patient interaction. *(Note: This review is a defined evaluation milestone, not real-world sensitivity proof).*
- [ ] **B6. Human Factors Usability Trial**: Verification that triage recommendations and emergency warnings are perceived unambiguously by non-technical patients under acute distress.

> **Gate B Status: 🟡 IN PROGRESS (Algorithmic safety verified in automated regression; prospective clinical cohort review and human factors trials required prior to patient contact)**

---

### Gate C: Operational, Institutional & Legal Governance
*Scope: Regulatory, institutional review board (IRB), data privacy, and legal frameworks.*

- [ ] **C1. Business Associate Agreement (BAA)**: Active BAAs executed with all cloud infrastructure providers (Neon, Clerk, Vercel, AssemblyAI).
- [ ] **C2. Institutional Review Board (IRB) / Ethics Protocol**: Controlled pilot protocol approved by the partner hospital's institutional ethics committee.
- [ ] **C3. Attending Physician Supervision Agreement**: Operating protocol ensuring 100% of generated consultation summaries and triage suggestions are reviewed and countersigned by a licensed attending physician.
- [ ] **C4. Data Protection & DPDP Compliance**: Patient consent capture and DPDP soft-deletion / data portability workflows formally documented.
- [ ] **C5. Clinical Escalation & 911 Dispatch Interconnect**: Emergency telemetry transmission verified with the receiving facility's dispatch coordinator.

> **Gate C Status: ⚪ PENDING INSTITUTIONAL PARTNERSHIP (Prerequisite for live hospital deployment)**

---

## 5. Known Operational Boundaries & Engineering Hardening Roadmap

To maintain transparency with technical auditors and clinical partners, the following operational boundaries and their planned hardening paths are documented:

| Subsystem | Current State | Planned Production Hardening |
| :--- | :--- | :--- |
| **Database Test Isolation** | Protected by `lib/security/test-db-guard.ts` which rejects the primary database. | Provision dedicated Neon ephemeral database branch per CI run. |
| **Rate Limiting** | In-memory token bucket sliding window (`lib/security/rate-limiter.ts`). Effective for single-instance or sticky deployments. | Multi-node deployment requires Redis/Upstash distributed sliding window rate limiting. |
| **Audit Checkpoint Anchoring** | Algorithmic HMAC-SHA256 checkpoint verifier with monotonic index validation (`lib/audit/checkpoint.ts`) tested against `InMemoryCheckpointStore`. | Deploy S3 Object Lock adapter with separate IAM credentials and AWS KMS key protection. |
| **Audio DSP Processing** | Dual-tier architecture: In-browser Web Audio Worklet for real-time SNR/ZCR feature extraction; Node.js server fallback for batch analysis. | Complete server-side C++/WASM DSP pipeline for low-end mobile devices unable to execute real-time Web Audio Worklets. |
| **Cloud ASR Dependency** | Dual-fallback pipeline: Direct AssemblyAI streaming WebSocket with automatic fallback to local Whisper/STT HTTP handler. | On-premises Whisper TensorRT-LLM container for zero-outbound-network air-gapped hospital deployments. |

---

## 6. Release Sign-Off Matrix

```
================================================================================
                    MEDVOICE PILOT READINESS SIGN-OFF                           
================================================================================
Engineering & Architecture Lead:   PROVISIONAL  [Core Logic Verified; Test DB & Checkpoint Store Pending]
Security & Infrastructure Lead:     PROVISIONAL  [RBAC & Guards Verified; Distributed Limits Pending]
Lead Clinical Arbiter Reviewer:     IN PROGRESS  [Algorithm Verified; Awaiting Prospective Cohort]
Institutional Review Board (IRB):   PENDING      [Gate C Scheduled with Partner Health]
================================================================================
```
