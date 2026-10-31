# MedVoice Clinical Response Evaluation Framework: Gate 0 Data Feasibility, Licensing, Provenance & Research Ethics Audit

**Document Version:** 1.0.0  
**Effective Date:** October 31, 2026  
**Auditor:** Data Governance & Research Ethics Auditor, MedVoice Research Board  
**Target Milestone:** Gate 0 (Data Feasibility, Licensing, Provenance & Ethics Verification)  
**Applicability:** MedVoice Production Conversational Runtime (`/api/voice/chat`), Evaluation Pipeline (`eval/`), and Associated Research Artifacts  

---

## 1. Executive Summary & Board Directives

The MedVoice Clinical Response Evaluation Framework is designed to empirically evaluate the clinical, semantic, and safety alignment of the MedVoice conversational decision-support runtime against authentic clinical interactions and rigorous safety challenge sets. 

Prior informal evaluation plans contained several severe legal, ethical, and regulatory vulnerabilities:
1. **MTSamples Licensing Error:** Inaccurately presumed MTSamples to be a Creative Commons Zero (CC0) public domain dataset based on unverified third-party scraper uploads.
2. **HealthCareMagic & MedDialog Provenance Confusion:** Failed to track the upstream legal chain of title, confusing academic redistribution wrappers (e.g., ChatDoctor, OpenMed) with original proprietary teleconsultation terms of service.
3. **Regulatory Jurisdiction Mismatch:** Erroneously cited United States HHS Common Rule (45 CFR § 46.104(d)(4)) as an automatic justification for secondary data research exemptions, ignoring the applicable Indian regulatory, research ethics, and personal data protection frameworks.
4. **Self-Exemption Presumption:** Presumed researchers could unilaterally declare an "exempt" status for secondary use of patient consultation dialogues.

By formal directive of the MedVoice Research Board, this document executes **Gate 0**, instituting:
- **Binding Legal & Provenance Registry:** Comprehensive legal analysis and classification of all prospective data sources into `APPROVED`, `CONDITIONALLY_APPROVED`, or `BLOCKED`.
- **Indian National Ethics Alignment:** Grounding in the **ICMR National Ethical Guidelines for Biomedical and Health Research Involving Human Participants (2017)** and the **ICMR Ethical Guidelines for Application of Artificial Intelligence in Biomedical Research and Healthcare (2023)**.
- **Mandatory Institutional Ethics Committee (IEC) Protocol:** Prohibition of investigator self-exemption; formal submission and review workflows.
- **Programmatic Hard Gate Enforcement:** Code-level barrier (`eval/src/governance/gate0-feasibility-check.ts`) that throws a terminating exception if any unverified or conditionally approved dataset is accessed for ingestion before formal sign-off.
- **Staged Progression**: Full authorization of internally authored, synthetic clinical benchmark fixtures (`gate0_cleared: true`) for Stage 1 engineering and unit testing, while holding external clinical corpora in check (`gate0_cleared: false`) pending formal DUA execution and IEC review.

---

## 2. Research Ethics Framework (Indian Regulatory & Institutional Compliance)

### 2.1 Rejection of Extraterritorial Self-Exemption (45 CFR § 46.104)

Previous drafts cited US 45 CFR § 46.104(d)(4) (secondary research on identifiable private information/biospecimens) to assert regulatory exemption. This assumption is formally rejected on two grounds:
1. **Jurisdictional Relevance:** MedVoice research and development, clinical advisory boards, and institutional deployments are subject to Indian health research regulations and international data transfer restrictions.
2. **Prohibition of Self-Determination:** Even within US Common Rule jurisdictions, investigators are not legally empowered to make unilateral self-exemption determinations; an Institutional Review Board (IRB) or designated institutional official must make that determination.

### 2.2 ICMR National Ethical Guidelines for Biomedical and Health Research (2017)

All research activities involving retrospective clinical dialogue, patient narratives, or transcriptions must adhere strictly to the **ICMR National Ethical Guidelines for Biomedical and Health Research Involving Human Participants (2017)**, with particular attention to:

