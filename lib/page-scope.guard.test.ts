import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * With Cache Components the router keeps the page you left in the document,
 * hidden by <Activity>. A document-wide query can then find the hidden page's
 * element instead of the visible one (the header's DESTINATIONS link on the
 * restaurant page did nothing in the phase-2 spike). Page content is queried
 * inside the visible page's root (useSite().pageRoot, usePageRoot()); only
 * these chrome-level queries may search the whole document.
 */
const ALLOWED = [
  "lib/motion.tsx: querySelectorAll('[data-header]')", // the headers live in the chrome
  'lib/motion.tsx: querySelectorAll(selector)', // overlay entrances (animateSelector)
];

const QUERY =
  /document\.(getElementById|querySelectorAll|querySelector|getElementsByClassName|getElementsByTagName)(?:<[^>]*>)?\(([^)]*)\)/g;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('DOM queries', () => {
  it('search the visible page, not the whole document', () => {
    const found = ['app', 'components', 'lib'].flatMap((dir) =>
      sources(dir).flatMap((file) =>
        [...readFileSync(file, 'utf8').matchAll(QUERY)].map((m) => `${file}: ${m[1]}(${m[2]})`),
      ),
    );
    expect(found.filter((q) => !ALLOWED.includes(q))).toEqual([]);
  });
});
