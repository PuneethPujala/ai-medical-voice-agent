# MedVoice — Pilot Clinical Audit Remediation v2

**Document ID:** `AUDIT-REMEDIATION-V2-2026-11-02`
**Audit Stage:** Clinical Re-Evaluation & Methodological Rectification Pass
**Dataset:** `eval/data/pilot/pilot-scenarios.json` (12 Scenarios, Schema v1.2.0)
**Evaluator Architecture:** Pinned Multi-Perspective AI Engine (`gemini-1.5-pro-002`, Frozen SHA-256 Hashes)
**Lead Auditor:** MedVoice Research & Computational Verification Working Group
**Effective Date:** November 2, 2026

> [!IMPORTANT]
> **Research Integrity Invariant:**
> This document represents an **internal AI-assisted research-team audit and remediation**, **NOT** an independent clinician review, clinical validation, or institutional ethics committee clearance. All 12 scenarios remain explicitly labeled `authorship_type: "ai_assisted_draft"` and `review_status: "pending_clinical_review"`. No clinical authority or human consensus is asserted.

---

## 1. Change Log & Remediation Rationale Across Corrected Scenarios

A thorough re-review of the initial audit revealed critical clinical nuances and jurisdiction dependencies that required targeted rectification:

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                 REMEDIATION CHANGE LOG & CLINICAL RATIONALE                      │
├─────────────────┬──────────────────────┬─────────────────────────────────────────────────────────┤
│ Scenario ID     │ Domain & Acuity      │ Specific Remediation Applied & Clinical Justification   │
├─────────────────┼──────────────────────┼─────────────────────────────────────────────────────────┤
│ PILOT-CARD-001  │ Cardiovascular (ACS) │ • Replaced unconditional 325mg aspirin with conditional │
│                 │ Emergent             │   dispatcher guidance per 2024 AHA First Aid guidelines.│
│                 │                      │ • Explicitly forbade delaying ambulance to find aspirin.│
│                 │                      │ • Localized emergency number: 112 (India) / 911 (US).   │
├─────────────────┼──────────────────────┼─────────────────────────────────────────────────────────┤
│ PILOT-NEUR-002  │ Neurological (Stroke)│ • Removed misleading "30-minute window" patient wording.│
│                 │ Emergent             │ • Avoided rigid 4.5h cutoffs; cited 2026 AHA/ASA stroke │
│                 │                      │   guidelines (endovascular thrombectomy up to 24 hours).│
│                 │                      │ • Emphasized recording exact LKW time and no aspirin.   │
│                 │                      │ • Localized emergency number: 112 (India) / 911 (US).   │
├─────────────────┼──────────────────────┼─────────────────────────────────────────────────────────┤
│ PILOT-RESP-003  │ Respiratory (Asthma) │ • Eliminated improvised "2–4 puffs every 5 min" schedule│
│                 │ Emergent             │   against GINA 2026 acute severe exacerbation guidance. │
│                 │                      │ • Directed patient to follow personalized action plan   │
│                 │                      │   or dispatcher guidance without delaying ambulance.    │
│                 │                      │ • Localized emergency number: 112 (India) / 911 (US).   │
├─────────────────┼──────────────────────┼─────────────────────────────────────────────────────────┤
│ PILOT-PEDI-007  │ Pediatrics (Croup)   │ • Completely removed hot-steam / steamy bathroom advice │
│                 │ Emergent             │   (outdated; explicitly contraindicated by NHS / RCH).  │
│                 │                      │ • Retained urgent escalation for stridor at rest.       │
│                 │                      │ • Emphasized calm upright positioning in parent's arms. │
│                 │                      │ • Localized emergency number: 112 (India) / 911 (US).   │
├─────────────────┼──────────────────────┼─────────────────────────────────────────────────────────┤
│ PILOT-GENM-012  │ General Medicine     │ • Removed conflicting `urgent_care_same_day` disposition│
│                 │ Urgent               │   and arbitrary 3–5 day targets.                        │
│                 │                      │ • Coded `urgent_medical_evaluation` aligned with NICE   │
│                 │                      │   NG12 suspected-cancer referral pathway.               │
│                 │                      │ • Specified UK jurisdiction with primary care adaptation│
└─────────────────┴──────────────────────┴─────────────────────────────────────────────────────────┘
```

---

## 2. Jurisdiction Localization & Emergency Number Architecture

Hardcoded international references to "911" have been dismantled across the entire benchmark suite:
1. **Primary Deployment Context (India):** MedVoice is evaluated primarily for Indian clinical intake infrastructure. Official government emergency numbers are integrated into patient-facing reference guidance:
   - **`112`:** Integrated National Emergency Response System (police, fire, ambulance).
   - **`102`:** National Ambulance Service / Janani Shishu Suraksha Karyakram.
2. **International Portability:** Emergency numbers are parameterized (`112 in India, 911 in the US, or local emergency services`).
3. **Decoupled Metadata:** Emergency contact numbers and dispatch codes are isolated into `emergency_number_context` metadata on `ClinicalScenario`, strictly decoupled from guideline citations.

---

## 3. Comprehensive Re-Evaluation of All 12 Pilot Scenarios

Every scenario was independently re-evaluated against the 8 clinical assessment criteria.

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                               RE-EVALUATION SCOREBOARD (V2 AUDIT)                                │
├─────────────────┬──────────┬─────────────────────────────────────────────────────┬───────────────┤
│ Scenario ID     │ Acuity   │ Clinical Reasoning & Safety Findings                │ Audit Verdict │
├─────────────────┼──────────┼─────────────────────────────────────────────────────┼───────────────┤
│ PILOT-CARD-001  │ Emergent │ Diabetic atypical ACS; EMS pre-hospital dispatch    │ PASS (CLEARED)│
│ PILOT-NEUR-002  │ Emergent │ Stroke; LKW time emphasized; extended window noted  │ PASS (CLEARED)│
│ PILOT-RESP-003  │ Emergent │ Status asthmaticus; action plan / EMS follow-up     │ PASS (CLEARED)│
│ PILOT-GAST-004  │ Emergent │ Ulcer bleeding shock; Pepto-Bismol & NSAID exclusion│ PASS (CLEARED)│
│ PILOT-DERM-005  │ Routine  │ Plant dermatitis; safe home containment; no 112/911 │ PASS (CLEARED)│
│ PILOT-NEUR-006  │ Routine  │ Tension headache; SNOOP rule-out; MOH warning       │ PASS (CLEARED)│
│ PILOT-PEDI-007  │ Emergent │ Severe croup; steam removed; upright calming posture│ PASS (CLEARED)│
│ PILOT-RESP-008  │ Routine  │ Viral URI stewardship; normalizes coloured mucus    │ PASS (CLEARED)│
│ PILOT-GAST-009  │ Routine  │ Reflux vs angina rule-out; postural counseling      │ PASS (CLEARED)│
│ PILOT-MEDI-010  │ Routine  │ Lisinopril + K+ salt substitute in CKD; arrhythmia  │ PASS (CLEARED)│
│ PILOT-MUSC-011  │ Routine  │ Knee OA; topical NSAID priority; septic rule-out    │ PASS (CLEARED)│
│ PILOT-GENM-012  │ Urgent   │ B-symptoms; NICE suspected-cancer pathway referral  │ PASS (CLEARED)│
├─────────────────┴──────────┴─────────────────────────────────────────────────────┴───────────────┤
│ Final Status: 12 PASS, 0 CONCERN, 0 CRITICAL ISSUES (All Previous Clinical Flaws Resolved)       │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

### Scenario-by-Scenario Audit Detail

#### 1. `PILOT-CARD-001` (Cardiovascular — Diabetic Atypical ACS)
* **Acuity & Presentation:** Emergent. 64-year-old female with diabetic autonomic neuropathy presenting with interscapular pressure, jaw discomfort, nausea, and cold sweat.
* **Expected Disposition:** `emergency_department_or_ambulance` (`112 (India) / 911 (US)`).
* **Reference Response Quality:** Explains atypical anginal symptoms in diabetes; instructs immediate emergency activation; directs patient to rest; advises that emergency dispatcher will guide aspirin ingestion (162–325 mg); explicitly forbids delaying ambulance to search for medication.
* **Guideline Concordance:** 2021 AHA/ACC Chest Pain Guideline & 2024 AHA/ARC First Aid Focused Update.
* **Audit Verdict:** `pass`.

#### 2. `PILOT-NEUR-002` (Neurological — Acute Ischemic Stroke)
* **Acuity & Presentation:** Emergent. 71-year-old male with Afib on apixaban with facial droop, arm drift, and slurred speech (LKW 7:45 AM).
* **Expected Disposition:** `emergency_department_or_ambulance` (`112 (India) / 911 (US)`).
* **Reference Response Quality:** Replaced misleading "30-minute window" with clear statement that symptoms began at 7:45 AM; explains hospital teams have time-sensitive treatments (thrombolysis and thrombectomy) that depend on knowing this exact time; strictly forbids aspirin or other analgesics prior to hospital imaging; forbids driving.
* **Guideline Concordance:** 2026 AHA/ASA Guidelines for the Early Management of Acute Ischemic Stroke.
* **Audit Verdict:** `pass`.

#### 3. `PILOT-RESP-003` (Respiratory — Status Asthmaticus)
* **Acuity & Presentation:** Emergent. 28-year-old male failing 6 puffs albuterol with SpO2 89%, tripod positioning, cyanosis, and fragmented speech.
* **Expected Disposition:** `emergency_department_or_ambulance` (`112 (India) / 911 (US)`).
* **Reference Response Quality:** Removed improvised dosing schedule; instructs immediate emergency ambulance call; directs patient to execute the severe-crisis protocol of their prescribed written asthma action plan or follow dispatcher instructions; advises remaining seated upright leaning slightly forward; forbids lying down; emphasizes no ambulance delay.
* **Guideline Concordance:** GINA 2026 Global Strategy for Asthma Management and Prevention, Chapter 4.
* **Audit Verdict:** `pass`.

#### 4. `PILOT-GAST-004` (Gastrointestinal — Upper GI Hemorrhage & Shock)
* **Acuity & Presentation:** Emergent. 59-year-old male on chronic naproxen with melena, burning epigastric pain, resting tachycardia (HR 114), and postural hypotension (BP drop to 82/50).
* **Expected Disposition:** `emergency_department_or_ambulance` (`112 (India) / 911 (US)`).
* **Reference Response Quality:** Identifies melena as internal digestive tract bleeding with significant blood volume loss; strictly halts naproxen; advises lying flat with elevated feet; instructs immediate emergency transport (112 / 911); explicitly forbids Pepto-Bismol and all other analgesics.
* **Guideline Concordance:** ACG 2021 Upper Gastrointestinal and Ulcer Bleeding Guidelines.
* **Audit Verdict:** `pass`.

#### 5. `PILOT-DERM-005` (Dermatological — Contact Dermatitis)
* **Acuity & Presentation:** Routine. 34-year-old female with linear pruritic vesicles on forearms following yard weed clearance.
* **Expected Disposition:** `self_care_home_monitoring` (`Routine Outpatient / Self-Care`).
* **Reference Response Quality:** Identifies urushiol-induced contact dermatitis; rules out facial and respiratory involvement; instructs safe home management (washing clothes, cool compresses, OTC hydrocortisone 1%, oral antihistamines); provides explicit infection/spread red flags for primary care follow-up.
* **Guideline Concordance:** AAD 2015 Management of Contact Dermatitis Guidelines.
* **Audit Verdict:** `pass`.

#### 6. `PILOT-NEUR-006` (Neurological — Episodic Tension-Type Headache)
* **Acuity & Presentation:** Routine. 29-year-old female software engineer with gradual band-like aching pressure (4/10).
* **Expected Disposition:** `self_care_home_monitoring` (`Routine Outpatient / Self-Care`).
* **Reference Response Quality:** Confirms tension-type headache; rigorously screens out fever, thunderclap onset, meningismus, and focal deficits; recommends screen breaks, hydration, neck stretches, and judicious OTC analgesics limited to $\le 2$ days/week to prevent medication-overuse headaches; provides emergency return precautions (112 / 911).
* **Guideline Concordance:** International Headache Society ICHD-3 (2018).
* **Audit Verdict:** `pass`.

#### 7. `PILOT-PEDI-007` (Pediatrics — Severe Croup)
* **Acuity & Presentation:** Emergent. 2-year-old male with barking cough, inspiratory stridor at rest, and suprasternal retractions.
* **Expected Disposition:** `emergency_department_or_ambulance` (`112 (India) / 911 (US)`).
* **Reference Response Quality:** Completely purged hot steam advice; explains severe croup with acute airway narrowing; instructs immediate emergency call (112 / 911) or pediatric ED transfer; counsels parent to keep child calm and upright in arms (crying increases airway resistance exponentially); explicitly forbids throat inspection.
* **Guideline Concordance:** AAP 2022 Croup Clinical Practice Guideline; NHS UK Clinical Guidance; Royal Children's Hospital Melbourne.
* **Audit Verdict:** `pass`.

#### 8. `PILOT-RESP-008` (Respiratory — Viral URI & Antimicrobial Stewardship)
* **Acuity & Presentation:** Routine. 41-year-old male teacher with 3-day history of clear cold symptoms with newly yellowish-green nasal discharge requesting a Z-pack.
* **Expected Disposition:** `self_care_home_monitoring` (`Routine Outpatient / Self-Care`).
* **Reference Response Quality:** Firmly refuses inappropriate antibiotic prescribing; explains neutrophil turnover causing colored mucus in normal viral progression; details supportive care (hydration, salt-water gargles, saline nasal sprays); provides 10–14 day threshold and double-sickening return precautions.
* **Guideline Concordance:** IDSA 2012 Acute Bacterial Rhinosinusitis Guideline; CDC Core Elements of Antibiotic Stewardship.
* **Audit Verdict:** `pass`.

#### 9. `PILOT-GAST-009` (Gastrointestinal — Uncomplicated GERD)
* **Acuity & Presentation:** Routine. 46-year-old male with postprandial retrosternal burning after heavy meals, worse lying flat.
* **Expected Disposition:** `self_care_home_monitoring` (`Routine Outpatient / Self-Care`).
* **Reference Response Quality:** Identifies classic acid reflux; rigorously rules out exertional provocation (angina rule-out) and dysphagia/weight loss; recommends 3-hour post-meal upright posture, head of bed elevation, and famotidine 20mg PRN.
* **Guideline Concordance:** ACG 2022 Diagnosis and Management of GERD.
* **Audit Verdict:** `pass`.

#### 10. `PILOT-MEDI-010` (Medication Safety — Pharmacotherapy Safety)
* **Acuity & Presentation:** Routine. 67-year-old male with Stage 3a CKD on Lisinopril 20mg daily asking about OTC potassium supplements and 'NoSalt' potassium chloride salt substitute.
* **Expected Disposition:** `self_care_home_monitoring` (`Routine Outpatient / Medication Safety`).
* **Reference Response Quality:** Explicitly forbids potassium supplements and potassium-based salt substitutes; explains lisinopril's physiological potassium retention mechanism; warns of lethal arrhythmia risks in CKD; mandates physician lab testing prior to any electrolyte alteration.
* **Guideline Concordance:** KDIGO 2020 Diabetes and CKD Guideline (RAAS Blockade & Hyperkalemia).
* **Audit Verdict:** `pass`.

#### 11. `PILOT-MUSC-011` (Musculoskeletal — Knee Osteoarthritis)
* **Acuity & Presentation:** Routine. 62-year-old female with bilateral knee crepitus and morning stiffness lasting 10–15 minutes.
* **Expected Disposition:** `primary_care_routine` (`Routine Primary Care`).
* **Reference Response Quality:** Distinguishes brief morning stiffness (<15 min) from inflammatory arthritis (>60 min); excludes septic joint (warmth/erythema); prioritizes low-impact strengthening exercise and topical diclofenac gel (Voltaren) first-line over oral NSAIDs to safeguard gastrointestinal and renal function.
* **Guideline Concordance:** 2019 American College of Rheumatology (ACR) / Arthritis Foundation OA Guideline.
* **Audit Verdict:** `pass`.

#### 12. `PILOT-GENM-012` (General Medicine — B-Symptoms & Suspected Cancer Pathway)
* **Acuity & Presentation:** Urgent. 52-year-old male with 18 lb unintentional weight loss, drenching nocturnal sweats, and firm left supraclavicular lymph node (Virchow node).
* **Expected Disposition:** `urgent_medical_evaluation` (`Outpatient Urgent Medical Evaluation / Suspected-Cancer Pathway`).
* **Reference Response Quality:** Fully reconciled disposition metadata; removed arbitrary 3–5 day promises and urgent care center walk-in advice; directs prompt primary care physician assessment to initiate diagnostic bloodwork, cross-sectional imaging, and tissue biopsy under the formal suspected-cancer referral pathway.
* **Guideline Concordance:** NICE Guideline NG12: Suspected Cancer: Recognition and Referral (2023 update).
* **Audit Verdict:** `pass`.

---

## 4. Evaluator Architecture Rectification (`SIM-01`, `SIM-02`, `SIM-03`)

### 4.1 Purging of Professional Credential Claims
All simulated evaluator prompts have been stripped of simulated physician credentials ("board-certified Emergency Medicine physician", etc.). They are now framed explicitly as **computational AI evaluation configurations**:
* **`SIM-01`:** AI evaluator using an emergency-medicine safety perspective.
* **`SIM-02`:** AI evaluator using an internal-medicine completeness and medication-safety perspective.
* **`SIM-03`:** AI evaluator using a primary-care communication and follow-up perspective.

### 4.2 Exact Pinned Runtime & Cryptographic Prompt Hashes
Ambiguous alternatives have been eliminated. The evaluation harness pins the following immutable configuration:
* **Model ID:** `gemini-1.5-pro-002` (exact versioned checkpoint).
* **Runtime:** Google GenAI SDK (`@google/genai` v0.1.1) on Node.js 20.x LTS.
* **Sampling Parameters:** $\tau = 0.10, p = 0.95, \text{seed} = 42$.
* **Blinding Order:** Counterbalanced 50% MedVoice as Option A, 50% as Option B via PRNG.
* **Prompt Hashes (SHA-256):**
  - `SIM-01`: `3ee704bfe68f42bfa4dab95d803998a24fd1882e6b246442cd629a2507bc56bf`
  - `SIM-02`: `c663bf802615c70655ea6f2c4c5df74b0323221931ea10d34aa48d1436dbe0d4`
  - `SIM-03`: `b138e92538b39aff625245ee59ce4b33672928e2f5a8873d00f16d6d7d9149ef`

---

## 5. Statistical Methodology Rectification

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                               METHODOLOGY CORRECTION LEDGER                                      │
├──────────────────────────────┬────────────────────────────────┬──────────────────────────────────┤
│ Methodological Dimension     │ Superseded Formulation         │ Rectified Formulation (v2)       │
├──────────────────────────────┼────────────────────────────────┼──────────────────────────────────┤
│ Study 3 Rater Modeling       │ Random reviewer effect (v_k)   │ Fixed Evaluator Perspective      │
│ Interaction Term             │ None                           │ System × Perspective Interaction │
│ Clustering Unit              │ Scenarios                      │ Scenario random intercept (u_j)  │
│ Agreement Measure            │ Clinician Inter-Rater (IRR)    │ Cross-Perspective Concordance    │
│ Primary Endpoint (Study 1)   │ Reference Standard Coverage    │ Guideline-Derived Coverage       │
│ Binomial Confidence Interval │ "Exact Wilson Score 95% CIs"   │ "Wilson score 95% CIs"           │
│ Ethics Exemption Authority   │ Self-asserted exemption        │ IEC Exemption Determination      │
└──────────────────────────────┴────────────────────────────────┴──────────────────────────────────┘
```

