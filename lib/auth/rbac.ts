import { currentUser } from "@clerk/nextjs/server";
import { logAuditEventAsync, AuditActorRole } from "../audit/audit-logger";

export type Role = "patient" | "clinician" | "admin";

export type Permission =
  | "consultations:create"
  | "consultations:read:own"
  | "consultations:approve"
  | "emergency:dispatch"
  | "health:export:own"
  | "analytics:read"
  | "system:read"
  | "audit:read"
  | "audit:verify";

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  patient: [
    "consultations:create",
    "consultations:read:own",
    "emergency:dispatch",
    "health:export:own",
  ],
  clinician: [
    "consultations:read:own",
    "consultations:approve",
    "emergency:dispatch",
    "health:export:own",
    "analytics:read",
  ],
  admin: [
    "consultations:approve",
    "analytics:read",
    "system:read",
    "audit:read",
    "audit:verify",
  ],
};

export interface AuthContext {
  userId: string;
  role: Role;
  name: string;
  email: string;
  isDemoMode: boolean;
}

/**
 * Checks whether a role possesses a specific permission.
 */
export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

/**
 * Resolve the authoritative authenticated context from the request.
 * Security Invariants:
 * 1. Authenticated Clerk session is the single source of truth for identity and role.
 * 2. Role is strictly extracted from server-side Clerk metadata (publicMetadata.role).
 * 3. A client can NEVER grant itself admin privileges via headers, query params, body, or cookies.
 * 4. An authenticated admin may voluntarily down-scope to patient view ('x-simulate-patient-view')
 *    for testing least-privilege UI behavior. A patient can NEVER elevate.
 * 5. Mock role headers are strictly constrained to automated test suites (NODE_ENV === 'test').
 */
export const INTERNAL_TEST_SECRET_HEADER = "x-test-harness-secret";

/**
 * Test fixture constant for test runners.
 * Runtime authorization functions (getAuthContext, proxy) NEVER fall back to this constant.
 * Missing or weak process.env.INTERNAL_TEST_SECRET (< 32 chars) strictly fails closed.
 */
export const DEFAULT_INTERNAL_TEST_SECRET = "medvoice-test-harness-auth-token-9f8a3c2e-secure-32ch";

export async function getAuthContext(request?: Request): Promise<AuthContext> {
  // 1. Authoritative Clerk session resolution
  try {
    const user = await currentUser();
    if (user) {
      const userRole = (user.publicMetadata?.role as Role) || "patient";
      const verifiedRole: Role = ["patient", "clinician", "admin"].includes(userRole) ? userRole : "patient";

      // Privilege attenuation: allow verified admin to down-scope to patient for safety inspection
      const simulatePatient = request?.headers.get("x-simulate-patient-view") === "true";
      const effectiveRole: Role = verifiedRole === "admin" && simulatePatient ? "patient" : verifiedRole;

      return {
        userId: user.id,
        role: effectiveRole,
        name: user.fullName || user.firstName || user.username || "Authenticated User",
        email: user.primaryEmailAddress?.emailAddress || "",
        isDemoMode: false,
      };
    }
  } catch {
    // Clerk session absent or unconfigured
  }

  // 2. Automated test runner harness ONLY (active when running unit/integration test processes)
  // Security Invariants:
  // - NODE_ENV must strictly equal "test" (never active in production or development)
  // - process.env.INTERNAL_TEST_SECRET must be explicitly configured and strong (>= 32 chars).
  //   Missing or weak secret strictly FAILS CLOSED with NO fallback.
  // - Request must include an authoritative internal test secret (x-test-harness-secret)
  //   matching process.env.INTERNAL_TEST_SECRET.
  const isTestHarness = process.env.NODE_ENV === "test";
  const configuredSecret = process.env.INTERNAL_TEST_SECRET;
  const isSecretValid = typeof configuredSecret === "string" && configuredSecret.trim().length >= 32;
  const providedSecret = request?.headers.get(INTERNAL_TEST_SECRET_HEADER);
  const testRoleHeader = request?.headers.get("x-mock-role") as Role | null;
  const testUserHeader = request?.headers.get("x-mock-user-id");

  if (
    isTestHarness &&
    isSecretValid &&
    providedSecret === configuredSecret &&
    testRoleHeader &&
    ["patient", "clinician", "admin"].includes(testRoleHeader)
  ) {
    const simulatePatient = request?.headers.get("x-simulate-patient-view") === "true";
    const effectiveRole: Role = testRoleHeader === "admin" && simulatePatient ? "patient" : testRoleHeader;

    return {
      userId: testUserHeader || `test-${testRoleHeader}-01`,
      role: effectiveRole,
      name: `Test ${testRoleHeader.toUpperCase()}`,
      email: `${testRoleHeader}@test.internal`,
      isDemoMode: true,
    };
  }

  // 3. Unauthenticated guest (anonymous web visitor)
  return {
    userId: "unauthenticated",
    role: "patient",
    name: "Unauthenticated Guest",
    email: "",
    isDemoMode: false,
  };
}

/**
 * Enforce RBAC permission for a request.
 * If unauthorized, durably logs an ACCESS_DENIED audit event and returns an appropriate 401 or 403 response.
 */
export async function authorizeRequest(
  request: Request,
  requiredPermission: Permission,
  resourceId: string = "system"
): Promise<{ authorized: true; auth: AuthContext } | { authorized: false; errorResponse: Response; auth: AuthContext }> {
  const auth = await getAuthContext(request);

  if (!hasPermission(auth.role, requiredPermission)) {
    await logAuditEventAsync({
      actorId: auth.userId,
      actorRole: auth.role as AuditActorRole,
      action: "ACCESS_DENIED",
      resourceType: "auth",
      resourceId,
      status: "DENIED",
      metadata: {
        requiredPermission,
        userRole: auth.role,
        isUnauthenticated: auth.userId === "unauthenticated",
      },
    });

    const isUnauthenticated = auth.userId === "unauthenticated";
    const statusCode = isUnauthenticated ? 401 : 403;
    const errorMessage = isUnauthenticated
      ? "Unauthorized: Authentication required to access this clinical administration resource."
      : "Forbidden: Insufficient privileges. Administrator role required.";

    const errorResponse = new Response(
      JSON.stringify({
        success: false,
        error: errorMessage,
        code: isUnauthenticated ? "UNAUTHORIZED" : "FORBIDDEN",
        requiredPermission,
        currentRole: auth.role,
      }),
      {
        status: statusCode,
        headers: { "Content-Type": "application/json" },
      }
    );

    return { authorized: false, errorResponse, auth };
  }

  return { authorized: true, auth };
}

