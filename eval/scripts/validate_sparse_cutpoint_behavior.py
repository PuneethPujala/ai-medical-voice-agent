#!/usr/bin/env python3
"""
MedVoice Study 3: Comprehensive Four-Cutpoint Estimability & Sparse Domain Audit
Targeted v3.3.17 Verification Script: Mathematical Audit of Unpenalized Intercept Hessian & Exploratory Fixed-Effect Logistic Prototype

Evaluates:
1. Complete 4-Cutpoint Estimability Audit (c=1, 2, 3, 4 and joint intersection).
2. Direct Cross-Tabulation of Domain Zero-Event Status vs. Criterion 4 (Max SE < 10.0).
3. Six System x Perspective Cell Event Counts and Direct Coefficient / SE Evidence.
4. Conditional vs. Unconditional Inference Quality, SE Reductions, and Wilson 95% CIs.
5. Exact Unpenalized Intercept Hessian Formulation: H_reg = X^T W X + lambda_reg * P where P = diag(0, 1, ..., 1).
"""

import numpy as np
from scipy import optimize, integrate

# Seed for reproducibility
SEED = 42
RNG = np.random.default_rng(SEED)

# Simulation parameters
N_SCENARIOS = 200
N_PERSPECTIVES = 3
N_SYSTEMS = 2
N_RATINGS = N_SCENARIOS * N_PERSPECTIVES * N_SYSTEMS  # 1,200 ratings
N_SIMS = 100

BETA_1 = 0.300
SIGMA_U = np.sqrt(0.50)
SIGMA_V = np.sqrt(0.25)

# Cutpoints for Condition 4 (Sparse Top Category)
THETA_CUTPOINTS = [-2.0, -0.8, 0.5, 4.25]

# 14-element contrast vector c = [1, 0, 0, 1/3, 1/3, 0_9]
CONTRAST_VECTOR = np.array([1.0, 0.0, 0.0, 1.0 / 3.0, 1.0 / 3.0] + [0.0] * 9)

# 20 scenarios per domain across 10 domains
scenario_domains = np.repeat(np.arange(10), 20)  # shape (200,)


def build_design_matrix():
    """Build design matrix X of shape (1200, 14) for fixed effects:
    beta_1 (M), gamma_2 (SIM-02), gamma_3 (SIM-03), delta_2 (M:SIM-02), delta_3 (M:SIM-03),
    alpha_2..10 (Domains 2-10). Domain 1 and SIM-01 are reference.
    """
    X = np.zeros((N_RATINGS, 14))
    row = 0
    scen_idx = []
    persp_idx = []
    sys_idx = []
    dom_idx = []

    for s in range(N_SCENARIOS):
        dom = scenario_domains[s]
        for p in range(N_PERSPECTIVES):
            for m in range(N_SYSTEMS):
                # Column 0: M (MedVoice indicator)
                X[row, 0] = float(m)

                # Columns 1, 2: Perspective main effects (SIM-02, SIM-03)
                if p == 1:
                    X[row, 1] = 1.0
                elif p == 2:
                    X[row, 2] = 1.0

                # Columns 3, 4: System x Perspective interactions
                if m == 1 and p == 1:
                    X[row, 3] = 1.0
                elif m == 1 and p == 2:
                    X[row, 4] = 1.0

                # Columns 5..13: Domain main effects (Domains 1 to 9, where 0 is ref)
                if dom > 0:
                    X[row, 4 + dom] = 1.0

                scen_idx.append(s)
                persp_idx.append(p)
                sys_idx.append(m)
                dom_idx.append(dom)
                row += 1

    return X, np.array(scen_idx), np.array(persp_idx), np.array(sys_idx), np.array(dom_idx)


X_MAT, SCEN_MAP, PERSP_MAP, SYS_MAP, DOM_MAP = build_design_matrix()


def simulate_latent_dataset(rng):
    """Simulate latent continuous outcome Y* under random intercepts."""
    u_s = rng.normal(0, SIGMA_U, size=N_SCENARIOS)
    v_sp = rng.normal(0, SIGMA_V, size=(N_SCENARIOS, N_PERSPECTIVES))

    w = u_s[SCEN_MAP] + v_sp[SCEN_MAP, PERSP_MAP]
    eta = X_MAT[:, 0] * BETA_1 + w
    eps = rng.logistic(0, 1, size=N_RATINGS)
    latent_y = eta + eps
    return latent_y


