import { describe, expect, it } from 'vitest';
import { navFor } from './nav';

describe('navFor', () => {
  it('shows each role only what its permissions open', () => {
    expect(navFor('admin').map((i) => i.label)).toEqual(['Tổng quan', 'Đặt bàn', 'Nhà hàng', 'Cài đặt đặt bàn', 'Nhân viên', 'Nhật ký']);
    expect(navFor('editor').map((i) => i.label)).toEqual(['Tổng quan', 'Đặt bàn', 'Nhà hàng']);
  });
});
