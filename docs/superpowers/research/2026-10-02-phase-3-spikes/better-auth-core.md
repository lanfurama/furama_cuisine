# Spike p3-auth: Better Auth core

**Topic:** Better Auth 1.7.7 core on Next 16.3.7, React 19.3, TS 7.0.2 and pg. It covers the staff_* tables, migration 005, roles, the invite flow, the /api/auth/admin/* block, the DAL, audit, last-admin protection and the bootstrap script, all verified end to end.

> Lead note: this is the spike's own report. Where it disagrees with `00-plan-outline.md` (sign-in transport, DAL path, permission names, the Editor-on-Admin-page behaviour, the email module, E2E seeding), the outline wins. Its §0 lists each conflict and how it was resolved.

## Verified patterns

**Where it lives**
- Clone: `/private/tmp/claude-501/-Users-bcmac-Desktop-projects-Outside-Projects-furama-cuisine/e860bf94-efdc-4015-b5d3-085d89bca850/scratchpad/p3-auth`. There are four commits on top of `6a93d7b`: `4d6b2ab`, `e6f64c0`, `2c8d3ab` and `6ebcef9`.
- The full patch for every file is `/private/tmp/claude-501/-Users-bcmac-Desktop-projects-Outside-Projects-furama-cuisine/e860bf94-efdc-4015-b5d3-085d89bca850/scratchpad/p3auth-out/p3-auth.patch` (2,933 lines, package-lock excluded).
- Logs are in the same `p3auth-out/` folder: `build-final2.log`, `e2e-all-final.log`, `e2e-14..16.log` and `lint.txt`. The E2E runner is `e2e.sh` / `e2e-all.sh`.
- The original repo was never modified (`git status` is clean). The DB `furama_cuisine_p3auth_test` has been dropped, and no servers are left running.

### Final verification (all on local Postgres 18.3, never Neon)

| Check | Result |
|---|---|
| `next typegen && tsc --noEmit` (TS 7.0.2) | OK, about 0.4 s. Better Auth's inferred types work with tsgo, including `auth.api.*` bodies, `session.user.role` and `banned`. |
| `oxlint` | 0 errors. 21 warnings, 3 of them new: the `pg` default import in `create-admin.mjs` and the E2E spec (same pattern as `scripts/migrate.mjs`), and `_writeToOutput` in the password prompt. |
| Unit (`vitest run`, no DB) | 148 passed, 65 skipped (23 files) |
| Integration (`TEST_DATABASE_URL=…p3auth_test`; the shared-DB files plus the new ones) | 192 passed (21 files) |
| `next build` | Green. All `/admin/*` routes and `/api/auth/[...all]` are ƒ. `/en` stays ○ and `/[lang]` stays ◐. `scripts/check-prerender.mjs` passes (prerender and fonts). |
| E2E: full suite on the production build, port 3201 | 45 passed (35 existing + 12 new admin-auth). The admin-auth spec on its own passed 12/12 three runs in a row. |

### New test names (they are the evidence)

**Integration: `test/integration/staff-auth.test.ts` (21 tests)**
- refuses createUser for an email without an invitation
- lets BOOTSTRAP_ADMIN_EMAIL in as Admin only while no Admin exists
- takes the role from the invitation, not from the caller
- keeps HTTP sign-up closed (400 `EMAIL_PASSWORD_SIGN_UP_DISABLED`)
- rejects HTTP calls to /api/auth/admin/* even from a signed-in Admin with a valid Origin (hooks.before → 403 `ADMIN_ENDPOINT_BLOCKED`; covers set-role POST, list-users GET and create-user POST)
- still serves server-side auth.api.* calls with the caller's permissions (Admin `listUsers`/`setRole` work; the Editor gets `YOU_ARE_NOT_ALLOWED_TO_CHANGE_USERS_ROLE` / `…LIST_USERS`)
- grants impersonation to no role (`YOU_ARE_NOT_ALLOWED_TO_IMPERSONATE_USERS`)
- auth.api.setRole runs outside our transaction (BEGIN → setRole → ROLLBACK; the role change persists)
- invite → accept → sign in, with one audit row per step and a single-use token (the token is 43-char base64url; only its SHA-256 hex is stored; `email_verified = true`)
- resend issues a new token and kills the old one; a failed send is recorded, not thrown (`email_error`)
- revoke closes the link and the account gate
- an expired invitation cannot be accepted, and the email can be invited again
- two racing accepts of one token create one account (the loser gets `already_staff`)
- a role change writes exactly one audit row with the acting Admin (actor id, email, `before`/`after`, ip; a no-op change writes 0 rows)
- the next session read sees the new role (no cookie cache)
- cannot demote or remove the last Admin (a banned Admin does not count)
- two Admins demoting each other at once leave one Admin
- removing staff deletes their sessions and logs the removal
- a failed audit insert rolls the change back (same transaction)
- stores the sign-in rate limit in auth_rate_limit (HTTP: 401, 401, 401, 429; row `198.51.100.7|/sign-in/email`). `auth.api.signInEmail` is never limited.
- reset: request → our link → new password; old sessions are revoked; an unknown email gets the same 200 and no email

**Unit**
- `lib/server/auth/permissions.test.ts`: the §7.1 matrix row by row, plus the no-impersonation case (16 tests).
- `test/guards/require-permission.guard.test.ts`: the oxc-parser CI guard, plus a self-test. It was mutation-tested: deleting `requirePermission` from `revokeInvite` makes it fail with `app/admin/users/actions.ts#revokeInvite: no requirePermission()`.

**E2E: `e2e/admin-auth.spec.ts` (12 tests)**
- a signed-out visitor is sent to the sign-in page (also checks `lang="vi"` and noindex)
- the Admin signs in
- a browser call to /api/auth/admin/* is rejected, even for an Admin: `fetch` from the page gets 403 `{code:'ADMIN_ENDPOINT_BLOCKED'}` for set-role and 403 for list-users, and the role in the DB is unchanged
- invite → accept → signed in as Editor (and the link is single-use)
- the Editor is kept out of the Admin area (no nav link; `/admin/users` → `/admin?denied=1`)
- a role change writes exactly one audit row with the acting Admin: the test drives the UI select and asserts the DB; each change adds exactly one row
- a direct POST to the Admin-only action is refused for the Editor and for no session:
  - The captured `next-action` is replayed with the Editor's cookies as "make me Admin". Result: 200, the body contains `"code":"forbidden"`, the role is unchanged and there are 0 new audit rows.
  - With no cookie, the proxy answers 307. With a forged cookie, the request gets past the proxy and comes back `forbidden`.
- the last Admin cannot demote themselves (Vietnamese alert)
- resend replaces the link; revoke kills it
- the Editor signs out
- forgotten password: request → emailed link → new password → sign in
- sign-in attempts are rate-limited from the database (the last attempt is 429 with a Vietnamese message, and there is a row in `auth_rate_limit`)

### Key verified facts (cite these in the plan)

1. **Install.**
   - `npm i better-auth@1.7.7 zod@4.6.5`
   - `npm i -D auth@1.7.7 jiti@2.7.0 oxc-parser@0.152.0`
   - Peers are optional and satisfied: next ^14||^15||^16, react ^18||^19, pg ^8.
   - The CLI package is **`auth`**. `@better-auth/cli` is 1.4.21 and deprecated.
2. **pg adapter.**
   - Pass `database: <pg.Pool>`. Better Auth duck-types `"connect" in db` → `new Kysely({dialect: new PostgresDialect({pool})})` with `transaction: true` (`node_modules/better-auth/node_modules/@better-auth/kysely-adapter/dist/index.mjs:20,76-79`).
   - We build the instance lazily (`getAuth()`), because `next build` loads the route modules. The build passes without `BETTER_AUTH_*` env.
3. **Generating the schema.**
   - `npx auth generate --config scripts/auth-cli.config.ts --output x.sql` **introspects a live DB** and emits only the missing pieces (`auth/dist/index.mjs:1766`).
   - The CLI **auto-loads `.env` and `.env.local`** (`import "dotenv/config"` at :37; c12 `dotenv: {fileName: [".env", ".env.local"]}` at :1203).
   - So the CLI config must read its own variable (`AUTH_CLI_DATABASE_URL`) and refuse non-local hosts. **Never run `npx auth migrate`.**
   - `npx auth check` → "Schema check passed against the live database."
4. **Generated SQL** (with modelName plus the snake_case `fields` mapping and the admin plugin) is below. Migration 005 uses it verbatim apart from `IF NOT EXISTS` and a role CHECK.
   - The admin plugin adds `role`, `banned`, `ban_reason` and `ban_expires` to the user table and **`impersonated_by` to the session table**.
   - The rate-limit table is `rateLimit.modelName`: `auth_rate_limit(id text pk, key text unique, count int, last_request bigint)`.
   - `database.validateSchema` defaults to true: Better Auth introspects at cold start and fails auth requests on a mismatch. There were no warnings at runtime.
5. **Admin endpoints over HTTP vs server-side.**
   - The router passes `request` and `_flag:'router'` (`better-call/dist/router.mjs:62-72`). `auth.api.x({headers})` carries no `request`.
   - `hooks.before` sees `ctx.path` = the canonical endpoint path (`better-auth/dist/api/dispatch.mjs` runBeforeHooks/dispatchAuthEndpoint). So this blocks every HTTP call while server calls keep working:
     ```ts
     if (ctx.request && ctx.path.startsWith('/admin/')) throw new APIError('FORBIDDEN', { code: ADMIN_ENDPOINT_BLOCKED })
     ```
   - The route handler adds a second prefix check that does not depend on Better Auth internals.
   - The router's origin check runs before hooks, so the tests send a valid Origin to prove the block itself is what rejects.
6. **Rate limiting.**
   - It only exists in the HTTP router's `onRequest` (`dist/api/index.mjs` router → `onRequestRateLimit`).
   - **`auth.api.*` calls (Server Actions) are never rate-limited.** That is why sign-in and reset post from the client to `/api/auth/sign-in/email` and `/api/auth/request-password-reset`.
   - Built-in rules: `/sign-in*` allows 3 per 10 s; `/request-password-reset` allows 3 per 60 s (`dist/api/rate-limiter/index.mjs` getDefaultSpecialRules).
   - It is on by default only when NODE_ENV=production. The tests pass `rateLimitEnabled`.
   - The IP comes from a single-value `x-forwarded-for`. `next start` forwards `::1`, which is stored /64-masked as `0000:…:0000`.
7. **createUser.**
   - A server-side `auth.api.createUser` **without headers needs no session and checks no permission** (`plugins/admin/routes.mjs` createUser: `if (!session && (ctx.request || ctx.headers)) throw UNAUTHORIZED`).
   - It **does not enforce minPasswordLength**; only the maximum is asserted. Our zod and the script must check ≥12.
   - Database hooks run plugin hooks first, then ours (`dist/context/helpers.mjs:22-45`). Our `user.create.before` therefore has the last word on `role`.
8. **Sessions.**
   - The cookie cache is off by default, so `getSession` reads `staff_session` joined to `staff_user` every time, and role changes apply on the next request (tested).
   - `nextCookies()` must be last. It skips session refresh in RSC and copies `Set-Cookie` into `cookies()` inside Server Actions.
   - Setting a cookie in a Server Action re-renders the current page (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md:85-89`). The accept action therefore calls `redirect('/admin')` itself.
9. **setRole is not transactional with our pg client.**
   - It runs on Better Auth's Kysely connection. `runWithTransaction` (`@better-auth/core/dist/context/transaction.mjs`) only wraps Better Auth's own adapter.
   - **Pattern used:** role change and removal are our own SQL inside `withTransaction`. The transaction locks the active Admin rows `FOR UPDATE ORDER BY id`, does the last-admin check, the UPDATE or DELETE and `insertAudit`, then COMMITs. This is exactly what `setRole`/`removeUser` write.
   - Rule: never call `auth.api.*` while holding a pool client inside a transaction. It is not atomic, and with pool max 5 it risks a pool-exhaustion deadlock.
10. **Second root layout.** Adding `app/admin/layout.tsx` makes `next/root-params` `lang()` typed `Promise<string | undefined>` (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/next-root-params.md:286-313`).
    - The guest layouts need a 2-line fix.
    - `tsc --noEmit` on a clean checkout does **not** see this. Only `next build` or `next typegen && tsc --noEmit` does (`06-cli/next.md:177-186`). CI's typecheck should run `next typegen` first.
11. **Cache Components and the admin tree.**
    - Without `export const instant = false`, the build fails with `blocking-prerender-dynamic` at `/admin/accept-invite`.
    - With `instant = false` alone, the build passes because every page reads request data.
    - `await connection()` before `<html>` (spec §11) also guarantees that a future admin page that reads nothing request-bound can't be prerendered. The spike-2 layout should keep this.
    - The DAL uses `headers()` + React `cache()`.
    - Activity keeps the previous admin page mounted but hidden (`02-guides/preserving-ui-state.md:17`), so E2E must use role locators.

### Generated Better Auth SQL (CLI output, before hand edits)
```sql
create table "staff_user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "email_verified" boolean not null, "image" text, "created_at" timestamptz default CURRENT_TIMESTAMP not null, "updated_at" timestamptz default CURRENT_TIMESTAMP not null, "role" text, "banned" boolean, "ban_reason" text, "ban_expires" timestamptz);
create table "staff_session" ("id" text not null primary key, "expires_at" timestamptz not null, "token" text not null unique, "created_at" timestamptz default CURRENT_TIMESTAMP not null, "updated_at" timestamptz not null, "ip_address" text, "user_agent" text, "user_id" text not null references "staff_user" ("id") on delete cascade, "impersonated_by" text);
create table "staff_account" ("id" text not null primary key, "account_id" text not null, "provider_id" text not null, "user_id" text not null references "staff_user" ("id") on delete cascade, "access_token" text, "refresh_token" text, "id_token" text, "access_token_expires_at" timestamptz, "refresh_token_expires_at" timestamptz, "scope" text, "password" text, "created_at" timestamptz default CURRENT_TIMESTAMP not null, "updated_at" timestamptz not null);
create table "staff_verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expires_at" timestamptz not null, "created_at" timestamptz default CURRENT_TIMESTAMP not null, "updated_at" timestamptz default CURRENT_TIMESTAMP not null);
create table "auth_rate_limit" ("id" text not null primary key, "key" text not null unique, "count" integer not null, "last_request" bigint not null);
create index "staff_session_user_id_idx" on "staff_session" ("user_id");
create index "staff_account_user_id_idx" on "staff_account" ("user_id");
create index "staff_verification_identifier_idx" on "staff_verification" ("identifier");
```

### db/migrations/005_staff_auth_audit.sql
```sql
-- Phase 3: staff sign-in and the audit trail (spec §5.2 "Nhân viên, quản trị", §7.1).
--
-- The five Better Auth tables are the output of
--   AUTH_CLI_DATABASE_URL=postgres://localhost:5432/<empty>_test \
--     npx auth generate --config scripts/auth-cli.config.ts --output <file>
-- (better-auth 1.7.7, after modelName/fields and the admin plugin were set in
-- lib/server/auth/config.ts), with IF NOT EXISTS added and one CHECK on role.
-- Better Auth validates this shape at start-up (database.validateSchema), so
-- change config.ts and regenerate rather than editing the columns here.

-- ── Better Auth ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff_user (
  id             text        NOT NULL PRIMARY KEY,
  name           text        NOT NULL,
  email          text        NOT NULL UNIQUE,
  email_verified boolean     NOT NULL,
  image          text,
  created_at     timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- admin plugin
  role           text        CONSTRAINT staff_user_role_check CHECK (role IN ('admin', 'editor')),
  banned         boolean,
  ban_reason     text,
  ban_expires    timestamptz
);

CREATE TABLE IF NOT EXISTS staff_session (
  id              text        NOT NULL PRIMARY KEY,
  expires_at      timestamptz NOT NULL,
  token           text        NOT NULL UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      timestamptz NOT NULL,
  ip_address      text,
  user_agent      text,
  user_id         text        NOT NULL REFERENCES staff_user (id) ON DELETE CASCADE,
  -- admin plugin; stays NULL: no role may impersonate (spec §7.1)
  impersonated_by text
);

CREATE TABLE IF NOT EXISTS staff_account (
  id                       text        NOT NULL PRIMARY KEY,
  account_id               text        NOT NULL,
  provider_id              text        NOT NULL,
  user_id                  text        NOT NULL REFERENCES staff_user (id) ON DELETE CASCADE,
  access_token             text,
  refresh_token            text,
  id_token                 text,
  access_token_expires_at  timestamptz,
  refresh_token_expires_at timestamptz,
  scope                    text,
  password                 text,
  created_at               timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at               timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS staff_verification (
  id         text        NOT NULL PRIMARY KEY,
  identifier text        NOT NULL,
  value      text        NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- rateLimit.storage = 'database': one row per "<ip>|<path>" key.
CREATE TABLE IF NOT EXISTS auth_rate_limit (
  id           text    NOT NULL PRIMARY KEY,
  key          text    NOT NULL UNIQUE,
  count        integer NOT NULL,
  last_request bigint  NOT NULL  -- epoch milliseconds
);

CREATE INDEX IF NOT EXISTS staff_session_user_id_idx ON staff_session (user_id);
CREATE INDEX IF NOT EXISTS staff_account_user_id_idx ON staff_account (user_id);
CREATE INDEX IF NOT EXISTS staff_verification_identifier_idx ON staff_verification (identifier);

-- ── staff_invitation ──────────────────────────────────────────────────────
-- App-owned invitations. Only the SHA-256 of the token is stored. "Gửi lại"
-- (resend) replaces token_hash and expires_at in place, so the old link dies.
CREATE TABLE IF NOT EXISTS staff_invitation (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email       text        NOT NULL CHECK (email = lower(email) AND email ~ '^[^@\s]+@[^@\s]+$'),
  role        text        NOT NULL CHECK (role IN ('admin', 'editor')),
  token_hash  text        NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  revoked_at  timestamptz,
  invited_by  text,       -- staff_user.id; no FK, the history outlives the inviter (spec §5.1.6)
  email_error text,       -- last delivery failure; NULL once a send succeeds
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_invitation_closed_once CHECK (used_at IS NULL OR revoked_at IS NULL)
);

-- One open invitation per email. "Open" here ignores expiry (now() cannot sit
-- in an index predicate); createInvitation revokes an expired one first.
CREATE UNIQUE INDEX IF NOT EXISTS staff_invitation_open_email_idx
  ON staff_invitation (email) WHERE used_at IS NULL AND revoked_at IS NULL;

-- ── audit_log ─────────────────────────────────────────────────────────────
-- Written in the same transaction as the change it records (spec §7.4).
-- actor_* are snapshots without FKs, so the log survives a staff removal.
CREATE TABLE IF NOT EXISTS audit_log (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  actor_id    text,
  actor_email text,
  action      text        NOT NULL
              CHECK (action ~ '^(create|update|delete|reorder|restore|settings|staff\.[a-z_]+)$'),
  entity_type text        NOT NULL CHECK (entity_type <> ''),
  entity_id   text,
  locale      text,
  before      jsonb,
  after       jsonb,
  ip          inet
);

CREATE INDEX IF NOT EXISTS audit_log_entity_idx ON audit_log (entity_type, entity_id, at DESC);
CREATE INDEX IF NOT EXISTS audit_log_at_idx ON audit_log (at DESC, id DESC);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx ON audit_log (actor_id, at DESC);

-- ── audit_feed ────────────────────────────────────────────────────────────
-- The /admin/audit timeline. Phase 4 replaces this (CREATE OR REPLACE VIEW,
-- same columns in the same order) with a UNION ALL over reservation_events.
CREATE OR REPLACE VIEW audit_feed AS
SELECT 'audit'::text   AS source,
       a.id::text      AS id,
       a.at,
       a.actor_id,
       a.actor_email   AS actor_label,
       a.action,
       a.entity_type,
       a.entity_id,
       a.locale,
       a.before,
       a.after
  FROM audit_log a;
```

### lib/server/auth/permissions.ts
```ts
import { createAccessControl } from 'better-auth/plugins/access';
import { defaultStatements } from 'better-auth/plugins/admin/access';

/*
 * The permission matrix of spec §7.1. `user` and `session` are the admin
 * plugin's own resources (its auth.api.* endpoints check them); the rest are
 * ours. No role gets `impersonate` or `impersonate-admins` (spec §7.1).
 *
 * This file has no server-only import: the CLI config and the bootstrap script
 * load it outside Next.
 */
