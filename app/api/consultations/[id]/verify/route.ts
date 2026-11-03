import { NextResponse } from "next/server";
import { getDb } from "@/config/db";
import { consultationsTable, auditEventsTable } from "@/config/schema";
import { eq, and, desc } from "drizzle-orm";
import { memoryConsultations } from "../../route";
import { getAuthContext, hasPermission, AuthContext } from "@/lib/auth/rbac";
import {
  computeCanonicalConsultationDigest,
  verifyEventIntegrity,
  getAuditEvents,
  AuditEvent,
} from "@/lib/audit/audit-logger";

function isClinicianAssigned(
  consultationDoctorId: string | null | undefined,
  authCtx: AuthContext
): boolean {
  if (!consultationDoctorId || typeof consultationDoctorId !== "string" || consultationDoctorId.trim().length === 0) {
    return false;
  }
  const targetId = consultationDoctorId.trim().toLowerCase();

  // 1. Primary: Match against resolved physician profile doctorId (e.g. "dr-sarah-chen")
  if (
    authCtx.doctorId &&
    typeof authCtx.doctorId === "string" &&
    authCtx.doctorId.trim().length > 0 &&
    authCtx.doctorId.trim().toLowerCase() === targetId
  ) {
    return true;
  }

  // 2. Fallback: Match against Clerk userId ONLY if the encounter explicitly recorded the clinician's Clerk userId.
  // Security guard against identity mismatch and bypass:
  // - Clinician userId must not be unauthenticated or anonymous
  // - Strict equality check after sanitization
  if (
    authCtx.userId &&
    typeof authCtx.userId === "string" &&
    authCtx.userId !== "unauthenticated" &&
    authCtx.userId !== "anon-user" &&
    authCtx.userId.trim().length > 0 &&
    authCtx.userId.trim().toLowerCase() === targetId
  ) {
    return true;
  }

  return false;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthContext(request);
    const { id } = await params;

    // 1. Enforce Authentication
    if (auth.userId === "unauthenticated" && !auth.isDemoMode) {
      return NextResponse.json(
        {
          success: false,
          error: "Unauthorized: Authentication required to verify consultation ledger.",
          code: "UNAUTHORIZED",
        },
        { status: 401 }
      );
    }

    // 2. Lookup record
    let record: any = null;
    const dbClient = getDb();

    if (dbClient) {
      try {
        const records = await dbClient
          .select()
          .from(consultationsTable)
          .where(eq(consultationsTable.id, id))
          .limit(1);

        if (records.length > 0) {
          record = records[0];
        }
      } catch (err) {
        console.error("[VerifyRoute] DB lookup error:", err);
      }
    }

    if (!record) {
      record = memoryConsultations.find((c) => c.id === id);
    }

    if (!record) {
      return NextResponse.json(
        {
          success: false,
          error: "Consultation record not found.",
          code: "NOT_FOUND",
        },
        { status: 404 }
      );
    }

    // 3. Ownership & IDOR Protection
    const isOwner =
      record.userId === auth.userId ||
      (auth.isDemoMode && (record.userId === "anon-user" || record.userId === auth.userId));
    const isAssignedClinician =
      auth.role === "clinician" && isClinicianAssigned(record.doctorId, auth);
    // Explicit permission enforcement for administrative verification:
    // Admin role alone is insufficient; caller must possess an explicit audit permission.
    const hasExplicitAuditPermission = Boolean(
      auth.permissions && (
        auth.permissions.includes("audit:verify") ||
        auth.permissions.includes("audit:read") ||
        auth.permissions.includes("system:read")
      )
    );
    const isAdmin = auth.role === "admin" && hasExplicitAuditPermission;

    if (!isOwner && !isAdmin && !isAssignedClinician) {
      return NextResponse.json(
        {
          success: false,
          error: "Forbidden: You are not authorized to verify this consultation record.",
          code: "FORBIDDEN",
        },
        { status: 403 }
      );
    }

    // 4. Compute current canonical digest
    const currentDigest = computeCanonicalConsultationDigest(record);

    // 5. Retrieve audit events for this resource
    let auditEvents: AuditEvent[] = [];

    if (dbClient) {
      try {
        const rows = await dbClient
          .select()
          .from(auditEventsTable)
          .where(
            and(
              eq(auditEventsTable.resourceId, id),
              eq(auditEventsTable.resourceType, "consultation")
            )
          )
          .orderBy(desc(auditEventsTable.index));

        auditEvents = rows.map((r: any) => ({
          index: r.index,
          id: r.id,
          timestamp: r.timestamp,
          actorId: r.actorId,
          actorRole: r.actorRole,
          action: r.action,
          resourceType: r.resourceType,
          resourceId: r.resourceId,
          status: r.status,
          clientIp: r.clientIp || undefined,
          metadata: r.metadata as Record<string, any> | undefined,
          previousHash: r.previousHash,
          eventHash: r.eventHash,
        }));
      } catch (err) {
        console.warn("[VerifyRoute] Could not query audit_events from DB, falling back to memory:", err);
      }
    }

    if (auditEvents.length === 0) {
      // Memory fallback
      auditEvents = getAuditEvents(500)
        .filter((e) => e.resourceId === id && e.resourceType === "consultation")
        .reverse();
    }

    // 6. Find latest audit event with a recorded recordDigest
    const digestEvent = auditEvents.find(
      (e) => e.metadata && typeof e.metadata.recordDigest === "string"
    );

    if (!digestEvent || !digestEvent.metadata?.recordDigest) {
      return NextResponse.json({
        success: true,
        status: "UNAVAILABLE",
        computedDigest: currentDigest,
        recordedDigest: null,
        message: "No cryptographic audit ledger digest recorded for this consultation.",
      });
    }

    // 7. Verify the integrity of the audit event itself
    const eventIntegrity = verifyEventIntegrity(digestEvent);
    if (!eventIntegrity.valid) {
      return NextResponse.json({
        success: true,
        status: "CORRUPTED_LEDGER",
        computedDigest: currentDigest,
        recordedDigest: digestEvent.metadata.recordDigest,
        eventId: digestEvent.id,
        message: `Audit ledger event tampering detected (${eventIntegrity.reason || "event hash mismatch"}).`,
      });
    }

    // 8. Compare computed digest with recorded digest
    const recordedDigest = digestEvent.metadata.recordDigest;
    const isVerified = recordedDigest === currentDigest;

    if (isVerified) {
      return NextResponse.json({
        success: true,
        status: "VERIFIED",
        computedDigest: currentDigest,
        recordedDigest,
        eventId: digestEvent.id,
        eventIndex: digestEvent.index,
        timestamp: digestEvent.timestamp,
        action: digestEvent.action,
        message: "Record cryptographically matches server audit ledger.",
      });
    }

    return NextResponse.json({
      success: true,
      status: "MISMATCH",
      computedDigest: currentDigest,
      recordedDigest,
      eventId: digestEvent.id,
      eventIndex: digestEvent.index,
      timestamp: digestEvent.timestamp,
      action: digestEvent.action,
      message: "Consultation contents deviate from cryptographically sealed ledger record.",
    });
  } catch (error: any) {
    console.error("[VerifyRouteError]", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to perform cryptographic ledger verification.",
        code: "INTERNAL_ERROR",
      },
      { status: 500 }
    );
  }
}
