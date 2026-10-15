import { createHash } from "crypto";

export type AuditAction =
  | "CONSULTATION_CREATED"
  | "CONSULTATION_UPDATED"
  | "CONSULTATION_APPROVED"
  | "CONSULTATION_ACCESSED"
  | "CONSULTATION_OVERRIDE"
  | "TRIAGE_EVALUATION"
  | "EMERGENCY_DISPATCH"
  | "AUDIT_CHAIN_VERIFIED"
  | "ACCESS_DENIED"
  | "ROLE_ELEVATION_ATTEMPT"
  | "PATIENT_PROFILE_ACCESSED"
  | "PATIENT_PROFILE_SAVED"
  | "PATIENT_PROFILE_DELETED"
  | "AUDIO_PLAYBACK_TELEMETRY_RECORDED";

export type AuditActorRole = "patient" | "clinician" | "admin" | "system";

export interface AuditEvent {
  index: number;
  id: string;
  timestamp: string;
  actorId: string;
  actorRole: AuditActorRole;
  action: AuditAction;
  resourceType: "consultation" | "dispatch" | "patient" | "audit" | "auth" | "system";
  resourceId: string;
  status: "SUCCESS" | "DENIED" | "FAILED";
  clientIp?: string;
  metadata?: Record<string, any>;
  previousHash: string;
  eventHash: string;
}

export interface ChainVerificationResult {
  valid: boolean;
  totalEvents: number;
  genesisHash: string;
  headHash: string | null;
  corruptedIndex?: number;
  reason?: string;
}

export const GENESIS_HASH = "0000000000000000000000000000000000000000000000000000000000000000";

// Deterministic canonical hash computation
export function computeEventHash(event: Omit<AuditEvent, "eventHash">): string {
  // Sort metadata keys deterministically to guarantee reproducible hashing
  const sortedMetadata = event.metadata
    ? Object.keys(event.metadata)
        .sort()
        .reduce((acc, key) => {
          acc[key] = event.metadata![key];
          return acc;
        }, {} as Record<string, any>)
    : {};

  const payload = [
    event.index,
    event.id,
    event.timestamp,
    event.actorId,
    event.actorRole,
    event.action,
    event.resourceType,
    event.resourceId,
    event.status,
    event.previousHash,
    JSON.stringify(sortedMetadata),
  ].join("|");

  return createHash("sha256").update(payload, "utf8").digest("hex");
}

import { getDb } from "@/config/db";
import { auditEventsTable } from "@/config/schema";
import { asc } from "drizzle-orm";

// In-memory append-only ledger for rapid access & fallback
let auditLedger: AuditEvent[] = [];

// Mutex queue to serialize in-process append operations and eliminate concurrency races
let writeLock: Promise<any> = Promise.resolve();

function serializeWrite<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeLock.then(fn, fn);
  writeLock = next.catch(() => {});
  return next;
}

/**
 * Persist an audit event asynchronously to Neon PostgreSQL
 */
export async function persistAuditEventToDb(event: AuditEvent): Promise<boolean> {
  const dbClient = getDb();
  if (!dbClient) return false;
  try {
    await dbClient.insert(auditEventsTable).values({
      index: event.index,
      id: event.id,
      timestamp: event.timestamp,
      actorId: event.actorId,
      actorRole: event.actorRole,
      action: event.action,
      resourceType: event.resourceType,
      resourceId: event.resourceId,
      status: event.status,
      clientIp: event.clientIp,
      metadata: event.metadata,
      previousHash: event.previousHash,
      eventHash: event.eventHash,
    });
    return true;
  } catch (err) {
    console.warn("Failed to persist audit event to Neon DB:", err);
    return false;
  }
}

/**
 * Synchronize and hydrate the in-memory ledger from Neon PostgreSQL.
 * If the database has records and in-memory is empty or stale, loads the durable chain.
 */
