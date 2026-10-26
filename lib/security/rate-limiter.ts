/**
 * In-Memory Sliding Window Rate Limiter & Abuse Protection Utility
 * 
 * Protects expensive AI/voice endpoints against resource exhaustion,
 * unthrottled scraping, and denial of service (OWASP API4:2023 Unrestricted Resource Consumption).
 * 
 * Invariants:
 * 1. Tracks request frequency per client IP with automatic garbage collection of expired buckets.
 * 2. Automated test runner (NODE_ENV === 'test') receives generous quota thresholds to avoid flakes.
 * 3. Returns standard HTTP 429 Too Many Requests with informative Retry-After headers when triggered.
 */

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetMs: number;
  retryAfterSec: number;
}

interface WindowBucket {
  timestamps: number[];
  lastCleanup: number;
}

const rateLimitStore = new Map<string, WindowBucket>();
let lastGlobalCleanup = Date.now();

// Clean up expired IP buckets every 5 minutes to prevent memory growth
function cleanupStaleBuckets(windowMs: number) {
  const now = Date.now();
  if (now - lastGlobalCleanup < 300000) return;
  lastGlobalCleanup = now;

  const threshold = now - windowMs;
  for (const [key, bucket] of rateLimitStore.entries()) {
    bucket.timestamps = bucket.timestamps.filter(t => t > threshold);
    if (bucket.timestamps.length === 0) {
      rateLimitStore.delete(key);
    }
  }
}

import { resolveTrustedClientIp } from "./rate-limit-policy";

export {
  RATE_LIMIT_POLICIES,
  resolveTrustedClientIp,
  deriveRateLimitKey,
} from "./rate-limit-policy";
export type {
  RouteRateLimitPolicy,
} from "./rate-limit-policy";

export {
  MemoryRateLimitStore,
  UpstashRedisRateLimitStore,
  RateLimitStoreError,
  evaluateRateLimit,
  buildRateLimit429Response,
  getActiveRateLimitStore,
  setRateLimitStoreForTesting,
} from "./distributed-rate-limiter";
export type {
  DistributedRateLimitStore,
  RateLimitStatus,
} from "./distributed-rate-limiter";

/**
 * Extract client IP address from standard proxy/CDN headers with spoofing protections.
 */
export function getClientIp(request: Request): string {
  return resolveTrustedClientIp(request);
}

/**
 * Check rate limit for a given key (e.g. IP + endpoint)
 */
export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number = 60000,
  forceExactLimit: boolean = false
): RateLimitResult {
  const isTest = process.env.NODE_ENV === "test";
  // In automated test harness, grant high threshold unless test explicitly requests exact limit
  const effectiveMax = (isTest && !forceExactLimit) ? Math.max(maxRequests, 500) : maxRequests;

  const now = Date.now();
  cleanupStaleBuckets(windowMs);

  let bucket = rateLimitStore.get(key);
  if (!bucket) {
    bucket = { timestamps: [], lastCleanup: now };
    rateLimitStore.set(key, bucket);
  }

  const windowStart = now - windowMs;
  bucket.timestamps = bucket.timestamps.filter(t => t > windowStart);

  if (bucket.timestamps.length >= effectiveMax) {
    const oldest = bucket.timestamps[0];
    const resetMs = Math.max(0, oldest + windowMs - now);
    const retryAfterSec = Math.ceil(resetMs / 1000);
    return {
      allowed: false,
      limit: effectiveMax,
      remaining: 0,
      resetMs,
      retryAfterSec: Math.max(1, retryAfterSec),
    };
  }

  bucket.timestamps.push(now);
  const remaining = effectiveMax - bucket.timestamps.length;
  return {
    allowed: true,
    limit: effectiveMax,
    remaining,
    resetMs: windowMs,
    retryAfterSec: 0,
  };
}

/**
 * Reset rate limit store (useful for tests)
 */
export function resetRateLimitStore() {
  rateLimitStore.clear();
}

/**
 * Resource Consumption Caps & Thresholds
 */
export const RESOURCE_LIMITS = {
  // Max patient utterance message string length on /api/voice/chat
  VOICE_CHAT_MAX_MESSAGE_CHARS: 1000,
  // Max conversation history items sent on /api/voice/chat
  VOICE_CHAT_MAX_HISTORY_ITEMS: 30,
  // Max text string length for TTS neural synthesis on /api/voice/tts
  VOICE_TTS_MAX_TEXT_CHARS: 1000,
  // Max audio upload payload in bytes for STT Whisper ASR (10 MB)
  VOICE_STT_MAX_AUDIO_BYTES: 10 * 1024 * 1024,
  // Rate limits (requests per minute)
  VOICE_CHAT_RATE_LIMIT_PER_MINUTE: 30,
  VOICE_TTS_RATE_LIMIT_PER_MINUTE: 45,
  VOICE_STT_RATE_LIMIT_PER_MINUTE: 30,
} as const;

/**
 * Standard HTTP 429 response builder with RFC-compliant headers
 */
export function buildRateLimitResponse(result: RateLimitResult, endpointName: string): Response {
  return new Response(
    JSON.stringify({
      success: false,
      error: `Too Many Requests: Rate limit exceeded for ${endpointName}. Please wait ${result.retryAfterSec}s before sending new requests.`,
      code: "RATE_LIMIT_EXCEEDED",
      limit: result.limit,
      retryAfterSec: result.retryAfterSec,
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": result.retryAfterSec.toString(),
        "X-RateLimit-Limit": result.limit.toString(),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": Math.ceil((Date.now() + result.resetMs) / 1000).toString(),
      },
    }
  );
}