#### Section 5: Informed Consent and Waiver Provisions (Sections 5.3 & 5.4)
- **Principle:** Research on human participants, including secondary use of identifiable or de-identified health data, requires informed consent unless a formal **Waiver of Informed Consent** is granted.
- **Prohibition of Self-Exemption:** *Under no circumstances may an investigator self-declare an exemption or waiver.* Only a duly constituted and accredited **Institutional Ethics Committee (IEC)** possesses the statutory authority to grant a waiver of consent.
- **Criteria for IEC Waiver of Consent:**
  1. The research involves no more than minimal risk to participants.
  2. The waiver will not adversely affect the rights, safety, and welfare of the participants.
  3. The research could not practicably be carried out without the waiver (e.g., retrospective analysis of historical, anonymized public forum consultations).
  4. Appropriate de-identification safeguards are in place to ensure confidentiality.

#### Section 11 & Chapter IV: Secondary Use of Data and Biological Specimens
- **Data Governance:** Secondary use of archived or public datasets must respect original consent boundaries. When datasets originate from commercial telemedicine or teleconsultation portals, investigators must verify whether users provided broad consent for research or whether data was extracted without explicit subject agreement.
- **Storage and Access Safeguards:** All raw secondary health data must be segregated, access-controlled, encrypted at rest, and excluded from version-controlled public code repositories.

### 2.3 ICMR Ethical Guidelines for Application of AI in Biomedical Research and Healthcare (2023)

In accordance with the 2023 ICMR AI guidelines, the MedVoice evaluation harness must satisfy five core ethical pillars:

1. **Principle of Autonomy and Data Privacy (Section 3.1 & 3.4):**
   - Protection against re-identification through mosaic effects (linking symptom complaints with local temporal or regional markers).
   - Strict application of automated and manual de-identification layers before any clinical narrative is ingested into prompt contexts or evaluation matrices.
2. **Principle of Safety, Non-Maleficence & Risk Minimization (Section 3.2):**
   - Retrospective dialogues from online platforms frequently feature unsupervised, inconsistent, or clinically flawed physician replies. They are designated as **reference responses**, not infallible ground truths.
   - Dual-arbiter safety preemption: The system must enforce deterministic emergency floor recognition (Track B) regardless of statistical semantic similarity scores (Track A).
3. **Principle of Transparency & Explainability (Section 3.5):**
   - Complete algorithmic provenance: Every evaluated turn must preserve an immutable SHA-256 digest linking input query, baseline reference, and evaluated runtime parameters.
4. **Principle of Data Governance & Custody (Section 4):**
   - AI training and evaluation datasets must maintain a verifiable chain of custody, documenting origin, ownership, license constraints, and preprocessing transformations.
5. **Principle of Bias Mitigation & Demographic Representation (Section 3.6):**
   - Evaluation datasets must avoid demographic or domain-specific skew that harms underrepresented clinical cohorts.

### 2.4 Digital Personal Data Protection Act (DPDPA), 2023

Under the Indian **Digital Personal Data Protection Act (DPDPA), 2023**:
- Personal data includes any data about an individual who is identifiable by or in relation to such data.
- Processing of health-related data requires compliance with purpose limitation, storage limitation, and reasonable security safeguards (§ 8).
- De-identified data that presents zero re-identification risk falls outside the strict ambit of personal data, but investigators must establish technical guarantees that re-identification is mathematically infeasible.

### 2.5 Institutional Ethics Committee (IEC) Submission & Review Protocol

Before any external corpus of clinical dialogues (HealthCareMagic, MedDialog, MTSamples) is ingested into the evaluation pipeline, the study team must execute the following protocol:

