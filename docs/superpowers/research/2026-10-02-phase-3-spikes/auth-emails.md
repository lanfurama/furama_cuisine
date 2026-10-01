# Spike p3-email: auth emails (Resend + react-email)

**Topic:** transactional auth emails sent with Resend and react-email, with live/redirect/log delivery, Vietnamese templates, tests, and invite `email_error` handling.

> Lead note: this is the spike's own report. The plan adopts `send.ts`, `auth-emails.ts`, `types.ts` and the templates. It drops `invite-flow.ts`, whose column names were placeholders, because the p3-auth `staff.ts` owns the invitation transaction. It also derives idempotency keys from the token hash rather than the raw token (see `00-plan-outline.md` §0, C6).

## Verified patterns

### Spike result: lib/server/email/
Verified in the clone; the original repo was not touched.

All files live in the clone at `/private/tmp/claude-501/-Users-bcmac-Desktop-projects-Outside-Projects-furama-cuisine/e860bf94-efdc-4015-b5d3-085d89bca850/scratchpad/p3-email/lib/server/email/`. Copy them verbatim into the repo in phase 3.

Files:
- `types.ts`
- `send.ts`
- `auth-emails.ts`
- `invite-flow.ts`
- `templates/{layout,staff-invitation,password-reset}.tsx`
- `email.test.ts` (17 tests)

Everything is verified:
- `vitest`: 17/17 pass.
- `tsc --noEmit`: clean.
- `oxlint`: only pre-existing warnings.
- `next build`: passes with the module imported from a route handler.
- Three real `next start` servers behaved as described below.

### Verified API facts (from the installed packages, not memory)

**react-email@6.11.0**
- It exports the components AND `render`, `plainTextSelectors`, `pretty` and `toPlainText`, all from `'react-email'` itself.
- `@react-email/render@2.1.0` comes in transitively. Do NOT add it, or `@react-email/components`, to package.json. (I uninstalled my explicit add.)
- Node entry: `node_modules/@react-email/render/dist/node/index.d.mts`.
- `render(node, options?) => Promise<string>` is async. `options.plainText: true` plus `htmlToTextOptions` gives plain text.

**Plain-text rendering**
- `render(el, {plainText:true})` upper-cases headings (h1 → "ĐẶT LẠI MẬT KHẨU"). The fix used:
  ```ts
  htmlToTextOptions: { selectors: [{ selector: 'h1', options: { uppercase: false } }, ...plainTextSelectors] }
  ```
- Buttons render in text as "Label URL" and links as a bare URL, so the URL is in the text part.
- Interpolated JSX numbers and strings split text nodes with `<!-- -->` in the HTML (`{7}<!-- --> ngày`). Build each paragraph as one template-string expression, so substring assertions and email clients see contiguous text.

**resend@6.31.0**
- Send call: `new Resend(key).emails.send(payload, { idempotencyKey })`.
  - The idempotency key is the SECOND argument and becomes the `Idempotency-Key` header (`node_modules/resend/dist/index.d.mts:1989`; `IdempotentRequest` at about line 177).
- It returns `{ data, error }` and does not throw on API errors, so we convert `error` into a thrown `EmailSendError('provider_error')`.
- Passing `html` + `text` (not `react`) means Resend never needs `@react-email/render` as an optional peer.
- The `RESEND_BASE_URL` env var overrides the endpoint (`index.mjs:1263`). I used it to verify the real SDK against a fake local HTTP server, which received:
  - `POST /emails`
  - `Authorization: Bearer re_fake`
  - `Idempotency-Key: invite:inv-9:tok_abc`
  - body `{from,to,subject,html,text}`

**Better Auth 1.7.7 `sendResetPassword`**
- Signature (`node_modules/better-auth/node_modules/@better-auth/core/dist/types/init-options.d.mts:720`):
  ```ts
  emailAndPassword.sendResetPassword(data: { user: User; url: string; token: string }, request?: Request) => Promise<void>
  ```
- In `better-auth/dist/api/routes/password.mjs:82` it is invoked via `ctx.context.runInBackgroundOrAwait(...)`. So:
  - it is not awaited on serverless;
  - it is safe against enumeration by timing;
  - our hook must catch and log its own errors.
- Better Auth's `url` is `${baseURL}/reset-password/${token}?callbackURL=...`, its own callback that redirects with `?token=`. We ignore `url` and build `${BETTER_AUTH_URL}/admin/reset-password?token=...` ourselves.
- Better Auth's default reset token TTL is 3600 s, so the template says 60 minutes. If `resetPasswordTokenExpiresIn` changes, pass `expiresInMinutes`.

