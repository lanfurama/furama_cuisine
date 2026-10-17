import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { ALT_EDGE, ALT_MAX, cleanAlt, fitWords, shrinkForAi } from './alt';

/*
 * Phase 9 D11 (spec §9.3): what leaves for the model is a JPEG no larger than
 * about 1024 px, and what comes back fits media_i18n.alt (≤ 250 characters,
 * not blank), cut at a word. The calls themselves are tested against the
 * database (test/integration/ai-alt.test.ts).
 */

describe('shrinkForAi', () => {
  it('turns a 3000×2000 PNG into a JPEG whose long edge is 1024', async () => {
    const png = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#2f6b4f' } }).png().toBuffer();
    const out = await shrinkForAi(png);
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe('jpeg');
    expect(Math.max(meta.width!, meta.height!)).toBe(ALT_EDGE);
    expect(meta.width! / meta.height!).toBeCloseTo(1.5, 1);
  });

  it('never enlarges a small picture, and follows its EXIF orientation', async () => {
    // 200×100 stored, orientation 6 (rotate 90°): the model sees it upright, 100×200.
    const jpeg = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#c86428' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const meta = await sharp(await shrinkForAi(jpeg)).metadata();
    expect([meta.width, meta.height]).toEqual([100, 200]);
  });

  it('puts transparency on white (JPEG has no alpha)', async () => {
    const png = await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const { data } = await sharp(await shrinkForAi(png)).raw().toBuffer({ resolveWithObject: true });
    expect([data[0], data[1], data[2]].every((v) => v >= 250)).toBe(true);
  });

  it('refuses bytes that are not a picture', async () => {
    await expect(shrinkForAi(new TextEncoder().encode('%PDF-1.7'))).rejects.toThrow();
  });
});

describe('cleanAlt / fitWords', () => {
  it('keeps one plain line: no quotes around it, no line breaks or runs of spaces', () => {
    expect(cleanAlt('  "A table set for two\n on the  terrace at dusk."  ')).toBe('A table set for two on the terrace at dusk.');
    expect(cleanAlt('“Grilled prawns.”')).toBe('Grilled prawns.');
    expect(cleanAlt(' \n ')).toBe('');
  });

  it('drops control and format characters (a NUL, a bidi override), keeping words apart', () => {
    expect(cleanAlt('Grilled\u0000 prawns\u202E on ice\u200B.')).toBe('Grilled prawns on ice.');
    expect(cleanAlt('Two\tglasses\r\nof wine')).toBe('Two glasses of wine');
  });

  it('cuts past 250 characters at the last whole word', () => {
    const long = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ');
    const fitted = cleanAlt(long);
    expect([...fitted].length).toBeLessThanOrEqual(ALT_MAX);
    expect(long.startsWith(fitted)).toBe(true);
    expect(long[fitted.length]).toBe(' ');
  });

  it('counts characters, not UTF-16 units, and cuts a word with no space at the limit', () => {
    expect(fitWords('Bàn ăn ven biển', 9)).toBe('Bàn ăn');
    expect(fitWords('abcdefghij', 4)).toBe('abcd');
    expect(fitWords('short', 250)).toBe('short');
    expect(fitWords('a b, c', 5)).toBe('a b');
  });
});
