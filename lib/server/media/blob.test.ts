import { getGlobalDispatcher } from 'undici';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { installBlobRedirect, refused } from '@/test/helpers/blob-redirect.mjs';
import { startFakeBlob, type FakeBlob } from '@/test/helpers/fake-blob';
import { BlobNotConfiguredError, blobCredentials, deleteBlobs, downloadBlob, headBlob, isBlobConfigured, issueUploadToken, listBlobs } from './blob';

/*
 * The one rule every Vercel Blob call of the app goes through (spec §11;
 * outline F13): credentials are always explicit, and without them nothing is
 * sent. Left to itself, the SDK would fall back to an OIDC token that
 * @vercel/oidc mints through the Vercel API on a linked checkout.
 */

describe('blobCredentials', () => {
  it('uses the read-write token when the environment has one', () => {
    expect(blobCredentials({ BLOB_READ_WRITE_TOKEN: ' vercel_blob_rw_store1_x ' })).toEqual({ token: 'vercel_blob_rw_store1_x' });
    // The token wins over a store id, on Vercel or not.
    expect(blobCredentials({ BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_store1_x', BLOB_STORE_ID: 'store2', VERCEL: '1' })).toEqual({
      token: 'vercel_blob_rw_store1_x',
    });
  });

  it('uses the store id only on Vercel, where the function has its own OIDC token', () => {
    expect(blobCredentials({ BLOB_STORE_ID: 'store2', VERCEL: '1' })).toEqual({ storeId: 'store2' });
    // A local run with only a store id would make the SDK mint a token through the Vercel API: refused.
    expect(() => blobCredentials({ BLOB_STORE_ID: 'store2' })).toThrow(BlobNotConfiguredError);
    expect(() => blobCredentials({ BLOB_STORE_ID: 'store2', VERCEL_OIDC_TOKEN: 'x' })).toThrow(BlobNotConfiguredError);
  });

  it('is "not configured" with nothing, or with blanks (the local prefix blanks every Blob variable)', () => {
    for (const env of [{}, { BLOB_READ_WRITE_TOKEN: '', BLOB_STORE_ID: '' }, { BLOB_READ_WRITE_TOKEN: '  ', VERCEL: '1' }]) {
      expect(() => blobCredentials(env)).toThrow(BlobNotConfiguredError);
      expect(isBlobConfigured(env)).toBe(false);
    }
    expect(isBlobConfigured({ BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_store1_x' })).toBe(true);
  });
});

describe('downloadBlob', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reads only from a public Vercel Blob host, and sends nothing anywhere else', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    for (const url of [
      'https://example.com/a.png',
      'https://public.blob.vercel-storage.com.evil.test/a.png',
      'http://127.0.0.1/a.png',
      'http://store1.public.blob.vercel-storage.com/a.png',
    ]) {
      await expect(downloadBlob(url)).rejects.toThrow('not a public Vercel Blob URL');
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('never follows a redirect: the bytes come from the Blob host or not at all', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new Uint8Array(1)));
    await downloadBlob('https://store1.public.blob.vercel-storage.com/a.png');
    expect(String(fetch.mock.calls[0][0])).toBe('https://store1.public.blob.vercel-storage.com/a.png');
    expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: 'error' });
  });

  it('stops reading past the cap', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new Uint8Array(11)));
    await expect(downloadBlob('https://store1.public.blob.vercel-storage.com/a.png', 10)).rejects.toThrow('blob larger than the upload cap');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new Uint8Array(10).fill(7)));
    expect(await downloadBlob('https://store1.public.blob.vercel-storage.com/a.png', 10)).toEqual(new Uint8Array(10).fill(7));
  });
});

/*
 * The gateway against the local fake store (test/helpers/fake-blob.ts), with
 * blob-redirect.mjs installed as Playwright's app server has it: every call
 * lands on the fake, with the read-write token, and nothing else leaves the
 * process. Never the real service.
 */
describe('the gateway against the fake store', () => {
  let fake: FakeBlob;
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

  beforeAll(async () => {
    fake = await startFakeBlob();
    const before = getGlobalDispatcher();
    installBlobRedirect(fake.url);
    // In place before any call: otherwise the first one would go to vercel.com.
    expect(getGlobalDispatcher()).not.toBe(before);
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', fake.token);
    vi.stubEnv('VERCEL_BLOB_RETRIES', '0');
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await fake.close();
    expect(refused).toEqual([]);
  });

  it('heads, lists by folder, reads and deletes, always with the bearer token', async () => {
    fake.seed('development/media/a/one.png', png, 'image/png');
    fake.seed('development/media/b/two.png', png, 'image/png');
    fake.seed('production/media/c/three.png', png, 'image/png');

    expect(await headBlob('development/media/missing.png')).toBeNull();
    const one = await headBlob('development/media/a/one.png');
    expect(one).toMatchObject({ pathname: 'development/media/a/one.png', url: fake.publicUrl('development/media/a/one.png'), size: 4, contentType: 'image/png' });

    const listed: string[] = [];
    for await (const b of listBlobs('development/')) listed.push(b.pathname);
    expect(listed).toEqual(['development/media/a/one.png', 'development/media/b/two.png']);

    // The bytes come from the public host, which only the redirect points at the fake.
    expect(await downloadBlob(one!.url)).toEqual(png);

    await deleteBlobs([one!.url]);
    await deleteBlobs([]);
    expect([...fake.files.keys()].sort()).toEqual(['development/media/b/two.png', 'production/media/c/three.png']);
    expect(fake.requests.filter((r) => r.path.startsWith('/api/blob')).every((r) => r.auth === `bearer:${fake.token.slice(0, 33)}`)).toBe(true);
  });

  it('issues an upload delegation for one pathname, one type, 15 MB and ten minutes', async () => {
    const issued = await issueUploadToken('development/media/d/four.webp', 'image/webp');
    const scope = JSON.parse(Buffer.from(issued.delegationToken.split('.')[0], 'base64url').toString());
    expect(scope).toMatchObject({ pathname: 'development/media/d/four.webp', operations: ['put'], maximumSizeInBytes: 15728640, allowedContentTypes: ['image/webp'] });
    expect(scope.validUntil - Date.now()).toBeGreaterThan(9 * 60_000);
    expect(scope.validUntil - Date.now()).toBeLessThanOrEqual(10 * 60_000);
  });

  it('refuses every other host this process tries to reach', async () => {
    await expect(fetch('https://example.com/')).rejects.toThrow();
    expect(refused.splice(0)).toEqual(['GET https://example.com/']);
  });
});
