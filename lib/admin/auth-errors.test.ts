import { describe, expect, it } from 'vitest';
import { actionErrorMessage, authErrorMessage, inviteEmailFailedMessage } from './auth-errors';

describe('authErrorMessage', () => {
  it.each([
    [401, 'INVALID_EMAIL_OR_PASSWORD', 'Email hoặc mật khẩu không đúng.'],
    [403, 'BANNED_USER', 'Tài khoản này đã bị khóa. Liên hệ Admin để được mở lại.'],
    [400, 'INVALID_TOKEN', 'Liên kết không hợp lệ hoặc đã được dùng. Hãy yêu cầu một liên kết mới.'],
    [400, 'TOKEN_EXPIRED', 'Liên kết đã hết hạn. Hãy yêu cầu một liên kết mới.'],
    [400, 'PASSWORD_TOO_SHORT', 'Mật khẩu cần ít nhất 12 ký tự.'],
  ])('%i %s', (status, code, message) => expect(authErrorMessage(status, code)).toBe(message));

  it('429 from the rate limiter (no code) → too many attempts, with the wait when known', () => {
    expect(authErrorMessage(429, undefined, 7)).toBe('Bạn đã thử quá nhiều lần. Vui lòng thử lại sau 7 giây.');
    expect(authErrorMessage(429)).toBe('Bạn đã thử quá nhiều lần. Vui lòng đợi một lát rồi thử lại.');
  });

  it('a caller may name its own fallback', () => {
    expect(authErrorMessage(500, 'SOMETHING_NEW', null, 'Không đổi được mật khẩu.')).toBe('Không đổi được mật khẩu.');
    expect(authErrorMessage(400, 'INVALID_TOKEN', null, 'x')).toBe('Liên kết không hợp lệ hoặc đã được dùng. Hãy yêu cầu một liên kết mới.');
  });

  it('unknown codes never show English', () => {
    expect(authErrorMessage(500, 'SOMETHING_NEW')).toBe('Không đăng nhập được. Vui lòng thử lại sau ít phút.');
    expect(authErrorMessage(500)).toBe('Không đăng nhập được. Vui lòng thử lại sau ít phút.');
  });
});

describe('actionErrorMessage', () => {
  it.each([
    ['forbidden', 'Bạn không có quyền thực hiện thao tác này.'],
    ['invalid', 'Dữ liệu chưa hợp lệ. Hãy kiểm tra các ô được đánh dấu.'],
    ['db_error', 'Không lưu được do lỗi hệ thống. Dữ liệu bạn nhập vẫn còn, hãy thử lại.'],
    ['already_staff', 'Email này đã có tài khoản nhân viên.'],
    ['already_invited', 'Email này đang có lời mời chưa dùng. Hãy bấm Gửi lại.'],
    ['not_found', 'Không tìm thấy mục này. Có thể người khác vừa thay đổi; hãy tải lại trang.'],
    ['last_admin', 'Không thể hạ quyền, khóa hoặc xóa Admin cuối cùng.'],
    ['self', 'Bạn không thể tự khóa hoặc tự xóa tài khoản của mình.'],
    ['invalid_token', 'Lời mời không hợp lệ, đã hết hạn hoặc đã bị thu hồi.'],
  ] as const)('%s', (code, message) => expect(actionErrorMessage(code)).toBe(message));
});

describe('inviteEmailFailedMessage', () => {
  const setup = 'Chưa gửi được email: chưa cấu hình gửi email trên môi trường này. Báo bộ phận kỹ thuật, rồi bấm Gửi lại.';
  it.each([
    ['not_delivered', setup],
    ['missing_api_key', setup],
    ['invalid_delivery_mode', setup],
    ['provider_error', 'Chưa gửi được email, bấm Gửi lại.'],
    ['unknown', 'Chưa gửi được email, bấm Gửi lại.'],
    ['toString', 'Chưa gửi được email, bấm Gửi lại.'],
    [null, 'Chưa gửi được email, bấm Gửi lại.'],
  ])('%s', (code, message) => expect(inviteEmailFailedMessage(code)).toBe(message));
});
