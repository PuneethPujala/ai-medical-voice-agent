#!/usr/bin/env Rscript
# ==============================================================================
# MedVoice Study 3: Proportional Odds Diagnostic & Bayesian Sensitivity Pipeline
# Specification Version 3.3.21 / Protocol Version 2.3.16
#
# Primary Frequentist Diagnostic: lme4::glmer (v1.1-35.5) / ordinal::clmm (v2023.12-4)
# Secondary Bayesian Predictive Analysis: brms (v2.22.0)
#
# Implements:
# 1. Four Dichotomized Cumulative Binary Regressions (Y >= 2, Y >= 3, Y >= 4, Y >= 5)
# 2. Strict 6-Step Estimability Decision Protocol per Cutpoint (Fail-Closed Architecture)
#    - Preserves primary random-effects structure: (1 | scenario_id) + (1 | scenario_persp_id)
#    - PROHIBITS silent reduced-model substitution on primary pathway.
#    - Dynamic Dimension Validation:
#        n_fixef = length(fixef(fit)) = 15 (1 cutpoint intercept + 1 system + 2 perspective + 2 interaction + 9 domain)
#        n_theta = length(getME(fit, "theta")) = 2 (scalar random intercepts for scenario and scenario_persp)
#        n_expected = n_fixef + n_theta = 17 parameters
#    - Step 0 (Event Guard): min(sum(Y_bin==1), sum(Y_bin==0)) >= 15
#    - Step 1 (Optimizer Termination): opt_code == 0 (bobyqa code 0 required)
#    - Step 1b (Structural Invariants & Domain Taxonomy):
#        Full fixed-effect rank = 15, no dropped coefficients (check.rankX = "stop.deficient").
#        Required contrast terms present ("M1", "M1:PerspectiveSIM-02", "M1:PerspectiveSIM-03").
#        Required random-effects grouping terms present ("scenario_id", "scenario_persp_id").
#        Strict 10-domain taxonomy: reference level "cardiovascular" (no dummy), exactly 9 non-reference dummy terms.
#        Explicit Laplace approximation: nAGQ = 1L passed directly to glmer().
#    - Step 2 (Singularity): isSingular(tol = 1e-4) boundary parameter test on theta vector,
#      supplemented by rePCA() and VarCorr() for component attribution (u_s vs v_sp).
#      Fails closed as SINGULAR_FIT; downstream checks marked NOT_ASSESSED_DUE_TO_SINGULARITY.
#    - Step 3 (Raw Gradient & relTol): Non-empty, finite, exact dynamic length (n_expected = 17),
#      custom raw acceptance rule max|grad| < 1e-3, and zero lme4 gradient/relTol warnings.
#      Properly partitions lme4 codes: -1, -2, -5 classified as GRADIENT failures (NOT Hessian).
#      Downstream marked NOT_ASSESSED_DUE_TO_GRADIENT_FAILURE if failed.
#    - Step 4 (Full Derivative Hessian & Fixed-Effect Information Matrix):
#      Full derivative Hessian dimension (17 x 17), positive definiteness, min eigenvalue > 1e-6,
#      condition number < 1e6, Cholesky factorability, zero checkHess warning codes/messages
#      (lme4 codes -3, -4, -6, 2, 3), and vcov(fit) dimension (15 x 15) strictly positive definite.
#      Downstream marked NOT_ASSESSED_DUE_TO_HESSIAN_FAILURE if failed.
#    - Step 5 (Fixed-Effect Quasi-Separation): finite SEs and max(SE_fixef) < 10.0.
#    - Step 6 (Four-Cutpoint Omnibus): all 4 cutpoints required; fails closed if any fails.
# 3. Omnibus Threshold-Contrast Heterogeneity Statistic:
#      Delta_PO = sum_{c=1}^4 (psi_primary^(c) - bar{psi}_primary)^2
# 4. Parametric Null Bootstrap under Fitted Proportional-Odds CLMM:
#      Target B_valid = 1000, Max attempts B_max = 1250, Min acceptable B_valid = 800.
#      p_boot = (1 + sum I(Delta_PO^(b) >= Delta_PO^obs)) / (B_valid + 1)
# 5. Bayesian Category-Specific Sensitivity Model (brms) via Grouped K-Fold CV.
# 6. Secondary Sensitivity: Explicitly labeled reduced-model function
#    (fit_threshold_regressions_reduced_sensitivity) isolated from primary pipeline.
#
# NOTE: While this R script is fully specified and verified for syntactic validity,
# empirical execution validation of the R pipeline remains pending local R setup.
# ==============================================================================

suppressPackageStartupMessages({
  if (requireNamespace("lme4", quietly = TRUE)) library(lme4)
  if (requireNamespace("ordinal", quietly = TRUE)) library(ordinal)
  if (requireNamespace("brms", quietly = TRUE)) library(brms)
})

# Pinned Software Versions
# R: >= 4.3.0
# lme4: 1.1-35.5
# ordinal: 2023.12-4
# brms: 2.22.0
# glmmTMB (alternative): 1.1.10

# ------------------------------------------------------------------------------
# 1. Named Linear Contrast Definition for Primary Estimand psi_primary
# ------------------------------------------------------------------------------
# IMPORTANT CONTRACT INVARIANT:
# Standard R formula expansion reorders terms so that all main effects precede
# interaction terms. In the formula:
#   Y_bin ~ M + Perspective + M:Perspective + Domain + (1 | scenario_id) + (1 | scenario_persp_id)
# the coefficient ordering in fixef(fit_c) is:
#   1: (Intercept)
#   2: M1
#   3: PerspectiveSIM-02
#   4: PerspectiveSIM-03
#   5..13: Nine Domain dummy coefficients (respiratory through routine)
#   14: M1:PerspectiveSIM-02
#   15: M1:PerspectiveSIM-03
#
# HARDCODED POSITIONAL CONTRAST VECTORS ARE STRICTLY PROHIBITED because positions 5
# and 6 correspond to Domain indicators, NOT interaction terms.
# The primary contrast vector L must be constructed strictly by COEFFICIENT NAME.

CANONICAL_REFERENCE_DOMAIN <- "cardiovascular"

CANONICAL_NON_REFERENCE_DOMAINS <- c(
  "Domainrespiratory_emergencies",
  "Domainneurological",
  "Domaingastrointestinal",
  "Domainendocrine_metabolic",
  "Domaininfectious_diseases",
  "Domainpediatric_urgent_care",
  "Domaintrauma_musculoskeletal",
  "Domaintoxicology_environmental",
  "Domainroutine_preventive"
)

