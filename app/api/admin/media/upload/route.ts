import { handleUploadPresigned } from '@vercel/blob/client';
import { z } from 'zod';
import { parseUploadPathname } from '@/lib/media/rules';
import { PermissionError, requirePermission } from '@/lib/server/dal/session';
import { BlobNotConfiguredError, envPrefix, issueUploadToken } from '@/lib/server/media/blob';

/*
 * Upload step 1 of 2 (spec §11): the media library's browser asks here for a
 * presigned URL (`uploadPresigned` from @vercel/blob/client), then PUTs the
 * file straight to Vercel Blob, so no file passes through this function (a
 * Vercel function body is capped at 4.5 MB; the upload cap is 15 MB). Step 2 is
 * the registerMedia Server Action (app/admin/(shell)/media/actions.ts).
 *
 * A URL is issued only to a signed-in staff member who may edit content, for
 * a pathname this environment hands out (lib/media/rules.ts: its own folder, a
 * fresh uuid, one of the five extensions), and it is limited by the Blob API
 * itself to that pathname, the extension's content type, 15 MB and ten
 * minutes (lib/server/media/blob.ts issueUploadToken).
 *
 * Only `blob.generate-presigned-url` is accepted. Vercel's upload-completed
 * callback (onUploadCompleted) is not used: it never reaches localhost or a
 * preview behind Deployment Protection, it would arrive here without a session
 * (this route asks for one first), and an upload that never gets its
 * registerMedia is an orphan the media-sweep cron removes after 24 hours
 * (spec §12). handleUploadPresigned insists on a webhook key before it looks at
 * the event type; it only uses the key to verify that callback, which this
 * route refuses before calling it.
 */

const NO_STORE = { 'cache-control': 'no-store' };
const NO_CALLBACK_KEY = 'unused: this route never accepts blob.upload-completed';

const Body = z.object({
  type: z.literal('blob.generate-presigned-url'),
  payload: z.object({
    pathname: z.string().max(300),
    // Single PUT only: files are at most 15 MB, under the multipart threshold the client would pick.
    multipart: z.literal(false),
    clientPayload: z.string().max(200).nullable(),
  }),
});

const fail = (status: number, error: string) => Response.json({ error }, { status, headers: NO_STORE });

export async function POST(request: Request): Promise<Response> {
  try {
    await requirePermission({ content: ['update'] });
  } catch (err) {
    return err instanceof PermissionError ? fail(err.code === 'unauthenticated' ? 401 : 403, err.code) : fail(500, 'server_error');
  }
  // spec §7.1: an admin route handler checks Origin (a cookie alone must not issue a URL to another site's page).
  if (request.headers.get('origin') !== new URL(request.url).origin) return fail(403, 'bad_origin');

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch {
    return fail(400, 'invalid');
  }
  const prefix = envPrefix();
  const contentType = parseUploadPathname(prefix, body.payload.pathname);
  if (!contentType) return fail(400, 'invalid_pathname');

  try {
    const result = await handleUploadPresigned({
      body,
      request,
      webhookPublicKey: process.env.BLOB_WEBHOOK_PUBLIC_KEY || NO_CALLBACK_KEY,
      // No urlOptions: the store's defaults are what we want (no random suffix, no overwrite), and the
      // delegation already carries the type, size and expiry limits.
      getSignedToken: async (pathname) => ({ token: await issueUploadToken(pathname, contentType) }),
    });
    return Response.json(result, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof BlobNotConfiguredError) return fail(503, 'blob_not_configured');
    console.error('[admin] media upload token failed', { name: err instanceof Error ? err.constructor.name : typeof err });
    return fail(502, 'blob_error');
  }
}
