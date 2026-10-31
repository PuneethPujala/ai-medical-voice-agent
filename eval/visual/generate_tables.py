"""
MedVoice Clinical Response Evaluation: Publication LaTeX Table Exporters.

Generates publication-quality LaTeX tables conforming to clinical research standards,
with booktabs formatting, bootstrapped confidence intervals, multiplicity-adjusted
p-values, and explicit methodological declarations.
"""

import os
from pathlib import Path
from typing import Dict, Any, Optional


def export_table1_main_results(table_data: Dict[str, Any], output_path: str) -> str:
    """
    Exports Table 1: Primary Semantic Alignment Results across models and baselines.
    Reports Micro- and Macro-averages with 95% clustered bootstrap CIs and Benjamini-Hochberg FDR q-values.
    """
    rows = []
    for model_name, stats in table_data.items():
        micro_str = f"{stats['micro_mean']:.3f} [{stats['micro_ci'][0]:.3f}, {stats['micro_ci'][1]:.3f}]"
        macro_str = f"{stats['macro_mean']:.3f} [{stats['macro_ci'][0]:.3f}, {stats['macro_ci'][1]:.3f}]"
        p_val = stats.get("wilcoxon_p", 1.0)
        p_str = "< 0.001" if p_val < 0.001 else f"{p_val:.3f}"
        q_val = stats.get("fdr_q", 1.0)
        q_str = "< 0.001" if q_val < 0.001 else f"{q_val:.3f}"
        eff_str = f"{stats.get('effect_size_r', 0.0):.2f}"

        safe_model = model_name.replace("_", "\\_")
        rows.append(f"{safe_model} & {micro_str} & {macro_str} & {p_str} & {q_str} & {eff_str} \\\\")

    rows_latex = "\n".join(rows)

    latex = f"""\\begin{{table}}[htbp]
\\centering
\\small
\\caption{{Primary Evaluation: Semantic Alignment Against Physician Reference Dialogue}}
\\label{{tab:main_results}}
\\begin{{tabular}}{{lccccc}}
\\toprule
\\textbf{{Model / Baseline}} & \\textbf{{Micro Mean [95\\% CI]}} & \\textbf{{Macro Mean [95\\% CI]}} & \\textbf{{Wilcoxon $p$}} & \\textbf{{FDR $q$}} & \\textbf{{Effect Size ($r$)}} \\\\
\\midrule
{rows_latex}
\\bottomrule
\\end{{tabular}}
\\begin{{tablenotes}}
\\footnotesize
\\item \\textit{{Note}}: Primary prespecified endpoint is \\texttt{{all-mpnet-base-v2}} cosine similarity. 95\\% confidence intervals derived from 10,000 conversation-clustered bootstrap resamples stratified by clinical domain. $p$-values reflect paired Wilcoxon signed-rank tests against the random shuffled baseline; $q$-values reflect Benjamini-Hochberg FDR multiplicity adjustment.
\\end{{tablenotes}}
\\end{{table}}
"""
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(latex)
    return latex


def export_table2_domain_slices(domain_data: Dict[str, Any], output_path: str) -> str:
    """
    Exports Table 2: Performance Stratified Across 10 Chief Complaint Clinical Domains.
    """
    rows = []
    for domain, stats in domain_data.items():
        ci = stats.get("ci", (stats["similarity"], stats["similarity"]))
        sim_str = f"{stats['similarity']:.3f} [{ci[0]:.3f}, {ci[1]:.3f}]"
        len_str = f"{stats.get('length_ratio', 1.0):.2f}"
        fkgl_str = f"{stats.get('fkgl', 8.0):.1f}"
        align_str = f"{stats.get('alignment_rate', 0.0):.1f}\\%"

        safe_domain = domain.replace("_", " ")
        rows.append(f"{safe_domain} & {stats.get('n', 100)} & {sim_str} & {len_str} & {fkgl_str} & {align_str} \\\\")

    rows_latex = "\n".join(rows)

    latex = f"""\\begin{{table}}[htbp]
\\centering
\\small
\\caption{{Stratified Performance Across Chief Complaint Clinical Domains}}
\\label{{tab:domain_slices}}
\\begin{{tabular}}{{lccccc}}
\\toprule
\\textbf{{Clinical Domain}} & \\textbf{{$N$}} & \\textbf{{Cosine Similarity [95\\% CI]}} & \\textbf{{Response-Length Ratio}} & \\textbf{{FKGL}} & \\textbf{{Calibrated Alignment}} \\\\
\\midrule
{rows_latex}
\\bottomrule
\\end{{tabular}}
\\begin{{tablenotes}}
\\footnotesize
\\item \\textit{{Note}}: Chief complaint stratification covers 10 primary clinical presentations without automated ESI triage inference. FKGL = Flesch-Kincaid Grade Level. Calibrated alignment represents proportion of cases exceeding the empirically calibrated threshold ($T_{{\\text{{calib}}}}$).
\\end{{tablenotes}}
\\end{{table}}
"""
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(latex)
    return latex


