import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/*
 * A local stand-in for Vercel Blob, for tests: never the real service. It
 * speaks the wire protocol @vercel/blob 2.8 uses (read from
 * node_modules/@vercel/blob/dist: requestApi, put, head, list, del,
 * issueSignedToken, presign/canonicalString), keeps files in memory, and
 * records every request so a test can assert what the app sent.
 *
 * Two faces, one port:
 *   /api/blob/…  the control-plane API (the SDK's VERCEL_BLOB_API_URL, by
 *                default https://vercel.com/api/blob)
 *   /cdn/<path>  the public file host (https://<store>.public.blob.vercel-storage.com/<path>)
 * test/helpers/blob-redirect.mjs points a Node process's fetch at it, and the
 * E2E browser reaches it through Playwright routes.
 *
 * What it enforces, like the real API: a read-write bearer token for server
 * calls; for a presigned PUT, the delegation token it issued (its own HMAC),
 * the operation, pathname scope and expiry, and the client signature over the
 * canonical string; the size and content-type limits; no overwrite unless
 * allowed. Erasable TypeScript only: `node` runs this file directly
 * (test/helpers/fake-blob-cli.mjs).
 */

export type StoredFile = { pathname: string; contentType: string; bytes: Buffer; uploadedAt: Date };

export type RecordedRequest = {
  method: string;
  /** '/api/blob…' or '/cdn/…' */
  path: string;
  query: Record<string, string>;
  /** 'bearer:<token>' | 'presigned' | 'none' */
  auth: string;
  status: number;
};

export type FakeBlob = {
  url: string;
  storeId: string;
  /** A read-write token the fake accepts (vercel_blob_rw_<storeId>_<secret>). */
  token: string;
  files: Map<string, StoredFile>;
  requests: RecordedRequest[];
  publicUrl: (pathname: string) => string;
  /** Stores a file directly (as if uploaded earlier). */
  seed: (pathname: string, bytes: Uint8Array, contentType: string, uploadedAt?: Date) => void;
  close: () => Promise<void>;
};

const API = '/api/blob';
const CANONICAL_KEYS = [
  'vercel-blob-add-random-suffix',
  'vercel-blob-allow-overwrite',
  'vercel-blob-allowed-content-types',
  'vercel-blob-cache-control-max-age',
  'vercel-blob-callback-token-payload',
  'vercel-blob-callback-url',
  'vercel-blob-if-match',
  'vercel-blob-maximum-size-in-bytes',
  'vercel-blob-valid-until',
];
const EXT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  pdf: 'application/pdf',
  txt: 'text/plain',
};

const b64url = (buf: Buffer | string) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const hmac = (key: string, data: string) => b64url(createHmac('sha256', key).update(data).digest());

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function compareUtf8(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += (chunk as Buffer).length;
    if (total > limit) return null;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): number {
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, PUT, POST, DELETE, OPTIONS',
    'access-control-allow-headers': '*',
    'access-control-expose-headers': '*',
    ...headers,
  });
  res.end(JSON.stringify(body));
  return status;
}

const apiError = (res: ServerResponse, status: number, code: string, message: string) => send(res, status, { error: { code, message } });

