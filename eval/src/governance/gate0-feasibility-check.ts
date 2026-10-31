/**
 * MedVoice Clinical Response Evaluation Framework
 * Gate 0: Data Feasibility, Licensing, Provenance & Research Ethics Audit Validator
 *
 * Enforces compliance with:
 * - ICMR National Ethical Guidelines for Biomedical and Health Research (2017)
 * - ICMR Ethical Guidelines for Application of AI in Biomedical Research and Healthcare (2023)
 * - Digital Personal Data Protection Act (DPDPA), 2023
 * - Dataset Copyright, Provenance Chain & Data Use Agreements (DUA)
 */

import * as fs from 'fs';
import * as path from 'path';

export type DatasetStatus = 'APPROVED' | 'CONDITIONALLY_APPROVED' | 'BLOCKED';

export interface RegulatoryFramework {
  id: string;
  name: string;
  applicableClauses: string[];
  selfExemptionPermitted: boolean;
}

export interface IecSubmissionProtocol {
  status: string;
  selfDeclaredExemptionForbidden: boolean;
  requiresFormalEthicsCommitteeReview: boolean;
  institutionalEthicsCommittee: string;
  requiredDossierDocuments: string[];
}

export interface DatasetGovernanceRecord {
  id: string;
  name: string;
  version: string;
  repositoryUrl: string;
  upstreamSourceUrl: string;
  claimedLicense: string;
  actualLegalTerms: string;
  provenanceChain: string[];
  status: DatasetStatus;
  gate0_cleared: boolean;
  dataUseAgreementRequired: boolean;
  requiresIecApproval: boolean;
  isHumanSubjectsData: boolean;
  permittedUses: string[];
  restrictions: string[];
  notes: string;
}

export interface EvalConfig {
  $schema?: string;
  metadata: {
    framework: string;
    version: string;
    gate: string;
    auditDate: string;
    auditor: string;
    regulatoryFrameworks: RegulatoryFramework[];
    iecSubmissionProtocol: IecSubmissionProtocol;
  };
  datasets: Record<string, DatasetGovernanceRecord>;
  ingestionGuardrails: {
    enforceGate0Check: boolean;
    allowSyntheticFixturesInStage1: boolean;
    blockedActions: string[];
    mandatorySanitizers: string[];
  };
  gitExclusionRules: {
    requiredGitignorePatterns: string[];
  };
}

export interface Gate0ValidationResult {
  allowed: boolean;
  datasetId: string;
  status: DatasetStatus | 'UNKNOWN';
  gate0Cleared: boolean;
  reason?: string;
  remediation?: string;
}

export interface GovernanceAuditResult {
  overallCleared: boolean;
  approvedDatasets: string[];
  conditionallyApprovedDatasets: string[];
  blockedDatasets: string[];
  unverifiedDatasets: string[];
  gitExclusionValid: boolean;
  missingGitignorePatterns: string[];
  rejectionReasons: Record<string, string>;
  iecComplianceStatus: string;
  selfExemptionForbiddenEnforced: boolean;
}

export class Gate0FeasibilityError extends Error {
  public readonly datasetId: string;
  public readonly status: string;
  public readonly remediation: string;

  constructor(datasetId: string, status: string, message: string, remediation: string) {
    super(`[GATE 0 VIOLATION] Dataset '${datasetId}' (${status}): ${message}\nRemediation Required: ${remediation}`);
    this.name = 'Gate0FeasibilityError';
    this.datasetId = datasetId;
    this.status = status;
    this.remediation = remediation;
    Object.setPrototypeOf(this, Gate0FeasibilityError.prototype);
  }
}

/**
 * Resolves the path to eval-config.json.
 */
