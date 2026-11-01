/**
 * Clinical Artifact Service (MedVoice Milestone 6 Stage 2)
 *
 * Implements the authoritative medico-legal lifecycle for clinical documents:
 * 1. Draft creation and editing
 * 2. Automatic downgrade from pending_review to draft on content modification
 * 3. Review submission
 * 4. Amendment lineage validation and creation
 * 5. Atomic, idempotent transactional signing
 * 6. Canonical SHA-256 digest and cryptographic attestation verification
 *
 * Transaction Lock Ordering (Strict Deadlock Prevention):
 * consultation -> artifact -> idempotency record -> audit chain head
 */

import { createHash, randomUUID } from "crypto";
import { sql, eq, and, desc, inArray } from "drizzle-orm";
import {
  consultationsTable,
  clinicalArtifactsTable,
  signingIdempotencyKeysTable,
} from "@/config/schema";
import {
  logAuditEventInTransaction,
  AuditEvent,
} from "@/lib/audit/audit-logger";

// ============================================================================
// Types
// ============================================================================

export type ClinicalArtifactStatus = "draft" | "pending_review" | "signed" | "cancelled";
export type ClinicalArtifactType = "soap_note";

export interface ClinicalArtifact {
  id: string;
  consultationId: string;
  artifactType: ClinicalArtifactType;
  version: number;
  status: ClinicalArtifactStatus;
  chiefComplaint: string;
  soapSubjective: string;
  soapObjective: string;
  soapAssessment: string;
  soapPlan: string;
  icd10Codes: string[];
  esiScore?: number | null;
  payloadSha256?: string | null;
  signedBy?: string | null;
  signedByRole?: string | null;
  signedAt?: Date | string | null;
  signingAttestationDigest?: string | null;
  amendsArtifactId?: string | null;
  amendmentReason?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface CreateDraftParams {
  consultationId: string;
  chiefComplaint: string;
  soapSubjective: string;
  soapObjective: string;
  soapAssessment: string;
  soapPlan: string;
  icd10Codes?: string[];
  esiScore?: number | null;
  artifactType?: ClinicalArtifactType;
  actorId: string;
  actorRole: "clinician" | "admin" | "system";
}

export interface UpdateDraftParams {
  artifactId: string;
  chiefComplaint?: string;
  soapSubjective?: string;
  soapObjective?: string;
  soapAssessment?: string;
  soapPlan?: string;
  icd10Codes?: string[];
  esiScore?: number | null;
  actorId: string;
  actorRole: "clinician" | "admin" | "system";
}

export interface SubmitForReviewParams {
  artifactId: string;
  actorId: string;
  actorRole: "clinician" | "admin" | "system";
}

export interface CreateAmendmentParams {
  consultationId: string;
  amendsArtifactId: string;
  amendmentReason: string;
  chiefComplaint?: string;
  soapSubjective?: string;
  soapObjective?: string;
  soapAssessment?: string;
  soapPlan?: string;
  icd10Codes?: string[];
  esiScore?: number | null;
  actorId: string;
  actorRole: "clinician" | "admin" | "system";
}

export interface SignArtifactParams {
  consultationId: string;
  artifactId: string;
  clinicianId: string;
  clinicianRole: "clinician" | "admin";
  idempotencyKey: string;
  expectedCaseVersion: number;
  signatureAttestation?: string;
}

export interface SigningResult {
  artifact: ClinicalArtifact;
  consultation: any;
  idempotentReplay: boolean;
  auditEvent?: AuditEvent;
}

// ============================================================================
// Custom Domain Errors
// ============================================================================

export class ClinicianAuthorizationError extends Error {
  readonly statusCode = 403;
  readonly code = "UNAUTHORIZED_CLINICIAN";
  constructor(message = "Unauthorized: Only clinicians or administrators may perform this action") {
    super(message);
    this.name = "ClinicianAuthorizationError";
  }
}

export class ConsultationNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = "CONSULTATION_NOT_FOUND";
  constructor(consultationId: string) {
    super(`Consultation '${consultationId}' not found`);
    this.name = "ConsultationNotFoundError";
  }
}

export class ArtifactNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = "ARTIFACT_NOT_FOUND";
  constructor(artifactId: string) {
    super(`Clinical artifact '${artifactId}' not found`);
    this.name = "ArtifactNotFoundError";
  }
}

export class ArtifactConsultationMismatchError extends Error {
  readonly statusCode = 400;
  readonly code = "ARTIFACT_CONSULTATION_MISMATCH";
  constructor(message = "Artifact does not belong to the specified consultation") {
    super(message);
    this.name = "ArtifactConsultationMismatchError";
  }
}

