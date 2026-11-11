/**
 * MedVoice In-Silico Evaluator Runner (Study 3 Orchestrator)
 *
 * Implements:
 * 1. Strict Data Boundary (synthetic benchmark fixtures only, zero database/patient access).
 * 2. Run Manifest enforcement (pins provider, model, prompt hash, rubric version, seed).
 * 3. Atomic crash recovery (validates existing JSONL lines, safely purges corrupted trailing lines).
 * 4. Pinned model execution across Groq, NVIDIA, and Mock providers.
 * 5. Conventional exit codes (exit code 2 on rate limit exhaustion, never 429).
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

import { EvaluatorProvider } from '../providers/types';
import { GroqEvalProvider } from '../providers/groq-eval-provider';
import { NvidiaEvalProvider } from '../providers/nvidia-eval-provider';
import { MockEvalProvider } from '../providers/mock-eval-provider';
import {
  stratifiedAllocateBatch,
  encryptSecretMapping,
  generateCryptographicSeed,
} from './blinding-engine';
import {
  buildEvaluationPrompt,
  PerspectiveId,
  computePromptTemplateHash,
  PROMPT_TEMPLATE_VERSION,
} from './prompt-builder';
import { parseEvaluationResponse } from './response-parser';
import { ClinicalScenario } from '../schema/scenario-schema';

export interface RunManifest {
  run_id: string;
  provider: 'groq' | 'nvidia' | 'mock';
  model_id: string;
  dataset_id: string;
  dataset_content_hash: string;
  dataset_manifest_hash: string;
  rubric_version: string;
  rubric_content_hash: string;
  protocol_version: string;
  prompt_template_version: string;
  prompt_template_hash: string;
  evaluator_source_tree_hash: string;
  dependency_lockfile_hash: string;
  randomization_seed: number;
  started_at: string;
  completed_at?: string;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'RATE_LIMIT_EXHAUSTED' | 'FAILED';
  http_status?: number;
  git_commit_sha: string;
}

/**
 * Computes a deterministic composite SHA-256 hash over all evaluator source code
 * (.ts files under eval/src/evaluator and eval/src/providers).
 */
export function computeEvaluatorSourceTreeHash(): string {
  const rootDir = path.resolve('eval/src');
  function getTsFiles(dir: string): string[] {
    let results: string[] = [];
    if (!fs.existsSync(dir)) return results;
    const list = fs.readdirSync(dir);
    for (const file of list) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat && stat.isDirectory()) {
        results = results.concat(getTsFiles(fullPath));
      } else if (file.endsWith('.ts')) {
        results.push(fullPath);
      }
    }
    return results;
  }

  const files = [
    ...getTsFiles(path.join(rootDir, 'evaluator')),
    ...getTsFiles(path.join(rootDir, 'providers')),
  ].sort();

  const hasher = crypto.createHash('sha256');
  for (const f of files) {
    const relPath = path.relative(rootDir, f).replace(/\\/g, '/');
    const fileHash = crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
    hasher.update(`${relPath}:${fileHash}\n`);
  }
  return hasher.digest('hex');
}

/**
 * Computes SHA-256 hash of the dependency lockfile (package-lock.json).
 */
export function computeLockfileHash(): string {
  const lockPath = path.resolve('package-lock.json');
  if (fs.existsSync(lockPath)) {
    return crypto.createHash('sha256').update(fs.readFileSync(lockPath)).digest('hex');
  }
  const pkgPath = path.resolve('package.json');
  return crypto.createHash('sha256').update(fs.readFileSync(pkgPath)).digest('hex');
}

/**
 * Computes SHA-256 hash of the approved dataset manifest.
 */
export function computeDatasetManifestHash(manifestPath: string): string {
  if (fs.existsSync(manifestPath)) {
    return crypto.createHash('sha256').update(fs.readFileSync(manifestPath)).digest('hex');
  }
  return 'manifest_not_found';
}

export interface RunExecutionOptions {
  inputFixturePath: string;
  outputDir: string;
  datasetManifestPath?: string;
  provider?: 'groq' | 'nvidia' | 'mock';
  model?: string;
  perspectives?: PerspectiveId[];
  limit?: number;
  seed?: number;
  secretKey?: string;
  resume?: boolean;
  dryRun?: boolean;
}

