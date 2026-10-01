import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * The admin renders at request time (spec §11). app/admin/layout.tsx makes
 * that so with `instant = false` + `await connection()`, but Cache Components
 * still validates navigations *between* admin pages in next dev and reports
 * every session read as a blocking route (instant-navigation.md:568). Each
 * admin page therefore says `instant = false` itself, and no admin file may
 * use style="" (style={…}) markup: the admin CSP has no 'unsafe-inline'.
 */
const ADMIN = 'app/admin';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

const all = files(ADMIN).filter((f) => /\.tsx?$/.test(f));

describe('admin pages', () => {
  it('every page.tsx exports instant = false', () => {
    const pages = all.filter((f) => f.endsWith('/page.tsx'));
    expect(pages.length).toBeGreaterThan(0);
    const missing = pages.filter((f) => !/^export const instant = false;$/m.test(readFileSync(f, 'utf8')));
    expect(missing.map((f) => relative('.', f))).toEqual([]);
  });

  it('the root layout blocks on connection() before rendering <html>', () => {
    const src = readFileSync(join(ADMIN, 'layout.tsx'), 'utf8');
    expect(src).toMatch(/^export const instant = false;$/m);
    // Code, not the comments that mention both: a statement of its own, before the <html …> element.
    const call = /^\s*await connection\(\);$/m.exec(src);
    const html = /<html\s/.exec(src);
    expect(call, 'no `await connection();` statement').not.toBeNull();
    expect(html, 'no <html …> element').not.toBeNull();
    expect(call!.index).toBeLessThan(html!.index);
  });

  it('no inline style attributes', () => {
    expect(all.filter((f) => /\bstyle=\{/.test(readFileSync(f, 'utf8')))).toEqual([]);
  });
});
