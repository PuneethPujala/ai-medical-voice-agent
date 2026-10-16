import { spawnSync } from "child_process";
import * as dotenv from "dotenv";

if (process.env.MEDVOICE_OFFLINE_TESTS === "1") {
  delete process.env.DATABASE_URL;
} else {
  dotenv.config({ path: ".env.local" });
  if (!process.env.DATABASE_URL) {
    dotenv.config({ path: ".env" });
  }
}

const DB_TEST_SUITES = [
  { id: "test:durable-audit", file: "tests/security-eval/durable-audit.test.ts", description: "Durable PostgreSQL Audit Chain Persistence" },
  { id: "test:atomic-concurrency", file: "tests/security-eval/atomic-concurrency-idempotency.test.ts", description: "Atomic CAS & Unique Idempotency Invariants" },
  { id: "verify:neon-concurrency", file: "scripts/verify-real-neon-concurrency.ts", description: "Live Neon PostgreSQL Concurrency Verification" },
  { id: "verify:db-schema", file: "scripts/verify-db-schema-live.ts", description: "Live Neon Schema & Constraint Validation" },
];

export async function runDatabaseTests() {
  console.log("================================================================================");
  console.log("       MEDVOICE REAL POSTGRESQL INTEGRATION VERIFICATION HARNESS                 ");
  console.log("================================================================================");

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.warn("\n⚠️  SKIPPED: DATABASE_URL environment variable is not configured.");
    console.warn("   A live PostgreSQL instance (e.g., Neon serverless) is required for real database verification.");
    console.warn("   Offline test execution cannot and must not be counted as verified database coverage.");
    console.warn("   To run real database verification, set DATABASE_URL in .env.local or the environment.\n");
    console.log("================================================================================");
    console.log("  DATABASE STATUS: UNCONFIGURED (Live verification explicitly skipped)          ");
    console.log("================================================================================\n");
    return;
  }

  // Mask database credentials in console output
  const maskedUrl = dbUrl.replace(/\/\/([^:]+):([^@]+)@/, "//$1:****@");
  console.log(`Connected Datastore: ${maskedUrl}`);
  console.log(`Executing ${DB_TEST_SUITES.length} live-database verification suites...\n`);

  for (let i = 0; i < DB_TEST_SUITES.length; i++) {
    const suite = DB_TEST_SUITES[i];
    console.log(`[${i + 1}/${DB_TEST_SUITES.length}] Executing ${suite.id} (${suite.file})...`);
    console.log(`     Target: ${suite.description}`);

    const startTime = Date.now();
    const child = spawnSync("npx", ["tsx", suite.file], {
      stdio: "inherit",
      shell: true,
      env: { ...process.env, NODE_ENV: "test" },
    });

    const elapsed = Date.now() - startTime;
    if (child.status !== 0) {
      console.error(`\n❌ FAILED: ${suite.id} exited with status ${child.status}`);
      process.exit(child.status || 1);
    }

    console.log(`  ✓ ${suite.id}: PASSED (${elapsed}ms)\n`);
  }

  console.log("================================================================================");
  console.log("  ALL REAL POSTGRESQL INTEGRATION SUITES PASSED & VERIFIED (100%)              ");
  console.log("================================================================================\n");
}

if (require.main === module || process.argv[1]?.endsWith("run-database-tests.ts")) {
  runDatabaseTests().catch((err) => {
    console.error("Fatal error during database test run:", err);
    process.exit(1);
  });
}