```
+-------------------------------------------------------------------------------+
|                        IEC SUBMISSION & REVIEW WORKFLOW                       |
+-------------------------------------------------------------------------------+
                                        |
                                        v
                 +-----------------------------------------------+
                 | Phase 1: Dossier Preparation                  |
                 | - Research Protocol (SPEC-2026-10-30)         |
                 | - Dataset Governance Audit (This Document)     |
                 | - De-Identification Verification Protocol    |
                 | - Data Security & Storage Architecture        |
                 | - Formal Waiver of Informed Consent Request   |
                 +-----------------------+-----------------------+
                                         |
                                         v
                 +-----------------------------------------------+
                 | Phase 2: Formal Submission to Accredited IEC  |
                 | - Submitted to Institutional Ethics Committee |
                 | - Primary Review: Minimal Risk Assessment     |
                 +-----------------------+-----------------------+
                                         |
                        +----------------+----------------+
                        |                                 |
                        v                                 v
          [Full Review Required]                [Expedited Review / Waiver]
          - Vulnerable populations               - De-identified secondary data
          - High risk re-identification          - Retrospective public dialogues
                        |                                 |
                        +----------------+----------------+
                                         |
                                         v
                 +-----------------------------------------------+
                 | Phase 3: IEC Determination & Letter of Action |
                 | - Formal Letter of Approval (LOA)             |
                 | - Explicit Waiver of Consent Issued           |
                 +-----------------------+-----------------------+
                                         |
                                         v
                 +-----------------------------------------------+
                 | Phase 4: Gate 0 Clearing Mutation             |
                 | - Update eval-config.json (gate0_cleared=true)|
                 | - Record IEC Approval Number & Expiry Date    |
                 | - Unlock programmatic ingestion validator     |
                 +-----------------------------------------------+
```

---

## 3. Comprehensive Dataset Licensing & Provenance Audit

```
+----------------------------------------------------------------------------------------------------+
|                                    PROVENANCE CHAIN SUMMARY                                        |
+----------------------------------------------------------------------------------------------------+

1. MTSAMPLES:
   Medical Transcriptionist -> MTSamples.com (Educational/Terms) -> Unofficial Kaggle Dump (Falsely Claimed CC0)
   STATUS: CONDITIONALLY APPROVED (GATE 0: NOT CLEARED - REQUIRES DUA)

2. HEALTHCAREMAGIC-100K:
   Patient/Doctor -> healthcaremagic.com (Proprietary ToS) -> ChatDoctor Scraper (Kent0n-Li / Apache-2.0 claim)
   STATUS: CONDITIONALLY APPROVED (GATE 0: NOT CLEARED - REQUIRES IEC APPROVAL & DE-IDENTIFICATION)

3. MEDDIALOG (ORIGINAL UCSD):
   Patient/Doctor -> HealthCareMagic & iCliniq -> UCSD-AI4H (Research Only, Copyright with Sources)
   STATUS: CONDITIONALLY APPROVED (GATE 0: NOT CLEARED - RESEARCH RESTRICTED)

4. MEDDIALOG (REPACKAGED / OPENMED):
   UCSD-AI4H -> Third-Party Aggregators (OpenMed / HF) -> Unsubstantiated Apache-2.0 / MIT Claims
   STATUS: BLOCKED (GATE 0: NOT CLEARED - UNVERIFIED COPYRIGHT TRANSFER)

5. MEDVOICE SYNTHETIC FIXTURES:
   MedVoice Clinical Team -> Curated Test Cases & Golden Dialogues -> Internal Version Control
   STATUS: APPROVED (GATE 0: CLEARED - STAGE 1 ENGINEERING & UNIT BENCHMARKS)

6. MEDLINEPLUS XML:
   National Library of Medicine (NLM) -> Official US Gov Release -> Public Domain (US)
   STATUS: APPROVED (GATE 0: CLEARED FOR RAG RETRIEVAL REFERENCE)
+----------------------------------------------------------------------------------------------------+
```

### 3.1 MTSamples (Medical Transcription Samples)

- **Source URL:** https://www.mtsamples.com/
- **Common Public Misconception:** Often cataloged on Kaggle (e.g., `tboyle10/medicaltranscriptions`) and GitHub as "CC0: Public Domain".
- **Legal Investigation of Actual Terms:**
  - MTSamples.com website terms of use state explicitly:
    > "The medical transcription samples on this site are provided for educational and illustrative purposes only... The contents of this site, including text, graphics, images, and other material are protected by copyright under both United States and foreign laws."
  - The terms allow individual browsing and educational reference with attribution.
  - Systematic extraction, bulk scraping, commercial redistribution, and corpus-scale ingestion for model training or benchmarking are **not** licensed under Creative Commons Zero.
