# Phase 2 data foundation: migration 004 (locales, content_strings, destinations), i18n registry, strings and locales read layer

## Verified patterns

All files below WORKED in the clone `/private/tmp/claude-501/-Users-bcmac-Desktop-projects-Outside-Projects-furama-cuisine/e860bf94-efdc-4015-b5d3-085d89bca850/scratchpad/spike-data` (the plan can copy them verbatim; paths are repo-relative). The cached getters were also proven in a minimal Next 16.3.7 app with cacheComponents and partialPrefetching at `.../scratchpad/spike-data-next` (own build and `next start` on port 3284, now killed; lsof shows nothing).

Evidence:
- `RESET_DATABASE_URL=postgres://localhost:5432/furama_cuisine_spikedata_test node scripts/reset-db.mjs` printed `✓ 001 ... ✓ 004_foundations_locales_strings_destinations.sql, Applied 4 migration(s).`
- `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_spikedata_test TZ=UTC npx vitest run` gave `Test Files 14 passed (14), Tests 110 passed (110)`. Baseline was 68; the +42 are the new tests below. The `003` stack trace in the output is the existing migration-003 "stops on duplicates" test failing on purpose.
- `npx tsc --noEmit` printed nothing, so it is clean. `npx oxlint` shows only warnings that were already there.