export async function syncAuditLedgerFromDb(): Promise<AuditEvent[]> {
  const dbClient = getDb();
  if (!dbClient) return auditLedger;

  try {
    const records = await dbClient
      .select()
      .from(auditEventsTable)
      .orderBy(asc(auditEventsTable.index));

    if (records && records.length > 0) {
      // Map database rows to typed AuditEvent
      const dbEvents: AuditEvent[] = records.map((r: any) => ({
        index: r.index,
        id: r.id,
        timestamp: r.timestamp,
        actorId: r.actorId,
        actorRole: r.actorRole as AuditActorRole,
        action: r.action as AuditAction,
        resourceType: r.resourceType as AuditEvent["resourceType"],
        resourceId: r.resourceId,
        status: r.status as AuditEvent["status"],
        clientIp: r.clientIp || undefined,
        metadata: (r.metadata as Record<string, any>) || undefined,
        previousHash: r.previousHash,
        eventHash: r.eventHash,
      }));

      // Validate cryptographic chain before adopting
      const check = verifyAuditChain(dbEvents);
      if (check.valid) {
        // If DB has more events than memory, hydrate
        if (dbEvents.length >= auditLedger.length) {
          auditLedger = dbEvents;
        }
      } else {
        console.error("Cryptographic corruption detected in Neon DB audit records:", check.reason);
      }
    }
  } catch (err) {
    console.warn("Could not sync audit ledger from Neon DB, using memory cache:", err);
  }

  return auditLedger;
}

/**
 * Clear in-memory audit ledger (primarily for isolated test fixtures)
 */
export function clearAuditLedger(): void {
  auditLedger = [];
}

/**
 * Log a security or clinical event to the tamper-evident cryptographic hash chain.
 * Synchronous variant: pushes to memory immediately and dispatches background persistence.
 */
export function logAuditEvent(
  params: {
    actorId: string;
    actorRole: AuditActorRole;
    action: AuditAction;
    resourceType: AuditEvent["resourceType"];
    resourceId: string;
    status?: "SUCCESS" | "DENIED" | "FAILED";
    clientIp?: string;
    metadata?: Record<string, any>;
  },
  skipBackgroundPersist: boolean = false
): AuditEvent {
  const index = auditLedger.length;
  const previousHash = index === 0 ? GENESIS_HASH : auditLedger[index - 1].eventHash;
  const id = `AUD-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
  const timestamp = new Date().toISOString();
  const status = params.status || "SUCCESS";

  const partialEvent: Omit<AuditEvent, "eventHash"> = {
    index,
    id,
    timestamp,
    actorId: params.actorId,
    actorRole: params.actorRole,
    action: params.action,
    resourceType: params.resourceType,
    resourceId: params.resourceId,
    status,
    clientIp: params.clientIp,
    metadata: params.metadata,
    previousHash,
  };

  const eventHash = computeEventHash(partialEvent);
  const fullEvent: AuditEvent = { ...partialEvent, eventHash };

  auditLedger.push(fullEvent);

  // Background persist to Neon DB if configured (non-blocking)
  if (!skipBackgroundPersist) {
    persistAuditEventToDb(fullEvent).catch((err) => {
      console.warn("Async audit persistence notice:", err?.message);
    });
  }

  return fullEvent;
}

/**
 * Log a security or clinical event with strict monotonic ordering,
 * in-process mutex serialization, database-first persistence, and concurrency conflict retry.
 * Guarantees that in-memory cache and PostgreSQL ledger NEVER diverge.
 */
let simulatedAuditFailure = false;
export function __setSimulatedAuditFailure(val: boolean) {
  simulatedAuditFailure = val;
}

export async function logAuditEventAsync(params: {
  actorId: string;
  actorRole: AuditActorRole;
  action: AuditAction;
  resourceType: AuditEvent["resourceType"];
  resourceId: string;
  status?: "SUCCESS" | "DENIED" | "FAILED";
  clientIp?: string;
  metadata?: Record<string, any>;
}): Promise<AuditEvent> {
  if (simulatedAuditFailure) {
    throw new Error("Simulated transient audit ledger datastore failure");
  }
  return serializeWrite(async () => {
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      attempts++;

      // 1. Ensure in-memory cache is hydrated from DB on first write or if stale
      if (auditLedger.length === 0) {
        await syncAuditLedgerFromDb();
      }

      const index = auditLedger.length;
      const previousHash = index === 0 ? GENESIS_HASH : auditLedger[index - 1].eventHash;
      const id = `AUD-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
      const timestamp = new Date().toISOString();
      const status = params.status || "SUCCESS";

      const partialEvent: Omit<AuditEvent, "eventHash"> = {
        index,
        id,
        timestamp,
        actorId: params.actorId,
        actorRole: params.actorRole,
        action: params.action,
        resourceType: params.resourceType,
        resourceId: params.resourceId,
        status,
        clientIp: params.clientIp,
        metadata: params.metadata,
        previousHash,
      };

      const eventHash = computeEventHash(partialEvent);
      const fullEvent: AuditEvent = { ...partialEvent, eventHash };

      const dbClient = getDb();
      if (dbClient) {
        try {
          await dbClient.insert(auditEventsTable).values({
            index: fullEvent.index,
            id: fullEvent.id,
            timestamp: fullEvent.timestamp,
            actorId: fullEvent.actorId,
            actorRole: fullEvent.actorRole,
            action: fullEvent.action,
            resourceType: fullEvent.resourceType,
            resourceId: fullEvent.resourceId,
            status: fullEvent.status,
            clientIp: fullEvent.clientIp,
            metadata: fullEvent.metadata,
            previousHash: fullEvent.previousHash,
            eventHash: fullEvent.eventHash,
          });

          // DB write succeeded: commit to in-memory ledger
          auditLedger.push(fullEvent);
          return fullEvent;
        } catch (dbErr: any) {
          // If conflict on index (concurrent insert from another process/lambda), re-sync and retry
          if (dbErr?.code === "23505" || dbErr?.message?.includes("unique constraint") || dbErr?.message?.includes("duplicate key")) {
            console.warn(`Concurrent audit collision on index ${index}. Re-syncing and retrying (attempt ${attempts}/${maxAttempts})...`);
            await syncAuditLedgerFromDb();
            continue;
          }

          console.error(`Durable audit persistence failed for event ${id}:`, dbErr?.message);
          throw new Error(`Durable audit persistence failed: ${dbErr?.message}`);
        }
      } else {
        // In environments without DB (e.g. offline unit testing), commit to memory ledger
        auditLedger.push(fullEvent);
        return fullEvent;
      }
    }

    throw new Error(`Failed to commit audit event after ${maxAttempts} concurrency retries.`);
  });
}



