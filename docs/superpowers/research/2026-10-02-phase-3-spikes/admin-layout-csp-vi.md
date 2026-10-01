# Spike p3-layout: admin layout, CSP nonce, Vietnamese shell

**Topic:** This spike covers the admin root layout under Cache Components, a per-request nonce CSP and security headers for /admin, and the proxy's session-cookie gate. It also covers the Vietnamese admin shell and sign-in (useActionState + a Server Action, zod in Vietnamese, the Better Auth error map, Intl vi-VN), with E2E against a local DB and seeded staff.

> Lead note: this is the spike's own report. Its `lib/auth/server.ts`, migration `005_staff_auth.sql` (camelCase columns) and coarse permission statement were stand-ins. The plan uses the p3-auth versions of those (see `00-plan-outline.md` §0). Everything about the layout, CSP, proxy, sign-in transport and per-page `instant = false` is adopted.

## Verified patterns

### Where everything is
- **Clone:** `/private/tmp/claude-501/-Users-bcmac-Desktop-projects-Outside-Projects-furama-cuisine/e860bf94-efdc-4015-b5d3-085d89bca850/scratchpad/p3-layout`
  - `.next`, `.env.local` and `.vercel` were deleted after cloning. The original repo is unchanged (`git status` is clean).
- **Full patch** of every change except `package-lock.json`: `/private/tmp/claude-501/-Users-bcmac-Desktop-projects-Outside-Projects-furama-cuisine/e860bf94-efdc-4015-b5d3-085d89bca850/scratchpad/p3-layout.patch`
  - 45 files, +1797/−7, 2130 lines. Apply it with `git apply`, then run `npm i better-auth@^1.7.7 zod@^4.6.5`.
- **Logs and screenshots:** `<clone>/.spike/`, including `build-final.log`, `e2e-final-{1,2,3}.log`, `build-neg.log`, `shot-sign-in.png` and `shot-users.png`.
- **Cleanup:** the DB `furama_cuisine_p3layout_test` has been dropped, and nothing is listening on ports 3231–3233.

### Final verification (all on the clone, all against a local `_test` DB)
- **Typecheck:** `npx tsc --noEmit` exits 0 (TypeScript 7.0.2).
- **Lint:** `npx oxlint` reports 0 errors and 18 warnings. That is the same 18 as `main`; none are in new files.
- **Unit tests:** `TZ=UTC vitest run` gives 20 files passed and 7 skipped; 196 tests passed and 44 skipped. `main` has 130 passed, so 66 tests are new or extended.
- **Build:** `next build` exits 0 with no warnings. After the DAL fix below, it also builds with no `BETTER_AUTH_*` env at all.
  ```
  ├ ƒ /admin
  ├   /admin/[...missing]
  │ └ ◐ /admin/[...missing]      ← fallback shell, also empty (htmlSize 0)
  ├ ƒ /admin/accept-invite
  ├ ƒ /admin/audit
  ├ ƒ /admin/reset-password
  ├ ƒ /admin/sign-in
  ├ ƒ /admin/users
  ├ ƒ /api/auth/[...all]
  ```
- **Nothing in the admin is prerendered.** Every `/admin*` entry in `prerender-manifest.json` has `response:"empty"`, `compute:"blocking"` and `htmlSize:0`, and every `.next/server/app/admin*.html` file is 0 bytes.
  - Next still records a postponed resume state for each route, but no admin markup is built ahead of time.
  - The build log has no `blocking-prerender-*` errors.
- **Prerender check:** `node scripts/check-prerender.mjs` passes, including the new admin rule and the font check (still 38 faces).
  - **Negative test:** with `await connection()` removed, `/admin/accept-invite` and `/admin/reset-password` become ○ (fully static, 13 KB shells), and the new check fails with exit 1. This also proves that `instant = false` alone does NOT make a route dynamic (`migrating-to-cache-components.md:86`).
- **Playwright:** the full suite passed 52/52 three times with `--retries=0` (33 existing guest tests plus 19 new admin tests).
- **Dev server** (`next dev`, local DB):
  - With `instant=false` on every admin page, there are no console errors and no CSP violations.
  - Without it, there are errors; see "Dev-mode validation" below.
- **curl on `next start`:**
  - `GET /admin/sign-in` returns 200 with these headers:
    - `content-security-policy: default-src 'self'; script-src 'self' 'nonce-…' 'strict-dynamic'; style-src 'self' 'nonce-…'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`
    - `x-frame-options: DENY`, `x-robots-tag: noindex, nofollow`, `referrer-policy: same-origin`, `x-content-type-options: nosniff`, `permissions-policy: …`
    - `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate`
  - The HTML has 13 `<script>` tags, and all 13 carry the nonce. Next also nonces the `<link rel=stylesheet/preload>` tags. There are 0 `style=""` attributes and 0 `<style>` elements.
  - The page has `<html lang="vi">` and `<meta name="robots" content="noindex, nofollow"/>`.
  - `/en` has no CSP and no X-Robots-Tag, still sends `x-nextjs-prerender`, and contains no `nonce=`.

### Key mechanics, verified

#### 1. Second root layout
`app/admin/layout.tsx` sits beside `app/(site)/[lang]/layout.tsx`, with `app/global-not-found.tsx` and `app/global-error.tsx` still in place.
- **Side effect on the guest code:** a second root layout without `[lang]` changes the generated `next/root-params` type to `lang(): Promise<string | undefined>` (`.next/types/root-params.d.ts`; documented at `next-root-params.md:286-313`).
  - The build then fails with TS2345 in both guest layouts.
  - The fix is two lines and is needed in phase 3:
    ```diff
    // app/(site)/[lang]/layout.tsx
    -  const code = await lang();
    +  const code = (await lang()) ?? DEFAULT_LOCALE;
    // app/(site)/[lang]/(guarded)/layout.tsx
    -  if (!enabled.some((l) => l.code === locale)) notFound();
    +  if (!locale || !enabled.some((l) => l.code === locale)) notFound();
    ```
- **Unmatched `/admin/*` URLs:** they match no route, so they get the guest site's English `global-not-found` with a real 404.
  - The spike adds `app/admin/[...missing]/page.tsx` → `notFound()`, which renders `app/admin/not-found.tsx` in Vietnamese. Its status is 200; see the next point.
