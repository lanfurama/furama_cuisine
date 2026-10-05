import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadSections } from '@/lib/server/content/site.queries';
import { TEST_DATABASE_URL } from '../helpers/db';
import { startFakeBlob, type FakeBlob } from '../helpers/fake-blob';

/*
 * scripts/move-assets-to-blob.mjs against the test database and the fake
 * store, run as the controller will run it (a separate Node process), with
 * blob-redirect.mjs preloaded so every request it makes lands on the fake:
 * dry run changes nothing; --apply uploads each public/assets file once and
 * repoints its row (same id), with blur placeholders and audit rows; a second
 * --apply does nothing. Never the real service: the child process gets the
 * fake's token and blob-redirect.mjs refuses every other host.
 */

const run = promisify(execFile);
let pool: Pool;
let fake: FakeBlob;

async function script(...args: string[]) {
  return run(process.execPath, ['--import', join(process.cwd(), 'test/helpers/blob-redirect.mjs'), 'scripts/move-assets-to-blob.mjs', ...args], {
    // A clean environment: only what pg needs to find the local server, and this test's own values.
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      USER: process.env.USER,
      DATABASE_URL: TEST_DATABASE_URL,
      BLOB_READ_WRITE_TOKEN: fake.token,
      FAKE_BLOB_ORIGIN: fake.url,
      VERCEL_BLOB_RETRIES: '0',
      NODE_ENV: 'test',
    },
  });
}

describe.skipIf(!TEST_DATABASE_URL)('move-assets-to-blob (test database + fake store)', () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
    fake = await startFakeBlob();
  });

  afterAll(async () => {
    // Back to 008's static rows, for the test files that follow.
    await pool.query(
      `UPDATE media SET storage = 'static', pathname = '/assets/' || regexp_replace(pathname, '^.*/', ''),
              url = '/assets/' || regexp_replace(pathname, '^.*/', ''), blur_data_url = NULL
        WHERE updated_by = 'script:move-assets-to-blob'`,
    );
    await pool.query(`DELETE FROM audit_log WHERE actor_email = 'script:move-assets-to-blob'`);
    await pool.end();
    await fake.close();
  });

  it('refuses a folder that is not production’s (or development’s): never a preview’s, whose rows are production’s', async () => {
    await expect(script('--prefix', 'prod')).rejects.toMatchObject({ code: 1 });
    await expect(script('--prefix', '../x', '--apply')).rejects.toMatchObject({ code: 1 });
    await expect(script('--prefix', 'preview/main', '--apply')).rejects.toMatchObject({ code: 1 });
    expect(fake.requests).toEqual([]);
  });

  it('dry run: lists every static file, changes nothing anywhere', async () => {
    const { rows: before } = await pool.query(`SELECT count(*)::int AS n FROM media WHERE storage = 'static'`);
    const { stdout } = await script('--prefix', 'production');
    expect(stdout).toContain(`DRY RUN: database localhost/`);
    expect(stdout).toContain(`  upload /assets/chef.jpg → production/assets/chef.jpg (57833 bytes)`);
    expect(stdout).toContain(`${before[0].n} static row(s); ${before[0].n} file(s) to upload.`);
    expect(fake.files.size).toBe(0);
    expect(fake.requests.every((r) => r.method === 'GET' && r.path === '/api/blob')).toBe(true);
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM media WHERE storage = 'static'`);
    expect(rows[0].n).toBe(before[0].n);
  });

  it('--apply: uploads each file byte for byte, repoints the same rows, and the guest loaders follow', async () => {
    const chef = (await pool.query<{ id: string }>(`SELECT id FROM media WHERE pathname = '/assets/chef.jpg'`)).rows[0].id;
    const { rows: statics } = await pool.query(`SELECT count(*)::int AS n FROM media WHERE storage = 'static'`);
    const { stdout } = await script('--prefix', 'production', '--apply');
    expect(stdout).toContain(`Updated ${statics[0].n} row(s).`);
    expect(fake.files.size).toBe(statics[0].n);
    expect(fake.files.get('production/assets/chef.jpg')!.bytes.equals(readFileSync(join(process.cwd(), 'public/assets/chef.jpg')))).toBe(true);
    expect(fake.files.get('production/assets/chef.jpg')!.contentType).toBe('image/jpeg');

    const row = (await pool.query(`SELECT storage, url, pathname, blur_data_url, width FROM media WHERE id = $1`, [chef])).rows[0];
    expect(row).toMatchObject({
      storage: 'blob',
      url: 'https://fakestore.public.blob.vercel-storage.com/production/assets/chef.jpg',
      pathname: 'production/assets/chef.jpg',
      width: 456,
    });
    expect(row.blur_data_url).toMatch(/^data:image\/webp;base64,/);
    // Its History row holds the file on either side as every media row does (an ItemSnapshot), the move marked.
    const { rows: moved } = await pool.query(`SELECT action, actor_id, before, after FROM audit_log WHERE actor_email = 'script:move-assets-to-blob' AND entity_id = $1`, [chef]);
    const alts = [expect.objectContaining({ locale: 'en', alt: 'A Furama chef at work' })];
    expect(moved).toEqual([
      {
        action: 'update',
        actor_id: null,
        before: { v: 1, row: expect.objectContaining({ id: chef, storage: 'static', url: '/assets/chef.jpg' }), i18n: alts },
        after: { v: 1, row: expect.objectContaining({ id: chef, storage: 'blob', url: row.url }), i18n: alts, meta: { moved_by: 'script:move-assets-to-blob' } },
      },
    ]);
    expect((await pool.query(`SELECT count(*)::int AS n FROM media WHERE storage = 'static'`)).rows[0].n).toBe(0);
    expect((await pool.query(`SELECT count(*)::int AS n FROM audit_log WHERE actor_email = 'script:move-assets-to-blob'`)).rows[0].n).toBe(statics[0].n);

    // The section that shows the chef now serves the Blob copy (same id, so every reference holds), with its placeholder.
    const sections = await loadSections('en');
    expect(sections.experiences.image).toMatchObject({ url: row.url, width: 456, height: 378, blur: row.blur_data_url });
  });

  it('a second --apply sends nothing and changes nothing', async () => {
    fake.requests.length = 0;
    const { stdout } = await script('--prefix', 'production', '--apply');
    expect(stdout).toContain('0 static row(s); 0 file(s) to upload, 0 uploaded.');
    expect(fake.requests).toEqual([]);
  });
});
