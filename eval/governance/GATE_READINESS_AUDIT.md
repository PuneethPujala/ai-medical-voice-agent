# MedVoice Study 3: Gate Readiness Audit & Acceleration Plan
**Status:** ACTIVE ACCELERATION SPRINT  
**Date:** November 13, 2026  
**Governing Methodology:** Protocol v2.3.16 / Specification v3.3.21 (FROZEN)  
**Scope:** Decoupled parallel preparation of Gates 1, 2, 3, and 4 without unauthorized scenario generation or live evaluation.

---

## 1. Executive Summary: Transition to Execution-Readiness

With the technical R reproducibility milestone formally **CLOSED & VERIFIED** under pinned packages (`lme4 1.1-35.5`, `ordinal 2023.12-4`, `Matrix 1.7-6`), the project transitions from statistical specification verification to **execution-readiness mode**.

### Core Invariants Maintained During Acceleration
1. **Methodology Freeze Invariant:** Methodology v3.3.21 remains strictly frozen. No statistical adjustments or version churn.
2. **Gate 1 Protection:** Zero production clinical scenarios ($N=200$) generated prior to formal investigator sign-off.
3. **Gate 2 Protection:** No unilateral claims of ethics exemption. Institutional Ethics Committee (IEC) review follows ICMR 2017 & ICMR AI 2023 guidelines.
4. **Gate 4 Protection:** Zero live calls to external APIs (`GROQ_API_KEY`, `NVIDIA_API_KEY`). All harness testing operates offline via `MockEvalProvider`.

---

