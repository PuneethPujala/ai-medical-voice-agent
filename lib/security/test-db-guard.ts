/**
 * Test Database Safety Guard
 * 
 * Prevents automated integration tests from writing to or permanently polluting
 * the shared primary production/development database (e.g. Ai-Medical-Voice-Agent).
 * 
 * Invariants:
 * 1. Prefers TEST_DATABASE_URL over DATABASE_URL for all integration tests.
 * 2. Strictly rejects the primary shared database unless explicitly overridden with ALLOW_SHARED_DB_TESTING=true.
 * 3. Never leaks plaintext credentials in console output or error messages.
 */

export interface TestDbValidationResult {
  safe: boolean;
  dbUrl?: string;
  maskedUrl?: string;
  dbName?: string;
  host?: string;
  reason?: string;
}

export function resolveTestDatabaseUrl(): string | undefined {
  return process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
}

export function maskDatabaseUrl(urlStr: string): string {
  try {
    return urlStr.replace(/\/\/([^:]+):([^@]+)@/, "//$1:****@");
  } catch {
    return "[MASKED_URL]";
  }
}

export function validateTestDatabaseTarget(urlStr?: string): TestDbValidationResult {
  if (!urlStr) {
    return {
      safe: false,
      reason: "No database URL configured (neither TEST_DATABASE_URL nor DATABASE_URL found).",
    };
  }

  try {
    const parsed = new URL(urlStr);
    const dbName = parsed.pathname.replace(/^\//, "");
    const host = parsed.host;
    const maskedUrl = maskDatabaseUrl(urlStr);

    const isPrimarySharedDb = dbName.toLowerCase() === "ai-medical-voice-agent";
    const isExplicitlyAllowed = process.env.ALLOW_SHARED_DB_TESTING === "true";

    if (isPrimarySharedDb && !isExplicitlyAllowed) {
      return {
        safe: false,
        dbUrl: urlStr,
        maskedUrl,
        dbName,
        host,
        reason: [
          `SAFETY VIOLATION: Database target '${dbName}' on host '${host}' is the primary shared database.`,
          `Running mutation-capable suites (such as test:durable-audit) permanently appends synthetic audit records`,
          `to the authoritative clinical audit ledger, corrupting its continuous audit trail.`,
          `To run live database tests safely:`,
          `  1. Create a dedicated Neon test branch or isolated database.`,
          `  2. Set TEST_DATABASE_URL to that isolated database connection string.`,
          `  3. Or pass ALLOW_SHARED_DB_TESTING=true to bypass this safety guard explicitly.`
        ].join("\n"),
      };
    }

    return {
      safe: true,
      dbUrl: urlStr,
      maskedUrl,
      dbName,
      host,
    };
  } catch {
    return {
      safe: false,
      reason: "Invalid database URL connection string format.",
    };
  }
}

export function assertSafeTestDatabase(urlStr?: string): string {
  const result = validateTestDatabaseTarget(urlStr);
  if (!result.safe) {
    throw new Error(`\n❌ [TEST DATABASE SAFETY GUARD] ${result.reason}\n`);
  }
  return result.dbUrl!;
}
