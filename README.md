# Furama Cuisine

Implementation of the `Furama Cuisine.dc.html` design canvas as a Next.js app,
with reservations persisted in Neon Postgres.

## Stack

- **Next.js 16** (App Router, Turbopack) + **React 19** + TypeScript
- **Neon Postgres** via the Vercel Marketplace, reached with `pg` (node-postgres)
  on Fluid Compute per Neon's own guidance
- **Better Auth** for staff sign-in (invitation only, Admin and Editor roles)
  and **Resend** with react-email for the staff emails
- Plain CSS with design tokens — the design is built on fluid `clamp()` values
  throughout, so the tokens mirror them directly rather than round-tripping
  through a utility framework

## Getting started

```bash
npm install
npm run dev
```

`.env.local` must point at the Neon **`dev`** branch: `DATABASE_URL` holds the
pooled string and `DATABASE_URL_UNPOOLED` the direct one. Do not run
`vercel env pull .env.local`. The shared Vercel variables point at production
data and would overwrite those lines.

Apply migrations to the dev branch with `npm run db:migrate`.

The admin (`/admin`) also needs `BETTER_AUTH_SECRET` and
`BETTER_AUTH_URL=http://localhost:3000` in `.env.local`; leave
`EMAIL_DELIVERY` unset there (log mode: invitation and reset links are
printed to the terminal). Create your Admin with `scripts/create-admin.mjs`
(see Deploying → First Admin).

## Testing

| Command | What it runs |
| --- | --- |
| `npm test` | Unit tests (Vitest, process timezone pinned to UTC) |
| `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npm test` | Unit and integration tests. The database is dropped and recreated on every run, and its name must end in `_test`. |
| `npm run test:e2e` | Playwright against `next start` on port 3100 (or `E2E_PORT`). Set `CI`, a local `_test` `DATABASE_URL`, `EMAIL_DELIVERY=log`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL=http://localhost:<port>` and `EMAIL_LOG_FILE` (variables below), or `E2E_BASE_URL` for a server you started; otherwise it refuses to run, because `next dev` and `next start` read `.env.local`. Run `npx playwright install chromium` once first. |
| `npm run test:visual` | Pixel-exact screenshots of the home and Tàya House pages, with and without JavaScript, against `e2e/__visual__/` (macOS baselines from before phase 2; CI skips them). Needs a running `next start`, see below. |
| `npm run lint` | oxlint (typescript-eslint does not support TypeScript 7) |

CI (`.github/workflows/ci.yml`) runs typecheck, lint, unit, integration,
build, the prerender and font check (`scripts/check-prerender.mjs`) and
end-to-end tests against a Postgres 18 service container. The build needs no
auth or email variable; the end-to-end step gets a fresh `BETTER_AUTH_SECRET`
per run, `EMAIL_DELIVERY=log` and an `EMAIL_LOG_FILE` the admin specs read
invitation and reset links from.

To run the production build locally against a throwaway database, keep
`.env.local` out of it: process variables win over that file, and the blank
`PG*` variables stop Next from handing its user and password to `pg`.

```bash
RESET_DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test node scripts/reset-db.mjs
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npm run build
node scripts/check-prerender.mjs
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test \
  BETTER_AUTH_SECRET=$(openssl rand -base64 32) BETTER_AUTH_URL=http://localhost:3100 \
  EMAIL_DELIVERY=log EMAIL_LOG_FILE=$TMPDIR/emails.ndjson npm run test:e2e
PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test \
  BETTER_AUTH_SECRET=$(openssl rand -base64 32) BETTER_AUTH_URL=http://localhost:3201 EMAIL_DELIVERY=log npx next start -p 3201 &
for i in $(seq 1 60); do curl -s -o /dev/null http://localhost:3201/ && break; sleep 1; done
VISUAL_BASE_URL=http://localhost:3201 npm run test:visual
kill %1   # stop the server (or: lsof -ti tcp:3201 | xargs kill)
```

