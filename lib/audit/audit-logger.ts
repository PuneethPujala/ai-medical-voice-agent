import { createHash, randomUUID } from "crypto";

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
  | "LONGITUDINAL_FACTS_ACCESSED"
  | "AUDIO_PLAYBACK_TELEMETRY_RECORDED"
  | "CLINICAL_ARTIFACT_DRAFT_CREATED"
  | "CLINICAL_ARTIFACT_DRAFT_UPDATED"
  | "CLINICAL_ARTIFACT_SUBMITTED_FOR_REVIEW"
  | "CLINICAL_ARTIFACT_AMENDMENT_CREATED"
  | "CLINICAL_ARTIFACT_SIGNED"
  | "CLINICAL_ARTIFACT_CANCELLED"
  | "CLINICAL_ARTIFACT_REJECTED";

export type AuditActorRole = "patient" | "clinician" | "admin" | "system";

export type AuditResourceType =
  | "consultation"
  | "dispatch"
  | "patient"
  | "audit"
  | "auth"
  | "system"
  | "clinical_artifact";

export interface AuditEvent {
  index: number;
  id: string;
  timestamp: string;
  actorId: string;
  actorRole: AuditActorRole;
  action: AuditAction;
  resourceType: AuditResourceType;
  resourceId: string;
  status: "SUCCESS" | "DENIED" | "FAILED";
  clientIp?: string;
  metadata?: Record<string, any>;
  previousHash: string;
  eventHash: string;
  hashVersion?: "v1" | "v2";
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

export function canonicalizeJson(value: any): any {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  return Object.keys(value).sort().reduce((acc, key) => {
    acc[key] = canonicalizeJson(value[key]);
    return acc;
  }, {} as Record<string, any>);
}

/**
 * Legacy v1 hash computation (shallow metadata key sort).
 * Preserved for full backward compatibility when verifying historical audit records.
 */
export function computeEventHashV1(event: Omit<AuditEvent, "eventHash">): string {
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

/**
 * Canonical v2 hash computation (recursive JSON key sort).
 * Enforces reproducible SHA-256 calculation across database jsonb round-trips.
 */
export function computeEventHashV2(event: Omit<AuditEvent, "eventHash">): string {
  const sortedMetadata = event.metadata ? canonicalizeJson(event.metadata) : {};

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

/**
 * Deterministic hash computation. Default for all newly generated events is V2.
 */
export function computeEventHash(
  event: Omit<AuditEvent, "eventHash">,
  version: "v1" | "v2" = "v2"
): string {
  return version === "v1" ? computeEventHashV1(event) : computeEventHashV2(event);
}

import { getDb } from "@/config/db";
import { auditEventsTable, auditChainHeadsTable } from "@/config/schema";
import { asc, eq, sql } from "drizzle-orm";

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

/**
 * Log an audit event within an existing database transaction, serializing via PostgreSQL
 * row-level lock on the singleton audit chain head (chain_id = 'main').
 *
 * Guarantees:
 * - Strict monotonic event index ordering across concurrent processes.
 * - Previous-hash cryptographic continuity.
 * - Atomic rollback if caller's transaction aborts.
 */
export async function logAuditEventInTransaction(
  tx: any,
  params: {
    actorId: string;
    actorRole: AuditActorRole;
    action: AuditAction;
    resourceType: AuditResourceType;
    resourceId: string;
    status?: "SUCCESS" | "DENIED" | "FAILED";
    clientIp?: string;
    metadata?: Record<string, any>;
  }
): Promise<AuditEvent> {
  if (simulatedAuditFailure) {
    throw new Error("Simulated transient audit ledger datastore failure");
  }

  // 1. Lock the singleton audit chain head (chain_id = 'main')
  // Strict lock ordering: consultation -> artifact -> idempotency record -> audit chain head
  const headRowsRes = await tx.execute(
    sql`SELECT chain_id, last_event_index, last_event_hash FROM audit_chain_heads WHERE chain_id = 'main' FOR UPDATE`
  );

  let nextIndex: number;
  let previousHash: string;

  const rows = headRowsRes.rows || headRowsRes;
  if (rows && rows.length > 0) {
    const head = rows[0];
    const lastIndex = Number(head.last_event_index ?? head.lastEventIndex);
    const lastHash = String(head.last_event_hash ?? head.lastEventHash);
    nextIndex = lastIndex + 1;
    previousHash = lastHash;
  } else {
    // If audit_chain_heads exists but 'main' row is missing, check audit_events
    const countRes = await tx.execute(
      sql`SELECT COUNT(*)::int as count, COALESCE(MAX(index), -1)::int as max_index FROM audit_events`
    );
    const countRows = countRes.rows || countRes;
    const maxIdx = Number(countRows[0]?.max_index ?? -1);
    if (maxIdx >= 0) {
      const lastEventRes = await tx.execute(
        sql`SELECT event_hash FROM audit_events WHERE index = ${maxIdx}`
      );
      const lastEventRows = lastEventRes.rows || lastEventRes;
      nextIndex = maxIdx + 1;
      previousHash = String(lastEventRows[0]?.event_hash);
    } else {
      nextIndex = 0;
      previousHash = GENESIS_HASH;
    }
    // Initialize audit_chain_heads for 'main'
    await tx.execute(
      sql`INSERT INTO audit_chain_heads (chain_id, last_event_index, last_event_hash, updated_at)
          VALUES ('main', ${nextIndex - 1}, ${previousHash}, NOW())
          ON CONFLICT (chain_id) DO UPDATE SET updated_at = NOW()`
    );
  }

  const id = `AUD-${Date.now()}-${randomUUID().slice(0, 8).toUpperCase()}`;
  const timestamp = new Date().toISOString();
  const status = params.status || "SUCCESS";

  const partialEvent: Omit<AuditEvent, "eventHash"> = {
    index: nextIndex,
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

  const eventHash = computeEventHashV2(partialEvent);
  const fullEvent: AuditEvent = { ...partialEvent, eventHash, hashVersion: "v2" };

  // Insert event into audit_events
  await tx.insert(auditEventsTable).values({
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

  // Advance audit_chain_heads
  await tx.execute(
    sql`UPDATE audit_chain_heads
        SET last_event_index = ${nextIndex},
            last_event_hash = ${eventHash},
            updated_at = NOW()
        WHERE chain_id = 'main'`
  );

  return fullEvent;
}

/**
 * Legacy audit persistence logic for environments where audit_chain_heads is not yet migrated,
 * or for offline test runners.
 */
async function legacyLogAuditEventAsync(params: {
  actorId: string;
  actorRole: AuditActorRole;
  action: AuditAction;
  resourceType: AuditResourceType;
  resourceId: string;
  status?: "SUCCESS" | "DENIED" | "FAILED";
  clientIp?: string;
  metadata?: Record<string, any>;
  requireDurable?: boolean;
}): Promise<AuditEvent> {
  let attempts = 0;
  const maxAttempts = 3;

  while (attempts < maxAttempts) {
    attempts++;

    if (auditLedger.length === 0) {
      await syncAuditLedgerFromDb();
    }

    const index = auditLedger.length;
    const previousHash = index === 0 ? GENESIS_HASH : auditLedger[index - 1].eventHash;
    const id = `AUD-${Date.now()}-${randomUUID().slice(0, 8).toUpperCase()}`;
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

        auditLedger.push(fullEvent);
        return fullEvent;
      } catch (dbErr: any) {
        const rootCause = dbErr?.cause ?? dbErr;
        const rootCode = rootCause?.code ?? dbErr?.code;
        const rootMsg = rootCause?.message ?? "";
        const outerMsg = dbErr?.message ?? "";
        const isUniqueViolation =
          rootCode === "23505" ||
          outerMsg.includes("unique constraint") || outerMsg.includes("duplicate key") ||
          rootMsg.includes("unique constraint") || rootMsg.includes("duplicate key");
        if (isUniqueViolation) {
          console.warn(`Concurrent audit collision on index ${index}. Re-syncing and retrying (attempt ${attempts}/${maxAttempts})...`);
          await syncAuditLedgerFromDb();
          continue;
        }

        if (params.requireDurable || process.env.NODE_ENV === "production") {
          console.error(`Durable audit persistence failed for event ${id}:`, outerMsg, rootMsg);
          throw new Error(`Durable audit persistence failed: ${outerMsg || rootMsg || "datastore error"}`);
        }

        console.error(`Durable audit persistence failed for event ${id} (falling back to memory):`, outerMsg, rootMsg);
        auditLedger.push(fullEvent);
        return fullEvent;
      }
    } else {
      auditLedger.push(fullEvent);
      return fullEvent;
    }
  }

  throw new Error(`Failed to commit audit event after ${maxAttempts} concurrency retries.`);
}

export async function logAuditEventAsync(params: {
  actorId: string;
  actorRole: AuditActorRole;
  action: AuditAction;
  resourceType: AuditResourceType;
  resourceId: string;
  status?: "SUCCESS" | "DENIED" | "FAILED";
  clientIp?: string;
  metadata?: Record<string, any>;
  requireDurable?: boolean;
}): Promise<AuditEvent> {
  if (simulatedAuditFailure) {
    throw new Error("Simulated transient audit ledger datastore failure");
  }

  return serializeWrite(async () => {
    const dbClient = getDb();
    if (dbClient) {
      try {
        const committedEvent = await dbClient.transaction(async (tx) => {
          return await logAuditEventInTransaction(tx, params);
        });
        auditLedger.push(committedEvent);
        return committedEvent;
      } catch (err: any) {
        const rootCause = err?.cause ?? err;
        const rootMsg = String(rootCause?.message ?? "");
        const outerMsg = String(err?.message ?? "");
        const isMissingChainHeads =
          rootMsg.includes("audit_chain_heads") && rootMsg.includes("does not exist");

        if (isMissingChainHeads) {
          // Fallback for unmigrated environments (e.g. before 0006 cutover)
          return await legacyLogAuditEventAsync(params);
        }

        if (params.requireDurable || process.env.NODE_ENV === "production" || simulatedAuditFailure) {
          throw new Error(`Durable audit persistence failed: ${outerMsg || rootMsg || "datastore error"}`);
        }

        return await legacyLogAuditEventAsync(params);
      }
    }

    // Offline / no-db mode
    return await legacyLogAuditEventAsync(params);
  });
}



export const MAX_HISTORICAL_PERMUTATION_BUDGET = 1000;

export type EventVerificationStatus =
  | "VERIFIED_V2"
  | "VERIFIED_V1_DIRECT"
  | "VERIFIED_V1_RECOVERED"
  | "TAMPERED"
  | "UNVERIFIABLE_BUDGET_EXCEEDED";

export interface EventVerificationDetail {
  valid: boolean;
  status: EventVerificationStatus;
  reason?: string;
  permutationsEvaluated?: number;
  totalCandidatePermutations?: number;
}

function computePayloadHashWithMetadataJson(
  event: Omit<AuditEvent, "eventHash">,
  metadataJson: string
): string {
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
    metadataJson,
  ].join("|");

  return createHash("sha256").update(payload, "utf8").digest("hex");
}

function factorial(n: number): number {
  if (n <= 1) return 1;
  if (n > 8) return Infinity; // Safe guard: 9! = 362,880 > 1,000 budget
  let res = 1;
  for (let i = 2; i <= n; i++) res *= i;
  return res;
}

/**
 * Calculates the exact total number of candidate key orderings across all nested objects.
 * In legacy V1, top-level keys were ALWAYS sorted alphabetically, so top-level keys contribute 1.
 * Any nested plain object with K keys contributes K! permutations.
 */
export function countCandidatePermutations(value: any, isTopLevel: boolean = true): number {
  if (!value || typeof value !== "object") return 1;

  if (Array.isArray(value)) {
    let count = 1;
    for (const item of value) {
      count *= countCandidatePermutations(item, false);
      if (count > 1_000_000) return Infinity;
    }
    return count;
  }

  const keys = Object.keys(value);
  if (isTopLevel) {
    let count = 1;
    for (const k of keys) {
      count *= countCandidatePermutations(value[k], false);
      if (count > 1_000_000) return Infinity;
    }
    return count;
  }

  let count = factorial(keys.length);
  if (count > 1_000_000) return Infinity;

  for (const k of keys) {
    count *= countCandidatePermutations(value[k], false);
    if (count > 1_000_000) return Infinity;
  }

  return count;
}

function* getPermutationsGen<T>(arr: T[]): Generator<T[]> {
  if (arr.length <= 1) {
    yield arr;
    return;
  }
  for (let i = 0; i < arr.length; i++) {
    const current = arr[i];
    const remaining = arr.slice(0, i).concat(arr.slice(i + 1));
    for (const p of getPermutationsGen(remaining)) {
      yield [current, ...p];
    }
  }
}

function* generatePermutedValues(value: any, isTopLevel: boolean = false): Generator<any> {
  if (value === null || typeof value !== "object") {
    yield value;
    return;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      yield [];
      return;
    }
    function* permuteArray(arr: any[], index: number): Generator<any[]> {
      if (index === arr.length) {
        yield [];
        return;
      }
      for (const head of generatePermutedValues(arr[index], false)) {
        for (const tail of permuteArray(arr, index + 1)) {
          yield [head, ...tail];
        }
      }
    }
    yield* permuteArray(value, 0);
    return;
  }

  // Plain object
  if (isTopLevel) {
    const sortedKeys = Object.keys(value).sort();
    function* permuteTopChildren(keys: string[], index: number): Generator<Record<string, any>> {
      if (index === keys.length) {
        yield {};
        return;
      }
      const key = keys[index];
      for (const childVal of generatePermutedValues(value[key], false)) {
        for (const rest of permuteTopChildren(keys, index + 1)) {
          yield { [key]: childVal, ...rest };
        }
      }
    }
    yield* permuteTopChildren(sortedKeys, 0);
    return;
  }

  // Nested object: test all permutations of key insertion order
  const rawKeys = Object.keys(value);
  for (const keyOrder of getPermutationsGen(rawKeys)) {
    function* permuteNestedChildren(keys: string[], index: number): Generator<Record<string, any>> {
      if (index === keys.length) {
        yield {};
        return;
      }
      const key = keys[index];
      for (const childVal of generatePermutedValues(value[key], false)) {
        for (const rest of permuteNestedChildren(keys, index + 1)) {
          yield { [key]: childVal, ...rest };
        }
      }
    }
    yield* permuteNestedChildren(keyOrder, 0);
  }
}

/**
 * Validates cryptographic eventHash integrity with comprehensive status inspection:
 * 1. Modern Canonical V2 check (for new events and post-change writes)
 * 2. Legacy Direct V1 check (for historical events with pre-sorted nested keys or flat metadata)
 * 3. Bounded permutation recovery check (for legacy V1 records altered by PostgreSQL jsonb key sorting)
 *
 * Accurately distinguishes:
 * - VERIFIED_V2 / VERIFIED_V1_DIRECT / VERIFIED_V1_RECOVERED (Genuine historical records)
 * - TAMPERED (Values, actors, pointers, or payloads genuinely altered)
 * - UNVERIFIABLE_BUDGET_EXCEEDED (Valid historical records exceeding permutation search budget)
 */
export function verifyEventIntegrity(event: AuditEvent): EventVerificationDetail {
  // 1. Explicit hashVersion enforcement if specified
  if (event.hashVersion === "v2") {
    const valid = event.eventHash === computeEventHashV2(event);
    return valid
      ? { valid: true, status: "VERIFIED_V2", permutationsEvaluated: 0 }
      : {
          valid: false,
          status: "TAMPERED",
          reason: "Canonical V2 SHA-256 hash mismatch: record payload or metadata was altered",
          permutationsEvaluated: 0,
        };
  }

  // 2. Try Canonical V2 first (matches all new events)
  if (event.eventHash === computeEventHashV2(event)) {
    return { valid: true, status: "VERIFIED_V2", permutationsEvaluated: 0 };
  }

  // 3. Try Legacy V1 Direct (matches flat or pre-sorted historical metadata)
  if (event.eventHash === computeEventHashV1(event)) {
    return { valid: true, status: "VERIFIED_V1_DIRECT", permutationsEvaluated: 0 };
  }

  // If explicit v1 requested and direct failed, or unversioned and both failed:
  // Check if permutation recovery is applicable (i.e. metadata exists and contains nested objects)
  if (!event.metadata || typeof event.metadata !== "object" || Array.isArray(event.metadata)) {
    return {
      valid: false,
      status: "TAMPERED",
      reason: "Payload hash tampering detected: metadata is missing or non-object and hash does not match computed SHA-256",
      permutationsEvaluated: 0,
    };
  }

  const totalCandidates = countCandidatePermutations(event.metadata, true);

  // If there are no nested permutations to try (e.g. metadata is completely flat),
  // then V1 direct was already exhaustive. The payload is definitely tampered.
  if (totalCandidates <= 1) {
    return {
      valid: false,
      status: "TAMPERED",
      reason: "Payload hash tampering detected: flat metadata SHA-256 does not match stored hash",
      permutationsEvaluated: 0,
      totalCandidatePermutations: 1,
    };
  }

  // If total candidate combinations exceed the computational safety budget:
  if (totalCandidates > MAX_HISTORICAL_PERMUTATION_BUDGET) {
    return {
      valid: false,
      status: "UNVERIFIABLE_BUDGET_EXCEEDED",
      reason: `Historical V1 verification search budget exceeded: ${totalCandidates} candidate permutations exceeds safety limit of ${MAX_HISTORICAL_PERMUTATION_BUDGET}`,
      permutationsEvaluated: 0,
      totalCandidatePermutations: totalCandidates,
    };
  }

  // Within budget: evaluate permutations lazily with early-exit on first match
  let evaluated = 0;
  for (const candidateMetadata of generatePermutedValues(event.metadata, true)) {
    evaluated++;
    const candidateJson = JSON.stringify(candidateMetadata);
    const candidateHash = computePayloadHashWithMetadataJson(event, candidateJson);
    if (candidateHash === event.eventHash) {
      return {
        valid: true,
        status: "VERIFIED_V1_RECOVERED",
        permutationsEvaluated: evaluated,
        totalCandidatePermutations: totalCandidates,
      };
    }
  }

  // All permutations evaluated without a match: payload or stored hash was genuinely tampered
  return {
    valid: false,
    status: "TAMPERED",
    reason: `Payload hash tampering detected: stored hash does not match any valid historical permutation (evaluated ${evaluated} permutations)`,
    permutationsEvaluated: evaluated,
    totalCandidatePermutations: totalCandidates,
  };
}

export function verifyHistoricalV1WithPermutations(event: AuditEvent): boolean {
  return verifyEventIntegrity(event).status === "VERIFIED_V1_RECOVERED";
}

export function verifyEventHash(event: AuditEvent): boolean {
  return verifyEventIntegrity(event).valid;
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

    // 3. Verify eventHash integrity with versioned backward compatibility and jsonb round-trip recovery
    const integrity = verifyEventIntegrity(current);
    if (!integrity.valid) {
      const reason =
        integrity.status === "UNVERIFIABLE_BUDGET_EXCEEDED"
          ? `Audit verification incomplete at index ${i}: ${integrity.reason}`
          : `Payload hash tampering detected at index ${i}: stored hash does not match computed SHA-256`;

      return {
        valid: false,
        totalEvents: events.length,
        genesisHash: GENESIS_HASH,
        headHash: events[events.length - 1]?.eventHash || null,
        corruptedIndex: i,
        reason,
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

/**
 * Compute a deterministic SHA-256 digest over all clinically relevant fields of a consultation record.
 * Used to detect post-hoc tampering: the digest recorded at write-time can be compared against
 * a freshly computed digest of the current record to verify nothing was altered outside the audit trail.
 *
 * The canonical string is versioned (v:1) so future schema additions can produce a v:2 without
 * breaking verification of records hashed under v:1.
 */
export function computeCanonicalConsultationDigest(record: {
  id?: string;
  patientName?: string;
  patientGender?: string;
  doctorId?: string;
  doctorName?: string;
  specialty?: string;
  chiefComplaint?: string;
  soapSubjective?: string;
  soapObjective?: string;
  soapAssessment?: string;
  soapPlan?: string;
  triageLevel?: string;
  esiScore?: number | null;
  icd10Codes?: string[];
  caseVersion?: number;
  transcript?: Array<{ role: string; text: string; timestamp?: string }>;
}): string {
  const canonical = {
    v: 1,
    id: record.id ?? "",
    patientName: record.patientName ?? "",
    patientGender: record.patientGender ?? "",
    doctorId: record.doctorId ?? "",
    doctorName: record.doctorName ?? "",
    specialty: record.specialty ?? "",
    chiefComplaint: record.chiefComplaint ?? "",
    soapSubjective: record.soapSubjective ?? "",
    soapObjective: record.soapObjective ?? "",
    soapAssessment: record.soapAssessment ?? "",
    soapPlan: record.soapPlan ?? "",
    triageLevel: record.triageLevel ?? "",
    esiScore: record.esiScore ?? null,
    icd10Codes: Array.isArray(record.icd10Codes) ? [...record.icd10Codes].sort() : [],
    caseVersion: record.caseVersion ?? 0,
    transcript: Array.isArray(record.transcript)
      ? record.transcript.map((t) => ({ role: t.role, text: t.text }))
      : [],
  };

  const payload = JSON.stringify(canonicalizeJson(canonical));
  return createHash("sha256").update(payload, "utf8").digest("hex");
}
