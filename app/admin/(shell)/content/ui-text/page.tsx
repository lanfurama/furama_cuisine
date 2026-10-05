import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePagePermission } from '@/lib/server/dal/session';
import { StringsPanel } from '../_ui/StringsPanel';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Chữ giao diện' };

/*
 * Spec §7.2 /admin/content/ui-text: the remaining ui.*, form.*, error.*, search.*, common.* keys, one group
 * per part of the site (the menu's own items: content/navigation).
 */
export default async function Page() {
  await requirePagePermission({ content: ['read'] });
  return (
    <>
      <p className="a-crumbs">
        <Link href="/admin/content">← Nội dung</Link>
      </p>
      <h1>Chữ giao diện</h1>
      <p className="a-lede">Chữ của các nút, nhãn và thông báo trên web khách (tiếng Anh). Lưu là web khách đổi ngay.</p>
      <StringsPanel
        screen="ui-text"
        title="Chữ giao diện"
        groups={[
          { title: 'Đầu trang, menu điện thoại và thanh tab', prefix: 'ui.' },
          { title: 'Chữ dùng chung', prefix: 'common.' },
          { title: 'Ô nhập của form đặt bàn', prefix: 'form.' },
          { title: 'Hộp tìm kiếm', prefix: 'search.' },
          { title: 'Lỗi của form đặt bàn', prefix: 'error.' },
        ]}
      />
    </>
  );
}
