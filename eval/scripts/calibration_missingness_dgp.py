#!/usr/bin/env python3
"""
MedVoice Study 3: Design A Incomplete-Session Calibration and Clustered Variance Derivation

Conditional Independence Assumptions:
1. Candidate Response Generation: MedVoice and Comparator generation failures (F_{s,MV}^{resp}, F_{s,Comp}^{resp})
   are conditionally independent given the shared scenario infrastructure shock omega_s:
       P(F_{s,MV} = 0, F_{s,Comp} = 0 | omega_s) = (1 - p_{s,MV}^{resp})(1 - p_{s,Comp}^{resp})
       q_s = P(G_s = 1 | omega_s) = 1 - (1 - p_{s,MV}^{resp})(1 - p_{s,Comp}^{resp})
2. Evaluator Scoring: The three evaluator scoring failures (E_{s,1}, E_{s,2}, E_{s,3}) are mutually independent
   and conditionally independent of candidate generation:
       P(E_{s,1} = 0, E_{s,2} = 0, E_{s,3} = 0 | G_s = 0) = (1 - r)^3 where r = p_eval = 0.001.

This research script implements:
1. Numerical calibration of the candidate generation baseline intercept phi_0
   across infrastructure shock variance levels sigma_omega in {0.0, 0.3, 0.6}.
2. Brent's root-finding method targeting an expected incomplete session rate of 2.0%
   (12.0 incomplete sessions out of 600 total paired evaluation sessions).
3. Exact per-scenario variance derivation accounting for candidate pair failure (G_s)
   and evaluator residual failure (E_sp):
       Var(Z_s) = 3(1 - q_s)r(1 - r) + 9 q_s(1 - q_s)(1 - r)^2
4. Stratified variance aggregation across 70 emergent and 130 non-emergent scenarios:
       Var(N_dropped) = 70 Var(Z_em) + 130 Var(Z_non_em)
5. Exact discrete probability convolution (via polynomial multiplication) of the
   discrete PMFs to compute exact quantiles and central 95% realization intervals [3, 25].
"""

import math
import numpy as np
from scipy import integrate, optimize

# Evaluator residual failure probability per session after 4 total attempts
R_EVAL = 0.001

# Guideline urgency and multi-agent system latency logit shifts
PHI_URG = 0.40
PHI_SYS = 0.20

# Cohort stratification
N_SCENARIOS = 200
N_EMERGENT = 70
N_NON_EMERGENT = 130
N_PERSPECTIVES = 3
N_SESSIONS = N_SCENARIOS * N_PERSPECTIVES  # 600 sessions

TARGET_DROP_RATE = 0.020  # 2.0%


def get_p_resp(phi_0: float, is_emergent: int, is_medvoice: int, omega: float = 0.0) -> float:
    """Compute candidate generation failure probability for a system."""
    logit = phi_0 + PHI_URG * is_emergent + PHI_SYS * is_medvoice + omega
    return 1.0 / (1.0 + np.exp(-logit))


def get_q_scenario(phi_0: float, is_emergent: int, omega: float = 0.0) -> float:
    """Probability that candidate pair generation fails (G_s = 1)."""
    p_mv = get_p_resp(phi_0, is_emergent, 1, omega)
    p_comp = get_p_resp(phi_0, is_emergent, 0, omega)
    return 1.0 - (1.0 - p_mv) * (1.0 - p_comp)


def get_p_dropped_session(phi_0: float, is_emergent: int, omega: float = 0.0) -> float:
    """Probability that an evaluation session (s, p) is incomplete (D_sp = 1)."""
    q = get_q_scenario(phi_0, is_emergent, omega)
    return 1.0 - (1.0 - q) * (1.0 - R_EVAL)


def calibrate_intercept(sigma_omega: float) -> float:
    """Solve for phi_0 targeting expected 2.0% dropped sessions using Brent's method."""
    def objective(phi_0: float) -> float:
        if sigma_omega == 0.0:
            p_em = get_p_dropped_session(phi_0, 1)
            p_non = get_p_dropped_session(phi_0, 0)
            exp_p = (N_EMERGENT / N_SCENARIOS) * p_em + (N_NON_EMERGENT / N_SCENARIOS) * p_non
        else:
            def integrand(w: float) -> float:
                p_em = get_p_dropped_session(phi_0, 1, w)
                p_non = get_p_dropped_session(phi_0, 0, w)
                dens = np.exp(-0.5 * (w / sigma_omega) ** 2) / (np.sqrt(2 * np.pi) * sigma_omega)
                return ((N_EMERGENT / N_SCENARIOS) * p_em + (N_NON_EMERGENT / N_SCENARIOS) * p_non) * dens

            exp_p, _ = integrate.quad(integrand, -7 * sigma_omega, 7 * sigma_omega, epsabs=1e-12, epsrel=1e-12)
        return exp_p - TARGET_DROP_RATE

    root = optimize.brentq(objective, -6.5, -3.5, xtol=1e-11, rtol=1e-11)
    return float(root)


