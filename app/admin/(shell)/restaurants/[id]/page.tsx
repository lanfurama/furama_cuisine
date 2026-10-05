import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPool } from '@/db/client';
import { detailPageWarnings } from '@/lib/admin/content-rules';
import { formatDateTimeVi } from '@/lib/admin/format';
import { listDestinationOptions } from '@/lib/server/content-admin/destinations';
import { listHistory } from '@/lib/server/content-admin/history';
import { listMediaOptions } from '@/lib/server/content-admin/media-options';
import { getRestaurantEditor, listCuisineOptions } from '@/lib/server/content-admin/restaurants';
import { requirePagePermission } from '@/lib/server/dal/session';
import { envPrefix, isBlobConfigured } from '@/lib/server/media/blob';
import { HistoryPanel } from '../../_kit/HistoryPanel';
import { restoreRestaurantAction } from './actions';
import { RestaurantForm } from './RestaurantForm';
import { RestaurantNav } from './RestaurantNav';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Nhà hàng' };

/** The History tab's names (spec §7.5), in form order. */
const LABELS = {
  name: 'Tên',
  slug: 'Đường dẫn',
  destination_id: 'Điểm đến',
  is_published: 'Hiện trên web',
  archived_at: 'Lưu trữ',
  has_detail_page: 'Trang chi tiết',
  type_label: 'Loại',
  card_image_id: 'Ảnh thẻ',
  detail_image_id: 'Ảnh chân dung',
  og_image_id: 'Ảnh chia sẻ',
  phone_display: 'Số điện thoại',
  phone_e164: 'Số điện thoại (E.164)',
  map_url: 'Bản đồ',
  detail_kicker: 'Dòng trên tên',
  story_label: 'Nhãn câu chuyện',
  story: 'Câu chuyện',
  highlights_title: 'Tiêu đề phần nổi bật',
  menu_pdf_media_id: 'File thực đơn',
  menu_pdf_url: 'Link thực đơn',
  seo_title: 'Tiêu đề SEO',
  seo_description: 'Mô tả SEO',
  'list:cuisines': 'Ẩm thực',
  'list:highlights': 'Điểm nổi bật',
};

/*
 * Spec §7.2 /admin/restaurants/[id]: one restaurant's content (name, slug,
 * destination, pictures, contact, detail page, highlights, menu, SEO), its
 * warnings (spec §6.4, §6.5), a tab to its booking screen (phase 4), and
 * History of the whole aggregate (spec §7.5). An archived restaurant says so
 * above the form and offers no "Xem trên web": guests see none of it.
 */
export default async function RestaurantContentPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePagePermission({ content: ['read'] });
  const { id } = await params;
  if (!/^[a-z0-9-]{1,60}$/.test(id)) notFound();
  const pool = getPool();
  const [editor, destinations, cuisines, images, pdfs, history] = await Promise.all([
    getRestaurantEditor(pool, id),
    listDestinationOptions(pool),
    listCuisineOptions(pool),
    listMediaOptions(pool, 'image'),
    listMediaOptions(pool, 'pdf'),
    listHistory(pool, 'restaurants', id),
  ]);
  if (!editor) notFound();
  const v = editor.values;
  const warnings = detailPageWarnings({
    hasDetailPage: v.hasDetailPage,
    name: v.name,
    shownHighlights: v.highlights.filter((h) => h.isPublished).length,
    hasPhone: editor.hasPhone,
    hasMap: editor.hasMap,
    hasMenu: Boolean(v.menuPdfMediaId.en || v.menuPdfUrl.en || v.highlights.some((h) => h.isPublished)),
  });

  return (
    <>
      <p className="a-crumbs">
        <Link href="/admin/restaurants">← Nhà hàng</Link>
      </p>
      <h1>{v.name}</h1>
      <RestaurantNav id={id} current="content" />
      {editor.archived ? (
        <p className="a-alert" role="status">
          Nhà hàng đang lưu trữ: khách không thấy. Bỏ lưu trữ ở danh sách nhà hàng.
        </p>
      ) : null}
      {warnings.length ? (
        <ul className="a-warn-list" aria-label="Cảnh báo">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
      <RestaurantForm
        id={id}
        token={editor.token}
        values={v}
        destinations={destinations}
        cuisines={cuisines}
        images={images}
        pdfs={pdfs}
        upload={{ prefix: envPrefix(), configured: isBlobConfigured() }}
        lastSaved={{ by: editor.updatedBy, at: formatDateTimeVi(editor.updatedAt) }}
        viewHref={editor.archived ? null : v.hasDetailPage && v.isPublished ? `/en/restaurants/${v.slug}` : '/en#restaurants'}
      />
      <HistoryPanel headingId={`restaurant-${id}-history`} entries={history} currentToken={editor.token} recordId={id} labels={LABELS} restore={restoreRestaurantAction} />
    </>
  );
}
