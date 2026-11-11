/**
 * End-to-end & Security Integrity Tests for Evaluator Runner:
 * - Data boundary validation (Blacklist & SHA-256 Allowlist)
 * - Run manifest immutability & full-parameter resume validation
 * - Crash recovery (safe unterminated fragment trimming, mid-file corruption abort, duplicate record abort)
 * - Rate limit exit code and metadata logging
 * - Full offline execution loop with MockEvalProvider
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  EvaluatorRunner,
  RunManifest,
  RunExecutionOptions,
} from '../../eval/src/evaluator/evaluator-runner';
import { MockEvalProvider } from '../../eval/src/providers/mock-eval-provider';

describe('Task 5: Orchestrator CLI, Run Manifest & Crash-Safe Resumption', () => {
  const sampleSyntheticScenariosPath = path.resolve('eval/data/pilot/pilot-scenarios.json');

  it('1. Strict data boundary: rejects primary database or patient consultation paths', async () => {
    const runner = new EvaluatorRunner();

    await assert.rejects(
      async () => {
        await runner.execute({
          inputFixturePath: 'lib/db/neon-client.ts',
          outputDir: os.tmpdir(),
          provider: 'mock',
          seed: 42,
        });
      },
      (err: any) => {
        assert(err.message.includes('STRICT_DATA_BOUNDARY_VIOLATION'));
        return true;
      }
    );
  });

  it('2. Synthetic data allowlist: validates TEST-SMOKE-001 and rejects unapproved fixture files', async () => {
    const runner = new EvaluatorRunner();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-allowlist-test-'));

    try {
      // 1. Verify TEST-SMOKE-001 passes allowlist validation and executes cleanly
      const smokeFixturePath = path.resolve('eval/data/smoke/smoke-scenario.json');
      const smokeResult = await runner.execute({
        inputFixturePath: smokeFixturePath,
        outputDir: path.join(tempDir, 'smoke_out'),
        provider: 'mock',
        seed: 42,
      });
      assert.strictEqual(smokeResult.exitCode, 0);
      assert.strictEqual(smokeResult.recordsProcessed, 3); // 1 scenario * 3 perspectives

      // 2. Create arbitrary unapproved fixture file and verify rejection
      const unapprovedFixture = path.join(tempDir, 'arbitrary-fixture.json');
      fs.writeFileSync(
        unapprovedFixture,
        JSON.stringify([{ scenario_id: 'UNAPPROVED-001', domain: 'cardiovascular' }]),
        'utf8'
      );

      await assert.rejects(
        async () => {
          await runner.execute({
            inputFixturePath: unapprovedFixture,
            outputDir: tempDir,
            provider: 'mock',
            seed: 42,
          });
        },
        (err: any) => {
          assert(err.message.includes('UNAPPROVED_DATASET_VIOLATION'));
          return true;
        }
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('3. Run manifest records complete reproducibility hashes and rejects mismatched resume', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-manifest-test-'));

    try {
      const runner = new EvaluatorRunner();
      // First run with mock provider, model mock-v1
      await runner.execute({
        inputFixturePath: sampleSyntheticScenariosPath,
        outputDir: tempDir,
        provider: 'mock',
        model: 'mock-model-v1',
        perspectives: ['SIM-01'],
        limit: 1,
        seed: 42,
      });

      const manifestPath = path.join(tempDir, 'run_manifest.json');
      assert(fs.existsSync(manifestPath));
      const manifest: RunManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      assert.strictEqual(manifest.provider, 'mock');
      assert.strictEqual(manifest.model_id, 'mock-model-v1');
      assert.strictEqual(manifest.randomization_seed, 42);
      assert(manifest.dataset_content_hash);
      assert(manifest.dataset_manifest_hash);
      assert(manifest.rubric_content_hash);
      assert.strictEqual(manifest.rubric_version, '2.2.0');
      assert.strictEqual(manifest.prompt_template_version, '2.2.0');
      assert(manifest.prompt_template_hash);
      assert(manifest.evaluator_source_tree_hash);
      assert(manifest.dependency_lockfile_hash);
      assert(manifest.git_commit_sha);

      // Attempt to resume with different model should fail
      await assert.rejects(
        async () => {
          await runner.execute({
            inputFixturePath: sampleSyntheticScenariosPath,
            outputDir: tempDir,
            provider: 'mock',
            model: 'incompatible-model-v2', // Mismatch!
            perspectives: ['SIM-01'],
            resume: true,
            seed: 42,
          });
        },
        (err: any) => {
          assert(err.message.includes('RUN_MANIFEST_MISMATCH'));
          assert(err.message.includes('model_id'));
          return true;
        }
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('4. Crash recovery: incomplete unterminated trailing fragment at EOF is recovered safely and backed up', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-trailing-test-'));
    try {
      const runner = new EvaluatorRunner();
      const testJsonl = path.join(tempDir, 'eval_results.jsonl');

      // 2 valid complete lines with terminating newline, plus unterminated trailing fragment (no trailing newline)
      const validLine1 = JSON.stringify({ scenario_id: 'PILOT-CARD-001', perspective_id: 'SIM-01' });
      const validLine2 = JSON.stringify({ scenario_id: 'PILOT-CARD-001', perspective_id: 'SIM-02' });
      const trailingFragment = '{"scenario_id": "PILOT-CARD-001", "perspecti'; // interrupted write

      fs.writeFileSync(testJsonl, validLine1 + '\n' + validLine2 + '\n' + trailingFragment, 'utf8');

      const recovery = runner.recoverAndLoadCheckpoints(testJsonl);
      assert.strictEqual(recovery.validLinesCount, 2);
      assert.strictEqual(recovery.completedKeys.size, 2);

      // Verify backup fragment was created
      assert(fs.existsSync(testJsonl + '.corrupted_fragment.bak'));
      const backedUpFragment = fs.readFileSync(testJsonl + '.corrupted_fragment.bak', 'utf8');
      assert.strictEqual(backedUpFragment, trailingFragment);

      // Verify file now contains only valid lines
      const cleaned = fs.readFileSync(testJsonl, 'utf8').trim().split('\n');
      assert.strictEqual(cleaned.length, 2);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('5. Crash recovery: corrupted record in the middle of file throws CORRUPTED_CHECKPOINT_INTEGRITY and preserves original file', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-midfile-test-'));
    try {
      const runner = new EvaluatorRunner();
      const testJsonl = path.join(tempDir, 'eval_results.jsonl');

      const line1 = JSON.stringify({ scenario_id: 'PILOT-CARD-001', perspective_id: 'SIM-01' });
      const line2Corrupted = '{"scenario_id": "CORRUPTED_MID_RECORD"'; // mid-file malformed
      const line3 = JSON.stringify({ scenario_id: 'PILOT-CARD-001', perspective_id: 'SIM-02' });

      fs.writeFileSync(testJsonl, line1 + '\n' + line2Corrupted + '\n' + line3 + '\n', 'utf8');

      assert.throws(
        () => {
          runner.recoverAndLoadCheckpoints(testJsonl);
        },
        (err: any) => {
          assert(err.message.includes('CORRUPTED_CHECKPOINT_INTEGRITY'));
          assert(err.message.includes('Mid-file or newline-terminated malformed records cannot be discarded'));
          return true;
        }
      );

      // Verify forensic backup was created
      assert(fs.existsSync(testJsonl + '.corrupted.bak'));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('6. Crash recovery: newline-terminated malformed final record throws CORRUPTED_CHECKPOINT_INTEGRITY and preserves original file', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-term-malformed-test-'));
    try {
      const runner = new EvaluatorRunner();
      const testJsonl = path.join(tempDir, 'eval_results.jsonl');

      const line1 = JSON.stringify({ scenario_id: 'PILOT-CARD-001', perspective_id: 'SIM-01' });
      const line2MalformedTerminated = '{"invalid_json": true\n'; // newline terminated, but malformed!

      fs.writeFileSync(testJsonl, line1 + '\n' + line2MalformedTerminated, 'utf8');

      assert.throws(
        () => {
          runner.recoverAndLoadCheckpoints(testJsonl);
        },
        (err: any) => {
          assert(err.message.includes('CORRUPTED_CHECKPOINT_INTEGRITY'));
          return true;
        }
      );

      // Verify forensic backup was created
      assert(fs.existsSync(testJsonl + '.corrupted.bak'));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('7. Crash recovery: duplicate scenario-perspective evaluation throws CORRUPTED_CHECKPOINT_INTEGRITY', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-dup-test-'));
    try {
      const runner = new EvaluatorRunner();
      const testJsonl = path.join(tempDir, 'eval_results.jsonl');

      const line1 = JSON.stringify({ scenario_id: 'PILOT-CARD-001', perspective_id: 'SIM-01' });
      const line2Duplicate = JSON.stringify({ scenario_id: 'PILOT-CARD-001', perspective_id: 'SIM-01' }); // Duplicate!

      fs.writeFileSync(testJsonl, line1 + '\n' + line2Duplicate + '\n', 'utf8');

      assert.throws(
        () => {
          runner.recoverAndLoadCheckpoints(testJsonl);
        },
        (err: any) => {
          assert(err.message.includes('CORRUPTED_CHECKPOINT_INTEGRITY'));
          assert(err.message.includes('Duplicate evaluation record'));
          return true;
        }
      );

      assert(fs.existsSync(testJsonl + '.corrupted.bak'));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('8. Crash recovery: clean resume executes only missing evaluations without duplicate work', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-resume-flow-test-'));
    try {
      const runner = new EvaluatorRunner();
      // First run for 2 scenarios with SIM-01
      await runner.execute({
        inputFixturePath: sampleSyntheticScenariosPath,
        outputDir: tempDir,
        provider: 'mock',
        model: 'mock-model-v1',
        perspectives: ['SIM-01'],
        limit: 2,
        seed: 42,
      });

      const outputJsonlPath = path.join(tempDir, 'eval_results.jsonl');
      const linesBefore = fs.readFileSync(outputJsonlPath, 'utf8').trim().split('\n');
      assert.strictEqual(linesBefore.length, 2);

      // Append an unterminated write fragment at EOF (simulating process death mid-write)
      fs.appendFileSync(outputJsonlPath, '{"scenario_id": "PILOT-RESP-003", "perspecti');

      // Resume run for 3 scenarios
      const resumeResult = await runner.execute({
        inputFixturePath: sampleSyntheticScenariosPath,
        outputDir: tempDir,
        provider: 'mock',
        model: 'mock-model-v1',
        perspectives: ['SIM-01'],
        limit: 3,
        resume: true,
        seed: 42,
      });

      assert.strictEqual(resumeResult.exitCode, 0);
      assert.strictEqual(resumeResult.recordsProcessed, 1); // Only the 3rd scenario needed

      const linesAfter = fs.readFileSync(outputJsonlPath, 'utf8').trim().split('\n');
      assert.strictEqual(linesAfter.length, 3);
      for (const line of linesAfter) {
        assert.doesNotThrow(() => JSON.parse(line));
      }
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('9. Rate limit exhaustion exits with code 2 (not 429) and records failure metadata', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-ratelimit-test-'));

    try {
      const failingMockProvider = new MockEvalProvider();
      failingMockProvider.complete = async () => {
        const error: any = new Error('RATE_LIMIT_EXHAUSTED: HTTP 429');
        error.code = 'RATE_LIMIT_EXHAUSTED';
        error.statusCode = 429;
        throw error;
      };

      const runner = new EvaluatorRunner({
        providerInstanceOverride: failingMockProvider,
      });

      const result = await runner.execute({
        inputFixturePath: sampleSyntheticScenariosPath,
        outputDir: tempDir,
        provider: 'mock',
        perspectives: ['SIM-01'],
        limit: 1,
        seed: 42,
      });

      assert.strictEqual(result.exitCode, 2); // Standard nonzero code 2 for rate limits (never 429!)
      assert.strictEqual(result.status, 'RATE_LIMIT_EXHAUSTED');
      assert.strictEqual(result.httpStatus, 429);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('10. Full offline execution generates valid JSONL with git commit SHA and encrypted secret mapping', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-full-test-'));

    try {
      const runner = new EvaluatorRunner();
      const result = await runner.execute({
        inputFixturePath: sampleSyntheticScenariosPath,
        outputDir: tempDir,
        provider: 'mock',
        model: 'mock-test-model',
        perspectives: ['SIM-01', 'SIM-02', 'SIM-03'],
        limit: 2,
        secretKey: 'unit-test-secret-key-12345',
        seed: 42,
      });

      assert.strictEqual(result.exitCode, 0);
      assert.strictEqual(result.recordsProcessed, 6); // 2 scenarios * 3 perspectives

      const resultsPath = path.join(tempDir, 'eval_results.jsonl');
      const lines = fs.readFileSync(resultsPath, 'utf8').trim().split('\n');
      assert.strictEqual(lines.length, 6);

      const firstRecord = JSON.parse(lines[0]);
      assert(firstRecord.git_commit_sha);
      assert(firstRecord.prompt_sha256);
      assert.strictEqual(firstRecord.provider, 'mock');
      assert(firstRecord.candidate_a.raw_scores);
      assert(firstRecord.candidate_a.adjusted_scores);

      const secretPath = path.join(tempDir, 'secret_mapping.enc');
      assert(fs.existsSync(secretPath));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('11. Compromised key rejection: Rejects exposed smoke-test key', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-compromised-key-test-'));

    try {
      const runner = new EvaluatorRunner();
      await assert.rejects(
        async () => {
          await runner.execute({
            inputFixturePath: sampleSyntheticScenariosPath,
            outputDir: tempDir,
            provider: 'mock',
            secretKey: 'smoke-test-secret-key-42',
          });
        },
        {
          message: /COMPROMISED_KEY_REJECTED/,
        }
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('12. Secure key required: Rejects live research run when EVAL_SECRET_KEY is absent', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-no-key-test-'));
    const prevKey = process.env.EVAL_SECRET_KEY;
    delete process.env.EVAL_SECRET_KEY;

    try {
      const runner = new EvaluatorRunner();
      await assert.rejects(
        async () => {
          await runner.execute({
            inputFixturePath: sampleSyntheticScenariosPath,
            outputDir: tempDir,
            provider: 'groq',
            // no secretKey provided
          });
        },
        {
          message: /SECURE_KEY_REQUIRED/,
        }
      );
    } finally {
      if (prevKey) {
        process.env.EVAL_SECRET_KEY = prevKey;
      }
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