ALL_10_REGISTERED_DOMAINS <- c(
  "cardiovascular",
  "respiratory_emergencies",
  "neurological",
  "gastrointestinal",
  "endocrine_metabolic",
  "infectious_diseases",
  "pediatric_urgent_care",
  "trauma_musculoskeletal",
  "toxicology_environmental",
  "routine_preventive"
)

REQUIRED_CONTRAST_TERMS <- c("M1", "M1:PerspectiveSIM-02", "M1:PerspectiveSIM-03")

build_named_contrast_vector <- function(coef_names) {
  missing_terms <- setdiff(REQUIRED_CONTRAST_TERMS, coef_names)
  if (length(missing_terms) > 0) {
    stop(sprintf("Model is missing required contrast coefficients: %s", paste(missing_terms, collapse = ", ")))
  }
  
  # Domain taxonomy invariant verification
  domain_terms <- coef_names[grepl("^Domain", coef_names)]
  if ("Domaincardiovascular" %in% domain_terms) {
    stop("Contrast invariant violated: Cardiovascular is reference domain and must not have a dummy coefficient.")
  }
  unapproved_domains <- setdiff(domain_terms, CANONICAL_NON_REFERENCE_DOMAINS)
  if (length(unapproved_domains) > 0) {
    stop(sprintf("Contrast invariant violated: Unapproved domain dummy term(s): %s", paste(unapproved_domains, collapse = ", ")))
  }
  
  L <- setNames(numeric(length(coef_names)), coef_names)
  L["M1"] <- 1.0
  L["M1:PerspectiveSIM-02"] <- 1.0 / 3.0
  L["M1:PerspectiveSIM-03"] <- 1.0 / 3.0
  
  # Structural invariant assertion: All Domain coefficients must receive exactly 0 weight
  if (any(L[domain_terms] != 0)) {
    stop("Contrast invariant violated: Domain coefficients must have zero weight in primary contrast.")
  }
  
  return(L)
}

compute_contrast <- function(fixef_estimates) {
  coef_names <- names(fixef_estimates)
  L <- build_named_contrast_vector(coef_names)
  psi <- sum(L * fixef_estimates)
  return(as.numeric(psi))
}

compute_contrast_se <- function(fixef_estimates, vcov_matrix) {
  coef_names <- names(fixef_estimates)
  L <- build_named_contrast_vector(coef_names)
  var_psi <- drop(t(L) %*% vcov_matrix %*% L)
  return(if (var_psi > 0) sqrt(var_psi) else NA_real_)
}

