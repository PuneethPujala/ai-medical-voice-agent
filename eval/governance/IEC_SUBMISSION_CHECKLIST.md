# Institutional Ethics Committee (IEC) Submission Readiness Checklist
**Protocol Title:** Empirical Multi-Dimensional In-Silico Evaluation of a Voice-Enabled Conversational Decision-Support System for Clinical Intake and Triage  
**Protocol Short Title:** MedVoice Clinical AI Evaluation (Phase 1 In-Silico Framework & Pilot)  
**Date of Audit:** November 13, 2026  
**Governing Ethical Code:** ICMR National Ethical Guidelines (2017) & ICMR AI in Healthcare Guidelines (2023)  
**Status:** READY FOR INSTITUTIONAL SPONSOR BINDING & FORMAL FILING  

---

## 1. Executive Summary & Regulatory Classification

This checklist audits the submission readiness of the MedVoice Phase 1 evaluation protocol for an **Application for Exemption from Ethics Committee Review / Determination of Non-Human Subjects Research**.

### Ethical & Regulatory Classification
- **Primary Framework:** ICMR National Ethical Guidelines for Biomedical and Health Research Involving Human Participants (2017), **Table 4.2 and Sections 4.8.1–4.8.3** (*Review Procedures: Exemption, Expedited, and Full Committee Review*).
- **AI Domain Framework:** ICMR Ethical Guidelines for Application of Artificial Intelligence in Biomedical Research and Healthcare (2023), **Section 3** (*Ethical Review Process for AI proposals*).
- **Core Bioethics Safeguard:** 
  - **Zero Patient Enrollment:** 100% synthetic clinical vignettes. No real patient data, authentic EHR records, PII, or PHI are involved.
  - **Zero Human Clinician Burden in Phase 1:** Computational evaluation executes strictly in-silico via simulated evaluator configurations (`SIM-01`, `SIM-02`, `SIM-03`). No human clinician participants are recruited or calibrated in Phase 1.
- **Core Governance Invariant:** **Review category cannot be unilaterally declared by investigators.** Under ICMR Guidelines (Section 4.8.2–4.8.3), the determination of review category (Exemption, Expedited, or Full Committee) must be formally decided and issued by the Institutional Ethics Committee (IEC) or its Secretariat upon review of the application package.

---

## 2. Institutional Placeholder Audit (Action Required by PI)

The following placeholders in `eval/governance/IEC_STUDY_BRIEF.md` require formal binding prior to institutional dispatch:

| Location | Current Placeholder | Required Action | Responsible Party | Blocker Ref |
| :--- | :--- | :--- | :--- | :--- |
| **Line 6** | `[Faculty Advisor / Institutional Sponsor]` | Insert full legal name, academic title, and departmental affiliation of the Faculty Advisor / Research Sponsor. | Principal Investigator | `B-G2-01` |
| **Line 7** | `[Institution Name]` | Insert official name and address of the accredited host medical / research institution. | Principal Investigator | `B-G2-01` |
| **Section 5** | Institutional COI Disclosures | Confirm formal disclosure statements regarding absence of financial interest in commercial comparator models. | Principal Investigator | `B-G2-01` |

> [!IMPORTANT]
> **Anti-Fabrication Guard:** Under engineering directives and research integrity standards, these placeholders **must never be filled with speculative or synthetic institutional credentials**. They must remain explicit until the Principal Investigator provides authentic institutional affiliation details.

---

## 3. Comprehensive Submission Package Inventory

The submission dossier consists of the following version-controlled project assets:

