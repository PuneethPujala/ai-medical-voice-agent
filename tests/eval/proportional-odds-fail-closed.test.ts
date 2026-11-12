/**
 * Unit and Regression Tests for Study 3 Proportional Odds Diagnostic Fail-Closed Architecture
 * Specification Version 3.3.21 / Protocol Version 2.3.16
 *
 * Verifies:
 * 1. Step 0: Event count screening guard (< 15 events).
 * 2. Step 1: Optimizer termination and non-zero convergence code handling.
 * 3. Step 1b: Structural Model Invariants Verification:
 *    - Full fixed-effect rank = 15, no dropped coefficients (check.rankX = "stop.deficient").
 *    - Required contrast terms present ("M1", "M1:PerspectiveSIM-02", "M1:PerspectiveSIM-03").
 *    - Required random-effects grouping terms present ("scenario_id", "scenario_persp_id").
 *    - Named contrast vector construction: 0 weight on all 9 domain indicators, 1.0 on M1, 1/3 on interactions.
 *    - Regression test proving naive positional indexing assigns 1/3 weight to Domain indicators in R order.
 * 4. Dynamic Dimension Validation:
 *    - n_fixef = length(fixef(fit)) = 15 (1 intercept + 1 system + 2 perspective + 2 interaction + 9 domain)
 *    - n_theta = length(getME(fit, "theta")) = 2 (scalar intercepts for scenario and scenario_persp)
 *    - n_expected = n_fixef + n_theta = 17 parameters
 * 5. Step 2: Random-effects singularity fails closed (SINGULAR_FIT) without silent model reduction.
 *    - Correct interpretation: tests boundary parameter condition (theta_i <= tol) on relative covariance factor.
 *    - Supplementary attribution: rePCA() provides orthogonal standard deviation breakdown.
 *    - Marks downstream checks as NOT_ASSESSED_DUE_TO_SINGULARITY.
 * 6. Step 3: Explicit raw gradient diagnostics (|nabla| < 1e-3, dynamic length == n_expected (17), all finite, relTol = NULL).
 * 7. Step 4: Full derivative Hessian (dim == 17x17, min eigval > 1e-6, cond num < 1e6, chol ok, conv$lme4$code == 0)
 *    & fixed-effect vcov (dim == 15x15, PD, finite).
 * 8. Step 5: Strict fixed-effect quasi-separation guard (max SE < 10.0).
 * 9. Step 6: Four-cutpoint omnibus synthesis: fails closed if any single cutpoint fails.
 * 10. Invariant: Preserved primary random-effects structure (u_s + v_sp); no silent fallback.
 * 11. Explicit Tri-State Diagnostic Telemetry (PASSED | FAILED | NOT_ASSESSED_DUE_TO_*).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

export type DiagnosticStepStatus =
  | 'PASSED'
  | 'EVENT_COUNT_GUARD_FAILED'
  | 'OPTIMIZER_EXECUTION_ERROR'
  | 'OPTIMIZER_CONVERGENCE_FAILED'
  | 'STRUCTURAL_SPECIFICATION_FAILED'
  | 'SINGULAR_FIT'
  | 'GRADIENT_EVALUATION_FAILED'
  | 'GRADIENT_TOLERANCE_EXCEEDED'
  | 'HESSIAN_CHECK_FAILED'
  | 'QUASI_SEPARATION_DETECTED'
  | 'QUASI_SEPARATION_MAX_SE_EXCEEDED';

export type TriStateStatus =
  | 'PASSED'
  | 'FAILED'
  | 'NOT_ASSESSED_DUE_TO_EVENT_GUARD'
  | 'NOT_ASSESSED_DUE_TO_OPTIMIZER_FAILURE'
  | 'NOT_ASSESSED_DUE_TO_STRUCTURAL_FAILURE'
  | 'NOT_ASSESSED_DUE_TO_SINGULARITY'
  | 'NOT_ASSESSED_DUE_TO_GRADIENT_FAILURE'
  | 'NOT_ASSESSED_DUE_TO_HESSIAN_FAILURE';

export interface CutpointTelemetry {
  cutpoint: number;
  threshold: number;
  status: DiagnosticStepStatus;
  detail: string;
  s0_event_status: TriStateStatus;
  s1_opt_status: TriStateStatus;
  s2_sing_status: TriStateStatus;
  s3_grad_status: TriStateStatus;
  s4_hess_status: TriStateStatus;
  s5_sep_status: TriStateStatus;
  opt_code: number | null;
  is_singular: boolean | null;
  singular_components?: string;
  n_fixef?: number;
  n_theta?: number;
  n_expected?: number;
  max_grad: number | null;
  min_hess_eigval: number | null;
  max_se: number | null;
  contrast: number | null;
}

export interface OmnibusDiagnosticResult {
  status: 'SUCCESS' | 'DIAGNOSTIC_NON_ESTIMABLE_DUE_TO_SPARSITY';
  delta_po: number | null;
  converged: boolean;
  contrasts: (number | null)[];
  diagnostics: CutpointTelemetry[];
  failed_cutpoints: number[];
  reason: string;
}

export const CANONICAL_REFERENCE_DOMAIN = 'cardiovascular';

export const CANONICAL_NON_REFERENCE_DOMAINS = [
  'Domainrespiratory_emergencies',
  'Domainneurological',
  'Domaingastrointestinal',
  'Domainendocrine_metabolic',
  'Domaininfectious_diseases',
  'Domainpediatric_urgent_care',
  'Domaintrauma_musculoskeletal',
  'Domaintoxicology_environmental',
  'Domainroutine_preventive',
] as const;

export const ALL_10_REGISTERED_DOMAINS = [
  'cardiovascular',
  'respiratory_emergencies',
  'neurological',
  'gastrointestinal',
  'endocrine_metabolic',
  'infectious_diseases',
  'pediatric_urgent_care',
  'trauma_musculoskeletal',
  'toxicology_environmental',
  'routine_preventive',
] as const;

/**
 * Pure verification engine replicating the exact R decision logic in TypeScript
 * to guarantee that our specification, mock verification, and contract invariants
 * are strictly machine-enforced and regression-tested.
 */
