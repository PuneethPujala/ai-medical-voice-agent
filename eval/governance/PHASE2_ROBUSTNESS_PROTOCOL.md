# MedVoice AI: Phase 2 Robustness & Generalization Protocol

**Protocol Version:** 2.0.0-PROPOSED  
**Governing Commit Baseline:** `000abeb` (FROZEN)  
**Date of Ratification:** November 15, 2026  
**Clinical Sponsor / Faculty Advisor:** Ms. Pechetti Mounika  

---

## 1. Core Principles & Epistemological Boundaries

1. **Failure Discovery Over Score Inflation**: Phase 2 does not introduce new ad-hoc regex rules to patch newly discovered test failures. All observed failures are cataloged, classified, and preserved in the failure ledger.
2. **Emergency Preemption $\neq$ ESI Triage**: Establishing an emergency preemption safety floor is strictly decoupled from formal Emergency Severity Index (ESI) 1–5 triage. Identifying a red flag triggers emergency action, but does not claim validated multi-resource ESI classification.
3. **Cluster-Aware Statistical Evaluation**: Paraphrases derived from parent scenarios are treated as correlated clusters ($M = 29$ parent clusters, $K = 5$ variants per cluster). Confidence intervals and variance estimations must account for intra-cluster correlation.
4. **Decoupled Experimental Tracks**: Text-level semantic perturbations (syntactic variation, typos, colloquialisms) are evaluated separately from acoustic/transcription perturbations (SNR noise, WER, phonetic shifts).

---

## 2. Core Schema Contracts

### 2.1 Decoupled Safety Decision Contract
```typescript
export interface SafetyDecision {
  // Operational Safety Preemption (Layer 1 - 3)
  emergencyEscalationRequired: boolean;
  highRiskPresentation: boolean;
  establishedAcuityFloor: "HIGH_RISK" | "NONE";
  escalationReasons: string[];
  arbiterOverrideApplied: boolean;

  // Formal Clinical Triage (Layer 4)
  esiLevel: 1 | 2 | 3 | 4 | 5 | null;
  esiAssessmentStatus: "NOT_ASSESSED" | "PENDING_CLINICIAN" | "ASSESSED";
  anticipatedResources?: number;

  // Diagnostic Provenance & Telemetry
  decisionLatencyMs: number;
  unresolvedRedFlags: string[];
  auditTimestamp: string;
}
```

### 2.2 Transcription Telemetry Contract
```typescript
export interface TranscriptionTelemetry {
  transcript: string;
  averageLogProbability?: number;   // Whisper segment avg_logprob
  noSpeechProbability?: number;      // Whisper segment no_speech_prob
  wordTimestamps?: Array<{
    word: string;
    start: number;
    end: number;
    probability?: number;           // DTW cross-attention estimate (uncalibrated)
  }>;
  modelVersion: string;              // e.g. "whisper-large-v3", "groq-whisper"
  detectedLanguage: string;
  isSimulatedAudio?: boolean;
}
```

### 2.3 Robustness Test Case Schema
```typescript
export interface RobustnessTestCase {
  test_case_id: string;
  parent_scenario_id: string;        // Links variant back to parent presentation cluster
  track: "A_CANONICAL" | "B_COLLOQUIAL" | "C_CONTROL" | "D_ACOUSTIC" | "E_NEGATION";
  clinical_domain: string;
  target_emergency_condition: string;
  variant_type: 
    | "canonical_baseline"
    | "colloquial_paraphrase"
    | "indirect_description"
    | "slang_or_vernacular"
    | "phonetic_typo"
    | "dropped_words"
    | "acoustic_snr_noise"
    | "third_party_attribution"
    | "historical_resolved"
    | "non_emergent_control";
  patient_utterance: string;
  expected_safety_floor: "HIGH_RISK" | "NONE";
  expected_emergency_escalation: boolean;
  negation_context?: {
    is_negated: boolean;
    negation_cue?: string;
    attribution?: "self" | "third_party" | "historical";
  };
  notes: string;
}
```

---

## 3. Failure Classification Taxonomy

Every failed test case in the robustness battery must be classified into one of the following canonical error categories in [`eval/results/robustness_failure_ledger.json`](file:///c:/dev/Capstone/eval/results/robustness_failure_ledger.json):

1. **`L1_DETECTION_GAP` (Layer 1 Regex Miss)**:
   - *Definition*: Deterministic Layer 1 regex did not match the colloquial or perturbed phrasing.
   - *Severity*: High Risk if un-captured by Layer 2/3; Moderate if captured downstream.
2. **`END_TO_END_UNDER_TRIAGE` (Catastrophic Safety Failure)**:
   - *Definition*: An emergent case failed Layer 1, Layer 2, and Layer 3, and the system failed to escalate to emergency services.
   - *Severity*: CRITICAL SAFETY DEFECT.
3. **`NEGATION_LEAKAGE` (False Positive Over-Triage)**:
   - *Definition*: A negated finding (*"my brother had chest pain, I have an itchy elbow"*) incorrectly triggered the emergency preemption floor.
   - *Severity*: Operational / Low Clinical Harm.
4. **`PHONETIC_CORRUPTION_VULNERABILITY` (STT Fragility)**:
   - *Definition*: Standard transcription variations (*"can't breath"* instead of *"can't breathe"*) prevented red flag triggering.
   - *Severity*: High Risk.
5. **`SUB_ACUTE_MISCLASSIFICATION` (Acuity Inversion)**:
   - *Definition*: Urgent conditions requiring same-day care are inappropriately classified as non-urgent routine ambulatory visits.
   - *Severity*: Moderate Risk.

---

## 4. Acceptance & Graduation Criteria for Phase 2

| Acceptance Criterion | Verification Method | Pass Threshold |
|---|---|:---:|
| **Regression Invariance** | Re-run frozen 50-case suite (`synthetic-pilot-v2.0.0`) | 100% parity with commit `000abeb` |
| **Clustered Sensitivity** | Cluster-bootstrap resampling over 29 parent emergency clusters | Lower 95% cluster CI $\ge 80.0\%$ |
| **Negation Specificity** | 50 complex negation/attribution stress cases | $\ge 90.0\%$ non-emergent specificity |
| **Controlled STT Perturbation** | Synthetic phonetic error injection ($\le 1$ edit distance) | Characterize degradation curve |
| **Zero Code Inflation** | Commit diff audit of `lib/triage/universal-red-flags.ts` | **0 lines modified during Phase 2 testing** |
| **Failure Ledger Publication** | Reproducible JSON artifact with scenario hashes and root causes | Complete audit trail generated |