def fit_binary_model(y_bin):
    """Fit 14-parameter logistic regression with intercept (15 params total).
    Returns dict of diagnostics and estimates.
    """
    x_with_int = np.column_stack([np.ones(N_RATINGS), X_MAT])

    # L2 ridge regularization lambda_reg = 1e-4 incorporated in Python numerical prototype
    # to stabilize Hessian inversion when quasi-separation occurs.
    lambda_reg = 1e-4

    def loss_and_grad(b):
        lin_pred = np.clip(x_with_int @ b, -25.0, 25.0)
        p = 1.0 / (1.0 + np.exp(-lin_pred))
        p = np.clip(p, 1e-12, 1.0 - 1e-12)
        neg_ll = -np.sum(y_bin * np.log(p) + (1.0 - y_bin) * np.log(1.0 - p))
        neg_ll += 0.5 * lambda_reg * np.sum(b[1:] ** 2)

        grad = x_with_int.T @ (p - y_bin)
        grad[1:] += lambda_reg * b[1:]
        return neg_ll, grad

    res = optimize.minimize(
        loss_and_grad,
        np.zeros(15),
        jac=True,
        method="BFGS",
        options={"maxiter": 200, "gtol": 1e-4},
    )

    opt_success = bool(res.success)
    max_grad = float(np.max(np.abs(res.jac)))
    grad_pass = bool(max_grad < 1e-3)

    b_hat = res.x
    fixed_effects = b_hat[1:]  # drop intercept
    psi_hat = float(CONTRAST_VECTOR @ fixed_effects)

    # Compute Hessian for standard errors
    lin_pred = np.clip(x_with_int @ b_hat, -25.0, 25.0)
    p = 1.0 / (1.0 + np.exp(-lin_pred))
    W_diag = p * (1.0 - p)
    # Strictly unpenalized intercept Hessian: H_reg = X^T W X + lambda_reg * P where P = diag(0, 1, ..., 1)
    P_pen = np.diag([0.0] + [1.0] * 14)
    Hess = x_with_int.T @ (x_with_int * W_diag[:, None]) + lambda_reg * P_pen

    try:
        cov_mat = np.linalg.inv(Hess)
        se_all = np.sqrt(np.diag(cov_mat))
        max_se = float(np.max(se_all[1:]))

        # Contrast variance: c^T Cov(beta) c
        cov_beta = cov_mat[1:, 1:]
        var_psi = float(CONTRAST_VECTOR @ cov_beta @ CONTRAST_VECTOR)
        se_psi = np.sqrt(var_psi) if var_psi > 0 else np.nan
        se_fixef = se_all[1:]
    except np.linalg.LinAlgError:
        se_psi = np.nan
        max_se = np.nan
        se_fixef = np.full(14, np.nan)

    n_events = int(np.sum(y_bin))
    c1_event = bool((n_events >= 15) and (N_RATINGS - n_events >= 15))
    c2_opt = bool(opt_success)
    c3_grad = bool(grad_pass)
    c4_se = bool((not np.isnan(max_se)) and (max_se < 10.0))
    is_estimable = bool(c1_event and c2_opt and c3_grad and c4_se)

    return {
        "psi_hat": psi_hat,
        "se_psi": se_psi,
        "b_hat": fixed_effects,
        "se_fixef": se_fixef,
        "max_grad": max_grad,
        "max_se": max_se,
        "n_events": n_events,
        "c1_event": c1_event,
        "c2_opt": c2_opt,
        "c3_grad": c3_grad,
        "c4_se": c4_se,
        "is_estimable": is_estimable,
    }


def wilson_ci(k, n, conf=0.95):
    """Wilson score confidence interval for a binomial proportion."""
    if n == 0:
        return (0.0, 0.0)
    from scipy.stats import norm
    z = norm.ppf(1.0 - (1.0 - conf) / 2.0)
    p = k / n
    denom = 1.0 + (z**2) / n
    center = (p + (z**2) / (2.0 * n)) / denom
    margin = (z / denom) * np.sqrt((p * (1.0 - p) / n) + (z**2) / (4.0 * n**2))
    return max(0.0, center - margin), min(1.0, center + margin)


