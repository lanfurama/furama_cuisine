# Phase 5 spike: protecting the public booking action, consent and the privacy page, the inbox search off the URL

> Spike report, key `anti-spam-consent` (clone `p5-guard`). Topic: protecting the public booking action (BotID, honeypot, per-phone limit), consent and the privacy page, moving the inbox search off the URL (SEC-2), and the deferred phase-3/4 items.
> Where this report and `00-plan-outline.md` disagree, **the outline wins** (see its §0 and §2). In particular the consent columns move into the single `007_email_and_consent.sql`, and the drawer work must be redone on top of phase 4's final fix wave (group A, `bf20f55`, already rewrote `SiteProvider` and `ReserveDrawer`).

The clone is `/private/tmp/claude-501/-Users-bcmac-Desktop-projects-Outside-Projects-furama-cuisine/e860bf94-efdc-4015-b5d3-085d89bca850/scratchpad/p5-guard`. It is based on `04e0692`, with the fix wave's four uncommitted test diffs reset before starting.

The full working diff, including new files, is in `/private/tmp/claude-501/-Users-bcmac-Desktop-projects-Outside-Projects-furama-cuisine/e860bf94-efdc-4015-b5d3-085d89bca850/scratchpad/p5-guard.patch` (2370 lines, 53 files, +1493/−55).

Everything below was run in that clone. Next docs are cited as `node_modules/next/dist/docs/<file>:line`.

## 0. Final status (all green)
| Check | Before (04e0692) | After |
|---|---|---|
| `npm run typecheck` (TS 7.0.2) | 0 | 0, with botid's types included |
| `npm run lint` | exit 0, 19 warnings | exit 0, 19 warnings (no new ones) |
| unit + integration (`TEST_DB_TAG=p5grd`) | 53 files, 580 tests | **57 files, 672 tests passed** |
| `next build` (2 builds) | – | ok; `check-prerender` passes `/en`, `/en/restaurants/taya-house` and **`/en/privacy`** (+ `content:legal`) |
| E2E, targeted, desktop, `--retries=0` | – | `guest-guard` 4/4, `booking-v2`, `booking-dates`, `admin-booking-settings`, `booking-acceptance` (A1–A6), `admin-reservations` 8/8 on a fresh DB (36 + 12 runs) |
| `e2e/botid.spec.ts` with `BOTID_DEV_BYPASS=BAD-BOT` | – | 1/1. The server log shows `[booking] refused as a bot { by: 'botid' }` |
| visual (8 baselines, `maxDiffPixelRatio 0`) | 8 | **8 passed** |

Negative checks (each one red, then restored):
- **Guest-phone lock removed:** 5 of 6 parallel submits from one number succeed. Red in 3 of 3 runs.
- **`BOTID_PROTECT` set to a naive `/api/*`:** 4 wiring tests fail.
- **Early availability checks removed:** 6 "no query" tests fail.
- **Footer mask removed from the no-JS visual:** 132 px differ (only the new link).

Cleanup: no servers are left on 3240–3249, and all five `*p5grd*` databases were dropped.

## 1. BotID (`botid@1.5.11`)

### Package facts
Read from `node_modules/botid/dist`:
- **Peers:** `next: *` and `react ^18||^19`, both optional. No runtime dependencies.
- **Exports:** `botid/client/core` (`initBotId`), `botid/server` (`checkBotId`), `botid/next/config` (`withBotId`).

`withBotId(config)` adds afterFiles rewrites and a header rule. Confirmed in `.next/routes-manifest.json` after the build:
- `/149e9513-01fa-4fb0-aad4-566afd725d1b/2d206a39-8ed7-437e-a3be-862e0f06eea3/a-4-a/c.js` → `https://api.vercel.com/bot-protection/v1/challenge`
- `…/:path*` → `…/v1/proxy/:path*`
- A header rule `X-Frame-Options: SAMEORIGIN` and `CSP frame-ancestors 'self'` on that prefix.

`checkBotId` on the server (`dist/server/index.mjs`):
- **Where headers come from:** it reads request headers from `globalThis[Symbol.for('@vercel/request-context')]`, not from `next/headers`. It only falls back to `next/headers` when `NODE_ENV==='development'`.
- **Development mode:** `isDevelopment` defaults to `NODE_ENV !== 'production'`. In that mode it returns HUMAN (`bypassed: true`), or the verdict named in `developmentOptions.bypass` (`'HUMAN'|'BAD-BOT'|'GOOD-BOT'|'ALLOWED'`).
- **Otherwise:** it needs an OIDC token, either the `x-vercel-oidc-token` request header or `VERCEL_OIDC_TOKEN`. Without one it **throws** "The 'x-vercel-oidc-token' header is missing…". So a plain `next start` (NODE_ENV=production, off Vercel) would throw on every booking unless the call is gated.
- **Checking:** it POSTs to `https://api.vercel.com/bot-protection/v1/is-bot`.
- **Noise:** when `x-is-human` is missing it logs a "Possible misconfiguration" `console.error`. This is expected off Vercel.

