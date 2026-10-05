#!/usr/bin/env node
/**
 * Run after `next build`. Exits 1 and lists the problems if any check fails.
 *
 * 1. The guest pages must be fully prerendered with their cacheLife (every
 *    one 'hours': the layout reads today's offers, since the nav leaves out a
 *    section with nothing to show) and carry every cache tag their data
 *    readers declare, or a write that refreshes one of those tags (spec §6.2)
 *    would never reach them. The admin pages are the
 *    opposite (1b): no static shell at all, since a shell built at build time
 *    could not carry the per-request CSP nonce (spec §11). /api/availability
 *    (1c) must be built as a route handler, and must not be prerendered either.
 * 2. The web fonts must reach the pages as one family each. lib/fonts/index.ts
 *    loads every subset with its own localFont call and joins the calls into
 *    one family through `declarations`, which relies on the bundler naming a
 *    local family after the call's const (Turbopack in Next 16.3). If a bundler
 *    or Next change names them apart, latin-ext and Vietnamese text silently
 *    falls back to Times New Roman/Arial and nothing else fails, so the built
 *    CSS is checked here: every expected @font-face, under the one family the
 *    CSS variable names, with Google's unicode-range per subset, in Google's
 *    order, its file present, and its stylesheet linked from the pages.
 * 3. NEXT_PUBLIC_VERCEL_ENV must be inlined everywhere (next.config.ts `env`):
 *    BotID's browser half (instrumentation-client.ts) and server half
 *    (lib/server/guard/bot.ts) decide by it, and a bundle still reading it at
 *    runtime could check bookings the browser never sent through BotID, and
 *    refuse every guest.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

/** Route -> its file under .next/server/app (without the extension). */
const PAGES = {
  '/en': 'en',
  '/en/restaurants/taya-house': 'en/restaurants/taya-house',
  '/en/privacy': 'en/privacy',
};
/**
 * The (guarded) layout's tags: the catalogue, the chrome's content and the UI
 * strings. The chrome's nav follows the home page's own answer (getHomeContent
 * in lib/server/content/home-content.ts), so the layout reads the home page's
 * lists too: the hero slides, experiences, stories and today's offers.
 */
const TAGS = [
  'restaurants',
  'i18n:en',
  'locales',
  'content:ui',
  'content:sections',
  'content:cuisines',
  'content:destinations',
  'content:nav',
  'content:contact',
  'media',
  'content:hero',
  'content:experiences',
  'content:stories',
  'content:offers',
];
/** Tags a page carries beyond the layout's: a restaurant page's own (restaurants.ts), the privacy policy's text (legal.ts). */
const PAGE_TAGS = {
  '/en/restaurants/taya-house': ['restaurant:taya-house'],
  '/en/privacy': ['content:legal'],
};
/**
 * A prerendered page lives as long as its shortest cacheLife (cacheLife.md:144-147).
 * Every guest page reads today's offers through the layout (getOffers, 'hours':
 * 1 hour, 1 day), so every one revalidates hourly; the other loaders are 'max'.
 */
const LIFETIME = { revalidate: 3_600, expire: 86_400 };

/** The families lib/fonts/index.ts defines, by the CSS variable that carries each. */
const FONTS = [
  { variable: '--font-crimson', fallback: 'Crimson Pro Fallback', styles: ['italic', 'normal'] },
  { variable: '--font-be-vietnam', fallback: 'Be Vietnam Pro Fallback', styles: ['normal'] },
];
const WEIGHTS = ['300', '400', '500', '600'];
/**
 * Google's unicode-range for each subset, in the order the faces must be
 * declared: where ranges overlap, the face declared last wins.
 */
const SUBSETS = {
  vietnamese:
    'U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB',
  'latin-ext':
    'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF',
  latin:
    'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
};
const SUBSET_ORDER = Object.keys(SUBSETS);
/** Pages whose HTML must link the stylesheet with the faces (_not-found is app/global-not-found.tsx). */
const FONT_PAGES = ['en', 'en/restaurants/taya-house', '_not-found'];