export const statement = {
  ...defaultStatements,
  /** Content, files and translations; `ai` = use the AI helpers; `restore` = history (§7.5). */
  content: ['read', 'update', 'restore', 'ai'],
  /** Handle, create and annotate bookings; `configure` = per-restaurant booking switch and overrides. */
  reservations: ['read', 'update', 'create', 'note', 'configure', 'auto-confirm', 'purge-test'],
  /** Service periods, capacity, closures. */
  closures: ['read', 'update'],
  locales: ['read', 'update'],
  /** Booking, notification and AI settings. */
  settings: ['read', 'update'],
  /** The site-wide audit log (/admin/audit). Per-record history is content:read. */
  audit: ['read'],
} as const;

export const ac = createAccessControl(statement);

const editorStatements = {
  content: ['read', 'update', 'restore', 'ai'],
  reservations: ['read', 'update', 'create', 'note', 'configure'],
  closures: ['read', 'update'],
} as const;

export const editor = ac.newRole(editorStatements);

export const admin = ac.newRole({
  ...editorStatements,
  reservations: [...editorStatements.reservations, 'auto-confirm', 'purge-test'],
  locales: ['read', 'update'],
  settings: ['read', 'update'],
  audit: ['read'],
  user: ['create', 'list', 'get', 'update', 'set-role', 'ban', 'delete', 'set-password'],
  session: ['list', 'revoke', 'delete'],
});

