import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSync } from 'oxc-parser';
import { describe, expect, it } from 'vitest';

/*
 * Phase-7 code rule 1 (spec §7.4, phase-6 ledger L7-6): a save expires the
 * guest cache only through the cache plan, `for (const tag of
 * tagsForSave(…)) updateTag(tag)` or the same over tagsForStrings(…), so the
 * tags of every table a transaction wrote are expired and lib/cache-plan.test.ts
 * keeps them in step with the loaders. The booking screens' own tag
 * (TAGS.bookingRules(id)) is not a content tag. One older call is listed
 * with its reason (phase 5's saveInbox went through the cache plan in plan
 * 7B task B5, L7-6).
 */

const ROOT = join(__dirname, '..', '..');

/** `<file>: <argument as written>` → why it may stay. */
const ALLOWED = new Map([
  [
    'app/admin/(shell)/restaurants/[id]/booking/actions.ts: TAGS.restaurants',
    'the booking screen (phase 4): service periods and the booking switch change the catalogue’s meals and bookingEnabled',
  ],
]);

const CACHE_PLAN_FUNCTIONS = ['tagsForSave', 'tagsForStrings'];

type Node = { type: string; start: number; end: number; [key: string]: unknown };

function files(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' || e.name.startsWith('.') ? [] : files(rel);
    return /\.[cm]?[jt]sx?$/.test(e.name) && !/\.test\.[cm]?[jt]sx?$/.test(e.name) ? [rel] : [];
  });
}

/** Visits every node with its ancestors (nearest last). */
function walk(node: unknown, visit: (n: Node, ancestors: Node[]) => void, ancestors: Node[] = []): void {
  if (Array.isArray(node)) return node.forEach((n) => walk(n, visit, ancestors));
  if (typeof node !== 'object' || node === null || typeof (node as Node).type !== 'string') return;
  visit(node as Node, ancestors);
  for (const [key, value] of Object.entries(node)) if (key !== 'parent') walk(value, visit, [...ancestors, node as Node]);
}

const calls = (n: Node, names: string[]) => n.type === 'CallExpression' && names.includes(((n.callee as Node).name as string) ?? '');

/**
 * Every updateTag(…) of a file whose argument is neither a loop variable over
 * tagsForSave/tagsForStrings nor TAGS.bookingRules(…), as `<file>: <argument>`.
 */
function rawTagCalls(rel: string, src: string): string[] {
  const found: string[] = [];
  walk(parseSync(rel, src).program, (n, ancestors) => {
    if (!calls(n, ['updateTag'])) return;
    const arg = (n.arguments as Node[])[0];
    const text = src.slice(arg.start, arg.end);
    if (arg.type === 'CallExpression' && src.slice(arg.start, arg.end).startsWith('TAGS.bookingRules(')) return;
    if (arg.type === 'Identifier') {
      const loop = [...ancestors].reverse().find((a) => a.type === 'ForOfStatement');
      const left = loop && (((loop.left as Node).declarations as Node[] | undefined)?.[0]?.id as Node | undefined);
      if (left?.name === arg.name && calls(loop!.right as Node, CACHE_PLAN_FUNCTIONS)) return;
    }
    found.push(`${rel}: ${text}`);
  });
  return found;
}

describe('content tags reach updateTag only through the cache plan (phase-7 code rule 1)', () => {
  it('no raw updateTag of a content tag in app or lib, except the listed ones', () => {
    const found = ['app', 'lib'].flatMap(files).flatMap((rel) => rawTagCalls(rel, readFileSync(join(ROOT, rel), 'utf8')));
    expect(found.filter((f) => !ALLOWED.has(f))).toEqual([]);
  });

  it('every allowed call still exists (a fixed one leaves the list)', () => {
    const found = new Set(['app', 'lib'].flatMap(files).flatMap((rel) => rawTagCalls(rel, readFileSync(join(ROOT, rel), 'utf8'))));
    expect([...ALLOWED.keys()].filter((k) => !found.has(k))).toEqual([]);
  });

  it('what it accepts and what it flags', () => {
    const src = [
      "for (const tag of tagsForSave(OFFER.tables)) updateTag(tag);",
      "for (const tag of tagsForStrings(keys, bumped)) updateTag(tag);",
      'updateTag(TAGS.bookingRules(id));',
      'updateTag(TAGS.contentOffers);',
      "updateTag('content:ui');",
      'for (const tag of [TAGS.media]) updateTag(tag);',
      'const tag = TAGS.contentHero; updateTag(tag);',
    ].join('\n');
    expect(rawTagCalls('x.ts', src)).toEqual(['x.ts: TAGS.contentOffers', "x.ts: 'content:ui'", 'x.ts: tag', 'x.ts: tag']);
  });
});
