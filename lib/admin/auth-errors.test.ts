import { describe, expect, it } from 'vitest';
import { actionErrorMessage, authErrorMessage, emailFailureHint, inviteEmailFailedMessage } from './auth-errors';

const REJECTED = 'Máy chủ SMTP từ chối địa chỉ người nhận: kiểm tra lại địa chỉ (gửi lại sẽ không giúp).';
const SENDER =
  'Máy chủ SMTP không cho gửi từ địa chỉ này hoặc không cho chuyển tiếp: kiểm tra EMAIL_FROM là địa chỉ mà tài khoản SMTP_USER được phép gửi, và tài khoản đã đăng nhập (SMTP_USER, SMTP_PASSWORD).';
const REFUSED_INVITE = 'Chưa gửi được email: máy chủ SMTP từ chối địa chỉ này. Kiểm tra lại địa chỉ, rồi thu hồi lời mời và mời lại.';

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
    ['conflict', 'Vừa có người khác thay đổi mục này. Hãy tải lại trang rồi làm lại.'],
    ['not_allowed', 'Không thể chuyển sang trạng thái này từ trạng thái hiện tại. Hãy tải lại trang.'],
    ['too_early', 'Chưa đến lúc thực hiện thao tác này.'],
    ['too_late', 'Đã quá thời gian cho phép (chỉ sửa được trong ngày phục vụ).'],
    ['full', 'Khung giờ này đã hết chỗ. Muốn vẫn nhận, hãy ghi lý do vượt sức chứa.'],
    ['closed', 'Nhà hàng đóng cửa vào bữa này trong ngày đã chọn.'],
    ['slot_unavailable', 'Giờ này không nằm trong ca phục vụ của ngày đã chọn.'],
    ['duplicate', 'Số điện thoại này đã có một đặt bàn đang hoạt động cùng nhà hàng, ngày và giờ.'],
    ['limit', 'Đã đủ số mục tối đa được hiện. Hãy ẩn một mục khác trước.'],
    ['missing_reference', 'Phiên bản này dùng một nhà hàng, ảnh hoặc mục không còn nữa, nên không khôi phục được.'],
  ] as const)('%s', (code, message) => expect(actionErrorMessage(code)).toBe(message));

  it('says who saved first, and how many covers are left, when the action sends them', () => {
    expect(actionErrorMessage('conflict', { by: 'Lan (lan@furama.test)', at: '19:05 02/10/2026' })).toBe(
      'Vừa được Lan (lan@furama.test) thay đổi lúc 19:05 02/10/2026. Hãy tải lại trang rồi làm lại.',
    );
    expect(actionErrorMessage('conflict', { by: 'Lan', at: '' })).toBe('Vừa được Lan thay đổi. Hãy tải lại trang rồi làm lại.');
    expect(actionErrorMessage('full', { left: '3' })).toBe('Khung giờ này chỉ còn 3 chỗ. Muốn vẫn nhận, hãy ghi lý do vượt sức chứa.');
    expect(actionErrorMessage('full', { left: '0' })).toBe('Khung giờ này chỉ còn 0 chỗ. Muốn vẫn nhận, hãy ghi lý do vượt sức chứa.');
  });

  it('names the layout limit a content save would pass (spec §6.5)', () => {
    expect(actionErrorMessage('limit', { max: '6' })).toBe('Tối đa 6 mục được hiện (giới hạn bố cục). Hãy ẩn một mục khác trước.');
  });
});

describe('"Gửi email thử" failures (R9)', () => {
  it('says what to fix for each kind of failure, and quotes the stored error', () => {
    expect(emailFailureHint('missing_smtp_config: SMTP_HOST is required when EMAIL_DELIVERY is live or redirect')).toBe(
      'Chưa cấu hình SMTP (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD) trên môi trường này.',
    );
    expect(emailFailureHint('missing_from: EMAIL_FROM with a sender address is required when EMAIL_DELIVERY=live')).toBe('Chưa đặt địa chỉ gửi (EMAIL_FROM).');
    expect(emailFailureHint('missing_redirect_to: EMAIL_REDIRECT_TO is required')).toBe('Chế độ redirect cần EMAIL_REDIRECT_TO.');
    expect(emailFailureHint('missing_app_url: BETTER_AUTH_URL is required')).toBe('Chưa đặt BETTER_AUTH_URL (địa chỉ của trang quản trị) cho các liên kết trong email.');
    expect(emailFailureHint('not_delivered: EMAIL_DELIVERY is log (or unset) on a Vercel preview deployment')).toBe('Môi trường này chưa bật gửi email (EMAIL_DELIVERY).');
    expect(emailFailureHint('provider_error: SMTP EAUTH at AUTH PLAIN: Invalid login: 535 Authentication failed')).toBe(
      'Máy chủ SMTP từ chối tài khoản đăng nhập: kiểm tra SMTP_USER và SMTP_PASSWORD.',
    );
    for (const stored of [
      'provider_error: SMTP ESOCKET at CONN: connect ECONNREFUSED 127.0.0.1:587',
      'provider_error: SMTP ETIMEDOUT at CONN: Greeting never received',
      'provider_error: SMTP ETLS at STARTTLS: Error upgrading connection with STARTTLS',
    ]) {
      expect(emailFailureHint(stored)).toBe('Không kết nối được máy chủ SMTP: kiểm tra SMTP_HOST, SMTP_PORT và SMTP_SECURE.');
    }
    expect(emailFailureHint("rejected: SMTP EENVELOPE at RCPT TO: Can't send mail - all recipients were rejected: 550 <redacted>")).toBe(REJECTED);
    expect(emailFailureHint('provider_error: SMTP EMESSAGE at DATA: Message failed: 554 Message rejected')).toBe('Kiểm tra cấu hình gửi email rồi thử lại.');
    const stored = 'provider_error: SMTP EAUTH at AUTH PLAIN: Invalid login: 535 Authentication failed';
    expect(actionErrorMessage('email_failed', { error: stored })).toBe(
      `Không gửi được email thử. Máy chủ SMTP từ chối tài khoản đăng nhập: kiểm tra SMTP_USER và SMTP_PASSWORD. (${stored})`,
    );
    expect(actionErrorMessage('email_failed')).toBe('Không gửi được email thử.');
    expect(actionErrorMessage('not_resendable')).toBe('Email này đã gửi, đã bỏ qua hoặc đang được gửi, nên không gửi lại được. Hãy tải lại trang.');
  });
});

