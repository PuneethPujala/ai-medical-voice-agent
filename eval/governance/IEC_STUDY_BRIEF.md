# Study Brief for Institutional Ethics Committee (IEC) & Faculty Sponsorship

**Protocol Title:** Empirical Multi-Dimensional In-Silico Evaluation of a Voice-Enabled Conversational Decision-Support System for Clinical Intake and Triage
**Protocol Short Title:** MedVoice Clinical AI Evaluation (Phase 1 In-Silico Computational Framework & Pilot)
**Principal Investigator / Research Lead:** MedVoice Engineering & Clinical Research Group
**Faculty Supervisor / Sponsor:** [Faculty Advisor / Institutional Sponsor], Department of Biomedical Informatics / Medical AI
**Target Ethics Body:** Institutional Ethics Committee (IEC), [Institution Name]
**Applicable Framework:** ICMR National Ethical Guidelines for Biomedical and Health Research (2017) & ICMR AI in Healthcare Guidelines (2023)
**Date of Submission:** November 2, 2026

---

## 1. Executive Summary & Nature of the Protocol

This protocol outlines the scientific rationale, methodology, and ethical safeguards for Phase 1 in-silico evaluation of **MedVoice**, an investigational conversational clinical decision-support agent designed to assist patients during health intake by structuring clinical dialogues and detecting potential medical emergencies.

### Key Bioethics Invariant
* **Zero Real Patient Enrollment:** Phase 1 uses **100% synthetic clinical vignettes** designed to represent diverse clinical complaints (cardiovascular, respiratory, neurological, gastrointestinal, pediatric). No authentic medical records, personal identifiable data (PII), or protected health information (PHI) are collected, processed, or stored.
* **No External Human Subjects or Clinician Recruitment in Phase 1:** To maintain strict research integrity without fabricating clinician credentials, Phase 1 evaluates system behavior entirely in-silico using **computational, role-conditioned simulated expert perspectives (`SIM-01`, `SIM-02`, `SIM-03`)** alongside frozen guideline-grounded reference responses. No external human participants, clinical staff, or healthcare consumers are recruited, surveyed, or burdened in this phase.
* **Formal Request for IEC Review Category Determination:** The investigators formally submit this dossier to request the Institutional Ethics Committee's **Official Review Category Determination** (seeking consideration for Exemption from Review or Expedited Review as determined by the Committee). Under the ICMR 2017 Guidelines (**Table 4.2 and Sections 4.8.1–4.8.3**, Review Procedures) and the ICMR AI in Healthcare Guidelines (**2023, Section 3**, Ethical Review Process), the categorization of review (Exemption, Expedited, or Full Committee) is determined exclusively by the Ethics Committee and its Secretariat upon evaluation of the protocol—never through researcher self-determination.

---

## 2. Research Objectives & Study Design

The research encompasses four decoupled scientific studies executed within an offline computational evaluation harness:

1. **Study 1 (Response Quality Benchmark):** Evaluates guideline-derived clinical element coverage and safety adherence against structured reference responses across 10 clinical chief complaint domains using standardized synthetic scenarios ($N = 500\text{--}600$).
2. **Study 2 (Safety & Escalation Challenge):** Assesses emergency sensitivity and under-triage rates across standardized emergency and non-emergent challenge cases ($N = 400\text{--}500$), measuring Wilson score 95% confidence intervals.
3. **Study 3 (AI-Assisted Multi-Perspective Computational Evaluation):** Evaluates 200 identity-masked response pairs across six clinical dimensions (Correctness, Relevance, Completeness, Uncertainty, Clarity, Empathy) using three standardized simulated clinical evaluator perspectives:
   - `SIM-01`: **Emergency Medicine Safety Perspective** (prioritizes rapid red-flag screening, prevents under-triage and acute delays).
   - `SIM-02`: **Internal Medicine Completeness Perspective** (prioritizes diagnostic completeness, comorbidity reconciliation, and drug interactions).
   - `SIM-03`: **Primary Care Communication Perspective** (prioritizes continuity of care, risk stratification, and prevents unwarranted ED over-triage).
   *Analysis utilizes Cumulative-Link Mixed-Effects Models (CLMM) treating evaluator perspective as a fixed factor with a System × Perspective interaction.*