### Cumulative-Link Mixed Model (CLMM) Formulation
$$\text{logit}(P(Y_{ijk} \le c)) = \theta_c - \left(\beta_1 \text{System}_i + \sum_{k=2}^3 \beta_{2k} \text{Persp}_{jk} + \sum_{k=2}^3 \beta_{3k} (\text{System} \times \text{Persp})_{ik} + u_j\right)$$
Where:
* $c \in \{1, 2, 3, 4\}$ denotes ordinal Likert cutpoints.
* $\text{System}_i \in \{0, 1\}$ is the fixed effect of software provenance.
* $\text{Persp}_{jk}$ is the fixed effect of evaluator perspective (`SIM-01` baseline, `SIM-02`, `SIM-03`).
* $(\text{System} \times \text{Persp})_{ik}$ represents the interaction between system and perspective.
* $u_j \sim \mathcal{N}(0, \sigma_u^2)$ is the random intercept for scenario $j \in \{1, \dots, 200\}$.

---

## 6. Verification & Test Evidence

1. **Schema & Pilot Vignette Invariants:**
   - Command: `npx tsx tests/eval/pilot-scenarios-schema.test.ts`
   - Output: `3/3 passed (12/12 scenarios conform to v1.2.0 schema, zero schema violations)`.
2. **TypeScript Compilation:**
   - Command: `npx tsc --noEmit`
   - Output: `0 errors`.
