# MedVoice Research Evaluation Framework: Dataset Governance & Provenance Specification

**Document Version:** 2.0.0 (Phase 1 Research Authorization)
**Effective Date:** November 2, 2026
**Auditor / Custodian:** MedVoice Clinical Research & Governance Working Group
**Target Studies:** Study 1 (Response Quality), Study 2 (Emergency Safety), Study 3 (Clinician Review), Study 4 (Operational Resilience)
**Applicability:** Evaluation Harness (`eval/`), Scenario Data Stores (`eval/data/`), and Associated Research Protocols

---

## 1. Executive Summary & Authoritative Resource Decisions

This document establishes the binding data governance, intellectual property, and research ethics policy for the MedVoice Research Evaluation Program.

In accordance with Phase 1 Research Authorization, MedVoice strictly prohibits scraping unverified online forums or treating broad health-topic consumer summaries as authentic patient consultations. The data strategy prioritizes **clinician-authored, guideline-grounded synthetic clinical scenarios** as the primary scientific foundation, reserving external public corpora for supporting or decoupled secondary benchmarks under verifiable terms.

### 1.1 Authoritative Resource Decision Matrix

| Resource / Corpus | Formal Decision | Authorized Role in Research | Governance & Licensing Rationale |
| :--- | :---: | :--- | :--- |
| **Clinician-Authored Synthetic Scenarios** | **PRIMARY** | Primary benchmark for **Study 1** (Clinical Quality) and **Study 2** (Safety & Escalation) | Fully controlled provenance, zero PHI/PII risk, grounded in established clinical practice guidelines (AHA/ACC, NICE, GOLD, IDSA). Eliminates legal ambiguity and forum-scraper noise. |
| **MedlinePlus Consumer Health Summaries** | **SUPPORTING** | Topic coverage validation, lay-terminology reference, patient-friendly phrasing check | U.S. National Library of Medicine (NLM). Health-topic summaries are public domain, but linked third-party assets are copyrighted. Requires item-level citation, retrieval date, and license checks. |
| **PubMedQA** | **OPTIONAL (DECOUPLED)** | Separate biomedical QA benchmark only; **never** combined into conversational intake | Biomedical question-answering on PubMed abstracts. Does not model conversational clinical triage or patient-doctor intake dynamics. |
| **MedDialog (UCSD & Repackaged)** | **HOLD (EXCLUDED)** | **Strictly excluded** from all active benchmarks | Underlying conversations originate from commercial telemedicine platforms with ambiguous terms of service and unverified chain of title. Excluded until explicit rights are established. |
| **MIMIC-IV / PhysioNet Corpora** | **DEFERRED (PHASE 2+)** | Deferred pending institutional sponsorship and formal DUA | PhysioNet credentialing requires institutional supervisor sign-off, CITI human-subjects training, and strict Data Use Agreement (DUA). Passing restricted data to external LLM APIs violates PhysioNet terms. |

---

## 2. Standardized Provenance Classification System

To maintain absolute transparency in peer review, every scenario and record within the MedVoice evaluation repository must carry an immutable provenance classification from one of four mutually exclusive categories:

```
                                  +---------------------------------------+
                                  |     Scenario Provenance Hierarchy     |
                                  +-------------------+-------------------+
                                                      |
         +----------------------------+---------------+---------------+----------------------------+
         |                            |                               |                            |
         v                            v                               v                            v
+------------------+         +------------------+            +------------------+         +------------------+
| synthetic_authored |       | synthetic_derived |           |  public_dataset  |         | real_deidentified|
|------------------|         |------------------|            |------------------|         |------------------|
| Authored directly|         | Grounded in      |            | Sourced from an  |         | Real patient     |
| by clinical team |         | MedlinePlus /    |            | established, open|         | records with IEC |
| to test specific |         | clinical practice|            | licensed corpus  |         | approval & DUA   |
| red flags/safety.|         | guidelines.      |            | (e.g. PubMedQA). |         | (MIMIC - on hold)|
+------------------+         +------------------+            +------------------+         +------------------+
```

### 2.1 Category Definitions & Invariants

1. **`synthetic_authored`**:
   - *Definition:* Clinical scenarios, patient utterances, and expected physician responses drafted for this evaluation.
   - *Authorship Subtypes:* Must explicitly distinguish between `clinician_authored` (authored directly by a licensed medical practitioner) and `ai_assisted_draft` / `researcher_authored` (drafted by biomedical informatics researchers or LLM assistance).
   - *Review Status:* Must remain explicitly marked `review_status: pending_clinical_review` until an independent licensed clinician formally evaluates and signs off on the vignette.
   - *Guideline Citation Rule:* Citing a published clinical guideline does **NOT** constitute clinical validation. Guideline references indicate the clinical evidence base used to construct the case, but the scenario remains an unverified draft until clinician review is complete.
   - *Governance Rule:* **Never mark as `deidentification_verified`.** Synthetic scenarios never contained human participant data; asserting "de-identification" on synthetic text is scientifically invalid and misleading.
   - *Required Metadata:* `authorship_type`, `author`, `clinical_reviewer`, `review_status`, `clinical_guideline` (issuing organization, year, section, jurisdiction).