# ------------------------------------------------------------------------------
# 2. Framework A: Frequentist Threshold Invariance Diagnostic via lme4::glmer
# ------------------------------------------------------------------------------
# Approach A: Predefine all four cutpoints c in {1, 2, 3, 4} (Y >= 2, 3, 4, 5).
# If ANY cutpoint fails any step of the 6-step estimability protocol under the
# PRESCRIBED PRIMARY MODEL, the diagnostic fails closed (DIAGNOSTIC_NON_ESTIMABLE_DUE_TO_SPARSITY).
#
# PRIMARY MODEL INVARIANT:
# The prescribed primary model contains TWO random intercepts:
#   (1 | scenario_id) + (1 | scenario_persp_id)
# Under no circumstances does this diagnostic silently substitute a reduced single-intercept
# model (1 | scenario_id) into the primary evaluation path. If the primary model exhibits
# singularity (isSingular == TRUE), that cutpoint is explicitly classified as SINGULAR_FIT
# and fails closed. Downstream gradient/Hessian checks are marked NOT_ASSESSED_DUE_TO_SINGULARITY.
#
# A reduced-model fit is implemented ONLY as an explicitly labeled secondary sensitivity
# function (fit_threshold_regressions_reduced_sensitivity) and is NEVER substituted into
# the primary diagnostic or primary bootstrap pipeline.
#
# CONVERGENCE & DIAGNOSTIC SEPARATION (6-STEP PROTOCOL WITH TRI-STATE TELEMETRY):
# Step 0: Event count guard: min(sum(Y_bin==1), sum(Y_bin==0)) >= 15
# Step 1: Optimizer execution & termination code: opt_code == 0 (bobyqa code 0 required)
# Step 2: Random-effects singularity: isSingular(tol = 1e-4) rank deficiency check via rePCA/VarCorr
# Step 3: Explicit raw gradient & relTol: non-empty, finite, length 16, max|grad| < 1e-3, no lme4 grad msgs
# Step 4: Full & fixed-effect Hessian: full derivative Hessian min eigval > 1e-6, no lme4 hess msgs, vcov PD
# Step 5: Fixed-effect quasi-separation guard: finite SEs and max(SE_fixef) < 10.0
# Step 6: Four-cutpoint omnibus synthesis: all 4 cutpoints required; fails closed if any fails
fit_threshold_regressions <- function(df_data) {
  contrasts <- numeric(4)
  convergence <- logical(4)
  non_estimable <- logical(4)
  
  # Overall cutpoint failure code
  cutpoint_status <- character(4)
  cutpoint_detail <- character(4)
  
  # Granular tri-state step telemetry: PASSED | FAILED | NOT_ASSESSED_DUE_TO_*
  s0_event_status <- character(4)
  s1_opt_status <- character(4)
  s2_sing_status <- character(4)
  s3_grad_status <- character(4)
  s4_hess_status <- character(4)
  s5_sep_status <- character(4)
  
  opt_codes <- integer(4)
  singular_flags <- logical(4)
  singular_components <- character(4)
  max_grads <- numeric(4)
  min_hess_eigvals <- numeric(4)
  max_ses <- numeric(4)
  
  for (c_idx in 1:4) {
    threshold_val <- c_idx + 1 # Y >= 2, 3, 4, 5
    df_data$Y_bin <- as.numeric(df_data$score >= threshold_val)
    n_pos <- sum(df_data$Y_bin == 1)
    n_neg <- sum(df_data$Y_bin == 0)
    
    # --------------------------------------------------------------------------
    # Step 0: Preliminary Frequency Guard
    # --------------------------------------------------------------------------
    if (n_pos < 15 || n_neg < 15) {
      contrasts[c_idx] <- NA_real_
      convergence[c_idx] <- FALSE
      non_estimable[c_idx] <- TRUE
      
      s0_event_status[c_idx] <- "FAILED"
      s1_opt_status[c_idx] <- "NOT_ASSESSED_DUE_TO_EVENT_GUARD"
      s2_sing_status[c_idx] <- "NOT_ASSESSED_DUE_TO_EVENT_GUARD"
      s3_grad_status[c_idx] <- "NOT_ASSESSED_DUE_TO_EVENT_GUARD"
      s4_hess_status[c_idx] <- "NOT_ASSESSED_DUE_TO_EVENT_GUARD"
      s5_sep_status[c_idx] <- "NOT_ASSESSED_DUE_TO_EVENT_GUARD"
      
      cutpoint_status[c_idx] <- "EVENT_COUNT_GUARD_FAILED"
      cutpoint_detail[c_idx] <- sprintf("Minority class has < 15 events (pos=%d, neg=%d)", n_pos, n_neg)
      opt_codes[c_idx] <- NA_integer_
      singular_flags[c_idx] <- NA
      singular_components[c_idx] <- "NOT_ASSESSED"
      max_grads[c_idx] <- NA_real_
      min_hess_eigvals[c_idx] <- NA_real_
      max_ses[c_idx] <- NA_real_
      next
    }
    s0_event_status[c_idx] <- "PASSED"
    
    # --------------------------------------------------------------------------
    # Step 1: Fit Prescribed Primary Model & Check Optimizer Termination Code
    # --------------------------------------------------------------------------
    ctrl <- lme4::glmerControl(
      optimizer = "bobyqa",
      optCtrl = list(maxfun = 200000),
      check.rankX = "stop.deficient",
      check.conv.grad = list(action = "warning", tol = 1e-3, relTol = NULL),
      check.conv.singular = list(action = "message", tol = 1e-4),
      check.conv.hess = list(action = "warning", tol = 1e-6),
      calc.derivs = TRUE
    )
    
    fit_c <- tryCatch({
      lme4::glmer(
        Y_bin ~ M + Perspective + M:Perspective + Domain + 
          (1 | scenario_id) + (1 | scenario_persp_id),
        data = df_data,
        family = binomial(link = "logit"),
        nAGQ = 1L,
        control = ctrl
      )
    }, error = function(e) {
      list(error = conditionMessage(e))
    })
    
    if (is.null(fit_c) || (!is.null(fit_c$error))) {
      err_msg <- if (!is.null(fit_c$error)) fit_c$error else "NULL model returned"
      contrasts[c_idx] <- NA_real_
      convergence[c_idx] <- FALSE
      non_estimable[c_idx] <- TRUE
      
      s1_opt_status[c_idx] <- "FAILED"
      s2_sing_status[c_idx] <- "NOT_ASSESSED_DUE_TO_OPTIMIZER_FAILURE"
      s3_grad_status[c_idx] <- "NOT_ASSESSED_DUE_TO_OPTIMIZER_FAILURE"
      s4_hess_status[c_idx] <- "NOT_ASSESSED_DUE_TO_OPTIMIZER_FAILURE"
      s5_sep_status[c_idx] <- "NOT_ASSESSED_DUE_TO_OPTIMIZER_FAILURE"
      
      cutpoint_status[c_idx] <- "OPTIMIZER_EXECUTION_ERROR"
      cutpoint_detail[c_idx] <- sprintf("Fatal optimizer error: %s", err_msg)
      opt_codes[c_idx] <- -1L
      singular_flags[c_idx] <- NA
      singular_components[c_idx] <- "NOT_ASSESSED"
      max_grads[c_idx] <- NA_real_
      min_hess_eigvals[c_idx] <- NA_real_
      max_ses[c_idx] <- NA_real_
      next
    }
    
    # Independent Inspection of Optimizer Convergence Code
    # In bobyqa/minqa, conv$opt == 0 signifies successful termination.
    opt_code <- fit_c@optinfo$conv$opt
    opt_codes[c_idx] <- if (is.null(opt_code)) -1L else as.integer(opt_code)
    if (is.null(opt_code) || opt_code != 0) {
      contrasts[c_idx] <- NA_real_
      convergence[c_idx] <- FALSE
      non_estimable[c_idx] <- TRUE
      
      s1_opt_status[c_idx] <- "FAILED"
      s2_sing_status[c_idx] <- "NOT_ASSESSED_DUE_TO_OPTIMIZER_FAILURE"
      s3_grad_status[c_idx] <- "NOT_ASSESSED_DUE_TO_OPTIMIZER_FAILURE"
      s4_hess_status[c_idx] <- "NOT_ASSESSED_DUE_TO_OPTIMIZER_FAILURE"
      s5_sep_status[c_idx] <- "NOT_ASSESSED_DUE_TO_OPTIMIZER_FAILURE"
      
      cutpoint_status[c_idx] <- "OPTIMIZER_CONVERGENCE_FAILED"
      cutpoint_detail[c_idx] <- sprintf("Optimizer termination code %s (expected 0)", as.character(opt_code))
      singular_flags[c_idx] <- NA
      singular_components[c_idx] <- "NOT_ASSESSED"
      max_grads[c_idx] <- NA_real_
      min_hess_eigvals[c_idx] <- NA_real_
      max_ses[c_idx] <- NA_real_
      next
    }
    
    # --------------------------------------------------------------------------
    # Step 1b: Structural Model Invariants Verification
    # --------------------------------------------------------------------------
    b_fixef_all <- tryCatch(lme4::fixef(fit_c, add.dropped = TRUE), error = function(e) lme4::fixef(fit_c))
    b_fixef <- lme4::fixef(fit_c)
    n_fixef <- length(b_fixef)
    n_theta <- length(lme4::getME(fit_c, "theta"))
    n_expected <- n_fixef + n_theta
    
    X_mat <- tryCatch(lme4::getME(fit_c, "X"), error = function(e) NULL)
    X_rank <- if (!is.null(X_mat)) qr(X_mat)$rank else 0
    grp_names <- names(lme4::ngrps(fit_c))
    
    has_dropped <- any(is.na(b_fixef_all)) || (length(b_fixef_all) != length(b_fixef))
    rank_ok <- (!is.null(X_mat)) && (ncol(X_mat) == 15) && (X_rank == 15)
    names_ok <- all(REQUIRED_CONTRAST_TERMS %in% names(b_fixef))
    grps_ok <- all(c("scenario_id", "scenario_persp_id") %in% grp_names) && (length(grp_names) == 2)
    dim_ok <- (n_fixef == 15) && (n_theta == 2) && (n_expected == 17)
    
    # Domain taxonomy invariants check
    domain_terms <- names(b_fixef)[grepl("^Domain", names(b_fixef))]
    has_cardio_dummy <- "Domaincardiovascular" %in% domain_terms
    unapproved_domains <- setdiff(domain_terms, CANONICAL_NON_REFERENCE_DOMAINS)
    missing_domains <- setdiff(CANONICAL_NON_REFERENCE_DOMAINS, domain_terms)
    domain_taxonomy_ok <- (!has_cardio_dummy) && (length(unapproved_domains) == 0) && (length(missing_domains) == 0)
    
    if (has_dropped || (!rank_ok) || (!names_ok) || (!grps_ok) || (!dim_ok) || (!domain_taxonomy_ok)) {
      contrasts[c_idx] <- NA_real_
      convergence[c_idx] <- FALSE
      non_estimable[c_idx] <- TRUE
      
      s1_opt_status[c_idx] <- "FAILED"
      s2_sing_status[c_idx] <- "NOT_ASSESSED_DUE_TO_STRUCTURAL_FAILURE"
      s3_grad_status[c_idx] <- "NOT_ASSESSED_DUE_TO_STRUCTURAL_FAILURE"
      s4_hess_status[c_idx] <- "NOT_ASSESSED_DUE_TO_STRUCTURAL_FAILURE"
      s5_sep_status[c_idx] <- "NOT_ASSESSED_DUE_TO_STRUCTURAL_FAILURE"
      
      struct_reason <- if (has_dropped) "Dropped fixed-effect coefficients detected (check.rankX violation)"
                       else if (!rank_ok) sprintf("Design matrix rank deficient (ncol=%d, rank=%d, expected=15)", if(is.null(X_mat)) 0 else ncol(X_mat), X_rank)
                       else if (!names_ok) sprintf("Missing required contrast coefficients: %s", paste(setdiff(REQUIRED_CONTRAST_TERMS, names(b_fixef)), collapse=", "))
                       else if (!grps_ok) sprintf("Missing required random-effects grouping terms: %s", paste(grp_names, collapse=", "))
                       else if (has_cardio_dummy) "Domain taxonomy invariant violated: Cardiovascular is reference domain and must not have a dummy coefficient"
                       else if (length(unapproved_domains) > 0) sprintf("Domain taxonomy invariant violated: Unapproved domain(s) detected: %s", paste(unapproved_domains, collapse=", "))
                       else if (length(missing_domains) > 0) sprintf("Domain taxonomy invariant violated: Missing required registered domain(s): %s", paste(missing_domains, collapse=", "))
                       else sprintf("Parameter dimension mismatch (n_fixef=%d, n_theta=%d, expected=15+2=17)", n_fixef, n_theta)
      
      cutpoint_status[c_idx] <- "STRUCTURAL_SPECIFICATION_FAILED"
      cutpoint_detail[c_idx] <- struct_reason
      opt_codes[c_idx] <- opt_code
      singular_flags[c_idx] <- NA
      singular_components[c_idx] <- "NOT_ASSESSED"
      max_grads[c_idx] <- NA_real_
      min_hess_eigvals[c_idx] <- NA_real_
      max_ses[c_idx] <- NA_real_
      next
    }
    s1_opt_status[c_idx] <- "PASSED"
    
    # --------------------------------------------------------------------------
    # Step 2: Random-Effects Singularity Inspection (Fail Closed for Primary Model)
    # --------------------------------------------------------------------------
    # In lme4, isSingular(fit, tol = 1e-4) directly evaluates whether any element
    # of the relative covariance parameter vector theta is on or near the lower
    # boundary constraint (theta_i <= tol). It does NOT simply evaluate variance < 1e-4.
    # Singularity can arise from u_s (scenario_id) OR v_sp (scenario_persp_id).
    is_sing <- lme4::isSingular(fit_c, tol = 1e-4)
    singular_flags[c_idx] <- is_sing
    
    if (is_sing) {
      vc <- as.data.frame(lme4::VarCorr(fit_c))
      vc_details <- paste(sprintf("%s(sd=%.2e)", vc$grp, vc$sdcor), collapse = ", ")
      
      # Use rePCA as supplementary diagnostic for orthogonal variance decomposition
      pca_summary <- tryCatch({
        pca_fit <- lme4::rePCA(fit_c)
        sds <- sapply(pca_fit, function(x) x$sdev)
        paste(sprintf("%s: sdev=%s", names(sds), paste(round(sds, 5), collapse=",")), collapse="; ")
      }, error = function(e) "rePCA unavailable")
      
      singular_components[c_idx] <- sprintf("%s | %s", vc_details, pca_summary)
      
      contrasts[c_idx] <- NA_real_
      convergence[c_idx] <- FALSE
      non_estimable[c_idx] <- TRUE
      
      s2_sing_status[c_idx] <- "FAILED"
      s3_grad_status[c_idx] <- "NOT_ASSESSED_DUE_TO_SINGULARITY"
      s4_hess_status[c_idx] <- "NOT_ASSESSED_DUE_TO_SINGULARITY"
      s5_sep_status[c_idx] <- "NOT_ASSESSED_DUE_TO_SINGULARITY"
      
      cutpoint_status[c_idx] <- "SINGULAR_FIT"
      cutpoint_detail[c_idx] <- sprintf("Singular random-effects structure (%s). Silent model reduction prohibited.", singular_components[c_idx])
      max_grads[c_idx] <- NA_real_
      min_hess_eigvals[c_idx] <- NA_real_
      max_ses[c_idx] <- NA_real_
      next
    }
    s2_sing_status[c_idx] <- "PASSED"
    singular_components[c_idx] <- "NON_SINGULAR"
    
    # --------------------------------------------------------------------------
    # Step 3: Explicit Raw Gradient Diagnostics & relTol Check
    # --------------------------------------------------------------------------
    # Custom acceptance rule: max_j |grad_j| < 1e-3, non-null, finite, exact dynamic length n_expected (17).
    # Note: lme4 internal checkConv.R computes:
    #   scgrad <- solve(chol(Hessian), gradient)
    #   mingrad <- pmin(abs(scgrad), abs(gradient))
    #   maxmingrad <- max(mingrad) <= tol (check.conv.grad$tol)
    # alongside relative gradient checks (|g_j / p_j|). Setting relTol = NULL in glmerControl
    # disables relative-gradient checks to avoid instability when parameters are near zero.
    # Our custom raw-gradient rule is an additional, stricter criterion.
    raw_grad <- fit_c@optinfo$derivs$gradient
    lme4_conv <- fit_c@optinfo$conv$lme4
    lme4_codes <- if (!is.null(lme4_conv$code)) as.integer(lme4_conv$code) else integer(0)
    conv_msgs <- if (!is.null(lme4_conv$messages)) as.character(lme4_conv$messages) else character(0)
    
    # Preemption Invariant: Detect gradient failures independently of numeric code.
    # In lme4 (checkConv.R), Hessian checks occur after gradient checks; Hessian diagnostics
    # can append messages and replace the numeric code with Hessian code(s) (e.g. c(2L, 3L)),
    # but the earlier gradient messages are preserved in conv$lme4$messages.
    # Therefore, Step 3 must inspect BOTH the complete message vector AND code vector.
    
    # 1. Detect gradient evaluation failure:
    #    - Code -5 (gradient NA / non-finite)
    #    - Message containing "unable to evaluate scaled gradient" or "scaled gradient has non-finite values"
    #    - raw_grad is null, has wrong dimension (!= n_expected), or contains NA/NaN/Inf
    msg_grad_eval_fail <- any(grepl("unable to evaluate|non-finite", conv_msgs, ignore.case = TRUE))
    code_grad_eval_fail <- any(lme4_codes == -5L)
    raw_grad_invalid <- is.null(raw_grad) || (length(raw_grad) != n_expected) || any(!is.finite(raw_grad))
    
    is_grad_eval_fail <- msg_grad_eval_fail || code_grad_eval_fail || raw_grad_invalid
    
    # 2. Detect gradient tolerance failure (if not an evaluation failure):
    #    - Code -1 (scaled gradient > tol) without evaluation failure message
    #    - Code -2 (relative gradient > relTol; unreachable under primary relTol = NULL, retained defensively)
    #    - Message containing "failed to converge with max|grad|" or "relative gradient"
    #    - Raw gradient max(abs(raw_grad)) >= 1e-3
    #    - Any message matching "gradient" or "relTol"
    msg_grad_tol_fail <- any(grepl("failed to converge with max\\|grad\\||relative gradient", conv_msgs, ignore.case = TRUE))
    code_grad_tol_fail <- any(lme4_codes %in% c(-1L, -2L))
    raw_grad_tol_fail <- (!raw_grad_invalid) && (max(abs(raw_grad)) >= 1e-3)
    has_grad_warning <- any(grepl("gradient|relTol", conv_msgs, ignore.case = TRUE))
    
    is_grad_tol_fail <- (!is_grad_eval_fail) && (msg_grad_tol_fail || code_grad_tol_fail || raw_grad_tol_fail || has_grad_warning)
    
    if (is_grad_eval_fail || is_grad_tol_fail) {
      contrasts[c_idx] <- NA_real_
      convergence[c_idx] <- FALSE
      non_estimable[c_idx] <- TRUE
      
      s3_grad_status[c_idx] <- "FAILED"
      s4_hess_status[c_idx] <- "NOT_ASSESSED_DUE_TO_GRADIENT_FAILURE"
      s5_sep_status[c_idx] <- "NOT_ASSESSED_DUE_TO_GRADIENT_FAILURE"
      
      all_codes_str <- if (length(lme4_codes) > 0) paste(lme4_codes, collapse = ",") else "none"
      
      if (is_grad_eval_fail) {
        cutpoint_status[c_idx] <- "GRADIENT_EVALUATION_FAILED"
        detail_msg <- if (msg_grad_eval_fail) {
          paste(conv_msgs[grepl("unable to evaluate|non-finite", conv_msgs, ignore.case = TRUE)], collapse = "; ")
        } else if (code_grad_eval_fail) {
          "Gradient contains NA or non-finite values (lme4 code -5)"
        } else {
          sprintf("Gradient vector invalid (length=%d, expected=%d, non-finite=%s)",
                  if (is.null(raw_grad)) 0 else length(raw_grad), n_expected,
                  if (is.null(raw_grad)) TRUE else any(!is.finite(raw_grad)))
        }
        cutpoint_detail[c_idx] <- sprintf("Gradient evaluation failure [codes: %s]: %s", all_codes_str, detail_msg)
      } else {
        cutpoint_status[c_idx] <- "GRADIENT_TOLERANCE_EXCEEDED"
        max_g_val <- if (!raw_grad_invalid) max(abs(raw_grad)) else NA_real_
        detail_msg <- if (msg_grad_tol_fail || has_grad_warning) {
          paste(conv_msgs[grepl("failed to converge with max\\|grad\\||relative gradient|gradient|relTol", conv_msgs, ignore.case = TRUE)], collapse = "; ")
        } else if (any(lme4_codes == -2L)) {
          "Relative-gradient check failure (lme4 code -2, unreachable under primary relTol = NULL)"
        } else {
          sprintf("Max absolute raw gradient %.2e >= 1e-3", max_g_val)
        }
        cutpoint_detail[c_idx] <- sprintf("Gradient tolerance exceeded [codes: %s]: %s", all_codes_str, detail_msg)
      }
      
      max_grads[c_idx] <- if (!raw_grad_invalid) max(abs(raw_grad)) else NA_real_
      min_hess_eigvals[c_idx] <- NA_real_
      max_ses[c_idx] <- NA_real_
      next
    }
    s3_grad_status[c_idx] <- "PASSED"
    max_grads[c_idx] <- max(abs(raw_grad))
    
    # --------------------------------------------------------------------------
    # Step 4: Full Derivative Hessian & Fixed-Effect Information Matrix Verification
    # --------------------------------------------------------------------------
    # Complete lme4 checkHess inspection + positive-definiteness & condition number:
    # 1. Full derivative Hessian (dim: n_expected x n_expected = 17 x 17)
    full_hess <- fit_c@optinfo$derivs$Hessian
    hess_dim_valid <- !is.null(full_hess) && all(dim(full_hess) == c(n_expected, n_expected))
    hess_finite <- hess_dim_valid && all(is.finite(full_hess))
    
    # Eigenvalues, condition number, and Cholesky of full Hessian
    ev_full <- if (hess_finite) tryCatch(eigen(full_hess, symmetric = TRUE, only.values = TRUE)$values, error = function(e) NULL) else NULL
    min_eig <- if (!is.null(ev_full) && all(is.finite(ev_full))) min(ev_full) else -Inf
    max_eig <- if (!is.null(ev_full) && all(is.finite(ev_full))) max(ev_full) else Inf
    cond_num <- if (min_eig > 0) max_eig / min_eig else Inf
    chol_ok <- if (hess_finite) !inherits(tryCatch(chol(full_hess), error = function(e) e), "error") else FALSE
    
    min_hess_eigvals[c_idx] <- min_eig
    # Vector-safe Hessian convergence codes check
    # Hessian-specific lme4 checkHess failure codes (-3, -4, -6, 2, 3):
    # -3: Negative eigenvalues (indefinite Hessian)
    # -4: Numerically singular Hessian (zero eigenvalue)
    # -6: Eigenvalue calculation failed
    #  2: Excessively large eigenvalue (> 1e6)
    #  3: Excessive condition number / ratio (> 1e6)
    known_hess_codes <- c(-3L, -4L, -6L, 2L, 3L)
    detected_hess_codes <- intersect(lme4_codes, known_hess_codes)
    has_hess_code_fail <- length(detected_hess_codes) > 0
    has_hess_msg <- any(grepl("Hessian|singular|eigenvalue|unidentifiable", conv_msgs, ignore.case = TRUE))
    
    # Check for unrecognized/unknown non-zero codes (fail closed)
    all_known_codes <- c(0L, -1L, -2L, -3L, -4L, -5L, -6L, 2L, 3L)
    unrecognized_codes <- setdiff(lme4_codes, all_known_codes)
    has_unknown_code <- length(unrecognized_codes) > 0
    
    # 2. Fixed-effect covariance matrix (vcov, dim: n_fixef x n_fixef = 15 x 15)
    cov_mat <- tryCatch(as.matrix(vcov(fit_c)), error = function(e) NULL)
    cov_dim_valid <- !is.null(cov_mat) && all(dim(cov_mat) == c(n_fixef, n_fixef))
    cov_finite <- cov_dim_valid && all(is.finite(cov_mat))
    cov_pd <- cov_finite && all(eigen(cov_mat, symmetric = TRUE, only.values = TRUE)$values > 0)
    
    hess_failed <- (!hess_dim_valid) || (!hess_finite) || (min_eig <= 1e-6) || 
                   (cond_num > 1e6) || (!chol_ok) || has_hess_code_fail || has_hess_msg || 
                   has_unknown_code || (!cov_dim_valid) || (!cov_finite) || (!cov_pd)
    
    if (hess_failed) {
      contrasts[c_idx] <- NA_real_
      convergence[c_idx] <- FALSE
      non_estimable[c_idx] <- TRUE
      
      s4_hess_status[c_idx] <- "FAILED"
      s5_sep_status[c_idx] <- "NOT_ASSESSED_DUE_TO_HESSIAN_FAILURE"
      
      # Build readable combined failure reason supporting multiple vector codes
      code_reasons <- character(0)
      if (any(detected_hess_codes == -3L)) code_reasons <- c(code_reasons, "Negative Hessian eigenvalues (code -3)")
      if (any(detected_hess_codes == -4L)) code_reasons <- c(code_reasons, "Numerically singular Hessian (code -4)")
      if (any(detected_hess_codes == -6L)) code_reasons <- c(code_reasons, "Hessian eigenvalue calculation failure (code -6)")
      if (any(detected_hess_codes == 2L)) code_reasons <- c(code_reasons, "Excessively large Hessian eigenvalue (code 2)")
      if (any(detected_hess_codes == 3L)) code_reasons <- c(code_reasons, "Excessive eigenvalue ratio / ill-conditioned Hessian (code 3)")
      if (has_unknown_code) code_reasons <- c(code_reasons, sprintf("Unrecognized diagnostic code(s): %s", paste(unrecognized_codes, collapse = ", ")))
      
      fail_reason <- if (length(code_reasons) > 0) {
                       sprintf("Hessian diagnostic code(s) [%s]: %s", paste(c(detected_hess_codes, unrecognized_codes), collapse = ", "), paste(code_reasons, collapse = "; "))
                     }
                     else if (!hess_dim_valid) sprintf("Full Hessian dim invalid (%s, expected %dx%d)", 
                                                       if(is.null(full_hess)) "NULL" else paste(dim(full_hess), collapse="x"), 
                                                       n_expected, n_expected)
                     else if (!hess_finite) "Full Hessian contains NaN or Inf"
                     else if (min_eig <= 1e-6) sprintf("Full Hessian min eigenvalue %.2e <= 1e-6", min_eig)
                     else if (cond_num > 1e6) sprintf("Full Hessian condition number %.2e > 1e6", cond_num)
                     else if (!chol_ok) "Full Hessian Cholesky decomposition failed"
                     else if (has_hess_msg) paste(conv_msgs[grepl("Hessian|singular|eigenvalue|unidentifiable", conv_msgs, ignore.case = TRUE)], collapse="; ")
                     else if (!cov_dim_valid) sprintf("vcov(fit) dim invalid (%s, expected %dx%d)", 
                                                      if(is.null(cov_mat)) "NULL" else paste(dim(cov_mat), collapse="x"), 
                                                      n_fixef, n_fixef)
                     else "vcov(fit) non-invertible or non-positive-definite"
      cutpoint_status[c_idx] <- "HESSIAN_CHECK_FAILED"
      cutpoint_detail[c_idx] <- fail_reason
      max_ses[c_idx] <- NA_real_
      next
    }
    s4_hess_status[c_idx] <- "PASSED"
    
    # --------------------------------------------------------------------------
    # Step 5: Strict Fixed-Effect Quasi-Separation Guard (max SE < 10.0)
    # --------------------------------------------------------------------------
    se_vals <- sqrt(diag(cov_mat))
    if (any(is.na(se_vals)) || any(is.infinite(se_vals))) {
      contrasts[c_idx] <- NA_real_
      convergence[c_idx] <- FALSE
      non_estimable[c_idx] <- TRUE
      
      s5_sep_status[c_idx] <- "FAILED"
      cutpoint_status[c_idx] <- "QUASI_SEPARATION_DETECTED"
      cutpoint_detail[c_idx] <- "Fixed-effect standard error contains NaN or Inf"
      max_ses[c_idx] <- Inf
      next
    }
    max_se <- max(se_vals)
    max_ses[c_idx] <- max_se
    if (max_se >= 10.0) {
      contrasts[c_idx] <- NA_real_
      convergence[c_idx] <- FALSE
      non_estimable[c_idx] <- TRUE
      
      s5_sep_status[c_idx] <- "FAILED"
      cutpoint_status[c_idx] <- "QUASI_SEPARATION_MAX_SE_EXCEEDED"
      cutpoint_detail[c_idx] <- sprintf("Max fixed-effect standard error %.2f >= 10.0 threshold", max_se)
      next
    }
    s5_sep_status[c_idx] <- "PASSED"
    
    # All Steps Passed Cleanly
    contrasts[c_idx] <- compute_contrast(lme4::fixef(fit_c))
    convergence[c_idx] <- TRUE
    cutpoint_status[c_idx] <- "PASSED"
    cutpoint_detail[c_idx] <- "All 6 checks passed cleanly under primary random-effects model"
  }
  
  # Format comprehensive per-cutpoint diagnostic telemetry
  cutpoint_diagnostics <- vector("list", 4)
  for (c_idx in 1:4) {
    cutpoint_diagnostics[[c_idx]] <- list(
      cutpoint = c_idx,
      threshold = c_idx + 1,
      overall_status = cutpoint_status[c_idx],
      detail = cutpoint_detail[c_idx],
      step_telemetry = list(
        step0_event_guard = s0_event_status[c_idx],
        step1_optimizer = s1_opt_status[c_idx],
        step2_singularity = s2_sing_status[c_idx],
        step3_gradient = s3_grad_status[c_idx],
        step4_hessian = s4_hess_status[c_idx],
        step5_separation = s5_sep_status[c_idx]
      ),
      opt_code = opt_codes[c_idx],
      is_singular = singular_flags[c_idx],
      singular_components = singular_components[c_idx],
      max_raw_grad = max_grads[c_idx],
      min_hess_eigval = min_hess_eigvals[c_idx],
      max_se = max_ses[c_idx],
      contrast = contrasts[c_idx]
    )
  }
  
  # Step 6: Approach A Policy - All 4 cutpoints are strictly required.
  if (!all(convergence)) {
    failed_cutpoints <- which(!convergence)
    reasons <- paste(sprintf("c=%d [%s: %s]", failed_cutpoints, cutpoint_status[failed_cutpoints], cutpoint_detail[failed_cutpoints]), collapse = "; ")
    return(list(
      status = "DIAGNOSTIC_NON_ESTIMABLE_DUE_TO_SPARSITY",
      delta_po = NA_real_,
      converged = FALSE,
      contrasts = contrasts,
      diagnostics = cutpoint_diagnostics,
      failed_cutpoints = failed_cutpoints,
      reason = sprintf("Estimability protocol failed closed: %s", reasons)
    ))
  }
  
  bar_psi <- mean(contrasts)
  delta_po <- sum((contrasts - bar_psi)^2)
  return(list(
    status = "SUCCESS",
    delta_po = delta_po,
    converged = TRUE,
    contrasts = contrasts,
    diagnostics = cutpoint_diagnostics,
    failed_cutpoints = integer(0),
    reason = "All 4 cutpoints successfully estimated under primary random-effects model"
  ))
}