## 2. Comprehensive 4-Workstream Status Audit

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            STUDY 3 WORKSTREAMS                              │
├──────────────────────────────┬──────────────────────────────────────────────┤
│ Workstream A (Gate 2)        │ Workstream B (Gate 1)                        │
│ Ethics & IEC Readiness       │ Scenario Generation Readiness                │
│ Priority: CRITICAL           │ Priority: HIGH                               │
│ Status: PENDING_DETERMINATION│ Status: PAUSED (Prep Mode)                   │
├──────────────────────────────┼──────────────────────────────────────────────┤
│ Workstream C (Gate 3)        │ Workstream D (Gate 4)                        │
│ Clinician Calibration Prep   │ Engineering & Mock Harness Readiness         │
│ Priority: MEDIUM             │ Priority: HIGH (Zero-Egress)                 │
│ Status: PENDING (Prep Mode)  │ Status: LOCKED (Mock Validated)              │
└──────────────────────────────┴──────────────────────────────────────────────┘
```

---

### Workstream A — Gate 2: Institutional Ethics & Regulatory Readiness

- **Current State:** `PENDING_INSTITUTIONAL_DETERMINATION`
- **Existing Assets:**
  - Protocol summary in `docs/RESEARCH_EVALUATION_PROTOCOL.md`.
  - IEC submission draft in `eval/governance/IEC_STUDY_BRIEF.md` (identifies protocol as minimal-risk in-silico computational research with zero real patient data).
  - Dataset licensing audit in `eval/config/DATASET_GOVERNANCE.md` and `eval/src/governance/gate0-feasibility-check.ts` (13/13 tests green).
- **Identified Gaps:**
  1. Sponsor and institution placeholders remain unbound (`[Faculty Advisor / Institutional Sponsor]`, `[Institution Name]`).
  2. Formal institutional submission packet has not been filed with the institutional IEC Secretariat.
  3. Formal Determination Letter / Exemption Certificate has not been issued.

---

### Workstream B — Gate 1: Scenario Generation Readiness

- **Current State:** `PAUSED` (Zero scenarios generated).
- **Existing Assets:**
  - Scenario Zod Schema v1.2.0 in `eval/src/schema/scenario-schema.ts`.
  - Deterministic payload transformer $T_{\text{payload}}$ in `eval/src/schema/scenario-payload-transformer.ts` (5/5 tests green).
  - 12 pilot calibration scenarios in `eval/data/pilot/pilot-scenarios.json`.
- **Identified Gaps:**
  1. Automated blueprint generation harness (`eval/src/harness/scenario-generator.ts`) is needed to produce the exact 200 scenario blueprints matching the 10 registered clinical domains (20 per domain) and balanced urgency tiers (Tiers 1–5).
  2. Batch schema validation and cryptographic SHA-256 manifest generation scripts are needed to verify conformity before investigator sign-off.
  3. Formal investigator sign-off document (`eval/governance/GATE1_AUTHORIZATION.md`) is awaiting execution.

---

### Workstream C — Gate 3: Clinician Calibration Preparation

- **Current State:** `PENDING` (Scenario drafting dependent on Gate 1).
- **Existing Assets:**
  - Clinical Review Packet in `docs/clinical-review-packet.md` (defining urgency tiers, clinical cutoff criteria, and high-risk policies).
  - 6-dimension scoring rubric in `eval/data/human_eval/scoring_rubric.md`.
  - Blinding and sampling engine in `eval/src/harness/human-review-sampler.ts`.
- **Identified Gaps:**
  1. Clinician Onboarding Standard Operating Procedure (SOP) with structured calibration exercises.
  2. Documented rater disagreement resolution protocol (consensus conference criteria when Likert difference $|r_1 - r_2| > 1$).
  3. Dry-run calibration test on the 12 existing pilot scenarios.

---

### Workstream D — Gate 4: Engineering & Mock Harness Readiness

- **Current State:** `LOCKED` (Live API calls strictly prohibited).
- **Existing Assets:**
  - Evaluator runner in `eval/src/evaluator/evaluator-runner.ts` with crash-safe atomic write/resume.
  - Deterministic `MockEvalProvider` in `eval/src/providers/mock-eval-provider.ts`.
  - Blinding engine with AES-256-GCM secret mapping in `eval/src/evaluator/blinding-engine.ts`.
  - Full end-to-end regression battery (69 test suites verified, zero failures).
- **Identified Gaps:**
  1. Full-scale synthetic dry run ($N = 1,200$ mock ratings) verifying that the entire downstream aggregation and JSON evidence pipeline operates end-to-end without network egress.
  2. Pre-flight credential check probe asserting fail-closed behavior when environment variables are unset.

---

## 3. Accountable Blocker Ledger (5-Field Matrix)

| # | Blocker | Owner | Required Action | Dependency | Exit Evidence |
|---|---|---|---|---|---|
| **B-G2-01** | Institutional sponsor & committee placeholders unbound in IEC brief | PI / Institutional Sponsor | Bind institutional details in `eval/governance/IEC_STUDY_BRIEF.md` | Institutional Review Setup | Verified IEC brief with named faculty sponsor and department |
| **B-G2-02** | Formal IEC application for exemption determination not yet filed | PI / Research Lead | Submit completed brief to IEC Secretariat under ICMR 2017 Ch. 5.4 | B-G2-01 | Formal submission acknowledgment / receipt with IEC reference number |
| **B-G2-03** | Institutional exemption determination certificate pending | Institutional Ethics Committee (IEC) | IEC review and issuance of formal determination letter | B-G2-02 | Written IEC Determination Letter archived in `eval/governance/evidence/` |
| **B-G1-01** | Automated generation harness for 200 synthetic scenario blueprints unbuilt | Evaluation Engineering Lead | Implement deterministic generator (`scenario-generator.ts`) with fixed seed | Frozen Methodology v3.3.21 | Generator unit test verifying 200 valid scenarios matching 10-domain taxonomy |
| **B-G1-02** | Investigator Gate 1 authorization pending | Principal Investigator | Formal sign-off authorizing execution of scenario generation script | B-G1-01, Methodology Freeze | Signed `eval/governance/GATE1_AUTHORIZATION.md` committed to repo |
| **B-G3-01** | Clinician onboarding & disagreement resolution SOP unformalized | Clinical Research Lead | Draft `eval/governance/CLINICIAN_CALIBRATION_SOP.md` defining rater rules & consensus protocol | Clinical Review Packet | Approved SOP document committed with explicit adjudication thresholds |
| **B-G4-01** | Full-scale 1,200-item offline mock dry run unexecuted | Infrastructure Lead | Execute evaluator runner with `MockEvalProvider` at full 1,200-sample scale | Gate 1 & Runner Harness | Valid mock run manifest and 1,200 mock records generated with 0 live API calls |

---

## 4. Parallel Execution Sprint Roadmap

```
Sprint Day 1-2 (Independent Preparation):
  ├── [Workstream A] Bind IEC brief details & prepare formal submission packet
  ├── [Workstream B] Build scenario-generator.ts & batch schema auditor (offline)
  ├── [Workstream C] Draft CLINICIAN_CALIBRATION_SOP.md on pilot scenarios
  └── [Workstream D] Execute full 1,200-item MockEvalProvider offline dry run

Sprint Day 3 (Review & Sign-Off):
  ├── [Gate 1] Present scenario generation validation package for investigator authorization
  ├── [Gate 2] Log formal IEC submission receipt
  └── [Gate 3] Validate pilot clinician calibration scoring

Sprint Day 4+ (Execution Post-Authorization):
  ├── [Gate 1 Unblocked] Execute deterministic scenario generation (200 blueprints created)
  ├── [Gate 3 Unblocked] Clinician review panel reviews generated blueprints
  └── [Gate 2 Complete] Await formal IEC Determination Certificate prior to Gate 4 unblinding
```