export interface RunExecutionResult {
  runId: string;
  exitCode: number;
  status: 'COMPLETED' | 'RATE_LIMIT_EXHAUSTED' | 'FAILED';
  httpStatus?: number;
  recordsProcessed: number;
  outputJsonlPath: string;
  manifestPath: string;
  error?: string;
}

export class EvaluatorRunner {
  private providerOverride: EvaluatorProvider | null = null;

  constructor(options?: { providerInstanceOverride?: EvaluatorProvider }) {
    if (options?.providerInstanceOverride) {
      this.providerOverride = options.providerInstanceOverride;
    }
  }

  /**
   * Enforces strict data boundary: asserts input is an approved synthetic fixture
   * registered with its SHA-256 hash in the approved dataset manifest,
   * prohibiting any connection to primary Neon database or patient consultation routes.
   */
  public validateDataBoundary(
    fixturePath: string,
    manifestPath: string = path.resolve('eval/data/manifest/approved_datasets.json')
  ): { dataset_id: string; dataset_version: string; dataset_sha256: string } {
    const normalized = path.normalize(fixturePath).toLowerCase();

    // 1. Blacklist check
    const prohibitedSubstrings = [
      'neon',
      'postgres',
      'lib/db',
      'lib\\db',
      'app/api/consultations',
      'app\\api\\consultations',
      'patients',
    ];

    for (const prohibited of prohibitedSubstrings) {
      if (normalized.includes(prohibited)) {
        throw new Error(
          `STRICT_DATA_BOUNDARY_VIOLATION: Attempted to load fixture from forbidden path '${fixturePath}'. The evaluator runner must consume approved synthetic benchmark fixtures only.`
        );
      }
    }

    if (!fs.existsSync(fixturePath)) {
      throw new Error(`Synthetic fixture file not found: ${fixturePath}`);
    }

    // 2. Cryptographic Content-Hash & Allowlist Verification
    const fixtureBytes = fs.readFileSync(fixturePath);
    const fixtureSha256 = crypto.createHash('sha256').update(fixtureBytes).digest('hex');

    if (!fs.existsSync(manifestPath)) {
      throw new Error(`Approved dataset manifest not found at: ${manifestPath}`);
    }

    const manifestData = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const approvedList = manifestData.approved_datasets || [];

    const matchedDataset = approvedList.find(
      (d: any) => d.sha256 === fixtureSha256
    );

    if (!matchedDataset) {
      throw new Error(
        `UNAPPROVED_DATASET_VIOLATION: Fixture '${fixturePath}' with SHA-256 '${fixtureSha256}' is not registered in the approved dataset manifest (${manifestPath}). Arbitrary or unapproved datasets are prohibited.`
      );
    }

    // 3. Scenario ID Verification
    const parsedFixture = JSON.parse(fixtureBytes.toString('utf8'));
    const scenarios: any[] = Array.isArray(parsedFixture)
      ? parsedFixture
      : parsedFixture.scenarios || [];

    const allowedIdSet = new Set(matchedDataset.approved_scenario_ids || []);
    for (const scen of scenarios) {
      if (!allowedIdSet.has(scen.scenario_id)) {
        throw new Error(
          `UNAUTHORIZED_SCENARIO_ID_VIOLATION: Scenario '${scen.scenario_id}' in fixture '${fixturePath}' is not in the approved scenario allowlist for dataset '${matchedDataset.dataset_id}'.`
        );
      }
    }

    return {
      dataset_id: matchedDataset.dataset_id,
      dataset_version: matchedDataset.dataset_version,
      dataset_sha256: fixtureSha256,
    };
  }

