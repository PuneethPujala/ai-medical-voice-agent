/**
 * Pre-Migration Audit Chain Verification Gate
 *
 * Cryptographically verifies the complete historical SHA-256 blockchain
 * before applying Migration 0006 (audit_chain_heads initialization).
 *
 * Invariants:
 * 1. Strictly strongly-typed with AuditEvent[]; zero usage of `any`.
 * 2. Enforces index contiguity (0, 1, 2, ... N-1).
 * 3. Enforces that event index 0 points to GENESIS_HASH.
 * 4. Verifies every previousHash cryptographic pointer.
 * 5. Recomputes every event hash using canonical computeEventHashV2.
 * 6. Detects interior corrupted links, payload tampering, gaps, or reorderings.
 * 7. Fails closed: throws AuditChainIntegrityError on any verification failure.
 */

import {
  AuditEvent,
  ChainVerificationResult,
  verifyAuditChain,
  GENESIS_HASH,
} from "./audit-logger";

export class AuditChainIntegrityError extends Error {
  public readonly corruptedIndex?: number;
  public readonly failureReason: string;

  constructor(reason: string, corruptedIndex?: number) {
    super(`[AUDIT_CHAIN_INTEGRITY_VIOLATION] ${reason}${corruptedIndex !== undefined ? ` (at index ${corruptedIndex})` : ""}`);
    this.name = "AuditChainIntegrityError";
    this.corruptedIndex = corruptedIndex;
    this.failureReason = reason;
  }
}

export interface PreMigrationVerificationReport {
  canProceed: boolean;
  totalEvents: number;
  terminalIndex: number;
  terminalHash: string;
}

/**
 * Validates an in-memory or database-retrieved historical audit ledger.
 * Returns the verified terminal state for audit_chain_heads anchoring,
 * or throws an AuditChainIntegrityError if any anomaly is detected.
 */
export function verifyHistoricalAuditChainForMigration(
  events: AuditEvent[]
): PreMigrationVerificationReport {
  // Case 1: Empty ledger is valid for genesis bootstrap
  if (events.length === 0) {
    return {
      canProceed: true,
      totalEvents: 0,
      terminalIndex: -1,
      terminalHash: GENESIS_HASH,
    };
  }

  // 1. Verify index 0 links to Genesis Hash
  if (events[0].previousHash !== GENESIS_HASH) {
    throw new AuditChainIntegrityError(
      `Genesis pointer violation: Event at index 0 has previousHash '${events[0].previousHash}', expected '${GENESIS_HASH}'`,
      0
    );
  }

  // 2. Full cryptographic verification via canonical verifier
  const result: ChainVerificationResult = verifyAuditChain(events);

  if (!result.valid) {
    throw new AuditChainIntegrityError(
      result.reason || "Cryptographic hash chain verification failed",
      result.corruptedIndex
    );
  }

  const terminal = events[events.length - 1];

  return {
    canProceed: true,
    totalEvents: events.length,
    terminalIndex: terminal.index,
    terminalHash: terminal.eventHash,
  };
}