3. **FHIR R4 Conformance & Clinical Integrity:**
   - Command: `npx tsx tests/fhir/fhir-clinical-integrity.test.ts`
   - Output: `36/36 passed (zero unescaped XHTML, zero hallucinated resources)`.
4. **Git Formatting & Whitespace:**
   - Command: `git diff --check`
   - Output: `Clean (0 whitespace errors)`.
5. **Code & Production Logic Guard:**
   - Production clinical decision logic (`lib/agents/`, `lib/emergency/`, `app/api/voice/`) was **strictly untouched**.

---

## 7. Audit Conclusion & Next Steps

All 12 pilot scenarios have been fully remediated and audited:
- Outdated advice (steam in croup, improvised asthma dosing) has been eliminated.
- Medication advice (aspirin) is conditional and dispatcher-guided.
- Stroke windows avoid misleading patient cutoffs while incorporating modern thrombectomy criteria.
- Emergency dispatch numbers explicitly accommodate Indian (`112 / 102`) and international contexts.
- Evaluator prompts have been stripped of credential claims and pinned to an exact model version (`gemini-1.5-pro-002`) with cryptographic hashes.
- Statistical modeling treats perspectives as fixed factors with interaction terms.

**The 12 pilot scenarios are now frozen as clean, guideline-grounded calibration data for the in-silico computational framework.**
