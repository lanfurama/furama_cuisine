import { roleCan, type Permissions, type StaffRole } from '@/lib/server/auth/permissions';

export type NavItem = { href: string; label: string; permission?: Permissions };

/*
 * The sidebar, in order. An item with a permission is shown only to roles
 * that have it; the page behind it checks again on the server. Each phase
 * appends its screens here as it builds them (spec §7.2).
 */
export const ADMIN_NAV: readonly NavItem[] = [
  { href: '/admin', label: 'Tổng quan' },
  { href: '/admin/reservations', label: 'Đặt bàn', permission: { reservations: ['read'] } },
  { href: '/admin/restaurants', label: 'Nhà hàng', permission: { schedule: ['read'] } },
  { href: '/admin/users', label: 'Nhân viên', permission: { user: ['list'] } },
  { href: '/admin/audit', label: 'Nhật ký', permission: { audit: ['read'] } },
];

export function navFor(role: StaffRole): NavItem[] {
  return ADMIN_NAV.filter((item) => !item.permission || roleCan(role, item.permission));
}

export const ROLE_LABELS: Record<StaffRole, string> = { admin: 'Admin', editor: 'Editor' };
