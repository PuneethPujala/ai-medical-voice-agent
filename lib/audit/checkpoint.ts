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
  /** HMAC-SHA256 (symmetric) or RSA-SHA256 (asymmetric PEM) signature over canonical payload */
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
 *
 * KEY CUSTODY & SIGNING SECURITY SPECIFICATION:
 * - Symmetric Keys (HMAC): The secret key MUST be injected via secure environment variables
 *   (AUDIT_CHECKPOINT_SIGNING_KEY) and never committed or logged. Both signing and verification
 *   require this secret; an attacker with application environment access could forge checkpoints.
 * - PEM-based Asymmetric Keys (RSA): Private key signs; public key verifies. The private key
 *   must be strictly isolated to the signing service/worker. Verifiers only need the public key.
 * - Hardware KMS/HSM Distinction: In-process PEM signing is asymmetric software cryptography.
 *   It is NOT managed cloud KMS or PKCS#11 HSM hardware integration, which requires non-exportable
 *   keys executed via remote API dispatch (e.g. AWS KMS Sign).
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
 * Stores checkpoints in a dedicated directory isolated from primary database files.
 * Implements atomic writes via temporary files and rename, monotonic event count enforcement,
 * and durability across process restarts.
 *
 * TRUST BOUNDARY & ISOLATION SPECIFICATION:
 * - Co-located Host Limitation: When vaultDir resides on the same host or filesystem as the
 *   primary database or web application, it protects against database-layer mutations, SQL injection,
 *   compromised database connection pools, and application crashes. It DOES NOT provide an independent
 *   trust boundary against an attacker with host-level administrative (root) access or identical
 *   filesystem write permissions.
 * - Independent Trust Isolation: For institutional pilots requiring host-level non-repudiation,
 *   vaultDir MUST be an independently mounted, append-only volume (e.g. WORM network share, dedicated
 *   NFS with append-only restrictions, or an isolated vault microservice with distinct credentials).
 * - Discrete Object Cross-Verification: To prevent trusting a mutated latest.json pointer,
 *   readLatestCheckpoint verifies that the corresponding discrete immutable checkpoint file exists
 *   and matches before returning it. If latest.json is missing or corrupted, it falls back to
 *   a complete directory scan of discrete files.
 * - Complete Highest-Count Fork Detection: When multiple discrete checkpoint files exist at the
 *   highest eventCount, ALL candidates must agree on checkpointId and headHash. Any conflict throws
 *   an explicit fork error, failing closed.
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

    if (fs.existsSync(targetFilePath)) {
      const existing = await fs.promises.readFile(targetFilePath, "utf8");
      if (existing !== payload) {
        throw new Error(`Fork rejected: discrete checkpoint '${targetFileName}' already exists with different content.`);
      }
    }

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

      // Fast-path: read latest.json and cross-verify with discrete immutable file
      const latestFilePath = path.join(this.vaultDir, "latest.json");
      if (fs.existsSync(latestFilePath)) {
        try {
          const raw = await fs.promises.readFile(latestFilePath, "utf8");
          const parsed = JSON.parse(raw);
          if (parsed && parsed.schemaVersion === AUDIT_CHECKPOINT_SCHEMA_VERSION && typeof parsed.eventCount === "number") {
            const paddedCount = String(parsed.eventCount).padStart(12, "0");
            const discretePath = path.join(this.vaultDir, `checkpoint-${paddedCount}-${parsed.checkpointId}.json`);
            if (fs.existsSync(discretePath)) {
              return parsed as AuditCheckpoint;
            }
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

      const topCandidates: AuditCheckpoint[] = [];
      let topCount: number | null = null;

      for (const file of checkpointFiles) {
        try {
          const raw = await fs.promises.readFile(path.join(this.vaultDir, file), "utf8");
          const parsed = JSON.parse(raw);
          if (parsed && parsed.schemaVersion === AUDIT_CHECKPOINT_SCHEMA_VERSION && typeof parsed.eventCount === "number") {
            const cp = parsed as AuditCheckpoint;
            if (topCount === null) {
              topCount = cp.eventCount;
              topCandidates.push(cp);
            } else if (cp.eventCount === topCount) {
              topCandidates.push(cp);
            } else {
              // Collected all candidates at the highest event count
              break;
            }
          }
        } catch {
          continue;
        }
      }

      if (topCandidates.length > 0) {
        const anchor = topCandidates[0];
        // Complete fork check across ALL candidates at highest eventCount
        for (let i = 1; i < topCandidates.length; i++) {
          if (topCandidates[i].headHash !== anchor.headHash || topCandidates[i].checkpointId !== anchor.checkpointId) {
            throw new Error(`Fork detected at eventCount ${anchor.eventCount}: multiple conflicting checkpoint files exist in vault.`);
          }
        }
        return anchor;
      }

      return null;
    } catch (err: any) {
      if (err.code === "ENOENT") return null;
      throw err;
    }
  }
}

