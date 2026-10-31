"""
MedVoice Clinical Response Evaluation: Publication Visual Plot Generators.

Generates publication-ready figures (>= 300 DPI) using Matplotlib and Seaborn:
- Figure 1: KDE distribution overlay (MedVoice vs Random vs Templated).
- Figure 2: Scatterplot of semantic similarity vs clinician correctness with Spearman trendline.
- Figure 3: Stratified domain boxplots across 10 Chief Complaint categories.
- Figure 4: 2D PCA embedding projection for visual representation comparison.
"""

import os
from pathlib import Path
from typing import Dict, List, Any, Optional, Union
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
import scipy.stats as stats
from sklearn.decomposition import PCA


# Set clean academic publication styling
plt.rcParams.update({
    "font.family": "sans-serif",
    "font.size": 10,
    "axes.titlesize": 11,
    "axes.labelsize": 10,
    "xtick.labelsize": 9,
    "ytick.labelsize": 9,
    "legend.fontsize": 9,
    "figure.titlesize": 12,
})


def generate_figure1_kde_overlay(
    agent_scores: Union[List[float], np.ndarray],
    random_scores: Union[List[float], np.ndarray],
    templated_scores: Union[List[float], np.ndarray],
    output_path: str,
    dpi: int = 300,
) -> str:
    """
    Renders Figure 1: Kernel Density Estimate (KDE) and distribution overlay
    comparing MedVoice against experimental control baselines.
    """
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    fig, ax = plt.subplots(figsize=(7, 4.5), dpi=dpi)

    sns.kdeplot(
        data=agent_scores,
        ax=ax,
        color="#1f77b4",
        label="MedVoice (all-mpnet-base-v2)",
        fill=True,
        alpha=0.3,
        linewidth=2,
    )
    sns.kdeplot(
        data=random_scores,
        ax=ax,
        color="#d62728",
        label="Random Shuffled Baseline",
        fill=True,
        alpha=0.2,
        linewidth=2,
        linestyle="--",
    )
    sns.kdeplot(
        data=templated_scores,
        ax=ax,
        color="#ff7f0e",
        label="Templated Fallback Baseline",
        fill=True,
        alpha=0.2,
        linewidth=2,
        linestyle=":",
    )

    ax.set_title("Distribution of Semantic Cosine Similarity Against Physician Reference", fontweight="bold")
    ax.set_xlabel("Cosine Similarity")
    ax.set_ylabel("Kernel Density")
    ax.set_xlim(-0.2, 1.0)
    ax.legend(frameon=True, loc="upper left")
    ax.grid(True, linestyle=":", alpha=0.6)

    fig.tight_layout()
    fig.savefig(output_path, dpi=dpi)
    plt.close(fig)
    return output_path


def generate_figure2_human_correlation(
    similarity_scores: Union[List[float], np.ndarray],
    clinician_ratings: Union[List[float], np.ndarray],
    output_path: str,
    dpi: int = 300,
) -> str:
    """
    Renders Figure 2: Scatterplot of automated semantic similarity versus
    human clinician correctness ratings with Spearman rho correlation trendline.
    """
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    fig, ax = plt.subplots(figsize=(6.5, 4.5), dpi=dpi)

    sim = np.asarray(similarity_scores, dtype=float)
    human = np.asarray(clinician_ratings, dtype=float)

    spearman_res = stats.spearmanr(sim, human)
    rho = float(spearman_res.statistic) if hasattr(spearman_res, "statistic") else float(spearman_res[0])
    p_val = float(spearman_res.pvalue) if hasattr(spearman_res, "pvalue") else float(spearman_res[1])
    p_str = "< 0.001" if p_val < 0.001 else f"{p_val:.3f}"

    sns.regplot(
        x=sim,
        y=human,
        ax=ax,
        scatter_kws={"alpha": 0.6, "color": "#2ca02c", "s": 40},
        line_kws={"color": "#1b611b", "linewidth": 2},
    )

    ax.set_title("Automated Embedding Similarity vs. Expert Clinician Correctness", fontweight="bold")
    ax.set_xlabel("Automated Cosine Similarity (all-mpnet-base-v2)")
    ax.set_ylabel("Clinician Likert Correctness Rating (1-5)")
    ax.set_ylim(0.8, 5.2)

    # Annotate correlation statistics
    ax.text(
        0.05,
        0.90,
        f"Spearman $\\rho = {rho:.3f}$\n$p = {p_str}$",
        transform=ax.transAxes,
        fontsize=10,
        bbox=dict(boxstyle="round,pad=0.4", facecolor="white", edgecolor="#ccc", alpha=0.9),
    )
    ax.grid(True, linestyle=":", alpha=0.6)

    fig.tight_layout()
    fig.savefig(output_path, dpi=dpi)
    plt.close(fig)
    return output_path


