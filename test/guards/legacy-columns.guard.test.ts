import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSync } from 'oxc-parser';
import { describe, expect, it } from 'vitest';

/*
 * R10 (phase 6): migration 008 replaced five phase-1 columns of restaurants
 * (type → restaurant_i18n.type_label, destination → destination_id, cuisines →
 * restaurant_cuisines, meals and slot_capacity → service_periods). They stay
 * until phase 10 drops them, so the phase-5 code can still run on a 008
 * database, but no app SQL may read them: a restaurant added in phase 7 fills
 * only the new columns, and a reader of an old one would silently leave it out
 * of a destination's closures, recipients or the catalogue.
 *
 * The scan parses every source file (oxc-parser; TypeScript 7 has no compiler
 * API) and looks at its SQL: string and template literals that read like a
 * query. A column is flagged when it is qualified by an alias the same query
 * gives to restaurants (`FROM restaurants r` … `r.destination`), by the table
 * name itself, or by an interpolated alias (`${restaurant}.destination`, as a
 * shared fragment such as groupPhoneSql writes it); destination and
 * slot_capacity are flagged bare too (`SELECT … destination AS …`), since no
 * other table has a column of either name, and so are type, cuisines and
 * meals when restaurants is the query's only table (`SELECT id, type FROM
 * restaurants`): other tables have columns of those names, so a bare one in a
 * join cannot be placed and is left to the alias rule. Migrations, the Neon check SQL and
 * the tests (booking-seed.test.ts reads the phase-1 seed on purpose) are not
 * app code.
 */

const ROOT = join(__dirname, '..', '..');
const SCAN = ['app', 'components', 'lib', 'db', 'scripts'];
const LEGACY = ['type', 'destination', 'cuisines', 'meals', 'slot_capacity'];
const SQL = /\b(?:SELECT|INSERT INTO|UPDATE|DELETE FROM|WHERE|JOIN)\b|\bAS "\w+"/;

type Node = { type: string; [key: string]: unknown };

function files(path: string): string[] {
  const full = join(ROOT, path);
  let entries;
  try {
    entries = readdirSync(full, { withFileTypes: true });
  } catch {
    return /\.(?:ts|tsx|mjs)$/.test(path) && !/\.test\.ts$/.test(path) && !/\.d\.ts$/.test(path) ? [path] : [];
  }
  return entries.flatMap((e) => (e.name === 'node_modules' || e.name.startsWith('.') || path === 'db/migrations' ? [] : files(join(path, e.name))));
}

function walk(node: unknown, visit: (n: Node) => void): void {
  if (Array.isArray(node)) return node.forEach((n) => walk(n, visit));
  if (typeof node !== 'object' || node === null || typeof (node as Node).type !== 'string') return;
  visit(node as Node);
  for (const [key, value] of Object.entries(node)) if (key !== 'parent') walk(value, visit);
}

/** Every string and template literal of a file; an interpolation reads as `${}`. */
function literals(rel: string, source: string): string[] {
  const { program, errors } = parseSync(rel, source);
  if (errors.length) throw new Error(`${rel}: ${errors[0].message}`);
  const out: string[] = [];
  walk(program, (n) => {
    if (n.type === 'TemplateLiteral') {
      out.push((n.quasis as { value: { raw: string } }[]).map((q) => q.value.raw).join('${}'));
    } else if (n.type === 'Literal' && typeof n.value === 'string') {
      out.push(n.value);
    }
  });
  return out;
}

/** The phase-1 columns a piece of SQL reads, as they are written there. */
function legacyReads(sql: string): string[] {
  if (!SQL.test(sql)) return [];
  const aliases = new Set(['restaurants']);
  for (const m of sql.matchAll(/\b(?:FROM|JOIN|UPDATE)\s+restaurants\s+(?:AS\s+)?([a-z_]\w*)/gi)) {
    if (!/^(?:WHERE|ON|JOIN|LEFT|RIGHT|INNER|CROSS|SET|ORDER|GROUP|USING|LIMIT)$/i.test(m[1])) aliases.add(m[1]);
  }
  const cols = LEGACY.join('|');
  const qualified = new RegExp(`(?:\\b(${[...aliases].join('|')})|\\$\\{\\})\\.(${cols})\\b(?![\\w])`, 'g');
  const bare = /(?<![\w.'"$])(destination|slot_capacity)(?![\w'"])/g;
  const reads = [...[...sql.matchAll(qualified)].map((m) => m[0]), ...[...sql.matchAll(bare)].map((m) => m[0])];
  const tables = new Set([...sql.matchAll(/\b(?:FROM|JOIN|UPDATE|INTO)\s+([a-z_]\w*)/gi)].map((m) => m[1].toLowerCase()));
  if (tables.size === 1 && tables.has('restaurants')) {
    reads.push(...[...sql.matchAll(/(?<![\w.'"$])(type|cuisines|meals)(?![\w'"])/g)].map((m) => m[0]));
  }
  return reads;
}

describe('no app SQL reads the phase-1 columns of restaurants (R10)', () => {
  it('finds none in app, components, lib, db and scripts', () => {
    const found = SCAN.flatMap(files).flatMap((rel) =>
      literals(rel, readFileSync(join(ROOT, rel), 'utf8')).flatMap((sql) => legacyReads(sql).map((col) => `${rel}: ${col}`)),
    );
    expect(found).toEqual([]);
  });

  it('recognises the forms it is looking for, and leaves other tables alone', () => {
    expect(legacyReads(`SELECT r.id, r.type, r.destination FROM restaurants r`)).toEqual(['r.type', 'r.destination']);
    expect(legacyReads(`SELECT rest.cuisines FROM reservations r JOIN restaurants rest ON rest.id = r.restaurant_id`)).toEqual(['rest.cuisines']);
    expect(legacyReads(`SELECT id FROM restaurants WHERE restaurants.meals @> $1`)).toEqual(['restaurants.meals']);
    expect(legacyReads('(SELECT d.phone_e164 FROM destinations d ORDER BY (d.id = ${}.destination) DESC LIMIT 1)')).toEqual(['${}.destination']);
    expect(legacyReads(`id, name, destination AS "destinationId"`)).toEqual(['destination']);
    expect(legacyReads(`UPDATE restaurants SET slot_capacity = 4 WHERE id = $1`)).toEqual(['slot_capacity']);
    expect(legacyReads(`SELECT id, name, type, cuisines FROM restaurants WHERE id = $1`)).toEqual(['type', 'cuisines']);
    expect(legacyReads(`SELECT id FROM restaurants r WHERE meals @> $1`)).toEqual(['meals']);
    // New columns, other tables, scope literals and prose are not reads of the phase-1 columns.
    expect(legacyReads(`SELECT r.destination_id, c.meals, m.content_type FROM restaurants r JOIN closures c ON c.scope = 'destination'`)).toEqual([]);
    expect(legacyReads(`SELECT e.type FROM reservation_events e WHERE e.reservation_id = $1`)).toEqual([]);
    expect(legacyReads(`SELECT id, type FROM media WHERE id = $1`)).toEqual([]);
    expect(legacyReads(`SELECT r.id, type FROM restaurants r JOIN media m ON m.id = r.card_image_id`)).toEqual([]);
    expect(legacyReads(`SELECT id, name FROM restaurants WHERE content_type = 'type' ORDER BY sort_order`)).toEqual([]);
    expect(legacyReads('Any destination')).toEqual([]);
  });
});