- **Response codes in production:** on `next start`, every admin page answers 200.
  - Next sends the empty shell's stored status before resuming the render:
    - `node_modules/next/dist/build/templates/app-page-runtime.js:1211-1213` sets `res.statusCode = cachedData.status`.
    - `:1388-1440` pipes the resume render into the already-open body.
  - So `redirect()`, `notFound()` and `forbidden()` inside an admin page arrive through the RSC payload. The server returns `<html id="__next_error__">`, and the client renders the 403 or 404 UI or follows the redirect.
  - Only the proxy's cookie check is a real 307.
  - `next dev` gives real 403/404 codes, because dev serves no prerender cache.
  - **Verified that nothing leaks:** an Editor's `/admin/users` response contains no other staff data, only the Editor's own name and email from the shell.

#### 2. Dev-mode validation
`instant=false` on the root layout is not enough. Dev still flagged:
- `Route "/admin/users": … uncached data` at `getSession` in the DAL.
- `Route "/admin/sign-in": … URL data` at `await searchParams`.

`instant-navigation.md:568` says "navigations between sibling segments below are still validated". The fix that was verified clean: `export const instant = false;` on **every** admin `page.tsx`, enforced by a guard test.

#### 3. Build-time execution
Admin layout and page bodies DO run during `next build`, up to their first request-time API, even though the root layout awaits `connection()` first.
- Proof: `getAuth().api.getSession({ headers: await headers() })` evaluates `getAuth()` before `await headers()`, so the build created Better Auth. Without the secret it logged `BetterAuthError: You are using the default secret`.
- **Rule:** the DAL reads `headers()` before anything else, and every admin page calls `verifySession()` / `requirePagePermission()` before any DB work.
- After the fix, the build needs no `BETTER_AUTH_SECRET` or `BETTER_AUTH_URL`; runtime does.

#### 4. Nonce flow
- The proxy sets the CSP on both the request headers (`NextResponse.next({ request: { headers } })`) and the response.
- Next parses the nonce from the request's `content-security-policy` header (`next/dist/server/app-render/app-render.js:209-210`, `get-script-nonce-from-header.js`: script-src first, else default-src).
- The empty prelude is essential: all HTML, including the bootstrap scripts from the stored `resumableState`, is produced at resume time with the request's nonce.
- On a soft navigation inside the shell (verified: 0 document requests), the new chunks load under `'strict-dynamic'` with no violation.

#### 5. Better Auth facts
All checked in `node_modules/better-auth@1.7.7`.
- **Session cookie:** `better-auth.session_token`. It gets the `__Secure-` prefix when `baseURL` is https or `advanced.useSecureCookies` is set (`dist/cookies/index.mjs` `createCookieGetter`).
  - `getSessionCookie(request)` from `better-auth/cookies` checks both names and works in `proxy.ts`. The spike verified it in the build and in unit tests with both names.
- **Rate limiting only runs in the HTTP router:** `dist/api/index.mjs:172` calls `onRequestRateLimit` inside the router's `onRequest`. `auth.api.*` calls skip it.
  - So a Server Action calling `auth.api.signInEmail` is **never rate-limited**.
  - The spike's sign-in action calls `auth.handler(new Request(baseURL + '/sign-in/email'))` instead, and copies `Set-Cookie` with `parseSetCookieHeader` / `toCookieOptions` from `better-auth/cookies`. The `nextCookies()` after-hook returns early for router calls (`_flag === 'router'`).
  - Default special rule: `/sign-in*` allows 3 attempts per 10 s per IP+path. The rate limit is on only when `NODE_ENV=production` (`create-context.mjs:172`).
- **Client IP:** `getIP` reads `x-forwarded-for` and accepts only a single value unless `trustedProxies` is set. `next start` sets `x-forwarded-for` only when it is absent (`next/dist/server/base-server.js:612` uses `??=`), so a client value passes through.
- **Error codes for the Vietnamese map:**
  - From `BASE_ERROR_CODES` (`@better-auth/core/dist/error/codes.mjs`): `INVALID_EMAIL_OR_PASSWORD` (401), `INVALID_TOKEN`, `TOKEN_EXPIRED`, `PASSWORD_TOO_SHORT`.
  - From `ADMIN_ERROR_CODES` (`plugins/admin/error-codes.mjs`): `BANNED_USER` (403).
  - The 429 response has **no code**: the body is `{message}` and the wait is in the `X-Retry-After` header.
- **Password hashing for seeds:** `better-auth/crypto` exports `hashPassword` and `verifyPassword` (scrypt via `@better-auth/utils/password`). Seeding a `staff_user` row plus a `staff_account` row (`providerId:'credential'`, `accountId = userId`, `password = hash`) by direct SQL works for sign-in.
- **Schema SQL:** `npx -y auth@1.7.7 generate --config <file exporting \`auth\`> --output x.sql --yes`, run against the local DB, produced clean SQL.
  - Tables: `staff_user`, `staff_session`, `staff_account`, `staff_verification`, `auth_rate_limit`. Admin plugin columns: `role`, `banned`, `banReason`, `banExpires`, `impersonatedBy`.
  - The config file cannot import `server-only`, so it needs a mirror config.

#### 6. zod 4.6.5
`z.config(z.locales.vi())` works. The built-in messages read, for example, "Quá nhỏ: mong đợi string có >=12 ký tự" and "địa chỉ email không hợp lệ", so the important fields need custom messages. The installed zod was 4.1.11 (transitive), so an explicit dependency is needed.

#### 7. Intl vi-VN on Asia/Ho_Chi_Minh
`{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}` gives `"00:30 02/10/2026"` for 17:30Z; `dateStyle:'full'` gives `"Thứ Sáu, 2 tháng 10, 2026"`. Unit-tested with TZ=UTC.

#### 8. `next/image` in the admin (for phase 7)
It renders `style="color:transparent"`, which raises a `style-src-attr` violation under this CSP. The image still loads.
- Verified fix with zero violations: `style-src-attr 'unsafe-hashes' 'sha256-zlqnbDt84zf1iSefLU/ImC54isoprH/MRiVZGskwexk='`, the SHA-256 of `color:transparent`.
- Not kept in the phase-3 CSP.

#### 9. Referrer-Policy
`no-referrer` would NOT break Server Actions: Chromium still sent `origin: http://localhost:3233` with `sec-fetch-site: same-origin`, and sign-in succeeded. The spike keeps `same-origin`.

