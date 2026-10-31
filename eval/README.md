# MedVoice Clinical Response Evaluation Framework

## 1. Overview & Research Architecture

The **MedVoice Clinical Response Evaluation Framework** provides an objective, reproducible, and methodologically sound clinical evaluation pipeline for the MedVoice conversational triage agent.

It evaluates the alignment between MedVoice AI-generated clinical responses and reference responses authored by verified board-certified physicians, using:
1. **Multi-Model Semantic Similarity**: Prespecified primary endpoint (`sentence-transformers/all-mpnet-base-v2`) and biomedical secondary encoders (`Bio_ClinicalBERT`, `PubMedBERT`, `BERTScore`).
2. **Experimental Controls**: True derangement floor baseline (Sattolo algorithm) and trivial templated fallback baseline.
3. **Controlled Clinical Safety Challenge (Track B)**: 35 standardized scenarios (22 emergent, 13 non-emergent controls) with exact Wilson score 95% confidence intervals.
4. **Double-Blinded Human Review**: Provenance-stripped, coin-flip randomized A/B presentation evaluated by independent licensed physicians with Krippendorff's $\alpha$ inter-rater reliability.
5. **Clustered Statistical Inference**: 10,000 conversation-clustered bootstrap confidence intervals, paired Wilcoxon signed-rank tests, Benjamini-Hochberg FDR multiplicity corrections, and exploratory OLS regression modeling.

### Ten Research Milestones & Deliverables
The framework encompasses 10 distinct, dependency-aware milestones (Gate 0 pre-flight clearance plus Tasks 1–9):
1. **Milestone 0 (Gate 0)**: Dataset Governance, Feasibility & Ethics Clearance (`eval/config/DATASET_GOVERNANCE.md`, `eval/src/governance/gate0-feasibility-check.ts`).
2. **Milestone 1 (Task 1)**: Ingestion, PhiScrubber De-Identification & Manifest Builder (`eval/src/ingestion/manifest-builder.ts`, `eval/src/ingestion/sanitize.ts`).
3. **Milestone 2 (Task 2)**: Production Runtime Bridge & Isolated State Barriers (`eval/src/harness/runtime-bridge.ts`, `eval/src/harness/session-isolation.ts`).
4. **Milestone 3 (Task 3)**: Experimental Controls: Sattolo Derangement & Consensus Cohorts (`eval/src/controls/`).
5. **Milestone 4 (Task 4)**: Multi-Model Embedding & Similarity Engine (`eval/metrics/embedder.py`, `eval/metrics/similarity.py`).
6. **Milestone 5 (Task 5)**: Track B Exploratory Safety Challenge Runner (`eval/src/safety/track-b-safety-runner.ts`).
7. **Milestone 6 (Task 6)**: Double-Blinded Multi-Clinician Review Exporter & Importer (`eval/src/harness/human-review-sampler.ts`, `eval/metrics/review_importer.py`).
8. **Milestone 7 (Task 7)**: Clustered Statistical Inference & Calibrated Thresholds (`eval/metrics/statistics.py`).
9. **Milestone 8 (Task 8)**: Publication Visualizations & LaTeX Table Exporters (`eval/visual/`).
10. **Milestone 9 (Task 9)**: Top-Level Pipeline Orchestrator & Operational Telemetry (`eval/run-pipeline.py`, `tests/eval/e2e-pipeline.test.ts`).

---

## 2. Directory Structure

```
eval/
├── README.md                           # This operational execution guide
├── config/
│   ├── DATASET_GOVERNANCE.md           # Gate 0 dataset feasibility, ethics & licenses
│   └── eval-config.json                # Pipeline hyperparameters, paths, seeds
├── data/
│   ├── processed/                      # Curated manifests & SHA-256 digests
│   └── human_eval/
│       ├── scoring_rubric.md           # 5-point Likert & Binary Safety Rubric
│       └── synthetic_review_mock.jsonl # Mock review fixture for CI verification
├── src/
│   ├── governance/                     # Gate 0 feasibility and license checks
│   ├── ingestion/                      # Manifest builder & PhiScrubber de-identification
│   ├── harness/                        # Production runtime bridge & session isolation
│   ├── controls/                       # Sattolo derangement & consensus cohorts
│   └── safety/                         # Track B exploratory safety challenge runner
├── metrics/
│   ├── embedder.py                     # HuggingFace & SentenceTransformers loaders
│   ├── similarity.py                   # Cosine, Euclidean, PCA, and BERTScore
│   ├── readability.py                  # FKGL & response-length ratio
│   ├── inter_rater.py                  # Krippendorff's alpha (ordinal)
│   ├── review_importer.py              # Double-blind review importer & unblinder
│   └── statistics.py                   # 10k bootstrap, Wilcoxon, OLS, threshold calibration
├── visual/
│   ├── generate_tables.py              # Publication LaTeX tables (booktabs)
│   └── generate_plots.py               # Figures 1-4 (>= 300 DPI)
├── requirements.txt                    # Python dependencies
└── run-pipeline.py                     # Top-level pipeline orchestrator
```

---

## 3. Quick Start & Execution

### Prerequisites
- Node.js 18+ (tested on Node 22)
- Python 3.10+ with `eval/requirements.txt` installed

### Run End-to-End Smoke Test
To verify the entire pipeline (Phase 1, Phase 2, tables, plots, telemetry) in ~10 seconds:
```bash
python eval/run-pipeline.py --phase all --smoke-test --use-mock-reviews --output-dir eval/output
```

### Run Automated Tests
```bash
# TypeScript Test Suites
npx tsx tests/eval/gate0-feasibility.test.ts
npx tsx tests/eval/manifest-builder.test.ts
npx tsx tests/eval/runtime-bridge.test.ts
npx tsx tests/eval/baseline-controls.test.ts
npx tsx tests/eval/track-b-safety.test.ts
npx tsx tests/eval/human-review-sampler.test.ts
npx tsx tests/eval/e2e-pipeline.test.ts

# Python Test Suites
python -m pytest tests/eval/test_similarity_metrics.py
python -m pytest tests/eval/test_human_review.py
python -m pytest tests/eval/test_statistical_inference.py
python -m pytest tests/eval/test_visual_generation.py
```

---

## 4. CLI Arguments for `run-pipeline.py`

| Flag | Options / Default | Description |
| :--- | :--- | :--- |
| `--phase` | `1`, `2`, `all` (default: `all`) | Select Phase 1 (benchmark execution), Phase 2 (statistics & deliverables), or both. |
| `--smoke-test` | Flag (boolean) | Fast validation on a mini-cohort with 200 bootstrap resamples. |
| `--use-mock-reviews`| Flag (boolean) | Ingest synthetic mock review fixtures for testing the adjudication pipeline. |
| `--skip-gpu` | Flag (boolean) | Force CPU device for embedding calculation. |
| `--output-dir` | Path (default: `eval/output`) | Directory where tables, figures, manifests, and telemetry are saved. |

---

## 5. Methodological & Scientific Governance

- **Zero Inferred ESI in Track A**: Retrospective chief complaints are categorized strictly into 10 anatomical/clinical domains; no automated ESI 1–5 level inference is applied.
- **Production Immutability**: Production application code (`app/`, `lib/`, `config/`) is completely unchanged; evaluation operates via isolated runtime bridges.
- **No Accuracy Equivalence**: Cosine similarity is never reported as "clinical accuracy" or percentage concordance; it is evaluated strictly as a semantic alignment proxy with bootstrapped confidence intervals.
- **Ethics Compliance**: In strict compliance with ICMR 2017, ICMR AI 2023, and DPDPA 2023 guidelines.