export function evaluateCutpointModel(input: {
  cutpoint: number;
  n_pos: number;
  n_neg: number;
  n_fixef?: number;
  n_theta?: number;
  optimizer_error?: string | null;
  optimizer_code?: number | null;
  has_dropped?: boolean;
  design_matrix_rank?: number;
  grouping_terms?: string[];
  lme4_conv_code?: number | number[] | null;
  lme4_message?: string | null;
  lme4_messages?: string[] | null;
  lme4_hess_code?: number | number[] | null;
  fitting_args?: { nAGQ?: number };
  require_full_domain_taxonomy?: boolean;
  is_singular?: boolean | null;
  singular_components?: string;
  raw_gradient?: number[] | null;
  has_gradient_warning?: boolean;
  full_hessian_dim?: [number, number];
  full_hessian_min_eigval?: number | null;
  full_hessian_cond_num?: number | null;
  full_hessian_chol_failed?: boolean;
  has_hessian_warning?: boolean;
  fixed_effect_dim?: [number, number];
  cov_matrix_valid?: boolean;
  se_values?: number[] | null;
  fixed_effects?: Record<string, number>;
}): CutpointTelemetry {
  const c = input.cutpoint;
  const threshold = c + 1;

  // Step 0: Event Count Guard
  if (input.n_pos < 15 || input.n_neg < 15) {
    return {
      cutpoint: c,
      threshold,
      status: 'EVENT_COUNT_GUARD_FAILED',
      detail: `Minority class has < 15 events (pos=${input.n_pos}, neg=${input.n_neg})`,
      s0_event_status: 'FAILED',
      s1_opt_status: 'NOT_ASSESSED_DUE_TO_EVENT_GUARD',
      s2_sing_status: 'NOT_ASSESSED_DUE_TO_EVENT_GUARD',
      s3_grad_status: 'NOT_ASSESSED_DUE_TO_EVENT_GUARD',
      s4_hess_status: 'NOT_ASSESSED_DUE_TO_EVENT_GUARD',
      s5_sep_status: 'NOT_ASSESSED_DUE_TO_EVENT_GUARD',
      opt_code: null,
      is_singular: null,
      max_grad: null,
      min_hess_eigval: null,
      max_se: null,
      contrast: null,
    };
  }
  const s0_event_status: TriStateStatus = 'PASSED';

  // Step 1: Optimizer Execution & Return Code Check
  if (input.optimizer_error) {
    return {
      cutpoint: c,
      threshold,
      status: 'OPTIMIZER_EXECUTION_ERROR',
      detail: `Fatal optimizer error: ${input.optimizer_error}`,
      s0_event_status,
      s1_opt_status: 'FAILED',
      s2_sing_status: 'NOT_ASSESSED_DUE_TO_OPTIMIZER_FAILURE',
      s3_grad_status: 'NOT_ASSESSED_DUE_TO_OPTIMIZER_FAILURE',
      s4_hess_status: 'NOT_ASSESSED_DUE_TO_OPTIMIZER_FAILURE',
      s5_sep_status: 'NOT_ASSESSED_DUE_TO_OPTIMIZER_FAILURE',
      opt_code: -1,
      is_singular: null,
      max_grad: null,
      min_hess_eigval: null,
      max_se: null,
      contrast: null,
    };
  }

  const opt_code = input.optimizer_code ?? -1;
  if (opt_code !== 0) {
    return {
      cutpoint: c,
      threshold,
      status: 'OPTIMIZER_CONVERGENCE_FAILED',
      detail: `Optimizer termination code ${opt_code} (expected 0)`,
      s0_event_status,
      s1_opt_status: 'FAILED',
      s2_sing_status: 'NOT_ASSESSED_DUE_TO_OPTIMIZER_FAILURE',
      s3_grad_status: 'NOT_ASSESSED_DUE_TO_OPTIMIZER_FAILURE',
      s4_hess_status: 'NOT_ASSESSED_DUE_TO_OPTIMIZER_FAILURE',
      s5_sep_status: 'NOT_ASSESSED_DUE_TO_OPTIMIZER_FAILURE',
      opt_code,
      is_singular: null,
      max_grad: null,
      min_hess_eigval: null,
      max_se: null,
      contrast: null,
    };
  }
  const s1_opt_status: TriStateStatus = 'PASSED';

  // Dynamic Parameter Dimension Calculation
  const n_fixef = input.n_fixef ?? 15;
  const n_theta = input.n_theta ?? 2;
  const n_expected = n_fixef + n_theta; // 17

  // Step 1b: Structural Model Invariants Verification
  const nagq_invalid = input.fitting_args?.nAGQ !== undefined && input.fitting_args.nAGQ !== 1;
  const has_dropped = Boolean(input.has_dropped);
  const rank_deficient = input.design_matrix_rank !== undefined && input.design_matrix_rank < 15;
  const grouping_invalid = Boolean(
    input.grouping_terms &&
      (!input.grouping_terms.includes('scenario_id') ||
        !input.grouping_terms.includes('scenario_persp_id') ||
        input.grouping_terms.length !== 2)
  );
  const missing_interaction = Boolean(
    input.fixed_effects &&
      (!('M1' in input.fixed_effects) ||
        !('M1:PerspectiveSIM-02' in input.fixed_effects) ||
        !('M1:PerspectiveSIM-03' in input.fixed_effects))
  );

  // Check Domain Taxonomy Invariants
  let domain_taxonomy_error: string | null = null;
  if (input.fixed_effects) {
    const fixefNames = Object.keys(input.fixed_effects);
    const domainNames = fixefNames.filter((k) => k.startsWith('Domain'));

    if (domainNames.includes('Domaincardiovascular')) {
      domain_taxonomy_error = 'Domain taxonomy invariant violated: Cardiovascular is reference domain and must not have a dummy coefficient';
    } else {
      const unapproved = domainNames.filter((d) => !CANONICAL_NON_REFERENCE_DOMAINS.includes(d as any));
      if (unapproved.length > 0) {
        domain_taxonomy_error = `Domain taxonomy invariant violated: Unapproved domain(s) detected: ${unapproved.join(', ')}`;
      } else if (input.require_full_domain_taxonomy) {
        const missing = CANONICAL_NON_REFERENCE_DOMAINS.filter((d) => !domainNames.includes(d));
        if (missing.length > 0) {
          domain_taxonomy_error = `Domain taxonomy invariant violated: Missing required registered domain(s): ${missing.join(', ')}`;
        }
      }
    }
  }

  if (nagq_invalid || has_dropped || rank_deficient || grouping_invalid || missing_interaction || domain_taxonomy_error) {
    const reason = nagq_invalid
      ? `Invalid quadrature specification: nAGQ=${input.fitting_args?.nAGQ} (nAGQ = 1L Laplace approximation strictly required)`
      : domain_taxonomy_error
        ? domain_taxonomy_error
        : has_dropped
          ? 'Dropped fixed-effect coefficients detected (check.rankX violation)'
          : rank_deficient
            ? `Design matrix rank deficient (rank=${input.design_matrix_rank}, expected 15)`
            : grouping_invalid
              ? `Missing required random-effects grouping terms: ${input.grouping_terms?.join(', ')}`
              : 'Missing required interaction/system contrast coefficients in fixed effects';

    return {
      cutpoint: c,
      threshold,
      status: 'STRUCTURAL_SPECIFICATION_FAILED',
      detail: reason,
      s0_event_status,
      s1_opt_status: 'FAILED',
      s2_sing_status: 'NOT_ASSESSED_DUE_TO_STRUCTURAL_FAILURE',
      s3_grad_status: 'NOT_ASSESSED_DUE_TO_STRUCTURAL_FAILURE',
      s4_hess_status: 'NOT_ASSESSED_DUE_TO_STRUCTURAL_FAILURE',
      s5_sep_status: 'NOT_ASSESSED_DUE_TO_STRUCTURAL_FAILURE',
      opt_code,
      is_singular: null,
      n_fixef,
      n_theta,
      n_expected,
      max_grad: null,
      min_hess_eigval: null,
      max_se: null,
      contrast: null,
    };
  }

  // Step 2: Random-effects Singularity (Fail Closed for Primary Model)
  const is_sing = Boolean(input.is_singular);
  if (is_sing) {
    const comp_str = input.singular_components ?? 'Rank-deficient random effects covariance matrix';
    return {
      cutpoint: c,
      threshold,
      status: 'SINGULAR_FIT',
      detail: `Primary random-effects structure is singular (${comp_str}). Refitting with reduced model is prohibited on primary pathway.`,
      s0_event_status,
      s1_opt_status,
      s2_sing_status: 'FAILED',
      s3_grad_status: 'NOT_ASSESSED_DUE_TO_SINGULARITY',
      s4_hess_status: 'NOT_ASSESSED_DUE_TO_SINGULARITY',
      s5_sep_status: 'NOT_ASSESSED_DUE_TO_SINGULARITY',
      opt_code,
      is_singular: true,
      singular_components: comp_str,
      n_fixef,
      n_theta,
      n_expected,
      max_grad: null,
      min_hess_eigval: null,
      max_se: null,
      contrast: null,
    };
  }
  const s2_sing_status: TriStateStatus = 'PASSED';

  // Normalize lme4 convergence codes and messages to arrays
  const rawCodes: number[] = [];
  if (input.lme4_conv_code !== undefined && input.lme4_conv_code !== null) {
    if (Array.isArray(input.lme4_conv_code)) {
      rawCodes.push(...input.lme4_conv_code);
    } else {
      rawCodes.push(input.lme4_conv_code);
    }
  }
  if (input.lme4_hess_code !== undefined && input.lme4_hess_code !== null) {
    if (Array.isArray(input.lme4_hess_code)) {
      rawCodes.push(...input.lme4_hess_code);
    } else {
      rawCodes.push(input.lme4_hess_code);
    }
  }

  const allMessages: string[] = [];
  if (input.lme4_message) {
    allMessages.push(input.lme4_message);
  }
  if (input.lme4_messages) {
    allMessages.push(...input.lme4_messages);
  }

  // Step 3: Raw Gradient Diagnostics & Dynamic Dimensionality Check
  // Independently detect gradient failures regardless of final numeric code (which may have been overwritten by Hessian checks)
  const msgGradEvalFail = allMessages.some((m) => /unable to evaluate|non-finite/i.test(m));
  const codeGradEvalFail = rawCodes.includes(-5);
  const rawGradInvalid =
    !input.raw_gradient ||
    input.raw_gradient.length !== n_expected ||
    input.raw_gradient.some((g) => Number.isNaN(g) || !Number.isFinite(g));

  const isGradEvalFail = msgGradEvalFail || codeGradEvalFail || rawGradInvalid;

  const msgGradTolFail = allMessages.some((m) => /failed to converge with max\|grad\||max\|relative grad\|/i.test(m));
  const codeGradTolFail = rawCodes.includes(-1) || rawCodes.includes(-2);
  const rawGradTolFail = !rawGradInvalid && Math.max(...input.raw_gradient!.map((g) => Math.abs(g))) >= 1e-3;
  const hasGradWarning = Boolean(input.has_gradient_warning) || allMessages.some((m) => /gradient|relTol/i.test(m) && !/unable to evaluate|non-finite/i.test(m));

  const isGradTolFail = !isGradEvalFail && (msgGradTolFail || codeGradTolFail || rawGradTolFail || hasGradWarning);

  if (isGradEvalFail || isGradTolFail) {
    const codesStr = rawCodes.length > 0 ? rawCodes.join(',') : 'none';
    let status: DiagnosticStepStatus;
    let detail: string;

    if (isGradEvalFail) {
      status = 'GRADIENT_EVALUATION_FAILED';
      const detailMsg = msgGradEvalFail
        ? allMessages.filter((m) => /unable to evaluate|non-finite/i.test(m)).join('; ')
        : codeGradEvalFail
          ? 'Gradient contains NA or non-finite values (lme4 code -5)'
          : `Gradient vector invalid (length=${input.raw_gradient?.length ?? 0}, expected=${n_expected}, non-finite)`;
      detail = `Gradient evaluation failure [codes: ${codesStr}]: ${detailMsg}`;
    } else {
      status = 'GRADIENT_TOLERANCE_EXCEEDED';
      const maxGVal = !rawGradInvalid ? Math.max(...input.raw_gradient!.map((g) => Math.abs(g))) : null;
      const detailMsg = msgGradTolFail || hasGradWarning
        ? allMessages.filter((m) => /failed to converge with max\|grad\||max\|relative grad\||gradient|relTol/i.test(m)).join('; ')
        : rawCodes.includes(-2)
          ? 'Relative-gradient check failure (lme4 code -2, unreachable under primary relTol = NULL)'
          : `Max absolute raw gradient ${maxGVal !== null ? maxGVal.toExponential(2) : 'NA'} >= 1e-3`;
      detail = `Gradient tolerance exceeded [codes: ${codesStr}]: ${detailMsg}`;
    }

    return {
      cutpoint: c,
      threshold,
      status,
      detail,
      s0_event_status,
      s1_opt_status,
      s2_sing_status,
      s3_grad_status: 'FAILED',
      s4_hess_status: 'NOT_ASSESSED_DUE_TO_GRADIENT_FAILURE',
      s5_sep_status: 'NOT_ASSESSED_DUE_TO_GRADIENT_FAILURE',
      opt_code: rawCodes[0] ?? opt_code,
      is_singular: false,
      n_fixef,
      n_theta,
      n_expected,
      max_grad: !rawGradInvalid ? Math.max(...input.raw_gradient!.map((g) => Math.abs(g))) : null,
      min_hess_eigval: null,
      max_se: null,
      contrast: null,
    };
  }
  const s3_grad_status: TriStateStatus = 'PASSED';
  const max_grad = Math.max(...input.raw_gradient!.map((g) => Math.abs(g)));

  // Step 4: Full Hessian & Fixed-Effect Information Matrix Verification
  // Check full Hessian dimensions
  if (
    input.full_hessian_dim &&
    (input.full_hessian_dim[0] !== n_expected || input.full_hessian_dim[1] !== n_expected)
  ) {
    return {
      cutpoint: c,
      threshold,
      status: 'HESSIAN_CHECK_FAILED',
      detail: `Full derivative Hessian dimension invalid (${input.full_hessian_dim.join('x')}, expected ${n_expected}x${n_expected})`,
      s0_event_status,
      s1_opt_status,
      s2_sing_status,
      s3_grad_status,
      s4_hess_status: 'FAILED',
      s5_sep_status: 'NOT_ASSESSED_DUE_TO_HESSIAN_FAILURE',
      opt_code,
      is_singular: false,
      n_fixef,
      n_theta,
      n_expected,
      max_grad,
      min_hess_eigval: null,
      max_se: null,
      contrast: null,
    };
  }

  // Check fixed-effect covariance dimensions
  if (
    input.fixed_effect_dim &&
    (input.fixed_effect_dim[0] !== n_fixef || input.fixed_effect_dim[1] !== n_fixef)
  ) {
    return {
      cutpoint: c,
      threshold,
      status: 'HESSIAN_CHECK_FAILED',
      detail: `Fixed-effects covariance dimension invalid (${input.fixed_effect_dim.join('x')}, expected ${n_fixef}x${n_fixef})`,
      s0_event_status,
      s1_opt_status,
      s2_sing_status,
      s3_grad_status,
      s4_hess_status: 'FAILED',
      s5_sep_status: 'NOT_ASSESSED_DUE_TO_HESSIAN_FAILURE',
      opt_code,
      is_singular: false,
      n_fixef,
      n_theta,
      n_expected,
      max_grad,
      min_hess_eigval: null,
      max_se: null,
      contrast: null,
    };
  }

  const min_eig = input.full_hessian_min_eigval ?? 1.0;
  const cond_num = input.full_hessian_cond_num ?? 10.0;
  const chol_failed = Boolean(input.full_hessian_chol_failed);

  const KNOWN_HESS_CODES = [-3, -4, -6, 2, 3];
  const detectedHessCodes = rawCodes.filter((code) => KNOWN_HESS_CODES.includes(code));
  const hasHessCodeFail = detectedHessCodes.length > 0;

  const ALL_KNOWN_CODES = [0, -1, -2, -3, -4, -5, -6, 2, 3];
  const unrecognizedCodes = rawCodes.filter((code) => !ALL_KNOWN_CODES.includes(code));
  const hasUnknownCode = unrecognizedCodes.length > 0;

  const hasHessMsg = allMessages.some((m) => /Hessian|singular|eigenvalue|unidentifiable/i.test(m));

  if (
    input.cov_matrix_valid === false ||
    input.has_hessian_warning ||
    hasHessMsg ||
    chol_failed ||
    hasHessCodeFail ||
    hasUnknownCode ||
    min_eig <= 1e-6 ||
    cond_num > 1e6 ||
    Number.isNaN(min_eig) ||
    !Number.isFinite(min_eig)
  ) {
    const codeReasons: string[] = [];
    if (detectedHessCodes.includes(-3)) codeReasons.push('Negative Hessian eigenvalues (code -3)');
    if (detectedHessCodes.includes(-4)) codeReasons.push('Numerically singular Hessian (code -4)');
    if (detectedHessCodes.includes(-6)) codeReasons.push('Hessian eigenvalue calculation failure (code -6)');
    if (detectedHessCodes.includes(2)) codeReasons.push('Excessively large Hessian eigenvalue (code 2)');
    if (detectedHessCodes.includes(3)) codeReasons.push('Excessive eigenvalue ratio / ill-conditioned Hessian (code 3)');
    if (hasUnknownCode) codeReasons.push(`Unrecognized diagnostic code(s): ${unrecognizedCodes.join(', ')}`);

    const reason = codeReasons.length > 0
      ? `Hessian diagnostic code(s) [${[...detectedHessCodes, ...unrecognizedCodes].join(', ')}]: ${codeReasons.join('; ')}`
      : chol_failed
        ? 'Cholesky decomposition of full Hessian failed'
        : cond_num > 1e6
          ? `Full Hessian condition number ${cond_num.toExponential(2)} > 1e6`
          : min_eig <= 1e-6
            ? `Full derivative Hessian min eigenvalue ${min_eig} <= 1e-6`
            : hasHessMsg
              ? allMessages.filter((m) => /Hessian|singular|eigenvalue|unidentifiable/i.test(m)).join('; ')
              : 'vcov non-invertible or Hessian warning message emitted';

    return {
      cutpoint: c,
      threshold,
      status: 'HESSIAN_CHECK_FAILED',
      detail: reason,
      s0_event_status,
      s1_opt_status,
      s2_sing_status,
      s3_grad_status,
      s4_hess_status: 'FAILED',
      s5_sep_status: 'NOT_ASSESSED_DUE_TO_HESSIAN_FAILURE',
      opt_code: rawCodes[0] ?? opt_code,
      is_singular: false,
      n_fixef,
      n_theta,
      n_expected,
      max_grad,
      min_hess_eigval: Number.isFinite(min_eig) ? min_eig : null,
      max_se: null,
      contrast: null,
    };
  }
  const s4_hess_status: TriStateStatus = 'PASSED';

  // Step 5: Fixed-Effect Quasi-Separation Guard
  if (!input.se_values || input.se_values.some((se) => Number.isNaN(se) || !Number.isFinite(se))) {
    return {
      cutpoint: c,
      threshold,
      status: 'QUASI_SEPARATION_DETECTED',
      detail: 'Fixed-effect standard error contains NaN or Inf',
      s0_event_status,
      s1_opt_status,
      s2_sing_status,
      s3_grad_status,
      s4_hess_status,
      s5_sep_status: 'FAILED',
      opt_code,
      is_singular: false,
      n_fixef,
      n_theta,
      n_expected,
      max_grad,
      min_hess_eigval: min_eig,
      max_se: Infinity,
      contrast: null,
    };
  }

  const max_se = Math.max(...input.se_values);
  if (max_se >= 10.0) {
    return {
      cutpoint: c,
      threshold,
      status: 'QUASI_SEPARATION_MAX_SE_EXCEEDED',
      detail: `Max fixed-effect standard error ${max_se.toFixed(2)} >= 10.0 threshold`,
      s0_event_status,
      s1_opt_status,
      s2_sing_status,
      s3_grad_status,
      s4_hess_status,
      s5_sep_status: 'FAILED',
      opt_code,
      is_singular: false,
      n_fixef,
      n_theta,
      n_expected,
      max_grad,
      min_hess_eigval: min_eig,
      max_se,
      contrast: null,
    };
  }
  const s5_sep_status: TriStateStatus = 'PASSED';

  // Step 6: Contrast Evaluation
  const b1 = input.fixed_effects?.['M1'] ?? 0;
  const d2 = input.fixed_effects?.['M1:PerspectiveSIM-02'] ?? 0;
  const d3 = input.fixed_effects?.['M1:PerspectiveSIM-03'] ?? 0;
  const psi = b1 + (d2 + d3) / 3;

  return {
    cutpoint: c,
    threshold,
    status: 'PASSED',
    detail: 'All checks passed cleanly under primary random-effects model',
    s0_event_status,
    s1_opt_status,
    s2_sing_status,
    s3_grad_status,
    s4_hess_status,
    s5_sep_status,
    opt_code,
    is_singular: false,
    n_fixef,
    n_theta,
    n_expected,
    max_grad,
    min_hess_eigval: min_eig,
    max_se,
    contrast: psi,
  };
}

