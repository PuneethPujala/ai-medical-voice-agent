"""
MedVoice Clinical Response Evaluation Framework
Multi-Metric Similarity Engine & Visualization Projections

Primary Metric:
- Cosine Similarity on all-mpnet-base-v2 (reported strictly as numeric similarity in [-1, 1],
  never as a percentage or clinical accuracy score).

Secondary Metrics & Covariates:
- Euclidean Distance
- Response-Length Ratio (W_agent / W_physician)
- Delta Flesch-Kincaid Grade Level (FKGL)
- Principal Component Analysis (PCA) for 2D/3D visual projection only (not ranking test).
"""

from typing import List, Optional
import numpy as np
import pandas as pd
from sklearn.decomposition import PCA

from eval.metrics.readability import (
    count_words,
    calculate_fkgl,
    calculate_response_length_ratio,
    calculate_delta_fkgl,
)
from eval.metrics.embedder import ClinicalEmbedder, PRIMARY_EMBEDDING_MODEL


def cosine_similarity_pairs(vec_a: np.ndarray, vec_b: np.ndarray) -> np.ndarray:
    """
    Computes row-wise paired cosine similarity between two 2D numpy arrays.
    Returns 1D array of float scores in [-1.0, 1.0].

    Invariant: Must NEVER be multiplied by 100 or labeled as percentage/accuracy.
    """
    if vec_a.shape != vec_b.shape:
        raise ValueError(
            f"Vector shape dimension mismatch: vec_a shape {vec_a.shape} vs vec_b shape {vec_b.shape}"
        )

    norm_a = np.linalg.norm(vec_a, axis=1, keepdims=True)
    norm_b = np.linalg.norm(vec_b, axis=1, keepdims=True)

    # Prevent division by zero
    norm_a = np.where(norm_a == 0, 1e-12, norm_a)
    norm_b = np.where(norm_b == 0, 1e-12, norm_b)

    dot_products = np.sum(vec_a * vec_b, axis=1, keepdims=True)
    cosine_sim = dot_products / (norm_a * norm_b)
    flattened = cosine_sim.flatten()

    # Numerical clip to [-1.0, 1.0]
    return np.clip(flattened, -1.0, 1.0)


def euclidean_distance_pairs(vec_a: np.ndarray, vec_b: np.ndarray) -> np.ndarray:
    """
    Computes row-wise paired Euclidean distance between two 2D numpy arrays.
    """
    if vec_a.shape != vec_b.shape:
        raise ValueError(
            f"Vector shape dimension mismatch: vec_a shape {vec_a.shape} vs vec_b shape {vec_b.shape}"
        )

    diff = vec_a - vec_b
    return np.linalg.norm(diff, axis=1)


def compute_pca_projection(
    embeddings: np.ndarray, n_components: int = 2, seed: int = 42
) -> np.ndarray:
    """
    Computes linear PCA projection for 2D/3D visual distribution scatterplots.

    Scientific Method Note:
    PCA is used STRICTLY for low-dimensional visualization and cluster inspection.
    It is NOT an arbiter of semantic ranking preservation.
    """
    if embeddings.shape[0] < n_components:
        raise ValueError(
            f"Number of samples ({embeddings.shape[0]}) must be >= n_components ({n_components})"
        )

    pca = PCA(n_components=n_components, random_state=seed)
    return pca.fit_transform(embeddings)


def compute_similarity_dataframe(
    ids: List[str],
    agent_texts: List[str],
    physician_texts: List[str],
    domains: List[str],
    embedder: Optional[ClinicalEmbedder] = None,
    model_name: str = PRIMARY_EMBEDDING_MODEL,
) -> pd.DataFrame:
    """
    Computes full evaluation metrics table for a paired cohort.

    Generates:
    - Primary endpoint: cosine_similarity
    - Euclidean distance
    - Response-length ratio (W_agent / W_physician)
    - Reading grade levels and Delta FKGL
    """
    n = len(ids)
    if not (len(agent_texts) == len(physician_texts) == len(domains) == n):
        raise ValueError("All input arrays (ids, agent_texts, physician_texts, domains) must have equal length.")

    if embedder is None:
        embedder = ClinicalEmbedder(default_model=model_name)

    # 1. Compute embeddings
    agent_embs = embedder.encode(agent_texts, model_name=model_name)
    phys_embs = embedder.encode(physician_texts, model_name=model_name)

    # 2. Vector similarities
    cosine_sims = cosine_similarity_pairs(agent_embs, phys_embs)
    euclidean_dists = euclidean_distance_pairs(agent_embs, phys_embs)

    # 3. Readability & length covariates
    records = []
    for i in range(n):
        ag_text = agent_texts[i]
        ph_text = physician_texts[i]

        ag_wc = count_words(ag_text)
        ph_wc = count_words(ph_text)

        # Handle edge case where physician reference has 0 words
        length_ratio = (
            calculate_response_length_ratio(ag_wc, ph_wc)
            if ph_wc > 0
            else 0.0
        )

        ag_fkgl = calculate_fkgl(ag_text)
        ph_fkgl = calculate_fkgl(ph_text)
        delta_fkgl = calculate_delta_fkgl(ag_fkgl, ph_fkgl)

        records.append({
            "id": ids[i],
            "domain": domains[i],
            "agent_text": ag_text,
            "physician_text": ph_text,
            "agent_word_count": ag_wc,
            "physician_word_count": ph_wc,
            "response_length_ratio": length_ratio,
            "agent_fkgl": ag_fkgl,
            "physician_fkgl": ph_fkgl,
            "delta_fkgl": delta_fkgl,
            "cosine_similarity": round(float(cosine_sims[i]), 4),
            "euclidean_distance": round(float(euclidean_dists[i]), 4),
        })

    return pd.DataFrame(records)