# ------------------------------------------------------------------------------
# Secondary Sensitivity Model: Reduced Single Random-Intercept Model
# ------------------------------------------------------------------------------
# NOTE: This function is strictly for pre-specified secondary sensitivity analysis.
# It is NEVER called in the primary diagnostic or primary bootstrap pipeline.
# Fitting this model evaluates parameter stability if the nested session-level
# variance component is omitted: Y_bin ~ ... + (1 | scenario_id).
fit_threshold_regressions_reduced_sensitivity <- function(df_data) {
  contrasts <- numeric(4)
  convergence <- logical(4)
  step_status <- character(4)
  step_failures <- character(4)
  
  for (c_idx in 1:4) {
    threshold_val <- c_idx + 1
    df_data$Y_bin <- as.numeric(df_data$score >= threshold_val)
    if (sum(df_data$Y_bin == 1) < 15 || sum(df_data$Y_bin == 0) < 15) {
      contrasts[c_idx] <- NA_real_
      convergence[c_idx] <- FALSE
      step_status[c_idx] <- "EVENT_COUNT_GUARD_FAILED"
      next
    }
    
    ctrl <- lme4::glmerControl(
      optimizer = "bobyqa",
      optCtrl = list(maxfun = 200000),
      check.conv.grad = list(action = "warning", tol = 1e-3, relTol = 1e-3),
      check.conv.singular = list(action = "message", tol = 1e-4),
      check.conv.hess = list(action = "warning", tol = 1e-6)
    )
    
    fit_sens <- tryCatch({
      lme4::glmer(
        Y_bin ~ M + Perspective + M:Perspective + Domain + (1 | scenario_id),
        data = df_data,
        family = binomial(link = "logit"),
        control = ctrl
      )
    }, error = function(e) NULL)
    
    if (is.null(fit_sens) || fit_sens@optinfo$conv$opt != 0) {
      contrasts[c_idx] <- NA_real_
      convergence[c_idx] <- FALSE
      step_status[c_idx] <- "OPTIMIZER_FAILED"
      next
    }
    
    cov_mat <- tryCatch(as.matrix(vcov(fit_sens)), error = function(e) NULL)
    if (is.null(cov_mat)) {
      contrasts[c_idx] <- NA_real_
      convergence[c_idx] <- FALSE
      step_status[c_idx] <- "HESSIAN_FAILED"
      next
    }
    
    se_vals <- sqrt(diag(cov_mat))
    if (any(is.na(se_vals)) || any(se_vals >= 10.0)) {
      contrasts[c_idx] <- NA_real_
      convergence[c_idx] <- FALSE
      step_status[c_idx] <- "SEPARATION_DETECTED"
      next
    }
    
    contrasts[c_idx] <- compute_contrast(lme4::fixef(fit_sens))
    convergence[c_idx] <- TRUE
    step_status[c_idx] <- "PASSED"
  }
  
  if (!all(convergence)) {
    return(list(
      model_type = "REDUCED_SINGLE_INTERCEPT_SENSITIVITY",
      status = "NON_ESTIMABLE",
      delta_po = NA_real_,
      converged = FALSE,
      contrasts = contrasts,
      step_status = step_status
    ))
  }
  
  bar_psi <- mean(contrasts)
  delta_po <- sum((contrasts - bar_psi)^2)
  return(list(
    model_type = "REDUCED_SINGLE_INTERCEPT_SENSITIVITY",
    status = "SUCCESS",
    delta_po = delta_po,
    converged = TRUE,
    contrasts = contrasts,
    step_status = step_status
  ))
}

