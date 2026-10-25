import crypto from "crypto";
import { getDb } from "@/config/db";
import { turnIdempotencyKeysTable, consultationsTable } from "@/config/schema";
import { and, eq, lte, sql } from "drizzle-orm";
import { LiveAudioMetrics } from "@/lib/acoustic/acoustic-dsp-analyzer";
import { memoryConsultations } from "@/app/api/consultations/route";

export interface CanonicalFingerprintInput {
  message: string;
  doctorId: string;
  patientId?: string | null;
  patientRelationship?: string | null;
  patientAge?: string | number | null;
  isInterruption?: boolean | null;
  interruptedAgent?: string | null;
  userLocation?: { latitude?: number; longitude?: number; city?: string } | null;
  audioMetrics?: LiveAudioMetrics | null;
}

/**
 * Deterministic JSON stringifier that sorts object keys recursively at all levels.
 * Treats undefined as explicit null to eliminate key omission variance.
 */
export function canonicalJsonStringify(obj: any): string {
  if (obj === null || obj === undefined) {
    return "null";
  }
  if (typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return `[${obj.map((item) => canonicalJsonStringify(item)).join(",")}]`;
  }
  const keys = Object.keys(obj).sort();
  const pairs = keys.map((key) => {
    const val = obj[key] === undefined ? null : obj[key];
    return `${JSON.stringify(key)}:${canonicalJsonStringify(val)}`;
  });
  return `{${pairs.join(",")}}`;
}

/**
 * Computes a deterministic SHA-256 request fingerprint across all semantically relevant fields.
 * Transport fields (stream, clientCaseVersion, connection headers) are deliberately excluded.
 */
export function computeTurnFingerprint(input: CanonicalFingerprintInput): string {
  const normLoc = input.userLocation ? {
    latitude: typeof input.userLocation.latitude === "number" ? Number(input.userLocation.latitude.toFixed(3)) : null,
    longitude: typeof input.userLocation.longitude === "number" ? Number(input.userLocation.longitude.toFixed(3)) : null,
    city: input.userLocation.city ? input.userLocation.city.trim().toLowerCase() : null,
  } : null;

  const normAcoustics = input.audioMetrics ? {
    durationMs: typeof input.audioMetrics.durationMs === "number" ? Math.round(input.audioMetrics.durationMs) : null,
    pauseCount: typeof input.audioMetrics.pauseCount === "number" ? Math.round(input.audioMetrics.pauseCount) : null,
    totalPauseDurationMs: typeof input.audioMetrics.totalPauseDurationMs === "number" ? Math.round(input.audioMetrics.totalPauseDurationMs) : null,
    speechPauseRatio: typeof input.audioMetrics.speechPauseRatio === "number" ? Number(input.audioMetrics.speechPauseRatio.toFixed(2)) : null,
    meanPauseDurationMs: typeof input.audioMetrics.meanPauseDurationMs === "number" ? Math.round(input.audioMetrics.meanPauseDurationMs) : null,
    energyVariance: typeof input.audioMetrics.energyVariance === "number" ? Number(input.audioMetrics.energyVariance.toFixed(2)) : null,
    pitchVariance: typeof input.audioMetrics.pitchVariance === "number" ? Number(input.audioMetrics.pitchVariance.toFixed(2)) : null,
    meanF0Hz: typeof input.audioMetrics.meanF0Hz === "number" ? Number(input.audioMetrics.meanF0Hz.toFixed(1)) : null,
    meanRms: typeof input.audioMetrics.meanRms === "number" ? Number(input.audioMetrics.meanRms.toFixed(4)) : null,
    voicedFramesCount: typeof input.audioMetrics.voicedFramesCount === "number" ? Math.round(input.audioMetrics.voicedFramesCount) : null,
    totalFramesCount: typeof input.audioMetrics.totalFramesCount === "number" ? Math.round(input.audioMetrics.totalFramesCount) : null,
    sampleRate: typeof input.audioMetrics.sampleRate === "number" ? Math.round(input.audioMetrics.sampleRate) : null,
    isLiveDsp: Boolean(input.audioMetrics.isLiveDsp),
  } : null;

  const canonical: Record<string, any> = {
    message: (input.message || "").trim().toLowerCase(),
    doctorId: (input.doctorId || "dr-sarah-chen").trim().toLowerCase(),
    patientId: input.patientId ? String(input.patientId).trim() : null,
    patientRelationship: input.patientRelationship ? input.patientRelationship.trim().toLowerCase() : "self",
    patientAge: input.patientAge !== undefined && input.patientAge !== null ? String(input.patientAge).trim() : null,
    isInterruption: Boolean(input.isInterruption),
    interruptedAgent: input.interruptedAgent ? input.interruptedAgent.trim() : null,
    userLocation: normLoc,
    audioMetrics: normAcoustics,
  };

  const canonicalString = canonicalJsonStringify(canonical);
  return crypto.createHash("sha256").update(canonicalString).digest("hex");
}

