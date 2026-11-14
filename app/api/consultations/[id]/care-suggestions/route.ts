import { NextResponse } from "next/server";
import { getDb } from "@/config/db";
import { consultationsTable, clinicalArtifactsTable } from "@/config/schema";
import { eq, desc } from "drizzle-orm";
import { memoryConsultations } from "../../route";
import { getAuthContext, AuthContext } from "@/lib/auth/rbac";
import { logAuditEventAsync } from "@/lib/audit/audit-logger";
import {
  evaluateRateLimit,
  buildRateLimit429Response,
  RATE_LIMIT_POLICIES,
} from "@/lib/security/rate-limiter";
import { CareSuggestionService } from "@/lib/care-suggestions/care-suggestion-service";
import { PatientProfileService } from "@/lib/patient/patient-profile-service";

function isAssignedClinician(
  consultationDoctorId: string | null | undefined,
  auth: AuthContext
): boolean {
  if (!consultationDoctorId || typeof consultationDoctorId !== "string" || consultationDoctorId.trim().length === 0) {
    return false;
  }
  const targetId = consultationDoctorId.trim().toLowerCase();
  if (auth.doctorId && typeof auth.doctorId === "string" && auth.doctorId.trim().toLowerCase() === targetId) {
    return true;
  }
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
 * GET /api/consultations/[id]/care-suggestions
 * Retrieves existing saved care suggestions for a consultation.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthContext(request);
    const { id: consultationId } = await params;

    // 1. Authentication check
    if (auth.userId === "unauthenticated" && !auth.isDemoMode) {
      return NextResponse.json(
        { success: false, error: "Unauthorized: Authentication required.", code: "UNAUTHORIZED" },
        { status: 401, headers: NO_CACHE_HEADERS }
      );
    }

    // 2. Fetch Consultation to verify ownership / authorization
    const db = getDb();
    let consultation: any = null;

    if (db) {
      try {
        const rows = await db
          .select()
          .from(consultationsTable)
          .where(eq(consultationsTable.id, consultationId))
          .limit(1);
        if (rows.length > 0) consultation = rows[0];
      } catch (dbErr) {
        console.warn("[CareSuggestions GET] DB query notice:", dbErr);
      }
    }

    if (!consultation) {
      consultation = memoryConsultations.find((c) => c.id === consultationId);
    }

    if (!consultation) {
      return NextResponse.json(
        { success: false, error: "Consultation not found.", code: "NOT_FOUND" },
        { status: 404, headers: NO_CACHE_HEADERS }
      );
    }

    // 3. Ownership / Authorization Check
    const isOwner =
      consultation.userId === auth.userId ||
      (auth.isDemoMode && (consultation.userId === "anon-user" || consultation.userId === auth.userId));
    const isClinician = auth.role === "clinician" && isAssignedClinician(consultation.doctorId, auth);
    const isAdmin = auth.role === "admin";

    if (!isOwner && !isClinician && !isAdmin) {
      await logAuditEventAsync({
        actorId: auth.userId,
        actorRole: auth.role,
        action: "ACCESS_DENIED",
        resourceType: "consultation",
        resourceId: consultationId,
        status: "DENIED",
        metadata: { reason: "IDOR: Unauthorized access attempt to care suggestions" },
      });

      return NextResponse.json(
        { success: false, error: "Forbidden: Not authorized to view care suggestions.", code: "FORBIDDEN" },
        { status: 403, headers: NO_CACHE_HEADERS }
      );
    }

    // 4. Retrieve Saved Suggestions
    const careSuggestions = await CareSuggestionService.getSavedSuggestions(consultationId);

    return NextResponse.json(
      {
        success: true,
        consultationId,
        hasSavedSuggestions: Boolean(careSuggestions),
        careSuggestions: careSuggestions || null,
      },
      { status: 200, headers: NO_CACHE_HEADERS }
    );
  } catch (err: any) {
    console.error("[CareSuggestions GET Error]", err);
    return NextResponse.json(
      { success: false, error: err?.message || "Failed to retrieve care suggestions." },
      { status: 500, headers: NO_CACHE_HEADERS }
    );
  }
}

