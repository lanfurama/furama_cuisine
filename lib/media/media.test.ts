import { describe, expect, it } from 'vitest';
import { parseFilmUrl } from './film';
import { MAX_UPLOAD_BYTES, blobEnvPrefix, blobImageHost, isMediaContentType, movedAssetPathname, parseUploadPathname, slugify, uploadPathname } from './rules';

const ID = '3f2b8c1e-5d4a-4b6c-9e7f-0a1b2c3d4e5f';

describe('blobEnvPrefix', () => {
  it('gives production, each preview branch and local development folders of their own', () => {
    expect(blobEnvPrefix({ VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'main' })).toBe('production');
    expect(blobEnvPrefix({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'feat/Ảnh mới_2' })).toBe('preview/feat-anh-moi-2');
    expect(blobEnvPrefix({ VERCEL_ENV: 'preview' })).toBe('preview/unknown');
    expect(blobEnvPrefix({ VERCEL_ENV: 'development' })).toBe('development');
    expect(blobEnvPrefix({})).toBe('development');
  });
});

describe('blobImageHost', () => {
  it('lets next/image fetch from this store only when the build knows its token or its store id', () => {
    expect(blobImageHost({ BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_AbC123xyz_secretpart' })).toBe('abc123xyz.public.blob.vercel-storage.com');
    expect(blobImageHost({ BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_AbC123xyz_secretpart', VERCEL: '1' })).toBe('abc123xyz.public.blob.vercel-storage.com');
    // A store connected with OIDC only (lib/server/media/blob.ts blobCredentials).
    expect(blobImageHost({ BLOB_STORE_ID: 'store_AbC1', VERCEL: '1' })).toBe('abc1.public.blob.vercel-storage.com');
  });

  it('a Vercel build that names no store allows no Blob host; only a build off Vercel (CI, local, the fake) allows any public store', () => {
    expect(blobImageHost({ VERCEL: '1' })).toBeNull();
    expect(blobImageHost({ VERCEL: '1', BLOB_READ_WRITE_TOKEN: '', BLOB_STORE_ID: '' })).toBeNull();
    expect(blobImageHost({})).toBe('*.public.blob.vercel-storage.com');
    expect(blobImageHost({ BLOB_READ_WRITE_TOKEN: '' })).toBe('*.public.blob.vercel-storage.com');
    // A value that does not name a store in the expected shape never widens or bends the host.
    expect(blobImageHost({ BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_evil.example.com_x', VERCEL: '1' })).toBeNull();
    expect(blobImageHost({ BLOB_STORE_ID: 'store_evil.example.com', VERCEL: '1' })).toBeNull();
    expect(blobImageHost({ BLOB_READ_WRITE_TOKEN: 'not-a-token' })).toBe('*.public.blob.vercel-storage.com');
  });
});

describe('upload pathnames', () => {
  it('names the file after its slug and its type, under the environment folder', () => {
    expect(uploadPathname('production', ID, 'Phở Bò  (final).JPEG', 'image/jpeg')).toBe(`production/media/${ID}/pho-bo-final.jpg`);
    expect(uploadPathname('development', ID, '.png', 'image/png')).toBe(`development/media/${ID}/file.png`);
    expect(uploadPathname('preview/x', ID, 'Menu 2026.pdf', 'application/pdf')).toBe(`preview/x/media/${ID}/menu-2026.pdf`);
  });

  it('accepts only this environment’s paths, and reads the type from the extension', () => {
    expect(parseUploadPathname('production', `production/media/${ID}/pho-bo.jpg`)).toBe('image/jpeg');
    expect(parseUploadPathname('production', `production/media/${ID}/menu.pdf`)).toBe('application/pdf');
    expect(parseUploadPathname('preview/a', `preview/a/media/${ID}/x.avif`)).toBe('image/avif');
    for (const bad of [
      `development/media/${ID}/pho-bo.jpg`, // another environment
      `production/media/${ID}/pho-bo.gif`,
      `production/media/${ID}/../x.jpg`,
      `production/media/${ID}/Pho.jpg`,
      `production/media/not-a-uuid/x.jpg`,
      `production/assets/x.jpg`,
      `production/media/${ID}/x.jpg?y`,
      `/production/media/${ID}/x.jpg`,
    ]) {
      expect(parseUploadPathname('production', bad), bad).toBeNull();
    }
    // A prefix with regex characters is matched literally.
    expect(parseUploadPathname('preview/a.b', `preview/aXb/media/${ID}/x.jpg`)).toBeNull();
  });

  it('moves a static file under the environment folder with its own name', () => {
    expect(movedAssetPathname('production', '/assets/chef.jpg')).toBe('production/assets/chef.jpg');
  });

  it('knows the five types and the 15 MB cap', () => {
    expect(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'application/pdf'].every(isMediaContentType)).toBe(true);
    expect(isMediaContentType('image/gif')).toBe(false);
    expect(isMediaContentType('toString')).toBe(false);
    expect(MAX_UPLOAD_BYTES).toBe(15728640);
    expect(slugify('Đà Nẵng — Phố cổ')).toBe('da-nang-pho-co');
  });
});

describe('parseFilmUrl', () => {
  it('turns YouTube links into a no-cookie embed', () => {
    for (const url of [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10',
      'https://youtube.com/watch?v=dQw4w9WgXcQ',
      'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ?si=abc',
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
      'https://www.youtube.com/shorts/dQw4w9WgXcQ',
    ]) {
      expect(parseFilmUrl(url), url).toEqual({
        provider: 'youtube',
        id: 'dQw4w9WgXcQ',
        embedUrl: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0',
      });
    }
  });

  it('turns Vimeo links into a do-not-track player URL, keeping an unlisted hash', () => {
    expect(parseFilmUrl('https://vimeo.com/76979871')?.embedUrl).toBe('https://player.vimeo.com/video/76979871?autoplay=1&dnt=1');
    expect(parseFilmUrl('https://vimeo.com/76979871/8272103f6e')?.embedUrl).toBe(
      'https://player.vimeo.com/video/76979871?autoplay=1&dnt=1&h=8272103f6e',
    );
    expect(parseFilmUrl('https://player.vimeo.com/video/76979871?h=8272103f6e')?.embedUrl).toBe(
      'https://player.vimeo.com/video/76979871?autoplay=1&dnt=1&h=8272103f6e',
    );
  });

  it('refuses anything that does not name one video on those two sites', () => {
    for (const url of [
      null,
      '',
      'not a url',
      'http://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://www.youtube.com/watch?v=short',
      'https://www.youtube.com/@channel',
      'https://www.youtube.com.evil.test/watch?v=dQw4w9WgXcQ',
      'https://user@youtu.be/dQw4w9WgXcQ',
      'https://youtu.be:8443/dQw4w9WgXcQ',
      'https://vimeo.com/channels/staffpicks',
      'https://player.vimeo.com/76979871',
      'https://example.com/video.mp4',
      'javascript:alert(1)',
    ]) {
      expect(parseFilmUrl(url), String(url)).toBeNull();
    }
  });
});
