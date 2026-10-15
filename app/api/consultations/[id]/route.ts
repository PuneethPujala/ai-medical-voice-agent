import { NextResponse } from "next/server";
import { getDb } from "@/config/db";
import { consultationsTable } from "@/config/schema";
import { and, eq, ne } from "drizzle-orm";
import { memoryConsultations } from "../route";
import { getAuthContext, hasPermission } from "@/lib/auth/rbac";
import { logAuditEventAsync } from "@/lib/audit/audit-logger";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthContext(request);
    const { id } = await params;

    // 1. Enforce Authentication (401 for unauthenticated requests unless in test/demo mode)
    if (auth.userId === "unauthenticated" && !auth.isDemoMode) {
      await logAuditEventAsync({
        actorId: "unauthenticated",
        actorRole: "patient",
        action: "ACCESS_DENIED",
        resourceType: "consultation",
        resourceId: id,
        status: "DENIED",
        metadata: { reason: "Unauthenticated request attempted to read consultation record" },
      });

      return NextResponse.json(
        {
          success: false,
          error: "Unauthorized: Authentication required to view consultation records.",
          code: "UNAUTHORIZED",
        },
        { status: 401 }
      );
    }

    // 2. Lookup record in Neon database
    let record: any = null;
    const dbClient = getDb();
    let dbError: any = null;

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
        dbError = err;
        console.error("DB lookup error:", err);
      }
    }

    // In production, database failure must never fall back to synthetic clinical records
    if (process.env.NODE_ENV === "production") {
      if (dbError || !dbClient) {
        return NextResponse.json(
          {
            success: false,
            error: "Clinical records service unavailable. Database connection could not be established.",
            code: "SERVICE_UNAVAILABLE",
          },
          { status: 503 }
        );
      }
      if (!record) {
        return NextResponse.json(
          { success: false, message: "Consultation report not found" },
          { status: 404 }
        );
      }
    }

    // Fallback to memory store strictly for development and test environments
    if (!record) {
      record = memoryConsultations.find((c) => c.id === id);
    }

    if (!record) {
      return NextResponse.json(
        { success: false, message: "Consultation report not found" },
        { status: 404 }
      );
    }

    // 3. Ownership & IDOR Protection:
    // Patients can only view their own consultations (record.userId === auth.userId).
    // Assigned clinicians (record.doctorId === auth.userId) may view records for clinical review.
    // Platform administrators (with system:read / analytics:read) have authority to inspect.
    const isOwner = record.userId === auth.userId || (auth.isDemoMode && (record.userId === "anon-user" || record.userId === auth.userId));
    const isAssignedClinician = auth.role === "clinician" && Boolean(
      record.doctorId && (
        record.doctorId === auth.userId ||
        record.doctorId.toLowerCase() === auth.userId.toLowerCase()
      )
    );
    const isAdmin = auth.role === "admin";

    if (!isOwner && !isAdmin && !isAssignedClinician) {
      await logAuditEventAsync({
        actorId: auth.userId,
        actorRole: auth.role,
        action: "ACCESS_DENIED",
        resourceType: "consultation",
        resourceId: id,
        status: "DENIED",
        metadata: {
          reason: "IDOR prevention: Unauthorized attempt to access another patient's consultation",
          recordOwnerId: record.userId,
          recordDoctorId: record.doctorId,
          attemptedBy: auth.userId,
          attemptedRole: auth.role,
        },
      });

      return NextResponse.json(
        {
          success: false,
          error: "Forbidden: You are only authorized to access your own clinical consultation records or assigned patient encounters.",
          code: "FORBIDDEN",
        },
        { status: 403 }
      );
    }

    // 4. Log consultation access in durable audit ledger
    await logAuditEventAsync({
      actorId: auth.userId,
      actorRole: auth.role,
      action: "CONSULTATION_ACCESSED",
      resourceType: "consultation",
      resourceId: id,
      status: "SUCCESS",
      metadata: {
        triageLevel: record.triageLevel,
        specialty: record.specialty,
        isOwner,
        isAdmin,
      },
    });

    return NextResponse.json({ success: true, consultation: record });
  } catch (error: any) {
    console.error("[ConsultationByIdError]", error);
    return NextResponse.json(
      { success: false, error: process.env.NODE_ENV === "production" ? "Internal server error retrieving consultation" : (error?.message || "Internal server error") },
      { status: 500 }
    );
  }
}