def main():
    print("=" * 85)
    print("MEDVOICE STUDY 3: TARGETED v3.3.15 FOUR-CUTPOINT & DOMAIN ESTIMABILITY AUDIT")
    print(f"Configurations: N_sims={N_SIMS}, theta={THETA_CUTPOINTS}, beta_1={BETA_1}, Seed={SEED}")
    print("=" * 85)

    # Per-cutpoint statistics
    # c = 1..4 corresponding to cutpoints THETA_CUTPOINTS[0..3]
    cutpoint_results = {c: {"c1": [], "c2": [], "c3": [], "c4": [], "est": []} for c in range(1, 5)}

    dataset_all_four_estimable = []

    # Domain zero-event tracking for c=4
    c4_datasets_with_zero_domain = []
    c4_datasets_max_se_fail = []

    # System x perspective cell counts and interaction SEs for c=4
    c4_sys_persp_counts = {(m, p): [] for m in range(2) for p in range(3)}
    c4_b1_vals = []
    c4_b1_ses = []
    c4_d2_vals = []
    c4_d2_ses = []
    c4_d3_vals = []
    c4_d3_ses = []

    # Domain events for c=4
    c4_domain_events = {d: [] for d in range(10)}

    # Primary contrast psi inference for c=4
    c4_psi_all = []
    c4_se_all = []
    c4_cov_all = []

    c4_psi_cond = []
    c4_se_cond = []
    c4_cov_cond = []

    # c4 max SE distribution
    c4_max_ses = []

    for sim_i in range(N_SIMS):
        latent_y = simulate_latent_dataset(RNG)

        sim_cutpoint_estimable = []

        for c_idx, theta in enumerate(THETA_CUTPOINTS):
            c_num = c_idx + 1
            y_bin = (latent_y > theta).astype(float)
            fit_res = fit_binary_model(y_bin)

            cutpoint_results[c_num]["c1"].append(fit_res["c1_event"])
            cutpoint_results[c_num]["c2"].append(fit_res["c2_opt"])
            cutpoint_results[c_num]["c3"].append(fit_res["c3_grad"])
            cutpoint_results[c_num]["c4"].append(fit_res["c4_se"])
            cutpoint_results[c_num]["est"].append(fit_res["is_estimable"])
            sim_cutpoint_estimable.append(fit_res["is_estimable"])

            if c_num == 4:
                # Sparse category audits
                c4_max_ses.append(fit_res["max_se"])

                # Check domain events
                has_zero_dom = False
                for d in range(10):
                    cnt = int(np.sum(y_bin[DOM_MAP == d]))
                    c4_domain_events[d].append(cnt)
                    if cnt == 0:
                        has_zero_dom = True
                c4_datasets_with_zero_domain.append(has_zero_dom)
                c4_datasets_max_se_fail.append(not fit_res["c4_se"])

                # Six system x perspective cells
                for m in range(2):
                    for p in range(3):
                        mask = (SYS_MAP == m) & (PERSP_MAP == p)
                        c4_sys_persp_counts[(m, p)].append(int(np.sum(y_bin[mask])))

                # Coefficient and SE tracking
                c4_b1_vals.append(fit_res["b_hat"][0])
                c4_b1_ses.append(fit_res["se_fixef"][0])
                c4_d2_vals.append(fit_res["b_hat"][3])
                c4_d2_ses.append(fit_res["se_fixef"][3])
                c4_d3_vals.append(fit_res["b_hat"][4])
                c4_d3_ses.append(fit_res["se_fixef"][4])

                # Contrast psi and coverage
                psi_h = fit_res["psi_hat"]
                se_h = fit_res["se_psi"]
                c4_psi_all.append(psi_h)
                c4_se_all.append(se_h)

                ci_lo = psi_h - 1.96 * se_h
                ci_hi = psi_h + 1.96 * se_h
                cov = bool(ci_lo <= BETA_1 <= ci_hi)
                c4_cov_all.append(cov)

                if fit_res["is_estimable"]:
                    c4_psi_cond.append(psi_h)
                    c4_se_cond.append(se_h)
                    c4_cov_cond.append(cov)

        # Dataset level intersection: all 4 cutpoints estimable
        dataset_all_four_estimable.append(all(sim_cutpoint_estimable))

    # =========================================================================
    # 1. FOUR-CUTPOINT ESTIMABILITY AUDIT
    # =========================================================================
    print("\n1. FOUR-CUTPOINT ESTIMABILITY AUDIT TABLE (N=100 DATASETS):")
    print(f"  {'Cutpoint':<12} | {'Event Guard':<14} | {'Optimizer':<12} | {'Gradient':<12} | {'Max SE < 10':<14} | {'Joint Estimable':<16}")
    print("  " + "-" * 88)
    cutpoint_labels = [
        "c=1 (Y >= 2)",
        "c=2 (Y >= 3)",
        "c=3 (Y >= 4)",
        "c=4 (Y >= 5)",
    ]
    for c_idx in range(4):
        c_num = c_idx + 1
        res_c = cutpoint_results[c_num]
        p_c1 = f"{sum(res_c['c1'])}/100 ({sum(res_c['c1'])}%)"
        p_c2 = f"{sum(res_c['c2'])}/100 ({sum(res_c['c2'])}%)"
        p_c3 = f"{sum(res_c['c3'])}/100 ({sum(res_c['c3'])}%)"
        p_c4 = f"{sum(res_c['c4'])}/100 ({sum(res_c['c4'])}%)"
        p_est = f"{sum(res_c['est'])}/100 ({sum(res_c['est'])}%)"
        print(f"  {cutpoint_labels[c_idx]:<12} | {p_c1:<14} | {p_c2:<12} | {p_c3:<12} | {p_c4:<14} | {p_est:<16}")

    n_all_four = sum(dataset_all_four_estimable)
    print("  " + "-" * 88)
    print(f"  DATASET-LEVEL INTERSECTION: N(all four cutpoints estimable) = {n_all_four} / 100 ({n_all_four:.1f}%)")

    # =========================================================================
    # 2. ZERO-EVENT DOMAINS VS. MAX-SE CROSS-TABULATION
    # =========================================================================
    print("\n2. DIRECT CROSS-TABULATION: ZERO-EVENT DOMAINS VS. MAX-SE (c=4):")
    # Table counts
    has_zero_arr = np.array(c4_datasets_with_zero_domain)
    max_se_fail_arr = np.array(c4_datasets_max_se_fail)

    n_has_zero = int(np.sum(has_zero_arr))
    n_no_zero = int(np.sum(~has_zero_arr))

    # Cross-tabulation cells:
    # Cell 1: Has Zero Domain & Fails Max SE
    cell_zero_fail = int(np.sum(has_zero_arr & max_se_fail_arr))
    # Cell 2: Has Zero Domain & Passes Max SE
    cell_zero_pass = int(np.sum(has_zero_arr & (~max_se_fail_arr)))
    # Cell 3: No Zero Domain & Fails Max SE
    cell_nozero_fail = int(np.sum((~has_zero_arr) & max_se_fail_arr))
    # Cell 4: No Zero Domain & Passes Max SE
    cell_nozero_pass = int(np.sum((~has_zero_arr) & (~max_se_fail_arr)))

    print(f"  Number of datasets with at least one zero-event domain : {n_has_zero} / 100 ({n_has_zero}%)")
    print(f"  Number of datasets with zero zero-event domains (no 0): {n_no_zero} / 100 ({n_no_zero}%)")
    print("\n  2x2 Cross-Tabulation (Dataset Level):")
    print(f"  {'Domain Status':<30} | {'Max SE >= 10 (FAIL)':<20} | {'Max SE < 10 (PASS)':<20} | {'Total':<8}")
    print("  " + "-" * 84)
    print(f"  {'At least 1 zero-event domain':<30} | {cell_zero_fail:<20d} | {cell_zero_pass:<20d} | {n_has_zero:<8d}")
    print(f"  {'Zero zero-event domains (all > 0)':<30} | {cell_nozero_fail:<20d} | {cell_nozero_pass:<20d} | {n_no_zero:<8d}")
    print("  " + "-" * 84)
    print(f"  {'Total':<30} | {cell_zero_fail + cell_nozero_fail:<20d} | {cell_zero_pass + cell_nozero_pass:<20d} | 100")

    # =========================================================================
    # 3. CONDITIONAL COVERAGE & RIDGE STABILIZATION EXPLANATION
    # =========================================================================
    print("\n3. CONDITIONAL VS. UNCONDITIONAL INFERENCE & WILSON 95% CIs (c=4):")
    cov_all_k = sum(c4_cov_all)
    cov_all_n = len(c4_cov_all)
    w_lo_all, w_hi_all = wilson_ci(cov_all_k, cov_all_n)

    cov_cond_k = sum(c4_cov_cond)
    cov_cond_n = len(c4_cov_cond)
    w_lo_cond, w_hi_cond = wilson_ci(cov_cond_k, cov_cond_n)

    mean_se_uncond = float(np.mean(c4_se_all))
    mean_se2_uncond = float(np.mean(np.array(c4_se_all) ** 2))
    mean_se_cond = float(np.mean(c4_se_cond))
    mean_se2_cond = float(np.mean(np.array(c4_se_cond) ** 2))
    se_reduction_pct = (mean_se_cond - mean_se_uncond) / mean_se_uncond * 100.0
    se2_reduction_pct = (mean_se2_cond - mean_se2_uncond) / mean_se2_uncond * 100.0

    print(f"  A. Unconditional (All {cov_all_n} Fitted Datasets):")
    print(f"     Numerator / Denominator    : {cov_all_k} / {cov_all_n} ({cov_all_k/cov_all_n*100:.1f}%)")
    print(f"     Wilson 95% Confidence Int  : [{w_lo_all*100:.1f}%, {w_hi_all*100:.1f}%]")
    print(f"     Mean Primary Contrast psi  : {np.mean(c4_psi_all):.4f} (True: {BETA_1:.4f})")
    print(f"     Empirical Bias             : {np.mean(c4_psi_all) - BETA_1:+.4f}")
    print(f"     Mean Contrast SE           : {mean_se_uncond:.4f}")
    print(f"     Mean Squared Contrast SE   : {mean_se2_uncond:.4f}")

    print(f"\n  B. Selection-Conditioned Subset (Fully Estimable, N={cov_cond_n}):")
    print(f"     Numerator / Denominator    : {cov_cond_k} / {cov_cond_n} ({cov_cond_k/cov_cond_n*100:.1f}%)")
    print(f"     Wilson 95% Confidence Int  : [{w_lo_cond*100:.1f}%, {w_hi_cond*100:.1f}%]")
    print(f"     Mean Primary Contrast psi  : {np.mean(c4_psi_cond):.4f} (True: {BETA_1:.4f})")
    print(f"     Empirical Bias             : {np.mean(c4_psi_cond) - BETA_1:+.4f} (Selection-induced downward shift)")
    print(f"     Mean Contrast SE           : {mean_se_cond:.4f} ({se_reduction_pct:+.2f}% relative to unconditional)")
    print(f"     Mean Squared Contrast SE   : {mean_se2_cond:.4f} ({se2_reduction_pct:+.2f}% relative to unconditional)")

    # =========================================================================
    # 4. SYSTEM X PERSPECTIVE CELL COUNTS & COEFFICIENT EVIDENCE
    # =========================================================================
    print("\n4. SYSTEM x PERSPECTIVE PARAMETER & CELL AUDIT (c=4):")
    print("  Cell Event Counts:")
    sys_names = ["Comparator", "MedVoice"]
    persp_names = ["SIM-01", "SIM-02", "SIM-03"]
    for m in range(2):
        for p in range(3):
            counts = c4_sys_persp_counts[(m, p)]
            z_pct = np.mean([cnt == 0 for cnt in counts]) * 100.0
            print(f"    {sys_names[m]} x {persp_names[p]:<7}: Mean = {np.mean(counts):5.2f} (SD={np.std(counts):.2f}, Min={min(counts):2d}, Max={max(counts):2d}, Zero={z_pct:4.1f}%)")

    print("\n  Coefficient & Standard Error Distributions across 100 Datasets:")
    print(f"    beta_1 (MedVoice main effect) : Mean = {np.mean(c4_b1_vals):.4f}, Mean SE = {np.mean(c4_b1_ses):.4f}")
    print(f"    delta_2 (MedVoice x SIM-02)   : Mean = {np.mean(c4_d2_vals):.4f}, Mean SE = {np.mean(c4_d2_ses):.4f}")
    print(f"    delta_3 (MedVoice x SIM-03)   : Mean = {np.mean(c4_d3_vals):.4f}, Mean SE = {np.mean(c4_d3_ses):.4f}")
    print("=" * 85)


if __name__ == "__main__":
    main()
