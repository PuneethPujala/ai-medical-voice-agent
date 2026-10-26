import { createHash, createHmac, createSign, createVerify, timingSafeEqual, randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { AuditEvent, verifyAuditChain, GENESIS_HASH } from "./audit-logger";

export const AUDIT_CHECKPOINT_SCHEMA_VERSION = "medvoice-audit-checkpoint-v1";

export interface AuditCheckpoint {
  schemaVersion: string;
  checkpointId: string;
  timestamp: string;
  eventCount: number;
  genesisHash: string;
  headHash: string;
  /** HMAC-SHA256 or RSA/ECDSA signature over canonical payload using dedicated checkpoint signing secret/key */
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
 * Timing-safe string comparison to prevent timing attacks during verification.
 */
function safeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Build canonical string representation for checkpoint payload.
 */
export function buildCanonicalCheckpointString(
  payload: Omit<AuditCheckpoint, "signature">
): string {
  return [
    payload.schemaVersion,
    payload.checkpointId,
    payload.timestamp,
    payload.eventCount,
    payload.genesisHash,
    payload.headHash,
  ].join("|");
}

/**
 * Compute canonical signature for checkpoint authenticity.
 * Supports symmetric HMAC-SHA256 or asymmetric private key (PEM format).
 */
export function computeCheckpointSignature(
  payload: Omit<AuditCheckpoint, "signature">,
  signingKey: string
): string {
  const canonicalString = buildCanonicalCheckpointString(payload);

  if (signingKey.includes("-----BEGIN") && (signingKey.includes("PRIVATE KEY") || signingKey.includes("RSA PRIVATE KEY"))) {
    const signer = createSign("SHA256");
    signer.update(canonicalString, "utf8");
    signer.end();
    return signer.sign(signingKey, "hex");
  }

  return createHmac("sha256", signingKey).update(canonicalString, "utf8").digest("hex");
}

/**
 * Verifies that a checkpoint's signature matches the canonical signing key or public key.
 */
export function verifyCheckpointSignature(
  checkpoint: AuditCheckpoint,
  verificationKey: string
): boolean {
  if (checkpoint.schemaVersion !== AUDIT_CHECKPOINT_SCHEMA_VERSION) {
    return false;
  }
  const { signature, ...rest } = checkpoint;
  const canonicalString = buildCanonicalCheckpointString(rest);

  if (verificationKey.includes("-----BEGIN") && (verificationKey.includes("PUBLIC KEY") || verificationKey.includes("RSA PUBLIC KEY"))) {
    try {
      const verifier = createVerify("SHA256");
      verifier.update(canonicalString, "utf8");
      verifier.end();
      return verifier.verify(verificationKey, signature, "hex");
    } catch {
      return false;
    }
  }

  const expectedSig = computeCheckpointSignature(rest, verificationKey);
  return safeEqual(expectedSig, signature);
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
 * STRICTLY PROHIBITED in production environments.
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

/**
 * File-based detached vault checkpoint store.
 * Stores checkpoints in a dedicated directory isolated from the primary database filesystem.
 * Implements atomic writes via temporary files and rename, monotonic event count enforcement,
 * and durability across process restarts.
 */
export class DetachedVaultCheckpointStore implements AuditCheckpointStore {
  readonly vaultDir: string;

  constructor(vaultDir?: string) {
    this.vaultDir = path.resolve(vaultDir || process.env.AUDIT_CHECKPOINT_VAULT_PATH || "./vault/checkpoints");
  }

  private async ensureDir(): Promise<void> {
    await fs.promises.mkdir(this.vaultDir, { recursive: true });
  }

  async writeCheckpoint(checkpoint: AuditCheckpoint): Promise<void> {
    await this.ensureDir();

    // Enforce monotonic advancement
    const latest = await this.readLatestCheckpoint();
    if (latest) {
      if (checkpoint.eventCount < latest.eventCount) {
        throw new Error(
          `Rollback rejected: cannot write checkpoint with eventCount ${checkpoint.eventCount} when latest is ${latest.eventCount}.`
        );
      }
      if (checkpoint.eventCount === latest.eventCount && checkpoint.headHash !== latest.headHash) {
        throw new Error(
          `Fork rejected: checkpoint at eventCount ${checkpoint.eventCount} already exists with different headHash.`
        );
      }
    }

    const payload = JSON.stringify(checkpoint, null, 2);
    const paddedCount = String(checkpoint.eventCount).padStart(12, "0");
    const targetFileName = `checkpoint-${paddedCount}-${checkpoint.checkpointId}.json`;
    const targetFilePath = path.join(this.vaultDir, targetFileName);
    const latestFilePath = path.join(this.vaultDir, "latest.json");

    // 1. Write immutable discrete checkpoint atomically via unique tmp file
    const tmpFileCheckpoint = path.join(this.vaultDir, `.tmp-${process.pid}-${Date.now()}-${randomUUID()}.json`);
    await fs.promises.writeFile(tmpFileCheckpoint, payload, "utf8");
    await fs.promises.rename(tmpFileCheckpoint, targetFilePath);

    // 2. Update latest pointer file atomically
    const tmpFileLatest = path.join(this.vaultDir, `.tmp-latest-${process.pid}-${Date.now()}-${randomUUID()}.json`);
    await fs.promises.writeFile(tmpFileLatest, payload, "utf8");
    await fs.promises.rename(tmpFileLatest, latestFilePath);
  }

  async readLatestCheckpoint(): Promise<AuditCheckpoint | null> {
    try {
      await this.ensureDir();

      // Fast-path: read latest.json
      const latestFilePath = path.join(this.vaultDir, "latest.json");
      if (fs.existsSync(latestFilePath)) {
        try {
          const raw = await fs.promises.readFile(latestFilePath, "utf8");
          const parsed = JSON.parse(raw);
          if (parsed && parsed.schemaVersion === AUDIT_CHECKPOINT_SCHEMA_VERSION && typeof parsed.eventCount === "number") {
            return parsed as AuditCheckpoint;
          }
        } catch {
          // If latest.json is corrupted or being replaced, fall back to directory scan
        }
      }

      // Fallback/Recovery: scan directory for discrete checkpoint files
      const files = await fs.promises.readdir(this.vaultDir);
      const checkpointFiles = files
        .filter((f) => f.startsWith("checkpoint-") && f.endsWith(".json"))
        .sort((a, b) => b.localeCompare(a)); // Descending order by padded count

      for (const file of checkpointFiles) {
        try {
          const raw = await fs.promises.readFile(path.join(this.vaultDir, file), "utf8");
          const parsed = JSON.parse(raw);
          if (parsed && parsed.schemaVersion === AUDIT_CHECKPOINT_SCHEMA_VERSION && typeof parsed.eventCount === "number") {
            return parsed as AuditCheckpoint;
          }
        } catch {
          continue;
        }
      }

      return null;
    } catch (err: any) {
      if (err.code === "ENOENT") return null;
      throw err;
    }
  }
}

export interface S3CheckpointConfig {
  bucket: string;
  region?: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  prefix?: string;
  objectLockCompliance?: boolean;
  objectLockRetainUntilDays?: number;
  customFetch?: typeof fetch;
}

/**
 * S3-compatible cloud external checkpoint store.
 * Supports AWS S3, MinIO, Cloudflare R2 with Object Lock headers for immutable WORM compliance.
 */
export class S3AuditCheckpointStore implements AuditCheckpointStore {
  readonly config: S3CheckpointConfig;
  private readonly baseUrl: string;

  constructor(config: S3CheckpointConfig) {
    if (!config.bucket) {
      throw new Error("S3AuditCheckpointStore requires a bucket name.");
    }
    this.config = config;
    const endpoint = config.endpoint || `https://${config.bucket}.s3.${config.region || "us-east-1"}.amazonaws.com`;
    this.baseUrl = endpoint.replace(/\/$/, "");
  }

  private getKey(fileName: string): string {
    const prefix = this.config.prefix ? this.config.prefix.replace(/^\/+|\/+$/g, "") + "/" : "";
    return `${prefix}${fileName}`;
  }

  async writeCheckpoint(checkpoint: AuditCheckpoint): Promise<void> {
    const latest = await this.readLatestCheckpoint();
    if (latest && checkpoint.eventCount < latest.eventCount) {
      throw new Error(
        `Rollback rejected: cannot write checkpoint with eventCount ${checkpoint.eventCount} when latest is ${latest.eventCount}.`
      );
    }

    const payload = JSON.stringify(checkpoint, null, 2);
    const paddedCount = String(checkpoint.eventCount).padStart(12, "0");
    const discreteKey = this.getKey(`checkpoint-${paddedCount}-${checkpoint.checkpointId}.json`);
    const latestKey = this.getKey("latest.json");

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.config.objectLockCompliance) {
      headers["x-amz-object-lock-mode"] = "COMPLIANCE";
      if (this.config.objectLockRetainUntilDays) {
        const retainDate = new Date(Date.now() + this.config.objectLockRetainUntilDays * 86400 * 1000).toISOString();
        headers["x-amz-object-lock-retain-until-date"] = retainDate;
      }
    }

    const fetchFn = this.config.customFetch || fetch;

    // 1. Put discrete object
    const discreteUrl = `${this.baseUrl}/${discreteKey}`;
    const resDiscrete = await fetchFn(discreteUrl, {
      method: "PUT",
      headers,
      body: payload,
    });

    if (!resDiscrete.ok) {
      const errText = await resDiscrete.text().catch(() => "");
      throw new Error(`S3 write failed for ${discreteKey}: HTTP ${resDiscrete.status} ${errText}`);
    }

    // 2. Put latest pointer object
    const latestUrl = `${this.baseUrl}/${latestKey}`;
    const resLatest = await fetchFn(latestUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: payload,
    });

    if (!resLatest.ok) {
      const errText = await resLatest.text().catch(() => "");
      throw new Error(`S3 write failed for ${latestKey}: HTTP ${resLatest.status} ${errText}`);
    }
  }

  async readLatestCheckpoint(): Promise<AuditCheckpoint | null> {
    const latestKey = this.getKey("latest.json");
    const url = `${this.baseUrl}/${latestKey}`;
    const fetchFn = this.config.customFetch || fetch;

    const res = await fetchFn(url, { method: "GET" });
    if (res.status === 404 || res.status === 403) {
      return null;
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`S3 read failed for ${latestKey}: HTTP ${res.status} ${errText}`);
    }

    const data = await res.json();
    if (data && data.schemaVersion === AUDIT_CHECKPOINT_SCHEMA_VERSION && typeof data.eventCount === "number") {
      return data as AuditCheckpoint;
    }

    return null;
  }
}

