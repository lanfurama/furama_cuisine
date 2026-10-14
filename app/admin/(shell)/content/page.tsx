import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePagePermission } from '@/lib/server/dal/session';
import { Icon, type IconName } from '../_ui/Icon';
import { PageHeader } from '../_ui/PageHeader';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Nội dung' };

/*
 * The content screens built so far (spec §7.2 /admin/content/…), as a static
 * list in groups (the home page's sections, the restaurants and booking, the
 * words every page shares, the policy and the emails): page source files are
 * not there at runtime on Vercel, so the index cannot look for them. Each
 * phase-7 editor adds its line. Each card's link carries the screen's name
 * alone; the card around it takes the click (admin.css .a-tile).
 */
type Screen = { href: string; label: string; icon: IconName; about: string };

const GROUPS: readonly { title: string; screens: readonly Screen[] }[] = [
  {
    title: 'Trang chủ',
    screens: [
      {
        href: '/admin/content/sections',
        label: 'Section trang chủ',
        icon: 'layers',
        about: 'Bật hoặc tắt từng phần của trang chủ; ảnh và link của phim, Experiences và Heritage.',
      },
      {
        href: '/admin/content/hero',
        label: 'Hero và phim',
        icon: 'film',
        about: 'Slide đầu trang chủ, chữ trên ảnh, tốc độ chuyển slide; poster, link và chữ của phim.',
      },
      {
        href: '/admin/content/cuisines',
        label: 'Ẩm thực',
        icon: 'bowl',
        about: 'Thanh “Explore by Cuisine”: tên, ảnh, thứ tự, hiện/ẩn của từng ẩm thực; cũng là bộ lọc ẩm thực.',
      },
      {
        href: '/admin/content/destinations',
        label: 'Điểm đến',
        icon: 'pin',
        about: 'Thẻ điểm đến ở trang chủ, tên, địa chỉ và số điện thoại của từng địa điểm; ẩn một điểm đến là ẩn nhà hàng của nó.',
      },
      {
        href: '/admin/content/offers',
        label: 'Ưu đãi',
        icon: 'tag',
        about: 'Thẻ ưu đãi ở trang chủ: thứ tự, hiện/ẩn, ngày hiện, xóa và khôi phục; chữ của mục.',
      },
      {
        href: '/admin/content/experiences',
        label: 'Experiences',
        icon: 'star',
        about: 'Các dòng của mục Experiences (tiêu đề, mô tả, link) và chữ của mục; ảnh bên cạnh: màn Sections.',
      },
      { href: '/admin/content/stories', label: 'Stories', icon: 'book', about: 'Thẻ bài viết (ảnh, link, ngày, chuyên mục, tiêu đề) và chữ của mục Stories.' },
      { href: '/admin/content/heritage', label: 'Heritage', icon: 'landmark', about: 'Chữ của mục Heritage (ảnh và link: màn Sections).' },
    ],
  },
  {
    title: 'Nhà hàng và đặt bàn',
    screens: [
      {
        href: '/admin/restaurants',
        label: 'Nhà hàng',
        icon: 'utensils',
        about: 'Nội dung từng nhà hàng: ảnh, trang chi tiết, điểm nổi bật, thực đơn, SEO; chữ dùng chung của trang nhà hàng.',
      },
      {
        href: '/admin/content/booking',
        label: 'Đặt bàn',
        icon: 'calendar',
        about: 'Thanh đặt bàn, ô tìm nhà hàng và form đặt bàn: nhà hàng và dịp chọn sẵn, chữ của các nút, nhãn và thông báo.',
      },
    ],
  },
  {
    title: 'Toàn trang',
    screens: [
      {
        href: '/admin/content/navigation',
        label: 'Menu điều hướng',
        icon: 'list',
        about: 'Các mục của thanh menu và menu điện thoại: nhãn, section đích, thứ tự, hiện/ẩn.',
      },
      {
        href: '/admin/content/contact',
        label: 'Liên hệ và chân trang',
        icon: 'phone',
        about: 'Link mạng xã hội, khẩu hiệu và chữ của chân trang; xem địa chỉ và email chung mà chân trang in.',
      },
      { href: '/admin/content/seo', label: 'SEO', icon: 'trend', about: 'Tiêu đề và mô tả của web trong kết quả tìm kiếm và khi chia sẻ link; ảnh chia sẻ.' },
      {
        href: '/admin/content/ui-text',
        label: 'Chữ giao diện',
        icon: 'type',
        about: 'Nút, nhãn và thông báo chung: đầu trang, tìm kiếm, ô nhập và lỗi của form đặt bàn.',
      },
    ],
  },
  {
    title: 'Chính sách và email',
    screens: [
      {
        href: '/admin/content/legal',
        label: 'Chính sách bảo mật',
        icon: 'shield',
        about: 'Trang chính sách và câu đồng ý ở form đặt bàn; mỗi lần đổi chữ khách đồng ý là một phiên bản mới.',
      },
      { href: '/admin/content/emails', label: 'Nội dung email', icon: 'mail', about: 'Tiêu đề và nội dung email đặt bàn, xem trước với một đặt bàn mẫu.' },
    ],
  },
];

export default async function ContentIndex() {
  await requirePagePermission({ content: ['read'] });
  return (
    <>
      <PageHeader title="Nội dung" lede="Chữ và danh sách của web khách. Lưu là lên web ngay; mọi thay đổi khôi phục được từ Lịch sử." />
      {GROUPS.map((group) => (
        <section key={group.title} className="a-tile-group">
          <h2>{group.title}</h2>
          <ul className="a-tiles" aria-label={`Màn hình nội dung: ${group.title}`}>
            {group.screens.map((s) => (
              <li key={s.href} className="a-tile">
                <span className="a-tile-icon" aria-hidden="true">
                  <Icon name={s.icon} size={20} />
                </span>
                <Link href={s.href}>{s.label}</Link>
                <p>{s.about}</p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
