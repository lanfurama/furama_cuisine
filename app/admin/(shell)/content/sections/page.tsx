import type { Metadata } from 'next';
import Link from 'next/link';
import { getPool } from '@/db/client';
import { formatDateTimeVi } from '@/lib/admin/format';
import { listHistory } from '@/lib/server/content-admin/history';
import { listMediaOptions } from '@/lib/server/content-admin/media-options';
import { listSectionsAdmin } from '@/lib/server/content-admin/sections';
import { requirePagePermission } from '@/lib/server/dal/session';
import { envPrefix, isBlobConfigured } from '@/lib/server/media/blob';
import { HistoryPanel } from '../../_kit/HistoryPanel';
import { restoreSectionAction } from './actions';
import { SectionForm } from './SectionForm';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Section trang chủ' };

/** The History tab's names (spec §7.5). */
const LABELS = { is_visible: 'Hiện trên trang chủ', image_id: 'Ảnh', link_url: 'Link' };

/*
 * Spec §7.2 content/sections: every home section's switch (restaurants is
 * locked on, spec §6.5), the pictures of the film, Experiences and Heritage,
 * and the film's and Heritage's links; each section with its History.
 */
export default async function SectionsPage() {
  await requirePagePermission({ content: ['read'] });
  const pool = getPool();
  const [sections, images] = await Promise.all([listSectionsAdmin(pool), listMediaOptions(pool, 'image')]);
  const histories = await Promise.all(sections.map((s) => listHistory(pool, 'sections', s.key, 10)));
  const upload = { prefix: envPrefix(), configured: isBlobConfigured() };
  return (
    <>
      <p className="a-crumbs">
        <Link href="/admin/content">← Nội dung</Link>
      </p>
      <h1>Section trang chủ</h1>
      <p className="a-lede">
        Bật hoặc tắt từng phần của trang chủ, và ảnh, link của phim, Experiences và Heritage. Lưu là lên web ngay; mọi thay đổi khôi phục được từ Lịch sử.
      </p>
      {sections.map((s, i) => (
        <section key={s.key} className="a-section-card" aria-labelledby={`section-${s.key}-title`}>
          <h2 id={`section-${s.key}-title`}>{s.label}</h2>
          <SectionForm section={s} images={images} upload={upload} lastSaved={{ by: s.updatedBy, at: formatDateTimeVi(s.updatedAt) }} />
          <HistoryPanel
            title={`Lịch sử: ${s.label}`}
            headingId={`section-${s.key}-history`}
            entries={histories[i]}
            currentToken={s.token}
            recordId={s.key}
            labels={LABELS}
            restore={restoreSectionAction}
          />
        </section>
      ))}
    </>
  );
}