#### 10. CSS chunks
`app/global-error.tsx` imports the guest `globals.css`, so every admin page preloads (but does not apply) the 45 KB guest stylesheet via the RSC `"G"` entry. The admin's own CSS is `styles/admin.css` (3.4 KB) plus the shared font CSS chunk.

### Files (final contents; everything else is in the patch)

#### proxy.ts
```ts
import { getSessionCookie } from 'better-auth/cookies';
import { NextResponse, type NextRequest } from 'next/server';
import { adminContentSecurityPolicy, adminSecurityHeaders, createNonce } from '@/lib/admin/csp';
import { ADMIN_SIGN_IN, isAdminPath, isPublicAdminPath } from '@/lib/admin/paths';
import { ENABLED_LOCALES, LOCALE_COOKIE, pickLocale } from '@/lib/i18n/locales';

/* (existing comment unchanged) */
export const config = {
  matcher: [
    '/admin/:path*',
    '/((?!api(?:/|$)|_next(?:/|$)|admin(?:/|$)|[a-z]{2,3}(?:-[a-z0-9]{2,8})*(?:/|$)|.*\\..*).*)',
  ],
};

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isAdminPath(pathname)) return adminProxy(request);

  const locale = pickLocale(
    request.cookies.get(LOCALE_COOKIE)?.value,
    request.headers.get('accept-language'),
    ENABLED_LOCALES, // phase 8: the enabled locales from the database, best effort
  );
  const url = request.nextUrl.clone(); // keeps the query string
  url.pathname = `/${locale}${pathname === '/' ? '' : pathname}`;
  // 307, not 308: the target depends on the cookie and Accept-Language, so no one may cache it as permanent.
  const res = NextResponse.redirect(url, 307);
  res.headers.append('Vary', 'Cookie, Accept-Language');
  return res;
}

/*
 * /admin: an optimistic check only (authentication.md:1033 — the proxy reads
 * the cookie, never the database). The cookie may be stale or forged, so every
 * admin page and action still verifies the session itself.
 */
function adminProxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // getSessionCookie knows Better Auth's names: better-auth.session_token, and
  // __Secure-better-auth.session_token once the base URL is https.
  if (!isPublicAdminPath(pathname) && !getSessionCookie(request)) {
    const url = request.nextUrl.clone();
    url.pathname = ADMIN_SIGN_IN;
    url.search = '';
    const next = new URLSearchParams(search);
    next.delete('_rsc');
    const query = next.toString();
    if (pathname !== '/admin' || query) url.searchParams.set('next', `${pathname}${query ? `?${query}` : ''}`);
    return NextResponse.redirect(url, 307);
  }

  const csp = adminContentSecurityPolicy(createNonce(), {
    dev: process.env.NODE_ENV === 'development',
    https: request.nextUrl.protocol === 'https:',
  });
  // Next takes the nonce from the request's CSP header and stamps it on its scripts.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('Content-Security-Policy', csp);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  for (const [name, value] of Object.entries(adminSecurityHeaders(csp))) res.headers.set(name, value);
  return res;
}
```

#### lib/admin/csp.ts
```ts
/** 128 random bits, base64. Next only accepts [A-Za-z0-9+/_-] and '=' padding. */
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}
export type CspOptions = { dev: boolean; https: boolean };
export function adminContentSecurityPolicy(nonce: string, { dev, https }: CspOptions): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    dev ? "style-src 'self' 'unsafe-inline'" : `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(https ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}
export function adminSecurityHeaders(csp: string): Record<string, string> {
  return {
    'Content-Security-Policy': csp,
    'X-Frame-Options': 'DENY',
    // Invite and reset links carry their token in the URL: never send it to another site.
    // (no-referrer would also do; Server Actions still get a real Origin under it in Chromium.)
    'Referrer-Policy': 'same-origin',
    'X-Robots-Tag': 'noindex, nofollow',
    'X-Content-Type-Options': 'nosniff',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  };
}
```

#### lib/admin/paths.ts
```ts
export const ADMIN_HOME = '/admin';
export const ADMIN_SIGN_IN = '/admin/sign-in';
/** The only admin pages reachable without a session cookie (spec §6.1). */
export const PUBLIC_ADMIN_PATHS: readonly string[] = [ADMIN_SIGN_IN, '/admin/accept-invite', '/admin/reset-password'];
export function isAdminPath(pathname: string): boolean {
  return pathname === ADMIN_HOME || pathname.startsWith(`${ADMIN_HOME}/`);
}
export function isPublicAdminPath(pathname: string): boolean {
  return PUBLIC_ADMIN_PATHS.includes(pathname);
}
/** Only a path inside the admin (not a public page) is accepted; anything else → /admin. */
export function safeAdminNext(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return ADMIN_HOME;
  const base = 'http://admin.invalid';
  let url: URL;
  try { url = new URL(value, base); } catch { return ADMIN_HOME; }
  if (url.origin !== base || !isAdminPath(url.pathname) || isPublicAdminPath(url.pathname)) return ADMIN_HOME;
  url.searchParams.delete('_rsc');
  return `${url.pathname}${url.search}`;
}
```

#### app/admin/layout.tsx
```tsx
import type { Metadata, Viewport } from 'next';
import { connection } from 'next/server';
import { fontVariables } from '@/lib/fonts';
import '@/styles/admin.css';

/* (long comment: why connection() before <html>, why instant=false, and the 200-status note) */
export const instant = false;