- **Provenance Chain:**
  1. Primary Origin: Anonymous medical transcriptionists uploading illustrative clinical notes to MTSamples.com.
  2. Intermediate Aggregator: MTSamples.com web portal under proprietary educational copyright.
  3. Secondary Scraper: Unofficial third-party scrapers creating unauthorized Kaggle archives falsely asserting CC0.
- **Risk Assessment:** High legal copyright risk if ingested at scale without direct permission. Zero patient re-identification risk (synthetic/curated illustrative transcripts).
- **Ingestion Condition:** Corpus-scale ingestion requires an executed written Data Use Agreement (DUA) or written permission from MTSamples administrators.
- **Gate 0 Decision:** **CONDITIONALLY APPROVED / PENDING DUA (GATE 0: NOT CLEARED)**. Access blocked by runtime validator until written authorization is on file.

### 3.2 HealthCareMagic-100k / ChatDoctor Release

- **Source URL:** https://github.com/Kent0n-Li/ChatDoctor
- **Paper Citation:** Yunxiang Li et al., "ChatDoctor: A Medical Large Language Model Fine-Tuned on Human-Doctor Conversations," *arXiv:2303.14070*, 2023.
- **Dataset Description:** Approximately 112,000 doctor-patient dialogue turns scraped from healthcaremagic.com (filtered to ~100k in clean releases).
- **Upstream Platform Terms:**
  - HealthCareMagic.com (subsidiary of MediBuddy / RapiData) operates a proprietary teleconsultation marketplace.
  - Upstream Terms of Service stipulate that consultations, questions, and responses submitted to the service become proprietary content or grant exclusive operating licenses to the platform.
- **Redistribution Terms & Research Conditions:**
  - The ChatDoctor authors released the dataset on Hugging Face / GitHub stating it is intended for academic research only and applied an Apache-2.0 or CC-BY-NC-SA 4.0 license tag to their code/filtering scripts.
  - However, downstream academic researchers do not acquire upstream copyright ownership merely by scraping or filtering.
  - The dataset is strictly restricted to **non-commercial academic research**.
- **Privacy & De-Identification Status:**
  - HealthCareMagic queries were written by actual patients online. While names are frequently omitted, free-text queries may contain indirect identifiers (e.g., specific dates, unique occupational exposures, rare comorbidities, geographic references).
- **Ingestion Condition:**
  1. IEC submission and formal approval/waiver of consent.
  2. Secondary de-identification pass through `PhiScrubber` prior to dataset manifest generation.
  3. Strict isolation within non-commercial research infrastructure.
- **Gate 0 Decision:** **CONDITIONALLY APPROVED (GATE 0: NOT CLEARED)**. Ingestion permitted only after IEC approval.

### 3.3 MedDialog (Original Distribution vs. Repackaged Variants)

- **Original Distribution:**
  - **Source URL:** https://github.com/UCSD-AI4H/Medical-Dialogue-System
  - **Paper Citation:** Guangtao Zeng, Shen Gao, et al., "MedDialog: a Large-scale Medical Dialogue Dataset," *arXiv:2004.03329*, 2020.
  - **Composition:** ~226k dialogues from HealthCareMagic, ~310k from iCliniq (English); ~792k from Haodf (Chinese).
  - **Original Terms:** The UCSD-AI4H team explicitly notes on their repository:
    > "The copyright of the data remains with the original websites (HealthCareMagic, iCliniq, Haodf). The data is released for research purposes only."
- **Repackaged Distributions (e.g., OpenMed, Hugging Face community mirrors):**
  - Various Hugging Face mirrors (`bigbio/med_dialog`, `openmed/meddialog-curated`) advertise the dataset under permissive labels such as MIT or Apache-2.0.
  - **Legal Finding:** Repackaged mirrors cannot grant rights broader than the upstream licensor. An MIT/Apache-2.0 tag applied by a third-party aggregator is legally void with respect to the underlying patient and physician intellectual property.