### How BotID covers a Server Action
- A Server Action is a POST to the page's own URL (`01-app/03-api-reference/03-file-conventions/proxy.md:249`).
- Next's action client calls the **global `fetch` at call time**: `next/dist/client/components/router-reducer/reducers/server-action-reducer.js:74` calls `segment-cache/fetch.js:28` (`return fetch(input, init)`) with `state.canonicalUrl`.
- BotID's `initBotId` replaces `window.fetch`. It matches `new URL(url, location.href).pathname` against globs (`*`→`.*`) and the method, then sets `x-is-human`, `x-path` and `x-method`.
- The drawer opens on every guest page in every locale, so the protect list is `[{ path: '/*', method: 'POST' }]`. It is only installed on guest pages of a Vercel deployment.
- `instrumentation-client.ts` runs before hydration, and only its synchronous code is guaranteed to run before hydration (`01-app/03-api-reference/03-file-conventions/instrumentation-client.md:117-127`; introduced in v15.3).

### Gotchas found
1. **The proxy runs before rewrites** (`proxy.md:236-247`). Our locale matcher would have 307'd BotID paths that have no dot to `/en/149e…`. The fix adds the prefix to the negative lookahead, pinned in `lib/i18n/proxy-matcher.test.ts`.
2. **Off Vercel, the client gate must stay off.** Otherwise the wrapper waits on `c.js`, which is either a 404 or proxied to api.vercel.com by `next start`, and the booking breaks or calls Vercel.
   - The gate is `NEXT_PUBLIC_VERCEL_ENV ∈ {production, preview}`.
   - In the build it compiles to `r.default.env.NEXT_PUBLIC_VERCEL_ENV`, which is undefined locally.
   - E2E proved the action POST carries no `x-is-human` locally.
3. **`vercel env pull` writes `VERCEL_ENV=development`.** The server gate therefore uses the same `DEPLOYED = {production, preview}` set as `lib/server/email/send.ts`, never `VERCEL==='1'`.

### `lib/botid.ts` (new)
```ts
export const BOTID_PROTECT = [{ path: '/*', method: 'POST' }];
const DEPLOYED = new Set(['production', 'preview']);
export function botIdEnabled(vercelEnv: string | undefined, pathname: string): boolean {
  return DEPLOYED.has(vercelEnv ?? '') && pathname !== '/admin' && !pathname.startsWith('/admin/');
}
```
The file also carries comments explaining the fetch path, with citations.

### `instrumentation-client.ts` (new, repo root)
```ts
import { initBotId } from 'botid/client/core';
import { BOTID_PROTECT, botIdEnabled } from '@/lib/botid';
if (botIdEnabled(process.env.NEXT_PUBLIC_VERCEL_ENV, window.location.pathname)) {
  initBotId({ protect: BOTID_PROTECT });
}
```

### `next.config.ts`
`import { withBotId } from 'botid/next/config'; … export default withBotId(nextConfig);`

### `proxy.ts` matcher
```
'/((?!api(?:/|$)|_next(?:/|$)|admin(?:/|$)|149e9513-01fa-4fb0-aad4-566afd725d1b(?:/|$)|[a-z]{2,3}(?:-[a-z0-9]{2,8})*(?:/|$)|.*\\..*).*)'
```
`adminProxy` also does `next.delete('q')` (SEC-2, see §5).

### `lib/server/guard/bot.ts` (new)
```ts
import 'server-only';
import { checkBotId } from 'botid/server';
const DEPLOYED = new Set(['production', 'preview']);
export type BotCheck = typeof checkBotId;
export async function isBotRequest(env: Record<string, string | undefined> = process.env, check: BotCheck = checkBotId): Promise<boolean> {
  if (!DEPLOYED.has(env.VERCEL_ENV ?? '')) {
    if (env.BOTID_DEV_BYPASS !== 'BAD-BOT') return false;
    const verdict = await check({ developmentOptions: { isDevelopment: true, bypass: 'BAD-BOT' } });
    return verdict.isBot;
  }
  try {
    const verdict = await check();
    return verdict.isBot; // verified bots are refused too
  } catch (err) {
    console.error('[botid] check failed, request let through', { name: err instanceof Error ? err.name : typeof err, message: err instanceof Error ? err.message : undefined });
    return false; // fail open
  }
}
```

### `app/actions.ts`, step 1
The honeypot is checked first because it costs nothing; BotID is a network call.
```ts
export async function submitReservation(input: unknown): Promise<ReservationResult> {
  const blockedBy = honeypotFilled(input) ? 'honeypot' : (await isBotRequest()) ? 'botid' : null;
  if (blockedBy) {
    console.warn('[booking] refused as a bot', { by: blockedBy }); // no PII (spec §12)
    return { ok: false, code: 'bot_blocked' };
  }
  const parsed = parseReservationInput(input);
  if (!parsed.ok) return parsed;
  const result = await createWebReservation(parsed.value);
  if (!result.ok) return result;
  return { ok: true, data: { reference: result.reference, date: result.date, status: result.status } };
}
```

### Tests
- **`lib/server/guard/bot.test.ts`** (9 tests):
  - Off Vercel nothing is called.
  - The real package bypass `BAD-BOT` gives true.
  - On a deployment it asks with no options, ignores the bypass, and refuses verified bots.
  - Fail-open logs only the name and message.
  - The real `checkBotId` with `isDevelopment:false` and no token throws.
