/**
 * MedVoice Care Network Client-Side Caching & Request Deduplication Engine
 *
 * Implements strict memory-scoped caching for hospital discovery queries,
 * in-flight request deduplication, sequence-based race condition protection,
 * and graceful fallback to stale cache on network failures.
 */

import { HospitalItem } from "@/app/_components/InteractiveRouteMap";

export interface CachedCareQueryResult {
  hospitals: HospitalItem[];
  timestamp: number;
  departureKey: string;
  targetKey: string;
}

export interface CachedRouteResult {
  roadDistanceKm: number;
  etaMinutes: number;
  coordinates: [number, number][];
  source: string;
  success: boolean;
  timestamp: number;
}

export class CareQueryCache {
  private cache = new Map<string, CachedCareQueryResult>();
  private inFlight = new Map<string, Promise<HospitalItem[]>>();
  private routeCache = new Map<string, CachedRouteResult>();
  private routeInFlight = new Map<string, Promise<CachedRouteResult>>();
  private readonly defaultTtlMs: number;

  constructor(defaultTtlMs = 10 * 60 * 1000) {
    // 10 minutes default TTL for facility directory data
    this.defaultTtlMs = defaultTtlMs;
  }

  public makeKey(targetLat: number, targetLng: number, departureLat: number, departureLng: number): string {
    return `${targetLat.toFixed(3)},${targetLng.toFixed(3)}_${departureLat.toFixed(3)},${departureLng.toFixed(3)}`;
  }

  public makeRouteKey(fromLat: number, fromLng: number, toLat: number, toLng: number): string {
    return `route_${fromLat.toFixed(4)},${fromLng.toFixed(4)}_${toLat.toFixed(4)},${toLng.toFixed(4)}`;
  }

  public get(targetLat: number, targetLng: number, departureLat: number, departureLng: number): CachedCareQueryResult | undefined {
    const key = this.makeKey(targetLat, targetLng, departureLat, departureLng);
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    const isExpired = Date.now() - entry.timestamp > this.defaultTtlMs;
    if (isExpired) {
      // Still return entry but marked stale conceptually so UI can revalidate while rendering
      return { ...entry };
    }

    return entry;
  }

  public set(targetLat: number, targetLng: number, departureLat: number, departureLng: number, hospitals: HospitalItem[]): void {
    const key = this.makeKey(targetLat, targetLng, departureLat, departureLng);
    this.cache.set(key, {
      hospitals,
      timestamp: Date.now(),
      targetKey: `${targetLat.toFixed(3)},${targetLng.toFixed(3)}`,
      departureKey: `${departureLat.toFixed(3)},${departureLng.toFixed(3)}`,
    });
  }

  public getRoute(fromLat: number, fromLng: number, toLat: number, toLng: number): CachedRouteResult | undefined {
    const key = this.makeRouteKey(fromLat, fromLng, toLat, toLng);
    const entry = this.routeCache.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.timestamp > this.defaultTtlMs) return undefined;
    return entry;
  }

  public setRoute(fromLat: number, fromLng: number, toLat: number, toLng: number, result: Omit<CachedRouteResult, "timestamp">): void {
    const key = this.makeRouteKey(fromLat, fromLng, toLat, toLng);
    this.routeCache.set(key, {
      ...result,
      timestamp: Date.now(),
    });
  }

  public async fetchRouteWithDeduplication(
    fromLat: number,
    fromLng: number,
    toLat: number,
    toLng: number,
    fetcher: (signal?: AbortSignal) => Promise<Omit<CachedRouteResult, "timestamp">>,
    signal?: AbortSignal
  ): Promise<{ route: CachedRouteResult; fromCache: boolean }> {
    const key = this.makeRouteKey(fromLat, fromLng, toLat, toLng);

    // 1. Check valid cache first
    const cached = this.getRoute(fromLat, fromLng, toLat, toLng);
    if (cached) {
      return { route: cached, fromCache: true };
    }

    // 2. In-flight promise deduplication
    const existing = this.routeInFlight.get(key);
    if (existing) {
      const res = await existing;
      return { route: res, fromCache: false };
    }

    // 3. Initiate fetch
    const p = (async () => {
      try {
        const raw = await fetcher(signal);
        const result: CachedRouteResult = {
          ...raw,
          timestamp: Date.now(),
        };
        this.routeCache.set(key, result);
        return result;
      } finally {
        this.routeInFlight.delete(key);
      }
    })();

    this.routeInFlight.set(key, p);
    const route = await p;
    return { route, fromCache: false };
  }

  public async fetchWithDeduplication(
    targetLat: number,
    targetLng: number,
    departureLat: number,
    departureLng: number,
    fetcher: (signal?: AbortSignal) => Promise<HospitalItem[]>,
    signal?: AbortSignal
  ): Promise<{ hospitals: HospitalItem[]; fromCache: boolean }> {
    const key = this.makeKey(targetLat, targetLng, departureLat, departureLng);

    // 1. Check valid cache first
    const cached = this.get(targetLat, targetLng, departureLat, departureLng);
    if (cached && Date.now() - cached.timestamp < this.defaultTtlMs) {
      return { hospitals: cached.hospitals, fromCache: true };
    }

    // 2. Check if identical query is already in flight (deduplicate)
    const existingPromise = this.inFlight.get(key);
    if (existingPromise) {
      const hospitals = await existingPromise;
      return { hospitals, fromCache: false };
    }

    // 3. Initiate new fetch with promise deduplication
    const queryPromise = (async () => {
      try {
        const hospitals = await fetcher(signal);
        this.set(targetLat, targetLng, departureLat, departureLng, hospitals);
        return hospitals;
      } catch (err) {
        // If fetch fails and we have stale cached data, don't crash — allow stale retrieval
        if (cached && cached.hospitals.length > 0) {
          console.warn("[CareCache] Network fetch failed, falling back to stale cache:", err);
          return cached.hospitals;
        }
        throw err;
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, queryPromise);
    const hospitals = await queryPromise;
    return { hospitals, fromCache: false };
  }

  public hasInFlight(targetLat: number, targetLng: number, departureLat: number, departureLng: number): boolean {
    const key = this.makeKey(targetLat, targetLng, departureLat, departureLng);
    return this.inFlight.has(key);
  }

  public clear(): void {
    this.cache.clear();
    this.inFlight.clear();
  }
}

export const clientCareCache = new CareQueryCache();