export const roles = { admin, editor };

export const STAFF_ROLES = ['admin', 'editor'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export function isStaffRole(value: unknown): value is StaffRole {
  return value === 'admin' || value === 'editor';
}

type Statement = typeof statement;
/** e.g. `{ user: ['set-role'] }` — the shape auth.api.userHasPermission takes. */
export type Permissions = { [K in keyof Statement]?: Statement[K][number][] };

/**
 * Same rule as the admin plugin's hasPermission (comma-separated roles, any
 * role that grants every requested action wins), without a database call.
 */
export function roleCan(role: string | null | undefined, permissions: Permissions): boolean {
  if (!role) return false;
  return role.split(',').some((r) => {
    const grant = isStaffRole(r) ? roles[r] : undefined;
    return grant?.authorize(permissions).success === true;
  });
}
```

### lib/server/auth/signup-gate.ts
```ts
import type { StaffRole } from './permissions';

/** Anything with pg's `query` (a Pool or a checked-out client). */
export type Queryable = {
  query<R extends Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: R[] }>;
};

export type SignupDecision =
  | { ok: true; role: StaffRole; via: 'invitation' | 'bootstrap' }
  | { ok: false };

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Who may get a staff_user row (spec §7.1): an email with an open invitation
 * (not used, not revoked, not expired) takes the invitation's role; the
 * BOOTSTRAP_ADMIN_EMAIL becomes Admin, but only while no Admin exists.
 * Everyone else is refused. Runs inside databaseHooks.user.create.before, so
 * every path that creates a user (admin createUser, the bootstrap script, a
 * future plugin) goes through it.
 */
