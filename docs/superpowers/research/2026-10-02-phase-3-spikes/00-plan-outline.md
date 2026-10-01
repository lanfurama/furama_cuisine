# Phase 3 plan outline: staff sign-in and the admin frame (Better Auth 1.7.7 on Next 16.3.7)

Scope: spec `docs/superpowers/specs/2026-10-01-admin-cms-design.md` §14.1 row 3, plus the details in §3 (decisions 3, 7, 8), §5.2, §7.1–7.4, §10.4, §11 and §13.

There are three spike reports in this folder:
- `better-auth-core.md` (clone `p3-auth`);
- `admin-layout-csp-vi.md` (clone `p3-layout`);
- `auth-emails.md` (clone `p3-email`).

Where a report and this outline disagree, **this outline wins**. §0 lists every conflict and how it was settled.

## 0. What I checked myself, on top of the three reports

**State**
- The repo is untouched: `git status` is clean and HEAD is `6a93d7b`. The only new files are this folder.
- Nothing is listening on ports 3100–3299, and the four `p3-email/*.pid` processes are gone.
- The spike databases (`furama_cuisine_p3auth_test`, `furama_cuisine_p3layout_test`, `p3email_test`) are dropped. Only the pre-existing `_test` databases remain.
- I did not re-run any build. I settled the conflicts by reading the clones, `node_modules/better-auth@1.7.7` and `node_modules/next/dist/docs`.

**Conflicts between the spikes, and the decision for each**

| # | Conflict | Decision | Evidence |
|---|---|---|---|
| C1 | **Sign-in and reset transport.** p3-auth posts from a client `fetch` to `/api/auth/*`. p3-layout uses a Server Action (`useActionState`) that calls `auth.handler(new Request(…))` in-process and copies `Set-Cookie`. | Use p3-layout's pattern for **sign-in, request-reset and reset**, through one helper `lib/server/auth/endpoint.ts`. | The rate limit only runs in the router's `onRequest` (`better-auth/dist/api/index.mjs:172`). `nextCookies()` returns early for router calls (`better-auth/dist/integrations/next-js.mjs:48,78`), which is why the action copies `Set-Cookie` itself with `parseSetCookieHeader`/`toCookieOptions` (both exported by `better-auth/dist/cookies/index.mjs`). p3-auth's integration tests already drive `/request-password-reset` and `/reset-password` through `auth.handler(new Request(…, {origin}))` (`p3-auth/test/integration/staff-auth.test.ts:438-463`). Server Actions keep Next's Origin-vs-Host CSRF check (`02-guides/server-actions.md:82`). Spec §7.3 asks for `useActionState`. |
| C2 | **Permission statement.** p3-auth's is fine-grained, one resource per §7.1 row. p3-layout's is coarse (`staff:['manage']`, `booking_rules`, `test_data`). | p3-auth's, with `closures` renamed `schedule`, because it covers service periods, capacity and closures. The nav uses `{user:['list']}` and `{audit:['read']}`. | spec §7.1 matrix; `p3-auth/lib/server/auth/permissions.ts` plus its 16-test matrix |
| C3 | **DAL path.** `lib/server/auth/session.ts` vs `lib/server/dal/session.ts`. | `lib/server/dal/session.ts`, because spec §4 names `dal/`. Use p3-auth's API (with `ip`) and p3-layout's rule "await `headers()` before anything else". | spec §4; p3-layout error 10 (build-time Better Auth init) |
| C4 | **An Editor on an Admin page.** p3-auth redirects to `/admin?denied=1`; p3-layout calls `forbidden()`. | `forbidden()` + `experimental.authInterrupts` + `(shell)/forbidden.tsx` (ruling R6). | `03-api-reference/04-functions/forbidden.md:4,17` (experimental). Both answer 200 on `next start` (`next/dist/build/templates/app-page-runtime.js:1211-1213`). |
| C5 | **Better Auth column names.** p3-auth uses snake_case `fields`; p3-layout's `005_staff_auth.sql` is camelCase. | snake_case, in the file `005_staff_auth_audit.sql`. | repo SQL style; p3-auth's `npx auth check` passed |
| C6 | **Email module.** p3-auth's `auth-mail.ts` vs p3-email's `send.ts` + templates + `invite-flow.ts`. | Take p3-email's `types.ts`, `send.ts`, `auth-emails.ts` and the templates. p3-auth's `staff.ts` keeps the DB flow, and `invite-flow.ts` is dropped (its columns were placeholders); `describeEmailError` moves to `types.ts`. `email_error` = `"<code>: <message>"`, at most 300 chars. The reset hook catches and logs. Idempotency keys use `sha256(token)`, not the raw token. | `better-auth/dist/api/routes/password.mjs:82` (`runInBackgroundOrAwait`) |
| C7 | **Email log for E2E.** p3-auth writes JSONL `{kind,to,link}`; p3-email writes NDJSON of the whole delivered message. | p3-email's record. The E2E helper takes the link out of `text` by path (`/admin/accept-invite?token=`, `/admin/reset-password?token=`). | `p3-email/lib/server/email/send.ts:29-41` (`consoleLogSink`) |
| C8 | **Route tree.** Flat (p3-auth) vs `(auth)` and `(shell)` route groups (p3-layout). | Route groups. | p3-layout E2E 52/52 ×3 |
| C9 | **Sign-out.** A client POST vs a Server Action. | Server Action `signOut` (on the allowlist), which works without JS. | p3-layout E2E |
| C10 | **E2E staff.** p3-auth runs `create-admin.mjs` before Playwright; p3-layout seeds with SQL + `hashPassword` under an advisory lock. | The seed fixture for E2E. The script gets its own integration test. Every E2E browser context sends a unique `x-forwarded-for`. | `/sign-in*` allows 3 tries per 10 s per IP+path (`better-auth/dist/api/rate-limiter/index.mjs` getDefaultSpecialRules), and `next start` keeps a client XFF (`next/dist/server/base-server.js:612`). Mixing the two suites without per-test IPs would trip the limiter. |
| C11 | **`instant = false`.** p3-auth put it on the root layout only, and only built for production. p3-layout put it on every admin page and also checked `next dev`. | Every `app/admin/**/page.tsx`, enforced by a guard test. | `02-guides/instant-navigation.md:568`; `03-file-conventions/02-route-segment-config/instant.md:112-115` |
| C12 | **Guest root-params fix.** `?? ''` vs `?? DEFAULT_LOCALE`. | `?? DEFAULT_LOCALE`. | `04-functions/next-root-params.md:286-290` |

## 1. Verified decisions

"Unverified" marks pieces that no spike ran end to end. Each one is pinned by a test in the task that adds it.

