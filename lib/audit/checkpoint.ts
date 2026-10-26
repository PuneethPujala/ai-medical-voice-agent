import { createHash, createHmac } from "crypto";
import { AuditEvent, verifyAuditChain, GENESIS_HASH } from "./audit-logger";

export const AUDIT_CHECKPOINT_SCHEMA_VERSION = "medvoice-audit-checkpoint-v1";

export interface AuditCheckpoint {
  schemaVersion: string;
  checkpointId: string;
  timestamp: string;
  eventCount: number;
  genesisHash: string;
  headHash: string;
  /** HMAC-SHA256 signature over canonical payload using dedicated checkpoint signing secret */
  signature: string;
}

export type CheckpointVerificationStatus =
  | "VERIFIED"
  | "UNANCHORED_NO_CHECKPOINT"
  | "REWRITTEN_LEDGER_DETECTED"
  | "TRUNCATED_LEDGER_DETECTED"
  | "TAMPERED_CHECKPOINT_SIGNATURE"
  | "STALE_CHECKPOINT_DETECTED"
  | "INVALID_GENESIS_ANCHOR"
  | "INTERNAL_CHAIN_INVALID"
  | "CHECKPOINT_STORE_ERROR";

export interface CheckpointVerificationResult {
  valid: boolean;
  status: CheckpointVerificationStatus;
  reason: string;
  checkpoint?: AuditCheckpoint;
  ledgerEventCount: number;
  ledgerHeadHash: string | null;
  corruptedIndex?: number;
}

/**
 * Storage interface for external audit checkpoints.
 * Implementations isolate checkpoint storage from the primary database write boundary.
 */
export interface AuditCheckpointStore {
  writeCheckpoint(checkpoint: AuditCheckpoint): Promise<void>;
  readLatestCheckpoint(): Promise<AuditCheckpoint | null>;
}

/**
 * Compute canonical HMAC signature for checkpoint authenticity.
 */
export function computeCheckpointSignature(
  payload: Omit<AuditCheckpoint, "signature">,
  signingKey: string
): string {
  const canonicalString = [
    payload.schemaVersion,
    payload.checkpointId,
    payload.timestamp,
    payload.eventCount,
    payload.genesisHash,
    payload.headHash,
  ].join("|");

  return createHmac("sha256", signingKey).update(canonicalString, "utf8").digest("hex");
}

/**
 * Verifies that a checkpoint's signature matches the canonical signing key.
 */
export function verifyCheckpointSignature(
  checkpoint: AuditCheckpoint,
  signingKey: string
): boolean {
  if (checkpoint.schemaVersion !== AUDIT_CHECKPOINT_SCHEMA_VERSION) {
    return false;
  }
  const { signature, ...rest } = checkpoint;
  const expectedSig = computeCheckpointSignature(rest, signingKey);
  return expectedSig === signature;
}

/**
 * Create a new signed audit checkpoint from an verified sequence of audit events.
 * Fails closed if the provided event sequence does not pass internal hash-chain verification.
 */
export function createAuditCheckpoint(
  events: AuditEvent[],
  signingKey: string,
  customId?: string
): AuditCheckpoint {
  if (!signingKey || signingKey.length < 16) {
    throw new Error("Audit checkpoint creation requires a secure signingKey (>= 16 chars).");
  }

  // 1. Internal chain verification MUST pass before a checkpoint can ever be minted
  const chainResult = verifyAuditChain(events);
  if (!chainResult.valid) {
    throw new Error(
      `Cannot create checkpoint: audit chain failed internal verification at index ${chainResult.corruptedIndex}: ${chainResult.reason}`
    );
  }

  const eventCount = events.length;
  const genesisHash = chainResult.genesisHash;
  const headHash = eventCount === 0 ? GENESIS_HASH : events[eventCount - 1].eventHash;
  const checkpointId = customId || `CHK-${Date.now()}-${createHash("sha256").update(headHash).digest("hex").slice(0, 8).toUpperCase()}`;
  const timestamp = new Date().toISOString();

  const unsigned = {
    schemaVersion: AUDIT_CHECKPOINT_SCHEMA_VERSION,
    checkpointId,
    timestamp,
    eventCount,
    genesisHash,
    headHash,
  };

  const signature = computeCheckpointSignature(unsigned, signingKey);
  return { ...unsigned, signature };
}

/**
 * Verify a live audit ledger sequence against a trusted external checkpoint.
 * Detects entire-chain recalculations, middle alterations, deletions, truncations, and signature tampering.
 */
