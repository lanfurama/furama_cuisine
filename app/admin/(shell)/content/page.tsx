import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePagePermission } from '@/lib/server/dal/session';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Nội dung' };

/*
 * The content screens built so far (spec §7.2 /admin/content/…), as a static
 * list: page source files are not there at runtime on Vercel, so the index
 * cannot look for them. Each phase-7 editor adds its line.
 */
const SCREENS = [
  { href: '/admin/content/offers', label: 'Ưu đãi', about: 'Thẻ ưu đãi ở trang chủ: thứ tự, hiện/ẩn, ngày hiện, xóa và khôi phục; chữ của mục.' },
  { href: '/admin/content/stories', label: 'Stories', about: 'Tiêu đề và câu dẫn của mục Stories.' },
  { href: '/admin/content/heritage', label: 'Heritage', about: 'Chữ của mục Heritage (ảnh và link: màn Sections).' },
  { href: '/admin/content/ui-text', label: 'Chữ giao diện', about: 'Nút, nhãn và thông báo chung: tìm kiếm, lỗi của form đặt bàn.' },
];

export default async function ContentIndex() {
  await requirePagePermission({ content: ['read'] });
  return (
    <>
      <h1>Nội dung</h1>
      <p className="a-lede">Chữ và danh sách của web khách. Lưu là lên web ngay; mọi thay đổi khôi phục được từ Lịch sử.</p>
      <ul className="a-list" aria-label="Màn hình nội dung">
        {SCREENS.map((s) => (
          <li key={s.href} className="a-list-item a-list-item--stack">
            <Link href={s.href}>{s.label}</Link>
            <span className="a-muted">{s.about}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
