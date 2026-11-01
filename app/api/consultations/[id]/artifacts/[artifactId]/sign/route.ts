import { NextResponse } from "next/server";
import { getDb } from "@/config/db";
import { getAuthContext, hasPermission } from "@/lib/auth/rbac";
import {
  signArtifactInTransaction,
  ClinicianAuthorizationError,
  ArtifactNotFoundError,
  ConsultationNotFoundError,
  CasConflictError,
  IdempotencyKeyPayloadMismatchError,
  ArtifactNotReadyForSigningError,
  ArtifactConsultationMismatchError,
} from "@/lib/consultation/clinical-artifact-service";

const NO_CACHE_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

/**
 * POST /api/consultations/[id]/artifacts/[artifactId]/sign
 * Authoritative transactional signing endpoint for clinical artifacts.
 * Performs atomic transition of artifact to 'signed', updates consultation
 * case_version and status ('approved'), updates legacy SOAP mirror, and logs
 * durable audit event in a single database transaction.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; artifactId: string }> }
) {
  try {
    const auth = await getAuthContext(request);
    const { id: consultationId, artifactId } = await params;

    // 1. Enforce Authentication
    if (auth.userId === "unauthenticated" && !auth.isDemoMode) {
      return NextResponse.json(
        { success: false, error: "Unauthorized: Authentication required to sign medical records.", code: "UNAUTHORIZED" },
        { status: 401, headers: NO_CACHE_HEADERS }
      );
    }

    // 2. Clinical Authority Role Check
    if (auth.role !== "clinician" && auth.role !== "admin") {
      return NextResponse.json(
        {
          success: false,
          error: "Forbidden: Clinical signing authority required. Only clinicians or authorized administrators may sign notes.",
          code: "FORBIDDEN_ROLE",
        },
        { status: 403, headers: NO_CACHE_HEADERS }
      );
    }

    const db = getDb();
    if (!db) {
      return NextResponse.json(
        { success: false, error: "Clinical datastore unavailable", code: "SERVICE_UNAVAILABLE" },
        { status: 503, headers: NO_CACHE_HEADERS }
      );
    }

    const body = await request.json().catch(() => ({}));

    // 3. Extract & Validate Idempotency Key
    const idempotencyKey =
      body.idempotencyKey ||
      request.headers.get("x-idempotency-key") ||
      request.headers.get("idempotency-key");

    if (!idempotencyKey || typeof idempotencyKey !== "string" || idempotencyKey.trim().length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "Missing required idempotencyKey for clinical signing transaction.",
          code: "MISSING_IDEMPOTENCY_KEY",
        },
        { status: 400, headers: NO_CACHE_HEADERS }
      );
    }

    // 4. Extract expectedCaseVersion
    if (body.expectedCaseVersion === undefined || typeof body.expectedCaseVersion !== "number") {
      return NextResponse.json(
        {
          success: false,
          error: "Missing or invalid expectedCaseVersion for optimistic concurrency control.",
          code: "INVALID_CASE_VERSION",
        },
        { status: 400, headers: NO_CACHE_HEADERS }
      );
    }

    const hasOverridePermission = hasPermission(auth.role, "clinical_artifacts:sign:any", auth.permissions);

    // 5. Execute Authoritative Signing Transaction
    const result = await db.transaction(async (tx) => {
      return await signArtifactInTransaction(tx, {
        consultationId,
        artifactId,
        clinicianId: auth.userId,
        clinicianRole: auth.role as "clinician" | "admin",
        clinicianDoctorId: auth.doctorId,
        hasOverridePermission,
        overrideReason: body.overrideReason,
        idempotencyKey: idempotencyKey.trim(),
        expectedCaseVersion: Number(body.expectedCaseVersion),
        signatureAttestation: body.signatureAttestation,
      });
    });

    return NextResponse.json(
      {
        success: true,
        artifact: result.artifact,
        consultation: result.consultation,
        signingAttestationDigest: result.artifact.signingAttestationDigest,
        isIdempotentRetry: result.idempotentReplay,
      },
      { status: 200, headers: NO_CACHE_HEADERS }
    );
  } catch (err: any) {
    console.error("[ClinicalArtifact Sign Route Error]", err);

    if (err instanceof CasConflictError) {
      return NextResponse.json(
        { success: false, error: err.message, code: "CAS_CONFLICT" },
        { status: 409, headers: NO_CACHE_HEADERS }
      );
    }
    if (err instanceof IdempotencyKeyPayloadMismatchError) {
      return NextResponse.json(
        { success: false, error: err.message, code: "IDEMPOTENCY_KEY_PAYLOAD_MISMATCH" },
        { status: 409, headers: NO_CACHE_HEADERS }
      );
    }
    if (err instanceof ArtifactNotReadyForSigningError) {
      return NextResponse.json(
        { success: false, error: err.message, code: "ARTIFACT_NOT_PENDING_REVIEW" },
        { status: 409, headers: NO_CACHE_HEADERS }
      );
    }
    if (err instanceof ArtifactConsultationMismatchError) {
      return NextResponse.json(
        { success: false, error: err.message, code: "ARTIFACT_MISMATCH" },
        { status: 400, headers: NO_CACHE_HEADERS }
      );
    }
    if (err instanceof ClinicianAuthorizationError) {
      return NextResponse.json(
        { success: false, error: err.message, code: "FORBIDDEN" },
        { status: 403, headers: NO_CACHE_HEADERS }
      );
    }
    if (err instanceof ArtifactNotFoundError || err instanceof ConsultationNotFoundError) {
      return NextResponse.json(
        { success: false, error: err.message, code: "NOT_FOUND" },
        { status: 404, headers: NO_CACHE_HEADERS }
      );
    }
    if (err?.statusCode) {
      return NextResponse.json(
        { success: false, error: err.message, code: "SIGNING_FAILED" },
        { status: err.statusCode, headers: NO_CACHE_HEADERS }
      );
    }

    return NextResponse.json(
      { success: false, error: err?.message || "Failed to sign clinical artifact", code: "INTERNAL_ERROR" },
      { status: 500, headers: NO_CACHE_HEADERS }
    );
  }
}