| §14.1 row-3 item | Approach | Source |
|---|---|---|
| **Better Auth** | <ul><li>`better-auth@1.7.7`, created lazily by `getAuth()` with `database: getPool()`. Better Auth duck-types the pool into Kysely `PostgresDialect`.</li><li>Tables renamed with `modelName` (`staff_*`) and columns mapped to snake_case with `fields`.</li><li>`emailAndPassword`: `disableSignUp`, password length 12–128, `revokeSessionsOnPasswordReset`, reset TTL 3600 s.</li><li>Sessions last 7 days with `updateAge` 1 day. The cookie cache is off.</li><li>`rateLimit`: `storage:'database'`, `modelName:'auth_rate_limit'`.</li><li>Telemetry off. Plugins: `admin`, then `nextCookies()` last.</li><li>`next build` needs no `BETTER_AUTH_*` variables. TS 7 typechecks the Better Auth types in about 0.4 s.</li></ul> | p3-auth `lib/server/auth/{config,auth}.ts`; `kysely-adapter/dist/index.mjs:20,76-79` |
| Migration 005 | <ul><li>SQL generated by the CLI (`auth@1.7.7 generate` against an empty local DB), plus `IF NOT EXISTS` and a role CHECK.</li><li>App-owned `staff_invitation`, `audit_log`, and the `audit_feed` view (over `audit_log` only).</li><li>`npx auth check` passes against it.</li></ul> | p3-auth (`005_staff_auth_audit.sql`, verbatim in `better-auth-core.md`) |
| **Roles** | <ul><li>`createAccessControl` with the statement in §4, roles `admin` and `editor`.</li><li>No role gets `impersonate` or `impersonate-admins`.</li><li>`roleCan()` checks a role with no DB call. The admin plugin's own `auth.api.*` endpoints check the `user` and `session` resources with the caller's role.</li></ul> | p3-auth `permissions.ts` + 16-test matrix; integration "grants impersonation to no role" |
| Invitation-only accounts | <ul><li>`databaseHooks.user.create.before` → `decideSignup`. An email with an open invitation gets that invitation's role. `BOOTSTRAP_ADMIN_EMAIL` becomes Admin only while no Admin exists.</li><li>Our hook runs after the plugin's hooks, so it has the last word on the role (`better-auth/dist/context/helpers.mjs:22-45`).</li></ul> | p3-auth integration (3 tests) |
| **Invites (create, resend, revoke, accept)** | <ul><li>The token is 32 bytes in base64url (43 chars). Only its SHA-256 hex is stored. It expires after 7 days.</li><li>Resend rotates `token_hash` and `expires_at` in place, so the old link dies. Revoke sets `revoked_at`.</li><li>Accept: `findOpenInvitation` → `auth.api.createUser` (no headers) → mark used + audit in one transaction → `auth.api.signInEmail({headers})` (`nextCookies` sets the cookie) → `redirect('/admin')`, outside the `try` (`cookies.md:85-89`).</li><li>Two racing accepts create one account.</li><li>The email is sent after COMMIT. A failure is stored in `email_error`, and the UI says "Chưa gửi được email, bấm Gửi lại".</li></ul> | p3-auth `staff.ts` + 8 integration tests + E2E; p3-email (ordering, `describeEmailError`). **Unverified:** the p3-email sender wired into `staff.ts` |
| **Reset password** | <ul><li>Our own page, `/admin/reset-password?token=`. Better Auth's `url` is ignored.</li><li>Both steps are Server Actions that go through `auth.handler` (request-reset is limited to 3 per 60 s per IP).</li><li>An unknown email gets the same answer. A reset revokes the user's sessions.</li></ul> | p3-auth integration (via `auth.handler`) + E2E (client POST); p3-email template. **Unverified:** the Server Action wrapper for reset. It is the same helper as sign-in, which p3-layout verified. |
| **Block the admin plugin's HTTP endpoints** | <ul><li>`hooks.before`: `if (ctx.request && ctx.path.startsWith('/admin/'))` → 403 `ADMIN_ENDPOINT_BLOCKED`.</li><li>A second prefix check sits in `app/api/auth/[...all]/route.ts`.</li><li>Server-side `auth.api.*` still works, with the caller's permissions. This answers the day-1 question in spec §16: yes.</li></ul> | p3-auth integration + E2E + curl; `better-call/dist/router.mjs:62-72` |
| **`audit_log`** | <ul><li>`insertAudit(client, actor, entry)` runs on the same client inside `withTransaction`.</li><li>The actor is a snapshot: id, email, and `ip inet` validated with `net.isIP`.</li><li>A no-op change writes 0 rows. A failed audit insert rolls the change back.</li><li>Role change, ban and remove are our own SQL (R1).</li></ul> | p3-auth `audit.ts` + integration |
| **Staff screen** | <ul><li>`/admin/users` (Admin, `user:list`): a staff table with a role `<select>`, Khóa/Mở khóa (lock/unlock) and Xóa (remove).</li><li>Open invitations with Gửi lại (resend) / Thu hồi (revoke), and the `email_error` notice. "Expired" is computed in SQL.</li><li>An invite form.</li><li>Every action follows `requirePermission` → zod → domain function → `refresh()` → `ActionResult`.</li></ul> | p3-auth `app/admin/users/*` + E2E. **Unverified:** ban/unban (not built in any spike) |
| **Vietnamese admin layout, dynamic render** | <ul><li>`app/admin/layout.tsx`: `export const instant = false`, then `await connection()` before `<html lang="vi">`, plus fonts, `styles/admin.css` and noindex metadata.</li><li>Every page also exports `instant = false`.</li><li>`(shell)` layout: sidebar nav filtered by `roleCan`, a header, a sign-out form.</li><li>A Vietnamese not-found page plus the `[...missing]` catch-all.</li><li>zod messages via `z.locales.vi()`. Better Auth codes map to Vietnamese text. Dates use `Intl` `vi-VN` in `Asia/Ho_Chi_Minh`.</li></ul> | p3-layout (52/52 ×3; dev console clean); `instant-navigation.md:568` |
| **CSP nonce** | <ul><li>The proxy makes a 128-bit nonce and sets the CSP on the request (Next reads the nonce from it: `app-render.js:209-210`) and on the response.</li><li>Response headers also include XFO DENY, X-Robots-Tag, Referrer-Policy `same-origin`, nosniff and Permissions-Policy.</li><li>Every `/admin` prerender entry has `response:"empty"` and `htmlSize:0`; `check-prerender` rule 1b enforces this.</li><li>0 CSP violations during hydration and during soft navigation.</li></ul> | p3-layout `proxy.ts`, `lib/admin/csp.ts`, `e2e/admin-security.spec.ts`; `02-guides/content-security-policy.md:179-193` |
| Proxy gate | <ul><li>`getSessionCookie(request)` accepts both cookie names.</li><li>Without a cookie: 307 to `/admin/sign-in?next=…`, with `_rsc` stripped. The three public pages are exempt.</li><li>`safeAdminNext()` blocks open redirects.</li><li>The proxy reads the cookie only, never the DB (`authentication.md:1028-1033`).</li></ul> | p3-layout `proxy.test.ts`, `paths.test.ts` |
| Sign-in | <ul><li>Server Action → `auth.handler(POST {baseURL}/sign-in/email)`, with origin = the baseURL origin and the incoming `x-forwarded-for`, `x-real-ip` and `user-agent` forwarded.</li><li>Copy `Set-Cookie`, then `redirect(safeAdminNext(next))`.</li><li>429 shows a Vietnamese message using `X-Retry-After`.</li></ul> | p3-layout E2E (429 on the 4th try with the right password) |
| DAL | <ul><li>`getStaffSession` (React `cache`, `headers()` first; banned or unknown role → `null`).</li><li>`verifySession`, `requirePermission` (throws `PermissionError`), `requirePagePermission` (`forbidden()`), `permissionResponse`, `auditActor`.</li></ul> | p3-auth + p3-layout |
| **Resend for auth emails** | <ul><li>`send.ts`: `EMAIL_DELIVERY` = `log` (default), `redirect` or `live`. Env is read at send time. An unknown mode throws.</li><li>The idempotency key is Resend's second argument.</li><li>`EMAIL_LOG_FILE` is NDJSON, written only outside `VERCEL_ENV=production`.</li><li>Vietnamese react-email templates for invite and reset.</li></ul> | p3-email (17 tests; the real SDK against a fake server via `RESEND_BASE_URL`; 3 `next start` modes) |
| Bootstrap | <ul><li>`scripts/create-admin.mjs` loads `config.ts` through jiti and calls `auth.api.createUser`, which goes through the gate.</li><li>Refuses an existing account, a second Admin and a short password.</li></ul> | p3-auth (4 manual runs) |
| CI guard (§7.1, §13) | <ul><li>An oxc-parser AST scan.</li><li>Every file-level `'use server'` export, every inline `'use server'` function and every `app/api/admin/**/route.ts` method must call `requirePermission`. Exceptions are on an allowlist.</li></ul> | p3-auth (mutation-tested) |
| Acceptance: invite → accept → sign in | E2E through the email log file. | p3-auth E2E "invite → accept → signed in as Editor (and the link is single-use)" |
| Acceptance: Editor blocked from the Admin area | <ul><li>No nav link.</li><li>The Admin page shows the 403 UI, and the response carries no staff data.</li><li>A replayed `next-action` POST returns `"code":"forbidden"` with 0 writes.</li></ul> | p3-layout E2E (403 UI, no data); p3-auth E2E (replay) |
| Acceptance: a role change writes exactly one audit row with the right actor | Drive the UI select, then assert the DB: +1 row, the actor's id and email, `before`/`after`. A no-op adds 0 rows. | p3-auth integration + E2E |
| Acceptance: a direct browser call to `/api/auth/admin/*` is rejected | A page `fetch` to set-role and list-users gets 403 `ADMIN_ENDPOINT_BLOCKED` even for an Admin. The role is unchanged. | p3-auth E2E + integration |
| `/admin/audit` | Reads `audit_feed` (Admin, `audit:read`), newest first, with Vietnamese action labels and `vi-VN` dates. | **Unverified** (p3-layout had a stub page only) |

