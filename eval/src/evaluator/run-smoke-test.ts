/**
 * Dedicated Live Synthetic Smoke Test Runner (Single Execution)
 * Target: TEST-SMOKE-001 on Groq Cloud (qwen/qwen3.8-27b)
 */

import path from 'node:path';
import fs from 'node:fs';
import { EvaluatorRunner } from './evaluator-runner';

async function main() {
  console.log('================================================================');
  console.log('MEDVOICE IN-SILICO EVALUATION RUNNER: LIVE SYNTHETIC SMOKE TEST');
  console.log('Target Scenario: TEST-SMOKE-001 (1 scenario)');
  console.log('Provider: Groq Cloud');
  console.log('Model: qwen/qwen3.8-27b');
  console.log('Perspectives: SIM-01, SIM-02, SIM-03 (3 calls total)');
  console.log('================================================================\n');

  const runner = new EvaluatorRunner();
  const inputFixturePath = path.resolve('eval/data/smoke/smoke-scenario.json');
  const outputDir = path.resolve('eval/output/smoke_test_run');

  // Clean output directory for a fresh run
  if (fs.existsSync(outputDir)) {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }

  const result = await runner.execute({
    inputFixturePath,
    outputDir,
    provider: 'groq',
    model: 'qwen/qwen3.8-27b',
    perspectives: ['SIM-01', 'SIM-02', 'SIM-03'],
    limit: 1,
    seed: 42,
    secretKey: process.env.EVAL_SECRET_KEY,
  });

  console.log('\n--- EXECUTION SUMMARY ---');
  console.log('Run ID:', result.runId);
  console.log('Status:', result.status);
  console.log('Exit Code:', result.exitCode);
  console.log('Records Processed:', result.recordsProcessed);
  console.log('Manifest Path:', result.manifestPath);
  console.log('Results JSONL Path:', result.outputJsonlPath);

  if (result.error) {
    console.error('Execution Error:', result.error);
    process.exit(result.exitCode);
  }

  // Read and print details of the generated records
  if (fs.existsSync(result.outputJsonlPath)) {
    const lines = fs.readFileSync(result.outputJsonlPath, 'utf8').trim().split('\n');
    console.log(`\n--- RETURNED EVALUATION RECORDS (${lines.length}) ---`);
    for (let i = 0; i < lines.length; i++) {
      const record = JSON.parse(lines[i]);
      console.log(`\n[Record ${i + 1}/${lines.length}] Perspective: ${record.perspective_id}`);
      console.log(`  Model Returned: ${record.model_returned}`);
      console.log(`  Response ID: ${record.response_id}`);
      console.log(`  System Fingerprint: ${record.system_fingerprint}`);
      console.log(`  Prompt SHA-256: ${record.prompt_sha256}`);
      console.log(`  Latency: ${record.latency_ms} ms`);
      console.log(`  Tokens: ${record.prompt_tokens} in / ${record.completion_tokens} out (${record.total_tokens} total)`);
      console.log(`  Candidate A (adjusted correctness): ${record.candidate_a?.adjusted_scores?.correctness}`);
      console.log(`  Candidate B (adjusted correctness): ${record.candidate_b?.adjusted_scores?.correctness}`);
    }
  }

  process.exit(result.exitCode);
}

main().catch((err) => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
