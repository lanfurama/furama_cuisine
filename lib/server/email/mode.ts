import 'server-only';
import { resolveMode } from './send';

/*
 * The email gate as staff should understand it (spec §10.4 "Cổng môi
 * trường"), read at request time for the email screens. The mode only: never
 * an SMTP setting, never the redirect address, never the raw variable
 * (Editors see the email log too). The verdict is the sender's own
 * (resolveMode), so the screen never says "live" where the sender refuses to
 * send, as on a Preview.
 */
export function deliveryModeNotice(env: Record<string, string | undefined> = process.env): string {
  let mode;
  try {
    mode = resolveMode(env.EMAIL_DELIVERY, env.VERCEL_ENV);
  } catch {
    return env.EMAIL_DELIVERY?.trim() === 'live'
      ? 'Chế độ gửi không hợp lệ: thật (live) chỉ dùng ở Production — không email nào được gửi từ môi trường này.'
      : 'Chế độ gửi không hợp lệ: không email nào được gửi.';
  }
  if (mode === 'live') return 'Chế độ gửi: thật (live) — email tới đúng người nhận.';
  if (mode === 'redirect') return 'Chế độ gửi: chuyển hướng (redirect) — mọi email về hộp thư thử nghiệm, không tới khách.';
  return 'Chế độ gửi: chỉ ghi log — không email nào được gửi đi từ môi trường này.';
}