def compute_scenario_pmf_and_variance(phi_0: float, is_emergent: int, sigma_omega: float):
    """Compute PMF of Z_s in {0, 1, 2, 3} and Var(Z_s)."""
    if sigma_omega == 0.0:
        q = get_q_scenario(phi_0, is_emergent, 0.0)
        pmf = np.zeros(4)
        for k in range(3):
            pmf[k] = (1.0 - q) * (math.comb(3, k) * (R_EVAL ** k) * ((1.0 - R_EVAL) ** (3 - k)))
        pmf[3] = q + (1.0 - q) * (R_EVAL ** 3)
        var_zs = 3 * (1 - q) * R_EVAL * (1 - R_EVAL) + 9 * q * (1 - q) * ((1 - R_EVAL) ** 2)
        return pmf, q, var_zs
    else:
        pmf = np.zeros(4)
        def q_at_w(w):
            return get_q_scenario(phi_0, is_emergent, w)

        def integrand_q(w):
            dens = np.exp(-0.5 * (w / sigma_omega) ** 2) / (np.sqrt(2 * np.pi) * sigma_omega)
            return q_at_w(w) * dens

        q_marg, _ = integrate.quad(integrand_q, -7 * sigma_omega, 7 * sigma_omega, epsabs=1e-12, epsrel=1e-12)

        for k in range(4):
            def integrand_k(w, k_val=k):
                q = q_at_w(w)
                dens = np.exp(-0.5 * (w / sigma_omega) ** 2) / (np.sqrt(2 * np.pi) * sigma_omega)
                if k_val < 3:
                    pk = (1.0 - q) * (math.comb(3, k_val) * (R_EVAL ** k_val) * ((1.0 - R_EVAL) ** (3 - k_val)))
                else:
                    pk = q + (1.0 - q) * (R_EVAL ** 3)
                return pk * dens

            pmf[k], _ = integrate.quad(integrand_k, -7 * sigma_omega, 7 * sigma_omega, epsabs=1e-12, epsrel=1e-12)

        # Total variance: Var(Z) = E[Var(Z|w)] + Var(E[Z|w])
        def integrand_var_cond(w):
            q = q_at_w(w)
            dens = np.exp(-0.5 * (w / sigma_omega) ** 2) / (np.sqrt(2 * np.pi) * sigma_omega)
            var_w = 3 * (1 - q) * R_EVAL * (1 - R_EVAL) + 9 * q * (1 - q) * ((1 - R_EVAL) ** 2)
            return var_w * dens

        def integrand_mean(w):
            q = q_at_w(w)
            dens = np.exp(-0.5 * (w / sigma_omega) ** 2) / (np.sqrt(2 * np.pi) * sigma_omega)
            mean_w = 3 * (1 - (1 - q) * (1 - R_EVAL))
            return mean_w * dens

        def integrand_mean_sq(w):
            q = q_at_w(w)
            dens = np.exp(-0.5 * (w / sigma_omega) ** 2) / (np.sqrt(2 * np.pi) * sigma_omega)
            mean_w = 3 * (1 - (1 - q) * (1 - R_EVAL))
            return (mean_w ** 2) * dens

        e_var, _ = integrate.quad(integrand_var_cond, -7 * sigma_omega, 7 * sigma_omega, epsabs=1e-12, epsrel=1e-12)
        e_mean, _ = integrate.quad(integrand_mean, -7 * sigma_omega, 7 * sigma_omega, epsabs=1e-12, epsrel=1e-12)
        e_mean_sq, _ = integrate.quad(integrand_mean_sq, -7 * sigma_omega, 7 * sigma_omega, epsabs=1e-12, epsrel=1e-12)
        var_zs = e_var + (e_mean_sq - e_mean ** 2)
        return pmf, q_marg, var_zs


