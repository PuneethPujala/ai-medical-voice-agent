/**
 * Actual Neon HTTP Driver & Transport Integration Test
 *
 * Exercises the authoritative @neondatabase/serverless and drizzle-orm/neon-http driver stack
 * against the isolated local PostgreSQL instance via controlled test transport.
 *
 * Verifies:
 * 1. logAuditEventAsync() detects that neon-http lacks interactive multi-statement transactions.
 * 2. It automatically selects the single-request atomic statement path (logAuditEventViaAtomicStatement).
 * 3. The SQL is transmitted via the Neon HTTP protocol and parsed correctly.
 * 4. The returned event index/hash are parsed correctly.
 * 5. Both audit_events and audit_chain_heads are advanced atomically.
 * 6. Edge-case canonical hash parity (Unicode, escaped quotes, backslashes, newlines, nested JSON, nulls, key ordering).
 */

import { Pool } from "pg";
import { neon, neonConfig } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { setCustomDbClient } from "../../config/db";
import {
  logAuditEventAsync,
  verifyAuditChain,
  verifyEventIntegrity,
  verifyEventHash,
  canonicalizeJson,
} from "../../lib/audit/audit-logger";

const DB_URL = process.env.TEST_DATABASE_URL || "postgresql://postgres:testpass@localhost:5433/medvoice_test";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

