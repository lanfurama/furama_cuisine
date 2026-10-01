# Staff authentication and roles for /admin (Neon Auth vs self-hosted Better Auth vs Clerk) on Next.js 16.3.7

# Staff auth and roles for /admin: research findings (2026-10-01)

## 0. What is provisioned today (checked live, read-only)

- **`.env.local`**: `NEON_AUTH_BASE_URL` and `VITE_NEON_AUTH_URL` both hold the literal string `"provisioning"`. These are stale placeholders, pulled by Vercel CLI while the Vercel-managed Neon integration was still setting up. There is no `NEON_AUTH_COOKIE_SECRET`.
- **Database**: I ran one `BEGIN READ ONLY` query on `DATABASE_URL_UNPOOLED` (Postgres 18.6). It has two schemas, `public` and `neon_auth`. So Managed Auth **is** provisioned on this branch.
  - `neon_auth` tables: `"user"`, `session`, `account`, `verification`, `organization`, `member`, `invitation`, `jwks`, `project_config`.
  - `neon_auth."user"` columns: `id uuid, name, email, emailVerified, image, createdAt, updatedAt, role, banned, banReason, banExpires`. The last four come from the admin plugin.
- **`neon_auth.project_config` (non-secret fields only)**:
  - `name` is `neon-violet-yacht`, the default. Auth emails would show this name.
  - `allow_localhost` is true.
  - `trusted_origins` is `[]`.
  - `email_and_password` is `{enabled:true, disableSignUp:false, requireEmailVerification:false, emailVerificationMethod:"otp"}`.
  - Magic link is disabled. The organization plugin is **enabled** (`creatorRole: owner`, `sendInvitationEmail: false`).
  - Webhooks are off. The email provider is `shared`. There is one social provider entry. There are **0 users**.
- **Consequence:** public sign-up is **open** on the Neon Auth endpoint right now. Anyone who knows the auth URL can create a `neon_auth` user. The app does not trust these users yet, so impact is low, but it should be closed whichever option is chosen.
- **Repo state:**
  - `next.config.ts` has no `cacheComponents`.
  - There is no `proxy.ts` yet.
  - `db/client.ts` already has a lazy `pg` Pool (max 5) wrapped with `attachDatabasePool`.
  - `node_modules/next/dist/compiled/server-only` exists, so `import 'server-only'` works without installing anything.

## 1. Neon Auth (Managed Better Auth)

Sources: `.agents/skills/neon/SKILL.md:34,80-90`, `.agents/skills/neon/references/auth.md`, and the neon-auth skill and docs fetched from neon.com on 2026-10-01.

### Package and versions
- **`@neondatabase/auth`**: the npm `latest` tag is **0.5.0-beta**; only beta versions have been published. Peer is `next >=16.0.0`.
  - It bundles the `better-auth` 1.6.23 client and `@neondatabase/auth-ui` 0.3.0-beta.
  - Neon docs say the managed server runs Better Auth **1.4.18**.
- **Entry points:**
  - `@neondatabase/auth/next/server` → `createNeonAuth`
  - `@neondatabase/auth/next` → `createAuthClient()`. It takes **no arguments** and talks to the same-origin `/api/auth` proxy.
  - `@neondatabase/auth-ui` is optional UI.
- **Plugins:** the wrapper pins the plugin list: jwt, admin, organization, emailOTP, magicLink, phoneNumber, anonymousToken. Verified in the package's `dist/adapter-core-*.mjs:726-733`. You cannot pass `plugins`.

### Next.js 16 App Router integration
```ts
// lib/auth/server.ts
export const auth = createNeonAuth({ baseUrl: process.env.NEON_AUTH_BASE_URL!, cookies: { secret: process.env.NEON_AUTH_COOKIE_SECRET! } });
// app/api/auth/[...path]/route.ts
export const { GET, POST, PUT, DELETE, PATCH } = auth.handler();
// proxy.ts (Next 16)
export default auth.middleware({ loginUrl: '/admin/sign-in' }); export const config = { matcher: ['/admin/:path*'] };
// server read
const { data: session } = await auth.getSession(); // session?.user (do not destructure { user })
```
- **Session cache:** the session is cached in a signed HTTP-only `session_data` cookie with a default TTL of 300 s (`cookies.sessionDataTtl`). Role or ban changes can take up to 5 minutes to apply if the role is read from the session.
- **`force-dynamic`:** Neon docs say Server Components that call `getSession()` must `export const dynamic = 'force-dynamic'`. With `cacheComponents` this is unnecessary (`02-guides/migrating-to-cache-components.md:138-140`).
- **What the middleware does:** I read the package's `dist/server-*.mjs`. It skips `/api/auth`, `/auth/sign-in`, `/auth/sign-up`, `/auth/magic-link`, `/auth/email-otp`, `/auth/forgot-password` and `/auth/callback`. It then runs a get-session through the proxy, which may use the cached cookie.
- **Matcher:** never use a catch-all matcher. It redirects the login page's own assets.
- **Env vars:**
  - `NEON_AUTH_BASE_URL` is server-only.
  - `NEON_AUTH_COOKIE_SECRET` is app-generated (`openssl rand -base64 32`, 32+ characters) and is not injected by Neon.
  - `VITE_NEON_AUTH_URL` exists only for Vite/TanStack browser code. Next does not need it, and no `NEXT_PUBLIC_*` variable is needed because the Next client uses the same-origin proxy.