### Design decisions
1. **`sendEmail({ to, subject, react | (html,text), idempotencyKey? })` → `{ mode, id? }`.** It throws `EmailSendError` with `.code` in `invalid_delivery_mode | missing_api_key | missing_from | missing_redirect_to | provider_error`.
2. **Env is read at SEND time** (`deps.env`, default `process.env`), never at import. Importing and building need no email env. Verified:
   - the build passes with no `RESEND_API_KEY`;
   - the live server answers `RESEND_API_KEY is required when EMAIL_DELIVERY=live` only when a send is attempted.
3. **`EMAIL_DELIVERY` unset or blank = `log`.** An unknown value (a typo) throws instead of falling through to live (fail closed).
4. **The three modes:**
   - `redirect`: sends through Resend to `EMAIL_REDIRECT_TO`, prefixes the subject with `[original@addr]`, and requires the key + `EMAIL_FROM`.
   - `live`: requires `RESEND_API_KEY` + `EMAIL_FROM`.
   - `log`: never touches Resend.
5. **Dependency injection:** `createEmailSender({ env, createResend, logSink })`. The default export is `sendEmail = createEmailSender()`. Tests inject a fake Resend client and an in-memory sink (an array push), so no `vi.mock` is needed.
6. **Log sink (the decision on PII and tokens).** Invite and reset links are bearer tokens.
   - When `VERCEL_ENV === 'production'`, the console line has only `*@domain` plus the idempotency key.
   - Everywhere else it prints the recipient, the subject and the full text (so dev can click through). If `EMAIL_LOG_FILE` is set, it also appends the full message as NDJSON.
   - That file is how Playwright (a separate `next start` process) reads the invite link:
     1. run the server with `EMAIL_LOG_FILE=<tmp>/emails.ndjson`;
     2. poll the file;
     3. parse the last line for `to`;
     4. take the first `/admin/accept-invite?token=` match from `.text`.
   - Verified end to end across the process boundary on `next start`.
7. **Idempotency keys:**
   - invite: `invite:{invitationId}:{token.slice(0,12)}`. Resend mints a new token, so it gets a new key; a retry of the same send dedupes.
   - reset: `reset:{token.slice(0,16)}`.
8. **Links** are built from `BETTER_AUTH_URL` (fallback `NEXT_PUBLIC_SITE_URL`, then `http://localhost:3000`), with the token `encodeURIComponent`-ed. The raw token is only in the email and the URL; the DB stores the SHA-256 hash.
9. **`import 'server-only'`** is in `send.ts`, `auth-emails.ts` and `invite-flow.ts` (the vitest alias already stubs it). Templates and types are server-agnostic.

### Core code
`send.ts`, abridged to the load-bearing part; the full file is in the clone.
```ts
export function createEmailSender(overrides: Partial<EmailDeps> = {}) {
  return async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
    const deps = { ...defaultDeps(), ...overrides };           // env read here, at send time
    const mode = resolveMode(deps.env.EMAIL_DELIVERY);          // unset => 'log'; typo => throw
    const { html, text } = input.react ? await renderEmail(input.react) : { html: input.html, text: input.text };
    let to = input.to, subject = input.subject;
    if (mode === 'redirect') {
      const target = deps.env.EMAIL_REDIRECT_TO?.trim();
      if (!target) throw new EmailSendError('missing_redirect_to', 'EMAIL_REDIRECT_TO is required when EMAIL_DELIVERY=redirect');
      to = target; subject = `[${input.to}] ${input.subject}`;
    }
    const delivered = { mode, to, originalTo: input.to, subject, html, text, idempotencyKey: input.idempotencyKey };
    if (mode === 'log') { await deps.logSink(delivered); return { mode }; }
    const apiKey = deps.env.RESEND_API_KEY?.trim();
    if (!apiKey) throw new EmailSendError('missing_api_key', `RESEND_API_KEY is required when EMAIL_DELIVERY=${mode}`);
    const from = deps.env.EMAIL_FROM?.trim();
    if (!from) throw new EmailSendError('missing_from', `EMAIL_FROM is required when EMAIL_DELIVERY=${mode}`);
    let result;
    try {
      result = await deps.createResend(apiKey).emails.send({ from, to, subject, html, text },
        input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : undefined);
    } catch (cause) { throw new EmailSendError('provider_error', `Resend request failed: ${String((cause as Error)?.message ?? cause)}`, { cause }); }
    if (result.error || !result.data) throw new EmailSendError('provider_error', `Resend rejected the email: ${result.error?.message ?? 'no id returned'}`);
    return { mode, id: result.data.id };
  };
}
export const sendEmail = createEmailSender();
```
`renderEmail(el)` = `Promise.all([render(el), render(el, { plainText: true, htmlToTextOptions: { selectors: [{ selector: 'h1', options: { uppercase: false } }, ...plainTextSelectors] } })])`.

