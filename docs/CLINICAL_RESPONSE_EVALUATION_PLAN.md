# MedVoice Clinical Response Evaluation Framework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reproducible, dual-track evaluation framework to benchmark MedVoice's production dialogue runtime against authentic physician responses (~1,000 pairs across 10 clinical domains) and evaluate emergency escalation on a 35-case safety challenge set.

**Architecture:** A decoupled multi-stage architecture:
- **Gate 0:** Data feasibility, licensing, provenance, and ethics verification.
- **Stage 1 (Tasks 1–2):** Dataset ingestion, de-identification safeguards, production runtime bridge (`/api/voice/chat`), and fresh-session isolation.
- **Stage 2 (Tasks 3–5):** True derangement baselines, multi-metric embeddings (`all-mpnet-base-v2` primary), and Track B held-out safety evaluation.
- **Stage 3 (Tasks 6–7):** Double-blinded multi-clinician review export/import, Krippendorff's $\alpha$, and conversation-clustered statistical inference.
- **Stage 4 (Tasks 8–9):** Publication LaTeX tables, KDE plots, and top-level CLI orchestrator.

**Tech Stack:** TypeScript (Node.js/tsx, Next.js route runtime, `PhiScrubber`, `conversationManager`), Python 3.10+ (`sentence-transformers`, `transformers`, `torch`, `scikit-learn`, `scipy`, `statsmodels`, `pandas`, `numpy`, `matplotlib`, `seaborn`).

