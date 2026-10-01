#!/usr/bin/env node
/**
 * Recreates a throwaway database and applies the migrations to it. Extra
 * arguments (e.g. `--until 002_seed_restaurants.sql`) go to migrate.mjs.
 *
 * Refuses anything but a local database whose name ends in _test or _ci, so it
 * can never be pointed at Neon by mistake.
 */
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const target = process.env.RESET_DATABASE_URL;
if (!target) {
  console.error('RESET_DATABASE_URL is not set.');
  process.exit(1);
}

const url = new URL(target);
const name = url.pathname.slice(1);
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
  console.error(`Refusing to reset a database on ${url.hostname}: only local databases.`);
  process.exit(1);
}
if (!/^[a-z0-9_]+_(test|ci)$/.test(name)) {
  console.error(`Refusing to reset "${name}": the name must end in _test or _ci.`);
  process.exit(1);
}

const admin = new URL(url);
admin.pathname = '/postgres';
const client = new pg.Client({ connectionString: admin.toString() });
await client.connect();
try {
  await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await client.query(`CREATE DATABASE "${name}"`);
} finally {
  await client.end();
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
execFileSync(process.execPath, [join(root, 'scripts', 'migrate.mjs'), ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL_UNPOOLED: target },
});
