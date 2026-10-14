#!/usr/bin/env node
/**
 * Applies a content pack (README "Content packs"): a reviewed JSON file of
 * edits to the seeded content, through applyContentPack
 * (lib/server/content-admin/content-pack.ts).
 *
 *   DATABASE_URL_UNPOOLED=… node scripts/apply-content-pack.mjs packs/<pack>.json            # dry run
 *   DATABASE_URL_UNPOOLED=… node scripts/apply-content-pack.mjs packs/<pack>.json --apply
 *
 * - Dry run unless --apply: the whole pack runs in a transaction that is
 *   rolled back, so it prints exactly what --apply would do.
 * - A change applies only while the value is still the seed's; anything staff
 *   changed is skipped and printed with the reason, never overwritten. Safe to
 *   run again: what it applied is no longer the seed's `from`, so it is skipped.
 * - One transaction, one audit_log row per item it changed (actor: this
 *   script), holding the item before and after as its History reads it, so
 *   History can restore the old version.
 * - It loads the TypeScript module with jiti (as scripts/create-admin.mjs
 *   does); nothing here reads .env files: pass the database explicitly. It
 *   reads DATABASE_URL_UNPOOLED before DATABASE_URL (as scripts/migrate.mjs
 *   does) and prints the host and database first.
 * - It cannot expire the guest pages' cache: redeploy afterwards.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';
import { Pool } from 'pg';

const root = fileURLToPath(new URL('..', import.meta.url));
const ACTOR = { id: 'script:apply-content-pack', email: 'script:apply-content-pack' };
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function fail(message) {
  console.error(`apply-content-pack: ${message}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const unknown = args.filter((a) => a.startsWith('--') && a !== '--apply');
const files = args.filter((a) => !a.startsWith('--'));
if (unknown.length > 0 || files.length !== 1) fail('usage: node scripts/apply-content-pack.mjs <pack.json> [--apply]');

const connectionString = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!connectionString) fail('DATABASE_URL_UNPOOLED (or DATABASE_URL) is not set.');
// Same TLS rule as scripts/move-assets-to-blob.mjs: full verification except for local databases.
const dbUrl = new URL(connectionString);
if (!LOCAL_HOSTS.has(dbUrl.hostname)) dbUrl.searchParams.set('sslmode', 'verify-full');

console.log(`${apply ? 'APPLY' : 'DRY RUN'}: database ${dbUrl.hostname}${dbUrl.pathname}`);

let pack;
try {
  pack = JSON.parse(await readFile(files[0], 'utf8'));
} catch (err) {
  fail(`${files[0]}: ${err instanceof Error ? err.message : String(err)}`);
}

const jiti = createJiti(import.meta.url, {
  alias: { '@/': root, 'server-only': fileURLToPath(new URL('./server-only-stub.mjs', import.meta.url)) },
});
const { applyContentPack, packErrors } = await jiti.import('../lib/server/content-admin/content-pack.ts');
// A pack may also carry booking periods ({ restaurant, from, to }): the booking module applies those (lib/server/booking/config.ts).
const periods = Array.isArray(pack?.periods) ? pack.periods : [];
const { applyPackPeriods } = periods.length > 0 ? await jiti.import('../lib/server/booking/config.ts') : {};

const errors = packErrors(pack);
if (errors.length > 0) fail(`${files[0]} is not a valid pack:\n${errors.map((e) => `  ${e}`).join('\n')}`);
console.log(`Pack ${pack.id}: ${pack.changes.length} change(s).`);

/** What a change does, as one line: the item, the column, from → to. */
function describe(c) {
  const value = (v) => (v === null || v === undefined ? 'empty' : JSON.stringify(v));
  return `${c.entity} ${c.id} ${c.kind === 'text' ? 'en.' : ''}${c.column}: ${value(c.from)} → ${value(c.to)}`;
}

const pool = new Pool({ connectionString: dbUrl.toString(), max: 1 });
let outcomes;
let periodOutcomes = [];
try {
  outcomes = await applyContentPack(pool, ACTOR, pack, { dryRun: !apply });
  if (periods.length > 0) periodOutcomes = await applyPackPeriods(pool, ACTOR, periods, { dryRun: !apply });
} catch (err) {
  // The transaction rolled back: a value the database refuses (a CHECK), or a lost connection.
  await pool.end();
  fail(`nothing changed: ${err instanceof Error ? err.message : String(err)}`);
}
await pool.end();

for (const o of outcomes) {
  console.log(`  ${o.applied ? 'applied' : 'skipped'} ${describe(o.change)}${o.applied ? '' : ` (${o.reason})`}`);
}
for (const o of periodOutcomes) {
  console.log(`  ${o.applied ? 'applied' : 'skipped'} service periods of ${o.restaurant}${o.applied ? '' : ` (${o.reason})`}`);
}
const all = [...outcomes, ...periodOutcomes];
const applied = all.filter((o) => o.applied).length;
console.log(`${applied} applied, ${all.length - applied} skipped.`);
if (!apply) {
  console.log('Dry run: nothing changed. Add --apply to write the changes.');
} else if (applied > 0) {
  console.log('Written in one transaction, with one audit row per item. Redeploy (or save each changed screen in the admin) so cached guest pages pick up the changes.');
}