const dir = join(process.cwd(), '.next');
const problems = [];

/* 1. Prerendering */
const manifest = JSON.parse(readFileSync(join(dir, 'prerender-manifest.json'), 'utf8'));
for (const [route, file] of Object.entries(PAGES)) {
  const entry = manifest.routes[route];
  if (!entry) {
    problems.push(`${route} is not prerendered`);
    continue;
  }
  if (entry.initialRevalidateSeconds !== LIFETIME.revalidate) {
    problems.push(`${route} revalidates after ${entry.initialRevalidateSeconds}s, expected ${LIFETIME.revalidate}s`);
  }
  if (entry.initialExpireSeconds !== LIFETIME.expire) {
    problems.push(`${route} expires after ${entry.initialExpireSeconds}s, expected ${LIFETIME.expire}s`);
  }
  const meta = JSON.parse(readFileSync(join(dir, 'server', 'app', `${file}.meta`), 'utf8'));
  if (meta.postponed) problems.push(`${route} is only partially prerendered`);
  const tags = String(meta.headers?.['x-next-cache-tags'] ?? '').split(',');
  for (const tag of [...TAGS, ...(PAGE_TAGS[route] ?? [])]) {
    if (!tags.includes(tag)) problems.push(`${route} is missing the cache tag ${tag}`);
  }
}

/* 1b. The admin has no static shell: its scripts could not carry the per-request CSP nonce (spec §11). */
const adminRoutes = [...Object.entries(manifest.routes), ...Object.entries(manifest.dynamicRoutes)].filter(
  ([route]) => route === '/admin' || route.startsWith('/admin/'),
);
// Next records an empty, blocking entry for every admin route; finding none means the check sees nothing.
if (adminRoutes.length === 0) problems.push('no /admin route in the prerender manifest');
for (const [route, entry] of adminRoutes) {
  if (entry.response !== 'empty' || entry.htmlSize !== 0) {
    problems.push(`${route} has a static shell (response ${entry.response}, ${entry.htmlSize} bytes); admin pages must render at request time`);
  }
}

/*
 * 1c. Availability is never cached (spec §6.2): a GET handler that stops
 * reading the request is prerendered at build time, and every guest would get
 * the build's slots. The crons likewise: prerendered, the outbox's one
 * build-time run would be all the sending it ever did (spec §10.4), and the
 * daily one would never revalidate the offers again (spec §6.2). None of these
 * routes may be in the prerender manifest at all.
 * It must also be in the build as a route handler: a moved or renamed route
 * is missing from the prerender manifest too, so that test alone would pass
 * on a build without it.
 */
const UNCACHED = ['/api/availability', '/api/cron/outbox', '/api/cron/daily', '/api/admin/emails/preview', '/api/admin/media/upload'];
const appPaths = JSON.parse(readFileSync(join(dir, 'server', 'app-paths-manifest.json'), 'utf8'));
for (const route of UNCACHED) {
  if (!appPaths[`${route}/route`]) {
    problems.push(`${route} is missing from the build (no ${route}/route handler in .next/server/app-paths-manifest.json)`);
  }
  if (manifest.routes[route] || manifest.dynamicRoutes[route]) problems.push(`${route} is prerendered; it must run per request`);
}

/* 2. Fonts */
const fontSummary = checkFonts();

/*
 * 3. BotID's switch. A read left in a bundle is `process.env.NEXT_PUBLIC_VERCEL_ENV`
 * on the server, and in the browser Turbopack's process polyfill (for example
 * `r.default.env.NEXT_PUBLIC_VERCEL_ENV`), so the pattern starts at `.env.`.
 * Only what runs is checked: the server's source maps carry the original
 * source (sourcesContent), where the expression rightly stays.
 */
