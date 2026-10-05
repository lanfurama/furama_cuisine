import { describe, expect, it } from 'vitest';
import { onlineBookingLabel } from './restaurant-status';

describe('the restaurants list’s “Đặt bàn online” cell', () => {
  const on = { bookingEnabled: true, archived: false, isPublished: true, destinationShown: true };

  it('says “Bật” only when guests can book online, and otherwise why not', () => {
    expect(onlineBookingLabel(on)).toBe('Bật');
    expect(onlineBookingLabel({ ...on, bookingEnabled: false })).toBe('Tắt');
    expect(onlineBookingLabel({ ...on, archived: true, isPublished: false })).toBe('Không nhận (đã lưu trữ)');
    expect(onlineBookingLabel({ ...on, isPublished: false })).toBe('Không nhận (đang ẩn)');
    // A hidden destination takes its restaurants off online booking too (bookableSql, L7-2).
    expect(onlineBookingLabel({ ...on, destinationShown: false })).toBe('Không nhận (điểm đến đang ẩn)');
  });
});