/**
 * Generates a strictly bounded, 36-character deterministic emergency turn key.
 * Guarantees that retries of the same emergency resolve to the identical record.
 */
export function generateEmergencyTurnId(
  userId: string,
  encounterId: string,
  baseTurnId: string,
  emergencyFingerprint: string
): string {
  const compound = `${userId}:${encounterId}:${baseTurnId}:${emergencyFingerprint}`;
  const hash = crypto.createHash("sha256").update(compound).digest("hex");
  return `emg_${hash.substring(0, 32)}`;
}

export interface MemoryTurnRecord {
  id: string;
  userId: string;
  encounterId: string;
  turnId: string;
  requestFingerprint: string;
  status: "pending" | "completed" | "conflict" | "failed";
  leaseExpiresAt: number;
  claimGeneration: number;
  caseVersion?: number;
  responsePayload?: any;
  createdAt: number;
  updatedAt: number;
}

export const memoryTurnIdempotencyKeys = new Map<string, MemoryTurnRecord>();

export type ReservationOutcome =
  | { outcome: "ACQUIRED"; claimGeneration: number }
  | { outcome: "REPLAY"; responsePayload: any; caseVersion?: number }
  | { outcome: "FINGERPRINT_MISMATCH"; existingFingerprint: string }
  | { outcome: "IN_FLIGHT"; leaseExpiresAt: Date; claimGeneration: number };

/**
 * Acquires an atomic lease reservation before expensive AI reasoning.
 * Enforces cross-worker atomicity on PostgreSQL or process-local atomicity in memory fallback.
 */
