import {
  isPathMatching,
  normalizePath,
  isTestBypassPermitted,
  isPublicRoute,
  isAdminRoute,
  isProtectedPhiRoute,
  PUBLIC_ROUTE_PATTERNS,
  ADMIN_ROUTE_PATTERNS,
  PROTECTED_PHI_ROUTE_PATTERNS,
} from "../../proxy";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

async function runProxyRoutingTests() {
  console.log("\n========================================================");
  console.log("  NEXT.JS PROXY & ROUTE MATCHING VERIFICATION SUITE");
  console.log("========================================================\n");

  // SUITE 1: Public Route Verification
  console.log("[Test Suite 1] Public Routes Access Control");
  {
    assert(isPathMatching("/", PUBLIC_ROUTE_PATTERNS), "Root '/' is recognized as public");
    assert(isPathMatching("/care", PUBLIC_ROUTE_PATTERNS), "'/care' is recognized as public");
    assert(isPathMatching("/care/facility-101", PUBLIC_ROUTE_PATTERNS), "Subpath '/care/facility-101' is recognized as public");
    assert(isPathMatching("/demo", PUBLIC_ROUTE_PATTERNS), "'/demo' is recognized as public");
    assert(isPathMatching("/demo/interactive", PUBLIC_ROUTE_PATTERNS), "'/demo/interactive' is recognized as public");
    assert(isPathMatching("/privacy", PUBLIC_ROUTE_PATTERNS), "'/privacy' is recognized as public");
    assert(isPathMatching("/sign-in", PUBLIC_ROUTE_PATTERNS), "'/sign-in' is recognized as public");
    assert(isPathMatching("/sign-in/sso-callback", PUBLIC_ROUTE_PATTERNS), "'/sign-in/sso-callback' is recognized as public");
    assert(isPathMatching("/sign-up", PUBLIC_ROUTE_PATTERNS), "'/sign-up' is recognized as public");
    assert(isPathMatching("/api/hospitals", PUBLIC_ROUTE_PATTERNS), "'/api/hospitals' is recognized as public");
    assert(isPathMatching("/api/route", PUBLIC_ROUTE_PATTERNS), "'/api/route' is recognized as public");

    // Sibling-prefix anti-spoofing tests (ensure /careless doesn't match /care)
    assert(!isPathMatching("/careless", PUBLIC_ROUTE_PATTERNS), "'/careless' does NOT match public '/care'");
    assert(!isPathMatching("/democrat", PUBLIC_ROUTE_PATTERNS), "'/democrat' does NOT match public '/demo'");
    assert(!isPathMatching("/privacy-breach", PUBLIC_ROUTE_PATTERNS), "'/privacy-breach' does NOT match public '/privacy'");
    assert(!isPathMatching("/sign-in-malicious", PUBLIC_ROUTE_PATTERNS), "'/sign-in-malicious' does NOT match public '/sign-in'");
  }

  // SUITE 2: Admin Route Protection
  console.log("\n[Test Suite 2] Admin & Audit Route Demarcation");
  {
    assert(isPathMatching("/admin", ADMIN_ROUTE_PATTERNS), "'/admin' is recognized as admin route");
    assert(isPathMatching("/admin/users", ADMIN_ROUTE_PATTERNS), "'/admin/users' is recognized as admin route");
    assert(isPathMatching("/api/admin", ADMIN_ROUTE_PATTERNS), "'/api/admin' is recognized as admin route");
    assert(isPathMatching("/api/admin/metrics", ADMIN_ROUTE_PATTERNS), "'/api/admin/metrics' is recognized as admin route");
    assert(isPathMatching("/api/audit", ADMIN_ROUTE_PATTERNS), "'/api/audit' is recognized as admin route");
    assert(isPathMatching("/api/audit/verify", ADMIN_ROUTE_PATTERNS), "'/api/audit/verify' is recognized as admin route");

    // Anti-spoofing
    assert(!isPathMatching("/administrator", ADMIN_ROUTE_PATTERNS), "'/administrator' does NOT match admin '/admin'");
    assert(!isPathMatching("/api/administration", ADMIN_ROUTE_PATTERNS), "'/api/administration' does NOT match admin");
    assert(!isPathMatching("/api/auditorium", ADMIN_ROUTE_PATTERNS), "'/api/auditorium' does NOT match audit");
  }

  // SUITE 3: Protected PHI Route Enforcement
  console.log("\n[Test Suite 3] Protected PHI & Clinical Route Guardrails");
  {
    const protectedPaths = [
      "/consult",
      "/consult/ENC-100",
      "/dashboard",
      "/dashboard/settings",
      "/profile",
      "/profile/history",
      "/api/consultations",
      "/api/consultations/ENC-100",
      "/api/consultations/ENC-100/fhir",
      "/api/patient",
      "/api/patient/profile",
      "/api/patient/profile/123",
      "/api/triage",
      "/api/voice",
      "/api/voice/chat",
      "/api/voice/stt",
      "/api/voice/telemetry",
      "/api/voice/token",
      "/api/voice/tts",
      "/api/emergency",
      "/api/emergency/pre-arrival",
    ];

    for (const p of protectedPaths) {
      assert(isPathMatching(p, PROTECTED_PHI_ROUTE_PATTERNS), `Protected PHI path '${p}' is strictly matched`);
      assert(!isPathMatching(p, PUBLIC_ROUTE_PATTERNS), `Protected PHI path '${p}' is NOT public`);
    }

    // Ensure sibling non-clinical routes aren't accidentally swallowed
    assert(!isPathMatching("/consultant-sales", PROTECTED_PHI_ROUTE_PATTERNS), "'/consultant-sales' does NOT match '/consult'");
    assert(!isPathMatching("/profiler", PROTECTED_PHI_ROUTE_PATTERNS), "'/profiler' does NOT match '/profile'");
  }

  // SUITE 4: URL Normalization & Edge-Case Bypass Defense
  console.log("\n[Test Suite 4] URL Normalization & RFC 3986 Path Traversal Defense");
  {
    // 1. Consecutive slashes (e.g. //consult, /api//admin)
    assert(isPathMatching("//consult", PROTECTED_PHI_ROUTE_PATTERNS), "Double slash '//consult' collapses and matches protected PHI");
    assert(isPathMatching("///dashboard", PROTECTED_PHI_ROUTE_PATTERNS), "Triple slash '///dashboard' collapses and matches protected PHI");
    assert(isPathMatching("/api//admin//metrics", ADMIN_ROUTE_PATTERNS), "Double slash '/api//admin//metrics' collapses and matches admin");
    assert(isPathMatching("//care//facility-101", PUBLIC_ROUTE_PATTERNS), "Double slash '//care//facility-101' collapses and matches public");

    // 2. Trailing slashes
    assert(isPathMatching("/consult/", PROTECTED_PHI_ROUTE_PATTERNS), "Trailing slash '/consult/' matches protected PHI");
    assert(isPathMatching("/dashboard/", PROTECTED_PHI_ROUTE_PATTERNS), "Trailing slash '/dashboard/' matches protected PHI");
    assert(isPathMatching("/admin/", ADMIN_ROUTE_PATTERNS), "Trailing slash '/admin/' matches admin");
    assert(isPathMatching("/care/", PUBLIC_ROUTE_PATTERNS), "Trailing slash '/care/' matches public");
    assert(isPathMatching("/", PUBLIC_ROUTE_PATTERNS), "Root '/' with trailing slash matches public");

    // 3. Dot segment resolution (RFC 3986 section 5.2.4 remove_dot_segments)
    // Critical defense: an attacker cannot start at public '/care' and traverse to '/consult' or '/admin'
    assert(normalizePath("/care/../consult") === "/consult", "Dot segment '/care/../consult' resolves cleanly to '/consult'");
    assert(isPathMatching("/care/../consult", PROTECTED_PHI_ROUTE_PATTERNS), "'/care/../consult' correctly resolves to protected PHI");
    assert(!isPathMatching("/care/../consult", PUBLIC_ROUTE_PATTERNS), "'/care/../consult' is strictly PREVENTED from matching public");

    assert(normalizePath("/care/%2e%2e/consult") === "/consult", "Encoded dot segment '/care/%2e%2e/consult' resolves to '/consult'");
    assert(isPathMatching("/care/%2e%2e/consult", PROTECTED_PHI_ROUTE_PATTERNS), "'/care/%2e%2e/consult' correctly resolves to protected PHI");
    assert(!isPathMatching("/care/%2e%2e/consult", PUBLIC_ROUTE_PATTERNS), "'/care/%2e%2e/consult' is strictly PREVENTED from matching public");

    assert(normalizePath("/care/../api/admin/metrics") === "/api/admin/metrics", "Dot segment to admin resolves cleanly to '/api/admin/metrics'");
    assert(isPathMatching("/care/../api/admin/metrics", ADMIN_ROUTE_PATTERNS), "'/care/../api/admin/metrics' resolves to admin route");
    assert(!isPathMatching("/care/../api/admin/metrics", PUBLIC_ROUTE_PATTERNS), "'/care/../api/admin/metrics' is NOT public");

    assert(normalizePath("/./consult") === "/consult", "Current directory dot segment '/./consult' resolves to '/consult'");
    assert(isPathMatching("/./consult", PROTECTED_PHI_ROUTE_PATTERNS), "'/./consult' matches protected PHI");

    assert(normalizePath("/../../../consult") === "/consult", "Path traversal above root '/../../../consult' resolves safely to '/consult'");
    assert(isPathMatching("/../../../consult", PROTECTED_PHI_ROUTE_PATTERNS), "'/../../../consult' matches protected PHI");

    // 4. Backslash normalization
    assert(normalizePath("/care\\..\\consult") === "/consult", "Backslash dot segment '/care\\..\\consult' resolves to '/consult'");
    assert(isPathMatching("/care\\..\\consult", PROTECTED_PHI_ROUTE_PATTERNS), "'/care\\..\\consult' matches protected PHI");
    assert(!isPathMatching("/care\\..\\consult", PUBLIC_ROUTE_PATTERNS), "'/care\\..\\consult' does NOT match public");

    assert(normalizePath("/care%5c..%5cconsult") === "/consult", "Encoded backslash '/care%5c..%5cconsult' resolves to '/consult'");
    assert(isPathMatching("/care%5c..%5cconsult", PROTECTED_PHI_ROUTE_PATTERNS), "'/care%5c..%5cconsult' matches protected PHI");
    assert(!isPathMatching("/care%5c..%5cconsult", PUBLIC_ROUTE_PATTERNS), "'/care%5c..%5cconsult' does NOT match public");

    // 5. Case-Insensitivity Normalization (preventing bypasses via /Consult or /ADMIN)
    assert(isPathMatching("/Consult", PROTECTED_PHI_ROUTE_PATTERNS), "Uppercase '/Consult' matches protected PHI");
    assert(isPathMatching("/CONSULT/enc-100", PROTECTED_PHI_ROUTE_PATTERNS), "Uppercase '/CONSULT/enc-100' matches protected PHI");
    assert(isPathMatching("/ADMIN", ADMIN_ROUTE_PATTERNS), "Uppercase '/ADMIN' matches admin");
    assert(isPathMatching("/API/ADMIN/METRICS", ADMIN_ROUTE_PATTERNS), "Uppercase '/API/ADMIN/METRICS' matches admin");
    assert(isPathMatching("/CARE", PUBLIC_ROUTE_PATTERNS), "Uppercase '/CARE' matches public");

    // 6. URL percent-decoding for unreserved characters
    assert(isPathMatching("/%63onsult", PROTECTED_PHI_ROUTE_PATTERNS), "Percent-encoded '/%63onsult' decodes to '/consult' and matches protected PHI");

    // 7. Encoded reserved characters (%2F, %23, %3F) must NOT create unintended equivalence
    assert(!isPathMatching("/care%2Fadmin", PUBLIC_ROUTE_PATTERNS), "Encoded slash '/care%2Fadmin' is a distinct segment and does NOT match public '/care'");
    assert(!isPathMatching("/care%20admin", PUBLIC_ROUTE_PATTERNS), "Encoded space '/care%20admin' does NOT match public '/care'");
    assert(isPathMatching("/care?query=1", PUBLIC_ROUTE_PATTERNS), "Query string in raw path is safely stripped to match '/care'");
    assert(isPathMatching("/care#section", PUBLIC_ROUTE_PATTERNS), "Hash fragment in raw path is safely stripped to match '/care'");

    // 8. Malformed URL paths fail safely
    const malformed = normalizePath("/%ff/admin");
    assert(malformed === "/__malformed_url_path__", "Malformed percent-encoding falls back to unroutable safe marker");
    assert(!isPathMatching("/%ff/admin", PUBLIC_ROUTE_PATTERNS), "Malformed path is never treated as public");
    assert(!isPathMatching("/%ff/admin", ADMIN_ROUTE_PATTERNS), "Malformed path is rejected before admin classification");
  }

  // SUITE 5: Test-Only Bypass Environment Isolation & Fail-Closed Invariants
  console.log("\n[Test Suite 5] Test Bypass Fail-Closed Invariants (isTestBypassPermitted)");
  {
    const validSecret = "medvoice-test-harness-auth-token-9f8a3c2e-secure-32chars";
    const createReq = (secretHeader: string | null) => ({
      headers: {
        get: (h: string) => (h === "x-test-harness-secret" ? secretHeader : null),
      },
    });

    const envRecord = process.env as Record<string, string | undefined>;
    const originalEnv = { ...process.env };

    try {
      // 1. Missing or Weak Configured Secret MUST fail closed (NO fallback to default)
      envRecord.NODE_ENV = "test";
      delete envRecord.INTERNAL_TEST_SECRET;
      assert(!isTestBypassPermitted(createReq(validSecret)), "Missing configured INTERNAL_TEST_SECRET strictly fails closed (no default fallback)");

      envRecord.INTERNAL_TEST_SECRET = "short-secret";
      assert(!isTestBypassPermitted(createReq("short-secret")), "Weak configured INTERNAL_TEST_SECRET (<32 chars) strictly fails closed");

      envRecord.INTERNAL_TEST_SECRET = "   ";
      assert(!isTestBypassPermitted(createReq("   ")), "Whitespace configured INTERNAL_TEST_SECRET strictly fails closed");

      // Set valid configured secret for remaining tests
      envRecord.INTERNAL_TEST_SECRET = validSecret;

      // 2. Production environment MUST fail closed even with valid secret
      envRecord.NODE_ENV = "production";
      assert(!isTestBypassPermitted(createReq(validSecret)), "Production NODE_ENV strictly rejects test bypass");

      // 3. Development environment MUST fail closed
      envRecord.NODE_ENV = "development";
      assert(!isTestBypassPermitted(createReq(validSecret)), "Development NODE_ENV strictly rejects test bypass");

      // 4. Staging / Cloud / Container deployments MUST fail closed even if NODE_ENV=test
      envRecord.NODE_ENV = "test";

      // Vercel
      process.env.VERCEL_ENV = "preview";
      assert(!isTestBypassPermitted(createReq(validSecret)), "Vercel Preview environment strictly rejects test bypass");
      process.env.VERCEL_ENV = "production";
      assert(!isTestBypassPermitted(createReq(validSecret)), "Vercel Production environment strictly rejects test bypass");
      delete process.env.VERCEL_ENV;

      // AWS
      process.env.AWS_REGION = "us-east-1";
      assert(!isTestBypassPermitted(createReq(validSecret)), "AWS Region environment strictly rejects test bypass");
      delete process.env.AWS_REGION;
      process.env.AWS_EXECUTION_ENV = "AWS_Lambda_nodejs20.x";
      assert(!isTestBypassPermitted(createReq(validSecret)), "AWS Execution environment strictly rejects test bypass");
      delete process.env.AWS_EXECUTION_ENV;

      // GCP
      process.env.K_SERVICE = "medvoice-api";
      assert(!isTestBypassPermitted(createReq(validSecret)), "GCP Cloud Run environment strictly rejects test bypass");
      delete process.env.K_SERVICE;

      // Render
      process.env.RENDER = "true";
      assert(!isTestBypassPermitted(createReq(validSecret)), "Render environment strictly rejects test bypass");
      delete process.env.RENDER;

      // Fly.io
      process.env.FLY_APP_NAME = "medvoice-app";
      assert(!isTestBypassPermitted(createReq(validSecret)), "Fly.io environment strictly rejects test bypass");
      delete process.env.FLY_APP_NAME;

      // Netlify
      process.env.NETLIFY = "true";
      assert(!isTestBypassPermitted(createReq(validSecret)), "Netlify environment strictly rejects test bypass");
      delete process.env.NETLIFY;

      // Heroku & Railway
      process.env.HEROKU_APP_NAME = "medvoice-staging";
      assert(!isTestBypassPermitted(createReq(validSecret)), "Heroku environment strictly rejects test bypass");
      delete process.env.HEROKU_APP_NAME;

      process.env.RAILWAY_ENVIRONMENT = "production";
      assert(!isTestBypassPermitted(createReq(validSecret)), "Railway environment strictly rejects test bypass");
      delete process.env.RAILWAY_ENVIRONMENT;

      // Container & Kubernetes
      process.env.CONTAINER = "true";
      assert(!isTestBypassPermitted(createReq(validSecret)), "Generic container environment strictly rejects test bypass");
      delete process.env.CONTAINER;

      process.env.KUBERNETES_SERVICE_HOST = "10.0.0.1";
      assert(!isTestBypassPermitted(createReq(validSecret)), "Kubernetes pod environment strictly rejects test bypass");
      delete process.env.KUBERNETES_SERVICE_HOST;

      // Explicit deployment flag
      process.env.MEDVOICE_DEPLOYMENT_ENV = "staging";
      assert(!isTestBypassPermitted(createReq(validSecret)), "MEDVOICE_DEPLOYMENT_ENV=staging strictly rejects test bypass");
      delete process.env.MEDVOICE_DEPLOYMENT_ENV;

      // 5. Header validation invariants (missing, empty, mismatched)
      assert(!isTestBypassPermitted(createReq(null)), "Missing test secret header strictly fails closed");
      assert(!isTestBypassPermitted(createReq("")), "Empty test secret header strictly fails closed");
      assert(!isTestBypassPermitted(createReq("invalid-token-xyz")), "Mismatched test secret strictly fails closed");

      // 6. Clean local test harness with matching secret IS permitted
      assert(isTestBypassPermitted(createReq(validSecret)), "Local test runner with matching secret is permitted");
    } finally {
      process.env = originalEnv;
    }
  }

  // SUITE 6: Complete Application Route Inventory & Request-Level Classification
  console.log("\n[Test Suite 6] Request-Level Route Classification & Defense-in-Depth");
  {
    const createMockNextReq = (pathname: string) => ({
      nextUrl: { pathname },
      headers: { get: () => null },
    } as any);

    const appRouteInventory = [
      // Public Static / Landing Routes
      { path: "/", expectedCategory: "public" },
      { path: "/care", expectedCategory: "public" },
      { path: "/care/delhi", expectedCategory: "public" },
      { path: "/demo", expectedCategory: "public" },
      { path: "/privacy", expectedCategory: "public" },
      { path: "/sign-in", expectedCategory: "public" },
      { path: "/sign-up", expectedCategory: "public" },
      { path: "/api/hospitals", expectedCategory: "public" },
      { path: "/api/route", expectedCategory: "public" },

      // Administrative & Governance Routes
      { path: "/admin", expectedCategory: "admin" },
      { path: "/admin/analytics", expectedCategory: "admin" },
      { path: "/api/admin/metrics", expectedCategory: "admin" },
      { path: "/api/audit", expectedCategory: "admin" },

      // Protected PHI Clinical Routes
      { path: "/consult", expectedCategory: "phi" },
      { path: "/dashboard", expectedCategory: "phi" },
      { path: "/profile", expectedCategory: "phi" },
      { path: "/api/consultations", expectedCategory: "phi" },
      { path: "/api/consultations/ENC-1", expectedCategory: "phi" },
      { path: "/api/consultations/ENC-1/fhir", expectedCategory: "phi" },
      { path: "/api/patient/profile", expectedCategory: "phi" },
      { path: "/api/patient/profile/123", expectedCategory: "phi" },
      { path: "/api/triage", expectedCategory: "phi" },
      { path: "/api/voice/chat", expectedCategory: "phi" },
      { path: "/api/voice/stt", expectedCategory: "phi" },
      { path: "/api/voice/telemetry", expectedCategory: "phi" },
      { path: "/api/voice/token", expectedCategory: "phi" },
      { path: "/api/voice/tts", expectedCategory: "phi" },
      { path: "/api/emergency/pre-arrival", expectedCategory: "phi" },
    ];

    for (const r of appRouteInventory) {
      const mockReq = createMockNextReq(r.path);
      const isPub = isPublicRoute(mockReq);
      const isAdm = isAdminRoute(mockReq);
      const isPhi = isProtectedPhiRoute(mockReq);

      if (r.expectedCategory === "public") {
        assert(isPub && !isAdm && !isPhi, `Request '${r.path}' is uniquely classified as public`);
      } else if (r.expectedCategory === "admin") {
        assert(!isPub && isAdm && !isPhi, `Request '${r.path}' is uniquely classified as admin`);
      } else if (r.expectedCategory === "phi") {
        assert(!isPub && !isAdm && isPhi, `Request '${r.path}' is uniquely classified as protected PHI`);
      }
    }

    // Request-level adversarial route resolution
    const hostileRequests = [
      { path: "/care/../consult", expectedCategory: "phi", name: "Dot segment to /consult" },
      { path: "/care/%2e%2e/consult", expectedCategory: "phi", name: "Encoded dot segment to /consult" },
      { path: "/care/../api/admin/metrics", expectedCategory: "admin", name: "Dot segment to admin API" },
      { path: "/care\\..\\consult", expectedCategory: "phi", name: "Backslash traversal to /consult" },
      { path: "/care%5c..%5cconsult", expectedCategory: "phi", name: "Encoded backslash to /consult" },
      { path: "/CONSULT", expectedCategory: "phi", name: "Uppercase /CONSULT" },
      { path: "/ADMIN", expectedCategory: "admin", name: "Uppercase /ADMIN" },
      { path: "/CARE", expectedCategory: "public", name: "Uppercase /CARE" },
    ];

    for (const h of hostileRequests) {
      const mockReq = createMockNextReq(h.path);
      const isPub = isPublicRoute(mockReq);
      const isAdm = isAdminRoute(mockReq);
      const isPhi = isProtectedPhiRoute(mockReq);

      if (h.expectedCategory === "phi") {
        assert(!isPub && isPhi, `Hostile request '${h.name}' correctly routed to PHI protection, NOT public`);
      } else if (h.expectedCategory === "admin") {
        assert(!isPub && isAdm, `Hostile request '${h.name}' correctly routed to Admin protection, NOT public`);
      } else if (h.expectedCategory === "public") {
        assert(isPub && !isAdm && !isPhi, `Uppercase public route '${h.name}' correctly identified`);
      }
    }
  }

  console.log("\n========================================================");
  console.log("  ALL PROXY ROUTE MATCHING & INVARIANT TESTS PASSED (100%)");
  console.log("========================================================\n");
}

runProxyRoutingTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
