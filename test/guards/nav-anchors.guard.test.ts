import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SECTION_KEYS } from '@/lib/content/types';

/*
 * A nav item scrolls to the element whose id is its target_section
 * (scrollToId in components/site/SiteProvider.tsx looks up `[id="<key>"]`).
 * Migration 008 refuses, with a CHECK, the sections that have no anchor of
 * their own name; every other section must have one, or an item an editor
 * points at it (phase 7) is a dead link: on the home page nothing happens, and
 * from any other page the guest lands at the top of home with no target.
 * When a section gains or loses its anchor, the CHECK changes with it, in a
 * new migration.
 */

const ROOT = join(__dirname, '..', '..');
const MIGRATION = join(ROOT, 'db', 'migrations', '008_content.sql');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

/** The keys inside `target_section NOT IN (…)` of nav_items' CHECK. */
function refusedTargets(sql: string): string[] {
  const list = /target_section\s+NOT IN\s*\(([^)]*)\)/.exec(sql)?.[1];
  if (!list) throw new Error('008_content.sql has no `target_section NOT IN (…)` CHECK');
  return list.split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
}

describe('nav items: every section the database lets an item target has an anchor of its own name', () => {
  it('finds, for each such section, an element with id="<section key>" under components/', () => {
    const refused = refusedTargets(readFileSync(MIGRATION, 'utf8'));
    // A typo in the CHECK would refuse nothing that exists; it must name real sections.
    expect(refused.filter((key) => !(SECTION_KEYS as readonly string[]).includes(key))).toEqual([]);

    const sources = files(join(ROOT, 'components')).map((path) => readFileSync(path, 'utf8'));
    const targets = SECTION_KEYS.filter((key) => !refused.includes(key));
    expect(targets.length).toBeGreaterThan(0);
    const withoutAnchor = targets.filter((key) => !sources.some((src) => src.includes(`id="${key}"`)));
    expect(withoutAnchor).toEqual([]);
  });
});