export type S3ProviderType = "aws" | "minio" | "r2" | "generic";

export interface S3CheckpointConfig {
  bucket: string;
  provider?: S3ProviderType;
  region?: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  prefix?: string;
  objectLockCompliance?: boolean;
  objectLockRetainUntilDays?: number;
  customFetch?: typeof fetch;
}

interface S3ObjectCandidate {
  key: string;
  versionId?: string;
}

/**
 * S3-compatible cloud external checkpoint store.
 * Supports AWS S3 and MinIO with Object Lock headers for immutable WORM compliance.
 *
 * PROVIDER CAPABILITY & WORM SPECIFICATION:
 * - AWS S3: Supports true WORM when the target bucket has Object Lock and Versioning enabled
 *   at bucket creation time. AWS mandates the Content-MD5 header and a valid retain-until date
 *   on all PUT Object requests specifying retention settings.
 * - MinIO: Supports S3 Object Lock compliance when started with Object Lock enabled.
 * - Cloudflare R2: Explicitly does NOT support S3 Object Lock (x-amz-object-lock-mode and retention
 *   headers are unimplemented per Cloudflare documentation). Configuring objectLockCompliance with R2
 *   is strictly rejected at initialization to prevent false WORM assurances. R2 is supported as a
 *   standard external checkpoint store only.
 *
 * OBJECT SELECTION, DELETE-MARKER & VERSION RESILIENCE:
 * - S3 Object Lock locks individual object versions. Putting a new object with the same key
 *   or deleting a key creates a new version or delete marker without deleting the underlying version.
 * - SCENARIO A: Delete marker on pointer key ('latest.json') -> Store cross-checks and falls back
 *   to version-aware discrete object discovery.
 * - SCENARIO B: Delete marker placed over a discrete checkpoint object ('checkpoint-*.json') ->
 *   ListObjectsV2 omits the key. The store uses ListObjectVersions ('?versions') with full pagination
 *   (IsTruncated, NextKeyMarker, NextVersionIdMarker) to discover retained, locked object versions
 *   and retrieves them via '?versionId=', completely bypassing delete markers!
 * - COMPREHENSIVE FORK DEFENSE: If multiple candidate checkpoints are discovered at the highest
 *   eventCount, the store verifies that ALL candidates agree on checkpointId and headHash. Any
 *   conflict among any candidates triggers an explicit Fork Error, failing closed.
 */
export class S3AuditCheckpointStore implements AuditCheckpointStore {
  readonly config: S3CheckpointConfig;
  private readonly baseUrl: string;

