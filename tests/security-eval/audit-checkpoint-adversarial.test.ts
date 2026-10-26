import assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { generateKeyPairSync } from "crypto";
import {
  AuditEvent,
  computeEventHash,
  verifyAuditChain,
  GENESIS_HASH,
} from "../../lib/audit/audit-logger";
import {
  AuditCheckpoint,
  InMemoryCheckpointStore,
  DetachedVaultCheckpointStore,
  S3AuditCheckpointStore,
  createAuditCheckpoint,
  verifyLedgerAgainstCheckpoint,
  createConfiguredCheckpointStore,
  verifyAuditWithConfiguredStore,
  computeCheckpointSignature,
  verifyCheckpointSignature,
} from "../../lib/audit/checkpoint";

const SIGNING_SECRET = "medvoice-secure-audit-checkpoint-secret-key-2026";
const ATTACKER_SECRET = "attacker-forged-secret-key-cannot-match-real-key";

function generateCleanLedger(count: number): AuditEvent[] {
  const events: AuditEvent[] = [];
  for (let i = 0; i < count; i++) {
    const previousHash = i === 0 ? GENESIS_HASH : events[i - 1].eventHash;
    const partial: Omit<AuditEvent, "eventHash"> = {
      index: i,
      id: `AUD-TEST-${i}`,
      timestamp: new Date(Date.now() + i * 1000).toISOString(),
      actorId: `usr-doctor-${i % 3}`,
      actorRole: "clinician",
      action: "TRIAGE_EVALUATION",
      resourceType: "consultation",
      resourceId: `CONS-${i}`,
      status: "SUCCESS",
      metadata: { score: i, valid: true },
      previousHash,
    };
    events.push({
      ...partial,
      eventHash: computeEventHash(partial),
    });
  }
  return events;
}

