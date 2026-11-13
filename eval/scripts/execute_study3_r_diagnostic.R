#!/usr/bin/env Rscript
# ==============================================================================
# MedVoice Study 3: R Reproducibility & Execution Driver
# Pinned to: lme4 1.1-35.5, ordinal 2023.12-4, Matrix 1.7-6, R 4.6.2
# Specification: v3.3.21 / Protocol: v2.3.16
# ==============================================================================

suppressPackageStartupMessages({
  library(Matrix)
  library(lme4)
  library(ordinal)
})

# Source the frozen Study 3 diagnostic specification
source("eval/scripts/proportional_odds_diagnostic_simulation.R")

cat("================================================================================\n")
cat("      MEDVOICE STUDY 3: R MIXED-EFFECTS DIAGNOSTIC REPRODUCIBILITY RUN          \n")
cat("================================================================================\n\n")

# 1. Environment & Software Version Audit
cat("[Phase 1] Environment & Package Version Verification\n")
cat("--------------------------------------------------------------------------------\n")
cat("R Version:       ", R.version.string, "\n")
cat("Platform:        ", R.version$platform, "\n")
cat("lme4 Version:    ", as.character(packageVersion("lme4")), " (Pinned: 1.1-35.5)\n")
cat("ordinal Version: ", as.character(packageVersion("ordinal")), " (Pinned: 2023.12-4)\n")
cat("Matrix Version:  ", as.character(packageVersion("Matrix")), "\n\n")

stopifnot(packageVersion("lme4") == "1.1.35.5")
stopifnot(packageVersion("ordinal") == "2023.12.4")

# 2. Data Generating Process (DGP) for Study 3 Benchmark
# 200 scenarios across 10 registered clinical domains (20 per domain)
# 3 perspectives (SIM-01, SIM-02, SIM-03)
# 2 system evaluations (Comparator M=0, MedVoice M=1)
# N = 200 * 3 * 2 = 1,200 clustered observations
generate_study3_dgp <- function(seed = 42, theta4 = 3.20) {
  set.seed(seed)
  n_scenarios <- 200
  scenarios_per_domain <- 20
  domains <- ALL_10_REGISTERED_DOMAINS
  
  sigma_u <- sqrt(0.50) # Scenario random intercept SD
  sigma_v <- sqrt(0.25) # Session random intercept SD
  
  u_s <- rnorm(n_scenarios, mean = 0, sd = sigma_u)
  names(u_s) <- as.character(1:n_scenarios)
  
  perspectives <- c("SIM-01", "SIM-02", "SIM-03")
  systems <- c(0, 1)
  
  rows <- list()
  for (d_idx in seq_along(domains)) {
    dom <- domains[d_idx]
    for (s in 1:scenarios_per_domain) {
      scen_id <- (d_idx - 1) * scenarios_per_domain + s
      u_val <- u_s[as.character(scen_id)]
      
      for (p in perspectives) {
        scen_persp_id <- paste0(scen_id, "_", p)
        v_val <- rnorm(1, mean = 0, sd = sigma_v)
        
        for (m in systems) {
          # Ground truth parameters:
          # Primary system contrast = 0.35
          beta_m <- 0.35 * m
          gamma_p <- if (p == "SIM-02") 0.10 else if (p == "SIM-03") -0.10 else 0.0
          delta_mp <- if (m == 1 && p == "SIM-02") -0.05 else if (m == 1 && p == "SIM-03") 0.05 else 0.0
          
          # Reference domain cardiovascular = 0, others centered at 0
          eta <- beta_m + gamma_p + delta_mp + u_val + v_val
          eps <- rlogis(1, location = 0, scale = 1)
          latent_y <- eta + eps
          
          cutpoints <- c(-2.5, -0.8, 1.0, theta4)
          score <- 1
          for (k in seq_along(cutpoints)) {
            if (latent_y > cutpoints[k]) score <- k + 1
          }
          
          rows[[length(rows) + 1]] <- data.frame(
            scenario_id = scen_id,
            scenario_persp_id = scen_persp_id,
            Perspective = p,
            M = factor(m, levels = c(0, 1)),
            Domain = dom,
            score = score,
            stringsAsFactors = FALSE
          )
        }
      }
    }
  }
  
  df_res <- do.call(rbind, rows)
  df_res$Perspective <- factor(df_res$Perspective, levels = perspectives)
  df_res$Domain <- factor(df_res$Domain, levels = ALL_10_REGISTERED_DOMAINS)
  return(df_res)
}

