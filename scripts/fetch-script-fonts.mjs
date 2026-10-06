#!/usr/bin/env node
/**
 * Fetches the Noto faces of the scripts the site's own fonts do not cover
 * (spec §8 SCRIPT_FONTS; lib/fonts/scripts.ts) into public/fonts/, before
 * `next build` (package.json "build"). Each script gets one stylesheet,
 * public/fonts/<script>.css, which the guest root layout links only on a page
 * in that script, and which sets --font-script (styles/tokens.css).
 *
 * Why not next/font/google: its stylesheets go wherever the module is
 * imported, so every page, /en included, linked all three (about 700
 * @font-face rules, 520 kB). Why not commit the files: Google splits each CJK
 * face into about 120 unicode-range slices, which would put hundreds of files
 * in git. So the build fetches them, as next/font/google would have, and
 * serves them from this origin: the guest's browser never calls Google, and
 * fetches a slice only when the page uses a character in its range.
 *
 * A fetch that fails does not fail the build: that script's stylesheet then
 * names the systems' own CJK fonts (every phone and desktop has them), and the
 * script prints a warning. public/fonts/ is not committed (.gitignore).
 *
 * Options: --force fetches again even when the files are there.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'fonts');

/** Script key (lib/i18n/scripts.ts) → the Google family, and the systems' fonts if the fetch fails. */
export const SCRIPT_FAMILIES = {
  hangul: { family: 'Noto Sans KR', system: "'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans CJK KR', sans-serif" },
  'han-simplified': { family: 'Noto Sans SC', system: "'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif" },
  japanese: { family: 'Noto Sans JP', system: "'Hiragino Sans', 'Yu Gothic', 'Noto Sans CJK JP', sans-serif" },
};
const WEIGHTS = '400;500';
// Google answers woff2 with unicode-range slices only to a browser it knows.
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const CONCURRENCY = 16;

const force = process.argv.includes('--force');

async function get(url, as) {
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return as === 'text' ? res.text() : Buffer.from(await res.arrayBuffer());
}

/** The stylesheet when the fetch fails: no faces, the systems' fonts. */
const systemOnly = (script, { system }) =>
  `/* ${script}: the Noto files could not be fetched at build time; the systems' fonts instead. */\n:root{--font-script:${system};}\n`;

async function fetchScript(script, spec) {
  const sheet = join(OUT, `${script}.css`);
  const dir = join(OUT, script);
  if (!force && existsSync(sheet) && !(await readFile(sheet, 'utf8')).includes('could not be fetched')) {
    console.log(`  · ${script} (already fetched)`);
    return;
  }
  const query = `family=${encodeURIComponent(spec.family).replace(/%20/g, '+')}:wght@${WEIGHTS}&display=swap`;
  const css = await get(`https://fonts.googleapis.com/css2?${query}`, 'text');
  const urls = [...new Set([...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2)\)/g)].map((m) => m[1]))];
  if (urls.length === 0) throw new Error(`${spec.family}: no woff2 in Google's stylesheet`);

  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const local = new Map();
  for (let i = 0; i < urls.length; i += CONCURRENCY) {
    await Promise.all(
      urls.slice(i, i + CONCURRENCY).map(async (url) => {
        const name = `${createHash('sha256').update(url).digest('hex').slice(0, 16)}.woff2`;
        await writeFile(join(dir, name), await get(url));
        local.set(url, `/fonts/${script}/${name}`);
      }),
    );
  }
  const rewritten = css.replace(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2)\)/g, (_, url) => `url(${local.get(url)})`);
  await writeFile(
    sheet,
    `/* ${spec.family} (OFL 1.1), fetched from Google Fonts by scripts/fetch-script-fonts.mjs. */\n${rewritten}\n` +
      `:root{--font-script:'${spec.family}', ${spec.system};}\n`,
  );
  console.log(`  ✓ ${script}: ${urls.length} files`);
}

await mkdir(OUT, { recursive: true });
console.log('Script fonts (spec §8):');
let failed = 0;
for (const [script, spec] of Object.entries(SCRIPT_FAMILIES)) {
  try {
    await fetchScript(script, spec);
  } catch (err) {
    failed++;
    await rm(join(OUT, script), { recursive: true, force: true });
    await writeFile(join(OUT, `${script}.css`), systemOnly(script, spec));
    console.warn(`  ! ${script}: ${err.message}; its pages use the systems' fonts.`);
  }
}
if (failed) console.warn(`Warning: ${failed} script font(s) fell back to the systems' fonts.`);