export const REQUIRED_CONTRAST_TERMS = ['M1', 'M1:PerspectiveSIM-02', 'M1:PerspectiveSIM-03'];

export function buildNamedContrastVector(coefNames: string[]): Record<string, number> {
  const missing = REQUIRED_CONTRAST_TERMS.filter((t) => !coefNames.includes(t));
  if (missing.length > 0) {
    throw new Error(`Model is missing required contrast coefficients: ${missing.join(', ')}`);
  }

  // Domain taxonomy invariant verification
  const domainTerms = coefNames.filter((name) => name.startsWith('Domain'));
  if (domainTerms.includes('Domaincardiovascular')) {
    throw new Error('Contrast invariant violated: Cardiovascular is reference domain and must not have a dummy coefficient.');
  }
  const unapproved = domainTerms.filter((d) => !CANONICAL_NON_REFERENCE_DOMAINS.includes(d as any));
  if (unapproved.length > 0) {
    throw new Error(`Contrast invariant violated: Unapproved domain dummy term(s): ${unapproved.join(', ')}`);
  }

  const L: Record<string, number> = {};
  for (const name of coefNames) {
    L[name] = 0;
  }
  L['M1'] = 1.0;
  L['M1:PerspectiveSIM-02'] = 1.0 / 3.0;
  L['M1:PerspectiveSIM-03'] = 1.0 / 3.0;

  // Structural invariant assertion: All Domain coefficients must receive exactly 0 weight
  for (const dt of domainTerms) {
    if (L[dt] !== 0) {
      throw new Error(`Contrast invariant violated: Domain coefficient ${dt} has non-zero weight.`);
    }
  }

  return L;
}

