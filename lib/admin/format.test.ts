import { describe, expect, it } from 'vitest';
import { formatDateTimeVi, formatLongDateVi, todayVi } from './format';

// npm test runs with TZ=UTC, like Vercel: the formatting must still be Vietnam's clock.
describe('admin dates', () => {
  it('formats in vi-VN on Asia/Ho_Chi_Minh, across the UTC midnight', () => {
    expect(formatDateTimeVi('2026-10-01T17:30:00Z')).toBe('00:30 02/10/2026');
    expect(formatDateTimeVi('2026-10-01T16:59:00Z')).toBe('23:59 01/10/2026');
    expect(formatLongDateVi('2026-10-01T17:30:00Z')).toBe('Thứ Sáu, 2 tháng 10, 2026');
    expect(todayVi(new Date('2026-10-01T23:00:00Z'))).toBe('Thứ Sáu, 2 tháng 10, 2026');
  });
});
