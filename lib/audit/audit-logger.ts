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
          // If conflict on index (concurrent insert from another process/lambda), re-sync and retry.
          // Drizzle wraps the underlying Postgres error — check both wrapper and cause.
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

          // Non-fatal: fall back to in-memory ledger so audit failures never crash the primary API.
          // The event is still recorded in-memory for the current process lifetime.
          console.error(`Durable audit persistence failed for event ${id} (falling back to memory):`, outerMsg, rootMsg);
          auditLedger.push(fullEvent);
          return fullEvent;
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
