import { NextResponse } from "next/server";
import {
  EmergencyDispatchPayloadSchema,
  computeClinicalAuditHash,
  generatePreArrivalDirectives,
  EmergencyDispatchReceipt,
} from "@/lib/emergency/dispatch";
import { logAuditEventAsync } from "@/lib/audit/audit-logger";
import { getAuthContext, hasPermission } from "@/lib/auth/rbac";

// Simulated receiving hospital in-memory pre-arrival telemetry board
const activeDispatches: EmergencyDispatchReceipt[] = [];

export async function POST(request: Request) {
  try {
    const auth = await getAuthContext(request);

    // Enforce permission: role must possess "emergency:dispatch"
    if (!hasPermission(auth.role, "emergency:dispatch")) {
      await logAuditEventAsync({
        actorId: auth.userId,
        actorRole: auth.role,
        action: "ACCESS_DENIED",
        resourceType: "dispatch",
        resourceId: "new_dispatch",
        status: "DENIED",
        metadata: {
          reason: "Role not authorized to trigger emergency ambulance dispatch",
          requiredPermission: "emergency:dispatch",
          userRole: auth.role,
        },
      });

      return NextResponse.json(
        {
          success: false,
          error: "Forbidden: Role not authorized to trigger emergency hospital pre-arrival dispatch.",
          code: "FORBIDDEN",
        },
        { status: 403 }
      );
    }

    const body = await request.json();
    const parsed = EmergencyDispatchPayloadSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid dispatch payload structure",
          details: parsed.error.issues,
        },
        { status: 400 }
      );
    }

    const payload = parsed.data;

    // Compute cryptographic audit hash
    const auditHash = computeClinicalAuditHash({
      consultationId: payload.consultationId,
      patientId: payload.patientId,
      timestamp: payload.timestamp,
      esiScore: payload.esiScore,
      triageLevel: payload.triageLevel,
      icd10Codes: payload.icd10Codes,
      chiefComplaint: payload.chiefComplaint,
    });

    // Generate clinical pre-arrival directives and bay reservation
    const { bay, physician, directives } = generatePreArrivalDirectives(
      payload.esiScore,
      payload.redFlagsTriggered
    );

    const dispatchId = `DISPATCH-ED-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    const receipt: EmergencyDispatchReceipt = {
      dispatchId,
      consultationId: payload.consultationId,
      hospitalName: payload.targetHospitalName,
      intakeQueueStatus: "TRIAGE_BAY_RESERVED",
      assignedHospitalBay: bay,
      attendingPhysicianOnCall: physician,
      etaMinutes: payload.etaMinutes,
      auditHash,
      tamperVerified: true,
      timestamp: new Date().toISOString(),
      preArrivalDirectives: directives,
    };

    // Store in receiving hospital telemetry board
    activeDispatches.unshift(receipt);
    if (activeDispatches.length > 50) activeDispatches.pop();

    await logAuditEventAsync({
      actorId: auth.userId,
      actorRole: auth.role,
      action: "EMERGENCY_DISPATCH",
      resourceType: "dispatch",
      resourceId: dispatchId,
      status: "SUCCESS",
      metadata: {
        hospitalName: payload.targetHospitalName,
        assignedBay: bay,
        esiScore: payload.esiScore,
        auditHash,
      },
    });

    return NextResponse.json({
      success: true,
      isSimulation: true,
      simulationNotice: "SIMULATION ONLY: Receiving hospital pre-arrival telemetry simulated in demonstration environment. No municipal 911 or real-world ambulance dispatched.",
      message: "Emergency pre-arrival alert transmitted and acknowledged by receiving hospital ED (Simulated).",
      receipt,
    });
  } catch (error: any) {
    console.error("[EmergencyDispatchError]", error);
    return NextResponse.json(
      { success: false, error: process.env.NODE_ENV === "production" ? "Emergency dispatch processing failure" : (error?.message || "Emergency dispatch failed") },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  try {
    const auth = await getAuthContext(request);
    const { searchParams } = new URL(request.url);
    const consultationId = searchParams.get("consultationId");

    // 1. Single encounter dispatch status lookup
    if (consultationId) {
      const match = activeDispatches.find((d) => d.consultationId === consultationId);
      if (!match) {
        return NextResponse.json({ success: true, dispatch: null });
      }

      // Check access boundary
      if (auth.userId === "unauthenticated" && !auth.isDemoMode) {
        return NextResponse.json(
          {
            success: false,
            error: "Unauthorized: Authentication required to query pre-arrival telemetry.",
            code: "UNAUTHORIZED",
          },
          { status: 401 }
        );
      }

      return NextResponse.json({ success: true, dispatch: match });
    }

    // 2. Querying all active emergency dispatches (Hospital ED Telemetry Board)
    // Administrative oversight: requires system:read or analytics:read
    if (auth.userId === "unauthenticated" && !auth.isDemoMode) {
      await logAuditEventAsync({
        actorId: "unauthenticated",
        actorRole: "patient",
        action: "ACCESS_DENIED",
        resourceType: "dispatch",
        resourceId: "telemetry_board",
        status: "DENIED",
        metadata: { reason: "Unauthenticated request attempted to query hospital telemetry board" },
      });

      return NextResponse.json(
        {
          success: false,
          error: "Unauthorized: Hospital administration credentials required.",
          code: "UNAUTHORIZED",
        },
        { status: 401 }
      );
    }

    if (!hasPermission(auth.role, "system:read") && !hasPermission(auth.role, "analytics:read")) {
      await logAuditEventAsync({
        actorId: auth.userId,
        actorRole: auth.role,
        action: "ACCESS_DENIED",
        resourceType: "dispatch",
        resourceId: "telemetry_board",
        status: "DENIED",
        metadata: { attemptedRole: auth.role, requiredPermission: "system:read" },
      });

      return NextResponse.json(
        {
          success: false,
          error: "Forbidden: Insufficient privileges to view hospital emergency dispatch telemetry board.",
          code: "FORBIDDEN",
        },
        { status: 403 }
      );
    }

    return NextResponse.json({
      success: true,
      totalActive: activeDispatches.length,
      dispatches: activeDispatches.slice(0, 10),
    });
  } catch (error: any) {
    console.error("[EmergencyTelemetryBoardError]", error);
    return NextResponse.json(
      { success: false, error: process.env.NODE_ENV === "production" ? "Failed to query emergency telemetry board" : (error?.message || "Failed to query telemetry board") },
      { status: 500 }
    );
  }
}

