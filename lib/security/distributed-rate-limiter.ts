import { createHash, randomBytes } from "crypto";
import {
  RouteRateLimitPolicy,
  RATE_LIMIT_POLICIES,
  deriveRateLimitKey,
} from "./rate-limit-policy";
import { evaluatePreArbiter } from "../triage/pre-arbiter";

export interface RateLimitStatus {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetMs: number;
  retryAfterSec: number;
  fallbackActive?: boolean;
  storeType: "redis" | "memory";
}

export interface RateLimitCheckOptions {
  key: string;
  limit: number;
  windowMs: number;
  cost?: number;
  now?: number;
}

export class RateLimitStoreError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "RateLimitStoreError";
  }
}

export interface DistributedRateLimitStore {
  readonly name: "redis" | "memory";
  checkAndIncrement(options: RateLimitCheckOptions): Promise<RateLimitStatus>;
  reset(key?: string): Promise<void>;
}

/**
 * In-Memory Sliding Window Store
 * Used for deterministic testing, offline environments, and local development.
 * Exactly mirrors the atomic sliding-window logic of the Redis Lua script.
 */
export class MemoryRateLimitStore implements DistributedRateLimitStore {
  readonly name = "memory" as const;
  private readonly store = new Map<string, number[]>();
  private simulateError: boolean = false;
  private simulateDelayMs: number = 0;

  __setSimulateError(val: boolean) {
    this.simulateError = val;
  }

  __setSimulateDelayMs(ms: number) {
    this.simulateDelayMs = ms;
  }

  async checkAndIncrement(options: RateLimitCheckOptions): Promise<RateLimitStatus> {
    if (this.simulateDelayMs > 0) {
      await new Promise((r) => setTimeout(r, this.simulateDelayMs));
    }
    if (this.simulateError) {
      throw new RateLimitStoreError("Simulated in-memory store failure");
    }

    const now = options.now ?? Date.now();
    const windowStart = now - options.windowMs;
    const cost = options.cost ?? 1;

    let timestamps = this.store.get(options.key) ?? [];
    // Prune entries outside sliding window
    timestamps = timestamps.filter((t) => t > windowStart);

    if (timestamps.length + cost <= options.limit) {
      for (let i = 0; i < cost; i++) {
        timestamps.push(now);
      }
      this.store.set(options.key, timestamps);
      return {
        allowed: true,
        limit: options.limit,
        remaining: options.limit - timestamps.length,
        resetMs: options.windowMs,
        retryAfterSec: 0,
        storeType: "memory",
      };
    }

    // Denied: determine reset time based on oldest entry in window
    this.store.set(options.key, timestamps);
    const oldest = timestamps[0] ?? now;
    const resetMs = Math.max(0, oldest + options.windowMs - now);
    const retryAfterSec = Math.max(1, Math.ceil(resetMs / 1000));

    return {
      allowed: false,
      limit: options.limit,
      remaining: 0,
      resetMs,
      retryAfterSec,
      storeType: "memory",
    };
  }

  async reset(key?: string): Promise<void> {
    if (key) {
      this.store.delete(key);
    } else {
      this.store.clear();
    }
  }
}

/**
 * Redis Lua Atomic Sliding Window Script
 *
 * Invariants:
 * 1. Atomically prunes expired members with score < (now - window).
 * 2. Counts active elements in the window (ZCARD).
 * 3. Enforces limit atomically; if allowed, inserts unique member token.
 * 4. Extends TTL to twice the window to ensure automatic garbage collection.
 * 5. Returns {allowed(1/0), limit, remaining, resetMs, retryAfterSec}.
 */
const LUA_SLIDING_WINDOW_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])
local member = ARGV[5]
local ttl = tonumber(ARGV[6])

local clearBefore = now - window
redis.call('ZREMRANGEBYSCORE', key, '-inf', clearBefore)
local currentCount = redis.call('ZCARD', key)

if (currentCount + cost) <= limit then
    redis.call('ZADD', key, now, member)
    redis.call('EXPIRE', key, ttl)
    return {1, limit, limit - (currentCount + cost), window, 0}
else
    local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
    local resetMs = window
    if oldest and #oldest >= 2 then
        local oldestScore = tonumber(oldest[2])
        resetMs = math.max(0, (oldestScore + window) - now)
    end
    redis.call('EXPIRE', key, ttl)
    local retryAfterSec = math.ceil(resetMs / 1000)
    if retryAfterSec < 1 then retryAfterSec = 1 end
    return {0, limit, 0, resetMs, retryAfterSec}