Playwright runs two projects. `desktop` holds every spec file, in parallel
workers; `desktop-serial` holds the `*.serial.spec.ts` files and runs after
`desktop` has finished (`dependencies`), because they change what every guest
page reads (a restaurant's online-booking switch). Running one serial file
also runs the whole `desktop` project first; add `--project=desktop-serial
--no-deps` to run it alone. Spec files run at the same time, so each one books
its own restaurant and dates, and puts back the rules it changes:

| Spec | Restaurant | Dates or rules |
| --- | --- | --- |
| `booking-v2` | Tàya House, Don Cipriani’s, Steakhouse The Fan | the last open day; a closure at +9; `max_party` 8 |
| `admin-reservations` | Tàya House, V-Senses Cafe, ChaoShan Hotpot, Café Indochine | +3, +4, +6 (one booking at 23:30, outside the hours), yesterday; +8; +7; +6 (picked from The Fan at +5, where nothing is written) |
| `admin-booking-config` | Thai Siam Kitchen, Hura Izakaya | dinner hours and covers (+2, +3), `max_party` and `window_days` overrides (back to NULL); `max_party` 8 |
| `admin-booking-settings` | Danaksara | `auto_confirm`; the last open day |
| `admin-closures` | Phố Cuốn; the MM Supercenter (Yum Food Village, ChaoShan Hotpot) | +5; a destination closure at +11 |
| `booking-acceptance` | Yum Food Village | +3, +4, +12, +13, yesterday; dinner hours, covers and `max_party` |
| `booking-switch.serial` | Tàya House, Hải Vân Lounge | online booking off, then on again |

`booking-acceptance.spec.ts` checks every phase-4 acceptance criterion of the
spec (§14.1 row 4) through the screens. Its tests share Yum Food Village's
rules and run in order, so never run that file with `--repeat-each`.

`E2E_BASE_URL=http://localhost:<port>` points the main Playwright suite at a
server you started yourself (for example `next dev` with the same variables)
instead of starting one. The admin specs still write their staff accounts
(with known passwords) straight into `DATABASE_URL`, so `e2e/staff-fixtures.ts`
refuses anything but a local database named `*_test` or `*_ci`, whichever way
Playwright runs. Never update the visual baselines to make a run
pass: open `test-results/**/*-diff.png` and fix the page.

## Deploying

Migrations are applied by hand with `scripts/migrate.mjs` against the target
environment's direct (unpooled) connection string. Nothing applies them
automatically.

Migration 003 (`phone_e164 NOT NULL` plus `reservations_dedupe_v2_idx`) and the
code that writes `phone_e164` must ship together: apply 003 to an environment
immediately before (or together with) its first deploy of this branch. Before
003 the new code fails on the missing column; after 003 the old code fails on
`NOT NULL`. The site has never been deployed, so there is no live traffic to
break today.

Migration 004 (`locales`, `content_strings`, `destinations` and the
`restaurants_destination_fk` constraint) must be on an environment's Neon
branch **before** that environment builds the phase-2 code: `next build`
reads the `locales` table (the guest layout's `generateStaticParams`) and
prerenders `/en` from the database, so a build against a branch without 004
fails. A failed build is safe (the previous deployment stays live), but
migrate first: apply 004 to a preview branch before its first phase-2
preview, and to production right before the production deploy, with the
`node scripts/migrate.mjs` command below. 004 only adds tables and a
constraint the current data already satisfies, so the code from before
phase 2 keeps working on a migrated database. Check
`SELECT DISTINCT destination FROM restaurants` on the target branch first:
every value must exist in `destinations`, or the constraint fails.

Neon preview branches fork from production, so a preview deployment needs
`node scripts/migrate.mjs` run against its preview branch (with
`DATABASE_URL_UNPOOLED` set to that branch) before bookings work there.

Production: never run `npm run db:migrate` (it reads `.env.local`, which must
point at dev). Run
`DATABASE_URL_UNPOOLED=<production direct URL> node scripts/migrate.mjs`
deliberately, after the dev branch has been migrated and verified.

Migration 005 (the `staff_*` tables, `auth_rate_limit`, `staff_invitation`,
`audit_log` and the `audit_feed` view) must be on an environment's Neon
branch before that environment runs the phase-3 code: Better Auth checks its
tables when it starts (`database.validateSchema`) and every admin page reads
them. 005 only adds tables, so the guest site keeps working on a migrated
database. Apply it with `node scripts/migrate.mjs` like the others.

### Migration 006 (phase 4: booking v2)

`006_booking_v2.sql` adds `booking_settings`, the restaurants' booking
switch and overrides, `service_periods` (seeded to behave exactly as before:
the old slots of each restaurant's meals, `slot_capacity` covers each),
`closures` and `closure_i18n`, the v2 columns of `reservations`,
`reservation_events`, `reservation_notes` and the `pg_trgm` search index, and
it redefines `audit_feed` to show booking events. It only adds, but the
phase-4 code needs it and the older code cannot write a booking on it
(`reservations.meal` is NOT NULL and `source` has no default): apply 006 to an
environment immediately before, or together with, its first phase-4 deploy,
as with 003. The site has never been deployed, so no live traffic breaks.

006 must run after 005 (it replaces 005's `audit_feed` view and reads
`audit_log`, `locales` and `destinations`). `scripts/migrate.mjs` applies the
files in name order and skips the ones `_migrations` lists, so it runs 005
first if that is missing; never apply 006 by hand with `psql -f`. It runs in
one transaction: if any statement fails (for example `CREATE EXTENSION
pg_trgm`), nothing of it stays.

Before applying 006 to a Neon branch, run these read-only checks on that
branch (`npm run db:psql` reads `.env.local`, so open psql on the branch's own
URL instead):

```sql
-- 1. Exactly 001–005 applied, 006 not yet.
SELECT name FROM _migrations ORDER BY name;
-- 2. pg_trgm is available (an empty result means 006 would roll back).
SELECT name, default_version, installed_version FROM pg_available_extensions WHERE name = 'pg_trgm';
-- 3. Every reserved_at is HH:MM (006 stops with a message otherwise; correct the rows first).
SELECT id, reserved_at FROM reservations WHERE reserved_at !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$';
-- 4. How many bookings become source 'legacy', is_test (they keep holding covers until purged).
SELECT count(*), min(created_at), max(created_at) FROM reservations;
-- 5. Every meal is one 006 knows (a restaurant with another would get no service period: closed every day).
SELECT id, meals FROM restaurants WHERE NOT meals <@ ARRAY['Breakfast', 'Lunch', 'Dinner', 'Drinks'];
-- 6. An override of these strings must keep the new {max}/{phone} (party_too_large) and read right for both causes (past).
SELECT key, locale, value FROM content_strings WHERE key IN ('error.party_too_large', 'error.past', 'error.closed');
```

Then apply it with `DATABASE_URL_UNPOOLED=<the branch's direct URL> node
scripts/migrate.mjs`, and check:

```sql
SELECT count(*) FROM service_periods;                        -- one per (restaurant, meal): 25 on the seed data
SELECT * FROM booking_settings;                              -- one row: 14, 30, NULL, 12, false, true, 24
SELECT count(*) FROM reservations WHERE meal IS NULL OR (search_text IS NULL AND anonymized_at IS NULL);  -- 0
SELECT source, is_test, count(*) FROM reservations GROUP BY 1, 2;
```

The booking-day lock (`pg_advisory_xact_lock` with `SET LOCAL lock_timeout`
inside a transaction, `lib/server/booking/lock.ts`) has only been tested on a
direct Postgres connection. The app uses Neon's **pooled** URL, so check it
once on a Neon branch before the first phase-4 deploy (spec §13). In two psql
sessions on that branch's pooled URL:

```sql
-- session 1
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('booking:taya-house:2030-01-01', 0));
-- session 2: waits about 2 seconds, then fails with 55P03 (lock_timeout)
BEGIN;
SELECT set_config('lock_timeout', '2s', true);
SELECT pg_advisory_xact_lock(hashtextextended('booking:taya-house:2030-01-01', 0));
ROLLBACK;
-- session 1
COMMIT;
```

If session 2 does not wait, the pooler does not keep the transaction on one
server connection and two guests could both take the last covers: stop and
switch to the fallback of spec §16 (a lock row per restaurant and date,
`SELECT … FOR UPDATE`).

On the first preview after phase 4, check that a save under "Giờ và sức
chứa" reaches the guest pages: switch a restaurant's online booking off, then
open the home page a few times; every response should drop its RESERVE (the
catalogue is cached per instance and `updateTag('restaurants')` expires it).

**Never run `npx auth migrate`** (or `generate`) without
`--config scripts/auth-cli.config.ts`: the Better Auth CLI loads `.env` and
`.env.local` by itself, which point at the shared database. That config reads
`AUTH_CLI_DATABASE_URL`, refuses anything but a local database, and drops every
`PG*` variable the CLI copied from `.env.local` before it connects (blank them
in the shell too):

```bash
RESET_DATABASE_URL=postgres://localhost:5432/furama_cuisine_cli_test node scripts/reset-db.mjs
PGHOST= PGUSER= PGPASSWORD= PGDATABASE= AUTH_CLI_DATABASE_URL=postgres://localhost:5432/furama_cuisine_cli_test npx auth check --config scripts/auth-cli.config.ts
```

The staff tables' columns come from `lib/server/auth/config.ts`; change that
file, regenerate with `npx auth generate --config scripts/auth-cli.config.ts`
against an empty local database, and write the difference as a new migration.

### Environment variables (admin)

| Variable | Production | Preview | Local E2E / CI |
| --- | --- | --- | --- |
| `BETTER_AUTH_SECRET` | its own, 32+ random bytes | its own | a fresh `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | `https://<production domain>`, the origin of emailed links | the preview's own URL | `http://localhost:<port>` |
| `EMAIL_DELIVERY` | `live` | `redirect` | `log` (also the default when unset) |
| `EMAIL_REDIRECT_TO` | — | the team inbox that receives every preview email | — |
| `EMAIL_FROM` | `Furama Cuisine <no-reply@mail.furamavietnam.com>` | same | — |
| `RESEND_API_KEY` | the production key | a separate key | — |
| `EMAIL_LOG_FILE` | never | never | a scratch file; log mode appends each email as one JSON line |
| `BOOTSTRAP_ADMIN_EMAIL` | never (only in the shell that runs `scripts/create-admin.mjs`) | never | — |

`EMAIL_DELIVERY` is read when an email is sent, never at build time; an
unknown value throws instead of sending. On a Vercel deployment
(`VERCEL_ENV=production` or `preview`) the log mode prints neither addresses
nor links and writes no `EMAIL_LOG_FILE`, so the email reached no one: the
send fails with `not_delivered`, and the staff screen says email is not set
up on that environment instead of "Đã gửi lời mời.".

### Resend

Invitation and reset emails go straight to Resend (spec §10.4), from a
subdomain of furamavietnam.com verified in Resend: IT adds the MX, SPF, DKIM
and DMARC records Resend lists for `mail.furamavietnam.com` (check first
whether the root domain already has a DMARC record), then `EMAIL_FROM` uses
that subdomain. Until it is verified, keep `EMAIL_DELIVERY=redirect` (on a
deployment, `log` sends nothing and every invitation is marked unsent).
A failed invitation email leaves the invitation in place and the staff
screen says "Chưa gửi được email, bấm Gửi lại" (or, for a setup problem such
as `not_delivered` or a missing key, that email is not set up on this
environment); a failed reset email is only logged.

### First Admin

Staff accounts exist only by invitation (spec §7.1); the one exception is the
first Admin, created once per environment by `scripts/create-admin.mjs`. It
goes through the same invitation gate, which admits `BOOTSTRAP_ADMIN_EMAIL`
only while no Admin exists, so a second run is refused. The script reads no
`.env` file: give it the target environment's variables explicitly, and set
`BOOTSTRAP_ADMIN_*` in that one shell only, never in Vercel.

```bash
BOOTSTRAP_ADMIN_EMAIL=owner@furamavietnam.com BOOTSTRAP_ADMIN_NAME='Chủ quán' \
  npx dotenv -e <file with that branch's DATABASE_URL, BETTER_AUTH_SECRET, BETTER_AUTH_URL> -- \
  node scripts/create-admin.mjs
```

It asks for the password (12–128 characters) unless `BOOTSTRAP_ADMIN_PASSWORD`
is set, and writes a `staff.bootstrap` row to `audit_log`.

Apply migration 005 to that database first; check the `Target database:` line
the script prints before you type the password; and never run it with
`.env.local` while that file points at the shared production database, unless
bootstrapping production is what you mean to do.

## Routes

| Route | Rendering | Notes |
| --- | --- | --- |
| `/` and other unprefixed paths | Proxy (`proxy.ts`) | 307 to `/<locale>…` by the `NEXT_LOCALE` cookie, then `Accept-Language`, then `en` (only `en` is enabled in phase 2); the query is kept |
| `/en` | Static, `cacheLife('max')` | Home: hero, finder, cuisines, restaurants, destinations, experiences, heritage, stories, offers |
| `/en/restaurants/[slug]` | Static for `taya-house`. Any other slug is a 404: the first visit is a soft 404 (status 200 with `noindex`), later visits get the cached 404, and without JavaScript the body is empty | Restaurant detail (Tàya House only until phase 6) |
| `/taya-house` | Redirect | 308 to `/en/restaurants/taya-house` (`next.config.ts`) |
| `/api/availability` | Dynamic, `no-store` | `?restaurant=&lang=[&from=&to=]`: each day's state (open, full, past, closed, too_large, outside) and public closure reason, with the clock, the party limit and the number to call; `?restaurant=&date=&lang=[&guests=]`: one day's services and slots with the covers left. 404 for an unknown restaurant or one with online booking off. `scripts/check-prerender.mjs` fails if it is ever prerendered |
| `/admin/sign-in`, `/admin/accept-invite`, `/admin/reset-password` | Request time, nonce CSP | The only admin pages open without a session cookie |
| `/admin`, `/admin/users`, `/admin/audit` | Request time, nonce CSP | Overview (with pending and today's bookings); staff and invitations (Admin); audit log of `audit_log` and booking events, paged with `?truoc=`/`?sau=` (Admin). Without a session cookie the proxy sends them to sign-in (307, `?next=` kept) |
| `/admin/reservations`, `/admin/reservations/[id]`, `/admin/reservations/day` | Request time, nonce CSP | Inbox (Cần xử lý · Hôm nay · Sắp tới · Tất cả, search by reference, phone, name or email); a booking (status changes, edit, internal notes, timeline); the printable day sheet. `reservations:read` |
| `/admin/reservations/new` | Request time, nonce CSP | Phone bookings and walk-ins. `reservations:create` |
| `/admin/reservations/closures`, `/admin/restaurants`, `/admin/restaurants/[id]/booking` | Request time, nonce CSP | Closures with the bookings each covers; the restaurants; "Giờ và sức chứa" (switch, overrides, service periods, slot preview, affected bookings; auto-confirm for Admins). `schedule:read` |
| `/admin/settings/booking` | Request time, nonce CSP | Booking defaults. Admin (`settings:read`) |
| `/api/auth/*` | Dynamic | Better Auth; `/api/auth/admin/*` is refused with 403 |

Every admin page renders at request time (`app/admin/layout.tsx`: `instant =
false` and `await connection()` before `<html>`), so each response carries the
nonce `proxy.ts` made for it. On `next start` and Vercel an admin page answers
200 even when it renders the sign-in redirect, the 403 view or the 404 view:
those arrive in the page payload, not the status.

The proxy skips `/api`, `/_next`, `/admin` (its own branch), any path with a dot
(files such as `/icon.svg`) and any unprefixed top-level segment of 2–3 letters,
which it reads as a locale. Such unknown top-level paths are not redirected; they
become cached 404s.

The design toggled between these two views with a `#taya-house` hash. They are
real routes here so each gets its own metadata and can be linked directly; the
brand curtain still plays over the swap via client-side navigation.

Guest pages live in `app/(site)/[lang]`. The root layout there reads no
database and never throws; `(guarded)/layout.tsx` checks the language
against the `locales` table and reads the catalogue and UI strings, so a
disabled language gets the site's 404 and a database error gets
`[lang]/error.tsx`, but only for request-time renders with JavaScript on.
An expired static route that fails to re-render, or a disabled-locale 404, gets
a plain 500 or an empty shell instead. Guest pages are cached with
`cacheLife('max')` (30 days) rather than hourly ISR, so a catalogue edit made
directly on Neon needs a redeploy (or a tag purge) to appear; the uncached
booking action reads the database directly. Pages carry the cache tags `restaurants`, `i18n:<code>`,
`locales` and `content:ui`; `lib/cache-tags.ts` names every tag of the CMS
(spec §6.2), so later phases never spell a tag by hand. Each page wraps its
content in `<ViewMarker>`: with Cache Components the router keeps the page
you left mounted but hidden, so page DOM is only queried inside the visible
page's `<main>` (`lib/page-scope.guard.test.ts` enforces it).

## Database

The restaurant catalogue is the database's job, not the code's — `restaurants`
is seeded by `db/migrations/002_seed_restaurants.sql` and read by
`db/queries.ts#listRestaurants`, then handed to the client through
`SiteProvider`. Editing the catalogue means editing a migration.

`locales`, `content_strings` and `destinations` (migration 004) are the
shared foundations of the CMS. Which UI strings exist is decided by
`lib/i18n/registry.ts`; `content_strings` only overrides or translates them,
and while it is empty the registry's English text is served. Guest pages
read through cached functions in `lib/server/content/` (`'use cache'`,
`cacheLife('max')`); their uncached loaders (`*.queries.ts`) are what the
integration tests exercise.

`reservations` records bookings (migration 006, phase 4). What a restaurant
offers comes from the database, never from the code: `service_periods` (the
weekly template: meal, weekdays, first and last seating, interval, covers per
slot), `closures` (a restaurant, a destination or all, inclusive dates, some
meals or the whole day, a public reason per language in `closure_i18n`) and
`booking_settings` with each restaurant's overrides and `booking_enabled`.
`lib/booking/resolve-day.ts` turns them into a day: `planDay` (the services
and slots) for staff screens, and `resolveDay` (plus the window, the lead
time, the same-day cut-off, the party limit and the covers held) for guests.
Nothing that reads them is cached.

Guarantees:

- every write that takes covers (a guest's submit, a staff booking, an edit
  that moves or grows a booking) takes one advisory lock per restaurant and
  date (`lib/server/booking/lock.ts`) and only then reads the rules and the
  covers, in the same transaction: concurrent requests for the last seats
  cannot both win
- covers are held by `requested`, `confirmed` and `seated` bookings only
- a partial unique index rejects a second active booking of the same table,
  time and phone
- `version` (bumped by the `reservations_before_write` trigger on every
  update) makes a stale admin page a conflict that names who changed it
- every booking change is a `reservation_events` row (the timeline), never
  an `audit_log` row; configuration changes are `audit_log` rows; the
  `audit_feed` view shows both

`app/actions.ts` (`submitReservation`) re-validates everything server-side;
the guest form's checks are only there for immediate feedback.

Migrations use the unpooled connection (DDL needs a direct session); the app
uses the pooled one. Both pin `sslmode=verify-full`; local throwaway databases
(`localhost`) skip it.

## Motion

`lib/motion.tsx` reproduces the design's motion: the intro curtain, staggered
`data-intro` entrances, scroll reveals batched through one `IntersectionObserver`
so simultaneous entries stagger top-to-bottom, parallax, hero fade, header
auto-hide, and per-overlay entrances.

Pre-animation states live in CSS gated on `[data-motion]`, which an inline
script in `<head>` stamps before first paint — so nothing flashes in before
hydration and visitors without JS still see everything. `prefers-reduced-motion`
turns the whole system off.

## Assets

`public/assets/` holds the design's 39 photographs. `scripts/extract-assets.py`
re-derives them from the DesignSync reads in a session transcript and is
idempotent.

Five source photos exceed the DesignSync 192 KiB per-file transfer cap and are
substituted with the design's own smaller rendition of the same shot (listed in
that script's `FALLBACKS`): `chef`, `hero-taya`/`taya-hero`, `hero-indochine`,
`r-danaksara`, `r-hai-van-lounge`. Re-export those from the design project if
you want them at full resolution.

## Design source

`design-src/Furama Cuisine.dc.html` is the imported design canvas, kept for
reference so future design revisions can be diffed against what was built.

## Scripts

| Command              | Purpose                        |
| -------------------- | ------------------------------ |
| `npm run dev`        | Dev server                     |
| `npm run build`      | Production build               |
| `npm run typecheck`  | `next typegen`, then `tsc` (no incremental cache) |
| `npm run lint`       | oxlint                         |
| `npm test`           | Vitest (unit, integration)     |
| `npm run test:e2e`   | Playwright                     |
| `npm run test:visual` | Screenshot comparison (local) |
| `npm run db:migrate` | Apply pending SQL migrations   |
| `npm run db:psql`    | psql shell against Neon        |