export async function decideSignup(
  db: Queryable,
  email: string,
  bootstrapAdminEmail: string | undefined,
): Promise<SignupDecision> {
  const normalized = normalizeEmail(email);
  const { rows } = await db.query<{ role: StaffRole }>(
    `SELECT role FROM staff_invitation
      WHERE email = $1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()
      ORDER BY created_at DESC
      LIMIT 1`,
    [normalized],
  );
  if (rows[0]) return { ok: true, role: rows[0].role, via: 'invitation' };

  if (bootstrapAdminEmail && normalized === normalizeEmail(bootstrapAdminEmail)) {
    const admins = await db.query(
      `SELECT 1 FROM staff_user WHERE 'admin' = ANY (string_to_array(role, ',')) LIMIT 1`,
    );
    if (admins.rows.length === 0) return { ok: true, role: 'admin', via: 'bootstrap' };
  }
  return { ok: false };
}
```

### lib/server/auth/config.ts
This file is shared by the app, the CLI, the bootstrap script and the tests, so it has no `server-only` import.
```ts
import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { nextCookies } from 'better-auth/next-js';
import { admin as adminPlugin } from 'better-auth/plugins/admin';
import type { Pool } from 'pg';
import { ac, roles } from './permissions';
import { decideSignup } from './signup-gate';

export const ADMIN_ENDPOINT_BLOCKED = 'ADMIN_ENDPOINT_BLOCKED';
export const INVITATION_REQUIRED = 'INVITATION_REQUIRED';
const DAY = 24 * 60 * 60;

export type AuthDeps = {
  pool: Pool;
  secret: string | undefined;          // BETTER_AUTH_SECRET
  baseURL: string | undefined;         // BETTER_AUTH_URL, also the origin of emailed links
  bootstrapAdminEmail: string | undefined;
  sendResetPassword: (to: { email: string; name: string }, link: string) => Promise<void>;
  rateLimitEnabled?: boolean;          // default: Better Auth's (production only)
};

export function createAuth(deps: AuthDeps) {
  return betterAuth({
    appName: 'Furama Cuisine',
    secret: deps.secret,
    baseURL: deps.baseURL,
    database: deps.pool,
    telemetry: { enabled: false },
    user: { modelName: 'staff_user', fields: { emailVerified: 'email_verified', createdAt: 'created_at', updatedAt: 'updated_at' } },
    session: {
      modelName: 'staff_session', expiresIn: 7 * DAY, updateAge: DAY,
      fields: { userId: 'user_id', expiresAt: 'expires_at', ipAddress: 'ip_address', userAgent: 'user_agent', createdAt: 'created_at', updatedAt: 'updated_at' },
    },
    account: {
      modelName: 'staff_account',
      fields: { accountId: 'account_id', providerId: 'provider_id', userId: 'user_id', accessToken: 'access_token', refreshToken: 'refresh_token', idToken: 'id_token', accessTokenExpiresAt: 'access_token_expires_at', refreshTokenExpiresAt: 'refresh_token_expires_at', createdAt: 'created_at', updatedAt: 'updated_at' },
    },
    verification: { modelName: 'staff_verification', fields: { expiresAt: 'expires_at', createdAt: 'created_at', updatedAt: 'updated_at' } },
    // Counted per IP and path by the HTTP router only; auth.api.* calls are not limited.
    rateLimit: { enabled: deps.rateLimitEnabled, storage: 'database', modelName: 'auth_rate_limit', fields: { lastRequest: 'last_request' } },
    emailAndPassword: {
      enabled: true, disableSignUp: true, minPasswordLength: 12, maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true, resetPasswordTokenExpiresIn: 60 * 60,
      // Our own page, not Better Auth's /api/auth/reset-password/:token redirect hop.
      sendResetPassword: async ({ user, token }) => {
        const link = new URL('/admin/reset-password', deps.baseURL);
        link.searchParams.set('token', token);
        await deps.sendResetPassword({ email: user.email, name: user.name }, link.toString());
      },
    },
    databaseHooks: {
      user: { create: {
        // Runs after the admin plugin's own hook, so it has the last word on `role`.
        before: async (user) => {
          const decision = await decideSignup(deps.pool, user.email, deps.bootstrapAdminEmail);
          if (!decision.ok) throw new APIError('FORBIDDEN', { code: INVITATION_REQUIRED, message: 'This email has no open invitation.' });
          return { data: { ...user, role: decision.role } };
        },
      } },
    },
    hooks: {
      // Spec §7.1: no browser may reach the admin plugin's endpoints. The HTTP
      // router passes `request`; a server-side auth.api.* call does not.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.request && ctx.path.startsWith('/admin/')) {
          throw new APIError('FORBIDDEN', { code: ADMIN_ENDPOINT_BLOCKED, message: 'Admin endpoints are server-only.' });
        }
      }),
    },
    plugins: [
      adminPlugin({
        ac, roles, defaultRole: 'editor', adminRoles: ['admin'],
        schema: { user: { fields: { banReason: 'ban_reason', banExpires: 'ban_expires' } }, session: { fields: { impersonatedBy: 'impersonated_by' } } },
      }),
      nextCookies(), // must stay last
    ],
  });
}
export type Auth = ReturnType<typeof createAuth>;
```
The file in the clone is the same, with the long object literals split over several lines.

### lib/server/auth/auth.ts
```ts
import 'server-only';
import { getPool } from '@/db/client';
import { createAuthMailer, deliveryMode, resetEmail, type AuthMailer } from '@/lib/server/email/auth-mail';
import { createAuth, type Auth } from './config';

/* Built on first use, not at import time: `next build` loads route modules
 * while collecting page data, and getPool() throws without DATABASE_URL. */
let instance: Auth | undefined;
let mailer: AuthMailer | undefined;

export function getAuthMailer(): AuthMailer {
  mailer ??= createAuthMailer({ mode: deliveryMode(process.env.EMAIL_DELIVERY), redirectTo: process.env.EMAIL_REDIRECT_TO, logFile: process.env.EMAIL_LOG_FILE });
  return mailer;
}

export function getAuth(): Auth {
  instance ??= createAuth({
    pool: getPool(),
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL,
    bootstrapAdminEmail: process.env.BOOTSTRAP_ADMIN_EMAIL,
    sendResetPassword: (to, link) => getAuthMailer()(resetEmail(to.email, to.name, link)),
  });
  return instance;
}
```

### lib/server/auth/session.ts (DAL)
```ts
import 'server-only';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { getAuth } from './auth';
import { isStaffRole, roleCan, type Permissions, type StaffRole } from './permissions';

// Every read hits the DB (Better Auth cookie cache is off). headers() makes callers dynamic;
// the admin layout (instant = false + await connection()) renders the tree at request time.
export type StaffSession = { userId: string; email: string; name: string; role: StaffRole; ip: string | null };

export class PermissionError extends Error {
  constructor(readonly code: 'unauthenticated' | 'forbidden') { super(code); this.name = 'PermissionError'; }
}

export const getStaffSession = cache(async (): Promise<StaffSession | null> => {
  const requestHeaders = await headers();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session) return null;
  const { user } = session;
  if (user.banned || !isStaffRole(user.role)) return null;
  return { userId: user.id, email: user.email, name: user.name, role: user.role,
    ip: requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() || null };
});

/** Pages: the staff member, or a redirect to sign-in. */
export async function verifySession(): Promise<StaffSession> {
  const staff = await getStaffSession();
  if (!staff) redirect('/admin/sign-in');
  return staff;
}

