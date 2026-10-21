import { describe, it } from 'node:test';
import assert from 'node:assert';
import { CareQueryCache } from '../../lib/care-network/care-cache';
import { HospitalItem } from '../../app/_components/InteractiveRouteMap';

const mockHospital1: HospitalItem = {
  id: 'hosp-1',
  name: 'Apollo Health City',
  specialty: ['Cardiology', 'Emergency'],
  city: 'Hyderabad',
  address: 'Jubilee Hills, Hyderabad',
  phone: '+91 40 2360 7777',
  emergencyPhone: '+91 40 1066',
  distanceKm: 3.4,
  latitude: 17.426,
  longitude: 78.412,
  isEmergency24x7: true,
};

const mockHospital2: HospitalItem = {
  id: 'hosp-2',
  name: 'NIMS Hyderabad',
  specialty: ['Neurology', 'Government'],
  city: 'Hyderabad',
  address: 'Punjagutta, Hyderabad',
  phone: '+91 40 2348 9000',
  emergencyPhone: '108',
  distanceKm: 5.1,
  latitude: 17.423,
  longitude: 78.452,
  isEmergency24x7: true,
};

describe('CareQueryCache Test Suite', () => {
  it('should store and retrieve hospital results by coordinate key', () => {
    const cache = new CareQueryCache();
    cache.set(17.426, 78.412, 17.420, 78.410, [mockHospital1, mockHospital2]);

    const result = cache.get(17.426, 78.412, 17.420, 78.410);
    assert.ok(result);
    assert.strictEqual(result.hospitals.length, 2);
    assert.strictEqual(result.hospitals[0].name, 'Apollo Health City');
  });

  it('should deduplicate concurrent in-flight requests for identical coordinates', async () => {
    const cache = new CareQueryCache();
    let networkCalls = 0;

    const mockFetcher = async () => {
      networkCalls++;
      await new Promise((r) => setTimeout(r, 50));
      return [mockHospital1];
    };

    // Trigger two requests simultaneously
    const [res1, res2] = await Promise.all([
      cache.fetchWithDeduplication(17.426, 78.412, 17.420, 78.410, mockFetcher),
      cache.fetchWithDeduplication(17.426, 78.412, 17.420, 78.410, mockFetcher),
    ]);

    assert.strictEqual(networkCalls, 1, 'Fetcher must be invoked exactly once for concurrent duplicate calls');
    assert.strictEqual(res1.hospitals.length, 1);
    assert.strictEqual(res2.hospitals.length, 1);
  });

  it('should return from cache on subsequent call without invoking fetcher', async () => {
    const cache = new CareQueryCache();
    let networkCalls = 0;

    const mockFetcher = async () => {
      networkCalls++;
      return [mockHospital1];
    };

    const first = await cache.fetchWithDeduplication(17.426, 78.412, 17.420, 78.410, mockFetcher);
    assert.strictEqual(first.fromCache, false);
    assert.strictEqual(networkCalls, 1);

    const second = await cache.fetchWithDeduplication(17.426, 78.412, 17.420, 78.410, mockFetcher);
    assert.strictEqual(second.fromCache, true);
    assert.strictEqual(networkCalls, 1, 'Fetcher must not be called on cache hit');
  });

  it('should fall back to stale cache if network fetch fails', async () => {
    // 1ms TTL to immediately simulate stale cache
    const cache = new CareQueryCache(1);
    cache.set(17.426, 78.412, 17.420, 78.410, [mockHospital1]);
    await new Promise((r) => setTimeout(r, 10));

    const failingFetcher = async () => {
      throw new Error('Network timeout (503 Service Unavailable)');
    };

    const fallback = await cache.fetchWithDeduplication(17.426, 78.412, 17.420, 78.410, failingFetcher);
    assert.strictEqual(fallback.hospitals.length, 1);
    assert.strictEqual(fallback.hospitals[0].id, 'hosp-1');
  });

  it('should cache and deduplicate route computations', async () => {
    const cache = new CareQueryCache();
    let routeFetches = 0;

    const mockRouteFetcher = async () => {
      routeFetches++;
      await new Promise((r) => setTimeout(r, 40));
      return {
        roadDistanceKm: 3.8,
        etaMinutes: 11,
        coordinates: [[17.420, 78.410], [17.426, 78.412]] as [number, number][],
        source: 'osrm_turn_by_turn',
        success: true,
      };
    };

    // Concurrent route fetches
    const [r1, r2] = await Promise.all([
      cache.fetchRouteWithDeduplication(17.420, 78.410, 17.426, 78.412, mockRouteFetcher),
      cache.fetchRouteWithDeduplication(17.420, 78.410, 17.426, 78.412, mockRouteFetcher),
    ]);

    assert.strictEqual(routeFetches, 1, 'Only one route network call executed for concurrent identical coordinates');
    assert.strictEqual(r1.route.roadDistanceKm, 3.8);
    assert.strictEqual(r2.route.roadDistanceKm, 3.8);

    // Subsequent call should hit cache immediately
    const r3 = await cache.fetchRouteWithDeduplication(17.420, 78.410, 17.426, 78.412, mockRouteFetcher);
    assert.strictEqual(r3.fromCache, true);
    assert.strictEqual(routeFetches, 1, 'No additional network call made on cached route');
  });
});