export function verifyLedgerAgainstCheckpoint(
  events: AuditEvent[],
  checkpoint: AuditCheckpoint | null,
  signingKey: string
): CheckpointVerificationResult {
  const eventCount = events.length;
  const ledgerHead = eventCount === 0 ? null : events[eventCount - 1].eventHash;

  // 1. Check for absence of checkpoint
  if (!checkpoint) {
    // Chain may be internally valid, but it is explicitly unanchored without an external checkpoint
    const internal = verifyAuditChain(events);
    return {
      valid: false,
      status: "UNANCHORED_NO_CHECKPOINT",
      reason: internal.valid
        ? "Audit chain is internally consistent but has no external anchor checkpoint (unverified)."
        : `Unanchored chain is internally corrupted: ${internal.reason}`,
      ledgerEventCount: eventCount,
      ledgerHeadHash: ledgerHead,
      corruptedIndex: internal.corruptedIndex,
    };
  }

  // 2. Validate checkpoint authenticity & signature
  if (!verifyCheckpointSignature(checkpoint, signingKey)) {
    return {
      valid: false,
      status: "TAMPERED_CHECKPOINT_SIGNATURE",
      reason: "Checkpoint signature verification failed: signature is invalid or unauthenticated.",
      checkpoint,
      ledgerEventCount: eventCount,
      ledgerHeadHash: ledgerHead,
    };
  }

  // 3. Genesis anchor verification
  if (checkpoint.genesisHash !== GENESIS_HASH) {
    return {
      valid: false,
      status: "INVALID_GENESIS_ANCHOR",
      reason: `Checkpoint genesis hash mismatch: expected '${GENESIS_HASH}', got '${checkpoint.genesisHash}'`,
      checkpoint,
      ledgerEventCount: eventCount,
      ledgerHeadHash: ledgerHead,
    };
  }

  // 4. Verify internal chain integrity up to the ledger length
  const internalCheck = verifyAuditChain(events);
  if (!internalCheck.valid) {
    return {
      valid: false,
      status: "INTERNAL_CHAIN_INVALID",
      reason: `Ledger failed internal cryptographic verification: ${internalCheck.reason}`,
      checkpoint,
      ledgerEventCount: eventCount,
      ledgerHeadHash: ledgerHead,
      corruptedIndex: internalCheck.corruptedIndex,
    };
  }

  // 5. Truncation Detection: Ledger has fewer events than the trusted checkpoint
  if (eventCount < checkpoint.eventCount) {
    return {
      valid: false,
      status: "TRUNCATED_LEDGER_DETECTED",
      reason: `Ledger has been truncated: checkpoint recorded ${checkpoint.eventCount} events, but ledger only contains ${eventCount}.`,
      checkpoint,
      ledgerEventCount: eventCount,
      ledgerHeadHash: ledgerHead,
    };
  }

  // 6. Checkpoint Point-in-Time Head Anchor Verification
  // The event at checkpoint.eventCount - 1 in the current ledger MUST match checkpoint.headHash
  if (checkpoint.eventCount > 0) {
    const historicalEventAtCheckpoint = events[checkpoint.eventCount - 1];
    if (!historicalEventAtCheckpoint || historicalEventAtCheckpoint.eventHash !== checkpoint.headHash) {
      return {
        valid: false,
        status: "REWRITTEN_LEDGER_DETECTED",
        reason: `Rewritten ledger detected: event at index ${checkpoint.eventCount - 1} hash '${historicalEventAtCheckpoint?.eventHash}' does not match trusted checkpoint head '${checkpoint.headHash}'.`,
        checkpoint,
        ledgerEventCount: eventCount,
        ledgerHeadHash: ledgerHead,
        corruptedIndex: checkpoint.eventCount - 1,
      };
    }
  }

  return {
    valid: true,
    status: "VERIFIED",
    reason: `Audit chain cryptographically verified and anchored against trusted checkpoint '${checkpoint.checkpointId}' (${checkpoint.eventCount} events anchor verified, current total ${eventCount}).`,
    checkpoint,
    ledgerEventCount: eventCount,
    ledgerHeadHash: ledgerHead,
  };
}

/**
 * In-memory external checkpoint store for testing and ephemeral execution.
 */
export class InMemoryCheckpointStore implements AuditCheckpointStore {
  private checkpoints: AuditCheckpoint[] = [];

  async writeCheckpoint(checkpoint: AuditCheckpoint): Promise<void> {
    const latest = await this.readLatestCheckpoint();
    if (latest && checkpoint.eventCount < latest.eventCount) {
      throw new Error(
        `Rollback rejected: cannot write checkpoint with eventCount ${checkpoint.eventCount} when latest is ${latest.eventCount}.`
      );
    }
    this.checkpoints.push({ ...checkpoint });
  }

  async readLatestCheckpoint(): Promise<AuditCheckpoint | null> {
    if (this.checkpoints.length === 0) return null;
    return { ...this.checkpoints[this.checkpoints.length - 1] };
  }

  clear(): void {
    this.checkpoints = [];
  }
}
