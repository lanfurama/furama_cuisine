import { blamesSender } from '@/lib/email/smtp-reply';
import type { ActionCode, ActionResult } from '@/lib/server/action-result';
import type { InviteDelivery } from '@/lib/server/auth/staff';
import type { EmailErrorCode } from '@/lib/server/email/types';

/*
 * What staff read when something is refused (spec §7.3), never English.
 * authErrorMessage: Better Auth's error codes (@better-auth/core
 * BASE_ERROR_CODES and the admin plugin's ADMIN_ERROR_CODES, better-auth
 * 1.7.7). A 429 from the rate limiter carries no code, only the status and an
 * X-Retry-After header in seconds.
 * actionErrorMessage: the codes our admin Server Actions return (spec §7.4).
 * inviteEmailFailedMessage: why an invitation email did not go out.
 * inviteOutcome: what the invite form says after a submit.
 * Client components import this file, so it imports types and client-safe
 * code only.
 */
const AUTH_MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: 'Email hoặc mật khẩu không đúng.',
  INVALID_EMAIL: 'Email không hợp lệ.',
  INVALID_PASSWORD: 'Mật khẩu không đúng.',
  BANNED_USER: 'Tài khoản này đã bị khóa. Liên hệ Admin để được mở lại.',
  INVALID_TOKEN: 'Liên kết không hợp lệ hoặc đã được dùng. Hãy yêu cầu một liên kết mới.',
  TOKEN_EXPIRED: 'Liên kết đã hết hạn. Hãy yêu cầu một liên kết mới.',
  PASSWORD_TOO_SHORT: 'Mật khẩu cần ít nhất 12 ký tự.',
  PASSWORD_TOO_LONG: 'Mật khẩu quá dài (tối đa 128 ký tự).',
  SESSION_EXPIRED: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
  USER_NOT_FOUND: 'Không tìm thấy tài khoản.',
  CREDENTIAL_ACCOUNT_NOT_FOUND: 'Tài khoản này chưa có mật khẩu. Hãy dùng "Quên mật khẩu".',
};

const AUTH_FALLBACK = 'Không đăng nhập được. Vui lòng thử lại sau ít phút.';

/** `fallback` is for a code we do not know; sign-in's own is the default. */
export function authErrorMessage(
  status: number,
  code?: string | null,
  retryAfterSeconds?: number | null,
  fallback = AUTH_FALLBACK,
): string {
  if (status === 429) {
    return retryAfterSeconds && retryAfterSeconds > 0
      ? `Bạn đã thử quá nhiều lần. Vui lòng thử lại sau ${retryAfterSeconds} giây.`
      : 'Bạn đã thử quá nhiều lần. Vui lòng đợi một lát rồi thử lại.';
  }
  return (code && AUTH_MESSAGES[code]) || fallback;
}

const ACTION_MESSAGES: Record<ActionCode, string> = {
  forbidden: 'Bạn không có quyền thực hiện thao tác này.',
  invalid: 'Dữ liệu chưa hợp lệ. Hãy kiểm tra các ô được đánh dấu.',
  db_error: 'Không lưu được do lỗi hệ thống. Dữ liệu bạn nhập vẫn còn, hãy thử lại.',
  already_staff: 'Email này đã có tài khoản nhân viên.',
  already_invited: 'Email này đang có lời mời chưa dùng. Hãy bấm Gửi lại.',
  not_found: 'Không tìm thấy mục này. Có thể người khác vừa thay đổi; hãy tải lại trang.',
  last_admin: 'Không thể hạ quyền, khóa hoặc xóa Admin cuối cùng.',
  self: 'Bạn không thể tự khóa hoặc tự xóa tài khoản của mình.',
  invalid_token: 'Lời mời không hợp lệ, đã hết hạn hoặc đã bị thu hồi.',
  conflict: 'Vừa có người khác thay đổi mục này. Hãy tải lại trang rồi làm lại.',
  not_allowed: 'Không thể chuyển sang trạng thái này từ trạng thái hiện tại. Hãy tải lại trang.',
  too_early: 'Chưa đến lúc thực hiện thao tác này.',
  too_late: 'Đã quá thời gian cho phép (chỉ sửa được trong ngày phục vụ).',
  full: 'Khung giờ này đã hết chỗ. Muốn vẫn nhận, hãy ghi lý do vượt sức chứa.',
  closed: 'Nhà hàng đóng cửa vào bữa này trong ngày đã chọn.',
  slot_unavailable: 'Giờ này không nằm trong ca phục vụ của ngày đã chọn.',
  duplicate: 'Số điện thoại này đã có một đặt bàn đang hoạt động cùng nhà hàng, ngày và giờ.',
  not_resendable: 'Email này đã gửi, đã bỏ qua hoặc đang được gửi, nên không gửi lại được. Hãy tải lại trang.',
  email_failed: 'Không gửi được email thử.',
  limit: 'Đã đủ số mục tối đa được hiện. Hãy ẩn một mục khác trước.',
  missing_reference: 'Phiên bản này dùng một nhà hàng, ảnh hoặc mục không còn nữa, nên không khôi phục được.',
  in_use: 'File này đang được dùng nên không xóa được. Hãy thay ảnh ở những chỗ dưới đây trước.',
  blob_not_configured: 'Môi trường này chưa kết nối kho file (Vercel Blob). Liên hệ người quản trị kỹ thuật.',
};