  constructor(config: S3CheckpointConfig) {
    if (!config.bucket) {
      throw new Error("S3AuditCheckpointStore requires a bucket name.");
    }

    const provider = config.provider || "aws";
    if (provider === "r2" && config.objectLockCompliance) {
      throw new Error(
        "Provider Capability Violation: Cloudflare R2 does not implement S3 Object Lock (WORM). " +
        "Cannot configure objectLockCompliance with provider 'r2'. Use AWS S3 or MinIO with an Object Lock-enabled " +
        "bucket for WORM compliance, or disable objectLockCompliance to use R2 as a standard external checkpoint store."
      );
    }

    if (config.objectLockCompliance) {
      const days = config.objectLockRetainUntilDays;
      if (typeof days !== "number" || !Number.isInteger(days) || days <= 0) {
        throw new Error(
          "S3 Object Lock Compliance requires 'objectLockRetainUntilDays' to be a positive integer (e.g. 1 to 36500 days)."
        );
      }
      if (days > 36500) {
        throw new Error(
          "S3 Object Lock Compliance 'objectLockRetainUntilDays' exceeds maximum supported retention period of 36500 days (100 years)."
        );
      }
    }

    this.config = { ...config, provider };
    const endpoint = config.endpoint || `https://${config.bucket}.s3.${config.region || "us-east-1"}.amazonaws.com`;
    this.baseUrl = endpoint.replace(/\/$/, "");
  }

  private getKey(fileName: string): string {
    const prefix = this.config.prefix ? this.config.prefix.replace(/^\/+|\/+$/g, "") + "/" : "";
    return `${prefix}${fileName}`;
  }

  async writeCheckpoint(checkpoint: AuditCheckpoint): Promise<void> {
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
    const discreteKey = this.getKey(`checkpoint-${paddedCount}-${checkpoint.checkpointId}.json`);
    const latestKey = this.getKey("latest.json");

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "If-None-Match": "*", // Prevent overwriting existing discrete key
    };

    if (this.config.objectLockCompliance) {
      headers["x-amz-object-lock-mode"] = "COMPLIANCE";
      const days = this.config.objectLockRetainUntilDays!;
      const retainDate = new Date(Date.now() + days * 86400 * 1000).toISOString();
      headers["x-amz-object-lock-retain-until-date"] = retainDate;
      // AWS S3 explicitly mandates Content-MD5 on Object Lock PUT Object requests
      headers["Content-MD5"] = createHash("md5").update(payload, "utf8").digest("base64");
    }

    const fetchFn = this.config.customFetch || fetch;

    // 1. Put discrete immutable checkpoint object
    const discreteUrl = `${this.baseUrl}/${discreteKey}`;
    const resDiscrete = await fetchFn(discreteUrl, {
      method: "PUT",
      headers,
      body: payload,
    });

    if (resDiscrete.status === 412) {
      throw new Error(`Fork rejected: discrete checkpoint already exists at key '${discreteKey}'.`);
    }

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