- **`lib/botid.test.ts`** (13 tests): runs the **real `initBotId`** against a minimal browser stub, with `window.V_C` pre-seeded with a challenge and `document.querySelector`→`{}` so the script counts as loaded.
  - An action-shaped POST to `/en`, `/en/restaurants/taya-house`, `/vi/privacy` or `/zh-hans/...?x=1` carries `x-is-human`, `x-path` and `x-method`, and keeps `next-action`.
  - A GET to `/api/availability` and a cross-origin POST are untouched.
  - `botIdEnabled` matrix.
- **`test/integration/submit-reservation.test.ts`:** `vi.stubEnv('BOTID_DEV_BYPASS','BAD-BOT')` gives `bot_blocked` with 0 rows. Without it, the same request books.
- **`e2e/botid.spec.ts`** is `test.skip` unless `BOTID_DEV_BYPASS=BAD-BOT`, because every booking on that server is refused. It needs a run of its own: `BOTID_DEV_BYPASS=BAD-BOT … E2E_PORT=3241 npx playwright test e2e/botid.spec.ts`. The `webServer` inherits the env.

## 2. Honeypot (`components/overlays/Honeypot.tsx`, new)
```tsx
export function Honeypot({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="hp" aria-hidden="true">
      <label>
        Website
        <input type="text" name="website" tabIndex={-1} autoComplete="off" data-1p-ignore="" data-lpignore="true"
          data-bwignore="" data-form-type="other" value={value} onChange={(e) => onChange(e.target.value)} />
      </label>
    </div>
  );
}
```
- **CSS:** `.hp{position:absolute;left:-10000px;top:auto;width:1px;height:1px;overflow:hidden}`. It is off-screen rather than `display:none`, because some scripts skip hidden inputs.
- **Placement:** it sits inside `.drawer-fields`, after Special requests.
- **Payload:** it is sent as `honeypot` (spec §10.2's input list).

Server side (`lib/server/booking/input.ts`):
- `honeypotFilled(input)` is true for any value other than `undefined`, `null` or `''`, including spaces and non-strings.
- zod also has `honeypot: z.literal('').optional()` mapped to `bot_blocked` (belt and braces).

**Decision:** a filled honeypot gets a visible `bot_blocked` with the phone number, not a silent fake success. A false positive (autofill or a password manager) must never show a guest a booking that does not exist.

E2E (`e2e/guest-guard.spec.ts`):
- The field is not in the accessibility tree: `ariaSnapshot` has no "Website" and there is no textbox named "Website".
- It is not in the viewport.
- Tab from Special requests goes to the "Privacy policy" link.
- `fill({force:true})` then submit gives the alert "We could not accept this request online. Please call us on +84 236 651 9999 to book.", exactly one POST without `x-is-human`, and 0 rows for that phone.

## 3. Per-phone limit (spec §10.2 step 5)

**Definition:** at most `PHONE_DAY_LIMIT = 3` (in `lib/booking/rules.ts`, shared with the client) **requested or confirmed** (`UPCOMING_STATUSES`) bookings with **`source='web'`** for the same **`phone_e164`** and **`reserved_on`**, across all restaurants. Notes on the choice:
- The existing `reservations_phone_idx (phone_e164, reserved_on)` from 006 serves the count.
- Staff-entered bookings are not "requests".
- Cancelled, declined, seated and no-show bookings do not count.

**Concurrency:** the booking-day lock is per restaurant, so it cannot serialise the same number booking two restaurants. A second advisory lock kind was added in `lib/server/booking/lock.ts`. `pg_advisory_xact_lock` still has exactly one call site.
```ts
async function advisoryLock(client: PoolClient, key: string, { timeout = '5s' }: LockOptions): Promise<void> {
  await client.query(`SELECT set_config('lock_timeout', $1, true)`, [timeout]);
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [key]);
}
export function lockBookingDay(client, restaurantId, date, options = {}) { return advisoryLock(client, `booking:${restaurantId}:${date}`, options); } // same key string as before
export function lockGuestPhoneDay(client, phoneE164, date, options = {}) { return advisoryLock(client, `guest-phone:${phoneE164}:${date}`, options); }
```
- **Lock order:** a guest submit takes the phone lock, then the day lock. Staff paths take only the day lock, so there is no deadlock cycle.
- **Burst cost:** a burst from one number queues on its own key and is refused before it touches the restaurant's day lock. This settles deferral T4 ("checks inside the booking-day lock").

`lib/server/booking/create.ts`:
```ts
async function phoneDayFull(client: PoolClient, input: ReservationRequest): Promise<boolean> {
  await lockGuestPhoneDay(client, input.phoneE164, input.date);
  const { rows } = await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM reservations
      WHERE phone_e164 = $1 AND reserved_on = $2::date AND source = 'web' AND status = ANY($3::text[])`,
    [input.phoneE164, input.date, UPCOMING_STATUSES]);
  return rows[0].n >= PHONE_DAY_LIMIT;
}
// insertInTransaction: if (await phoneDayFull(client, input)) return { ok: false, code: 'too_many_requests' }; then lockBookingDay(...)
```
The INSERT gains `consent_version, consented_at` = `$14, now()` (§4).

Integration tests (`test/integration/submit-reservation.test.ts`, step-5 block):
- The fourth request at any restaurant is refused, including the same number written as `+84 905…` and a lunch request on the same date. Another date or another number still books.
- Cancelling one frees a place.
- Only requested and confirmed web bookings of that date and number count. Seeded cancelled, declined, seated, no-show, staff-entered, other-date and other-number rows do not.
- **Six restaurants at once from one number:** exactly 3 succeed and 3 get `too_many_requests`.
- A number waiting on its held phone lock does not block another number at the same restaurant, date and time.

The E2E checks that the drawer shows "This number already has 3 table requests for that day. To book more, please call us on 0859 555 759." (Phố Cuốn, Dining House phone; three rows seeded for one number at Phố Cuốn, today + 13). The `{phone}` comes from the client: `SiteProvider` merges the chosen restaurant's calendar `groupPhone` into the params (`errorParams`). `{limit}` comes from `DEFAULT_PARAMS.limit = String(PHONE_DAY_LIMIT)`.

## 4. Consent, notice and policy page (spec §11)

### Migration snippet (`db/migrations/007_guest_guard.sql`; merged into phase 5's single 007)
```sql
ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS consent_version text,
  ADD COLUMN IF NOT EXISTS consented_at    timestamptz;
ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_consent_check;
ALTER TABLE reservations ADD CONSTRAINT reservations_consent_check
  CHECK ((consent_version IS NULL AND consented_at IS NULL)
      OR (consent_version IS NOT NULL AND consented_at IS NOT NULL AND length(consent_version) BETWEEN 1 AND 40));
