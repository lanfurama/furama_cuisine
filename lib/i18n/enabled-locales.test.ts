import { beforeEach, describe, expect, it, vi } from 'vitest';

const query = vi.fn();
const getPool = vi.fn(() => ({ query }));
vi.mock('@/db/client', () => ({ getPool: () => getPool() }));

const { enabledLocalesBestEffort, resetEnabledLocalesCache } = await import('./enabled-locales');

const rows = (...codes: string[]) => ({ rows: codes.map((code) => ({ code })) });

describe('enabledLocalesBestEffort (the proxy’s one database read)', () => {
  beforeEach(() => {
    resetEnabledLocalesCache();
    query.mockReset();
    getPool.mockClear();
  });

  it('reads the enabled codes in the table’s order', async () => {
    query.mockResolvedValue(rows('en', 'vi'));
    expect(await enabledLocalesBestEffort(0)).toEqual(['en', 'vi']);
    expect(query).toHaveBeenCalledWith('SELECT code FROM locales WHERE is_enabled ORDER BY sort_order, code');
  });

  it('answers from memory for 60 seconds, then reads again', async () => {
    query.mockResolvedValueOnce(rows('en')).mockResolvedValueOnce(rows('en', 'ko'));
    expect(await enabledLocalesBestEffort(0)).toEqual(['en']);
    expect(await enabledLocalesBestEffort(59_999)).toEqual(['en']);
    expect(query).toHaveBeenCalledTimes(1);
    expect(await enabledLocalesBestEffort(60_000)).toEqual(['en', 'ko']);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('serves en when the query fails, and keeps that answer for the TTL too', async () => {
    query.mockRejectedValue(new Error('connection refused'));
    expect(await enabledLocalesBestEffort(0)).toEqual(['en']);
    expect(await enabledLocalesBestEffort(30_000)).toEqual(['en']);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('serves en when there is no database configured', async () => {
    getPool.mockImplementationOnce(() => {
      throw new Error('DATABASE_URL is not set.');
    });
    expect(await enabledLocalesBestEffort(0)).toEqual(['en']);
  });

  it('serves en when the table answers with no enabled language', async () => {
    query.mockResolvedValue(rows());
    expect(await enabledLocalesBestEffort(0)).toEqual(['en']);
  });

  it('gives up after 500 ms', async () => {
    vi.useFakeTimers();
    try {
      query.mockReturnValue(new Promise(() => {}));
      const answer = enabledLocalesBestEffort(0);
      await vi.advanceTimersByTimeAsync(500);
      expect(await answer).toEqual(['en']);
    } finally {
      vi.useRealTimers();
    }
  });
});