| # | Document | File Path | Version | Verification Status |
|---|---|---|---|---|
| 1 | **Research Evaluation Protocol** | `docs/RESEARCH_EVALUATION_PROTOCOL.md` | v2.3.16 | Complete & Guideline-Grounded |
| 2 | **IEC Study Brief** | `eval/governance/IEC_STUDY_BRIEF.md` | v1.0.0 | Drafted (Placeholders Audited) |
| 3 | **Dataset Governance & Licensing Audit** | `eval/config/DATASET_GOVERNANCE.md` | v1.2.0 | Verified (All Sources Documented) |
| 4 | **Gate 0 Automated Feasibility Check** | `eval/src/governance/gate0-feasibility-check.ts` | v1.0.0 | Verified (13/13 Tests Green) |
| 5 | **Clinical Review Packet** | `docs/clinical-review-packet.md` | v2.0.0 | Complete (Urgency Tiers 1–5 & 65 Red Flags) |
| 6 | **Standardized Scoring Rubric** | `eval/data/human_eval/scoring_rubric.md` | v2.2.0 | Complete (6 Dimensions + 5 Safety Flags) |
| 7 | **Clinician Calibration SOP** | `eval/governance/CLINICIAN_CALIBRATION_SOP.md` | v1.0.0 | Drafted (Disagreement & Adjudication Rules) |
| 8 | **Methodology Specification** | `eval/governance/STUDY3_METHODOLOGY_SPECIFICATION.md` | v3.3.21 | FROZEN & Statistically Verified |

---

## 4. Institutional Submission & Review Step-by-Step Pathway

```
┌────────────────────────────────────────────────────────┐
│ Step 1: Sponsor Binding                                │
│ - PI binds [Faculty Advisor] and [Institution Name]    │
│ - Finalize Cover Letter to IEC Secretariat             │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│ Step 2: Formal Filing with IEC Secretariat             │
│ - Submit Completed Dossier (Items 1-8 above)           │
│ - Request Form: ICMR Exemption Determination           │
│ - Obtain Formal Filing Receipt / Reference Number      │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│ Step 3: Administrative / Secretariat Review            │
│ - IEC Secretariat reviews protocol under ICMR 2017     │
│   Table 4.2 / Section 4.8 & ICMR AI 2023 Section 3     │
│ - Verifies 100% synthetic in-silico nature             │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│ Step 4: Issuance of Determination Letter               │
│ - IEC issues Formal Exemption Certificate OR           │
│   Full/Expedited Committee Review Request              │
│ - Archive Determination Letter in repo                 │
│   (eval/governance/evidence/iec_determination.pdf)     │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│ Step 5: Unblock Gate 2                                 │
│ - Update GATE_READINESS_AUDIT.md: Gate 2 -> UNBLOCKED  │
│ - Authorize progression toward Gate 4 unblinding       │
└────────────────────────────────────────────────────────┘
```

---

## 5. Formal Post-Filing Tracking Record Template

*(To be completed by the Principal Investigator upon institutional submission)*

```markdown
### IEC Filing Tracking Record
- **Target Ethics Committee:** _____________________________________________
- **Institutional Reference Number:** _______________________________________
- **Date of Submission:** _________________________________________________
- **Submission Mode:** [ ] Physical Hardcopy  [ ] Institutional Portal  [ ] Email
- **Assigned Review Category:** [ ] Exemption Determination  [ ] Expedited  [ ] Full Board
- **Date of Acknowledgment Receipt:** _____________________________________
- **IEC Decision:** [ ] Exemption Granted  [ ] Minor Revisions  [ ] Full Review Required
- **Decision Date:** ______________________________________________________
- **Archived Certificate Path:** `eval/governance/evidence/IEC_DETERMINATION_LETTER.pdf`
```

---

## 6. Regulatory Risk Analysis & ICMR Compliance Summary

| Evaluation Area | Risk Level | Mitigation & Compliance Safeguards |
| :--- | :---: | :--- |
| **Patient Harm** | **None (Zero)** | Zero real patients are treated, advised, or observed. System operates purely in-silico. |
| **Data Privacy & PII** | **None (Zero)** | 100% synthetic vignettes. `PhiScrubber` sanitization eliminates synthetic resemblance to real individuals. |
| **Commercial Exploitation** | **None (Zero)** | Research is conducted under open CC BY 4.0 license for academic evaluation. |
| **Research Integrity** | **High Assurance** | All evaluator perspectives are explicitly labeled as AI simulations (`SIM-01` through `SIM-03`). Zero fabricated clinician credentials. |