export class IdempotencyKeyPayloadMismatchError extends Error {
  readonly statusCode = 409;
  readonly code = "IDEMPOTENCY_KEY_PAYLOAD_MISMATCH";
  constructor(message = "409 IDEMPOTENCY_KEY_PAYLOAD_MISMATCH: Idempotency key reused with different request payload") {
    super(message);
    this.name = "IdempotencyKeyPayloadMismatchError";
  }
}

export class CasConflictError extends Error {
  readonly statusCode = 409;
  readonly code = "CAS_CONFLICT";
  constructor(message = "CAS conflict: consultation case_version has drifted") {
    super(message);
    this.name = "CasConflictError";
  }
}

export class ArtifactNotReadyForSigningError extends Error {
  readonly statusCode = 400;
  readonly code = "ARTIFACT_NOT_READY_FOR_SIGNING";
  constructor(message = "Artifact must be in 'pending_review' status to be signed. Drafts must be submitted for review first.") {
    super(message);
    this.name = "ArtifactNotReadyForSigningError";
  }
}

export class ArtifactAlreadySignedError extends Error {
  readonly statusCode = 409;
  readonly code = "ARTIFACT_ALREADY_SIGNED";
  constructor(message = "Clinical artifact is already signed and sealed") {
    super(message);
    this.name = "ArtifactAlreadySignedError";
  }
}

export class ArtifactCancelledError extends Error {
  readonly statusCode = 400;
  readonly code = "ARTIFACT_CANCELLED";
  constructor(message = "Cancelled clinical artifacts cannot be modified, submitted, or signed") {
    super(message);
    this.name = "ArtifactCancelledError";
  }
}

export class CompetingAmendmentError extends Error {
  readonly statusCode = 409;
  readonly code = "COMPETING_AMENDMENT_EXISTS";
  constructor(message = "An active amendment already exists for this parent artifact") {
    super(message);
    this.name = "CompetingAmendmentError";
  }
}

export class InvalidAmendmentLineageError extends Error {
  readonly statusCode = 400;
  readonly code = "INVALID_AMENDMENT_LINEAGE";
  constructor(message: string) {
    super(message);
    this.name = "InvalidAmendmentLineageError";
  }
}

export class ArtifactImmutabilityViolationError extends Error {
  readonly statusCode = 400;
  readonly code = "ARTIFACT_IMMUTABLE";
  constructor(message = "Signed clinical artifacts are immutable and cannot be modified") {
    super(message);
    this.name = "ArtifactImmutabilityViolationError";
  }
}

// ============================================================================
// Cryptographic Attestation & Digest Functions
// ============================================================================

/**
 * Computes a deterministic canonical SHA-256 digest of clinical artifact content.
 */
export function computeCanonicalArtifactDigest(artifact: {
  consultationId: string;
  artifactType: string;
  version: number;
  chiefComplaint: string;
  soapSubjective: string;
  soapObjective: string;
  soapAssessment: string;
  soapPlan: string;
  icd10Codes?: string[] | null;
  esiScore?: number | null;
}): string {
  const canonicalObj = {
    artifactType: artifact.artifactType,
    chiefComplaint: artifact.chiefComplaint,
    consultationId: artifact.consultationId,
    esiScore: artifact.esiScore ?? null,
    icd10Codes: Array.isArray(artifact.icd10Codes) ? [...artifact.icd10Codes].sort() : [],
    soapAssessment: artifact.soapAssessment,
    soapObjective: artifact.soapObjective,
    soapPlan: artifact.soapPlan,
    soapSubjective: artifact.soapSubjective,
    version: artifact.version,
  };
  return createHash("sha256")
    .update(JSON.stringify(canonicalObj), "utf8")
    .digest("hex");
}

/**
 * Computes the cryptographically bound signing attestation digest.
 */
