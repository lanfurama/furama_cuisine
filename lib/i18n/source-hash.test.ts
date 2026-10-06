import { describe, expect, it } from 'vitest';
import { sourceHash, translationState } from './source-hash';

describe('sourceHash: the default row’s fingerprint', () => {
  it('is stable, ignores columns it is not given, and reads null and empty alike', () => {
    const a = sourceHash(['title', 'schedule'], { title: 'Sunset', schedule: null, other: 'x' });
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(sourceHash(['title', 'schedule'], { title: 'Sunset', schedule: '' })).toBe(a);
    expect(sourceHash(['title', 'schedule'], { title: 'Sunset' })).toBe(a);
  });

  it('changes with any column’s text, and with the columns’ order', () => {
    const a = sourceHash(['title', 'schedule'], { title: 'Sunset', schedule: 'Daily' });
    expect(sourceHash(['title', 'schedule'], { title: 'Sunset!', schedule: 'Daily' })).not.toBe(a);
    expect(sourceHash(['schedule', 'title'], { title: 'Sunset', schedule: 'Daily' })).not.toBe(a);
  });
});

describe('translationState', () => {
  const now = sourceHash(['title'], { title: 'Sunset' });
  const before = sourceHash(['title'], { title: 'Sunrise' });
  it('says each of the four states', () => {
    expect(translationState(undefined, now, false)).toBe('missing');
    expect(translationState({ status: 'reviewed', source_hash: now }, now, false)).toBe('reviewed');
    expect(translationState({ status: 'machine', source_hash: now }, now, false)).toBe('machine');
    expect(translationState({ status: 'reviewed', source_hash: before }, now, false)).toBe('stale');
  });
  it('never calls the default language or a row without a fingerprint out of date', () => {
    expect(translationState(undefined, now, true)).toBe('reviewed');
    expect(translationState({ status: 'reviewed', source_hash: null }, now, false)).toBe('reviewed');
  });
});