2. **`synthetic_derived`**:
   - *Definition:* Scenarios adapted from documented public reference materials (e.g., MedlinePlus clinical topic briefs, CDC triage vignettes, clinical case reports).
   - *Governance Rule:* Must document exact upstream reference URL, specific content element adapted, retrieval timestamp, transformation notes (e.g., conversion of declarative symptom lists into conversational patient dialogue), and verifying clinician.
   - *Required Metadata:* `source_url`, `source_license`, `retrieval_date`, `transformation_notes`, `verifying_clinician_id`.

3. **`public_dataset`**:
   - *Definition:* Records drawn directly from open, licensed scientific datasets where redistribution and research reuse are explicitly permitted.
   - *Governance Rule:* Must cite the upstream DOI, license type, and confirm that the dataset does not contain conversational patient consultation text with disputed commercial copyright.

4. **`real_deidentified`**:
   - *Definition:* Authentic human clinical encounter records or notes.
   - *Governance Rule:* **Zero usage in Phase 1.** Requires active institutional sponsorship, formal IEC protocol approval, data transfer agreements, and verified HIPAA/ICMR de-identification auditing prior to ingestion.

---

## 3. Item-Level Provenance Schema

Every scenario in the versioned benchmark must satisfy the following machine-readable metadata schema:

```json
{
  "scenario_id": "MEDVOICE-PILOT-001",
  "provenance": {
    "provenance_type": "synthetic_authored",
    "source_reference": "2020 AHA/ACC Guideline for the Management of Patients With Non-ST-Elevation Acute Coronary Syndromes",
    "source_url": null,
    "license_basis": "MedVoice Research Consortium Internal Copyright (CC BY 4.0)",
    "attribution": "MedVoice Clinical Advisory Working Group",
    "retrieval_date": "2026-11-02",
    "transformations": "Original conversational dialogue written to reflect typical female atypical ACS presentation with associated autonomic symptoms",
    "author": "Dr. Sarah Chen, MD (Cardiology / Internal Medicine)",
    "clinical_reviewer": "Dr. Marcus Vance, MD (Emergency Medicine)",
    "review_status": "clinician_verified",
    "schema_version": "1.0.0"
  }
}
```

---

## 4. Indian National Ethics Framework (ICMR 2017 & 2023 Compliance)

Although Phase 1 utilizes synthetic scenarios, MedVoice formally aligns with the national regulatory and bioethics standards of India to ensure full readiness for subsequent human clinician review and prospective institutional trials.

### 4.1 ICMR Ethical Guidelines for AI in Biomedical Research and Healthcare (2023)
The evaluation protocol specifically adheres to the core ethical principles stipulated in Chapter 2 of the ICMR 2023 AI Guidelines:
1. **Principle of Autonomy and Data Privacy (Section 2.1):** No personal identifiable data from real patients is ingested into local or external models without verified statutory consent or IEC waiver.
2. **Principle of Safety and Risk Minimization (Section 2.2):** Explicit evaluation of under-triage and critical omission rates to detect algorithm-induced harm before any clinical piloting.
3. **Principle of Transparency and Explainability (Section 2.4):** Transparent reporting of all benchmark architectures, model weights, random seeds, and exact provenance of reference responses.
4. **Principle of Accountability and Human Oversight (Section 2.6):** Clinician-in-the-loop oversight throughout; AI outputs are evaluated strictly as clinical decision-support proposals, never autonomous prescriptions.

### 4.2 Institutional Ethics Committee (IEC) Determination Workflow
- **No Investigator Self-Exemption:** In accordance with ICMR 2017 (Section 5), investigators shall not unilaterally declare studies exempt from ethics review.
- **Submission Requirement:** A concise Study Brief (`eval/governance/IEC_STUDY_BRIEF.md`) must be submitted to the institutional IEC or research office to obtain a formal **Determination of Exemption or Expedited Review** prior to engaging recruited human clinicians for Study 3 scoring.

---

## 5. Summary of Prohibitions & Hard Gates

1. **NO SCRAPED TELEMEDICINE FORUMS:** MedDialog, HealthCareMagic, and unverified WebMD scrapers are strictly blocked from active benchmark execution.
2. **NO UNVERIFIED PUBLIC DOMAIN CLAIMS:** MedlinePlus content must not be assigned a blanket public-domain status without verifying that linked diagrams, third-party tables, and external references are free of copyright restrictions.
3. **NO REAL PATIENT IDENTIFIERS:** Real medical record numbers, dates of birth, clinician identities, or geographic hospital identifiers must never enter the evaluation repository.
4. **NO CLAIMS OF CLINICAL EFFICACY:** Synthetic benchmark evaluations shall be reported solely as controlled software-engineering and pre-clinical decision-support evaluations, not clinical proof of safety in real-world patient care.
