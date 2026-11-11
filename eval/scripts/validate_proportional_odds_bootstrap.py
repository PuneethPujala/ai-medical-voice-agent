#!/usr/bin/env python3
"""
MedVoice Study 3: Proportional Odds Diagnostic Simulation Study

Validates the Framework A Parametric Null Bootstrap Diagnostic across 5 simulation conditions:
1. True Proportional Odds (PO True): Empirical Type-I error rate (target nominal ~0.05).
2. Moderate Threshold-Specific Effects: Empirical detection probability (power).
3. Strong Threshold-Specific Effects: Empirical detection probability (power).
4. Sparse Highest-Rating Category (Y=5 sparse): Convergence, stability, and error rate.
5. Random-Effect Variance Configurations (Low vs High sigma_u^2, sigma_v^2): Diagnostic stability.
"""

import sys
import numpy as np
from scipy import optimize

# Fixed study design parameters
N_SCENARIOS = 200
N_PERSPECTIVES = 3
N_SYSTEMS = 2
N_OBS = N_SCENARIOS * N_PERSPECTIVES * N_SYSTEMS  # 1,200 observations
N_DOMAINS = 10
SCENARIOS_PER_DOMAIN = 20

# Design matrix structure
SCENARIO_IDS = np.repeat(np.arange(N_SCENARIOS), N_PERSPECTIVES * N_SYSTEMS)
PERSP_IDS = np.tile(np.repeat(np.arange(N_PERSPECTIVES), N_SYSTEMS), N_SCENARIOS)
SYS_IDS = np.tile(np.arange(N_SYSTEMS), N_SCENARIOS * N_PERSPECTIVES)
DOMAIN_IDS = np.repeat(np.arange(N_DOMAINS), SCENARIOS_PER_DOMAIN * N_PERSPECTIVES * N_SYSTEMS)

# Pre-construct design matrix X (N_OBS x 15)
X_DESIGN = np.zeros((N_OBS, 15))
X_DESIGN[:, 0] = 1.0  # Intercept
X_DESIGN[:, 1] = SYS_IDS  # System (1 = MedVoice, 0 = Comparator)
X_DESIGN[:, 2] = (PERSP_IDS == 1).astype(float)  # SIM-02
X_DESIGN[:, 3] = (PERSP_IDS == 2).astype(float)  # SIM-03
X_DESIGN[:, 4] = SYS_IDS * (PERSP_IDS == 1)      # System x SIM-02
X_DESIGN[:, 5] = SYS_IDS * (PERSP_IDS == 2)      # System x SIM-03
for d in range(1, N_DOMAINS):
    X_DESIGN[:, 5 + d] = (DOMAIN_IDS == d).astype(float)  # Domain indicators

# Ridge penalty parameter
LAMBDA_PENALTY = 1e-4


def compute_contrast(beta_vec):
    """Linear contrast c^T beta evaluating psi_primary = beta_1 + (delta_2 + delta_3) / 3."""
    return beta_vec[1] + (beta_vec[4] + beta_vec[5]) / 3.0


def fit_dichotomized_binary(y_binary, x_mat=X_DESIGN):
    """Fit dichotomized binary regression with analytic gradient for maximum speed."""
    def loss_and_grad(b):
        z = x_mat @ b
        # Stable sigmoid
        p = 1.0 / (1.0 + np.exp(-np.clip(z, -30, 30)))
        # -log L = sum [ -y*z + log(1 + exp(z)) ]
        neg_ll = -np.sum(y_binary * z - np.logaddexp(0.0, z)) + 0.5 * LAMBDA_PENALTY * np.sum(b[1:] ** 2)
        # Gradient
        grad = x_mat.T @ (p - y_binary)
        grad[1:] += LAMBDA_PENALTY * b[1:]
        return neg_ll, grad

    res = optimize.minimize(
        loss_and_grad,
        np.zeros(15),
        jac=True,
        method='BFGS',
        options={'maxiter': 100, 'gtol': 1e-4}
    )
    converged = res.success
    psi_c = compute_contrast(res.x) if converged else np.nan
    return psi_c, converged