const RUNTIME_ENV = /\.env\.NEXT_PUBLIC_VERCEL_ENV\b/;
const bundles = ['server', 'static'].flatMap((d) => listFiles(join(dir, d))).filter((f) => !f.endsWith('.map'));
for (const file of bundles.filter((f) => RUNTIME_ENV.test(readFileSync(f, 'utf8')))) {
  problems.push(`${relative(process.cwd(), file)} reads NEXT_PUBLIC_VERCEL_ENV at runtime; next.config.ts must inline it (env)`);
}

if (problems.length) {
  console.error(`Prerender and font check failed:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(
  `Prerender check passed: ${Object.keys(PAGES).join(', ')} (tags: ${TAGS.join(', ')}; ${Object.entries(PAGE_TAGS).map(([route, tags]) => `${route} also ${tags.join(', ')}`).join('; ')}; lifetimes: ${Object.keys(PAGES).map((route) => `${route} ${LIFETIME.revalidate}/${LIFETIME.expire}s`).join(', ')}).`,
);
console.log(`Admin check passed: ${adminRoutes.map(([route]) => route).join(', ')} have no static shell.`);
console.log(`Uncached check passed: ${UNCACHED.join(', ')} built as a route handler, not prerendered.`);
console.log(`Font check passed: ${fontSummary}.`);
console.log(`Inlined env check passed: none of ${bundles.length} files under .next/server and .next/static reads NEXT_PUBLIC_VERCEL_ENV at runtime.`);

function checkFonts() {
  const sheets = listFiles(join(dir, 'static'))
    .filter((f) => f.endsWith('.css'))
    .map((file) => ({ file, css: readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '') }));
  const faces = sheets.flatMap(({ file, css }) =>
    [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => {
      const d = parseDeclarations(m[1]);
      const weight = { normal: '400', bold: '700' }[d['font-weight']] ?? d['font-weight'] ?? '400';
      return { ...d, file, family: d['font-family'], style: d['font-style'] ?? 'normal', weight };
    }),
  );
  const expectedTotal = FONTS.reduce((n, f) => n + f.styles.length * WEIGHTS.length * SUBSET_ORDER.length + 1, 0);
  if (faces.length !== expectedTotal) {
    problems.push(`the built CSS has ${faces.length} @font-face rules, expected ${expectedTotal}`);
  }
  const ranges = Object.fromEntries(SUBSET_ORDER.map((s) => [canonicalRange(SUBSETS[s]), s]));
  const known = new Set();
  const summary = [`${faces.length} @font-face rules`];

  for (const font of FONTS) {
    const values = new Set(
      sheets.flatMap(({ css }) =>
        [...css.matchAll(new RegExp(`${font.variable}\\s*:\\s*([^;}]+)`, 'g'))].map((m) => m[1].trim()),
      ),
    );
    if (values.size !== 1) {
      problems.push(`${font.variable} is defined ${values.size} different ways in the built CSS, expected 1`);
      continue;
    }
    const stack = [...values][0].split(',').map(unquote);
    const family = stack[0];
    known.add(family).add(font.fallback);
    if (!stack.includes(font.fallback)) problems.push(`${font.variable} does not list ${font.fallback}`);

    const own = faces.filter((f) => f.family === family);
    const expected = font.styles.length * WEIGHTS.length * SUBSET_ORDER.length;
    if (own.length !== expected) {
      problems.push(`${font.variable} names the family "${family}", which has ${own.length} @font-face rules, expected ${expected}`);
    }
    for (const style of own.length ? font.styles : []) {
      for (const weight of WEIGHTS) {
        const group = own.filter((f) => f.style === style && f.weight === weight);
        const order = group.map((f) => ranges[canonicalRange(f['unicode-range'] ?? '')] ?? 'an unknown unicode-range');
        const files = [...new Set(group.map((f) => relative(process.cwd(), f.file)))];
        if (order.join() !== SUBSET_ORDER.join() || files.length > 1) {
          problems.push(
            `"${family}" ${style} ${weight} has faces for [${order.join(', ')}]${files.length > 1 ? ` across ${files.join(', ')}` : ''}, expected [${SUBSET_ORDER.join(', ')}] in that order in one stylesheet`,
          );
        }
      }
    }
    for (const face of own) {
      if (face['font-display'] !== 'swap') problems.push(`a "${family}" face has font-display ${face['font-display']}, expected swap`);
      const url = /url\(\s*['"]?([^'")?#]+)/.exec(face.src ?? '')?.[1];
      const path = url && (url.startsWith('/_next/') ? join(dir, url.slice('/_next/'.length)) : join(dirname(face.file), url));
      if (!path || !existsSync(path)) problems.push(`a "${family}" face points at ${url ?? 'no file'}, which is not in the build`);
    }
    const fallbacks = faces.filter((f) => f.family === font.fallback);
    if (fallbacks.length !== 1 || !/^local\(/.test(fallbacks[0].src ?? '')) {
      problems.push(`expected one local() @font-face for "${font.fallback}", found ${fallbacks.length}`);
    }
    summary.push(`"${family}" ${own.length} faces (${SUBSET_ORDER.join(', ')} x ${font.styles.join('/')} x ${WEIGHTS.join('/')})`);
  }

  // A subset that drifted into a family of its own: its glyphs would never be used.
  const stray = Object.entries(Object.groupBy(faces.filter((f) => !known.has(f.family)), (f) => f.family));
  for (const [family, list] of stray) {
    problems.push(`${list.length} @font-face rules use the family "${family}", which no font variable names (a subset split off from its family?)`);
  }

  const fontSheets = new Set(faces.map((f) => `/_next/${relative(dir, f.file).split(sep).join('/')}`));
  for (const page of FONT_PAGES) {
    const htmlFile = join(dir, 'server', 'app', `${page}.html`);
    const html = existsSync(htmlFile) ? readFileSync(htmlFile, 'utf8') : '';
    for (const href of fontSheets) {
      // No closing quote: a deployment id may follow as ?dpl=...
      if (!html.includes(`href="${href}`)) problems.push(`/${page} does not link the font stylesheet ${href}`);
    }
  }
  summary.push(`linked from ${FONT_PAGES.map((p) => `/${p}`).join(', ')}`);
  return summary.join('; ');
}

