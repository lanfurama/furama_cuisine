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
});
