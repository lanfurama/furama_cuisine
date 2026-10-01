import type { ActionCode } from '@/lib/server/action-result';

/*
 * What staff read when something is refused (spec §7.3), never English.
 * authErrorMessage: Better Auth's error codes (@better-auth/core
 * BASE_ERROR_CODES and the admin plugin's ADMIN_ERROR_CODES, better-auth
 * 1.7.7). A 429 from the rate limiter carries no code, only the status and an
 * X-Retry-After header in seconds.
 * actionErrorMessage: the codes our admin Server Actions return (spec §7.4).
 * Client components import this file, so it imports types only.
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

export function authErrorMessage(status: number, code?: string | null, retryAfterSeconds?: number | null): string {
  if (status === 429) {
    return retryAfterSeconds && retryAfterSeconds > 0
      ? `Bạn đã thử quá nhiều lần. Vui lòng thử lại sau ${retryAfterSeconds} giây.`
      : 'Bạn đã thử quá nhiều lần. Vui lòng đợi một lát rồi thử lại.';
  }
  return (code && AUTH_MESSAGES[code]) || AUTH_FALLBACK;
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
};

export function actionErrorMessage(code: ActionCode): string {
  return ACTION_MESSAGES[code];
}