export async function PATCH(
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
          error: "Unauthorized: Authentication required to modify consultation records.",
          code: "UNAUTHORIZED",
        },
        { status: 401 }
      );
    }

    // 2. Fetch existing consultation
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
        console.error("DB lookup error on PATCH:", err);
        return NextResponse.json(
          { success: false, error: "Clinical datastore unavailable", code: "SERVICE_UNAVAILABLE" },
          { status: 503 }
        );
      }
    } else {
      record = memoryConsultations.find((c) => c.id === id);
    }

    if (!record) {
      return NextResponse.json(
        { success: false, message: "Consultation report not found" },
        { status: 404 }
      );
    }

    // 3. Ownership & Clinical Authority Check
    // - Patients can only access their own records (record.userId === auth.userId)
    // - Clinicians with consultations:approve authority can review and sign patient charts
    // - Administrators can access records for maintenance
    const isOwner = record.userId === auth.userId || (auth.isDemoMode && (record.userId === "anon-user" || record.userId === auth.userId));
    const isAssignedClinician = auth.role === "clinician" && Boolean(
      record.doctorId && (
        record.doctorId === auth.userId ||
        record.doctorId.toLowerCase() === auth.userId.toLowerCase()
      )
    );
    const isAdmin = auth.role === "admin";
    const canApprove = hasPermission(auth.role, "consultations:approve") && (isAssignedClinician || isAdmin);

    if (!isOwner && !canApprove && !isAdmin) {
      await logAuditEventAsync({
        actorId: auth.userId,
        actorRole: auth.role,
        action: "ACCESS_DENIED",
        resourceType: "consultation",
        resourceId: id,
        status: "DENIED",
        metadata: {
          reason: "IDOR prevention on PATCH: Unauthorized attempt to mutate consultation record",
          recordOwnerId: record.userId,
          recordDoctorId: record.doctorId,
          attemptedBy: auth.userId,
          attemptedRole: auth.role,
        },
      });

      const isUnassignedClinician = auth.role === "clinician";
      return NextResponse.json(
        {
          success: false,
          error: isUnassignedClinician
            ? "Forbidden: Care relationship required. Clinicians can only access and sign patient encounters assigned to them."
            : "Forbidden: You are not authorized to modify another patient's consultation.",
          code: isUnassignedClinician ? "FORBIDDEN_CARE_RELATIONSHIP" : "FORBIDDEN",
        },
        { status: 403 }
      );
    }

    const body = await request.json();
    const action = body.action || "update";
    const isApproving = action === "approve" || body.status === "approved";

    // Clinical signing authority validation:
    // Only clinicians and administrators possess authority to sign or approve medical records.
    if (isApproving && !hasPermission(auth.role, "consultations:approve")) {
      await logAuditEventAsync({
        actorId: auth.userId,
        actorRole: auth.role,
        action: "ACCESS_DENIED",
        resourceType: "consultation",
        resourceId: id,
        status: "DENIED",
        metadata: {
          reason: "Unauthorized attempt to sign or approve consultation without clinical signing authority",
          userRole: auth.role,
        },
      });

      return NextResponse.json(
        {
          success: false,
          error: "Forbidden: Clinical signing authority required to approve medical records. Only clinicians and administrators may sign notes.",
          code: "FORBIDDEN_SIGNING_AUTHORITY",
        },
        { status: 403 }
      );
    }

    // Care relationship validation:
    // Clinicians may only sign/approve encounters assigned to their clinical care relationship.
    if (isApproving && auth.role === "clinician" && !isAssignedClinician && !isAdmin) {
      await logAuditEventAsync({
        actorId: auth.userId,
        actorRole: auth.role,
        action: "ACCESS_DENIED",
        resourceType: "consultation",
        resourceId: id,
        status: "DENIED",
        metadata: {
          reason: "Unauthorized clinician attempt to approve consultation without assigned care relationship",
          recordDoctorId: record.doctorId,
          attemptedBy: auth.userId,
        },
      });

      return NextResponse.json(
        {
          success: false,
          error: "Forbidden: Care relationship required. Clinicians can only sign patient encounters assigned to them.",
          code: "FORBIDDEN_CARE_RELATIONSHIP",
        },
        { status: 403 }
      );
    }

    // STATE MACHINE RULE 0: Idempotent Retry Check
    if (body.idempotencyKey && record.idempotencyKey && body.idempotencyKey === record.idempotencyKey) {
      return NextResponse.json({
        success: true,
        consultation: record,
        isIdempotentRetry: true,
      });
    }

    // STATE MACHINE RULE 0.5: Optimistic Concurrency Check (caseVersion & version)
    const expectedVersion = record.caseVersion !== undefined ? Number(record.caseVersion) : (record.version !== undefined ? Number(record.version) : 1);
    const submittedVersion = body.caseVersion !== undefined ? Number(body.caseVersion) : (body.version !== undefined ? Number(body.version) : undefined);
    if (submittedVersion !== undefined) {
      if (submittedVersion <= expectedVersion) {
        return NextResponse.json(
          {
            success: false,
            error: `Concurrency conflict: Submitted version (${submittedVersion}) is behind or equal to datastore version (${expectedVersion}).`,
            code: "CONCURRENCY_CONFLICT",
          },
          { status: 409 }
        );
      }
    }
    if (body.expectedVersion !== undefined && Number(body.expectedVersion) !== expectedVersion) {
      return NextResponse.json(
        {
          success: false,
          error: `Concurrency conflict: Expected version (${body.expectedVersion}) does not match datastore version (${expectedVersion}).`,
          code: "CONCURRENCY_CONFLICT",
        },
        { status: 409 }
      );
    }

    // STATE MACHINE RULE 1: Stale Downgrade Rejection
    // If a consultation is already approved, it can NEVER be downgraded to pending review or draft.
    if (record.status === "approved" && body.status && body.status !== "approved") {
      return NextResponse.json(
        {
          success: false,
          error: "Conflict: Consultation record is already approved and signed. Stale draft updates and status downgrades are prohibited.",
          code: "STATUS_CONFLICT",
        },
        { status: 409 }
      );
    }

    // STATE MACHINE RULE 2: If already approved, preserve approvedAt and approvedBy
    const isTransitioningToApproved = isApproving && record.status !== "approved";
    const nextStatus = isApproving ? "approved" : (body.status || record.status || "completed_pending_review");

    // Capture previous state for compensating rollback if audit fails
    const previousStatus = record.status;
    const previousApprovedAt = record.approvedAt || null;
    const previousApprovedBy = record.approvedBy || null;

    const nextVersion = submittedVersion !== undefined ? submittedVersion : (expectedVersion + 1);

    const updateFields: any = {
      status: nextStatus,
      version: nextVersion,
      caseVersion: nextVersion,
    };

    if (body.interviewState !== undefined) updateFields.interviewState = body.interviewState;
    if (body.deliveredTurnRecords !== undefined) updateFields.deliveredTurnRecords = body.deliveredTurnRecords;
    if (body.attributedFacts !== undefined) updateFields.attributedFacts = body.attributedFacts;
    if (body.unmappedObservations !== undefined) updateFields.unmappedObservations = body.unmappedObservations;
    if (body.idempotencyKey !== undefined) updateFields.idempotencyKey = body.idempotencyKey;

    if (isTransitioningToApproved) {
      updateFields.approvedAt = new Date();
      updateFields.approvedBy = auth.userId;
    }

    if (body.soapSubjective !== undefined) updateFields.soapSubjective = body.soapSubjective;
    if (body.soapObjective !== undefined) updateFields.soapObjective = body.soapObjective;
    if (body.soapAssessment !== undefined) updateFields.soapAssessment = body.soapAssessment;
    if (body.soapPlan !== undefined) updateFields.soapPlan = body.soapPlan;

    if (dbClient) {
      try {
        const updated = await dbClient
          .update(consultationsTable)
          .set(updateFields)
          .where(
            and(
              eq(consultationsTable.id, id),
              eq(consultationsTable.caseVersion, expectedVersion),
              isAdmin || canApprove ? undefined : eq(consultationsTable.userId, record.userId)
            )
          )
          .returning({ id: consultationsTable.id, caseVersion: consultationsTable.caseVersion });

        if (updated.length === 0) {
          return NextResponse.json(
            {
              success: false,
              error: `Concurrency conflict: Row version was modified by a concurrent transaction. Expected version ${expectedVersion}.`,
              code: "CONCURRENCY_CONFLICT",
            },
            { status: 409 }
          );
        }
      } catch (dbErr) {
        console.error("Neon DB update error on PATCH:", dbErr);
        return NextResponse.json(
          { success: false, error: "Failed to persist status change to datastore.", code: "PERSISTENCE_FAILURE" },
          { status: 503 }
        );
      }
    } else {
      if ((record.caseVersion || 1) !== expectedVersion) {
        return NextResponse.json(
          {
            success: false,
            error: `Concurrency conflict: Row version was modified by a concurrent transaction. Expected version ${expectedVersion}.`,
            code: "CONCURRENCY_CONFLICT",
          },
          { status: 409 }
        );
      }
      Object.assign(record, updateFields);
    }

    // 4. Audit ledger consistency:
    // If audit logging fails, rollback mutation so an un-audited approval never commits
    try {
      await logAuditEventAsync({
        actorId: auth.userId,
        actorRole: auth.role,
        action: isApproving ? "CONSULTATION_APPROVED" : "CONSULTATION_UPDATED",
        resourceType: "consultation",
        resourceId: id,
        status: "SUCCESS",
        metadata: {
          previousStatus,
          newStatus: nextStatus,
          actorId: auth.userId,
        },
      });
    } catch (auditErr: any) {
      console.error("Critical: Audit ledger write failure during consultation mutation:", auditErr);
      if (dbClient) {
        try {
          await dbClient
            .update(consultationsTable)
            .set({
              status: previousStatus,
              approvedAt: previousApprovedAt,
              approvedBy: previousApprovedBy,
            })
            .where(eq(consultationsTable.id, id));
        } catch (rollbackErr) {
          console.error("Critical: Rollback error after audit ledger failure:", rollbackErr);
        }
      } else {
        Object.assign(record, {
          status: previousStatus,
          approvedAt: previousApprovedAt,
          approvedBy: previousApprovedBy,
        });
      }

      return NextResponse.json(
        {
          success: false,
          error: "Audit ledger persistence failure. Operation aborted to preserve compliance integrity.",
          code: "AUDIT_FAILURE",
        },
        { status: 500 }
      );
    }

    const updated = { ...record, ...updateFields };
    return NextResponse.json({ success: true, consultation: updated });
  } catch (error: any) {
    console.error("[ConsultationPatchError]", error);
    return NextResponse.json(
      { success: false, error: process.env.NODE_ENV === "production" ? "Internal server error" : (error?.message || "Internal server error") },
      { status: 500 }
    );
  }
}
