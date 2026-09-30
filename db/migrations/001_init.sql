-- Furama Cuisine — reservations schema.
-- Applied with `npm run db:migrate`; every statement is idempotent so the
-- migration is safe to re-run against an existing database.

CREATE TABLE IF NOT EXISTS restaurants (
  id             text PRIMARY KEY,
  name           text        NOT NULL,
  type           text        NOT NULL,
  destination    text        NOT NULL,
  cuisines       text[]      NOT NULL DEFAULT '{}',
  meals          text[]      NOT NULL DEFAULT '{}',
  -- Covers per time slot. Availability is derived from booked covers, not faked.
  slot_capacity  integer     NOT NULL DEFAULT 12,
  sort_order     integer     NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reservations (
  id             bigserial   PRIMARY KEY,
  reference      text        NOT NULL UNIQUE,
  restaurant_id  text        NOT NULL REFERENCES restaurants (id),
  reserved_on    date        NOT NULL,
  reserved_at    text        NOT NULL,
  guests         integer     NOT NULL CHECK (guests BETWEEN 1 AND 12),
  guest_name     text        NOT NULL,
  phone          text        NOT NULL,
  email          text,
  note           text,
  status         text        NOT NULL DEFAULT 'requested'
                 CHECK (status IN ('requested', 'confirmed', 'cancelled')),
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- The availability lookup: covers already booked for one restaurant on one day.
CREATE INDEX IF NOT EXISTS reservations_slot_idx
  ON reservations (restaurant_id, reserved_on, reserved_at)
  WHERE status <> 'cancelled';

-- Stops a double submit from creating two identical bookings.
CREATE UNIQUE INDEX IF NOT EXISTS reservations_dedupe_idx
  ON reservations (restaurant_id, reserved_on, reserved_at, phone)
  WHERE status <> 'cancelled';
