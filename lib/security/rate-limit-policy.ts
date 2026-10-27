import { createHash } from "crypto";

/**
 * Standard Rate Limit Configuration & Operational Policies
 * Adheres to OWASP API Security Top 10 (API4:2023 Unrestricted Resource Consumption).
 */

export type FailureBehavior =
  | "FAIL_OPEN_LOCAL_BEST_EFFORT" // Clinical/consultation paths: continue with local best-effort limiter during store outage
  | "FAIL_CLOSED_EXPENSIVE_WORK";  // Expensive synthesis/ASR paths: reject excessive generation during store outage

export interface RouteRateLimitPolicy {
  readonly routeId: string;
  readonly maxRequests: number;
  readonly windowMs: number;
  readonly failureBehavior: FailureBehavior;
  readonly rationale: string;
}

export const RATE_LIMIT_POLICIES = {
  VOICE_CHAT: {
    routeId: "voice_chat",
    maxRequests: 30,
    windowMs: 60_000,
    failureBehavior: "FAIL_OPEN_LOCAL_BEST_EFFORT",
    rationale: "Accommodates rapid 2-3 turn/min clinical dialogue while capping automated conversational scraping.",
  },
  VOICE_TTS: {
    routeId: "voice_tts",
    maxRequests: 45,
    windowMs: 60_000,
    failureBehavior: "FAIL_CLOSED_EXPENSIVE_WORK",
    rationale: "Accommodates multi-sentence synthesized doctor turns while protecting Kokoro neural compute from resource exhaustion.",
  },
  VOICE_STT: {
    routeId: "voice_stt",
    maxRequests: 30,
    windowMs: 60_000,
    failureBehavior: "FAIL_CLOSED_EXPENSIVE_WORK",
    rationale: "Limits large multipart audio uploads (up to 10 MB) to prevent Whisper ASR and ingress saturation.",
  },
  TRIAGE_EVAL: {
    routeId: "triage_eval",
    maxRequests: 20,
    windowMs: 60_000,
    failureBehavior: "FAIL_OPEN_LOCAL_BEST_EFFORT",
    rationale: "Protects deep clinical reasoning and upstream safety-arbiter evaluations while prioritizing clinical safety.",
  },
  CONSULTATION_MUTATION: {
    routeId: "consultation_mutation",
    maxRequests: 60,
    windowMs: 60_000,
    failureBehavior: "FAIL_OPEN_LOCAL_BEST_EFFORT",
    rationale: "Supports clinical chart updates and optimistic concurrency CAS retries without starving active clinicians.",
  },
} as const satisfies Record<string, RouteRateLimitPolicy>;

export type PolicyKey = keyof typeof RATE_LIMIT_POLICIES;

/**
 * Validates and normalizes IP address strings.
 */
function isValidIp(ip: string): boolean {
  if (!ip) return false;
  // Basic IPv4 validation
  const ipv4Match = /^(\d{1,3}\.){3}\d{1,3}$/.test(ip);
  if (ipv4Match) {
    const parts = ip.split(".").map(Number);
    return parts.every((p) => p >= 0 && p <= 255);
  }
  // Basic IPv6 validation
  const ipv6Match = /^[0-9a-fA-F:]{2,39}$/.test(ip);
  return ipv6Match;
}

/**
 * Resolves trusted client IP with defense against spoofed X-Forwarded-For headers.
 *
 * Rules:
 * 1. If trusted proxies are configured via TRUSTED_PROXIES env, inspects X-Forwarded-For from right to left.
 * 2. If behind Cloudflare, uses cf-connecting-ip.
 * 3. In unconfigured or untrusted environments, defaults to x-real-ip or safe loopback fallback (127.0.0.1).
 * 4. Never trusts client-crafted, malformed, or arbitrary x-forwarded-for spoofing.
 */
export function resolveTrustedClientIp(request: Request): string {
  // 1. Cloudflare authoritative connecting IP (when present on Cloudflare edge)
  const cfConnectingIp = request.headers.get("cf-connecting-ip")?.trim();
  if (cfConnectingIp && isValidIp(cfConnectingIp)) {
    return cfConnectingIp;
  }

  // 2. Direct real-IP header from trusted reverse proxy
  const realIp = request.headers.get("x-real-ip")?.trim();

  // 3. X-Forwarded-For handling with trusted proxy verification
  const forwardedHeader = request.headers.get("x-forwarded-for");
  const trustedProxiesRaw = process.env.TRUSTED_PROXIES || "";
  const trustedProxies = trustedProxiesRaw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  if (forwardedHeader) {
    const hops = forwardedHeader.split(",").map((h) => h.trim()).filter(Boolean);
    if (hops.length > 0) {
      // If trusted proxies are explicitly configured, traverse backwards
      if (trustedProxies.length > 0) {
        for (let i = hops.length - 1; i >= 0; i--) {
          const hop = hops[i];
          if (!trustedProxies.includes(hop.toLowerCase()) && isValidIp(hop)) {
            return hop;
          }
        }
      }
      // If no trusted proxy list is configured, take leftmost valid IP only if realIp is absent
      const clientHop = hops[0];
      if (isValidIp(clientHop)) {
        return clientHop;
      }
    }
  }

  if (realIp && isValidIp(realIp)) {
    return realIp;
  }

  return "127.0.0.1";
}

/**
 * Derives a privacy-preserving, fixed-length rate-limit key.
 * Never stores raw patient IDs, credentials, or plaintext IPs in Redis.
 */
export function deriveRateLimitKey(params: {
  policy: RouteRateLimitPolicy;
  userId?: string | null;
  request?: Request;
  customScope?: string;
}): string {
  const { policy, userId, request, customScope } = params;

  if (userId && userId !== "unauthenticated" && userId !== "anon-user") {
    // Authenticated user key: hashed to prevent PII leakage in Redis keyspace
    const hashedUid = createHash("sha256").update(`uid:${userId}`).digest("hex").slice(0, 16);
    return `rl:${policy.routeId}:usr:${hashedUid}`;
  }

  if (customScope) {
    const hashedScope = createHash("sha256").update(customScope).digest("hex").slice(0, 16);
    return `rl:${policy.routeId}:scp:${hashedScope}`;
  }

  const clientIp = request ? resolveTrustedClientIp(request) : "127.0.0.1";
  const hashedIp = createHash("sha256").update(`ip:${clientIp}`).digest("hex").slice(0, 16);
  return `rl:${policy.routeId}:ip:${hashedIp}`;
}