### Roles, admin plugin, organization plugin
- **Admin plugin: supported**, with no install step.
  - The server endpoint map includes `admin.createUser`, `listUsers`, `setRole`, `setUserPassword`, `updateUser`, `banUser`, `unbanUser`, `listUserSessions`, `revokeUserSession(s)`, `impersonateUser`, `removeUser` and `hasPermission`. Verified in `dist/server-*.mjs`, API_ENDPOINTS lines 123-177.
  - The caller's Better Auth role must be `admin`.
  - The first admin is made in the Console (Auth → Users → "Make admin") or with `neon neon-auth user set-role <id> --roles admin`.
- **No custom roles or permissions.** The roadmap lists "Admin plugin customization: Coming soon". Better Auth's own docs say that without custom access control "only `admin` and `user` exist as valid roles". So an **Editor role has to live in an app table**.
- **Organization plugin: Partial / Beta.**
  - Roles are owner/admin/member only. There are no Teams, custom roles, dynamic access control or server hooks.
  - Invitation emails are sent only when `send_invitation_email=true` **and** "Verify email at signup" is on.
  - Accepting needs `/auth/accept-invitation?invitationId=` (via `AuthView`) or a custom flow. The invitee must already have, or must create, an account.

### Invitations and invite-only (disabling sign-up)
- **Disable sign-up** in either of these ways:
  - Console, or `neon neon-auth config email-password update --disable-sign-up`
  - API `PATCH /projects/{id}/branches/{id}/auth/email_and_password`
  - Magic link has its own `disable_sign_up` flag.
- **Ways to create accounts once sign-up is off:**
  - `auth.admin.createUser({ email, password, name, role })`. The password is **required**.
  - `neon neon-auth user create --email`.
  - The Console.
- **Fail-closed allowlist:** the blocking `user.before_create` webhook.
  - The URL must be public HTTPS. No localhost or raw IPs; a tunnel is needed for local testing.
  - Requests are signed with an Ed25519 detached JWS.
  - Delivery gets 3 attempts within 15 s. If the webhook fails, the signup is rejected.
- **Unverified:** whether `disableSignUp` also blocks auto-signup through Email OTP sign-in. `plugin_configs` has no `emailOtp` entry to control it.

### Email verification, magic link, password reset, and who sends the email
- **What Managed Auth sends:** verification email (as a code, or as a link), email OTP, magic link, password reset, and organization invitations.
- **Sender:** the default is shared SMTP `auth@mail.myneon.app`. It is rate-limited and meant for dev only.
- **Production:** the production checklist **requires custom SMTP**. Any SMTP works, including Resend's SMTP.
  - Custom SMTP changes only the sender. The emails still use Neon's templates.
  - Full branding or translated emails require the `send.otp` / `send.magic_link` webhooks.
- **Links vs codes:** verification links need custom SMTP; codes work on shared SMTP.
- **Password reset:** links expire after 15 min. The SDK's `resetPasswordForEmail` is not supported; use the UI components or the `requestPasswordReset` / `resetPassword` endpoints.
- **Magic link:** off by default; expiry is configurable from 5 to 1440 min.
- **App name:** defaults to the Neon project name, so it is `neon-violet-yacht` today.

### Where the user tables live, and SQL joins
- Everything lives in the `neon_auth` schema in the same database and branch.
- You can join on it: `JOIN neon_auth."user" u ON u.id = s.user_id`. The id is a uuid, and `"user"` must be quoted.
- Treat the schema as read-only because Neon manages it. I could not verify that Neon tolerates foreign keys pointing into it, so use soft references.
- **Branching:** auth state branches with the database.
  - The Vercel-managed integration auto-provisions Auth on preview branches and injects `NEON_AUTH_BASE_URL` / `VITE_NEON_AUTH_URL`.
  - On a Vercel-managed organization the Neon CLI needs `NEON_API_KEY`; `neon login` does not work.
- **Trusted domains:** exact entries plus wildcards such as `https://*.x.vercel.app`. Localhost is allowed by default; turn that off for production.
- **Pricing:** included in Neon plans; the Free plan covers 60k MAU.
- **Not available on Managed:** MFA (on the roadmap), passkeys, custom hooks/plugins, custom JWT claims.

