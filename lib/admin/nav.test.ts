import { describe, expect, it } from 'vitest';
import { ADMIN_NAV, NAV_GROUPS, navFor, navGroupsFor } from './nav';

describe('navFor', () => {
  it('shows each role only what its permissions open', () => {
    expect(navFor('admin').map((i) => i.label)).toEqual(['Tổng quan', 'Đặt bàn', 'Nhà hàng', 'Nội dung', 'Thư viện', 'Bản dịch', 'Cài đặt đặt bàn', 'Thông báo email', 'AI', 'Nhân viên', 'Nhật ký']);
    expect(navFor('editor').map((i) => i.label)).toEqual(['Tổng quan', 'Đặt bàn', 'Nhà hàng', 'Nội dung', 'Thư viện', 'Bản dịch']);
  });
});

describe('navGroupsFor', () => {
  const shape = (role: 'admin' | 'editor') => navGroupsFor(role).map((g) => [g.label, g.items.map((i) => i.label)]);

  it('gives an Admin all three headings, each with its own screens', () => {
    expect(shape('admin')).toEqual([
      ['Vận hành', ['Tổng quan', 'Đặt bàn', 'Nhà hàng']],
      ['Web khách', ['Nội dung', 'Thư viện', 'Bản dịch']],
      ['Hệ thống', ['Cài đặt đặt bàn', 'Thông báo email', 'AI', 'Nhân viên', 'Nhật ký']],
    ]);
  });

  it('drops the heading an Editor has nothing under', () => {
    expect(shape('editor')).toEqual([
      ['Vận hành', ['Tổng quan', 'Đặt bàn', 'Nhà hàng']],
      ['Web khách', ['Nội dung', 'Thư viện', 'Bản dịch']],
    ]);
    expect(navGroupsFor('editor').map((g) => g.id)).toEqual(['ops', 'web']);
  });

  it('files every item under a heading that exists', () => {
    const ids = NAV_GROUPS.map((g) => g.id);
    for (const item of ADMIN_NAV) expect(ids, item.href).toContain(item.group);
  });

  it.each(['admin', 'editor'] as const)('loses and reorders nothing for %s: the headings read in a row are navFor', (role) => {
    expect(navGroupsFor(role).flatMap((g) => g.items)).toEqual(navFor(role).map(({ href, label }) => ({ href, label })));
  });
});
