import assert from "assert";
import {
  validateTestDatabaseTarget,
  maskDatabaseUrl,
  assertSafeTestDatabase,
  resolveTestDatabaseUrl,
} from "../../lib/security/test-db-guard";

async function runTestDbGuardBattery() {
  console.log("================================================================================");
  console.log("       TEST DATABASE SAFETY GUARD ADVERSARIAL & BOUNDARY BATTERY               ");
  console.log("================================================================================\n");

  // 1. Missing Configuration Fail-Closed
  console.log("[Test 1] Missing Configuration Fails Closed");
  const missingCases = [undefined, "", "   ", null as any];
  for (const tc of missingCases) {
    const res = validateTestDatabaseTarget(tc);
    assert.strictEqual(res.safe, false, "Undefined or empty database URL must be rejected");
    assert.match(res.reason!, /No database URL configured/);
  }
  console.log("  ✓ Correctly rejected missing and whitespace configurations.");

  // 2. Malformed URL Formats
  console.log("\n[Test 2] Malformed URLs Fail Closed");
  const malformedCases = [
    "not-a-url",
    "http://localhost:5432/medvoice_test",
    "mysql://user:pass@localhost:3306/medvoice_test",
    "mongodb://localhost:27017/medvoice_test",
    "file:///tmp/db.sqlite",
    "postgresql://",
  ];
  for (const tc of malformedCases) {
    const res = validateTestDatabaseTarget(tc);
    assert.strictEqual(res.safe, false, `Malformed URL '${tc}' must be rejected`);
    assert(res.reason!.length > 0, "Reason must be provided");
  }
  console.log("  ✓ Correctly rejected non-PostgreSQL protocols and unparseable strings.");

  // 3. Empty Database Names
  console.log("\n[Test 3] Empty Database Names Fail Closed");
  const emptyDbCases = [
    "postgresql://localhost:5432",
    "postgresql://localhost:5432/",
    "postgresql://user:pass@localhost:5432/?sslmode=disable",
  ];
  for (const tc of emptyDbCases) {
    const res = validateTestDatabaseTarget(tc);
    assert.strictEqual(res.safe, false, "Empty database name must be rejected");
    assert.match(res.reason!, /Database name cannot be empty/);
  }
  console.log("  ✓ Correctly rejected connection strings without explicit database names.");

  // 4. Primary Shared Database Rejection (Unconditional)
  console.log("\n[Test 4] Shared Primary Neon Database Unconditionally Rejected");
  const primaryCases = [
    "postgresql://neondb_owner:secret_password@ep-raspy-dawn-awdpo1my-pooler.c-12.us-east-1.aws.neon.tech/Ai-Medical-Voice-Agent?sslmode=require",
    "postgresql://neondb_owner:secret_password@ep-raspy-dawn-awdpo1my.us-east-1.aws.neon.tech/ai-medical-voice-agent",
    "postgresql://user:pass@ep-raspy-dawn.us-east-1.aws.neon.tech/test_db", // primary host pattern
    "postgresql://user:pass@localhost:5432/Ai-Medical-Voice-Agent", // primary db name on localhost
    "postgresql://user:pass@localhost:5432/ai-medical-voice-agent",
  ];
  for (const tc of primaryCases) {
    const res = validateTestDatabaseTarget(tc);
    assert.strictEqual(res.safe, false, `Primary shared database target must be rejected: ${tc}`);
    assert.match(res.reason!, /SAFETY VIOLATION.*primary clinical database/);
    assert.strictEqual(res.maskedUrl?.includes("secret_password"), false, "Plaintext password must not be leaked in maskedUrl");
  }
  console.log("  ✓ Unconditionally rejected all variations of primary shared database target.");

  // 5. Positive Identification of Test Datastores
  console.log("\n[Test 5] Positive Identification of Safe Isolated Targets");
  const safeCases = [
    "postgresql://postgres:postgres@localhost:5432/medvoice_test",
    "postgresql://postgres:postgres@127.0.0.1:5432/medvoice_test",
    "postgresql://postgres:postgres@127.0.0.1:5433/medvoice_test",
    "postgresql://postgres:testpassword123@postgres:5432/medvoice_test",
    "postgresql://user:pass@host.docker.internal:5432/test_db",
    "postgresql://user:pass@ep-isolated-ci-1234.us-east-1.aws.neon.tech/medvoice_test",
  ];
  for (const tc of safeCases) {
    const res = validateTestDatabaseTarget(tc);
    assert.strictEqual(res.safe, true, `Safe target must pass: ${tc}`);
    assert.strictEqual(res.maskedUrl?.includes("postgres@"), false, "Password masked in safe case");
    assert.strictEqual(res.maskedUrl?.includes("****"), true, "Mask string present in maskedUrl");
  }
  console.log("  ✓ Correctly identified and approved genuine isolated test datastores.");

  // 6. Unknown Remote Host Rejected Even If Database Name Contains 'test'
  console.log("\n[Test 6] Unknown Remote Hosts Rejected Even With 'test' Database Name");
  const remoteTestCases = [
    "postgresql://app_user:pass@prod-cluster.c-12.us-east-1.rds.amazonaws.com:5432/medvoice_test",
    "postgresql://app_user:pass@prod-cluster.c-12.us-east-1.rds.amazonaws.com:5432/test",
    "postgresql://app_user:pass@production-db.internal:5432/ci_database",
    "postgresql://app_user:pass@cloud-postgres.azure.com:5432/sandbox_test",
    "postgresql://app_user:pass@ep-random-cloud-host-123.neon.tech/test_db",
  ];
  for (const tc of remoteTestCases) {
    const res = validateTestDatabaseTarget(tc);
    assert.strictEqual(res.safe, false, `Unknown remote host with test db name must fail closed: ${tc}`);
    assert.match(res.reason!, /SAFETY VIOLATION.*Remote database host.*cannot be positively verified/);
  }

  // Also verify local non-test names are rejected
  const localNonTestRes = validateTestDatabaseTarget("postgresql://postgres:postgres@localhost:5432/production_live");
  assert.strictEqual(localNonTestRes.safe, false, "Local non-test database name must be rejected");
  assert.match(localNonTestRes.reason!, /does not have an isolated test name/);

  console.log("  ✓ Unknown remote hosts strictly rejected despite test-related database naming.");

  // 7. Credential Masking & Sensitive Query Redaction
  console.log("\n[Test 7] Credential & Sensitive Query Parameter Masking");
  const sensitiveUrl = "postgresql://my_user:super_secret_pass_123@localhost:5432/medvoice_test?apiKey=secret_api_key&token=jwt_sensitive_token&other=safe";
  const masked = maskDatabaseUrl(sensitiveUrl);
  assert.strictEqual(masked.includes("super_secret_pass_123"), false, "Password redacted");
  assert.strictEqual(masked.includes("secret_api_key"), false, "apiKey query parameter redacted");
  assert.strictEqual(masked.includes("jwt_sensitive_token"), false, "token query parameter redacted");
  assert.strictEqual(masked.includes("other=safe"), true, "Non-sensitive parameter preserved");
  assert.strictEqual(masked.includes("****"), true, "Mask placeholder present");
  console.log("  ✓ Plaintext credentials and sensitive query parameters sanitized.");

  // 8. assertSafeTestDatabase Assertions
  console.log("\n[Test 8] assertSafeTestDatabase Guard Invariants");
  assert.throws(
    () => assertSafeTestDatabase("postgresql://neondb_owner:npg@ep-raspy-dawn.us-east-1.aws.neon.tech/Ai-Medical-Voice-Agent"),
    /SAFETY VIOLATION/,
    "assertSafeTestDatabase must throw on primary database"
  );
  assert.throws(
    () => assertSafeTestDatabase(""),
    /No database URL configured/,
    "assertSafeTestDatabase must throw on empty URL"
  );
  const safeDbUrl = "postgresql://postgres:postgres@localhost:5432/medvoice_test";
  const returnedUrl = assertSafeTestDatabase(safeDbUrl);
  assert.strictEqual(returnedUrl, safeDbUrl, "assertSafeTestDatabase returns raw URL only when proven safe");
  console.log("  ✓ assertSafeTestDatabase strictly enforces safety invariant.");

  console.log("\n================================================================================");
  console.log("  TEST DATABASE SAFETY GUARD: ALL 8 TEST INVARIANTS PASSED (100%)              ");
  console.log("================================================================================\n");
}

runTestDbGuardBattery().catch((err) => {
  console.error("Test DB guard battery failure:", err);
  process.exit(1);
});