## 2. Alternatives

### Self-hosted Better Auth in the app, using the existing `pg` pool
- **Versions:** `better-auth` **1.7.7** (latest tag, 2026-09-30). Peers: `next ^14||^15||^16`, `pg ^8`, `react ^18||^19`.
  - The CLI package is now **`auth`** (`npx auth@latest …`, v1.7.7). `@better-auth/cli` is deprecated on npm.
- **Database:** pass `database: new Pool(...)` (Kysely Postgres dialect), so `getPool()` can be reused.
  - `npx auth@latest generate --output <file>` writes a **plain SQL file** for Kysely. It can go straight into `db/migrations/` and works with `scripts/migrate.mjs`.
  - Table names can be changed with `modelName` per model, or the tables can go in a separate schema with `database.schemaName`.
- **Next integration** (`better-auth.com/docs/integrations/next`):
  - `toNextJsHandler(auth)` at `app/api/auth/[...all]/route.ts`.
  - `auth.api.getSession({ headers: await headers() })` on the server.
  - The `nextCookies()` plugin (must be last) lets Server Actions set cookies.
  - Next 16 `proxy.ts` examples are given both ways: cookie-only `getSessionCookie(request)` (documented as optimistic and "NOT SECURE") or a full `getSession` call on the Node runtime.
- **Admin plugin with custom access control:**
  - `createAccessControl(statement)` plus `ac.newRole(...)` gives **real `admin` and `editor` roles** with per-resource permissions.
  - `auth.api.userHasPermission({ body: { userId, permissions } })` checks a user's permissions on the server.
  - Also available: `setRole`, `banUser`, `removeUser`, `revokeUserSessions`.
  - `npx auth@latest create-admin --email … --role admin` uses `auth.api.createUser`, so database hooks run.
  - Server-side `auth.api.createUser({ body })` needs no session.
- **Invite-only:**
  - `emailAndPassword.disableSignUp: true`.
  - `magicLink({ disableSignUp: true })`.
  - `databaseHooks.user.create.before` can throw an `APIError` to act as an allowlist.
  - Invitations themselves are app-owned. There is no invitation primitive outside the organization plugin.
- **Emails:** you write `sendResetPassword`, `sendMagicLink` and `sendVerificationEmail`. They can send through **Resend**, the same provider planned for booking emails, so auth emails can be Furama-branded and in EN or VI.
- **Operations:**
  - `BETTER_AUTH_SECRET` (or `AUTH_SECRET`) is required in production; Better Auth throws without it.
  - Set `BETTER_AUTH_URL`, or use `baseURL: { allowedHosts: [...wildcards], fallback }`. The allowed hosts are also added to `trustedOrigins`.
  - The `rateLimit` default storage is **`"memory"`**, which does not work across serverless instances, so set `storage: "database"`. Rate limiting is on only in production by default.
  - A `twoFactor` plugin is available if Admins need MFA later.

### Clerk via the Vercel Marketplace
- **Integration:** native Marketplace integration with unified billing and env-var sync (vercel.com/changelog/clerk-joins-the-vercel-marketplace).
- **Versions:** `@clerk/nextjs` 7.9.9. Peers are `next ^16.0.10` (16.3.7 is fine) and `react ~19.3.0-0`. On Next 16 the middleware file is `proxy.ts` with `clerkMiddleware()`.
- **Invite-only:**
  - Invite-only access mode (`sign_up_mode: restricted`) is free on **all plans, including Hobby**.
  - The Invitations API sends Clerk's own emails. They auto-verify the email, expire after 1 month, and are limited to 100 requests/hour.
  - The allowlist/blocklist feature is **paid** (Pro, $25/mo). Hobby is free up to 50k MRU, with 3 dashboard seats.
- **Roles:** via `publicMetadata.role` plus a custom session-token claim (the "basic RBAC" guide), or via Organization roles.
- **Downsides for this project:**
  - Staff identities live outside Postgres. There is no SQL join; you need a webhook sync or stored Clerk IDs plus an email snapshot for the audit log.
  - It adds another vendor and duplicates the Neon Auth that is already provisioned.

## 3. The pattern Next.js 16 recommends (local docs in `node_modules/next/dist/docs/01-app`)

1. **Two kinds of check.** Optimistic checks read the cookie. Secure checks read the database. Centralise both in a DAL with DTOs; Proxy is optional (`02-guides/authentication.md:1011-1024`).
2. **`proxy.ts` is for optimistic checks only.**
   - Proxy runs on every route, including prefetches, so "only read the session from the cookie … avoid database checks" (`authentication.md:1033`).
   - It "should not be your only line of defense" (`:1121`).
   - Proxy runs on Node.js (`:1126`). The `runtime` option is not allowed (`03-api-reference/03-file-conventions/proxy.md:253-255`).
   - Middleware was renamed Proxy. It is not meant for full session management or authorization (`01-getting-started/16-proxy.md:15,29`).
   - There is **one** `proxy.ts` per project; split logic into modules and import them (`16-proxy.md:35-37`). The planned i18n locale routing and the `/admin` auth check must therefore be combined in one file.