  /**
   * Resolves Git commit SHA.
   */
  private getGitCommitSha(): string {
    try {
      return execSync('git rev-parse HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      return 'unknown_commit_sha';
    }
  }

  /**
   * Initializes or creates provider instance based on options.
   */
  private createProvider(providerName: 'groq' | 'nvidia' | 'mock', model?: string): EvaluatorProvider {
    if (this.providerOverride) {
      return this.providerOverride;
    }

    switch (providerName) {
      case 'groq':
        return new GroqEvalProvider({ model });
      case 'nvidia':
        return new NvidiaEvalProvider({ model });
      case 'mock':
        return new MockEvalProvider({ modelReturned: model });
      default:
        throw new Error(`Unsupported provider: ${providerName}`);
    }
  }

  /**
   * Validates existing JSONL file and purges only an unterminated trailing write fragment at EOF.
   * If any interior line is corrupted or a newline-terminated record is malformed, throws
   * CORRUPTED_CHECKPOINT_INTEGRITY and preserves original evidence in a backup file.
   */
  public recoverAndLoadCheckpoints(jsonlPath: string): { completedKeys: Set<string>; validLinesCount: number } {
    const completedKeys = new Set<string>();
    if (!fs.existsSync(jsonlPath)) {
      return { completedKeys, validLinesCount: 0 };
    }

    const rawContent = fs.readFileSync(jsonlPath, 'utf8');
    if (!rawContent || rawContent.trim() === '') {
      return { completedKeys, validLinesCount: 0 };
    }

    const hasTrailingNewline = rawContent.endsWith('\n');
    const lines = rawContent.split('\n');
    if (hasTrailingNewline && lines[lines.length - 1] === '') {
      lines.pop();
    }

    const validLines: string[] = [];
    let recoveredFragment: string | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (!trimmed) {
        fs.copyFileSync(jsonlPath, jsonlPath + '.corrupted.bak');
        throw new Error(
          `CORRUPTED_CHECKPOINT_INTEGRITY: Empty line encountered at line ${i + 1}. Mid-file whitespace corruption cannot be silently discarded. Original evidence preserved at ${jsonlPath}.corrupted.bak`
        );
      }

      try {
        const record = JSON.parse(line);
        if (!record.scenario_id || !record.perspective_id) {
          throw new Error('Missing scenario_id or perspective_id');
        }
        const key = `${record.scenario_id}:${record.perspective_id}`;
        if (completedKeys.has(key)) {
          fs.copyFileSync(jsonlPath, jsonlPath + '.corrupted.bak');
          throw new Error(
            `CORRUPTED_CHECKPOINT_INTEGRITY: Duplicate evaluation record detected for '${key}' at line ${i + 1}. Original evidence preserved at ${jsonlPath}.corrupted.bak`
          );
        }
        completedKeys.add(key);
        validLines.push(line);
      } catch (err: any) {
        if (err.message?.includes('CORRUPTED_CHECKPOINT_INTEGRITY')) {
          throw err;
        }

        const isLastLine = i === lines.length - 1;
        // Only a non-newline-terminated final line can be treated as an incomplete write fragment
        if (isLastLine && !hasTrailingNewline) {
          recoveredFragment = line;
          fs.writeFileSync(jsonlPath + '.corrupted_fragment.bak', line, 'utf8');
          console.warn(
            `[CrashRecovery] Recovered incomplete non-newline-terminated trailing fragment at line ${i + 1}. Fragment preserved at ${jsonlPath}.corrupted_fragment.bak`
          );
          break;
        } else {
          // Mid-file corruption or newline-terminated malformed final record must trigger hard failure
          fs.copyFileSync(jsonlPath, jsonlPath + '.corrupted.bak');
          throw new Error(
            `CORRUPTED_CHECKPOINT_INTEGRITY: Unparseable record at line ${i + 1}. Mid-file or newline-terminated malformed records cannot be discarded. Original evidence preserved at ${jsonlPath}.corrupted.bak`
          );
        }
      }
    }

    // Rewrite clean valid lines if an unterminated trailing fragment was trimmed
    if (recoveredFragment !== null) {
      fs.writeFileSync(jsonlPath, validLines.length > 0 ? validLines.join('\n') + '\n' : '', 'utf8');
    }

    return { completedKeys, validLinesCount: validLines.length };
  }