4. **Study 4 (Operational Reliability Testing):** Evaluates system response latency, speech transcription (STT), speech synthesis (TTS), memory leak resilience, and concurrency using controlled synthetic traffic ($N = 1,000$ pilot; $N \ge 10,000$ for definitive P99 claims).

---

## 3. Ethical Safeguards & ICMR 2023 Alignment

| ICMR 2023 Principle | Project Implementation & Ethical Countermeasures |
| :--- | :--- |
| **Principle of Safety & Harm Minimization (Ch. 2.2)** | Evaluates zero-tolerance critical safety omissions (e.g., missed myocardial infarction or stroke signs). The system is deployed strictly as an offline evaluation harness, completely decoupled from active patient care. |
| **Principle of Autonomy & Privacy (Ch. 2.1)** | Zero real patient data ingested. All scenarios are synthetic vignettes authored by the study team. No data transfers to unvetted third-party commercial cloud APIs. |
| **Principle of Transparency & Explainability (Ch. 2.4)** | Full version control of model weights, system prompts, scenario manifests, and statistical scripts. All evaluation code and data schemas are machine-auditable. |
| **Principle of Research Honesty & Accountability (Ch. 2.6)** | Explicit labeling of all evaluator perspectives as simulated computational roles. Zero fabrication of human clinician identities or credentials. AI outputs are framed strictly as pre-clinical decision-support research, not autonomous medical practice. |

---

## 4. Simulated Evaluator Framework & Future Human Transition Plan

### 4.1 In-Silico Computational Reviewers (Phase 1)
To ensure complete scientific reproducibility while external clinical panel funding and institutional recruitment are finalized:
* **`SIM-01` (Emergency Medicine Evaluation Persona):** Focuses on acuity, triage accuracy, and critical omissions checklist compliance.
* **`SIM-02` (Internal Medicine Evaluation Persona):** Focuses on comorbidity interaction, pharmacological safety, and diagnostic breadth.
* **`SIM-03` (Primary Care Evaluation Persona):** Focuses on risk communication, patient comprehension, and over-triage containment.
* **Hyperparameter Freezing:** All evaluations run under fixed inference configurations (e.g., temperature $\tau = 0.1$, random seed $42$) to guarantee deterministic reproduction.

### 4.2 Future Human Clinical Trial Transition (Phase 2 Roadmap)
If institutional review determines that future deployment warrants human clinical panel validation:
1. **Formal Amendment Submission:** The investigators will submit a protocol amendment to the IEC specifying human clinician recruitment criteria, compensation, and written informed consent forms.
2. **Target Human Reviewer Cohort:** Minimum 3 licensed physicians (Emergency Medicine, Internal Medicine, Family Medicine) with $\ge 2$ years post-residency experience.
3. **Workload Staging:** 12-case pilot calibration followed by four blocks of 50 blinded pairs over 4 weeks to prevent rater fatigue.
4. **Independent Adjudication:** Human consensus conferences for any pairs exhibiting rating discordance $> 1$ Likert point.

---

## 5. Risk Assessment & Participant Protection

* **Patient Risk:** **None (Zero).** No human patients are involved, treated, or observed.
* **Human Subject Risk:** **None (Zero).** Phase 1 involves no human clinician subjects or research volunteers.
* **Data Security & Privacy:** All synthetic test vignettes are held in version-controlled local repositories without exposure to unprotected public endpoints.
* **Conflict of Interest:** Investigators hold no commercial ownership of closed-source competitor clinical models.

---

## 6. Regulatory Sign-Off & Milestones

* [x] **Milestone 1:** Synthetic scenario schema v1.2.0 and 12-case pilot calibration set completed.
* [x] **Milestone 2:** Simulated expert evaluation framework (`SIM-01`, `SIM-02`, `SIM-03`) and CLMM statistical analysis plan defined.
* [ ] **Milestone 3:** Formal Faculty Sponsor endorsement and submission to Institutional Ethics Committee for Review Category Determination.
* [ ] **Milestone 4:** Execution of Study 1–4 computational benchmarks using synthetic corpora.
* [ ] **Milestone 5:** Optional Phase 2 protocol amendment submission if transition to human clinician panel is funded.

*Phase 1 computational evaluation operates strictly within synthetic parameters. No real patient data or fabricated clinician claims shall be admitted into research publications.*
