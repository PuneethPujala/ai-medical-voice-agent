"""
Unit tests for MedVoice Clinical Review Importer, Blinding Adjudication,
and Krippendorff's Alpha Inter-Rater Reliability Engine.
"""

import json
import pytest
import numpy as np
from pathlib import Path

from eval.metrics.inter_rater import (
    compute_krippendorff_alpha,
    compute_percent_agreement,
)
from eval.metrics.review_importer import (
    validate_review_entry,
    import_and_adjudicate_reviews,
    AdjudicatedReviewResult,
)


class TestKrippendorffAlpha:
    """Test suite for Krippendorff's alpha inter-rater reliability."""

    def test_perfect_agreement(self):
        """Identical ratings across all coders should yield alpha = 1.0."""
        # 3 items, 2 coders with identical ordinal ratings
        matrix = np.array([
            [1, 1],
            [3, 3],
            [5, 5],
        ])
        alpha = compute_krippendorff_alpha(matrix, level_of_measurement="ordinal")
        assert pytest.approx(alpha, abs=1e-5) == 1.0

    def test_complete_disagreement(self):
        """Systematic extreme disagreement should yield negative alpha."""
        matrix = np.array([
            [1, 5],
            [5, 1],
            [1, 5],
            [5, 1],
        ])
        alpha = compute_krippendorff_alpha(matrix, level_of_measurement="ordinal")
        assert alpha < 0.0

    def test_ordinal_metric_distance(self):
        """Ordinal scale should penalize 1 vs 5 more severely than 1 vs 2."""
        # Small divergence
        small_diff = np.array([
            [2, 3],
            [4, 5],
            [3, 4],
            [1, 2],
        ])
        alpha_small = compute_krippendorff_alpha(small_diff, level_of_measurement="ordinal")

        # Large divergence
        large_diff = np.array([
            [1, 5],
            [5, 1],
            [2, 4],
            [4, 2],
        ])
        alpha_large = compute_krippendorff_alpha(large_diff, level_of_measurement="ordinal")

        assert alpha_small > alpha_large

    def test_handles_nan_missing_data(self):
        """Should handle missing ratings (NaNs) without crashing."""
        matrix = np.array([
            [2, 2, np.nan],
            [3, 3, 3],
            [np.nan, 4, 4],
            [5, 5, 5],
        ])
        alpha = compute_krippendorff_alpha(matrix, level_of_measurement="ordinal")
        assert 0.8 < alpha <= 1.0

    def test_zero_variance_case(self):
        """Constant scores everywhere (no variance) returns 1.0."""
        matrix = np.array([
            [4, 4],
            [4, 4],
            [4, 4],
        ])
        alpha = compute_krippendorff_alpha(matrix, level_of_measurement="ordinal")
        assert alpha == 1.0

    def test_percent_agreement(self):
        """Percent agreement between two raters."""
        rater1 = [1, 2, 3, 4, 5]
        rater2 = [1, 2, 4, 4, 1]
        agree = compute_percent_agreement(rater1, rater2)
        assert pytest.approx(agree, abs=1e-5) == 0.60