/**
 * Factory for creating the configured external checkpoint store.
 * Strictly enforces a fail-closed policy: in production environments (NODE_ENV === "production"),
 * InMemoryCheckpointStore is PROHIBITED. A durable detached vault or S3 store MUST be configured.
 */
export function createConfiguredCheckpointStore(env: NodeJS.ProcessEnv = process.env): AuditCheckpointStore {
  const isProduction = env.NODE_ENV === "production";
  const storeType = (env.AUDIT_CHECKPOINT_STORE_TYPE || "").toLowerCase();

  if (isProduction) {
    if (storeType === "memory") {
      throw new Error(
        "Production security violation: InMemoryCheckpointStore is strictly prohibited in production. Configure AUDIT_CHECKPOINT_STORE_TYPE=vault or AUDIT_CHECKPOINT_STORE_TYPE=s3."
      );
    }

    if (storeType === "vault" || (!storeType && env.AUDIT_CHECKPOINT_VAULT_PATH)) {
      return new DetachedVaultCheckpointStore(env.AUDIT_CHECKPOINT_VAULT_PATH);
    }

    if (storeType === "s3" || (!storeType && env.AUDIT_CHECKPOINT_S3_BUCKET)) {
      return new S3AuditCheckpointStore({
        bucket: env.AUDIT_CHECKPOINT_S3_BUCKET || "",
        region: env.AUDIT_CHECKPOINT_S3_REGION || "us-east-1",
        endpoint: env.AUDIT_CHECKPOINT_S3_ENDPOINT,
        accessKeyId: env.AUDIT_CHECKPOINT_S3_KEY_ID,
        secretAccessKey: env.AUDIT_CHECKPOINT_S3_SECRET_KEY,
        prefix: env.AUDIT_CHECKPOINT_S3_PREFIX,
        objectLockCompliance: env.AUDIT_CHECKPOINT_S3_OBJECT_LOCK === "true",
      });
    }

    throw new Error(
      "Production security violation: External audit checkpoint store must be configured in production (AUDIT_CHECKPOINT_STORE_TYPE='vault' or 's3')."
    );
  }

  // Development / Test fallbacks
  if (storeType === "vault" || env.AUDIT_CHECKPOINT_VAULT_PATH) {
    return new DetachedVaultCheckpointStore(env.AUDIT_CHECKPOINT_VAULT_PATH);
  }

  if (storeType === "s3" || env.AUDIT_CHECKPOINT_S3_BUCKET) {
    return new S3AuditCheckpointStore({
      bucket: env.AUDIT_CHECKPOINT_S3_BUCKET || "dev-audit-bucket",
      region: env.AUDIT_CHECKPOINT_S3_REGION,
      endpoint: env.AUDIT_CHECKPOINT_S3_ENDPOINT,
      prefix: env.AUDIT_CHECKPOINT_S3_PREFIX,
    });
  }

  // Permitted ONLY in non-production
  return new InMemoryCheckpointStore();
}

