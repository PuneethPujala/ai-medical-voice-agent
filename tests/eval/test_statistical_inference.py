"""
Unit tests for MedVoice Statistical Inference Engine, Clustered Bootstrapping,
Wilcoxon Paired Hypotheses, FDR Multiplicity Correction, OLS Regressions,
and Calibrated Semantic Threshold Engine.
"""

import pytest
import numpy as np
import pandas as pd

from eval.metrics.statistics import (
    compute_clustered_bootstrap_ci,
    compute_paired_wilcoxon_tests,
    apply_benjamini_hochberg_fdr,
    fit_exploratory_ols_regression,
    calibrate_semantic_threshold,
)


class TestClusteredBootstrap:
    """Test suite for conversation-clustered bootstrapping."""

    def test_clustered_bootstrap_preserves_mean(self):
        """Bootstrap point estimate and CI should bracket the true sample mean."""
        np.random.seed(42)
        # Create 20 conversation clusters, each with 2 turns
        data = []
        for conv_id in range(20):
            domain = "cardio" if conv_id < 10 else "respiratory"
            base_score = 0.75 if domain == "cardio" else 0.65
            for turn in range(2):
                data.append({
                    "conversation_id": f"conv_{conv_id}",
                    "domain": domain,
                    "similarity": base_score + np.random.normal(0, 0.05),
                })
        df = pd.DataFrame(data)

        result = compute_clustered_bootstrap_ci(
            df=df,
            cluster_col="conversation_id",
            metric_col="similarity",
            stratify_col="domain",
            n_resamples=500,
            seed=42,
        )

        sample_mean = df["similarity"].mean()
        assert pytest.approx(result["mean"], abs=1e-4) == sample_mean
        assert result["ci_lower"] < sample_mean < result["ci_upper"]
        assert result["n_resamples"] == 500
        assert "macro_mean" in result
        assert result["macro_ci_lower"] < result["macro_mean"] < result["macro_ci_upper"]

    def test_clustered_bootstrap_handles_single_item_clusters(self):
        """Should handle data where each cluster is a single row without error."""
        df = pd.DataFrame({
            "conv_id": [f"c_{i}" for i in range(15)],
            "domain": ["derm"] * 15,
            "score": [0.8] * 15,
        })
        result = compute_clustered_bootstrap_ci(
            df=df,
            cluster_col="conv_id",
            metric_col="score",
            n_resamples=200,
            seed=42,
        )
        assert pytest.approx(result["mean"], abs=1e-4) == 0.8
        assert pytest.approx(result["ci_lower"], abs=1e-4) == 0.8
        assert pytest.approx(result["ci_upper"], abs=1e-4) == 0.8


class TestPairedWilcoxon:
    """Test suite for Wilcoxon signed-rank paired tests."""

    def test_significant_difference_agent_vs_floor(self):
        """MedVoice scores substantially higher than random baseline."""
        agent = [0.85, 0.82, 0.88, 0.79, 0.91, 0.84, 0.87, 0.83, 0.86, 0.89]
        floor = [0.22, 0.18, 0.25, 0.19, 0.30, 0.21, 0.27, 0.15, 0.24, 0.28]

        res = compute_paired_wilcoxon_tests(agent, floor, zero_method="wilcox")

        assert res["p_value"] < 0.01
        assert res["rank_biserial_r"] == 1.0  # Perfect separation
        assert res["median_diff"] > 0.5

    def test_handles_zero_difference_ties(self):
        """Should handle zero-difference ties using zero_method='wilcox'."""
        agent = [0.8, 0.8, 0.85, 0.9, 0.7]
        baseline = [0.8, 0.8, 0.85, 0.6, 0.5]

        res = compute_paired_wilcoxon_tests(agent, baseline, zero_method="wilcox")
        assert "p_value" in res
        assert "rank_biserial_r" in res


class TestBenjaminiHochbergFDR:
    """Test suite for Benjamini-Hochberg FDR multiplicity adjustment."""

    def test_fdr_adjustment_preserves_monotonicity(self):
        """Adjusted p-values (q-values) should be >= raw p-values and monotonic."""
        raw_p = {
            "model_1": 0.001,
            "model_2": 0.01,
            "model_3": 0.03,
            "model_4": 0.04,
            "model_5": 0.25,
            "model_6": 0.80,
        }

        adjusted = apply_benjamini_hochberg_fdr(raw_p, alpha=0.05)

        for key in raw_p:
            assert adjusted[key]["adjusted_p_value"] >= raw_p[key]

        # Check significant flags
        assert adjusted["model_1"]["significant"] is True
        assert adjusted["model_6"]["significant"] is False


class TestExploratoryOLSRegression:
    """Test suite for covariate regression analysis."""

    def test_fit_ols_regression_with_covariates(self):
        """Fits OLS regression with length ratio and delta FKGL covariates."""
        np.random.seed(42)
        n = 100
        length_ratio = np.random.uniform(0.5, 2.0, size=n)
        delta_fkgl = np.random.uniform(-3.0, 3.0, size=n)
        # Similarity depends slightly on length ratio
        similarity = 0.6 + 0.1 * length_ratio - 0.02 * delta_fkgl + np.random.normal(0, 0.02, size=n)

        df = pd.DataFrame({
            "similarity": similarity,
            "length_ratio": length_ratio,
            "delta_fkgl": delta_fkgl,
            "domain": np.random.choice(["cardio", "neuro", "gi"], size=n),
        })

        res = fit_exploratory_ols_regression(
            df=df,
            dependent_var="similarity",
            covariates=["length_ratio", "delta_fkgl"],
            categorical_covariates=["domain"],
        )

        assert "r_squared" in res
        assert res["r_squared"] > 0.5
        assert "length_ratio" in res["coefficients"]
        assert "delta_fkgl" in res["coefficients"]
        assert "interpretation_note" in res
        assert "not a causal inference model" in res["interpretation_note"]


class TestSemanticThresholdCalibration:
    """Test suite for calibrating alignment threshold against clinical acceptability."""

    def test_calibrate_threshold_finds_optimal_cutpoint(self):
        """Finds threshold maximizing F1 score."""
        # Scores for acceptable cases are high, unacceptable cases are low
        high_scores = np.random.uniform(0.70, 0.95, size=50)
        low_scores = np.random.uniform(0.20, 0.60, size=50)

        scores = np.concatenate([high_scores, low_scores])
        # Ground truth: 1 for high scores, 0 for low scores
        acceptability = np.concatenate([np.ones(50), np.zeros(50)])

        calib = calibrate_semantic_threshold(scores, acceptability, metric_to_maximize="f1")

        assert 0.60 <= calib["optimal_threshold"] <= 0.72
        assert calib["max_f1"] >= 0.90
        assert calib["precision_at_threshold"] >= 0.85
        assert calib["recall_at_threshold"] >= 0.85