## 1. `db/migrations/004_foundations_locales_strings_destinations.sql`
```sql
-- Phase 2 foundations shared by the booking and content branches
-- (spec §5.1, §5.2 "Nền tảng"): the language list, translatable UI strings
-- and the destinations. Every statement is idempotent; every seed is
-- ON CONFLICT DO NOTHING so a re-run never overwrites what an editor changed.

-- ── locales ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS locales (
  -- Used in URLs: en, vi, zh-hans. Lower case; region/script subtags allowed.
  code          text PRIMARY KEY
                CHECK (code ~ '^[a-z]{2,3}(-[a-z0-9]{2,8})*$'),
  bcp47         text        NOT NULL CHECK (bcp47 ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  native_name   text        NOT NULL CHECK (native_name <> ''),
  short_label   text        NOT NULL CHECK (short_label <> ''),
  -- Key into SCRIPT_FONTS in code. Not an enum here: the list lives in code.
  script        text        NOT NULL CHECK (script <> ''),
  is_default    boolean     NOT NULL DEFAULT false,
  is_enabled    boolean     NOT NULL DEFAULT false,
  -- Show machine-translated rows to guests for this locale.
  serve_machine boolean     NOT NULL DEFAULT false,
  sort_order    integer     NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text,
  -- The default language is always served.
  CONSTRAINT locales_default_enabled CHECK (NOT is_default OR is_enabled)
);

-- At most one default (the index is on a constant, so a second TRUE collides).
CREATE UNIQUE INDEX IF NOT EXISTS locales_single_default_idx
  ON locales ((true)) WHERE is_default;

INSERT INTO locales (code, bcp47, native_name, short_label, script, is_default, is_enabled, sort_order)
VALUES
  ('en', 'en', 'English',    'EN', 'latin',      true,  true,  10),
  ('vi', 'vi', 'Tiếng Việt', 'VI', 'vietnamese', false, false, 20)
ON CONFLICT DO NOTHING;

-- ── content_strings ────────────────────────────────────────────────────────
-- Which keys exist is decided by lib/i18n/registry.ts; this table only holds
-- overrides and translations. Empty at first: readers fall back to the registry.
CREATE TABLE IF NOT EXISTS content_strings (
  key         text        NOT NULL
              CHECK (key ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$'),
  locale      text        NOT NULL REFERENCES locales (code) ON UPDATE CASCADE ON DELETE CASCADE,
  value       text        NOT NULL,  -- ICU MessageFormat
  status      text        NOT NULL DEFAULT 'reviewed' CHECK (status IN ('machine', 'reviewed')),
  origin      text        NOT NULL DEFAULT 'human'    CHECK (origin IN ('human', 'ai', 'seed')),
  ai_model    text,
  source_hash text,
  reviewed_by text,
  reviewed_at timestamptz,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text,
  PRIMARY KEY (key, locale)
);

-- Lookups are per locale (all overrides for one language).
CREATE INDEX IF NOT EXISTS content_strings_locale_idx ON content_strings (locale);

-- ── destinations ───────────────────────────────────────────────────────────
-- Non-translatable columns only; names, addresses and card copy join in
-- destination_i18n in phase 6. card_image_id has no FK yet: `media` does not
-- exist until phase 6, which adds the constraint.
CREATE TABLE IF NOT EXISTS destinations (
  id             text PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'),
  kind           text        NOT NULL CHECK (kind IN ('venue', 'teaser')),
  card_image_id  uuid,
  phone_e164     text        CHECK (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  phone_display  text,
  email          text        CHECK (email ~ '^[^@\s]+@[^@\s]+$'),
  map_url        text        CHECK (map_url ~ '^https://'),
  show_in_footer boolean     NOT NULL DEFAULT false,
  sort_order     integer     NOT NULL DEFAULT 0,
  is_published   boolean     NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     text,
  -- A phone number is shown as typed by staff; it needs the dialable form too.
  CONSTRAINT destinations_phone_pair CHECK ((phone_e164 IS NULL) = (phone_display IS NULL))
);

-- From lib/data.ts (DESTS, DESTINATION_CARDS, CONTACT) and the footer.
-- The footer lists the resort and the dining house only. The shared email
-- (CONTACT.email) belongs to site_settings in phase 6, so it is not copied here.
INSERT INTO destinations (id, kind, phone_e164, phone_display, map_url, show_in_footer, sort_order)
VALUES
  ('resort',       'venue',  '+842366519999', '+84 236 651 9999', 'https://maps.google.com/?q=Furama+Resort+Danang', true,  10),
  ('dining-house', 'venue',  '+84859555759',  '0859 555 759',     NULL,                                               true,  20),
  ('mm',           'venue',  NULL,            NULL,               NULL,                                               false, 30),
  ('future',       'teaser', NULL,            NULL,               NULL,                                               false, 40)
ON CONFLICT DO NOTHING;

-- restaurants.destination already holds these ids as text. Constrain it now so
-- a typo cannot create an orphan; phase 6 adds destination_id and phase 10
-- drops this column together with its constraint.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'restaurants_destination_fk') THEN
    ALTER TABLE restaurants
      ADD CONSTRAINT restaurants_destination_fk
      FOREIGN KEY (destination) REFERENCES destinations (id) ON UPDATE CASCADE;
  END IF;
END $$;
```
Design notes:
- Migration number: 004 is the next free one after 003.
- `card_image_id` has no FK. There is no media table until phase 6, which adds the constraint.
- The `(true)` expression index is the single-default guard.
- `locales_default_enabled` makes it impossible to disable the default language.
- `script` is a plain non-empty text. The allowed set lives in code (`SCRIPT_FONTS`).
- Seeded script values `latin` and `vietnamese` are an assumption. The spec only says Latin and Vietnamese share the current font. Phase 8 decides the real keys.
- The seed copies only what lib/data.ts has. No dining-house map URL or email is invented. `CONTACT.email` is a single shared address and is left for `site_settings`.

## 2. `lib/cache-tags.ts`
```ts
export const TAGS = {
  /** Which languages exist and which are enabled. */
  locales: 'locales',
  /** UI strings: ui.*, form.*, error.*, search.*, common.* */
  contentUi: 'content:ui',
  /** Everything served in one language; refreshed when it is enabled or disabled. */
  i18n: (locale: string) => `i18n:${locale}`,
} as const;
```
Only the tags that have a reader in phase 2 are defined. Each later phase adds its own, with the same names as spec §6.2.