/**
 * High-level verification helper using configured external store.
 * Catches store outages/exceptions and returns fail-closed CHECKPOINT_STORE_ERROR.
 */
export async function verifyAuditWithConfiguredStore(
  events: AuditEvent[],
  store?: AuditCheckpointStore,
  signingKey?: string
): Promise<CheckpointVerificationResult> {
  const key = signingKey || process.env.AUDIT_CHECKPOINT_SIGNING_KEY;
  if (!key) {
    return {
      valid: false,
      status: "TAMPERED_CHECKPOINT_SIGNATURE",
      reason: "Missing checkpoint signing key: AUDIT_CHECKPOINT_SIGNING_KEY is required.",
      ledgerEventCount: events.length,
      ledgerHeadHash: events.length > 0 ? events[events.length - 1].eventHash : null,
    };
  }

  let activeStore = store;
  if (!activeStore) {
    try {
      activeStore = createConfiguredCheckpointStore();
    } catch (err: any) {
      return {
        valid: false,
        status: "CHECKPOINT_STORE_ERROR",
        reason: `Checkpoint store initialization failure: ${err.message}`,
        ledgerEventCount: events.length,
        ledgerHeadHash: events.length > 0 ? events[events.length - 1].eventHash : null,
      };
    }
  }

  try {
    const checkpoint = await activeStore.readLatestCheckpoint();
    return verifyLedgerAgainstCheckpoint(events, checkpoint, key);
  } catch (err: any) {
    return {
      valid: false,
      status: "CHECKPOINT_STORE_ERROR",
      reason: `External checkpoint store failure: ${err.message}`,
      ledgerEventCount: events.length,
      ledgerHeadHash: events.length > 0 ? events[events.length - 1].eventHash : null,
    };
  }
}
