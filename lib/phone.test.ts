import { describe, expect, it } from 'vitest';
import { toE164 } from './phone';

describe('toE164', () => {
  it.each([
    ['0905 000 000', '+84905000000'],
    ['+84 905 000 000', '+84905000000'],
    ['84905000000', '+84905000000'],
    ['0236 3847 333', '+842363847333'],
    ['+33 6 12 34 56 78', '+33612345678'],
    ['+82 10-1234-5678', '+821012345678'],
  ])('reads %j as %s', (raw, e164) => {
    expect(toE164(raw)).toBe(e164);
  });

  it.each(['12345', 'abc', ''])('rejects %j', (raw) => {
    expect(toE164(raw)).toBeNull();
  });
});