# ------------------------------------------------------------------------------
# 3. Parametric Null Bootstrap Procedure
# ------------------------------------------------------------------------------
run_parametric_null_bootstrap <- function(df_observed, B = 1000, seed = 42) {
  set.seed(seed)
  
  # Step 1: Fit observed primary proportional-odds CLMM
  fit_null <- tryCatch({
    ordinal::clmm(
      as.factor(score) ~ M + Perspective + M:Perspective + Domain + 
        (1 | scenario_id) + (1 | scenario_persp_id),
      data = df_observed,
      link = "logit"
    )
  }, error = function(e) NULL)
  
  if (is.null(fit_null)) {
    stop("Failed to fit primary null proportional-odds CLMM.")
  }
  
  # Step 2: Compute observed Delta_PO across all four predefined cutpoints
  obs_diag <- fit_threshold_regressions(df_observed)
  if (!obs_diag$converged) {
    stop(sprintf("Observed threshold regressions failed: %s Proportional odds diagnostic fails closed (DIAGNOSTIC_NON_ESTIMABLE).", obs_diag$reason))
  }
  delta_obs <- obs_diag$delta_po
  
  # Extract fitted parameters
  fitted_cutpoints <- fit_null$Theta
  fitted_coefs <- fit_null$beta
  sigma_u <- sqrt(as.numeric(fit_null$ST$scenario_id[1, 1]))
  sigma_v <- sqrt(as.numeric(fit_null$ST$scenario_persp_id[1, 1]))
  
  # Step 3: Parametric bootstrap loop under null (preserving clustered structure)
  # Retry budget: Target B valid replicates, maximum B * 1.25 attempts (25% retry budget)
  exceedances <- 0
  valid_replicates <- 0
  max_attempts <- round(B * 1.25) # 1,250 attempts for B = 1,000
  total_attempts <- 0
  
  unique_scenarios <- unique(df_observed$scenario_id)
  n_scenarios <- length(unique_scenarios)
  
  while (valid_replicates < B && total_attempts < max_attempts) {
    total_attempts <- total_attempts + 1
    df_boot <- df_observed
    
    # Generate random intercepts for bootstrap replicate
    u_b <- rnorm(n_scenarios, 0, sigma_u)
    names(u_b) <- unique_scenarios
    
    unique_persp_sessions <- unique(df_observed$scenario_persp_id)
    v_b <- rnorm(length(unique_persp_sessions), 0, sigma_v)
    names(v_b) <- unique_persp_sessions
    
    # Compute linear predictor under null (identical beta across cutpoints)
    X_mat <- model.matrix(~ M + Perspective + M:Perspective + Domain, data = df_boot)[, -1]
    eta_fixed <- as.numeric(X_mat %*% fitted_coefs)
    eta_total <- eta_fixed + u_b[as.character(df_boot$scenario_id)] + v_b[as.character(df_boot$scenario_persp_id)]
    
    # Sample logistic error
    eps <- rlogis(nrow(df_boot), location = 0, scale = 1)
    latent_y <- eta_total + eps
    
    # Generate ordinal rating from cutpoints
    score_boot <- rep(1, nrow(df_boot))
    for (k in 1:length(fitted_cutpoints)) {
      score_boot[latent_y > fitted_cutpoints[k]] <- k + 1
    }
    df_boot$score <- score_boot
    
    # Re-evaluate Delta_PO on bootstrap sample across ALL FOUR cutpoints
    boot_diag <- fit_threshold_regressions(df_boot)
    if (boot_diag$converged && !is.na(boot_diag$delta_po)) {
      valid_replicates <- valid_replicates + 1
      if (boot_diag$delta_po >= delta_obs) {
        exceedances <- exceedances + 1
      }
    }
  }
  
  # Step 4: Three-Branch Stopping Outcome Evaluation
  # NOTE: These branches are specified governance policy rules, not empirical counts.
  discard_rate <- (total_attempts - valid_replicates) / total_attempts

  if (valid_replicates >= B) {
    # Branch 1: Full quota achieved (B_valid = 1,000)
    p_boot <- (1 + exceedances) / (valid_replicates + 1) # Denominator: 1,001
    branch_status <- "FULL_QUOTA_ACHIEVED"
  } else if (valid_replicates >= 800) {
    # Branch 2: Attempt limit reached with acceptable count (800 <= B_valid <= 999)
    # Exceedance p-value evaluated strictly using the actual valid replicate count.
    p_boot <- (1 + exceedances) / (valid_replicates + 1)
    branch_status <- "ACCEPTABLE_QUOTA_REACHED"
  } else {
    # Branch 3: Attempt limit reached with insufficient count (B_valid < 800) -> Fail closed
    stop(sprintf(
      "BOOTSTRAP_CONVERGENCE_INSUFFICIENT: Achieved only %d valid bootstrap replicates out of %d attempts (discard rate = %.1f%%, minimum 800 required). Diagnostic fails closed without p-value.",
      valid_replicates, total_attempts, discard_rate * 100
    ))
  }
  
  return(list(
    status = branch_status,
    delta_obs = delta_obs,
    observed_contrasts = obs_diag$contrasts,
    valid_replicates = valid_replicates,
    total_attempts = total_attempts,
    discard_rate = discard_rate,
    p_boot_denominator = valid_replicates + 1,
    exceedances = exceedances,
    p_boot = p_boot,
    rejected_po = (p_boot < 0.05)
  ))
}

