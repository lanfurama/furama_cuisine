import { describe, expect, it } from 'vitest';
import { fold } from './booking';

describe('fold', () => {
  it('ignores accents and đ so guests can search without Vietnamese input', () => {
    expect(fold('Phố Cuốn')).toBe('pho cuon');
    expect(fold('Đà Nẵng')).toBe('da nang');
  });
});
