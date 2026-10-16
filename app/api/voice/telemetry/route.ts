import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/rbac";
import { getDb } from "@/config/db";
import { consultationsTable } from "@/config/schema";
import { eq, and } from "drizzle-orm";
import { memoryConsultations } from "@/app/api/consultations/route";
import { logAuditEventAsync } from "@/lib/audit/audit-logger";

/**
 * VOICE PLAYBACK TELEMETRY API
 *
 * Clinical Delivery Separation Invariant:
 * Server-side events (text generated, safety approved, state persisted, audio synthesized, chunk sent)
 * are strictly separated from client browser media playback reporting.
 *
 * This endpoint records browser media playback telemetry reported by client-side audio player events
 * (e.g. HTML5 Audio "ended", "pause", "error").
 *
 * STRICT ARCHITECTURAL PRINCIPLE:
 * Zero unsupported claims of acoustic verification. MedVoice explicitly does NOT claim or certify
 * biological ear perception or that a human acoustically heard or comprehended the audio.
 */

export async function POST(request: Request) {
  try {
    const auth = await getAuthContext(request);
    if (auth.userId === "unauthenticated" && !auth.isDemoMode) {
      return NextResponse.json(
        { success: false, error: "Unauthorized: Authentication required to submit telemetry.", code: "UNAUTHORIZED" },
        { status: 401 }
      );
    }

    const effectiveUserId = auth.userId === "unauthenticated" && auth.isDemoMode
      ? "anon-user"
      : auth.userId;

    const body = await request.json();
    const {
      consultationId,
      encounterId = consultationId,
      turnId,
      status, // "delivered" | "interrupted" | "failed"
      playedDurationMs,
      interruptedAtMs,
      clientTimestamp = new Date().toISOString(),
    } = body;

    if (!encounterId) {
      return NextResponse.json(
        { success: false, error: "Missing required parameter: encounterId / consultationId", code: "INVALID_INPUT" },
        { status: 400 }
      );
    }

    if (turnId == null || !status) {
      return NextResponse.json(
        { success: false, error: "Missing required telemetry fields: turnId and status", code: "INVALID_INPUT" },
        { status: 400 }
      );
    }

    const validStatuses = ["delivered", "interrupted", "failed"];
    if (!validStatuses.includes(status)) {
      return NextResponse.json(
        { success: false, error: `Invalid status '${status}'. Must be one of: ${validStatuses.join(", ")}`, code: "INVALID_STATUS" },
        { status: 400 }
      );
    }

    // 1. Fetch consultation record
    const dbClient = getDb();
    let record: any = null;

    if (dbClient) {
      try {
        const rows = await dbClient
          .select()
          .from(consultationsTable)
          .where(eq(consultationsTable.id, encounterId))
          .limit(1);
        if (rows.length > 0) record = rows[0];
      } catch (err) {
        console.error("Failed to query consultations in telemetry route:", err);
        return NextResponse.json(
          { success: false, error: "Failed to retrieve encounter state from datastore.", code: "DATABASE_READ_FAILURE" },
          { status: 503 }
        );
      }
    } else {
      record = memoryConsultations.find(c => c.id === encounterId);
    }

    if (!record) {
      return NextResponse.json(
        { success: false, error: "Consultation encounter not found", code: "NOT_FOUND" },
        { status: 404 }
      );
    }

    // 2. Tenant / Caller Isolation: Ensure caller owns the encounter or has clinical role
    const isOwner = record.userId === effectiveUserId || (auth.isDemoMode && record.userId === "anon-user");
    const isAdmin = auth.role === "admin";
    const isClinician = auth.role === "clinician";

    if (!isOwner && !isAdmin && !isClinician) {
      return NextResponse.json(
        { success: false, error: "Forbidden: You are not authorized to update telemetry for this encounter", code: "FORBIDDEN" },
        { status: 403 }
      );
    }

    // 3. Update DeliveredTurnRecord lifecycle state
    const deliveredRecords = Array.isArray(record.deliveredTurnRecords)
      ? [...record.deliveredTurnRecords]
      : [];

    const existingTurn = deliveredRecords.find(t => t.turnId === Number(turnId));
    if (existingTurn) {
      existingTurn.audioDeliveryStatus = status;
      existingTurn.audioDeliveryResult = {
        playedDurationMs: playedDurationMs ?? existingTurn.audioDeliveryResult?.playedDurationMs,
        confirmedAt: new Date().toISOString(),
      };
      if (interruptedAtMs != null) {
        existingTurn.audioDeliveryResult.interruptedAtMs = interruptedAtMs;
      }
    } else {
      deliveredRecords.push({
        turnId: Number(turnId),
        deliveredText: "",
        conversationalAction: "INQUIRE",
        intendedTargets: [],
        targetResolutionStatuses: {},
        relevantEvidenceRefs: [],
        caseVersion: record.caseVersion || 1,
        timestamp: clientTimestamp,
        audioDeliveryStatus: status,
        audioDeliveryResult: {
          playedDurationMs,
          confirmedAt: new Date().toISOString(),
          interruptedAtMs,
        },
      });
    }

    if (dbClient) {
      const updateConditions = [eq(consultationsTable.id, encounterId)];
      if (!isAdmin && !isClinician) {
        updateConditions.push(eq(consultationsTable.userId, effectiveUserId));
      }

      try {
        const updated = await dbClient
          .update(consultationsTable)
          .set({ deliveredTurnRecords: deliveredRecords })
          .where(and(...updateConditions))
          .returning({ id: consultationsTable.id });

        if (!updated || updated.length === 0) {
          return NextResponse.json(
            { success: false, error: "Encounter not found or unauthorized for update", code: "NOT_FOUND" },
            { status: 404 }
          );
        }
      } catch (err) {
        console.error("Could not persist deliveredTurnRecords to DB:", err);
        return NextResponse.json(
          { success: false, error: "Failed to persist playback telemetry to datastore.", code: "PERSISTENCE_FAILURE" },
          { status: 503 }
        );
      }
    } else {
      record.deliveredTurnRecords = deliveredRecords;
    }

    // 4. Audit Log
    try {
      await logAuditEventAsync({
        actorId: auth.userId,
        actorRole: auth.role,
        action: "AUDIO_PLAYBACK_TELEMETRY_RECORDED",
        resourceType: "consultation",
        resourceId: encounterId,
        status: "SUCCESS",
        metadata: {
          turnId,
          playbackStatus: status,
          playedDurationMs,
          acousticVerificationClaimed: false, // Invariant: zero false acoustic claims
        },
      });
    } catch {}

    return NextResponse.json({
      success: true,
      encounterId,
      turnId: Number(turnId),
      deliveryStatus: status,
      telemetryType: "client_reported_playback",
      acousticVerificationClaimed: false,
    });
  } catch (error: any) {
    console.error("[VoiceTelemetryError]", error);
    return NextResponse.json(
      { success: false, error: "Internal server error processing voice telemetry" },
      { status: 500 }
    );
  }
}
