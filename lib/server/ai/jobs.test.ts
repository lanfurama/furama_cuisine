import { describe, expect, it } from 'vitest';
import { jobLocale, normaliseProgress, strike, STRIKES } from './jobs';

/* The pure half of ai_jobs: the progress document and the language rule (the SQL is test/integration/ai-jobs.test.ts). */

describe('job progress', () => {
  it('reads the stored jsonb, filling what an older row lacks', () => {
    expect(normaliseProgress({ done: 0, failed: 0, remaining: null })).toEqual({ done: 0, failed: 0, remaining: null, skipped: [], strikes: {} });
    expect(normaliseProgress({ done: 3.7, failed: -1, remaining: 4, skipped: ['a', 1], strikes: { a: 2 } })).toEqual({
      done: 3,
      failed: 0,
      remaining: 4,
      skipped: ['a'],
      strikes: { a: 2 },
    });
    expect(normaliseProgress(null).remaining).toBeNull();
  });

  it('skips a unit on its third failure in the job, and counts every failure', () => {
    const p = normaliseProgress({});
    for (let i = 1; i < STRIKES; i++) strike(p, 'offers:1');
    expect(p).toMatchObject({ failed: STRIKES - 1, skipped: [], strikes: { 'offers:1': STRIKES - 1 } });
    strike(p, 'offers:1');
    expect(p).toMatchObject({ failed: STRIKES, skipped: ['offers:1'], strikes: {} });
  });

  it('caps the skipped list at 200', () => {
    const p = normaliseProgress({ skipped: Array.from({ length: 200 }, (_, i) => `u${i}`) });
    for (let i = 0; i < STRIKES; i++) strike(p, 'one-more');
    expect(p.skipped).toHaveLength(200);
    expect(p.skipped).not.toContain('one-more');
  });
});

describe('jobLocale (R9-18)', () => {
  it('takes a listed language other than the default, and nothing else', () => {
    expect(jobLocale('vi')).toBe(true);
    expect(jobLocale('en')).toBe(false);
    expect(jobLocale('fr')).toBe(false);
    expect(jobLocale('')).toBe(false);
  });
});