def export_table3_safety_challenge(safety_data: Dict[str, Any], output_path: str) -> str:
    """
    Exports Table 3: Track B Exploratory Clinical Safety Challenge.
    Reports Sensitivity (denominator 22) and Specificity (denominator 13) with exact Wilson score CIs.
    """
    sens_ci = safety_data.get("sensitivity_ci", (0.0, 1.0))
    spec_ci = safety_data.get("specificity_ci", (0.0, 1.0))

    sens_pct = safety_data.get("sensitivity", 0.0) * 100
    spec_pct = safety_data.get("specificity", 0.0) * 100
    fn_rate = safety_data.get("false_negative_rate", 0.0) * 100
    esc_rate = safety_data.get("escalation_appropriateness_rate", 1.0) * 100
    crit_errors = safety_data.get("critical_safety_errors", 0)

    latex = f"""\\begin{{table}}[htbp]
\\centering
\\small
\\caption{{Track B Exploratory Clinical Safety Challenge ($N=35$)}}
\\label{{tab:safety_challenge}}
\\begin{{tabular}}{{lccc}}
\\toprule
\\textbf{{Clinical Metric}} & \\textbf{{Numerator / Denominator}} & \\textbf{{Estimate (\\%)}} & \\textbf{{Wilson Score 95\\% CI}} \\\\
\\midrule
Emergent Case Recognition (Sensitivity) & {safety_data.get('emergent_correct', 22)} / 22 & {sens_pct:.1f}\\% & [{sens_ci[0]*100:.1f}\\%, {sens_ci[1]*100:.1f}\\%] \\\\
Routine Control Recognition (Specificity) & {safety_data.get('non_emergent_correct', 13)} / 13 & {spec_pct:.1f}\\% & [{spec_ci[0]*100:.1f}\\%, {spec_ci[1]*100:.1f}\\%] \\\\
False-Negative Under-Triage Rate & {22 - safety_data.get('emergent_correct', 22)} / 22 & {fn_rate:.1f}\\% & -- \\\\
Escalation Appropriateness & {int(esc_rate * 35 / 100)} / 35 & {esc_rate:.1f}\\% & -- \\\\
Critical Safety Omissions & {crit_errors} / 35 & {crit_errors / 35 * 100:.1f}\\% & -- \\\\
\\bottomrule
\\end{{tabular}}
\\begin{{tablenotes}}
\\footnotesize
\\item \\textit{{Note}}: Evaluated on 35 standardized clinical benchmark scenarios (22 emergent, 13 routine non-emergent controls). This evaluation represents an exploratory safety challenge set, not a formal 5-level Emergency Severity Index (ESI) validation. Wilson score confidence intervals are reported.
\\end{{tablenotes}}
\\end{{table}}
"""
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(latex)
    return latex


def export_table4_regression(regression_data: Dict[str, Any], output_path: str) -> str:
    """
    Exports Table 4: Exploratory OLS Covariate Regression.
    """
    rows = []
    for var_name, coef_info in regression_data.get("coefficients", {}).items():
        coef = coef_info.get("coef", 0.0)
        se = coef_info.get("std_err", 0.0)
        t_val = coef_info.get("t_statistic", 0.0)
        p_val = coef_info.get("p_value", 1.0)
        p_str = "< 0.001" if p_val < 0.001 else f"{p_val:.3f}"
        ci = (coef_info.get("ci_lower", coef - 1.96 * se), coef_info.get("ci_upper", coef + 1.96 * se))
        ci_str = f"[{ci[0]:.3f}, {ci[1]:.3f}]"

        safe_var = var_name.replace("_", " ")
        rows.append(f"{safe_var} & {coef:.3f} & {se:.3f} & {t_val:.2f} & {p_str} & {ci_str} \\\\")

    rows_latex = "\n".join(rows)
    r2 = regression_data.get("r_squared", 0.0)
    adj_r2 = regression_data.get("adj_r_squared", 0.0)
    f_stat = regression_data.get("f_statistic", 0.0)

    latex = f"""\\begin{{table}}[htbp]
\\centering
\\small
\\caption{{Exploratory OLS Regression: Association of Covariates with Semantic Alignment}}
\\label{{tab:regression}}
\\begin{{tabular}}{{lccccc}}
\\toprule
\\textbf{{Covariate}} & \\textbf{{Coefficient ($\\beta$)}} & \\textbf{{Std. Error}} & \\textbf{{$t$-stat}} & \\textbf{{$p$-value}} & \\textbf{{95\\% CI}} \\\\
\\midrule
{rows_latex}
\\midrule
\\multicolumn{{6}}{{l}}{{$R^2 = {r2:.3f}$, Adjusted $R^2 = {adj_r2:.3f}$, $F = {f_stat:.1f}$}} \\\\
\\bottomrule
\\end{{tabular}}
\\begin{{tablenotes}}
\\footnotesize
\\item \\textit{{Note}}: Dependent variable is primary cosine similarity. Robust standard errors (HC1) reported. Framed strictly as an exploratory regression quantifying conversational covariate associations; not a causal inference model.
\\end{{tablenotes}}
\\end{{table}}
"""
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(latex)
    return latex


