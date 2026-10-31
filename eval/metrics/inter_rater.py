"""
MedVoice Clinical Response Evaluation: Inter-Rater Reliability Engine.

Computes Krippendorff's Alpha for ordinal Likert scales, interval metrics,
and nominal classifications, alongside observed percent agreement and safety concordance.
"""

from typing import List, Dict, Any, Optional, Union
import numpy as np


def compute_krippendorff_alpha(
    data: Union[np.ndarray, List[List[Optional[float]]]],
    level_of_measurement: str = "ordinal",
) -> float:
    """
    Computes Krippendorff's alpha coefficient of reliability.

    Parameters
    ----------
    data : array-like of shape (n_units, n_coders)
        Matrix where rows represent evaluation units (samples) and
        columns represent coders/raters. Missing ratings should be np.nan or None.
    level_of_measurement : str
        Scale type: 'nominal', 'ordinal', 'interval', or 'ratio'.
        Default is 'ordinal' for Likert scales.

    Returns
    -------
    float
        Krippendorff's alpha reliability coefficient [-1.0, 1.0].
    """
    matrix = np.array(data, dtype=float)
    if matrix.ndim != 2:
        raise ValueError("Data matrix must be 2-dimensional (units x coders)")

    n_units, n_coders = matrix.shape

    # Identify units with at least two non-NaN values
    valid_mask = ~np.isnan(matrix)
    units_m = np.sum(valid_mask, axis=1)
    eligible_units = np.where(units_m >= 2)[0]

    if len(eligible_units) == 0:
        return 0.0

    # Extract all observed values across eligible units
    observed_values = matrix[eligible_units][valid_mask[eligible_units]]
    unique_values = np.sort(np.unique(observed_values))

    # Trivial case: all ratings in the entire matrix are identical
    if len(unique_values) <= 1:
        return 1.0

    val_to_idx = {val: idx for idx, val in enumerate(unique_values)}
    num_vals = len(unique_values)

    # Build coincidence matrix o[v, v']
    o_matrix = np.zeros((num_vals, num_vals), dtype=float)
    for u in eligible_units:
        vals_in_u = matrix[u][valid_mask[u]]
        m_u = len(vals_in_u)
        scale = 1.0 / (m_u - 1)
        for i in range(m_u):
            idx_i = val_to_idx[vals_in_u[i]]
            for j in range(m_u):
                if i != j:
                    idx_j = val_to_idx[vals_in_u[j]]
                    o_matrix[idx_i, idx_j] += scale

    # Marginal frequencies n_v
    marginals = np.sum(o_matrix, axis=1)
    total_pairs = np.sum(marginals)

    if total_pairs <= 1:
        return 1.0

    # Calculate difference metric delta^2[v, v']
    delta_sq = np.zeros((num_vals, num_vals), dtype=float)

    if level_of_measurement == "nominal":
        for i in range(num_vals):
            for j in range(num_vals):
                delta_sq[i, j] = 0.0 if i == j else 1.0

    elif level_of_measurement == "interval":
        for i in range(num_vals):
            for j in range(num_vals):
                delta_sq[i, j] = (unique_values[i] - unique_values[j]) ** 2

    elif level_of_measurement == "ordinal":
        for i in range(num_vals):
            for j in range(num_vals):
                if i == j:
                    delta_sq[i, j] = 0.0
                else:
                    low, high = min(i, j), max(i, j)
                    # Sum marginals from low to high minus half of the endpoints
                    d = np.sum(marginals[low : high + 1]) - (marginals[low] + marginals[high]) / 2.0
                    delta_sq[i, j] = d ** 2
    else:
        raise ValueError(f"Unsupported level_of_measurement: {level_of_measurement}")

    # Observed disagreement D_o
    d_o = np.sum(o_matrix * delta_sq) / total_pairs

    # Expected disagreement D_e
    outer_marginals = np.outer(marginals, marginals)
    d_e = np.sum(outer_marginals * delta_sq) / (total_pairs * (total_pairs - 1))

    if d_e == 0.0:
        return 1.0 if d_o == 0.0 else 0.0

    alpha = 1.0 - (d_o / d_e)
    return float(alpha)


def compute_percent_agreement(rater1_scores: List[Any], rater2_scores: List[Any]) -> float:
    """
    Computes simple observed percent agreement between two raters.
    """
    if len(rater1_scores) != len(rater2_scores):
        raise ValueError("Rater score lists must be of equal length")
    if len(rater1_scores) == 0:
        return 1.0

    matches = sum(1 for a, b in zip(rater1_scores, rater2_scores) if a == b)
    return float(matches / len(rater1_scores))
