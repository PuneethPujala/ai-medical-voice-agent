"""
MedVoice Clinical Response Evaluation: Statistical Inference & Hypothesis Testing Engine.

Implements conversation-clustered bootstrapping (10,000 resamples), paired Wilcoxon
signed-rank tests, Benjamini-Hochberg FDR multiplicity correction, exploratory OLS
regression modeling, and calibrated semantic threshold optimization.
"""

from typing import Dict, List, Any, Optional, Union
import numpy as np
import pandas as pd
import scipy.stats as stats
import statsmodels.api as sm
from statsmodels.stats.multitest import multipletests


def compute_clustered_bootstrap_ci(
    df: pd.DataFrame,
    cluster_col: str,
    metric_col: str,
    stratify_col: Optional[str] = None,
    n_resamples: int = 10000,
    confidence_level: float = 0.95,
    seed: int = 42,
) -> Dict[str, Any]:
    """
    Computes conversation-level clustered bootstrap confidence intervals for primary
    and secondary evaluation metrics, accounting for intra-cluster correlation.

    Parameters
    ----------
    df : pd.DataFrame
        DataFrame containing evaluation metrics and cluster identifiers.
    cluster_col : str
        Column identifying the cluster unit (e.g. 'conversation_id').
    metric_col : str
        Metric column to evaluate (e.g. 'similarity_all_mpnet_base_v2').
    stratify_col : Optional[str]
        Optional column for stratified cluster resampling (e.g. 'domain').
    n_resamples : int
        Number of bootstrap iterations (default: 10,000).
    confidence_level : float
        Confidence level for percentile intervals (default: 0.95).
    seed : int
        Random seed for reproducibility.

    Returns
    -------
    Dict[str, Any]
        Dictionary containing point estimates and confidence bounds.
    """
    rng = np.random.default_rng(seed)
    alpha = 1.0 - confidence_level
    lower_pct = 100.0 * (alpha / 2.0)
    upper_pct = 100.0 * (1.0 - alpha / 2.0)

    # Point estimates
    sample_mean = float(df[metric_col].mean())
    macro_mean: Optional[float] = None
    if stratify_col and stratify_col in df.columns:
        macro_mean = float(df.groupby(stratify_col)[metric_col].mean().mean())

    # Map clusters to their corresponding rows
    cluster_to_indices = df.groupby(cluster_col).indices

    micro_means = np.zeros(n_resamples, dtype=float)
    macro_means = np.zeros(n_resamples, dtype=float) if macro_mean is not None else None

    if stratify_col and stratify_col in df.columns:
        # Map each cluster to its stratum
        cluster_stratum_df = df[[cluster_col, stratify_col]].drop_duplicates()
        stratum_to_clusters = cluster_stratum_df.groupby(stratify_col)[cluster_col].apply(list).to_dict()
        strata = list(stratum_to_clusters.keys())

        for b in range(n_resamples):
            resampled_row_indices = []
            for s in strata:
                clusters = stratum_to_clusters[s]
                k = len(clusters)
                sampled_clusters = rng.choice(clusters, size=k, replace=True)
                for c in sampled_clusters:
                    resampled_row_indices.extend(cluster_to_indices[c])

            resampled_df = df.iloc[resampled_row_indices]
            micro_means[b] = resampled_df[metric_col].mean()
            if macro_means is not None:
                macro_means[b] = resampled_df.groupby(stratify_col)[metric_col].mean().mean()
    else:
        unique_clusters = list(cluster_to_indices.keys())
        k = len(unique_clusters)
        for b in range(n_resamples):
            sampled_clusters = rng.choice(unique_clusters, size=k, replace=True)
            resampled_row_indices = []
            for c in sampled_clusters:
                resampled_row_indices.extend(cluster_to_indices[c])
            micro_means[b] = df.iloc[resampled_row_indices][metric_col].mean()

    ci_lower = float(np.percentile(micro_means, lower_pct))
    ci_upper = float(np.percentile(micro_means, upper_pct))

    result = {
        "mean": sample_mean,
        "ci_lower": ci_lower,
        "ci_upper": ci_upper,
        "n_resamples": n_resamples,
        "confidence_level": confidence_level,
    }

    if macro_mean is not None and macro_means is not None:
        result["macro_mean"] = macro_mean
        result["macro_ci_lower"] = float(np.percentile(macro_means, lower_pct))
        result["macro_ci_upper"] = float(np.percentile(macro_means, upper_pct))

    return result