**Spec:** [`docs/SEMANTIC_EVALUATION_STUDY_DESIGN.md`](file:///c:/dev/Capstone/docs/SEMANTIC_EVALUATION_STUDY_DESIGN.md) (and [`docs/superpowers/specs/2026-10-30-semantic-evaluation-study-design.md`](file:///c:/dev/Capstone/docs/superpowers/specs/2026-10-30-semantic-evaluation-study-design.md)).

---

## Global Constraints

- **Runtime Isolation**: MedVoice must be evaluated via its actual production dialogue runtime (`/api/voice/chat` handler, `dr-sarah-chen` persona, deterministic Pre-Arbiter, clinical state machine, RAG, and $<60$ word voice guard). Never alter MedVoice production code to suit the evaluation harness.
- **Zero Physician Leakage**: The physician's reference response must never be exposed to MedVoice in prompts, context, RAG, or state.
- **Session Memory Barrier**: Every benchmark turn must initialize with a fresh `conversationManager.createInitialState()`; no cross-turn or cross-session state leakage.
- **Track A Stratification**: Stratified strictly across 10 primary Chief Complaint Clinical Domains. No automated or model-inferred ESI 1–5 labels.
- **Track B Granularity**: 35 challenge cases evaluated strictly as binary emergency-status recognition, reported with exact counts and Wilson score 95% confidence intervals, explicitly framed as exploratory.
- **Primary Endpoint**: The primary automated semantic similarity measure is prespecified as cosine similarity on `sentence-transformers/all-mpnet-base-v2`. All secondary comparisons must apply multiplicity adjustments (Benjamini-Hochberg FDR).
- **No Cosine Percentages**: Cosine similarity must never be reported as a percentage or equated with clinical accuracy. A calibrated semantic-alignment threshold ($T_{\text{calib}}$) must be validated separately against clinician ratings on a calibration split.
- **True Derangement**: The random baseline must enforce a true derangement ($\pi(i) \ne i$ for all $i$), guaranteeing zero self-matches.
- **Clustered Resampling**: All bootstrap confidence intervals (10,000 iterations) must cluster resamples at the conversation/patient presentation level, reporting both micro-averages and domain macro-averages.
- **Covariate Naming**: Response-length differences must be explicitly labeled `response-length ratio` ($W_{\text{agent}} / W_{\text{physician}}$), not "spoken conciseness ratio".
- **Short Message Support**: Accept valid short clinical queries (e.g. "I'm dizzy", "I have chest pain"); reject empty/malformed inputs; enforce tokenizer/context limits without silent truncation.
- **De-Identification Safeguards**: `PhiScrubber` is an automated de-identification safeguard, not proof of complete HIPAA compliance. Raw data, manifests, and reviewer identity mappings must remain outside public Git commits.

---

## Review Focus

1. **Self-Matching in Random Baseline**: An ordinary shuffle can pair example $i$ with physician $i$; the derangement generator must verify $\forall i, \pi(i) \ne i$ and fail fast if a fixed point occurs.
2. **Reviewer Provenance Leakage**: If typographical quotes, whitespace formatting, or response lengths subtly reveal AI vs. human origin, blinding is compromised; the review exporter must normalize typography, whitespace, and case styling.
3. **Division by Zero in Response-Length Ratio**: If a physician reference is empty, division crashes; the ingestion validator must reject empty reference responses at the boundary.
4. **Ties in Wilcoxon Signed-Rank Test**: Identical templated baseline comparisons produce zero differences; `scipy.stats.wilcoxon` must explicitly use `zero_method='wilcox'` or `pratt`.
5. **Multi-Clinician Adjudication Disconnect**: If reviewer scores diverge by $>1$ point, the importer must flag them for adjudication and compute pre-adjudication Krippendorff's $\alpha$ separately from final consensus metrics.

---

## File Structure

```
eval/
├── README.md                                    # Usage guide & CLI documentation
├── package.json                                 # Node dependencies for eval runner
├── requirements.txt                             # Python dependencies for metrics/stats
├── config/
│   └── eval-config.json                         # Paths, model checkpoints, random seeds, telemetry
├── data/
│   ├── raw/                                     # Raw downloads (gitignored)
│   ├── processed/
│   │   ├── dataset_manifest.jsonl               # Curated ~1,000 benchmark pairs (gitignored)
│   │   ├── consensus_manifest.jsonl             # N=50-100 dual-physician pairs (gitignored)
│   │   └── dataset_manifest.sha256              # SHA-256 integrity digest
│   └── human_eval/
│       ├── scoring_rubric.md                    # Predefined ordinal Likert scoring rubric
│       ├── blind_sample_100.jsonl               # 100 randomized, blinded pairs (A/B)
│       ├── reviewer_mapping_secret.json         # Blinded identity mapping (gitignored)
│       └── synthetic_review_mock.jsonl          # Deterministic test fixture for CI
├── src/
│   ├── governance/
│   │   └── gate0-feasibility-check.ts           # Gate 0: Licensing, provenance & ethics audit
│   ├── ingestion/
│   │   ├── sanitize.ts                          # PHI scrubber & text normalizer
│   │   └── manifest-builder.ts                  # Ingestion parser & manifest generator
│   ├── harness/
│   │   ├── runtime-bridge.ts                    # Direct /api/voice/chat headless caller
│   │   ├── session-isolation.ts                 # Fresh state barrier & memory cleaner
│   │   └── benchmark-runner.ts                  # Phase 1 runner generating agent turns
│   ├── controls/
│   │   ├── derangement-baseline.ts              # True derangement random baseline
│   │   ├── templated-baseline.ts                # Static fallback generator
│   │   └── consensus-cohort.ts                  # Dual-physician consensus extractor
│   └── safety/
│       └── track-b-safety-runner.ts             # 35-case safety challenge evaluator
├── metrics/
│   ├── embedder.py                              # PyTorch / SentenceTransformers embedder
│   ├── similarity.py                            # Cosine, Euclidean, PCA, BERTScore
│   ├── readability.py                           # Word counts, response-length ratio, FKGL
│   ├── review_importer.py                       # Validated clinical review score importer
│   ├── inter_rater.py                           # Krippendorff's alpha & weighted agreement
│   └── statistics.py                            # Clustered bootstrap, Wilcoxon, regressions
├── visual/
│   ├── generate_tables.py                       # LaTeX & Markdown publication tables
│   └── generate_plots.py                        # Distribution KDEs, scatterplots, boxplots
└── run-pipeline.py                              # Top-level orchestrator & operational logger
```

---

## Phased Implementation Tasks

### Gate 0: Data Feasibility, Licensing, Provenance & Ethics Audit

**Files:**
- Create: `eval/src/governance/gate0-feasibility-check.ts`
- Create: `eval/config/eval-config.json`
- Test: `tests/eval/gate0-feasibility.test.ts`

**Interfaces:**
- Produces: `verifyDatasetGovernance(sources?: Array<{ id: string } | string>): GovernanceAuditResult`.
- Verifies: License compliance (Non-CC0 terms & DUA for MTSamples, academic research & IEC protocol for HealthCareMagic/MedDialog, tainted rejection for OpenMed/repackaged mirrors), Indian research ethics compliance (ICMR 2017 & ICMR AI 2023 guidelines, prohibition of self-exemption, IEC submission requirement), and `.gitignore` containment for raw datasets and secret review mappings.

- [x] **Step 1: Write the failing test**
  Verify that `verifyDatasetGovernance` rejects unverified sources, asserts required license attributes, and confirms raw data directories are gitignored.
- [x] **Step 2: Run test to verify it fails**
  Run: `npx tsx tests/eval/gate0-feasibility.test.ts`
  Expected: FAIL (Module not found)
- [x] **Step 3: Implement `gate0-feasibility-check.ts` and `eval-config.json`**
  Implement licensing verifier, ethics declaration validator, and path checker.
- [x] **Step 4: Run test to verify it passes**
  Run: `npx tsx tests/eval/gate0-feasibility.test.ts`
  Expected: PASS
- [ ] **Step 5: Commit**
  `git add eval/src/governance/ eval/config/ tests/eval/gate0-feasibility.test.ts && git commit -m "feat(eval): add Gate 0 dataset feasibility and licensing governance"`

---

### Task 1: Dataset Ingestion, De-Identification Safeguards & Manifest Builder

**Files:**
- Create: `eval/src/ingestion/sanitize.ts`
- Create: `eval/src/ingestion/manifest-builder.ts`
- Test: `tests/eval/manifest-builder.test.ts`

**Interfaces:**
- Consumes: `PhiScrubber.scrub()` from `lib/security/phi-scrubber.ts`.
- Produces: `buildEvaluationManifest(rawItems: RawDialogueItem[]): ManifestBuildResult`.
- Requirements:
  - Accept valid short clinical queries (e.g. "I have chest pain", "I'm dizzy"); reject empty/whitespace-only messages.
  - Enforce tokenizer context limits without silent truncation.
  - Categorize into 10 Chief Complaint domains (Cardiovascular, Respiratory, Neurological, Gastrointestinal, Dermatological, Musculoskeletal, General Medicine, Medication, Chronic, Other).
  - Record physician specialty if present in source metadata; otherwise record `"unknown"`.
  - Zero automated ESI inference for Track A.
  - Output `dataset_manifest.jsonl` with SHA-256 provenance hashes.

- [ ] **Step 1: Write the failing test**
  Assert that short queries ("I am dizzy") are accepted, empty queries are rejected, 10 domains are classified, physician specialty is preserved or `"unknown"`, and SHA-256 digests match payload.
- [ ] **Step 2: Run test to verify it fails**
  Run: `npx tsx tests/eval/manifest-builder.test.ts`
  Expected: FAIL
- [ ] **Step 3: Implement `sanitize.ts` and `manifest-builder.ts`**
  Implement regex domain classifier, PHI de-identification wrapper, and duplicate-detecting manifest writer.
- [ ] **Step 4: Run test to verify it passes**
  Run: `npx tsx tests/eval/manifest-builder.test.ts`
  Expected: PASS
- [ ] **Step 5: Commit**
  `git add eval/src/ingestion/ tests/eval/manifest-builder.test.ts && git commit -m "feat(eval): add manifest builder with short-message support and domain stratification"`

---

### Task 2: MedVoice Production Runtime Bridge & Session Isolation

**Files:**
- Create: `eval/src/harness/session-isolation.ts`
- Create: `eval/src/harness/runtime-bridge.ts`
- Test: `tests/eval/runtime-bridge.test.ts`

**Interfaces:**
- Consumes: `POST` from `app/api/voice/chat/route.ts`, `conversationManager` from `lib/triage/conversation-manager.ts`.
- Produces: `executeIsolatedTurn(patientQuery: string, context?: TurnContext[]): Promise<TurnExecutionResult>`.
- Requirements:
  - Invokes the production `/api/voice/chat` handler directly.
  - Fresh session initialization (`conversationManager.createInitialState()`) on every example.
  - Doctor locked to `dr-sarah-chen` (Internal Medicine).
  - Records operational telemetry: execution latency (ms), token count, retry count, model checkpoint, prompt hash, and timestamps.
  - Enforces the production $<60$ word voice guard.
  - Strictly prevents physician reference response from entering the payload.

- [ ] **Step 1: Write the failing test**
  Verify that sequential calls maintain isolated states, doctor reply adheres to $<60$ word limit, operational telemetry is populated, and physician reference cannot be leaked.
- [ ] **Step 2: Run test to verify it fails**
  Run: `npx tsx tests/eval/runtime-bridge.test.ts`
  Expected: FAIL
- [ ] **Step 3: Implement `runtime-bridge.ts` and `session-isolation.ts`**
  Construct synthetic `NextRequest` invoking `/api/voice/chat`, extracting `doctorReply`, state, and telemetry.
- [ ] **Step 4: Run test to verify it passes**
  Run: `npx tsx tests/eval/runtime-bridge.test.ts`
  Expected: PASS
- [ ] **Step 5: Commit**
  `git add eval/src/harness/ tests/eval/runtime-bridge.test.ts && git commit -m "feat(eval): add production runtime bridge and session isolation harness"`

---

### Task 3: True Derangement Baseline & Consensus Calibration Cohort

**Files:**
- Create: `eval/src/controls/derangement-baseline.ts`
- Create: `eval/src/controls/templated-baseline.ts`
- Create: `eval/src/controls/consensus-cohort.ts`
- Test: `tests/eval/baseline-controls.test.ts`

**Interfaces:**
- Consumes: `dataset_manifest.jsonl`.
- Produces: `generateDerangementBaseline(items: CuratedPairRecord[], seed: number): BaselinePairRecord[]`, `generateTemplatedBaseline(items: CuratedPairRecord[]): BaselinePairRecord[]`, `extractConsensusCohort(items: MultiPhysicianRecord[]): ConsensusPairRecord[]`.
- Requirements:
  - Guaranteed true derangement: $\forall i, \pi(i) \ne i$ (zero self-matches).
  - Reproducible with fixed seed (`42`).
  - Consensus cohort extracting 50–100 dual-physician threads from source data.

- [ ] **Step 1: Write the failing test**
  Assert that the derangement generator verifies zero fixed points across 1,000 items, templated baseline outputs standard fallback text, and consensus extractor produces paired physician answers.
- [ ] **Step 2: Run test to verify it fails**
  Run: `npx tsx tests/eval/baseline-controls.test.ts`
  Expected: FAIL
- [ ] **Step 3: Implement `derangement-baseline.ts`, `templated-baseline.ts`, and `consensus-cohort.ts`**
  Implement Sattolo's or rejection-based derangement algorithm and consensus thread parser.
- [ ] **Step 4: Run test to verify it passes**
  Run: `npx tsx tests/eval/baseline-controls.test.ts`
  Expected: PASS
- [ ] **Step 5: Commit**
  `git add eval/src/controls/ tests/eval/baseline-controls.test.ts && git commit -m "feat(eval): add true derangement baseline and consensus cohort generator"`

---

### Task 4: Automated Embedding & Multi-Metric Similarity Engine

**Files:**
- Create: `eval/metrics/embedder.py`
- Create: `eval/metrics/similarity.py`
- Create: `eval/metrics/readability.py`
- Test: `tests/eval/test_similarity_metrics.py`

**Interfaces:**
- Consumes: Agent and physician response text arrays.
- Produces: `compute_similarity_matrix(agent_texts, physician_texts) -> pd.DataFrame`.
- Requirements:
  - **Primary Model**: `sentence-transformers/all-mpnet-base-v2` (768-dim) for primary cosine similarity.
  - **Secondary Models**: `all-MiniLM-L6-v2`, `Bio_ClinicalBERT`, `PubMedBERT` documented as secondary/exploratory.
  - **BERTScore**: Documented checkpoint (`roberta-large`).
  - **Covariates**: Response-length ratio ($W_{\text{agent}} / W_{\text{physician}}$) and Flesch-Kincaid Grade Level ($\Delta \text{FKGL}$). Safely handle division by zero.
  - **PCA**: Used strictly for 2D/3D visualization projections (not as a ranking preservation correctness test).
  - No reporting of cosine similarity as a percentage or clinical accuracy.

- [ ] **Step 1: Write the failing test**
  Assert cosine similarity is in $[-1, 1]$, response-length ratio correctly handles short and long responses, missing reference text throws ValueError, and embeddings are reproducible.
- [ ] **Step 2: Run test to verify it fails**
  Run: `pytest tests/eval/test_similarity_metrics.py`
  Expected: FAIL
- [ ] **Step 3: Implement `embedder.py`, `similarity.py`, and `readability.py`**
  Implement PyTorch/SentenceTransformers loader, cosine/Euclidean calculator, BERTScore wrapper, and FKGL calculator.
- [ ] **Step 4: Run test to verify it passes**
  Run: `pytest tests/eval/test_similarity_metrics.py`
  Expected: PASS
- [ ] **Step 5: Commit**
  `git add eval/metrics/ tests/eval/test_similarity_metrics.py && git commit -m "feat(eval): add multi-model embedding and similarity engine with primary endpoint"`

---

### Task 5: Controlled Clinical Safety Challenge (Track B)

**Files:**
- Create: `eval/src/safety/track-b-safety-runner.ts`
- Test: `tests/eval/track-b-safety.test.ts`

**Interfaces:**
- Consumes: `tests/clinical-eval/cases.json` (35 challenge cases: 22 emergent, 13 non-emergent controls).
- Produces: `executeTrackBSafetyChallenge(): Promise<TrackBSafetySummary>`.
- Requirements:
  - Held-out evaluation: MedVoice prompts and arbiters must not be tuned against these 35 cases.
  - Binary emergency recognition:
    - Sensitivity: $\text{True Positives} / 22$.
    - Specificity: $\text{True Negatives} / 13$.
    - False-negative under-triage rate.
  - Escalation appropriateness check (EMS / ED directives).
  - Exact counts and Wilson score 95% confidence intervals.
  - Explicitly documented as an exploratory safety challenge set, not 5-level ESI.

- [ ] **Step 1: Write the failing test**
  Assert that Track B runner computes Sensitivity on denominator 22, Specificity on denominator 13, flags under-triage, and formats Wilson score 95% CIs.
- [ ] **Step 2: Run test to verify it fails**
  Run: `npx tsx tests/eval/track-b-safety.test.ts`
  Expected: FAIL
- [ ] **Step 3: Implement `track-b-safety-runner.ts`**
  Implement case loader, runtime bridge invoker, triage directive inspector, and Wilson score CI calculator.
- [ ] **Step 4: Run test to verify it passes**
  Run: `npx tsx tests/eval/track-b-safety.test.ts`
  Expected: PASS
- [ ] **Step 5: Commit**
  `git add eval/src/safety/ tests/eval/track-b-safety.test.ts && git commit -m "feat(eval): add Track B exploratory safety challenge runner with Wilson CIs"`

---

### Task 6: Double-Blinded Multi-Clinician Review Exporter & Validated Importer

**Files:**
- Create: `eval/src/harness/human-review-sampler.ts`
- Create: `eval/metrics/review_importer.py`
- Create: `eval/metrics/inter_rater.py`
- Create: `eval/data/human_eval/scoring_rubric.md`
- Create: `eval/data/human_eval/synthetic_review_mock.jsonl`
- Test: `tests/eval/test_human_review.py`

**Interfaces:**
- Produces:
  - `sample_blind_subset(results, n=100, seed=42)` -> `blind_sample_100.jsonl` and gitignored `reviewer_mapping_secret.json`.
  - `import_and_adjudicate_reviews(review_file, secret_mapping_file) -> AdjudicatedReviewResult`.
  - `compute_krippendorff_alpha(ratings_matrix, level_of_measurement='ordinal') -> float`.
- Requirements:
  - At least 2 independent clinical raters per example.
  - Randomized Response A/B presentation (unbiased coin flip; 50% Agent is A, 50% Doctor is A).
  - Strict provenance stripping (normalized whitespace, quotes, no model tokens).
  - Predefined 5-point Likert ordinal rubric: Medical Correctness, Completeness, Relevance, Empathy, Clarity, Uncertainty handling, and Binary Safety error flags.
  - Computes pre-adjudication inter-rater reliability via Krippendorff's $\alpha$ (ordinal).
  - Flags disagreements ($>1$ point or discordant safety flags) for panel adjudication.
  - Validates and imports completed review files into structured dataframes.

- [ ] **Step 1: Write the failing test**
  Verify that blinding strips provenance, 2 raters are required per case, Krippendorff's $\alpha$ handles ordinal ties, and the importer rejects malformed review files.
- [ ] **Step 2: Run test to verify it fails**
  Run: `pytest tests/eval/test_human_review.py`
  Expected: FAIL
- [ ] **Step 3: Implement sampler, rubric, `inter_rater.py`, and `review_importer.py`**
  Implement blinding sampler, coin-flip secret mapper, Krippendorff's $\alpha$ calculation, and JSONL review importer.
- [ ] **Step 4: Run test to verify it passes**
  Run: `pytest tests/eval/test_human_review.py`
  Expected: PASS
- [ ] **Step 5: Commit**
  `git add eval/src/harness/ eval/metrics/review_importer.py eval/metrics/inter_rater.py eval/data/human_eval/ tests/eval/test_human_review.py && git commit -m "feat(eval): add blinded multi-clinician review sampler, rubric, and validated importer"`

---

### Task 7: Clustered Statistical Inference & Calibrated Threshold Engine

**Files:**
- Create: `eval/metrics/statistics.py`
- Test: `tests/eval/test_statistical_inference.py`

**Interfaces:**
- Consumes: Evaluated dataset dataframe and imported clinical reviewer scores.
- Produces: Conversation-clustered bootstrap CIs (micro and macro), Wilcoxon signed-rank tests with multiplicity adjustments, OLS regressions, and calibrated semantic threshold ($T_{\text{calib}}$).
- Requirements:
  - Conversation-level clustered bootstrap (10,000 resamples) stratified by domain.
  - Primary endpoint prespecified: `all-mpnet-base-v2` cosine similarity.
  - Benjamini-Hochberg FDR multiplicity correction for secondary models and domains.
  - Paired Wilcoxon signed-rank test against deranged random and templated baselines (using `zero_method='wilcox'`).
  - OLS regression modeling: $\text{Similarity}_i = \beta_0 + \beta_1 (\text{LengthRatio}_i) + \beta_2 (\Delta \text{FKGL}_i) + \sum \gamma_k (\text{Domain}_k) + \epsilon_i$ (framed as exploratory, not causal).
  - Computes calibrated semantic alignment threshold ($T_{\text{calib}}$) maximizing F1 against clinical acceptability ratings on a calibration split.

- [ ] **Step 1: Write the failing test**
  Verify that clustered bootstrapping resamples by conversation cluster, Wilcoxon handles zero-difference ties safely, Benjamini-Hochberg adjusts secondary $p$-values, and threshold calibration computes optimal cutpoint.
- [ ] **Step 2: Run test to verify it fails**
  Run: `pytest tests/eval/test_statistical_inference.py`
  Expected: FAIL
- [ ] **Step 3: Implement `statistics.py`**
  Implement conversation-clustered 10k bootstrap, paired Wilcoxon, Benjamini-Hochberg correction, statsmodels OLS, and ROC/F1 threshold calibrator.
- [ ] **Step 4: Run test to verify it passes**
  Run: `pytest tests/eval/test_statistical_inference.py`
  Expected: PASS
- [ ] **Step 5: Commit**
  `git add eval/metrics/statistics.py tests/eval/test_statistical_inference.py && git commit -m "feat(eval): add clustered statistical inference, multiplicity adjustments, and threshold calibrator"`

---

### Task 8: Publication Visualizations & LaTeX Table Exporters

**Files:**
- Create: `eval/visual/generate_tables.py`
- Create: `eval/visual/generate_plots.py`
- Test: `tests/eval/test_visual_generation.py`

**Interfaces:**
- Consumes: Statistical summaries and metrics dataframes.
- Produces: LaTeX files (`table1_main_results.tex`, `table2_domain_slices.tex`, `table3_safety_challenge.tex`, `table4_regression.tex`, `table5_human_eval.tex`) and PNG figures (`figure1_kde_overlay.png`, `figure2_human_correlation.png`, `figure3_domain_boxplots.png`, `figure4_pca_projection.png`).
- Requirements:
  - Table 1 reports micro- and macro-averages, 95% clustered bootstrap CIs, and Benjamini-Hochberg adjusted $p$-values.
  - Table 2 reports 10 clinical domain slices with response-length ratios and calibrated alignment rates.
  - Table 3 reports Track B exploratory safety metrics with exact counts and Wilson score 95% CIs.
  - Table 4 reports exploratory OLS regression coefficients with robust standard errors.
  - Table 5 reports clinician review dimensions, pre-adjudication Krippendorff's $\alpha$, and adjudicated scores.
  - Figure 4 renders PCA projections for visual representation comparison (without asserting ranking preservation).

- [ ] **Step 1: Write the failing test**
  Verify that all 5 LaTeX tables are syntactically valid and figures are rendered at $\ge 300$ DPI.
- [ ] **Step 2: Run test to verify it fails**
  Run: `pytest tests/eval/test_visual_generation.py`
  Expected: FAIL
- [ ] **Step 3: Implement `generate_tables.py` and `generate_plots.py`**
  Implement LaTeX table formatter and Matplotlib/Seaborn KDE distribution plots, scatterplots with Spearman correlation, domain boxplots, and PCA scatter.
- [ ] **Step 4: Run test to verify it passes**
  Run: `pytest tests/eval/test_visual_generation.py`
  Expected: PASS
- [ ] **Step 5: Commit**
  `git add eval/visual/ tests/eval/test_visual_generation.py && git commit -m "feat(eval): add publication LaTeX tables and visual plot generators"`

---

### Task 9: Top-Level Orchestration, Operational Telemetry & E2E Smoke Tests

**Files:**
- Create: `eval/run-pipeline.py`
- Create: `eval/README.md`
- Test: `tests/eval/e2e-pipeline.test.ts`

**Interfaces:**
- CLI flags: `--phase [1|2|all]`, `--smoke-test`, `--use-mock-reviews`, `--skip-gpu`, `--output-dir`.
- Produces: `operational_telemetry.json` logging total runtime, P50/P95 turn latency, failure rates, retries, and token usage.

- [ ] **Step 1: Write the failing test**
  Execute end-to-end smoke test on a 5-item mini-manifest through Phase 1 and Phase 2 using the synthetic mock review fixture, asserting all tables, plots, telemetry JSON, and manifests are produced with 0 errors.
- [ ] **Step 2: Run test to verify it fails**
  Run: `npx tsx tests/eval/e2e-pipeline.test.ts`
  Expected: FAIL
- [ ] **Step 3: Implement `run-pipeline.py` and `README.md`**
  Implement CLI parser, subprocess execution coordinator, operational telemetry logger, and comprehensive setup/execution documentation.
- [ ] **Step 4: Run test to verify it passes**
  Run: `npx tsx tests/eval/e2e-pipeline.test.ts`
  Expected: PASS
- [ ] **Step 5: Commit**
  `git add eval/run-pipeline.py eval/README.md tests/eval/e2e-pipeline.test.ts && git commit -m "feat(eval): add top-level pipeline orchestrator, operational logger, and e2e smoke test"`
