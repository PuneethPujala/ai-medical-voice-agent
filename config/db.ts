import { drizzle } from 'drizzle-orm/neon-http';
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

type DbClient = ReturnType<typeof drizzle>;

let customDbClient: any = null;

export function setCustomDbClient(client: any) {
  customDbClient = client;
}

export function getDb(): DbClient | null {
  if (customDbClient !== null) {
    return customDbClient ? (customDbClient as DbClient) : null;
  }
  if (!process.env.DATABASE_URL) {
    return null;
  }
  return drizzle(process.env.DATABASE_URL);
}

export const db = process.env.DATABASE_URL
  ? drizzle(process.env.DATABASE_URL)
  : (null as any);

export { schema };