  /**
   * Executes the in-silico evaluation run.
   */
  public async execute(options: RunExecutionOptions): Promise<RunExecutionResult> {
    const datasetInfo = this.validateDataBoundary(
      options.inputFixturePath,
      options.datasetManifestPath
    );

    const outputDir = path.resolve(options.outputDir);
    fs.mkdirSync(outputDir, { recursive: true });

    const providerName = options.provider || 'groq';
    const defaultModel =
      providerName === 'groq'
        ? 'qwen/qwen3.8-27b'
        : providerName === 'nvidia'
        ? 'openai/gpt-oss-20b'
        : 'mock-eval-model-v1';
    const modelId = options.model || defaultModel;

    const seed = options.seed ?? (providerName === 'mock' ? 42 : generateCryptographicSeed());
    const perspectives: PerspectiveId[] = options.perspectives || ['SIM-01', 'SIM-02', 'SIM-03'];
    
    const isMockOrDryRun = providerName === 'mock' || options.dryRun === true;
    let resolvedSecretKey = options.secretKey || process.env.EVAL_SECRET_KEY;

    if (!resolvedSecretKey) {
      if (!isMockOrDryRun) {
        throw new Error(
          "SECURE_KEY_REQUIRED: No secure evaluation key found in environment (EVAL_SECRET_KEY) or options. " +
          "Benchmark evaluations require a recoverable, securely managed 32-byte key to prevent irrecoverable secret mapping lock-out upon process exit."
        );
      }
      resolvedSecretKey = crypto.randomBytes(32).toString('hex');
    }

    if (resolvedSecretKey === 'smoke-test-secret-key-42') {
      throw new Error("COMPROMISED_KEY_REJECTED: The key 'smoke-test-secret-key-42' is permanently compromised and cannot be used for evaluations.");
    }
    const secretKey = resolvedSecretKey;
    const gitCommitSha = this.getGitCommitSha();

    // Compute cryptographic reproducibility hashes
    const rubricPath = path.resolve('eval/data/human_eval/scoring_rubric.md');
    const rubricBytes = fs.existsSync(rubricPath)
      ? fs.readFileSync(rubricPath)
      : Buffer.from('default_rubric_v2.2.0');
    const rubricContentHash = crypto.createHash('sha256').update(rubricBytes).digest('hex');
    const rubricVersion = '2.2.0';
    const protocolVersion = '1.2.0';

    const promptTemplateVersion = PROMPT_TEMPLATE_VERSION;
    const promptTemplateHash = computePromptTemplateHash();
    const evaluatorSourceTreeHash = computeEvaluatorSourceTreeHash();
    const dependencyLockfileHash = computeLockfileHash();
    const resolvedManifestPath = options.datasetManifestPath || path.resolve('eval/data/manifest/approved_datasets.json');
    const datasetManifestHash = computeDatasetManifestHash(resolvedManifestPath);

    const manifestPath = path.join(outputDir, 'run_manifest.json');
    const resultsJsonlPath = path.join(outputDir, 'eval_results.jsonl');
    const secretMappingPath = path.join(outputDir, 'secret_mapping.enc');

    let runId: string;

    // Handle Run Manifest and Resume validation
    if (options.resume && fs.existsSync(manifestPath)) {
      const existingManifest: RunManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const mismatches: string[] = [];

      if (existingManifest.provider !== providerName) {
        mismatches.push(`provider (expected: '${existingManifest.provider}', got: '${providerName}')`);
      }
      if (existingManifest.model_id !== modelId) {
        mismatches.push(`model_id (expected: '${existingManifest.model_id}', got: '${modelId}')`);
      }
      if (existingManifest.randomization_seed !== seed) {
        mismatches.push(
          `randomization_seed (expected: ${existingManifest.randomization_seed}, got: ${seed})`
        );
      }
      if (existingManifest.dataset_content_hash !== datasetInfo.dataset_sha256) {
        mismatches.push(
          `dataset_content_hash (expected: '${existingManifest.dataset_content_hash}', got: '${datasetInfo.dataset_sha256}')`
        );
      }
      if (existingManifest.dataset_manifest_hash && existingManifest.dataset_manifest_hash !== datasetManifestHash) {
        mismatches.push(
          `dataset_manifest_hash (expected: '${existingManifest.dataset_manifest_hash}', got: '${datasetManifestHash}')`
        );
      }
      if (existingManifest.rubric_content_hash !== rubricContentHash) {
        mismatches.push(
          `rubric_content_hash (expected: '${existingManifest.rubric_content_hash}', got: '${rubricContentHash}')`
        );
      }
      if (existingManifest.rubric_version !== rubricVersion) {
        mismatches.push(
          `rubric_version (expected: '${existingManifest.rubric_version}', got: '${rubricVersion}')`
        );
      }
      if (existingManifest.protocol_version !== protocolVersion) {
        mismatches.push(
          `protocol_version (expected: '${existingManifest.protocol_version}', got: '${protocolVersion}')`
        );
      }
      if (existingManifest.prompt_template_version && existingManifest.prompt_template_version !== promptTemplateVersion) {
        mismatches.push(
          `prompt_template_version (expected: '${existingManifest.prompt_template_version}', got: '${promptTemplateVersion}')`
        );
      }
      if (existingManifest.prompt_template_hash && existingManifest.prompt_template_hash !== promptTemplateHash) {
        mismatches.push(
          `prompt_template_hash (expected: '${existingManifest.prompt_template_hash}', got: '${promptTemplateHash}')`
        );
      }
      if (existingManifest.evaluator_source_tree_hash && existingManifest.evaluator_source_tree_hash !== evaluatorSourceTreeHash) {
        mismatches.push(
          `evaluator_source_tree_hash (expected: '${existingManifest.evaluator_source_tree_hash}', got: '${evaluatorSourceTreeHash}')`
        );
      }
      if (existingManifest.dependency_lockfile_hash && existingManifest.dependency_lockfile_hash !== dependencyLockfileHash) {
        mismatches.push(
          `dependency_lockfile_hash (expected: '${existingManifest.dependency_lockfile_hash}', got: '${dependencyLockfileHash}')`
        );
      }
      if (existingManifest.git_commit_sha !== gitCommitSha) {
        mismatches.push(
          `git_commit_sha (expected: '${existingManifest.git_commit_sha}', got: '${gitCommitSha}')`
        );
      }

      if (mismatches.length > 0) {
        throw new Error(
          `RUN_MANIFEST_MISMATCH: Incompatible resume attempt.\nMismatches detected:\n- ${mismatches.join('\n- ')}`
        );
      }

      runId = existingManifest.run_id;
    } else {
      runId = `run_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      const newManifest: RunManifest = {
        run_id: runId,
        provider: providerName,
        model_id: modelId,
        dataset_id: datasetInfo.dataset_id,
        dataset_content_hash: datasetInfo.dataset_sha256,
        dataset_manifest_hash: datasetManifestHash,
        rubric_version: rubricVersion,
        rubric_content_hash: rubricContentHash,
        protocol_version: protocolVersion,
        prompt_template_version: promptTemplateVersion,
        prompt_template_hash: promptTemplateHash,
        evaluator_source_tree_hash: evaluatorSourceTreeHash,
        dependency_lockfile_hash: dependencyLockfileHash,
        randomization_seed: seed,
        started_at: new Date().toISOString(),
        status: 'IN_PROGRESS',
        git_commit_sha: gitCommitSha,
      };
      fs.writeFileSync(manifestPath, JSON.stringify(newManifest, null, 2) + '\n');
    }

    // Recover valid records and checkpoints
    const { completedKeys } = this.recoverAndLoadCheckpoints(resultsJsonlPath);

    // Load synthetic scenarios
    const rawFixture = fs.readFileSync(options.inputFixturePath, 'utf8');
    const parsedData = JSON.parse(rawFixture);
    const scenarios: ClinicalScenario[] = Array.isArray(parsedData)
      ? parsedData
      : parsedData.scenarios || [];

    const scenariosToProcess = options.limit ? scenarios.slice(0, options.limit) : scenarios;

    // Execute stratified allocation
    const { blindedPairs, secretRecords } = stratifiedAllocateBatch(
      scenariosToProcess.map((s) => ({
        id: s.scenario_id,
        domain: s.domain || (s as any).clinical_domain || 'general_medicine',
      })),
      (item) => {
        const fullScen = scenariosToProcess.find((s) => s.scenario_id === item.id)!;
        const dialogueTurns: string[] = [];
        if (fullScen.initial_patient_utterance) {
          dialogueTurns.push(fullScen.initial_patient_utterance);
        }
        if (fullScen.follow_up_dialogue && Array.isArray(fullScen.follow_up_dialogue)) {
          for (const d of fullScen.follow_up_dialogue) {
            dialogueTurns.push(d.utterance);
          }
        } else if ((fullScen as any).presenting_dialogue && Array.isArray((fullScen as any).presenting_dialogue)) {
          for (const d of (fullScen as any).presenting_dialogue) {
            dialogueTurns.push(d.utterance);
          }
        }
        const agentText = dialogueTurns.join(' ');
        const refText =
          fullScen.physician_reference_response ||
          (fullScen as any).comparator_response?.response_text ||
          'Standard emergency clinical referral advice.';
        return {
          agentResponse: agentText,
          referenceResponse: refText,
        };
      },
      seed
    );

    // Save encrypted secret mapping
    const encryptedSecretPayload = encryptSecretMapping(secretRecords, secretKey);
    fs.writeFileSync(secretMappingPath, JSON.stringify(encryptedSecretPayload, null, 2) + '\n');

    if (options.dryRun) {
      return {
        runId,
        exitCode: 0,
        status: 'COMPLETED',
        recordsProcessed: 0,
        outputJsonlPath: resultsJsonlPath,
        manifestPath,
      };
    }

    const provider = this.createProvider(providerName, modelId);
    let newlyProcessedCount = 0;

    try {
      for (const scenario of scenariosToProcess) {
        const pair = blindedPairs.find((p) => p.sample_id === scenario.scenario_id);
        if (!pair) continue;

        for (const perspectiveId of perspectives) {
          const checkpointKey = `${scenario.scenario_id}:${perspectiveId}`;
          if (completedKeys.has(checkpointKey)) {
            continue; // Skip already completed
          }

          // Build prompt
          const renderedPrompt = buildEvaluationPrompt({
            perspectiveId,
            scenario,
            blindedPair: pair,
          });

          // Call provider
          const completionResult = await provider.complete(renderedPrompt.messages, {
            temperature: 0.1,
            topP: 0.95,
            seed: 42,
          });

          // Parse and apply auditable safety capping
          const parsedEvaluation = parseEvaluationResponse(completionResult.content);

          // Assemble complete evaluation record
          const evalRecord = {
            run_id: runId,
            scenario_id: scenario.scenario_id,
            perspective_id: perspectiveId,
            pair_id: pair.pair_id,
            provider: providerName,
            model_configured: modelId,
            model_returned: completionResult.modelReturned,
            response_id: completionResult.responseId,
            system_fingerprint: completionResult.systemFingerprint,
            git_commit_sha: gitCommitSha,
            latency_ms: completionResult.latencyMs,
            prompt_tokens: completionResult.promptTokens,
            completion_tokens: completionResult.completionTokens,
            total_tokens: completionResult.totalTokens,
            prompt_sha256: renderedPrompt.promptSha256,
            temperature: 0.1,
            seed_applied: completionResult.seedApplied,
            candidate_a: parsedEvaluation.candidate_a,
            candidate_b: parsedEvaluation.candidate_b,
            timestamp: completionResult.timestamp,
          };

          // Append to JSONL atomically
          fs.appendFileSync(resultsJsonlPath, JSON.stringify(evalRecord) + '\n');
          completedKeys.add(checkpointKey);
          newlyProcessedCount++;
        }
      }

      // Mark completed in manifest
      const finalManifest: RunManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      finalManifest.status = 'COMPLETED';
      finalManifest.completed_at = new Date().toISOString();
      fs.writeFileSync(manifestPath, JSON.stringify(finalManifest, null, 2) + '\n');

      return {
        runId,
        exitCode: 0,
        status: 'COMPLETED',
        recordsProcessed: newlyProcessedCount,
        outputJsonlPath: resultsJsonlPath,
        manifestPath,
      };
    } catch (err: any) {
      const isRateLimit =
        err.code === 'RATE_LIMIT_EXHAUSTED' ||
        err.statusCode === 429 ||
        err.message?.includes('RATE_LIMIT_EXHAUSTED');

      const finalStatus = isRateLimit ? 'RATE_LIMIT_EXHAUSTED' : 'FAILED';
      const exitCode = isRateLimit ? 2 : 1; // Conventional exit code 2 for rate limits (never 429!)

      try {
        const manifestToUpdate: RunManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        manifestToUpdate.status = finalStatus;
        if (isRateLimit) manifestToUpdate.http_status = 429;
        fs.writeFileSync(manifestPath, JSON.stringify(manifestToUpdate, null, 2) + '\n');
      } catch {
        // Ignore manifest update errors on crash
      }

      return {
        runId,
        exitCode,
        status: finalStatus,
        httpStatus: isRateLimit ? 429 : undefined,
        recordsProcessed: newlyProcessedCount,
        outputJsonlPath: resultsJsonlPath,
        manifestPath,
        error: err.message,
      };
    }
  }
}