## 3. `lib/i18n/registry.ts`
Full file is in the clone. Shape (the first three of the 12 `error.*` entries shown here):
```ts
export const ADMIN_SCREENS = ['hero','booking','navigation','contact','seo','legal','emails','ui-text'] as const; // spec §7.2
export type AdminScreen = (typeof ADMIN_SCREENS)[number];
export type StringDef = {
  en: string;                 // English default, always present
  vi?: string;                // only email.* / legal.* (later phases)
  maxLength: number;
  vars?: readonly string[];   // {name} placeholders
  context: string;            // for translators and the AI
  screen: AdminScreen;        // admin screen that edits this key
};
export const REGISTRY = {
  'error.restaurant_unavailable': { en: 'That restaurant is no longer available.', maxLength: 140,
    context: 'Shown under the reservation form when the chosen restaurant stopped taking online bookings.', screen: 'ui-text' },
  'error.party_too_large': { en: 'Please choose between 1 and 12 guests.', maxLength: 140, context: '...', screen: 'ui-text' },
  'error.slot_unavailable': { en: '{restaurant} does not serve at that time.', maxLength: 140, vars: ['restaurant'],
    context: 'The time is not in the restaurant’s service hours. {restaurant} is the restaurant name; keep it as is.', screen: 'ui-text' },
  // ...past, invalid_name, invalid_phone, invalid_email, full, duplicate, unknown, network, outside_window:
  // the same 12 codes and the same English text as the old MESSAGES in lib/booking-errors.ts
} as const satisfies Record<string, StringDef>;   // `satisfies` keeps the literal key names

export type StringKey = keyof typeof REGISTRY;
export const STRING_KEYS = Object.keys(REGISTRY) as StringKey[];
export const KEY_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;   // same regex as the DB CHECK
export const CLIENT_KEYS = STRING_KEYS.filter((k) => k.startsWith('error.')) as StringKey[];  // grows per component moved to t()
export function registryLocaleDefault(key: StringKey, locale: string): string | undefined {
  const def: StringDef = REGISTRY[key];
  return locale === 'vi' ? def.vi : undefined;
}
```

## 4. `lib/i18n/format.ts` (no ICU library in phase 2)
```ts
export type MessageParams = Record<string, string | number>;
export function formatMessage(template: string, params: MessageParams = {}, _locale = 'en'): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}
/** True when the text uses ICU syntax beyond {name} (plural, select, nested braces). */
export function usesIcuSyntax(template: string): boolean {
  return /\{\s*\w+\s*,/.test(template) || /\{[^{}]*\{/.test(template);
}
```

## 5. `lib/i18n/resolve.ts` (pure, no server-only, unit-testable)
```ts
import { REGISTRY, registryLocaleDefault, type StringKey } from './registry';
export type StringRow = { key: string; locale: string; value: string };
/** Per key: row in `locale` -> registry text for that locale -> row in default language -> registry English. */
export function resolveStrings<K extends StringKey>(
  rows: readonly StringRow[], keys: readonly K[], locale: string, defaultLocale: string,
): Record<K, string> {
  const at = new Map<string, string>();
  for (const r of rows) at.set(`${r.key}\u0000${r.locale}`, r.value);
  const out = {} as Record<K, string>;
  for (const key of keys) {
    out[key] =
      at.get(`${key}\u0000${locale}`) ??
      registryLocaleDefault(key, locale) ??
      at.get(`${key}\u0000${defaultLocale}`) ??
      REGISTRY[key].en;
  }
  return out;
}
```

## 6. `lib/server/content/strings.queries.ts` (uncached loader, testable)
```ts
import 'server-only';
import { query } from '@/db/client';
import type { StringRow } from '@/lib/i18n/resolve';

export async function loadStringRows(locale: string, keys: readonly string[]): Promise<{ defaultLocale: string; rows: StringRow[] }> {
  const defaults = await query<{ code: string }>('SELECT code FROM locales WHERE is_default');
  const defaultLocale = defaults[0]?.code ?? 'en';
  if (keys.length === 0) return { defaultLocale, rows: [] };
  const rows = await query<StringRow>(
    `SELECT cs.key, cs.locale, cs.value
       FROM content_strings cs
       JOIN locales l ON l.code = cs.locale
      WHERE cs.key = ANY($1::text[])
        AND cs.locale IN ($2, $3)
        AND (cs.locale = $3
             OR cs.status = 'reviewed'
             OR (cs.status = 'machine' AND l.serve_machine))`,
    [keys, locale, defaultLocale],
  );
  return { defaultLocale, rows };
}
```