describe('SMTP refusals: whose side to check (F9)', () => {
  it.each([
    ["provider_error: SMTP EENVELOPE at RCPT TO: Can't send mail - all recipients were rejected: 553 5.7.1 <<redacted>>: Sender address rejected: not owned by user"],
    ["provider_error: SMTP EENVELOPE at RCPT TO: Can't send mail - all recipients were rejected: 554 5.7.1 <<redacted>>: Relay access denied"],
    ["provider_error: SMTP EENVELOPE at RCPT TO: Can't send mail - all recipients were rejected: 554 <<redacted>>: Relay access denied"],
    ['provider_error: SMTP EENVELOPE at MAIL FROM: Mail command failed: 553 5.7.1 <<redacted>>: Sender address rejected: not owned by user'],
    ['provider_error: SMTP EENVELOPE at MAIL FROM: Mail command failed: 550 5.7.60 SMTP; Client does not have permissions to send as this sender'],
  ])('a refusal of the sender, a relay or the login names EMAIL_FROM: %s', (stored) => {
    expect(emailFailureHint(stored)).toBe(SENDER);
    expect(emailFailureHint(stored)).toContain('EMAIL_FROM');
  });

  it('a refused mailbox says so, and that sending again will not help; the same words elsewhere than the envelope do not blame the sender', () => {
    expect(emailFailureHint("rejected: SMTP EENVELOPE at RCPT TO: Can't send mail - all recipients were rejected: 550 5.1.1 <<redacted>>: Recipient address rejected: User unknown")).toBe(
      REJECTED,
    );
    expect(REJECTED).not.toContain('Gửi lại');
    expect(emailFailureHint("provider_error: SMTP EENVELOPE at RCPT TO: Can't send mail - all recipients were rejected: 451 Try again later")).toBe(
      'Kiểm tra cấu hình gửi email rồi thử lại.',
    );
    expect(emailFailureHint('provider_error: SMTP EMESSAGE at DATA: Message failed: 554 5.7.1 Message rejected as spam')).toBe('Kiểm tra cấu hình gửi email rồi thử lại.');
  });

  it('a 5.1.x code about the recipient is the mailbox, whatever the words: Postfix’s relay recipient table does not name EMAIL_FROM', () => {
    expect(
      emailFailureHint(
        "rejected: SMTP EENVELOPE at RCPT TO: Can't send mail - all recipients were rejected: 550 5.1.1 <<redacted>>: Recipient address rejected: User unknown in relay recipient table",
      ),
    ).toBe(REJECTED);
    // The sender's own 5.1.x (RFC 3463 5.1.8, Postfix's unknown sender domain) still names EMAIL_FROM.
    expect(
      emailFailureHint("provider_error: SMTP EENVELOPE at RCPT TO: Can't send mail - all recipients were rejected: 550 5.1.8 <<redacted>>: Sender address rejected: Domain not found"),
    ).toBe(SENDER);
  });
});

describe('inviteEmailFailedMessage', () => {
  const setup = 'Chưa gửi được email: chưa cấu hình gửi email trên môi trường này. Báo bộ phận kỹ thuật, rồi bấm Gửi lại.';
  it.each([
    ['not_delivered', setup],
    ['missing_smtp_config', setup],
    ['missing_app_url', setup],
    ['rejected', REFUSED_INVITE],
    ['invalid_delivery_mode', setup],
    ['provider_error', 'Chưa gửi được email, bấm Gửi lại.'],
    ['unknown', 'Chưa gửi được email, bấm Gửi lại.'],
    ['toString', 'Chưa gửi được email, bấm Gửi lại.'],
    [null, 'Chưa gửi được email, bấm Gửi lại.'],
  ])('%s', (code, message) => expect(inviteEmailFailedMessage(code)).toBe(message));

  it('a refused address is not worth sending again: the message says to check it and invite again (F9)', () => {
    expect(inviteEmailFailedMessage('rejected')).not.toContain('Gửi lại');
    expect(inviteEmailFailedMessage('rejected')).toContain('mời lại');
  });
});
