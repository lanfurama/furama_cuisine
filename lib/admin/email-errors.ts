import type { ReservationStatus } from '@/lib/booking/rules';
import { STATUS_LABELS } from '@/lib/reservations/lifecycle';
import { emailFailureHint } from './auth-errors';

/*
 * The "Lỗi gần nhất" of a booking email (email_outbox.last_error), in
 * Vietnamese, for the email log and the booking's own table (spec §7.3: staff
 * never read English). The drain stores English on purpose (lib/server/email/
 * drain.ts: "skipped: <why>", "lease_expired: …", "<code>: <message>"); this
 * says what it means and what staff should do. No server import: the screens
 * may render it in a client component later.
 */

const SKIPS: Record<string, string> = {
  // R7: a corrected address is never emailed automatically, so the guest has to hear it by phone.
  'the guest email changed': 'Khách đã đổi email: hệ thống không tự gửi tới địa chỉ mới, hãy gọi khách.',
  'the sitting has passed': 'Đã qua giờ hẹn: không gửi nữa.',
  'the recipient no longer gets these emails': 'Người nhận đã bị gỡ hoặc tắt: không gửi nữa.',
  'the booking no longer exists': 'Đặt bàn không còn nữa: không gửi.',
  'the booking was anonymised': 'Đặt bàn đã được ẩn danh: không gửi nữa.',
};

const NOW_STATUS = /^the booking is now (\S+)$/;

export function outboxErrorHint(stored: string): string {
  if (stored.startsWith('skipped: ')) {
    const why = stored.slice('skipped: '.length);
    const status = NOW_STATUS.exec(why)?.[1];
    if (status) {
      const label = STATUS_LABELS[status as ReservationStatus] ?? status;
      return `Đặt bàn đã chuyển sang “${label}”: email này không còn đúng nên không gửi.`;
    }
    // Object.hasOwn: an inherited key such as "constructor" is not a reason.
    return Object.hasOwn(SKIPS, why) ? SKIPS[why] : 'Email này không còn khớp với đặt bàn nên không gửi.';
  }
  // The function died mid-send on the last attempt: the server may have accepted it (R6).
  if (stored.startsWith('lease_expired:')) {
    return 'Lần gửi cuối không báo lại kết quả; có thể email đã tới. Kiểm tra với người nhận trước khi gửi lại.';
  }
  return emailFailureHint(stored);
}