## 2. Spec deviations that need a ruling

Each item gives a proposed ruling and what happens if the ruling turns out wrong.

**R1. §7.1 "đổi vai trò, khóa, xóa … gọi `auth.api.*`".**
- **Measured:** `auth.api.setRole` commits on Better Auth's own Kysely connection, outside our transaction (integration: BEGIN → setRole → ROLLBACK, and the change persists).
- **Proposed:** role change, ban/unban and removal run our own SQL in one `withTransaction`:
  1. lock the Admin rows (`FOR UPDATE ORDER BY id`);
  2. run the last-admin check;
  3. UPDATE or DELETE (plus `DELETE FROM staff_session` on ban);
  4. `insertAudit`;
  5. COMMIT.
- The SQL is the same write `setRole`/`banUser`/`removeUser` make, and sessions read the new role on the next request.
- **If wrong:** a future Better Auth version adds side effects to those endpoints that we would not reproduce. Re-check on every Better Auth upgrade.

**R2. §7.1/§13 public allowlist "hiện chỉ có `submitReservation`".**
- **Proposed:** the allowlist is exactly
  - `app/actions.ts#submitReservation`
  - `app/admin/(auth)/sign-in/actions.ts#signIn`
  - `app/admin/(shell)/actions.ts#signOut`
  - `app/admin/(auth)/reset-password/actions.ts#requestPasswordReset`
  - `app/admin/(auth)/reset-password/actions.ts#resetPassword`
  - `app/admin/(auth)/accept-invite/actions.ts#acceptInvitation`
- Each entry carries a comment saying what protects it.
- **If wrong:** a public action grows a privileged path. The per-entry comment and the review checklist (§5.5) are the guard.

**R3. §7.3 `useActionState` versus §7.1 "giới hạn số lần thử lưu trong DB".**
- **Proposed:** sign-in, request-reset and reset are Server Actions that call Better Auth's router in-process (`auth.handler`), so both clauses hold.
- Accept-invite calls `auth.api.*` and is not rate-limited, because the 256-bit token is the credential.
- **If wrong:** the handler's internals change (cookie copy, origin). E2E pins sign-in, 429 and reset.

**R4. §11 names only `app/admin/layout.tsx` for `instant = false`.**
- **Proposed:** every admin `page.tsx` also exports it, enforced by a guard test.
- Without it, `next dev` reports blocking routes between admin pages (`instant-navigation.md:568`).

**R5. §11/§13: admin pages answer HTTP 200 on `next start`.**
- `forbidden()`, `notFound()` and `redirect()` inside a page arrive through the RSC payload (`app-page-runtime.js:1211-1213, 1388-1440`). Only the proxy's 307 is a real status. `next dev` gives real 403/404.
- **Proposed:** accept. Acceptance tests assert the UI and the absence of data, never the status. Server Actions stay the real boundary.

**R6. Not in the spec: `experimental.authInterrupts: true` for `forbidden()` and `(shell)/forbidden.tsx`.**
- **Proposed:** use it. It keeps the URL, renders a Vietnamese 403 inside the shell and injects noindex (`forbidden.md:15`). The repo already relies on the experimental `globalNotFound`.
- **Fallback:** if the flag is removed, `redirect('/admin?denied=1')`, which p3-auth verified.

**R7. §5.2 Better Auth schema.**
- Snake_case columns through `fields`. The plugin also adds `staff_session.impersonated_by`, which stays NULL.
- The CLI is pinned as the devDependency `auth@1.7.7` instead of `npx auth@latest`.
- The CLI runs only with `--config scripts/auth-cli.config.ts`, which reads `AUTH_CLI_DATABASE_URL` and refuses non-localhost hosts. The reason: the CLI auto-loads `.env` and `.env.local` (`auth/dist/index.mjs:37,1203`), and `.env.local` holds the shared Neon DB.
- `npx auth migrate` is never run.
- **Proposed:** accept.

**R8. §5.2 extras.**
- `staff_invitation`:
  - resend rotates in place;
  - CHECKs: lowercase email, role, 64-hex hash, not both used and revoked;
  - a partial unique index `staff_invitation_open_email_idx`.
- `audit_log`:
  - an identity `id`;
  - `ip inet`;
  - a CHECK on `action` (`create|update|delete|reorder|restore|settings|staff\.[a-z_]+`).
- `audit_feed` is created now over `audit_log` only. Phase 4 runs `CREATE OR REPLACE` with the same columns in the same order.
- **Proposed:** accept.

**R9. §10.4 email additions.**
- `EMAIL_LOG_FILE` (NDJSON, never under `VERCEL_ENV=production`).
- An unknown `EMAIL_DELIVERY` value throws (fail closed).
- `redirect` prefixes the subject with `[original@addr]`.
- Better Auth's reset `url` is ignored.
- A failed reset email is only logged (there is no column for it, and the hook must not leak whether the account exists).
- **Proposed:** accept.

**R10. §7.1 "Admin đầu tiên tạo bằng script".**
- Implemented as `scripts/create-admin.mjs` (jiti + `createUser`), not `npx auth create-admin`, which auto-loads `.env.local` and prompts.
- `BOOTSTRAP_ADMIN_EMAIL` is set only in the shell that runs the script, **never in Vercel env**. With it unset, the app has no bootstrap path at all.
- The bootstrap Admin gets `email_verified = true`, the same as invitees.
- **Proposed:** accept.

**R11. Two guest files change, and the typecheck command changes.**
- A second root layout makes `lang()` return `string | undefined`, so the guest root layout and `(guarded)/layout.tsx` change.
- `npm run typecheck` becomes `next typegen && tsc --noEmit`, because plain `tsc` misses the change (`06-cli/next.md:177-186`).
- **Proposed:** accept.

**R12. Beyond §11.**
- Extra headers: X-Robots-Tag, Referrer-Policy `same-origin` (keeps token URLs off other sites), nosniff, Permissions-Policy, and `base-uri 'none'`.
- `app/admin/[...missing]` gives unknown admin URLs a Vietnamese 404, with status 200 per R5.
- **Proposed:** accept.

**R13. Scope.**
- Ban/unban is built, because §7.3 needs the "tài khoản bị khóa" message and §7.1 lists it.
- **Admin-set-password is not built.** Reset by email covers it. If it is ever needed, it is `(await auth.$context).password.hash` plus SQL in the transaction.
- The overview `/admin` shows only phase-3 items: a greeting, the date, and invitations whose email failed. The other §7.2 widgets arrive with phases 4, 5 and 8.
- **Proposed:** accept.

