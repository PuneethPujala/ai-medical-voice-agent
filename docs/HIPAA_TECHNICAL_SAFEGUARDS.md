# MedVoice — HIPAA-Aligned Technical Safeguards (45 CFR § 164.312)

> **Document Status**: Authoritative Architecture Specification  
> **Target Scope**: Application-Layer Technical Security & Privacy Controls  
> **System Classification**: AI-assisted clinical voice intake, triage, documentation, and emergency-routing system (Research & Pilot Prototype)

---

## 1. Executive Summary & Compliance Posture

MedVoice handles electronic Protected Health Information (ePHI) during patient voice intake, multi-specialty clinical reasoning, deterministic ESI-style triage, SOAP documentation, and HL7 FHIR R4 document bundle generation.

### Grounded Compliance Stance

> **Important**: MedVoice does **NOT** claim full organizational "HIPAA Compliance" or formal third-party certification.  
> The Health Insurance Portability and Accountability Act (HIPAA) Security Rule (45 CFR Part 160 and Part 164, Subparts A and C) mandates a comprehensive triad of **Administrative**, **Physical**, and **Technical** safeguards, alongside Business Associate Agreements (BAAs), institutional workforce training, and enterprise risk management protocols.

Software architecture alone can only satisfy **Technical Safeguards (45 CFR § 164.312)**. MedVoice has engineered and verified strict, application-layer technical controls aligned directly with these federal standards, while maintaining full honesty regarding out-of-scope administrative and physical prerequisites.

---

## 2. Technical Safeguards Implementation Matrix (45 CFR § 164.312)

| HIPAA Regulation | Required / Addressable | MedVoice Technical Implementation | Verification Mechanism | Status |
| :--- | :---: | :--- | :--- | :---: |
| **§ 164.312(a)(1) Access Control** | **Required** | Root Edge Gateway (`proxy.ts`) + strict RBAC (`patient` vs `admin`). IDOR ownership controls ensure patients can only access their own records. | Automated test suite (`cors-rbac-audit.test.ts`), Edge Proxy | 🟢 Implemented |
| **§ 164.312(a)(2)(i) Unique User ID** | **Required** | Clerk server-side authentication assigns immutable, unique user IDs (`userId`). Client headers cannot elevate privileges. | Anti-spoofing tests in `cors-rbac-audit.test.ts` | 🟢 Implemented |
| **§ 164.312(a)(2)(ii) Emergency Access** | **Required** | Algorithmic ESI v4 safety arbiter executes deterministically without authentication delay to preserve patient safety. | Deterministic arbiter tests | 🟢 Implemented |
| **§ 164.312(a)(2)(iii) Automatic Logoff** | Addressable | Client session tokens expire via Clerk auth policies; local voice intake re-arms only during active consultation turns. | Session management | 🟢 Implemented |
| **§ 164.312(b) Audit Controls** | **Required** | SHA-256 hash-chained immutable audit ledger backed by PostgreSQL persistence with correlation IDs (`x-request-id`). | Hash chain verification (`verifyAuditChain`) & tamper detection | 🟢 Implemented |
| **§ 164.312(c)(1) Integrity Controls** | **Required** | Cryptographic payload hashing (`eventHash`), Zod validation, and deterministic HL7 FHIR R4 structural validator (`validateFhirR4Bundle`). | `tests/fhir-eval/fhir.test.ts` & mutation tests | 🟢 Implemented |
| **§ 164.312(c)(2) Data De-Identification** | Addressable | Zero-Trust PHI Scrubber (`PhiScrubber`) redacts PII/PHI (phones, emails, IDs, names) into an ephemeral vault before cloud LLM dispatch. | Unit tests & `x-phi-redactions` response telemetry | 🟢 Implemented |
| **§ 164.312(d) Authentication** | **Required** | Authoritative Clerk server-side session token verification via Edge Gateway. Rejects client-supplied `x-mock-role` in production. | Server-side `authorizeRequest()` & `proxy.ts` | 🟢 Implemented |
| **§ 164.312(e)(1) Transmission Security** | **Required** | HTTPS deployment, HSTS preload (`max-age=63072000`), secure CORS origin restriction, `no-store` cache controls on all `/api/*` endpoints. | Next.js Edge Proxy headers & tests | 🟢 Implemented |

