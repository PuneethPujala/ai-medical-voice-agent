/**
 * Test Database Safety Guard
 * 
 * Prevents automated integration tests from writing to or permanently polluting
 * the shared primary production/development clinical database (e.g. Ai-Medical-Voice-Agent).
 * 
 * Invariants:
 * 1. Prefers TEST_DATABASE_URL over DATABASE_URL for all integration tests.
 * 2. Strictly and unconditionally rejects the primary shared database by database name,
 *    endpoint identity, and known production Neon host patterns.
 * 3. Never leaks plaintext credentials, passwords, or tokens in console output or error messages.
 * 4. Fails closed: if a target database cannot be positively identified as an isolated
 *    test datastore, execution is aborted before any writes can occur.
 * 5. Provides unified SQL execution helper (createSqlHelper) for tests across both
 *    Neon HTTP and standard PostgreSQL service containers.
 */

import { neon } from "@neondatabase/serverless";
import { Pool } from "pg";

export interface TestDbValidationResult {
  safe: boolean;
  dbUrl?: string;
  maskedUrl?: string;
  dbName?: string;
  host?: string;
  reason?: string;
}

// Known primary shared clinical database identifiers that must NEVER be written to by automated tests
const SHARED_PRIMARY_DB_NAMES = new Set([
  "ai-medical-voice-agent",
]);

const SHARED_PRIMARY_HOST_PATTERNS = [
  "ep-raspy-dawn",
  "ep-raspy-dawn-awdpo1my",
];

const LOCAL_CI_HOST_PREFIXES = [
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
  "postgres",
  "0.0.0.0",
  "host.docker.internal",
];

export function resolveTestDatabaseUrl(): string | undefined {
  return process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
}

export function maskDatabaseUrl(urlStr: string): string {
  if (!urlStr || typeof urlStr !== "string") {
    return "[EMPTY_OR_INVALID_URL]";
  }

  try {
    const parsed = new URL(urlStr);
    if (parsed.password) {
      parsed.password = "****";
    }

    // Redact sensitive query parameters if present
    const sensitiveKeys = ["password", "token", "key", "secret", "auth", "apikey"];
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (sensitiveKeys.some((s) => key.toLowerCase().includes(s))) {
        parsed.searchParams.set(key, "****");
      }
    }

    return parsed.toString();
  } catch {
    // Fallback regex masking for non-standard URI schemes
    return urlStr
      .replace(/\/\/([^:]+):([^@]+)@/, "//$1:****@")
      .replace(/([?&](?:password|token|key|secret)=)[^&]+/gi, "$1****");
  }
}

