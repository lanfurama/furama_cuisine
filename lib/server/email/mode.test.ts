import { describe, expect, it } from 'vitest';
import { deliveryModeNotice } from './mode';

describe('deliveryModeNotice', () => {
  it('names the mode staff should know about, and nothing of the settings behind it', () => {
    expect(deliveryModeNotice({})).toBe('Chế độ gửi: chỉ ghi log — không email nào được gửi đi từ môi trường này.');
    expect(deliveryModeNotice({ EMAIL_DELIVERY: 'live', SMTP_HOST: 'smtp.secret.test', SMTP_PASSWORD: 'pw' })).toBe(
      'Chế độ gửi: thật (live) — email tới đúng người nhận.',
    );
    const redirect = deliveryModeNotice({ EMAIL_DELIVERY: 'redirect', EMAIL_REDIRECT_TO: 'boss@furama.test' });
    expect(redirect).toBe('Chế độ gửi: chuyển hướng (redirect) — mọi email về hộp thư thử nghiệm, không tới khách.');
    expect(redirect).not.toContain('@');
    expect(deliveryModeNotice({ EMAIL_DELIVERY: 'Live x' })).toBe('Chế độ gửi không hợp lệ: không email nào được gửi.');
  });

  it('live on a Preview or under `vercel dev` is not live: the sender refuses it there, and so does the notice', () => {
    for (const VERCEL_ENV of ['preview', 'development']) {
      expect(deliveryModeNotice({ EMAIL_DELIVERY: 'live', VERCEL_ENV })).toBe(
        'Chế độ gửi không hợp lệ: thật (live) chỉ dùng ở Production — không email nào được gửi từ môi trường này.',
      );
    }
    expect(deliveryModeNotice({ EMAIL_DELIVERY: 'live', VERCEL_ENV: 'production' })).toBe('Chế độ gửi: thật (live) — email tới đúng người nhận.');
    expect(deliveryModeNotice({ EMAIL_DELIVERY: 'redirect', VERCEL_ENV: 'preview' })).toBe(
      'Chế độ gửi: chuyển hướng (redirect) — mọi email về hộp thư thử nghiệm, không tới khách.',
    );
  });
});
