import assert from "assert";
import {
  AuditEvent,
  computeEventHash,
  verifyAuditChain,
  GENESIS_HASH,
} from "../../lib/audit/audit-logger";
import {
  AuditCheckpoint,
  InMemoryCheckpointStore,
  createAuditCheckpoint,
  verifyLedgerAgainstCheckpoint,
  computeCheckpointSignature,
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
  // Test 6: Entire-ledger replacement with newly minted hashes fails
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

  console.log("\n================================================================================");
  console.log("  ALL 10 ADVERSARIAL AUDIT-CHECKPOINT TESTS PASSED (100% VERIFIED)             ");
  console.log("================================================================================\n");
}

runCheckpointAdversarialSuite().catch((err) => {
  console.error("Adversarial checkpoint test failure:", err);
  process.exit(1);
});
