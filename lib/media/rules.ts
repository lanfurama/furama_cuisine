/*
 * The upload rules of spec §11, shared by the browser (the media library's
 * uploader), the token route (app/api/admin/media/upload) and registerMedia,
 * so all three refuse the same files. No server-only import: the client
 * component reads the same table to name the file before it asks for a token.
 */

/** jpeg/png/webp/avif/pdf (spec §11; media.content_type CHECK in 008). */
export const MEDIA_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'application/pdf': 'pdf',
} as const;
export type MediaContentType = keyof typeof MEDIA_TYPES;
export const MEDIA_CONTENT_TYPES = Object.keys(MEDIA_TYPES) as MediaContentType[];

/** 15 MB (spec §11; media.bytes CHECK in 008). */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

/** How long a presigned upload URL stays valid: one upload, started right after it is issued. */
export const UPLOAD_URL_TTL_MS = 10 * 60 * 1000;

export function isMediaContentType(value: unknown): value is MediaContentType {
  return typeof value === 'string' && Object.hasOwn(MEDIA_TYPES, value);
}

export const isImageType = (type: MediaContentType) => type !== 'application/pdf';

/**
 * The environment's folder in the store. Spec §11 planned one store for
 * Production and one for Preview and Development; previews now use the
 * production database (owner, 2026-10-05), so Production and Preview share
 * one store (README "Media in Vercel Blob") and the folder keeps each
 * deployment's uploads apart: `production`, a preview's git branch, and
 * `development` for local runs and tests. A deployment's sweep lists its own
 * folder only (the cron runs on production, so it never touches a preview's
 * uploads), and the rows that vouch for every folder's files are the one
 * shared database's.
 */
export function blobEnvPrefix(env: Record<string, string | undefined>): string {
  if (env.VERCEL_ENV === 'production') return 'production';
  if (env.VERCEL_ENV === 'preview') {
    const branch = slugify(env.VERCEL_GIT_COMMIT_REF ?? '', 60) || 'unknown';
    return `preview/${branch}`;
  }
  return 'development';
}

/** Lower-case ASCII words joined by '-', at most `max` characters ('' when nothing is left). */
export function slugify(value: string, max = 60): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';

/**
 * Where an upload lands: `<env>/media/<uuid>/<name>.<ext>`. The uuid makes the
 * path unique without the store's random suffix (the browser must know the
 * final pathname before it asks for a token: the presigned URL is signed for
 * exactly that path), and the readable name keeps the file recognisable in the
 * Vercel dashboard. The extension follows the content type, not the file name.
 */
export function uploadPathname(prefix: string, id: string, fileName: string, type: MediaContentType): string {
  const base = slugify(fileName.replace(/\.[^.]*$/, ''), 60) || 'file';
  return `${prefix}/media/${id}/${base}.${MEDIA_TYPES[type]}`;
}

/**
 * The content type an upload pathname commits to, or null when the path is not
 * one this environment hands out (another environment's folder, a path outside
 * media/, a traversal, an unknown extension).
 */
export function parseUploadPathname(prefix: string, pathname: string): MediaContentType | null {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^${escaped}/media/${UUID}/[a-z0-9]+(?:-[a-z0-9]+)*\\.(jpg|png|webp|avif|pdf)$`).exec(pathname);
  if (!match) return null;
  const ext = match[1];
  return MEDIA_CONTENT_TYPES.find((t) => MEDIA_TYPES[t] === ext) ?? null;
}

/**
 * The Blob host next/image may optimise (next.config.ts images.remotePatterns;
 * spec §6.3 item 7, §11), or null for none. The store is named by the build's
 * read-write token (vercel_blob_rw_<storeId>_<secret>, what connecting a store
 * to the project sets) or by BLOB_STORE_ID (store_<storeId>: a store connected
 * with OIDC only, lib/server/media/blob.ts), so a build that knows its store
 * serves that store's files only, never another store's public blobs. A Vercel
 * build that knows neither has no store: no Blob host at all, since every
 * store's host would make /_next/image a proxy for anyone's public files. Only
 * a build off Vercel (CI, a local build with the Blob variables blank, the
 * E2E app on the fake store) allows any public store's host. `*` is one DNS
 * label in remotePatterns
 * (node_modules/next/dist/docs/01-app/03-api-reference/02-components/image.md).
 */
export function blobImageHost(env: Record<string, string | undefined>): string | null {
  const fromToken = env.BLOB_READ_WRITE_TOKEN?.trim().split('_')[3];
  const fromStoreId = env.BLOB_STORE_ID?.trim().replace(/^store_/, '');
  for (const candidate of [fromToken, fromStoreId]) {
    const storeId = candidate?.toLowerCase();
    if (storeId && /^[a-z0-9]+$/.test(storeId)) return `${storeId}.public.blob.vercel-storage.com`;
  }
  return env.VERCEL === '1' ? null : '*.public.blob.vercel-storage.com';
}

/** Where scripts/move-assets-to-blob.mjs puts a public/assets file: `<env>/assets/<file>`. */
export function movedAssetPathname(prefix: string, staticPathname: string): string {
  return `${prefix}${staticPathname}`;
}