export function resolveEvalConfigPath(customPath?: string): string {
  if (customPath) {
    if (path.isAbsolute(customPath)) return customPath;
    return path.resolve(process.cwd(), customPath);
  }
  // Standard location relative to repo root or eval directory
  const candidates = [
    path.resolve(process.cwd(), 'eval/config/eval-config.json'),
    path.resolve(__dirname, '../../config/eval-config.json'),
    path.resolve(__dirname, '../../../eval/config/eval-config.json'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0];
}

/**
 * Loads and validates eval-config.json.
 */
export function loadEvalConfig(configPath?: string): EvalConfig {
  const resolved = resolveEvalConfigPath(configPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Eval configuration file not found at: ${resolved}`);
  }
  const content = fs.readFileSync(resolved, 'utf-8');
  return JSON.parse(content) as EvalConfig;
}

/**
 * Retrieves a dataset record from the configuration registry.
 */
export function getDatasetRecord(datasetId: string, configPath?: string): DatasetGovernanceRecord | undefined {
  const config = loadEvalConfig(configPath);
  return config.datasets[datasetId];
}

/**
 * Returns all dataset governance records registered in Gate 0.
 */
export function getGovernanceRegistry(configPath?: string): DatasetGovernanceRecord[] {
  const config = loadEvalConfig(configPath);
  return Object.values(config.datasets);
}

/**
 * Quick check if a dataset is Gate 0 cleared.
 */
export function isGate0Cleared(datasetId: string, configPath?: string): boolean {
  const record = getDatasetRecord(datasetId, configPath);
  return Boolean(record && record.gate0_cleared && record.status === 'APPROVED');
}

/**
 * Evaluates whether a dataset may be accessed for a specific operation.
 */
export function checkDatasetAccess(
  datasetId: string,
  operation: 'read' | 'ingest' | 'benchmark' = 'ingest',
  configPath?: string
): Gate0ValidationResult {
  const config = loadEvalConfig(configPath);
  const record = config.datasets[datasetId];

  if (!record) {
    return {
      allowed: false,
      datasetId,
      status: 'UNKNOWN',
      gate0Cleared: false,
      reason: `Dataset '${datasetId}' is unverified and absent from the Gate 0 governance registry.`,
      remediation: 'Register the dataset in eval-config.json with full provenance, licensing, and ethical audit before accessing.',
    };
  }

  if (record.status === 'BLOCKED') {
    return {
      allowed: false,
      datasetId,
      status: 'BLOCKED',
      gate0Cleared: false,
      reason: `Dataset '${datasetId}' is BLOCKED due to legal, licensing, or provenance chain taint. ${record.notes}`,
      remediation: 'Do not attempt to use this dataset. Select an approved alternative or execute formal upstream clearance.',
    };
  }

  if (record.status === 'CONDITIONALLY_APPROVED') {
    if (!record.gate0_cleared) {
      let specificReason = `Dataset '${datasetId}' is CONDITIONALLY APPROVED but NOT CLEARED for ${operation}.`;
      let specificRemediation = 'Complete Gate 0 clearing requirements before ingestion.';

      if (datasetId === 'mtsamples') {
        specificReason += ' MTSamples cannot be used under CC0; actual terms require educational sharing attribution and non-commercial licensing.';
        specificRemediation = 'Obtain an executed written Data Use Agreement (DUA) or written permission from MTSamples before corpus ingestion.';
      } else if (datasetId.includes('healthcaremagic') || datasetId.includes('meddialog')) {
        specificReason += ' Secondary clinical dialogue ingestion requires Institutional Ethics Committee (IEC) review under ICMR (2017) guidelines.';
        specificRemediation = 'Submit study protocol and waiver of consent application to accredited IEC. Self-exemption is forbidden.';
      }

      return {
        allowed: false,
        datasetId,
        status: 'CONDITIONALLY_APPROVED',
        gate0Cleared: false,
        reason: specificReason,
        remediation: specificRemediation,
      };
    }
  }

  if (record.status === 'APPROVED' && record.gate0_cleared) {
    return {
      allowed: true,
      datasetId,
      status: 'APPROVED',
      gate0Cleared: true,
    };
  }

  return {
    allowed: false,
    datasetId,
    status: record.status,
    gate0Cleared: record.gate0_cleared,
    reason: `Dataset '${datasetId}' has not passed Gate 0 clearance.`,
    remediation: 'Review DATASET_GOVERNANCE.md and complete required regulatory/ethics milestones.',
  };
}

/**
 * Asserts that a dataset is cleared for ingestion/benchmarking.
 * Throws a Gate0FeasibilityError immediately if unverified, blocked, or conditionally approved without clearance.
 */
export function assertGate0Cleared(
  datasetId: string,
  operation: 'read' | 'ingest' | 'benchmark' = 'ingest',
  configPath?: string
): void {
  const result = checkDatasetAccess(datasetId, operation, configPath);
  if (!result.allowed) {
    throw new Gate0FeasibilityError(
      datasetId,
      result.status,
      result.reason || 'Dataset access blocked by Gate 0 Feasibility Guard.',
      result.remediation || 'Consult eval/config/DATASET_GOVERNANCE.md for required approvals.'
    );
  }
}

/**
 * Verifies that all required raw data and secret mapping patterns are present in .gitignore.
 */
export function verifyGitignoreExclusions(
  gitignorePath?: string,
  requiredPatterns?: string[]
): { valid: boolean; missingPatterns: string[]; foundPatterns: string[] } {
  const resolvedGitignore = gitignorePath
    ? (path.isAbsolute(gitignorePath) ? gitignorePath : path.resolve(process.cwd(), gitignorePath))
    : path.resolve(process.cwd(), '.gitignore');

  if (!fs.existsSync(resolvedGitignore)) {
    throw new Error(`.gitignore not found at: ${resolvedGitignore}`);
  }

  const defaultRequired = [
    'eval/data/raw/',
    'data/raw/',
    'data/raw-datasets/',
    '*.raw.json',
    '*.raw.csv',
    '*review-mapping*.json',
    '*secret*',
    '*phi*',
    '*identifiable*',
  ];

  const patternsToCheck = requiredPatterns || defaultRequired;
  const gitignoreContent = fs.readFileSync(resolvedGitignore, 'utf-8');
  const lines = gitignoreContent.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

  const missingPatterns: string[] = [];
  const foundPatterns: string[] = [];

  for (const pattern of patternsToCheck) {
    // Check direct line match or regex match
    const exists = lines.some((line) => line === pattern || line.includes(pattern.replace(/\*/g, '')));
    if (exists) {
      foundPatterns.push(pattern);
    } else {
      missingPatterns.push(pattern);
    }
  }

  return {
    valid: missingPatterns.length === 0,
    missingPatterns,
    foundPatterns,
  };
}

/**
 * Performs a comprehensive Gate 0 governance audit across specified datasets (or all configured datasets).
 */
export function verifyDatasetGovernance(
  sources?: Array<{ id: string } | string>,
  configPath?: string,
  gitignorePath?: string
): GovernanceAuditResult {
  const config = loadEvalConfig(configPath);
  const gitCheck = verifyGitignoreExclusions(gitignorePath, config.gitExclusionRules?.requiredGitignorePatterns);

  const datasetIdsToCheck: string[] = sources
    ? sources.map((s) => (typeof s === 'string' ? s : s.id))
    : Object.keys(config.datasets);

  const approvedDatasets: string[] = [];
  const conditionallyApprovedDatasets: string[] = [];
  const blockedDatasets: string[] = [];
  const unverifiedDatasets: string[] = [];
  const rejectionReasons: Record<string, string> = {};

  for (const id of datasetIdsToCheck) {
    const access = checkDatasetAccess(id, 'ingest', configPath);
    if (access.allowed) {
      approvedDatasets.push(id);
    } else {
      if (access.status === 'BLOCKED') {
        blockedDatasets.push(id);
      } else if (access.status === 'CONDITIONALLY_APPROVED') {
        conditionallyApprovedDatasets.push(id);
      } else {
        unverifiedDatasets.push(id);
      }
      rejectionReasons[id] = access.reason || 'Not cleared by Gate 0';
    }
  }

  // Verify ethics invariants:
  // 1. selfExemptionPermitted must be false across all regulatory frameworks
  const selfExemptionForbiddenEnforced = config.metadata.regulatoryFrameworks.every(
    (rf) => rf.selfExemptionPermitted === false
  ) && config.metadata.iecSubmissionProtocol.selfDeclaredExemptionForbidden === true;

  // 2. Real clinical datasets with human subjects data cannot have gate0_cleared === true
  // unless IEC approval is verified
  const hasPrematureRealDataClearance = Object.values(config.datasets).some(
    (ds) => ds.isHumanSubjectsData && ds.gate0_cleared && ds.requiresIecApproval
  );

  // Overall check is cleared only if:
  // - All requested sources are approved and cleared
  // - gitignore exclusions are valid
  // - self exemption is strictly forbidden
  // - no premature clearance exists for unapproved real datasets
  const allRequestedCleared = datasetIdsToCheck.length > 0 &&
    conditionallyApprovedDatasets.length === 0 &&
    blockedDatasets.length === 0 &&
    unverifiedDatasets.length === 0;

  const overallCleared = allRequestedCleared &&
    gitCheck.valid &&
    selfExemptionForbiddenEnforced &&
    !hasPrematureRealDataClearance;

  return {
    overallCleared,
    approvedDatasets,
    conditionallyApprovedDatasets,
    blockedDatasets,
    unverifiedDatasets,
    gitExclusionValid: gitCheck.valid,
    missingGitignorePatterns: gitCheck.missingPatterns,
    rejectionReasons,
    iecComplianceStatus: config.metadata.iecSubmissionProtocol.status,
    selfExemptionForbiddenEnforced,
  };
}