**R14. Rate limits.**
- Keep Better Auth's defaults: `/sign-in*` 3 per 10 s and `/request-password-reset` 3 per 60 s, per IP+path. They are on only when `NODE_ENV=production`, so `next start` and Vercel get them and dev does not.
- No per-email throttle in phase 3.
- **Proposed:** accept, and revisit in phase 10 (hardening).

**R15. §7.4 `updateTag` step.**
- Staff writes touch no cached tag, so staff actions call `refresh()` (`04-functions/refresh.md`) instead.
- **Proposed:** accept. Not a real deviation; noted so the reviewer does not flag the missing `updateTag`.

## 3. Tasks in execution order (all on `main`, one commit per task, each ends green)

**Gate for every task:**
1. `npm run typecheck` (from T1 on: `next typegen && tsc --noEmit`).
2. `npm run lint`: 0 errors, and no new warnings except the `pg` default-import ones in `.mjs`/E2E, which match `scripts/migrate.mjs`.
3. `TEST_DATABASE_URL=postgres://localhost:5432/<x>_test npm test`.
4. The §4 E2E recipe: reset-db → build → `node scripts/check-prerender.mjs` → `npm run test:e2e`.

From T6 on, also run `npm run test:visual` at ratio 0, because T6 touches the guest layouts.

**Copy-from rule:** the code exists in `p3auth-out/p3-auth.patch`, `p3-layout.patch` and `p3-email/lib/server/email/`. Cherry-pick it, then reconcile it with this outline (§0 conflicts, §4 names).

**T1. Dependencies, typecheck, permissions, migration 005**
- **Install:** `npm i better-auth@1.7.7 zod@4.6.5` and `npm i -D auth@1.7.7`.
- **package.json:** `"typecheck": "next typegen && tsc --noEmit"`.
- **Files:**
  - `lib/server/auth/permissions.ts` (statement in §4) and `permissions.test.ts`;
  - `db/migrations/005_staff_auth_audit.sql` (verbatim from `better-auth-core.md`);
  - `test/integration/migration-005.test.ts` (new). It uses its own DB, `furama_cuisine_migrate005_test`, like 004.
- **Tests:**
  - **Permissions:** the matrix row by row. No role has `impersonate`, `impersonate-admins` or `set-email`. The Editor lacks every `user:*`, `session:*`, `audit:read`, `settings:*`, `locales:*` and `reservations:auto-confirm|purge-test`.
  - **Migration:**
    - all 7 tables and the view exist;
    - role CHECK: `'owner'` is rejected;
    - invitation CHECKs: an upper-case email, a bad hash, and used+revoked are each rejected;
    - a second open invitation for the same email fails; after a revoke it works;
    - `audit_log.action`: `staff.role` is accepted, `login` is rejected;
    - `audit_feed` columns come in the order `source,id,at,actor_id,actor_label,action,entity_type,entity_id,locale,before,after`;
    - a re-run is idempotent;
    - it applies on top of 004 with existing rows.
- **Deps:** none. No `app/admin` yet, so no guest change.
- **Copy from:** p3-auth `4d6b2ab`, with `closures` renamed to `schedule`.

**T2. Better Auth configuration and the day-1 proofs (no Next wiring)**
- **Files:**
  - `lib/server/auth/signup-gate.ts`;
  - `lib/server/auth/config.ts` (`createAuth(deps)`). Its `sendResetPassword` wraps the injected sender in try/catch and logs only `EmailSendError.code` (C6);
  - `scripts/auth-cli.config.ts`;
  - `test/helpers/auth.ts`: `createTestAuth(pool, overrides)` and `signInCookie(auth, email, password, ip)`;
  - `test/integration/better-auth.test.ts`.
- **Tests:** carried over from p3-auth's `staff-auth.test.ts`:
  - HTTP sign-up is closed (400 `EMAIL_PASSWORD_SIGN_UP_DISABLED`);
  - `/api/auth/admin/{set-role,list-users,create-user}` over `auth.handler` with a valid Origin and an Admin cookie → 403 `ADMIN_ENDPOINT_BLOCKED`;
  - `auth.api.listUsers`/`setRole` work for the Admin and are refused for the Editor;
  - no impersonation;
  - createUser is refused without an invitation;
  - the bootstrap exception applies only while no Admin exists;
  - the role comes from the invitation;
  - the rate limit is stored in `auth_rate_limit` (401, 401, 401, 429) and `auth.api.signInEmail` is never limited;
  - reset: request → our link → new password → sessions revoked; an unknown email gets the same 200 and no email;
  - the next session read sees a changed role;
  - `setRole` commits outside our transaction (the proof behind R1).
- **Extra gate:** `AUTH_CLI_DATABASE_URL=postgres://localhost:5432/<x>_test npx auth check --config scripts/auth-cli.config.ts` prints "Schema check passed". The cosmetic int8 warning on `last_request` is expected.
- **Deps:** T1.

**T3. Auth email module**
- **Install:** `npm i resend@6.31.0 react-email@6.11.0`. Do not add `@react-email/components` or `@react-email/render`.
- **Files:**
  - `lib/server/email/{types.ts,send.ts,auth-emails.ts}`;
  - `lib/server/email/templates/{layout,staff-invitation,password-reset}.tsx`;
  - `lib/server/email/email.test.ts`;
  - `lib/server/email/resend-import.guard.test.ts`: nothing outside `lib/server/email/` imports `resend`.
- **Changes vs the spike:**
  - `describeEmailError` moves to `types.ts`;
  - idempotency keys are `invite:{invitationId}:{sha256(token).slice(0,16)}` and `reset:{sha256(token).slice(0,16)}`;
  - `invite-flow.ts` and its 4 tests are not copied (T4 owns that flow).
- **Tests:** the 13 template and delivery tests from the spike, plus the import guard.
- **Deps:** none. It can run in parallel with T1 and T2.

**T4. Audit helper and staff domain**
- **Files:**
  - `lib/server/audit.ts` (`insertAudit`, `withTransaction`);
  - `lib/server/auth/staff.ts`:
    - `createInvitation`, `resendInvitation`, `revokeInvitation`, `findOpenInvitation`, `acceptInvitation`;
    - `setStaffRole`, `banStaff`, `unbanStaff`, `removeStaff`;
    - deps-injected `sendInvite` (from T3), with the failure written to `email_error` through `describeEmailError`;
  - `test/integration/staff-auth.test.ts`.
- **Tests (p3-auth):**
  - invite → accept with one audit row per step, a single-use token, `email_verified = true`;
  - resend kills the old token;
  - revoke;
  - an expired invitation can't be accepted, and the email can be re-invited;
  - racing accepts → one account;
  - a role change → exactly one row with the actor; a no-op → 0 rows;
  - last Admin: can't demote or remove, and a banned Admin doesn't count;
  - concurrent mutual demotion leaves one Admin;
  - remove deletes sessions and logs it;
  - a failed audit insert rolls the change back.
- **New tests:**
  - a failing sender → the invitation exists, `email_error` = `provider_error: …`, the result is `emailSent:false`;
  - a resend that succeeds clears `email_error`;
  - ban: deletes `staff_session` rows, refuses `self` and the last active Admin, writes `staff.ban`; the next `getSession` is null;
  - unban writes `staff.unban`.
- **Deps:** T2, T3.

**T5. Bootstrap script**
- **Install:** `npm i -D jiti@2.7.0`.
- **Files:**
  - `scripts/create-admin.mjs`, passing `data: { emailVerified: true }` (R10);
  - `test/integration/create-admin.test.ts` (new). It spawns `node scripts/create-admin.mjs` with an explicit env against `TEST_DATABASE_URL`.
  - README section "Admin đầu tiên": run it against a Neon branch with `dotenv -e <branch env file> --` and `BOOTSTRAP_ADMIN_*` set inline.