def compute_delta_po(y_ratings):
    """Compute omnibus threshold-contrast heterogeneity statistic Delta_PO across 4 cutpoints."""
    contrasts = []
    converged_all = True
    for c in range(1, 5):
        y_bin = (y_ratings >= (c + 1)).astype(float)
        # Check rare categories
        if np.sum(y_bin) < 5 or np.sum(1 - y_bin) < 5:
            return np.nan, False, None
        psi_c, conv = fit_dichotomized_binary(y_bin)
        if not conv or np.isnan(psi_c):
            converged_all = False
            break
        contrasts.append(psi_c)

    if not converged_all or len(contrasts) < 4:
        return np.nan, False, None

    contrasts = np.array(contrasts)
    bar_psi = np.mean(contrasts)
    delta_po = float(np.sum((contrasts - bar_psi) ** 2))
    return delta_po, True, contrasts


def simulate_ordinal_dataset(cutpoints, beta_by_threshold, sigma_u, sigma_v, rng):
    """Simulate ordinal dataset with 1,200 clustered observations."""
    u = rng.normal(0.0, sigma_u, size=N_SCENARIOS)
    v = rng.normal(0.0, sigma_v, size=(N_SCENARIOS, N_PERSPECTIVES))

    gamma = np.array([0.0, -0.15, 0.10])
    alpha = np.array([0.0, 0.12, -0.08, 0.15, -0.10, 0.05, -0.12, 0.18, -0.05, 0.22])

    eta_base = gamma[PERSP_IDS] + alpha[DOMAIN_IDS] + u[SCENARIO_IDS] + v[SCENARIO_IDS, PERSP_IDS]
    eps = rng.logistic(0.0, 1.0, size=N_OBS)

    y_ratings = np.ones(N_OBS, dtype=int)
    delta_p = np.array([0.0, 0.10, -0.10])

    for c in range(1, 5):
        b_c = beta_by_threshold[c - 1] if isinstance(beta_by_threshold, (list, np.ndarray)) else beta_by_threshold
        eta_c = eta_base + (b_c + delta_p[PERSP_IDS]) * SYS_IDS
        latent_c = eta_c + eps
        passed_threshold = (latent_c > cutpoints[c - 1])
        y_ratings[passed_threshold] = c + 1

    return y_ratings


def run_parametric_bootstrap_test(y_ratings, cutpoints, sigma_u, sigma_v, b_boot=50, rng=None):
    """Framework A Parametric Null Bootstrap test."""
    if rng is None:
        rng = np.random.default_rng()

    delta_obs, conv_obs, contrasts_obs = compute_delta_po(y_ratings)
    if not conv_obs:
        return np.nan, False, False

    pooled_psi = np.mean(contrasts_obs)
    exceedances = 0
    valid_replicates = 0

    for _ in range(b_boot):
        y_null_b = simulate_ordinal_dataset(cutpoints, pooled_psi, sigma_u, sigma_v, rng)
        delta_b, conv_b, _ = compute_delta_po(y_null_b)
        if not conv_b or np.isnan(delta_b):
            continue
        valid_replicates += 1
        if delta_b >= delta_obs:
            exceedances += 1

    if valid_replicates < (b_boot * 0.8):
        return np.nan, True, False

    p_boot = (1.0 + exceedances) / (valid_replicates + 1.0)
    rejected = (p_boot < 0.05)
    return p_boot, True, rejected


def evaluate_simulation_condition(cond_name, cutpoints, beta_spec, sigma_u, sigma_v, n_sims=50, b_boot=50, seed=42):
    """Run Monte Carlo simulation battery for a condition."""
    rng = np.random.default_rng(seed)
    rejections = 0
    convergences = 0
    boot_failures = 0
    p_values = []

    for sim_idx in range(n_sims):
        y_data = simulate_ordinal_dataset(cutpoints, beta_spec, sigma_u, sigma_v, rng)
        p_val, conv, rej = run_parametric_bootstrap_test(y_data, cutpoints, sigma_u, sigma_v, b_boot=b_boot, rng=rng)

        if not conv:
            continue
        convergences += 1

        if np.isnan(p_val):
            boot_failures += 1
            continue

        p_values.append(p_val)
        if rej:
            rejections += 1

    conv_rate = convergences / n_sims
    boot_fail_rate = boot_failures / max(1, convergences)
    empirical_rate = rejections / max(1, len(p_values))

    return {
        "condition": cond_name,
        "n_sims": n_sims,
        "convergences": convergences,
        "conv_rate": conv_rate,
        "boot_fail_rate": boot_fail_rate,
        "empirical_rate": empirical_rate,
        "p_values": p_values,
    }