- **Gate 0 Decision:**
  - `meddialog_original`: **CONDITIONALLY APPROVED (GATE 0: NOT CLEARED)** (Subject to non-commercial academic research use and IEC waiver).
  - `meddialog_repackaged`: **BLOCKED (GATE 0: NOT CLEARED)** (Tainted chain of custody; usage prohibited in MedVoice pipelines).

### 3.4 MedVoice Synthetic Clinical Benchmark Fixtures

- **Source:** Internally authored clinical cases (`tests/clinical-eval/cases.json`, `tests/fixtures/`, `tests/adversarial-red-flags.ts`).
- **Authorship:** MedVoice Engineering & Clinical Advisory Team.
- **Characteristics:**
  - Fully synthetic, expert-crafted clinical vignettes and dialogue turns.
  - Zero human subjects; zero protected health information (PHI); zero scraped content.
  - Designed specifically for deterministic unit tests, emergency floor verification, and regression prevention.
- **Licensing:** Proprietary Internal Research Artifact / Permissive internal evaluation license.
- **Gate 0 Decision:** **APPROVED (GATE 0: CLEARED)**. Permitted immediately for Stage 1 engineering, continuous integration, and pipeline validation.

### 3.5 MedlinePlus Clinical Summaries

- **Source URL:** https://medlineplus.gov/xml.html
- **Distributor:** U.S. National Library of Medicine (NLM), National Institutes of Health.
- **Licensing:** U.S. Government Work; public domain in the United States. NLM provides unrestricted educational and scientific access with standard attribution guidelines.
- **Role in MedVoice:** Reference knowledge base for deterministic clinical RAG (`lib/clinical-rag/`).
- **Gate 0 Decision:** **APPROVED (GATE 0: CLEARED)** for knowledge retrieval reference.

---

## 4. Master Dataset Governance Registry

The following table constitutes the official, binding Gate 0 status for all evaluation and research data sources:

| Dataset ID | Name & Version | Upstream Source URL | Listed License | Actual Legal Status | Provenance Integrity | IEC Approval Status | Gate 0 Status | Authorized Operations |
|---|---|---|---|---|---|---|---|---|
| `medvoice_synthetic_fixtures` | MedVoice Synthetic Suite v1.0 | Internal `tests/fixtures/` | Internal Research | Fully Controlled Internal IP | Direct (Internally Authored) | Exempt (Non-Human Subjects) | **CLEARED** | Unit Tests, Stage 1 Engineering, CI Verification |
| `medlineplus_xml` | MedlinePlus Reference 2026 | https://medlineplus.gov/ | Public Domain (US) | US Gov Public Domain | Direct (NLM Official Distribution) | Exempt (Public Clinical Facts) | **CLEARED** | RAG Knowledge Retrieval |
| `mtsamples` | MTSamples Corpus v1.0 | https://www.mtsamples.com/ | Falsely Listed as CC0 | Proprietary Educational Copyright | Broken (Scraped Mirror) | Pending Institutional Review | **NOT CLEARED** | BLOCKED until Written DUA Executed |
| `healthcaremagic_100k` | ChatDoctor-HealthCareMagic v1 | https://github.com/Kent0n-Li/ChatDoctor | Apache-2.0 (Wrapper) | Proprietary Web ToS (Research Only) | Attributed Academic Scrape | Pending IEC Protocol Submission | **NOT CLEARED** | BLOCKED until Formal IEC Waiver Granted |
| `meddialog_original` | MedDialog UCSD Release v1 | https://github.com/UCSD-AI4H | Research Use Only | Upstream Web Copyright Retained | Attributed Academic Scrape | Pending IEC Protocol Submission | **NOT CLEARED** | BLOCKED until Formal IEC Waiver Granted |
| `meddialog_repackaged` | OpenMed / HF Mirror | Various Hugging Face repos | Permissive (MIT/Apache) | Legally Invalid Redistribution | Tainted / Derivative | Unreviewable | **BLOCKED** | PERMANENTLY BLOCKED from MedVoice Pipeline |
| `mimic_iv_notes` | PhysioNet MIMIC-IV-Note v2.2 | https://physionet.org/ | PhysioNet Credentialed DUA | Restricted Credentialed Health Data | Verified Clinical Hospital Records | Requires CITI + PhysioNet DUA | **BLOCKED** | BLOCKED until Credentialing Completed |

