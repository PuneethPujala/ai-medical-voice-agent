import fs from 'node:fs';
import path from 'node:path';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

import { unblindEvaluationRecords, CLMM_SCORE_DIMENSIONS } from './unblinding-bridge';

const jsonlPath = path.resolve('eval/output/pilot_benchmark_run/eval_results.jsonl');
const secretPath = path.resolve('eval/output/pilot_benchmark_run/secret_mapping.enc');
const secretKey = process.env.EVAL_SECRET_KEY;

if (!secretKey) {
  console.error('Missing EVAL_SECRET_KEY');
  process.exit(1);
}

const evalRecords = fs.readFileSync(jsonlPath, 'utf8')
  .trim()
  .split('\n')
  .map(l => JSON.parse(l));

const encryptedSecret = JSON.parse(fs.readFileSync(secretPath, 'utf8'));

const unblinded = unblindEvaluationRecords(evalRecords, encryptedSecret, secretKey);
console.log('Unblinded records total:', unblinded.length);

const medvoice = unblinded.filter(r => r.system === 'medvoice');
const comparator = unblinded.filter(r => r.system === 'comparator');

console.log('MedVoice observations:', medvoice.length);
console.log('Comparator observations:', comparator.length);

function mean(arr: number[]) {
  return (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2);
}

function std(arr: number[]) {
  const m = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((a, b) => a + Math.pow(b - m, 2), 0) / arr.length;
  return Math.sqrt(variance).toFixed(2);
}

console.log('\n========================================================================');
console.log('      MEDVOICE STUDY 3 PILOT BENCHMARK: LIVE EMPIRICAL RESULTS          ');
console.log('========================================================================');
console.log('Dimension'.padEnd(25) + 'MedVoice (Mean ± SD)'.padEnd(25) + 'Comparator (Mean ± SD)');
console.log('------------------------------------------------------------------------');

for (const dim of CLMM_SCORE_DIMENSIONS) {
  const mvScores = medvoice.map(r => r.adjusted_scores[dim]);
  const compScores = comparator.map(r => r.adjusted_scores[dim]);
  const mvStr = `${mean(mvScores)} ± ${std(mvScores)}`;
  const compStr = `${mean(compScores)} ± ${std(compScores)}`;
  console.log(dim.padEnd(25) + mvStr.padEnd(25) + compStr);
}

console.log('========================================================================\n');

// Per-perspective breakdown
console.log('--- BREAKDOWN BY EVALUATOR PERSPECTIVE ---');
for (const p of ['SIM-01', 'SIM-02', 'SIM-03']) {
  const pMv = medvoice.filter(r => r.perspective_id === p);
  const pComp = comparator.filter(r => r.perspective_id === p);
  console.log(`\n[${p}]`);
  for (const dim of ['correctness', 'completeness', 'clarity']) {
    const mvMean = mean(pMv.map(r => (r.adjusted_scores as any)[dim]));
    const compMean = mean(pComp.map(r => (r.adjusted_scores as any)[dim]));
    console.log(`  ${dim.padEnd(16)} MedVoice: ${mvMean} | Comparator: ${compMean}`);
  }
}