# ------------------------------------------------------------------------------
# 4. Framework B: Bayesian Predictive Sensitivity Model (brms v2.22.0)
# ------------------------------------------------------------------------------
run_bayesian_sensitivity_analysis <- function(df_data, chains = 4, iter = 2000, seed = 42) {
  # Priors:
  # Fixed effects: Normal(0, 1)
  # Thresholds: Student-t(3, 0, 2.5)
  # Random effects SD: Student-t(3, 0, 1)
  model_priors <- c(
    prior(normal(0, 1), class = "b"),
    prior(student_t(3, 0, 2.5), class = "Intercept"),
    prior(student_t(3, 0, 1), class = "sd")
  )
  
  # Model 1: Proportional Odds CLMM
  fit_brms_po <- brms::brm(
    score ~ M + Perspective + M:Perspective + Domain + 
      (1 | scenario_id) + (1 | scenario_persp_id),
    data = df_data,
    family = cumulative(link = "logit", threshold = "flexible"),
    prior = model_priors,
    chains = chains,
    iter = iter,
    seed = seed,
    control = list(adapt_delta = 0.95)
  )
  
  # Model 2: Category-Specific Effects Model for System Indicator cs(M)
  fit_brms_cs <- brms::brm(
    score ~ cs(M) + Perspective + cs(M):Perspective + Domain + 
      (1 | scenario_id) + (1 | scenario_persp_id),
    data = df_data,
    family = cumulative(link = "logit", threshold = "flexible"),
    prior = model_priors,
    chains = chains,
    iter = iter,
    seed = seed,
    control = list(adapt_delta = 0.95)
  )
  
  # Grouped 10-Fold Cross-Validation at Scenario Cluster Level
  # Using folds = "grouped", group = "scenario_id", joint = "group"
  cv_po <- brms::kfold(fit_brms_po, K = 10, folds = "grouped", group = "scenario_id", joint = "group")
  cv_cs <- brms::kfold(fit_brms_cs, K = 10, folds = "grouped", group = "scenario_id", joint = "group")
  
  loo_comp <- brms::loo_compare(cv_po, cv_cs)
  
  return(list(
    fit_po = fit_brms_po,
    fit_cs = fit_brms_cs,
    cv_po = cv_po,
    cv_cs = cv_cs,
    comparison = loo_comp
  ))
}
