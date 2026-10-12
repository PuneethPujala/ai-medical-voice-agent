import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/rbac";
import { logAuditEventAsync } from "@/lib/audit/audit-logger";
import { PatientProfileService } from "@/lib/patient/patient-profile-service";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/patient/profile/[id]
 * Enforces strict multi-tenant isolation. Users can only access their own profiles.
 */
export async function GET(request: Request, context: RouteParams) {
  try {
    const auth = await getAuthContext(request);
    if (auth.userId === "unauthenticated") {
      return NextResponse.json(
        { success: false, error: "Unauthorized", code: "UNAUTHORIZED" },
        { status: 401 }
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
        },
        { status: 404 }
      );
    }

    await logAuditEventAsync({
      actorId: auth.userId,
      actorRole: auth.role,
      action: "PATIENT_PROFILE_ACCESSED",
      resourceType: "patient",
      resourceId: id,
      status: "SUCCESS",
      metadata: { profileId: id },
    });

    return NextResponse.json({ success: true, profile });
  } catch (error: any) {
    console.error("[GET /api/patient/profile/[id]] Error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error", details: error?.message },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/patient/profile/[id]
 * Soft-deletes a patient profile in compliance with privacy regulations.
 */
export async function DELETE(request: Request, context: RouteParams) {
  try {
    const auth = await getAuthContext(request);
    if (auth.userId === "unauthenticated") {
      return NextResponse.json(
        { success: false, error: "Unauthorized", code: "UNAUTHORIZED" },
        { status: 401 }
      );
    }

    const { id } = await context.params;
    const success = await PatientProfileService.deleteProfile(id, auth.userId);

    if (!success) {
      return NextResponse.json(
        { success: false, error: "Profile not found or unauthorized to delete." },
        { status: 404 }
      );
    }

    await logAuditEventAsync({
      actorId: auth.userId,
      actorRole: auth.role,
      action: "PATIENT_PROFILE_DELETED",
      resourceType: "patient",
      resourceId: id,
      status: "SUCCESS",
      metadata: { profileId: id },
    });

    return NextResponse.json({ success: true, message: "Profile deleted successfully." });
  } catch (error: any) {
    console.error("[DELETE /api/patient/profile/[id]] Error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error", details: error?.message },
      { status: 500 }
    );
  }
}