## 7. `lib/server/content/strings.ts` (cached wrapper)
```ts
import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { TAGS } from '@/lib/cache-tags';
import type { StringKey } from '@/lib/i18n/registry';
import { resolveStrings } from '@/lib/i18n/resolve';
import { loadStringRows } from './strings.queries';

export async function getStrings<K extends StringKey>(locale: string, keys: readonly K[]): Promise<Record<K, string>> {
  'use cache';
  cacheLife('max');
  cacheTag(TAGS.contentUi, TAGS.i18n(locale));
  const { defaultLocale, rows } = await loadStringRows(locale, keys);
  return resolveStrings(rows, keys, locale, defaultLocale);
}
```
The cache wrapper is deliberately a separate file. Outside Next, `cacheTag()` and `cacheLife()` throw ("only available with the `cacheComponents` config"), which I checked in Vitest. So the wrapper cannot be imported by Vitest; the loader and `resolveStrings` carry the logic and the tests.

## 8. `lib/server/content/locales.queries.ts` and `locales.ts`
```ts
// locales.queries.ts
import 'server-only';
import { query } from '@/db/client';
export type SiteLocale = { code: string; bcp47: string; nativeName: string; shortLabel: string; script: string; isDefault: boolean; serveMachine: boolean };
export async function loadEnabledLocales(): Promise<SiteLocale[]> {
  const rows = await query<{ code: string; bcp47: string; native_name: string; short_label: string; script: string; is_default: boolean; serve_machine: boolean }>(
    `SELECT code, bcp47, native_name, short_label, script, is_default, serve_machine
       FROM locales WHERE is_enabled ORDER BY sort_order, code`);
  return rows.map((r) => ({ code: r.code, bcp47: r.bcp47, nativeName: r.native_name, shortLabel: r.short_label,
    script: r.script, isDefault: r.is_default, serveMachine: r.serve_machine }));
}
// locales.ts
import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { TAGS } from '@/lib/cache-tags';
import { loadEnabledLocales, type SiteLocale } from './locales.queries';
export type { SiteLocale };
export async function getEnabledLocales(): Promise<SiteLocale[]> {
  'use cache';
  cacheLife('max');
  cacheTag(TAGS.locales);
  return loadEnabledLocales();
}
```

## 9. `lib/booking-errors.ts` (copy moves to the registry; the old call sites keep working)
`BOOKING_ERROR_CODES` and `BookingErrorCode` are unchanged. The `MESSAGES` map is deleted, and the file now ends with:
```ts
import { formatMessage } from '@/lib/i18n/format';
import { REGISTRY } from '@/lib/i18n/registry';
export type ErrorKey = `error.${BookingErrorCode}`;
export type ErrorStrings = Record<ErrorKey, string>;
/** Indexing REGISTRY by every code is the compile-time check that each code has a key. */
export const DEFAULT_ERROR_STRINGS = Object.fromEntries(
  BOOKING_ERROR_CODES.map((code) => [`error.${code}`, REGISTRY[`error.${code}`].en]),
) as ErrorStrings;
const DEFAULT_PARAMS: Record<string, string> = { restaurant: 'The restaurant' };
export function bookingErrorMessage(code: BookingErrorCode, params: Record<string, string> = {}, strings: ErrorStrings = DEFAULT_ERROR_STRINGS): string {
  return formatMessage(strings[`error.${code}`], { ...DEFAULT_PARAMS, ...params });
}
```
All 3 existing calls in `SiteProvider.tsx` (lines 390, 414, 427) still compile unchanged. The phase 2 task then passes `strings` as the third argument, taken from a `SiteProvider` prop.