---

## 3. Detailed Technical Safeguards Architecture

### A. Root Security Gateway & Access Control (45 CFR § 164.312(a)(1))

1. **Edge-Level Security Gateway (`proxy.ts`)**:
   * Evaluates incoming requests at the Next.js runtime edge before any backend route executes.
   * Gates `/admin/*`, `/api/admin/*`, and `/api/audit/*` behind strict Clerk `admin` role assertions.
   * Mandates valid session authentication for protected PHI endpoints (`/api/patient/*`, `/api/consultations/*`, `/api/triage/*`, `/api/voice/*`).
   * Injects an immutable correlation ID (`x-request-id`) into both request and response headers for complete end-to-end audit traceability.
2. **Role-Based Access Control (RBAC)**:
   * **`patient`**: Authorized exclusively for `consultations:create`, `consultations:read` (own records only), `emergency:dispatch`, and `health:export` (own records only).
   * **`admin`**: Authorized exclusively for `analytics:read`, `system:read`, `audit:read`, and `audit:verify`. Admins do *not* participate in clinical intake.
   * **Internal AI Clinicians (Dr. Sarah Chen, Dr. Marcus Vance, etc.)**: Modeled as system reasoning modules and internal persona profiles—**never** as human user accounts with login privileges.
3. **Insecure Direct Object Reference (IDOR) Defense & Fail-Closed Persistence**:
   * Endpoint `GET /api/consultations/[id]` and `GET /api/consultations/[id]/fhir` inspect the authenticated `userId`.
   * If a patient attempts to access another user's clinical consultation or FHIR record, the request is immediately rejected with `403 Forbidden`, and an `ACCESS_DENIED` event is written into the durable audit ledger.
   * In-memory profile storage (`profile-store.ts`) has been decommissioned. In production, database failures throw `PatientProfileDatabaseError` and return sanitized HTTP 503 errors rather than silently leaking or persisting mock health data in memory.

### B. Audit Controls & Non-Repudiation (45 CFR § 164.312(b))

1. **Cryptographic SHA-256 Hash Chaining**:
   Every clinical transaction is sealed into an append-only block:
   $$\text{eventHash} = \text{SHA-256}(\text{index} \parallel \text{id} \parallel \text{timestamp} \parallel \text{actorId} \parallel \text{action} \parallel \text{resourceType} \parallel \text{resourceId} \parallel \text{status} \parallel \text{previousHash} \parallel \text{sortedMetadata})$$
2. **Durable Persistence**:
   Backed by PostgreSQL (`audit_events` table). Any out-of-order insertion, payload tampering, or sequence truncation is caught by `verifyAuditChain()`.
3. **Data Minimization in Audit Logs**:
   Audit metadata records operational identifiers (`consultationId`, `esiLevel`, `action`, `requestId`) rather than raw conversational transcripts, adhering to the HIPAA Minimum Necessary rule.

### C. Zero-Trust PHI De-Identification & Ephemeral Audio Lifecycle

1. **In-Flight PHI De-Identification (`lib/security/phi-scrubber.ts`)**:
   * Prior to dispatching conversational turns to cloud LLMs (Groq, NVIDIA NIM) or writing debug logs, incoming transcripts pass through `PhiScrubber.scrub()`.
   * Evaluates deterministic regular expressions for Email addresses, Phone numbers, Government IDs, Dates, and Patient entity names, replacing them with keyed tokens (`[REDACTED_EMAIL_1]`, etc.).
   * Stores original values in an ephemeral in-memory vault tied strictly to the request lifecycle.
   * Sanitized model outputs are safely rehydrated on the client UI boundary via `PhiScrubber.rehydrate()`, ensuring zero raw PII/PHI reaches external inference providers.