### Templates
Common to both: Vietnamese, brand colour `#7a1f2b`, inline styles, `<Html lang="vi">` and `<Body lang="vi">`.

**Invite**
- Subject: `Lời mời tham gia quản trị Furama Cuisine`.
- Body:
  - a heading;
  - "{inviter} đã mời bạn vào khu vực quản trị Furama Cuisine với vai trò **Biên tập viên|Quản trị viên**";
  - the button "Chấp nhận lời mời";
  - a fallback link;
  - "Liên kết có hiệu lực trong 7 ngày và chỉ dùng được một lần...".
- Props: `{ acceptUrl, role: 'admin'|'editor', inviterName, expiresInDays=7 }`.

**Reset**
- Subject: `Đặt lại mật khẩu quản trị Furama Cuisine`.
- Props: `{ resetUrl, userName?, expiresInMinutes=60 }`.

The real rendered plain text of the invite, from the live server log:
```
Furama Cuisine

Bạn được mời tham gia quản trị Furama Cuisine

Lê Thị An đã mời bạn vào khu vực quản trị Furama Cuisine với vai trò Biên tập viên.

Chấp nhận lời mời http://localhost:3230/admin/accept-invite?token=tok_abc

Nếu nút không hoạt động, hãy mở liên kết này: http://localhost:3230/admin/accept-invite?token=tok_abc

Liên kết có hiệu lực trong 7 ngày và chỉ dùng được một lần. Nếu bạn không mong đợi lời mời này, hãy bỏ qua email.
```

**Hook wiring for phase 3** (`lib/auth.ts`):
```ts
emailAndPassword: {
  enabled: true,
  disableSignUp: true,
  sendResetPassword: async ({ user, token }) => {
    try {
      await sendPasswordReset({ user, token })
    } catch (e) {
      console.error('[auth] reset email failed', e instanceof EmailSendError ? e.code : 'unknown')
    }
  },
}
```
Do not rethrow. The hook runs in the background, and a throw must not reveal whether the account exists.

### Item 4: the invite Server Action and email_error
Implemented in `invite-flow.ts` and tested.

Order: `requirePermission('staff.invite')` → zod → `createInvitation()`:
1. **Transaction.** `BEGIN`; `INSERT staff_invitation` (email lower-cased, role, `token_hash=sha256(token)`, `expires_at=now+7d`, `invited_by`) `RETURNING id`; `INSERT audit_log`; `COMMIT`. The raw 32-byte `base64url` token is never stored.
2. **Send after the commit.** Only AFTER the commit, call `sendStaffInvitation`. Never hold a DB transaction across a network call.
3. **Record the outcome.**
   - On success: `UPDATE staff_invitation SET email_error = NULL WHERE id=$1`. This also clears a previous failure on resend.
   - On any thrown error (including `missing_api_key` and `provider_error`):
     - there is NO rollback;
     - run `UPDATE staff_invitation SET email_error = $2 WHERE id=$1` with `describeEmailError(e)`. That is `"<code>: <message>"` truncated to 300 chars, with no token, so it is safe to show an Admin;
     - return `{ invitationId, emailSent: false, emailError }`, so the UI shows "Chưa gửi được email, bấm Gửi lại".
   - The action itself never throws because of email.
4. **"Gửi lại" (resend)** uses the same Server Action pattern: a new token, overwrite `token_hash` + `expires_at` (the old token is dead), an audit row, then `deliverInvitation({ token: newToken, ... })`.

The module takes a `Queryable` (a `pg` client or pool satisfies it), so it is unit-testable. In the real action, pass a dedicated `pool.connect()` client for the transaction, and use the pool (or the same client after release) for the email_error UPDATE.

### Tests
`lib/server/email/email.test.ts`: 17 tests, all pass with `TZ=UTC npx vitest run lib/server/email`.

**Templates**
- The invite html and text contain the link, 'Biên tập viên', the inviter name, '7 ngày', `lang="vi"` and 'Chấp nhận lời mời', and the text has no `<`.
- The reset html and text contain the link and 'Đặt lại mật khẩu', and the text has 'Xin chào Lan'.
- The link builders encode tokens.

**Delivery**
- Log by default:
  - never calls `createResend`;
  - the sink receives the rendered text with `/admin/accept-invite?token=tok` and the idempotency key.
