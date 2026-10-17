import { describe, expect, it } from 'vitest';
import { ASSIST_TOO_LONG, assistRefusal, MAX_ASSIST_CHARS } from './assist';

describe('assistRefusal', () => {
  it('lets through text up to the limit, and says why beyond it', () => {
    expect(MAX_ASSIST_CHARS).toBe(4000);
    expect(assistRefusal('x'.repeat(4000))).toBeNull();
    expect(assistRefusal('x'.repeat(4001))).toBe(ASSIST_TOO_LONG);
    expect(ASSIST_TOO_LONG).toContain('4.000');
  });
});
