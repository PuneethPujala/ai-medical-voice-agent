import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/rbac";
import { logAuditEventAsync } from "@/lib/audit/audit-logger";
import { PatientProfileService } from "@/lib/patient/patient-profile-service";
import { LongitudinalFactService } from "@/lib/patient/longitudinal-fact-service";
import type { LongitudinalPatientFact } from "@/lib/patient/longitudinal-fact-types";

const PHI_RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
  "Pragma": "no-cache",
  "X-Content-Type-Options": "nosniff",
};

export interface CategorizedClinicalFacts {
  clinicianConfirmed: LongitudinalPatientFact[];
  patientReported: LongitudinalPatientFact[];
  confirmedNone: Array<{ domain: string; statement: string; source: string }>;
  uncollected: Array<{ domain: string; reason: string }>;
}

/**
 * GET /api/patient/longitudinal-facts
 * Server-authoritative endpoint retrieving active longitudinal facts and baseline
 * clinical observations for the authenticated user's self-profile.
 *
 * Invariants:
 * 1. Strict server-side profile derivation (never trusts client-supplied profile/user IDs).
 * 2. Strict DPDP / HIPAA consent gate: if consent is withheld or absent, zero PHI facts are returned.
 * 3. Categorizes observations into: clinician_confirmed, patient_reported, confirmed_none, and uncollected.
 * 4. Strictly private, non-cacheable headers.
 */