- An unknown mode is rejected.
- Redirect:
  - rewrites `to`, prefixes the subject, and calls the fake Resend with `{ idempotencyKey }` as the second argument;
  - without a target, it throws.
- Live:
  - calls Resend with the real recipient and `createResend('re_key')`;
  - without a key, it throws `RESEND_API_KEY is required when EMAIL_DELIVERY=live`. This uses the DEFAULT `sendEmail` with `process.env` swapped, which proves env is read at send time, since the import already succeeded;
  - without EMAIL_FROM, it throws.
- Resend's `{error}` and thrown network errors both become `provider_error`.
- The reset email ignores Better Auth's url and links to `/admin/reset-password?token=tok123` with the key `reset:tok123`.

**Invite flow** (fake db)
- The statement order is `BEGIN, INSERT, INSERT, COMMIT, SEND, UPDATE`.
- The email is lower-cased, and `token_hash` is 64 hex.
- A failing Resend → no ROLLBACK, and `email_error` = `provider_error: Resend rejected the email: rate limited`.
- A missing key is recorded, not thrown.
- The resend path clears email_error.

### Integration verification
Run in the clone against the local DB `p3email_test` on ports 3230–3232. All servers were stopped and the DB dropped afterwards.

Setup: a temporary route `app/api/email-probe` (since removed), then `next build` (passed, with the route listed as `ƒ`), then three `next start` servers:
- **(a) default log + `EMAIL_LOG_FILE`:** the probe returned `{"ok":true,"r":{"mode":"log"}}`, and the NDJSON had the link for both invite and reset.
- **(b) `EMAIL_DELIVERY=redirect EMAIL_REDIRECT_TO=qa@furama.test RESEND_API_KEY=re_fake RESEND_BASE_URL=http://localhost:3251`:** the fake Resend received the exact payload above, with `to: qa@furama.test` and the subject `[new.staff@furama.test] Lời mời ...`.
- **(c) `EMAIL_DELIVERY=live` without a key:** HTTP 500 JSON `RESEND_API_KEY is required when EMAIL_DELIVERY=live`. The server started fine, so there is no build-time or boot-time failure.

### Env vars to document (.env.example / README)
- `EMAIL_DELIVERY`: live, redirect or log; default log.
- `EMAIL_REDIRECT_TO`
- `EMAIL_FROM`, e.g. `Furama Cuisine <no-reply@mail.furamavietnam.com>`.
- `RESEND_API_KEY`
- `EMAIL_LOG_FILE`: test and dev only.
- `BETTER_AUTH_URL`: used for links.

## Errors hit

1. **`sed -i "1i import 'server-only';"` fails on macOS (extra characters at the end of l command)**
   - Cause: BSD sed does not support the GNU one-line `1i text`.
   - Fix: prepend with `printf ... | cat - file > tmp && mv tmp file`, or use python or Edit.
2. **Test: expected html to contain '7 ngày' (received `...trong <!-- -->7<!-- --> ngày...`)**
   - Cause: React SSR inserts `<!-- -->` between adjacent text nodes when JSX mixes literal text and `{expr}`.
   - Fix: render each interpolated paragraph as one template-literal expression, `` {`...${x}...`} ``.
3. **The plain-text heading rendered as 'ĐẶT LẠI MẬT KHẨU'; the test expected 'Đặt lại mật khẩu'**
   - Cause: the html-to-text default selector uppercases h1–h6.
   - Fix: pass `htmlToTextOptions.selectors` with h1 `uppercase:false` before `...plainTextSelectors` (exported by react-email). The tests call the same `renderEmail` helper.
4. **The first combined shell command (reset-db + export env + `npm run build`) exceeded the 120 s tool timeout and was backgrounded; the build never ran and the fake server file was never written**
   - Cause: a `cat > $TMPDIR/fake.mjs` with an empty TMPDIR aborted the heredoc chain, and the long build ran in the foreground.
   - Fix: write the helper file with a plain heredoc, run the build with `( ... ; echo EXIT $? >> build.log ) &` in the background, and watch build.log.
5. **oxlint no-useless-concat warning in a test (`'Live ' + 'x'`)**
   - Cause: string-literal concatenation.
   - Fix: a single literal, `'Live x'`.

## Package versions

- resend@6.31.0 (npm view latest on 2026-10-01; Node >=20)
- react-email@6.11.0 (exports the components + render + plainTextSelectors; depends on @react-email/render@2.1.0, which is not added directly)
- better-auth@1.7.7 (installed in the clone to inspect the sendResetPassword signature; package.json range ^1.7.7)
- @better-auth/core@1.7.7 (nested under better-auth)
- react 19.3, next 16.3.7, vitest 5.0.3 and typescript 7.0.2 unchanged
- package.json additions in the clone: better-auth ^1.7.7, react-email ^6.11.0, resend ^6.31.0 (dependencies). Do NOT add @react-email/components (deprecated) or @react-email/render.