## 10. Wiring in the Server Component tree (proven in the spike app, `spike-data-next`)
```ts
// app/(site)/[lang]/layout.tsx
import { notFound } from 'next/navigation';
import { lang } from 'next/root-params';
import { getEnabledLocales } from '@/lib/server/content/locales';
export async function generateStaticParams() {
  const codes = (await getEnabledLocales()).map((l) => l.code);
  return (codes.includes('en') ? codes : ['en', ...codes]).map((code) => ({ lang: code }));
}
export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const code = await lang();
  const locale = (await getEnabledLocales()).find((l) => l.code === code);
  if (!locale) notFound();
  return <html lang={locale.bcp47}><body>{children}</body></html>;
}
// page or layout: const strings = await getStrings(await lang(), CLIENT_KEYS);  -> <SiteProvider strings={strings}>
```
Config: `next.config.ts` with `cacheComponents: true, partialPrefetching: true`.

Spike outcomes (real `next build` + `next start -p 3284`, DB `furama_cuisine_spikedata_test`):
- Build output: `/en` and `/vi` are `○` (static), `/[lang]` is `◐` (partial prerender), and `/api/revalidate` is `ƒ`. The build needs a reachable DB, because `generateStaticParams` reads `locales` at build time.
- `/en` served the registry default while `content_strings` was empty.
- After `INSERT ... ('error.full','en','EDITED in DB')` and before any revalidation, `/en` still served the old text, so the cache works.
- After `POST /api/revalidate` (`revalidateTag('content:ui','max')`), the first request was still stale and the second one showed `EDITED in DB`. This is stale-while-revalidate. Server Actions must use `updateTag` for read-your-own-writes (spec §6.2 already says so).
- `/vi` with no vi rows served the English DB override. The per-key fallback works.
- `/fr` returned 404.
- A disabled `vi` kept returning 200 until `revalidateTag('locales','max')` was called. After that, two requests gave 404. Re-enabling gave 200 again. So the "disable language" write must refresh `locales` and `i18n:<code>`.

## 11. Tests that passed
- `lib/i18n/registry.test.ts`, per key:
  - the key matches `KEY_PATTERN`, `en` is not longer than `maxLength`, and `context` is not empty;
  - `screen` is in `ADMIN_SCREENS`;
  - the `{vars}` used in en and vi equal the declared `vars`;
  - no ICU syntax is used.
  It also covers `formatMessage`, `usesIcuSyntax` and the `resolveStrings` fallback chain.
- `lib/booking-errors.test.ts`: the original 3 tests still pass unchanged, plus 1 test for an override string that keeps `{restaurant}`.
- `test/integration/migration-004.test.ts`, with its own DB `furama_cuisine_spikedata_mig_test` (it uses `resetDatabase`, `migrate` and `withClient` from `test/helpers/db.ts`):
  - seeds: locales en and vi, and the 4 destinations with the exact phone values;
  - `content_strings` starts empty;
  - every seeded restaurant maps to a destination, and `UPDATE restaurants SET destination='nowhere'` is rejected by `restaurants_destination_fk`;
  - a second default locale is rejected by `locales_single_default_idx`;
  - disabling the default language is rejected by `locales_default_enabled`;
  - bad locale codes are rejected: `'EN','e','zh_hans','zh-','-en','en us',''`;
  - `zh-hans` and `ko` are accepted;
  - bad content key, status and origin are rejected;
  - unknown locale and duplicate `(key, locale)` are rejected;
  - FK cascade: renaming `ko` to `kr` carries its strings, deleting `kr` removes them, and the `en` row survives;
  - destination id, kind, `phone_e164`, `phone_pair` and `map_url` CHECKs fire;
  - idempotency: re-running the file keeps 4 destinations and 2 locales and keeps an edited `phone_display`;
  - migrating on top of a DB at 003 that already holds a reservation leaves that reservation and adds the 4 destinations.
- `test/integration/content-strings.test.ts` (uses the global `TEST_DATABASE_URL` DB, cleans up in `beforeEach` and `afterAll`):
  - registry defaults are returned when the table is empty;
  - an en override is served;
  - reviewed vi rows are shown and a missing key falls back to the en row;
  - machine rows are hidden by default and shown after `serve_machine=true`;
  - `CLIENT_KEYS` are read in one query;
  - `loadEnabledLocales` returns only enabled locales, in `sort_order`.
- Gap: the `'use cache'` wrappers have no Vitest test. They were verified through the real build only (section 10). The plan should add either an e2e check or a build-time smoke check for them.

