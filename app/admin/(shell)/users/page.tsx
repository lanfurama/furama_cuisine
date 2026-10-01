import type { Metadata } from 'next';
import { getPool } from '@/db/client';
import { formatDateTimeVi } from '@/lib/admin/format';
import { ROLE_LABELS } from '@/lib/admin/nav';
import { listOpenInvitations, listStaff } from '@/lib/server/auth/staff-queries';
import { requirePagePermission } from '@/lib/server/dal/session';
import { InvitationList, type InvitationItem } from './InvitationList';
import { InviteForm } from './InviteForm';
import { StaffTable, type StaffItem } from './StaffTable';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Nhân viên' };

export default async function UsersPage() {
  // Before any query: an Editor gets the 403 view and no staff data.
  const me = await requirePagePermission({ user: ['list'] });
  const pool = getPool();
  const [staffRows, invitationRows] = await Promise.all([listStaff(pool), listOpenInvitations(pool)]);

  // Only what the screen shows reaches the browser; dates and labels are formatted here (dates on Vietnam's clock).
  const staff: StaffItem[] = staffRows.map((s) => ({
    id: s.id,
    name: s.name,
    email: s.email,
    role: s.role,
    banned: s.banned,
    createdLabel: formatDateTimeVi(s.created_at),
    isSelf: s.id === me.userId,
  }));
  const invitations: InvitationItem[] = invitationRows.map((i) => ({
    id: i.id,
    email: i.email,
    roleLabel: ROLE_LABELS[i.role],
    expiresLabel: formatDateTimeVi(i.expires_at),
    expired: i.expired,
    emailFailed: i.email_error !== null,
  }));

  return (
    <>
      <h1>Nhân viên</h1>
      <p className="a-lede">Mời người mới, đổi vai trò, khóa hoặc xóa tài khoản. Mọi thay đổi được ghi vào nhật ký.</p>
      <StaffTable staff={staff} />
      <h2>Lời mời đang chờ</h2>
      <InvitationList invitations={invitations} />
      <InviteForm />
    </>
  );
}