3. **DAL:** a `server-only` module with `verifySession = cache(async () => …)` that redirects if there is no session (`authentication.md:1131-1170`).
   - All data reads and permission checks go through it.
   - Only the DAL should touch `process.env` (`02-guides/data-security.md:56-66,132`). This matters for the GCP/Vertex credentials too.
4. **Do not rely on layouts for auth.** Layouts do not re-render on navigation and do not gate child segments. Check close to the data (`authentication.md:1350-1360`).
   - Client Components cannot import the DAL (`:1368`).
   - `return null`-style gating in a layout is **not recommended** (`:1458`).
5. **Every Server Action re-checks auth and authorization.**
   - Actions are public POST endpoints (`data-security.md:281-291`; `authentication.md:1463`).
   - A page-level check does not cover its actions (`data-security.md:339`).
   - Check per resource to avoid IDOR (`:370`), validate input (`:308`), put mutation logic in the DAL (`:397-437`), and return minimal data (`:441`).
   - Built-in protection: Origin vs Host check (`:550`). The audit checklist is at `:603-611`.
6. **Route Handlers:** same rule, with 401/403 responses (`authentication.md:1503-1553`).
7. **Options:**
   - `forbidden()` / `unauthorized()` still need experimental `authInterrupts` in 16.3.7 (`03-api-reference/04-functions/forbidden.md:4,17`).
   - If `cacheComponents` is enabled later, session reads move behind `<Suspense>` and `use cache: private` (`02-guides/authentication-with-cache-components.md`).

## 4. Comparison for invite-only staff with Admin and Editor roles

| | Neon Managed Auth | Self-hosted Better Auth | Clerk |
|---|---|---|---|
| Provisioned already | Yes (needs env re-pull and cookie secret) | No (package and tables to add) | No |
| Real Editor role / permissions | No (admin/user only; "Editor" goes in an app table) | **Yes** (`createAccessControl`) | Metadata claim or Org roles |
| Invite-only | `disableSignUp` + admin `createUser` (password required) + optional webhook | `disableSignUp` + DB hook + app-owned invites | **Built-in Invite-only mode + invitation emails** |
| Auth emails | Neon templates; custom SMTP required in prod; branding only via public webhook | **Resend, branded, EN/VI** | Clerk templates |
| Staff identities in SQL | Yes (`neon_auth`) | Yes (own tables) | No (sync needed) |
| Local dev / previews | Per-branch auth URL; trusted domains; localhost toggle | Same app and database; `allowedHosts` wildcard | Clerk dev instance |
| Maturity | SDK 0.5.0-beta; managed server 1.4.18 | 1.7.7 stable | 7.9.9 stable |
| What we maintain | Least code | Auth config and upgrades | Least code; extra vendor |
| MFA later | Roadmap | `twoFactor` plugin | Yes |

## 5. Recommendation: self-hosted Better Auth 1.7.x in the Next app, on the existing Neon database

**Why:**
- The required features are exactly the ones Managed Auth lacks today:
  - custom roles and permissions (admin-plugin customization is on the roadmap)
  - server hooks to enforce the invite allowlist
  - branded, bilingual emails without a public webhook
- The neon-auth skill itself routes this case to self-managed Better Auth on the existing app host, keeping Lakebase Postgres (`neon-auth SKILL.md`, When to Use table).
- There are 0 Managed users, so switching costs nothing now. Neon says there is no documented migration from Managed Auth to self-managed later.
- The auth tables still sit in the same Neon branch, so they branch with previews.

### Exact setup steps (none of these were run)

1. **Close the open door now.**
   - In the Neon Console (Project → production branch → Auth), disable sign-up. Or with `NEON_API_KEY`: `neon neon-auth config email-password update --disable-sign-up`.
   - Once Better Auth is live, disable Neon Auth on the branch while keeping its data: Console, or `neon neon-auth disable` **without** `--delete-data`.
   - Ignore `NEON_AUTH_BASE_URL` and `VITE_NEON_AUTH_URL`.
2. **Dev branch.** Create a Neon dev branch for local admin/auth work. `.env.local` almost certainly points at the production branch.
3. **Install** (the user runs this): `npm i better-auth@^1.7.7`. Add `resend` if the email workstream has not already.
4. **Env vars**, added to Vercel for Production, Preview and Development, and to `.env.local`:
   - `BETTER_AUTH_SECRET`, from `openssl rand -base64 32` or `npx auth@latest secret`.
   - `BETTER_AUTH_URL` (`http://localhost:3000` locally; the production origin on Vercel).
   - `RESEND_API_KEY` and `AUTH_EMAIL_FROM`, with the sender domain verified in Resend (SPF/DKIM).
