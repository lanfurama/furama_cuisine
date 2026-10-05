/*
 * Vietnamese names for audit_feed.action and entity_type on /admin/audit.
 * The action list is spec §5.2's (create, update, delete, reorder, restore,
 * settings, staff.*) plus reservation.<type> from reservation_events (§7.4);
 * lib/admin/audit-labels.test.ts fails when the code writes a staff action,
 * or migration 006 allows an event type, that this file does not name.
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
  // reservation_events through audit_feed: 'reservation.' || type.
  'reservation.created': 'Tạo đặt bàn',
  'reservation.status_changed': 'Đổi trạng thái đặt bàn',
  'reservation.edited': 'Sửa đặt bàn',
  'reservation.note_added': 'Thêm ghi chú nội bộ',
};

const ENTITIES: Record<string, string> = {
  staff_user: 'Nhân viên',
  staff_invitation: 'Lời mời',
  reservation: 'Đặt bàn',
  // Booking configuration (audit_log): the periods of one restaurant, its switch and overrides, the defaults, a closure.
  service_periods: 'Ca phục vụ',
  restaurant_booking: 'Quy tắc đặt bàn',
  booking_settings: 'Cài đặt đặt bàn',
  closure: 'Ngày đóng cửa',
  // Email (phase 5): a staff.new recipient, the shared inbox (site_settings.email), "Gửi lại" on one email (R2).
  notification_recipient: 'Người nhận thông báo',
  site_settings: 'Cài đặt chung',
  email_outbox: 'Email',
  // Content (phase 7): a list item and its order (entity_id NULL), a registry key, a policy version.
  offers: 'Ưu đãi',
  sections: 'Section trang chủ',
  // A restaurant's content (the row, its translations, cuisines and highlights as one aggregate).
  restaurants: 'Nhà hàng',
  restaurant_highlights: 'Điểm nổi bật',
  hero_slides: 'Slide hero',
  content_strings: 'Chữ trên web',
  legal_versions: 'Phiên bản chính sách',
  // A library file: the row and its alt text (R5, C6).
  media: 'File trong thư viện',
};

export function auditActionLabel(action: string): string {
  return ACTIONS[action] ?? action;
}

export function auditEntityLabel(entityType: string): string {
  return ENTITIES[entityType] ?? entityType;
}