/** All files below `root`. */
function listFiles(root) {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => join(d.parentPath, d.name));
}

/** The descriptors of one @font-face body; `;` inside quotes or parentheses does not split. */
function parseDeclarations(body) {
  const out = {};
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let i = 0; i <= body.length; i++) {
    const c = body[i];
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '(') depth++;
    else if (c === ')') depth--;
    else if ((c === ';' || c === undefined) && depth === 0) {
      const decl = body.slice(start, i);
      const colon = decl.indexOf(':');
      if (colon > 0) {
        const prop = decl.slice(0, colon).trim().toLowerCase();
        const value = decl.slice(colon + 1).trim();
        out[prop] = prop === 'font-family' ? unquote(value) : value;
      }
      start = i + 1;
    }
  }
  return out;
}

function unquote(value) {
  return value.trim().replace(/^(['"])(.*)\1$/, '$2');
}

/** A unicode-range as merged code point intervals, so U+0000-00FF, U+0-FF and U+?? compare equal. */
function canonicalRange(value) {
  const spans = value
    .split(',')
    .map((t) => t.trim().toUpperCase().replace(/^U\+/, ''))
    .filter(Boolean)
    .map((t) => {
      if (t.includes('?')) return [t.replaceAll('?', '0'), t.replaceAll('?', 'F')];
      const [a, b = a] = t.split('-');
      return [a, b];
    })
    .map(([a, b]) => [parseInt(a, 16), parseInt(b, 16)])
    .sort((x, y) => x[0] - y[0]);
  const merged = [];
  for (const [a, b] of spans) {
    const last = merged.at(-1);
    if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  return merged.map(([a, b]) => (a === b ? a.toString(16) : `${a.toString(16)}-${b.toString(16)}`)).join(',');
}