5. **`lib/auth/permissions.ts`:**
```ts
import { createAccessControl } from 'better-auth/plugins/access';
import { defaultStatements, adminAc } from 'better-auth/plugins/admin/access';
export const statement = { ...defaultStatements,
  content: ['read','update','publish'], reservation: ['read','update'], closure: ['read','update'],
  settings: ['read','update'] /* incl. Vertex AI model/region/prompts/glossary/test-connection */, audit: ['read'] } as const;
export const ac = createAccessControl(statement);
export const editor = ac.newRole({ content: ['read','update','publish'], reservation: ['read','update'], closure: ['read','update'] });
export const admin  = ac.newRole({ ...adminAc.statements, content: ['read','update','publish'], reservation: ['read','update'], closure: ['read','update'], settings: ['read','update'], audit: ['read'] });
```
6. **`lib/auth/server.ts`** (`import 'server-only'`). Call `betterAuth({ ... })` with:
   - `appName: 'Furama Cuisine'`
   - `baseURL: { allowedHosts: ['<prod-domain>', '<project>-*-<team>.vercel.app', 'localhost:*'], fallback: 'https://<prod-domain>' }`. Keep the preview pattern **narrow**; do not use `*.vercel.app`.
   - `database: getPool()`
   - `user/session/account/verification: { modelName: 'staff_user' | 'staff_session' | 'staff_account' | 'staff_verification' }`, plus `session.expiresIn` of about 7 days
   - `emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 12, sendResetPassword: <Resend> }`
   - `rateLimit: { storage: 'database', modelName: 'auth_rate_limit' }`
   - `databaseHooks.user.create.before`: throw `APIError('FORBIDDEN')` unless an open `staff_invitation` exists for `lower(email)`, or the email equals the bootstrap admin email
   - `databaseHooks.session.create.after`: write `audit_log('auth.sign_in')`
   - `plugins: [admin({ ac, roles: { admin, editor }, defaultRole: 'editor' }), nextCookies()]`. `nextCookies` must be last.
   - Optional: `magicLink({ disableSignUp: true, sendMagicLink: <Resend> })`.
7. **Routes and client:**
   - `app/api/auth/[...all]/route.ts`: `export const { GET, POST } = toNextJsHandler(auth)`.
   - `lib/auth/client.ts`: `createAuthClient({ plugins: [adminClient({ ac, roles: { admin, editor } })] })` from `better-auth/react`.
8. **Migrations:**
   - `npx auth@latest generate --output db/migrations/003_staff_auth.sql`, then review it.
   - Add `004_staff_admin.sql` with:
     - `staff_invitation(id bigserial, email text, role text check (role in ('admin','editor')), token_hash text unique, invited_by text, expires_at timestamptz, accepted_at timestamptz, revoked_at timestamptz, created_at timestamptz default now())`, plus a partial unique index on `lower(email)` where the invite is still open.
     - `audit_log(id bigserial, at timestamptz default now(), actor_id text, actor_email text, actor_role text, action text, entity_type text, entity_id text, locale text, diff jsonb, ip inet, user_agent text)`, indexed on `(entity_type, entity_id, at desc)`. No FK to the user table, so the history survives user removal.
   - Run `npm run db:migrate` on the dev branch first, then production.
9. **Bootstrap the first Admin:** `dotenv -e .env.local -- npx auth@latest create-admin --email <owner> --name "<name>" --role admin`. The hook from step 6 must allow the bootstrap email; otherwise insert an invitation row first.
10. **`proxy.ts`** (a single file combined with i18n):
    - For `/admin/*`, except `/admin/sign-in`, `/admin/accept-invite` and `/admin/reset-password`: redirect if `!getSessionCookie(request)`.
    - Other paths go to locale routing.
    - The matcher must exclude `api/auth`, `_next/static`, `_next/image` and static files.
11. **`lib/dal.ts`** (`server-only`):
    - `verifySession = cache(...)`: calls `auth.api.getSession({ headers: await headers() })`, redirects to `/admin/sign-in` if there is no session or the user is banned, and returns a DTO `{ userId, name, email, role }`.
    - `requirePermission(perms)`: calls `auth.api.userHasPermission({ body: { userId, permissions: perms } })` and throws `'Forbidden'`.
    - Every admin page calls it.
    - **Every** Server Action and Route Handler calls it first, validates input, writes `audit_log` in the **same transaction** as the change, returns minimal data, then revalidates.
    - The Vertex AI settings page and its "test connection" action require `settings:update` (Admin only). GCP credentials stay in env vars and are read only from server-only modules.