- **Tests:**
  1. it creates the Admin, writes `staff.bootstrap` and sets `email_verified` true;
  2. the same email again → exit 1 "already has an account";
  3. another email → refused;
  4. an 11-character password → refused.
- **Deps:** T2. It can run in parallel with T3 and T4.

**T6. Admin root layout, CSP nonce, proxy gate (no auth wiring yet)**
- **Files:**
  - `lib/admin/{csp,paths}.ts` with tests;
  - `proxy.ts`: the `adminProxy` branch;
  - `proxy.test.ts`;
  - `lib/i18n/proxy-matcher.test.ts`: the `/admin/*` additions, plus `/api/auth/*` skipped;
  - `app/admin/layout.tsx`;
  - `styles/admin.css`;
  - `app/admin/not-found.tsx`;
  - `app/admin/[...missing]/page.tsx`;
  - `app/admin/(auth)/layout.tsx`;
  - `app/admin/(auth)/sign-in/page.tsx`: a static card with the heading "Đăng nhập" and no form yet;
  - the guest fix (C12) in `app/(site)/[lang]/layout.tsx` and `(guarded)/layout.tsx`;
  - `scripts/check-prerender.mjs`: rule 1b;
  - `lib/admin/admin-pages.guard.test.ts`;
  - `e2e/admin-security.spec.ts`.
- **E2E tests:**
  - **Headers:** the exact CSP, XFO DENY, X-Robots-Tag, Referrer-Policy, nosniff, Permissions-Policy, and `Cache-Control` private no-store.
  - **Nonce:** every `<script>` carries it, and every request gets a new one.
  - **Guest unaffected:** `/en` has no CSP and still sends `x-nextjs-prerender`.
  - **Proxy gate:** 307 with `next`, `_rsc` stripped.
  - **Page:** `lang="vi"` and robots noindex.
  - **Hydration:** 0 CSP violations, caught both by the console listener and by `securitypolicyviolation`.
- **Extra gate:**
  - the build lists every `/admin` route as ƒ, and `[...missing]` with an empty shell;
  - **once**, a negative build without `await connection()` makes check-prerender fail (record the output in the commit body);
  - visual 0-diff.
- **Deps:** T1 (it needs `better-auth/cookies`). It can run in parallel with T2–T5.

**T7. Better Auth route, DAL, sign-in, shell, CI guard**
- **Install:** `npm i -D oxc-parser@0.152.0`.
- **Files:**
  - **Auth wiring:**
    - `lib/server/auth/auth.ts`: lazy `getAuth()` from env; `sendResetPassword` → `sendPasswordReset`;
    - `app/api/auth/[...all]/route.ts`: the prefix block, then `getAuth().handler`;
    - `lib/server/auth/endpoint.ts`: `callAuthEndpoint(path, body)`, which forwards XFF, x-real-ip and user-agent, sets origin to the baseURL origin, and never forwards `cookie`; and `applySetCookies(res)`.
  - **DAL and shared helpers:**
    - `lib/server/dal/session.ts`;
    - `lib/server/action-result.ts`;
    - `lib/admin/{zod,auth-errors,format,nav}.ts` with tests.
  - **Sign-in:** `app/admin/(auth)/sign-in/{actions.ts,SignInForm.tsx,page.tsx}`.
  - **Shell:** `app/admin/(shell)/{layout.tsx,NavLinks.tsx,actions.ts,page.tsx,error.tsx}`. `error.tsx` is a Vietnamese client error boundary (new).
  - **Guard:** `test/guards/require-permission.guard.test.ts`. Its allowlist at this point is `submitReservation`, `signIn` and `signOut`.
  - **E2E support:**
    - `e2e/staff-fixtures.ts`: the seed with `hashPassword` and `pg_advisory_xact_lock(hashtext('e2e-seed-staff'))`, plus `uniqueIp(testInfo)`;
    - `e2e/admin-sign-in.spec.ts`;
    - the shell soft-navigation case in `admin-security.spec.ts`;
    - `playwright.config.ts`: when it starts its own server, refuse unless `EMAIL_DELIVERY === 'log'`, `BETTER_AUTH_SECRET` is set, and `BETTER_AUTH_URL` equals the server origin (new).
- **Guard additions (new, unverified):**
  - `requirePermission(` must sit in the function's first statement, or in the first statement of a top-level `try`;
  - admin-plugin calls `auth.api.(createUser|setRole|banUser|unbanUser|removeUser|setUserPassword|impersonateUser|listUsers)` may appear only in `lib/server/auth/staff.ts` and `scripts/create-admin.mjs`.
  - Mutation-test both: remove one call and confirm the failure message.
- **E2E (p3-layout):**
  - the Admin signs in, lands on `?next`, sees `aria-current` and the vi date;
  - the cookie is HttpOnly and Lax;
  - sign-out clears it;
  - a signed-in visit to sign-in redirects;
  - `?next=//evil` → `/admin`;
  - a wrong password keeps the email and shows the Vietnamese message;
  - zod errors are in Vietnamese;
  - the banned account sees its message;
  - the 4th try in 10 s gets 429;
  - a forged cookie lands back on sign-in;
  - an unknown admin URL shows the Vietnamese 404;
  - soft navigation in the shell: 0 document requests and 0 violations.
- **Deps:** T2, T3, T6.

**T8. Accept invitation and reset password**
- **Files:**
  - `app/admin/(auth)/accept-invite/{page.tsx,AcceptForm.tsx,actions.ts}`. `acceptInvitation`: zod (token, name 1–100, password 12–128) → `staff.acceptInvitation` → `auth.api.signInEmail({headers})` → `redirect('/admin')` outside the try;
  - `app/admin/(auth)/reset-password/{page.tsx,RequestForm.tsx,ResetForm.tsx,actions.ts}`. `requestPasswordReset` and `resetPassword` go through `callAuthEndpoint`, and the request step always shows the same message;
  - the allowlist grows by these three exports;
  - `e2e/email-log.ts`: poll the NDJSON and return the last link for `to` and a path;
  - `e2e/admin-invite-reset.spec.ts`.
- **E2E:**
  - **Accept:**
    - an invitation inserted by SQL with a known token, hashed in the test, signs in as Editor;
    - reopening the link shows "Lời mời không hợp lệ…";
    - an expired invitation (`expires_at` in the past) and a revoked one both show the invalid view.
  - **Reset:**
    - request → link from the log → new password;
    - the old password fails and the new one works;
    - an unknown email gets the same message, with no log line.
- **Deps:** T4, T7.

**T9. Staff screen**
- **Files:**
  - `app/admin/(shell)/users/{page.tsx,actions.ts,StaffTable.tsx,InvitationList.tsx,InviteForm.tsx}`;
  - `lib/server/auth/staff-queries.ts`: `listStaff`, and `listOpenInvitations` with `expires_at <= now() AS expired` and `email_error`;
  - `(shell)/forbidden.tsx`;
  - `next.config.ts`: `experimental.authInterrupts: true` (R6);
  - `requirePagePermission({ user: ['list'] })`;
  - `e2e/admin-users.spec.ts`.
- **Actions and the permission each requires:**

  | Action | Permission |
  |---|---|
  | `inviteStaff` | `user:create` |
  | `resendInvite` | `user:create` |
  | `revokeInvite` | `user:create` |
  | `changeStaffRole` | `user:set-role` |
  | `banStaffMember` | `user:ban` |
  | `unbanStaffMember` | `user:ban` |
  | `removeStaffMember` | `user:delete` |