## Recommended task breakdown

**Task A: the email module.** Small, with no auth dependency.
- Copy `lib/server/email/*` from the spike clone.
- Run `npm i resend@^6.31.0 react-email@^6.11.0`.
- Add the 5 env vars to `.env.example` and the README.
- Run the 17 tests.
- Add a CI/lint guard that nothing outside `lib/server/email` imports `resend` directly.

**Task B: auth wiring.** The `sendResetPassword` hook in `lib/auth.ts` calls `sendPasswordReset`, and it swallows and logs errors, because it runs in the background.

**Task C: the staff screen and the invite actions.**
- Server Actions `inviteStaff` and `resendInvitation`, using `createInvitation`/`deliverInvitation` inside the real DAL:
  - a `pool.connect` client for the transaction;
  - `requirePermission` first;
  - the audit row in the same transaction.
- The UI shows "Chưa gửi được email, bấm Gửi lại" when `emailSent` is false or `staff_invitation.email_error IS NOT NULL`.

**Task D: E2E.**
- The Playwright config starts the server with EMAIL_DELIVERY unset and EMAIL_LOG_FILE pointing at a per-run temp file.
- A helper, `readLastInviteLink(email)`, polls the NDJSON.
- The spec covers:
  - invite → accept → sign in;
  - resend invalidates the old token;
  - a forced email failure records email_error while the invitation still exists. Force it with EMAIL_DELIVERY=live and no RESEND_API_KEY, either in a second webServer or through a test-only env flip.

## Risks and open questions

- **Placeholder column names.** The spike's `invite-flow.ts` uses placeholder column names for audit_log (`actor_id`, `action`, `entity`, `entity_id`, `diff`) and for staff_invitation. Phase 3's migration is authoritative, so adapt the SQL. The spike has no staff tables, and its DB access is faked in tests.
- **Failed reset emails only reach the logs.** `sendResetPassword` runs via `runInBackgroundOrAwait`, so on Vercel it may run after the response (waitUntil).
  - A thrown error there is invisible to the user, so the hook must catch and log.
  - There is no email_error column for resets, so a failed reset email shows up only in the logs.
  - This is acceptable per the spec (reset emails go straight through Resend, not the outbox), but worth stating.
- **The reset template says 60 minutes.** That matches Better Auth's default `resetPasswordTokenExpiresIn=3600`; keep them in sync if the config changes.
- **The log sink prints full links outside `VERCEL_ENV=production`.**
  - A self-hosted production (no VERCEL_ENV) running `EMAIL_DELIVERY=log` would log bearer tokens and honour EMAIL_LOG_FILE.
  - The spec deploys on Vercel, so the risk is low.
  - Consider also redacting when `NODE_ENV=production` AND EMAIL_LOG_FILE is unset. (E2E uses `next start`, which is NODE_ENV=production, hence the VERCEL_ENV gate.)
- **Redirect mode sends real mail.** It goes through Resend to EMAIL_REDIRECT_TO, so it needs a verified domain and API key in Preview. The Resend free tier (100/day) is shared with production if one key is used, so prefer separate keys per environment.
- **Resend domain verification is untested.** DNS at Furama's host is outside the spike. Live mode was only exercised against a fake HTTP server (RESEND_BASE_URL), never against api.resend.com.
- **react-email pulls a large dependency tree** (prettier, html-to-text, etc.). It was verified to bundle and run in a Node route handler under `next build` with Cache Components, but the bundle size of the serverless function was not measured.
- **Cosmetic plain-text quirks.** A 'Button' renders in plain text as 'Label URL' on one line, which is fine. The brand line 'Furama Cuisine' and a '----' rule also appear in the text.

## Spec deviations

- **EMAIL_LOG_FILE (addition).** Spec §10.4 says log mode is for CI and dev, with no detail on content. We add `EMAIL_LOG_FILE` (NDJSON, outside production deployments only) so E2E can read links out of the server process. This is an addition, not a contradiction.
- **Better Auth's reset `url` is not used.** The `url` argument to `sendResetPassword` is deliberately ignored; the email links to `/admin/reset-password?token=...` (the spec §7.2 screen), built from `token` and BETTER_AUTH_URL.
- **Invalid EMAIL_DELIVERY values throw.** The spec only defines three values and "default log when unset"; throwing on anything else fails closed.
- **Redirect mode prefixes the subject** with the original recipient in brackets, so reviewers can see who the mail was meant for.
