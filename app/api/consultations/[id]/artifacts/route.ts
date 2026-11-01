import { NextResponse } from "next/server";
import { getDb } from "@/config/db";
import { consultationsTable } from "@/config/schema";
import { eq } from "drizzle-orm";
import { getAuthContext, hasPermission, AuthContext } from "@/lib/auth/rbac";
import { logAuditEventAsync } from "@/lib/audit/audit-logger";
import {
  getArtifactsForConsultation,
  createDraftArtifact,
  createAmendment,
  ClinicianAuthorizationError,
  ConsultationNotFoundError,
  CompetingAmendmentError,
} from "@/lib/consultation/clinical-artifact-service";

function isAssignedClinician(
  consultationDoctorId: string | null | undefined,
  auth: AuthContext
): boolean {
  if (!consultationDoctorId) return false;
  const effectiveDoctorId = auth.doctorId || auth.userId;
  return (
    consultationDoctorId === effectiveDoctorId ||
    consultationDoctorId.toLowerCase() === effectiveDoctorId.toLowerCase() ||
    consultationDoctorId === auth.userId ||
    consultationDoctorId.toLowerCase() === auth.userId.toLowerCase()
  );
}

const NO_CACHE_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

/**
 * GET /api/consultations/[id]/artifacts
 * Retrieves chronological clinical artifact history for a consultation.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthContext(request);
    const { id: consultationId } = await params;

    // 1. Enforce Authentication
    if (auth.userId === "unauthenticated" && !auth.isDemoMode) {
      return NextResponse.json(
        {
          success: false,
          error: "Unauthorized: Authentication required to view clinical artifacts.",
          code: "UNAUTHORIZED",
        },
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

    // 2. Fetch Consultation to verify ownership & care relationship
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

    // 3. IDOR Protection: only patient owner, assigned clinician, or admin may access
    if (!isOwner && !isClinician && !isAdmin) {
      await logAuditEventAsync({
        actorId: auth.userId,
        actorRole: auth.role,
        action: "ACCESS_DENIED",
        resourceType: "clinical_artifact",
        resourceId: consultationId,
        status: "DENIED",
        metadata: {
          reason: "IDOR: Unauthorized access attempt to consultation clinical artifacts",
          consultationOwnerId: consultation.userId,
          consultationDoctorId: consultation.doctorId,
        },
      });

      return NextResponse.json(
        {
          success: false,
          error: "Forbidden: You are not authorized to view clinical artifacts for this consultation.",
          code: "FORBIDDEN",
        },
        { status: 403, headers: NO_CACHE_HEADERS }
      );
    }

    // 4. Retrieve Artifacts
    const artifacts = await getArtifactsForConsultation(db, consultationId);

    // If caller is patient, only show signed artifacts (draft notes are not patient-accessible)
    const filteredArtifacts =
      auth.role === "patient" && !isAdmin
        ? artifacts.filter((a) => a.status === "signed")
        : artifacts;

    return NextResponse.json(
      { success: true, artifacts: filteredArtifacts },
      { status: 200, headers: NO_CACHE_HEADERS }
    );
  } catch (err: any) {
    console.error("[ClinicalArtifacts GET Error]", err);
    return NextResponse.json(
      { success: false, error: err?.message || "Failed to retrieve clinical artifacts", code: "INTERNAL_ERROR" },
      { status: 500, headers: NO_CACHE_HEADERS }
    );
  }
}

/**
 * POST /api/consultations/[id]/artifacts
 * Creates initial draft artifact OR linked amendment draft.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthContext(request);
    const { id: consultationId } = await params;

    // 1. Enforce Authentication
    if (auth.userId === "unauthenticated" && !auth.isDemoMode) {
      return NextResponse.json(
        {
          success: false,
          error: "Unauthorized: Authentication required to create clinical artifacts.",
          code: "UNAUTHORIZED",
        },
        { status: 401, headers: NO_CACHE_HEADERS }
      );
    }

    // 2. Clinical Authority & Role Check: Only clinician or admin may author notes
    if (auth.role !== "clinician" && auth.role !== "admin") {
      return NextResponse.json(
        {
          success: false,
          error: "Forbidden: Only authorized clinicians or administrators may author clinical artifacts.",
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

    // 3. Verify Consultation & Care Relationship
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
        {
          success: false,
          error: "Forbidden: Care relationship required. Clinician is not assigned to this consultation.",
          code: "FORBIDDEN_CARE_RELATIONSHIP",
        },
        { status: 403, headers: NO_CACHE_HEADERS }
      );
    }

    const body = await request.json().catch(() => ({}));

    // Branch: Amendment Creation vs Initial Draft Creation
    if (body.parentArtifactId) {
      // Linked Amendment
      if (!body.amendmentReason || typeof body.amendmentReason !== "string" || body.amendmentReason.trim().length < 10) {
        return NextResponse.json(
          {
            success: false,
            error: "Clinical amendment requires an auditable justification/reason (minimum 10 characters).",
            code: "INVALID_AMENDMENT_REASON",
          },
          { status: 400, headers: NO_CACHE_HEADERS }
        );
      }

      const amendment = await db.transaction(async (tx) => {
        return await createAmendment(tx, {
          consultationId,
          amendsArtifactId: body.parentArtifactId || body.amendsArtifactId,
          amendmentReason: body.amendmentReason.trim(),
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
        { success: true, artifact: amendment },
        { status: 201, headers: NO_CACHE_HEADERS }
      );
    } else {
      // Initial Draft
      const draft = await db.transaction(async (tx) => {
        return await createDraftArtifact(tx, {
          consultationId,
          chiefComplaint: body.chiefComplaint || consultation.chiefComplaint || "Clinical intake consultation",
          soapSubjective: body.soapSubjective || consultation.soapSubjective || "",
          soapObjective: body.soapObjective || consultation.soapObjective || "",
          soapAssessment: body.soapAssessment || consultation.soapAssessment || "",
          soapPlan: body.soapPlan || consultation.soapPlan || "",
          actorId: auth.userId,
          actorRole: auth.role as "clinician" | "admin",
        });
      });

      return NextResponse.json(
        { success: true, artifact: draft },
        { status: 201, headers: NO_CACHE_HEADERS }
      );
    }
  } catch (err: any) {
    console.error("[ClinicalArtifacts POST Error]", err);
    if (err instanceof CompetingAmendmentError) {
      return NextResponse.json(
        { success: false, error: err.message, code: "COMPETING_AMENDMENT" },
        { status: 409, headers: NO_CACHE_HEADERS }
      );
    }
    if (err instanceof ClinicianAuthorizationError) {
      return NextResponse.json(
        { success: false, error: err.message, code: "FORBIDDEN" },
        { status: 403, headers: NO_CACHE_HEADERS }
      );
    }
    if (err instanceof ConsultationNotFoundError) {
      return NextResponse.json(
        { success: false, error: err.message, code: "NOT_FOUND" },
        { status: 404, headers: NO_CACHE_HEADERS }
      );
    }
    if (err?.statusCode) {
      return NextResponse.json(
        { success: false, error: err.message, code: "ARTIFACT_SERVICE_ERROR" },
        { status: err.statusCode, headers: NO_CACHE_HEADERS }
      );
    }

    return NextResponse.json(
      { success: false, error: err?.message || "Failed to create clinical artifact", code: "INTERNAL_ERROR" },
      { status: 500, headers: NO_CACHE_HEADERS }
    );
  }
}