export function validateTestDatabaseTarget(urlStr?: string): TestDbValidationResult {
  if (!urlStr || typeof urlStr !== "string" || !urlStr.trim()) {
    return {
      safe: false,
      reason: "No database URL configured (neither TEST_DATABASE_URL nor DATABASE_URL found).",
    };
  }

  const trimmed = urlStr.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      safe: false,
      reason: "Invalid database URL connection string format (URL parse error).",
    };
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== "postgresql:" && protocol !== "postgres:") {
    return {
      safe: false,
      reason: `Unsupported database protocol '${parsed.protocol}'. Only 'postgresql:' and 'postgres:' are permitted for test datastores.`,
    };
  }

  const host = parsed.host.toLowerCase();
  const pathname = parsed.pathname;
  const dbName = pathname.replace(/^\//, "").split("?")[0].trim();
  const maskedUrl = maskDatabaseUrl(trimmed);

  if (!dbName) {
    return {
      safe: false,
      maskedUrl,
      host,
      reason: "Database name cannot be empty in connection string.",
    };
  }

  // 1. Unconditional rejection of known primary shared clinical database
  const isPrimaryName = SHARED_PRIMARY_DB_NAMES.has(dbName.toLowerCase());
  const isPrimaryHost = SHARED_PRIMARY_HOST_PATTERNS.some((pattern) => host.includes(pattern));

  if (isPrimaryName || isPrimaryHost) {
    return {
      safe: false,
      maskedUrl,
      dbName,
      host,
      reason: [
        `SAFETY VIOLATION: Database target '${dbName}' on host '${host}' is positively identified as the shared primary clinical database.`,
        `Running automated integration test suites against the primary clinical datastore permanently pollutes the authoritative`,
        `clinical audit ledger and mutates live clinical records.`,
        `To run live database verification safely:`,
        `  1. Run with an isolated disposable PostgreSQL instance (e.g. CI service container on localhost / postgres).`,
        `  2. Or configure TEST_DATABASE_URL pointing to a dedicated ephemeral test branch (e.g. medvoice_test).`,
        `  3. Direct testing against the primary database is strictly prohibited and fails closed.`,
      ].join("\n"),
    };
  }

  // 2. Local/CI Disposable Host Check
  const hostname = parsed.hostname.toLowerCase();
  const isLocalOrCi = LOCAL_CI_HOST_PREFIXES.some(
    (prefix) => hostname === prefix || hostname.startsWith(prefix)
  );

  const isIsolatedDbName =
    dbName.toLowerCase().includes("test") ||
    dbName.toLowerCase().includes("ci") ||
    dbName.toLowerCase().includes("temp") ||
    dbName.toLowerCase().includes("ephemeral") ||
    dbName.toLowerCase().includes("isolated") ||
    dbName.toLowerCase().includes("sandbox") ||
    dbName.toLowerCase() === "postgres"; // standard default database in ephemeral Docker containers

  if (isLocalOrCi) {
    if (!isIsolatedDbName) {
      return {
        safe: false,
        maskedUrl,
        dbName,
        host,
        reason: [
          `SAFETY VIOLATION: Local database target '${dbName}' on host '${host}' does not have an isolated test name.`,
          `Disposable test datastores on local/CI hosts must contain 'test', 'ci', 'temp', 'isolated', 'sandbox', or use default 'postgres'.`,
        ].join("\n"),
      };
    }
    return {
      safe: true,
      dbUrl: trimmed,
      maskedUrl,
      dbName,
      host,
    };
  }

  // 3. Remote / Cloud Host Verification (Strict Fail-Closed)
  // An unknown remote host is strictly REJECTED even if its database name contains 'test'.
  // Remote testing is ONLY permitted if BOTH:
  // a) The remote hostname explicitly identifies as an isolated test branch (e.g. contains 'test', 'ci', or starts with 'ep-test-'), AND
  // b) The database name is explicitly isolated ('test', 'ci', etc.)
  const isExplicitTestHost =
    hostname.includes("test") ||
    hostname.includes("ci") ||
    hostname.startsWith("ep-test-");

  if (!isExplicitTestHost) {
    return {
      safe: false,
      maskedUrl,
      dbName,
      host,
      reason: [
        `SAFETY VIOLATION: Remote database host '${host}' cannot be positively verified as a dedicated test infrastructure branch.`,
        `Unknown remote hosts are strictly rejected even if the database name contains 'test' or 'sandbox'.`,
        `Remote datastores require verified test-branch hostnames (e.g. ep-test-branch.* or hostname containing 'test'/'ci').`,
      ].join("\n"),
    };
  }

  if (!isIsolatedDbName) {
    return {
      safe: false,
      maskedUrl,
      dbName,
      host,
      reason: [
        `SAFETY VIOLATION: Remote test host '${host}' targeted non-isolated database '${dbName}'.`,
        `The database name must explicitly contain 'test', 'ci', 'temp', 'ephemeral', 'isolated', or 'sandbox'.`,
      ].join("\n"),
    };
  }

  return {
    safe: true,
    dbUrl: trimmed,
    maskedUrl,
    dbName,
    host,
  };
}

export function assertSafeTestDatabase(urlStr?: string): string {
  const result = validateTestDatabaseTarget(urlStr);
  if (!result.safe) {
    throw new Error(`\n❌ [TEST DATABASE SAFETY GUARD] ${result.reason}\n`);
  }
  return result.dbUrl!;
}

export type SqlTaggedFunction = {
  (strings: TemplateStringsArray, ...values: any[]): Promise<any[]>;
  end?: () => Promise<void>;
};

/**
 * Creates a unified SQL execution helper that works seamlessly across both
 * Neon cloud instances and standard containerized PostgreSQL instances.
 */
export function createSqlHelper(dbUrl: string): SqlTaggedFunction {
  assertSafeTestDatabase(dbUrl);

  const isNeonCloud = dbUrl.includes(".neon.tech") || dbUrl.startsWith("https://");

  if (isNeonCloud) {
    const neonSql = neon(dbUrl);
    const helper: SqlTaggedFunction = async (strings, ...values) => {
      return (neonSql as any)(strings, ...values);
    };
    helper.end = async () => {};
    return helper;
  }

  const pool = new Pool({ connectionString: dbUrl });
  const helper: SqlTaggedFunction = async (strings, ...values) => {
    let query = strings[0];
    for (let i = 0; i < values.length; i++) {
      query += `$${i + 1}` + strings[i + 1];
    }
    const result = await pool.query(query, values);
    return result.rows;
  };

  helper.end = async () => {
    await pool.end().catch(() => {});
  };

  return helper;
}
