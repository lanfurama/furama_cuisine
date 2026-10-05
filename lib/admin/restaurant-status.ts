/*
 * The restaurants list's "Đặt bàn online" cell (spec §7.2 /admin/restaurants).
 * The restaurant's switch alone is not online booking: guests book only a
 * restaurant they see, i.e. shown, not archived, at a shown destination
 * (bookableSql in lib/server/booking/rules.ts; 7A review A11, phase-6 ledger
 * L7-2), so the cell says "Bật" only then, and otherwise why it takes none.
 */
export type OnlineBookingState = { bookingEnabled: boolean; archived: boolean; isPublished: boolean; destinationShown: boolean };

export function onlineBookingLabel(r: OnlineBookingState): string {
  if (!r.bookingEnabled) return 'Tắt';
  if (r.archived) return 'Không nhận (đã lưu trữ)';
  if (!r.isPublished) return 'Không nhận (đang ẩn)';
  if (!r.destinationShown) return 'Không nhận (điểm đến đang ẩn)';
  return 'Bật';
}
