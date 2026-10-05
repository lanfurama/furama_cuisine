import 'server-only';
import sharp, { type Metadata } from 'sharp';
import { MAX_UPLOAD_BYTES, type MediaContentType } from '@/lib/media/rules';

/*
 * What registerMedia stores about a file (spec §5.2 media: width, height,
 * bytes, blur_data_url), read from the bytes themselves, never from what the
 * browser said. sharp is the image library next/image already uses on the
 * server (a dependency of next, external to the server bundle:
 * node_modules/next/dist/lib/server-external-packages.jsonc).
 */

export type Measured = {
  contentType: MediaContentType;
  bytes: number;
  /** Displayed size: EXIF orientation applied, as a browser draws it. Null for a PDF. */
  width: number | null;
  height: number | null;
  /** A ≤16 px WebP for next/image's placeholder="blur"; null for a PDF. */
  blurDataUrl: string | null;
};

export type MeasureFailure = 'type_mismatch' | 'unreadable' | 'too_large';

const SHARP_FORMAT: Record<string, MediaContentType> = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

/** 20 000 px a side: media_dimensions' CHECK (008). */
const MAX_SIDE = 20_000;

/**
 * 50 megapixels (outline §4.7): what one function may decode. 15 MB of a
 * well-compressed file can hold far more pixels than that, and decoding them
 * for the blur would take the function's memory (risk 2). The header is read
 * without the limit, so such a file is answered "too large", not
 * "unreadable"; the decode itself runs with sharp's limitInputPixels.
 */
export const MAX_PIXELS = 50_000_000;

function isPdf(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
}

/**
 * Measures `bytes`, which must really be `expected` (the type the pathname's
 * extension and the upload token committed to): a PNG renamed .jpg, or an
 * HTML file named .pdf, is refused.
 */
export async function measureMedia(bytes: Uint8Array, expected: MediaContentType): Promise<Measured | { error: MeasureFailure }> {
  if (bytes.byteLength === 0) return { error: 'unreadable' };
  if (bytes.byteLength > MAX_UPLOAD_BYTES) return { error: 'too_large' };
  if (expected === 'application/pdf') {
    return isPdf(bytes)
      ? { contentType: expected, bytes: bytes.byteLength, width: null, height: null, blurDataUrl: null }
      : { error: 'type_mismatch' };
  }
  let meta: Metadata;
  try {
    // failOn 'error': a truncated upload is refused rather than measured from its header.
    meta = await sharp(bytes, { failOn: 'error' }).metadata();
  } catch {
    return isPdf(bytes) ? { error: 'type_mismatch' } : { error: 'unreadable' };
  }
  const actual = meta.format === 'heif' && meta.compression === 'av1' ? 'image/avif' : SHARP_FORMAT[meta.format];
  if (actual !== expected) return { error: 'type_mismatch' };
  const { width, height } = meta.autoOrient;
  if (!(width >= 1 && height >= 1)) return { error: 'unreadable' };
  if (width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS) return { error: 'too_large' };
  let blur: Buffer;
  try {
    blur = await sharp(bytes, { failOn: 'error', limitInputPixels: MAX_PIXELS })
      .autoOrient()
      .resize(16, 16, { fit: 'inside' })
      .webp({ quality: 50 })
      .toBuffer();
  } catch {
    return { error: 'unreadable' };
  }
  const blurDataUrl = `data:image/webp;base64,${blur.toString('base64')}`;
  // media.blur_data_url CHECK: ≤ 4000 characters. A 16 px WebP is a few hundred.
  return {
    contentType: expected,
    bytes: bytes.byteLength,
    width,
    height,
    blurDataUrl: blurDataUrl.length <= 4000 ? blurDataUrl : null,
  };
}