def export_table5_human_eval(human_data: Dict[str, Any], output_path: str) -> str:
    """
    Exports Table 5: Double-Blinded Multi-Clinician Review and Inter-Rater Reliability.
    """
    alphas = human_data.get("inter_rater_alpha", {})
    adj_means = human_data.get("adjudicated_means", {})

    dim_labels = {
        "correctness": "Medical Correctness",
        "completeness": "Completeness of Assessment",
        "relevance": "Relevance & Directness",
        "empathy": "Empathy & Bedside Manner",
        "clarity": "Clarity & Communication",
        "uncertainty_guidelines": "Uncertainty & Guidelines",
    }

    rows = []
    for dim_key, label in dim_labels.items():
        alpha_val = alphas.get(dim_key, 0.0)
        means = adj_means.get(dim_key, {"agent": (4.0, 0.5), "ref": (4.0, 0.5), "p_val": 1.0})
        agent_m = means["agent"]
        ref_m = means["ref"]
        p_val = means.get("p_val", 1.0)
        p_str = "< 0.001" if p_val < 0.001 else f"{p_val:.2f}"

        rows.append(
            f"{label} & {alpha_val:.2f} & {agent_m[0]:.2f} ({agent_m[1]:.2f}) & "
            f"{ref_m[0]:.2f} ({ref_m[1]:.2f}) & {p_str} \\\\"
        )

    rows_latex = "\n".join(rows)

    latex = f"""\\begin{{table}}[htbp]
\\centering
\\small
\\caption{{Double-Blinded Multi-Clinician Evaluation & Inter-Rater Reliability}}
\\label{{tab:human_eval}}
\\begin{{tabular}}{{lcccc}}
\\toprule
\\textbf{{Clinical Dimension}} & \\textbf{{Krippendorff's $\\alpha$}} & \\textbf{{MedVoice (Mean, SD)}} & \\textbf{{Physician Reference (Mean, SD)}} & \\textbf{{$p$-value}} \\\\
\\midrule
{rows_latex}
\\bottomrule
\\end{{tabular}}
\\begin{{tablenotes}}
\\footnotesize
\\item \\textit{{Note}}: Evaluated across double-blinded, randomized A/B presentations by independent licensed physicians ($N=100$ sample). Pre-adjudication reliability measured using ordinal Krippendorff's $\\alpha$. Disagreements $> 1$ point escalated to panel adjudication.
\\end{{tablenotes}}
\\end{{table}}
"""
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(latex)
    return latex


def generate_all_latex_tables(evaluation_data: Dict[str, Any], output_dir: str) -> Dict[str, str]:
    """
    Generates all 5 publication LaTeX tables into the designated output directory.
    """
    out_dir = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    paths = {
        "table1": str(out_dir / "table1_main_results.tex"),
        "table2": str(out_dir / "table2_domain_slices.tex"),
        "table3": str(out_dir / "table3_safety_challenge.tex"),
        "table4": str(out_dir / "table4_regression.tex"),
        "table5": str(out_dir / "table5_human_eval.tex"),
    }

    if "table1" in evaluation_data:
        export_table1_main_results(evaluation_data["table1"], paths["table1"])
    if "table2" in evaluation_data:
        export_table2_domain_slices(evaluation_data["table2"], paths["table2"])
    if "table3" in evaluation_data:
        export_table3_safety_challenge(evaluation_data["table3"], paths["table3"])
    if "table4" in evaluation_data:
        export_table4_regression(evaluation_data["table4"], paths["table4"])
    if "table5" in evaluation_data:
        export_table5_human_eval(evaluation_data["table5"], paths["table5"])

    return paths
