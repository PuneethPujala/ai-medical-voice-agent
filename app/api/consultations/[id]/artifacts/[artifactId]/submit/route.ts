import { NextResponse } from "next/server";
import { getDb } from "@/config/db";
import { consultationsTable } from "@/config/schema";
import { eq } from "drizzle-orm";
import { getAuthContext, hasPermission, AuthContext } from "@/lib/auth/rbac";
import {
  submitForReview,
  ClinicianAuthorizationError,
  ArtifactNotFoundError,
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
 * POST /api/consultations/[id]/artifacts/[artifactId]/submit
 * Submits an active draft artifact for physician review.
 */
export async function POST(
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
        { success: false, error: "Forbidden: Clinician credentials required to submit notes for review", code: "FORBIDDEN_ROLE" },
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

    const submitted = await db.transaction(async (tx) => {
      return await submitForReview(tx, {
        artifactId,
        actorId: auth.userId,
        actorRole: auth.role as "clinician" | "admin",
      });
    });

    return NextResponse.json(
      { success: true, artifact: submitted },
      { status: 200, headers: NO_CACHE_HEADERS }
    );
  } catch (err: any) {
    console.error("[ClinicalArtifact Submit Error]", err);
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
      { success: false, error: err?.message || "Failed to submit artifact for review", code: "INTERNAL_ERROR" },
      { status: 500, headers: NO_CACHE_HEADERS }
    );
  }
}