## Errors hit
- **Calling `cacheTag()` / `cacheLife()` from Vitest throws: `cacheTag()` is only available with the `cacheComponents` config.**
  - cause: next/cache's cacheTag and cacheLife only work inside the Next runtime with cacheComponents enabled; the 'use cache' directive is a plain no-op string under plain Node.
  - fix: Split each reader into an uncached `*.queries.ts` loader plus a pure `resolveStrings`, both covered by Vitest, and a thin `'use cache'` wrapper (`strings.ts`, `locales.ts`) that is checked only by next build and next start.
- **EADDRINUSE (errno -48) on `next start -p 3237`; curl on that port returned another project's page with `GLOBAL not-found`.**
  - cause: Another concurrent spike was already listening on 3237 (lsof showed PID 27132, not mine).
  - fix: Left that process alone and used port 3284 after confirming with lsof that it was free. Killed only my own server by `lsof -ti :3284`. Port 3237 and 3284 were not touched by me beyond this.
- **A Bash command with `rm -rf app/*` after `cd` was blocked by the safety check; the flagged path resolved to the original repo's `app/*`. The command did not run (git status in the original repo stays clean).**
  - cause: The relative glob after `cd` could not be resolved statically.
  - fix: Never used a glob or rm in this form again. Built the Next probe app by copying only the pieces needed into a fresh dir with `cp -cR node_modules lib db package.json`, and wrote the new `app/` there.
- **After the first integration run, `locales.vi` was left enabled, so the Next probe build produced `/vi` unexpectedly.**
  - cause: The last test in content-strings.test.ts enabled vi and nothing reset it.
  - fix: Added an `afterAll` that deletes content_strings and resets is_enabled and serve_machine, so later runs and builds start from the seed state.

## Recommended task breakdown

Split into 5 small tasks. Each is TDD, and each ends with `npm test` (with TEST_DATABASE_URL), `npm run typecheck`, `npm run lint` all green.

**T1: Migration 004 and its integration test.** Copy the SQL and `test/integration/migration-004.test.ts` from the clone. No code depends on it yet. Use a unique throwaway DB name for the migration test, because the existing 003 test shares `furama_cuisine_migrate_test`. Run it on Neon `dev` afterwards with `npm run db:migrate`. It is additive and safe, but production still gets it only at deploy.

**T2: Registry, format, resolve, cache-tags and the `booking-errors` change.** Files: `lib/cache-tags.ts`, `lib/i18n/{registry,format,resolve}.ts` with `registry.test.ts`, and the `lib/booking-errors.ts` change with its test. Pure code, no DB.

**T3: Read layer.** Files: `lib/server/content/{strings,locales}.queries.ts` and `{strings,locales}.ts`, plus `test/integration/content-strings.test.ts`. The `'use cache'` wrappers can only be checked after T4, so the tests here only cover the loaders.

**T4: Turn on `cacheComponents` and `partialPrefetching`, and restructure `app/(site)/[lang]`.** This is the big one and is owned by the route-restructure part of phase 2. Order matters:
1. Set the config flags.
2. Remove `export const revalidate = 3600` from the root layout; it conflicts with Cache Components.
3. Move to `app/(site)/[lang]/layout.tsx`, using the `generateStaticParams` and `notFound` shape from section 10.
4. Call `getStrings(await lang(), CLIENT_KEYS)` and pass `strings` to `SiteProvider`. Replace the 3 `bookingErrorMessage` calls so they pass those strings.
5. Wrap `listRestaurants()` in a `'use cache'` getter tagged `restaurants`. It currently runs on every render of the root layout.
6. Add smoke checks with e2e or `next build`: `/en` renders, `/fr` is 404, and `/en` shows a changed string after an update plus revalidate.

**T5: Remaining phase 2 items.** Both are outside this spike:
- Slug keys for cuisines and meals.
- Use `destinations` to remove the footer hardcodes. This is optional; the phase 2 acceptance ("looks identical") does not need it. If done, read destinations through a `'use cache'` getter tagged `content:contact` (this tag is not defined in `cache-tags.ts` yet; the spike only defined `locales`, `content:ui`, `i18n:<code>`). Do not do it in the same commit as T4.

