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
  // P1.1 EXTERNAL ADAPTER & DURABILITY TEST SUITE (Tests 11 - 18)
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
    // Test 12: DetachedVaultCheckpointStore directory recovery when latest.json is corrupted
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
    // Test 13: DetachedVaultCheckpointStore blocks rollback and fork attempts
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
    // Start with 5 events checkpointed
    const baseEvents = generateCleanLedger(5);
    const cp14 = createAuditCheckpoint(baseEvents, SIGNING_SECRET);

    // Append 3 more valid events to the ledger
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
    // 16a: Explicit memory requested in production
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

    // 16b: Missing configuration in production
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

    // 16c: Configured vault in production succeeds
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
    console.log("\n[Test 17] S3AuditCheckpointStore dispatches Object-Lock headers & enforces immutability");
    const s3RecordedRequests: Array<{ url: string; method: string; headers: Record<string, string>; body?: string }> = [];
    let s3StoredObject: string | null = null;

    const mockFetch: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = input.toString();
      const method = init?.method || "GET";
      const headers = (init?.headers || {}) as Record<string, string>;
      s3RecordedRequests.push({ url, method, headers, body: init?.body as string });

      if (method === "GET") {
        if (!s3StoredObject) {
          return new Response("Not Found", { status: 404 });
        }
        return new Response(s3StoredObject, {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (method === "PUT") {
        s3StoredObject = init?.body as string;
        return new Response(null, { status: 200 });
      }

      return new Response("Method not allowed", { status: 405 });
    };

    const s3Store = new S3AuditCheckpointStore({
      bucket: "medvoice-audit-worm-vault",
      region: "us-east-1",
      objectLockCompliance: true,
      objectLockRetainUntilDays: 2555, // 7-year medical compliance hold
      customFetch: mockFetch,
    });

    const s3Checkpoint = createAuditCheckpoint(generateCleanLedger(4), SIGNING_SECRET, "CHK-S3-WORM-01");
    await s3Store.writeCheckpoint(s3Checkpoint);

    // Verify S3 request headers contain Object Lock compliance
    const discretePutReq = s3RecordedRequests.find((r) => r.method === "PUT" && r.url.includes("checkpoint-000000000004"));
    assert.ok(discretePutReq, "Discrete S3 checkpoint PUT request must be dispatched");
    assert.strictEqual(discretePutReq.headers["x-amz-object-lock-mode"], "COMPLIANCE");
    assert.ok(discretePutReq.headers["x-amz-object-lock-retain-until-date"], "Retain date header must be present");

    const s3Read = await s3Store.readLatestCheckpoint();
    assert.ok(s3Read, "S3 readLatestCheckpoint must retrieve saved checkpoint");
    assert.strictEqual(s3Read.checkpointId, "CHK-S3-WORM-01");
    assert.strictEqual(s3Read.eventCount, 4);
    console.log("  ✓ Test 17 Passed: S3AuditCheckpointStore dispatches compliant WORM Object-Lock headers.");

    // -------------------------------------------------------------------------
    // Test 18: Asymmetric RSA Key Pair Checkpoint Signing & Verification (HSM/KMS)
    // -------------------------------------------------------------------------
    console.log("\n[Test 18] Asymmetric RSA key pair signing and verification for HSM/KMS trust boundary");
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });

    const rsaLedger = generateCleanLedger(6);
    const rsaCheckpoint = createAuditCheckpoint(rsaLedger, privateKey, "CHK-RSA-HSM-001");

    assert.ok(rsaCheckpoint.signature.length > 64, "RSA signature must be a valid hex signature");

    // Public key must verify the signature
    const rsaValid = verifyCheckpointSignature(rsaCheckpoint, publicKey);
    assert.strictEqual(rsaValid, true, "Public key must verify RSA checkpoint signature");

    // Verification against full ledger using public key
    const rsaLedgerRes = verifyLedgerAgainstCheckpoint(rsaLedger, rsaCheckpoint, publicKey);
    assert.strictEqual(rsaLedgerRes.valid, true);
    assert.strictEqual(rsaLedgerRes.status, "VERIFIED");

    // Tampered checkpoint payload must fail verification with public key
    const tamperedRsaCp = { ...rsaCheckpoint, eventCount: 99 };
    const rsaTamperedValid = verifyCheckpointSignature(tamperedRsaCp, publicKey);
    assert.strictEqual(rsaTamperedValid, false, "Tampered payload must fail RSA verification");
    console.log("  ✓ Test 18 Passed: Asymmetric RSA-SHA256 signature verification functions correctly for KMS/HSM integration.");

  } finally {
    // Clean up temporary test vault directory
    if (fs.existsSync(testVaultDir)) {
      fs.rmSync(testVaultDir, { recursive: true, force: true });
    }
  }

  console.log("\n================================================================================");
  console.log("  ALL 18 ADVERSARIAL & EXTERNAL CHECKPOINT TESTS PASSED (100% VERIFIED)        ");
  console.log("================================================================================\n");
}

runCheckpointAdversarialSuite().catch((err) => {
  console.error("Adversarial checkpoint test failure:", err);
  process.exit(1);
});
