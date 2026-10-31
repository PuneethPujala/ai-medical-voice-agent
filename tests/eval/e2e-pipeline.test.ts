import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

async function main() {
  console.log("================================================================================");
  console.log("MEDVOICE CLINICAL EVALUATION: END-TO-END PIPELINE SMOKE TEST");
  console.log("================================================================================\n");

  const outDir = path.join(process.cwd(), "eval", ".tmp", "e2e-smoke-output");
  if (fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
  fs.mkdirSync(outDir, { recursive: true });

  const pipelineScript = path.join(process.cwd(), "eval", "run-pipeline.py");
  assert.strictEqual(
    fs.existsSync(pipelineScript),
    true,
    "eval/run-pipeline.py orchestrator must exist"
  );

  console.log("[Execution: Running Top-Level Orchestration Pipeline in Smoke Test Mode]");
  const cmd = `python eval/run-pipeline.py --phase all --smoke-test --use-mock-reviews --output-dir "${outDir}"`;
  
  const stdout = execSync(cmd, {
    cwd: process.cwd(),
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  console.log(stdout);

  // Suite 1: Operational Telemetry Artifacts
  console.log("[Suite 1: Operational Telemetry Verification]");
  const telemetryPath = path.join(outDir, "operational_telemetry.json");
  assert.strictEqual(fs.existsSync(telemetryPath), true, "operational_telemetry.json must be produced");
  const telemetry = JSON.parse(fs.readFileSync(telemetryPath, "utf-8"));
  assert.strictEqual(telemetry.success, true, "Telemetry status must be success");
  assert.strictEqual(typeof telemetry.total_runtime_seconds, "number", "Runtime seconds must be recorded");
  assert.strictEqual(typeof telemetry.p50_latency_ms, "number", "P50 latency must be tracked");
  assert.strictEqual(typeof telemetry.p95_latency_ms, "number", "P95 latency must be tracked");
  assert.strictEqual(telemetry.failure_rate, 0.0, "Smoke test must have 0 failure rate");
  console.log("  ✓ PASS: Operational telemetry accurately recorded with latency and success metrics");

  // Suite 2: LaTeX Tables Deliverables
  console.log("\n[Suite 2: Publication LaTeX Tables Verification]");
  const tablesDir = path.join(outDir, "tables");
  assert.strictEqual(fs.existsSync(tablesDir), true, "tables directory must exist");
  const expectedTables = [
    "table1_main_results.tex",
    "table2_domain_slices.tex",
    "table3_safety_challenge.tex",
    "table4_regression.tex",
    "table5_human_eval.tex",
  ];
  for (const t of expectedTables) {
    const tablePath = path.join(tablesDir, t);
    assert.strictEqual(fs.existsSync(tablePath), true, `Table ${t} must exist`);
    const content = fs.readFileSync(tablePath, "utf-8");
    assert.strictEqual(content.includes("\\begin{table}"), true, `${t} must contain valid LaTeX table`);
    assert.strictEqual(content.includes("\\bottomrule"), true, `${t} must use booktabs formatting`);
  }
  console.log("  ✓ PASS: All 5 publication LaTeX tables generated with valid syntax");

  // Suite 3: Publication Figures Deliverables
  console.log("\n[Suite 3: Publication Figures Verification]");
  const figuresDir = path.join(outDir, "figures");
  assert.strictEqual(fs.existsSync(figuresDir), true, "figures directory must exist");
  const expectedFigures = [
    "figure1_kde_overlay.png",
    "figure2_human_correlation.png",
    "figure3_domain_boxplots.png",
    "figure4_pca_projection.png",
  ];
  for (const f of expectedFigures) {
    const figPath = path.join(figuresDir, f);
    assert.strictEqual(fs.existsSync(figPath), true, `Figure ${f} must exist`);
    const stats = fs.statSync(figPath);
    assert.strictEqual(stats.size > 1000, true, `${f} must be a non-trivial image file`);
  }
  console.log("  ✓ PASS: All 4 publication figures generated successfully");

  // Suite 4: Intermediate Manifests & Blinding Outputs
  console.log("\n[Suite 4: Intermediate Manifests & Clinical Review Exports]");
  const blindSamplePath = path.join(outDir, "blind_sample.jsonl");
  const adjudicatedPath = path.join(outDir, "adjudicated_reviews.json");
  assert.strictEqual(fs.existsSync(blindSamplePath), true, "blind_sample.jsonl must exist");
  assert.strictEqual(fs.existsSync(adjudicatedPath), true, "adjudicated_reviews.json must exist");
  console.log("  ✓ PASS: Blinded clinical review sample and adjudicated results produced");

  // Cleanup
  try {
    fs.rmSync(outDir, { recursive: true, force: true });
  } catch {}

  console.log("\n================================================================================");
  console.log("ALL E2E PIPELINE SMOKE TESTS COMPLETED SUCCESSFULLY");
  console.log("================================================================================");
}

main().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