Dependencies: T1 and T2 are independent. T3 needs T1 and T2. T4 needs T2 and T3.

## Risks / open questions
- RECOMMENDATION on question 2 (FK now?): yes. 004 already adds restaurants_destination_fk (restaurants.destination -> destinations.id, ON UPDATE CASCADE). The ids already match DestKey, so it is one statement that makes a seed typo fail loudly (the test proves it). It costs nothing in phase 6, which adds destination_id as a new column and backfills it from the old one. Phase 10 then drops the text column together with this constraint. The spec's "destination_id arrives in phase 6" is not contradicted, because the constraint sits on the old column. If the team wants the strictest reading, delete the DO block; nothing else depends on it.
- SCOPE: do NOT do these in phase 2 (YAGNI). (a) intl-messageformat: version 12.1.2 exists on npm (`npm view intl-messageformat version`), but phase 2 has one variable ({restaurant}), and the spec's ICU/Intl item (6.3 item 4: Intl, plurals, remove the WD/MO arrays) is not in the phase 2 row of 14.1. Add it with the first plural or select string, probably phase 6 or 7. `formatMessage(template, params, locale)` already has the right signature, so callers will not change. The registry test blocks ICU syntax in defaults until then, so nothing sneaks in. (b) Registering any key beyond the 12 error.* keys: the content inventory and the ui/form/search keys belong to phase 7, when the editor exists. (c) email.* and legal.* keys and the VI defaults, which belong to phase 5. (d) Writes: no admin write path, no `updateTag` calls and no `i18n:<code>` refresh logic, as there is no writer until phase 3 and later. (e) Seeding content_strings: the table stays empty by spec. (f) A media FK on card_image_id, which comes in phase 6. (g) Destination names, addresses and card copy (destination_i18n), also phase 6, so the footer addresses stay hardcoded in phase 2. (h) A trigger for updated_at: the app sets it.
- Open question for the spec owner: `destinations.email` is seeded NULL for all four rows. lib/data.ts has only one shared address (CONTACT.email = fb@furamavietnam.com), and the spec puts the shared email in `site_settings`. If the owner wants the resort row to carry it, it is a one-line seed change. The dining-house `map_url` is also NULL because no URL exists in code. Do not invent one.
- Open question: the `script` seed values. 004 seeds 'latin' for en and 'vietnamese' for vi, a guess from "Latin và tiếng Việt dùng font hiện tại". Phase 8 defines SCRIPT_FONTS; this must match it or a data fix is needed. The column has no enum CHECK on purpose.
- Open: the `reviewed` rows have no CHECK that `reviewed_at` is set. This keeps the seed and the writers simple. Add it when the first writer lands (phase 7) if wanted.
- Build now needs the DB: with cacheComponents, `generateStaticParams` reads `locales` at build time, and the root layout reads restaurants. A DB error fails `next build` (spec §12 says cached or prerendered pages keep serving, but the build itself does not). CI already has Postgres. Vercel preview builds use the per-preview Neon branch from phase 0, so confirm that branch has migration 004 before the first preview after merge, or the build breaks.
- `revalidateTag(tag,'max')` is stale-while-revalidate (proven: one stale response, then fresh). That is acceptable for cron and jobs. Server Actions (the admin, later) must use `updateTag`. Do not use `revalidateTag` for the disable-a-language flow if immediate removal matters.
- The `locales` tag is attached to every page through the layout's `getEnabledLocales()`. A language switch therefore re-renders every page of that language the next time they are requested. That is correct, but it makes every locale toggle a full-site refresh. This is fine for the volume.
- Languages added after the build (for example `ko`) rely on the dynamic fallback of `generateStaticParams`. I did not test that path in this spike: only `en` and `vi` were built. Phase 8 must test it. In phase 2 only `en` is enabled, so it is not exercised.
- `getStrings` takes `keys` as an argument, so the key list is part of the cache key. Always pass a stable constant (`CLIENT_KEYS`), never a per-request array, or the cache fragments. A future per-page subset would give one cache entry per distinct list.
- Client code must not import the registry's `REGISTRY` for display once overrides exist; it should read the `strings` prop. The 12-entry registry is imported by `lib/booking-errors.ts` only for the default parameter, which is small. If bundle size matters, make `strings` a required argument and drop DEFAULT_ERROR_STRINGS from the client.
- The fallback subject `'The restaurant'` in booking-errors is English-only and is not in the registry. It matters only if a server error omits `params.restaurant`. Phase 4 should make the server always pass the name.
- The existing 003 test shares the DB name `furama_cuisine_migrate_test`, so two parallel test runs on the same server (for example several spikes) can collide. It passed here, but flaky failures would come from that.

