import { Button, Heading, Link, Text } from 'react-email';
import { EmailLayout, emailStyles } from './layout';

export type StaffInvitationProps = {
  /** Full accept link, e.g. https://host/admin/accept-invite?token=… */
  acceptUrl: string;
  role: 'admin' | 'editor';
  inviterName: string;
  expiresInDays?: number;
};

export const roleLabelVi = { admin: 'Quản trị viên', editor: 'Biên tập viên' } as const;

export const staffInvitationSubject = 'Lời mời tham gia quản trị Furama Cuisine';

export function StaffInvitationEmail({ acceptUrl, role, inviterName, expiresInDays = 7 }: StaffInvitationProps) {
  const roleLabel = roleLabelVi[role];
  return (
    <EmailLayout preview={`${inviterName} mời bạn tham gia quản trị Furama Cuisine với vai trò ${roleLabel}`}>
      <Heading as="h1" style={emailStyles.heading}>Bạn được mời tham gia quản trị Furama Cuisine</Heading>
      <Text style={emailStyles.paragraph}>
        {`${inviterName} đã mời bạn vào khu vực quản trị Furama Cuisine với vai trò `}<strong>{roleLabel}</strong>.
      </Text>
      <Button href={acceptUrl} style={emailStyles.button}>Chấp nhận lời mời</Button>
      <Text style={emailStyles.small}>
        Nếu nút không hoạt động, hãy mở liên kết này: <Link href={acceptUrl}>{acceptUrl}</Link>
      </Text>
      <Text style={emailStyles.paragraph}>
        {`Liên kết có hiệu lực trong ${expiresInDays} ngày và chỉ dùng được một lần. Nếu bạn không mong đợi lời mời này, hãy bỏ qua email.`}
      </Text>
    </EmailLayout>
  );
}