/** Actions, route handlers, pages: throws PermissionError unless the role grants every action. */
export async function requirePermission(permissions: Permissions): Promise<StaffSession> {
  const staff = await getStaffSession();
  if (!staff) throw new PermissionError('unauthenticated');
  if (!roleCan(staff.role, permissions)) throw new PermissionError('forbidden');
  return staff;
}

/** Pages: redirect instead of throwing (forbidden() needs experimental.authInterrupts). */
export async function requirePagePermission(permissions: Permissions): Promise<StaffSession> {
  const staff = await verifySession();
  if (!roleCan(staff.role, permissions)) redirect('/admin?denied=1');
  return staff;
}

export function permissionResponse(err: unknown): Response {
  if (err instanceof PermissionError) return Response.json({ code: err.code }, { status: err.code === 'unauthenticated' ? 401 : 403 });
  throw err;
}

export function auditActor(staff: StaffSession) { return { id: staff.userId, email: staff.email, ip: staff.ip }; }
```

### lib/server/audit.ts
```ts
import { isIP } from 'node:net';
import type { Pool, PoolClient } from 'pg';

export type AuditActor = { id: string; email: string; ip?: string | null };
export type AuditEntry = { action: string; entityType: string; entityId: string | null; locale?: string | null; before?: unknown; after?: unknown };

