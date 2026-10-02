import { describe, expect, it } from 'vitest';
import { emailFailureHint } from './auth-errors';
import { outboxErrorHint } from './email-errors';

/* What staff read for an email's stored error or skip, in the email log and on the booking (F8). */

describe('outboxErrorHint', () => {
  it.each([
    ['skipped: the guest email changed', 'Khách đã đổi email: hệ thống không tự gửi tới địa chỉ mới, hãy gọi khách.'],
    ['skipped: the booking is now cancelled', 'Đặt bàn đã chuyển sang “Đã hủy”: email này không còn đúng nên không gửi.'],
    ['skipped: the booking is now confirmed', 'Đặt bàn đã chuyển sang “Đã xác nhận”: email này không còn đúng nên không gửi.'],
    ['skipped: the booking is now no_show', 'Đặt bàn đã chuyển sang “Không đến”: email này không còn đúng nên không gửi.'],
    ['skipped: the sitting has passed', 'Đã qua giờ hẹn: không gửi nữa.'],
    ['skipped: the recipient no longer gets these emails', 'Người nhận đã bị gỡ hoặc tắt: không gửi nữa.'],
    ['skipped: the booking no longer exists', 'Đặt bàn không còn nữa: không gửi.'],
    ['skipped: the booking was anonymised', 'Đặt bàn đã được ẩn danh: không gửi nữa.'],
    [
      'lease_expired: the last attempt never reported back',
      'Lần gửi cuối không báo lại kết quả; có thể email đã tới. Kiểm tra với người nhận trước khi gửi lại.',
    ],
  ])('%s', (stored, line) => expect(outboxErrorHint(stored)).toBe(line));

  it('a skip it does not know yet still reads as a skip, never as a setup problem', () => {
    expect(outboxErrorHint('skipped: something new')).toBe('Email này không còn khớp với đặt bàn nên không gửi.');
    expect(outboxErrorHint('skipped: the booking is now something_new')).toBe('Đặt bàn đã chuyển sang “something_new”: email này không còn đúng nên không gửi.');
  });

  it('a send error reads as the setup hint staff already get for the test email', () => {
    for (const stored of [
      'provider_error: SMTP ETIMEDOUT at CONN: Greeting never received',
      'provider_error: SMTP EAUTH at AUTH PLAIN: Invalid login: 535 Authentication failed',
      "rejected: SMTP EENVELOPE at RCPT TO: Can't send mail - all recipients were rejected: 550 <redacted>",
      'not_delivered: EMAIL_DELIVERY is log (or unset) on a Vercel preview deployment',
      'unknown: boom',
    ]) {
      expect(outboxErrorHint(stored)).toBe(emailFailureHint(stored));
    }
  });

  it('never English', () => {
    for (const stored of ['skipped: the guest email changed', 'skipped: the sitting has passed', 'lease_expired: x', 'provider_error: SMTP ETIMEDOUT at CONN']) {
      expect(outboxErrorHint(stored)).not.toMatch(/\b(the|skipped|email changed|passed)\b/);
    }
  });
});
