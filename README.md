# Furama Cuisine

Implementation of the `Furama Cuisine.dc.html` design canvas as a Next.js app,
with reservations persisted in Neon Postgres.

## Stack

- **Next.js 16** (App Router, Turbopack) + **React 19** + TypeScript
- **Neon Postgres** via the Vercel Marketplace, reached with `pg` (node-postgres)
  on Fluid Compute per Neon's own guidance
- Plain CSS with design tokens — the design is built on fluid `clamp()` values
  throughout, so the tokens mirror them directly rather than round-tripping
  through a utility framework

## Getting started

```bash
npm install
vercel env pull .env.local --yes   # Neon credentials
npm run db:migrate                 # apply db/migrations/*.sql
npm run dev
```

## Routes

| Route                | Rendering | Notes                                        |
| -------------------- | --------- | -------------------------------------------- |
| `/`                  | Static, ISR 1h | Home: hero, finder, cuisines, restaurants, destinations, experiences, heritage, stories, offers |
| `/taya-house`        | Static, ISR 1h | Tàya House restaurant detail                 |
| `/api/availability`  | Dynamic   | Booked covers per slot for one restaurant/day |

The design toggled between these two views with a `#taya-house` hash. They are
real routes here so each gets its own metadata and can be linked directly; the
brand curtain still plays over the swap via client-side navigation.

## Database

The restaurant catalogue is the database's job, not the code's — `restaurants`
is seeded by `db/migrations/002_seed_restaurants.sql` and read by
`db/queries.ts#listRestaurants`, then handed to the client through
`SiteProvider`. Editing the catalogue means editing a migration.

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
uses the pooled one. Both pin `sslmode=verify-full`.

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
| `npm run typecheck`  | `tsc --noEmit`                 |
| `npm run db:migrate` | Apply pending SQL migrations   |
| `npm run db:psql`    | psql shell against Neon        |
