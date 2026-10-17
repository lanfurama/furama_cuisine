import type { Metadata } from 'next';
import Link from 'next/link';
import { getPool } from '@/db/client';
import { formatDateTimeVi } from '@/lib/admin/format';
import { listHistory } from '@/lib/server/history/history';
import { listMediaOptions } from '@/lib/server/content-admin/media-options';
import { getSettingsEditor, SHARE_IMAGE } from '@/lib/server/content-admin/settings';
import { requirePagePermission } from '@/lib/server/dal/session';
import { envPrefix, isBlobConfigured } from '@/lib/server/media/blob';
import { HistoryPanel } from '../../_kit/HistoryPanel';
import { SeoSuggestButton } from '../../_kit/SeoSuggestButton';
import { StringsPanel, type ScreenSearchParams } from '../_ui/StringsPanel';
import { restoreShareImageAction } from './actions';
import { ShareImageForm } from './ShareImageForm';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'SEO' };

/*
 * Spec §7.2 content/seo: how the site names itself to search engines and in
 * shared links (seo.*: the home page's title and description, its share
 * text, the other pages' title pattern, the not-found title) and the share
 * picture (site_settings.og_image_id, with History). A restaurant's own SEO
 * title, description and picture are on its screen; a restaurant page
 * without them uses these (L7-13). "Gợi ý bằng AI" (phase 9, R9-22) under
 * the home page's description fills its title and description.
 */
export default async function SeoPage({ searchParams }: { searchParams: ScreenSearchParams }) {
  await requirePagePermission({ content: ['read'] });
  const pool = getPool();
  const [editor, history, images] = await Promise.all([
    getSettingsEditor(pool, SHARE_IMAGE),
    listHistory(pool, 'site_settings', SHARE_IMAGE.id, 10),
    listMediaOptions(pool, 'image'),
  ]);
  const lastSaved = history[0] ? { by: history[0].actor, at: formatDateTimeVi(history[0].at) } : null;

  return (
    <>
      <p className="a-crumbs">
        <Link href="/admin/content">← Nội dung</Link>
      </p>
      <h1>SEO</h1>
      <p className="a-lede">
        Tên và mô tả của web trong kết quả tìm kiếm và khi chia sẻ link. Trang nhà hàng có tiêu đề, mô tả và ảnh riêng ở{' '}
        <Link href="/admin/restaurants">màn của từng nhà hàng</Link>; trang nào chưa có thì dùng mô tả và ảnh ở đây. Lưu là lên web ngay; mọi thay đổi khôi
        phục được từ Lịch sử.
      </p>

      <section aria-labelledby="seo-copy" className="a-card-row">
        <h2 id="seo-copy">Tiêu đề và mô tả</h2>
        <StringsPanel
          searchParams={searchParams}
          screen="seo"
          title="Chữ SEO"
          asides={{
            // R9-22: the home page's pair only; the share text and the title patterns are not suggested.
            'seo.home_description': (
              <SeoSuggestButton
                target={{ kind: 'home' }}
                fields={{ title: 'v:seo.home_title', description: 'v:seo.home_description' }}
                hint="AI gợi ý tiêu đề và mô tả trang chủ từ nội dung đang hiện trên web, bằng ngôn ngữ đang sửa. Chưa lưu gì cho tới khi bạn bấm Lưu."
              />
            ),
          }}
        />
      </section>

      <section className="a-section-card" aria-labelledby="seo-share">
        <h2 id="seo-share">Ảnh chia sẻ</h2>
        <ShareImageForm
          token={editor.token}
          imageId={(editor.values.og_image_id as string | null) ?? null}
          images={images}
          upload={{ prefix: envPrefix(), configured: isBlobConfigured() }}
          lastSaved={lastSaved}
        />
        <HistoryPanel
          title="Lịch sử: ảnh chia sẻ"
          headingId="seo-share-history"
          entries={history}
          currentToken={editor.token}
          recordId={SHARE_IMAGE.id}
          labels={{ og_image_id: 'Ảnh chia sẻ' }}
          restore={restoreShareImageAction}
        />
      </section>
    </>
  );
}
