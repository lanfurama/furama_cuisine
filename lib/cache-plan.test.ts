import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONTENT_TABLES, LOADERS, SAVE_TAGS, tagsForLocales, tagsForSave, type ContentTable } from './cache-plan';
import { TAGS } from './cache-tags';

const ALL_TAGS = new Set<string>(Object.values(TAGS).flatMap((t) => (typeof t === 'string' ? [t] : [])));

describe('cache plan (spec §6.2)', () => {
  it('expires, on a save to any table a loader reads, at least one of that loader’s tags', () => {
    const gaps: string[] = [];
    for (const [name, loader] of Object.entries(LOADERS)) {
      for (const table of loader.reads as readonly ContentTable[]) {
        // A language switch reaches every loader through i18n:<locale>, which each one carries.
        if (table === 'locales' && name !== 'locales') continue;
        if (!SAVE_TAGS[table].some((tag) => (loader.tags as readonly string[]).includes(tag))) gaps.push(`${name} reads ${table}`);
      }
    }
    expect(gaps).toEqual([]);
  });

  it('names only tags from lib/cache-tags.ts', () => {
    const used = [...Object.values(SAVE_TAGS).flat(), ...Object.values(LOADERS).flatMap((l) => [...l.tags])];
    expect(used.filter((t) => !ALL_TAGS.has(t))).toEqual([]);
  });

  it('knows what a save to every content table expires', () => {
    for (const table of CONTENT_TABLES) expect(SAVE_TAGS[table].length).toBeGreaterThan(0);
  });

  it('adds restaurant:<id> for a restaurant’s own rows, once per tag', () => {
    expect(tagsForSave(['restaurants', 'restaurant_i18n'], 'taya-house')).toEqual(['restaurants', 'restaurant:taya-house']);
    expect(tagsForSave(['offers', 'offer_i18n'])).toEqual(['content:offers']);
  });

  it('is what the loaders tag: every cached loader calls cacheTag(...LOADERS.<its name>.tags)', () => {
    const dir = join(__dirname, 'server', 'content');
    const source = readdirSync(dir)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.queries.ts') && !f.endsWith('.test.ts') && f !== 'sql.ts')
      .map((f) => readFileSync(join(dir, f), 'utf8'))
      .join('\n');
    const cached = source.split("'use cache';").length - 1;
    const tagged = [...source.matchAll(/cacheTag\(\.\.\.LOADERS\.(\w+)\.tags/g)].map((m) => m[1]);
    expect(tagged).toHaveLength(cached);
    expect(tagged.filter((n) => !(n in LOADERS))).toEqual([]);
    expect(Object.keys(LOADERS).filter((n) => !tagged.includes(n))).toEqual([]);
  });
});

describe('tagsForLocales (phase 8)', () => {
  it('expires locales, and the i18n tag of each language that changed, once', () => {
    expect(tagsForLocales(['vi', 'vi', 'ko'])).toEqual(['locales', 'i18n:vi', 'i18n:ko']);
    expect(tagsForLocales([])).toEqual(['locales']);
  });
});
