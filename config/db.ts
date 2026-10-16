import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

type DbClient = ReturnType<typeof drizzle>;

let customDbClient: any = null;

export function setCustomDbClient(client: any) {
  customDbClient = client;
}

export function getDb(): DbClient | null {
  if (customDbClient !== null) {
    return customDbClient as DbClient;
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