async function runNeonHttpDriverIntegrationTest() {
  console.log("\n================================================================================");
  console.log("  NEON-HTTP DRIVER TRANSPORT & CANONICAL HASH PARITY INTEGRATION BATTERY");
  console.log("================================================================================\n");

  const pool = new Pool({ connectionString: DB_URL });

  // Track transmitted SQL statements from the actual Neon HTTP client
  const transmittedRequests: { query: string; params: any[] }[] = [];

  // Configure Neon serverless HTTP fetchFunction to route directly to local PostgreSQL
  // This executes the REAL @neondatabase/serverless client and REAL drizzle-orm/neon-http driver!
  const originalFetchFunction = neonConfig.fetchFunction;
  neonConfig.fetchFunction = async (url: string, options: any) => {
    const reqBody = typeof options?.body === "string" ? JSON.parse(options.body) : options.body;
    transmittedRequests.push({ query: reqBody.query, params: reqBody.params || [] });

    const pgResult = await pool.query({
      text: reqBody.query,
      values: reqBody.params,
      rowMode: "array",
    });

    const responsePayload = {
      fields: pgResult.fields.map((f) => ({ name: f.name, dataTypeID: f.dataTypeID })),
      rows: pgResult.rows,
      rowCount: pgResult.rowCount,
      command: pgResult.command,
      rowAsArray: false,
    };

    return new Response(JSON.stringify(responsePayload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    // -------------------------------------------------------------------------
    // Phase 1: Driver Architecture & Transaction Detection
    // -------------------------------------------------------------------------
    console.log("[Phase 1] Initializing actual Neon HTTP Drizzle instance...");
    const neonSql = neon("postgresql://testuser:testpass@fake-test-endpoint.neon.tech/medvoice_test");
    const neonDb = drizzleNeon({ client: neonSql });

    // Verify driver capabilities
    let threwNoTransactionSupport = false;
    try {
      await neonDb.transaction(async () => {});
    } catch (err: any) {
      if (String(err?.message || "").includes("No transactions support in neon-http driver")) {
        threwNoTransactionSupport = true;
      }
    }
    assert(
      threwNoTransactionSupport,
      "neon-http driver explicitly throws 'No transactions support in neon-http driver' on interactive transaction attempt"
    );

    // Set custom db client so logAuditEventAsync uses this actual Neon HTTP client
    setCustomDbClient(neonDb);

    // -------------------------------------------------------------------------
    // Phase 2: End-to-End logAuditEventAsync() via Neon HTTP Transport
    // -------------------------------------------------------------------------
    console.log("\n[Phase 2] Executing logAuditEventAsync() through real Neon HTTP driver...");
    transmittedRequests.length = 0;

    const headBefore = await pool.query("SELECT * FROM audit_chain_heads WHERE chain_id = 'main'");
    const prevIndex = Number(headBefore.rows[0].last_event_index);
    const prevHash = String(headBefore.rows[0].last_event_hash);

    const event = await logAuditEventAsync({
      actorId: "usr-clinician-driver-test",
      actorRole: "clinician",
      action: "CLINICAL_ARTIFACT_SIGNED",
      resourceType: "clinical_artifact",
      resourceId: "art-neon-http-001",
      status: "SUCCESS",
      requireDurable: true,
      metadata: {
        driverTest: true,
        transport: "@neondatabase/serverless",
        pipeline: "neon-http",
      },
    });

    // 1. Verify transmission through Neon HTTP fetch
    assert(transmittedRequests.length >= 1, "Neon HTTP driver transmitted SQL request over HTTP transport");
    const atomicQueryTransmitted = transmittedRequests.find((r) =>
      r.query.includes("WITH locked_head AS") && r.query.includes("audit_chain_heads")
    );
    assert(Boolean(atomicQueryTransmitted), "Driver transmitted the atomic CTE query with locked_head");

    // 2. Verify returned event properties
    const expectedIndex = prevIndex + 1;
    assert(event.index === expectedIndex, `Returned event index correctly parsed as ${expectedIndex}`);
    assert(event.previousHash === prevHash, `Returned previousHash correctly linked to ${prevHash.slice(0, 16)}...`);
    assert(event.eventHash.length === 64, "Returned eventHash is valid 64-char hex");
    assert(verifyEventHash(event), "Event hash verification passes in TypeScript");

    // 3. Verify atomic state update in database
    const headAfter = await pool.query("SELECT * FROM audit_chain_heads WHERE chain_id = 'main'");
    assert(Number(headAfter.rows[0].last_event_index) === expectedIndex, "audit_chain_heads index advanced in PostgreSQL");
    assert(headAfter.rows[0].last_event_hash === event.eventHash, "audit_chain_heads hash advanced in PostgreSQL");

    const eventInDb = await pool.query("SELECT * FROM audit_events WHERE id = $1", [event.id]);
    assert(eventInDb.rows.length === 1, "Event persisted in audit_events table");
    assert(eventInDb.rows[0].index === expectedIndex, "audit_events row index matches event index");
    assert(eventInDb.rows[0].event_hash === event.eventHash, "audit_events row event_hash matches exactly");

    // -------------------------------------------------------------------------
    // Phase 3: Canonical Hash Parity Under Adversarial Payloads
    // -------------------------------------------------------------------------
    console.log("\n[Phase 3] Testing canonical hash parity across difficult payloads...");

    const testPayloads = [
      {
        name: "Unicode Characters (Hindi, Japanese, Accents, Emoji)",
        metadata: {
          hindi: "हृदय रोग विशेषज्ञ",
          japanese: "急性冠症候群の疑い",
          accents: "über-précis cardio-stéthoscope",
          emojis: "🫀 🩺 🚨 💊",
        },
      },
      {
        name: "Escaped Quotes & Complex Apostrophes",
        metadata: {
          quote1: 'Doctor\'s note: "Immediate coronary catheterization required"',
          quote2: "Patient states: 'I cannot breathe when lying down.'",
          nestedQuotes: 'He said, "She told him, \'Wait for EMS\'"',
        },
      },
      {
        name: "Backslashes, Tabs, and Newline Sequences",
        metadata: {
          path: "C:\\Users\\clinician\\AppData\\Local\\Temp\\report.pdf",
          windowsNewlines: "Line 1\r\nLine 2\r\nLine 3",
          unixNewlines: "Header\n\nSection 1\nSection 2",
          tabbedTable: "HR\tBP\tSPO2\n72\t120/80\t99%",
          escapedRegex: "^[A-Za-z0-9_\\-\\.\\+]+@[A-Za-z0-9\\-]+\\.[A-Za-z]+$",
        },
      },
      {
        name: "Deeply Nested JSON with Null Values & Mixed Primitives",
        metadata: {
          level1: {
            level2: {
              level3: {
                flag: true,
                count: 0,
                nullValue: null,
                emptyArray: [],
                nestedArray: [1, "two", null, { three: 3.14159 }],
              },
            },
          },
          topLevelNull: null,
          zero: 0,
          negative: -42.75,
        },
      },
      {
        name: "Key Order Permutation Parity (Unordered Objects)",
        metadata: {
          z: "last key",
          a: "first key",
          m: { zebra: 1, alpha: 2, beta: { delta: null, charlie: "ordered" } },
        },
      },
    ];

    for (const testCase of testPayloads) {
      console.log(`  • Running parity check: ${testCase.name}...`);
      const parityEvent = await logAuditEventAsync({
        actorId: "usr-parity-tester",
        actorRole: "clinician",
        action: "CLINICAL_ARTIFACT_SIGNED",
        resourceType: "clinical_artifact",
        resourceId: `art-parity-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        status: "SUCCESS",
        requireDurable: true,
        metadata: testCase.metadata,
      });

      // 1. Verify TypeScript canonical calculation matches event.eventHash
      const integrityCheck = verifyEventIntegrity(parityEvent);
      assert(integrityCheck.valid === true, `  ✓ TypeScript verifyEventIntegrity passed`);
      assert(integrityCheck.status === "VERIFIED_V2", `  ✓ Status is strictly VERIFIED_V2`);
      assert(verifyEventHash(parityEvent) === true, `  ✓ verifyEventHash confirms byte parity`);

      // 2. Verify that PostgreSQL stored the exact same hash
      const storedRow = await pool.query("SELECT event_hash, previous_hash FROM audit_events WHERE id = $1", [parityEvent.id]);
      assert(storedRow.rows[0].event_hash === parityEvent.eventHash, `  ✓ PostgreSQL row hash matches TypeScript byte-for-byte`);

      // 3. Verify audit_chain_heads was synchronized to this hash
      const headCheck = await pool.query("SELECT last_event_hash FROM audit_chain_heads WHERE chain_id = 'main'");
      assert(headCheck.rows[0].last_event_hash === parityEvent.eventHash, `  ✓ audit_chain_heads head hash synchronized`);
    }

    // -------------------------------------------------------------------------
    // Phase 4: Full Chain Integrity Verification Across All Events
    // -------------------------------------------------------------------------
    console.log("\n[Phase 4] Verifying cryptographic continuity of entire database chain...");
    const allDbEvents = await pool.query("SELECT * FROM audit_events ORDER BY index ASC");
    const domainEvents = allDbEvents.rows.map((r) => ({
      index: Number(r.index),
      id: r.id,
      timestamp: typeof r.timestamp === "string" ? r.timestamp : new Date(r.timestamp).toISOString(),
      actorId: r.actor_id,
      actorRole: r.actor_role,
      action: r.action,
      resourceType: r.resource_type,
      resourceId: r.resource_id,
      status: r.status,
      clientIp: r.client_ip,
      metadata: r.metadata,
      previousHash: r.previous_hash,
      eventHash: r.event_hash,
      hashVersion: r.hash_version,
    }));

    const chainVerification = verifyAuditChain(domainEvents as any);
    assert(chainVerification.valid === true, `Full audit chain is 100% valid across ${domainEvents.length} events`);
    console.log(`  ✓ Successfully verified cryptographic link for all ${domainEvents.length} events in PostgreSQL.`);

    console.log("\n================================================================================");
    console.log("  ALL NEON-HTTP DRIVER TRANSPORT & PARITY CHECKS PASSED (100% CLEAN)");
    console.log("================================================================================\n");
  } finally {
    setCustomDbClient(null);
    neonConfig.fetchFunction = originalFetchFunction;
    await pool.end();
  }
}

runNeonHttpDriverIntegrationTest().catch((err) => {
  console.error("Neon HTTP driver integration test failure:", err);
  process.exit(1);
});
