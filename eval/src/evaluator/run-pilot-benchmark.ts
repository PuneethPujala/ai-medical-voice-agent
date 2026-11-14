/**
 * Live Pilot Benchmark Runner
 * Evaluates 12 Pilot Scenarios on Groq Cloud (qwen/qwen3.8-27b)
 */

import path from 'node:path';
import fs from 'node:fs';
import { EvaluatorRunner } from './evaluator-runner';

async function main() {
  console.log('================================================================');
  console.log('MEDVOICE IN-SILICO EVALUATION RUNNER: LIVE PILOT BENCHMARK');
  console.log('Target: 12 Scenarios (synthetic-pilot-v1.2.0)');
  console.log('Provider: Groq Cloud');
  console.log('Model: qwen/qwen3.8-27b');
  console.log('Perspectives: SIM-01, SIM-02, SIM-03 (36 evaluations total)');
  console.log('================================================================\n');

  const runner = new EvaluatorRunner();
  const inputFixturePath = path.resolve('eval/data/pilot/pilot-scenarios.json');
  const outputDir = path.resolve('eval/output/pilot_benchmark_run');

  const result = await runner.execute({
    inputFixturePath,
    outputDir,
    provider: 'groq',
    model: 'qwen/qwen3.8-27b',
    perspectives: ['SIM-01', 'SIM-02', 'SIM-03'],
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

  process.exit(result.exitCode);
}

main().catch((err) => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
