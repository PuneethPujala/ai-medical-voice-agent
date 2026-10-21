import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/rbac";
import { logAuditEventAsync } from "@/lib/audit/audit-logger";
import { PatientProfileService, PatientProfileDatabaseError } from "@/lib/patient/patient-profile-service";
import { sanitizeErrorMessage } from "@/lib/security/error-sanitizer";

const PHI_RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
  "Pragma": "no-cache",
  "X-Content-Type-Options": "nosniff",
};

/**
 * GET /api/patient/profile
 * Retrieves saved profile(s) for the authenticated user.
 * Supports:
 * - ?all=true -> returns all profiles (self, mother, child, etc.)
 * - ?relationship=mother -> returns profile for specific family member
 * - default -> returns "self" profile
 */
export async function GET(request: Request) {
  const requestId = request.headers.get("x-request-id") || crypto.randomUUID();
  try {
    const auth = await getAuthContext(request);

    if (auth.userId === "unauthenticated") {
      return NextResponse.json(
        {
          success: false,
          error: "Unauthorized: Authentication required to view patient profiles.",
          code: "UNAUTHORIZED",
          requestId,
        },
        { status: 401, headers: { "x-request-id": requestId } }
      );
    }

    const { searchParams } = new URL(request.url);
    const getAll = searchParams.get("all") === "true";
    const relationship = searchParams.get("relationship") || "self";
    const profileId = searchParams.get("id");

    let profile = null;
    let profiles: any[] = [];

    if (getAll) {
      profiles = await PatientProfileService.listProfiles(auth.userId);
      profile = profiles.find((p) => p.relationshipToUser === "self") || profiles[0] || null;
    } else if (profileId) {
      profile = await PatientProfileService.getProfileById(profileId, auth.userId);
    } else {
      profile = await PatientProfileService.getProfileByRelationship(auth.userId, relationship);
      profiles = await PatientProfileService.listProfiles(auth.userId);
    }

    await logAuditEventAsync({
      actorId: auth.userId,
      actorRole: auth.role,
      action: "PATIENT_PROFILE_ACCESSED",
      resourceType: "patient",
      resourceId: profile?.id || auth.userId,
      status: "SUCCESS",
      metadata: { relationship, getAll, found: Boolean(profile), requestId },
    });

    return NextResponse.json(
      {
        success: true,
        profile,
        profiles,
        requestId,
      },
      { headers: { ...PHI_RESPONSE_HEADERS, "x-request-id": requestId } }
    );
  } catch (error: any) {
    console.error("[GET /api/patient/profile] Error:", error);
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
      {
        success: false,
        error: sanitizeErrorMessage(error, "Failed to retrieve patient profile."),
        requestId,
      },
      { status: 500, headers: { "x-request-id": requestId } }
    );
  }
}

/**
 * POST / PUT /api/patient/profile
 * Saves or updates a patient profile for the authenticated user.
 * Supports optional partial updates, multi-patient representation, and DPDP compliance.
 */
export async function POST(request: Request) {
  const requestId = request.headers.get("x-request-id") || crypto.randomUUID();
  try {
    const auth = await getAuthContext(request);

    if (auth.userId === "unauthenticated") {
      return NextResponse.json(
        {
          success: false,
          error: "Unauthorized: Authentication required to save patient profile.",
          code: "UNAUTHORIZED",
          requestId,
        },
        { status: 401, headers: { "x-request-id": requestId } }
      );
    }

    const body = await request.json();

    // Validation: Sanitize strings and check bounds
    if (body.age !== undefined && body.age !== null) {
      const numAge = Number(body.age);
      if (isNaN(numAge) || numAge < 0 || numAge > 130) {
        return NextResponse.json(
          { success: false, error: "Validation Error: Age must be a number between 0 and 130.", requestId },
          { status: 400, headers: { "x-request-id": requestId } }
        );
      }
      body.age = numAge;
    }

    if (body.name && typeof body.name === "string" && body.name.length > 128) {
      return NextResponse.json(
        { success: false, error: "Validation Error: Name cannot exceed 128 characters.", requestId },
        { status: 400, headers: { "x-request-id": requestId } }
      );
    }

    // Save profile via service layer
    const savedProfile = await PatientProfileService.upsertProfile(auth.userId, body);

    await logAuditEventAsync({
      actorId: auth.userId,
      actorRole: auth.role,
      action: "PATIENT_PROFILE_SAVED",
      resourceType: "patient",
      resourceId: savedProfile.id,
      status: "SUCCESS",
      metadata: {
        relationship: savedProfile.relationshipToUser,
        age: savedProfile.age,
        conditionCount: savedProfile.knownConditions?.length || 0,
        medicationCount: savedProfile.currentMedications?.length || 0,
        requestId,
      },
    });

    return NextResponse.json(
      {
        success: true,
        profile: savedProfile,
        message: "Patient profile saved successfully.",
        requestId,
      },
      { headers: { ...PHI_RESPONSE_HEADERS, "x-request-id": requestId } }
    );
  } catch (error: any) {
    console.error("[POST /api/patient/profile] Error:", error);
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
      {
        success: false,
        error: sanitizeErrorMessage(error, "Failed to save patient profile."),
        requestId,
      },
      { status: 500, headers: { "x-request-id": requestId } }
    );
  }
}

export const PUT = POST;
