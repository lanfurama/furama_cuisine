/*
 * Vietnamese names for audit_log.action and entity_type on /admin/audit.
 * The action list is spec §5.2's (create, update, delete, reorder, restore,
 * settings, staff.*); lib/admin/audit-labels.test.ts fails when the code
 * writes a staff action this file does not name.
 */
const ACTIONS: Record<string, string> = {
  create: 'Tạo mới',
  update: 'Sửa',
  delete: 'Xóa',
  reorder: 'Sắp xếp lại',
  restore: 'Khôi phục',
  settings: 'Đổi cài đặt',
  'staff.bootstrap': 'Tạo Admin đầu tiên',
  'staff.invite': 'Mời nhân viên',
  'staff.invite_resend': 'Gửi lại lời mời',
  'staff.invite_revoke': 'Thu hồi lời mời',
  'staff.invite_accept': 'Nhận lời mời',
  'staff.role': 'Đổi vai trò',
  'staff.ban': 'Khóa tài khoản',
  'staff.unban': 'Mở khóa tài khoản',
  'staff.remove': 'Xóa tài khoản',
};

const ENTITIES: Record<string, string> = {
  staff_user: 'Nhân viên',
  staff_invitation: 'Lời mời',
};

export function auditActionLabel(action: string): string {
  return ACTIONS[action] ?? action;
}

export function auditEntityLabel(entityType: string): string {
  return ENTITIES[entityType] ?? entityType;
}
