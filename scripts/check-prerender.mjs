#!/usr/bin/env node
/**
 * Run after `next build`. The guest pages must be fully prerendered with
 * cacheLife('max') and carry every cache tag their data readers declare, or a
 * write that refreshes one of those tags (spec §6.2) would never reach them.
 * Exits 1 and lists the problems otherwise.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Route -> its file under .next/server/app (without the extension). */
const PAGES = {
  '/en': 'en',
  '/en/restaurants/taya-house': 'en/restaurants/taya-house',
};
const TAGS = ['restaurants', 'i18n:en', 'locales', 'content:ui'];
const REVALIDATE = 2_592_000; // cacheLife('max'): 30 days
const EXPIRE = 31_536_000; // 1 year

const dir = join(process.cwd(), '.next');
const manifest = JSON.parse(readFileSync(join(dir, 'prerender-manifest.json'), 'utf8'));
const problems = [];

for (const [route, file] of Object.entries(PAGES)) {
  const entry = manifest.routes[route];
  if (!entry) {
    problems.push(`${route} is not prerendered`);
    continue;
  }
  if (entry.initialRevalidateSeconds !== REVALIDATE) {
    problems.push(`${route} revalidates after ${entry.initialRevalidateSeconds}s, expected ${REVALIDATE}s`);
  }
  if (entry.initialExpireSeconds !== EXPIRE) {
    problems.push(`${route} expires after ${entry.initialExpireSeconds}s, expected ${EXPIRE}s`);
  }
  const meta = JSON.parse(readFileSync(join(dir, 'server', 'app', `${file}.meta`), 'utf8'));
  if (meta.postponed) problems.push(`${route} is only partially prerendered`);
  const tags = String(meta.headers?.['x-next-cache-tags'] ?? '').split(',');
  for (const tag of TAGS) {
    if (!tags.includes(tag)) problems.push(`${route} is missing the cache tag ${tag}`);
  }
}

if (problems.length) {
  console.error(`Prerender check failed:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`Prerender check passed: ${Object.keys(PAGES).join(', ')} (tags: ${TAGS.join(', ')}).`);