export async function acquireTurnReservation(params: {
  userId: string;
  encounterId: string;
  turnId: string;
  requestFingerprint: string;
  leaseDurationMs?: number;
}): Promise<ReservationOutcome> {
  const {
    userId,
    encounterId,
    turnId,
    requestFingerprint,
    leaseDurationMs = 45000,
  } = params;

  const dbClient = getDb();

  if (dbClient) {
    const recordId = `turn_res_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    const leaseExpiresAt = new Date(Date.now() + leaseDurationMs);

    // 1. Attempt atomic insert
    try {
      const inserted = await dbClient
        .insert(turnIdempotencyKeysTable)
        .values({
          id: recordId,
          userId,
          encounterId,
          turnId,
          requestFingerprint,
          status: "pending",
          leaseExpiresAt,
          claimGeneration: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoNothing({
          target: [
            turnIdempotencyKeysTable.userId,
            turnIdempotencyKeysTable.encounterId,
            turnIdempotencyKeysTable.turnId,
          ],
        })
        .returning({ claimGeneration: turnIdempotencyKeysTable.claimGeneration });

      if (inserted && inserted.length > 0) {
        return { outcome: "ACQUIRED", claimGeneration: inserted[0].claimGeneration };
      }
    } catch (insertErr: any) {
      // 23505 unique violation fallback
    }

    // 2. Conflict: Fetch existing record
    const existingRows = await dbClient
      .select()
      .from(turnIdempotencyKeysTable)
      .where(
        and(
          eq(turnIdempotencyKeysTable.userId, userId),
          eq(turnIdempotencyKeysTable.encounterId, encounterId),
          eq(turnIdempotencyKeysTable.turnId, turnId)
        )
      )
      .limit(1);

    if (existingRows.length === 0) {
      // Race: deleted or retry insert
      return acquireTurnReservation(params);
    }

    const existing = existingRows[0];

    // Check request fingerprint
    if (existing.requestFingerprint !== requestFingerprint) {
      return { outcome: "FINGERPRINT_MISMATCH", existingFingerprint: existing.requestFingerprint };
    }

    // Check completed status
    if (existing.status === "completed") {
      return {
        outcome: "REPLAY",
        responsePayload: existing.responsePayload,
        caseVersion: existing.caseVersion ?? undefined,
      };
    }

    // Check if lease expired or prior conflict: takeover!
    const isExpired = new Date(existing.leaseExpiresAt).getTime() <= Date.now();
    const isConflict = existing.status === "conflict";

    if (isExpired || isConflict) {
      const targetNextGen = existing.claimGeneration + 1;
      const newLease = new Date(Date.now() + leaseDurationMs);

      const takeoverConditions = [
        eq(turnIdempotencyKeysTable.userId, userId),
        eq(turnIdempotencyKeysTable.encounterId, encounterId),
        eq(turnIdempotencyKeysTable.turnId, turnId),
        eq(turnIdempotencyKeysTable.claimGeneration, existing.claimGeneration),
      ];

      if (!isConflict) {
        takeoverConditions.push(lte(turnIdempotencyKeysTable.leaseExpiresAt, new Date()));
      }

      const updated = await dbClient
        .update(turnIdempotencyKeysTable)
        .set({
          status: "pending",
          claimGeneration: targetNextGen,
          leaseExpiresAt: newLease,
          updatedAt: new Date(),
        })
        .where(and(...takeoverConditions))
        .returning({ claimGeneration: turnIdempotencyKeysTable.claimGeneration });

      if (updated && updated.length > 0) {
        return { outcome: "ACQUIRED", claimGeneration: updated[0].claimGeneration };
      }

      // Someone else took over lease; re-inspect
      return acquireTurnReservation(params);
    }

    return {
      outcome: "IN_FLIGHT",
      leaseExpiresAt: new Date(existing.leaseExpiresAt),
      claimGeneration: existing.claimGeneration,
    };
  }

  // --- In-Memory Fallback ---
  const memKey = `${userId}:${encounterId}:${turnId}`;
  const now = Date.now();
  const existingMem = memoryTurnIdempotencyKeys.get(memKey);

  if (!existingMem) {
    memoryTurnIdempotencyKeys.set(memKey, {
      id: `mem_res_${now}`,
      userId,
      encounterId,
      turnId,
      requestFingerprint,
      status: "pending",
      leaseExpiresAt: now + leaseDurationMs,
      claimGeneration: 1,
      createdAt: now,
      updatedAt: now,
    });
    return { outcome: "ACQUIRED", claimGeneration: 1 };
  }

  if (existingMem.requestFingerprint !== requestFingerprint) {
    return { outcome: "FINGERPRINT_MISMATCH", existingFingerprint: existingMem.requestFingerprint };
  }

  if (existingMem.status === "completed") {
    return {
      outcome: "REPLAY",
      responsePayload: existingMem.responsePayload,
      caseVersion: existingMem.caseVersion,
    };
  }

  const isExpired = existingMem.leaseExpiresAt <= now;
  const isConflict = existingMem.status === "conflict";

  if (isExpired || isConflict) {
    const nextGen = existingMem.claimGeneration + 1;
    existingMem.status = "pending";
    existingMem.claimGeneration = nextGen;
    existingMem.leaseExpiresAt = now + leaseDurationMs;
    existingMem.updatedAt = now;
    return { outcome: "ACQUIRED", claimGeneration: nextGen };
  }

  return {
    outcome: "IN_FLIGHT",
    leaseExpiresAt: new Date(existingMem.leaseExpiresAt),
    claimGeneration: existingMem.claimGeneration,
  };
}

export interface CommitTurnParams {
  userId: string;
  encounterId: string;
  turnId?: string;
  claimGeneration?: number;
  expectedCaseVersion: number;
  nextCaseVersion: number;
  stateToPersist: any;
  responsePayload: any;
}

export interface CommitTurnResult {
  success: boolean;
  code?: string;
  message?: string;
  caseVersion?: number;
}

/**
 * Executes atomic consultation state commit and idempotency completion.
 * Dispatches the stored PostgreSQL function commit_consultation_turn or enforces
 * 3-phase conditional consistency on the in-memory fallback.
 */
export async function commitTurnWithFencing(params: CommitTurnParams): Promise<CommitTurnResult> {
  const {
    userId,
    encounterId,
    turnId,
    claimGeneration,
    expectedCaseVersion,
    nextCaseVersion,
    stateToPersist,
    responsePayload,
  } = params;

  const dbClient = getDb();

  if (dbClient) {
    if (turnId && claimGeneration !== undefined) {
      // Dispatches atomic stored function commit_consultation_turn
      const jsonState = JSON.stringify(stateToPersist || {});
      const jsonDelivered = JSON.stringify(stateToPersist.deliveredTurnRecords || []);
      const jsonFacts = JSON.stringify(stateToPersist.attributedFacts || []);
      const jsonUnmapped = JSON.stringify(stateToPersist.unmappedObservations || []);
      const jsonResponse = JSON.stringify(responsePayload || {});

      const queryResult = await dbClient.execute(sql`
        SELECT commit_consultation_turn(
          ${userId},
          ${encounterId},
          ${turnId},
          ${claimGeneration},
          ${expectedCaseVersion},
          ${nextCaseVersion},
          ${jsonState},
          ${jsonDelivered},
          ${jsonFacts},
          ${jsonUnmapped},
          ${jsonResponse}
        ) AS result;
      `);

      const raw = (queryResult as any).rows?.[0]?.result || (queryResult as any)[0]?.result;
      if (!raw) {
        return { success: false, code: "PERSISTENCE_FAILURE", message: "Empty result from commit_consultation_turn." };
      }

      return raw as CommitTurnResult;
    }

    // Legacy unkeyed turn fallback
    const conditions = [
      eq(consultationsTable.id, encounterId),
      eq(consultationsTable.caseVersion, expectedCaseVersion),
    ];
    if (userId !== "anon-user") {
      conditions.push(eq(consultationsTable.userId, userId));
    }

    const updated = await dbClient
      .update(consultationsTable)
      .set({
        interviewState: stateToPersist,
        deliveredTurnRecords: stateToPersist.deliveredTurnRecords,
        attributedFacts: stateToPersist.attributedFacts,
        unmappedObservations: stateToPersist.unmappedObservations,
        caseVersion: nextCaseVersion,
      })
      .where(and(...conditions))
      .returning({ id: consultationsTable.id });

    if (!updated || updated.length === 0) {
      return {
        success: false,
        code: "CONCURRENT_MODIFICATION_CONFLICT",
        message: `CaseVersion conflict for encounter ${encounterId}. Expected ${expectedCaseVersion}.`,
      };
    }

    return { success: true, caseVersion: nextCaseVersion };
  }

  // --- In-Memory Fallback ---
  const memKey = `${userId}:${encounterId}:${turnId}`;
  const keyRec = turnId ? memoryTurnIdempotencyKeys.get(memKey) : undefined;

  // Phase 1: Fencing check
  if (turnId && claimGeneration !== undefined) {
    if (!keyRec || keyRec.claimGeneration !== claimGeneration || keyRec.status !== "pending") {
      return {
        success: false,
        code: "FENCING_CONFLICT",
        message: "Claim generation is stale or turn is not in pending status.",
      };
    }
  }

  // Phase 2: Consultation CAS
  const mem = memoryConsultations.find((c) => c.id === encounterId);
  if (!mem) {
    return {
      success: false,
      code: "ENCOUNTER_NOT_FOUND",
      message: `Encounter '${encounterId}' not found in memory store.`,
    };
  }

  const currentMemVersion = typeof mem.caseVersion === "number" ? mem.caseVersion : expectedCaseVersion;
  if (currentMemVersion !== expectedCaseVersion) {
    if (keyRec) {
      keyRec.status = "conflict";
      keyRec.updatedAt = Date.now();
    }
    return {
      success: false,
      code: "CONCURRENT_MODIFICATION_CONFLICT",
      message: `Encounter caseVersion mismatch. Expected ${expectedCaseVersion}, got ${currentMemVersion}.`,
    };
  }

  // Phase 3: Update consultation and mark idempotency completed atomically
  mem.caseVersion = nextCaseVersion;
  mem.interviewState = stateToPersist;
  mem.deliveredTurnRecords = stateToPersist.deliveredTurnRecords;
  mem.attributedFacts = stateToPersist.attributedFacts;
  mem.unmappedObservations = stateToPersist.unmappedObservations;

  if (keyRec) {
    keyRec.status = "completed";
    keyRec.caseVersion = nextCaseVersion;
    keyRec.responsePayload = responsePayload;
    keyRec.updatedAt = Date.now();
  }

  return { success: true, caseVersion: nextCaseVersion };
}
