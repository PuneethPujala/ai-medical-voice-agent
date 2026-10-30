import { clerkMiddleware } from '@clerk/nextjs/server';
import { NextResponse, type NextRequest } from 'next/server';

const INTERNAL_TEST_SECRET_HEADER = 'x-test-harness-secret';

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

export function normalizePath(pathname: string): string {
  if (!pathname || typeof pathname !== 'string') {
    return '/';
  }
  // 1. Strip raw query string and hash fragment if present in raw path string
  pathname = pathname.split('?')[0].split('#')[0];

  // 2. Normalize backslashes to forward slashes before decoding/splitting
  pathname = pathname.replace(/\\+/g, '/');

  // 3. Decode unreserved characters, encoded dots (%2e / %2E), and convert %5c to /
  try {
    pathname = pathname.replace(/%5c/gi, '/');
    pathname = decodeURI(pathname);
  } catch {
    // Malformed encoding in path fails safe to unroutable marker
    return '/__malformed_url_path__';
  }

  // 4. Resolve dot segments (RFC 3986 section 5.2.4 "remove_dot_segments")
  const rawSegments = pathname.split('/');
  const resolvedSegments: string[] = [];

  for (const seg of rawSegments) {
    if (seg === '' || seg === '.') {
      continue;
    }
    if (seg === '..') {
      // Pop previous segment; cannot escape root '/'
      if (resolvedSegments.length > 0) {
        resolvedSegments.pop();
      }
      continue;
    }
    resolvedSegments.push(seg);
  }

  let normalized = '/' + resolvedSegments.join('/');

  // 5. Lowercase for consistent route matching
  normalized = normalized.toLowerCase();

  return normalized;
}

export function isPathMatching(pathname: string, patterns: string[]): boolean {
  const normalized = normalizePath(pathname);
  if (normalized === '/__malformed_url_path__') {
    return false; // Malformed paths never match valid patterns
  }
  return patterns.some((pattern) => {
    const normalizedPattern = normalizePath(pattern);
    if (normalizedPattern === '/') {
      return normalized === '/';
    }
    return normalized === normalizedPattern || normalized.startsWith(`${normalizedPattern}/`);
  });
}

export const isPublicRoute = (req: NextRequest) => isPathMatching(req.nextUrl.pathname, PUBLIC_ROUTE_PATTERNS);
export const isAdminRoute = (req: NextRequest) => isPathMatching(req.nextUrl.pathname, ADMIN_ROUTE_PATTERNS);
export const isProtectedPhiRoute = (req: NextRequest) => isPathMatching(req.nextUrl.pathname, PROTECTED_PHI_ROUTE_PATTERNS);

export function isTestBypassPermitted(req: { headers: { get: (name: string) => string | null } }): boolean {
  // Fail-closed invariant 1: NODE_ENV must strictly equal "test"
  if (process.env.NODE_ENV !== 'test') {
    return false;
  }
  // Fail-closed invariant 2: Real cloud or hosted deployments must NEVER allow test bypass
  if (
    process.env.VERCEL ||
    process.env.VERCEL_ENV ||
    process.env.AWS_EXECUTION_ENV ||
    process.env.AWS_REGION ||
    process.env.K_SERVICE ||
    process.env.RENDER ||
    process.env.FLY_APP_NAME ||
    process.env.NETLIFY ||
    process.env.HEROKU_APP_NAME ||
    process.env.RAILWAY_ENVIRONMENT ||
    process.env.CONTAINER ||
    process.env.KUBERNETES_SERVICE_HOST ||
    process.env.MEDVOICE_DEPLOYMENT_ENV
  ) {
    return false;
  }
  // Fail-closed invariant 3: Explicit configured INTERNAL_TEST_SECRET must be present and strong (>= 32 chars)
  // Missing or weak secret strictly fails closed - NO default fallback permitted.
  const configuredSecret = process.env.INTERNAL_TEST_SECRET;
  if (!configuredSecret || typeof configuredSecret !== 'string' || configuredSecret.trim().length < 32) {
    return false;
  }
  // Fail-closed invariant 4: Header secret must match configured secret
  const providedTestSecret = req.headers.get(INTERNAL_TEST_SECRET_HEADER);
  if (!providedTestSecret) {
    return false;
  }
  return providedTestSecret === configuredSecret;
}

export default clerkMiddleware(async (auth, req) => {
  const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID();
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-request-id', requestId);

  // Early Malformed URL Ingress Check: Fail closed immediately
  if (normalizePath(req.nextUrl.pathname) === '/__malformed_url_path__') {
    return NextResponse.json(
      { error: 'Bad Request: Malformed URI encoding in request path', requestId },
      { status: 400, headers: { 'x-request-id': requestId } }
    );
  }

  // 0. Test Runner / Automated Integration Bypass (Disabled by default in production & cloud deployments)
  if (isTestBypassPermitted(req)) {
    const res = NextResponse.next();
    res.headers.set('x-request-id', requestId);
    return res;
  }

  if (isPublicRoute(req)) {
    const res = NextResponse.next();
    res.headers.set('x-request-id', requestId);
    return res;
  }

  // Block internal dev routes in production
  if (process.env.NODE_ENV === 'production' && normalizePath(req.nextUrl.pathname).startsWith('/dev')) {
    return NextResponse.json(
      { error: 'Not Found', requestId },
      { status: 404, headers: { 'x-request-id': requestId } }
    );
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
  const response = NextResponse.next();
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
