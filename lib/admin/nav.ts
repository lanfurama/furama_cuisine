import { roleCan, type Permissions, type StaffRole } from '@/lib/server/auth/permissions';

/** The sidebar's headings: daily work, the guest site's words and files, then settings and people. */
export type NavGroup = 'ops' | 'web' | 'system';

export const NAV_GROUPS: readonly { id: NavGroup; label: string }[] = [
  { id: 'ops', label: 'Vận hành' },
  { id: 'web', label: 'Web khách' },
  { id: 'system', label: 'Hệ thống' },
];

export type NavItem = { href: string; label: string; group: NavGroup; permission?: Permissions };

/*
 * The sidebar, in order, under its group headings. An item with a permission
 * is shown only to roles that have it; the page behind it checks again on the
 * server. Each phase appends its screens here as it builds them (spec §7.2).
 */
export const ADMIN_NAV: readonly NavItem[] = [
  { href: '/admin', label: 'Tổng quan', group: 'ops' },
  { href: '/admin/reservations', label: 'Đặt bàn', group: 'ops', permission: { reservations: ['read'] } },
  { href: '/admin/restaurants', label: 'Nhà hàng', group: 'ops', permission: { schedule: ['read'] } },
  { href: '/admin/content', label: 'Nội dung', group: 'web', permission: { content: ['read'] } },
  { href: '/admin/media', label: 'Thư viện', group: 'web', permission: { content: ['read'] } },
  { href: '/admin/translations', label: 'Bản dịch', group: 'web', permission: { content: ['read'] } },
  { href: '/admin/settings/booking', label: 'Cài đặt đặt bàn', group: 'system', permission: { settings: ['read'] } },
  { href: '/admin/settings/notifications', label: 'Thông báo email', group: 'system', permission: { settings: ['read'] } },
  { href: '/admin/settings/ai', label: 'AI', group: 'system', permission: { settings: ['read'] } },
  { href: '/admin/users', label: 'Nhân viên', group: 'system', permission: { user: ['list'] } },
  { href: '/admin/audit', label: 'Nhật ký', group: 'system', permission: { audit: ['read'] } },
];

export function navFor(role: StaffRole): NavItem[] {
  return ADMIN_NAV.filter((item) => !item.permission || roleCan(role, item.permission));
}

export const ROLE_LABELS: Record<StaffRole, string> = { admin: 'Admin', editor: 'Editor' };
