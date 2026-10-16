# MedVoice AI: Clinical Safety Architecture & Governance

> **Document Version:** 1.0  
> **Status:** Clinical Safety Specification & Release Governance Charter  
> **Target Audience:** Clinical Safety Officers, Attending Physicians, Regulatory Reviewers, Software Engineers  

---

## 1. Safety Intent & Regulatory Scope

MedVoice is designed strictly as an **investigational clinical decision support and triage intake assistant** for pre-hospital voice interaction. It evaluates patient testimony in real time, extracts structured symptoms, flags life-threatening clinical presentations, and coordinates emergency escalation.

### Explicit Operational Boundaries ("What MedVoice Does NOT Do")
To eliminate clinical ambiguity and prevent dangerous misuse, MedVoice operates under the following hard architectural constraints:

1. **No Autonomous Diagnosis**: MedVoice does not formulate definitive medical diagnoses. All diagnostic outputs represent preliminary triage risk stratifications and differentials for clinician review.
2. **No Autonomous Medication Prescription**: The system is prohibited from prescribing medications, altering prescription dosages, or advising patients to discontinue prescribed treatments.
3. **No Direct Hardware Biometric Acquisition & Zero ECG Integration**: Clinical scoring tools (e.g., TIMI, BE-FAST, PEWS) are **deterministic heuristic algorithms** evaluating user-reported symptoms and patient-reported telemetry. MedVoice does **not** acquire direct 12-lead ECGs, automated blood pressures, or continuous pulse oximetry. Any ECG-related parameters are heuristic descriptors of patient-reported symptoms, unvalidated for acute clinical decisions.
4. **Simulated Multi-Specialist Deliberation**: Specialist modules (Cardiology, Neurology, Pediatrics) are software rule-and-prompt heuristics with bounded execution budgets, **not** real-time panels of independent physician LLMs or certified clinical authorities.
5. **No Automated CAD / PSAP Dispatch**: MedVoice does not connect directly to 911/112/108 computer-aided dispatch (CAD) emergency switches. Emergency handling consists of immediate verbal instructions directing the caller to dial local emergency services, accompanied by verified hospital routing.
6. **Not a Cleared Medical Device**: MedVoice is an investigational software system and has not been cleared or approved by the U.S. FDA, European EMA, or Indian CDSCO as a Software as a Medical Device (SaMD).

---

## 2. Standardized Urgency Taxonomy: MedVoice Tiers vs. ESI v4

The Emergency Severity Index (ESI v4) is an emergency department algorithm dependent on in-person physical examination, point-of-care diagnostics, and resource utilization predictions. In a remote voice triage setting, these physical modalities do not exist.

MedVoice standardizes on **MedVoice Urgency Tiers (Tiers 1–5)**:

| Tier | Urgency Classification | Disposition Protocol | Clinical Action & Indications |
| :---: | :--- | :--- | :--- |
| **Tier 1** | Immediate Resuscitation | Immediate Emergency Services Call | Airway collapse, stridor, severe cyanosis, cardiac arrest, respiratory failure. Stop intake and instruct caller to dial 112 / 108 / 911 immediately. |
| **Tier 2** | Emergent / High Risk | Rapid Emergency Evaluation (< 15 min) | Acute coronary syndrome equivalents, acute focal neurological deficit (BE-FAST), thunderclap headache, active uncontrolled hemorrhage. |
| **Tier 3** | Urgent / Same-Day | Same-Day Clinic / Urgent Care (< 12 hr) | Moderate acute illness without hemodynamic compromise: unassessed pleuritic pain, high fever without sepsis, severe dehydration with stable vitals. |
| **Tier 4** | Less Urgent | Routine Ambulatory Appointment | Low-acuity complaints: uncomplicated pharyngitis, mild upper respiratory infection, minor musculoskeletal strain. |
| **Tier 5** | Non-Urgent | Primary Care / Administrative Advice | Routine follow-up: maintenance prescription refills, administrative forms, preventive health inquiries. |

> **API Compatibility Note**: In `lib/triage/safety-arbiter.ts`, the canonical classification is represented by `urgencyTier: MedVoiceUrgencyTier` (1–5) and `tierTitle: string`. The legacy property `esiScore` is maintained strictly as a backward-compatible programmatic alias.

---

## 3. Deterministic Safety Arbiter & Universal Red-Flag Screen

### 3.1. Design Principles of the Safety Arbiter
1. **Classifier Independence**: The Universal Red-Flag Screen (`lib/triage/universal-red-flags.ts`) evaluates every turn directly against normalized patient testimony and accumulated clinical facts. A diagnostic classifier misclassification (e.g. labeling chest pain under gastrointestinal issues) cannot suppress a cardiovascular rule.
2. **Escalate-Only (Monotonic Non-Downgrade Invariant)**: Acuity is monotonic within an encounter. Once an emergency condition (Tier 1 or Tier 2) is triggered, downstream LLM reasoning or subsequent non-emergency answers are mathematically forbidden from de-escalating acuity:
   $$\text{UrgencyTier}_{\text{final}} = \min(\text{UrgencyTier}_{\text{pre-arbiter}}, \text{UrgencyTier}_{\text{llm}})$$
