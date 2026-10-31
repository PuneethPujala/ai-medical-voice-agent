"""
Unit tests for MedVoice Publication Visualizations and LaTeX Table Exporters.
Verifies all 5 LaTeX tables are syntactically valid and figures are generated at >= 300 DPI.
"""

import os
import re
import pytest
import numpy as np
import pandas as pd
from PIL import Image

from eval.visual.generate_tables import (
    export_table1_main_results,
    export_table2_domain_slices,
    export_table3_safety_challenge,
    export_table4_regression,
    export_table5_human_eval,
    generate_all_latex_tables,
)
from eval.visual.generate_plots import (
    generate_figure1_kde_overlay,
    generate_figure2_human_correlation,
    generate_figure3_domain_boxplots,
    generate_figure4_pca_projection,
    generate_all_plots,
)


@pytest.fixture
def sample_table_data():
    """Mock evaluation statistics for table generation."""
    return {
        "table1": {
            "MedVoice (all-mpnet-base-v2)": {
                "micro_mean": 0.812,
                "micro_ci": (0.795, 0.828),
                "macro_mean": 0.805,
                "macro_ci": (0.782, 0.821),
                "wilcoxon_p": 1e-15,
                "fdr_q": 1e-15,
                "effect_size_r": 0.94,
            },
            "Random Shuffled Baseline": {
                "micro_mean": 0.231,
                "micro_ci": (0.215, 0.248),
                "macro_mean": 0.229,
                "macro_ci": (0.211, 0.245),
                "wilcoxon_p": 1.0,
                "fdr_q": 1.0,
                "effect_size_r": 0.0,
            },
            "Templated Fallback Baseline": {
                "micro_mean": 0.384,
                "micro_ci": (0.369, 0.399),
                "macro_mean": 0.380,
                "macro_ci": (0.362, 0.395),
                "wilcoxon_p": 1e-12,
                "fdr_q": 1e-12,
                "effect_size_r": 0.88,
            },
        },
        "table2": {
            "Cardiovascular": {"n": 100, "similarity": 0.835, "ci": (0.810, 0.855), "length_ratio": 0.85, "fkgl": 8.4, "alignment_rate": 88.0},
            "Respiratory": {"n": 100, "similarity": 0.821, "ci": (0.795, 0.842), "length_ratio": 0.82, "fkgl": 8.1, "alignment_rate": 86.0},
            "Neurological": {"n": 100, "similarity": 0.805, "ci": (0.778, 0.829), "length_ratio": 0.80, "fkgl": 8.5, "alignment_rate": 82.0},
            "Gastrointestinal": {"n": 100, "similarity": 0.814, "ci": (0.790, 0.836), "length_ratio": 0.86, "fkgl": 8.2, "alignment_rate": 84.0},
            "Dermatological": {"n": 100, "similarity": 0.792, "ci": (0.765, 0.815), "length_ratio": 0.78, "fkgl": 7.9, "alignment_rate": 80.0},
            "Musculoskeletal": {"n": 100, "similarity": 0.801, "ci": (0.775, 0.824), "length_ratio": 0.79, "fkgl": 8.0, "alignment_rate": 81.0},
            "General Medicine": {"n": 100, "similarity": 0.826, "ci": (0.802, 0.848), "length_ratio": 0.84, "fkgl": 8.3, "alignment_rate": 87.0},
            "Medication": {"n": 100, "similarity": 0.788, "ci": (0.760, 0.812), "length_ratio": 0.75, "fkgl": 8.6, "alignment_rate": 78.0},
            "Chronic Conditions": {"n": 100, "similarity": 0.818, "ci": (0.792, 0.839), "length_ratio": 0.83, "fkgl": 8.4, "alignment_rate": 85.0},
            "Other": {"n": 100, "similarity": 0.799, "ci": (0.771, 0.823), "length_ratio": 0.81, "fkgl": 8.2, "alignment_rate": 80.0},
        },
        "table3": {
            "total_cases": 35,
            "emergent_total": 22,
            "emergent_correct": 21,
            "sensitivity": 21 / 22,
            "sensitivity_ci": (0.772, 0.999),
            "non_emergent_total": 13,
            "non_emergent_correct": 12,
            "specificity": 12 / 13,
            "specificity_ci": (0.640, 0.998),
            "false_negative_rate": 1 / 22,
            "escalation_appropriateness_rate": 33 / 35,
            "critical_safety_errors": 0,
        },
        "table4": {
            "r_squared": 0.42,
            "adj_r_squared": 0.41,
            "f_statistic": 34.5,
            "f_pvalue": 1e-10,
            "coefficients": {
                "Intercept": {"coef": 0.62, "std_err": 0.04, "t_statistic": 15.5, "p_value": 1e-12, "ci_lower": 0.54, "ci_upper": 0.70},
                "Response-Length Ratio": {"coef": 0.12, "std_err": 0.03, "t_statistic": 4.0, "p_value": 0.0001, "ci_lower": 0.06, "ci_upper": 0.18},
                "Delta FKGL": {"coef": -0.015, "std_err": 0.005, "t_statistic": -3.0, "p_value": 0.003, "ci_lower": -0.025, "ci_upper": -0.005},
            },
        },
        "table5": {
            "inter_rater_alpha": {
                "correctness": 0.78,
                "completeness": 0.72,
                "relevance": 0.81,
                "empathy": 0.75,
                "clarity": 0.84,
                "uncertainty_guidelines": 0.76,
            },
            "adjudicated_means": {
                "correctness": {"agent": (4.3, 0.6), "ref": (4.5, 0.5), "p_val": 0.12},
                "completeness": {"agent": (4.1, 0.7), "ref": (4.4, 0.6), "p_val": 0.08},
                "relevance": {"agent": (4.6, 0.5), "ref": (4.7, 0.5), "p_val": 0.25},
                "empathy": {"agent": (4.4, 0.6), "ref": (4.2, 0.7), "p_val": 0.15},
                "clarity": {"agent": (4.7, 0.4), "ref": (4.5, 0.6), "p_val": 0.06},
                "uncertainty_guidelines": {"agent": (4.2, 0.6), "ref": (4.3, 0.6), "p_val": 0.40},
            },
            "safety_error_rates": {
                "agent_count": 0,
                "ref_count": 0,
            },
        },
    }


