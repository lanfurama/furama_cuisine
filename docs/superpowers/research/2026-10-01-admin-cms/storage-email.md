# Image storage for admin uploads (Vercel Blob vs Neon Object Storage) and transactional email (Resend), Furama Cuisine CMS


# Image storage and transactional email for the Furama Cuisine CMS

## 0. What the repo has today

- **Images.** `public/assets` holds 39 JPGs, 3.0 MB in total. Each file is between 7.9 KB and 182 KB.
- **Many of them are low-resolution placeholders** (checked with `sips`):
  - The cuisine icons `cuisine-cafe-lounge`, `hotpot`, `international` and `japanese` are 45×45, but they render at 80×80 (`components/home/Cuisines.tsx:73`).
  - Two hero slides are tiny. `hero-taya.jpg` is 174×264 and `hero-indochine.jpg` is 125×94, yet both are used full-bleed (`components/home/Hero.tsx:31,39`; `lib/data.ts:141-142`).
  - Four restaurant cards are 125×94: `r-chaoshan-hotpot`, `r-danaksara`, `r-hai-van-lounge` and `r-yum-food-village`.
  - We need the original photos from Furama marketing, whichever storage we choose.
- **Image rendering is mixed.**
  - `next/image` is used in `RestaurantCard`, `Cuisines`, `Destinations`, `Stories` and `TayaExperiences`.
  - Plain `<img>` is used in `Hero.tsx:29-39` (a `<picture>` with a separate mobile crop), `Experiences.tsx:14`, `Heritage.tsx:13`, `FilmModal.tsx:28` and `TayaHero.tsx:72`.
  - `SearchOverlay.tsx:87` uses a CSS `background-image`.
  - Paths are hardcoded by helpers at `lib/data.ts:173-174` (`restaurantImage`, `cuisineImage`). Alt text is hardcoded in English only (`lib/data.ts:134-142`, and inside the components).
- **`next.config.ts` has no `images` block.**
- **Reservations data.** In `db/migrations/001_init.sql` the `reservations` table has no `locale` column, `email` is optional, and the status values are only `requested`, `confirmed` and `cancelled`.
- **Environment.** `.env.local` was created by the Vercel CLI and already contains `VERCEL_OIDC_TOKEN`, `NEON_PROJECT_ID`, `NEON_AUTH_BASE_URL` and `POSTGRES_PRISMA_URL`. That is the variable set the Vercel-managed Neon integration produces, so the Neon project is almost certainly Vercel-managed.
- **Contact domain.** The site's contact address is `fb@furamavietnam.com` and links point to the furamavietnam.com WordPress site (`lib/data.ts`). The domain therefore has live corporate mailboxes and is most likely not on Vercel DNS.

## 1. Vercel Blob

Status: first-party and GA. Private storage has also reached GA. Current SDK is `@vercel/blob@2.8.0` (published 2026-08-10, needs Node 20 or later).

- **Public vs private is a property of the store, not of each file, and cannot be changed later.**
  - Public: anyone with the URL can read the file, which is served directly from `https://<store-id>.public.blob.vercel-storage.com/<pathname>`.
  - Private: every read needs a token and goes through a Function using `get()`, or through `presignUrl()`.
  - `next/image` with direct blob URLs only works for public stores.
  - Source: https://vercel.com/docs/vercel-blob and https://vercel.com/docs/vercel-blob/public-storage
- **Authentication.**
  - A connected project gets `BLOB_STORE_ID`, `VERCEL_OIDC_TOKEN` and `BLOB_WEBHOOK_PUBLIC_KEY`. The OIDC token is short-lived and rotated automatically.
  - `BLOB_READ_WRITE_TOKEN` is a long-lived token. It is only needed outside Vercel, or for the older `handleUpload` client-token flow.
- **Upload limits.**
  - Server uploads through a Function are limited to about 4.5 MB of request body.
  - Next.js Server Actions are capped at 1 MB by default (`node_modules/next/dist/docs/01-app/02-guides/server-actions.md:83`).
  - So admin uploads should be client uploads: the browser sends the file straight to Blob, up to 5 TB.
  - Two flows exist, both imported from `@vercel/blob/client`:
    - **Older flow:** `upload()` on the client with `handleUpload({ body, request, onBeforeGenerateToken, onUploadCompleted })` on the server. `onBeforeGenerateToken` returns `allowedContentTypes`, `maximumSizeInBytes`, `addRandomSuffix`, `tokenPayload` and `callbackUrl`. This flow requires `BLOB_READ_WRITE_TOKEN`.
    - **Newer flow:** `uploadPresigned()` on the client with `handleUploadPresigned({ getSignedToken, onUploadCompleted })` on the server, together with `issueSignedToken()`. It works with OIDC and verifies the completion callback with `BLOB_WEBHOOK_PUBLIC_KEY`. I confirmed both exports in the 2.8.0 tarball (`dist/client.d.ts`).
  - In both flows you must check the admin session inside the callback. Otherwise anyone can upload.
  - `onUploadCompleted` never fires on localhost, so the client should also register the upload itself (see section 4).
  - Source: https://vercel.com/docs/vercel-blob/client-upload and https://vercel.com/docs/vercel-blob/vercel-signed-urls