export function computeSigningAttestationDigest(params: {
  payloadSha256: string;
  artifactId: string;
  consultationId: string;
  signedBy: string;
  signedByRole: string;
  signedAt: string;
}): string {
  const payload = [
    params.payloadSha256,
    params.artifactId,
    params.consultationId,
    params.signedBy,
    params.signedByRole,
    params.signedAt,
  ].join("|");
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

/**
 * Verifies the integrity of a signed clinical artifact.
 */
export function verifyArtifactIntegrity(artifact: {
  id: string;
  consultationId: string;
  artifactType: string;
  version: number;
  chiefComplaint: string;
  soapSubjective: string;
  soapObjective: string;
  soapAssessment: string;
  soapPlan: string;
  icd10Codes?: string[] | null;
  esiScore?: number | null;
  status: string;
  payloadSha256?: string | null;
  signedBy?: string | null;
  signedByRole?: string | null;
  signedAt?: Date | string | null;
  signingAttestationDigest?: string | null;
}): { valid: boolean; reason?: string } {
  if (artifact.status !== "signed") {
    return { valid: true }; // Unsigned artifacts do not possess sealed digests
  }

  if (
    !artifact.payloadSha256 ||
    !artifact.signingAttestationDigest ||
    !artifact.signedBy ||
    !artifact.signedByRole ||
    !artifact.signedAt
  ) {
    return {
      valid: false,
      reason: "Signed artifact is missing mandatory cryptographic attestation metadata",
    };
  }

  const expectedPayloadSha256 = computeCanonicalArtifactDigest(artifact);
  if (artifact.payloadSha256 !== expectedPayloadSha256) {
    return {
      valid: false,
      reason: `Payload SHA-256 mismatch: recorded '${artifact.payloadSha256}' vs computed '${expectedPayloadSha256}'`,
    };
  }

  const signedAtIso =
    artifact.signedAt instanceof Date
      ? artifact.signedAt.toISOString()
      : new Date(artifact.signedAt).toISOString();

  const expectedAttestationDigest = computeSigningAttestationDigest({
    payloadSha256: artifact.payloadSha256,
    artifactId: artifact.id,
    consultationId: artifact.consultationId,
    signedBy: artifact.signedBy,
    signedByRole: artifact.signedByRole,
    signedAt: signedAtIso,
  });

  if (artifact.signingAttestationDigest !== expectedAttestationDigest) {
    return {
      valid: false,
      reason: `Signing attestation digest mismatch: recorded '${artifact.signingAttestationDigest}' vs computed '${expectedAttestationDigest}'`,
    };
  }

  return { valid: true };
}

// ============================================================================
// Service Operations
// ============================================================================

/**
 * Helper to normalize row returned by Drizzle or pg.Pool
 */
function normalizeArtifactRow(row: any): ClinicalArtifact {
  return {
    id: row.id,
    consultationId: row.consultation_id ?? row.consultationId,
    artifactType: row.artifact_type ?? row.artifactType,
    version: Number(row.version),
    status: row.status,
    chiefComplaint: row.chief_complaint ?? row.chiefComplaint,
    soapSubjective: row.soap_subjective ?? row.soapSubjective,
    soapObjective: row.soap_objective ?? row.soapObjective,
    soapAssessment: row.soap_assessment ?? row.soapAssessment,
    soapPlan: row.soap_plan ?? row.soapPlan,
    icd10Codes: Array.isArray(row.icd10_codes ?? row.icd10Codes)
      ? (row.icd10_codes ?? row.icd10Codes)
      : [],
    esiScore: row.esi_score ?? row.esiScore ?? null,
    payloadSha256: row.payload_sha256 ?? row.payloadSha256 ?? null,
    signedBy: row.signed_by ?? row.signedBy ?? null,
    signedByRole: row.signed_by_role ?? row.signedByRole ?? null,
    signedAt: row.signed_at ?? row.signedAt ?? null,
    signingAttestationDigest:
      row.signing_attestation_digest ?? row.signingAttestationDigest ?? null,
    amendsArtifactId: row.amends_artifact_id ?? row.amendsArtifactId ?? null,
    amendmentReason: row.amendment_reason ?? row.amendmentReason ?? null,
    createdAt: row.created_at ?? row.createdAt,
    updatedAt: row.updated_at ?? row.updatedAt,
  };
}

/**
 * Create a new initial clinical artifact in 'draft' status (Version 1).
 * Lock Order: consultation -> artifact -> audit chain head
 */
export async function createDraftArtifact(
  tx: any,
  params: CreateDraftParams
): Promise<ClinicalArtifact> {
  // 1. Lock consultation
  const consultRes = await tx.execute(
    sql`SELECT id FROM consultations WHERE id = ${params.consultationId} FOR UPDATE`
  );
  const consultRows = consultRes.rows || consultRes;
  if (!consultRows || consultRows.length === 0) {
    throw new ConsultationNotFoundError(params.consultationId);
  }

  const artifactType = params.artifactType || "soap_note";

  // 2. Check if an active version 1 already exists
  const existingRes = await tx.execute(
    sql`SELECT id, status FROM clinical_artifacts
        WHERE consultation_id = ${params.consultationId}
          AND artifact_type = ${artifactType}
          AND status <> 'cancelled'`
  );
  const existingRows = existingRes.rows || existingRes;
  if (existingRows && existingRows.length > 0) {
    throw new Error(
      `An active clinical artifact already exists for consultation '${params.consultationId}'. Use createAmendment for subsequent versions.`
    );
  }

  const artifactId = `art_${randomUUID().replace(/-/g, "")}`;
  const now = new Date();

  // 3. Insert initial draft (version 1)
  const insertRes = await tx.execute(
    sql`INSERT INTO clinical_artifacts (
          id, consultation_id, artifact_type, version, status,
          chief_complaint, soap_subjective, soap_objective, soap_assessment, soap_plan,
          icd10_codes, esi_score, created_at, updated_at
        ) VALUES (
          ${artifactId}, ${params.consultationId}, ${artifactType}, 1, 'draft',
          ${params.chiefComplaint}, ${params.soapSubjective}, ${params.soapObjective}, ${params.soapAssessment}, ${params.soapPlan},
          ${JSON.stringify(params.icd10Codes || [])}::jsonb, ${params.esiScore ?? null}, ${now}, ${now}
        ) RETURNING *`
  );
  const insertedRows = insertRes.rows || insertRes;
  const artifact = normalizeArtifactRow(insertedRows[0]);

  // 4. Log audit event
  await logAuditEventInTransaction(tx, {
    actorId: params.actorId,
    actorRole: params.actorRole,
    action: "CLINICAL_ARTIFACT_DRAFT_CREATED",
    resourceType: "clinical_artifact",
    resourceId: artifact.id,
    metadata: {
      consultationId: params.consultationId,
      version: 1,
      artifactType,
    },
  });

  return artifact;
}

/**
 * Update an existing draft clinical artifact.
 *
 * CRITICAL CLINICAL INVARIANT:
 * If an artifact is in 'pending_review' status and clinical content is edited,
 * it is automatically downgraded back to 'draft', requiring explicit clinician re-submission!
 *
 * Signed or cancelled artifacts reject any updates.
 */
export async function updateDraftArtifact(
  tx: any,
  params: UpdateDraftParams
): Promise<ClinicalArtifact> {
  // 1. Lock artifact
  const artRes = await tx.execute(
    sql`SELECT * FROM clinical_artifacts WHERE id = ${params.artifactId} FOR UPDATE`
  );
  const artRows = artRes.rows || artRes;
  if (!artRows || artRows.length === 0) {
    throw new ArtifactNotFoundError(params.artifactId);
  }
  const current = normalizeArtifactRow(artRows[0]);

  if (current.status === "signed") {
    throw new ArtifactImmutabilityViolationError(
      "Signed clinical artifacts are immutable and cannot be updated"
    );
  }
  if (current.status === "cancelled") {
    throw new ArtifactCancelledError(
      "Cancelled clinical artifacts cannot be modified"
    );
  }

  // 2. Determine target status (automatic downgrade if pending_review)
  let targetStatus = current.status;
  let wasDowngraded = false;
  if (current.status === "pending_review") {
    targetStatus = "draft";
    wasDowngraded = true;
  }

  const updatedChiefComplaint = params.chiefComplaint ?? current.chiefComplaint;
  const updatedSubjective = params.soapSubjective ?? current.soapSubjective;
  const updatedObjective = params.soapObjective ?? current.soapObjective;
  const updatedAssessment = params.soapAssessment ?? current.soapAssessment;
  const updatedPlan = params.soapPlan ?? current.soapPlan;
  const updatedIcd10 = params.icd10Codes ?? current.icd10Codes;
  const updatedEsi = params.esiScore !== undefined ? params.esiScore : current.esiScore;
  const now = new Date();

  // 3. Execute update
  const updateRes = await tx.execute(
    sql`UPDATE clinical_artifacts
        SET chief_complaint = ${updatedChiefComplaint},
            soap_subjective = ${updatedSubjective},
            soap_objective = ${updatedObjective},
            soap_assessment = ${updatedAssessment},
            soap_plan = ${updatedPlan},
            icd10_codes = ${JSON.stringify(updatedIcd10)}::jsonb,
            esi_score = ${updatedEsi ?? null},
            status = ${targetStatus},
            updated_at = ${now}
        WHERE id = ${params.artifactId}
        RETURNING *`
  );
  const updatedRows = updateRes.rows || updateRes;
  const updatedArtifact = normalizeArtifactRow(updatedRows[0]);

  // 4. Log audit event
  await logAuditEventInTransaction(tx, {
    actorId: params.actorId,
    actorRole: params.actorRole,
    action: "CLINICAL_ARTIFACT_DRAFT_UPDATED",
    resourceType: "clinical_artifact",
    resourceId: updatedArtifact.id,
    metadata: {
      consultationId: updatedArtifact.consultationId,
      version: updatedArtifact.version,
      previousStatus: current.status,
      newStatus: targetStatus,
      downgradedFromPendingReview: wasDowngraded,
    },
  });

  return updatedArtifact;
}

/**
 * Submit a draft artifact for clinician review.
 * Validates clinical content completeness and transitions status to 'pending_review'.
 */
export async function submitForReview(
  tx: any,
  params: SubmitForReviewParams
): Promise<ClinicalArtifact> {
  // 1. Lock artifact
  const artRes = await tx.execute(
    sql`SELECT * FROM clinical_artifacts WHERE id = ${params.artifactId} FOR UPDATE`
  );
  const artRows = artRes.rows || artRes;
  if (!artRows || artRows.length === 0) {
    throw new ArtifactNotFoundError(params.artifactId);
  }
  const current = normalizeArtifactRow(artRows[0]);

  if (current.status === "signed") {
    throw new ArtifactAlreadySignedError("Clinical artifact is already signed");
  }
  if (current.status === "cancelled") {
    throw new ArtifactCancelledError("Cancelled clinical artifacts cannot be submitted for review");
  }
  if (current.status === "pending_review") {
    return current; // Idempotent no-op
  }

  // 2. Validate mandatory clinical content
  if (
    !current.chiefComplaint?.trim() ||
    !current.soapSubjective?.trim() ||
    !current.soapObjective?.trim() ||
    !current.soapAssessment?.trim() ||
    !current.soapPlan?.trim()
  ) {
    throw new Error("Cannot submit for review: all SOAP sections and chief complaint must be populated");
  }

  const now = new Date();
  const updateRes = await tx.execute(
    sql`UPDATE clinical_artifacts
        SET status = 'pending_review',
            updated_at = ${now}
        WHERE id = ${params.artifactId}
        RETURNING *`
  );
  const updatedRows = updateRes.rows || updateRes;
  const artifact = normalizeArtifactRow(updatedRows[0]);

  // 3. Log audit event
  await logAuditEventInTransaction(tx, {
    actorId: params.actorId,
    actorRole: params.actorRole,
    action: "CLINICAL_ARTIFACT_SUBMITTED_FOR_REVIEW",
    resourceType: "clinical_artifact",
    resourceId: artifact.id,
    metadata: {
      consultationId: artifact.consultationId,
      version: artifact.version,
    },
  });

  return artifact;
}

/**
 * Create a subsequent revision (amendment) linked to a signed parent artifact.
 *
 * Invariants Enforced:
 * - Parent artifact MUST be signed.
 * - Parent artifact MUST belong to the specified consultation.
 * - amendmentReason is mandatory and must be >= 10 characters.
 * - Only ONE active amendment successor is allowed per parent artifact (partial unique index).
 * - New version is parent.version + 1.
 * - Starts in 'draft' status.
 */
export async function createAmendment(
  tx: any,
  params: CreateAmendmentParams
): Promise<ClinicalArtifact> {
  // 1. Validate amendment reason
  if (!params.amendmentReason || params.amendmentReason.trim().length < 10) {
    throw new InvalidAmendmentLineageError(
      "Amendment reason is mandatory and must contain at least 10 characters"
    );
  }

  // 2. Lock consultation
  const consultRes = await tx.execute(
    sql`SELECT id FROM consultations WHERE id = ${params.consultationId} FOR UPDATE`
  );
  const consultRows = consultRes.rows || consultRes;
  if (!consultRows || consultRows.length === 0) {
    throw new ConsultationNotFoundError(params.consultationId);
  }

  // 3. Lock parent artifact
  const parentRes = await tx.execute(
    sql`SELECT * FROM clinical_artifacts WHERE id = ${params.amendsArtifactId} FOR UPDATE`
  );
  const parentRows = parentRes.rows || parentRes;
  if (!parentRows || parentRows.length === 0) {
    throw new ArtifactNotFoundError(params.amendsArtifactId);
  }
  const parent = normalizeArtifactRow(parentRows[0]);

  // 4. Lineage and ownership checks
  if (parent.consultationId !== params.consultationId) {
    throw new ArtifactConsultationMismatchError(
      `Parent artifact '${params.amendsArtifactId}' does not belong to consultation '${params.consultationId}'`
    );
  }
  if (parent.status !== "signed") {
    throw new InvalidAmendmentLineageError(
      `Cannot amend artifact '${params.amendsArtifactId}': status is '${parent.status}'. Only signed artifacts may be amended.`
    );
  }

  // 5. Verify no competing active successor exists
  const activeSuccessorRes = await tx.execute(
    sql`SELECT id, status, version FROM clinical_artifacts
        WHERE amends_artifact_id = ${params.amendsArtifactId}
          AND status IN ('draft', 'pending_review', 'signed')`
  );
  const activeSuccessorRows = activeSuccessorRes.rows || activeSuccessorRes;
  if (activeSuccessorRows && activeSuccessorRows.length > 0) {
    throw new CompetingAmendmentError(
      `An active amendment ('${activeSuccessorRows[0].id}', version ${activeSuccessorRows[0].version}, status '${activeSuccessorRows[0].status}') already exists for parent artifact '${params.amendsArtifactId}'`
    );
  }

  const newVersion = parent.version + 1;
  const artifactId = `art_${randomUUID().replace(/-/g, "")}`;
  const now = new Date();

  // Prepopulate content from parent unless explicitly overridden
  const chiefComplaint = params.chiefComplaint ?? parent.chiefComplaint;
  const soapSubjective = params.soapSubjective ?? parent.soapSubjective;
  const soapObjective = params.soapObjective ?? parent.soapObjective;
  const soapAssessment = params.soapAssessment ?? parent.soapAssessment;
  const soapPlan = params.soapPlan ?? parent.soapPlan;
  const icd10Codes = params.icd10Codes ?? parent.icd10Codes;
  const esiScore = params.esiScore !== undefined ? params.esiScore : parent.esiScore;

  // 6. Insert new amendment
  const insertRes = await tx.execute(
    sql`INSERT INTO clinical_artifacts (
          id, consultation_id, artifact_type, version, status,
          chief_complaint, soap_subjective, soap_objective, soap_assessment, soap_plan,
          icd10_codes, esi_score, amends_artifact_id, amendment_reason,
          created_at, updated_at
        ) VALUES (
          ${artifactId}, ${params.consultationId}, ${parent.artifactType}, ${newVersion}, 'draft',
          ${chiefComplaint}, ${soapSubjective}, ${soapObjective}, ${soapAssessment}, ${soapPlan},
          ${JSON.stringify(icd10Codes)}::jsonb, ${esiScore ?? null}, ${parent.id}, ${params.amendmentReason},
          ${now}, ${now}
        ) RETURNING *`
  );
  const insertedRows = insertRes.rows || insertRes;
  const amendment = normalizeArtifactRow(insertedRows[0]);

  // 7. Log audit event
  await logAuditEventInTransaction(tx, {
    actorId: params.actorId,
    actorRole: params.actorRole,
    action: "CLINICAL_ARTIFACT_AMENDMENT_CREATED",
    resourceType: "clinical_artifact",
    resourceId: amendment.id,
    metadata: {
      consultationId: params.consultationId,
      amendsArtifactId: parent.id,
      amendmentReason: params.amendmentReason,
      parentVersion: parent.version,
      newVersion,
    },
  });

  return amendment;
}

/**
 * Cancel an unsealed draft or pending-review artifact.
 * Cancelling frees the active amendment successor constraint, allowing a replacement revision.
 */
export async function cancelArtifact(
  tx: any,
  params: {
    artifactId: string;
    actorId: string;
    actorRole: "clinician" | "admin" | "system";
    cancellationReason: string;
  }
): Promise<ClinicalArtifact> {
  const artRes = await tx.execute(
    sql`SELECT * FROM clinical_artifacts WHERE id = ${params.artifactId} FOR UPDATE`
  );
  const artRows = artRes.rows || artRes;
  if (!artRows || artRows.length === 0) {
    throw new ArtifactNotFoundError(params.artifactId);
  }
  const current = normalizeArtifactRow(artRows[0]);

  if (current.status === "signed") {
    throw new ArtifactImmutabilityViolationError(
      "Signed clinical artifacts are immutable and cannot be cancelled"
    );
  }
  if (current.status === "cancelled") {
    return current;
  }

  const now = new Date();
  const updateRes = await tx.execute(
    sql`UPDATE clinical_artifacts
        SET status = 'cancelled',
            updated_at = ${now}
        WHERE id = ${params.artifactId}
        RETURNING *`
  );
  const updatedRows = updateRes.rows || updateRes;
  const cancelledArtifact = normalizeArtifactRow(updatedRows[0]);

  await logAuditEventInTransaction(tx, {
    actorId: params.actorId,
    actorRole: params.actorRole,
    action: "CLINICAL_ARTIFACT_CANCELLED",
    resourceType: "clinical_artifact",
    resourceId: cancelledArtifact.id,
    metadata: {
      consultationId: cancelledArtifact.consultationId,
      version: cancelledArtifact.version,
      cancellationReason: params.cancellationReason,
    },
  });

  return cancelledArtifact;
}

/**
 * Execute an atomic, tamper-evident clinical artifact signing transaction.
 *
 * Atomically Performs (Inside Single Transaction):
 * 1. Verify authenticated clinician authorization.
 * 2. Lock and validate consultation (lock order 1).
 * 3. Lock and validate target artifact (lock order 2).
 * 4. Verify consultation ownership.
 * 5. Check durable idempotency record (lock order 3).
 *    - Same key + same fingerprint: return previously signed artifact without duplicate audit event.
 *    - Same key + different fingerprint: throw 409 IDEMPOTENCY_KEY_PAYLOAD_MISMATCH.
 * 6. Verify expected caseVersion and pending_review state.
 * 7. Recompute canonical SHA-256 digest on server.
 * 8. Sign artifact exactly once (status='signed', seal attestation digest).
 * 9. Update consultation with conditional CAS (caseVersion + 1, status='completed').
 * 10. Update legacy SOAP compatibility mirror from signed artifact only.
 * 11. Persist signing idempotency key.
 * 12. Append audit event and advance singleton chain head (lock order 4).
 * 13. Commit everything together.
 */
export async function signArtifactInTransaction(
  tx: any,
  params: SignArtifactParams
): Promise<SigningResult> {
  // 1. Verify clinician authorization
  if (params.clinicianRole !== "clinician" && params.clinicianRole !== "admin") {
    throw new ClinicianAuthorizationError(
      `Role '${params.clinicianRole}' is not authorized to sign clinical artifacts`
    );
  }

  // 2. Lock consultation (Lock order: 1)
  const consultRes = await tx.execute(
    sql`SELECT id, user_id, status, case_version, doctor_id
        FROM consultations
        WHERE id = ${params.consultationId}
        FOR UPDATE`
  );
  const consultRows = consultRes.rows || consultRes;
  if (!consultRows || consultRows.length === 0) {
    throw new ConsultationNotFoundError(params.consultationId);
  }
  const consultation = consultRows[0];
  const currentCaseVersion = Number(consultation.case_version ?? consultation.caseVersion);

  // 3. Lock artifact (Lock order: 2)
  const artRes = await tx.execute(
    sql`SELECT * FROM clinical_artifacts
        WHERE id = ${params.artifactId}
        FOR UPDATE`
  );
  const artRows = artRes.rows || artRes;
  if (!artRows || artRows.length === 0) {
    throw new ArtifactNotFoundError(params.artifactId);
  }
  const artifact = normalizeArtifactRow(artRows[0]);

  // 4. Verify consultation ownership
  if (artifact.consultationId !== params.consultationId) {
    throw new ArtifactConsultationMismatchError(
      `Artifact '${params.artifactId}' belongs to consultation '${artifact.consultationId}', not '${params.consultationId}'`
    );
  }

  // 5. Check durable idempotency record (Lock order: 3)
  const requestFingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        consultationId: params.consultationId,
        artifactId: params.artifactId,
        clinicianId: params.clinicianId,
        idempotencyKey: params.idempotencyKey,
        expectedCaseVersion: params.expectedCaseVersion,
      }),
      "utf8"
    )
    .digest("hex");

  const idempRes = await tx.execute(
    sql`SELECT * FROM signing_idempotency_keys
        WHERE consultation_id = ${params.consultationId}
          AND artifact_id = ${params.artifactId}
          AND actor_id = ${params.clinicianId}
          AND idempotency_key = ${params.idempotencyKey}
        FOR UPDATE`
  );
  const idempRows = idempRes.rows || idempRes;
  if (idempRows && idempRows.length > 0) {
    const existingKey = idempRows[0];
    const recordedHash = String(existingKey.request_hash ?? existingKey.requestHash);
    if (recordedHash === requestFingerprint) {
      // Valid idempotent replay: return already-signed artifact without modifying DB or re-auditing
      return {
        artifact,
        consultation,
        idempotentReplay: true,
      };
    } else {
      throw new IdempotencyKeyPayloadMismatchError(
        `409 IDEMPOTENCY_KEY_PAYLOAD_MISMATCH: Idempotency key '${params.idempotencyKey}' was previously used with a different request fingerprint`
      );
    }
  }

  // 6. Verify status and CAS version
  if (artifact.status === "signed") {
    throw new ArtifactAlreadySignedError(
      `Clinical artifact '${params.artifactId}' is already signed`
    );
  }
  if (artifact.status === "cancelled") {
    throw new ArtifactCancelledError(
      `Clinical artifact '${params.artifactId}' has been cancelled`
    );
  }
  if (artifact.status !== "pending_review") {
    throw new ArtifactNotReadyForSigningError(
      `Artifact '${params.artifactId}' is in status '${artifact.status}'. It must be submitted for review ('pending_review') before signing.`
    );
  }
  if (currentCaseVersion !== params.expectedCaseVersion) {
    throw new CasConflictError(
      `CAS conflict: consultation case_version is ${currentCaseVersion}, expected ${params.expectedCaseVersion}`
    );
  }

  // 7. Recompute canonical artifact digest on server
  const payloadSha256 = computeCanonicalArtifactDigest(artifact);
  const signedAt = new Date();
  const signedAtIso = signedAt.toISOString();

  // 8. Compute signing attestation digest
  const signingAttestationDigest = computeSigningAttestationDigest({
    payloadSha256,
    artifactId: artifact.id,
    consultationId: params.consultationId,
    signedBy: params.clinicianId,
    signedByRole: params.clinicianRole,
    signedAt: signedAtIso,
  });

  // 9. Sign artifact exactly once
  const signRes = await tx.execute(
    sql`UPDATE clinical_artifacts
        SET status = 'signed',
            payload_sha256 = ${payloadSha256},
            signed_by = ${params.clinicianId},
            signed_by_role = ${params.clinicianRole},
            signed_at = ${signedAt},
            signing_attestation_digest = ${signingAttestationDigest},
            updated_at = ${signedAt}
        WHERE id = ${params.artifactId}
          AND status = 'pending_review'
        RETURNING *`
  );
  const signedRows = signRes.rows || signRes;
  if (!signedRows || signedRows.length === 0) {
    throw new CasConflictError("Failed to sign: artifact status changed concurrently");
  }
  const newlySignedArtifact = normalizeArtifactRow(signedRows[0]);

  // 10. Update consultation status with conditional CAS and update legacy SOAP compatibility mirror
  const newCaseVersion = currentCaseVersion + 1;
  const updateConsultRes = await tx.execute(
    sql`UPDATE consultations
        SET case_version = ${newCaseVersion},
            status = 'completed',
            soap_subjective = ${artifact.soapSubjective},
            soap_objective = ${artifact.soapObjective},
            soap_assessment = ${artifact.soapAssessment},
            soap_plan = ${artifact.soapPlan},
            approved_at = ${signedAt},
            approved_by = ${params.clinicianId}
        WHERE id = ${params.consultationId}
          AND case_version = ${params.expectedCaseVersion}
        RETURNING *`
  );
  const updatedConsultRows = updateConsultRes.rows || updateConsultRes;
  if (!updatedConsultRows || updatedConsultRows.length === 0) {
    throw new CasConflictError(
      `CAS conflict: consultation '${params.consultationId}' was updated concurrently during signing`
    );
  }
  const updatedConsultation = updatedConsultRows[0];

  // 11. Persist durable idempotency record
  await tx.execute(
    sql`INSERT INTO signing_idempotency_keys (
          idempotency_key, consultation_id, artifact_id, actor_id,
          request_hash, result_artifact_id, created_at
        ) VALUES (
          ${params.idempotencyKey}, ${params.consultationId}, ${params.artifactId}, ${params.clinicianId},
          ${requestFingerprint}, ${params.artifactId}, ${signedAt}
        )`
  );

  // 12. Append audit event and advance audit chain head (Lock order: 4)
  const auditEvent = await logAuditEventInTransaction(tx, {
    actorId: params.clinicianId,
    actorRole: params.clinicianRole,
    action: "CLINICAL_ARTIFACT_SIGNED",
    resourceType: "clinical_artifact",
    resourceId: params.artifactId,
    metadata: {
      consultationId: params.consultationId,
      version: newlySignedArtifact.version,
      payloadSha256,
      signingAttestationDigest,
      previousCaseVersion: currentCaseVersion,
      newCaseVersion,
      idempotencyKey: params.idempotencyKey,
    },
  });

  return {
    artifact: newlySignedArtifact,
    consultation: updatedConsultation,
    idempotentReplay: false,
    auditEvent,
  };
}