export async function GET(request: Request) {
  const requestId = request.headers.get("x-request-id") || crypto.randomUUID();

  try {
    const auth = await getAuthContext(request);

    if (auth.userId === "unauthenticated") {
      return NextResponse.json(
        {
          success: false,
          error: "Unauthorized: Authentication required to access longitudinal health facts.",
          code: "UNAUTHORIZED",
          requestId,
        },
        { status: 401, headers: { ...PHI_RESPONSE_HEADERS, "x-request-id": requestId } }
      );
    }

    // Derive the user's primary self profile server-side
    const profile = await PatientProfileService.getSelfProfile(auth.userId);

    if (!profile) {
      await logAuditEventAsync({
        actorId: auth.userId,
        actorRole: auth.role,
        action: "LONGITUDINAL_FACTS_ACCESSED",
        resourceType: "patient",
        resourceId: auth.userId,
        status: "SUCCESS",
        metadata: { foundProfile: false, consentGiven: false, factsCount: 0, requestId },
      });

      return NextResponse.json(
        {
          success: true,
          consentNotice: true,
          message: "No patient profile found. Please configure a patient profile to enable longitudinal records.",
          facts: [],
          categorized: {
            clinicianConfirmed: [],
            patientReported: [],
            confirmedNone: [],
            uncollected: [
              { domain: "Allergies", reason: "Profile not configured" },
              { domain: "Current Medications", reason: "Profile not configured" },
              { domain: "Medical History", reason: "Profile not configured" },
            ],
          },
          profileSummary: null,
          requestId,
        },
        { headers: { ...PHI_RESPONSE_HEADERS, "x-request-id": requestId } }
      );
    }

    // DPDP & Privacy Consent Gate
    if (!profile.consentGiven) {
      await logAuditEventAsync({
        actorId: auth.userId,
        actorRole: auth.role,
        action: "LONGITUDINAL_FACTS_ACCESSED",
        resourceType: "patient",
        resourceId: profile.id,
        status: "DENIED",
        metadata: {
          reason: "Consent not granted for longitudinal processing",
          profileId: profile.id,
          requestId,
        },
      });

      return NextResponse.json(
        {
          success: true,
          consentNotice: true,
          message: "Longitudinal health records processing requires active patient consent under DPDP regulations.",
          facts: [],
          categorized: {
            clinicianConfirmed: [],
            patientReported: [],
            confirmedNone: [],
            uncollected: [],
          },
          profileSummary: {
            profileId: profile.id,
            name: profile.name,
            consentGiven: false,
            consentTimestamp: profile.consentTimestamp,
          },
          requestId,
        },
        { headers: { ...PHI_RESPONSE_HEADERS, "x-request-id": requestId } }
      );
    }

    // Retrieve active longitudinal facts from the authoritative datastore
    const rawFacts = await LongitudinalFactService.getActiveFacts(auth.userId, profile.id);

    // Grounded categorization of facts and clinical domains
    const clinicianConfirmed: LongitudinalPatientFact[] = [];
    const patientReported: LongitudinalPatientFact[] = [];
    const confirmedNone: Array<{ domain: string; statement: string; source: string }> = [];
    const uncollected: Array<{ domain: string; reason: string }> = [];

    for (const fact of rawFacts) {
      const valLower = (fact.reportedValue || "").toLowerCase();
      const isNegated =
        valLower === "none" ||
        valLower === "no" ||
        valLower === "denies" ||
        valLower === "no known" ||
        valLower === "absent" ||
        valLower === "negative";

      if (isNegated) {
        confirmedNone.push({
          domain: fact.concept.replace(/_/g, " "),
          statement: fact.reportedValue,
          source: fact.verification === "clinician_confirmed" ? "Clinician Verified" : "Patient Stated",
        });
      } else if (fact.verification === "clinician_confirmed") {
        clinicianConfirmed.push(fact);
      } else {
        patientReported.push(fact);
      }
    }

    // Domain evaluation from structured profile: Allergies
    if (profile.allergyStatus === "none_known" || (profile.drugAllergies && profile.drugAllergies.length === 0 && profile.allergyStatus !== "unassessed")) {
      confirmedNone.push({
        domain: "Drug Allergies",
        statement: "No Known Drug Allergies (NKDA)",
        source: "Profile Baseline",
      });
    } else if (profile.allergyStatus === "unassessed") {
      uncollected.push({
        domain: "Allergies",
        reason: "Allergy status currently unassessed",
      });
    }

    // Domain evaluation: Tobacco / Smoking
    if (profile.smokingStatus === "never") {
      confirmedNone.push({
        domain: "Tobacco Use",
        statement: "Lifetime Non-Smoker",
        source: "Profile Baseline",
      });
    } else if (profile.smokingStatus === "unknown") {
      uncollected.push({
        domain: "Tobacco & Smoking",
        reason: "Smoking history unrecorded",
      });
    }

    // Baseline category coverage checks
    const activeCategories = new Set(rawFacts.map((f) => f.category));
    if (!activeCategories.has("lifestyle_sleep")) {
      uncollected.push({
        domain: "Sleep Baseline",
        reason: "No baseline sleep observation recorded",
      });
    }
    if (!activeCategories.has("functional_mobility")) {
      uncollected.push({
        domain: "Functional Mobility",
        reason: "No functional mobility score recorded",
      });
    }

    await logAuditEventAsync({
      actorId: auth.userId,
      actorRole: auth.role,
      action: "LONGITUDINAL_FACTS_ACCESSED",
      resourceType: "patient",
      resourceId: profile.id,
      status: "SUCCESS",
      metadata: {
        profileId: profile.id,
        factsCount: rawFacts.length,
        clinicianConfirmedCount: clinicianConfirmed.length,
        patientReportedCount: patientReported.length,
        confirmedNoneCount: confirmedNone.length,
        uncollectedCount: uncollected.length,
        requestId,
      },
    });

    return NextResponse.json(
      {
        success: true,
        consentNotice: false,
        facts: rawFacts,
        categorized: {
          clinicianConfirmed,
          patientReported,
          confirmedNone,
          uncollected,
        },
        profileSummary: {
          profileId: profile.id,
          name: profile.name,
          knownConditions: profile.knownConditions || [],
          currentMedications: profile.currentMedications || [],
          drugAllergies: profile.drugAllergies || [],
          allergyStatus: profile.allergyStatus,
          smokingStatus: profile.smokingStatus,
          consentGiven: profile.consentGiven,
          consentTimestamp: profile.consentTimestamp,
        },
        requestId,
      },
      { headers: { ...PHI_RESPONSE_HEADERS, "x-request-id": requestId } }
    );
  } catch (error: any) {
    console.error("[GET /api/patient/longitudinal-facts] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to retrieve longitudinal health facts.",
        code: "INTERNAL_ERROR",
        requestId,
      },
      { status: 500, headers: { ...PHI_RESPONSE_HEADERS, "x-request-id": requestId } }
    );
  }
}
