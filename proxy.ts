import { clerkMiddleware } from '@clerk/nextjs/server';
import { NextResponse, type NextRequest } from 'next/server';

const INTERNAL_TEST_SECRET_HEADER = 'x-test-harness-secret';
const DEFAULT_INTERNAL_TEST_SECRET = 'medvoice-test-harness-auth-token-9f8a3c2e';

export const PUBLIC_ROUTE_PATTERNS = [
  '/',
  '/care',
  '/demo',
  '/privacy',
  '/sign-in',
  '/sign-up',
  '/api/hospitals',
  '/api/route',
];

export const ADMIN_ROUTE_PATTERNS = [
  '/admin',
  '/api/admin',
  '/api/audit',
];

export const PROTECTED_PHI_ROUTE_PATTERNS = [
  '/consult',
  '/dashboard',
  '/profile',
  '/api/consultations',
  '/api/patient',
  '/api/triage',
  '/api/voice',
  '/api/emergency',
];

export function isPathMatching(pathname: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    if (pattern === '/') {
      return pathname === '/';
    }
    return pathname === pattern || pathname.startsWith(`${pattern}/`);
  });
}

export const isPublicRoute = (req: NextRequest) => isPathMatching(req.nextUrl.pathname, PUBLIC_ROUTE_PATTERNS);
export const isAdminRoute = (req: NextRequest) => isPathMatching(req.nextUrl.pathname, ADMIN_ROUTE_PATTERNS);
export const isProtectedPhiRoute = (req: NextRequest) => isPathMatching(req.nextUrl.pathname, PROTECTED_PHI_ROUTE_PATTERNS);

export default clerkMiddleware(async (auth, req) => {
  const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID();
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-request-id', requestId);

  // 0. Test Runner / Automated Integration Bypass
  const isTestEnv = process.env.NODE_ENV === 'test';
  const providedTestSecret = req.headers.get(INTERNAL_TEST_SECRET_HEADER);
  const expectedTestSecret = process.env.INTERNAL_TEST_SECRET || DEFAULT_INTERNAL_TEST_SECRET;
  if (isTestEnv && providedTestSecret === expectedTestSecret) {
    const res = NextResponse.next({ request: { headers: requestHeaders } });
    res.headers.set('x-request-id', requestId);
    return res;
  }

  if (isPublicRoute(req)) {
    const res = NextResponse.next({ request: { headers: requestHeaders } });
    res.headers.set('x-request-id', requestId);
    return res;
  }

  const session = await auth();

  // 1. Enforce Authentication on all PHI & Admin routes
  if (!session.userId && (isProtectedPhiRoute(req) || isAdminRoute(req))) {
    if (req.nextUrl.pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: 'Unauthorized: Valid clinical session required', requestId },
        { status: 401, headers: { 'x-request-id': requestId } }
      );
    }
    return session.redirectToSignIn({ returnBackUrl: req.url });
  }

  // 2. Enforce Strict RBAC on Admin & Audit Endpoints
  if (isAdminRoute(req)) {
    const role = (session.sessionClaims?.metadata as { role?: string })?.role;
    if (role !== 'admin' && role !== 'clinician_auditor') {
      if (req.nextUrl.pathname.startsWith('/api/')) {
        return NextResponse.json(
          { error: 'Forbidden: Insufficient RBAC privileges', requestId },
          { status: 403, headers: { 'x-request-id': requestId } }
        );
      }
      return NextResponse.redirect(new URL('/dashboard', req.url));
    }
  }

  // 3. Inject HIPAA Security & No-Store Cache Headers for PHI API responses
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('x-request-id', requestId);
  if (req.nextUrl.pathname.startsWith('/api/')) {
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    response.headers.set('Pragma', 'no-cache');
    response.headers.set('X-Content-Type-Options', 'nosniff');
  }

  return response;
});

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
