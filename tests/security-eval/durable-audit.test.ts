import dotenv from "dotenv";
dotenv.config();

import {
  logAuditEvent,
  logAuditEventAsync,
  syncAuditLedgerFromDb,
  clearAuditLedger,
  verifyAuditChain,
  getAuditEvents,
  GENESIS_HASH,
} from "../../lib/audit/audit-logger";
import { getDb } from "../../config/db";
import { auditEventsTable } from "../../config/schema";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

async function runDurableAuditTest() {
  console.log("\n========================================================");
  console.log("  DURABLE POSTGRESQL AUDIT CHAIN PERSISTENCE TEST");
  console.log("========================================================\n");

  const db = getDb();
  if (!db) {
    console.log("⚠️ Database URL not configured, skipping live Neon DB verification.");
    return;
  }

  // 1. Reset in-memory ledger
  clearAuditLedger();

  // 2. Sync from database to get current head
  console.log("[Step 1] Hydrating audit ledger from Neon DB...");
  const initialEvents = await syncAuditLedgerFromDb();
  console.log(`  ✓ Initial events in DB: ${initialEvents.length}`);

  const startCount = initialEvents.length;
  const startHead = startCount > 0 ? initialEvents[startCount - 1].eventHash : GENESIS_HASH;

  // 3. Log a new clinical event
  console.log("\n[Step 2] Logging new clinical event...");
  const newEvent = await logAuditEventAsync({
    actorId: "usr-clinician-anna",
    actorRole: "admin",
    action: "TRIAGE_EVALUATION",
    resourceType: "consultation",
    resourceId: `CONS-${Date.now()}`,
    status: "SUCCESS",
    metadata: {
      clinician: "Dr. Anna Bennett, MD",
      chiefComplaint: "Pain with swallowing saliva",
      esiLevel: 3,
    },
  });

  assert(newEvent.index === startCount, `Event index correctly set to ${startCount}`);
  assert(newEvent.previousHash === startHead, `previousHash matches previous chain head: ${startHead.slice(0, 16)}...`);
  assert(newEvent.eventHash.length === 64, "Event hash is valid SHA-256");

  // 4. Simulate complete server process restart by wiping in-memory state
  console.log("\n[Step 3] Simulating server crash / cold reboot (clearing memory)...");
  clearAuditLedger();
  assert(getAuditEvents().length === 0, "In-memory audit cache is now completely empty (0 events)");

  // 5. Restore from database
  console.log("\n[Step 4] Re-syncing audit ledger from durable Neon PostgreSQL...");
  const restoredEvents = await syncAuditLedgerFromDb();
  assert(restoredEvents.length === startCount + 1, `Restored exact expected event count: ${restoredEvents.length}`);

  const restoredHead = restoredEvents[restoredEvents.length - 1];
  assert(restoredHead.id === newEvent.id, "Restored head event ID matches logged event");
  assert(restoredHead.eventHash === newEvent.eventHash, "Restored head event hash matches exactly");
  assert(restoredHead.previousHash === startHead, "Restored previousHash pointer is authentic");

  // 6. Full cryptographic verification of restored chain
  console.log("\n[Step 5] Cryptographic integrity verification of restored chain...");
  const verification = verifyAuditChain(restoredEvents);
  assert(verification.valid === true, "Full audit chain across restarts validates cryptographically (100% authentic)");
  console.log(`  ✓ Validated ${verification.totalEvents} chained SHA-256 blocks from genesis to head.`);

  // 7. Concurrent write serialization test
  console.log("\n[Step 6] Concurrent write serialization & race-condition defense test...");
  const concurrentCount = 5;
  const currentTotal = restoredEvents.length;

  console.log(`  • Dispatching ${concurrentCount} simultaneous logAuditEventAsync operations...`);
  const concurrentResults = await Promise.all(
    Array.from({ length: concurrentCount }, (_, i) =>
      logAuditEventAsync({
        actorId: `usr-stress-client-${i}`,
        actorRole: "system",
        action: "TRIAGE_EVALUATION",
        resourceType: "system",
        resourceId: `STRESS-RES-${i}`,
        status: "SUCCESS",
        metadata: { threadIndex: i, timestamp: Date.now() },
      })
    )
  );

  assert(concurrentResults.length === concurrentCount, `All ${concurrentCount} concurrent writes resolved successfully`);

  // Verify monotonic indexing across all concurrent events
  for (let i = 0; i < concurrentCount; i++) {
    const expectedIndex = currentTotal + i;
    assert(concurrentResults[i].index === expectedIndex, `Concurrent event ${i} assigned monotonic index ${expectedIndex}`);
    if (i > 0) {
      assert(
        concurrentResults[i].previousHash === concurrentResults[i - 1].eventHash,
        `Concurrent event ${i} previousHash links cryptographically to event ${i - 1} eventHash`
      );
    }
  }

  // Verify chain post-concurrency
  const allEventsAfterConcurrency = getAuditEvents(200, 0);
  const verifyConcurrencyChain = verifyAuditChain(allEventsAfterConcurrency);
  assert(verifyConcurrencyChain.valid === true, "Audit chain integrity preserved with zero races during concurrency");
  console.log(`  ✓ Concurrency test passed: ${concurrentCount} simultaneous writes strictly sequenced without collision.`);

  console.log("\n========================================================");
  console.log("  DURABLE AUDIT PERSISTENCE TEST COMPLETED SUCCESSFULLY");
  console.log("========================================================\n");
}

runDurableAuditTest().catch((err) => {
  console.error("Durable audit test failure:", err);
  process.exit(1);
});