def convolve_discrete_pmf(pmf_em, pmf_non):
    """Perform exact discrete convolution across 70 emergent and 130 non-emergent scenarios."""
    pmf = np.array([1.0])
    for _ in range(N_EMERGENT):
        pmf = np.convolve(pmf, pmf_em)
    for _ in range(N_NON_EMERGENT):
        pmf = np.convolve(pmf, pmf_non)
    return pmf


def run_full_calibration():
    shock_configs = [0.0, 0.3, 0.6]
    results = {}

    print("=" * 80)
    print("MEDVOICE STUDY 3: DESIGN A MISSINGNESS DGP CALIBRATION & DISCRETE CONVOLUTION")
    print("=" * 80)

    for sigma_omega in shock_configs:
        phi_0 = calibrate_intercept(sigma_omega)
        pmf_em, q_em, var_em = compute_scenario_pmf_and_variance(phi_0, 1, sigma_omega)
        pmf_non, q_non, var_non = compute_scenario_pmf_and_variance(phi_0, 0, sigma_omega)

        var_total = N_EMERGENT * var_em + N_NON_EMERGENT * var_non
        sd_total = math.sqrt(var_total)

        pmf_total = convolve_discrete_pmf(pmf_em, pmf_non)
        cdf_total = np.cumsum(pmf_total)

        mean_total = float(np.sum(np.arange(len(pmf_total)) * pmf_total))
        var_from_pmf = float(np.sum(((np.arange(len(pmf_total)) - mean_total) ** 2) * pmf_total))

        # Discrete quantile calculation:
        # Central 95% discrete interval [q_lower, q_upper]
        # q_lower: smallest integer n such that P(N <= n) >= 0.025
        # q_upper: smallest integer n such that P(N <= n) >= 0.975
        q_lower = int(np.searchsorted(cdf_total, 0.025))
        q_upper = int(np.searchsorted(cdf_total, 0.975))

        results[sigma_omega] = {
            "phi_0": phi_0,
            "q_em": q_em,
            "q_non": q_non,
            "var_em": var_em,
            "var_non": var_non,
            "var_total": var_total,
            "sd_total": sd_total,
            "mean_total": mean_total,
            "q_lower": q_lower,
            "q_upper": q_upper,
            "cdf_q_lower_minus_1": float(cdf_total[q_lower - 1]),
            "cdf_q_lower": float(cdf_total[q_lower]),
            "cdf_q_upper_minus_1": float(cdf_total[q_upper - 1]),
            "cdf_q_upper": float(cdf_total[q_upper]),
        }

        print(f"\n--- Shock Configuration: sigma_omega = {sigma_omega} ---")
        print(f"  Calibrated phi_0:          {phi_0:.7f} (displayed: {phi_0:.4f})")
        print(f"  Emergent Pair Drop q_em:   {q_em:.6f} | Var(Z_em): {var_em:.6f}")
        print(f"  Non-Emergent Drop q_non:   {q_non:.6f} | Var(Z_non): {var_non:.6f}")
        print(f"  Aggregated Var(N_dropped): {var_total:.4f} (analytical) | {var_from_pmf:.4f} (PMF)")
        print(f"  Aggregated SD(N_dropped):  {sd_total:.4f}")
        print(f"  Expected Dropped Sessions: {mean_total:.4f} / {N_SESSIONS} ({mean_total/N_SESSIONS*100:.2f}%)")
        print(f"  Exact Central 95% Quantiles: [{q_lower}, {q_upper}]")
        print(f"    P(N <= {q_lower-1}) = {cdf_total[q_lower-1]:.5f} <= 0.025")
        print(f"    P(N <= {q_lower})   = {cdf_total[q_lower]:.5f} > 0.025")
        print(f"    P(N <= {q_upper-1}) = {cdf_total[q_upper-1]:.5f} < 0.975")
        print(f"    P(N <= {q_upper})   = {cdf_total[q_upper]:.5f} >= 0.975")

    print("\n" + "=" * 90)
    print("SUMMARY FOR SPECIFICATION TABLE v3.3.15:")
    print("=" * 90)
    for sigma_omega, res in results.items():
        print(f"sigma_omega = {sigma_omega}: phi_0 = {res['phi_0']:.5f}, "
              f"q_em = {res['q_em']:.7f}, q_non = {res['q_non']:.7f}, "
              f"Var = {res['var_total']:.5f}, SD = {res['sd_total']:.5f}, "
              f"95% Discrete Range = {res['q_lower']} to {res['q_upper']}")

    return results


if __name__ == "__main__":
    run_full_calibration()