12. **Staff management** (Admin only, `user:create|set-role|ban|delete`):
    - **Invite:** a server action creates a random 32-byte token, stores its SHA-256 with a 7-day expiry, and emails `/admin/accept-invite?token=…` through Resend.
    - **Accept page:** re-validates the token and collects name and password. It then calls `auth.api.createUser({ body: { email, password, name, role } })`, marks the invitation accepted, calls `auth.api.signInEmail({ body, headers: await headers() })` (cookies are set via `nextCookies`) and redirects to `/admin`.
    - **Change role, remove or ban:** `setRole`, `banUser` (which revokes sessions) and `removeUser`. Block demoting or removing the last Admin. Audit every action.
13. **Password reset:** `/admin/reset-password` using `requestPasswordReset` / `resetPassword`, with the email sent by Resend.
14. **Tests** (Playwright):
    - An Editor gets denied on `/admin/settings` and on direct POSTs to admin-only actions.
    - Signed-out POSTs to actions are rejected.
    - Invite token reuse or expiry fails.
    - A non-invited sign-up is rejected even when calling `/api/auth/sign-up/email` directly.

### If the team prefers Managed Neon Auth instead (fallback)
1. Re-pull the env (`vercel env pull`) to replace the `"provisioning"` values, and add `NEON_AUTH_COOKIE_SECRET`.
2. In the Console:
   - Set the app name to "Furama Cuisine".
   - Disable sign-up.
   - Disable the unused organization plugin.
   - Set custom SMTP (Resend SMTP).
   - Add trusted domains: production, plus a preview wildcard.
   - Turn off localhost on the production branch.
3. Pin `@neondatabase/auth@0.5.0-beta`. Add `createNeonAuth`, the `[...path]` handler, and `auth.middleware` called only for `/admin` inside the combined `proxy.ts`.
4. Create `staff_member(user_id uuid, role admin|editor)` joined to `neon_auth."user"`. Admins also get Better Auth role `admin` so they can call the admin APIs; Editors get `user`.
5. Invite with `auth.admin.createUser` (random password) plus a Resend invite email. Staff sign in with Email OTP. Verify that OTP does not auto-create unknown users; if it does, add the `user.before_create` webhook.
6. Re-check the `staff_member` row on every request, because of the 5-minute session cache.


## Recommendation
Use self-hosted Better Auth (better-auth@^1.7.7) inside the Next.js app, on the existing Neon `pg` pool and the same database.
- **Roles:** the admin plugin's custom access control defines real `admin` and `editor` roles. Admin gets everything, including staff management and the Vertex AI settings; Editor gets content, reservations and closures.
- **Invite-only:** sign-up is disabled (`emailAndPassword.disableSignUp`, plus magic link `disableSignUp` if magic link is used). A `databaseHooks.user.create.before` hook rejects any email without an open invitation.
- **Invitations:** app-owned, single-use, hashed tokens in a `staff_invitation` table with a 7-day expiry, emailed through Resend. On accept, the server calls `auth.api.createUser` and signs the person in.
- **Audit:** an `audit_log` row is written in the same transaction as every mutation.
- **Next 16 pattern:**
  - One `proxy.ts`, combined with i18n, does only a cookie-presence check on `/admin`.
  - A server-only DAL (`verifySession` plus `requirePermission` via `auth.api.userHasPermission`) is called by every admin page.
  - Every Server Action and Route Handler re-checks permission itself.
- **Neon Managed Auth:** close its open sign-up immediately. Once Better Auth is live, disable Managed Auth while keeping its data (it has 0 users).
- **Why not Managed:** it is a reasonable fallback, but it cannot express an Editor role, its emails are Neon-templated unless you run a public webhook, and its SDK is still 0.5.0-beta.
- **Why not Clerk:** it would put staff identities outside Postgres.

## Risks
- Neon Managed Auth sign-up is OPEN right now on the provisioned endpoint (disableSignUp=false, 0 users): anyone with the auth URL can create neon_auth users. Low impact while unused, but disable sign-up or disable Managed Auth (keep data) before any deploy.
- .env.local almost certainly points at the production Neon branch; building auth/admin locally would write staff users, invitations and audit rows into production. Create a Neon dev branch first (the Vercel-managed org needs NEON_API_KEY for the CLI, or use the Console).
- Self-hosted Better Auth means we own security updates and configuration: BETTER_AUTH_SECRET is required; rateLimit must use storage 'database' (the in-memory default is per-instance on serverless); a too-broad baseURL.allowedHosts such as '*.vercel.app' would also widen trustedOrigins, so keep the preview pattern project-specific.
- The databaseHooks.user.create.before allowlist also runs for the `npx auth create-admin` bootstrap, so the first Admin needs an invitation row or an explicit bootstrap-email exception, otherwise bootstrap fails.
- Invite tokens must be stored hashed, expire, be single-use and be rate-limited; the accept page is public. The email sender domain must be verified in Resend (SPF/DKIM) or invites and password resets will not arrive.
- Only one proxy.ts is allowed: locale routing and the /admin auth check must share it. A wrong matcher can redirect static assets, expose /admin, or break /api/auth.
- Better Auth's heavy inferred types under TypeScript 7 (tsgo) are untested here (unverified).
- If Managed Neon Auth is chosen instead: the SDK is still 0.5.0-beta; it is undocumented whether disableSignUp blocks Email-OTP auto-registration (may need the public user.before_create webhook, which cannot be tested on localhost without a tunnel); emails stay Neon-templated and English unless webhooks are used; production requires custom SMTP; the 5-minute session_data cache delays role and ban changes unless the app re-reads its own staff table.
- If cacheComponents is enabled later for the CMS/ISR work, admin session reads must move behind <Suspense> / 'use cache: private', and force-dynamic patterns from vendor docs no longer apply.