  /**
   * Version-aware candidate listing using ListObjectVersions (?versions).
   * Fully handles multi-page pagination using IsTruncated, NextKeyMarker, and NextVersionIdMarker.
   * Unlike ListObjectsV2, ListObjectVersions reveals underlying retained object versions
   * even when an active delete marker has been placed over a key!
   */
  private async listDiscreteCheckpointCandidates(): Promise<S3ObjectCandidate[]> {
    const prefix = this.getKey("checkpoint-");
    const fetchFn = this.config.customFetch || fetch;
    const candidates: S3ObjectCandidate[] = [];

    // 1. Primary: ListObjectVersions (?versions) with pagination
    try {
      let isTruncated = true;
      let keyMarker: string | undefined;
      let versionIdMarker: string | undefined;
      let pageCount = 0;
      const maxPages = 100; // Safeguard up to 100,000 versions

      while (isTruncated && pageCount < maxPages) {
        pageCount++;
        let versionsUrl = `${this.baseUrl}/?versions&prefix=${encodeURIComponent(prefix)}`;
        if (keyMarker) {
          versionsUrl += `&key-marker=${encodeURIComponent(keyMarker)}`;
        }
        if (versionIdMarker) {
          versionsUrl += `&version-id-marker=${encodeURIComponent(versionIdMarker)}`;
        }

        const res = await fetchFn(versionsUrl, { method: "GET" });
        if (!res.ok) {
          throw new Error(`S3 ListObjectVersions failed on page ${pageCount}: HTTP ${res.status}`);
        }

        const xml = await res.text().catch(() => "");
        // Match each <Version> block (excluding <DeleteMarker> blocks)
        const versionBlocks = xml.match(/<Version>[\s\S]*?<\/Version>/g) || [];

        for (const block of versionBlocks) {
          const keyMatch = block.match(/<Key>([^<]+)<\/Key>/);
          const versionMatch = block.match(/<VersionId>([^<]+)<\/VersionId>/);
          if (keyMatch && keyMatch[1].endsWith(".json")) {
            candidates.push({
              key: keyMatch[1],
              versionId: versionMatch ? versionMatch[1] : undefined,
            });
          }
        }

        const isTruncatedMatch = xml.match(/<IsTruncated>(true|false)<\/IsTruncated>/i);
        isTruncated = isTruncatedMatch ? isTruncatedMatch[1].toLowerCase() === "true" : false;

        if (isTruncated) {
          const nextKeyMatch = xml.match(/<NextKeyMarker>([^<]+)<\/NextKeyMarker>/);
          const nextVerMatch = xml.match(/<NextVersionIdMarker>([^<]+)<\/NextVersionIdMarker>/);
          if (!nextKeyMatch) {
            throw new Error("S3 ListObjectVersions returned truncated result without NextKeyMarker.");
          }
          keyMarker = nextKeyMatch[1];
          versionIdMarker = nextVerMatch ? nextVerMatch[1] : undefined;
        }
      }

      if (candidates.length > 0) {
        return candidates.sort((a, b) => b.key.localeCompare(a.key));
      }
    } catch (err: any) {
      if (!candidates.length && (err.message?.includes("HTTP 404") || err.message?.includes("HTTP 501") || err.message?.includes("HTTP 403"))) {
        // Fall back to ListObjectsV2 if provider does not support version listing
      } else {
        throw err; // Fail closed on pagination or network failure
      }
    }

    // 2. Secondary fallback: ListObjectsV2 (?list-type=2) with continuation-token pagination
    try {
      let isTruncated = true;
      let continuationToken: string | undefined;
      let pageCount = 0;
      const maxPages = 100;

      while (isTruncated && pageCount < maxPages) {
        pageCount++;
        let listUrl = `${this.baseUrl}/?list-type=2&prefix=${encodeURIComponent(prefix)}`;
        if (continuationToken) {
          listUrl += `&continuation-token=${encodeURIComponent(continuationToken)}`;
        }

        const res = await fetchFn(listUrl, { method: "GET" });
        if (!res.ok) {
          throw new Error(`S3 ListObjectsV2 failed on page ${pageCount}: HTTP ${res.status}`);
        }

        const xml = await res.text().catch(() => "");
        const matches = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)];
        for (const m of matches) {
          if (m[1].endsWith(".json")) {
            candidates.push({ key: m[1] });
          }
        }

        const isTruncatedMatch = xml.match(/<IsTruncated>(true|false)<\/IsTruncated>/i);
        isTruncated = isTruncatedMatch ? isTruncatedMatch[1].toLowerCase() === "true" : false;

        if (isTruncated) {
          const nextTokenMatch = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
          if (!nextTokenMatch) {
            throw new Error("S3 ListObjectsV2 returned truncated result without NextContinuationToken.");
          }
          continuationToken = nextTokenMatch[1];
        }
      }