/**
 * POST /api/consultations/[id]/care-suggestions
 * Generates structured care suggestions for a consultation.
 * Supports Scenario A (SOAP Available) and Scenario B (SOAP Unavailable Fallback).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthContext(request);
    const { id: consultationId } = await params;

    // 1. Authentication Check
    if (auth.userId === "unauthenticated" && !auth.isDemoMode) {
      return NextResponse.json(
        { success: false, error: "Unauthorized: Authentication required.", code: "UNAUTHORIZED" },
        { status: 401, headers: NO_CACHE_HEADERS }
      );
    }

    // 2. Distributed Rate Limiting
    const rateLimit = await evaluateRateLimit({
      policy: RATE_LIMIT_POLICIES.CONSULTATION_MUTATION,
      userId: auth.userId,
      request,
    });
    if (!rateLimit.allowed) {
      return buildRateLimit429Response(rateLimit);
    }

    // 3. Fetch Consultation
    const db = getDb();
    let consultation: any = null;

    if (db) {
      try {
        const rows = await db
          .select()
          .from(consultationsTable)
          .where(eq(consultationsTable.id, consultationId))
          .limit(1);
        if (rows.length > 0) consultation = rows[0];
      } catch (dbErr) {
        console.warn("[CareSuggestions POST] DB query notice:", dbErr);
      }
    }

    if (!consultation) {
      consultation = memoryConsultations.find((c) => c.id === consultationId);
    }

    if (!consultation) {
      return NextResponse.json(
        { success: false, error: "Consultation not found.", code: "NOT_FOUND" },
        { status: 404, headers: NO_CACHE_HEADERS }
      );
    }

    // 4. Ownership / Authorization Check
    const isOwner =
      consultation.userId === auth.userId ||
      (auth.isDemoMode && (consultation.userId === "anon-user" || consultation.userId === auth.userId));
    const isClinician = auth.role === "clinician" && isAssignedClinician(consultation.doctorId, auth);
    const isAdmin = auth.role === "admin";

    if (!isOwner && !isClinician && !isAdmin) {
      await logAuditEventAsync({
        actorId: auth.userId,
        actorRole: auth.role,
        action: "ACCESS_DENIED",
        resourceType: "consultation",
        resourceId: consultationId,
        status: "DENIED",
        metadata: { reason: "IDOR: Unauthorized attempt to generate care suggestions" },
      });

      return NextResponse.json(
        { success: false, error: "Forbidden: Not authorized to generate care suggestions for this consultation.", code: "FORBIDDEN" },
        { status: 403, headers: NO_CACHE_HEADERS }
      );
    }

    // 5. Parse Optional Client Body Overrides (e.g. latest transcript from active UI session)
    const body = await request.json().catch(() => ({}));
    const transcript =
      Array.isArray(body.transcript) && body.transcript.length > 0
        ? body.transcript
        : Array.isArray(consultation.transcript) && consultation.transcript.length > 0
        ? consultation.transcript
        : [];

    if (transcript.length === 0 && !consultation.chiefComplaint && !consultation.soapSubjective) {
      return NextResponse.json(
        {
          success: false,
          error: "Insufficient clinical information: No consultation dialogue transcript or clinical notes available to generate care suggestions.",
          code: "INSUFFICIENT_DATA",
        },
        { status: 400, headers: NO_CACHE_HEADERS }
      );
    }

    // 6. Retrieve SOAP Data (Check DB artifacts, then consultation record)
    let soapReport: { subjective?: string; objective?: string; assessment?: string; plan?: string } | null = null;
    let soapArtifactId: string | null = null;

    if (db) {
      try {
        const artifacts = await db
          .select()
          .from(clinicalArtifactsTable)
          .where(eq(clinicalArtifactsTable.consultationId, consultationId))
          .orderBy(desc(clinicalArtifactsTable.version))
          .limit(1);

        if (artifacts.length > 0) {
          const art = artifacts[0];
          soapArtifactId = art.id;
          soapReport = {
            subjective: art.soapSubjective,
            objective: art.soapObjective,
            assessment: art.soapAssessment,
            plan: art.soapPlan,
          };
        }
      } catch (artErr) {
        console.warn("[CareSuggestions POST] Artifact lookup notice:", artErr);
      }
    }

    // Fallback to consultation table SOAP fields if artifact wasn't found
    if (!soapReport && (consultation.soapSubjective || consultation.soapAssessment)) {
      soapReport = {
        subjective: consultation.soapSubjective || undefined,
        objective: consultation.soapObjective || undefined,
        assessment: consultation.soapAssessment || undefined,
        plan: consultation.soapPlan || undefined,
      };
    }

    // Client body SOAP override if passed
    if (body.soap && (body.soap.subjective || body.soap.assessment)) {
      soapReport = {
        subjective: body.soap.subjective,
        objective: body.soap.objective,
        assessment: body.soap.assessment,
        plan: body.soap.plan,
      };
    }

    // 7. Retrieve Patient Profile if available
    let patientProfile: any = null;
    if (consultation.patientProfileId) {
      try {
        patientProfile = await PatientProfileService.getProfileById(consultation.patientProfileId, auth.userId);
      } catch {
        // Non-critical profile retrieval fallback
      }
    }

    // 8. Generate Structured Care Suggestions
    const careSuggestions = await CareSuggestionService.generateSuggestions({
      consultationId,
      transcript,
      soapReport,
      soapArtifactId,
      patientProfile,
      chiefComplaint: consultation.chiefComplaint || body.chiefComplaint,
      esiScore: consultation.esiScore ?? body.esiScore ?? null,
      triageLevel: consultation.triageLevel || body.triageLevel,
      doctorId: consultation.doctorId,
      doctorName: consultation.doctorName,
      specialty: consultation.specialty,
      actorId: auth.userId,
      actorRole: auth.role,
    });

    return NextResponse.json(
      {
        success: true,
        consultationId,
        source: careSuggestions.source,
        sourceDisplay: careSuggestions.sourceDisplay,
        soapAvailable: careSuggestions.soapAvailable,
        careSuggestions,
      },
      { status: 200, headers: NO_CACHE_HEADERS }
    );
  } catch (err: any) {
    console.error("[CareSuggestions POST Error]", err);
    return NextResponse.json(
      { success: false, error: err?.message || "Failed to generate care suggestions." },
      { status: 500, headers: NO_CACHE_HEADERS }
    );
  }
}