## Spec deviations
- Spec §5.2 says `destinations.card_image_id` exists, but there is no `media` table until phase 6. Done: the column is created as plain `uuid NULL` with no FK, and phase 6 adds the constraint.
- Spec §5.1 item 5/4 and §5.2 list `reviewed_by`, `reviewed_at` etc. but say nothing about which columns are required. Done: all of ai_model, source_hash, reviewed_by, reviewed_at, updated_by are nullable; status and origin have defaults ('reviewed', 'human').
- Spec §5.2 for `locales` does not say how the default is enforced. Done: a partial unique index on `((true)) WHERE is_default`, plus a CHECK that the default locale must be enabled (this CHECK is my addition, in line with "Hàng ngôn ngữ mặc định luôn hiển thị").
- Spec §14.1 row 2 does not mention `restaurants.destination`. I added `restaurants_destination_fk` in 004 (see risk and recommendation for question 2). If this is unwanted, delete the DO block and the test case `every seeded restaurant points at a destination`.
- Spec §5.1 item 2 says the registry keys carry ICU variables, and §6.3 item 4 says ICU is used. Done in phase 2: variables are declared as `{name}` placeholders only, a test forbids plural/select syntax, and no ICU parser is added until the first string needs it. Callers will not change when intl-messageformat arrives.
- Spec §6.2 says every content read function takes `locale` and uses `lang()` from root params. `getStrings` and `getEnabledLocales` follow that, except that `getEnabledLocales` takes no `locale` (it is global). `lang()` is not called inside `getStrings`, as the spec says it is called in the Server Component and passed in.
- Spec §6.3 item 1 and the §14.1 row say `bookingErrorMessage` copy moves to the registry in phase 2. Done, but the third argument `strings` defaults to the English registry text, so the 3 call sites in SiteProvider compile unchanged until T4 passes the real strings.

## Doc citations
- node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cacheTag.md:15-50 (cacheTag needs cacheComponents; use updateTag for read-your-own-writes in Server Functions, revalidateTag elsewhere, lines 65-68)
- node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-cache.md:81-88 (cache key = build ID + serializable arguments + closure variables), :107 (only root params that are read enter the key), :146-155 (arguments and return values must be serializable), :241 (no cookies/headers/searchParams inside 'use cache')
- node_modules/next/dist/docs/01-app/03-api-reference/04-functions/next-root-params.md:11-30 (lang() from next/root-params in Server Components; names come from the dynamic segment folder), note that it cannot be used in Client Components or Server Actions, so getStrings takes `locale` as an argument
- node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/partialPrefetching.md:19-34 (needs cacheComponents; config validation throws without it)
- node_modules/next/dist/docs/01-app/04-glossary.md:165 (Partial Prefetching and App Shell definition)
- docs/superpowers/specs/2026-10-01-admin-cms-design.md §5.1 items 2,5,7 (registry; visibility and fallback; migrations, ON CONFLICT DO NOTHING), §5.2 'Nền tảng (đợt 2)', §6.2 (cache tags and refresh rules), §6.3 items 1-8, §14.1 row 2
- lib/booking-errors.ts header comment: 'The English copy lives here until the content registry (lib/i18n/registry.ts) arrives in phase 2'
- Real outputs (not docs): `Tests 110 passed (110)`; `next build` listed /en and /vi as static; the revalidateTag behaviour above