      return candidates.sort((a, b) => b.key.localeCompare(a.key));
    } catch (err: any) {
      throw err; // Fail closed on listing failures
    }
  }

  async readLatestCheckpoint(): Promise<AuditCheckpoint | null> {
    const latestKey = this.getKey("latest.json");
    const url = `${this.baseUrl}/${latestKey}`;
    const fetchFn = this.config.customFetch || fetch;

    // Fast-path: try latest.json with discrete cross-validation
    try {
      const res = await fetchFn(url, { method: "GET" });
      if (res.ok) {
        const data = await res.json();
        if (data && data.schemaVersion === AUDIT_CHECKPOINT_SCHEMA_VERSION && typeof data.eventCount === "number" && data.checkpointId) {
          // Cross-verify that discrete immutable object exists and matches
          const paddedCount = String(data.eventCount).padStart(12, "0");
          const discreteKey = this.getKey(`checkpoint-${paddedCount}-${data.checkpointId}.json`);
          const discreteRes = await fetchFn(`${this.baseUrl}/${discreteKey}`, { method: "GET" });
          if (discreteRes.ok) {
            const discreteData = await discreteRes.json();
            if (discreteData && discreteData.headHash === data.headHash && discreteData.signature === data.signature) {
              return data as AuditCheckpoint;
            }
          }
        }
      }
    } catch {
      // On network/parse failure, continue to version-aware listing
    }

    // Fallback/Recovery: version-aware discrete object discovery with complete fork checking
    try {
      const candidates = await this.listDiscreteCheckpointCandidates();
      const validCandidatesAtMax: AuditCheckpoint[] = [];
      let highestEventCount: number | null = null;

      for (const candidate of candidates) {
        try {
          const candidateUrl = candidate.versionId && candidate.versionId !== "null"
            ? `${this.baseUrl}/${candidate.key}?versionId=${encodeURIComponent(candidate.versionId)}`
            : `${this.baseUrl}/${candidate.key}`;

          const resCandidate = await fetchFn(candidateUrl, { method: "GET" });
          if (resCandidate.ok) {
            const discreteData = await resCandidate.json();
            if (
              discreteData &&
              discreteData.schemaVersion === AUDIT_CHECKPOINT_SCHEMA_VERSION &&
              typeof discreteData.eventCount === "number" &&
              discreteData.headHash
            ) {
              const cp = discreteData as AuditCheckpoint;
              if (highestEventCount === null) {
                highestEventCount = cp.eventCount;
                validCandidatesAtMax.push(cp);
              } else if (cp.eventCount === highestEventCount) {
                // Collect ALL candidates sharing the maximum event count
                validCandidatesAtMax.push(cp);
              } else if (cp.eventCount < highestEventCount) {
                // Since candidates are sorted descending, once we see a lower count, all max candidates have been evaluated
                break;
              }
            }
          }
        } catch (err: any) {
          if (err.message && err.message.includes("Fork detected")) {
            throw err;
          }
          continue;
        }
      }

      // Complete highest-count fork detection across ALL candidates:
      if (validCandidatesAtMax.length > 0) {
        const anchor = validCandidatesAtMax[0];
        for (let i = 1; i < validCandidatesAtMax.length; i++) {
          const candidate = validCandidatesAtMax[i];
          if (candidate.headHash !== anchor.headHash || candidate.checkpointId !== anchor.checkpointId) {
            throw new Error(
              `Fork detected at eventCount ${anchor.eventCount}: multiple conflicting checkpoint versions exist ('${anchor.checkpointId}' vs '${candidate.checkpointId}').`
            );
          }
        }
        return anchor;
      }
    } catch (err: any) {
      if (err.message && (err.message.includes("Fork detected") || err.message.includes("ListObjectVersions failed") || err.message.includes("without NextKeyMarker"))) {
        throw err;
      }
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
      const retainDaysStr = env.AUDIT_CHECKPOINT_S3_RETAIN_DAYS;
      const retainDays = retainDaysStr ? parseInt(retainDaysStr, 10) : undefined;

      return new S3AuditCheckpointStore({
        bucket: env.AUDIT_CHECKPOINT_S3_BUCKET || "",
        provider: (env.AUDIT_CHECKPOINT_S3_PROVIDER as S3ProviderType) || "aws",
        region: env.AUDIT_CHECKPOINT_S3_REGION || "us-east-1",
        endpoint: env.AUDIT_CHECKPOINT_S3_ENDPOINT,
        accessKeyId: env.AUDIT_CHECKPOINT_S3_KEY_ID,
        secretAccessKey: env.AUDIT_CHECKPOINT_S3_SECRET_KEY,
        prefix: env.AUDIT_CHECKPOINT_S3_PREFIX,
        objectLockCompliance: env.AUDIT_CHECKPOINT_S3_OBJECT_LOCK === "true",
        objectLockRetainUntilDays: retainDays,
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
      provider: (env.AUDIT_CHECKPOINT_S3_PROVIDER as S3ProviderType) || "aws",
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