- **New guard check (unverified):** for `app/admin/(shell)/users/actions.ts`, the `requirePermission` argument must be an object literal that `roleCan('editor', arg)` rejects.
- **E2E:**
  - an Admin invites, and the row and the log line appear;
  - resend → the old link is invalid;
  - revoke → the row is gone and `revoked_at` is set;
  - an `email_error` set by SQL shows "Chưa gửi được email, bấm Gửi lại";
  - the last Admin can't demote themselves (Vietnamese alert);
  - ban → the banned user's next page load lands on sign-in;
  - remove;
  - Editor: no "Nhân viên" link, and `/admin/users` shows "Không có quyền truy cập" with no other staff email in the response body.
- **Deps:** T4, T7.

**T10. Audit screen**
- **Files:**
  - `app/admin/(shell)/audit/page.tsx`, with `requirePagePermission({ audit: ['read'] })`;
  - `lib/server/audit-feed.ts`:
    ```sql
    SELECT … FROM audit_feed
     ORDER BY at DESC, source DESC, lpad(id, 20, '0') DESC
     LIMIT 50 OFFSET $1
    ```
    (`?trang=` paging);
  - `lib/admin/audit-labels.ts`: Vietnamese labels for the 9 `staff.*` actions;
  - `test/integration/audit-feed.test.ts`;
  - `e2e/admin-audit.spec.ts`.
- **What the page shows:** time (`formatDateTimeVi`), actor email, label, entity, and `before`/`after` in `<details><pre>`.
- **Tests:**
  - integration: order and tie-break across 12 rows with the same `at` (one transaction), paging, and every action has a label;
  - E2E: the Admin sees the role-change row with the actor's email; the Editor gets the 403 UI.
- **Deps:** T7. T9 provides real rows, but the tests seed by SQL.

**T11. Acceptance, CI, docs**
- **Files:**
  - `e2e/admin-acceptance.spec.ts` (serial). It runs the four §14.1 criteria end to end through the UI:
    1. invite → accept → sign in;
    2. Editor blocked: nav, page, the replayed `next-action` of `changeStaffRole` with the Editor cookie → `"code":"forbidden"`, role unchanged, 0 audit rows; with no cookie → 307; with a forged cookie → `forbidden`;
    3. a role change → exactly one audit row with the acting Admin's id and email;
    4. a page `fetch` to `/api/auth/admin/set-role` and `/list-users` → 403 `ADMIN_ENDPOINT_BLOCKED`, role unchanged.
  - `.github/workflows/ci.yml`, E2E step env:
    - `BETTER_AUTH_SECRET`, generated per run (`openssl rand -base64 32 >> $GITHUB_ENV`);
    - `BETTER_AUTH_URL=http://localhost:3100`;
    - `EMAIL_DELIVERY=log`;
    - `EMAIL_LOG_FILE=${{ runner.temp }}/emails.ndjson`.
    - The build step needs no auth env.
  - README:
    - an env table (§4);
    - "migrate 005 before deploying";
    - "never `npx auth migrate`";
    - first Admin;
    - Resend domain setup (spec §15 items 4–5).
- **Gate:** the full suite 3× green with `--retries=0`, then `next dev` against a local `_test` DB with a clean console on every admin page.
- **Deps:** T8, T9, T10.

**Order and parallelism**
- Sequence: T1 → T2 → T4 → T7 → (T8, T9, T10) → T11.
- T3 can run any time before T4.
- T5 can run any time after T2.
- T6 can run any time after T1, and must finish before T7.

## 4. Global constraints for the plan