export async function startFakeBlob(options: { port?: number; storeId?: string; secret?: string } = {}): Promise<FakeBlob> {
  const storeId = options.storeId ?? 'fakestore';
  // Alphanumeric: the SDK reads the store id as the token's fourth '_' field.
  const secret = options.secret ?? randomBytes(12).toString('hex');
  const token = `vercel_blob_rw_${storeId}_${secret}`;
  /** The store's signing secret: delegation tokens and client signing keys derive from it. */
  const signingSecret = randomBytes(32).toString('hex');
  const files = new Map<string, StoredFile>();
  const requests: RecordedRequest[] = [];
  const publicUrl = (pathname: string) => `https://${storeId}.public.blob.vercel-storage.com/${pathname}`;

  const describe = (f: StoredFile) => ({
    url: publicUrl(f.pathname),
    downloadUrl: `${publicUrl(f.pathname)}?download=1`,
    pathname: f.pathname,
    contentType: f.contentType,
    contentDisposition: `inline; filename="${f.pathname.split('/').pop()}"`,
    size: f.bytes.length,
    uploadedAt: f.uploadedAt.toISOString(),
    cacheControl: 'public, max-age=2592000',
    etag: `"${createHmac('sha1', 'etag').update(f.bytes).digest('hex')}"`,
  });

  const pathnameOf = (urlOrPathname: string) => {
    try {
      const u = new URL(urlOrPathname);
      return decodeURIComponent(u.pathname.slice(1));
    } catch {
      return urlOrPathname;
    }
  };

  /** Checks a presigned PUT; returns its effective limits, or an error message. */
  function verifyPresigned(pathname: string, q: URLSearchParams): { maxSize?: number; types?: string[]; overwrite: boolean } | string {
    const delegation = q.get('vercel-blob-delegation') ?? '';
    const signature = q.get('vercel-blob-signature') ?? '';
    const dot = delegation.indexOf('.');
    if (dot < 0) return 'bad delegation';
    const payloadSeg = delegation.slice(0, dot);
    if (!safeEqual(delegation.slice(dot + 1), hmac(signingSecret, payloadSeg))) return 'delegation not issued by this store';
    const scope = JSON.parse(fromB64url(payloadSeg).toString('utf8')) as {
      storeId: string;
      pathname?: string;
      operations?: string[];
      validUntil: number;
      maximumSizeInBytes?: number;
      allowedContentTypes?: string[];
    };
    if (scope.storeId !== storeId) return 'other store';
    if (!scope.operations?.includes('put')) return 'operation not delegated';
    if (scope.pathname && scope.pathname !== '*' && scope.pathname !== pathname) return 'pathname outside the delegation';
    const urlUntil = q.get('vercel-blob-valid-until');
    if (Date.now() > scope.validUntil || (urlUntil && Date.now() > Number(urlUntil))) return 'Token expired';
    const lines = [`operation=put`, `pathname=${pathname}`];
    for (const k of CANONICAL_KEYS) {
      const v = q.get(k);
      if (v) lines.push(`${k}=${v}`);
    }
    lines.sort(compareUtf8);
    const clientKey = hmac(signingSecret, delegation);
    if (!safeEqual(signature, hmac(clientKey, lines.join('\n')))) return 'bad signature';
    const urlMax = q.get('vercel-blob-maximum-size-in-bytes');
    const urlTypes = q.get('vercel-blob-allowed-content-types');
    return {
      maxSize: urlMax ? Number(urlMax) : scope.maximumSizeInBytes,
      types: urlTypes ? urlTypes.split(',') : scope.allowedContentTypes,
      overwrite: q.get('vercel-blob-allow-overwrite') === 'true',
    };
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<number> {
    const url = new URL(req.url ?? '/', 'http://fake');
    const q = url.searchParams;
    if (req.method === 'OPTIONS') return send(res, 204, {});

    // ── test hooks ────────────────────────────────────────────────────────
    if (url.pathname === '/__fake/health') return send(res, 200, { ok: true, storeId });
    if (url.pathname === '/__fake/requests') return send(res, 200, requests);
    if (url.pathname === '/__fake/files') return send(res, 200, [...files.values()].map(describe));
    if (url.pathname === '/__fake/age' && req.method === 'POST') {
      const body = JSON.parse(((await readBody(req, 10_000)) ?? Buffer.from('{}')).toString()) as { pathname: string; hours: number };
      const f = files.get(body.pathname);
      if (!f) return send(res, 404, {});
      f.uploadedAt = new Date(Date.now() - body.hours * 3600_000);
      return send(res, 200, describe(f));
    }

    // ── the public host ───────────────────────────────────────────────────
    if (url.pathname.startsWith('/cdn/')) {
      const f = files.get(decodeURIComponent(url.pathname.slice('/cdn/'.length)));
      if (!f) {
        res.writeHead(404, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' });
        res.end('not found');
        return 404;
      }
      res.writeHead(200, {
        'content-type': f.contentType,
        'content-length': String(f.bytes.length),
        'last-modified': f.uploadedAt.toUTCString(),
        'cache-control': 'public, max-age=2592000',
        'access-control-allow-origin': '*',
      });
      res.end(f.bytes);
      return 200;
    }

    if (!url.pathname.startsWith(API)) return apiError(res, 404, 'not_found', 'unknown path');
    const sub = url.pathname.slice(API.length) || '/';
    const bearer = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    const hasRw = bearer !== '' && safeEqual(bearer, token);

    // PUT /?pathname=… : a server put (bearer) or a browser's presigned PUT.
    if (req.method === 'PUT' && (sub === '/' || sub === '')) {
      const pathname = q.get('pathname') ?? '';
      if (!pathname || pathname.includes('//')) return apiError(res, 400, 'bad_request', 'invalid pathname');
      let limits: { maxSize?: number; types?: string[]; overwrite: boolean };
      if (q.has('vercel-blob-delegation')) {
        const v = verifyPresigned(pathname, q);
        if (typeof v === 'string') return apiError(res, 403, v === 'Token expired' ? 'client_token_expired' : 'forbidden', v);
        limits = v;
      } else if (hasRw) {
        limits = { overwrite: req.headers['x-allow-overwrite'] === '1' };
      } else {
        return apiError(res, 403, 'forbidden', 'no credentials');
      }
      const ext = pathname.split('.').pop()?.toLowerCase() ?? '';
      const contentType = String(req.headers['x-content-type'] ?? EXT_TYPES[ext] ?? 'application/octet-stream');
      if (limits.types && !limits.types.includes(contentType)) {
        return apiError(res, 400, 'bad_request', `contentType ${contentType} is not allowed`);
      }
      const body = await readBody(req, limits.maxSize ?? 5 * 1024 ** 4);
      if (body === null) return apiError(res, 400, 'bad_request', `the file length cannot be greater than ${limits.maxSize}`);
      if (files.has(pathname) && !limits.overwrite) return apiError(res, 400, 'bad_request', 'This blob already exists');
      const file: StoredFile = { pathname, contentType, bytes: body, uploadedAt: new Date() };
      files.set(pathname, file);
      return send(res, 200, describe(file));
    }

    if (!hasRw) return apiError(res, 403, 'forbidden', 'a read-write token is required');

    if (req.method === 'POST' && sub === '/signed-token') {
      const body = JSON.parse(((await readBody(req, 100_000)) ?? Buffer.from('{}')).toString()) as Record<string, unknown>;
      const validUntil = typeof body.validUntil === 'number' ? body.validUntil : Date.now() + 3600_000;
      const payload = {
        storeId,
        pathname: (body.pathname as string | undefined) ?? '*',
        operations: (body.operations as string[] | undefined) ?? ['get'],
        validUntil,
        ...(body.maximumSizeInBytes !== undefined ? { maximumSizeInBytes: body.maximumSizeInBytes } : {}),
        ...(body.allowedContentTypes !== undefined ? { allowedContentTypes: body.allowedContentTypes } : {}),
      };
      const payloadSeg = b64url(JSON.stringify(payload));
      const delegationToken = `${payloadSeg}.${hmac(signingSecret, payloadSeg)}`;
      return send(res, 200, { delegationToken, clientSigningToken: hmac(signingSecret, delegationToken), validUntil });
    }

    if (req.method === 'GET' && (sub === '/' || sub === '') && q.has('url')) {
      const f = files.get(pathnameOf(q.get('url')!));
      return f ? send(res, 200, describe(f)) : apiError(res, 404, 'not_found', 'The requested blob does not exist');
    }

    if (req.method === 'GET' && (sub === '/' || sub === '')) {
      const prefix = q.get('prefix') ?? '';
      const limit = Math.min(Number(q.get('limit') ?? 1000), 1000);
      const start = Number(q.get('cursor') ?? 0);
      const all = [...files.values()].filter((f) => f.pathname.startsWith(prefix)).sort((a, b) => compareUtf8(a.pathname, b.pathname));
      const page = all.slice(start, start + limit);
      const hasMore = start + limit < all.length;
      return send(res, 200, { blobs: page.map(describe), hasMore, ...(hasMore ? { cursor: String(start + limit) } : {}) });
    }

    if (req.method === 'POST' && sub === '/delete') {
      const body = JSON.parse(((await readBody(req, 1_000_000)) ?? Buffer.from('{}')).toString()) as { urls: string[] };
      for (const u of body.urls ?? []) files.delete(pathnameOf(u));
      return send(res, 200, {});
    }

    return apiError(res, 404, 'not_found', `unknown ${req.method} ${sub}`);
  }

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://fake');
    const authHeader = req.headers.authorization;
    const auth = authHeader ? `bearer:${authHeader.slice(7, 40)}` : url.searchParams.has('vercel-blob-delegation') ? 'presigned' : 'none';
    handle(req, res)
      .then((status) => {
        if (!url.pathname.startsWith('/__fake/')) {
          requests.push({ method: req.method ?? '', path: url.pathname, query: Object.fromEntries(url.searchParams), auth, status });
        }
      })
      .catch((err: unknown) => {
        requests.push({ method: req.method ?? '', path: url.pathname, query: Object.fromEntries(url.searchParams), auth, status: 500 });
        if (!res.headersSent) apiError(res, 500, 'unknown_error', err instanceof Error ? err.message : String(err));
      });
  });
  await new Promise<void>((resolve) => server.listen(options.port ?? 0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    storeId,
    token,
    files,
    requests,
    publicUrl,
    seed: (pathname, bytes, contentType, uploadedAt = new Date()) => {
      files.set(pathname, { pathname, contentType, bytes: Buffer.from(bytes), uploadedAt });
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
