import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { measureMedia } from './measure';

const asset = (name: string) => new Uint8Array(readFileSync(join(process.cwd(), 'public', 'assets', name)));
async function encode(format: 'png' | 'webp' | 'avif' | 'jpeg', w: number, h: number): Promise<Uint8Array> {
  const image = sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 120, b: 40 } } });
  return new Uint8Array(await image.toFormat(format).toBuffer());
}

describe('measureMedia', () => {
  it('measures a real asset and draws a small WebP blur', async () => {
    const m = await measureMedia(asset('chef.jpg'), 'image/jpeg');
    expect(m).toMatchObject({ contentType: 'image/jpeg', width: 456, height: 378, bytes: 57833 });
    if ('error' in m) throw new Error(m.error);
    expect(m.blurDataUrl).toMatch(/^data:image\/webp;base64,[A-Za-z0-9+/=]+$/);
    expect(m.blurDataUrl!.length).toBeLessThan(1000);
    // Decodes, and stays within 16 px a side with the picture's aspect.
    const blur = await sharp(Buffer.from(m.blurDataUrl!.split(',')[1], 'base64')).metadata();
    expect([blur.width, blur.height]).toEqual([16, 13]);
  });

  it('reads png, webp and avif, each only as itself', async () => {
    expect(await measureMedia(await encode('png', 40, 30), 'image/png')).toMatchObject({ width: 40, height: 30 });
    expect(await measureMedia(await encode('webp', 30, 40), 'image/webp')).toMatchObject({ width: 30, height: 40 });
    expect(await measureMedia(await encode('avif', 64, 32), 'image/avif')).toMatchObject({ width: 64, height: 32, contentType: 'image/avif' });
    expect(await measureMedia(await encode('png', 40, 30), 'image/jpeg')).toEqual({ error: 'type_mismatch' });
    expect(await measureMedia(await encode('webp', 40, 30), 'image/avif')).toEqual({ error: 'type_mismatch' });
  });

  it('applies EXIF orientation: a quarter-turned photo is measured as it is shown', async () => {
    const rotated = new Uint8Array(
      await sharp({ create: { width: 60, height: 20, channels: 3, background: '#888' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer(),
    );
    expect(await measureMedia(rotated, 'image/jpeg')).toMatchObject({ width: 20, height: 60 });
  });

  it('accepts a PDF by its signature, with no size and no blur, and refuses a fake one', async () => {
    const pdf = new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');
    expect(await measureMedia(pdf, 'application/pdf')).toEqual({ contentType: 'application/pdf', bytes: pdf.byteLength, width: null, height: null, blurDataUrl: null });
    expect(await measureMedia(new TextEncoder().encode('<html>'), 'application/pdf')).toEqual({ error: 'type_mismatch' });
    expect(await measureMedia(pdf, 'image/jpeg')).toEqual({ error: 'type_mismatch' });
  });

  it('refuses a picture over 50 megapixels before decoding it (outline §4.7, risk 2)', async () => {
    const huge = new Uint8Array(await sharp({ create: { width: 8000, height: 6400, channels: 3, background: '#888' } }).jpeg({ quality: 10 }).toBuffer());
    expect(huge.byteLength).toBeLessThan(15 * 1024 * 1024);
    expect(await measureMedia(huge, 'image/jpeg')).toEqual({ error: 'too_large' });
  });

  it('refuses garbage, a truncated image and an empty file', async () => {
    expect(await measureMedia(new TextEncoder().encode('not an image at all'), 'image/png')).toEqual({ error: 'unreadable' });
    const chef = asset('chef.jpg');
    expect(await measureMedia(chef.subarray(0, 4000), 'image/jpeg')).toMatchObject({ error: expect.stringMatching(/unreadable/) });
    expect(await measureMedia(new Uint8Array(0), 'image/png')).toEqual({ error: 'unreadable' });
    expect(await measureMedia(new Uint8Array(15 * 1024 * 1024 + 1), 'image/png')).toEqual({ error: 'too_large' });
  });
});