## Open questions
- What is the production domain (or domains)? It is needed for BETTER_AUTH_URL / allowedHosts, the Resend sender domain, and invite links.
- Which sign-in method should staff use: email + password with reset (recommended), passwordless magic link, or both?
- Who is the first Admin (email address) to bootstrap?
- Can Editors publish content changes live, or only save drafts that an Admin publishes? This decides whether Editors get the content:publish permission.
- Should Editors manage closures/blackout dates and per-restaurant opening hours, slots and capacity, or only Admins? The requirements say Editors handle content and reservations.
- Do Admins need two-factor authentication now? It is available as a self-hosted Better Auth plugin but not on Managed Neon Auth.
- Which languages should auth/invite emails and the admin UI use: EN only, or EN + VI?
- OK to disable the unused Neon Managed Auth on the Neon project (keeping its schema and data; it has 0 users) once Better Auth is live, and to disable its open sign-up immediately?
- How long should a session last (default 7 days)? Will any staff use shared front-desk computers, which would argue for shorter sessions?

## Key facts
- [verified] Neon Managed Auth is provisioned on the branch DATABASE_URL points to: schema neon_auth exists with tables user, session, account, verification, organization, member, invitation, jwks, project_config; neon_auth."user" has uuid id plus role/banned/banReason/banExpires columns. (Read-only SQL (BEGIN READ ONLY) against DATABASE_URL_UNPOOLED, 2026-10-01)
- [verified] Live Neon Auth config: email+password sign-up OPEN (disableSignUp=false), requireEmailVerification=false, magic link disabled, organization plugin enabled, webhooks off, shared SMTP, app name 'neon-violet-yacht', allow_localhost=true, trusted_origins empty, 0 users. (Read-only SQL on neon_auth.project_config and neon_auth."user" (non-secret columns only))
- [verified] .env.local has NEON_AUTH_BASE_URL and VITE_NEON_AUTH_URL set to the literal placeholder "provisioning" and no NEON_AUTH_COOKIE_SECRET. (/Users/bcmac/Desktop/projects/Outside Projects/furama_cuisine/.env.local (values inspected only for these two keys))
- [verified] @neondatabase/auth npm latest is 0.5.0-beta (only betas published), peer next>=16.0.0, bundles better-auth 1.6.23; Neon docs say managed server supports Better Auth 1.4.18. (npm view @neondatabase/auth; https://neon.com/docs/auth/overview.md)
- [verified] Next.js integration: createNeonAuth({baseUrl, cookies:{secret}}) from @neondatabase/auth/next/server; auth.handler() at app/api/auth/[...path]/route.ts; auth.middleware({loginUrl}) exported from proxy.ts on Next 16 with a narrow matcher; auth.getSession() returns {data, error}; session_data cookie cache TTL 300s. (https://neon.com/docs/auth/reference/nextjs-server.md; https://neon.com/docs/ai/skills/neon-auth/references/managed-auth.md)
- [verified] Neon server SDK exposes admin.createUser/listUsers/setRole/setUserPassword/updateUser/banUser/unbanUser/listUserSessions/revokeUserSession(s)/impersonateUser/removeUser/hasPermission; caller must hold Better Auth role 'admin'. admin.createUser requires a password. (@neondatabase/auth@0.5.0-beta dist/server-*.mjs API_ENDPOINTS (unpacked in scratchpad); https://neon.com/docs/auth/guides/plugins/admin.md)
- [likely] Managed Auth cannot define custom roles/permissions: 'Admin plugin customization' is on the roadmap, and Better Auth states that without custom access control only 'admin' and 'user' are valid roles, so an Editor role must be stored in an app table. (https://neon.com/docs/auth/roadmap.md; https://better-auth.com/docs/plugins/admin.md (Admin Roles warning))
- [verified] Organization plugin in Managed Auth is Partial/Beta: owner/admin/member only, no Teams/custom roles/server hooks; invitation emails only if send_invitation_email=true AND verify-email-at-signup is on. (https://neon.com/docs/auth/guides/plugins/organization.md; neon-auth SKILL.md plugin table)
- [verified] Sign-up can be disabled via `neon neon-auth config email-password update --disable-sign-up` or API PATCH .../auth/email_and_password; magic link has its own disable_sign_up; user.before_create is a blocking, fail-closed webhook (HTTPS public URL only, Ed25519 JWS, 3 attempts/15s). (https://neon.com/docs/cli/neon-auth.md; https://neon.com/docs/auth/guides/plugins/magic-link.md; https://neon.com/docs/auth/guides/webhooks.md)
- [unverified] Whether Managed Auth's disableSignUp also blocks Email-OTP sign-in auto-registration of unknown emails is not documented. (Neon docs (no statement found); neon_auth.project_config has no emailOtp plugin config)
- [verified] Managed Auth emails (verification, OTP, magic link, reset, org invites) go via shared SMTP auth@mail.myneon.app by default (rate-limited); production requires custom SMTP, which changes only the sender; full branding/localisation only via send.otp/send.magic_link webhooks. Verification links need custom SMTP; reset links expire in 15 min. (https://neon.com/docs/auth/production-checklist.md; https://neon.com/docs/auth/guides/customize-emails.md; https://neon.com/docs/auth/guides/password-reset.md)
- [verified] Vercel-managed Neon integration auto-provisions Managed Auth on preview branches and injects NEON_AUTH_BASE_URL/VITE_NEON_AUTH_URL; Neon CLI on a Vercel-managed org needs NEON_API_KEY (neon login does not work). VITE_NEON_AUTH_URL is only for Vite apps; Next client needs no public URL. (https://neon.com/docs/guides/vercel-managed-integration.md; managed-auth.md Environment table)
- [verified] better-auth latest is 1.7.7 (2026-09-30), peers next ^14||^15||^16, pg ^8; CLI package is now `auth` (1.7.7), @better-auth/cli is deprecated. (npm view better-auth; npm view auth; npm view @better-auth/cli)
- [verified] Better Auth supports custom roles via createAccessControl/ac.newRole passed to admin({ac, roles}), server checks via auth.api.userHasPermission, emailAndPassword.disableSignUp, magicLink disableSignUp, databaseHooks.user.create.before, nextCookies(), getSessionCookie for proxy.ts, `npx auth@latest generate` emitting a SQL file for the Kysely/pg adapter, and `create-admin` CLI. (https://better-auth.com/docs/plugins/admin.md; /docs/reference/options.md; /docs/plugins/magic-link.md; /docs/integrations/next.md; /docs/concepts/cli.md; /docs/adapters/postgresql.md)
- [verified] Better Auth rate limiting defaults to in-memory storage (ineffective across serverless instances) and is enabled only in production; BETTER_AUTH_SECRET is required in production; baseURL.allowedHosts supports wildcards and feeds trustedOrigins. (https://better-auth.com/docs/reference/options.md)
- [verified] Clerk: native Vercel Marketplace integration; @clerk/nextjs 7.9.9 peers next ^16.0.10 and react ~19.3; Invite-only access mode available on all plans incl. free Hobby (50k MRU); allowlist/blocklist requires paid plan (Pro $25/mo); roles via publicMetadata + session claims or Organizations. (https://vercel.com/changelog/clerk-joins-the-vercel-marketplace; npm view @clerk/nextjs; https://clerk.com/docs/guides/secure/restricting-access.md; https://clerk.com/pricing.md; https://clerk.com/docs/guides/secure/basic-rbac.md)
- [verified] Next 16: Proxy should only do optimistic cookie checks because it runs on every route including prefetches, and must not be the only line of defense; Proxy runs on Node.js and the runtime option is disallowed; only one proxy.ts per project. (node_modules/next/dist/docs/01-app/02-guides/authentication.md:1033,1121,1126; 03-api-reference/03-file-conventions/proxy.md:253-255; 01-getting-started/16-proxy.md:15,29,35-37)
- [verified] Next 16: centralise auth in a server-only DAL with verifySession = cache(...); do not rely on layouts; every Server Action and Route Handler re-verifies auth and authorization (they are public POST endpoints), validate input, return minimal data; only the DAL should read process.env. (node_modules/next/dist/docs/01-app/02-guides/authentication.md:1131-1170,1350-1360,1458,1463,1503; data-security.md:56-66,132,281-291,308,339,370,397-437,441,609)
- [verified] forbidden()/unauthorized() still require experimental authInterrupts in Next 16.3.7; force-dynamic is unnecessary once cacheComponents is enabled (not enabled in this repo). (node_modules/next/dist/docs/01-app/03-api-reference/04-functions/forbidden.md:4,17; 02-guides/migrating-to-cache-components.md:138-140; next.config.ts)