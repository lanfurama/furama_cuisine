import type { Metadata } from 'next';
import Link from 'next/link';
import { getPool } from '@/db/client';
import { LIMITS, limitWarnings } from '@/lib/admin/content-rules';
import { formatDateTimeVi } from '@/lib/admin/format';
import { HERO_SLIDE, listSlidesAdmin } from '@/lib/server/content-admin/hero';
import { listDeleted, listHistory } from '@/lib/server/content-admin/history';
import { listMediaOptions } from '@/lib/server/content-admin/media-options';
import { getAutoplayEditor, listSectionsAdmin } from '@/lib/server/content-admin/sections';
import { orderToken, type OrderSnapshot } from '@/lib/server/content-admin/snapshot';
import { requirePagePermission } from '@/lib/server/dal/session';
import { envPrefix, isBlobConfigured } from '@/lib/server/media/blob';
import { HistoryPanel } from '../../_kit/HistoryPanel';
import { RestoreButton } from '../../_kit/RestoreButton';
import { StringsPanel } from '../_ui/StringsPanel';
import { restoreSectionAction } from '../sections/actions';
import { SectionForm } from '../sections/SectionForm';
import { restoreAutoplayAction, restoreSlideAction, restoreSlideOrderAction } from './actions';
import { AutoplayForm } from './AutoplayForm';
import { SlideForm } from './SlideForm';
import { SlideList } from './SlideList';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Hero và phim' };

const SLIDE_LABELS = { image_id: 'Ảnh', image_mobile_id: 'Ảnh cho điện thoại', is_published: 'Hiện' };

/*
 * Spec §7.2 content/hero: the slides (order, show/hide, pictures, phone crop
 * of the first), the hero's copy (hero.*), the slide pace, and the film
 * (poster, link, on/off: the sections screen's writer, C5) with its words
 * (film.*). Every part has its History.
 */
export default async function HeroPage() {
  await requirePagePermission({ content: ['read'] });
  const pool = getPool();
  const [{ items, token }, deleted, orderHistory, images, autoplay, autoplayHistory, sections, filmHistory] = await Promise.all([
    listSlidesAdmin(pool),
    listDeleted(pool, HERO_SLIDE),
    listHistory(pool, 'hero_slides', null, 10),
    listMediaOptions(pool, 'image'),
    getAutoplayEditor(pool),
    listHistory(pool, 'site_settings', 'hero_autoplay_ms', 10),
    listSectionsAdmin(pool),
    listHistory(pool, 'sections', 'film', 10),
  ]);
  const slideHistories = await Promise.all(items.map((s) => listHistory(pool, 'hero_slides', s.id, 10)));
  const film = sections.find((s) => s.key === 'film')!;
  const upload = { prefix: envPrefix(), configured: isBlobConfigured() };
  const shown = items.filter((i) => i.isPublished).length;
  const fileOf = (id: unknown) => (images.find((i) => i.id === id)?.pathname ?? '').split('/').pop() || `slide`;
  const lastAutoplay = autoplayHistory[0] ? { by: autoplayHistory[0].actor, at: formatDateTimeVi(autoplayHistory[0].at) } : null;

  return (
    <>
      <p className="a-crumbs">
        <Link href="/admin/content">← Nội dung</Link>
      </p>
      <h1>Hero và phim</h1>
      <p className="a-lede">Ảnh lớn đầu trang chủ, chữ trên ảnh, tốc độ chuyển slide, và phim. Lưu là lên web ngay; mọi thay đổi khôi phục được từ Lịch sử.</p>

      <section className="a-section-card" aria-labelledby="hero-slides-title">
        <h2 id="hero-slides-title">Slide</h2>
        <SlideList items={items} listToken={token} warnings={limitWarnings('heroSlides', shown)} images={images} upload={upload} />
        <h3>Thêm slide</h3>
        <SlideForm
          slide={{ id: null, imageId: null, imageMobileId: null, isPublished: shown < LIMITS.heroSlides.max }}
          token={token}
          images={images}
          upload={upload}
          label="Thêm slide"
        />
      </section>

      <section className="a-section-card" aria-labelledby="hero-deleted-title">
        <h2 id="hero-deleted-title">Slide đã xóa gần đây</h2>
        {deleted.length === 0 ? (
          <p className="a-muted">Không có slide nào bị xóa.</p>
        ) : (
          <ul className="a-list">
            {deleted.map((d) => {
              const when = formatDateTimeVi(d.at);
              return (
                <li key={d.id} className="a-list-item">
                  <span>
                    {fileOf((d.before.row as { image_id?: unknown } | undefined)?.image_id)} · xóa bởi {d.actor} lúc {when}
                  </span>
                  <RestoreButton action={restoreSlideAction} id={d.id} auditId={d.auditId} side="before" token="deleted" label="Khôi phục mục đã xóa" when={when} />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {items.map((s, i) => (
        <HistoryPanel
          key={s.id}
          title={`Lịch sử: ${s.name}`}
          headingId={`hero-slide-${s.id}-history`}
          entries={slideHistories[i]}
          currentToken={s.token}
          recordId={s.id}
          labels={SLIDE_LABELS}
          restore={restoreSlideAction}
        />
      ))}

      <HistoryPanel
        title="Lịch sử thứ tự slide"
        headingId="hero-order-history"
        entries={orderHistory}
        currentToken={token}
        recordId="hero_slides"
        labels={{}}
        restore={restoreSlideOrderAction}
        tokenOf={(s: OrderSnapshot) => orderToken(s)}
        describe={(e) => `Thứ tự: ${((e.after as OrderSnapshot | null)?.order ?? []).map((o) => o.id).join(', ')}`}
      />

      <section className="a-section-card" aria-labelledby="hero-pace-title">
        <h2 id="hero-pace-title">Tốc độ slide</h2>
        <AutoplayForm ms={autoplay.ms} token={autoplay.token} lastSaved={lastAutoplay} />
        <HistoryPanel
          title="Lịch sử: tốc độ slide"
          headingId="hero-pace-history"
          entries={autoplayHistory}
          currentToken={autoplay.token}
          recordId="hero_autoplay_ms"
          labels={{ hero_autoplay_ms: 'Thời gian mỗi slide (ms)' }}
          restore={restoreAutoplayAction}
        />
      </section>

      <section className="a-section-card" aria-labelledby="hero-film-title">
        <h2 id="hero-film-title">Phim</h2>
        <p className="a-muted">Nút WATCH THE FILM trên hero mở hộp phim. Cùng dữ liệu với section “Phim” ở màn Section trang chủ.</p>
        <SectionForm
          section={film}
          images={images}
          upload={upload}
          formLabel="Phim"
          lastSaved={{ by: film.updatedBy, at: formatDateTimeVi(film.updatedAt) }}
        />
        <HistoryPanel
          title="Lịch sử: phim"
          headingId="hero-film-history"
          entries={filmHistory}
          currentToken={film.token}
          recordId="film"
          labels={{ is_visible: 'Hiện nút WATCH THE FILM', image_id: 'Ảnh poster', link_url: 'Link video' }}
          restore={restoreSectionAction}
        />
      </section>

      <section aria-labelledby="hero-copy-title">
        <h2 id="hero-copy-title">Chữ trên hero và trong hộp phim</h2>
        <StringsPanel
          screen="hero"
          title="Chữ hero và phim"
          groups={[
            { title: 'Hero', prefix: 'hero.' },
            { title: 'Hộp phim', prefix: 'film.' },
          ]}
        />
      </section>
    </>
  );
}
