import { Button, Heading, Link, Text } from 'react-email';
import { EmailLayout, emailStyles } from './layout';

export type PasswordResetProps = {
  /** Full link to /admin/reset-password?token=… */
  resetUrl: string;
  userName?: string;
  expiresInMinutes?: number;
};

export const passwordResetSubject = 'Đặt lại mật khẩu quản trị Furama Cuisine';

export function PasswordResetEmail({ resetUrl, userName, expiresInMinutes = 60 }: PasswordResetProps) {
  return (
    <EmailLayout preview="Đặt lại mật khẩu quản trị Furama Cuisine">
      <Heading as="h1" style={emailStyles.heading}>Đặt lại mật khẩu</Heading>
      <Text style={emailStyles.paragraph}>
        {`${userName ? `Xin chào ${userName}, chúng` : 'Chúng'} tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản quản trị Furama Cuisine của bạn.`}
      </Text>
      <Button href={resetUrl} style={emailStyles.button}>Đặt mật khẩu mới</Button>
      <Text style={emailStyles.small}>
        Nếu nút không hoạt động, hãy mở liên kết này: <Link href={resetUrl}>{resetUrl}</Link>
      </Text>
      <Text style={emailStyles.paragraph}>
        {`Liên kết có hiệu lực trong ${expiresInMinutes} phút. Nếu bạn không yêu cầu, hãy bỏ qua email này; mật khẩu hiện tại vẫn giữ nguyên.`}
      </Text>
    </EmailLayout>
  );
}
