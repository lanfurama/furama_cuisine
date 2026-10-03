#!/usr/bin/env node
/**
 * Prints the `media` seed rows of migration 008 for every file in
 * public/assets: path, type, pixel size and byte count, measured from the files
 * themselves. The migration's VALUES block is this output pasted verbatim, so
 * re-running the script after an asset changes shows the drift, and
 * test/integration/content-seed.test.ts re-measures every file against the
 * database. Reads nothing else and writes nothing.
 *
 *   node scripts/measure-assets.mjs
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// Node strips the types of this .ts file itself (Node ≥ 22.18); it has no imports of its own.
import { imageSize, jpegIsRotated } from '../lib/media/image-size.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'public', 'assets');

const files = (await readdir(dir)).filter((f) => !f.startsWith('.')).sort();
const rows = [];
for (const file of files) {
  const bytes = new Uint8Array(await readFile(join(dir, file)));
  const size = imageSize(bytes);
  if (!size) throw new Error(`${file}: not a JPEG or PNG this script can measure`);
  if (size.contentType === 'image/jpeg' && jpegIsRotated(bytes)) {
    throw new Error(`${file}: EXIF orientation is set; store the displayed (rotated) size instead`);
  }
  rows.push(`    ('/assets/${file}', '${size.contentType}', ${size.width}, ${size.height}, ${bytes.length})`);
}
console.log(rows.join(',\n'));
