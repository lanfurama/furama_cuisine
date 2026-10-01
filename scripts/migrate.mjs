#!/usr/bin/env node
/**
 * Applies db/migrations/*.sql in filename order, once each, inside a
 * transaction. Uses the unpooled connection because schema changes need a
 * direct session (pgBouncer cannot carry DDL session state).
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'db', 'migrations');

const connectionString =
  process.env.DATABASE_URL_UNPOOLED ?? process.env.POSTGRES_URL_NON_POOLING ?? process.env.DATABASE_URL;

if (!connectionString) {
  console.error(
    'DATABASE_URL_UNPOOLED is not set. Point it at the Neon dev branch (see README → Getting started).',
  );
  process.exit(1);
}

// `--until 002_seed_restaurants.sql` stops after that file; tests use it to
// build a database as it was before a later migration.
const untilAt = process.argv.indexOf('--until');
const until = untilAt === -1 ? null : process.argv[untilAt + 1];
if (untilAt !== -1 && !until) {
  console.error('--until needs a migration file name.');
  process.exit(1);
}

// Pin full TLS verification for Neon (see db/client.ts); local throwaway
// databases have no TLS.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const url = new URL(connectionString);
if (!LOCAL_HOSTS.has(url.hostname)) url.searchParams.set('sslmode', 'verify-full');

console.log(`Migrating ${url.hostname}${url.pathname}`);
const client = new pg.Client({ connectionString: url.toString() });
await client.connect();

try {
  await client.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name       text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const { rows } = await client.query('SELECT name FROM _migrations');
  const applied = new Set(rows.map((r) => r.name));
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();

  let ran = 0;
  for (const file of files) {
    if (until && file > until) break;
    if (applied.has(file)) {
      console.log(`  · ${file} (already applied)`);
      continue;
    }
    const sql = await readFile(join(dir, file), 'utf8');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`  ✓ ${file}`);
      ran++;
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`  ✗ ${file}`);
      throw err;
    }
  }

  console.log(ran ? `\nApplied ${ran} migration(s).` : '\nDatabase already up to date.');
} finally {
  await client.end();
}
