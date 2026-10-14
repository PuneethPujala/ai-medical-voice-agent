import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/rbac";
import { logAuditEventAsync } from "@/lib/audit/audit-logger";
import { PatientProfileService, PatientProfileDatabaseError } from "@/lib/patient/patient-profile-service";
import { sanitizeErrorMessage } from "@/lib/security/error-sanitizer";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/patient/profile/[id]
 * Enforces strict multi-tenant isolation. Users can only access their own profiles.
 */
export async function GET(request: Request, context: RouteParams) {
  const requestId = request.headers.get("x-request-id") || crypto.randomUUID();
  try {
    const auth = await getAuthContext(request);
    if (auth.userId === "unauthenticated") {
      return NextResponse.json(
        { success: false, error: "Unauthorized", code: "UNAUTHORIZED", requestId },
        { status: 401, headers: { "x-request-id": requestId } }
      );
    }

    const { id } = await context.params;
    const profile = await PatientProfileService.getProfileById(id, auth.userId);

    if (!profile) {
      return NextResponse.json(
        {
          success: false,
          error: "Profile not found or access denied.",
          code: "NOT_FOUND",
          requestId,
        },
        { status: 404, headers: { "x-request-id": requestId } }
      );
    }

    await logAuditEventAsync({
      actorId: auth.userId,
      actorRole: auth.role,
      action: "PATIENT_PROFILE_ACCESSED",
      resourceType: "patient",
      resourceId: id,
      status: "SUCCESS",
      metadata: { profileId: id, requestId },
    });

    return NextResponse.json(
      { success: true, profile, requestId },
      { headers: { "x-request-id": requestId } }
    );
  } catch (error: any) {
    console.error("[GET /api/patient/profile/[id]] Error:", error);
    if (error instanceof PatientProfileDatabaseError) {
      return NextResponse.json(
        {
          success: false,
          error: "Patient profile datastore is temporarily offline. Please retry shortly.",
          code: "DATASTORE_OFFLINE",
          requestId,
        },
        { status: 503, headers: { "Retry-After": "10", "x-request-id": requestId } }
      );
    }
    return NextResponse.json(
      { success: false, error: sanitizeErrorMessage(error, "Internal server error"), requestId },
      { status: 500, headers: { "x-request-id": requestId } }
    );
  }
}

/**
 * DELETE /api/patient/profile/[id]
 * Soft-deletes a patient profile in compliance with privacy regulations.
 */
export async function DELETE(request: Request, context: RouteParams) {
  const requestId = request.headers.get("x-request-id") || crypto.randomUUID();
  try {
    const auth = await getAuthContext(request);
    if (auth.userId === "unauthenticated") {
      return NextResponse.json(
        { success: false, error: "Unauthorized", code: "UNAUTHORIZED", requestId },
        { status: 401, headers: { "x-request-id": requestId } }
      );
    }

    const { id } = await context.params;
    const success = await PatientProfileService.deleteProfile(id, auth.userId);

    if (!success) {
      return NextResponse.json(
        { success: false, error: "Profile not found or unauthorized to delete.", requestId },
        { status: 404, headers: { "x-request-id": requestId } }
      );
    }

    await logAuditEventAsync({
      actorId: auth.userId,
      actorRole: auth.role,
      action: "PATIENT_PROFILE_DELETED",
      resourceType: "patient",
      resourceId: id,
      status: "SUCCESS",
      metadata: { profileId: id, requestId },
    });

    return NextResponse.json(
      { success: true, message: "Profile deleted successfully.", requestId },
      { headers: { "x-request-id": requestId } }
    );
  } catch (error: any) {
    console.error("[DELETE /api/patient/profile/[id]] Error:", error);
    if (error instanceof PatientProfileDatabaseError) {
      return NextResponse.json(
        {
          success: false,
          error: "Patient profile datastore is temporarily offline. Please retry shortly.",
          code: "DATASTORE_OFFLINE",
          requestId,
        },
        { status: 503, headers: { "Retry-After": "10", "x-request-id": requestId } }
      );
    }
    return NextResponse.json(
      { success: false, error: sanitizeErrorMessage(error, "Internal server error"), requestId },
      { status: 500, headers: { "x-request-id": requestId } }
    );
  }
}