cat("[Phase 2] Generating Benchmark Clustered Dataset (N = 1,200)\n")
cat("--------------------------------------------------------------------------------\n")
df_benchmark <- generate_study3_dgp(seed = 42, theta4 = 3.20)
cat("Total Observations:     ", nrow(df_benchmark), "\n")
cat("Unique Scenarios:       ", length(unique(df_benchmark$scenario_id)), "\n")
cat("Unique Sessions:        ", length(unique(df_benchmark$scenario_persp_id)), "\n")
cat("Clinical Domains:       ", length(unique(df_benchmark$Domain)), "\n")
cat("Rating Distribution (Scores 1 to 5):\n")
print(table(df_benchmark$score))
cat("\n")

# 3. Fit Primary Null Proportional-Odds Model via ordinal::clmm
cat("[Phase 3] Primary Null Proportional-Odds Model Fitting via ordinal::clmm\n")
cat("--------------------------------------------------------------------------------\n")
t0_clmm <- Sys.time()
fit_null <- ordinal::clmm(
  as.factor(score) ~ M + Perspective + M:Perspective + Domain + 
    (1 | scenario_id) + (1 | scenario_persp_id),
  data = df_benchmark,
  link = "logit"
)
t1_clmm <- Sys.time()
cat("ordinal::clmm Fit Succeeded in ", round(difftime(t1_clmm, t0_clmm, units = "secs"), 2), " s\n")
cat("Estimated Thresholds (Theta):\n")
print(fit_null$Theta)
vc_null <- ordinal::VarCorr(fit_null)
sigma_u_est <- as.numeric(attr(vc_null[["scenario_id"]], "stddev"))[1]
sigma_v_est <- as.numeric(attr(vc_null[["scenario_persp_id"]], "stddev"))[1]
cat("Estimated Random Effects SD (via ordinal::VarCorr):\n")
cat("  sigma_u (scenario):     ", round(sigma_u_est, 4), "\n")
cat("  sigma_v (session):      ", round(sigma_v_est, 4), "\n\n")

# 4. Execute 4-Cutpoint Proportional-Odds Diagnostic via lme4::glmer
cat("[Phase 4] Primary Proportional-Odds Diagnostic Execution via lme4::glmer\n")
cat("--------------------------------------------------------------------------------\n")
t0_diag <- Sys.time()
diag_res <- fit_threshold_regressions(df_benchmark)
t1_diag <- Sys.time()

cat("Diagnostic Execution Completed in ", round(difftime(t1_diag, t0_diag, units = "secs"), 2), " s\n")
cat("Status:          ", diag_res$status, "\n")
cat("All Converged:   ", diag_res$converged, "\n")
cat("Delta_PO:        ", round(diag_res$delta_po, 6), "\n\n")

cat("Per-Cutpoint Detailed Step Telemetry:\n")
cat("--------------------------------------------------------------------------------\n")
for (c in 1:4) {
  d <- diag_res$diagnostics[[c]]
  cat(sprintf("[Cutpoint %d (Y >= %d)]\n", c, c + 1))
  cat("  Overall Status:           ", d$overall_status, "\n")
  cat("  Detail:                   ", d$detail, "\n")
  cat("  Primary Contrast (psi):   ", if (is.null(d$contrast) || is.na(d$contrast)) "NA" else round(d$contrast, 4), "\n")
  cat("  Step 0 (Event Guard):     ", d$step_telemetry$step0_event_guard, "\n")
  cat("  Step 1 (Optimizer Code):  ", d$step_telemetry$step1_optimizer, sprintf("(opt_code=%s)\n", if (is.na(d$opt_code)) "NA" else as.character(d$opt_code)))
  cat("  Step 2 (Singularity):     ", d$step_telemetry$step2_singularity, sprintf("(is_singular=%s, component=%s)\n", if (is.na(d$is_singular)) "NA" else as.character(d$is_singular), d$singular_components))
  cat("  Step 3 (Raw Gradient):    ", d$step_telemetry$step3_gradient, sprintf("(max|grad|=%s)\n", if (is.na(d$max_raw_grad)) "NA" else sprintf("%.2e", d$max_raw_grad)))
  cat("  Step 4 (Full Hessian):    ", d$step_telemetry$step4_hessian, sprintf("(min_eig=%s)\n", if (is.na(d$min_hess_eigval)) "NA" else sprintf("%.2e", d$min_hess_eigval)))
  cat("  Step 5 (Quasi-Separation):", d$step_telemetry$step5_separation, sprintf("(max_SE=%s)\n", if (is.na(d$max_se)) "NA" else sprintf("%.3f", d$max_se)))
  cat("\n")
}