def compute_paired_wilcoxon_tests(
    agent_scores: Union[List[float], np.ndarray],
    baseline_scores: Union[List[float], np.ndarray],
    zero_method: str = "wilcox",
) -> Dict[str, Any]:
    """
    Computes paired two-sided Wilcoxon signed-rank test comparing MedVoice
    semantic similarity against experimental control baselines.
    """
    a = np.asarray(agent_scores, dtype=float)
    b = np.asarray(baseline_scores, dtype=float)
    if len(a) != len(b):
        raise ValueError("Agent and baseline score arrays must have equal length")

    diffs = a - b
    median_diff = float(np.median(diffs))
    iqr_diff = float(np.percentile(diffs, 75) - np.percentile(diffs, 25))

    # Check trivial case where all diffs are 0
    if np.all(diffs == 0):
        return {
            "statistic": 0.0,
            "p_value": 1.0,
            "rank_biserial_r": 0.0,
            "median_diff": 0.0,
            "iqr_diff": 0.0,
            "n_pairs": len(a),
        }

    wilc_res = stats.wilcoxon(a, b, zero_method=zero_method, alternative="two-sided")

    # Compute rank-biserial correlation effect size: r = (W_+ - W_-) / (W_+ + W_-)
    nonzero_diffs = diffs[diffs != 0] if zero_method != "pratt" else diffs
    if len(nonzero_diffs) == 0:
        r_biserial = 0.0
    else:
        abs_diffs = np.abs(nonzero_diffs)
        ranks = stats.rankdata(abs_diffs)
        w_plus = np.sum(ranks[nonzero_diffs > 0])
        w_minus = np.sum(ranks[nonzero_diffs < 0])
        total_w = w_plus + w_minus
        r_biserial = float((w_plus - w_minus) / total_w) if total_w > 0 else 0.0

    return {
        "statistic": float(wilc_res.statistic),
        "p_value": float(wilc_res.pvalue),
        "rank_biserial_r": r_biserial,
        "median_diff": median_diff,
        "iqr_diff": iqr_diff,
        "n_pairs": len(a),
    }


def apply_benjamini_hochberg_fdr(
    p_values: Union[Dict[str, float], List[float]],
    alpha: float = 0.05,
) -> Dict[str, Dict[str, Any]]:
    """
    Applies Benjamini-Hochberg False Discovery Rate (FDR) multiplicity correction
    across secondary hypothesis tests and clinical domain slices.
    """
    if isinstance(p_values, dict):
        keys = list(p_values.keys())
        raw_list = [p_values[k] for k in keys]
    else:
        keys = [f"test_{i}" for i in range(len(p_values))]
        raw_list = list(p_values)

    reject, pvals_corrected, _, _ = multipletests(raw_list, alpha=alpha, method="fdr_bh")

    output: Dict[str, Dict[str, Any]] = {}
    for i, key in enumerate(keys):
        output[key] = {
            "raw_p_value": float(raw_list[i]),
            "adjusted_p_value": float(pvals_corrected[i]),
            "significant": bool(reject[i]),
            "alpha": alpha,
        }
    return output