export function computeNamedContrast(fixefEstimates: Record<string, number>): number {
  const coefNames = Object.keys(fixefEstimates);
  const L = buildNamedContrastVector(coefNames);
  let psi = 0;
  for (const name of coefNames) {
    psi += L[name] * fixefEstimates[name];
  }
  return psi;
}

export function computePositionalContrast(coefArray: number[]): number {
  // Naive positional vector c = [0, 1, 0, 0, 1/3, 1/3, 0_9]
  // In an array where 0 is Intercept, 1 is M1, 2 is Persp2, 3 is Persp3,
  // 4 and 5 are the first two Domain dummies!
  return coefArray[1] + (coefArray[4] + coefArray[5]) / 3.0;
}

export function synthesizeOmnibusDiagnostic(
  diagnostics: CutpointTelemetry[]
): OmnibusDiagnosticResult {
  assert.strictEqual(diagnostics.length, 4, 'Exactly 4 cutpoints required');
  const failed_cutpoints: number[] = [];
  const contrasts: (number | null)[] = [];

  for (const diag of diagnostics) {
    if (diag.status !== 'PASSED' || diag.contrast === null) {
      failed_cutpoints.push(diag.cutpoint);
      contrasts.push(null);
    } else {
      contrasts.push(diag.contrast);
    }
  }

  if (failed_cutpoints.length > 0) {
    const reasons = diagnostics
      .filter((d) => d.status !== 'PASSED')
      .map((d) => `c=${d.cutpoint} [${d.status}: ${d.detail}]`)
      .join('; ');

    return {
      status: 'DIAGNOSTIC_NON_ESTIMABLE_DUE_TO_SPARSITY',
      delta_po: null,
      converged: false,
      contrasts,
      diagnostics,
      failed_cutpoints,
      reason: `Estimability protocol failed closed: ${reasons}`,
    };
  }

  const valid_contrasts = contrasts as number[];
  const bar_psi = valid_contrasts.reduce((a, b) => a + b, 0) / 4;
  const delta_po = valid_contrasts.reduce((sum, psi) => sum + (psi - bar_psi) ** 2, 0);

  return {
    status: 'SUCCESS',
    delta_po,
    converged: true,
    contrasts,
    diagnostics,
    failed_cutpoints: [],
    reason: 'All 4 cutpoints successfully estimated under primary random-effects model',
  };
}