def main():
    print("=" * 85, flush=True)
    print("MEDVOICE STUDY 3: FRAMEWORK A PROPORTIONAL ODDS NULL BOOTSTRAP VALIDATION", flush=True)
    print("=" * 85, flush=True)

    base_cutpoints = np.array([-2.0, -0.8, 0.5, 1.8])
    sparse_cutpoints = np.array([-2.0, -0.8, 0.5, 4.25])  # Sparse top category: theta_4=4.25 => P(Y=5) ~ 2.33% (~28 events / 1200)

    conditions = [
        {
            "name": "1. True Proportional Odds (Null H0)",
            "cutpoints": base_cutpoints,
            "beta": 0.300,
            "sigma_u": np.sqrt(0.50),
            "sigma_v": np.sqrt(0.25),
            "metric": "Type-I Error Rate (Target: ~0.05)",
        },
        {
            "name": "2. Moderate Threshold Effects",
            "cutpoints": base_cutpoints,
            "beta": [0.15, 0.25, 0.35, 0.45],
            "sigma_u": np.sqrt(0.50),
            "sigma_v": np.sqrt(0.25),
            "metric": "Detection Power (Moderate)",
        },
        {
            "name": "3. Strong Threshold Effects",
            "cutpoints": base_cutpoints,
            "beta": [0.05, 0.20, 0.45, 0.70],
            "sigma_u": np.sqrt(0.50),
            "sigma_v": np.sqrt(0.25),
            "metric": "Detection Power (Strong)",
        },
        {
            "name": "4. Sparse Top Rating Category (Y=5)",
            "cutpoints": sparse_cutpoints,
            "beta": 0.300,
            "sigma_u": np.sqrt(0.50),
            "sigma_v": np.sqrt(0.25),
            "metric": "Type-I Error & Numerical Stability",
        },
        {
            "name": "5a. Variance Sensitivity: Low Cluster Var",
            "cutpoints": base_cutpoints,
            "beta": 0.300,
            "sigma_u": np.sqrt(0.20),
            "sigma_v": np.sqrt(0.10),
            "metric": "Type-I Error & Low-Variance Stability",
        },
        {
            "name": "5b. Variance Sensitivity: High Cluster Var",
            "cutpoints": base_cutpoints,
            "beta": 0.300,
            "sigma_u": np.sqrt(0.80),
            "sigma_v": np.sqrt(0.40),
            "metric": "Type-I Error & High-Variance Stability",
        },
    ]

    results_table = []

    for idx, cond in enumerate(conditions, 1):
        print(f"Running Condition {cond['name']} ...", flush=True)
        res = evaluate_simulation_condition(
            cond["name"],
            cond["cutpoints"],
            cond["beta"],
            cond["sigma_u"],
            cond["sigma_v"],
            n_sims=50,
            b_boot=50,
            seed=200 + idx,
        )
        res["metric_desc"] = cond["metric"]
        results_table.append(res)
        print(f"  -> Convergence Rate:       {res['conv_rate']*100:.1f}%", flush=True)
        print(f"  -> Bootstrap Failure Rate: {res['boot_fail_rate']*100:.1f}%", flush=True)
        print(f"  -> Empirical Rate:         {res['empirical_rate']*100:.1f}% ({cond['metric']})\n", flush=True)

    print("=" * 85, flush=True)
    print("PROPORTIONAL ODDS DIAGNOSTIC VALIDATION SUMMARY (TABLE FOR SPECIFICATION v3.3.15)", flush=True)
    print("=" * 85, flush=True)
    print(f"{'Simulation Condition':<42} | {'Conv Rate':<10} | {'Boot Fail':<10} | {'Empirical Rate':<16} | {'Target / Benchmark':<20}", flush=True)
    print("-" * 110, flush=True)
    for res in results_table:
        print(f"{res['condition']:<42} | {res['conv_rate']*100:>8.1f}% | {res['boot_fail_rate']*100:>8.1f}% | {res['empirical_rate']*100:>14.1f}% | {res['metric_desc']:<20}", flush=True)
    print("=" * 110, flush=True)


if __name__ == "__main__":
    main()
