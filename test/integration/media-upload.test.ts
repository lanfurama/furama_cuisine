import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { uploadPresigned } from '@vercel/blob/client';
import { getGlobalDispatcher } from 'undici';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { installBlobRedirect, refused } from '../helpers/blob-redirect.mjs';
import { startFakeBlob, type FakeBlob } from '../helpers/fake-blob';

/*
 * Upload step 1 end to end, in Node: @vercel/blob's own browser-side
 * uploadPresigned() asks the real route handler (app/api/admin/media/upload)
 * for a presigned URL, then PUTs the file to "https://vercel.com/api/blob",
 * which blob-redirect.mjs sends to the fake store. The fake checks the
 * delegation it issued and the client's signature exactly as the SDK computes
 * them, so this proves the token's limits are enforced by the store, not by
 * our client code. The session is mocked: the route's permission rule itself
 * is held by the CI guard and the E2E spec.
 */

const session = vi.hoisted(() => ({ result: 'ok' as 'ok' | 'unauthenticated' | 'forbidden' }));
vi.mock('@/lib/server/dal/session', () => {
  class PermissionError extends Error {
    constructor(readonly code: 'unauthenticated' | 'forbidden') {
      super(code);
    }
  }
  return {
    PermissionError,
    requirePermission: vi.fn(async () => {
      if (session.result !== 'ok') throw new PermissionError(session.result);
      return { userId: 'editor-1', email: 'editor@furama.test', name: 'Biên tập', role: 'editor', ip: null };
    }),
  };
});

let fake: FakeBlob;
let app: Server;
let origin: string;
const ID = '3f2b8c1e-5d4a-4b6c-9e7f-0a1b2c3d4e5f';
const path = (name: string) => `development/media/${ID}/${name}`;
const handleUploadUrl = () => `${origin}/api/admin/media/upload`;

describe('presigned upload: route handler + @vercel/blob client + fake store', () => {
  beforeAll(async () => {
    fake = await startFakeBlob();
    const before = getGlobalDispatcher();
    installBlobRedirect(fake.url);
    expect(getGlobalDispatcher()).not.toBe(before);
    process.env.BLOB_READ_WRITE_TOKEN = fake.token;
    process.env.VERCEL_BLOB_RETRIES = '0';
    delete process.env.VERCEL_OIDC_TOKEN;
    delete process.env.VERCEL_ENV;
    delete process.env.BLOB_WEBHOOK_PUBLIC_KEY;
    const { POST } = await import('@/app/api/admin/media/upload/route');
    app = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const request = new Request(`${origin}${req.url}`, {
        method: req.method,
        headers: Object.entries(req.headers).flatMap(([k, v]) => (typeof v === 'string' ? [[k, v] as [string, string]] : [])),
        body: req.method === 'GET' ? undefined : Buffer.concat(chunks),
      });
      const response = await POST(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    });
    await new Promise<void>((resolve) => app.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    await new Promise((r) => app.close(r));
    await fake.close();
    expect(refused).toEqual([]);
  });

  beforeEach(() => {
    session.result = 'ok';
    fake.files.clear();
    fake.requests.length = 0;
  });

  const upload = (pathname: string, body: Blob | Buffer, contentType?: string) =>
    uploadPresigned(pathname, body, { access: 'public', handleUploadUrl: handleUploadUrl(), headers: { origin }, ...(contentType ? { contentType } : {}) });

  it('uploads straight to the store with a URL signed for that one pathname', async () => {
    const result = await upload(path('terrace.png'), Buffer.from('fake png bytes'), 'image/png');
    expect(result).toMatchObject({ pathname: path('terrace.png'), url: `https://fakestore.public.blob.vercel-storage.com/${path('terrace.png')}` });
    expect(fake.files.get(path('terrace.png'))?.bytes.toString()).toBe('fake png bytes');
    expect(fake.requests.map((r) => `${r.method} ${r.path} ${r.auth.split(':')[0]} ${r.status}`)).toEqual([
      'POST /api/blob/signed-token bearer 200',
      'PUT /api/blob/ presigned 200',
    ]);
    // The browser's PUT carries no token at all, only the delegation and its signature.
    const put = fake.requests[1];
    expect(Object.keys(put.query).sort()).toEqual(['pathname', 'vercel-blob-delegation', 'vercel-blob-signature']);
  });

  it('the store refuses another content type, a file over 15 MB, and a second upload to the same path', async () => {
    await expect(upload(path('photo.jpg'), Buffer.from('x'), 'image/png')).rejects.toThrow(/content type|contentType/i);
    await expect(upload(path('big.jpg'), Buffer.alloc(15 * 1024 * 1024 + 1), 'image/jpeg')).rejects.toThrow(/too large|greater/i);
    await upload(path('once.webp'), Buffer.from('a'), 'image/webp');
    await expect(upload(path('once.webp'), Buffer.from('b'), 'image/webp')).rejects.toThrow();
    expect(fake.files.get(path('once.webp'))?.bytes.toString()).toBe('a');
  });

  it('a presigned URL works only for the path it was signed for', async () => {
    const res = await fetch(handleUploadUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ type: 'blob.generate-presigned-url', payload: { pathname: path('a.png'), multipart: false, clientPayload: null } }),
    });
    const { presignedUrlPayload } = (await res.json()) as { presignedUrlPayload: { delegationToken: string; signature: string; params: Record<string, string> } };
    const forged = new URL('https://vercel.com/api/blob/');
    forged.searchParams.set('pathname', path('b.png'));
    forged.searchParams.set('vercel-blob-delegation', presignedUrlPayload.delegationToken);
    forged.searchParams.set('vercel-blob-signature', presignedUrlPayload.signature);
    const put = await fetch(forged, { method: 'PUT', body: 'x', headers: { 'x-vercel-blob-access': 'public' } });
    expect(put.status).toBe(403);
    expect(fake.files.size).toBe(0);
  });

  it('issues nothing to a stranger, a role without content:update, another site, or a path this environment does not hand out', async () => {
    const ask = (pathname: string, headers: Record<string, string> = { origin }) =>
      fetch(handleUploadUrl(), {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ type: 'blob.generate-presigned-url', payload: { pathname, multipart: false, clientPayload: null } }),
      }).then(async (r) => [r.status, ((await r.json()) as { error?: string }).error]);

    session.result = 'unauthenticated';
    expect(await ask(path('x.png'))).toEqual([401, 'unauthenticated']);
    session.result = 'forbidden';
    expect(await ask(path('x.png'))).toEqual([403, 'forbidden']);
    session.result = 'ok';
    expect(await ask(path('x.png'), { origin: 'https://evil.test' })).toEqual([403, 'bad_origin']);
    expect(await ask(path('x.png'), {})).toEqual([403, 'bad_origin']);
    for (const bad of [`production/media/${ID}/x.png`, `development/media/${ID}/x.gif`, `development/assets/x.png`, `development/media/${ID}/../../x.png`]) {
      expect(await ask(bad)).toEqual([400, 'invalid_pathname']);
    }
    // Vercel's completion callback is not accepted here (no session, and not this route's job).
    const callback = await fetch(handleUploadUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ type: 'blob.upload-completed', payload: { blob: { pathname: path('x.png') }, tokenPayload: null } }),
    });
    expect(callback.status).toBe(400);
    // None of these reached the store.
    expect(fake.requests).toEqual([]);
  });
});