3. **Fail-Safe on Uncertainty**: Equivocal phrases ("maybe", "not sure", inaudible ASR) on high-lethality triggers are treated as positive-uncertain, initiating a single discriminator question rather than clearing the flag.
4. **Local Negation Scope**: Negation parsing is strictly localized. "I have no fever, but severe chest pressure" negates only fever; it never suppresses the chest pressure indicator.

### 3.2. Universal Red-Flag Catalog Summary

| Category | Representative Trigger Conditions | Assigned Acuity |
| :--- | :--- | :---: |
| **Airway / Respiratory** | Inability to speak in full sentences, stridor, cyanosis, tongue/throat swelling | Tier 1 (Emergency) |
| **Circulation / Shock** | Syncope with chest pain, cold/clammy/mottled skin, hematemesis with dizziness | Tier 1 (Emergency) |
| **Neurological** | Sudden facial droop, unilateral arm/leg weakness, slurred speech (BE-FAST), thunderclap headache ("worst of life"), new confusion | Tier 2 (Emergent) |
| **Cardiovascular** | Crushing/pressure retrosternal pain, radiation to jaw/left arm, exertional diaphoresis | Tier 2 (Emergent) |
| **Pediatric Critical** | Infant $<3\text{ months}$ with fever $\ge 38.0^\circ\text{C}$, inconsolable lethargy, grunting/stridor | Tier 1 / Tier 2 |
| **Surgical Abdomen** | Rigid board-like abdomen, severe localized RLQ pain with rebound tenderness | Tier 2 (Emergent) |
| **Obstetric Emergency** | Gestational age $\ge 20\text{ weeks}$ with severe headache, visual disturbance, or RUQ pain (preeclampsia) | Tier 2 (Emergent) |

---

## 4. Anti-Hallucination & Provenance Rigor

To prevent LLM hallucination from introducing clinical risk into medical records:

1. **Missing vs. Denied Distinction**:
   - An unasked clinical dimension is recorded as `unresolved` or `[NOT ASSESSED]`.
   - The system is programmatically blocked from asserting that an unasked symptom is negative (e.g. it cannot record "denies shortness of breath" if the question was never asked).
2. **Strict Provenance Hierarchy**:
   Every clinical fact stored in `attributedFacts` carries a verifiable provenance tag:
   - `patient_reported`: Spoken directly by patient during interview.
   - `clinician_verified`: Verified by medical staff during encounter review.
   - `device_measured`: Acquired via authenticated medical device integrations.
   - `arbiter_enforced`: Generated deterministically by safety rules.
   - When conflicting statements occur, facts with higher provenance rank automatically take precedence (`clinician_verified` > `arbiter_enforced` > `device_measured` > `patient_reported`).
3. **No Fabricated Biometrics**:
   Unmeasured biometric vitals (blood pressure, heart rate, oxygen saturation, temperature) are represented as `[NOT ASSESSED]`. The LLM is forbidden from synthesizing simulated numbers in clinical notes.

---

## 5. Clinical Benchmark Evaluation & Validation Status

### 5.1. Standardized 35-Case Benchmark Evaluation
MedVoice was evaluated against an automated clinical regression suite comprising 35 standardized clinical benchmark scenarios:
- **22 High-Acuity Emergency Cases**: Acute myocardial infarction, atypical angina in diabetics, acute ischemic stroke, pulmonary embolism, pediatric epiglottitis, neonatal fever, ruptured ectopic pregnancy, tension pneumothorax, anaphylaxis.
- **13 Non-Emergency Control Cases**: Uncomplicated viral URI, localized contact dermatitis, chronic tension headache, routine medication refill, stable osteoarthritis.

### 5.2. Measured Safety Concordance
- **Emergency Sensitivity**: **100% (22/22)**. All 22 life-threatening cases were correctly escalated to Emergency Status (Tier 1 / Tier 2) with immediate EMS notification scripts.
- **False-Negative Rate**: **0.0% (0/22)** on the benchmark population. Zero life-threatening cases were downgraded to ambulatory or routine care.
- **Scope Disclaimer**: This 100% sensitivity metric was measured on this finite 35-case benchmark suite. It demonstrates deterministic arbiter consistency under controlled inputs and **does not constitute a claim of universal population-level clinical accuracy**.

---

## 6. Pre-Production Release Constraints

Before MedVoice can transition from an investigational research prototype to clinical piloting, the following clinical release gates must be fulfilled:

1. **Formal Physician Review of Thresholds**: All empirical screening thresholds (e.g., infant fever cutoffs, atypical ACS screening age $\ge 40$, active bleeding continuous pressure time $\ge 10\text{ minutes}$) must be signed off by a credentialed Clinical Governance Board.
2. **Jurisdiction-Specific Emergency Number Routing**: Verify emergency contact numbers per deployment jurisdiction (e.g., India: `112` national, `108` ambulance, `102` maternal transport, `14416` Tele-MANAS; US: `911`).
3. **Human-in-the-Loop Signoff**: All generated consultation notes (`consultationsTable`) must remain in `completed_pending_review` until an authorized clinician reviews and signs off on the record.
4. **Safety Regression Suite Gate**: Any code modifications to `lib/triage/`, `lib/agents/`, or `lib/clinical-knowledge/` must pass 100% of the 41-suite canonical test battery with zero regressions in emergency sensitivity.