---

## 5. De-Identification & Technical Safeguards Standard

To comply with ICMR (2023) Section 3.4 and international privacy best practices, MedVoice implements a defense-in-depth sanitization protocol:

### 5.1 Safe Harbor Standard (18 HIPAA Identifiers + Indian Telemedicine Context)
All prospective dialogue entries must be scrubbed of:
1. Names of patients, relatives, and healthcare providers.
2. All geographic subdivisions smaller than a state (city, town, district, pin code).
3. All elements of dates (except year) for dates directly related to an individual.
4. Telephone and mobile numbers.
5. Fax numbers.
6. Email addresses.
7. Social Security / Aadhaar / National ID / Driving License numbers.
8. Medical record numbers / Hospital Registration numbers.
9. Health plan beneficiary numbers.
10. Account numbers.
11. Certificate / license numbers.
12. Vehicle identifiers and serial numbers, including license plate numbers.
13. Device identifiers and serial numbers.
14. Web Universal Resource Locators (URLs).
15. Internet Protocol (IP) address numbers.
16. Biometric identifiers, including finger and voice prints.
17. Full face photographic images and any comparable images.
18. Any other unique identifying number, characteristic, or code.

### 5.2 Technical Sanitization Architecture
1. **Automated Zero-Trust Scrubber (`PhiScrubber`):** Regex-driven boundary detection across telephone numbers, emails, identification tokens, and dates.
2. **Context-Aware Named Entity Recognition (NER):** High-sensitivity masking of clinician names, clinic titles, and local landmarks.
3. **Cryptographic One-Way Salting:** Replaced identifiers receive a deterministic HMAC-SHA256 pseudonym keyed with an ephemeral audit secret that is never committed to source control.

### 5.3 Git Containment Policy
To prevent accidental disclosure of raw dialogues, unscrubbed clinical text, or reviewer identity mappings:
- The `.gitignore` configuration must strictly exclude:
  - `eval/data/raw/`
  - `data/raw/`
  - `data/raw-datasets/`
  - `*.raw.json`
  - `*.raw.csv`
  - `*review-mapping*.json`
  - `*secret*`
  - `*phi*`
  - `*identifiable*`

---

## 6. Programmatic Gating Architecture (Gate 0 Validator)

The gatekeeper module `eval/src/governance/gate0-feasibility-check.ts` enforces these policies at compile-time and runtime:
- **Hard Runtime Exception:** Any call attempting to load or process a dataset where `gate0_cleared === false` immediately throws a `Gate0FeasibilityError` with full legal remediation instructions.
- **Stage 1 Engineering Authorization:** Only datasets with `status === "APPROVED"` and `gate0_cleared === true` (specifically `medvoice_synthetic_fixtures` and `medlineplus_xml`) are allowed to pass.
- **Repository Integrity Audit:** Automated tests verify that `.gitignore` actively isolates raw data directories and secret mapping files.

---

## 7. Sign-Off & Governance Audit Summary

- **Audit Status:** GATE 0 AUDIT COMPLETED.
- **Production Directives:**
  1. Synthetic benchmark fixtures are CLEARED for immediate Stage 1 engineering.
  2. External retrospective corpora (MTSamples, HealthCareMagic, MedDialog) remain LOCKED in Gate 0 pending written DUA and IEC protocol approvals.
  3. Repackaged/tainted datasets (e.g. OpenMed mirrors) are PERMANENTLY BLOCKED.
- **Next Required Action:** Submit formal research protocol and waiver of consent application to the Institutional Ethics Committee.