- **New in 2.8: `putImage(pathname, bodyOrUrl, { optimizeImage: { width, quality, format } })`.** It runs Vercel Image Optimization and stores only the optimised result. It needs OIDC and is billed as one image transformation plus one put. The CLI equivalent is `vercel blob put-image`.
- **Caching and overwrites.**
  - The CDN and browsers cache blobs for up to 1 month by default. `cacheControlMaxAge` can lower this, to a minimum of 60 s.
  - Overwrites take up to 60 s to propagate, and browsers keep their stale copy.
  - Vercel recommends treating blobs as immutable: use `addRandomSuffix: true` and never overwrite.
- **`next/image` setup:** `images.remotePatterns: [new URL('https://<store-id>.public.blob.vercel-storage.com/**')]`.
  - Use the exact hostname, not a wildcard. Otherwise anyone's public store could run through our image optimiser at our cost.
  - Next 16 also has these relevant settings:
    - `images.qualities` now defaults to `[75]` and must list any other quality you use.
    - `priority` is deprecated in favour of `preload`, `loading="eager"` or `fetchPriority`.
    - `getImageProps()` handles a separate crop per breakpoint (the existing hero `<picture>`).
    - `minimumCacheTTL` defaults to 4 h and there is no way to invalidate it. Because our URLs never change, it can safely be raised to about 31 days.
  - Source: `node_modules/next/dist/docs/01-app/03-api-reference/02-components/image.md` (lines 265-293, 533-611, 698-728, 774-802 and 1327-1363).
- **Pricing.**

  | | Hobby (free) | Pro |
  |---|---|---|
  | Storage | 1 GB | $0.023/GB-month |
  | Simple operations | 10k | $0.40 per 1M |
  | Advanced operations (put/copy/list) | 2k | $5.00 per 1M |
  | Data transfer | 10 GB | about $0.05/GB in iad1 |

  - `del()` is free. Pro rate limits are 7,200 simple and 4,500 advanced operations per minute. On Hobby, Blob stops working for 30 days once you exceed the limits.
  - Images served through `next/image` are billed as Image Optimization: Hobby includes 5k transformations a month, and Pro pays $0.05–$0.0812 per 1k. In that setup Blob is only read when the optimiser's cache misses, so Blob transfer stays close to zero.
  - **Hobby is limited to non-commercial personal use, so a hotel site needs a Pro plan.**
  - Our likely spend is a few hundred images at about 1.5 MB each, roughly 0.3 GB. That is well under $1 a month for Blob, plus a small Image Optimization line.
  - Source: https://vercel.com/docs/vercel-blob/usage-and-pricing and https://vercel.com/docs/image-optimization/limits-and-pricing
- **Optimisation limits.** Source images can be at most 8192 px on either side. Only JPEG, PNG, WebP and AVIF are optimised; anything else, including HEIC from iPhones, is served as-is. So reject HEIC, or convert it in the browser.
- **Provisioning.** Blob is first-party, not a Marketplace integration.
  - Dashboard: Project → Storage → Create → Blob → Public.
  - CLI: `vercel blob create-store furama-media --access public --region iad1 --yes`. `--yes` connects the store to the linked project in all environments; `--environment` (repeatable) limits that. The default region is iad1, and **the region cannot be changed after creation.**
  - Then run `vercel env pull`.
  - Source: https://vercel.com/docs/cli/blob

## 2. Neon Object Storage

What the skill (`.agents/skills/neon/SKILL.md:36,40-42`) and the docs say:

- **What it is.** S3-compatible object storage scoped to a database branch. A branch inherits its parent's buckets copy-on-write, so preview branches get their own isolated files.
- **Regions.** Available in aws-us-east-2, us-east-1, eu-central-1 and ap-southeast-1. Our project is in aws-us-east-1, so it qualifies.
- **Bucket access.** Buckets are `private` or `public_read`. The access level can only be set in the Console or API, not through S3 calls.
- **Public URLs include the branch ID:** `https://<branch-id>.storage.c-<N>.<region>.aws.neon.tech/<bucket>/<key>`.
- **Uploads and credentials.**
  - Browser uploads use S3 presigned PUT (through `@aws-sdk/s3-request-presigner`, with `forcePathStyle: true`) or Neon's Files SDK.
  - Credentials are static `AWS_*` keys that `neon.ts`, `neon env pull` or `neon deploy` write to a local file.