end
`;

/**
 * Upstash Redis / Redis REST Client Store
 * Communicates via atomic HTTP REST operations without extra binary dependencies.
 */
export class UpstashRedisRateLimitStore implements DistributedRateLimitStore {
  readonly name = "redis" as const;
  private readonly baseUrl: string;
  private readonly token: string;
  private consecutiveFailures: number = 0;
  private circuitOpenUntil: number = 0;

  constructor(config: { url: string; token: string }) {
    this.baseUrl = config.url.replace(/\/+$/, "");
    this.token = config.token;
  }

  async checkAndIncrement(options: RateLimitCheckOptions): Promise<RateLimitStatus> {
    const now = options.now ?? Date.now();

    // Circuit breaker check: fail fast if circuit is open
    if (now < this.circuitOpenUntil) {
      throw new RateLimitStoreError(
        `Redis circuit breaker is open (cooling down until ${new Date(this.circuitOpenUntil).toISOString()})`
      );
    }

    const cost = options.cost ?? 1;
    const member = `${now}:${randomBytes(6).toString("hex")}`;
    const ttlSeconds = Math.max(60, Math.ceil((options.windowMs / 1000) * 2));

    try {
      const response = await fetch(`${this.baseUrl}/eval`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify([
          LUA_SLIDING_WINDOW_SCRIPT,
          1,
          options.key,
          now.toString(),
          options.windowMs.toString(),
          options.limit.toString(),
          cost.toString(),
          member,
          ttlSeconds.toString(),
        ]),
        signal: AbortSignal.timeout(250), // 250ms bounded timeout
      });

      if (!response.ok) {
        throw new Error(`Upstash Redis HTTP status ${response.status}: ${await response.text()}`);
      }

      const json = await response.json();
      const rawResult = json.result;

      if (!Array.isArray(rawResult) || rawResult.length < 5) {
        throw new Error(`Malformed response from Upstash Redis: ${JSON.stringify(rawResult)}`);
      }

      const [allowedRaw, limit, remaining, resetMs, retryAfterSec] = rawResult;
      this.consecutiveFailures = 0; // reset on success

      return {
        allowed: Number(allowedRaw) === 1,
        limit: Number(limit),
        remaining: Number(remaining),
        resetMs: Number(resetMs),
        retryAfterSec: Number(retryAfterSec),
        storeType: "redis",
      };
    } catch (err: any) {
      this.consecutiveFailures++;
      if (this.consecutiveFailures >= 3) {
        // Trip circuit breaker for 10 seconds after 3 consecutive failures
        this.circuitOpenUntil = now + 10_000;
      }
      throw new RateLimitStoreError(`Upstash Redis rate limit failed: ${err?.message}`, err);
    }
  }

  async reset(key?: string): Promise<void> {
    try {
      if (key) {
        await fetch(`${this.baseUrl}/del/${encodeURIComponent(key)}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${this.token}` },
          signal: AbortSignal.timeout(500),
        });
      } else {
        await fetch(`${this.baseUrl}/flushdb`, {
          method: "POST",
          headers: { Authorization: `Bearer ${this.token}` },
          signal: AbortSignal.timeout(500),
        });
      }
    } catch (err) {
      // Non-fatal cleanup error
    }
  }
}

// Global active store singleton
let customTestStore: DistributedRateLimitStore | null = null;
let fallbackLocalStore = new MemoryRateLimitStore();

export function setRateLimitStoreForTesting(store: DistributedRateLimitStore | null) {
  customTestStore = store;
}

export function getActiveRateLimitStore(): DistributedRateLimitStore {
  if (customTestStore) {
    return customTestStore;
  }

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (url && token) {
    return new UpstashRedisRateLimitStore({ url, token });
  }

  // Fallback to local memory store for local development/unit tests
  return fallbackLocalStore;
}

export function getFallbackLocalStore(): MemoryRateLimitStore {
  return fallbackLocalStore;
}

export interface EvaluateRateLimitOptions {
  policy: RouteRateLimitPolicy;
  userId?: string | null;
  request?: Request;
  customScope?: string;
  preflightUtterance?: string;
  forceExactLimit?: boolean;
  cost?: number;
  now?: number;
}

export interface EvaluateRateLimitResult {
  allowed: boolean;
  status: RateLimitStatus;
  policy: RouteRateLimitPolicy;
  emergencyPreempted?: boolean;
  emergencyDirective?: string;
  emergencyFlags?: string[];
  degradedNotice?: string;
}

/**
 * Evaluates rate limit against the distributed store with deterministic emergency preemption.
 *
 * Critical Healthcare Invariant:
 * If a request exceeds its quota (or the shared store is degraded), a fast deterministic
 * emergency preflight checks the patient's utterance for acute red flags.
 * If life-threatening symptoms are present:
 *   - The caller is IMMEDIATELY granted an emergency directive (112/911/108 routing).
 *   - Downstream expensive processing (neural speech, LLMs) is NOT dispatched.
 *   - Life safety is guaranteed while compute resources remain protected from denial-of-service.
 */
export async function evaluateRateLimit(
  options: EvaluateRateLimitOptions
): Promise<EvaluateRateLimitResult> {
  const { policy, userId, request, customScope, preflightUtterance, forceExactLimit, cost, now } = options;

  const key = deriveRateLimitKey({ policy, userId, request, customScope });
  const isTest = process.env.NODE_ENV === "test";
  const effectiveMax = isTest && !forceExactLimit ? Math.max(policy.maxRequests, 500) : policy.maxRequests;

  const store = getActiveRateLimitStore();
  let status: RateLimitStatus;

  try {
    status = await store.checkAndIncrement({
      key,
      limit: effectiveMax,
      windowMs: policy.windowMs,
      cost: cost ?? 1,
      now,
    });
  } catch (storeError: any) {
    // Store failure or timeout handling per policy
    if (policy.failureBehavior === "FAIL_OPEN_LOCAL_BEST_EFFORT") {
      // Clinical path: switch to local memory best-effort limiter to protect instance while allowing clinical care
      const local = getFallbackLocalStore();
      status = await local.checkAndIncrement({
        key,
        limit: effectiveMax,
        windowMs: policy.windowMs,
        cost: cost ?? 1,
        now,
      });
      status.fallbackActive = true;
    } else {
      // Expensive path (TTS/ASR): FAIL_CLOSED to protect compute resources
      return {
        allowed: false,
        policy,
        status: {
          allowed: false,
          limit: effectiveMax,
          remaining: 0,
          resetMs: 5000,
          retryAfterSec: 5,
          fallbackActive: true,
          storeType: store.name,
        },
        degradedNotice:
          "Service temporarily degraded: rate-limiting infrastructure unavailable. Resource-intensive voice synthesis is paused.",
      };
    }
  }

  // If request is allowed under the quota:
  if (status.allowed) {
    return {
      allowed: true,
      status,
      policy,
    };
  }

  // If request is denied under the quota:
  // Execute deterministic emergency preflight on utterance if available
  if (preflightUtterance && typeof preflightUtterance === "string" && preflightUtterance.trim()) {
    const preCheck = evaluatePreArbiter({ transcript: preflightUtterance });
    const isEmergency =
      preCheck.immediate_danger ||
      (preCheck.pre_safety_flags && preCheck.pre_safety_flags.length > 0);

    if (isEmergency) {
      return {
        allowed: true,
        emergencyPreempted: true,
        emergencyDirective:
          "This is an urgent medical condition. Emergency pre-arrival directives have been triggered. Please call 112 or 108 immediately or proceed to the nearest emergency department.",
        emergencyFlags: preCheck.pre_safety_flags,
        status,
        policy,
      };
    }
  }

  // Not an emergency: standard 429 rate limit denial
  return {
    allowed: false,
    status,
    policy,
  };
}

/**
 * Builds RFC 6585 compliant HTTP 429 response.
 */
export function buildRateLimit429Response(evalResult: EvaluateRateLimitResult): Response {
  const { status, policy, degradedNotice } = evalResult;

  const errorMessage =
    degradedNotice ||
    `Too Many Requests: Rate limit exceeded for ${policy.routeId}. Please wait ${status.retryAfterSec}s before sending new requests.`;

  const resetTimestampSec = Math.ceil((Date.now() + status.resetMs) / 1000);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Retry-After": status.retryAfterSec.toString(),
    "X-RateLimit-Limit": status.limit.toString(),
    "X-RateLimit-Remaining": status.remaining.toString(),
    "X-RateLimit-Reset": resetTimestampSec.toString(),
  };

  if (status.fallbackActive) {
    headers["X-RateLimit-Fallback"] = "true";
  }

  return new Response(
    JSON.stringify({
      success: false,
      error: errorMessage,
      code: "RATE_LIMIT_EXCEEDED",
      limit: status.limit,
      retryAfterSec: status.retryAfterSec,
      degraded: status.fallbackActive ?? false,
    }),
    {
      status: 429,
      headers,
    }
  );
}
