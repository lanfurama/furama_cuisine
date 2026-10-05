# Phase 7 spike: media library, Vercel Blob uploads, sweep, CmsImage, the move to Blob and the film embed

> Spike report, key `media-blob` (clone `p7-media`, DB tag `p7med`, ports 3230 E2E, 3231 visual, 3236 fake Blob). Topic: media library + Vercel Blob uploads (presigned), `registerMedia`, delete-while-used refusal, media-sweep cron, CmsImage for Blob (R3 measured), move-/assets-to-Blob script, film embed — all tested against a local fake Blob server. No real Blob service was ever called.
>
> Where this report and `00-plan-outline.md` disagree, **the outline wins** (its §0 lists every conflict). In particular, the outline:
> - removes the guest `CmsImage` from the admin library page: under the admin CSP, `<Image>` injects `style="color:transparent"` (the `form-kit-history` spike measured 560 violations; this spike's E2E did not run `watchCsp`). Admin thumbnails use the kit's `getImageProps` + `<img>` component, and the admin-media E2E adds `watchCsp`;
> - keeps the film part on `/admin/content/hero` (spec §7.2) but builds it inside the kit's hero screen, sharing one `sections` save and token with the sections screen;
> - nav: one "Thư viện" item for `/admin/media` beside "Nội dung";
> - plans **no** baseline re-take: this spike measured that the R3 conversion passes the configured gate (8/8 at `maxDiffPixelRatio: 0`, Playwright's default per-pixel `threshold` 0.2, `node_modules/playwright-core/lib/coreBundle.js:7897`) once `visual-nojs.spec.ts` waits for images;
> - wires the fake Blob server into `playwright.config.ts` (a second `webServer`) so the gate needs no manual step.

## Where everything is
- Clone (all work, nothing committed): `/private/tmp/claude-501/-Users-bcmac-Desktop-projects-Outside-Projects-furama-cuisine/e860bf94-efdc-4015-b5d3-085d89bca850/scratchpad/p7-media` (HEAD c896b13, branch main). The original repo was not touched: `git status` there is still clean at c896b13.
- **The full working diff, new files included (58 files, +3310/−50):** `/private/tmp/claude-501/-Users-bcmac-Desktop-projects-Outside-Projects-furama-cuisine/e860bf94-efdc-4015-b5d3-085d89bca850/scratchpad/p7med-logs/p7-media-full.patch`. Apply it with `git apply` on c896b13.
- The same diff without the R3 image conversion and the later test and package edits: `.../scratchpad/p7med-logs/spike-core.patch`.
- Logs (all in `.../scratchpad/p7med-logs/`):
  - unit: `unit-baseline.txt`, `unit-final.txt`
  - build: `build-3.txt`, `build-r3.txt`
  - E2E: `e2e-full-2.txt` (core), `e2e-full-r3c.txt` (with R3)
  - visual: `visual-1.txt`, `visual-r3*.txt`
  - lint: `lint-final.txt`

## Gate results (my DBs `furama_cuisine_*_p7med_test`, ports 3230 for E2E, 3231 for visual, 3236 for the fake; all stopped and dropped afterwards)

| Gate | Baseline c896b13 | Spike (core) | Spike + R3 |
|---|---|---|---|
| typecheck | clean | clean | clean |
| lint | exit 0, 19 warnings | exit 0, 19 warnings | exit 0, **14** warnings (5 `no-img-element` gone) |
| unit + integration | 83 files, 1039 tests | — | **89 files, 1079 tests**, all pass |
| build + `check-prerender` | — | pass (new uncached routes listed) | pass |
| DOM diff vs a c896b13 build | — | **0 lines** on /en, /en/restaurants/taya-house, /en/privacy | /en 12 lines (5 `<img>` → next/image), taya 2 lines, privacy 0 |
| E2E full, `--retries=0`, EXTENDED prefix + fake Blob | — | 172 passed, 1 skipped | 172 passed, 1 skipped (the 4th run; see the flakes under errors) |
| visual | — | **8/8** at `maxDiffPixelRatio: 0` | cold image cache: 6/8; warm: 8/8 twice |

The 172 includes my 4 new tests.

## @vercel/blob 2.8.0: what is really in the package (latest on npm 2026-10-05; client API in `dist/client.js`, server in `dist/index.js` and `dist/chunk-YYMLUMXS.js`)

**The spec's API exists.** `uploadPresigned` (client) and `handleUploadPresigned` (server) are both exported from `@vercel/blob/client`. The older `upload`/`handleUpload` (HMAC client token) also exists.

How the presigned flow works:
- The browser POSTs `{type:'blob.generate-presigned-url', payload:{pathname, multipart, clientPayload}}` to `handleUploadUrl`.
- The server's `getSignedToken` must return an `IssuedSignedToken`. We get it from `issueSignedToken({pathname, operations:['put'], validUntil, maximumSizeInBytes, allowedContentTypes})`. That is a network call (`POST {api}/signed-token`, bearer = read-write or OIDC; chunk ~1810).
- `presign()` then HMACs a canonical string with `clientSigningToken` (canonicalString, chunk ~2032).
- The browser PUTs to `{api}/?pathname=…&vercel-blob-delegation=…&vercel-blob-signature=…`. That request carries no bearer token.

**handleUploadPresigned throws `Missing webhook public key`** (client.js:316-320) unless `webhookPublicKey` or `BLOB_WEBHOOK_PUBLIC_KEY` is set. It does so even for URL issuance, and the key is only used to verify the Ed25519 upload-completed callback.

**onUploadCompleted:**
- The callback URL comes from `VERCEL_BLOB_CALLBACK_URL`, else `VERCEL_BRANCH_URL`/`VERCEL_URL` (preview) or `VERCEL_PROJECT_PRODUCTION_URL` (client.js:495-524).
- It never reaches localhost or a preview behind Deployment Protection.
- It arrives without a session.

**Pointing the SDK at a fake:**
- `VERCEL_BLOB_API_URL` / `NEXT_PUBLIC_VERCEL_BLOB_API_URL` replace the default `https://vercel.com/api/blob` (chunk:110, 257-264) for every control-plane call: put, head (`GET ?url=`), list (`GET ?prefix=`), del (`POST /delete`), signed-token, mpu.
- Nothing overrides the public file host. `get()` fetches `https://<store>.public.blob.vercel-storage.com/...` directly and refuses other hosts (index.js:99-155).
- `VERCEL_BLOB_RETRIES` defaults to 10; set it to 0 in tests.

**Credential resolution (chunk:161-206):** the `token` option, then OIDC, then `BLOB_READ_WRITE_TOKEN`.
- With no `VERCEL_OIDC_TOKEN`, `@vercel/oidc` *refreshes* one (`node_modules/@vercel/oidc/dist/token.js` refreshToken 27-62). It reads `.vercel/project.json`, then the Vercel CLI's login or keyring, and calls the Vercel API.
- So on a linked dev checkout, a local SDK call without explicit credentials reaches Vercel.
- Our gateway therefore always passes credentials explicitly: the read-write token, or `{storeId}` only when `VERCEL=1`. Otherwise it reports "not configured" and makes no call. I deleted the clone's `.vercel/` for safety.

**Upload progress:** with `onUploadProgress`, the SDK sends a streamed request body (fetch + ReadableStream, duplex half) when the browser supports it (chunk:404-441, 518-541). Chromium streams uploads only over HTTP/2 or QUIC, and Playwright interception drops a streamed body. The uploader therefore does **not** pass `onUploadProgress`.

## Next 16.3.7 facts used
- `experimental.serverActions.bodySizeLimit: '2mb'`: `docs/01-app/03-api-reference/05-config/01-next-config-js/serverActions.md:59-75`.
- `images.remotePatterns` (wildcards: `*` is one label): `docs/01-app/03-api-reference/02-components/image.md:533-611`.
- `getImageProps` for art direction (the hero's `<picture>`): image.md:1009-1033 and 1329-1359.
- `preload` replaces the deprecated `priority`: image.md:265-293.
- The optimizer DNS-resolves a remote host and refuses private IPs. If the lookup fails, it falls back to the hostname and continues (`node_modules/next/dist/server/image-optimizer.js:935-960`). `dangerouslyAllowLocalIP` is image.md:896-920.

## Design decisions in the code
1. **Two-step upload (spec §11).**
   - The browser builds the path `<env>/media/<uuid>/<slug>.<ext>` and calls `uploadPresigned(path, file, {access:'public', handleUploadUrl:'/api/admin/media/upload', contentType})`.
   - The route grants a presigned URL scoped to that pathname, the type implied by the extension, 15 MB and 10 minutes. The Blob API enforces all four.
   - The client then calls the `registerMedia({pathname})` Server Action. The server trusts only the pathname:
     - `head()` gives existence, size and URL;
     - it downloads the bytes (host must be `*.public.blob.vercel-storage.com`, capped at 15 MB);
     - sharp checks the real type and measures the displayed width and height (EXIF orientation applied);
     - sharp makes a ≤16 px WebP blur;
     - it upserts by pathname with an audit row (create, or update on retry).
   - A file whose content does not match its name is deleted from the store at once.
2. **Environment folders.** `blobEnvPrefix`:
   - `production`;
   - `preview/<git-branch-slug>` (each preview branch has its own Neon branch);
   - `development` for local runs and tests.
   The sweep lists only `<prefix>/`, so the "own environment's store" rule holds even inside the shared Preview/Dev store.
3. **Delete is soft (`deleted_at`), as 008 designed.**
   - In one transaction: `SELECT … FOR UPDATE`, then the usage query; if anything uses the file, refuse with `{code:'in_use', uses:[{label, href}]}`; otherwise soft delete, audit (before = row + i18n), and redirect to `/admin/media?deleted=1`.
   - Every content save that points a row at a file must call `assertLiveMedia(client, ids, kind)`. It takes `FOR KEY SHARE`, which serialises with the delete. A two-connection test proves this, and a mutation run without the lock fails it.
   - The usage query lists all 12 FK columns explicitly (`MEDIA_REFERENCES`). An integration test compares that list with `pg_constraint` and checks every FK is RESTRICT.
4. **media-sweep (`/api/cron/media-sweep`, daily `35 18 * * *` UTC = 01:35 Da Nang, `maxDuration` 300, CRON_SECRET or 401, `?dry=1`):**
   - (a) purges rows 30 days in the trash. A RESTRICT violation is SQLSTATE **23001** (not 23503) and the row is kept;
   - (b) deletes blobs under `<prefix>/` that no media row (live or trashed) names and that are older than 24 hours;
   - a DB error aborts the run before any delete;
   - with no Blob configured it answers `{skipped}`.
5. **Admin CSP.** `connect-src 'self' https://vercel.com/api/blob/`, or `NEXT_PUBLIC_VERCEL_BLOB_API_URL` + `/`. `img-src` is unchanged: thumbnails and previews go through `/_next/image` ('self').
6. **next.config.**
   - `images.remotePatterns: [{protocol:'https', hostname: <storeId>.public.blob.vercel-storage.com, or *.public.blob.vercel-storage.com when no token at build, port:'', pathname:'/**', search:''}]`;
   - `experimental.serverActions.bodySizeLimit: '2mb'`.
7. **CmsImage.** `blur` is an optional key added by `mediaJson` only when `blur_data_url` is set, so static rows keep the exact phase-6 shape. It gives `placeholder="blur"`. `cmsPictureProps()` (getImageProps) draws the hero's art-directed `<picture>`.
8. **Film (spec §5.2).** `parseFilmUrl` accepts YouTube watch, youtu.be, embed, shorts and live links, and vimeo.com / player.vimeo.com with an unlisted hash.
   - It returns `https://www.youtube-nocookie.com/embed/<id>?autoplay=1&rel=0` or `https://player.vimeo.com/video/<id>?autoplay=1&dnt=1[&h=]`.
   - `FilmModal` renders a sandboxed iframe over the poster, else "COMING SOON".
   - The editor at `/admin/content/hero` (film part: on/off, poster from the library, link) refuses a link that names no video. It saves through the token-checked transaction, audits `sections:film`, and expires `tagsForSave(['sections'])`.

## Key file: app/api/admin/media/upload/route.ts (verbatim body)
```ts
const Body = z.object({ type: z.literal('blob.generate-presigned-url'), payload: z.object({ pathname: z.string().max(300), multipart: z.literal(false), clientPayload: z.string().max(200).nullable() }) });
export async function POST(request: Request): Promise<Response> {
  try {
    await requirePermission({ content: ['update'] });
  } catch (err) {
    return err instanceof PermissionError ? fail(err.code === 'unauthenticated' ? 401 : 403, err.code) : fail(500, 'server_error');
  }
  if (request.headers.get('origin') !== new URL(request.url).origin) return fail(403, 'bad_origin');
  let body: z.infer<typeof Body>;
  try { body = Body.parse(await request.json()); } catch { return fail(400, 'invalid'); }
  const contentType = parseUploadPathname(envPrefix(), body.payload.pathname);
  if (!contentType) return fail(400, 'invalid_pathname');
  try {
    const result = await handleUploadPresigned({
      body, request,
      webhookPublicKey: process.env.BLOB_WEBHOOK_PUBLIC_KEY || NO_CALLBACK_KEY, // only used for the callback, which this route never accepts
      getSignedToken: async (pathname) => ({ token: await issueUploadToken(pathname, contentType) }),
    });
    return Response.json(result, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof BlobNotConfiguredError) return fail(503, 'blob_not_configured');
    console.error('[admin] media upload token failed', { name: err instanceof Error ? err.constructor.name : typeof err });
    return fail(502, 'blob_error');
  }
}
```

## Key file: lib/server/media/blob.ts (credentials and the upload token)
```ts
export function blobCredentials(env: Record<string, string | undefined> = process.env): { token: string } | { storeId: string } {
  const token = env.BLOB_READ_WRITE_TOKEN?.trim(); if (token) return { token };
  const storeId = env.BLOB_STORE_ID?.trim(); if (storeId && env.VERCEL === '1') return { storeId };
  throw new BlobNotConfiguredError();
}
export async function issueUploadToken(pathname: string, contentType: MediaContentType) {
  return issueSignedToken({ ...blobCredentials(), pathname, operations: ['put'], validUntil: Date.now() + UPLOAD_URL_TTL_MS, maximumSizeInBytes: MAX_UPLOAD_BYTES, allowedContentTypes: [contentType] });
}
// headBlob (BlobNotFoundError → null), listBlobs (async generator, 1000 a page), deleteBlobs, downloadBlob(url) (host check, 20 s timeout, 15 MB cap)
```

## Key file: lib/media/rules.ts (shared by client and server)
- `MEDIA_TYPES` jpeg/png/webp/avif/pdf → jpg/png/webp/avif/pdf.
- `MAX_UPLOAD_BYTES = 15728640` and `UPLOAD_URL_TTL_MS = 10 min`.
- `blobEnvPrefix(env)`, `slugify` (strips Vietnamese diacritics and đ).
- `uploadPathname(prefix, uuid, fileName, type)` → `${prefix}/media/${uuid}/${slug||'file'}.${ext}`.
- `parseUploadPathname(prefix, path)` uses a strict regex (UUID v4, kebab slug, the five extensions, prefix escaped) and returns the type or null.
- `movedAssetPathname(prefix, '/assets/x.jpg')` → `${prefix}/assets/x.jpg`.

## Test infrastructure (no real service is ever called)
**`test/helpers/fake-blob.ts`** (erasable TypeScript, so Node runs it directly):
- An HTTP fake of the control-plane API under `/api/blob` and the public host under `/cdn/<path>`.
- It issues delegation tokens HMACed with its own secret and re-derives the client signing key.
- It verifies the canonical-string signature exactly as the SDK builds it.
- It enforces the token's pathname scope, expiry, `allowedContentTypes` (`x-content-type`), maximum size and no-overwrite.
- It records every request with method, path, query, auth kind and status.
- Test hooks: `/__fake/health|requests|files|age`. Its CLI is `test/helpers/fake-blob-cli.mjs` (`FAKE_BLOB_PORT`, `FAKE_BLOB_SECRET`).

**`test/helpers/blob-redirect.mjs`**, loaded with `--import` or `installBlobRedirect(origin)`:
- An undici global dispatcher (`new Agent().compose(...)`) that rewrites `https://vercel.com/api/blob*` → fake and `https://*.public.blob.vercel-storage.com/p` → `fake/cdn/p`. It **refuses every other non-local host** and records them in `refused`.
- It stubs `dns.lookup` / `dns.promises.lookup` to ENOTFOUND for these hosts, so the next/image optimizer makes no outside DNS query.
- Node's fetch, the SDK's undici and next/image all use the same global dispatcher (`Symbol.for('undici.globalDispatcher.1')`).

**E2E server environment** (the EXTENDED prefix plus):
```
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_fakestore_<secret>
VERCEL_BLOB_RETRIES=0
FAKE_BLOB_ORIGIN=http://127.0.0.1:3236
NODE_OPTIONS=--import=<repo>/test/helpers/blob-redirect.mjs
BLOB_STORE_ID=
VERCEL_BLOB_API_URL=
NEXT_PUBLIC_VERCEL_BLOB_API_URL=
```
- Start the fake first: `FAKE_BLOB_PORT=3236 FAKE_BLOB_SECRET=… node test/helpers/fake-blob-cli.mjs`.
- In the browser, Playwright `context.route` forwards vercel.com/api/blob and *.blob.vercel-storage.com to the fake with `route.fetch`, and aborts all other external hosts. Playwright answers intercepted CORS preflights itself.
- The production admin CSP is exercised unchanged: the browser PUTs to https://vercel.com/api/blob/.
- The full E2E run logged no "refused" line, and the fake recorded 52 requests.

## New tests (all pass)

| File | Tests | What it proves |
|---|---|---|
| `lib/media/media.test.ts` | 8 | env prefix, path build and parse, film URL parser |
| `lib/server/media/measure.test.ts` | 5 | real asset 456×378 with a 16×13 blur; png/webp/avif, each only as itself; EXIF orientation 6 swaps width and height; PDF signature; truncated, garbage, empty or over-cap files refused |
| `test/integration/media-library.test.ts` | 12 | references vs `pg_constraint` (all RESTRICT); register upsert, audit and wire log; wrong type refused and blob deleted; foreign path or missing blob refused with no request; in-use delete refused with the list; soft delete, audit snapshot, `assertLiveMedia`; delete-vs-save lock race; alt editor plus token conflict; sweep own folder only (dry run, 24 h grace, other env untouched), 30-day trash purge (RESTRICT row kept), bad prefix refused |
| `test/integration/media-upload.test.ts` | 4 | the real SDK `uploadPresigned` → real route → fake: the PUT carries only delegation and signature; the store refuses a wrong type, more than 15 MB, or an overwrite; a URL signed for path A fails for path B (403); 401, 403 and bad-origin answers, foreign or bad paths, and the callback event refused with no store request |
| `test/integration/move-assets.test.ts` | 4 | the script as a child process: dry run changes nothing; `--apply` uploads 39 files byte for byte, repoints the same ids with blur and audit rows, and `loadSections` returns the Blob URL with `blur`; a second `--apply` sends nothing |
| `test/integration/cron-media-sweep.test.ts` | 4 | 401; skipped when not configured; dry run vs real run under `VERCEL_ENV=production`; `maxDuration` |
| `require-permission` guard | — | adds `CONTENT_ACTIONS`: registerMedia, saveMediaDetails, deleteMedia, saveFilm = `content:update`, Editor allowed |
| `e2e/admin-media.serial.spec.ts` | 4 | Editor upload through the nav → in the library (thumbnail via `/_next/image?url=https%3A%2F%2Ffakestore…`) → EN alt → delete → redirect with notice, the blob kept (soft delete); disguised file refused and removed, `.gif` refused on the client; chef.jpg delete refused with a "Section experiences" link; film: bad link refused, a YouTube link gives a youtube-nocookie iframe in the guest dialog, then put back (R21) |

## R3 / visual baseline measurement (all content images through next/image)
- I converted Hero (both slides), Experiences, Heritage (no `fill`, so the parallax CSS keeps working), RestaurantHero and the FilmModal poster.
- DOM diff: /en 12 lines (5 images), taya 2 lines.
- **Visual:**
  - The first run with a cold image cache failed 2 of 8 no-JS home shots: desktop 89,565 px (ratio 0.02); phone ratios 0.02–0.07. Lazy story images were still loading during the full-page no-JS capture.
  - Two reruns with a warm cache: **8/8 at maxDiffPixelRatio 0**.
- Raw pixel comparison with no threshold, R3 vs baseline (no-JS home):
  - desktop: 924,848 px differ, max channel delta 29/255, all in the chef and heritage images;
  - phone: 284,258 px differ, max delta 31.
  - Every difference is below Playwright's default per-pixel threshold of 0.2, so the configured gate passes **without re-taking the baselines**.
- Moving the files to Blob does not touch the baselines. Visual and E2E run on the locally seeded static rows and never see Blob URLs.
- One E2E needed an update: `restaurant-pages.serial` now matches `src=/^\/_next\/image\?url=%2Fassets%2Fr-the-fan\.jpg&/` instead of the raw `/assets/r-the-fan.jpg`.

## move-assets-to-blob script (`scripts/move-assets-to-blob.mjs`)
- Run: `DATABASE_URL=… BLOB_READ_WRITE_TOKEN=… node scripts/move-assets-to-blob.mjs --prefix production [--apply]`.
- `--prefix` must be `production`, `development` or `preview/<slug>`. It is a dry run by default.
- It checks each file's byte count against its row, and skips a file already in the store with the same size (`head`).
- It uploads with `put(token, access:'public', addRandomSuffix:false, allowOverwrite:false)`.
- It updates all rows in one transaction, only where `storage='static'` and the pathname still matches, and writes an audit row per file (`actor_email 'script:move-assets-to-blob'`).
- Sample dry run: `DRY RUN: database localhost/… → store fakestore, folder production/` … `39 static row(s); 39 file(s) to upload.`

## Errors hit, and their fixes

| # | Error | Cause | Fix |
|---|---|---|---|
| 1 | The `cp -cR` landed the source inside an existing `scratchpad/p7-media` (left from an earlier run that had already installed @vercel/blob 2.8.0), as `p7-media/furama_cuisine`, including its `.env.local` | The target directory already existed, so cp copied into it | Deleted the nested `furama_cuisine` directory without reading `.env.local`. Used the existing clone at c896b13 (its only diff was @vercel/blob in package.json and the lock) and deleted its `.next`, `.env.local` and `.vercel` |
| 2 | TS2559: Type 'ProcessEnv' has no properties in common with type '{ VERCEL_ENV?: string … }' | Weak-type detection against Next's ProcessEnv augmentation | Typed env parameters as `Record<string, string \| undefined>` |
| 3 | TS2503 Cannot find namespace 'sharp' | The sharp default import is not a namespace in TS7 | `import sharp, { type Metadata } from 'sharp'` |
| 4 | The sweep's purge threw: update or delete on table "media" violates RESTRICT setting of foreign key constraint "sections_image_id_fkey" | ON DELETE RESTRICT raises SQLSTATE 23001 (restrict_violation), not 23503 | Catch both 23001 and 23503, keep the row and continue |
| 5 | The presigned PUT carried extra vercel-blob-allow-overwrite and vercel-blob-add-random-suffix params | urlOptions `{allowOverwrite:false, addRandomSuffix:false}` were passed to handleUploadPresigned | Dropped urlOptions; the store defaults are the same |
| 6 | pg FATAL 28000 in the move-assets child process | The test passed a minimal env to execFile without USER and HOME | Pass PATH, HOME, USER and NODE_ENV plus the test's own values |
| 7 | E2E: every browser upload stored 0 bytes and registerMedia said 'File quá lớn' | With onUploadProgress, @vercel/blob streams the body (fetch + ReadableStream, duplex half). Playwright interception loses streamed bodies, and Chromium streams uploads only over HTTP/2 or QUIC (a real risk behind HTTP/1.1 proxies) | Removed onUploadProgress from the uploader (the SDK then sends the File as a plain body). measureMedia now reports an empty file as 'unreadable' |
| 8 | E2E: getByRole('img') found no thumbnail | The thumbnail has alt="" (presentation role) because the link names the file | Use `card.locator('img')` and poll `complete && naturalWidth` |
| 9 | E2E strict-mode violation: two cards named san-hien-buoi-toi.png | A rerun without a DB reset found the previous run's file | A per-run file name (Date.now() base36) |
| 10 | E2E: the delete form stayed 'Đang xóa…' although the row was soft-deleted at once | refresh() re-rendered /admin/media/[id], whose page calls notFound() for the deleted file, inside the action response, and the form's promise never settled | deleteMedia now calls `redirect('/admin/media?deleted=1')`, which passes through actionError via unstable_rethrow; the library shows 'Đã xóa file.' |
| 11 | e2e/admin-security.spec.ts expected connect-src 'self' | An intended CSP change: the browser uploads to the Blob API | Updated the expectation to "connect-src 'self' https://vercel.com/api/blob/" |
| 12 | Lint went from 19 to 22 warnings (iframe-missing-sandbox, pg no-named-as-default-member, no-unexpected-multiline) | New code | Sandbox attribute with an `oxlint-disable-next-line` directive and a justification (the player is cross-origin), `import { Client } from 'pg'` (pg ships an ESM wrapper), measure.test helper rewritten; back to 19 (14 with R3) |
| 13 | Under R3, the first visual run failed no-JS home on both projects (ratios 0.02–0.07) | Cold /_next/image cache: lazy images loaded during the full-page no-JS capture | Two reruns with a warm cache passed 8/8. Phase 7 should warm the optimizer or wait for images in visual-nojs.spec |
| 14 | Under R3, restaurant-pages.serial expected src '/assets/r-the-fan.jpg' | The portrait now goes through next/image | The assertion matches the `/_next/image?url=%2Fassets%2Fr-the-fan.jpg&` prefix |
| 15 | Flakes, each once: routing.spec (statuses '200 200 404' on a NUL-byte slug, the known soft-404 caching race R14) and a migration-007 hook timeout | Timing; the second ran while a parallel build loaded the CPU | Both passed on rerun; the code did not change |
| 16 | I wrote one temporary backup to /tmp during a mutation check | My mistake (the rules say scratchpad only) | Deleted it at once; the file was restored from it and verified |

## Package versions
- `@vercel/blob` 2.8.0 (npm latest 2026-10-05; added to dependencies as `^2.8.0`)
- `sharp` 0.35.5 (already installed via next ^0.35.4; now a direct dependency `^0.35.5` because measure.ts and the script import it)
- `undici` 6.29.0 (already via @vercel/blob; added as devDependency `^6.29.0` for `test/helpers/blob-redirect.mjs`). Node 22.22 bundles undici 6.23.0; both share `Symbol.for('undici.globalDispatcher.1')`
- `@vercel/oidc` 3.8.9 (transitive; has the local refresh behaviour described in the risks)
- next 16.3.7, react 19.3.0, typescript 7.0.2, pg 8.23.0, zod 4.6.5, vitest 5.0.3, @playwright/test 1.63.0, oxlint 1.86.0
- Node v22.22.0, Postgres 18 (local)

## Recommended task breakdown (spike's proposal; the outline's §3 supersedes it)

Base phase 7's media tasks on `p7-media-full.patch`; each task keeps the full gate.

M1 — foundations (no UI):
- `lib/media/rules.ts` and `film.ts` (+ media.test);
- `lib/server/media/blob.ts` (explicit credentials) and `measure.ts` (+ test);
- package.json: sharp, undici dev;
- test/helpers `fake-blob.ts`, `fake-blob-cli.mjs`, `blob-redirect.mjs` (+ `.d.mts`);
- next.config: remotePatterns + bodySizeLimit;
- admin CSP connect-src (+ csp.test, admin-security E2E);
- ActionResult codes `in_use` and `blob_not_configured`, with their Vietnamese messages.

M2 — library and upload:
- `lib/server/media/library.ts`, including `MEDIA_REFERENCES` + the pg_constraint test, `assertLiveMedia` and the soft delete;
- `register.ts`;
- `app/api/admin/media/upload/route.ts`;
- media actions (delete redirects), the /admin/media and /admin/media/[id] pages, uploader, nav item;
- the media-library and media-upload integration tests;
- the CONTENT_ACTIONS guard rows;
- E2E admin-media.serial (upload, refusal, in-use);
- wire the fake into playwright.config: a second webServer for fake-blob-cli, plus env for next start (the token, FAKE_BLOB_ORIGIN, NODE_OPTIONS --import), so the gate needs no manual steps.

M3 — media-sweep:
- `sweep.ts`, the cron route, vercel.json entry and guard, check-prerender UNCACHED list;
- cron-media-sweep test;
- a README runbook line for manual preview sweeps.

M4 — CmsImage everywhere (R3, closes spec §6.3 item 7):
- convert Hero (cmsPictureProps), Experiences, Heritage, RestaurantHero and the FilmModal poster;
- mediaJson `blur`;
- update the restaurant-pages src assertion;
- give visual-nojs a warm-up or wait-for-images;
- DOM diff expectations: /en 12 lines, taya 2;
- also fix L7-8: SearchOverlay's `url('${r.image.url}')` must escape the URL or go through the optimizer (not done in this spike).

M5 — film:
- the FilmModal iframe;
- move the film part of /admin/content/hero into the form kit's hero screen (slides, copy and autoplay come from the kit spike);
- registry keys for the iframe title and the COMING SOON copy (R2).

M6 — move to Blob:
- `scripts/move-assets-to-blob.mjs` + test;
- README runbook: dry run, --apply per environment, then redeploy;
- the owner creates the stores first.

M7 — integration with the other spikes:
- the form kit's ImagePicker uses `listMedia(kind)` and calls `assertLiveMedia` in every saver;
- the history/restore flow, when restoring a row whose media is soft-deleted, un-deletes the media in the same transaction, or refuses if the media was purged;
- R19 (card alt follows a rename) and L7-3 (one live-portrait predicate) use the same library helpers.

## Risks and open questions
1. Not verified against the real Blob service (by rule). The fake mirrors SDK 2.8.0's wire format, but these must be checked on the first preview: CORS on https://vercel.com/api/blob for our origin; that a presigned PUT with no allow-overwrite param refuses an overwrite; that x-content-type is checked against allowedContentTypes; that the store is public-access (we send access:'public'); the head() and list() response shapes.
2. BLOB_WEBHOOK_PUBLIC_KEY: handleUploadPresigned throws before issuing a URL unless a key is given. We pass a documented placeholder because the completion callback is never accepted on this route. Open question: does connecting a store set BLOB_WEBHOOK_PUBLIC_KEY? It only matters if the onUploadCompleted fallback is ever wired (it would need a session-less route outside /api/admin).
3. Credentials: if a connected store gives only BLOB_STORE_ID + OIDC (no BLOB_READ_WRITE_TOKEN), blobCredentials uses {storeId} when VERCEL=1. That path is untested, and remotePatterns falls back to the wildcard host because no token is visible at build.
4. @vercel/oidc refresh: any @vercel/blob call without explicit credentials on a developer machine with a linked .vercel/ and a logged-in Vercel CLI mints an OIDC token through the Vercel API. Every Blob call and script must go through blob.ts or pass `token`. Consider a CI guard that forbids importing '@vercel/blob' outside lib/server/media/blob.ts, scripts/move-assets-to-blob.mjs and the client uploader.
5. Vercel Cron runs on production deployments only, so the Preview/Dev store is never swept automatically (manual curl with CRON_SECRET, or accept the leftovers). Local development and tests share the `development` folder: a local DB must never run the sweep with the Preview/Dev token, or it would delete Dev's files that its rows do not name. Keep that token out of local env files, or give each developer a folder such as development-<user>.
6. Preview folders follow the git branch (VERCEL_GIT_COMMIT_REF). If previews of one branch ever share a DB with another branch, or the DB branch is reset, its files become orphans and are swept after 24 h. That is intended, but uploads made on one preview vanish when its DB resets.
7. Soft delete plus 30-day purge (my decision; the spec only names orphan blobs). History restore must handle a content row that points at a soft-deleted file (un-delete it in the same transaction) or at a purged one (refuse: the file is gone).
8. Every content editor must call assertLiveMedia in its save transaction. Without it, a row can point at a trashed file and guest loaders silently hide the image (mediaJson filters deleted_at).
9. sharp on Vercel: decoding a 15 MB upload of up to 20000 px a side can use a lot of memory. Consider `sharp(…, { limitInputPixels: 50e6 })` and a function memory check on the first preview. registerMedia downloads the file again from the CDN (one extra read per upload).
10. Vercel's production image optimisation is not sharp, so production pixels differ from local `next start`. The baselines are local only, so they are unaffected either way.
11. R3 conversion: the first visual run on a cold image cache can fail the no-JS shots (lazy images still loading). Needs a warm-up or wait-for-images change in visual-nojs.spec.
12. L7-8 is still open: SearchOverlay's inline `url('${r.image.url}')` background needs escaping, or the optimizer, before Blob URLs reach it. Guest CSP (phase 10) needs frame-src www.youtube-nocookie.com player.vimeo.com, and img-src for the Blob host only if any raw Blob URL remains (after R3 every content image goes through /_next/image).
13. The FilmModal iframe title 'One Furama Cuisine — the film' and the COMING SOON copy are guest-visible text outside the registry; they must become keys (the phase-7 CI 'no guest text outside registry/DB' test).
14. After move-assets on a real DB, anything keyed on '/assets/…' pathnames (e2e SQL, the 008 re-run seed) no longer matches. E2E runs only on local seeded DBs, so it is safe today. Re-running 008 by hand (psql -f) would insert new static rows for the moved files: harmless duplicates.
15. The route's Origin check compares against new URL(request.url).origin. Check it on a Vercel preview behind a custom domain or Deployment Protection.

## Spec deviations (the spike's list; rulings in the outline §2)
1. onUploadCompleted (§11 'dự phòng') is not wired: it needs BLOB_WEBHOOK_PUBLIC_KEY and a session-less callback route outside /api/admin. An upload that never gets registerMedia is removed by media-sweep after 24 h (§12). handleUploadPresigned gets a placeholder key, used only for the refused callback.
2. Delete is soft (media.deleted_at, as 008 designed), with an app-level usage check under row locks plus assertLiveMedia; ON DELETE RESTRICT stays the final guard for the sweep's hard delete. The sweep also purges trashed rows after 30 days; the spec names only orphan blobs.
3. Pathnames carry an environment folder (production | preview/<branch> | development) and the sweep lists only that folder. This is in addition to the spec's separate Production and Preview/Dev stores, which alone cannot separate previews and dev inside the shared store.
4. images.remotePatterns is pinned to the store's own host when BLOB_READ_WRITE_TOKEN is visible at build (else *.public.blob.vercel-storage.com), rather than a generic Blob wildcard.
5. The admin CSP (not only the guest one) changes: connect-src adds https://vercel.com/api/blob/ for the browser's presigned PUT. img-src is unchanged because previews go through /_next/image.
6. No upload progress bar (onUploadProgress makes the SDK stream the body, which Chromium sends only over HTTP/2 or QUIC).
7. The film link is validated more strictly than 008's sections_film_video CHECK: it must name one YouTube or Vimeo video. The embed uses youtube-nocookie / player.vimeo with dnt=1.
8. registerMedia measures from the stored bytes with sharp: displayed size after EXIF orientation, and a 16 px WebP blur.
9. ActionResult gains the codes in_use (with a `uses` list) and blob_not_configured.
10. package.json gains sharp (direct; it was transitive via next) and undici (devDependency for the test preload), beyond @vercel/blob.

## User steps
- Vercel dashboard → project → Storage → Create Database → Blob: create a store for Production (for example furama-cuisine-production), access Public. When connecting it to the project, tick only Production. It should set BLOB_READ_WRITE_TOKEN for Production.
- Create a second Blob store for Preview and Development (for example furama-cuisine-preview), access Public, connected with only Preview and Development ticked.
- After connecting, open Project → Settings → Environment Variables and tell the controller which Blob variables exist for each environment (BLOB_READ_WRITE_TOKEN, and whether BLOB_STORE_ID or BLOB_WEBHOOK_PUBLIC_KEY also appeared). Send only the names, never the values.
- Do not pull the Preview/Dev Blob token into a local .env.local (no `vercel env pull` for it). Local development and tests run against the fake or with no store.
- CRON_SECRET, already set in phase 5, also protects the new /api/cron/media-sweep; nothing new to set.
- After phase 7 is deployed to Production, the controller runs `scripts/move-assets-to-blob.mjs --prefix production` (dry run first, then --apply) with the Production database and the Production Blob token, then redeploys so cached pages use the Blob URLs. Optionally do the same for a preview with `--prefix preview/<branch>`.
- Content still owed: high-resolution originals for the ~17 thumbnail-sized images (upload them in /admin/media and replace the old ones), menu PDFs, and the YouTube or Vimeo link for the film.