describe('MedVoice Study 3: Proportional Odds Diagnostic 6-Step Decision Protocol', () => {
  const dummy17Grad = (maxVal: number) => [
    maxVal,
    ...Array(16).fill(maxVal / 2),
  ];

  it('1. Step 0: Catches event count guard failure when minority class < 15 events', () => {
    const res = evaluateCutpointModel({
      cutpoint: 4,
      n_pos: 12,
      n_neg: 1188,
    });
    assert.strictEqual(res.status, 'EVENT_COUNT_GUARD_FAILED');
    assert.strictEqual(res.s0_event_status, 'FAILED');
    assert.strictEqual(res.s1_opt_status, 'NOT_ASSESSED_DUE_TO_EVENT_GUARD');
    assert.strictEqual(res.s2_sing_status, 'NOT_ASSESSED_DUE_TO_EVENT_GUARD');
    assert.strictEqual(res.contrast, null);
    assert.match(res.detail, /< 15 events/);
  });

  it('2. Step 1: Catches optimizer non-convergence when opt_code != 0', () => {
    const res = evaluateCutpointModel({
      cutpoint: 2,
      n_pos: 300,
      n_neg: 900,
      optimizer_code: 1, // e.g. iteration limit exceeded
    });
    assert.strictEqual(res.status, 'OPTIMIZER_CONVERGENCE_FAILED');
    assert.strictEqual(res.s0_event_status, 'PASSED');
    assert.strictEqual(res.s1_opt_status, 'FAILED');
    assert.strictEqual(res.s2_sing_status, 'NOT_ASSESSED_DUE_TO_OPTIMIZER_FAILURE');
    assert.strictEqual(res.opt_code, 1);
    assert.strictEqual(res.contrast, null);
  });

  it('3. Step 2: Catches singular random effects (SINGULAR_FIT) and fails closed without silent model reduction', () => {
    const res = evaluateCutpointModel({
      cutpoint: 4,
      n_pos: 28,
      n_neg: 1172,
      optimizer_code: 0,
      is_singular: true,
      singular_components: 'scenario_persp_id(sd=0.00e+00)',
    });
    assert.strictEqual(res.status, 'SINGULAR_FIT');
    assert.strictEqual(res.s0_event_status, 'PASSED');
    assert.strictEqual(res.s1_opt_status, 'PASSED');
    assert.strictEqual(res.s2_sing_status, 'FAILED');
    assert.strictEqual(res.s3_grad_status, 'NOT_ASSESSED_DUE_TO_SINGULARITY');
    assert.strictEqual(res.s4_hess_status, 'NOT_ASSESSED_DUE_TO_SINGULARITY');
    assert.strictEqual(res.s5_sep_status, 'NOT_ASSESSED_DUE_TO_SINGULARITY');
    assert.strictEqual(res.is_singular, true);
    assert.strictEqual(res.contrast, null);
    assert.match(res.detail, /Refitting with reduced model is prohibited/);
  });

  it('4. Step 3: Dimensionality check catches gradient length mismatch (length 16 when 17 expected)', () => {
    const res = evaluateCutpointModel({
      cutpoint: 3,
      n_pos: 200,
      n_neg: 1000,
      optimizer_code: 0,
      is_singular: false,
      raw_gradient: [1e-4, ...Array(15).fill(1e-4)], // length 16 != 17
    });
    assert.strictEqual(res.status, 'GRADIENT_EVALUATION_FAILED');
    assert.strictEqual(res.s3_grad_status, 'FAILED');
    assert.strictEqual(res.s4_hess_status, 'NOT_ASSESSED_DUE_TO_GRADIENT_FAILURE');
    assert.match(res.detail, /length=16, expected=17/);
    assert.strictEqual(res.contrast, null);
  });

  it('5. Step 3: Catches gradient tolerance violation when max |grad| >= 1e-3 on 17-element gradient', () => {
    const res = evaluateCutpointModel({
      cutpoint: 3,
      n_pos: 200,
      n_neg: 1000,
      optimizer_code: 0,
      is_singular: false,
      raw_gradient: dummy17Grad(2.5e-3), // 2.5e-3 >= 1e-3, length 17
    });
    assert.strictEqual(res.status, 'GRADIENT_TOLERANCE_EXCEEDED');
    assert.strictEqual(res.s3_grad_status, 'FAILED');
    assert.strictEqual(res.s4_hess_status, 'NOT_ASSESSED_DUE_TO_GRADIENT_FAILURE');
    assert.ok(res.max_grad !== null && res.max_grad >= 1e-3);
    assert.strictEqual(res.contrast, null);
  });

  it('6. Step 4: Catches Hessian dimension mismatch (16x16 instead of 17x17)', () => {
    const res = evaluateCutpointModel({
      cutpoint: 1,
      n_pos: 600,
      n_neg: 600,
      optimizer_code: 0,
      is_singular: false,
      raw_gradient: dummy17Grad(1e-4),
      full_hessian_dim: [16, 16], // 16x16 != 17x17
      cov_matrix_valid: true,
    });
    assert.strictEqual(res.status, 'HESSIAN_CHECK_FAILED');
    assert.strictEqual(res.s4_hess_status, 'FAILED');
    assert.match(res.detail, /Full derivative Hessian dimension invalid \(16x16, expected 17x17\)/);
    assert.strictEqual(res.contrast, null);
  });

  it('7. Step 4: Catches fixed-effect vcov dimension mismatch (14x14 instead of 15x15)', () => {
    const res = evaluateCutpointModel({
      cutpoint: 1,
      n_pos: 600,
      n_neg: 600,
      optimizer_code: 0,
      is_singular: false,
      raw_gradient: dummy17Grad(1e-4),
      full_hessian_dim: [17, 17],
      fixed_effect_dim: [14, 14], // 14x14 != 15x15
      cov_matrix_valid: true,
    });
    assert.strictEqual(res.status, 'HESSIAN_CHECK_FAILED');
    assert.strictEqual(res.s4_hess_status, 'FAILED');
    assert.match(res.detail, /Fixed-effects covariance dimension invalid \(14x14, expected 15x15\)/);
    assert.strictEqual(res.contrast, null);
  });

  it('8. Step 4: Catches Hessian check failure when condition number > 1e6 or Cholesky fails', () => {
    const res = evaluateCutpointModel({
      cutpoint: 1,
      n_pos: 600,
      n_neg: 600,
      optimizer_code: 0,
      is_singular: false,
      raw_gradient: dummy17Grad(1e-4),
      full_hessian_dim: [17, 17],
      fixed_effect_dim: [15, 15],
      full_hessian_cond_num: 5e7, // > 1e6
      cov_matrix_valid: true,
    });
    assert.strictEqual(res.status, 'HESSIAN_CHECK_FAILED');
    assert.strictEqual(res.s4_hess_status, 'FAILED');
    assert.match(res.detail, /condition number .* > 1e6/);
    assert.strictEqual(res.contrast, null);
  });

  it('9. Step 5: Catches fixed-effect quasi-separation when max SE >= 10.0', () => {
    const res = evaluateCutpointModel({
      cutpoint: 4,
      n_pos: 28,
      n_neg: 1172,
      optimizer_code: 0,
      is_singular: false,
      raw_gradient: dummy17Grad(1e-4),
      full_hessian_dim: [17, 17],
      fixed_effect_dim: [15, 15],
      full_hessian_min_eigval: 1.5,
      cov_matrix_valid: true,
      se_values: [0.35, 0.42, 33.2], // 33.2 >= 10.0
    });
    assert.strictEqual(res.status, 'QUASI_SEPARATION_MAX_SE_EXCEEDED');
    assert.strictEqual(res.s5_sep_status, 'FAILED');
    assert.strictEqual(res.max_se, 33.2);
    assert.strictEqual(res.contrast, null);
  });

  it('10. Clean pass: All checks pass cleanly under primary random-effects model with 17-parameter dimensions', () => {
    const res = evaluateCutpointModel({
      cutpoint: 2,
      n_pos: 400,
      n_neg: 800,
      optimizer_code: 0,
      is_singular: false,
      raw_gradient: dummy17Grad(3e-4),
      full_hessian_dim: [17, 17],
      fixed_effect_dim: [15, 15],
      full_hessian_min_eigval: 0.85,
      full_hessian_cond_num: 25.0,
      cov_matrix_valid: true,
      se_values: [0.25, 0.31, 0.28],
      fixed_effects: {
        '(Intercept)': -0.50,
        M1: 0.30,
        'M1:PerspectiveSIM-02': -0.06,
        'M1:PerspectiveSIM-03': 0.09,
      },
    });
    assert.strictEqual(res.status, 'PASSED');
    assert.strictEqual(res.s0_event_status, 'PASSED');
    assert.strictEqual(res.s1_opt_status, 'PASSED');
    assert.strictEqual(res.s2_sing_status, 'PASSED');
    assert.strictEqual(res.s3_grad_status, 'PASSED');
    assert.strictEqual(res.s4_hess_status, 'PASSED');
    assert.strictEqual(res.s5_sep_status, 'PASSED');
    assert.strictEqual(res.is_singular, false);
    assert.strictEqual(res.n_expected, 17);
    assert.strictEqual(res.n_fixef, 15);
    assert.strictEqual(res.n_theta, 2);
    assert.ok(res.max_grad !== null && res.max_grad < 1e-3);
    assert.ok(res.max_se !== null && res.max_se < 10.0);
    // psi = 0.30 + (-0.06 + 0.09) / 3 = 0.30 + 0.01 = 0.31
    assert.strictEqual(Number(res.contrast?.toFixed(4)), 0.31);
  });

  it('11. Four-cutpoint omnibus synthesis: Fails closed if ANY single cutpoint fails', () => {
    const valid_effects = { M1: 0.3, 'M1:PerspectiveSIM-02': 0.0, 'M1:PerspectiveSIM-03': 0.0 };
    const c1 = evaluateCutpointModel({ cutpoint: 1, n_pos: 800, n_neg: 400, optimizer_code: 0, is_singular: false, raw_gradient: dummy17Grad(1e-4), full_hessian_dim: [17, 17], fixed_effect_dim: [15, 15], cov_matrix_valid: true, se_values: [0.2], fixed_effects: valid_effects });
    const c2 = evaluateCutpointModel({ cutpoint: 2, n_pos: 500, n_neg: 700, optimizer_code: 0, is_singular: false, raw_gradient: dummy17Grad(1e-4), full_hessian_dim: [17, 17], fixed_effect_dim: [15, 15], cov_matrix_valid: true, se_values: [0.2], fixed_effects: valid_effects });
    const c3 = evaluateCutpointModel({ cutpoint: 3, n_pos: 200, n_neg: 1000, optimizer_code: 0, is_singular: false, raw_gradient: dummy17Grad(1e-4), full_hessian_dim: [17, 17], fixed_effect_dim: [15, 15], cov_matrix_valid: true, se_values: [0.2], fixed_effects: valid_effects });
    // c4 fails due to singularity
    const c4 = evaluateCutpointModel({ cutpoint: 4, n_pos: 28, n_neg: 1172, optimizer_code: 0, is_singular: true });

    const omnibus = synthesizeOmnibusDiagnostic([c1, c2, c3, c4]);
    assert.strictEqual(omnibus.status, 'DIAGNOSTIC_NON_ESTIMABLE_DUE_TO_SPARSITY');
    assert.strictEqual(omnibus.converged, false);
    assert.strictEqual(omnibus.delta_po, null);
    assert.deepStrictEqual(omnibus.failed_cutpoints, [4]);
    assert.match(omnibus.reason, /SINGULAR_FIT/);
  });

  it('12. Four-cutpoint omnibus synthesis: Successfully evaluates Delta_PO when all 4 cutpoints pass', () => {
    const c1 = evaluateCutpointModel({ cutpoint: 1, n_pos: 800, n_neg: 400, optimizer_code: 0, is_singular: false, raw_gradient: dummy17Grad(1e-4), full_hessian_dim: [17, 17], fixed_effect_dim: [15, 15], cov_matrix_valid: true, se_values: [0.2], fixed_effects: { M1: 0.28, 'M1:PerspectiveSIM-02': 0.0, 'M1:PerspectiveSIM-03': 0.0 } });
    const c2 = evaluateCutpointModel({ cutpoint: 2, n_pos: 500, n_neg: 700, optimizer_code: 0, is_singular: false, raw_gradient: dummy17Grad(1e-4), full_hessian_dim: [17, 17], fixed_effect_dim: [15, 15], cov_matrix_valid: true, se_values: [0.2], fixed_effects: { M1: 0.30, 'M1:PerspectiveSIM-02': 0.0, 'M1:PerspectiveSIM-03': 0.0 } });
    const c3 = evaluateCutpointModel({ cutpoint: 3, n_pos: 200, n_neg: 1000, optimizer_code: 0, is_singular: false, raw_gradient: dummy17Grad(1e-4), full_hessian_dim: [17, 17], fixed_effect_dim: [15, 15], cov_matrix_valid: true, se_values: [0.2], fixed_effects: { M1: 0.32, 'M1:PerspectiveSIM-02': 0.0, 'M1:PerspectiveSIM-03': 0.0 } });
    const c4 = evaluateCutpointModel({ cutpoint: 4, n_pos: 28, n_neg: 1172, optimizer_code: 0, is_singular: false, raw_gradient: dummy17Grad(1e-4), full_hessian_dim: [17, 17], fixed_effect_dim: [15, 15], cov_matrix_valid: true, se_values: [0.4], fixed_effects: { M1: 0.30, 'M1:PerspectiveSIM-02': 0.0, 'M1:PerspectiveSIM-03': 0.0 } });

    const omnibus = synthesizeOmnibusDiagnostic([c1, c2, c3, c4]);
    assert.strictEqual(omnibus.status, 'SUCCESS');
    assert.strictEqual(omnibus.converged, true);
    assert.ok(omnibus.delta_po !== null && omnibus.delta_po >= 0);
    assert.strictEqual(omnibus.failed_cutpoints.length, 0);
  });

  it('13. Architectural Invariant: Never substitutes reduced single-intercept model on primary pathway', () => {
    // Assert that when is_singular is true, status is strictly SINGULAR_FIT and does NOT refit to PASSED
    const res = evaluateCutpointModel({
      cutpoint: 4,
      n_pos: 28,
      n_neg: 1172,
      optimizer_code: 0,
      is_singular: true,
      singular_components: 'scenario_id(sd=0.71), scenario_persp_id(sd=0.00)',
    });
    assert.strictEqual(res.status, 'SINGULAR_FIT');
    assert.strictEqual(res.contrast, null, 'Contrast must not be computed for singular primary model');
  });

  it('14. Primary Contrast: Named construction strictly assigns 0 weight to all 9 domains and 1/3 to interactions', () => {
    // Canonical 15 fixed-effect coefficient names under R terms() ordering with
    // Cardiovascular as reference domain and treatment contrasts:
    const canonical_r_coef_names = [
      '(Intercept)',
      'M1',
      'PerspectiveSIM-02',
      'PerspectiveSIM-03',
      'Domainrespiratory_emergencies',
      'Domainneurological',
      'Domaingastrointestinal',
      'Domainendocrine_metabolic',
      'Domaininfectious_diseases',
      'Domainpediatric_urgent_care',
      'Domaintrauma_musculoskeletal',
      'Domaintoxicology_environmental',
      'Domainroutine_preventive',
      'M1:PerspectiveSIM-02',
      'M1:PerspectiveSIM-03',
    ];

    const L = buildNamedContrastVector(canonical_r_coef_names);

    // Verify system effect weight
    assert.strictEqual(L['M1'], 1.0);
    // Verify interaction weights
    assert.strictEqual(L['M1:PerspectiveSIM-02'], 1.0 / 3.0);
    assert.strictEqual(L['M1:PerspectiveSIM-03'], 1.0 / 3.0);

    // Verify main perspective weights are 0
    assert.strictEqual(L['PerspectiveSIM-02'], 0.0);
    assert.strictEqual(L['PerspectiveSIM-03'], 0.0);
    assert.strictEqual(L['(Intercept)'], 0.0);

    // Verify all 9 domain coefficients receive strictly 0.0 weight
    const domainNames = canonical_r_coef_names.filter((n) => n.startsWith('Domain'));
    assert.strictEqual(domainNames.length, 9);
    for (const d of domainNames) {
      assert.strictEqual(L[d], 0.0, `Domain ${d} must have strictly 0 weight`);
    }
  });

  it('15. Regression Test: Naive positional indexing bugs assign 1/3 weight to Domain dummy indicators in R terms order', () => {
    // Canonical R term ordering for formula:
    // Y ~ M + Perspective + M:Perspective + Domain
    // R formula parser expands terms order 1 (main effects) before order 2 (interactions).
    // Array indices (0-based):
    // 0: (Intercept)
    // 1: M1 (system)
    // 2: PerspectiveSIM-02
    // 3: PerspectiveSIM-03
    // 4: Domainrespiratory_emergencies (first non-reference domain)
    // 5: Domainneurological (second non-reference domain)
    // 6..12: Remaining 7 domains
    // 13: M1:PerspectiveSIM-02
    // 14: M1:PerspectiveSIM-03

    const coefNames = [
      '(Intercept)',
      'M1',
      'PerspectiveSIM-02',
      'PerspectiveSIM-03',
      'Domainrespiratory_emergencies',
      'Domainneurological',
      'Domaingastrointestinal',
      'Domainendocrine_metabolic',
      'Domaininfectious_diseases',
      'Domainpediatric_urgent_care',
      'Domaintrauma_musculoskeletal',
      'Domaintoxicology_environmental',
      'Domainroutine_preventive',
      'M1:PerspectiveSIM-02',
      'M1:PerspectiveSIM-03',
    ];

    // Suppose true model has M1 = 0.30, interaction2 = 0.06, interaction3 = 0.09
    // and Domainrespiratory = -0.50, Domainneurological = -0.80
    const coefDict: Record<string, number> = {
      '(Intercept)': -1.2,
      M1: 0.30,
      'PerspectiveSIM-02': -0.10,
      'PerspectiveSIM-03': 0.05,
      Domainrespiratory_emergencies: -0.50,
      Domainneurological: -0.80,
      Domaingastrointestinal: 0.10,
      Domainendocrine_metabolic: 0.20,
      Domaininfectious_diseases: -0.15,
      Domainpediatric_urgent_care: 0.05,
      Domaintrauma_musculoskeletal: -0.05,
      Domaintoxicology_environmental: 0.02,
      Domainroutine_preventive: -0.20,
      'M1:PerspectiveSIM-02': 0.06,
      'M1:PerspectiveSIM-03': 0.09,
    };

    const coefArray = coefNames.map((n) => coefDict[n]);

    // True contrast: 0.30 + (0.06 + 0.09) / 3 = 0.30 + 0.05 = 0.35
    const namedContrast = computeNamedContrast(coefDict);
    assert.strictEqual(Number(namedContrast.toFixed(4)), 0.35);

    // Naive positional contrast: c[1] + (c[4] + c[5]) / 3
    // But c[4] is Domainrespiratory_emergencies (-0.50) and c[5] is Domainneurological (-0.80)!
    // Naive result: 0.30 + (-0.50 + -0.80) / 3 = 0.30 - 0.4333 = -0.1333!
    const naivePositionalContrast = computePositionalContrast(coefArray);
    assert.notStrictEqual(
      Number(naivePositionalContrast.toFixed(4)),
      Number(namedContrast.toFixed(4)),
      'Naive positional indexing must produce erroneous result due to domain contamination'
    );
    assert.strictEqual(Number(naivePositionalContrast.toFixed(4)), -0.1333);
  });

  it('16. Structural Invariant: Missing interaction term in fixed effects fails closed as STRUCTURAL_SPECIFICATION_FAILED', () => {
    const res = evaluateCutpointModel({
      cutpoint: 1,
      n_pos: 600,
      n_neg: 600,
      optimizer_code: 0,
      is_singular: false,
      // Fixed effects missing 'M1:PerspectiveSIM-03'
      fixed_effects: {
        '(Intercept)': -0.5,
        M1: 0.3,
        'M1:PerspectiveSIM-02': -0.05,
      },
    });
    assert.strictEqual(res.status, 'STRUCTURAL_SPECIFICATION_FAILED');
    assert.strictEqual(res.s1_opt_status, 'FAILED');
    assert.strictEqual(res.s2_sing_status, 'NOT_ASSESSED_DUE_TO_STRUCTURAL_FAILURE');
    assert.strictEqual(res.contrast, null);
    assert.match(res.detail, /Missing required interaction\/system contrast coefficients/);
  });

  it('17. Structural Invariant: Dropped coefficient (has_dropped = true) fails closed as STRUCTURAL_SPECIFICATION_FAILED', () => {
    const res = evaluateCutpointModel({
      cutpoint: 2,
      n_pos: 400,
      n_neg: 800,
      optimizer_code: 0,
      is_singular: false,
      has_dropped: true, // check.rankX detected dropped column
    });
    assert.strictEqual(res.status, 'STRUCTURAL_SPECIFICATION_FAILED');
    assert.strictEqual(res.s1_opt_status, 'FAILED');
    assert.strictEqual(res.s2_sing_status, 'NOT_ASSESSED_DUE_TO_STRUCTURAL_FAILURE');
    assert.strictEqual(res.contrast, null);
    assert.match(res.detail, /Dropped fixed-effect coefficients detected/);
  });

  it('18. Structural Invariant: Rank-deficient design matrix (rank < 15) fails closed as STRUCTURAL_SPECIFICATION_FAILED', () => {
    const res = evaluateCutpointModel({
      cutpoint: 3,
      n_pos: 200,
      n_neg: 1000,
      optimizer_code: 0,
      is_singular: false,
      design_matrix_rank: 14, // rank deficient (< 15)
    });
    assert.strictEqual(res.status, 'STRUCTURAL_SPECIFICATION_FAILED');
    assert.strictEqual(res.s1_opt_status, 'FAILED');
    assert.strictEqual(res.s2_sing_status, 'NOT_ASSESSED_DUE_TO_STRUCTURAL_FAILURE');
    assert.strictEqual(res.contrast, null);
    assert.match(res.detail, /Design matrix rank deficient/);
  });

  it('19. Structural Invariant: Missing grouping term fails closed as STRUCTURAL_SPECIFICATION_FAILED', () => {
    const res = evaluateCutpointModel({
      cutpoint: 4,
      n_pos: 28,
      n_neg: 1172,
      optimizer_code: 0,
      is_singular: false,
      // scenario_persp_id missing from grouping terms
      grouping_terms: ['scenario_id'],
    });
    assert.strictEqual(res.status, 'STRUCTURAL_SPECIFICATION_FAILED');
    assert.strictEqual(res.s1_opt_status, 'FAILED');
    assert.strictEqual(res.s2_sing_status, 'NOT_ASSESSED_DUE_TO_STRUCTURAL_FAILURE');
    assert.strictEqual(res.contrast, null);
    assert.match(res.detail, /Missing required random-effects grouping terms/);
  });

  it('20. Step 4: Non-zero Hessian diagnostic code (lme4_hess_code != 0) fails closed as HESSIAN_CHECK_FAILED', () => {
    const res = evaluateCutpointModel({
      cutpoint: 2,
      n_pos: 400,
      n_neg: 800,
      optimizer_code: 0,
      is_singular: false,
      raw_gradient: dummy17Grad(1e-4),
      full_hessian_dim: [17, 17],
      fixed_effect_dim: [15, 15],
      lme4_hess_code: 1, // Non-zero lme4 Hessian diagnostic code
      cov_matrix_valid: true,
      se_values: [0.25],
      fixed_effects: {
        M1: 0.3,
        'M1:PerspectiveSIM-02': 0.0,
        'M1:PerspectiveSIM-03': 0.0,
      },
    });
    assert.strictEqual(res.status, 'HESSIAN_CHECK_FAILED');
    assert.strictEqual(res.s4_hess_status, 'FAILED');
    assert.strictEqual(res.contrast, null);
    assert.match(res.detail, /Hessian diagnostic code\(s\) \[1\]: Unrecognized diagnostic code\(s\): 1/);
  });

  it('21. Domain Taxonomy Invariant: Missing registered domain fails closed as STRUCTURAL_SPECIFICATION_FAILED', () => {
    // 8 of 9 registered domains present (Domaingastrointestinal missing)
    const incomplete_domains_fixed_effects: Record<string, number> = {
      '(Intercept)': -1.0,
      M1: 0.3,
      'PerspectiveSIM-02': 0.0,
      'PerspectiveSIM-03': 0.0,
      'M1:PerspectiveSIM-02': 0.0,
      'M1:PerspectiveSIM-03': 0.0,
      Domainrespiratory_emergencies: 0.1,
      Domainneurological: -0.1,
      // Domaingastrointestinal missing!
      Domainendocrine_metabolic: 0.05,
      Domaininfectious_diseases: -0.05,
      Domainpediatric_urgent_care: 0.02,
      Domaintrauma_musculoskeletal: -0.02,
      Domaintoxicology_environmental: 0.01,
      Domainroutine_preventive: -0.1,
    };

    const res = evaluateCutpointModel({
      cutpoint: 1,
      n_pos: 600,
      n_neg: 600,
      optimizer_code: 0,
      is_singular: false,
      require_full_domain_taxonomy: true,
      fixed_effects: incomplete_domains_fixed_effects,
    });
    assert.strictEqual(res.status, 'STRUCTURAL_SPECIFICATION_FAILED');
    assert.strictEqual(res.s1_opt_status, 'FAILED');
    assert.strictEqual(res.s2_sing_status, 'NOT_ASSESSED_DUE_TO_STRUCTURAL_FAILURE');
    assert.match(res.detail, /Missing required registered domain\(s\): Domaingastrointestinal/);
  });

  it('22. Domain Taxonomy Invariant: Unapproved domain introduced fails closed as STRUCTURAL_SPECIFICATION_FAILED', () => {
    const unapproved_fixed_effects: Record<string, number> = {
      '(Intercept)': -1.0,
      M1: 0.3,
      'PerspectiveSIM-02': 0.0,
      'PerspectiveSIM-03': 0.0,
      'M1:PerspectiveSIM-02': 0.0,
      'M1:PerspectiveSIM-03': 0.0,
      Domainobstetric_gynecologic: 0.15, // UNAPPROVED domain!
    };

    const res = evaluateCutpointModel({
      cutpoint: 1,
      n_pos: 600,
      n_neg: 600,
      optimizer_code: 0,
      is_singular: false,
      fixed_effects: unapproved_fixed_effects,
    });
    assert.strictEqual(res.status, 'STRUCTURAL_SPECIFICATION_FAILED');
    assert.strictEqual(res.s1_opt_status, 'FAILED');
    assert.match(res.detail, /Unapproved domain\(s\) detected: Domainobstetric_gynecologic/);
  });

  it('23. Domain Taxonomy Invariant: Incorrect reference category (Domaincardiovascular present) fails closed', () => {
    const wrong_ref_fixed_effects: Record<string, number> = {
      '(Intercept)': -1.0,
      M1: 0.3,
      'PerspectiveSIM-02': 0.0,
      'PerspectiveSIM-03': 0.0,
      'M1:PerspectiveSIM-02': 0.0,
      'M1:PerspectiveSIM-03': 0.0,
      Domaincardiovascular: 0.20, // Cardiovascular must be reference (no dummy coefficient)
    };

    const res = evaluateCutpointModel({
      cutpoint: 1,
      n_pos: 600,
      n_neg: 600,
      optimizer_code: 0,
      is_singular: false,
      fixed_effects: wrong_ref_fixed_effects,
    });
    assert.strictEqual(res.status, 'STRUCTURAL_SPECIFICATION_FAILED');
    assert.strictEqual(res.s1_opt_status, 'FAILED');
    assert.match(res.detail, /Cardiovascular is reference domain and must not have a dummy coefficient/);
  });

  it('24. Diagnostic Classification: Gradient codes (-1, -2, -5) fail Step 3 and are NOT classified as Hessian failures', () => {
    // Test 24a: Code -1 with evaluation failure ("unable to evaluate scaled gradient")
    const res1Eval = evaluateCutpointModel({
      cutpoint: 1,
      n_pos: 600,
      n_neg: 600,
      optimizer_code: 0,
      is_singular: false,
      lme4_conv_code: -1,
      lme4_message: 'unable to evaluate scaled gradient',
      raw_gradient: dummy17Grad(1e-4),
    });
    assert.strictEqual(res1Eval.status, 'GRADIENT_EVALUATION_FAILED');
    assert.strictEqual(res1Eval.s3_grad_status, 'FAILED');
    assert.strictEqual(res1Eval.s4_hess_status, 'NOT_ASSESSED_DUE_TO_GRADIENT_FAILURE');
    assert.match(res1Eval.detail, /Gradient evaluation failure \[codes: -1\]: unable to evaluate scaled gradient/);

    // Test 24b: Code -1 with tolerance exceedance ("Model failed to converge with max|grad| = ...")
    const res1Tol = evaluateCutpointModel({
      cutpoint: 1,
      n_pos: 600,
      n_neg: 600,
      optimizer_code: 0,
      is_singular: false,
      lme4_conv_code: -1,
      lme4_message: 'Model failed to converge with max|grad| = 0.005 (tol = 0.001, component 1)',
      raw_gradient: dummy17Grad(1e-4),
    });
    assert.strictEqual(res1Tol.status, 'GRADIENT_TOLERANCE_EXCEEDED');
    assert.strictEqual(res1Tol.s3_grad_status, 'FAILED');
    assert.strictEqual(res1Tol.s4_hess_status, 'NOT_ASSESSED_DUE_TO_GRADIENT_FAILURE');
    assert.match(res1Tol.detail, /Gradient tolerance exceeded \[codes: -1\]: Model failed to converge with max\|grad\|/);

    // Test 24c: Code -5: Gradient NA or non-finite
    const res5 = evaluateCutpointModel({
      cutpoint: 1,
      n_pos: 600,
      n_neg: 600,
      optimizer_code: 0,
      is_singular: false,
      lme4_conv_code: -5,
      raw_gradient: dummy17Grad(1e-4),
    });
    assert.strictEqual(res5.status, 'GRADIENT_EVALUATION_FAILED');
    assert.strictEqual(res5.s3_grad_status, 'FAILED');
    assert.strictEqual(res5.s4_hess_status, 'NOT_ASSESSED_DUE_TO_GRADIENT_FAILURE');
    assert.match(res5.detail, /Gradient contains NA or non-finite values \(lme4 code -5\)/);

    // Test 24d: Defensive check for Code -2 (relative gradient failure, unreachable under primary relTol = NULL)
    const res2 = evaluateCutpointModel({
      cutpoint: 1,
      n_pos: 600,
      n_neg: 600,
      optimizer_code: 0,
      is_singular: false,
      lme4_conv_code: -2,
      raw_gradient: dummy17Grad(1e-4),
    });
    assert.strictEqual(res2.status, 'GRADIENT_TOLERANCE_EXCEEDED');
    assert.strictEqual(res2.s3_grad_status, 'FAILED');
    assert.strictEqual(res2.s4_hess_status, 'NOT_ASSESSED_DUE_TO_GRADIENT_FAILURE');
    assert.match(res2.detail, /Relative-gradient check failure \(lme4 code -2, unreachable under primary relTol = NULL\)/);

    // Test 24d (with upstream message): "Model failed to converge with max|relative grad| = ..."
    const res2Msg = evaluateCutpointModel({
      cutpoint: 1,
      n_pos: 600,
      n_neg: 600,
      optimizer_code: 0,
      is_singular: false,
      lme4_conv_code: -2,
      lme4_message: 'Model failed to converge with max|relative grad| = 0.005 (tol = 0.001, component 1)',
      raw_gradient: dummy17Grad(1e-4),
    });
    assert.strictEqual(res2Msg.status, 'GRADIENT_TOLERANCE_EXCEEDED');
    assert.strictEqual(res2Msg.s3_grad_status, 'FAILED');
    assert.strictEqual(res2Msg.s4_hess_status, 'NOT_ASSESSED_DUE_TO_GRADIENT_FAILURE');
    assert.match(res2Msg.detail, /Model failed to converge with max\|relative grad\|/);
  });

  it('25. Diagnostic Classification: Vector-safe Hessian codes fail Step 4 as HESSIAN_CHECK_FAILED', () => {
    const valid_effects = { M1: 0.3, 'M1:PerspectiveSIM-02': 0.0, 'M1:PerspectiveSIM-03': 0.0 };

    // 25a: Scalar Hessian codes
    for (const [code, expectedFragment] of [
      [-3, 'Negative Hessian eigenvalues (code -3)'],
      [-4, 'Numerically singular Hessian (code -4)'],
      [-6, 'Hessian eigenvalue calculation failure (code -6)'],
      [2, 'Excessively large Hessian eigenvalue (code 2)'],
      [3, 'Excessive eigenvalue ratio / ill-conditioned Hessian (code 3)'],
    ] as const) {
      const res = evaluateCutpointModel({
        cutpoint: 2,
        n_pos: 400,
        n_neg: 800,
        optimizer_code: 0,
        is_singular: false,
        raw_gradient: dummy17Grad(1e-4),
        full_hessian_dim: [17, 17],
        fixed_effect_dim: [15, 15],
        lme4_conv_code: code,
        cov_matrix_valid: true,
        se_values: [0.25],
        fixed_effects: valid_effects,
      });
      assert.strictEqual(res.status, 'HESSIAN_CHECK_FAILED', `Code ${code} must classify as HESSIAN_CHECK_FAILED`);
      assert.strictEqual(res.s3_grad_status, 'PASSED');
      assert.strictEqual(res.s4_hess_status, 'FAILED');
      assert.match(res.detail, new RegExp(expectedFragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }

    // 25b: Vector Hessian codes: c(2L, 3L) combined
    const resMulti = evaluateCutpointModel({
      cutpoint: 2,
      n_pos: 400,
      n_neg: 800,
      optimizer_code: 0,
      is_singular: false,
      raw_gradient: dummy17Grad(1e-4),
      full_hessian_dim: [17, 17],
      fixed_effect_dim: [15, 15],
      lme4_conv_code: [2, 3], // Multiple Hessian codes vector
      cov_matrix_valid: true,
      se_values: [0.25],
      fixed_effects: valid_effects,
    });
    assert.strictEqual(resMulti.status, 'HESSIAN_CHECK_FAILED');
    assert.strictEqual(resMulti.s3_grad_status, 'PASSED');
    assert.strictEqual(resMulti.s4_hess_status, 'FAILED');
    assert.match(resMulti.detail, /Excessively large Hessian eigenvalue \(code 2\)/);
    assert.match(resMulti.detail, /Excessive eigenvalue ratio \/ ill-conditioned Hessian \(code 3\)/);

    // 25c: Unrecognized diagnostic code (e.g. 99) fails closed
    const resUnknown = evaluateCutpointModel({
      cutpoint: 2,
      n_pos: 400,
      n_neg: 800,
      optimizer_code: 0,
      is_singular: false,
      raw_gradient: dummy17Grad(1e-4),
      full_hessian_dim: [17, 17],
      fixed_effect_dim: [15, 15],
      lme4_conv_code: [99], // Unrecognized code
      cov_matrix_valid: true,
      se_values: [0.25],
      fixed_effects: valid_effects,
    });
    assert.strictEqual(resUnknown.status, 'HESSIAN_CHECK_FAILED');
    assert.strictEqual(resUnknown.s4_hess_status, 'FAILED');
    assert.match(resUnknown.detail, /Unrecognized diagnostic code\(s\): 99/);
  });

  it('26. Structural Invariant: Explicit nAGQ = 1L (Laplace approximation) is verified', () => {
    // Invalid nAGQ = 2
    const res_invalid = evaluateCutpointModel({
      cutpoint: 1,
      n_pos: 600,
      n_neg: 600,
      optimizer_code: 0,
      is_singular: false,
      fitting_args: { nAGQ: 2 },
    });
    assert.strictEqual(res_invalid.status, 'STRUCTURAL_SPECIFICATION_FAILED');
    assert.match(res_invalid.detail, /nAGQ = 1L Laplace approximation strictly required/);

    // Valid nAGQ = 1
    const res_valid = evaluateCutpointModel({
      cutpoint: 1,
      n_pos: 600,
      n_neg: 600,
      optimizer_code: 0,
      is_singular: false,
      fitting_args: { nAGQ: 1 },
      raw_gradient: dummy17Grad(1e-4),
      full_hessian_dim: [17, 17],
      fixed_effect_dim: [15, 15],
      cov_matrix_valid: true,
      se_values: [0.25],
      fixed_effects: { M1: 0.3, 'M1:PerspectiveSIM-02': 0.0, 'M1:PerspectiveSIM-03': 0.0 },
    });
    assert.strictEqual(res_valid.status, 'PASSED');
  });

  it('27. Sequential Preemption Invariant: Gradient evaluation failure with overwritten Hessian code fails Step 3', () => {
    // Simulates lme4 scenario where checkConv records "unable to evaluate scaled gradient",
    // but checkHess subsequently overwrites code with Hessian code [3] and appends Hessian message
    const resPreempt = evaluateCutpointModel({
      cutpoint: 1,
      n_pos: 600,
      n_neg: 600,
      optimizer_code: 0,
      is_singular: false,
      raw_gradient: dummy17Grad(1e-4),
      lme4_conv_code: [3], // Overwritten by Hessian check!
      lme4_messages: [
        'unable to evaluate scaled gradient',
        'Model is nearly unidentifiable: large eigenvalue ratio',
      ],
      full_hessian_dim: [17, 17],
      fixed_effect_dim: [15, 15],
      cov_matrix_valid: true,
      se_values: [0.25],
    });

    // Invariant: Must fail closed at Step 3 as GRADIENT_EVALUATION_FAILED.
    // Downstream Hessian check (Step 4) MUST NOT be assessed!
    assert.strictEqual(resPreempt.status, 'GRADIENT_EVALUATION_FAILED');
    assert.strictEqual(resPreempt.s3_grad_status, 'FAILED');
    assert.strictEqual(resPreempt.s4_hess_status, 'NOT_ASSESSED_DUE_TO_GRADIENT_FAILURE');
    assert.strictEqual(resPreempt.s5_sep_status, 'NOT_ASSESSED_DUE_TO_GRADIENT_FAILURE');
    assert.match(resPreempt.detail, /unable to evaluate scaled gradient/);
  });

  it('28. Sequential Preemption Invariant: Gradient tolerance failure with Hessian codes fails Step 3', () => {
    const resTolPreempt = evaluateCutpointModel({
      cutpoint: 1,
      n_pos: 600,
      n_neg: 600,
      optimizer_code: 0,
      is_singular: false,
      raw_gradient: dummy17Grad(1e-4),
      lme4_conv_code: [2, 3], // Hessian codes present
      lme4_messages: [
        'Model failed to converge with max|grad| = 0.005 (tol = 0.001, component 1)',
        'Hessian eigenvalue calculation failure',
      ],
      full_hessian_dim: [17, 17],
      fixed_effect_dim: [15, 15],
      cov_matrix_valid: true,
      se_values: [0.25],
    });

    assert.strictEqual(resTolPreempt.status, 'GRADIENT_TOLERANCE_EXCEEDED');
    assert.strictEqual(resTolPreempt.s3_grad_status, 'FAILED');
    assert.strictEqual(resTolPreempt.s4_hess_status, 'NOT_ASSESSED_DUE_TO_GRADIENT_FAILURE');
    assert.strictEqual(resTolPreempt.s5_sep_status, 'NOT_ASSESSED_DUE_TO_GRADIENT_FAILURE');
    assert.match(resTolPreempt.detail, /Model failed to converge with max\|grad\|/);
  });

  it('29. Robustness: Missing or empty messages with diagnostic codes fail closed safely without error', () => {
    // Missing messages array and null message with Hessian code
    const resNoMsg = evaluateCutpointModel({
      cutpoint: 1,
      n_pos: 600,
      n_neg: 600,
      optimizer_code: 0,
      is_singular: false,
      raw_gradient: dummy17Grad(1e-4),
      lme4_conv_code: [2],
      lme4_message: null,
      lme4_messages: null,
      full_hessian_dim: [17, 17],
      fixed_effect_dim: [15, 15],
      cov_matrix_valid: true,
      se_values: [0.25],
      fixed_effects: { M1: 0.3, 'M1:PerspectiveSIM-02': 0.0, 'M1:PerspectiveSIM-03': 0.0 },
    });
    assert.strictEqual(resNoMsg.status, 'HESSIAN_CHECK_FAILED');
    assert.strictEqual(resNoMsg.s4_hess_status, 'FAILED');
    assert.match(resNoMsg.detail, /Excessively large Hessian eigenvalue \(code 2\)/);

    // Missing messages with code -1 falls back safely to tolerance exceeded
    const resNoMsgGrad = evaluateCutpointModel({
      cutpoint: 1,
      n_pos: 600,
      n_neg: 600,
      optimizer_code: 0,
      is_singular: false,
      raw_gradient: dummy17Grad(1e-4),
      lme4_conv_code: [-1],
      lme4_message: null,
      lme4_messages: [],
    });
    assert.strictEqual(resNoMsgGrad.status, 'GRADIENT_TOLERANCE_EXCEEDED');
    assert.strictEqual(resNoMsgGrad.s3_grad_status, 'FAILED');
    assert.match(resNoMsgGrad.detail, /Gradient tolerance exceeded/);
  });
});