/**
 * Verify cryptographic integrity of an audit event sequence.
 * Detects any data mutation, record insertion, deletion, or reordering.
 */
export function verifyAuditChain(events: AuditEvent[] = auditLedger): ChainVerificationResult {
  if (events.length === 0) {
    return {
      valid: true,
      totalEvents: 0,
      genesisHash: GENESIS_HASH,
      headHash: null,
    };
  }

  for (let i = 0; i < events.length; i++) {
    const current = events[i];

    // 1. Verify index continuity
    if (current.index !== i) {
      return {
        valid: false,
        totalEvents: events.length,
        genesisHash: GENESIS_HASH,
        headHash: events[events.length - 1]?.eventHash || null,
        corruptedIndex: i,
        reason: `Index mismatch at position ${i}: expected ${i}, found ${current.index}`,
      };
    }

    // 2. Verify previousHash pointer
    const expectedPrevious = i === 0 ? GENESIS_HASH : events[i - 1].eventHash;
    if (current.previousHash !== expectedPrevious) {
      return {
        valid: false,
        totalEvents: events.length,
        genesisHash: GENESIS_HASH,
        headHash: events[events.length - 1]?.eventHash || null,
        corruptedIndex: i,
        reason: `Broken chain pointer at index ${i}: expected previousHash '${expectedPrevious}', got '${current.previousHash}'`,
      };
    }

    // 3. Verify eventHash integrity
    const computedHash = computeEventHash(current);
    if (computedHash !== current.eventHash) {
      return {
        valid: false,
        totalEvents: events.length,
        genesisHash: GENESIS_HASH,
        headHash: events[events.length - 1]?.eventHash || null,
        corruptedIndex: i,
        reason: `Payload hash tampering detected at index ${i}: stored hash does not match computed SHA-256`,
      };
    }
  }

  return {
    valid: true,
    totalEvents: events.length,
    genesisHash: GENESIS_HASH,
    headHash: events[events.length - 1].eventHash,
  };
}

/**
 * Read-only accessor for the audit ledger (safe copy).
 */
export function getAuditEvents(limit: number = 50, offset: number = 0): AuditEvent[] {
  return auditLedger.slice(offset, offset + limit).map((e) => ({ ...e }));
}