def generate_figure3_domain_boxplots(
    df: pd.DataFrame,
    metric_col: str,
    domain_col: str,
    output_path: str,
    dpi: int = 300,
) -> str:
    """
    Renders Figure 3: Stratified performance across Chief Complaint clinical domains.
    """
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    fig, ax = plt.subplots(figsize=(10, 5), dpi=dpi)

    # Sort domains by median similarity for clear visualization
    order = df.groupby(domain_col)[metric_col].median().sort_values(ascending=False).index.tolist()

    sns.boxplot(
        data=df,
        x=domain_col,
        y=metric_col,
        hue=domain_col,
        legend=False,
        order=order,
        ax=ax,
        palette="Blues_r",
        fliersize=3,
        linewidth=1.2,
    )

    ax.set_title("Semantic Alignment Stratified by Chief Complaint Clinical Domain", fontweight="bold")
    ax.set_xlabel("Clinical Domain")
    ax.set_ylabel("Cosine Similarity")
    ax.set_xticks(range(len(order)))
    ax.set_xticklabels([d.replace("_", " ").title() for d in order], rotation=35, ha="right")
    ax.grid(True, linestyle=":", alpha=0.5, axis="y")

    fig.tight_layout()
    fig.savefig(output_path, dpi=dpi)
    plt.close(fig)
    return output_path


def generate_figure4_pca_projection(
    agent_embeddings: np.ndarray,
    reference_embeddings: np.ndarray,
    domains: List[str],
    output_path: str,
    dpi: int = 300,
) -> str:
    """
    Renders Figure 4: 2D PCA embedding projection for visual representation comparison.
    Explicitly labeled as an exploratory visualization without claiming ranking preservation.
    """
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    fig, ax = plt.subplots(figsize=(8, 5.5), dpi=dpi)

    combined = np.vstack([agent_embeddings, reference_embeddings])
    pca = PCA(n_components=2, random_state=42)
    proj = pca.fit_transform(combined)

    n = len(agent_embeddings)
    agent_proj = proj[:n]
    ref_proj = proj[n:]

    unique_domains = sorted(list(set(domains)))
    palette = sns.color_palette("tab10", len(unique_domains))
    domain_to_color = {d: palette[i] for i, d in enumerate(unique_domains)}

    for d in unique_domains:
        idxs = [i for i, dom in enumerate(domains) if dom == d]
        color = domain_to_color[d]

        # Plot Reference points as squares
        ax.scatter(
            ref_proj[idxs, 0],
            ref_proj[idxs, 1],
            color=color,
            marker="s",
            alpha=0.6,
            s=45,
            label=f"{d} (Physician)" if len(unique_domains) <= 4 else None,
        )
        # Plot Agent points as circles
        ax.scatter(
            agent_proj[idxs, 0],
            agent_proj[idxs, 1],
            color=color,
            marker="o",
            alpha=0.7,
            s=45,
            edgecolors="black",
            linewidth=0.5,
            label=f"{d} (MedVoice)" if len(unique_domains) <= 4 else None,
        )

    var1 = pca.explained_variance_ratio_[0] * 100
    var2 = pca.explained_variance_ratio_[1] * 100

    ax.set_title("2D Principal Component Projection of Clinical Embeddings", fontweight="bold")
    ax.set_xlabel(f"Principal Component 1 ({var1:.1f}% Variance)")
    ax.set_ylabel(f"Principal Component 2 ({var2:.1f}% Variance)")

    # Explanatory caption on ranking preservation
    ax.text(
        0.5,
        -0.18,
        "Note: 2D PCA projection illustrates geometric clustering. It is an exploratory visual comparison\n"
        "and does not preserve high-dimensional pairwise ranking preservation.",
        transform=ax.transAxes,
        ha="center",
        fontsize=8,
        style="italic",
        color="#555",
    )
    ax.grid(True, linestyle=":", alpha=0.5)

    fig.tight_layout()
    fig.savefig(output_path, dpi=dpi)
    plt.close(fig)
    return output_path


def generate_all_plots(
    evaluation_data: Dict[str, Any],
    output_dir: str,
    dpi: int = 300,
) -> Dict[str, str]:
    """
    Generates all 4 publication figures into the designated output directory.
    """
    out_dir = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    paths = {
        "figure1": str(out_dir / "figure1_kde_overlay.png"),
        "figure2": str(out_dir / "figure2_human_correlation.png"),
        "figure3": str(out_dir / "figure3_domain_boxplots.png"),
        "figure4": str(out_dir / "figure4_pca_projection.png"),
    }

    if "figure1" in evaluation_data:
        f1_data = evaluation_data["figure1"]
        generate_figure1_kde_overlay(
            f1_data["agent"],
            f1_data["random"],
            f1_data["templated"],
            paths["figure1"],
            dpi=dpi,
        )

    if "figure2" in evaluation_data:
        f2_data = evaluation_data["figure2"]
        generate_figure2_human_correlation(
            f2_data["similarity"],
            f2_data["human"],
            paths["figure2"],
            dpi=dpi,
        )

    if "figure3" in evaluation_data:
        f3_data = evaluation_data["figure3"]
        generate_figure3_domain_boxplots(
            f3_data["df"],
            f3_data["metric_col"],
            f3_data["domain_col"],
            paths["figure3"],
            dpi=dpi,
        )

    if "figure4" in evaluation_data:
        f4_data = evaluation_data["figure4"]
        generate_figure4_pca_projection(
            f4_data["agent_embs"],
            f4_data["ref_embs"],
            f4_data["domains"],
            paths["figure4"],
            dpi=dpi,
        )

    return paths