export const metadata: Metadata = {
  title: { template: '%s · Quản trị Furama Cuisine', default: 'Quản trị Furama Cuisine' },
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#14201c' };

export default async function AdminRootLayout({ children }: { children: React.ReactNode }) {
  await connection();
  return (
    <html lang="vi" className={fontVariables}>
      <body className="admin">{children}</body>
    </html>
  );
}
```

#### lib/server/dal/session.ts
```ts
import 'server-only';
import { headers } from 'next/headers';
import { forbidden, redirect } from 'next/navigation';
import { cache } from 'react';
import { getAuth } from '@/lib/auth/server';
import { isStaffRole, roleCan, type Permission, type StaffRole } from '@/lib/auth/permissions';
import { ADMIN_SIGN_IN } from '@/lib/admin/paths';

export type Staff = { id: string; name: string; email: string; role: StaffRole };

export const getStaff = cache(async (): Promise<Staff | null> => {
  // headers() first: `next build` runs admin layouts and pages up to their first
  // request-time call, so anything before it (creating Better Auth) would run at build time.
  const requestHeaders = await headers();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session) return null;
  const { id, name, email, role, banned } = session.user;
  if (banned || !isStaffRole(role)) return null;
  return { id, name, email, role };
});
export async function verifySession(): Promise<Staff> {
  const staff = await getStaff();
  if (!staff) redirect(ADMIN_SIGN_IN);
  return staff;
}
export async function requirePagePermission(permission: Permission): Promise<Staff> {
  const staff = await verifySession();
  if (!roleCan(staff.role, permission)) forbidden(); // needs experimental.authInterrupts
  return staff;
}
```

#### lib/auth/permissions.ts
This file has no server imports, so the nav can use it too.
```ts
import { createAccessControl } from 'better-auth/plugins/access';
import { defaultStatements } from 'better-auth/plugins/admin/access';
export const statement = { ...defaultStatements, content: ['update'], reservation: ['update'], booking_rules: ['update'],
  locale: ['manage'], settings: ['update'], staff: ['manage'], audit: ['read'], test_data: ['delete'] } as const;
export const ac = createAccessControl(statement);
export const editor = ac.newRole({ content: ['update'], reservation: ['update'], booking_rules: ['update'] });
export const admin = ac.newRole({
  user: ['create', 'list', 'set-role', 'ban', 'delete', 'set-password', 'get', 'update'], // no impersonate
  session: ['list', 'revoke', 'delete'], content: ['update'], reservation: ['update'], booking_rules: ['update'],
  locale: ['manage'], settings: ['update'], staff: ['manage'], audit: ['read'], test_data: ['delete'],
});
export const roles = { admin, editor } as const;
export type StaffRole = keyof typeof roles;
type Statement = typeof statement;
export type Permission = { [K in keyof Statement]?: Statement[K][number][] };
export function isStaffRole(value: unknown): value is StaffRole { return value === 'admin' || value === 'editor'; }
export function roleCan(role: string | null | undefined, permission: Permission): boolean {
  if (!isStaffRole(role)) return false;
  return roles[role].authorize(permission).success; // an Editor asking for staff → unknown resource → false
}
```

#### lib/auth/server.ts
This is the spike's minimal version; the auth spike owns the real one.
```ts
import 'server-only';
import { betterAuth } from 'better-auth';
import { nextCookies } from 'better-auth/next-js';
import { admin as adminPlugin } from 'better-auth/plugins/admin';
import { getPool } from '@/db/client';
import { ac, roles } from '@/lib/auth/permissions';
function createAuth() {
  return betterAuth({
    appName: 'Furama Cuisine', database: getPool(),
    user: { modelName: 'staff_user' }, session: { modelName: 'staff_session', expiresIn: 60 * 60 * 24 * 7 },
    account: { modelName: 'staff_account' }, verification: { modelName: 'staff_verification' },
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 12 },
    rateLimit: { storage: 'database', modelName: 'auth_rate_limit' },
    plugins: [adminPlugin({ ac, roles, defaultRole: 'editor', adminRoles: ['admin'] }), nextCookies()],
  });
}
export type Auth = ReturnType<typeof createAuth>;
let instance: Auth | undefined;
export function getAuth(): Auth { instance ??= createAuth(); return instance; } // lazy: build never needs the secret
```

#### app/api/auth/[...all]/route.ts
```ts
import { getAuth } from '@/lib/auth/server';
function handler(request: Request): Promise<Response> { return getAuth().handler(request); }
export { handler as GET, handler as POST };
```

#### app/admin/(auth)/sign-in/actions.ts
```ts
'use server';
import { parseSetCookieHeader, toCookieOptions } from 'better-auth/cookies';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { authErrorMessage } from '@/lib/admin/auth-errors';
import { safeAdminNext } from '@/lib/admin/paths';
import { z } from '@/lib/admin/zod';
import { getAuth } from '@/lib/auth/server';

