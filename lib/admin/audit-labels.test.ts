import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { auditActionLabel, auditEntityLabel } from './audit-labels';

describe('audit labels', () => {
  it('names every staff action the code writes, in Vietnamese', () => {
    const sources = ['lib/server/auth/staff.ts', 'scripts/create-admin.mjs'].map((f) => readFileSync(f, 'utf8')).join('\n');
    const written = [...new Set([...sources.matchAll(/'(staff\.[a-z_]+)'/g)].map((m) => m[1]))].sort();
    expect(written).toEqual([
      'staff.ban',
      'staff.bootstrap',
      'staff.invite',
      'staff.invite_accept',
      'staff.invite_resend',
      'staff.invite_revoke',
      'staff.remove',
      'staff.role',
      'staff.unban',
    ]);
    for (const action of written) expect(auditActionLabel(action)).not.toBe(action);
  });

  it('names the content actions of spec §5.2 and falls back to the raw action', () => {
    expect(['create', 'update', 'delete', 'reorder', 'restore', 'settings'].map(auditActionLabel)).toEqual([
      'Tạo mới',
      'Sửa',
      'Xóa',
      'Sắp xếp lại',
      'Khôi phục',
      'Đổi cài đặt',
    ]);
    expect(auditActionLabel('staff.something_new')).toBe('staff.something_new');
    expect(auditEntityLabel('staff_user')).toBe('Nhân viên');
    expect(auditEntityLabel('restaurant')).toBe('restaurant');
  });

  it('names every reservation event type of migration 006, as audit_feed shows it (reservation.<type>)', () => {
    const migration = readFileSync('db/migrations/006_booking_v2.sql', 'utf8');
    const check = /type\s+text\s+NOT NULL CHECK \(type IN \(([^)]*)\)\)/.exec(migration)?.[1] ?? '';
    const types = [...check.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(types).toEqual(['created', 'status_changed', 'edited', 'note_added']);
    for (const type of types) expect(auditActionLabel(`reservation.${type}`)).not.toBe(`reservation.${type}`);
    expect(auditActionLabel('reservation.status_changed')).toBe('Đổi trạng thái đặt bàn');
  });

  it('names the booking entities: the reservation, and the configuration phase 4 writes to audit_log', () => {
    expect(['reservation', 'service_periods', 'restaurant_booking', 'booking_settings', 'closure'].map(auditEntityLabel)).toEqual([
      'Đặt bàn',
      'Ca phục vụ',
      'Quy tắc đặt bàn',
      'Cài đặt đặt bàn',
      'Ngày đóng cửa',
    ]);
  });

  it('names every entity the email screens write to audit_log', () => {
    const source = ['lib/server/email/recipients.ts', 'lib/server/email/outbox-log.ts'].map((f) => readFileSync(f, 'utf8')).join('\n');
    const entities = [...new Set([...source.matchAll(/entityType: '([a-z_]+)'/g)].map((m) => m[1]))].sort();
    expect(entities).toEqual(['email_outbox', 'notification_recipient', 'site_settings']);
    expect(entities.map(auditEntityLabel)).toEqual(['Email', 'Người nhận thông báo', 'Cài đặt chung']);
  });

  it('names every configuration entity the booking screens write to audit_log', () => {
    const config = readFileSync('lib/server/booking/config.ts', 'utf8');
    const entities = [...new Set([...config.matchAll(/entityType: '([a-z_]+)'/g)].map((m) => m[1]))];
    expect(entities).toContain('service_periods');
    for (const entity of entities) expect(auditEntityLabel(entity)).not.toBe(entity);
  });

  it('names every entity the content editors write to audit_log (phase 7, R5: the table name)', () => {
    const files = ['lib/server/content-admin/offers.ts', 'lib/server/content/strings-admin.ts', 'lib/server/content/policy-version.ts', 'lib/server/media/library.ts'];
    const source = files.map((f) => readFileSync(f, 'utf8')).join('\n');
    const entities = [...new Set([...source.matchAll(/entityType: '([a-z_]+)'/g)].map((m) => m[1]))].sort();
    expect(entities).toEqual(['content_strings', 'legal_versions', 'media', 'offers']);
    expect(entities.map(auditEntityLabel)).toEqual(['Chữ trên web', 'Phiên bản chính sách', 'File trong thư viện', 'Ưu đãi']);
  });
});
