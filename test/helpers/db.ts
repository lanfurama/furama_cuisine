import { execFileSync } from 'node:child_process';
import pg from 'pg';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

/**
 * The integration server's URL, pointed at another database name.
 * TEST_DB_TAG=x renames furama_cuisine_migrate_test to furama_cuisine_migrate_x_test,
 * so two checkouts can run the suite on one Postgres at the same time.
 */
export function databaseUrl(name: string): string {
  const url = new URL(TEST_DATABASE_URL ?? 'postgres://localhost:5432/postgres');
  const tag = process.env.TEST_DB_TAG;
  url.pathname = `/${tag && /^[a-z0-9]+$/.test(tag) ? name.replace(/_test$/, `_${tag}_test`) : name}`;
  return url.toString();
}

/** Recreates the database and applies migrations, optionally stopping after `until`. */
export function resetDatabase(url: string, until?: string): void {
  execFileSync(process.execPath, ['scripts/reset-db.mjs', ...(until ? ['--until', until] : [])], {
    stdio: 'inherit',
    env: { ...process.env, RESET_DATABASE_URL: url },
  });
}

/**
 * The last migration with a locales table (011 drops it, with the foreign keys
 * and social_links.visible_locales): the tests of 004–010 check their own
 * schema on a database built up to here.
 */
export const BEFORE_011 = '010_locales_phase8.sql';

/** Applies every pending migration, optionally stopping after `until`. Throws when one fails. */
export function migrate(url: string, until?: string): void {
  execFileSync(process.execPath, ['scripts/migrate.mjs', ...(until ? ['--until', until] : [])], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL_UNPOOLED: url },
  });
}

export async function withClient<T>(url: string, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}