async function runCheckpointAdversarialSuite() {
  console.log("================================================================================");
  console.log("   AUDIT-CHAIN EXTERNAL CHECKPOINT VERIFICATION & ADVERSARIAL BATTERY           ");
  console.log("================================================================================");

  const store = new InMemoryCheckpointStore();
  const initialLedger = generateCleanLedger(5);

  // ---------------------------------------------------------------------------
  // Test 1: Unmodified ledger passes verification against trusted checkpoint
  // ---------------------------------------------------------------------------
  console.log("\n[Test 1] Unmodified ledger passes verification against trusted checkpoint");
  const checkpoint1 = createAuditCheckpoint(initialLedger, SIGNING_SECRET);
  await store.writeCheckpoint(checkpoint1);

  const res1 = verifyLedgerAgainstCheckpoint(initialLedger, checkpoint1, SIGNING_SECRET);
  assert.strictEqual(res1.valid, true, "Unmodified ledger must be valid");
  assert.strictEqual(res1.status, "VERIFIED", "Status is VERIFIED");
  console.log("  ✓ Test 1 Passed: Unmodified 5-event ledger passes verification.");

  // ---------------------------------------------------------------------------
  // Test 2: Single-event metadata mutation fails
  // ---------------------------------------------------------------------------
  console.log("\n[Test 2] Single-event metadata mutation fails");
  const tamperedLedger2 = JSON.parse(JSON.stringify(initialLedger));
  tamperedLedger2[2].metadata.score = 999; // Corrupt without updating eventHash

  const res2 = verifyLedgerAgainstCheckpoint(tamperedLedger2, checkpoint1, SIGNING_SECRET);
  assert.strictEqual(res2.valid, false, "Tampered metadata must fail");
  assert.strictEqual(res2.status, "INTERNAL_CHAIN_INVALID");
  assert.strictEqual(res2.corruptedIndex, 2);
  console.log("  ✓ Test 2 Passed: Single-event mutation caught by internal chain verification.");

  // ---------------------------------------------------------------------------
  // Test 3: Event mutation followed by full downstream hash recalculation
  // (Crucial: Passes ordinary verifyAuditChain, but FAILS against checkpoint!)
  // ---------------------------------------------------------------------------
  console.log("\n[Test 3] Event mutation + full recalculation fails against trusted checkpoint");
  const rewrittenLedger3: AuditEvent[] = JSON.parse(JSON.stringify(initialLedger));
  // Attacker alters event index 2
  rewrittenLedger3[2].metadata = { score: 999, attackerInjected: true };
  rewrittenLedger3[2].eventHash = computeEventHash(rewrittenLedger3[2]);

  // Attacker recalculates all subsequent hashes (index 3 and 4)
  for (let i = 3; i < rewrittenLedger3.length; i++) {
    rewrittenLedger3[i].previousHash = rewrittenLedger3[i - 1].eventHash;
    rewrittenLedger3[i].eventHash = computeEventHash(rewrittenLedger3[i]);
  }

  // Demonstration: Ordinary hash-chain verifier ALONE accepts the rewritten chain!
  const ordinaryCheck = verifyAuditChain(rewrittenLedger3);
  assert.strictEqual(ordinaryCheck.valid, true, "Demonstration: Ordinary chain verification is fooled by recalculation!");
  console.log("    (Confirmed: Ordinary in-database chain verification alone accepts recalculated ledger)");

  // Checkpoint verification MUST detect the rewrite!
  const res3 = verifyLedgerAgainstCheckpoint(rewrittenLedger3, checkpoint1, SIGNING_SECRET);
  assert.strictEqual(res3.valid, false, "Checkpoint verification must catch rewritten ledger");
  assert.strictEqual(res3.status, "REWRITTEN_LEDGER_DETECTED");
  assert.strictEqual(res3.corruptedIndex, 4, "Flags discrepancy at checkpoint head index");
  console.log("  ✓ Test 3 Passed: Checkpoint verification successfully exposes fully recalculated chain rewrite.");

  // ---------------------------------------------------------------------------
  // Test 4: Middle-event deletion fails
  // ---------------------------------------------------------------------------
  console.log("\n[Test 4] Middle-event deletion fails");
  const deletedLedger4 = [...initialLedger.slice(0, 2), ...initialLedger.slice(3)];
  const res4 = verifyLedgerAgainstCheckpoint(deletedLedger4, checkpoint1, SIGNING_SECRET);
  assert.strictEqual(res4.valid, false);
  console.log(`  ✓ Test 4 Passed: Middle deletion caught (${res4.status}).`);

  // ---------------------------------------------------------------------------
  // Test 5: Tail truncation fails
  // ---------------------------------------------------------------------------
  console.log("\n[Test 5] Tail truncation fails (ledger shorter than checkpoint count)");
  const truncatedLedger5 = initialLedger.slice(0, 3); // 3 events instead of 5
  const res5 = verifyLedgerAgainstCheckpoint(truncatedLedger5, checkpoint1, SIGNING_SECRET);
  assert.strictEqual(res5.valid, false);
  assert.strictEqual(res5.status, "TRUNCATED_LEDGER_DETECTED");
  console.log("  ✓ Test 5 Passed: Truncated ledger strictly rejected.");

  // ---------------------------------------------------------------------------
  // Test 6: Entire-ledger rewrite with newly minted hashes fails
  // ---------------------------------------------------------------------------
  console.log("\n[Test 6] Entire-ledger rewrite with completely new events fails against checkpoint");
  const brandNewLedger6 = generateCleanLedger(5); // Clean 5 events, but totally different IDs/timestamps
  const ordinaryCheck6 = verifyAuditChain(brandNewLedger6);
  assert.strictEqual(ordinaryCheck6.valid, true, "New ledger is internally valid");

  const res6 = verifyLedgerAgainstCheckpoint(brandNewLedger6, checkpoint1, SIGNING_SECRET);
  assert.strictEqual(res6.valid, false);
  assert.strictEqual(res6.status, "REWRITTEN_LEDGER_DETECTED");
  console.log("  ✓ Test 6 Passed: Completely replaced ledger rejected against external checkpoint.");

  // ---------------------------------------------------------------------------
  // Test 7: Tampered checkpoint signature fails
  // ---------------------------------------------------------------------------
  console.log("\n[Test 7] Tampered checkpoint signature fails");
  const forgedCheckpoint7: AuditCheckpoint = {
    ...checkpoint1,
    signature: "0000111122223333444455556666777788889999aaaabbbbccccddddeeeeffff",
  };
  const res7 = verifyLedgerAgainstCheckpoint(initialLedger, forgedCheckpoint7, SIGNING_SECRET);
  assert.strictEqual(res7.valid, false);
  assert.strictEqual(res7.status, "TAMPERED_CHECKPOINT_SIGNATURE");
  console.log("  ✓ Test 7 Passed: Forged signature rejected.");

  // ---------------------------------------------------------------------------
  // Test 8: Older checkpoint replay detection (Store rollback defense)
  // ---------------------------------------------------------------------------
  console.log("\n[Test 8] Checkpoint store rejects rollback to older event count");
  const advancedLedger8 = generateCleanLedger(10);
  const advancedCheckpoint8 = createAuditCheckpoint(advancedLedger8, SIGNING_SECRET);
  await store.writeCheckpoint(advancedCheckpoint8);

  // Attempting to overwrite store with older checkpoint1 (5 events) must throw
  let storeRollbackBlocked = false;
  try {
    await store.writeCheckpoint(checkpoint1);
  } catch (err: any) {
    storeRollbackBlocked = true;
    assert(err.message.includes("Rollback rejected"));
  }
  assert.strictEqual(storeRollbackBlocked, true, "Store must prevent writing older checkpoint");
  console.log("  ✓ Test 8 Passed: Checkpoint store enforces monotonic advancement and blocks replay.");

  // ---------------------------------------------------------------------------
  // Test 9: Missing checkpoint produces explicit UNANCHORED status (never silent pass)
  // ---------------------------------------------------------------------------
  console.log("\n[Test 9] Missing checkpoint returns explicit UNANCHORED status");
  const res9 = verifyLedgerAgainstCheckpoint(initialLedger, null, SIGNING_SECRET);
  assert.strictEqual(res9.valid, false);
  assert.strictEqual(res9.status, "UNANCHORED_NO_CHECKPOINT");
  console.log("  ✓ Test 9 Passed: Missing checkpoint returns explicit unanchored status.");

  // ---------------------------------------------------------------------------
  // Test 10: Checkpoint created with invalid internal chain strictly fails closed
  // ---------------------------------------------------------------------------
  console.log("\n[Test 10] Minting checkpoint on invalid chain fails closed");
  let mintingBlocked = false;
  try {
    createAuditCheckpoint(tamperedLedger2, SIGNING_SECRET);
  } catch (err: any) {
    mintingBlocked = true;
    assert(err.message.includes("Cannot create checkpoint"));
  }
  assert.strictEqual(mintingBlocked, true, "Minting must throw on corrupted input chain");
  console.log("  ✓ Test 10 Passed: createAuditCheckpoint refuses to sign invalid chains.");

  // ===========================================================================
  // P1.1 EXTERNAL ADAPTER & DURABILITY TEST SUITE (Tests 11 - 25)
  // ===========================================================================

  const testVaultDir = path.join(os.tmpdir(), `medvoice-vault-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);

  try {
    // -------------------------------------------------------------------------
    // Test 11: DetachedVaultCheckpointStore persistence across process restarts
    // -------------------------------------------------------------------------
    console.log("\n[Test 11] DetachedVaultCheckpointStore persists and recovers across simulated process restart");
    const vaultStore1 = new DetachedVaultCheckpointStore(testVaultDir);
    const ledger11 = generateCleanLedger(7);
    const cp11 = createAuditCheckpoint(ledger11, SIGNING_SECRET, "CHK-VAULT-RESTART-001");
    await vaultStore1.writeCheckpoint(cp11);

    // Simulate process termination and fresh process instantiation pointing to the same vault directory
    const vaultStore2 = new DetachedVaultCheckpointStore(testVaultDir);
    const recoveredCp = await vaultStore2.readLatestCheckpoint();

    assert.ok(recoveredCp, "Recovered checkpoint must exist");
    assert.strictEqual(recoveredCp.checkpointId, cp11.checkpointId);
    assert.strictEqual(recoveredCp.eventCount, 7);
    assert.strictEqual(recoveredCp.headHash, cp11.headHash);
    assert.strictEqual(recoveredCp.signature, cp11.signature);

    const verifyRecovered = verifyLedgerAgainstCheckpoint(ledger11, recoveredCp, SIGNING_SECRET);
    assert.strictEqual(verifyRecovered.valid, true);
    assert.strictEqual(verifyRecovered.status, "VERIFIED");
    console.log("  ✓ Test 11 Passed: DetachedVaultCheckpointStore survives process restarts with full cryptographic validity.");

    // -------------------------------------------------------------------------
    // Test 12: DetachedVaultCheckpointStore directory recovery when latest.json is damaged
    // -------------------------------------------------------------------------
    console.log("\n[Test 12] DetachedVaultCheckpointStore recovers highest checkpoint even if latest.json is damaged");
    const latestFile = path.join(testVaultDir, "latest.json");
    fs.writeFileSync(latestFile, "CORRUPTED_JSON_NOT_VALID", "utf8");

    // Fresh store reading should fall back to scanning discrete checkpoint files
    const vaultStore3 = new DetachedVaultCheckpointStore(testVaultDir);
    const fallbackCp = await vaultStore3.readLatestCheckpoint();
    assert.ok(fallbackCp, "Fallback scan must find discrete checkpoint");
    assert.strictEqual(fallbackCp.checkpointId, cp11.checkpointId);
    console.log("  ✓ Test 12 Passed: Directory scan successfully recovers checkpoint when pointer file is corrupted.");

    // -------------------------------------------------------------------------
    // Test 13: DetachedVaultCheckpointStore blocks rollback and forks
    // -------------------------------------------------------------------------
    console.log("\n[Test 13] DetachedVaultCheckpointStore strictly blocks rollback and forks");
    const smallerCp = createAuditCheckpoint(generateCleanLedger(3), SIGNING_SECRET);
    let vaultRollbackBlocked = false;
    try {
      await vaultStore2.writeCheckpoint(smallerCp);
    } catch (err: any) {
      vaultRollbackBlocked = true;
      assert(err.message.includes("Rollback rejected"));
    }
    assert.strictEqual(vaultRollbackBlocked, true, "Vault must reject older eventCount");

    // Fork attempt: same eventCount (7) but different headHash
    const forkedLedger = generateCleanLedger(7);
    const forkedCp = createAuditCheckpoint(forkedLedger, SIGNING_SECRET, "CHK-FORK-001");
    let forkBlocked = false;
    try {
      await vaultStore2.writeCheckpoint(forkedCp);
    } catch (err: any) {
      forkBlocked = true;
      assert(err.message.includes("Fork rejected"));
    }
    assert.strictEqual(forkBlocked, true, "Vault must reject checkpoint with same count but different headHash");
    console.log("  ✓ Test 13 Passed: DetachedVaultCheckpointStore strictly prevents rollbacks and fork collisions.");

    // -------------------------------------------------------------------------
    // Test 14: Valid ledger extension after anchored checkpoint
    // -------------------------------------------------------------------------
    console.log("\n[Test 14] Valid ledger extensions after checkpoint anchor verify cleanly");
    const baseEvents = generateCleanLedger(5);
    const cp14 = createAuditCheckpoint(baseEvents, SIGNING_SECRET);

    const extendedLedger = [...baseEvents];
    for (let i = 5; i < 8; i++) {
      const prevHash = extendedLedger[i - 1].eventHash;
      const partial: Omit<AuditEvent, "eventHash"> = {
        index: i,
        id: `AUD-TEST-${i}`,
        timestamp: new Date(Date.now() + i * 1000).toISOString(),
        actorId: `usr-doctor-ext`,
        actorRole: "clinician",
        action: "CONSULTATION_UPDATED",
        resourceType: "consultation",
        resourceId: `CONS-EXT-${i}`,
        status: "SUCCESS",
        metadata: { valid: true },
        previousHash: prevHash,
      };
      extendedLedger.push({
        ...partial,
        eventHash: computeEventHash(partial),
      });
    }

    const res14 = verifyLedgerAgainstCheckpoint(extendedLedger, cp14, SIGNING_SECRET);
    assert.strictEqual(res14.valid, true, "Extended ledger must verify valid against anchor");
    assert.strictEqual(res14.status, "VERIFIED");
    assert.strictEqual(res14.ledgerEventCount, 8);
    assert.strictEqual(res14.checkpoint?.eventCount, 5);
    console.log("  ✓ Test 14 Passed: Valid ledger extension (5 anchored, 8 total) is cryptographically verified.");

    // -------------------------------------------------------------------------
    // Test 15: Store outage fails closed with CHECKPOINT_STORE_ERROR
    // -------------------------------------------------------------------------
    console.log("\n[Test 15] External storage outage fails closed with CHECKPOINT_STORE_ERROR");
    const brokenStore = {
      async writeCheckpoint(): Promise<void> {
        throw new Error("Network timeout: S3 / Vault storage endpoint unreachable");
      },
      async readLatestCheckpoint(): Promise<AuditCheckpoint | null> {
        throw new Error("Connection refused: 503 Service Unavailable");
      },
    };

    const res15 = await verifyAuditWithConfiguredStore(extendedLedger, brokenStore, SIGNING_SECRET);
    assert.strictEqual(res15.valid, false, "Store outage must never return valid");
    assert.strictEqual(res15.status, "CHECKPOINT_STORE_ERROR");
    assert.ok(res15.reason.includes("503 Service Unavailable"));
    console.log("  ✓ Test 15 Passed: Store outages fail-closed with explicit CHECKPOINT_STORE_ERROR.");

    // -------------------------------------------------------------------------
    // Test 16: Production security policy forbids InMemoryCheckpointStore
    // -------------------------------------------------------------------------
    console.log("\n[Test 16] Production factory strictly forbids InMemoryCheckpointStore");
    let prodMemoryRejected = false;
    try {
      createConfiguredCheckpointStore({
        NODE_ENV: "production",
        AUDIT_CHECKPOINT_STORE_TYPE: "memory",
      });
    } catch (err: any) {
      prodMemoryRejected = true;
      assert(err.message.includes("prohibited in production"));
    }
    assert.strictEqual(prodMemoryRejected, true, "In-memory store must be rejected in production");

    let prodUnconfiguredRejected = false;
    try {
      createConfiguredCheckpointStore({
        NODE_ENV: "production",
      });
    } catch (err: any) {
      prodUnconfiguredRejected = true;
      assert(err.message.includes("must be configured in production"));
    }
    assert.strictEqual(prodUnconfiguredRejected, true, "Unconfigured store must throw in production");

    const prodVaultStore = createConfiguredCheckpointStore({
      NODE_ENV: "production",
      AUDIT_CHECKPOINT_STORE_TYPE: "vault",
      AUDIT_CHECKPOINT_VAULT_PATH: testVaultDir,
    });
    assert.ok(prodVaultStore instanceof DetachedVaultCheckpointStore, "Produces DetachedVaultCheckpointStore");
    console.log("  ✓ Test 16 Passed: Production fail-closed policy successfully prevents in-memory reliance.");

    // -------------------------------------------------------------------------
    // Test 17: S3AuditCheckpointStore Object-Lock & WORM compliance verification
    // -------------------------------------------------------------------------
    console.log("\n[Test 17] S3AuditCheckpointStore dispatches Object-Lock headers & Content-MD5");
    const s3ObjectStore = new Map<string, string>();
    const s3RecordedRequests: Array<{ url: string; method: string; headers: Record<string, string>; body?: string }> = [];

    const mockFetch: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = input.toString();
      const method = init?.method || "GET";
      const headers = (init?.headers || {}) as Record<string, string>;
      s3RecordedRequests.push({ url, method, headers, body: init?.body as string });

      if (url.includes("?list-type=2")) {
        const prefixMatch = url.match(/prefix=([^&]+)/);
        const prefix = prefixMatch ? decodeURIComponent(prefixMatch[1]) : "";
        const keys = [...s3ObjectStore.keys()].filter((k) => k.includes(prefix));
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Name>medvoice-audit-worm-vault</Name>
  <Prefix>${prefix}</Prefix>
  ${keys.map((k) => `<Contents><Key>${k.split("/").pop()}</Key></Contents>`).join("\n")}
</ListBucketResult>`;
        return new Response(xml, { status: 200, headers: { "Content-Type": "application/xml" } });
      }

      if (method === "GET") {
        if (!s3ObjectStore.has(url)) {
          return new Response("Not Found", { status: 404 });
        }
        return new Response(s3ObjectStore.get(url)!, {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (method === "PUT") {
        s3ObjectStore.set(url, init?.body as string);
        return new Response(null, { status: 200 });
      }

      return new Response("Method not allowed", { status: 405 });
    };

    const s3Store = new S3AuditCheckpointStore({
      bucket: "medvoice-audit-worm-vault",
      provider: "aws",
      region: "us-east-1",
      objectLockCompliance: true,
      objectLockRetainUntilDays: 2555, // 7-year medical compliance hold
      customFetch: mockFetch,
    });

    const s3Checkpoint = createAuditCheckpoint(generateCleanLedger(4), SIGNING_SECRET, "CHK-S3-WORM-01");
    await s3Store.writeCheckpoint(s3Checkpoint);

    const discretePutReq = s3RecordedRequests.find((r) => r.method === "PUT" && r.url.includes("checkpoint-000000000004"));
    assert.ok(discretePutReq, "Discrete S3 checkpoint PUT request must be dispatched");
    assert.strictEqual(discretePutReq.headers["x-amz-object-lock-mode"], "COMPLIANCE");
    assert.ok(discretePutReq.headers["x-amz-object-lock-retain-until-date"], "Retain date header must be present");
    assert.ok(discretePutReq.headers["Content-MD5"], "AWS S3 Object Lock mandates Content-MD5 header on PUT Object");

    const s3Read = await s3Store.readLatestCheckpoint();
    assert.ok(s3Read, "S3 readLatestCheckpoint must retrieve saved checkpoint");
    assert.strictEqual(s3Read.checkpointId, "CHK-S3-WORM-01");
    assert.strictEqual(s3Read.eventCount, 4);
    console.log("  ✓ Test 17 Passed: S3AuditCheckpointStore dispatches compliant WORM headers and required Content-MD5.");

    // -------------------------------------------------------------------------
    // Test 18: PEM-based Asymmetric RSA-SHA256 Key Signing & Verification
    // -------------------------------------------------------------------------
    console.log("\n[Test 18] PEM-based asymmetric RSA-SHA256 key pair signing and verification");
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });

    const rsaLedger = generateCleanLedger(6);
    const rsaCheckpoint = createAuditCheckpoint(rsaLedger, privateKey, "CHK-RSA-PEM-001");

    assert.ok(rsaCheckpoint.signature.length > 64, "RSA signature must be a valid hex signature");
    const rsaValid = verifyCheckpointSignature(rsaCheckpoint, publicKey);
    assert.strictEqual(rsaValid, true, "Public key must verify RSA checkpoint signature");

    const rsaLedgerRes = verifyLedgerAgainstCheckpoint(rsaLedger, rsaCheckpoint, publicKey);
    assert.strictEqual(rsaLedgerRes.valid, true);
    assert.strictEqual(rsaLedgerRes.status, "VERIFIED");

    const tamperedRsaCp = { ...rsaCheckpoint, eventCount: 99 };
    const rsaTamperedValid = verifyCheckpointSignature(tamperedRsaCp, publicKey);
    assert.strictEqual(rsaTamperedValid, false, "Tampered payload must fail RSA verification");
    console.log("  ✓ Test 18 Passed: PEM-based asymmetric RSA-SHA256 signature verification functions correctly.");

    // -------------------------------------------------------------------------
    // Test 19: Cloudflare R2 Provider Capability Guard (Refuses False WORM Claims)
    // -------------------------------------------------------------------------
    console.log("\n[Test 19] S3AuditCheckpointStore rejects objectLockCompliance with provider 'r2'");
    let r2ObjectLockRejected = false;
    try {
      new S3AuditCheckpointStore({
        bucket: "medvoice-r2-bucket",
        provider: "r2",
        objectLockCompliance: true,
      });
    } catch (err: any) {
      r2ObjectLockRejected = true;
      assert(err.message.includes("Cloudflare R2 does not implement S3 Object Lock"));
    }
    assert.strictEqual(r2ObjectLockRejected, true, "R2 with objectLockCompliance must throw");

    const validR2Store = new S3AuditCheckpointStore({
      bucket: "medvoice-r2-bucket",
      provider: "r2",
      objectLockCompliance: false,
      customFetch: mockFetch,
    });
    assert.strictEqual(validR2Store.config.provider, "r2");
    console.log("  ✓ Test 19 Passed: Provider capability guard blocks false WORM assurances on Cloudflare R2.");

    // -------------------------------------------------------------------------
    // Test 20: Vault Filesystem Permission / I/O Outage Fails Closed
    // -------------------------------------------------------------------------
    console.log("\n[Test 20] Detached vault I/O error fails closed with CHECKPOINT_STORE_ERROR");
    const faultyVaultStore = new DetachedVaultCheckpointStore(testVaultDir);
    faultyVaultStore.readLatestCheckpoint = async () => {
      throw new Error("EACCES: permission denied, open 'vault/checkpoints/latest.json'");
    };

    const res20 = await verifyAuditWithConfiguredStore(extendedLedger, faultyVaultStore, SIGNING_SECRET);
    assert.strictEqual(res20.valid, false, "Filesystem fault must never return valid");
    assert.strictEqual(res20.status, "CHECKPOINT_STORE_ERROR");
    assert.ok(res20.reason.includes("EACCES: permission denied"));
    console.log("  ✓ Test 20 Passed: Vault filesystem errors fail closed with explicit CHECKPOINT_STORE_ERROR.");

    // -------------------------------------------------------------------------
    // Test 21: S3 Retention Configuration Strict Parameter Validation
    // -------------------------------------------------------------------------
    console.log("\n[Test 21] S3AuditCheckpointStore validates retention parameters strictly");
    const invalidRetentionCases = [
      { name: "missing retention days", conf: { objectLockCompliance: true } },
      { name: "zero retention days", conf: { objectLockCompliance: true, objectLockRetainUntilDays: 0 } },
      { name: "negative retention days", conf: { objectLockCompliance: true, objectLockRetainUntilDays: -5 } },
      { name: "fractional retention days", conf: { objectLockCompliance: true, objectLockRetainUntilDays: 3.5 } },
      { name: "excessive retention days (> 100 years)", conf: { objectLockCompliance: true, objectLockRetainUntilDays: 50000 } },
    ];

    for (const testCase of invalidRetentionCases) {
      let rejected = false;
      try {
        new S3AuditCheckpointStore({
          bucket: "test-bucket",
          provider: "aws",
          ...(testCase.conf as any),
        });
      } catch (err: any) {
        rejected = true;
        assert(err.message.includes("Object Lock Compliance"));
      }
      assert.strictEqual(rejected, true, `Case '${testCase.name}' must be rejected`);
    }
    console.log("  ✓ Test 21 Passed: S3 Object Lock configuration rejects missing, non-positive, or unreasonable retention periods.");

    // -------------------------------------------------------------------------
    // Test 22: S3 Delete-Marker Resilience on latest.json Pointer
    // -------------------------------------------------------------------------
    console.log("\n[Test 22] S3AuditCheckpointStore recovers locked discrete checkpoint when latest.json has delete marker");
    const deleteMarkerStore = new Map<string, string>();
    const discreteKey = "https://delete-marker-test.s3.us-east-1.amazonaws.com/checkpoint-000000000005-CHK-IMMUTABLE-01.json";
    const latestKey = "https://delete-marker-test.s3.us-east-1.amazonaws.com/latest.json";

    const ledger22 = generateCleanLedger(5);
    const cp22 = createAuditCheckpoint(ledger22, SIGNING_SECRET, "CHK-IMMUTABLE-01");
    deleteMarkerStore.set(discreteKey, JSON.stringify(cp22));
    // Simulate S3 delete marker: latest.json does NOT exist in deleteMarkerStore (404)

    const deleteMarkerFetch: typeof fetch = async (input: RequestInfo | URL): Promise<Response> => {
      const url = input.toString();
      if (url.includes("?list-type=2")) {
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Name>delete-marker-test</Name>
  <Prefix>checkpoint-</Prefix>
  <Contents>
    <Key>checkpoint-000000000005-CHK-IMMUTABLE-01.json</Key>
  </Contents>
</ListBucketResult>`;
        return new Response(xml, { status: 200, headers: { "Content-Type": "application/xml" } });
      }

      if (deleteMarkerStore.has(url)) {
        return new Response(deleteMarkerStore.get(url)!, { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response("NoSuchKey: Delete marker placed", { status: 404 });
    };

    const s3DeleteMarkerStore = new S3AuditCheckpointStore({
      bucket: "delete-marker-test",
      customFetch: deleteMarkerFetch,
    });

    const recoveredFromList = await s3DeleteMarkerStore.readLatestCheckpoint();
    assert.ok(recoveredFromList, "Must recover checkpoint even when latest.json returns 404");
    assert.strictEqual(recoveredFromList.checkpointId, "CHK-IMMUTABLE-01");
    assert.strictEqual(recoveredFromList.eventCount, 5);

    const verifyDeleteMarkerLedger = verifyLedgerAgainstCheckpoint(ledger22, recoveredFromList, SIGNING_SECRET);
    assert.strictEqual(verifyDeleteMarkerLedger.valid, true);
    console.log("  ✓ Test 22 Passed: S3 store queries discrete locked objects and recovers when latest.json has delete marker.");

    // -------------------------------------------------------------------------
    // Test 23: S3 Untrusted Mutable Pointer Tamper Defense
    // -------------------------------------------------------------------------
    console.log("\n[Test 23] S3AuditCheckpointStore detects tampered latest.json pointer and falls back to genuine locked object");
    // Attacker altered latest.json to point to an unverified / rolled-back hash
    const fakeCheckpoint = {
      ...cp22,
      checkpointId: "CHK-FAKE-UNBACKED",
      headHash: "0000000000000000000000000000000000000000000000000000000000000000",
    };
    deleteMarkerStore.set(latestKey, JSON.stringify(fakeCheckpoint));

    const s3TamperedPointerStore = new S3AuditCheckpointStore({
      bucket: "delete-marker-test",
      customFetch: deleteMarkerFetch,
    });

    // Cross-verification against discrete object must fail for fakeCheckpoint, causing fallback to listDiscreteCheckpointKeys
    const genuineRecovered = await s3TamperedPointerStore.readLatestCheckpoint();
    assert.ok(genuineRecovered, "Must recover genuine discrete checkpoint");
    assert.strictEqual(genuineRecovered.checkpointId, "CHK-IMMUTABLE-01", "Must return genuine checkpoint, not fake pointer");
    assert.strictEqual(genuineRecovered.headHash, cp22.headHash);
    console.log("  ✓ Test 23 Passed: Tampered latest.json without matching discrete object is strictly rejected in favor of verified locked object.");

    // -------------------------------------------------------------------------
    // Test 24: S3 Discrete Object Precondition / Fork Rejection
    // -------------------------------------------------------------------------
    console.log("\n[Test 24] S3AuditCheckpointStore enforces conditional writes and blocks discrete key overwrites");
    const conditionalMockFetch: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = input.toString();
      const method = init?.method || "GET";
      if (method === "PUT" && url.includes("checkpoint-000000000005")) {
        // Simulate S3 If-None-Match: * precondition failure (object already exists)
        return new Response("Precondition Failed", { status: 412 });
      }
      return new Response(null, { status: 200 });
    };

    const s3ConditionalStore = new S3AuditCheckpointStore({
      bucket: "conditional-test",
      customFetch: conditionalMockFetch,
    });

    let s3ForkBlocked = false;
    try {
      await s3ConditionalStore.writeCheckpoint(cp22);
    } catch (err: any) {
      s3ForkBlocked = true;
      assert(err.message.includes("Fork rejected"));
    }
    assert.strictEqual(s3ForkBlocked, true, "Store must block overwriting discrete checkpoint key");
    console.log("  ✓ Test 24 Passed: Discrete checkpoint objects cannot be overwritten, preventing branch forks.");

    // -------------------------------------------------------------------------
    // Test 25: Detached Vault Discrete Cross-Verification
    // -------------------------------------------------------------------------
    console.log("\n[Test 25] DetachedVault cross-verifies latest.json against discrete file before trusting");
    const vaultCrossStore = new DetachedVaultCheckpointStore(testVaultDir);
    // Write a genuine checkpoint
    const cp25 = createAuditCheckpoint(generateCleanLedger(8), SIGNING_SECRET, "CHK-VAULT-GENUINE-25");
    await vaultCrossStore.writeCheckpoint(cp25);

    // Tamper with latest.json by inserting a fake checkpointId that has no discrete file
    const vaultLatestFile = path.join(testVaultDir, "latest.json");
    const tamperedLatest = { ...cp25, checkpointId: "CHK-FAKE-UNBACKED-VAULT" };
    fs.writeFileSync(vaultLatestFile, JSON.stringify(tamperedLatest), "utf8");

    // readLatestCheckpoint must detect that checkpoint-000000000008-CHK-FAKE-UNBACKED-VAULT.json doesn't exist,
    // and fall back to scanning discrete files, returning the genuine checkpoint!
    const recoveredCp25 = await vaultCrossStore.readLatestCheckpoint();
    assert.ok(recoveredCp25, "Must recover genuine discrete checkpoint");
    assert.strictEqual(recoveredCp25.checkpointId, "CHK-VAULT-GENUINE-25");
    console.log("  ✓ Test 25 Passed: Vault cross-verifies latest.json and falls back to authentic discrete file.");

    // -------------------------------------------------------------------------
    // Test 26: S3 Scenario B - Discrete Object Delete-Marker Resilience via ListObjectVersions
    // -------------------------------------------------------------------------
    console.log("\n[Test 26] S3 Scenario B: Recovers locked discrete object when key itself has delete marker");
    const scenarioBStore = new Map<string, string>();
    const discreteKey26 = "checkpoint-000000000007-CHK-SCENARIO-B.json";
    const discreteUrl26 = `https://scenario-b-test.s3.us-east-1.amazonaws.com/${discreteKey26}`;
    const versionedUrl26 = `${discreteUrl26}?versionId=v-retained-locked-007`;

    const ledger26 = generateCleanLedger(7);
    const cp26 = createAuditCheckpoint(ledger26, SIGNING_SECRET, "CHK-SCENARIO-B");
    scenarioBStore.set(versionedUrl26, JSON.stringify(cp26));

    const scenarioBFetch: typeof fetch = async (input: RequestInfo | URL): Promise<Response> => {
      const url = input.toString();

      // In Scenario B: latest.json is deleted or uninitialized
      if (url.includes("/latest.json")) {
        return new Response("NoSuchKey", { status: 404 });
      }

      // Ordinary ListObjectsV2: omits the key because current version is a delete marker!
      if (url.includes("?list-type=2")) {
        const emptyXml = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Name>scenario-b-test</Name>
  <Prefix>checkpoint-</Prefix>
</ListBucketResult>`;
        return new Response(emptyXml, { status: 200, headers: { "Content-Type": "application/xml" } });
      }

      // ListObjectVersions (?versions): exposes the underlying locked Version and the DeleteMarker!
      if (url.includes("?versions")) {
        const versionsXml = `<?xml version="1.0" encoding="UTF-8"?>
<ListVersionsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Name>scenario-b-test</Name>
  <Prefix>checkpoint-</Prefix>
  <DeleteMarker>
    <Key>${discreteKey26}</Key>
    <VersionId>v-delete-marker-current-999</VersionId>
    <IsLatest>true</IsLatest>
  </DeleteMarker>
  <Version>
    <Key>${discreteKey26}</Key>
    <VersionId>v-retained-locked-007</VersionId>
    <IsLatest>false</IsLatest>
  </Version>
</ListVersionsResult>`;
        return new Response(versionsXml, { status: 200, headers: { "Content-Type": "application/xml" } });
      }

      // Reading the bare URL without versionId returns 404 (due to delete marker)
      if (url === discreteUrl26) {
        return new Response("NoSuchKey: Delete marker is current", { status: 404 });
      }

      // Reading with ?versionId returns the retained locked object!
      if (scenarioBStore.has(url)) {
        return new Response(scenarioBStore.get(url)!, { status: 200, headers: { "Content-Type": "application/json" } });
      }

      return new Response("NoSuchKey", { status: 404 });
    };

    const s3ScenarioBStore = new S3AuditCheckpointStore({
      bucket: "scenario-b-test",
      customFetch: scenarioBFetch,
    });

    const recoveredScenarioB = await s3ScenarioBStore.readLatestCheckpoint();
    assert.ok(recoveredScenarioB, "Must recover locked discrete checkpoint using version-aware discovery");
    assert.strictEqual(recoveredScenarioB.checkpointId, "CHK-SCENARIO-B");
    assert.strictEqual(recoveredScenarioB.eventCount, 7);

    const verifyScenarioBLedger = verifyLedgerAgainstCheckpoint(ledger26, recoveredScenarioB, SIGNING_SECRET);
    assert.strictEqual(verifyScenarioBLedger.valid, true);
    assert.strictEqual(verifyScenarioBLedger.status, "VERIFIED");
    console.log("  ✓ Test 26 Passed: ListObjectVersions successfully recovers retained locked version despite active delete marker on discrete key.");

    // -------------------------------------------------------------------------
    // Test 27: Conflicting Multi-Version Checkpoint Fork Detection
    // -------------------------------------------------------------------------
    console.log("\n[Test 27] S3AuditCheckpointStore detects and fails closed on conflicting checkpoint forks");
    const forkStore = new Map<string, string>();
    const forkLedgerA = generateCleanLedger(8);
    const cpForkA = createAuditCheckpoint(forkLedgerA, SIGNING_SECRET, "CHK-FORK-A");

    const forkLedgerB = generateCleanLedger(8);
    // Alter index 7 so headHash differs
    forkLedgerB[7].metadata = { altered: true };
    forkLedgerB[7].eventHash = computeEventHash(forkLedgerB[7]);
    const cpForkB = createAuditCheckpoint(forkLedgerB, SIGNING_SECRET, "CHK-FORK-B");

    const forkKeyA = "checkpoint-000000000008-CHK-FORK-A.json";
    const forkKeyB = "checkpoint-000000000008-CHK-FORK-B.json";
    forkStore.set(`https://fork-test.s3.us-east-1.amazonaws.com/${forkKeyA}`, JSON.stringify(cpForkA));
    forkStore.set(`https://fork-test.s3.us-east-1.amazonaws.com/${forkKeyB}`, JSON.stringify(cpForkB));

    const forkFetch: typeof fetch = async (input: RequestInfo | URL): Promise<Response> => {
      const url = input.toString();
      if (url.includes("/latest.json")) return new Response("NoSuchKey", { status: 404 });
      if (url.includes("?versions")) {
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ListVersionsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Name>fork-test</Name>
  <Prefix>checkpoint-</Prefix>
  <Version><Key>${forkKeyA}</Key><VersionId>v1</VersionId></Version>
  <Version><Key>${forkKeyB}</Key><VersionId>v2</VersionId></Version>
</ListVersionsResult>`;
        return new Response(xml, { status: 200, headers: { "Content-Type": "application/xml" } });
      }
      if (forkStore.has(url.split("?")[0])) {
        return new Response(forkStore.get(url.split("?")[0])!, { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response("NoSuchKey", { status: 404 });
    };

    const s3ForkStore = new S3AuditCheckpointStore({
      bucket: "fork-test",
      customFetch: forkFetch,
    });

    let forkDetected = false;
    try {
      await s3ForkStore.readLatestCheckpoint();
    } catch (err: any) {
      forkDetected = true;
      assert(err.message.includes("Fork detected at eventCount 8"));
    }
    assert.strictEqual(forkDetected, true, "Store must throw on conflicting checkpoints at same eventCount");

    // Higher level verifier must fail closed with CHECKPOINT_STORE_ERROR
    const res27 = await verifyAuditWithConfiguredStore(forkLedgerA, s3ForkStore, SIGNING_SECRET);
    assert.strictEqual(res27.valid, false, "Conflicting fork must never return valid");
    assert.strictEqual(res27.status, "CHECKPOINT_STORE_ERROR");
    assert.ok(res27.reason.includes("Fork detected"));
    console.log("  ✓ Test 27 Passed: Conflicting multi-version checkpoint forks fail closed with CHECKPOINT_STORE_ERROR.");

    // -------------------------------------------------------------------------
    // Test 28: S3 ListObjectVersions Multi-Page Pagination with Key & Version Markers
    // -------------------------------------------------------------------------
    console.log("\n[Test 28] S3 ListObjectVersions handles multi-page pagination across >1,000 versions");
    const paginationStore = new Map<string, string>();
    const newestLedger = generateCleanLedger(15);
    const newestCheckpoint = createAuditCheckpoint(newestLedger, SIGNING_SECRET, "CHK-NEWEST-PAGE-2");
    const newestKey = "checkpoint-000000000015-CHK-NEWEST-PAGE-2.json";
    paginationStore.set(`https://pagination-test.s3.us-east-1.amazonaws.com/${newestKey}`, JSON.stringify(newestCheckpoint));

    const paginationRequests: string[] = [];

    const paginationFetch: typeof fetch = async (input: RequestInfo | URL): Promise<Response> => {
      const url = input.toString();
      paginationRequests.push(url);

      if (url.includes("/latest.json")) {
        return new Response("NoSuchKey", { status: 404 });
      }

      if (url.includes("?versions")) {
        if (!url.includes("key-marker=")) {
          // Page 1: Returns 1,000 simulated legacy versions, truncated!
          const page1Xml = `<?xml version="1.0" encoding="UTF-8"?>
<ListVersionsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Name>pagination-test</Name>
  <Prefix>checkpoint-</Prefix>
  <IsTruncated>true</IsTruncated>
  <NextKeyMarker>checkpoint-000000000001-CHK-PAGE1-TAIL.json</NextKeyMarker>
  <NextVersionIdMarker>v-tail-1000</NextVersionIdMarker>
  <Version>
    <Key>checkpoint-000000000001-CHK-PAGE1-TAIL.json</Key>
    <VersionId>v-tail-1000</VersionId>
  </Version>
</ListVersionsResult>`;
          return new Response(page1Xml, { status: 200, headers: { "Content-Type": "application/xml" } });
        } else {
          // Page 2: Contains the newest checkpoint (eventCount 15), is not truncated
          const page2Xml = `<?xml version="1.0" encoding="UTF-8"?>
<ListVersionsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Name>pagination-test</Name>
  <Prefix>checkpoint-</Prefix>
  <IsTruncated>false</IsTruncated>
  <Version>
    <Key>${newestKey}</Key>
    <VersionId>v-newest-page2</VersionId>
  </Version>
</ListVersionsResult>`;
          return new Response(page2Xml, { status: 200, headers: { "Content-Type": "application/xml" } });
        }
      }

      if (paginationStore.has(url.split("?")[0])) {
        return new Response(paginationStore.get(url.split("?")[0])!, { status: 200, headers: { "Content-Type": "application/json" } });
      }

      return new Response("NoSuchKey", { status: 404 });
    };

    const s3PaginationStore = new S3AuditCheckpointStore({
      bucket: "pagination-test",
      customFetch: paginationFetch,
    });

    const recoveredFromPage2 = await s3PaginationStore.readLatestCheckpoint();
    assert.ok(recoveredFromPage2, "Must recover newest checkpoint located on Page 2");
    assert.strictEqual(recoveredFromPage2.checkpointId, "CHK-NEWEST-PAGE-2");
    assert.strictEqual(recoveredFromPage2.eventCount, 15);

    // Verify pagination requests were correctly issued with markers
    const secondPageReq = paginationRequests.find((u) => u.includes("key-marker=checkpoint-000000000001-CHK-PAGE1-TAIL.json"));
    assert.ok(secondPageReq, "Must request second page with key-marker from first page");
    assert.ok(secondPageReq.includes("version-id-marker=v-tail-1000"), "Must include version-id-marker");

    // Test malformed truncation (IsTruncated=true without NextKeyMarker fails closed)
    const brokenPaginationFetch: typeof fetch = async (input: RequestInfo | URL): Promise<Response> => {
      const url = input.toString();
      if (url.includes("/latest.json")) return new Response("NoSuchKey", { status: 404 });
      if (url.includes("?versions")) {
        const brokenXml = `<?xml version="1.0" encoding="UTF-8"?>
<ListVersionsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <IsTruncated>true</IsTruncated>
</ListVersionsResult>`;
        return new Response(brokenXml, { status: 200, headers: { "Content-Type": "application/xml" } });
      }
      return new Response("NoSuchKey", { status: 404 });
    };

    const brokenPagStore = new S3AuditCheckpointStore({
      bucket: "broken-pagination-test",
      customFetch: brokenPaginationFetch,
    });

    let brokenPagFailedClosed = false;
    try {
      await brokenPagStore.readLatestCheckpoint();
    } catch (err: any) {
      brokenPagFailedClosed = true;
      assert(err.message.includes("without NextKeyMarker"));
    }
    assert.strictEqual(brokenPagFailedClosed, true, "Truncated page missing NextKeyMarker must fail closed");
    console.log("  ✓ Test 28 Passed: ListObjectVersions pagination traverses across pages with markers and fails closed on malformed markers.");

    // -------------------------------------------------------------------------
    // Test 29: Complete Highest-Count Fork Detection (First Two Agree, Third Conflicts)
    // -------------------------------------------------------------------------
    console.log("\n[Test 29] Complete fork detection catches conflicting 3rd candidate even when first 2 agree");
    const multiCandStore = new Map<string, string>();
    const ledgerTenA = generateCleanLedger(10);
    const cpTenA = createAuditCheckpoint(ledgerTenA, SIGNING_SECRET, "CHK-10-A");

    // Candidate 1 is an identical duplicate or version of Candidate 0
    const cpTenADup = { ...cpTenA };

    // Candidate 2 has same eventCount (10) but a conflicting headHash
    const ledgerTenB = generateCleanLedger(10);
    ledgerTenB[9].metadata = { forked: true };
    ledgerTenB[9].eventHash = computeEventHash(ledgerTenB[9]);
    const cpTenConflict = createAuditCheckpoint(ledgerTenB, SIGNING_SECRET, "CHK-10-CONFLICTING-3RD");

    const key10A = "checkpoint-000000000010-CHK-10-A.json";
    const key10B = "checkpoint-000000000010-CHK-10-CONFLICTING-3RD.json";
    multiCandStore.set(`https://multicand-test.s3.us-east-1.amazonaws.com/${key10A}?versionId=v-agree-1`, JSON.stringify(cpTenA));
    multiCandStore.set(`https://multicand-test.s3.us-east-1.amazonaws.com/${key10A}?versionId=v-agree-2`, JSON.stringify(cpTenADup));
    multiCandStore.set(`https://multicand-test.s3.us-east-1.amazonaws.com/${key10B}?versionId=v-conflict-3`, JSON.stringify(cpTenConflict));

    const multiCandFetch: typeof fetch = async (input: RequestInfo | URL): Promise<Response> => {
      const url = input.toString();
      if (url.includes("/latest.json")) return new Response("NoSuchKey", { status: 404 });
      if (url.includes("?versions")) {
        // Return 3 candidates: first two agree, third conflicts
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ListVersionsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Name>multicand-test</Name>
  <Prefix>checkpoint-</Prefix>
  <Version><Key>${key10A}</Key><VersionId>v-agree-1</VersionId></Version>
  <Version><Key>${key10A}</Key><VersionId>v-agree-2</VersionId></Version>
  <Version><Key>${key10B}</Key><VersionId>v-conflict-3</VersionId></Version>
</ListVersionsResult>`;
        return new Response(xml, { status: 200, headers: { "Content-Type": "application/xml" } });
      }
      if (multiCandStore.has(url)) {
        return new Response(multiCandStore.get(url)!, { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response("NoSuchKey", { status: 404 });
    };

    const s3MultiCandStore = new S3AuditCheckpointStore({
      bucket: "multicand-test",
      customFetch: multiCandFetch,
    });

    let multiCandForkCaught = false;
    try {
      await s3MultiCandStore.readLatestCheckpoint();
    } catch (err: any) {
      multiCandForkCaught = true;
      assert(err.message.includes("Fork detected at eventCount 10"));
      assert(err.message.includes("CHK-10-CONFLICTING-3RD"));
    }
    assert.strictEqual(multiCandForkCaught, true, "Store must check all candidates at highest count, catching 3rd conflicting candidate");
    console.log("  ✓ Test 29 Passed: Exhaustive candidate scan verifies all candidates at max count and catches conflicting 3rd candidate.");

  } finally {
    // Clean up temporary test vault directory
    if (fs.existsSync(testVaultDir)) {
      fs.rmSync(testVaultDir, { recursive: true, force: true });
    }
  }

  console.log("\n================================================================================");
  console.log("  ALL 29 ADVERSARIAL & EXTERNAL CHECKPOINT TESTS PASSED (100% VERIFIED)        ");
  console.log("================================================================================\n");
}

runCheckpointAdversarialSuite().catch((err) => {
  console.error("Adversarial checkpoint test failure:", err);
  process.exit(1);
});
