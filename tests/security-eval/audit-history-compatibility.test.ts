import assert from "assert";
import {
  computeEventHashV1,
  computeEventHashV2,
  computeEventHash,
  verifyAuditChain,
  verifyEventHash,
  verifyEventIntegrity,
  countCandidatePermutations,
  MAX_HISTORICAL_PERMUTATION_BUDGET,
  GENESIS_HASH,
  AuditEvent,
} from "../../lib/audit/audit-logger";
import { getDb } from "../../config/db";
import { auditEventsTable } from "../../config/schema";
import { asc, eq } from "drizzle-orm";
import { resolveTestDatabaseUrl, validateTestDatabaseTarget } from "../../lib/security/test-db-guard";

async function runAuditHistoryCompatibilityBattery() {
  console.log("================================================================================");
  console.log("    HISTORICAL AUDIT CHAIN BACKWARD COMPATIBILITY & VERSIONING BATTERY        ");
  console.log("================================================================================\n");

  // ---------------------------------------------------------------------------
  // PART A: PRESERVED PRE-CHANGE HISTORICAL FIXTURES & PERMUTATION BOUNDARIES
  // ---------------------------------------------------------------------------
  console.log("--- PART A: PRESERVED IN-MEMORY HISTORICAL FIXTURES & PERMUTATION BOUNDARIES ---");

  // Historical Event 0: Genesis event with flat metadata
  const event0Partial: Omit<AuditEvent, "eventHash"> = {
    index: 0,
    id: "AUD-HISTORICAL-0000",
    timestamp: "2026-01-01T00:00:00.000Z",
    actorId: "system",
    actorRole: "system",
    action: "AUDIT_CHAIN_VERIFIED",
    resourceType: "system",
    resourceId: "sys-0",
    status: "SUCCESS",
    previousHash: GENESIS_HASH,
    metadata: { version: "1.0", initialized: true },
  };
  const event0Hash = computeEventHashV1(event0Partial);
  const event0: AuditEvent = { ...event0Partial, eventHash: event0Hash };

  // Historical Event 1: Pre-change event with nested object having reversed/non-alphabetical keys
  const event1Partial: Omit<AuditEvent, "eventHash"> = {
    index: 1,
    id: "AUD-HISTORICAL-0001",
    timestamp: "2026-01-01T00:01:00.000Z",
    actorId: "clinician-dr-sarah",
    actorRole: "clinician",
    action: "CONSULTATION_ACCESSED",
    resourceType: "consultation",
    resourceId: "ENC-HIST-101",
    status: "SUCCESS",
    previousHash: event0.eventHash,
    metadata: {
      details: {
        z_offset: 100,
        a_limit: 10,
        m_filter: "active",
      },
      reason: "Clinical chart inspection",
    },
  };
  const event1LegacyHash = computeEventHashV1(event1Partial);
  const event1ModernHash = computeEventHashV2(event1Partial);

  assert.notStrictEqual(
    event1LegacyHash,
    event1ModernHash,
    "Invariant: V1 shallow-sort hash must differ from V2 recursive-canonical hash when nested keys are non-alphabetical"
  );

  const event1: AuditEvent = { ...event1Partial, eventHash: event1LegacyHash };

  // Historical Event 2: Points to event1's legacy hash
  const event2Partial: Omit<AuditEvent, "eventHash"> = {
    index: 2,
    id: "AUD-HISTORICAL-0002",
    timestamp: "2026-01-01T00:02:00.000Z",
    actorId: "patient-alice",
    actorRole: "patient",
    action: "CONSULTATION_CREATED",
    resourceType: "consultation",
    resourceId: "ENC-HIST-102",
    status: "SUCCESS",
    previousHash: event1.eventHash,
    metadata: {
      symptoms: ["headache", "fatigue"],
    },
  };
  const event2LegacyHash = computeEventHashV1(event2Partial);
  const event2: AuditEvent = { ...event2Partial, eventHash: event2LegacyHash };

  const historicalLedger: AuditEvent[] = [event0, event1, event2];

  // Test 1: Historical ledger verification
  console.log("[Test 1] Preserved Pre-Change Historical Fixture Compatibility");
  const verification = verifyAuditChain(historicalLedger);
  assert.strictEqual(
    verification.valid,
    true,
    `Historical ledger must verify cleanly under dual-mode verifier. Reason: ${verification.reason}`
  );
  assert.strictEqual(verification.totalEvents, 3, "Total events must be 3");
  assert.strictEqual(verification.headHash, event2.eventHash, "Head hash must match event 2");
  console.log("  ✓ Preserved pre-change fixture (with nested non-alphabetical keys) verifies cleanly.");

  // Test 2: Strict Tamper Detection on Historical Records
  console.log("\n[Test 2] Strict Tamper Detection on Historical Records");
  const tamperedLedgerA = JSON.parse(JSON.stringify(historicalLedger));
  tamperedLedgerA[1].metadata.details.z_offset = 999;
  const tamperCheckA = verifyAuditChain(tamperedLedgerA);
  assert.strictEqual(tamperCheckA.valid, false, "Tampering with historical metadata must be caught");
  assert.strictEqual(tamperCheckA.corruptedIndex, 1, "Corrupted index must point to index 1");
  assert.match(tamperCheckA.reason!, /Payload hash tampering detected at index 1/);

  const tamperedLedgerB = JSON.parse(JSON.stringify(historicalLedger));
  tamperedLedgerB[1].actorId = "malicious-attacker";
  const tamperCheckB = verifyAuditChain(tamperedLedgerB);
  assert.strictEqual(tamperCheckB.valid, false, "Tampering with actorId must be caught");
  assert.strictEqual(tamperCheckB.corruptedIndex, 1);

  const tamperedLedgerC = JSON.parse(JSON.stringify(historicalLedger));
  tamperedLedgerC[2].previousHash = "0000000000000000000000000000000000000000000000000000000000000000";
  const tamperCheckC = verifyAuditChain(tamperedLedgerC);
  assert.strictEqual(tamperCheckC.valid, false, "Broken previousHash pointer must be caught");
  assert.strictEqual(tamperCheckC.corruptedIndex, 2);
  assert.match(tamperCheckC.reason!, /Broken chain pointer at index 2/);
  console.log("  ✓ Tamper detection strictly identifies corrupted metadata, actor, and chain pointers.");

  // Test 3: Seamless Transition
  console.log("\n[Test 3] Seamless Ledger Progression (Historical V1 -> Modern V2)");
  const newEvent3Partial: Omit<AuditEvent, "eventHash"> = {
    index: 3,
    id: "AUD-MODERN-0003",
    timestamp: "2026-10-26T12:00:00.000Z",
    actorId: "system",
    actorRole: "system",
    action: "TRIAGE_EVALUATION",
    resourceType: "consultation",
    resourceId: "ENC-MODERN-201",
    status: "SUCCESS",
    previousHash: event2.eventHash,
    metadata: {
      nestedConfig: {
        timeout: 5000,
        active: true,
      },
    },
    hashVersion: "v2",
  };
  const newEvent3Hash = computeEventHash(newEvent3Partial, "v2");
  const event3: AuditEvent = { ...newEvent3Partial, eventHash: newEvent3Hash };

  const extendedLedger = [...historicalLedger, event3];
  const extendedVerification = verifyAuditChain(extendedLedger);

  assert.strictEqual(
    extendedVerification.valid,
    true,
    `Mixed historical V1 + modern V2 chain must verify with 100% integrity. Reason: ${extendedVerification.reason}`
  );
  assert.strictEqual(extendedVerification.totalEvents, 4);
  assert.strictEqual(extendedVerification.headHash, event3.eventHash);
  console.log("  ✓ New V2 event seamlessly chained to historical V1 head with zero cryptographic divergence.");

  // Test 4: Default computeEventHash Uses Canonical V2
  console.log("\n[Test 4] Default computeEventHash Uses Canonical V2");
  const sampleEvent: Omit<AuditEvent, "eventHash"> = {
    index: 0,
    id: "AUD-SAMPLE",
    timestamp: "2026-10-26T00:00:00.000Z",
    actorId: "test",
    actorRole: "system",
    action: "AUDIT_CHAIN_VERIFIED",
    resourceType: "system",
    resourceId: "sample",
    status: "SUCCESS",
    previousHash: GENESIS_HASH,
    metadata: { b: { z: 1, a: 2 } },
  };

  const defaultHash = computeEventHash(sampleEvent);
  const explicitV2Hash = computeEventHashV2(sampleEvent);
  const explicitV1Hash = computeEventHashV1(sampleEvent);

  assert.strictEqual(defaultHash, explicitV2Hash, "Default computeEventHash must match V2 canonical hash");
  assert.notStrictEqual(defaultHash, explicitV1Hash, "V2 hash must be distinct from V1 on nested keys");
  console.log("  ✓ Default hash function strictly invokes canonical V2 calculation.");

  // Test 5: 5-Key Nested Object In-Memory Recovery
  console.log("\n[Test 5] Boundary Check: 5-Key Nested Object In-Memory Recovery (5! = 120)");
  const fiveKeyPartial: Omit<AuditEvent, "eventHash"> = {
    index: 0,
    id: "AUD-5KEY-001",
    timestamp: "2026-01-01T00:00:00.000Z",
    actorId: "system",
    actorRole: "system",
    action: "AUDIT_CHAIN_VERIFIED",
    resourceType: "system",
    resourceId: "test-5key",
    status: "SUCCESS",
    previousHash: GENESIS_HASH,
    metadata: {
      params: {
        z_last: 5,
        w_fourth: 4,
        m_third: 3,
        d_second: 2,
        a_first: 1,
      },
    },
  };
  const fiveKeyV1Hash = computeEventHashV1(fiveKeyPartial);
  // Simulate PostgreSQL JSONB reordering (alphabetical order)
  const fiveKeyAlphabeticalMetadata = {
    params: {
      a_first: 1,
      d_second: 2,
      m_third: 3,
      w_fourth: 4,
      z_last: 5,
    },
  };
  const fiveKeyEventSimulatedDb: AuditEvent = {
    ...fiveKeyPartial,
    metadata: fiveKeyAlphabeticalMetadata,
    eventHash: fiveKeyV1Hash,
  };

  const fiveKeyCheck = verifyEventIntegrity(fiveKeyEventSimulatedDb);
  assert.strictEqual(fiveKeyCheck.valid, true, "5-key nested object must verify via permutation recovery");
  assert.strictEqual(fiveKeyCheck.status, "VERIFIED_V1_RECOVERED");
  assert(fiveKeyCheck.permutationsEvaluated! <= 120, "Permutations evaluated must be <= 120");
  assert.strictEqual(fiveKeyCheck.totalCandidatePermutations, 120);
  console.log(`  ✓ 5-key nested object verified cleanly (evaluated ${fiveKeyCheck.permutationsEvaluated}/120 candidate permutations).`);

  // Test 6: Multiple Nested Objects with Independent Reordering
  console.log("\n[Test 6] Boundary Check: Multiple Nested Objects with Independent Reordering");
  const multiNestedPartial: Omit<AuditEvent, "eventHash"> = {
    index: 0,
    id: "AUD-MULTI-001",
    timestamp: "2026-01-01T00:00:00.000Z",
    actorId: "system",
    actorRole: "system",
    action: "AUDIT_CHAIN_VERIFIED",
    resourceType: "system",
    resourceId: "test-multi",
    status: "SUCCESS",
    previousHash: GENESIS_HASH,
    metadata: {
      filterConfig: {
        z_sort: "desc",
        a_filter: "active",
      },
      pagination: {
        offset: 100,
        limit: 25,
        cursor: "cur_xyz",
      },
    },
  };
  const multiNestedV1Hash = computeEventHashV1(multiNestedPartial);
  // Total permutations: 2! * 3! = 2 * 6 = 12
  const candidateCount = countCandidatePermutations(multiNestedPartial.metadata, true);
  assert.strictEqual(candidateCount, 12, "Candidate permutations for 2-key and 3-key objects must be 12");

  // Simulate JSONB reordering (alphabetical keys)
  const multiAlphabeticalMetadata = {
    filterConfig: {
      a_filter: "active",
      z_sort: "desc",
    },
    pagination: {
      cursor: "cur_xyz",
      limit: 25,
      offset: 100,
    },
  };
  const multiEventSimulatedDb: AuditEvent = {
    ...multiNestedPartial,
    metadata: multiAlphabeticalMetadata,
    eventHash: multiNestedV1Hash,
  };

  const multiCheck = verifyEventIntegrity(multiEventSimulatedDb);
  assert.strictEqual(multiCheck.valid, true, "Multi-nested object must verify via permutation recovery");
  assert.strictEqual(multiCheck.status, "VERIFIED_V1_RECOVERED");
  assert(multiCheck.permutationsEvaluated! <= 12, "Permutations evaluated must be <= 12");
  console.log(`  ✓ Multiple nested objects verified cleanly (evaluated ${multiCheck.permutationsEvaluated}/12 permutations).`);

  // Test 7: Nested Objects in Arrays
  console.log("\n[Test 7] Boundary Check: Nested Objects Inside Arrays");
  const arrayNestedPartial: Omit<AuditEvent, "eventHash"> = {
    index: 0,
    id: "AUD-ARRAY-001",
    timestamp: "2026-01-01T00:00:00.000Z",
    actorId: "system",
    actorRole: "system",
    action: "AUDIT_CHAIN_VERIFIED",
    resourceType: "system",
    resourceId: "test-array",
    status: "SUCCESS",
    previousHash: GENESIS_HASH,
    metadata: {
      batchId: "BATCH-1",
      entries: [
        { y_metric: 99, x_metric: 1 },
        { b_code: "ALT", a_code: "AST" },
      ],
    },
  };
  const arrayNestedV1Hash = computeEventHashV1(arrayNestedPartial);
  // Total permutations: 2! * 2! = 4
  const arrayCandidateCount = countCandidatePermutations(arrayNestedPartial.metadata, true);
  assert.strictEqual(arrayCandidateCount, 4, "Array with two 2-key objects must have 4 candidate permutations");

  // Simulate JSONB reordering
  const arrayAlphabeticalMetadata = {
    batchId: "BATCH-1",
    entries: [
      { x_metric: 1, y_metric: 99 },
      { a_code: "AST", b_code: "ALT" },
    ],
  };
  const arrayEventSimulatedDb: AuditEvent = {
    ...arrayNestedPartial,
    metadata: arrayAlphabeticalMetadata,
    eventHash: arrayNestedV1Hash,
  };

  const arrayCheck = verifyEventIntegrity(arrayEventSimulatedDb);
  assert.strictEqual(arrayCheck.valid, true, "Nested objects inside arrays must verify via permutation recovery");
  assert.strictEqual(arrayCheck.status, "VERIFIED_V1_RECOVERED");
  console.log(`  ✓ Nested objects inside arrays verified cleanly (evaluated ${arrayCheck.permutationsEvaluated}/4 permutations).`);

  // Test 8: Tamper Invariant Checks across Permutation Boundaries
  console.log("\n[Test 8] Tamper Invariant Defense Across Boundary Scenarios");
  // 8a: Value tampering in 5-key object
  const tampered5Key: AuditEvent = {
    ...fiveKeyEventSimulatedDb,
    metadata: {
      params: {
        ...fiveKeyAlphabeticalMetadata.params,
        z_last: 9999, // tampered!
      },
    },
  };
  const tampered5Check = verifyEventIntegrity(tampered5Key);
  assert.strictEqual(tampered5Check.valid, false, "Tampered value in 5-key object must fail closed");
  assert.strictEqual(tampered5Check.status, "TAMPERED");
  assert.strictEqual(tampered5Check.permutationsEvaluated, 120, "Must exhaustively evaluate all 120 permutations before failing");

  // 8b: Actor tampering on multi-nested event
  const tamperedMultiActor: AuditEvent = {
    ...multiEventSimulatedDb,
    actorId: "impostor-admin",
  };
  const tamperedMultiCheck = verifyEventIntegrity(tamperedMultiActor);
  assert.strictEqual(tamperedMultiCheck.valid, false, "Tampered actor on multi-nested event must fail closed");
  assert.strictEqual(tamperedMultiCheck.status, "TAMPERED");

  // 8c: Pointer tampering
  const tamperedPointerLedger: AuditEvent[] = [
    { ...event0 },
    { ...multiEventSimulatedDb, index: 1, previousHash: "0000000000000000000000000000000000000000000000000000000000000000" },
  ];
  const pointerCheck = verifyAuditChain(tamperedPointerLedger);
  assert.strictEqual(pointerCheck.valid, false, "Tampered previousHash pointer must fail closed");
  assert.match(pointerCheck.reason!, /Broken chain pointer/);

  // 8d: Value tampering in array-nested object
  const tamperedArray: AuditEvent = {
    ...arrayEventSimulatedDb,
    metadata: {
      ...arrayAlphabeticalMetadata,
      entries: [
        { x_metric: 99999, y_metric: 99 }, // tampered!
        { a_code: "AST", b_code: "ALT" },
      ],
    },
  };
  const tamperedArrayCheck = verifyEventIntegrity(tamperedArray);
  assert.strictEqual(tamperedArrayCheck.valid, false, "Tampered value in array must fail closed");
  assert.strictEqual(tamperedArrayCheck.status, "TAMPERED");
  console.log("  ✓ Strict tamper defense verified across all boundary scenarios (values, actors, pointers).");

  // Test 9: Budget Exceeded Handling
  console.log("\n[Test 9] Budget Exceeded Handling: Explicit UNVERIFIABLE_BUDGET_EXCEEDED (7! = 5040 > 1000)");
  const largeObjectPartial: Omit<AuditEvent, "eventHash"> = {
    index: 0,
    id: "AUD-LARGE-001",
    timestamp: "2026-01-01T00:00:00.000Z",
    actorId: "system",
    actorRole: "system",
    action: "AUDIT_CHAIN_VERIFIED",
    resourceType: "system",
    resourceId: "test-large",
    status: "SUCCESS",
    previousHash: GENESIS_HASH,
    metadata: {
      hugeConfig: {
        k7: 7,
        k6: 6,
        k5: 5,
        k4: 4,
        k3: 3,
        k2: 2,
        k1: 1,
      },
    },
  };
  const largeV1Hash = computeEventHashV1(largeObjectPartial);
  const largeCount = countCandidatePermutations(largeObjectPartial.metadata, true);
  assert.strictEqual(largeCount, 5040, "7-key nested object has 5040 permutations");

  const largeAlphabeticalMetadata = {
    hugeConfig: {
      k1: 1,
      k2: 2,
      k3: 3,
      k4: 4,
      k5: 5,
      k6: 6,
      k7: 7,
    },
  };
  const largeEventSimulatedDb: AuditEvent = {
    ...largeObjectPartial,
    metadata: largeAlphabeticalMetadata,
    eventHash: largeV1Hash,
  };

  const largeCheck = verifyEventIntegrity(largeEventSimulatedDb);
  assert.strictEqual(largeCheck.valid, false, "Record exceeding budget must not verify");
  assert.strictEqual(
    largeCheck.status,
    "UNVERIFIABLE_BUDGET_EXCEEDED",
    "Must explicitly report UNVERIFIABLE_BUDGET_EXCEEDED, NOT TAMPERED"
  );
  assert.strictEqual(largeCheck.permutationsEvaluated, 0, "Must not evaluate permutations when budget exceeded");
  assert.strictEqual(largeCheck.totalCandidatePermutations, 5040);
  assert.match(largeCheck.reason!, /search budget exceeded: 5040 candidate permutations/);

  // Chain verification must report the exact budget exceeded reason
  const largeChainCheck = verifyAuditChain([largeEventSimulatedDb]);
  assert.strictEqual(largeChainCheck.valid, false);
  assert.match(largeChainCheck.reason!, /Audit verification incomplete at index 0/);
  assert.doesNotMatch(largeChainCheck.reason!, /Payload hash tampering detected/);
  console.log("  ✓ Predictable budget enforced: Exceeding 1000 permutations explicitly reports UNVERIFIABLE_BUDGET_EXCEEDED without falsely accusing tampering.");

  // ---------------------------------------------------------------------------
  // PART B: GENUINE POSTGRESQL JSONB ROUND-TRIP VERIFICATION
  // ---------------------------------------------------------------------------
  console.log("\n--- PART B: GENUINE POSTGRESQL JSONB ROUND-TRIP VERIFICATION ---");
  const testDbUrl = resolveTestDatabaseUrl();
  const dbCheck = testDbUrl ? validateTestDatabaseTarget(testDbUrl) : { safe: false };

  if (!testDbUrl || !dbCheck.safe) {
    console.log("  ℹ️  PostgreSQL JSONB live database round-trip skipped (No isolated test database configured).");
    console.log("     Configure TEST_DATABASE_URL or run in CI database service to execute Part B.");
  } else {
    console.log(`[Test 10] Real PostgreSQL JSONB Round-Trip with Historical V1 Event (${dbCheck.dbName})`);
    const dbClient = getDb();
    assert(Boolean(dbClient), "Database client must be available for Part B");

    // Clear previous test records in isolated database
    await dbClient!.delete(auditEventsTable);

    // Test 10: 2-key nested object in real PostgreSQL JSONB
    const dbLegacyPartial: Omit<AuditEvent, "eventHash"> = {
      index: 0,
      id: "AUD-LEGACY-DB-0001",
      timestamp: "2026-01-01T00:00:00.000Z",
      actorId: "clinician-dr-chen",
      actorRole: "clinician",
      action: "AUDIT_CHAIN_VERIFIED",
      resourceType: "audit",
      resourceId: "chain_head",
      status: "SUCCESS",
      previousHash: GENESIS_HASH,
      metadata: {
        totalVerifiedEvents: 50,
        chainValid: true,
        inspectedRange: { offset: 0, limit: 50 }, // 'offset' before 'limit'
      },
    };
    const dbLegacyV1Hash = computeEventHashV1(dbLegacyPartial);

    await dbClient!.insert(auditEventsTable).values({
      index: dbLegacyPartial.index,
      id: dbLegacyPartial.id,
      timestamp: dbLegacyPartial.timestamp,
      actorId: dbLegacyPartial.actorId,
      actorRole: dbLegacyPartial.actorRole,
      action: dbLegacyPartial.action,
      resourceType: dbLegacyPartial.resourceType,
      resourceId: dbLegacyPartial.resourceId,
      status: dbLegacyPartial.status,
      metadata: dbLegacyPartial.metadata,
      previousHash: dbLegacyPartial.previousHash,
      eventHash: dbLegacyV1Hash,
    });

    const rows10 = await dbClient!
      .select()
      .from(auditEventsTable)
      .where(eq(auditEventsTable.id, dbLegacyPartial.id))
      .limit(1);

    assert.strictEqual(rows10.length, 1);
    const restoredRow10 = rows10[0];
    const returnedKeys10 = Object.keys((restoredRow10.metadata as any).inspectedRange);
    assert.deepStrictEqual(returnedKeys10, ["limit", "offset"], "PostgreSQL jsonb must return keys in alphabetical order");

    const restoredEvent10: AuditEvent = {
      index: restoredRow10.index,
      id: restoredRow10.id,
      timestamp: restoredRow10.timestamp,
      actorId: restoredRow10.actorId,
      actorRole: restoredRow10.actorRole as any,
      action: restoredRow10.action as any,
      resourceType: restoredRow10.resourceType as any,
      resourceId: restoredRow10.resourceId,
      status: restoredRow10.status as any,
      clientIp: restoredRow10.clientIp || undefined,
      metadata: restoredRow10.metadata as any,
      previousHash: restoredRow10.previousHash,
      eventHash: restoredRow10.eventHash,
    };

    const dbVerification10 = verifyAuditChain([restoredEvent10]);
    assert.strictEqual(dbVerification10.valid, true, `Legacy V1 event must verify after real jsonb roundtrip: ${dbVerification10.reason}`);
    console.log("  ✓ Real PostgreSQL JSONB round-trip verified (2-key nested object).");

    // Test 11: 5-Key Nested Object in Real PostgreSQL JSONB
    console.log("\n[Test 11] Real PostgreSQL JSONB Round-Trip with 5-Key Nested Object");
    const db5KeyPartial: Omit<AuditEvent, "eventHash"> = {
      index: 1,
      id: "AUD-5KEY-DB-0002",
      timestamp: "2026-01-01T00:01:00.000Z",
      actorId: "system",
      actorRole: "system",
      action: "AUDIT_CHAIN_VERIFIED",
      resourceType: "system",
      resourceId: "5key_node",
      status: "SUCCESS",
      previousHash: restoredEvent10.eventHash,
      metadata: {
        diagnostics: {
          z_tail: 50,
          v_speed: 40,
          p_pressure: 30,
          f_flow: 20,
          a_head: 10,
        },
      },
    };
    const db5KeyHash = computeEventHashV1(db5KeyPartial);

    await dbClient!.insert(auditEventsTable).values({
      index: db5KeyPartial.index,
      id: db5KeyPartial.id,
      timestamp: db5KeyPartial.timestamp,
      actorId: db5KeyPartial.actorId,
      actorRole: db5KeyPartial.actorRole,
      action: db5KeyPartial.action,
      resourceType: db5KeyPartial.resourceType,
      resourceId: db5KeyPartial.resourceId,
      status: db5KeyPartial.status,
      metadata: db5KeyPartial.metadata,
      previousHash: db5KeyPartial.previousHash,
      eventHash: db5KeyHash,
    });

    const rows11 = await dbClient!
      .select()
      .from(auditEventsTable)
      .where(eq(auditEventsTable.id, db5KeyPartial.id))
      .limit(1);

    assert.strictEqual(rows11.length, 1);
    const restoredRow11 = rows11[0];
    const returnedKeys11 = Object.keys((restoredRow11.metadata as any).diagnostics);
    assert.notDeepStrictEqual(
      returnedKeys11,
      ["z_tail", "v_speed", "p_pressure", "f_flow", "a_head"],
      "PostgreSQL jsonb must reorder keys from their original in-memory insertion order"
    );

    const restoredEvent11: AuditEvent = {
      index: restoredRow11.index,
      id: restoredRow11.id,
      timestamp: restoredRow11.timestamp,
      actorId: restoredRow11.actorId,
      actorRole: restoredRow11.actorRole as any,
      action: restoredRow11.action as any,
      resourceType: restoredRow11.resourceType as any,
      resourceId: restoredRow11.resourceId,
      status: restoredRow11.status as any,
      clientIp: restoredRow11.clientIp || undefined,
      metadata: restoredRow11.metadata as any,
      previousHash: restoredRow11.previousHash,
      eventHash: restoredRow11.eventHash,
    };

    const integrity11 = verifyEventIntegrity(restoredEvent11);
    assert.strictEqual(integrity11.valid, true);
    assert.strictEqual(integrity11.status, "VERIFIED_V1_RECOVERED");
    assert(integrity11.permutationsEvaluated! <= 120);
    console.log(`  ✓ Real PostgreSQL JSONB round-trip verified (5-key nested object, evaluated ${integrity11.permutationsEvaluated}/120 permutations).`);

    // Test 12: Multiple Nested Objects in Real PostgreSQL JSONB
    console.log("\n[Test 12] Real PostgreSQL JSONB Round-Trip with Multiple Nested Objects");
    const dbMultiPartial: Omit<AuditEvent, "eventHash"> = {
      index: 2,
      id: "AUD-MULTI-DB-0003",
      timestamp: "2026-01-01T00:02:00.000Z",
      actorId: "system",
      actorRole: "system",
      action: "AUDIT_CHAIN_VERIFIED",
      resourceType: "system",
      resourceId: "multi_node",
      status: "SUCCESS",
      previousHash: restoredEvent11.eventHash,
      metadata: {
        filterConfig: { z_sort: "desc", a_filter: "active" },
        pagination: { offset: 100, limit: 25, cursor: "c1" },
      },
    };
    const dbMultiHash = computeEventHashV1(dbMultiPartial);

    await dbClient!.insert(auditEventsTable).values({
      index: dbMultiPartial.index,
      id: dbMultiPartial.id,
      timestamp: dbMultiPartial.timestamp,
      actorId: dbMultiPartial.actorId,
      actorRole: dbMultiPartial.actorRole,
      action: dbMultiPartial.action,
      resourceType: dbMultiPartial.resourceType,
      resourceId: dbMultiPartial.resourceId,
      status: dbMultiPartial.status,
      metadata: dbMultiPartial.metadata,
      previousHash: dbMultiPartial.previousHash,
      eventHash: dbMultiHash,
    });

    const rows12 = await dbClient!
      .select()
      .from(auditEventsTable)
      .where(eq(auditEventsTable.id, dbMultiPartial.id))
      .limit(1);

    assert.strictEqual(rows12.length, 1);
    const restoredRow12 = rows12[0];
    const restoredEvent12: AuditEvent = {
      index: restoredRow12.index,
      id: restoredRow12.id,
      timestamp: restoredRow12.timestamp,
      actorId: restoredRow12.actorId,
      actorRole: restoredRow12.actorRole as any,
      action: restoredRow12.action as any,
      resourceType: restoredRow12.resourceType as any,
      resourceId: restoredRow12.resourceId,
      status: restoredRow12.status as any,
      clientIp: restoredRow12.clientIp || undefined,
      metadata: restoredRow12.metadata as any,
      previousHash: restoredRow12.previousHash,
      eventHash: restoredRow12.eventHash,
    };

    const integrity12 = verifyEventIntegrity(restoredEvent12);
    assert.strictEqual(integrity12.valid, true);
    assert.strictEqual(integrity12.status, "VERIFIED_V1_RECOVERED");
    console.log(`  ✓ Real PostgreSQL JSONB round-trip verified (Multiple nested objects, evaluated ${integrity12.permutationsEvaluated}/12 permutations).`);

    // Test 13: Nested Objects in Arrays in Real PostgreSQL JSONB
    console.log("\n[Test 13] Real PostgreSQL JSONB Round-Trip with Nested Objects in Arrays");
    const dbArrayPartial: Omit<AuditEvent, "eventHash"> = {
      index: 3,
      id: "AUD-ARRAY-DB-0004",
      timestamp: "2026-01-01T00:03:00.000Z",
      actorId: "system",
      actorRole: "system",
      action: "AUDIT_CHAIN_VERIFIED",
      resourceType: "system",
      resourceId: "array_node",
      status: "SUCCESS",
      previousHash: restoredEvent12.eventHash,
      metadata: {
        batchId: "BATCH-42",
        items: [
          { y_score: 95, x_score: 80 },
          { b_cat: "cardiac", a_cat: "vital" },
        ],
      },
    };
    const dbArrayHash = computeEventHashV1(dbArrayPartial);

    await dbClient!.insert(auditEventsTable).values({
      index: dbArrayPartial.index,
      id: dbArrayPartial.id,
      timestamp: dbArrayPartial.timestamp,
      actorId: dbArrayPartial.actorId,
      actorRole: dbArrayPartial.actorRole,
      action: dbArrayPartial.action,
      resourceType: dbArrayPartial.resourceType,
      resourceId: dbArrayPartial.resourceId,
      status: dbArrayPartial.status,
      metadata: dbArrayPartial.metadata,
      previousHash: dbArrayPartial.previousHash,
      eventHash: dbArrayHash,
    });

    const rows13 = await dbClient!
      .select()
      .from(auditEventsTable)
      .where(eq(auditEventsTable.id, dbArrayPartial.id))
      .limit(1);

    assert.strictEqual(rows13.length, 1);
    const restoredRow13 = rows13[0];
    const restoredEvent13: AuditEvent = {
      index: restoredRow13.index,
      id: restoredRow13.id,
      timestamp: restoredRow13.timestamp,
      actorId: restoredRow13.actorId,
      actorRole: restoredRow13.actorRole as any,
      action: restoredRow13.action as any,
      resourceType: restoredRow13.resourceType as any,
      resourceId: restoredRow13.resourceId,
      status: restoredRow13.status as any,
      clientIp: restoredRow13.clientIp || undefined,
      metadata: restoredRow13.metadata as any,
      previousHash: restoredRow13.previousHash,
      eventHash: restoredRow13.eventHash,
    };

    const integrity13 = verifyEventIntegrity(restoredEvent13);
    assert.strictEqual(integrity13.valid, true);
    assert.strictEqual(integrity13.status, "VERIFIED_V1_RECOVERED");
    console.log(`  ✓ Real PostgreSQL JSONB round-trip verified (Nested objects in arrays, evaluated ${integrity13.permutationsEvaluated}/4 permutations).`);

    // Test 14: Database-Level Payload Tampering Fails Closed
    console.log("\n[Test 14] Real PostgreSQL JSONB Database-Level Payload Tampering Fails Closed");
    const tamperedDbEvent: AuditEvent = {
      ...restoredEvent11,
      metadata: {
        diagnostics: {
          ...(restoredEvent11.metadata as any).diagnostics,
          z_tail: 999999, // tampered value!
        },
      },
    };

    const dbTamperCheck = verifyEventIntegrity(tamperedDbEvent);
    assert.strictEqual(dbTamperCheck.valid, false);
    assert.strictEqual(dbTamperCheck.status, "TAMPERED");
    assert.strictEqual(dbTamperCheck.permutationsEvaluated, 120);
    console.log("  ✓ Database-level payload tampering strictly caught across all 120 permutations (fails closed).");

    // Test 15: Budget-Exceeded Event Through Real PostgreSQL JSONB
    console.log("\n[Test 15] Real PostgreSQL JSONB Round-Trip with Budget-Exceeded Event (7 keys)");
    const dbHugePartial: Omit<AuditEvent, "eventHash"> = {
      index: 4,
      id: "AUD-HUGE-DB-0005",
      timestamp: "2026-01-01T00:04:00.000Z",
      actorId: "system",
      actorRole: "system",
      action: "AUDIT_CHAIN_VERIFIED",
      resourceType: "system",
      resourceId: "huge_node",
      status: "SUCCESS",
      previousHash: restoredEvent13.eventHash,
      metadata: {
        hugeObj: { k7: 7, k6: 6, k5: 5, k4: 4, k3: 3, k2: 2, k1: 1 },
      },
    };
    const dbHugeHash = computeEventHashV1(dbHugePartial);

    await dbClient!.insert(auditEventsTable).values({
      index: dbHugePartial.index,
      id: dbHugePartial.id,
      timestamp: dbHugePartial.timestamp,
      actorId: dbHugePartial.actorId,
      actorRole: dbHugePartial.actorRole,
      action: dbHugePartial.action,
      resourceType: dbHugePartial.resourceType,
      resourceId: dbHugePartial.resourceId,
      status: dbHugePartial.status,
      metadata: dbHugePartial.metadata,
      previousHash: dbHugePartial.previousHash,
      eventHash: dbHugeHash,
    });

    const rows15 = await dbClient!
      .select()
      .from(auditEventsTable)
      .where(eq(auditEventsTable.id, dbHugePartial.id))
      .limit(1);

    assert.strictEqual(rows15.length, 1);
    const restoredRow15 = rows15[0];
    const restoredEvent15: AuditEvent = {
      index: restoredRow15.index,
      id: restoredRow15.id,
      timestamp: restoredRow15.timestamp,
      actorId: restoredRow15.actorId,
      actorRole: restoredRow15.actorRole as any,
      action: restoredRow15.action as any,
      resourceType: restoredRow15.resourceType as any,
      resourceId: restoredRow15.resourceId,
      status: restoredRow15.status as any,
      clientIp: restoredRow15.clientIp || undefined,
      metadata: restoredRow15.metadata as any,
      previousHash: restoredRow15.previousHash,
      eventHash: restoredRow15.eventHash,
    };

    const integrity15 = verifyEventIntegrity(restoredEvent15);
    assert.strictEqual(integrity15.valid, false);
    assert.strictEqual(integrity15.status, "UNVERIFIABLE_BUDGET_EXCEEDED");
    assert.strictEqual(integrity15.totalCandidatePermutations, 5040);
    console.log("  ✓ Budget-exceeded record retrieved from PostgreSQL JSONB explicitly flags UNVERIFIABLE_BUDGET_EXCEEDED (5040 > 1000).");

    // Test 16: Chaining Modern V2 Event to Database-Restored V1 Chain
    console.log("\n[Test 16] Chaining Modern V2 Event to Database-Restored V1 Chain");
    // Verify the 4-event chain (events 10, 11, 12, 13)
    const validRestoredChain = [restoredEvent10, restoredEvent11, restoredEvent12, restoredEvent13];
    const chainCheck = verifyAuditChain(validRestoredChain);
    assert.strictEqual(chainCheck.valid, true, `Restored 4-event V1 chain must verify: ${chainCheck.reason}`);

    // Append modern V2 event to the restored V1 chain
    const dbModernPartial: Omit<AuditEvent, "eventHash"> = {
      index: 4,
      id: "AUD-MODERN-DB-0006",
      timestamp: "2026-10-26T12:00:00.000Z",
      actorId: "system",
      actorRole: "system",
      action: "AUDIT_CHAIN_VERIFIED",
      resourceType: "system",
      resourceId: "modern_head",
      status: "SUCCESS",
      previousHash: restoredEvent13.eventHash,
      metadata: {
        config: { active: true, retries: 3 },
      },
      hashVersion: "v2",
    };
    const dbModernHash = computeEventHash(dbModernPartial, "v2");
    const modernEvent: AuditEvent = { ...dbModernPartial, eventHash: dbModernHash };

    const fullRestoredWithV2 = [...validRestoredChain, modernEvent];
    const fullCheck = verifyAuditChain(fullRestoredWithV2);
    assert.strictEqual(fullCheck.valid, true, `Full hybrid chain must verify: ${fullCheck.reason}`);
    assert.strictEqual(fullCheck.headHash, dbModernHash);
    console.log("  ✓ Modern V2 event successfully chained to database-restored V1 chain with 100% integrity.");

    // Clean up test records
    await dbClient!.delete(auditEventsTable);
  }

  console.log("\n================================================================================");
  console.log("  HISTORICAL AUDIT COMPATIBILITY & JSONB RECOVERY: ALL TESTS PASSED (100%)     ");
  console.log("================================================================================\n");
}

runAuditHistoryCompatibilityBattery().catch((err) => {
  console.error("Audit history compatibility battery failure:", err);
  process.exit(1);
});
