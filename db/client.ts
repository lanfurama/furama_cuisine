import { Pool } from 'pg';
import { attachDatabasePool } from '@vercel/functions';

/*
 * One pool per warm Fluid Compute instance. `attachDatabasePool` lets Vercel
 * drain it on shutdown so Neon does not accumulate idle connections. The pool
 * is created lazily, on the first query.
 */
let pool: Pool | null = null;

/** Throwaway databases for tests and CI run on this machine without TLS. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Neon hands out `sslmode=require`, which node-postgres currently treats as
 * `verify-full` but will downgrade in pg v9. Pinning it keeps full certificate
 * verification across that change (and silences the deprecation warning).
 */
function withVerifyFull(url: string): string {
  const parsed = new URL(url);
  if (LOCAL_HOSTS.has(parsed.hostname)) return url;
  if (parsed.searchParams.get('sslmode') !== 'verify-full') {
    parsed.searchParams.set('sslmode', 'verify-full');
  }
  return parsed.toString();
}

export function getPool(): Pool {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set. Point .env.local at the Neon dev branch (see README → Getting started).',
    );
  }

  pool = new Pool({
    connectionString: withVerifyFull(connectionString),
    max: 5,
    idleTimeoutMillis: 10_000,
  });
  attachDatabasePool(pool);
  return pool;
}

export async function query<T extends Record<string, unknown>>(
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  const result = await getPool().query<T>(text, values);
  return result.rows;
}
