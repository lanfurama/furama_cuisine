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
  console.error('DATABASE_URL is not set. Run: vercel env pull .env.local --yes');
  process.exit(1);
}

// Pin full TLS verification; see db/client.ts for why.
const url = new URL(connectionString);
url.searchParams.set('sslmode', 'verify-full');

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