- **Limits and rough edges.**
  - Maximum object size is 5 GiB.
  - Heavy use is throttled with `503 SlowDown`.
  - Lifecycle rules and versioning are stored but not enforced.
  - `expires_at` on credentials is not enforced either.
  - There is no CDN and no image transformation. The skill itself says to "put a CDN in front of public assets".
  - Source: https://neon.com/docs/storage/overview.md, `/buckets.md`, `/s3-compatibility.md`, `/authentication.md`, `/objects.md`, and https://neon.com/docs/ai/skills/neon-object-storage/SKILL.md
- **Maturity.**
  - It launched in beta on 2026-07-15, in us-east-2 only, with the warning that it was "not production ready" (https://releases.sh/release/rel_WlOw5J5poMxxB_V_h9RPk).
  - A blog post dated 2026-08-06 says it "was available … free of charge during the beta" and mentions a GA announcement (https://neon.com/blog/building-neon-object-storage).
  - The docs pages carry no beta label. **I could not confirm whether it is formally GA.**
- **Pricing.** 5 GB per project on the free plan. On Launch/Scale it is $0.023/GB-month with no per-operation charge, and egress counts against the shared transfer allowance (https://neon.com/pricing.md).
- **Our setup is not covered.** Neon's guide to the Vercel-managed integration lists its limitations without mentioning Object Storage at all. For Vercel-managed accounts the Neon CLI needs an API key, because `neon login` does not work (https://neon.com/docs/guides/vercel-managed-integration.md).
  - So it is undocumented whether buckets work on this Vercel-managed project, and whether the `AWS_*` credentials would ever reach Vercel's environment variables. Most likely we would have to add and rotate them by hand.

## 3. Comparison and recommendation: Vercel Blob, public store

| | Vercel Blob (public store) | Neon Object Storage |
|---|---|---|
| Maturity | GA, SDK 2.8.0 | Beta from 2026-07; GA unclear; Vercel-managed project support undocumented |
| Delivery | Vercel CDN; immutable URLs cached for 1 month | Branch endpoint with no CDN |
| `next/image` | Documented, exact-host `remotePatterns` | Hostname changes per branch, so it needs a wide wildcard (cost-abuse risk) or keys rebuilt per environment |
| Browser upload | First-class `upload()` / `uploadPresigned()` with type and size limits | DIY S3 presign plus bucket CORS |
| Credentials | OIDC, nothing long-lived (token already present) | Static AWS keys |
| Image extras | `putImage()` for pre-optimised variants | None |
| Cost at our scale | Under $1/month plus Image Optimization | About the same |
| Neon's advantage | — | Files branch together with database rows |

Neon's real advantage is that files branch with the database, which keeps preview environments consistent. Blob gets the same benefit from a **separate Blob store connected only to Preview and Development**. Stores are unlimited on every plan.

## 4. Implementation plan

### Upload flow

1. The admin picks a file. The browser accepts JPEG, PNG, WebP or AVIF only.
2. The browser downscales the image to at most 3840 px on the long edge (the largest default `deviceSizes` value).
3. The browser reads the width and height and builds a 16 px base64 WebP placeholder from a canvas. This avoids needing `sharp` on the server.
4. The browser calls `uploadPresigned(..., { access: 'public', handleUploadUrl: '/api/admin/media/upload' })`.
5. The route handler checks the admin or editor session and calls `issueSignedToken({ operations: ['put'], allowedContentTypes, maximumSizeInBytes: 25 MB })`.
   - Pathnames look like `media/<yyyy>/<mm>/<slug>.<ext>` with `addRandomSuffix: true`, `allowOverwrite: false` and `cacheControlMaxAge` of 1 year.
6. When the upload resolves, the client calls a `registerMedia` server action. It inserts the `media` row (an idempotent upsert on `pathname`) and writes the audit log. `onUploadCompleted` runs the same upsert as a backup.
7. If AI is on, `registerMedia` then uses `after()` (`next/server`) to ask Vertex AI for alt text, translating it per locale. It fetches the public blob URL and sends a downscaled copy of about 1568 px inline. Store the result as `ai` until an editor reviews it.

### Schema sketch

```sql
CREATE TABLE media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storage text NOT NULL DEFAULT 'blob' CHECK (storage IN ('blob','static')),
  pathname text NOT NULL UNIQUE,
  url text NOT NULL,
  content_type text NOT NULL,
  bytes int NOT NULL,
  width int NOT NULL,
  height int NOT NULL,
  blur_data_url text,
  focal_x real NOT NULL DEFAULT 0.5,
  focal_y real NOT NULL DEFAULT 0.5,
  decorative boolean NOT NULL DEFAULT false,
  uploaded_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE media_alt (
  media_id uuid REFERENCES media(id) ON DELETE CASCADE,
  locale text NOT NULL,          -- FK to locales(code)
  alt text NOT NULL,
  source text NOT NULL CHECK (source IN ('human','ai','ai_reviewed')),
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (media_id, locale)
);
```

- Every content table references images with `image_id uuid REFERENCES media(id) ON DELETE RESTRICT`. Postgres then refuses to delete an image that is still in use.
- An optional per-usage alt override can live in that content row's translation table.
- **Alt text fallback:** the requested locale's alt → the English alt → `''`. `decorative = true` always renders `alt=""`. The focal point drives `object-position` for `fill` crops.

### Rendering

- Build a single `<CmsImage media sizes fill preload?>` wrapper around `next/image`. It supplies width and height, `placeholder="blur"` with the stored placeholder, and the localised alt.
- The hero's separate mobile crop uses `getImageProps()`, with two `media` IDs per slide (desktop and mobile).
- `SearchOverlay`'s CSS background becomes a small `<Image fill>`.
- Proposed `next.config.ts`:
  - `images.remotePatterns` containing the exact production and preview store hosts
  - `localPatterns: [{ pathname: '/assets/**', search: '' }]` for as long as any static files remain
  - `qualities: [75, 85]`
  - `formats: ['image/avif', 'image/webp']` (optional)
  - `minimumCacheTTL: 2678400`

### Moving the 39 existing images

I recommend uploading them to Blob once, rather than keeping them as static files:

1. A one-off script, `scripts/seed-media.mjs`, runs once per environment through `dotenv -e .env.local`.
2. For each file it reads the dimensions and builds the blur placeholder with `sharp` (0.35.x; add it as a devDependency, because today it is only a transitive dependency of `next`).
3. It calls `put('seed/<name>.jpg', buf, { access: 'public', addRandomSuffix: false, allowOverwrite: false })`, skipping the file if `head()` shows it already exists.
4. It upserts the `media` row and inserts English alt text taken from today's hardcoded strings.
5. Keep `public/assets` for one release as a rollback, then delete it. Only brand assets stay: logo, favicon, the default OG image, and the PNG logo used in emails.

The alternative is to keep the 39 as `storage = 'static'` rows pointing at `/assets/...`. That costs nothing, but those images can't really be deleted from the admin and the model stays split. Either way, the media library should warn when an image's natural width is below its largest rendered width (for example under 1600 px for hero slots).

### Removing orphaned files

Run a daily Vercel Cron route protected by `CRON_SECRET`:

1. **Soft-deleted media.** Find `media` rows where `deleted_at < now() - interval '30 days'` and no references remain (check with a view that unions every `image_id` column). Delete them in batches with `del([...urls])`, which is free, then hard-delete the rows. The 30-day grace period covers undo, the audit log and cached pages.
2. **Abandoned uploads.** Uploaded but never registered. Once a week, page through `list({ prefix: 'media/', cursor })` (one advanced operation per 1,000 blobs). Delete blobs that have no `media` row and are older than 24 h.
3. Replacing an image never auto-deletes the old one. It shows up under an "Unused" filter.
4. The sweeper only touches its own environment's store or prefix. This is the main reason for a separate preview store: a production sweep must never delete blobs that only a preview database references.
5. Optimised copies can keep serving until `minimumCacheTTL` expires. That is acceptable.

## 5. Transactional email: Resend

### Versions (checked with `npm view` and the downloaded tarballs, 2026-10-01)

- `resend@6.31.0`, published 2026-09-29, needs Node 20 or later. Its API has:
  - `emails.send` with `react`, `idempotencyKey` and `scheduledAt`
  - `batch.send` (up to 100 emails per call)
  - `webhooks.verify`
  - `templates`
- **React Email 6:** `react-email@6.11.0` (2026-09-23).
  - Components (`Html`, `Body`, `Button`, `Heading`, `Preview`, `Tailwind`, …) are now imported from `'react-email'` itself.
  - `@react-email/components` (1.0.12) is **deprecated on npm**.
  - `@react-email/render@2.1.0` is a dependency of `react-email` and an optional peer of `resend`.
  - The `email dev` CLI gives a local preview server.
- Resend's docs say to pass `react: Template(props)` as a function call, not as JSX.
- Install: `npm i resend react-email`.

### Provisioning

- The Marketplace product is `resend/resend-email` and adds `RESEND_API_KEY`. Install with `vercel integration add resend` (or `vc i resend`). Add `-m region=ap-northeast-1` for Tokyo, the closest region to Vietnam; the default is us-east-1.
  - Billing goes through Vercel, and promo or startup credits don't apply.
  - Resources created this way can only be removed from Vercel, not from the Resend dashboard.
- **Caveat:** Resend's Marketplace guide lists "A domain purchased in Vercel" as a prerequisite, and its DNS auto-setup targets Vercel domains. furamavietnam.com appears to be hosted elsewhere. I could not confirm whether the Marketplace flow accepts an external domain.
  - Fallback: create the Resend account at resend.com and add `RESEND_API_KEY` with `vercel env add`. Everything else stays the same.
  - Source: https://resend.com/docs/guides/vercel-marketplace-integration.md and https://vercel.com/changelog/resend-vercel-marketplace (2026-07-01)
- **Regions:** us-east-1, eu-west-1, sa-east-1 and ap-northeast-1. The region only controls where mail is sent from; account data is always stored in the US. Changing region means deleting and re-adding the domain.

### Sending domain

Resend recommends a subdomain, for example `mail.furamavietnam.com` or `dining.furamavietnam.com`. The DNS changes go in at furamavietnam.com's DNS host:

- `MX send.mail` → `feedback-smtp.<region>.amazonses.com`, priority 10. This sits on the `send.` subdomain, so the existing root MX records for staff mailboxes are untouched.
- `TXT send.mail` → `"v=spf1 include:amazonses.com ~all"`
- `TXT resend._domainkey.mail` → the DKIM key from the Resend dashboard
- **DMARC:** `TXT _dmarc.mail.furamavietnam.com` → `v=DMARC1; p=none; rua=mailto:…`. Move it to `quarantine` and then `reject` once mail passes. Check first whether `_dmarc.furamavietnam.com` already exists, since a subdomain inherits the parent's `sp=` policy.

Verification usually takes about 15 minutes and can take up to 72 h. Don't turn on Cloudflare proxying for any CNAME records. Source: https://resend.com/docs/add-a-domain.md, `/knowledge-base/vercel.md` and `/dashboard/domains/dmarc.md`.

### Limits

- **Free:**
  - 3,000 emails a month and 100 a day. The day is a UTC calendar day, and received mail also counts.
  - Each To, Cc or Bcc recipient counts as a separate email.
  - 3 domains.
- **All plans:** 10 requests/second per team, 30-day log retention.
- **Pro:** $20 a month for 50k emails, with no daily cap, 10 domains, and overage at $0.90 per 1k up to 5× the quota.
- At about 30 bookings a day × (1 staff email + 1 to 2 guest emails), plus staff login emails, we would hit the 100/day free cap. **Production should be on Pro.**
- Source: https://resend.com/pricing and https://resend.com/docs/knowledge-base/account-quotas-and-limits.md

### Sending pattern

- Create the reservation and insert an `email_outbox` row in the same database transaction. Then send from `after()` with `idempotencyKey: 'booking-confirmed/<reference>'` (keys last 24 h).
- A cron job retries failures.
- Optionally use Resend webhooks with `webhooks.verify` to record delivered, bounced and complained events. This keeps history past Resend's 30 days, and the bounce rate must stay under 4%.
- `tags` must be ASCII, so never put Vietnamese text in tags.
- Logos in emails must be absolute public URLs (a Blob PNG, not SVG or `/_next/image`).

### Can Neon Auth send from our own address?

Yes. By default Managed Better Auth sends from the shared `auth@mail.myneon.app`, which is meant for development only. There are two ways to change that:

- **(A) Custom SMTP.** Console → Settings → Auth, or `neon neon-auth config email-provider update`, pointed at Resend's SMTP:
  - host `smtp.resend.com`, port 465 or 587, user `resend`, password = a Resend API key with sending access only.
  - This gives our sender address but keeps Neon's default email content.
  - Verification links (as opposed to codes) also require a custom provider.
- **(B) Webhooks.**
  - `send.otp` and `send.magic_link` are blocking events. Once subscribed, Neon skips its own email. There are 3 attempts within a 15 s overall limit.
  - Payloads are signed with Ed25519 detached JWS, using the key set at `${NEON_AUTH_BASE_URL}/.well-known/jwks.json`.
  - `organization.invitation.created` is non-blocking. Set `send_invitation_email: false` so the invite email comes only from us.
  - Our handler renders branded React Email templates in EN/VI and sends them through Resend.
  - The webhook URL must be public HTTPS with no redirects, so it can't be localhost and must get past Vercel's preview Deployment Protection.
  - Neon has no dashboard templates yet.
  - Source: https://neon.com/docs/auth/guides/customize-emails.md, `/auth/production-checklist.md`, `/auth/guides/webhooks.md` and `/auth/guides/plugins/organization.md`
- The simplest path is (A) at launch and (B) when branding or Vietnamese staff emails matter.
- Alternatively, the app can send its own invite email from the "Invite staff" server action using its own invitation table, and use Neon Auth only for sign-in. That choice belongs to the auth topic.

### Emails in several languages

- Add `locale` to `reservations` (the guest's site locale when they booked) and `preferred_locale` to staff.
- Keep a fixed React Email layout that matches the site's design. Store the editable copy as translatable CMS strings per locale and per template: subject, preview text, greeting, body blocks, CTA labels and footer.
  - Guest emails are guest-visible content, so requirement 1 applies to them.
  - Placeholders look like `{{guestName}}`, `{{restaurant}}`, `{{date}}`, `{{time}}`, `{{guests}}`, `{{reference}}`.
  - After a Vertex AI translation, check that every placeholder is still there and that glossary names (Tàya House, Phố Cuốn, booking references) are unchanged.
- If a locale is missing, fall back to English.
- **Formatting:**
  - Dates: `Intl.DateTimeFormat(locale, { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'full', timeStyle: 'short' })`. This ties in with the timezone bug.
  - Prices: `Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' })`.
- **Markup and fonts:**
  - Set `<Html lang={locale}>`.
  - Use email-safe fonts that cover Vietnamese (Arial, Helvetica, Segoe UI). Add CJK fallbacks for KO/ZH (Apple SD Gothic Neo, Malgun Gothic, PingFang SC, Microsoft YaHei). Don't rely on web fonts that lack a Vietnamese subset.
  - Always send a plain-text part.
- Preview each locale with `email dev` and `PreviewProps`.
- Staff booking alerts default to Vietnamese and go to a per-restaurant recipient list set in the admin. Remember that each recipient counts against the quota.


## Recommendation
**Storage: use Vercel Blob with a public store.**
- Create `furama-media` for Production and a separate store for Preview and Development. Use the same region as the Functions (iad1 today). Decide the region before creating the stores, because it cannot be changed later.
- Upload from the browser with `uploadPresigned` / `handleUploadPresigned`. This works with OIDC, so no long-lived token is needed. Check the admin session before issuing a token, accept only jpeg/png/webp/avif, and use random-suffix pathnames that are never overwritten.
- After each upload, register it in a `media` table (dimensions, blur placeholder, focal point) with alt text per locale in `media_alt`. Content tables reference images by foreign key with ON DELETE RESTRICT.
- Render every image through one `<CmsImage>` wrapper around `next/image`, with `remotePatterns` set to the exact store hostnames, `minimumCacheTTL` of about 31 days and `qualities` [75, 85]. The hero's separate mobile crop uses `getImageProps`.
- Move the 39 images in `public/assets` to Blob once with an idempotent seed script (`seed/` prefix), then remove them from `public/` after one release.
- Ask Furama for original photos: several current images are 45–174 px wide.
- Run a daily Cron sweep: delete soft-deleted, unreferenced media after 30 days, and abandoned uploads (no `media` row) after 24 h. Each environment sweeps only its own store.
- Generate AI alt text with Vertex AI in `after()` once an upload is registered. Editors review it.
- Do not use Neon Object Storage yet. It is beta or newly GA, has no CDN, its URLs change per branch, and support on this Vercel-managed Neon project is undocumented.

**Email: use Resend with `resend@6.31` and `react-email@6.11`.**
- Import components from `react-email`, not the deprecated `@react-email/components`.
- Send from a subdomain such as `mail.furamavietnam.com` in the Tokyo region (ap-northeast-1). Set up SPF, DKIM and DMARC as listed above, starting DMARC at `p=none`.
- Use the Pro plan in production, because the free tier's 100 emails/day is too tight.
- Install through the Marketplace if it accepts an external domain. Otherwise sign up at resend.com and add `RESEND_API_KEY` by hand.
- Send booking emails through an outbox table plus `after()`, with idempotency keys.
- Make email copy editable in the CMS per locale, inside a fixed React Email layout, and add a `locale` column to `reservations`.
- For Neon Auth staff emails, start with custom SMTP to Resend. Move to the `send.otp` / `send.magic_link` webhooks when branded or Vietnamese staff emails are wanted, and handle invites through `organization.invitation.created` or the app's own invite email.

## Risks
- Hobby is limited to non-commercial use (Vercel Image Optimization terms) and Blob stops working for 30 days if limits are exceeded. A hotel site needs Vercel Pro before launch.
- Blob store region cannot be changed. If compute or the database later moves to Singapore (sin1 / aws-ap-southeast-1) for Vietnamese guests, an iad1 store means slower uploads and slower image-cache misses. Decide the region before creating the store.
- A wildcard remotePatterns entry (*.public.blob.vercel-storage.com, or **.aws.neon.tech for Neon) lets anyone run their images through our optimiser at our cost. Pin exact hostnames.
- onUploadCompleted does not fire locally or behind Vercel preview Deployment Protection. Registering the upload from the client is required, or uploads are lost locally.
- If production and preview share one Blob store, the production sweep would delete blobs that only preview databases reference. Use a separate store or prefix.
- Several current images (45–174 px wide) look blurry on retina screens, and the migration will not fix that. Original photos are needed.
- HEIC photos from iPhones are not optimised by Vercel. Reject or convert them in the browser.
- The Resend Marketplace flow may require a domain bought on Vercel, so it may not work with furamavietnam.com, which appears to use external DNS with live mailboxes. DNS changes need Furama IT. Resources created through the Marketplace can only be deleted from Vercel.
- The Resend free tier (100/day, every recipient counted) would be exceeded on busy days, and booking confirmations would silently fail without the outbox and retry.
- Guest email is optional in the reservations schema, so many guests would get no confirmation without a phone channel (SMS/Zalo).
- Neon Auth webhooks for send.otp and send.magic_link are blocking with a 15 s limit. If Resend is slow or down, staff cannot sign in. Monitor this, or keep custom SMTP as the fallback.
- Neon's shared sender (auth@mail.myneon.app) is for development only. Leaving it in production risks rate limits and poor deliverability for staff invites and magic links.
- Neon Object Storage is still at beta-level maturity (unenforced credential expiry and lifecycle rules, no CDN), and support on Vercel-managed projects is undocumented. It should not be chosen now.

## Open questions
- Which Vercel plan does the team use? Pro is needed for commercial use. And will Functions and Neon stay in iad1 (us-east-1), or move to Singapore? That decides the Blob store region, which cannot be changed later.
- Who manages DNS for furamavietnam.com, and can we add records for a sending subdomain such as mail.furamavietnam.com (MX/TXT on send.mail, DKIM TXT, DMARC)? Does a _dmarc record already exist on the root domain?
- Should we install Resend through the Vercel Marketplace (billed by Vercel, possibly requiring a Vercel domain), or create the Resend account directly and add RESEND_API_KEY by hand?
- Can Furama marketing supply original high-resolution photos to replace the low-res placeholders (hero slides, cuisine icons, four restaurant thumbnails)?
- Should the guest confirmation email go out automatically when staff confirm a booking, or also when the request is received? And should guest email become required, or should SMS/Zalo be added for guests who give only a phone number?
- Which staff addresses should get new-booking alerts: one shared F&B inbox (fb@furamavietnam.com) or a per-restaurant list? And in which language: Vietnamese, English, or per staff member?
- Is plain custom SMTP (our sender, Neon's English template) enough for staff sign-in and invite emails at launch, or do they need branded EN/VI templates through Neon Auth webhooks from day one?

## Key facts
- [verified] public/assets holds 39 JPGs (3.0 MB in total). Many are low-res placeholders: 45x45 cuisine icons rendered at 80 px, hero slides at 174x264 and 125x94 shown full-bleed, and four restaurant cards at 125x94. (sips on /Users/bcmac/Desktop/projects/Outside Projects/furama_cuisine/public/assets; components/home/Hero.tsx:29-39; lib/data.ts:141-142)
- [verified] Image rendering is mixed: next/image in 5 components, plain <img> in Hero, Experiences, Heritage, FilmModal and TayaHero, a CSS background in SearchOverlay. Paths are hardcoded by lib/data.ts:173-174, and next.config.ts has no images config. (grep of components/ and lib/; next.config.ts)
- [verified] Vercel Blob access mode (public or private) is set per store and cannot be changed after creation. Public URLs look like https://<store-id>.public.blob.vercel-storage.com/<pathname>. next/image with direct URLs works only for public stores. (https://vercel.com/docs/vercel-blob ; https://vercel.com/docs/vercel-blob/public-storage)
- [verified] @vercel/blob 2.8.0 (2026-08-10) exports upload/handleUpload (needs BLOB_READ_WRITE_TOKEN) and uploadPresigned/handleUploadPresigned/issueSignedToken (work with OIDC and BLOB_WEBHOOK_PUBLIC_KEY), plus putImage() for upload-time optimisation. (npm pack @vercel/blob@2.8.0 dist/client.d.ts and dist/index.d.ts:380-413; https://vercel.com/docs/vercel-blob/vercel-signed-urls)
- [verified] Client uploads are needed above 4.5 MB. onUploadCompleted does not fire on localhost. Server Actions are capped at a 1 MB body by default in Next 16. (https://vercel.com/docs/vercel-blob/client-upload ; node_modules/next/dist/docs/01-app/02-guides/server-actions.md:83)
- [verified] Blob pricing: Hobby includes 1 GB, 10k simple ops, 2k advanced ops and 10 GB transfer. Pro: $0.023/GB-month, $0.40/1M simple ops, $5/1M advanced ops, about $0.05/GB transfer in iad1. del() is free. CDN cache lasts 1 month and overwrites take about 60 s to propagate. (https://vercel.com/docs/vercel-blob/usage-and-pricing (updated 2026-09-23))
- [verified] Vercel Image Optimization: Hobby includes 5K transformations a month; on-demand is $0.05-0.0812 per 1K. Source images are limited to 8192 px. Only jpeg/png/webp/avif are optimised. Hobby is for non-commercial use only. (https://vercel.com/docs/image-optimization/limits-and-pricing)
- [verified] Next 16 image changes: qualities defaults to [75] and must list any other value; priority is deprecated in favour of preload; remotePatterns accepts URL objects; minimumCacheTTL defaults to 4 h and cannot be invalidated; getImageProps handles separate crops per breakpoint. (node_modules/next/dist/docs/01-app/03-api-reference/02-components/image.md:265-293,533-611,698-728,774-802,1327-1363)
- [verified] Blob store CLI: `vercel blob create-store <name> --access public|private [--region iad1] [--yes] [--environment <env>]`. The default region is iad1 and cannot be changed later. (https://vercel.com/docs/cli/blob)
- [likely] Neon Object Storage launched in beta on 2026-07-15 with a 'not production ready' warning. It is now in 4 regions including aws-us-east-1. Formal GA status could not be confirmed. (https://releases.sh/release/rel_WlOw5J5poMxxB_V_h9RPk ; https://neon.com/blog/building-neon-object-storage ; .agents/skills/neon/SKILL.md:40-42)
- [verified] Neon public_read URLs include the branch ID (<branch-id>.storage.c-N.<region>.aws.neon.tech). There is no CDN or image transforms, objects max out at 5 GiB, lifecycle/versioning and credential expires_at are not enforced, and the AWS SDK needs forcePathStyle. (https://neon.com/docs/storage/buckets.md ; /s3-compatibility.md ; /authentication.md ; /objects.md)
- [likely] Neon's documentation of Vercel-managed integration limits does not mention Object Storage. CLI use on Vercel-managed accounts needs an API key. The project's .env.local matches a Vercel-managed Neon install. (https://neon.com/docs/guides/vercel-managed-integration.md ; .env.local variable names)
- [verified] Neon Object Storage pricing: 5 GB per project on Free; $0.023/GB-month on Launch/Scale with no per-operation fee; egress counts against the network allowance. (https://neon.com/pricing.md)
- [verified] resend@6.31.0 was published 2026-09-29 (Node 20+). @react-email/render is an optional peer. React Email 6 (react-email@6.11.0) exports components directly, and @react-email/components is deprecated on npm. (npm view; npm pack resend@6.31.0, react-email@6.11.0 dist/index.d.mts)
- [verified] Resend free tier: 3,000 emails a month and 100 a day (UTC day), 3 domains, 10 req/s per team, 30-day retention; each recipient counts separately. Pro is $20/month for 50k with no daily cap. (https://resend.com/pricing ; https://resend.com/docs/knowledge-base/account-quotas-and-limits.md)
- [verified] Resend domain DNS: MX send.<sub> to feedback-smtp.<region>.amazonses.com (priority 10), TXT send.<sub> 'v=spf1 include:amazonses.com ~all', TXT resend._domainkey.<sub> for DKIM, and DMARC on _dmarc starting at p=none. A subdomain is recommended. (https://resend.com/docs/knowledge-base/vercel.md ; /add-a-domain.md ; /dashboard/domains/dmarc.md)
- [verified] Resend sending regions are us-east-1, eu-west-1, sa-east-1 and ap-northeast-1. Account data is stored in the US regardless of region. (https://resend.com/docs/dashboard/domains/regions.md)
- [verified] The Resend Marketplace integration (resend-email) adds RESEND_API_KEY and installs with `vc i resend -m region=...`. Resend's guide lists 'A domain purchased in Vercel' as a prerequisite, and resources it creates can only be deleted from Vercel. (https://resend.com/docs/guides/vercel-marketplace-integration.md ; https://vercel.com/marketplace/resend ; https://resend.com/docs/knowledge-base/vercel.md)
- [verified] Managed Neon Auth sends from the shared auth@mail.myneon.app by default. A custom SMTP provider gives our own sender with Neon's templates. Webhooks send.otp and send.magic_link (blocking; Neon then skips its own email) give fully custom, multi-language emails via Resend. (https://neon.com/docs/auth/guides/customize-emails.md ; https://neon.com/docs/auth/production-checklist.md)
- [verified] Neon Auth organization invitation emails are controlled by send_invitation_email (default false). The organization.invitation.created webhook is non-blocking and can trigger a custom invite email. Webhook URLs must be public HTTPS with no redirects. (https://neon.com/docs/auth/guides/plugins/organization.md ; https://neon.com/docs/auth/guides/webhooks.md)
- [verified] Resend SMTP settings: host smtp.resend.com, ports 465/587 (also 25/2465/2587), username 'resend', password = API key. (https://resend.com/docs/send-with-smtp.md)
- [verified] Resend tags are ASCII-only. Idempotency keys expire after 24 h. The react param should be passed as Template(props), not JSX. (https://resend.com/docs/send-with-nextjs.md)