export async function insertAudit(client: PoolClient, actor: AuditActor | null, entry: AuditEntry): Promise<void> {
  const ip = actor?.ip && isIP(actor.ip) ? actor.ip : null;
  await client.query(
    `INSERT INTO audit_log (actor_id, actor_email, action, entity_type, entity_id, locale, before, after, ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [actor?.id ?? null, actor?.email ?? null, entry.action, entry.entityType, entry.entityId, entry.locale ?? null,
     entry.before === undefined ? null : JSON.stringify(entry.before),
     entry.after === undefined ? null : JSON.stringify(entry.after), ip],
  );
}

export async function withTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
```

### lib/server/auth/staff.ts (invites, accept, role, remove; every function takes injected deps)
Constants and helpers:
- `INVITE_TTL = '7 days'`
- `hashToken` = SHA-256 hex
- `newInviteToken()` = `randomBytes(32).toString('base64url')` plus its hash
- The invite link is `${baseURL}/admin/accept-invite?token=…`.

`deliverInvite` sends after the commit. On success it sets `email_error = NULL`. On failure it stores `email_error` (first 500 characters), logs `{id, code:'email_error'}` with no PII, and returns false.

`createInvitation(deps, actor, {email, role})` runs one transaction:
1. If `staff_user` already has this email → `already_staff`.
2. Revoke any expired open invitation for the email.
3. ```sql
   INSERT … VALUES ($1,$2,$3, now()+$4::interval, $5)
   ON CONFLICT (email) WHERE used_at IS NULL AND revoked_at IS NULL DO NOTHING
   RETURNING id::text, expires_at
   ```
   If no row comes back → `already_invited`.
4. `insertAudit('staff.invite', 'staff_invitation', id, after: {email, role, expires_at})`. The token is never logged.
5. After COMMIT: `deliverInvite`.

It returns `{ok:true, id, emailSent}`.

`resendInvitation(deps, actor, id)`, in a transaction:
```sql
UPDATE staff_invitation
   SET token_hash = $new, expires_at = now() + 7d, email_error = NULL
 WHERE id = $1 AND used_at IS NULL AND revoked_at IS NULL
RETURNING email, role, expires_at
```
Then it writes the audit row `'staff.invite_resend'` and, after the commit, delivers. This revives an expired invitation, and the old link dies.

`revokeInvitation`: `UPDATE … SET revoked_at = now() WHERE open RETURNING email, role`, then the audit row `'staff.invite_revoke'` with `before` = that row.

`findOpenInvitation(pool, token)`: requires `/^[A-Za-z0-9_-]{43}$/`, then looks the token up by hash with `used_at/revoked_at IS NULL AND expires_at > now()`.

`acceptInvitation(deps, {token, name, password}, ip)`:
1. `findOpenInvitation`.
2. ```ts
   auth.api.createUser({ body: { email, password, name, role: invitation.role, data: { emailVerified: true } } })
   ```
   No headers are passed, so this is a trusted server call. The hook re-checks the invitation.
3. Error mapping: `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL` → `already_staff`; `INVITATION_REQUIRED` → `invalid_token`.
4. One transaction: `UPDATE used_at = now() WHERE id AND used_at IS NULL`, plus the audit row `'staff.invite_accept'` with the new user as actor, the IP, and `after {email, role, invitation_id}`.

The caller then runs `auth.api.signInEmail({ body, headers: await headers() })`, and `nextCookies` sets the cookie.

```ts
async function lockAdmins(c) { await c.query(`SELECT id FROM staff_user WHERE role = 'admin' ORDER BY id FOR UPDATE`); }
async function otherActiveAdmins(c, userId) { /* count(*) WHERE role='admin' AND id <> $1 AND banned IS NOT TRUE */ }

export async function setStaffRole(pool, actor, { userId, role }) {
  return withTransaction(pool, async (c) => {
    await lockAdmins(c);
    const target = (await c.query('SELECT id, role FROM staff_user WHERE id = $1 FOR UPDATE', [userId])).rows[0];
    if (!target) return { ok: false, code: 'not_found' };
    if (target.role === role) return { ok: true, changed: false };            // no audit row
    if (target.role === 'admin' && (await otherActiveAdmins(c, target.id)) === 0) return { ok: false, code: 'last_admin' };
    await c.query('UPDATE staff_user SET role = $2, updated_at = now() WHERE id = $1', [target.id, role]); // = auth.api.setRole's write
    await insertAudit(c, actor, { action: 'staff.role', entityType: 'staff_user', entityId: target.id, before: { role: target.role }, after: { role } });
    return { ok: true, changed: true };
  });
}
```

`removeStaff(pool, actor, userId)`:
- Removing yourself → `self`.
- Otherwise the same lock and last-admin check, then `DELETE FROM staff_user` (sessions and accounts go with it via ON DELETE CASCADE, as `auth.api.removeUser` would do).
- The audit row is `'staff.remove'` with `before {email, name, role}`.

### lib/server/email/auth-mail.ts
- `deliveryMode(EMAIL_DELIVERY)` returns `live|redirect|log`, default `log`.
- `createAuthMailer({mode, redirectTo, transport, logFile})`:
  - `log`: `console.info('[auth-mail:log] kind → to')`, and appends a JSONL line to `EMAIL_LOG_FILE` when that is set. The E2E reads links from that file.
  - `redirect`: sends to `EMAIL_REDIRECT_TO` with the subject `[→ original] …`.
  - `live`: sends through the injected `transport`. The Resend transport is not wired; the email spike owns it.
- `inviteEmail(to, role, link)` and `resetEmail(to, name, link)` produce a Vietnamese subject and text.

### app/api/auth/[...all]/route.ts
```ts
import { getAuth } from '@/lib/server/auth/auth';
import { ADMIN_ENDPOINT_BLOCKED } from '@/lib/server/auth/config';

async function handle(request: Request): Promise<Response> {
  if (new URL(request.url).pathname.startsWith('/api/auth/admin/')) {
    return Response.json({ code: ADMIN_ENDPOINT_BLOCKED }, { status: 403 });
  }
  return getAuth().handler(request);
}
export { handle as GET, handle as POST };
```
`toNextJsHandler` from `better-auth/next-js` exists, but it is just `(req) => auth.handler(req)` for GET/POST/PATCH/PUT/DELETE. We need the extra prefix check and lazy init, so it isn't used.

### proxy.ts (only the /admin branch changed)
```ts
import { getSessionCookie } from 'better-auth/cookies';
const PUBLIC_ADMIN_PATHS = new Set(['/admin/sign-in', '/admin/accept-invite', '/admin/reset-password']);
// in proxy():
if (pathname === '/admin' || pathname.startsWith('/admin/')) {
  if (PUBLIC_ADMIN_PATHS.has(pathname) || getSessionCookie(request)) return NextResponse.next();
  return NextResponse.redirect(new URL('/admin/sign-in', request.url), 307);
}
```
`getSessionCookie` handles both `better-auth.session_token` and the `__Secure-` prefix.

### Guest root-layout fix (needed as soon as app/admin/layout.tsx exists)
```diff
- const code = await lang();
+ const code = (await lang()) ?? '';            // app/(site)/[lang]/layout.tsx
- if (!enabled.some((l) => l.code === locale)) notFound();
+ if (!locale || !enabled.some((l) => l.code === locale)) notFound();   // (guarded)/layout.tsx
```

### app/admin/layout.tsx (a stand-in; the layout spike owns the CSP nonce and XFO)
```tsx
import type { Metadata } from 'next';
import { connection } from 'next/server';
import type { ReactNode } from 'react';
export const instant = false;
export const metadata: Metadata = { title: { default: 'Quản trị · Furama Cuisine', template: '%s · Quản trị Furama Cuisine' }, robots: { index: false, follow: false } };
export default async function AdminLayout({ children }: { children: ReactNode }) {
  await connection();
  return (<html lang="vi"><body>{children}</body></html>);
}
```

### Server Actions
**app/admin/users/actions.ts**
- Exports: `inviteStaff(prev, formData)`, `resendInvite(id)`, `revokeInvite(id)`, `changeStaffRole(userId, role)` and `removeStaffMember(userId)`.
- Each one does: `try { const actor = await requirePermission({ user: ['create'|'set-role'|'delete'] }); zod.parse(...); await staff.X(deps, auditActor(actor), input); refresh(); return {ok:true,data} } catch (e) { return actionError(e) }`.
- `lib/server/action-result.ts`: `z.config(z.locales.vi())`. `actionError` maps PermissionError → `forbidden`, ZodError → `invalid` + `fieldErrors` (`z.flattenError`), and anything else → a logged `db_error`.

**app/admin/accept-invite/actions.ts** (PUBLIC)
```ts
export async function acceptInvitation(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const result = await run(formData);
  // Outside the try: redirect() throws. Setting the cookie re-renders this page,
  // where the now-used invitation would show as invalid, so leave it from here.
  if (result.ok) redirect('/admin');
  return result;
}
async function run(formData: FormData): Promise<ActionResult> {
  try {
    const input = AcceptInput.parse({ token: formData.get('token'), name: formData.get('name'), password: formData.get('password') }); // password min 12 max 128
    const auth = getAuth();
    const requestHeaders = await headers();
    const result = await accept({ pool: getPool(), auth, mailer: getAuthMailer(), baseURL: process.env.BETTER_AUTH_URL ?? '' }, input,
      requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() || null);
    if (!result.ok) return result;
    await auth.api.signInEmail({ body: { email: result.email, password: input.password }, headers: requestHeaders }); // nextCookies sets the cookie
    return { ok: true, data: null };
  } catch (err) { return actionError(err); }
}
```

### Pages (full source in the patch)
- **`/admin/sign-in`**: a client form that POSTs JSON to `/api/auth/sign-in/email`, then calls `location.assign('/admin')`. Errors go through `authErrorMessage(code, status)`, which maps 429 to "Bạn đã thử quá nhiều lần…".
- **`/admin/reset-password`**:
  - Without `?token`, it POSTs `{email}` to `/api/auth/request-password-reset` and always answers "Nếu email này có tài khoản…".
  - With `?token`, it POSTs `{token, newPassword}` to `/api/auth/reset-password`.
- **`/admin/accept-invite`**: validates the token on the server (`findOpenInvitation`) and uses `useActionState(acceptInvitation)`.
- **`/admin`**: calls `verifySession()`; shows the denied notice, and shows the users link only for `roleCan(user:list)`.
- **`/admin/users`**: `requirePagePermission({user:['list']})`. It has a staff table with a role `<select>` (`useTransition` + action), pending invitations with Gửi lại / Thu hồi and the "Chưa gửi được email, bấm Gửi lại" notice, and an invite form.
  - Dates are formatted with `Intl.DateTimeFormat('vi-VN', {timeZone: 'Asia/Ho_Chi_Minh'})`.
  - "Expired" is computed in SQL (`expires_at <= now()`).
- **Sign-out**: a client `POST /api/auth/sign-out`.
- **`lib/admin/auth-errors.ts`**: Better Auth codes and admin action codes mapped to Vietnamese.

### scripts/create-admin.mjs (bootstrap)
- It takes `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_NAME` and `BOOTSTRAP_ADMIN_PASSWORD` (or a hidden prompt), plus `DATABASE_URL`, `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL`. It does not read `.env` files.
- It checks that the password is 12–128 characters, because createUser doesn't check the minimum.
- It loads `lib/server/auth/config.ts` through `createJiti(import.meta.url, { alias: {'@/': root} })`.
- It calls `auth.api.createUser({ body: { email, password, name, role: 'admin' } })`, so the gate allows it only while no Admin exists.
- It writes the audit row `'staff.bootstrap'` and applies `sslmode=verify-full` for non-local hosts.

Verified runs:
- `Admin created: owner@furama.test (…)`
- re-run with the same email → `refused: owner@furama.test already has an account.` (exit 1)
- another email → `refused: an Admin already exists, or the email is not BOOTSTRAP_ADMIN_EMAIL.`
- short password → refused

### scripts/auth-cli.config.ts
It reads `AUTH_CLI_DATABASE_URL` and refuses non-localhost hosts or query strings. It exports `auth = createAuth({ pool: new Pool({connectionString: url}), secret: 'cli-only…', baseURL: 'http://localhost:3000', … })`.

### test/guards/require-permission.guard.test.ts
- Uses `oxc-parser@0.152.0` (`parseSync`), because TS 7 has no JS compiler API.
- Scans app/, lib/ and components/ for:
  - file-level `'use server'` (ESTree `ExpressionStatement.directive`): every export must be a local function whose body contains a `requirePermission(` call;
  - inline `'use server'` functions;
  - GET/POST/… in `app/api/admin/**/route.ts`.
- Public allowlist: `app/actions.ts#submitReservation` and `app/admin/accept-invite/actions.ts#acceptInvitation`.

### Runtime probes (curl against `next start` on :3202)
| Request | Result |
|---|---|
| `GET /admin` with no cookie | 307 → `/admin/sign-in` |
| `POST /api/auth/admin/set-role` | 403 `{"code":"ADMIN_ENDPOINT_BLOCKED"}` |
| sign-in with an evil Origin | 403 `INVALID_ORIGIN` |
| sign-in with no Origin and no cookie | handled normally (401 for a wrong password) |
| sign-up | 400 `EMAIL_PASSWORD_SIGN_UP_DISABLED` |
| `/admin/sign-in` headers | `Cache-Control: private, no-cache, no-store` |

There were no Better Auth schema-validation warnings in the server log.

### Environment used for build, start and E2E
```
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE=
DATABASE_URL=postgres://localhost:5432/furama_cuisine_p3auth_test
BETTER_AUTH_SECRET=$(openssl rand -base64 32)
BETTER_AUTH_URL=http://localhost:3201
EMAIL_DELIVERY=log
EMAIL_LOG_FILE=<scratch>/emails.jsonl
E2E_PORT=3201
```
Before Playwright: `RESET_DATABASE_URL=… node scripts/reset-db.mjs`, then `node scripts/create-admin.mjs`. The build itself needs no `BETTER_AUTH_*` variables.

## Errors hit

1. **While `auth generate` ran: "ERROR [Better Auth]: Database schema mismatch — Missing tables staff_user, …"**
   - Cause: the CLI introspects the live DB (getMigrations) and logs the diff before generating. This is expected on an empty DB.
   - Fix: none needed. Run it only against an empty local `_test` DB through `AUTH_CLI_DATABASE_URL`.
2. **After migration 005, `auth generate` printed "WARN Field last_request in table auth_rate_limit has a different type in the database. Expected number but got int8."**
   - Cause: an upstream inconsistency. The CLI emits `bigint` for the `bigint:true` number field, then its own type comparison flags int8.
   - Fix: cosmetic. `npx auth check` passes, generate reports "already up to date", and the runtime server log is clean. Keep bigint.
3. **next build: TS2345 "Argument of type 'string | undefined' is not assignable to parameter of type 'string'" in `app/(site)/[lang]/layout.tsx:56` and `(guarded)/layout.tsx:22,26`**
   - Cause: a second root layout (`app/admin/layout.tsx`) without `[lang]` makes the generated `next/root-params` `lang()` return `Promise<string | undefined>` (`next-root-params.md:286-313`). Plain `tsc --noEmit` misses it until `.next/types` exists.
   - Fix: `(await lang()) ?? ''` in the site root layout and `if (!locale || !enabled.some(...)) notFound()` in the guarded layout. CI's typecheck should be `next typegen && tsc --noEmit` (verified that it catches this).
4. **oxlint error react(purity): `Date.now` is an impure function (`app/admin/users/page.tsx`)**
   - Cause: invitation expiry was computed in render.
   - Fix: compute `expires_at <= now() AS expired` in SQL.
5. **oxlint warnings next(no-html-link-for-pages) on admin pages**
   - Cause: plain `<a>` used for internal links.
   - Fix: use `next/link`.
6. **create-admin printed "BETTER_AUTH_SECRET is not set" even though it was in `$E`**
   - Cause: zsh doesn't word-split `env $E`.
   - Fix: run the env-heavy commands from bash scripts in the scratchpad.
7. **Integration: listUsers emails toEqual mismatch**
   - Cause: a test bug. The expected array wasn't sorted the way `.sort()` sorts.
   - Fix: expect `['ed@furama.test', 'owner@furama.test']`.
8. **E2E invite→accept: the URL stayed on `/admin/accept-invite` and the page showed "Lời mời không hợp lệ…"**
   - Cause: `nextCookies()` sets the session cookie inside the Server Action, so Next re-renders the current route (`cookies.md:85-89`). The invitation is now used, so the page renders the invalid view and unmounts the form before its client `useEffect` redirect runs.
   - Fix: `redirect('/admin')` from the action itself, after the try/catch (redirect throws NEXT_REDIRECT). The client effect was removed.
9. **E2E strict mode violation: `getByRole('alert')` resolved to 2 elements**
   - Cause: Next's `#__next-route-announcer__` also has `role=alert`.
   - Fix: scope to `page.getByRole('main')`.
10. **E2E revoke: expected the status "Đã thu hồi." but the element was gone**
    - Cause: `refresh()` re-renders the list, and revoked invitations aren't listed, so the row and its status span disappear.
    - Fix: assert the row has count 0 and that `revoked_at` is set in the DB.
11. **E2E reset: the form was submitted empty / strict mode "getByLabel(Email) resolved to 2 elements"**
    - Cause: (1) The Link click returns before client navigation finishes. (2) Cache Components keeps the previous route mounted but hidden in React `<Activity>` (`preserving-ui-state.md:17`), so the hidden sign-in Email input still matches `getByLabel`.
    - Fix: wait for `toHaveURL`, then use `getByRole('textbox', { name: 'Email' })`; role queries skip hidden nodes.
12. **Probe: a build without `export const instant = false` in `app/admin/layout.tsx` failed: 'Route "/admin/accept-invite": Next.js encountered uncached or runtime data during prerendering' (blocking-prerender-dynamic)**
    - Cause: Cache Components validates a static shell for every route.
    - Fix: keep `instant = false` (this alone builds) plus `await connection()` before `<html>` (spec §11), which also covers future admin pages that read no request data.

## Package versions

- better-auth@1.7.7 (dependency; optional peers next ^14||^15||^16, react ^18||^19, pg ^8, all satisfied)
- @better-auth/core@1.7.7, @better-auth/kysely-adapter@1.7.7, @better-auth/telemetry@1.7.7 (transitive; telemetry is off by default and also set to `enabled:false`)
- better-call@1.4.0 (transitive)
- kysely@0.29.6 (transitive)
- zod@4.6.5 (dependency added; the same version better-auth bundles; `z.locales.vi()` verified)
- auth@1.7.7 (devDependency: the Better Auth CLI; @better-auth/cli@1.4.21 is deprecated)
- jiti@2.7.0 (devDependency, for `scripts/create-admin.mjs`)
- oxc-parser@0.152.0 (devDependency, for the requirePermission CI guard)
- next@16.3.7, react@19.3.0, react-dom@19.3.0, pg@8.23.x, typescript@7.0.2 (tsc typechecks the Better Auth types in about 0.4 s), vitest@5.0.3, @playwright/test@1.63.0, oxlint@1.86.0
- Node v22.22.0; local PostgreSQL 18.3 (Homebrew)

## Recommended task breakdown

Phase 3 plan. Each task is TDD with its own gate. Most of the code exists in `p3-auth.patch` and can be cherry-picked task by task.

**T1. Dependencies, config, migration 005.**
- Install better-auth, zod, and the dev tools auth, jiti and oxc-parser at the exact versions listed.
- Add `lib/server/auth/{permissions,signup-gate,config}.ts` and `scripts/auth-cli.config.ts`.
- Generate the SQL through the CLI against an empty `_test` DB, then write `db/migrations/005_staff_auth_audit.sql` (the Better Auth tables, staff_invitation, audit_log, and audit_feed over audit_log only).
- Patch the two guest layouts for the optional root param.
- Change the CI/npm typecheck to `next typegen && tsc --noEmit`.
- Gate: a migration-005 integration test plus `npx auth check` on the local DB.

**T2. Auth instance, route and DAL.**
- `lib/server/auth/auth.ts` (lazy getAuth), `app/api/auth/[...all]/route.ts` (prefix block + handler), the `proxy.ts` cookie check, `lib/server/auth/session.ts` (getStaffSession / verifySession / requirePermission / requirePagePermission / permissionResponse), `lib/server/action-result.ts`.
- Gate: integration tests for the hooks.before block (HTTP 403 with a valid Origin + Admin cookie), auth.api.* still serving, no impersonation, sign-up closed; the permissions unit matrix.

**T3. Audit helper and staff domain.**
- `lib/server/audit.ts` and `lib/server/auth/staff.ts` (create, resend, revoke, findOpen, accept; setStaffRole and removeStaff with FOR UPDATE admin locks). Add banStaff with the same pattern: UPDATE banned + DELETE staff_session in the transaction, plus the last-admin check.
- Gate: the 21 staff-auth integration tests, including exactly-one-audit-row, concurrent demotions, rollback on audit failure, and the "setRole is outside our tx" proof.

**T4. Bootstrap.**
- `scripts/create-admin.mjs` plus a README section for running it against Neon through dotenv-cli, with an explicit env.
- Gate: run it 4× on a local `_test` DB (create / repeat refused / other email refused / short password refused).

**T5. Admin layout.** Spike 2 owns this; coordinate.
- `app/admin/layout.tsx` with `instant = false`, `await connection()` before `<html lang="vi">`, a nonce CSP from `proxy.ts`, noindex and X-Frame-Options DENY.
- Gate: the build shows every `/admin` route as ƒ; check-prerender still passes for guest pages.

**T6. Auth screens.**
- `/admin/sign-in`, `/admin/reset-password`, `/admin/accept-invite` (Vietnamese; the `lib/admin/auth-errors.ts` mapping).
- Sign-in and reset POST to Better Auth's HTTP endpoints from the client, so the DB rate limit and the origin check apply. Accept goes through a public Server Action that redirects itself.

**T7. Staff and audit screens.**
- `/admin` overview (denied notice) and `/admin/users` (role select, invite, resend/revoke, the email_error notice, remove/ban).
- `/admin/audit` reading audit_feed (Admin, `audit:read`), with Intl vi-VN in Asia/Ho_Chi_Minh.

**T8. Email** (the email spike owns Resend).
- `lib/server/email/auth-mail.ts` with the EMAIL_DELIVERY gate (log by default; EMAIL_LOG_FILE for E2E) and the Resend transport for live/redirect.
- Vietnamese invite and reset templates (React Email later).

**T9. CI guard and E2E.**
- `test/guards/require-permission.guard.test.ts` (oxc-parser; allowlist submitReservation + acceptInvitation).
- `e2e/admin-auth.spec.ts` (12 tests).
- CI env: BETTER_AUTH_SECRET, BETTER_AUTH_URL=http://localhost:3100, EMAIL_DELIVERY=log, EMAIL_LOG_FILE; run create-admin before Playwright.
- Gate: the full E2E suite green 3× in a row.

Order: T1 → T2 → T3 → (T4, T5 in parallel) → T6 → T7 → T8 → T9. T5 must land before T6 if the CSP nonce affects the client forms.

## Risks and open questions

- **Vercel preview URLs.** BETTER_AUTH_URL is one fixed origin. Previews need `baseURL: { allowedHosts: [prod, '<project>-*-<team>.vercel.app', 'localhost:*'], fallback }`. Invite and reset links then need a deliberate public origin per environment. The spike did not exercise this.
- **The Better Auth CLI auto-loads .env and .env.local** (dotenv/config + c12). In the real repo, any `npx auth …` whose config used getPool()/DATABASE_URL would introspect the shared Neon DB. Keep `scripts/auth-cli.config.ts` on `AUTH_CLI_DATABASE_URL` with the localhost refusal, and never run `npx auth migrate`.
- **Rate limiting exists only in Better Auth's HTTP router.** Any sign-in or reset done through `auth.api.*` in a Server Action bypasses it. The design relies on the client POSTing to `/api/auth/*`. It is on by default only when NODE_ENV=production, so dev is unthrottled.
- **Client IP** for rate limits and audit comes from a single-value x-forwarded-for. That is fine on Vercel, which overwrites the header. Behind another proxy it can be spoofed or collapse into a shared "no-trusted-ip" bucket. IPv6 clients are bucketed per /64 by default.
- **database.validateSchema** (default true) introspects the DB on each cold start, and auth requests fail if migration 005 and config.ts drift apart. Regenerate rather than hand-edit the Better Auth columns.
- **Rule for later phases:** never call `auth.api.*` while holding a pg client inside `withTransaction`. It is not atomic (proved by a test), and with pool max 5 it can deadlock the pool.
- **Adding the admin root layout changes next/root-params typing** for every guest file that calls `lang()`. Future phases must handle `undefined`, and CI must run `next typegen` before tsc.
- **Activity (Cache Components) keeps previously visited admin pages mounted but hidden.** E2E must use role locators. Hidden pages also keep stale client state, for example a role select after someone else's change; the server checks still protect.
- **The admin plugin's mergeSchema mutates its module-level schema object.** Two Better Auth instances with different field maps in one process would collide. We use one config everywhere, including the CLI, the script and the tests.
- **admin createUser does not enforce minPasswordLength.** Our zod and the bootstrap script must, as they do now. Better Auth's `emailAndPassword.minPasswordLength` still covers sign-up, reset and change-password.
- **Not built in the spike:** banStaff/unban, setUserPassword (would use `(await auth.$context).password.hash` plus SQL in the transaction), the /admin/audit screen, the Resend live/redirect transport, the CSP nonce and X-Frame-Options. Ban must also delete `staff_session` rows, because getSession does not reject a banned user's existing session; the admin plugin's banned check runs only at session creation. Our DAL also returns null for banned users.
- **Open: should the bootstrap Admin be `email_verified=true`?** It is currently false; invitees are set to true on accept. Nothing reads it today.
- **Open:** an Editor visiting an Admin-only page is redirected to `/admin?denied=1` (status 200 after the redirect). A real 403 needs `experimental.authInterrupts` + `forbidden()`. Decide whether that is acceptable.
- **Open: should the accept-invite and reset-password pages also be throttled?** Tokens are 32 random bytes (accept) and Better Auth's own reset token, so brute force is infeasible. The request-password-reset endpoint is limited to 3 per 60 s per IP by Better Auth.
- **Neon specifics not verified:** FOR UPDATE row locks inside withTransaction over the pooled URL (standard; PgBouncer transaction mode supports them), and the latency of runtime validateSchema introspection on a Neon cold start.
- **The concurrent-accept loser got `already_staff` in 3 of 3 runs,** because the findUserByEmail pre-check saw the winner. A unique-violation race could instead surface as a thrown error, which actions map to `db_error`. Harmless, but the message would be generic.

## Spec deviations

- **§7.1** says role change, ban, delete and set-password go "requirePermission → kiểm tra Admin cuối cùng → gọi auth.api.* → ghi audit". The spike does role change and removal with our own SQL inside one pg transaction (lock the Admin rows, last-admin check, UPDATE/DELETE, audit_log, COMMIT) instead of `auth.api.setRole`/`removeUser`. Reason: an integration test proves `auth.api.setRole` commits on Better Auth's own connection, outside our transaction, so "exactly one audit row with the right actor" plus last-admin safety can't be atomic through auth.api. The SQL is the same write those endpoints make, and sessions read the new role on the next request.
- **§7.1 and §13:** the public action allowlist must contain acceptInvitation as well as submitReservation. The invitee has no session; the 32-byte token is the credential.
- **§7.3 (forms use useActionState):** sign-in and both reset steps are client forms that POST to Better Auth's HTTP endpoints, not Server Actions. Only the HTTP router applies the DB rate limit (§7.1 "giới hạn số lần thử lưu trong DB") and the Origin check. Accept-invite and the staff actions still use Server Actions with useActionState or transitions.
- **§5.2 audit_feed:** created now over audit_log only (same column list), so /admin/audit can read the view in phase 3. Phase 4 does CREATE OR REPLACE with a UNION ALL over reservation_events.
- **§5.2 Better Auth tables:** besides modelName, the config maps every column to snake_case through `fields`, so the staff_* columns match the repo's SQL style (email_verified, user_id, ban_reason …). The SQL was still generated by the CLI after configuring this. The admin plugin also adds `staff_session.impersonated_by`, which the spec doesn't list.
- **§5.2 staff_invitation:** "Gửi lại" rotates token_hash and expires_at in place on the same row, which also revives an expired invitation, instead of creating a new row. Added CHECK constraints: lowercase email, role in admin/editor, 64-hex hash, not both used and revoked. Added a partial unique index for one open invitation per email.
- **§5.2 audit_log:** added an id identity PK, `ip inet` (validated with net.isIP before insert), and a CHECK on action matching the spec list `create|update|delete|reorder|restore|settings|staff.*`. Actions in use: staff.bootstrap, staff.invite, staff.invite_resend, staff.invite_revoke, staff.invite_accept, staff.role, staff.remove.
- **§10.4 EMAIL_DELIVERY=log:** added an optional EMAIL_LOG_FILE (JSONL including the link) so E2E can read invite and reset links. In log mode the link is in that file, and console.info prints only the kind and recipient.
- **§7.1 "Admin đầu tiên tạo bằng script":** implemented as `scripts/create-admin.mjs` (it loads the TS config through jiti), not `npx auth create-admin`, because the CLI auto-loads .env.local and prompts interactively. It uses the same createUser path, so the bootstrap exception in the hook is exercised.
- **Editor on an Admin-only page:** redirect to `/admin?denied=1` rather than a 403 page (`forbidden()` needs `experimental.authInterrupts` in 16.3.7: `forbidden.md:17`).