**Versions** (install exactly these; package.json keeps the repo's caret style)

| Kind | Packages |
|---|---|
| dependencies | `better-auth@1.7.7`, `zod@4.6.5`, `resend@6.31.0`, `react-email@6.11.0` |
| devDependencies | `auth@1.7.7` (Better Auth CLI; `@better-auth/cli` is deprecated), `jiti@2.7.0`, `oxc-parser@0.152.0` |
| Transitive, for reference | `@better-auth/core@1.7.7`, `@better-auth/kysely-adapter@1.7.7`, `better-call@1.4.0`, `kysely@0.29.6`, `@react-email/render@2.1.0` |
| Unchanged | `next@16.3.7`, `react@19.3.0`, `pg@8.23.0`, `typescript@7.0.2`, `vitest@5.0.3`, `@playwright/test@1.63.0`, `oxlint@1.86.0` |
| Runtimes | Node 22.22.0 locally, Node 24 in CI. Postgres 18.3 locally, 18 in CI. |

**Environment variables**

| Context | Exact setting |
|---|---|
| Unit + integration | `TEST_DATABASE_URL=postgres://localhost:5432/<name>_test npm test`. There is no auth or email env: tests inject `secret: 'test-secret-0123456789abcdef0123456789abcdef'`, `baseURL: 'http://localhost:3000'`, `bootstrapAdminEmail: 'owner@furama.test'`, and `rateLimitEnabled: true` only in the rate-limit test. |
| Better Auth CLI | `AUTH_CLI_DATABASE_URL=postgres://localhost:5432/<name>_test npx auth check --config scripts/auth-cli.config.ts`. Never `migrate`; never without `--config`. |
| Build | `CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/<name>_test npm run build`. It needs **no** `BETTER_AUTH_*`, `RESEND_*` or `EMAIL_*`. |
| E2E | `CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/<name>_test BETTER_AUTH_SECRET=$(openssl rand -base64 32) BETTER_AUTH_URL=http://localhost:<port> EMAIL_DELIVERY=log EMAIL_LOG_FILE=<scratch>/emails.ndjson E2E_PORT=<port> npm run test:e2e`. `EMAIL_DELIVERY=log` must be **set explicitly**, because `next start` also reads `.env.local` and only process env beats it. |
| Bootstrap (local, in agent sessions) | `DATABASE_URL=postgres://localhost:5432/<name>_test BETTER_AUTH_SECRET=<same as server> BETTER_AUTH_URL=http://localhost:<port> BOOTSTRAP_ADMIN_EMAIL=owner@furama.test BOOTSTRAP_ADMIN_NAME='Chủ quán' BOOTSTRAP_ADMIN_PASSWORD='correct horse battery' node scripts/create-admin.mjs` |
| Production | `BETTER_AUTH_SECRET` (its own, ≥32 bytes), `BETTER_AUTH_URL=https://<production domain>`, `EMAIL_DELIVERY=live`, `EMAIL_FROM='Furama Cuisine <no-reply@mail.furamavietnam.com>'`, `RESEND_API_KEY` (production key). No `BOOTSTRAP_ADMIN_EMAIL`, no `EMAIL_LOG_FILE`. |
| Preview | Its own `BETTER_AUTH_SECRET`, `EMAIL_DELIVERY=redirect`, `EMAIL_REDIRECT_TO=<team inbox>`, `EMAIL_FROM`, `RESEND_API_KEY` (a separate key). `BETTER_AUTH_URL`: day-1 check (§6). |

**E2E fixtures**
- Admin `owner@furama.test` / `correct horse battery`.
- Editor `editor@furama.test` / `editor passphrase 1`.
- `banned@furama.test`: an Editor with `banned = true`.
- Invitees `invitee-<worker>-<n>@furama.test`.
- Every browser context sets `extraHTTPHeaders: { 'x-forwarded-for': uniqueIp(testInfo) }`.
- Specs that change roles are `serial`, and they restore the role before the last-admin test.

**Names**
- **Tables:** `staff_user`, `staff_session`, `staff_account`, `staff_verification`, `auth_rate_limit`, `staff_invitation`, `audit_log`, and the view `audit_feed`. The index `staff_invitation_open_email_idx` holds one open invitation per email. Staff integration test files `TRUNCATE staff_user, staff_invitation, audit_log, auth_rate_limit, staff_verification CASCADE` in `beforeEach`.
- **Cookies:**
  - `better-auth.session_token` over http, or `__Secure-better-auth.session_token` when `BETTER_AUTH_URL` is https;
  - attributes: HttpOnly, SameSite=Lax, Path=/, Max-Age=604800, and Secure on https;
  - not used: `better-auth.session_data` (the cookie cache is off, and the proxy rejects a cookie jar that has only this one) and `better-auth.dont_remember` (sign-in always sends `rememberMe: true`);
  - `NEXT_LOCALE` is untouched.
- **Audit actions** (`entity_type` is `staff_user` or `staff_invitation`): `staff.bootstrap`, `staff.invite`, `staff.invite_resend`, `staff.invite_revoke`, `staff.invite_accept`, `staff.role`, `staff.ban`, `staff.unban`, `staff.remove`. The token is never logged; `after` holds `{email, role, expires_at}`.
- **Action result:**
  - `{ok:true, data}` or `{ok:false, code, params?, fieldErrors?}`.
  - Codes: `forbidden`, `invalid`, `db_error`, `already_staff`, `already_invited`, `not_found`, `last_admin`, `self`, `invalid_token`.
  - `PermissionError('unauthenticated')` also maps to `forbidden` for actions. Route handlers give 401 or 403 through `permissionResponse`.
- **Constants:**
  - invitation TTL `'7 days'`; token regex `^[A-Za-z0-9_-]{43}$`;
  - reset TTL 3600 s, and the template says 60 minutes;
  - session 7 days, `updateAge` 1 day;
  - password 12–128 characters;
  - `email_error` at most 300 characters.

**Permission statement** (`lib/server/auth/permissions.ts`; `defaultStatements` also defines `user:impersonate`, `impersonate-admins` and `set-email`, which no role gets)
```ts
export const statement = {
  ...defaultStatements,
  content: ['read', 'update', 'restore', 'ai'],
  reservations: ['read', 'update', 'create', 'note', 'configure', 'auto-confirm', 'purge-test'],
  schedule: ['read', 'update'],          // service periods, capacity, closures
  locales: ['read', 'update'],
  settings: ['read', 'update'],          // booking, notification, AI settings
  audit: ['read'],                       // /admin/audit (per-record history is content:read)
} as const;
const editorStatements = {
  content: ['read', 'update', 'restore', 'ai'],
  reservations: ['read', 'update', 'create', 'note', 'configure'],
  schedule: ['read', 'update'],
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
```
Pages and actions in phase 3: `/admin/users` uses `user:list`, `/admin/audit` uses `audit:read`, and the actions use the table in T9.

**File paths**
- **Server code:**
  - `lib/server/auth/{permissions,signup-gate,config}.ts`: no `server-only`, because the CLI and the script load them;
  - `lib/server/auth/{auth,endpoint,staff,staff-queries}.ts`;
  - `lib/server/dal/session.ts`;
  - `lib/server/{audit,audit-feed,action-result}.ts`;
  - `lib/server/email/**`;
  - `lib/admin/{csp,paths,zod,auth-errors,format,nav,audit-labels}.ts`.
- **Routes:**
  - `app/api/auth/[...all]/route.ts`;
  - `app/admin/layout.tsx`, `not-found.tsx`, `[...missing]/page.tsx`;
  - `app/admin/(auth)/{sign-in,accept-invite,reset-password}/…`;
  - `app/admin/(shell)/{layout,page,error,forbidden,NavLinks,actions}.tsx|ts`;
  - `app/admin/(shell)/{users,audit}/…`.
- **Other:**
  - `styles/admin.css`;
  - `scripts/{create-admin.mjs,auth-cli.config.ts}`;
  - `db/migrations/005_staff_auth_audit.sql`.

**Code rules**
- **Lazy init:** `getAuth()` is lazy. Nothing creates Better Auth or reads `BETTER_AUTH_*` at import time.
- **DAL first:** the DAL awaits `headers()` before `getAuth()`. Every admin page exports `instant = false` and calls `verifySession()` or `requirePagePermission()` before any DB work, because the build runs page bodies up to the first request API.
- **Actions:** every admin Server Action starts with `requirePermission(…)` (first statement, or first statement in a top-level `try`), then zod, then `withTransaction` (write + `insertAudit`), then `refresh()`. It returns an `ActionResult` and never throws to the client. `redirect()` goes outside the `try`.
- **No `auth.api.*` inside a transaction:** never call `auth.api.*` while holding a client from `withTransaction`. It is not atomic, and the pool max is 5.
- **No public auth over `auth.api.*`:** never sign in, request a reset or reset a password through `auth.api.*` from a public action. Use `callAuthEndpoint` so the rate limit applies. The only `auth.api.signInEmail` call is in `acceptInvitation`.
- **Plugin order:** `nextCookies()` stays the last plugin. There is one `createAuth` config for the app, the CLI, the script and the tests (the plugin's `mergeSchema` mutates module state).
- **No inline styles:** no `style={…}` under `app/admin`, and admin pages import no guest components (`components/**`). `next/image` stays out of the admin until phase 7 adds the CSP hash.
- **Locators:** E2E uses role locators (Activity keeps hidden admin pages mounted). Alerts are scoped to `form` or `main`, because the route announcer is also `role=alert`.
- **Dates:** in `lib/admin/format.ts` (`VENUE_TZ` from `lib/venue-time.ts`), never `Date.now()` in render.
- **Stale dev types:** `rm -rf .next/dev` before a build if a page was deleted after `next dev` ran.

**Ports**
- E2E: 3100 in CI.
- Agents: 3200–3299.
- Stop servers and drop `_test` DBs when done.

## 5. Review focus: five conditions most likely to bite

**1. Session fixation and cookie scope**
- **What could go wrong:**
  - The sign-in action forwards the incoming `cookie` header into the inner `Request`, or copies cookies from anywhere but the handler's `Set-Cookie`.
  - `toCookieOptions` drops `HttpOnly`, `Secure` or `SameSite`.
  - The `__Secure-` name is used on https but the proxy or DAL only knows the plain name.
  - A banned or removed user keeps a live session.
  - A reset leaves old sessions alive.
- **Pins:**
  - E2E: the cookie is HttpOnly + Lax; sign-out clears it; a forged cookie → sign-in.
  - `proxy.test.ts`: both cookie names pass, and a jar with only `session_data` is rejected.
  - Integration: reset revokes sessions; ban/remove delete sessions; the next `getSession` sees a changed role.
- **Reviewer checks:**
  - `endpoint.ts` builds headers from an allowlist (`x-forwarded-for`, `x-real-ip`, `user-agent`).
  - Every session is server-generated, and nothing reads a token from a query or body.
  - Path=/ is accepted: guest and admin share one origin (see §6).

**2. Invite token reuse and expiry**
- **What could go wrong:**
  - The token is accepted after `used_at`, `revoked_at` or `expires_at`.
  - Resend leaves the old hash valid.
  - The raw token reaches the DB, `audit_log`, a log line or an idempotency key.
  - A partial failure (createUser succeeds, then marking used fails) leaves a reusable link.
- **Pins:**
  - Integration: single-use, resend kills the old link, revoke, expired, racing accepts → one account, a 64-hex hash only.
  - E2E: reopening a used link shows the invalid view; expired and revoked show it too.
- **Reviewer checks:**
  - `findOpenInvitation` and `decideSignup` both filter `used_at IS NULL AND revoked_at IS NULL AND expires_at > now()`.
  - `UPDATE … WHERE used_at IS NULL` is used as the race guard.
  - Idempotency keys use `sha256(token)`.
  - The production log sink redacts.

**3. Last-admin lockout**
- **What could go wrong:**
  - Demote, ban or remove leaves zero active Admins.
  - Two Admins demote each other concurrently.
  - The check counts banned Admins as active.
  - The lock order differs between functions, so they deadlock.
- **Pins:**
  - Integration: can't demote, ban or remove the last Admin; a banned Admin doesn't count; concurrent mutual demotion leaves one.
  - E2E: the Vietnamese alert on self-demotion.
- **Reviewer checks:**
  - Every path calls `lockAdmins` (`ORDER BY id FOR UPDATE`) first, then counts `banned IS NOT TRUE`.
  - Self-ban and self-remove return `self`.
  - The runbook covers a lost last Admin (SQL on Neon, or `BOOTSTRAP_ADMIN_EMAIL` only after no Admin exists).

**4. CSP breaking hydration**
- **What could go wrong:**
  - A page gets prerendered, so its HTML has no nonce.
  - An inline `style=` attribute, `next/image`, a guest component or a third-party script lands in the admin.
  - The dev-only `'unsafe-eval'` or `'unsafe-inline'` leaks into production.
  - The proxy stops setting the CSP on the *request* headers.
- **Pins:**
  - `check-prerender` rule 1b (`response:"empty"`, `htmlSize:0` for every `/admin` entry).
  - The guard: `instant = false` on every page, `connection()` before `<html`, no `style={`.
  - E2E: 0 violations during hydration and soft navigation; every `<script>` nonced; a new nonce per request.
  - `csp.test.ts`: the production string has no `unsafe-*`.
- **Reviewer checks:** run `next dev` once over all admin pages (console clean) before T11 closes.

**5. An Editor reaching Admin-only actions via direct POST**
- **What could go wrong:**
  - An action checks the wrong permission, checks it after a side effect, or catches `PermissionError` and carries on.
  - A new `'use server'` file skips the check.
  - An `auth.api.*` admin endpoint is reachable over HTTP, or called server-side without the caller's headers.
- **Pins:**
  - The CI guard: presence, first statement, the allowlist, the admin-plugin call allowlist, and the users-actions permission-argument check.
  - E2E replay of `changeStaffRole` with the Editor cookie → `forbidden`, 0 writes, 0 audit rows.
  - Integration: HTTP `/api/auth/admin/*` → 403 even for an Admin; `auth.api.setRole` with Editor headers → refused.
- **Reviewer checks:**
  - Each action's permission matches T9's table.
  - `actionError` maps `PermissionError` before anything is written.

## 6. Risks and day-1 checks

**Risks**
- **Vercel previews and `BETTER_AUTH_URL`.**
  - Links in emails and the `__Secure-` decision come from one fixed origin.
  - Because sign-in and reset set `origin` to the baseURL origin, Better Auth's origin check passes on any host, and Next's Server Action check (Origin vs Host) still guards CSRF.
  - Cookies are host-only, so a preview works if its `BETTER_AUTH_URL` is that preview's URL.
  - Not exercised: `baseURL.allowedHosts` (keep any pattern project-specific, never `*.vercel.app`).
- **The CLI auto-loads `.env.local`.** Any `npx auth …` without `--config scripts/auth-cli.config.ts` could introspect the shared Neon DB. `auth migrate` would write to it.
- **Rate limiting.** It exists only in the HTTP router and only when `NODE_ENV=production`. The IP comes from a single-value XFF: Vercel overwrites it, but a bare `next start` passes a client value through (`base-server.js:612`). IPv6 clients are bucketed per /64.
- **Admin pages always answer 200 in production (R5).** Monitoring or tests that look at the status will be misled.
- **The build runs admin page bodies up to their first request API.** A DB query placed before `verifySession()` runs at build time against the build's `DATABASE_URL`.
- **`database.validateSchema`** introspects the DB at every cold start. If migration 005 and `config.ts` drift apart, auth requests fail. Regenerate; don't hand-edit. Neon cold-start latency for this is unmeasured.
- **Activity keeps hidden admin pages mounted.** They can show stale data (e.g. a role select after someone else's change). Server checks still protect.
- **Tokens in URLs.** `/admin/accept-invite?token=` and `/admin/reset-password?token=` appear in Vercel request logs. Mitigations: tokens are single-use, invites expire in 7 days and resets in 1 hour, and Referrer-Policy is `same-origin`.
- **Same origin for guest and admin.** The admin cookie is sent on guest pages, and the guest CSP allows `'unsafe-inline'`. An XSS on the guest site could drive admin Server Actions with a staff cookie. Rules: guest content is always React-escaped, and phase 7 must never render CMS HTML raw. An admin subdomain is the structural fix (post-B).
- **Session refresh.** `nextCookies()` skips the refresh in RSC, so only Server Actions and route handlers extend the cookie. Staff who only browse re-sign-in at most every 7 days.
- **Email delivery.**
  - Resend live mode was only tested against a fake server.
  - Domain DNS (spec §15 items 4–5) is still pending.
  - A failed reset email only reaches the logs.
  - react-email's bundle size is unmeasured.
- **Small upstream behaviours.**
  - `admin.createUser` does not enforce `minPasswordLength` (zod and the script do).
  - The int8 warning from `auth generate` is cosmetic.
  - The concurrent-accept loser could, in theory, get `db_error` instead of `already_staff`.
- **Not verified on Neon.** `FOR UPDATE` over the pooled URL, and Better Auth's Kysely transactions over PgBouncer.
- **Not verified on Node 24** (CI) for Better Auth and react-email; the spikes ran Node 22.
- **Minor.**
  - `app/global-error.tsx` makes admin pages preload the 45 KB guest CSS (optional: give it its own sheet).
  - `.next/dev/types` goes stale after deleting a page.
  - Email-case handling at sign-in is unverified. Invitations are stored lower-cased; check that Better Auth lower-cases the sign-in input.

**Day-1 checks**
1. **T1:** `next typegen && tsc --noEmit` is green, and `npx auth check --config …` passes on a migrated local DB.
2. **T2:** the spec §16 proof (HTTP block vs server calls) is green in integration before any UI exists.
3. **T6:** the build shows ƒ and empty shells for all admin routes; the negative build without `connection()` fails check-prerender; 0 CSP violations; visual 0-diff on guest pages.
4. **T7:** the sign-in E2E is green under parallel workers with per-test XFF, and `next dev` shows a clean console on `/admin/sign-in` and `/admin`.
5. **First Vercel preview:**
   - migration 005 is applied on that preview's Neon branch;
   - `BETTER_AUTH_URL` is the preview URL, and the cookie is `__Secure-…`;
   - the admin CSP holds up with the Vercel toolbar (violations from `vercel.live` are expected noise, not breakage);
   - `EMAIL_DELIVERY=redirect` delivers to `EMAIL_REDIRECT_TO`;
   - the Server Action Origin check passes behind Vercel.

**Evidence paths**
- `/private/tmp/claude-501/-Users-bcmac-Desktop-projects-Outside-Projects-furama-cuisine/e860bf94-efdc-4015-b5d3-085d89bca850/scratchpad/p3-auth`: commits `4d6b2ab`, `e6f64c0`, `2c8d3ab`, `6ebcef9`; patch and logs in `…/scratchpad/p3auth-out/`.
- `/private/tmp/claude-501/-Users-bcmac-Desktop-projects-Outside-Projects-furama-cuisine/e860bf94-efdc-4015-b5d3-085d89bca850/scratchpad/p3-layout`: patch at `…/scratchpad/p3-layout.patch`; logs and screenshots in `<clone>/.spike/`.
- `/private/tmp/claude-501/-Users-bcmac-Desktop-projects-Outside-Projects-furama-cuisine/e860bf94-efdc-4015-b5d3-085d89bca850/scratchpad/p3-email/lib/server/email/`.
