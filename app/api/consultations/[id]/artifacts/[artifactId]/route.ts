import { NextResponse } from "next/server";
import { getDb } from "@/config/db";
import { consultationsTable } from "@/config/schema";
import { eq } from "drizzle-orm";
import { getAuthContext, hasPermission, AuthContext } from "@/lib/auth/rbac";
import { logAuditEventAsync } from "@/lib/audit/audit-logger";
import {
  getArtifactById,
  updateDraftArtifact,
  ClinicianAuthorizationError,
  ArtifactNotFoundError,
  ArtifactImmutabilityViolationError,
} from "@/lib/consultation/clinical-artifact-service";

function isAssignedClinician(
  consultationDoctorId: string | null | undefined,
  auth: AuthContext
): boolean {
  if (!consultationDoctorId || typeof consultationDoctorId !== "string" || consultationDoctorId.trim().length === 0) {
    return false;
  }
  const targetId = consultationDoctorId.trim().toLowerCase();
  // 1. Match against doctorId from Clerk publicMetadata (e.g. "dr-sarah-chen")
  if (auth.doctorId && typeof auth.doctorId === "string" && auth.doctorId.trim().toLowerCase() === targetId) {
    return true;
  }
  // 2. Direct match against Clerk userId if consultation was assigned by userId
  if (auth.userId && typeof auth.userId === "string" && auth.userId.trim().toLowerCase() === targetId) {
    return true;
  }
  return false;
}

const NO_CACHE_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

