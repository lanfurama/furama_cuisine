import { describe, expect, it } from 'vitest';
import { formatDateTimeVi, formatFileSize, formatIsoDayVi, formatLongDateVi, todayVi } from './format';

// npm test runs with TZ=UTC, like Vercel: the formatting must still be Vietnam's clock.
describe('admin dates', () => {
  it('formats in vi-VN on Asia/Ho_Chi_Minh, across the UTC midnight', () => {
    expect(formatDateTimeVi('2026-10-01T17:30:00Z')).toBe('00:30 02/10/2026');
    expect(formatDateTimeVi('2026-10-01T16:59:00Z')).toBe('23:59 01/10/2026');
    expect(formatLongDateVi('2026-10-01T17:30:00Z')).toBe('Thứ Sáu, 2 tháng 10, 2026');
    expect(todayVi(new Date('2026-10-01T23:00:00Z'))).toBe('Thứ Sáu, 2 tháng 10, 2026');
  });

  it('formats a calendar date as itself, whatever the server timezone', () => {
    expect(formatIsoDayVi('2026-10-05')).toBe('Th 2, 05/10/2026');
    expect(formatIsoDayVi('2026-10-04')).toBe('CN, 04/10/2026');
  });
});

describe('formatFileSize', () => {
  it('prints a file size the way the media library shows it (Vietnamese decimals)', () => {
    expect(formatFileSize(57833)).toBe('56 KB');
    expect(formatFileSize(1)).toBe('1 KB');
    expect(formatFileSize(2.4 * 1024 * 1024)).toBe('2,4 MB');
    expect(formatFileSize(15728640)).toBe('15,0 MB');
  });
});