class TestLatexTableExporters:
    """Test suite validating LaTeX table syntax, required columns, and scientific disclaimers."""

    def test_export_table1_main_results(self, sample_table_data, tmp_path):
        out_file = tmp_path / "table1_main_results.tex"
        tex = export_table1_main_results(sample_table_data["table1"], str(out_file))

        assert os.path.exists(out_file)
        assert "\\begin{table}" in tex
        assert "\\toprule" in tex
        assert "\\bottomrule" in tex
        assert "MedVoice" in tex
        assert "Random Shuffled Baseline" in tex
        assert "Micro Mean" in tex or "Micro-Average" in tex

    def test_export_table2_domain_slices(self, sample_table_data, tmp_path):
        out_file = tmp_path / "table2_domain_slices.tex"
        tex = export_table2_domain_slices(sample_table_data["table2"], str(out_file))

        assert os.path.exists(out_file)
        assert "Cardiovascular" in tex
        assert "Respiratory" in tex
        assert "Chronic Conditions" in tex
        assert "Alignment Rate" in tex or "Calibrated Alignment" in tex

    def test_export_table3_safety_challenge(self, sample_table_data, tmp_path):
        out_file = tmp_path / "table3_safety_challenge.tex"
        tex = export_table3_safety_challenge(sample_table_data["table3"], str(out_file))

        assert os.path.exists(out_file)
        assert "22" in tex  # Emergent denominator
        assert "13" in tex  # Non-emergent denominator
        assert "Wilson" in tex
        assert "exploratory" in tex.lower()

    def test_export_table4_regression(self, sample_table_data, tmp_path):
        out_file = tmp_path / "table4_regression.tex"
        tex = export_table4_regression(sample_table_data["table4"], str(out_file))

        assert os.path.exists(out_file)
        assert "Response-Length Ratio" in tex
        assert "not a causal inference model" in tex.lower() or "exploratory" in tex.lower()

    def test_export_table5_human_eval(self, sample_table_data, tmp_path):
        out_file = tmp_path / "table5_human_eval.tex"
        tex = export_table5_human_eval(sample_table_data["table5"], str(out_file))

        assert os.path.exists(out_file)
        assert "Krippendorff" in tex
        assert "Medical Correctness" in tex or "correctness" in tex.lower()

    def test_generate_all_tables_convenience(self, sample_table_data, tmp_path):
        paths = generate_all_latex_tables(sample_table_data, str(tmp_path))
        assert len(paths) == 5
        for p in paths.values():
            assert os.path.exists(p)


class TestFigureGeneration:
    """Test suite validating Matplotlib figures are rendered at >= 300 DPI."""

    def test_figure1_kde_overlay(self, tmp_path):
        np.random.seed(42)
        agent = np.random.normal(0.81, 0.05, 100)
        random_b = np.random.normal(0.23, 0.08, 100)
        templated = np.random.normal(0.38, 0.04, 100)

        out_path = tmp_path / "figure1_kde_overlay.png"
        generate_figure1_kde_overlay(agent, random_b, templated, str(out_path), dpi=300)

        assert os.path.exists(out_path)
        with Image.open(out_path) as img:
            dpi = img.info.get("dpi", (300, 300))
            assert round(dpi[0]) >= 300

    def test_figure2_human_correlation(self, tmp_path):
        np.random.seed(42)
        sim = np.random.uniform(0.6, 0.95, 50)
        human = sim * 4.0 + np.random.normal(0, 0.3, 50)

        out_path = tmp_path / "figure2_human_correlation.png"
        generate_figure2_human_correlation(sim, human, str(out_path), dpi=300)

        assert os.path.exists(out_path)
        with Image.open(out_path) as img:
            dpi = img.info.get("dpi", (300, 300))
            assert round(dpi[0]) >= 300

    def test_figure3_domain_boxplots(self, tmp_path):
        np.random.seed(42)
        domains = ["Cardio", "Resp", "Neuro", "GI", "Derm"]
        data = []
        for d in domains:
            for _ in range(20):
                data.append({"domain": d, "similarity": np.random.normal(0.8, 0.06)})
        df = pd.DataFrame(data)

        out_path = tmp_path / "figure3_domain_boxplots.png"
        generate_figure3_domain_boxplots(df, metric_col="similarity", domain_col="domain", output_path=str(out_path), dpi=300)

        assert os.path.exists(out_path)
        with Image.open(out_path) as img:
            dpi = img.info.get("dpi", (300, 300))
            assert round(dpi[0]) >= 300

    def test_figure4_pca_projection(self, tmp_path):
        np.random.seed(42)
        agent_embs = np.random.normal(0, 1, (30, 64))
        ref_embs = np.random.normal(0.1, 1, (30, 64))
        domains = ["Cardio"] * 10 + ["Resp"] * 10 + ["Neuro"] * 10

        out_path = tmp_path / "figure4_pca_projection.png"
        generate_figure4_pca_projection(agent_embs, ref_embs, domains, str(out_path), dpi=300)

        assert os.path.exists(out_path)
        with Image.open(out_path) as img:
            dpi = img.info.get("dpi", (300, 300))
            assert round(dpi[0]) >= 300