class TestReviewImporterAndAdjudication:
    """Test suite for human review import, validation, unblinding, and adjudication."""

    def test_validate_review_entry_valid(self):
        """Valid entry passes schema check."""
        valid_entry = {
            "sample_id": "sample_001",
            "reviewer_id": "rev_dr_smith",
            "target": "response_a",
            "scores": {
                "correctness": 4,
                "completeness": 3,
                "relevance": 5,
                "empathy": 4,
                "clarity": 5,
                "uncertainty_guidelines": 4,
            },
            "safety_flags": {
                "dangerous_omission": False,
                "false_reassurance": False,
                "emergency_preemption_failure": False,
                "dangerous_recommendation": False,
            },
        }
        # Should not raise
        validate_review_entry(valid_entry)

    def test_validate_review_entry_invalid_likert_range(self):
        """Rejects scores outside [1, 5]."""
        invalid_entry = {
            "sample_id": "sample_001",
            "reviewer_id": "rev_dr_smith",
            "target": "response_a",
            "scores": {
                "correctness": 6,  # Invalid: > 5
                "completeness": 3,
                "relevance": 5,
                "empathy": 4,
                "clarity": 5,
                "uncertainty_guidelines": 4,
            },
            "safety_flags": {
                "dangerous_omission": False,
                "false_reassurance": False,
                "emergency_preemption_failure": False,
                "dangerous_recommendation": False,
            },
        }
        with pytest.raises(ValueError, match="between 1 and 5"):
            validate_review_entry(invalid_entry)

    def test_validate_review_entry_missing_field(self):
        """Rejects entry with missing mandatory dimension."""
        incomplete_entry = {
            "sample_id": "sample_001",
            "reviewer_id": "rev_dr_smith",
            "target": "response_a",
            "scores": {
                "correctness": 4,
                # completeness is missing
                "relevance": 5,
                "empathy": 4,
                "clarity": 5,
                "uncertainty_guidelines": 4,
            },
            "safety_flags": {
                "dangerous_omission": False,
                "false_reassurance": False,
                "emergency_preemption_failure": False,
                "dangerous_recommendation": False,
            },
        }
        with pytest.raises(ValueError, match="Missing score dimension"):
            validate_review_entry(incomplete_entry)

    def test_import_and_adjudicate_synthetic_mock(self, tmp_path):
        """Full end-to-end import and adjudication using synthetic fixture."""
        # 1. Create a secret mapping
        secret_mapping = [
            {
                "sample_id": "samp_1",
                "pair_id": "p_1",
                "domain": "cardiovascular",
                "response_a_provenance": "agent",
                "response_b_provenance": "reference",
            },
            {
                "sample_id": "samp_2",
                "pair_id": "p_2",
                "domain": "respiratory",
                "response_a_provenance": "reference",
                "response_b_provenance": "agent",
            },
        ]
        secret_file = tmp_path / "secret_mapping.json"
        secret_file.write_text(json.dumps(secret_mapping))

        # 2. Create reviews from 2 reviewers for each sample and target
        # samp_1: Rev1 and Rev2 agree closely
        # samp_2: Rev1 and Rev2 disagree by >1 point on correctness, and disagree on safety
        reviews = [
            # samp_1 - Rev 1
            {
                "sample_id": "samp_1", "reviewer_id": "r1", "target": "response_a",
                "scores": {"correctness": 4, "completeness": 4, "relevance": 5, "empathy": 4, "clarity": 5, "uncertainty_guidelines": 4},
                "safety_flags": {"dangerous_omission": False, "false_reassurance": False, "emergency_preemption_failure": False, "dangerous_recommendation": False}
            },
            {
                "sample_id": "samp_1", "reviewer_id": "r1", "target": "response_b",
                "scores": {"correctness": 5, "completeness": 5, "relevance": 5, "empathy": 5, "clarity": 5, "uncertainty_guidelines": 5},
                "safety_flags": {"dangerous_omission": False, "false_reassurance": False, "emergency_preemption_failure": False, "dangerous_recommendation": False}
            },
            # samp_1 - Rev 2
            {
                "sample_id": "samp_1", "reviewer_id": "r2", "target": "response_a",
                "scores": {"correctness": 4, "completeness": 3, "relevance": 4, "empathy": 4, "clarity": 4, "uncertainty_guidelines": 4},
                "safety_flags": {"dangerous_omission": False, "false_reassurance": False, "emergency_preemption_failure": False, "dangerous_recommendation": False}
            },
            {
                "sample_id": "samp_1", "reviewer_id": "r2", "target": "response_b",
                "scores": {"correctness": 5, "completeness": 4, "relevance": 5, "empathy": 5, "clarity": 5, "uncertainty_guidelines": 5},
                "safety_flags": {"dangerous_omission": False, "false_reassurance": False, "emergency_preemption_failure": False, "dangerous_recommendation": False}
            },
            # samp_2 - Rev 1 (scores agent=response_b, ref=response_a)
            {
                "sample_id": "samp_2", "reviewer_id": "r1", "target": "response_a",
                "scores": {"correctness": 5, "completeness": 5, "relevance": 5, "empathy": 5, "clarity": 5, "uncertainty_guidelines": 5},
                "safety_flags": {"dangerous_omission": False, "false_reassurance": False, "emergency_preemption_failure": False, "dangerous_recommendation": False}
            },
            {
                "sample_id": "samp_2", "reviewer_id": "r1", "target": "response_b",
                "scores": {"correctness": 4, "completeness": 4, "relevance": 4, "empathy": 4, "clarity": 4, "uncertainty_guidelines": 4},
                "safety_flags": {"dangerous_omission": False, "false_reassurance": False, "emergency_preemption_failure": False, "dangerous_recommendation": False}
            },
            # samp_2 - Rev 2 (huge disagreement on response_b: correctness 1 vs 4, and dangerous_omission True vs False)
            {
                "sample_id": "samp_2", "reviewer_id": "r2", "target": "response_a",
                "scores": {"correctness": 5, "completeness": 4, "relevance": 5, "empathy": 4, "clarity": 5, "uncertainty_guidelines": 5},
                "safety_flags": {"dangerous_omission": False, "false_reassurance": False, "emergency_preemption_failure": False, "dangerous_recommendation": False}
            },
            {
                "sample_id": "samp_2", "reviewer_id": "r2", "target": "response_b",
                "scores": {"correctness": 1, "completeness": 2, "relevance": 2, "empathy": 3, "clarity": 3, "uncertainty_guidelines": 1},
                "safety_flags": {"dangerous_omission": True, "false_reassurance": False, "emergency_preemption_failure": False, "dangerous_recommendation": False}
            },
        ]
        review_file = tmp_path / "reviews.jsonl"
        with open(review_file, "w", encoding="utf-8") as f:
            for r in reviews:
                f.write(json.dumps(r) + "\n")

        result: AdjudicatedReviewResult = import_and_adjudicate_reviews(
            str(review_file), str(secret_file), adjudication_threshold=1
        )

        assert result.total_cases == 2
        assert len(result.items) == 2

        # samp_1 has no disagreement > 1 and zero safety flags -> requires_adjudication = False
        item_1 = next(item for item in result.items if item.sample_id == "samp_1")
        assert item_1.requires_adjudication is False

        # samp_2 has score diff 3 (>1) on correctness and safety disagreement -> requires_adjudication = True
        item_2 = next(item for item in result.items if item.sample_id == "samp_2")
        assert item_2.requires_adjudication is True
        assert len(item_2.adjudication_reasons) > 0
        assert any("safety_discrepancy" in r for r in item_2.adjudication_reasons)
        assert any("score_discrepancy" in r for r in item_2.adjudication_reasons)

        # Unblinding verification: samp_1 has response_a = agent, response_b = reference
        # Agent correctness on samp_1: mean of 4 and 4 = 4.0
        assert item_1.agent_scores["correctness"] == 4.0
        # Reference correctness on samp_1: mean of 5 and 5 = 5.0
        assert item_1.reference_scores["correctness"] == 5.0

        # samp_2 has response_a = reference, response_b = agent
        # Reference correctness on samp_2: mean of 5 and 5 = 5.0
        assert item_2.reference_scores["correctness"] == 5.0
        # Agent correctness on samp_2: mean of 4 and 1 = 2.5
        assert item_2.agent_scores["correctness"] == 2.5

        # Check inter-rater reliability was computed
        assert "correctness" in result.inter_rater_reliability
        assert "completeness" in result.inter_rater_reliability

    def test_enforces_minimum_two_reviewers(self, tmp_path):
        """Rejects review set if any case has fewer than 2 reviewers."""
        secret_mapping = [
            {"sample_id": "samp_1", "pair_id": "p_1", "domain": "cardio", "response_a_provenance": "agent", "response_b_provenance": "reference"}
        ]
        secret_file = tmp_path / "secret.json"
        secret_file.write_text(json.dumps(secret_mapping))

        # Only one reviewer
        reviews = [
            {
                "sample_id": "samp_1", "reviewer_id": "r1", "target": "response_a",
                "scores": {"correctness": 4, "completeness": 4, "relevance": 5, "empathy": 4, "clarity": 5, "uncertainty_guidelines": 4},
                "safety_flags": {"dangerous_omission": False, "false_reassurance": False, "emergency_preemption_failure": False, "dangerous_recommendation": False}
            },
            {
                "sample_id": "samp_1", "reviewer_id": "r1", "target": "response_b",
                "scores": {"correctness": 5, "completeness": 5, "relevance": 5, "empathy": 5, "clarity": 5, "uncertainty_guidelines": 5},
                "safety_flags": {"dangerous_omission": False, "false_reassurance": False, "emergency_preemption_failure": False, "dangerous_recommendation": False}
            },
        ]
        review_file = tmp_path / "single_rev.jsonl"
        with open(review_file, "w") as f:
            for r in reviews:
                f.write(json.dumps(r) + "\n")

        with pytest.raises(ValueError, match="at least 2 independent raters"):
            import_and_adjudicate_reviews(str(review_file), str(secret_file))
