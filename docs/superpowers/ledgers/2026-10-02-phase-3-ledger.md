# Phase 3 ledger — auth and admin shell

Plan: `docs/superpowers/plans/2026-10-02-phase-3-auth-admin-shell.md`. Spec: `docs/superpowers/specs/2026-10-01-admin-cms-design.md`.

Executed on `main` from 28e739e to a3d2793:
- 11 task commits, each a cherry-pick of the verified reference commit followed by a task review.
- One fix round on Task 4 (1fe103f).
- Six commits in the final fix wave (5a026d3..a3d2793).

Final gate:
- typecheck and lint pass (20 warnings).
- Unit and integration: 41 files, 375 tests.
- build and check-prerender pass.
- E2E: 70 passed, twice in a row.
- Visual: 8 passed at ratio 0.

Migration 005 was applied to the shared Neon database on 2026-10-02, after a read-only pre-flight:
- 001–004 were already applied.
- No name collisions. Neon Auth keeps its own tables in the `neon_auth` schema.
- The migration only adds objects.

No Admin exists on Neon yet. Creating one is the user's step (README → First Admin).

## Rulings

- **Execution method:** cherry-pick each verified `p3-folded` commit, reconcile it with the task brief, prove RED for each new test file, then run the full gate. The plan was executed green in that order.
- **Plan rulings R1–R15:** accepted as written.
- **Plan risks marked "Cần quyết định":**
  - #1 Preview `BETTER_AUTH_URL`: check on the first Vercel preview (phase 5).
  - #3 The rate limit lives only in the production HTTP router, and X-Forwarded-For is trusted: accepted while hosting on Vercel; revisit in phase 10.
  - #6 `validateSchema` cold-start latency: measure on the first preview.
  - #8 Tokens appear in URLs and logs: accepted (single use, short expiry, `Referrer-Policy: same-origin`); revisit in phase 10.
  - #9 Admin and guest share an origin: React escaping only, and phase 7 never renders raw CMS HTML; the subdomain option is for phase 10.
  - #11 Live Resend: blocked until the user provisions Resend (phase 5).
  - #13 `FOR UPDATE` through the Neon pooler, and Node 24: check on the first preview and in CI.
  - #15 The `page-scope` flake: monitor.
- **Task 4, finding 1 (plan-mandated):** a revoke racing an accept left an account with no audit row. Fixed with `AND revoked_at IS NULL` plus a regression test, because the spec's "exactly one audit row per staff action" outranks the plan's verbatim code. Its sibling, an IPv6 address with a zone ID failing the `inet` insert, was fixed in the same round.
- **Task 11, finding 1 (plan-mandated):** E2E `getByLabel` calls without `exact`. Folded into the final fix wave, together with the same issue from Task 8.
- **Final review triage:** accepted as given. The final fix wave also took in the create-admin bootstrap bundle and the early `null` for cookie-less requests in `getStaffSession`.
- **Residuals after the final wave:**
  - The guard still accepts `return await <side effect>` in a catch. Phase 10 tightens the catch to `return actionError(<param>)` or `throw <param>`.
  - Ctrl-C at create-admin's password prompt prints the password-length message. Phase 10.
  - The invite form's "created but not sent" alert has no test. Phase 7.

## Deferred findings by owning phase

### Phase 4 — reservations v2
- `actionError` turns `redirect()`, `notFound()` and `forbidden()` into `db_error`. Call `unstable_rethrow(err)` first, before the first phase-4 action.
- X-Forwarded-For parsing is duplicated in the accept-invite action and the DAL. Extract `clientIp(headers)`.
- `/admin/audit`:
  - It pages with OFFSET; switch to keyset paging when `audit_feed` is rewritten.
  - It shows the raw id for the `staff_invitation` entity; resolve the email instead.

### Phase 5 — email, then launch A
Before turning on `EMAIL_DELIVERY=live`:
- `appOrigin()` in `lib/server/email/auth-emails.ts` silently falls back to `http://localhost:3000`. Throw outside log mode, and make a missing `BETTER_AUTH_URL` fail closed.
- `new Resend() as unknown as ResendLike` hides drift in the SDK's types.
- The 60-minute and 7-day defaults in the templates are not tied to the config constants.
- react-email pulls its CLI dependencies (tailwind, esbuild, socket.io) into production dependencies. Measure the bundle (risk 11).
- `staff.ts` `deliverInvite`: a database error after a successful send is reported as an email failure. Split the send from the bookkeeping UPDATE.

Preview setup: preview branches fork the production staff tables. With `redirect` mode, the shared inbox receives reset links for real staff. Decide on this before the first preview (risk 1).

### Phase 7 — editors and media
- Admin-pages guard:
  - also ban `components/**` imports and `next/image` under `app/admin`;
  - scan `.js` and `.jsx` files too.
- Shared form kit:
  - echo submitted values back on failure (InviteForm and AcceptForm currently lose their input while the `db_error` text says the input was kept);
  - test the invite form's "created but not sent" alert.
- The invalid-token state of `ResetForm` needs a link to request a new link.
- In the users table:
  - `td.a-actions` is a flex container, which breaks the cell border;
  - ban and remove errors render under the role column.

### Phase 10 — hardening, then launch B
- **CI guard:** the catch must be exactly `return actionError(<param>)` or `throw <param>`.
- **Tests:**
  - the Task 2 "no email" test uses a 100 ms sleep without comparing response bodies;
  - the Task 2 race bound is 500 ms;
  - no tests for: reset expiry of 3600 s, the 12-character floor on `/reset-password`, bootstrap with an undefined email, a mixed-case bootstrap email;
  - no DAL test for the banned and role-less filters;
  - the E2E "no email" check uses a 500 ms sleep;
  - the email-log reader throws on a partly written line, and its file is never truncated;
  - the admin-audit E2E assumes its row is in the newest 50.
- **signOut:** swallows errors without logging. Log `{ name }` and delete the cookie.
- **`/api/auth/update-user`:** staff can change their own name and image through it with no audit row. Allowlist the HTTP auth paths in `hooks.before`.
- **Accept, then sign-in failure:** if sign-in fails after a successful accept, redirect to sign-in instead of returning `db_error`.
- **Users screen:** a NULL role renders as "Admin". Filter it out or show "—".
- **Audit screen:** the pagination `<nav>` landmark renders empty on a single page.
- **create-admin:** Ctrl-C at the prompt gives a misleading message.
- **Rate limit and X-Forwarded-For when self-hosted:** risk 3.

### Dropped (reasons in the final review)
- Test-only SQL concatenation in the migration-005 test.
- The `minPasswordLength` comment (risk 12).
- Resend guard: its scan scope and side-effect imports.
- Duplicate `lang` on `<Body>`.
- A deadlock in `lockAdmins` is improbable and rolls back cleanly.
- The ban/sign-in race is closed by the DAL's `banned` check.
- The proxy comment about cookie names.
- The csp.test regex (plan-mandated).
- Leftover `mkdtemp` directory.
- Field errors reachable only by tampering.
- `z.email()` does not trim (the browser trims `type="email"`).
- `?trang` past the end of the log.