def fit_exploratory_ols_regression(
    df: pd.DataFrame,
    dependent_var: str,
    covariates: List[str],
    categorical_covariates: Optional[List[str]] = None,
    cluster_col: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Fits an exploratory Ordinary Least Squares (OLS) regression quantifying the
    association between conversational covariates (e.g. response-length ratio,
    Delta FKGL) and semantic similarity.

    Framed strictly as exploratory covariate analysis, NOT causal inference.
    """
    work_df = df.copy()

    # Build design matrix with categorical dummies
    feature_cols: List[str] = list(covariates)
    if categorical_covariates:
        for cat_col in categorical_covariates:
            dummies = pd.get_dummies(work_df[cat_col], prefix=cat_col, drop_first=True, dtype=float)
            work_df = pd.concat([work_df, dummies], axis=1)
            feature_cols.extend(dummies.columns.tolist())

    X = work_df[feature_cols]
    X = sm.add_constant(X)
    y = work_df[dependent_var]

    model = sm.OLS(y, X)

    if cluster_col and cluster_col in work_df.columns:
        fitted = model.fit(cov_type="cluster", cov_kwds={"groups": work_df[cluster_col]})
    else:
        fitted = model.fit(cov_type="HC1")

    coefficients: Dict[str, Dict[str, float]] = {}
    for var_name in fitted.params.index:
        coefficients[var_name] = {
            "coef": float(fitted.params[var_name]),
            "std_err": float(fitted.bse[var_name]),
            "t_statistic": float(fitted.tvalues[var_name]),
            "p_value": float(fitted.pvalues[var_name]),
            "ci_lower": float(fitted.conf_int().loc[var_name, 0]),
            "ci_upper": float(fitted.conf_int().loc[var_name, 1]),
        }

    try:
        f_stat = float(fitted.fvalue) if not np.isnan(fitted.fvalue) else 0.0
    except Exception:
        f_stat = 0.0

    try:
        f_p = float(fitted.f_pvalue) if not np.isnan(fitted.f_pvalue) else 1.0
    except Exception:
        f_p = 1.0

    return {
        "dependent_variable": dependent_var,
        "r_squared": float(fitted.rsquared),
        "adj_r_squared": float(fitted.rsquared_adj),
        "f_statistic": f_stat,
        "f_pvalue": f_p,
        "n_observations": int(fitted.nobs),
        "coefficients": coefficients,
        "interpretation_note": (
            "Exploratory regression quantifying covariate associations with semantic similarity; "
            "not a causal inference model."
        ),
    }


def calibrate_semantic_threshold(
    similarity_scores: Union[List[float], np.ndarray],
    clinical_acceptability: Union[List[int], List[bool], np.ndarray],
    num_thresholds: int = 100,
    metric_to_maximize: str = "f1",
) -> Dict[str, Any]:
    """
    Calibrates empirical semantic alignment threshold (T_calib) maximizing F1
    or Accuracy against binary clinical acceptability ratings.
    """
    scores = np.asarray(similarity_scores, dtype=float)
    y_true = np.asarray(clinical_acceptability, dtype=int)

    if len(scores) != len(y_true):
        raise ValueError("Scores and acceptability arrays must have equal length")

    thresholds = np.linspace(0.0, 1.0, num_thresholds)
    curve: List[Dict[str, float]] = []

    best_thresh = 0.5
    best_metric_val = -1.0
    best_precision = 0.0
    best_recall = 0.0
    best_acc = 0.0

    for t in thresholds:
        y_pred = (scores >= t).astype(int)

        tp = int(np.sum((y_pred == 1) & (y_true == 1)))
        fp = int(np.sum((y_pred == 1) & (y_true == 0)))
        fn = int(np.sum((y_pred == 0) & (y_true == 1)))
        tn = int(np.sum((y_pred == 0) & (y_true == 0)))

        prec = float(tp / (tp + fp)) if (tp + fp) > 0 else 0.0
        rec = float(tp / (tp + fn)) if (tp + fn) > 0 else 0.0
        f1 = float(2 * prec * rec / (prec + rec)) if (prec + rec) > 0 else 0.0
        acc = float((tp + tn) / len(y_true)) if len(y_true) > 0 else 0.0

        curve.append({
            "threshold": float(t),
            "precision": prec,
            "recall": rec,
            "f1": f1,
            "accuracy": acc,
        })

        target_val = f1 if metric_to_maximize == "f1" else acc
        if target_val > best_metric_val:
            best_metric_val = target_val
            best_thresh = float(t)
            best_precision = prec
            best_recall = rec
            best_acc = acc

    return {
        "optimal_threshold": best_thresh,
        "max_f1": best_metric_val if metric_to_maximize == "f1" else (
            2 * best_precision * best_recall / (best_precision + best_recall)
            if (best_precision + best_recall) > 0 else 0.0
        ),
        "precision_at_threshold": best_precision,
        "recall_at_threshold": best_recall,
        "accuracy_at_threshold": best_acc,
        "metric_maximized": metric_to_maximize,
        "threshold_curve": curve,
    }
