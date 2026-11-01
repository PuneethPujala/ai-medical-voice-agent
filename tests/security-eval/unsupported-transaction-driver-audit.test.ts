import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { Pool } from "pg";
import { getDb, setCustomDbClient } from "../../config/db";
import {
  logAuditEventAsync,
  verifyAuditChain,
  isMemoryAuditFallbackPermitted,
  isLegacyPreMigrationPermitted,
  clearAuditLedger,
  getAuditLedger,
  computeEventHashV2,
  GENESIS_HASH,
} from "../../lib/audit/audit-logger";
import { assertSafeTestDatabase, validateTestDatabaseTarget } from "../../lib/security/test-db-guard";

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://postgres:testpass@localhost:5433/medvoice_test";

describe("Milestone 6: Audit Chain Integrity on Drivers Lacking Interactive Transactions", () => {
  let pool: Pool;
  let rawDrizzleDb: any;
  let unsupportedTxDriverMock: any;

  before(async () => {
    // 1. Enforce strict test database safety guard
    const targetCheck = validateTestDatabaseTarget(TEST_DB_URL);
    assert.strictEqual(
      targetCheck.safe,
      true,
      `Target database must be verified safe. Reason: ${targetCheck.reason}`
    );
    assertSafeTestDatabase(TEST_DB_URL);

    process.env.TEST_DATABASE_URL = TEST_DB_URL;
    pool = new Pool({ connectionString: TEST_DB_URL });

    // 2. Clean and initialize audit tables
    await pool.query(`
      DROP TABLE IF EXISTS "audit_chain_heads" CASCADE;
      DROP TABLE IF EXISTS "audit_events" CASCADE;

      CREATE TABLE "audit_chain_heads" (
        "chain_id" varchar(64) PRIMARY KEY,
        "last_event_index" integer NOT NULL,
        "last_event_hash" varchar(64) NOT NULL,
        "updated_at" timestamp DEFAULT now()
      );

      CREATE TABLE "audit_events" (
        "index" integer NOT NULL UNIQUE,
        "id" varchar(128) PRIMARY KEY,
        "timestamp" varchar(64) NOT NULL,
        "actor_id" varchar(128) NOT NULL,
        "actor_role" varchar(64) NOT NULL,
        "action" varchar(128) NOT NULL,
        "resource_type" varchar(64) NOT NULL,
        "resource_id" varchar(255) NOT NULL,
        "status" varchar(32) NOT NULL,
        "client_ip" varchar(64),
        "metadata" jsonb,
        "previous_hash" varchar(64) NOT NULL,
        "event_hash" varchar(64) NOT NULL,
        "created_at" timestamp DEFAULT now()
      );
    `);

    rawDrizzleDb = getDb();
    assert(rawDrizzleDb, "Drizzle client should be initialized against test database");

    // 3. Create a driver client that replicates neon-http:
    // It supports execute(), insert(), select(), but throws "No transactions support in neon-http driver" on .transaction()
    unsupportedTxDriverMock = {
      execute: (query: any) => rawDrizzleDb.execute(query),
      insert: (table: any) => rawDrizzleDb.insert(table),
      select: (args?: any) => rawDrizzleDb.select(args),
      update: (table: any) => rawDrizzleDb.update(table),
      delete: (table: any) => rawDrizzleDb.delete(table),
      transaction: async () => {
        throw new Error("No transactions support in neon-http driver");
      },
    };

    // Inject the mock driver into the MedVoice database layer
    setCustomDbClient(unsupportedTxDriverMock);
  });

  after(async () => {
    setCustomDbClient(null);
    if (pool) {
      await pool.end().catch(() => {});
    }
  });

  it("Test 1: Chain head advances monotonically after every append through the unsupported-transaction driver path", async () => {
    clearAuditLedger();

    const event1 = await logAuditEventAsync({
      actorId: "clinician-001",
      actorRole: "clinician",
      action: "CONSULTATION_CREATED",
      resourceType: "consultation",
      resourceId: "ENC-TX-TEST-001",
      status: "SUCCESS",
      requireDurable: true,
      metadata: { department: "Cardiology", visitType: "in-person" },
    });

    assert.strictEqual(event1.index, 0, "First event must have index 0");
    assert.strictEqual(event1.previousHash, GENESIS_HASH, "First event previousHash must be GENESIS_HASH");
    assert.strictEqual(event1.hashVersion, "v2", "Hash version must be v2");

    // Verify audit_chain_heads row in physical PostgreSQL
    const headRes1 = await pool.query("SELECT * FROM audit_chain_heads WHERE chain_id = 'main'");
    assert.strictEqual(headRes1.rows.length, 1, "audit_chain_heads must contain main chain row");
    assert.strictEqual(Number(headRes1.rows[0].last_event_index), 0, "Chain head index must advance to 0");
    assert.strictEqual(headRes1.rows[0].last_event_hash, event1.eventHash, "Chain head hash must match event 1");

    // Second append
    const event2 = await logAuditEventAsync({
      actorId: "patient-001",
      actorRole: "patient",
      action: "CONSULTATION_UPDATED",
      resourceType: "consultation",
      resourceId: "ENC-TX-TEST-001",
      status: "SUCCESS",
      requireDurable: true,
      metadata: { symptomAdded: "chest tightness", severity: 7 },
    });

    assert.strictEqual(event2.index, 1, "Second event must have index 1");
    assert.strictEqual(event2.previousHash, event1.eventHash, "Second event previousHash must match event 1 hash");

    const headRes2 = await pool.query("SELECT * FROM audit_chain_heads WHERE chain_id = 'main'");
    assert.strictEqual(Number(headRes2.rows[0].last_event_index), 1, "Chain head index must advance to 1");
    assert.strictEqual(headRes2.rows[0].last_event_hash, event2.eventHash, "Chain head hash must match event 2");
  });

  it("Test 2: Concurrent writers over unsupported-transaction driver receive unique contiguous indices and correct previous hashes", async () => {
    const NUM_CONCURRENT = 10;
    console.log(`  Executing ${NUM_CONCURRENT} concurrent writes over unsupported-transaction driver...`);

    const writePromises = Array.from({ length: NUM_CONCURRENT }, (_, i) =>
      logAuditEventAsync({
        actorId: `worker-${i}`,
        actorRole: "clinician",
        action: "CONSULTATION_UPDATED",
        resourceType: "consultation",
        resourceId: `ENC-CONCURRENT-${i}`,
        status: "SUCCESS",
        requireDurable: true,
        metadata: { workerIndex: i, timestamp: Date.now() },
      })
    );

    const committedEvents = await Promise.all(writePromises);
    assert.strictEqual(committedEvents.length, NUM_CONCURRENT);

    // Verify indices in DB are contiguous without gaps or duplicates
    const allDbEvents = await pool.query("SELECT * FROM audit_events ORDER BY index ASC");
    const totalEvents = allDbEvents.rows.length;
    assert.strictEqual(totalEvents, 2 + NUM_CONCURRENT, "Total events in DB must match initial + concurrent count");

    for (let i = 0; i < totalEvents; i++) {
      assert.strictEqual(Number(allDbEvents.rows[i].index), i, `Event at offset ${i} must have index ${i}`);
      if (i > 0) {
        assert.strictEqual(
          allDbEvents.rows[i].previous_hash,
          allDbEvents.rows[i - 1].event_hash,
          `Event ${i} previous_hash must match event ${i - 1} event_hash`
        );
      }
    }

    // Verify chain head
    const headRes = await pool.query("SELECT * FROM audit_chain_heads WHERE chain_id = 'main'");
    assert.strictEqual(
      Number(headRes.rows[0].last_event_index),
      totalEvents - 1,
      "audit_chain_heads must match the final allocated index"
    );
    assert.strictEqual(
      headRes.rows[0].last_event_hash,
      allDbEvents.rows[totalEvents - 1].event_hash,
      "audit_chain_heads must match the final event hash"
    );
  });

  it("Test 3: PostgreSQL atomic hash calculation matches computeEventHashV2 canonical specification byte-for-byte", async () => {
    const allEvents = await pool.query("SELECT * FROM audit_events ORDER BY index ASC");
    for (const row of allEvents.rows) {
      const referenceHash = computeEventHashV2({
        index: Number(row.index),
        id: row.id,
        timestamp: row.timestamp,
        actorId: row.actor_id,
        actorRole: row.actor_role,
        action: row.action,
        resourceType: row.resource_type,
        resourceId: row.resource_id,
        status: row.status,
        previousHash: row.previous_hash,
        metadata: row.metadata,
      });

      assert.strictEqual(
        row.event_hash,
        referenceHash,
        `PostgreSQL sha256 at index ${row.index} must match Node.js canonical computeEventHashV2`
      );
    }

    // Run full cryptographic chain audit verification
    const verification = verifyAuditChain(getAuditLedger());
    assert.strictEqual(verification.valid, true, "Full audit chain must validate cryptographically");
  });

  it("Test 4: Failed operations roll back atomically, leaving neither an inserted event nor an advanced chain head", async () => {
    const headBefore = await pool.query("SELECT * FROM audit_chain_heads WHERE chain_id = 'main'");
    const lastIndexBefore = Number(headBefore.rows[0].last_event_index);
    const lastHashBefore = String(headBefore.rows[0].last_event_hash);

    // Intentionally pass an oversized resourceId (length > 255) to trigger a PostgreSQL column constraint error
    const oversizedId = "X".repeat(300);

    let errorThrown = false;
    try {
      await logAuditEventAsync({
        actorId: "attacker",
        actorRole: "patient",
        action: "CONSULTATION_CREATED",
        resourceType: "consultation",
        resourceId: oversizedId,
        requireDurable: true,
      });
    } catch (err: any) {
      errorThrown = true;
    }

    assert.strictEqual(errorThrown, true, "Oversized field must trigger database rejection");

    // Verify head was NOT advanced
    const headAfter = await pool.query("SELECT * FROM audit_chain_heads WHERE chain_id = 'main'");
    assert.strictEqual(Number(headAfter.rows[0].last_event_index), lastIndexBefore, "Chain head index must NOT advance on failure");
    assert.strictEqual(headAfter.rows[0].last_event_hash, lastHashBefore, "Chain head hash must NOT change on failure");

    // Verify no stray event was inserted
    const strayRes = await pool.query("SELECT * FROM audit_events WHERE index > $1", [lastIndexBefore]);
    assert.strictEqual(strayRes.rows.length, 0, "No event row may exist beyond previous head index");
  });

  it("Test 5: Legacy pre-migration behavior remains explicitly gated and refuses silent bypass", async () => {
    // Drop audit_chain_heads to simulate unmigrated environment
    await pool.query('DROP TABLE IF EXISTS "audit_chain_heads" CASCADE;');

    // In production mode, missing audit_chain_heads must fail closed
    const prevNodeEnv = process.env.NODE_ENV;
    const prevAllowLegacy = process.env.ALLOW_LEGACY_AUDIT_WRITER;

    try {
      process.env.NODE_ENV = "production";
      process.env.ALLOW_LEGACY_AUDIT_WRITER = "false";

      assert.strictEqual(
        isLegacyPreMigrationPermitted(),
        false,
        "Legacy pre-migration writer must be forbidden in production"
      );

      let failedClosed = false;
      try {
        await logAuditEventAsync({
          actorId: "test-user",
          actorRole: "clinician",
          action: "CONSULTATION_APPROVED",
          resourceType: "consultation",
          resourceId: "ENC-FAIL-CLOSED",
          requireDurable: true,
        });
      } catch (err: any) {
        failedClosed = true;
        assert(
          err.message.includes("audit_chain_heads") || err.message.includes("Durable audit persistence failed"),
          `Expected chain head failure, got: ${err.message}`
        );
      }

      assert.strictEqual(failedClosed, true, "Must fail closed in production when audit_chain_heads is missing");
    } finally {
      process.env.NODE_ENV = prevNodeEnv;
      process.env.ALLOW_LEGACY_AUDIT_WRITER = prevAllowLegacy;
    }
  });

  it("Test 6: Production strictly forbids in-memory audit fallback", () => {
    const prevEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      assert.strictEqual(
        isMemoryAuditFallbackPermitted(false),
        false,
        "Production must never allow memory fallback even when requireDurable is false"
      );
      assert.strictEqual(
        isMemoryAuditFallbackPermitted(true),
        false,
        "Production must never allow memory fallback when requireDurable is true"
      );
    } finally {
      process.env.NODE_ENV = prevEnv;
    }
  });
});