# 5. Sparse-Cutpoint Stress Test (theta4 = 4.25)
cat("[Phase 5] Sparse-Cutpoint Stress Test (theta4 = 4.25) - Fail-Closed Invariant\n")
cat("--------------------------------------------------------------------------------\n")
df_sparse <- generate_study3_dgp(seed = 101, theta4 = 4.25)
cat("Sparse Dataset Rating Distribution:\n")
print(table(df_sparse$score))
cat("Testing fail-closed boundary on sparse cutpoint 4...\n")
sparse_res <- fit_threshold_regressions(df_sparse)
cat("Sparse Diagnostic Status:   ", sparse_res$status, "\n")
cat("Sparse Delta_PO Evaluated:  ", if (is.na(sparse_res$delta_po)) "NA (Safely Refused)" else as.character(sparse_res$delta_po), "\n")
cat("Reason:                     ", sparse_res$reason, "\n\n")

# 6. Secondary Sensitivity Analysis: Reduced Single Random-Intercept Model
cat("[Phase 6] Secondary Sensitivity Model Fitting (1 | scenario_id) - Isolated\n")
cat("--------------------------------------------------------------------------------\n")
sens_res <- fit_threshold_regressions_reduced_sensitivity(df_benchmark)
cat("Secondary Sensitivity Status:", sens_res$status, "\n")
cat("Secondary Contrasts (c=1..4):\n")
print(round(sens_res$contrasts, 4))
cat("Secondary Delta_PO:          ", if (is.na(sens_res$delta_po)) "NA" else round(sens_res$delta_po, 6), "\n\n")

# 7. Save Structured Reproducibility Evidence JSON
dir.create("eval/results", showWarnings = FALSE, recursive = TRUE)

evidence_record <- list(
  timestamp = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC"),
  r_version = R.version.string,
  platform = R.version$platform,
  packages = list(
    lme4 = as.character(packageVersion("lme4")),
    ordinal = as.character(packageVersion("ordinal")),
    Matrix = as.character(packageVersion("Matrix"))
  ),
  benchmark_results = list(
    status = diag_res$status,
    converged = diag_res$converged,
    delta_po = if (is.na(diag_res$delta_po)) "NA" else diag_res$delta_po,
    reason = diag_res$reason,
    contrasts = lapply(diag_res$contrasts, function(x) if (is.na(x)) "NA" else x),
    cutpoints = lapply(diag_res$diagnostics, function(d) {
      list(
        cutpoint = d$cutpoint,
        threshold = d$threshold,
        status = d$overall_status,
        detail = d$detail,
        contrast = if (is.null(d$contrast) || is.na(d$contrast)) "NA" else d$contrast,
        opt_code = if (is.na(d$opt_code)) "NA" else d$opt_code,
        is_singular = if (is.na(d$is_singular)) "NA" else d$is_singular,
        singular_components = d$singular_components,
        max_raw_grad = if (is.na(d$max_raw_grad)) "NA" else d$max_raw_grad,
        min_hess_eigval = if (is.na(d$min_hess_eigval)) "NA" else d$min_hess_eigval,
        max_se = if (is.na(d$max_se)) "NA" else d$max_se
      )
    })
  ),
  sparse_stress_results = list(
    status = sparse_res$status,
    converged = sparse_res$converged,
    delta_po = if (is.na(sparse_res$delta_po)) "NA" else sparse_res$delta_po,
    reason = sparse_res$reason
  ),
  secondary_sensitivity_results = list(
    status = sens_res$status,
    converged = sens_res$converged,
    delta_po = if (is.na(sens_res$delta_po)) "NA" else sens_res$delta_po,
    contrasts = lapply(sens_res$contrasts, function(x) if (is.na(x)) "NA" else x)
  )
)

# Custom minimal JSON serializer
serialize_json <- function(obj) {
  if (is.null(obj)) return("null")
  if (is.logical(obj)) return(if (is.na(obj)) "null" else if (obj) "true" else "false")
  if (is.numeric(obj)) return(if (is.na(obj)) "null" else as.character(obj))
  if (is.character(obj)) return(paste0("\"", gsub("\"", "\\\\\"", obj), "\""))
  if (is.list(obj)) {
    if (is.null(names(obj))) {
      # array
      items <- vapply(obj, serialize_json, character(1))
      return(paste0("[", paste(items, collapse = ", "), "]"))
    } else {
      # object
      pairs <- vapply(names(obj), function(k) {
        paste0("\"", k, "\": ", serialize_json(obj[[k]]))
      }, character(1))
      return(paste0("{", paste(pairs, collapse = ", "), "}"))
    }
  }
  return("\"unknown\"")
}

json_str <- serialize_json(evidence_record)
writeLines(json_str, "eval/results/study3_r_diagnostic_execution.json")
cat("Structured evidence written to: eval/results/study3_r_diagnostic_execution.json\n")
cat("================================================================================\n")
cat("             MEDVOICE STUDY 3 R REPRODUCIBILITY RUN COMPLETED                   \n")
cat("================================================================================\n")