2. **Local Audio Ingestion**:
   * Patient speech is captured via browser `MediaRecorder` and streamed in-memory to `/api/voice/stt`.
   * Next.js bridges the audio buffer directly to the local Whisper neural speech recognition container over localhost.
3. **Guaranteed Ephemeral Scrub**:
   * In `backend/services/audio_service.py`, temporary audio files used during acoustic feature extraction are unlinked immediately inside a guaranteed `finally: os.remove()` block.
4. **Zero Audio Persistence**:
   * Raw audio recordings are **never stored** in the database, file system, or external object storage.

### D. Interoperability & Clinical Data Integrity (45 CFR § 164.312(c)(1))

1. **Deterministic HL7 FHIR R4 Bundle Validation (`lib/fhir/bundle.ts`)**:
   * All exported consultation documents pass through `validateFhirR4Bundle` before leaving the server.
   * Enforces structural cardinality (root `Bundle`, mandatory `Patient` and `Composition` entries), URI format compliance (`urn:uuid:` or `http(s):`), and recognized clinical terminology system URIs (SNOMED-CT, LOINC, ICD-10-CM).
   * Malformed bundles are intercepted and return standard FHIR `OperationOutcome` error diagnostics.
2. **Hybrid Clinical Knowledge RAG**:
   * Ingests medical guidelines into PostgreSQL (`clinical_knowledge_passages` table) with hybrid lexical + cosine vector search (`retrieveFromDatabase`), backed by a zero-config local index reader for offline validation.

### E. Transmission Security & Defense-in-Depth (45 CFR § 164.312(e)(1))

1. **HTTP Strict Transport Security (HSTS)**:
   * Configured in `next.config.ts` with `max-age=63072000; includeSubDomains; preload`.
2. **No-Cache Directives on Clinical Endpoints**:
   * Edge Middleware and API routes apply `Cache-Control: no-store, no-cache, must-revalidate, private` and `Pragma: no-cache` to ensure intermediary proxies, CDNs, and browser caches never persist sensitive clinical responses.
3. **Framing & Content Protection**:
   * `X-Frame-Options: DENY` (anti-clickjacking).
   * `X-Content-Type-Options: nosniff` (anti-MIME-confusion).
   * `Referrer-Policy: strict-origin-when-cross-origin`.
   * `Permissions-Policy: camera=(), microphone=(self), geolocation=(self)`.

---

## 4. Boundaries: What Is NOT Claimed

To preserve technical integrity during clinical, academic, and enterprise evaluation:

| Dimension | Compliance Reality | MedVoice Implementation Boundary |
| :--- | :--- | :--- |
| **Formal HIPAA Certification** | Requires an accredited institutional compliance audit. | **NOT claimed.** Prototype is a research and clinical engineering demonstration. |
| **Business Associate Agreements (BAAs)** | Legal contracts between healthcare covered entities and third-party cloud vendors (e.g. Clerk, Neon, Vercel). | **NOT executed.** Demonstration environment operates under developer sandbox terms. |
| **Physical Safeguards (45 CFR § 164.310)** | Data center access badges, camera monitoring, workstation security, device media destruction. | **Infrastructure-dependent.** Managed by cloud hosting providers (e.g., AWS/Neon), not the application codebase. |
| **Administrative Safeguards (45 CFR § 164.308)** | Formal security officer designation, workforce sanction policies, disaster recovery plans, employee training. | **Organizational responsibility.** Lies outside the scope of a software application. |

---

## 5. Reviewer FAQ & Defense Script

**Question: "Is MedVoice HIPAA compliant?"**

> **Defensible Response**:  
> *"No formal HIPAA certification is claimed. MedVoice is a clinical engineering prototype. We have implemented several key HIPAA-aligned technical safeguards under 45 CFR § 164.312, including role-based access control, cryptographic SHA-256 audit chaining, patient-owned IDOR boundaries, zero-trust PHI de-identification before third-party LLMs, deterministic HL7 FHIR R4 validation, ephemeral audio handling with zero persistent voice storage, and strict transport security. Full organizational HIPAA compliance requires administrative policies, physical facility controls, and Business Associate Agreements that are outside the scope of this application."*