/**
 * GET /api/consultations/[id]/artifacts/[artifactId]
 * Retrieves a single clinical artifact by ID.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; artifactId: string }> }
) {
  try {
    const auth = await getAuthContext(request);
    const { id: consultationId, artifactId } = await params;

    if (auth.userId === "unauthenticated" && !auth.isDemoMode) {
      return NextResponse.json(
        { success: false, error: "Unauthorized", code: "UNAUTHORIZED" },
        { status: 401, headers: NO_CACHE_HEADERS }
      );
    }

    const db = getDb();
    if (!db) {
      return NextResponse.json(
        { success: false, error: "Clinical datastore unavailable", code: "SERVICE_UNAVAILABLE" },
        { status: 503, headers: NO_CACHE_HEADERS }
      );
    }

    const consultRows = await db
      .select()
      .from(consultationsTable)
      .where(eq(consultationsTable.id, consultationId))
      .limit(1);

    if (consultRows.length === 0) {
      return NextResponse.json(
        { success: false, error: "Consultation not found", code: "NOT_FOUND" },
        { status: 404, headers: NO_CACHE_HEADERS }
      );
    }

    const consultation = consultRows[0];
    const isOwner =
      consultation.userId === auth.userId ||
      (auth.isDemoMode && (consultation.userId === "anon-user" || consultation.userId === auth.userId));
    const isClinician = auth.role === "clinician" && isAssignedClinician(consultation.doctorId, auth);
    const isAdmin = auth.role === "admin";

    if (!isOwner && !isClinician && !isAdmin) {
      return NextResponse.json(
        { success: false, error: "Forbidden", code: "FORBIDDEN" },
        { status: 403, headers: NO_CACHE_HEADERS }
      );
    }

    const artifact = await getArtifactById(db, artifactId);
    if (!artifact || artifact.consultationId !== consultationId) {
      return NextResponse.json(
        { success: false, error: "Clinical artifact not found", code: "NOT_FOUND" },
        { status: 404, headers: NO_CACHE_HEADERS }
      );
    }

    // Patient cannot view draft/pending_review artifacts
    if (auth.role === "patient" && !isAdmin && artifact.status !== "signed") {
      return NextResponse.json(
        { success: false, error: "Forbidden: Clinical notes are only visible once signed", code: "FORBIDDEN" },
        { status: 403, headers: NO_CACHE_HEADERS }
      );
    }

    return NextResponse.json(
      { success: true, artifact },
      { status: 200, headers: NO_CACHE_HEADERS }
    );
  } catch (err: any) {
    console.error("[ClinicalArtifact GET Error]", err);
    return NextResponse.json(
      { success: false, error: err?.message || "Failed to retrieve artifact", code: "INTERNAL_ERROR" },
      { status: 500, headers: NO_CACHE_HEADERS }
    );
  }
}

/**
 * PATCH /api/consultations/[id]/artifacts/[artifactId]
 * Updates an active draft artifact. If currently in pending_review,
 * automatically downgrades to draft.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; artifactId: string }> }
) {
  try {
    const auth = await getAuthContext(request);
    const { id: consultationId, artifactId } = await params;

    if (auth.userId === "unauthenticated" && !auth.isDemoMode) {
      return NextResponse.json(
        { success: false, error: "Unauthorized", code: "UNAUTHORIZED" },
        { status: 401, headers: NO_CACHE_HEADERS }
      );
    }

    if (auth.role !== "clinician" && auth.role !== "admin") {
      return NextResponse.json(
        { success: false, error: "Forbidden: Clinician credentials required to edit clinical notes", code: "FORBIDDEN_ROLE" },
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

    const consultRows = await db
      .select()
      .from(consultationsTable)
      .where(eq(consultationsTable.id, consultationId))
      .limit(1);

    if (consultRows.length === 0) {
      return NextResponse.json(
        { success: false, error: "Consultation not found", code: "NOT_FOUND" },
        { status: 404, headers: NO_CACHE_HEADERS }
      );
    }

    const consultation = consultRows[0];
    const isAssigned = isAssignedClinician(consultation.doctorId, auth);
    const hasAdminOverride =
      auth.role === "admin" &&
      hasPermission(auth.role, "clinical_artifacts:sign:any", auth.permissions);

    if (!isAssigned && !hasAdminOverride) {
      return NextResponse.json(
        { success: false, error: "Forbidden: Care relationship required", code: "FORBIDDEN_CARE_RELATIONSHIP" },
        { status: 403, headers: NO_CACHE_HEADERS }
      );
    }

    const body = await request.json().catch(() => ({}));

    const updated = await db.transaction(async (tx) => {
      return await updateDraftArtifact(tx, {
        artifactId,
        chiefComplaint: body.chiefComplaint,
        soapSubjective: body.soapSubjective,
        soapObjective: body.soapObjective,
        soapAssessment: body.soapAssessment,
        soapPlan: body.soapPlan,
        actorId: auth.userId,
        actorRole: auth.role as "clinician" | "admin",
      });
    });

    return NextResponse.json(
      { success: true, artifact: updated },
      { status: 200, headers: NO_CACHE_HEADERS }
    );
  } catch (err: any) {
    console.error("[ClinicalArtifact PATCH Error]", err);
    if (err instanceof ArtifactImmutabilityViolationError) {
      return NextResponse.json(
        { success: false, error: err.message, code: "SIGNED_ARTIFACT_IMMUTABLE" },
        { status: 409, headers: NO_CACHE_HEADERS }
      );
    }
    if (err instanceof ArtifactNotFoundError) {
      return NextResponse.json(
        { success: false, error: err.message, code: "NOT_FOUND" },
        { status: 404, headers: NO_CACHE_HEADERS }
      );
    }
    if (err instanceof ClinicianAuthorizationError) {
      return NextResponse.json(
        { success: false, error: err.message, code: "FORBIDDEN" },
        { status: 403, headers: NO_CACHE_HEADERS }
      );
    }
    if (err?.statusCode) {
      return NextResponse.json(
        { success: false, error: err.message, code: "ARTIFACT_SERVICE_ERROR" },
        { status: err.statusCode, headers: NO_CACHE_HEADERS }
      );
    }

    return NextResponse.json(
      { success: false, error: err?.message || "Failed to update clinical artifact", code: "INTERNAL_ERROR" },
      { status: 500, headers: NO_CACHE_HEADERS }
    );
  }
}