```
- There is no CHECK tying the columns to `source='web'`: even a NOT VALID one would refuse UPDATEs of older web rows.
- Neither column is personal data, so the phase-10 anonymiser keeps them.

### Parser and insert
- zod: `consent: z.literal(true)` maps to `consent_required` (placed after `note` in FIELD_CODES).
- `ReservationRequest.consentVersion = PRIVACY_POLICY_VERSION`.
- The INSERT adds `consent_version, consented_at` = `$14, now()`.

### `lib/legal.ts`
- `PRIVACY_POLICY_VERSION = '2026-10-02'`.
- `PRIVACY_SECTIONS` holds 5 heading/body pairs, and `PRIVACY_KEYS` lists every key the page reads.
- `privacyHref(locale) = /<locale>/privacy`.
- `lib/legal.test.ts` pins the pair `{version, sha256}` of the EN text: PRIVACY_KEYS plus `booking.privacy_notice` and `booking.consent`, hash `e4cc25f6…c5e9`. Editing the policy text fails CI until the version moves.

### Registry (EN only)
- **Error copy:**
  - `error.consent_required`
  - `error.too_many_requests` (vars `limit`, `phone`)
  - `error.bot_blocked` (var `phone`; it never accuses and always gives the phone)
- **Drawer copy:** `booking.privacy_notice` and `booking.consent`. These have screen `legal` but the `booking.` prefix, so they reach the client.
- **Link:** `legal.link`. `ClientKey` and `CLIENT_KEYS` now include `'legal.link'`, used by both the drawer and the footer.
- **Page:** `legal.title`, `legal.updated {date}`, `legal.intro`, plus `legal.{collect,use,share,keep,rights}_{heading,body}`. `rights_body` uses `{email}`, rendered as a mailto link.

### Drawer (`components/overlays/ReserveDrawer.tsx`)
- After the fields comes a `.drawer-consent` block:
  - `<p id="drawer-privacy">` holds the notice plus a link `target="_blank" rel="noopener"`, so the form keeps its state.
  - Then the checkbox, with `aria-describedby="drawer-privacy"` and `aria-invalid`.
  - A `field-error` shows when unticked.
- `SiteProvider` gains `consent`, `setConsent`, `honeypot` and `setHoneypot`:
  - `fieldsValid` now requires consent, so nothing is POSTed without the tick (proved by E2E).
  - Both reset with the form on a done close.
  - Both are sent in the payload.
  - `errors.consent` is set.

### Page (`app/(site)/[lang]/(guarded)/privacy/page.tsx`)
- It reads `lang()` through `getPrivacyStrings(locale)` (`lib/server/content/legal.ts`: `'use cache'`, `cacheLife('max')`, `cacheTag(TAGS.contentLegal, TAGS.i18n(locale))`).
- `ViewMarker view="other"`; `generateMetadata` gives the title "Privacy policy — Furama Cuisine".
- The date is formatted with `en-GB` for `en` in UTC, so it reads "2 October 2026".
- Styles are in `styles/legal.css`, imported in `app/globals.css`.
- It is prerendered (`○ /en/privacy`). `check-prerender` now includes `/en/privacy` with `PAGE_TAGS {'/en/privacy':['content:legal']}`.

### Footer
`<Link href={privacyHref(locale)} className="footer-strong footer-legal">{strings['legal.link']}</Link>` sits as the last item in `.footer-bottom`.

### Visual baselines
- The drawer is **not** in any baseline: the visual specs take full-page shots of home and taya-house without opening it.
- The footer link **is** in the baselines: without the mask, 132 px differ on no-JS home.
- The new file `e2e/visual-added.css` (`.footer-legal{display:none!important}`) is applied through `stylePath` in **both** `visual.spec.ts` (`['./e2e/visual.css','./e2e/visual-added.css']`) and `visual-nojs.spec.ts`. The no-JS spec had no `stylePath` before. Result: 8/8 at ratio 0.

### E2E (`e2e/guest-guard.spec.ts`)
- **Consent:** unticked means no POST, the error shows and `aria-invalid` is set. Ticking clears it. The link opens `/en/privacy` in a popup with the h1 "Privacy policy", and the form keeps its values.
- **Footer:** the link goes to `/en/privacy`; the title, the "Last updated 2 October 2026" line, the five `main` h2s and the mailto link are checked.
- **Existing specs:** the six E2E bookings in `booking-v2` (2), `booking-dates`, `admin-booking-settings` and `booking-acceptance` A1 now tick the box with `getByRole('checkbox', { name: 'I agree to Furama Cuisine using my details as described in the privacy policy.' })`.
- **A1:** still green with the extra lock (8 replays, "≥5 waiters" still holds).

## 5. SEC-2: the inbox search leaves the URL

`lib/server/booking/inbox-search.ts` (new):
- `INBOX_SEARCH_COOKIE='fc_inbox_search'`, max age 30 minutes.
- Cookie options: `httpOnly`, `sameSite:'strict'`, `path:'/admin/reservations'`. `secure` is on unless `BETTER_AUTH_URL` starts with `http://`.
- The value is `JSON.stringify([id, q])`, with `id = randomBytes(4).toString('hex')`.
- `searchText()` trims, caps at 100 characters and needs at least 2.
- `decodeSearch(id, cookie)` returns `{q}`, or `'expired'` (wrong id, missing cookie, bad JSON, or another tab's search), or `null` when the URL has no id.

The action, in `app/admin/(shell)/reservations/actions.ts`:
```ts
export async function searchReservations(formData: FormData): Promise<void> {
  await requirePermission({ reservations: ['read'] });
  const q = searchText(formData.get('q'));
  redirect(q ? `/admin/reservations?tim=${await saveInboxSearch(q)}` : '/admin/reservations');
}
```
- `cookies().set` is only allowed in a Server Function or Route Handler (`01-app/03-api-reference/04-functions/cookies.md:6,74,81-87`).
- The page:
  - uses `<form action={searchReservations}>`;
  - reads `?tim=` through `readInboxSearch`;
  - builds pager links as `?tim=<id>&sau=<cursor>`, so keyset paging is unchanged;
  - keeps tabs as before;
  - when the search has expired, shows `role="status"` "Kết quả tìm kiếm đã hết hạn. Hãy tìm lại.";
  - leaves "Xóa tìm kiếm" as a link (the cookie expires in 30 minutes).
- The guard table `BOOKING_ACTIONS` gains `searchReservations: { permission: { reservations: ['read'] }, editor: true }`.
- The public allowlist stays at **6**; only `submitReservation`'s justification text was updated.
- `proxy.ts` drops `q` from the sign-in `next`, pinned in `proxy.test.ts`.

Tests:
- `inbox-search.test.ts` (unit).
- The `admin-reservations.spec.ts` search test now types the phone into the box. It asserts the URL matches `?tim=[0-9a-f]{8}`, does not contain the phone and differs from the first search; a reload keeps the results and the box value; `document.cookie` has no `fc_inbox_search` (httpOnly); a search in a second tab makes the first say it has expired and show the tabs.

## 6. Error codes
- `BOOKING_ERROR_CODES` adds `consent_required`, `too_many_requests` and `bot_blocked` before `unknown`.
- `DEFAULT_ERROR_STRINGS` indexes the registry for each code at compile time, and `booking-errors.test.ts` "has copy for every code" passes.

## 7. Extra (deferral T5): cheap availability answers
`app/api/availability/route.ts` now answers before any query:
- `400 invalid_range` when both `from` and `to` are given and the span is wrong.
- `404 restaurant_unavailable` when the restaurant id fails `/^[a-z0-9][a-z0-9-]{0,63}$/`.

`test/integration/availability.test.ts` asserts `getPool().query` is never called for six such requests. **This change came after the last build,** so only integration tests (28/28) exercise it.

## 8. Errors hit
1. **Integration test 'the database keeps the version and the time together' failed:** an INSERT with `consent_version` NULL and `consented_at` set was accepted.
   - Cause: the first CHECK, `(… OR (consented_at IS NOT NULL AND length(consent_version) BETWEEN 1 AND 40))`, evaluates to NULL when `consent_version` is NULL, and a CHECK that evaluates to NULL passes.
   - Fix: the second disjunct now requires `consent_version IS NOT NULL AND consented_at IS NOT NULL AND length(...) BETWEEN 1 AND 40`; 25/25 pass.
2. **The footer privacy link would break the visual baselines;** with the mask removed, the no-JS home differs by 132 px.
   - Cause: the baselines are full-page shots that include the footer, and `visual-nojs.spec.ts` did not use `visual.css` at all.
   - Fix: new `e2e/visual-added.css` hides `.footer-legal` and is passed as `stylePath` in both visual specs; 8/8 pass at ratio 0. The link has its own functional E2E.
3. **admin-reservations search E2E: after reload the box showed the first search's text.**
   - Cause: test race: the row and URL assertions passed at once on the old page, so `page.reload()` aborted the second Server Action before it finished.
   - Fix: wait for the lede `Kết quả cho "<phone>" …`, then assert the URL differs from the first search's.
4. **Privacy E2E could not find 'Last updated 2 October 2026'.**
   - Cause: Intl `'en'` formats US-style ('October 2, 2026').
   - Fix: use `en-GB` for locale `en`, matching the site's day-first dates; other locales use `toBcp47` (phase 8).
5. **Privacy E2E: the list of level-2 headings had an extra 'Where would you like to dine?'.**
   - Cause: the chrome's BookingBar heading is on every guest page.
   - Fix: scope the assertion to `getByRole('main')`.
6. **admin-reservations 'edit into a full slot' (1 vs 0 chỗ) and 'day sheet 4/16' failed on the second E2E run.**
   - Cause: known since phase 4 (fix-wave F18): the spec permanently adds covers, so it is not re-runnable on the same database. Not caused by this spike.
   - Fix: reset the database and rerun: 8/8 green.
7. **`lib/booking.test.ts` FIELD_MAX tests, booking-config and lifecycle helpers returned `consent_required`.**
   - Cause: their inputs lacked the now-required `consent:true`.
   - Fix: added `consent: true` to those inputs (and to submit-reservation's request).
8. **oxlint warning `typescript(no-extraneous-class)` in `lib/botid.test.ts`** (20 warnings instead of 19).
   - Cause: the XMLHttpRequest stub was an empty class.
   - Fix: gave the stub `open()` and `send()` methods; back to 19 warnings.
9. **`timeout` command not found** (zsh on macOS).
   - Cause: GNU coreutils is not installed.
   - Fix: ran without it, relying on the Bash tool's timeout.
10. **BotID prints 'Possible misconfiguration of Vercel BotId…' in server logs off Vercel.**
    - Cause: `checkBotId` logs `console.error` when the `x-is-human` header is absent, which is always the case off Vercel.
    - Fix: expected and harmless. The unit test silences it; noted so nobody chases it in E2E logs.

## 9. Package versions
- `botid@1.5.11` (added in the clone, `--save-exact`; peers `next:*` and `react ^18||^19`, both optional; no dependencies; MIT; types compile under TypeScript 7.0.2).
- next@16.3.7 (Turbopack; `instrumentation-client` available since v15.3), react@19.3.0, typescript@7.0.2, zod@4.6.5, pg@8.23.0, vitest@5.0.3, @playwright/test@1.63.0, oxlint@1.86.0.
- Postgres 18.3 (local), Node 22.22.0 (local).
- No other packages added; resend and nodemailer belong to the SMTP spike.

## 10. The spike's recommended task breakdown

**G1. Copy and policy constants.**
- Files: `lib/booking-errors.ts` (three codes, `DEFAULT_PARAMS.limit`), `lib/booking/rules.ts` (`PHONE_DAY_LIMIT`), `lib/i18n/registry.ts` (`error.consent_required`, `error.too_many_requests`, `error.bot_blocked`, `booking.privacy_notice`, `booking.consent`, `legal.link` and the `legal.*` page keys; `ClientKey` and `CLIENT_KEYS` gain `legal.link`), `lib/legal.ts`.
- Tests: `lib/legal.test.ts` (hash pin), existing registry and booking-errors tests.

**G2. Migration, parser and per-phone limit.**
- Merge the `007_guest_guard.sql` block into the single phase-5 007.
- `lib/server/booking/input.ts`: `consent`, `honeypot`, `honeypotFilled`, `consentVersion`.
- `lib/server/booking/lock.ts`: `lockGuestPhoneDay`, shared helper, lock order.
- `lib/server/booking/create.ts`: `phoneDayFull` and the consent columns.
- Tests: `input.test.ts`, and `submit-reservation.test.ts` (consent, the CHECK, the five step-5 tests including the concurrency race). Run the race once with the phone lock removed; it must go red.
- Fix the consent fields in the `booking.test.ts`, `booking-config.test.ts` and `reservation-lifecycle.test.ts` helpers.

**G3. BotID.**
- Install `botid@1.5.11`.
- `next.config.ts` `withBotId`; `proxy.ts` matcher exclusion and `proxy-matcher.test.ts`.
- `lib/botid.ts` + `instrumentation-client.ts` + `lib/botid.test.ts` (real wrapper).
- `lib/server/guard/bot.ts` + `bot.test.ts`.
- `app/actions.ts` step 1 + its integration tests.
- `e2e/botid.spec.ts` and the extra opt-in E2E command (decide whether CI runs it as a second job).

**G4. The drawer.**
- `components/overlays/Honeypot.tsx`, the consent block in `ReserveDrawer.tsx`, the `SiteProvider` state and payload, and `errorParams` (group phone).
- CSS in `styles/overlays.css`.
- Tick the box in the six E2E bookings; `e2e/guest-guard.spec.ts` (consent, honeypot, per-phone message).
- Fold in phase 4's drawer error-path deferrals (T6), since this task reworks the error mapping anyway:
  - a 404 `restaurant_unavailable` shows `error.network` with a futile Try again;
  - Try again unmounts its own focused button, and a double failure shows a double alert;
  - the BookingBar shows nothing when the calendar fails.
- Rebase on the fix wave first: F2, F3, F4 and F5 rewrite these same files.

**G5. Policy page.**
- `app/(site)/[lang]/(guarded)/privacy/page.tsx`, `lib/server/content/legal.ts` (`content:legal` tag), `styles/legal.css`.
- The footer link and `e2e/visual-added.css`, wired into both visual specs.
- `check-prerender` `/en/privacy` plus `PAGE_TAGS`.
- E2E footer test. Visual must stay 8/8 at 0.

**G6. SEC-2.**
- `lib/server/booking/inbox-search.ts` + test, the `searchReservations` action, the inbox page.
- Guard `BOOKING_ACTIONS` row; proxy strips `q` (+ `proxy.test.ts`).
- `admin-reservations.spec.ts` search test. This spec also needs F18 (re-runnable) from the fix wave.

**G7. Cheap availability answers (T5).** Early range check and id-shape 404 in `route.ts`, plus the "no query" tests.

**Deferred items that belong to other phase-5 tasks:**
- **SMTP / email transport:**
  - `appOrigin()` must fail closed outside log mode, and a missing `BETTER_AUTH_URL` must throw.
  - `deliverInvite`: split the send from the bookkeeping UPDATE, so a database error after a successful send is not reported as an email failure.
  - The "Resend cast" (`new Resend() as unknown as ResendLike`) disappears with Resend. Do not reintroduce an `as unknown as` cast for the nodemailer transport.
  - Preview `redirect` mode sends real staff's reset links to the shared inbox: a user decision before the first preview.
- **Templates:**
  - Tie the 60-minute and 7-day template constants to the config.
  - Measure the react-email bundle and its production CLI dependencies (tailwind, esbuild, socket.io).
  - The done screen and `guest.ack` / `guest.confirmed` must use the same wording (the F2 keys).
- **Outbox:**
  - Replace the `reservation_events.type` CHECK when adding email events, and make the audit-label guard read the live constraint.
  - Label guest and system email events, so conflicts never read 'người khác'.
- **Phase 7, not 5:** scope the `serverActions.bodySizeLimit` raise. Next's limit is global; `submitReservation` stays protected by the zod `abort` bounds (F1).

## 11. Risks and open questions
1. **BotID pricing and plans were not verified;** from memory: Basic validation is free on all plans, Deep Analysis is Pro/Enterprise and billed per check (about $1 per 1,000). The Vercel docs could not be reached under the no-external-service rule. The user should check vercel.com/docs/botid before enabling Deep Analysis.
2. **The server check only works on a deployment with OIDC federation on;** the client half needs `NEXT_PUBLIC_VERCEL_ENV` inlined at build, i.e. 'Automatically expose System Environment Variables' on. If either is off, the client silently skips BotID, or the server throws and fails open with a '[botid] check failed' log. Verify on the first preview.
3. **Fail-open is a policy choice:** a BotID outage or misconfiguration lets bots through (honeypot, consent and the phone limit still apply) rather than blocking every guest. Alternative: fail closed with `bot_blocked`, which shows the phone number.
4. **Verified bots** (search crawlers, AI agents booking for a user) are refused too. Product decision: allow, for example, a ChatGPT-agent category via `isVerifiedBot` or `verifiedBotCategory`.
5. **BotID adds about 6 KB minified** (`botid/client/core` is 6,264 bytes) to every page's client bundle even where it never runs, because the gate is a runtime check on the inlined env.
6. **withBotId's rewrites also exist in local and CI builds.** A request to `/149e9513-…/` on `next start` would proxy to api.vercel.com. Nothing requests it locally (the client gate is off), but a manual curl would.
7. **Phase 10's static guest CSP** (`script-src 'self' 'unsafe-inline'`) must allow BotID: `c.js` and `p.js` are same-origin through the rewrite, but Kasada's Deep Analysis script may need wasm or eval. Test with Deep Analysis on before shipping the CSP.
8. **'Per day' in the phone limit means `reserved_on`** (the booking's date). One number can still hold 3 × window_days (42) active web requests across dates. The alternative, 3 created per Da Nang day, is stronger against a single prankster but blocks a family booking 4 dinners in one sitting. Rotating numbers defeats either; BotID is the real defence. The user decides the definition and the limit of 3.
9. **A guest submit now takes two advisory locks** (phone, then day) and one extra count query. Lock order is documented and no path takes them the other way. Phase 4's code rule 'one booking-day lock per transaction' still holds; plan text that says 'one lock per transaction' needs updating.
10. **Step order differs from spec §10.2:** step 5 (phone limit) runs before the step-3 rule checks inside the transaction, so `too_many_requests` takes precedence over `outside_window`, `closed` and the like.
11. **Consent version:** a code constant pinned to a hash of the EN text. From phase 7, when editors change `legal.*` in the database, the version must come from the save (for example its `updated_at`) and the hash test moves to that flow. `legal.keep_body` hard-codes 24 months while `booking_settings.pii_retention_months` is editable: tie them when phase 10 makes retention real.
12. **The policy text is an EN draft.** A lawyer must confirm it against Law 91/2025/QH15 (spec §11 already says so), including the controller's identity and the processors (Vercel, Neon, SMTP provider), and a VI version is probably needed. Only EN keys exist now.
13. **The footer link is masked in the visual specs** rather than the baselines being re-taken (the rule is never `--update-snapshots`). If the user prefers, re-take the baselines once with a reviewed diff and drop `visual-added.css`.
14. **Tabs left open across the deploy:** if phase 4 deploys before phase 5, an old drawer sends no consent and gets `consent_required` with no box to tick. Vercel Skew Protection, or a reload, covers it; the site has never been deployed, so the risk is low.
15. **The inbox search cookie** (httpOnly, 30 min, path `/admin/reservations`) still holds guest PII on the staff browser. It is no longer in URLs or logs. 'Xóa tìm kiếm' is a plain link, so the cookie lingers until it expires; add a clear action if a shared PC matters.
16. **Merge conflicts:** the fix wave (F1 `input.ts` zod abort, F2–F5 `SiteProvider` and `ReserveDrawer` rewrites, F6 `outside_window` copy, F18 admin-reservations spec) touches the same files. This patch is based on `04e0692` without the wave and must be re-applied on top of it.
17. **007 numbering:** the outbox spike also writes 007. Merge this block into one file; migration tests read files by name.
18. **The BotID blocked-path E2E needs a separate server run** with `BOTID_DEV_BYPASS=BAD-BOT`. CI has to decide whether to add that job or rely on the integration test plus the unit test of the real wrapper.

## 12. Spec deviations proposed by the spike
1. A filled honeypot returns a visible `bot_blocked` that gives the restaurant's phone, not a silent fake success (spec §10.2 does not say which; a false positive must never look like a booking).
2. BotID treats verified bots as bots and fails open on BotID errors. The spec only says 'bots are blocked'.
3. The per-phone limit (§10.2 step 5) is defined as: 3 requested or confirmed web bookings per `phone_e164` per `reserved_on`, across restaurants. It is checked inside the booking transaction under a new guest-phone advisory lock taken before the booking-day lock, so it runs before the step-3 rule checks.
4. Consent is recorded as two new columns, `reservations.consent_version` and `consented_at`, with a pair CHECK. The spec only says 'notice, checkbox, policy page'. The version is a code constant pinned by a hash test.
5. `booking.privacy_notice` and `booking.consent` use the `booking.*` prefix (screen `legal`) so they ship to the client. `legal.link` was added to `ClientKey` and `CLIENT_KEYS`. EN only; there are no VI defaults yet, although the registry allows vi for `legal.*`.
6. The privacy page's reader is tagged `content:legal` plus `i18n:<locale>`, apart from `getStrings`'s `content:ui`.
7. The footer link is hidden from the visual specs by a new `e2e/visual-added.css` instead of changing the baselines.
8. SEC-2 is done now in phase 5 (a POST action, a 30-minute httpOnly cookie, and the URL carrying only `?tim=<id>`). The proxy also drops `?q=` from the sign-in `next`.
9. Beyond the asked scope: `/api/availability` answers a fully given bad range (400) and an impossible restaurant id (404) before any database query (phase-4 deferral T5).

## 13. User steps
1. Vercel → Project Settings: make sure 'Automatically expose System Environment Variables' is on (Environment Variables page) and OIDC Federation is enabled (Security). BotID needs both: `NEXT_PUBLIC_VERCEL_ENV` at build, and `VERCEL_OIDC_TOKEN` or the `x-vercel-oidc-token` header at runtime.
2. Vercel → Firewall → BotID: decide whether to turn on Deep Analysis (Pro/Enterprise, billed per check; check current pricing on vercel.com/docs/botid). Basic mode needs no toggle.
3. After the first preview deploy: make one real booking from a browser. Check that the function logs show no '[botid] check failed', that the Firewall/BotID traffic view shows the check, and that the booking went through.
4. Never set `BOTID_DEV_BYPASS` in any Vercel environment. The code ignores it on deployments, but it is a test switch only.
5. Ask a lawyer to review the privacy notice, the consent label and the policy page (Law 91/2025/QH15), and supply the VI text. Confirm the controller name and contact address (currently `fb@furamavietnam.com`), the processors (Vercel, Neon, your SMTP provider) and the 24-month retention wording.
6. Decide: the per-phone limit's 'day' (booking date or day of request) and the number 3; whether verified bots (for example AI agents) may book; whether BotID fails open (the current choice) or closed.
7. Optional: add a Vercel WAF rate_limit rule on POST to guest pages (start in log mode) as a second layer behind BotID.
8. Not done here, but needed for the SMTP and outbox work: make sure the SMTP host allows outbound 587 or 465 from Vercel Functions (port 25 is usually blocked), and set up SPF, DKIM and DMARC for the sending domain.