export type SignInState = { email: string; message?: string; fieldErrors?: { email?: string[]; password?: string[] } } | null;
const schema = z.object({
  email: z.email({ error: 'Nhập email công việc, ví dụ ten@furamavietnam.com.' }),
  password: z.string().min(1, { error: 'Nhập mật khẩu.' }),
});
/* Public action (on the CI guard allowlist). Goes through auth.handler() so the DB rate limit applies. */
export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get('email') ?? '').trim();
  const parsed = schema.safeParse({ email, password: formData.get('password') ?? '' });
  if (!parsed.success) return { email, fieldErrors: z.flattenError(parsed.error).fieldErrors };
  const auth = getAuth();
  const { baseURL } = await auth.$context;
  const incoming = await headers();
  const forwarded: Record<string, string> = {};
  for (const name of ['x-forwarded-for', 'x-real-ip', 'user-agent']) { const v = incoming.get(name); if (v) forwarded[name] = v; }
  let res: Response;
  try {
    res = await auth.handler(new Request(`${baseURL}/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: new URL(baseURL).origin, ...forwarded },
      body: JSON.stringify({ email: parsed.data.email, password: parsed.data.password, rememberMe: true }),
    }));
  } catch (error) {
    console.error('[admin] sign-in failed', error instanceof Error ? error.message : error);
    return { email, message: authErrorMessage(500) };
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { code?: string } | null;
    return { email, message: authErrorMessage(res.status, body?.code, Number(res.headers.get('x-retry-after')) || null) };
  }
  const jar = await cookies();
  for (const header of res.headers.getSetCookie()) {
    for (const [name, attributes] of parseSetCookieHeader(header)) jar.set(name, attributes.value, toCookieOptions(attributes));
  }
  redirect(safeAdminNext(formData.get('next')));
}
```

#### app/admin/(auth)/sign-in/SignInForm.tsx
- `'use client'`, using `const [state, action, pending] = useActionState<SignInState, FormData>(signIn, null)`.
- `<form action={action} noValidate>` with:
  - a hidden `next` input;
  - `<p className="a-alert" role="alert">` for `state.message`;
  - email (`defaultValue={state?.email ?? ''}`, `aria-invalid`/`aria-describedby` from `fieldErrors`) and password fields, each with a `<p className="a-field-error">`;
  - the button `{pending ? 'Đang đăng nhập…' : 'Đăng nhập'}`, disabled while pending.

#### app/admin/(auth)/sign-in/page.tsx
- `export const instant = false` and `metadata.title 'Đăng nhập'`.
- Awaits `searchParams.next`. If `await getStaff()` returns someone, it calls `redirect(safeAdminNext(next))`.
- Otherwise it renders the card with `<SignInForm next>` and a "Quên mật khẩu?" link.

#### app/admin/(shell)/layout.tsx
- Calls `const staff = await verifySession()`.
- Builds `items = navFor(staff.role)`.
- Renders a sidebar (`<nav aria-label="Điều hướng quản trị"><NavLinks items/>`) and a header with `staff.name`, the email · `ROLE_LABELS[role]`, and `<form action={signOut}><button>Đăng xuất</button></form>`.

#### app/admin/(shell)/NavLinks.tsx
A client component; `usePathname()` drives `aria-current="page"`.

#### app/admin/(shell)/actions.ts
`signOut()` calls `getAuth().api.signOut({ headers: await headers() })` inside try/catch (`nextCookies` clears the cookies), then `redirect('/admin/sign-in')`.

#### lib/admin/nav.ts
```ts
export const ADMIN_NAV = [
  { href: '/admin', label: 'Tổng quan' },
  { href: '/admin/users', label: 'Nhân viên', permission: { staff: ['manage'] } },
  { href: '/admin/audit', label: 'Nhật ký', permission: { audit: ['read'] } },
];
export function navFor(role) { return ADMIN_NAV.filter((i) => !i.permission || roleCan(role, i.permission)); }
export const ROLE_LABELS = { admin: 'Admin', editor: 'Editor' };
```

#### Pages, forbidden, not-found
- `(shell)/page.tsx` greets the user and shows `todayVi()`.
- `(shell)/users/page.tsx`:
  - starts with `await requirePagePermission({ staff: ['manage'] })`, then queries `staff_user`;
  - the date column uses `formatDateTimeVi`.
- `(shell)/audit/page.tsx` calls `requirePagePermission({ audit: ['read'] })`.
- `(shell)/forbidden.tsx` shows "Không có quyền truy cập" and renders inside the shell.
- `app/admin/not-found.tsx` shows "Không tìm thấy trang".
- `app/admin/[...missing]/page.tsx` calls `notFound()`.
- Every `page.tsx` has `export const instant = false;`.

#### lib/admin/zod.ts
```ts
import * as z from 'zod';
z.config(z.locales.vi());
export { z };
```

#### lib/admin/auth-errors.ts
- **Map:**
  - `INVALID_EMAIL_OR_PASSWORD`: 'Email hoặc mật khẩu không đúng.'
  - `BANNED_USER`: 'Tài khoản này đã bị khóa. Liên hệ Admin để được mở lại.'
  - `INVALID_TOKEN`: 'Liên kết không hợp lệ hoặc đã được dùng. Hãy yêu cầu một liên kết mới.'
  - `TOKEN_EXPIRED`: 'Liên kết đã hết hạn. Hãy yêu cầu một liên kết mới.'
  - `PASSWORD_TOO_SHORT`, `PASSWORD_TOO_LONG`, `INVALID_EMAIL`, `INVALID_PASSWORD`, `SESSION_EXPIRED`, `USER_NOT_FOUND` and `CREDENTIAL_ACCOUNT_NOT_FOUND` are also mapped.
- **Status 429:** 'Bạn đã thử quá nhiều lần. Vui lòng thử lại sau N giây.' when the wait is known, otherwise '… Vui lòng đợi một lát rồi thử lại.'
- **Fallback:** 'Không đăng nhập được. Vui lòng thử lại sau ít phút.'

#### lib/admin/format.ts
Two `Intl.DateTimeFormat('vi-VN', { timeZone: VENUE_TZ, … })` instances, built once, behind `formatDateTimeVi`, `formatLongDateVi` and `todayVi(now = new Date())`. Putting `new Date()` in a helper keeps oxlint's react(purity) rule quiet.

#### styles/admin.css
- It has its own tokens (`--a-*`), is loaded only by the admin root layout, and uses `var(--font-be-vietnam)` from `lib/fonts`.
- It covers the shell grid (232 px sidebar), header, buttons, fields, alerts, the auth card, tables, and a ≤760 px breakpoint.
- There is no `style=""` anywhere in the admin (guard-tested).

#### db/migrations/005_staff_auth.sql
The spike version: SQL generated by `auth@1.7.7 generate` (shown in the patch).

#### next.config.ts
Adds `experimental.authInterrupts: true`.

#### scripts/check-prerender.mjs
New rule 1b:
```js
for (const [route, entry] of [...Object.entries(manifest.routes), ...Object.entries(manifest.dynamicRoutes)]) {
  if (route !== '/admin' && !route.startsWith('/admin/')) continue;
  if (entry.response !== 'empty' || entry.htmlSize !== 0) problems.push(`${route} has a static shell (…); admin pages must render at request time`);
}
```

#### Tests
- **`lib/admin/admin-pages.guard.test.ts`** checks that:
  - every `app/admin/**/page.tsx` has `export const instant = false;`;
  - the root layout has `instant=false` and `await connection()` before `<html`;
  - no `style={` appears in `app/admin`.
- **`proxy.test.ts`** (unit tests with `new NextRequest`):
  - 307 + `next` for signed-out pages, with `_rsc` stripped;
  - the public pages are matched exactly and receive a CSP;
  - both cookie names pass;
  - `x-middleware-request-content-security-policy` equals the response CSP;
  - the nonce differs on every request;
  - a cookie with only `session_data` is rejected;
  - guest redirects carry no admin headers.
- **`lib/i18n/proxy-matcher.test.ts`** gains `/admin/users`, `/admin/sign-in?next=…`, `/admin/accept-invite?token=…` and `/admin/reset-password`, and skips `/api/auth/sign-in/email` and `/api/auth/admin/set-role`.
- **Other unit tests:** `csp.test.ts`, `paths.test.ts` (open-redirect cases `//evil`, `/\evil`, `https://…`, `/admin/../en`, `/admin/%2e%2e/en`, `/admin/sign-in`), `auth-errors.test.ts`, `nav.test.ts` (roleCan matrix; admin impersonate → false), `format.test.ts`.
- **`e2e/admin-staff.ts`:** seeds 3 staff accounts via pg + `hashPassword`. It takes `pg_advisory_xact_lock`, because parallel workers seed at the same time.
- **`e2e/admin-security.spec.ts`:**
  - headers, and the nonce on every script;
  - a new nonce per request;
  - the guest page has no CSP;
  - the proxy gate;
  - hydration with zero CSP violations, caught two ways:
    ```ts
    page.on('console', m => /Content Security Policy/i.test(m.text()) && violations.push(...));
    await page.exposeFunction('reportCspViolation', v => violations.push(v));
    await page.addInitScript(() => document.addEventListener('securitypolicyviolation', e => window.reportCspViolation(...)));
    // hydrated:
    await page.waitForFunction(() => Object.keys(document).some(k => k.startsWith('__reactContainer$')));
    ```
  - a soft navigation inside the shell with 0 document requests and 0 violations.
- **`e2e/admin-sign-in.spec.ts`:**
  - Admin signs in → lands on `?next=` → sees all 3 nav items → `aria-current` → the vi date regex → an httpOnly/Lax cookie → sign out clears the cookie.
  - A signed-in visit to `/sign-in` redirects into the admin; `?next=//evil` → `/admin`.
  - The Editor sees only 'Tổng quan'; `/admin/users` shows the 403 UI inside the shell, with no admin data in the response.
  - A wrong password gives the Vietnamese message and keeps the email; zod field errors are in Vietnamese; the banned account sees its message.
  - The 4th attempt within 10 s returns the 429 message, even with the right password.
  - A forged cookie → sign-in; an unknown admin URL → the Vietnamese 404.
  - Helpers:
    - `formAlert = page.locator('form').getByRole('alert')`, because Next's `#__next-route-announcer__` is also `role=alert`.
    - `signIn()` waits for the POST response; `settled()` waits for `getByRole('button', { name: 'Đăng nhập', exact: true })` to be enabled.
    - Each test gets its own `x-forwarded-for`.

### Environment for build, start and E2E
```
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/<name>_test \
BETTER_AUTH_SECRET=<openssl rand -base64 32> BETTER_AUTH_URL=http://localhost:<E2E_PORT> EMAIL_DELIVERY=log \
E2E_PORT=<port> npx playwright test
```
`next build` itself needs no `BETTER_AUTH_*`. `next start` and E2E do: Playwright's webServer inherits the env, so CI's E2E step must add `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL`.

## Errors hit

1. **next build: TS2345 'string | undefined' is not assignable to 'string' in `app/(site)/[lang]/layout.tsx:56` and `(guarded)/layout.tsx:22,26`**
   - Cause: adding `app/admin/layout.tsx` (a second root layout without `[lang]`) changes the generated `next/root-params` type to `lang(): Promise<string | undefined>` (`next-root-params.md:286-313`).
   - Fix: in the root layout, `(await lang()) ?? DEFAULT_LOCALE`; in the guarded layout, `if (!locale || !enabled.some(...)) notFound()`.
2. **oxlint error react(purity): Date.now is impure, in `app/admin/(shell)/page.tsx`**
   - Cause: calling `Date.now()` directly in a Server Component's render.
   - Fix: moved the call into a helper, `todayVi(now = new Date())`, in `lib/admin/format.ts`.
3. **E2E beforeAll: duplicate key value violates unique constraint "staff_user_email_key"**
   - Cause: two spec files seed in parallel workers; a concurrent `INSERT ... ON CONFLICT (id)` still collides on the unique email.
   - Fix: `SELECT pg_advisory_xact_lock(hashtext('e2e-seed-staff'))` inside the seed transaction. Also removed the `DELETE FROM auth_rate_limit`, which could reset another worker's in-flight rate-limit test.
4. **Playwright strict mode violation: `getByRole('alert')` resolved to 2 elements**
   - Cause: Next's route announcer `<div id="__next-route-announcer__" role="alert">` is always in the document.
   - Fix: scope to the form: `page.locator('form').getByRole('alert')`.
5. **Editor GET /admin/users: expected 403, received 200** (also: the forged-cookie redirect is 200 + a client redirect, and `notFound()` is 200)
   - Cause: under cacheComponents each admin route is an empty prerendered shell plus a postponed state. `next start` sends the cached shell's status (`app-page-runtime.js:1211-1213`), then pipes the resume into the open body (`:1388-1440`), so `forbidden()`/`notFound()`/`redirect()` go through the RSC payload with `<html id=__next_error__>`. `next dev` gives real 403/404 codes.
   - Fix: the tests assert the 403 UI, that the response body has no other staff data, and that no table renders, instead of the status. Documented in `app/admin/layout.tsx`. The real security boundary stays in the DAL and the actions.
6. **Rate-limit E2E: the 4th sign-in (right password) succeeded; the auth_rate_limit count was only 2**
   - Cause: the test filled fields while the previous action was still pending. When the action settled, React reset the form and wiped the typed password, so some submits failed zod and never reached Better Auth. Also, the pending label 'Đang đăng nhập…' matched the name 'Đăng nhập' (substring match). Direct curl confirmed the limiter: 401, 401, 401, 429.
   - Fix: the `signIn()` helper waits for the POST /admin/sign-in response, and `settled()` waits for `getByRole('button', { name: 'Đăng nhập', exact: true })` to be enabled before the next attempt.
7. **Guest test: x-nextjs-prerender expected '1', received '1, 1'**
   - Cause: `next start` emits the header twice for prerendered guest pages (pre-existing behaviour).
   - Fix: assert `/^1(, 1)*$/`.
8. **next dev: 'Route "/admin/users": Next.js encountered uncached data…' (at getSession) and 'Route "/admin/sign-in": … URL data' (await searchParams), despite instant=false on `app/admin/layout.tsx`**
   - Cause: dev instant validation still checks navigations between sibling segments below an `instant=false` layout (`instant-navigation.md:568`), and every Page is validated implicitly (`instant.md:110-112`).
   - Fix: `export const instant = false;` in every `app/admin/**/page.tsx`, enforced by `lib/admin/admin-pages.guard.test.ts`. Re-probed: the console is clean.
9. **next build after deleting a page: `.next/dev/types/validator.ts` TS2307 Cannot find module '../../../app/admin/(shell)/image-probe/page.js'**
   - Cause: tsconfig includes `.next/dev/types/**`. A dev server had generated types for the page, which go stale once it is deleted.
   - Fix: `rm -rf .next/dev` (or the whole `.next`) before building.
10. **Build without BETTER_AUTH_SECRET logged '[Error [BetterAuthError]: You are using the default secret…]' (exit 0)**
    - Cause: build-time prerender runs admin layout and page bodies up to their first request API. `getAuth().api.getSession({ headers: await headers() })` evaluates `getAuth()` before awaiting `headers()`, so Better Auth (and the pg pool) was created at build time.
    - Fix: the DAL awaits `headers()` first, then calls `getAuth()`. Rebuilt with no `BETTER_AUTH_*` env: the log is clean.
11. **A code comment claimed Referrer-Policy no-referrer makes browsers send Origin: null on same-origin POSTs, which would break Server Actions**
    - Cause: an unverified assumption.
    - Fix: tested in dev. With no-referrer, Chromium sent `origin: http://localhost:3233` (sec-fetch-site same-origin) and sign-in worked. The comment was corrected; `same-origin` is kept to protect token URLs.
12. **Production CSP violation 'Applying inline style violates … style-src' (style-src-attr) on a next/image probe page**
    - Cause: `next/image` always renders `style="color:transparent"`, and the admin CSP has no `'unsafe-inline'`.
    - Fix: verified that `style-src-attr 'unsafe-hashes' 'sha256-zlqnbDt84zf1iSefLU/ImC54isoprH/MRiVZGskwexk='` gives zero violations and the image loads. Not kept in phase 3 (there is no next/image yet); recommended for phase 7.
13. **zsh: command not found: timeout**
    - Cause: macOS has no GNU timeout.
    - Fix: ran the command without it.

## Package versions

- next@16.3.7 (Turbopack build)
- react@19.3.0
- react-dom@19.3.0
- better-auth@1.7.7 (newly installed; @better-auth/core@1.7.7, kysely@0.29.6 and better-call@1.4.0 come with it)
- auth@1.7.7 (the Better Auth CLI, run through `npx -y auth@1.7.7 generate`; not installed)
- zod@4.6.5 (newly installed as a direct dependency; before this only zod@4.1.11 was present, pulled in by @vercel/functions → @vercel/oidc → @vercel/cli-config)
- @playwright/test@1.63.0
- vitest@5.0.3
- typescript@7.0.2
- pg@8.23.0
- oxlint@1.86.0
- node v22.22.0
- PostgreSQL 18.3 (Homebrew, local)
- resend@6.31.0 is the npm latest per `npm view`; not installed (no email in this spike)

## Recommended task breakdown

Phase-3 layout/CSP/proxy/UI work, in dependency order. The auth-spike tasks (Better Auth config, invites, audit, Resend, blocking /api/auth/admin/*) slot in after T3.

**T1. Dependencies and the guest root-params fix.**
- `npm i better-auth@^1.7.7 zod@^4.6.5`.
- Make the two guest `lang()` call sites handle undefined. This must land together with T3, or the build breaks.
- Gate: tsc, plus the existing E2E and visual suites unchanged.

**T2. Admin security headers and the proxy admin branch (TDD).**
- Add `lib/admin/csp.ts` and `lib/admin/paths.ts`, and extend `proxy.ts` (`getSessionCookie` from `better-auth/cookies`).
- Tests: `lib/admin/csp.test.ts`, `lib/admin/paths.test.ts`, `proxy.test.ts`, plus the proxy-matcher additions (/admin subpaths; /api/auth/* skipped).

**T3. Admin root layout.**
- `app/admin/layout.tsx` (`instant=false` + `await connection()` before `<html>`, noindex metadata, fonts), `styles/admin.css`, `app/admin/not-found.tsx` and `app/admin/[...missing]/page.tsx`.
- `check-prerender.mjs` rule 1b (admin entries must be response 'empty' with htmlSize 0) and `lib/admin/admin-pages.guard.test.ts` (every admin page has `instant=false`; no `style={}`).
- Gate: the build output shows ƒ for every /admin route; check-prerender passes; a negative build without `connection()` fails the check.

**T4 (auth spike). Better Auth server, permissions and the route.**
- Better Auth server, permissions (createAccessControl admin/editor, no impersonate) and `app/api/auth/[...all]/route.ts`.
- Generate the staff_* and auth_rate_limit migration with `npx auth@1.7.7 generate` against a local DB, using a mirror config (`server-only` cannot be imported).
- Keep `getAuth()` lazy.

**T5. DAL.** `lib/server/dal/session.ts` (getStaff reads `headers()` FIRST, then verifySession and requirePagePermission) plus `experimental.authInterrupts` and `(shell)/forbidden.tsx`.
- Rule: every admin page calls the DAL before any DB work.

**T6. Shell.**
- `(shell)/layout.tsx` (verifySession; a sidebar from `lib/admin/nav.ts` filtered by roleCan; a header with name, email and role, and a sign-out form), the NavLinks client component (`aria-current`), the `(shell)/actions.ts` signOut, and the overview page.
- `lib/admin/format.ts` (Intl vi-VN, VENUE_TZ) with unit tests under TZ=UTC.

**T7. Sign-in.**
- `lib/admin/zod.ts` (`z.config(z.locales.vi())`), `lib/admin/auth-errors.ts` (code → Vietnamese; 429 uses X-Retry-After).
- The sign-in `actions.ts`: zod, then `auth.handler()` so the DB rate limit applies, then copy Set-Cookie, then `redirect(safeAdminNext(next))`.
- SignInForm (useActionState) and `page.tsx` (`instant=false`; redirect when already signed in).
- Add signIn and signOut, and later acceptInvite, requestPasswordReset and resetPassword, to the CI guard's public-action allowlist.

**T8. E2E and CI.**
- `e2e/admin-staff.ts` seed (hashPassword + direct SQL, advisory lock), `e2e/admin-security.spec.ts` (headers, every script carries the nonce, a new nonce per request, the guest has no CSP, the proxy gate, zero CSP violations during hydration and soft navigation), `e2e/admin-sign-in.spec.ts` (flows, Vietnamese errors, the Editor 403 UI, banned, rate limit, forged cookie, unknown URL).
- CI: add BETTER_AUTH_SECRET (random) and BETTER_AUTH_URL=http://localhost:3100 to the E2E step env. The build step needs neither.

Optional, independent of the above: give `app/global-error.tsx` its own small stylesheet, so admin pages stop preloading the 45 KB guest `globals.css`.

## Risks and open questions

- **DECIDE:** on `next start`, every admin page answers HTTP 200. `forbidden()`, `notFound()` and `redirect()` are delivered through the RSC payload and rendered client-side (`app-page-runtime.js:1211-1213, 1388-1440`). Only the proxy's cookie redirect is a real 307. Is 200 plus a client-rendered 403 page acceptable for "Editor blocked from the Admin area"? Spec §13 tests should assert the UI and the absence of data, not the status. `next dev` returns real 403/404, so status-based tests pass in dev and fail in production.
- **Every public auth Server Action that calls `auth.api.*` skips Better Auth's rate limit,** because the limit only runs in the HTTP router (`dist/api/index.mjs:172`). This covers sign-in, request-reset, reset and accept-invite. Route each through `auth.handler()` as the spike does, or add an app-level limiter. Also note that the default /sign-in rule is only 3 attempts per 10 s per IP (about 26k guesses per day per IP), and it is on only when NODE_ENV=production. Consider `rateLimit.customRules` (for example 5 per 60 s) and a per-email throttle.
- **The rate-limit key comes from x-forwarded-for.** On Vercel the platform sets it. On a bare `next start` a client value passes through unchanged (`base-server.js:612` uses `??=`), so the limit could be bypassed if the app is ever self-hosted without a proxy that overwrites the header. If several proxies are involved, set `advanced.ipAddress.trustedProxies`.
- **Phase 7 must extend the admin CSP:**
  - img-src and connect-src need the Vercel Blob host (thumbnails, presigned browser uploads).
  - next/image needs `style-src-attr 'unsafe-hashes' 'sha256-zlqnbDt84zf1iSefLU/ImC54isoprH/MRiVZGskwexk='` (verified).
  - `placeholder='blur'` cannot be hashed, so do not use it in the admin.
  - Any third-party script (e.g. BotID on the guest side) is unaffected, because the guest site gets no nonce CSP.
- **During `next build`, admin layout and page bodies run up to their first request-time API,** even though the root layout awaits `connection()` first. Any DB query or secret-dependent init placed before `verifySession()` or `headers()` would run at build time against the build's DATABASE_URL. Make this a coding rule or a review checklist item.
- **`app/global-error.tsx` imports the guest `globals.css`.** Every admin page preloads that 45 KB stylesheet through the RSC 'G' entry without applying it. This is minor but avoidable.
- **Unmatched /admin/* URLs** fall through to the guest English global-not-found with a real 404 unless the `[...missing]` catch-all exists. With the catch-all, users get the Vietnamese admin 404, but the status is 200. Which is preferred?
- **tsconfig includes `.next/dev/types`,** so deleting a page after running `next dev` can break `next build` until `.next/dev` is removed. This is pre-existing, but it will hit developers who add and remove admin pages.
- **The spike's `lib/auth/server.ts`, migration 005 and the stub accept-invite and reset-password pages are minimal stand-ins.** The auth spike's config (invite hook, bootstrap exception, hooks.before blocking /api/auth/admin/*, Resend) must keep: `getAuth()` lazy, modelName staff_*, rateLimit storage 'database' with modelName auth_rate_limit, and `nextCookies()` as the last plugin. If the auth spike's hooks.before checks `_flag === 'router'` or `ctx.request` to block /admin/*, the spike's use of `auth.handler` for sign-in is unaffected, because it only calls `/sign-in/email`.
- **Open: should admin `<Link>` prefetches skip the proxy** (the matcher `missing` prefetch headers from the CSP doc)? It is not needed for correctness: prefetch RSC requests just receive an unused CSP header, and cookie-less prefetches get a 307. The spike leaves the matcher as is.
- **Open: Referrer-Policy.** `same-origin` was chosen to keep invite and reset tokens off other sites. `no-referrer` was verified to also work with Server Actions in Chromium. Neither is verified on Safari or Firefox.

## Spec deviations

- **§7.1 CI guard:** the spec says the public-action allowlist currently holds only submitReservation. Phase 3 necessarily adds public Server Actions with no session to check: signIn and signOut (this spike), and acceptInvite, requestPasswordReset and resetPassword (the auth flows). The allowlist must grow; each of these validates its own input.
- **§11 and §13:** the spec implies forbidden pages and redirects behave normally. Under Cache Components on `next start`, admin pages always return 200, and `forbidden()`, `notFound()` and `redirect()` act client-side through the RSC payload. The acceptance test "Editor blocked from Admin area" must assert the 403 UI and the absence of data, not an HTTP 403. Server Actions remain the real boundary.
- **§11** says only that `app/admin/layout.tsx` sets `instant = false` and awaits `connection()`. In practice every admin `page.tsx` must also export `instant = false`, or `next dev` reports blocking-route errors for navigations between admin pages (`instant-navigation.md:568`). The spike enforces this with a guard test.
- **Not in the spec:** `experimental.authInterrupts: true`, for `forbidden()` and `forbidden.tsx` (`forbidden.md:4,17`).
- **Not in the spec:** the sign-in Server Action calls `auth.handler()` (Better Auth's HTTP router) instead of `auth.api.signInEmail`, because only the router applies the DB-backed rate limit that spec §7.1 requires, which the "thử quá nhiều lần" message of §7.3 depends on.
- **Not in the spec:** `app/admin/[...missing]/page.tsx`, so unknown admin URLs get the Vietnamese admin 404 instead of the guest English global-not-found.
- **Phase 3 must touch two guest files** (`app/(site)/[lang]/layout.tsx` and `(guarded)/layout.tsx`), because a second root layout makes the `lang()` of next/root-params possibly undefined.
- **§11 lists noindex and X-Frame-Options DENY.** The spike also sends `X-Robots-Tag: noindex, nofollow` (headers survive the client-side error shells), `Referrer-Policy: same-origin`, `X-Content-Type-Options: nosniff` and `Permissions-Policy`, and uses `base-uri 'none'` rather than `'self'`.