/** `params` fills in the codes that carry details: who saved first and when, the covers left. */
export function actionErrorMessage(code: ActionCode, params?: Record<string, string>): string {
  if (code === 'conflict' && params?.by) {
    return `Vừa được ${params.by} thay đổi${params.at ? ` lúc ${params.at}` : ''}. Hãy tải lại trang rồi làm lại.`;
  }
  if (code === 'full' && params?.left !== undefined) {
    return `Khung giờ này chỉ còn ${params.left} chỗ. Muốn vẫn nhận, hãy ghi lý do vượt sức chứa.`;
  }
  if (code === 'limit' && params?.max) {
    return `Tối đa ${params.max} mục được hiện (giới hạn bố cục). Hãy ẩn một mục khác trước.`;
  }
  if (code === 'email_failed' && params?.error) {
    return `Không gửi được email thử. ${emailFailureHint(params.error)} (${params.error})`;
  }
  return ACTION_MESSAGES[code];
}

/**
 * What an Admin can do about a stored email error ("<code>: <message>",
 * describeEmailError; no address in it): the setup errors name the variables
 * to set, an SMTP refusal says whose side to check (R9). A refusal of the
 * envelope that blames the sender, a relay or the login (lib/email/smtp-reply.ts)
 * names EMAIL_FROM: it is ours to fix, not the recipient's.
 */
export function emailFailureHint(stored: string): string {
  const code = stored.split(':')[0];
  const envelope = / at (?:RCPT TO|MAIL FROM): (.*)$/s.exec(stored);
  if (envelope && blamesSender(envelope[1])) {
    return 'Máy chủ SMTP không cho gửi từ địa chỉ này hoặc không cho chuyển tiếp: kiểm tra EMAIL_FROM là địa chỉ mà tài khoản SMTP_USER được phép gửi, và tài khoản đã đăng nhập (SMTP_USER, SMTP_PASSWORD).';
  }
  if (code === 'missing_smtp_config') return 'Chưa cấu hình SMTP (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD) trên môi trường này.';
  if (code === 'missing_from') return 'Chưa đặt địa chỉ gửi (EMAIL_FROM).';
  if (code === 'missing_redirect_to') return 'Chế độ redirect cần EMAIL_REDIRECT_TO.';
  if (code === 'missing_app_url') return 'Chưa đặt BETTER_AUTH_URL (địa chỉ của trang quản trị) cho các liên kết trong email.';
  if (code === 'not_delivered' || code === 'invalid_delivery_mode') return 'Môi trường này chưa bật gửi email (EMAIL_DELIVERY).';
  if (code === 'rejected') return 'Máy chủ SMTP từ chối địa chỉ người nhận: kiểm tra lại địa chỉ (gửi lại sẽ không giúp).';
  if (/SMTP EAUTH/.test(stored)) return 'Máy chủ SMTP từ chối tài khoản đăng nhập: kiểm tra SMTP_USER và SMTP_PASSWORD.';
  if (/SMTP (ECONNECTION|ETIMEDOUT|ESOCKET|EDNS|ETLS)/.test(stored)) return 'Không kết nối được máy chủ SMTP: kiểm tra SMTP_HOST, SMTP_PORT và SMTP_SECURE.';
  return 'Kiểm tra cấu hình gửi email rồi thử lại.';
}

/*
 * true: this environment cannot send email at all until someone fixes its
 * setup, so "Gửi lại" alone will not help. not_delivered is log mode on a
 * Vercel deployment, which logs the email without its link. A Record, so a new
 * EmailErrorCode has to be sorted here.
 */
const EMAIL_SETUP_ERRORS: Record<EmailErrorCode, boolean> = {
  invalid_delivery_mode: true,
  missing_smtp_config: true,
  missing_from: true,
  missing_redirect_to: true,
  missing_app_url: true,
  not_delivered: true,
  // The recipient's server refused the address for good; the setup is fine.
  rejected: false,
  provider_error: false,
};

/** `code` is the one in front of staff_invitation.email_error (an EmailErrorCode, or "unknown"). */
export function inviteEmailFailedMessage(code: string | null | undefined): string {
  // The address itself was refused for good: sending it again cannot help, a corrected invitation can.
  if (code === 'rejected') return 'Chưa gửi được email: máy chủ SMTP từ chối địa chỉ này. Kiểm tra lại địa chỉ, rồi thu hồi lời mời và mời lại.';
  // `=== true`: an inherited key such as "toString" must not read as a setup error.
  return code && EMAIL_SETUP_ERRORS[code as EmailErrorCode] === true
    ? 'Chưa gửi được email: chưa cấu hình gửi email trên môi trường này. Báo bộ phận kỹ thuật, rồi bấm Gửi lại.'
    : 'Chưa gửi được email, bấm Gửi lại.';
}

/**
 * The invite form's line after a submit (phase-3 ledger): "sent" as a
 * status; "created but not emailed" as an alert saying why, never the green
 * "sent"; a refusal without a field to mark (already staff, already
 * invited, forbidden) as an alert; nothing before a submit, or when the
 * refusal is a field's (shown beside it).
 */
export function inviteOutcome(state: ActionResult<InviteDelivery> | null): { role: 'status' | 'alert'; text: string } | null {
  if (!state) return null;
  if (state.ok) {
    return state.data.emailSent ? { role: 'status', text: 'Đã gửi lời mời.' } : { role: 'alert', text: `Đã tạo lời mời. ${inviteEmailFailedMessage(state.data.emailError)}` };
  }
  return state.fieldErrors ? null : { role: 'alert', text: actionErrorMessage(state.code, state.params) };
}
