import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { imageSize, jpegIsRotated } from './image-size';

const asset = (name: string) => new Uint8Array(readFileSync(`public/assets/${name}`));

/** A JPEG made of an EXIF segment (big-endian TIFF, one IFD entry: orientation) and a start of scan. */
function exifJpeg(orientation: number): Uint8Array {
  const tiff = [0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, 0, 0, 0, 0];
  const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const length = body.length + 2;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, length >> 8, length & 0xff, ...body, 0xff, 0xda, 0, 2]);
}

describe('imageSize', () => {
  it('reads the size of the JPEG assets as macOS sips reports it (wide, tall, odd)', () => {
    expect(imageSize(asset('hero-beach.jpg'))).toEqual({ contentType: 'image/jpeg', width: 906, height: 515 });
    expect(imageSize(asset('dest-dining-house.jpg'))).toEqual({ contentType: 'image/jpeg', width: 616, height: 960 });
    expect(imageSize(asset('r-hai-van-lounge.jpg'))).toEqual({ contentType: 'image/jpeg', width: 126, height: 94 });
    expect(imageSize(asset('cuisine-hotpot.jpg'))).toEqual({ contentType: 'image/jpeg', width: 45, height: 45 });
  });

  it('reads a PNG header', () => {
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    png.set([0, 0, 0x05, 0x00, 0, 0, 0x02, 0xd0], 16); // 1280 × 720
    expect(imageSize(png)).toEqual({ contentType: 'image/png', width: 1280, height: 720 });
  });

  it('gives up on anything else', () => {
    expect(imageSize(new TextEncoder().encode('%PDF-1.7 …'))).toBeNull();
    expect(imageSize(new Uint8Array([0xff, 0xd8, 0x00]))).toBeNull();
  });
});

describe('jpegIsRotated', () => {
  it('sees an EXIF orientation that swaps the displayed size, and none in the assets', () => {
    expect(jpegIsRotated(exifJpeg(6))).toBe(true);
    expect(jpegIsRotated(exifJpeg(1))).toBe(false);
    expect(jpegIsRotated(asset('hero-beach.jpg'))).toBe(false);
  });
});
