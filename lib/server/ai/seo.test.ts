import { describe, expect, it } from 'vitest';
import { fitWords, restoreNames } from './seo';

const count = (s: string) => [...s].length;

describe('fitWords (R9-22: a suggestion is cut at the last word boundary that still fits)', () => {
  it('leaves a text that fits as it is, trimmed and with single spaces', () => {
    expect(fitWords('  Tàya House —   Furama  ', 60)).toBe('Tàya House — Furama');
  });

  it('cuts at a word boundary, with no space or punctuation left at the end, and never passes the maximum', () => {
    const text = 'A wellness dining home by the sea, with plant-forward dishes, herbal teas and a quiet garden for long lunches.';
    const out = fitWords(text, 60);
    expect(count(out)).toBeLessThanOrEqual(60);
    expect(text.startsWith(out)).toBe(true);
    expect(out).toBe('A wellness dining home by the sea, with plant-forward');
    expect(fitWords('Fine dining, by the sea', 12)).toBe('Fine dining');
    expect(fitWords('Sea view — dinner tonight', 10)).toBe('Sea view');
    for (const max of [5, 17, 33, 60, 100]) {
      const cut = fitWords(text, max);
      expect(count(cut)).toBeLessThanOrEqual(max);
      expect(cut).not.toMatch(/[\s\p{P}]$/u);
    }
  });

  it('cuts a single word longer than the maximum hard', () => {
    expect(fitWords('Supercalifragilisticexpialidocious', 10)).toBe('Supercalif');
    expect(fitWords('x'.repeat(70), 60)).toBe('x'.repeat(60));
  });

  it('counts characters, not UTF-16 units, and compares in NFC', () => {
    const decomposed = 'Tàya House'.normalize('NFD');
    expect(fitWords(decomposed, 60)).toBe('Tàya House');
    expect(count(fitWords('Ẩm thực Việt Nam bên bờ biển Đà Nẵng', 20))).toBeLessThanOrEqual(20);
    expect(fitWords('Ẩm thực Việt Nam bên bờ biển Đà Nẵng', 20)).toBe('Ẩm thực Việt Nam bên');
  });

  it('drops control and invisible format characters, keeping the joiners (ZWJ, ZWNJ)', () => {
    expect(fitWords('Tàya\u202E House\u0007\u200B\u0000 by\u00ADthe\uFEFF sea', 60)).toBe('Tàya House bythe sea');
    expect(fitWords('Bếp\tnhà\nTàya', 60)).toBe('Bếp nhà Tàya');
    expect(fitWords('👩\u200D🍳 class, می\u200Cخواهم', 60)).toBe('👩\u200D🍳 class, می\u200Cخواهم');
  });

  it('cuts hard by whole graphemes, never inside an emoji sequence', () => {
    const family = '👩\u200D👩\u200D👧\u200D👦'; // 7 code points, one grapheme
    expect(fitWords(family + family, 10)).toBe(family);
    expect(fitWords('q\u0307'.repeat(6), 5)).toBe('q\u0307'.repeat(2));
  });

  it('never cuts inside a name it must keep: it cuts before the name instead', () => {
    expect(fitWords('Dinner at Tàya House tonight', 16, ['Tàya House'])).toBe('Dinner at');
    expect(fitWords('Dinner at Tàya House tonight', 20, ['Tàya House'])).toBe('Dinner at Tàya House');
    // A name that alone passes the maximum is cut hard like any long word.
    expect(fitWords('Tàya House', 6, ['Tàya House'])).toBe('Tàya H');
    // The names are read the way the text is: NFC, one space.
    expect(fitWords('Dinner at Tàya House tonight', 16, ['Ta\u0300ya   House'.normalize('NFD')])).toBe('Dinner at');
  });
});

describe('restoreNames (the masked names come back exactly as written)', () => {
  const masked = {
    text: '',
    tokens: [
      { token: '⟦G1⟧', restore: 'Tàya House' },
      { token: '⟦G2⟧', restore: 'Hai Van Lounge' },
      { token: '⟦V1⟧', restore: '{name}' },
    ],
  };

  it('puts every name back; the model may use any of them, once, twice or not at all', () => {
    expect(restoreNames('⟦G1⟧ — dinner by the sea', masked)).toEqual({ ok: true, text: 'Tàya House — dinner by the sea', names: ['Tàya House'] });
    expect(restoreNames('⟦G1⟧ and ⟦G1⟧, ⟦G2⟧', masked)).toMatchObject({ ok: true, text: 'Tàya House and Tàya House, Hai Van Lounge' });
    expect(restoreNames('No names at all', masked)).toEqual({ ok: true, text: 'No names at all', names: [] });
  });

  it('refuses an invented token or a broken one', () => {
    expect(restoreNames('⟦G9⟧ by the sea', masked)).toEqual({ ok: false });
    expect(restoreNames('⟦G1 by the sea', masked)).toEqual({ ok: false });
    expect(restoreNames('G1⟧ by the sea', masked)).toEqual({ ok: false });
  });

  it('refuses a look-alike token left in the answer (other brackets around G1 or V1)', () => {
    for (const text of ['〚G1〛 by the sea', '[G1] by the sea', '⟨V1⟩ tonight', '( G2 ) and ⟦G1⟧', '【G12】']) expect(restoreNames(text, masked), text).toEqual({ ok: false });
    // Words that only look a little like one are fine.
    expect(restoreNames('A G7 summit menu (V60 coffee)', masked)).toMatchObject({ ok: true });
  });
});
