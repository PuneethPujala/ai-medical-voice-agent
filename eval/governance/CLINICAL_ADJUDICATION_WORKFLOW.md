# MedVoice AI: Clinical Equivalence Adjudication Protocol & Workflow

**Protocol Identifier**: `MEDVOICE-EVAL-SOP-004-v1.0`  
**Governing Standard**: IEC / Clinical Research Adjudication Framework for Pre-Hospital Decision Support  
**Scope**: Verification of synthetic candidate paraphrases (Track B, $N=145$) derived from the 29 canonical emergency scenarios.

---

## 1. Rationale & Governance Invariant

In natural language robustness evaluation, synthetically generated paraphrases must not be automatically assumed to represent faithful clinical equivalents of their parent presentations without explicit clinical adjudication. 

To maintain scientific integrity:
1. All newly generated candidate paraphrases default to `adjudicationStatus: "PENDING"`, `reviewed: false`.
2. Candidates may only transition to `ACCEPTED`, `REVISE`, or `REJECTED` following independent clinical review by qualified emergency medical reviewers.
3. Benchmarks conducted prior to independent clinical sign-off must be transparently designated as **"Exploratory Evaluations on Candidate Paraphrases"** rather than "Clinically Validated Benchmarks".

---

## 2. Structured Adjudication Criteria

Each candidate paraphrase must be reviewed against four mandatory criteria:

### Criterion 1: Parent Condition Preservation (`parentConditionPreserved`)
- *Objective*: Does the patient's utterance represent the exact pathophysiological condition defined by the parent scenario?
- *Rule*: Any condition drift (e.g., describing aortic dissection symptoms for a pulmonary embolism scenario, or anaphylaxis for a COPD scenario) results in immediate `REJECTED` or `REVISE`.

### Criterion 2: Critical Features Preservation (`criticalFeaturesPreserved`)
- *Objective*: Are the essential diagnostic red flags present in the colloquial description?
- *Examples*:
  - *Acute Stroke*: Sudden focal neurological deficit (dysarthria, facial asymmetry, unilateral weakness).
  - *Pulmonary Embolism*: Acute pleuritic chest pain with dyspnea, hemoptysis, or unilateral leg edema.
  - *Pediatric Croup*: Stridor, barking cough, and respiratory retractions at rest.

### Criterion 3: Absence of Material Contradictions (`materialContradictions`)
- *Objective*: Does the utterance introduce contradictory statements that clinically negate the emergency?
- *Examples of Contradictions*: Claiming the pain resolved hours ago, attributing symptoms to another person, or explicitly denying severity.

### Criterion 4: Plausible Pre-Hospital Patient Language
- *Objective*: Is the utterance representative of real-world patient or caregiver vocabulary (slang, metaphors, non-medical vernacular) rather than clinical jargon?

---

## 3. Adjudication Status Definitions

| Status | Description | Action Required |
|---|---|---|
| `PENDING` | Default status upon synthetic generation. Unreviewed by independent clinician. | Awaiting clinical review queue. |
| `ACCEPTED` | Reviewed and confirmed to satisfy all 4 criteria with 0 material contradictions. | Approved for formal benchmark reporting. |
| `REVISE` | Minor clinical ambiguity or imprecise phrasing that can be resolved with minor editing. | Returned to research team for revision. |
| `REJECTED` | Severe condition drift, clinical inaccuracy, or fatal contradiction. | Quarantined; excluded from benchmark corpus. |

---

## 4. Execution Workflow

1. Generator emits candidate fixtures with `adjudicationStatus: "PENDING"` in [`eval/src/robustness/fixtures/adversarial_paraphrases_145.json`](file:///c:/dev/Capstone/eval/src/robustness/fixtures/adversarial_paraphrases_145.json).
2. Independent reviewers inspect candidates using the CLI tool:
   ```bash
   npx tsx scripts/adjudicate-paraphrase-cohort.ts --reviewer <REVIEWER_ID>
   ```
3. Decisions and audit notes are committed to the clinical audit trail.
