"""
MedVoice Clinical Response Evaluation Framework
Task 4: Automated Embedding & Multi-Metric Similarity Engine Test Suite

Verifies:
1. Cosine similarity bounded strictly in [-1, 1], never represented as percentage.
2. Identical vectors yield cosine similarity 1.0; orthogonal yield 0.0.
3. Response-length ratio (W_agent / W_physician) safely handles division by zero.
4. Readability metrics (FKGL and Delta FKGL) computation.
5. ClinicalEmbedder produces correct dimensions (768-dim for all-mpnet-base-v2).
6. PCA projection produces valid 2D coordinates for visual projection without ranking assumptions.
7. Similarity matrix pipeline generates structured pandas DataFrame with required metric columns.
"""

import pytest
import numpy as np
import pandas as pd

from eval.metrics.readability import (
    count_words,
    calculate_fkgl,
    calculate_response_length_ratio,
    calculate_delta_fkgl,
)
from eval.metrics.similarity import (
    cosine_similarity_pairs,
    euclidean_distance_pairs,
    compute_pca_projection,
    compute_similarity_dataframe,
)
from eval.metrics.embedder import ClinicalEmbedder, PRIMARY_EMBEDDING_MODEL


class TestReadabilityAndLengthMetrics:
    def test_count_words_standard(self):
        assert count_words("The patient presents with severe shortness of breath.") == 8
        assert count_words("   ") == 0
        assert count_words("") == 0

    def test_calculate_fkgl_valid(self):
        text = "The patient presents with acute coronary syndrome and requires emergency aspirin administration."
        fkgl = calculate_fkgl(text)
        assert isinstance(fkgl, float)
        assert fkgl > 0.0

    def test_calculate_response_length_ratio_normal(self):
        # 30 agent words / 60 physician words = 0.5
        ratio = calculate_response_length_ratio(30, 60)
        assert pytest.approx(ratio, 0.001) == 0.5

    def test_calculate_response_length_ratio_zero_physician_raises(self):
        with pytest.raises(ValueError, match="Physician word count must be greater than zero"):
            calculate_response_length_ratio(30, 0)

    def test_calculate_delta_fkgl(self):
        # Agent FKGL = 8.5, Physician FKGL = 10.5 -> delta = -2.0
        delta = calculate_delta_fkgl(8.5, 10.5)
        assert pytest.approx(delta, 0.001) == -2.0


class TestVectorSimilarityCalculations:
    def test_cosine_similarity_identical_vectors(self):
        vec_a = np.array([[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]])
        vec_b = np.array([[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]])
        sim = cosine_similarity_pairs(vec_a, vec_b)
        np.testing.assert_allclose(sim, [1.0, 1.0], atol=1e-6)

    def test_cosine_similarity_orthogonal_vectors(self):
        vec_a = np.array([[1.0, 0.0, 0.0]])
        vec_b = np.array([[0.0, 1.0, 0.0]])
        sim = cosine_similarity_pairs(vec_a, vec_b)
        np.testing.assert_allclose(sim, [0.0], atol=1e-6)

    def test_cosine_similarity_opposite_vectors(self):
        vec_a = np.array([[1.0, 2.0, 3.0]])
        vec_b = np.array([[-1.0, -2.0, -3.0]])
        sim = cosine_similarity_pairs(vec_a, vec_b)
        np.testing.assert_allclose(sim, [-1.0], atol=1e-6)

    def test_euclidean_distance(self):
        vec_a = np.array([[0.0, 0.0], [1.0, 1.0]])
        vec_b = np.array([[3.0, 4.0], [1.0, 1.0]])
        dist = euclidean_distance_pairs(vec_a, vec_b)
        np.testing.assert_allclose(dist, [5.0, 0.0], atol=1e-6)

    def test_mismatched_dimensions_raise(self):
        vec_a = np.array([[1.0, 0.0]])
        vec_b = np.array([[1.0, 0.0, 0.0]])
        with pytest.raises(ValueError, match="dimension mismatch"):
            cosine_similarity_pairs(vec_a, vec_b)


class TestPCAProjection:
    def test_pca_projection_dimension(self):
        # 10 samples with 16 features -> project to 2D
        rng = np.random.RandomState(42)
        embeddings = rng.randn(10, 16)
        coords = compute_pca_projection(embeddings, n_components=2)
        assert coords.shape == (10, 2)

    def test_pca_projection_reproducible(self):
        rng = np.random.RandomState(42)
        embeddings = rng.randn(5, 8)
        c1 = compute_pca_projection(embeddings, n_components=2, seed=42)
        c2 = compute_pca_projection(embeddings, n_components=2, seed=42)
        np.testing.assert_allclose(c1, c2)


class TestClinicalEmbedder:
    def test_primary_model_name(self):
        assert PRIMARY_EMBEDDING_MODEL == "sentence-transformers/all-mpnet-base-v2"

    def test_embedder_dimension(self):
        embedder = ClinicalEmbedder(mock_mode=True, embedding_dim=768)
        texts = ["Patient presents with chest pain.", "Patient has a mild cough."]
        embs = embedder.encode(texts)
        assert isinstance(embs, np.ndarray)
        assert embs.shape == (2, 768)
        # Verify L2 normalized
        norms = np.linalg.norm(embs, axis=1)
        np.testing.assert_allclose(norms, [1.0, 1.0], atol=1e-5)


class TestSimilarityDataFramePipeline:
    def test_compute_similarity_dataframe(self):
        embedder = ClinicalEmbedder(mock_mode=True, embedding_dim=768)
        agent_texts = [
            "Please rest and take acetaminophen for your headache.",
            "You should go to the emergency room immediately for your chest pain.",
        ]
        physician_texts = [
            "Take 500mg paracetamol and sleep in a dark quiet room.",
            "This sounds like an acute coronary event. Call emergency medical services right away.",
        ]
        ids = ["MED-EVAL-0001", "MED-EVAL-0002"]
        domains = ["Neurological", "Cardiovascular"]

        df = compute_similarity_dataframe(
            ids=ids,
            agent_texts=agent_texts,
            physician_texts=physician_texts,
            domains=domains,
            embedder=embedder,
        )

        assert isinstance(df, pd.DataFrame)
        assert len(df) == 2
        expected_cols = [
            "id",
            "domain",
            "agent_text",
            "physician_text",
            "agent_word_count",
            "physician_word_count",
            "response_length_ratio",
            "agent_fkgl",
            "physician_fkgl",
            "delta_fkgl",
            "cosine_similarity",
            "euclidean_distance",
        ]
        for col in expected_cols:
            assert col in df.columns, f"Missing column: {col}"

        # Cosine similarity must be between -1.0 and 1.0
        assert (df["cosine_similarity"] >= -1.0).all()
        assert (df["cosine_similarity"] <= 1.0).all()

        # Check response-length ratios are positive
        assert (df["response_length_ratio"] > 0).all()
