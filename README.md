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
| `/api/availability` | Dynamic | Booked covers per slot for one restaurant/day |
| `/admin/sign-in`, `/admin/accept-invite`, `/admin/reset-password` | Request time, nonce CSP | The only admin pages open without a session cookie |
| `/admin`, `/admin/users`, `/admin/audit` | Request time, nonce CSP | Overview; staff and invitations (Admin); audit log (Admin). Without a session cookie the proxy sends them to sign-in (307, `?next=` kept) |
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

`reservations` records table requests. Availability is **derived from booked
covers** against each restaurant's `slot_capacity`, replacing the design's
placeholder hash-based availability. A slot closes when it has passed (plus 30
minutes' lead time) or when the party would exceed the remaining covers.

Guarantees in the schema:

- capacity is re-checked inside the insert's transaction under `SELECT … FOR
  UPDATE`, so two simultaneous requests for the last seats cannot both win
- a partial unique index rejects a double submit of the same table
- `guests` is bounded 1–12 and `restaurant_id` is a foreign key

`app/actions.ts` re-validates every field, the slot's existence on that
restaurant, the booking window and the lead time server-side — the client's
checks are only there for immediate feedback.

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
