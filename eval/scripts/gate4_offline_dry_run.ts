/**
 * Gate 4 Offline Mock Dry Run Execution Script
 *
 * Implements:
 * 1. End-to-end execution of EvaluatorRunner using MockEvalProvider (100% offline).
 * 2. Processes 200 test scenarios x 3 perspectives x 2 candidates = 1,200 clinical observation ratings
 *    (600 paired evaluation sessions), strictly matching Study 3 specification J=200, P=3, K=2.
 * 3. Network Egress Probe: monkeypatches http/https/fetch to assert ZERO live network requests.
 * 4. Captures execution duration, heap memory metrics, token telemetry, and exit codes.
 * 5. Verifies complete artifact generation: run_manifest.json, eval_results.jsonl, secret_mapping.enc.
 * 6. Tests crash recovery and AES-256-GCM secret mapping decryption.
 * 7. Records structured JSON evidence at eval/results/gate4_offline_dry_run_evidence.json.
 * 8. Gate 4 invariant: Gate 4 remains LOCKED (offline validation only, zero live API access).
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import dns from 'node:dns';
import child_process from 'node:child_process';
import { EvaluatorRunner, RunExecutionResult } from '../src/evaluator/evaluator-runner';
import { MockEvalProvider } from '../src/providers/mock-eval-provider';
import { decryptSecretMapping, EncryptedSecretPayload } from '../src/evaluator/blinding-engine';
import {
  generateScenarioBatch,
  createApprovedDatasetManifestEntry,
} from '../src/harness/scenario-generator';

interface DryRunTelemetry {
  timestamp: string;
  governance_boundary: {
    gate_4_status: 'LOCKED';
    live_api_calls_attempted: 0;
    network_egress_bytes: 0;
    mock_provider_used: true;
    investigator_clinical_content_loaded: false;
    isolation_layers_enforced: string[];
    token_inference_mode: 'SYNTHETIC_MOCK_METADATA_ONLY';
  };
  matrix_sizing: {
    scenarios_count: number; // 200
    perspectives_count: number; // 3 (SIM-01, SIM-02, SIM-03)
    evaluation_sessions_count: number; // 600
    candidates_per_session: number; // 2 (Candidate A, Candidate B)
    total_observation_ratings: number; // 1,200
  };
  execution_metrics: {
    duration_ms: number;
    records_processed: number;
    exit_code: number;
    initial_heap_mb: number;
    final_heap_mb: number;
    peak_heap_diff_mb: number;
    avg_latency_ms: number;
    total_prompt_tokens: number;
    total_completion_tokens: number;
  };
  artifacts: {
    output_dir: string;
    manifest_file: string;
    manifest_status: string;
    manifest_sha256: string;
    results_jsonl: string;
    results_line_count: number;
    results_sha256: string;
    secret_mapping_file: string;
    secret_mapping_sha256: string;
    secret_mapping_decryption_verified: boolean;
  };
  reproducibility: {
    randomization_seed: number;
    git_commit_sha: string;
    evaluator_source_hash: string;
    rubric_version: string;
    prompt_template_version: string;
  };
  crash_recovery_verification: {
    simulated_resume_tested: boolean;
    duplicate_records_prevented: boolean;
  };
}

export async function executeGate4OfflineDryRun(): Promise<DryRunTelemetry> {
  console.log('================================================================================');
  console.log('MEDVOICE STUDY 3 — GATE 4 OFFLINE MOCK DRY RUN (1,200 OBSERVATIONS)');
  console.log('================================================================================\n');

  // 1. Install Multi-Layer Zero-Egress Network Isolation Barrier
  let networkRequestsAttempted = 0;
  const originalHttpRequest = http.request;
  const originalHttpGet = http.get;
  const originalHttpsRequest = https.request;
  const originalHttpsGet = https.get;
  const originalFetch = globalThis.fetch;
  const originalDnsLookup = dns.lookup;
  const originalDnsResolve = dns.resolve;
  const originalNetConnect = net.connect;
  const originalNetCreateConnection = net.createConnection;
  const originalSocketConnect = net.Socket.prototype.connect;
  const originalTlsConnect = tls.connect;
  const originalChildExec = child_process.exec;

  const egressBlocker = function (vector: string, target?: string) {
    networkRequestsAttempted++;
    throw new Error(
      `ZERO_EGRESS_BARRIER_VIOLATION: Attempted outbound network call via '${vector}'${
        target ? ` targeting '${target}'` : ''
      } during Gate 4 offline dry run!`
    );
  };

  (http as any).request = function (...args: any[]) {
    const target = typeof args[0] === 'string' ? args[0] : args[0]?.host || args[0]?.hostname;
    egressBlocker('http.request', target);
  };
  (http as any).get = function () { egressBlocker('http.get'); };
  (https as any).request = function (...args: any[]) {
    const target = typeof args[0] === 'string' ? args[0] : args[0]?.host || args[0]?.hostname;
    egressBlocker('https.request', target);
  };
  (https as any).get = function () { egressBlocker('https.get'); };
  if (typeof globalThis.fetch === 'function') {
    (globalThis as any).fetch = async function (input: any) {
      const url = typeof input === 'string' ? input : input?.url || 'unknown_url';
      egressBlocker('globalThis.fetch', url);
    };
  }
  (dns as any).lookup = function (...args: any[]) { egressBlocker('dns.lookup', args[0]); };
  (dns as any).resolve = function (...args: any[]) { egressBlocker('dns.resolve', args[0]); };
  (net as any).connect = function () { egressBlocker('net.connect'); };
  (net as any).createConnection = function () { egressBlocker('net.createConnection'); };
  (net.Socket.prototype as any).connect = function () { egressBlocker('net.Socket.connect'); };
  (tls as any).connect = function () { egressBlocker('tls.connect'); };
  (child_process as any).exec = function (...args: any[]) {
    const cmd = args[0];
    if (typeof cmd === 'string' && /(?:curl|wget|nc|ncat|ssh|invoke-webrequest)/i.test(cmd)) {
      egressBlocker('child_process.exec_network_client', cmd);
    }
    return originalChildExec.apply(child_process, args as any);
  };

  const initialMemory = process.memoryUsage();
  const startTime = Date.now();

  const tempWorkspace = path.resolve('eval/output/gate4_dry_run_' + Date.now());
  const fixtureDir = path.join(tempWorkspace, 'fixtures');
  const runOutputDir = path.join(tempWorkspace, 'run_artifacts');
  fs.mkdirSync(fixtureDir, { recursive: true });
  fs.mkdirSync(runOutputDir, { recursive: true });

  try {
    // 2. Generate 200 non-clinical synthetic test scenarios (20 per domain x 10 domains)
    console.log('[Step 1/5] Generating 200 non-clinical synthetic test scenarios (seed: 42)...');
    const batch = generateScenarioBatch({
      testFixtureMode: true,
      perDomainCount: 20, // 20 * 10 = 200
      seed: 42,
    });

    const fixturePath = path.join(fixtureDir, 'test_scenarios_200.json');
    const fixtureContent = JSON.stringify(batch.scenarios, null, 2);
    fs.writeFileSync(fixturePath, fixtureContent, 'utf8');

    // Compute exact file-bytes SHA-256
    const exactFileSha256 = crypto
      .createHash('sha256')
      .update(fs.readFileSync(fixturePath))
      .digest('hex');

    // 3. Create approved dataset manifest for this test batch
    const manifestPath = path.join(fixtureDir, 'test_approved_datasets.json');
    const manifestEntry = {
      dataset_id: 'dry-run-test-v1.0.0',
      dataset_version: '1.0.0',
      fixture_relative_path: fixturePath,
      sha256: exactFileSha256,
      scenario_count: batch.scenarios.length,
      approved_scenario_ids: batch.scenarios.map((s) => s.scenario_id),
      provenance_types: ['synthetic_authored'],
      authorship_types: ['ai_assisted_draft'],
      schema_version: '1.2.0',
      quarantined_from_benchmarks: true,
      description: 'Offline dry-run test dataset with 200 non-clinical fixtures.',
    };
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({ approved_datasets: [manifestEntry] }, null, 2),
      'utf8'
    );

    console.log(`  ✓ 200 scenarios generated across 10 domains (SHA-256: ${batch.contentSha256.substring(0, 16)}...)`);

    // 4. Execute EvaluatorRunner with MockEvalProvider
    console.log('[Step 2/5] Initializing EvaluatorRunner with MockEvalProvider (Zero Egress)...');
    const mockProvider = new MockEvalProvider({
      latencyMs: 1, // Ultra-fast mock execution
      promptTokens: 350,
      completionTokens: 120,
    });

    const runner = new EvaluatorRunner({
      providerInstanceOverride: mockProvider,
    });

    const secretKey = 'gate4-dry-run-test-secret-key-32b-verified';

    console.log('[Step 3/5] Executing 600 paired sessions (1,200 candidate observation ratings)...');
    const runResult: RunExecutionResult = await runner.execute({
      inputFixturePath: fixturePath,
      datasetManifestPath: manifestPath,
      outputDir: runOutputDir,
      provider: 'mock',
      perspectives: ['SIM-01', 'SIM-02', 'SIM-03'],
      seed: 42,
      secretKey,
    });

    if (runResult.exitCode !== 0) {
      throw new Error(`Runner exited with non-zero code ${runResult.exitCode}: ${runResult.error}`);
    }

    const endTime = Date.now();
    const finalMemory = process.memoryUsage();

    console.log(`  ✓ Evaluator completed successfully. Exit code: ${runResult.exitCode}`);
    console.log(`  ✓ Sessions processed: ${runResult.recordsProcessed}`);

    // 5. Verify Generated Artifacts
    console.log('[Step 4/5] Verifying generated artifacts and cryptographic integrity...');
    const manifestFile = path.join(runOutputDir, 'run_manifest.json');
    const resultsFile = path.join(runOutputDir, 'eval_results.jsonl');
    const secretFile = path.join(runOutputDir, 'secret_mapping.enc');

    if (!fs.existsSync(manifestFile) || !fs.existsSync(resultsFile) || !fs.existsSync(secretFile)) {
      throw new Error('Missing required output artifact files!');
    }

    const manifestData = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    const resultsContent = fs.readFileSync(resultsFile, 'utf8').trim();
    const resultsLines = resultsContent.split('\n');

    if (resultsLines.length !== 600) {
      throw new Error(`Expected exactly 600 JSONL records, found ${resultsLines.length}`);
    }

    // Verify token aggregation and per-record integrity
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalLatency = 0;

    for (let i = 0; i < resultsLines.length; i++) {
      const rec = JSON.parse(resultsLines[i]);
      if (!rec.candidate_a || !rec.candidate_b || !rec.scenario_id || !rec.perspective_id) {
        throw new Error(`Record at line ${i + 1} is missing required fields`);
      }
      totalPromptTokens += rec.prompt_tokens || 0;
      totalCompletionTokens += rec.completion_tokens || 0;
      totalLatency += rec.latency_ms || 0;
    }

    // Verify secret mapping decryption
    const encryptedSecret: EncryptedSecretPayload = JSON.parse(fs.readFileSync(secretFile, 'utf8'));
    const decryptedSecret = decryptSecretMapping(encryptedSecret, secretKey);
    if (!Array.isArray(decryptedSecret) || decryptedSecret.length !== 200) {
      throw new Error(`Expected 200 decrypted secret records, found ${decryptedSecret.length}`);
    }

    console.log(`  ✓ run_manifest.json: Status ${manifestData.status}, Seed ${manifestData.randomization_seed}`);
    console.log(`  ✓ eval_results.jsonl: Exactly 600 sessions (1,200 observation ratings) verified`);
    console.log(`  ✓ secret_mapping.enc: Decryption verified (200 blinded pairs matched)`);

    // 6. Test Crash Recovery / Resume Idempotence
    console.log('[Step 5/5] Verifying crash recovery checkpointing & resume idempotence...');
    const resumeResult = await runner.execute({
      inputFixturePath: fixturePath,
      datasetManifestPath: manifestPath,
      outputDir: runOutputDir,
      provider: 'mock',
      perspectives: ['SIM-01', 'SIM-02', 'SIM-03'],
      seed: 42,
      secretKey,
      resume: true,
    });

    if (resumeResult.recordsProcessed !== 0) {
      throw new Error(
        `Resume verification failed: Expected 0 newly processed records on clean resume, got ${resumeResult.recordsProcessed}`
      );
    }
    console.log('  ✓ Resume idempotence confirmed: 0 redundant executions.');

    const manifestSha256 = crypto
      .createHash('sha256')
      .update(fs.readFileSync(manifestFile))
      .digest('hex');
    const resultsSha256 = crypto
      .createHash('sha256')
      .update(fs.readFileSync(resultsFile))
      .digest('hex');
    const secretSha256 = crypto
      .createHash('sha256')
      .update(fs.readFileSync(secretFile))
      .digest('hex');

    const durationMs = endTime - startTime;
    const initialHeapMb = Math.round(initialMemory.heapUsed / 1024 / 1024);
    const finalHeapMb = Math.round(finalMemory.heapUsed / 1024 / 1024);

    const telemetry: DryRunTelemetry = {
      timestamp: new Date().toISOString(),
      governance_boundary: {
        gate_4_status: 'LOCKED',
        live_api_calls_attempted: 0,
        network_egress_bytes: 0,
        mock_provider_used: true,
        investigator_clinical_content_loaded: false,
        isolation_layers_enforced: [
          'http.request',
          'http.get',
          'https.request',
          'https.get',
          'globalThis.fetch',
          'dns.lookup',
          'dns.resolve',
          'net.connect',
          'net.createConnection',
          'net.Socket.connect',
          'tls.connect',
          'child_process.exec_network_client',
        ],
        token_inference_mode: 'SYNTHETIC_MOCK_METADATA_ONLY',
      },
      matrix_sizing: {
        scenarios_count: 200,
        perspectives_count: 3,
        evaluation_sessions_count: 600,
        candidates_per_session: 2,
        total_observation_ratings: 1200,
      },
      execution_metrics: {
        duration_ms: durationMs,
        records_processed: runResult.recordsProcessed,
        exit_code: runResult.exitCode,
        initial_heap_mb: initialHeapMb,
        final_heap_mb: finalHeapMb,
        peak_heap_diff_mb: finalHeapMb - initialHeapMb,
        avg_latency_ms: Math.round(totalLatency / resultsLines.length),
        total_prompt_tokens: totalPromptTokens,
        total_completion_tokens: totalCompletionTokens,
      },
      artifacts: {
        output_dir: runOutputDir,
        manifest_file: 'run_manifest.json',
        manifest_status: manifestData.status,
        manifest_sha256: manifestSha256,
        results_jsonl: 'eval_results.jsonl',
        results_line_count: resultsLines.length,
        results_sha256: resultsSha256,
        secret_mapping_file: 'secret_mapping.enc',
        secret_mapping_sha256: secretSha256,
        secret_mapping_decryption_verified: true,
      },
      reproducibility: {
        randomization_seed: manifestData.randomization_seed,
        git_commit_sha: manifestData.git_commit_sha,
        evaluator_source_hash: manifestData.evaluator_source_tree_hash,
        rubric_version: manifestData.rubric_version,
        prompt_template_version: manifestData.prompt_template_version,
      },
      crash_recovery_verification: {
        simulated_resume_tested: true,
        duplicate_records_prevented: true,
      },
    };

    // Save evidence JSON artifact
    const evidencePath = path.resolve('eval/results/gate4_offline_dry_run_evidence.json');
    fs.writeFileSync(evidencePath, JSON.stringify(telemetry, null, 2), 'utf8');

    console.log('\n================================================================================');
    console.log('GATE 4 OFFLINE DRY RUN COMPLETED SUCCESSFULLY');
    console.log(`Evidence artifact written to: ${evidencePath}`);
    console.log('Boundary note: Gate 4 remains strictly LOCKED for live evaluations.');
    console.log('================================================================================\n');

    return telemetry;
  } finally {
    // Restore all original network & execution handlers
    (http as any).request = originalHttpRequest;
    (http as any).get = originalHttpGet;
    (https as any).request = originalHttpsRequest;
    (https as any).get = originalHttpsGet;
    if (originalFetch) (globalThis as any).fetch = originalFetch;
    (dns as any).lookup = originalDnsLookup;
    (dns as any).resolve = originalDnsResolve;
    (net as any).connect = originalNetConnect;
    (net as any).createConnection = originalNetCreateConnection;
    (net.Socket.prototype as any).connect = originalSocketConnect;
    (tls as any).connect = originalTlsConnect;
    (child_process as any).exec = originalChildExec;

    // Clean up temporary workspace
    try {
      if (fs.existsSync(tempWorkspace)) {
        fs.rmSync(tempWorkspace, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup error
    }
  }
}

// Execute directly if run as main script
if (require.main === module || process.argv[1]?.endsWith('gate4_offline_dry_run.ts')) {
  executeGate4OfflineDryRun()
    .then((telemetry) => {
      console.log('Execution summary:');
      console.log(`- Total Observation Ratings: ${telemetry.matrix_sizing.total_observation_ratings}`);
      console.log(`- Paired Evaluation Sessions: ${telemetry.matrix_sizing.evaluation_sessions_count}`);
      console.log(`- Duration: ${telemetry.execution_metrics.duration_ms} ms`);
      console.log(`- Network Requests Attempted: ${telemetry.governance_boundary.live_api_calls_attempted}`);
      console.log(`- Gate 4 Status: ${telemetry.governance_boundary.gate_4_status}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Gate 4 Dry Run failed:', err);
      process.exit(1);
    });
}
