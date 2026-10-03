/**
 * Reads an image's pixel size from its header, with no dependency, for the
 * files under public/assets (spec §5.2 media.width/height). Erasable syntax
 * only and no imports: scripts/measure-assets.mjs loads this file directly
 * through Node's type stripping, and the content-seed test imports it, so the
 * migration's numbers and the test's check come from the same reader.
 * JPEG and PNG only: that is every static asset today. Uploads (phase 7) are
 * measured by the upload path, not here.
 */

export type ImageSize = { contentType: 'image/jpeg' | 'image/png'; width: number; height: number };

export function imageSize(bytes: Uint8Array): ImageSize | null {
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // IHDR is always the first chunk: width and height at bytes 16 and 20.
    return { contentType: 'image/png', width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) return jpegSize(bytes);
  return null;
}

/**
 * Walks the JPEG segments to the first start-of-frame marker (SOF0–SOF15,
 * except DHT C4, JPG C8 and DAC CC), which carries the height then the width.
 * Ignores EXIF orientation on purpose: the browser applies it, so a rotated
 * file would need its width and height swapped. None of the assets has one
 * (`sips -g orientation`); the test pins that.
 */
function jpegSize(bytes: Uint8Array): ImageSize | null {
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1];
    // Fill bytes and markers without a length.
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    const length = (bytes[at + 2] << 8) | bytes[at + 3];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = (bytes[at + 5] << 8) | bytes[at + 6];
      const width = (bytes[at + 7] << 8) | bytes[at + 8];
      return width > 0 && height > 0 ? { contentType: 'image/jpeg', width, height } : null;
    }
    at += 2 + length;
  }
  return null;
}

/** True when a JPEG carries an EXIF orientation other than 1 (normal), which would swap the displayed size. */
export function jpegIsRotated(bytes: Uint8Array): boolean {
  let at = 2;
  while (at + 4 < bytes.length && bytes[at] === 0xff) {
    const marker = bytes[at + 1];
    const length = (bytes[at + 2] << 8) | bytes[at + 3];
    if (marker === 0xda) return false; // start of scan: no more metadata
    if (marker === 0xe1 && String.fromCharCode(...bytes.subarray(at + 4, at + 8)) === 'Exif') {
      const tiff = at + 10;
      const little = bytes[tiff] === 0x49;
      const u16 = (o: number) => (little ? bytes[o] | (bytes[o + 1] << 8) : (bytes[o] << 8) | bytes[o + 1]);
      const u32 = (o: number) => (little ? u16(o) | (u16(o + 2) << 16) : (u16(o) << 16) | u16(o + 2));
      const ifd = tiff + u32(tiff + 4);
      const count = u16(ifd);
      for (let i = 0; i < count; i++) {
        const entry = ifd + 2 + i * 12;
        if (u16(entry) === 0x0112) return u16(entry + 8) !== 1;
      }
      return false;
    }
    at += 2 + length;
  }
  return false;
}
