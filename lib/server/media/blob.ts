import 'server-only';
import { BlobNotFoundError, del, head, issueSignedToken, list, type IssuedSignedToken } from '@vercel/blob';
import { MAX_UPLOAD_BYTES, UPLOAD_URL_TTL_MS, blobEnvPrefix, type MediaContentType } from '@/lib/media/rules';

/*
 * Every call this app makes to Vercel Blob goes through here (spec §11), so
 * the credentials rule lives in one place.
 *
 * Credentials are always passed explicitly. Left to itself, the SDK resolves
 * them as: the `token` option, then an OIDC token (VERCEL_OIDC_TOKEN, and when
 * that variable is missing @vercel/oidc *refreshes one*: it finds
 * .vercel/project.json, reads the Vercel CLI's login and calls the Vercel API),
 * then BLOB_READ_WRITE_TOKEN (node_modules/@vercel/blob/dist/chunk-YYMLUMXS.js
 * resolveBlobAuth; node_modules/@vercel/oidc/dist/token.js refreshToken). On a
 * developer's linked checkout that refresh would reach Vercel from a local run.
 * So: a read-write token when the environment has one (what connecting a store
 * to the project sets), else OIDC with BLOB_STORE_ID only on Vercel, where the
 * function's own token is present and no refresh happens; anything else is
 * "not configured" and no request is made.
 */

export class BlobNotConfiguredError extends Error {
  constructor() {
    super('Vercel Blob is not configured for this environment (BLOB_READ_WRITE_TOKEN, or BLOB_STORE_ID on Vercel).');
    this.name = 'BlobNotConfiguredError';
  }
}

type Credentials = { token: string } | { storeId: string };

export function blobCredentials(env: Record<string, string | undefined> = process.env): Credentials {
  const token = env.BLOB_READ_WRITE_TOKEN?.trim();
  if (token) return { token };
  const storeId = env.BLOB_STORE_ID?.trim();
  if (storeId && env.VERCEL === '1') return { storeId };
  throw new BlobNotConfiguredError();
}

export function isBlobConfigured(env: Record<string, string | undefined> = process.env): boolean {
  try {
    blobCredentials(env);
    return true;
  } catch {
    return false;
  }
}

/** This deployment's folder in its store (lib/media/rules.ts blobEnvPrefix). */
export function envPrefix(env: Record<string, string | undefined> = process.env): string {
  return blobEnvPrefix(env);
}

/**
 * The delegation behind one presigned upload: put only, this pathname only,
 * this type only, at most 15 MB, valid for ten minutes. The Blob API enforces
 * each limit when the browser's PUT arrives.
 */
export async function issueUploadToken(pathname: string, contentType: MediaContentType): Promise<IssuedSignedToken> {
  return issueSignedToken({
    ...blobCredentials(),
    pathname,
    operations: ['put'],
    validUntil: Date.now() + UPLOAD_URL_TTL_MS,
    maximumSizeInBytes: MAX_UPLOAD_BYTES,
    allowedContentTypes: [contentType],
  });
}

export type StoredBlob = { pathname: string; url: string; size: number; contentType: string; uploadedAt: Date };

/** The store's own record of a file, or null when it has none (BlobNotFoundError). */
export async function headBlob(pathname: string): Promise<StoredBlob | null> {
  try {
    const h = await head(pathname, blobCredentials());
    return { pathname: h.pathname, url: h.url, size: h.size, contentType: h.contentType, uploadedAt: h.uploadedAt };
  } catch (err) {
    if (err instanceof BlobNotFoundError) return null;
    throw err;
  }
}

/** Every file under `prefix` (paged by the API, 1000 at a time). */
export async function* listBlobs(prefix: string): AsyncGenerator<{ pathname: string; url: string; size: number; uploadedAt: Date }> {
  let cursor: string | undefined;
  do {
    const page = await list({ ...blobCredentials(), prefix, cursor, limit: 1000 });
    for (const b of page.blobs) yield { pathname: b.pathname, url: b.url, size: b.size, uploadedAt: b.uploadedAt };
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
}

export async function deleteBlobs(urls: string[]): Promise<void> {
  if (urls.length > 0) await del(urls, blobCredentials());
}

/**
 * A stored file's bytes, read back for registerMedia to measure. The URL comes
 * from head(), never from the browser, and must be https on a Blob host, with
 * no redirect followed (a redirect could lead anywhere); the read stops past
 * the 15 MB cap.
 */
export async function downloadBlob(url: string, maxBytes = MAX_UPLOAD_BYTES): Promise<Uint8Array> {
  const target = new URL(url);
  if (target.protocol !== 'https:' || !target.hostname.endsWith('.public.blob.vercel-storage.com')) throw new Error('not a public Vercel Blob URL');
  const res = await fetch(target, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20_000) });
  if (!res.ok || !res.body) throw new Error(`blob download failed: ${res.status}`);
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error('blob larger than the upload cap');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}
