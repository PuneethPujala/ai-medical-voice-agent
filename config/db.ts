import { drizzle as drizzleNeon } from 'drizzle-orm/neon-http';
import { drizzle as drizzleNodePg } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';
import dns from 'dns';
import net from 'net';
import { setGlobalDispatcher, Agent } from 'undici';

// Resilient DNS resolution fallback for Neon Serverless when local router/ISP DNS drops or refuses cloud domains
if (typeof process !== 'undefined' && process.versions?.node) {
  try {
    const resolver = new dns.promises.Resolver();
    resolver.setServers(['8.8.8.8', '1.1.1.1']);

    const customLookup = (hostname: string, opts: any, cb: any) => {
      if (typeof opts === 'function') {
        cb = opts;
        opts = {};
      }
      if (hostname === 'localhost' || net.isIP(hostname)) {
        return dns.lookup(hostname, opts, cb);
      }
      resolver
        .resolve4(hostname)
        .then((addrs) => {
          if (opts && opts.all) {
            cb(null, addrs.map((a) => ({ address: a, family: 4 })));
          } else {
            cb(null, addrs[0], 4);
          }
        })
        .catch(() => {
          resolver
            .resolve6(hostname)
            .then((addrs6) => {
              if (opts && opts.all) {
                cb(null, addrs6.map((a) => ({ address: a, family: 6 })));
              } else {
                cb(null, addrs6[0], 6);
              }
            })
            .catch(() => dns.lookup(hostname, opts, cb));
        });
    };

    setGlobalDispatcher(new Agent({ connect: { lookup: customLookup } }));
  } catch {
    // If undici is unavailable or in Edge runtime, standard fetch lookup proceeds
  }
}

export type DbClient = ReturnType<typeof drizzleNeon>;

let customDbClient: any = null;
let currentDrizzleInstance: any = null;
let currentPoolInstance: Pool | null = null;
let cachedDbUrl: string | null = null;

export function setCustomDbClient(client: any) {
  customDbClient = client;
}

export function getDb(): DbClient | null {
  if (customDbClient !== null) {
    return customDbClient ? (customDbClient as DbClient) : null;
  }
  const dbUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  if (!dbUrl) {
    return null;
  }

  if (currentDrizzleInstance && cachedDbUrl === dbUrl) {
    return currentDrizzleInstance;
  }

  cachedDbUrl = dbUrl;
  const isNeonCloud = dbUrl.includes('.neon.tech') || dbUrl.startsWith('https://');

  if (isNeonCloud) {
    currentDrizzleInstance = drizzleNeon(dbUrl) as DbClient;
  } else {
    currentDrizzleInstance = drizzleNodePg(dbUrl) as unknown as DbClient;
  }

  return currentDrizzleInstance;
}

export async function closeDbPool(): Promise<void> {
  if (currentPoolInstance) {
    await currentPoolInstance.end().catch(() => {});
    currentPoolInstance = null;
    currentDrizzleInstance = null;
    cachedDbUrl = null;
  }
}

export const db = (process.env.TEST_DATABASE_URL || process.env.DATABASE_URL)
  ? getDb()
  : (null as any);

export { schema };
