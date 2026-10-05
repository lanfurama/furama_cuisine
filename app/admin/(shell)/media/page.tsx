import type { Metadata } from 'next';
import Link from 'next/link';
import { getPool } from '@/db/client';
import { formatDateTimeVi, formatFileSize } from '@/lib/admin/format';
import { requirePagePermission } from '@/lib/server/dal/session';
import { envPrefix, isBlobConfigured } from '@/lib/server/media/blob';
import { listMedia, listTrashed, type LibraryItem } from '@/lib/server/media/library';
import { MediaUploader } from '../_kit/MediaUploader';
import { Thumb } from '../_kit/Thumb';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Thư viện ảnh và PDF' };

const fileName = (m: LibraryItem) => m.pathname.split('/').pop() ?? m.pathname;

/*
 * Spec §7.2 /admin/media: every live file, newest first, with search by name
 * or EN alt text and a filter by kind; upload at the top (§11). Each card opens
 * the file's page (alt text, decorative flag, where it is used, delete,
 * History). The trash lists the files deleted in the last 30 days (R14): each
 * page brings its file back from History until the sweep purges it.
 */
export default async function MediaPage({ searchParams }: { searchParams: Promise<{ q?: string; kind?: string; deleted?: string }> }) {
  await requirePagePermission({ content: ['read'] });
  const { q = '', kind, deleted } = await searchParams;
  const kindFilter: 'image' | 'pdf' | undefined = kind === 'image' || kind === 'pdf' ? kind : undefined;
  const filter = { q: q.trim().slice(0, 100) || undefined, kind: kindFilter };
  const pool = getPool();
  const [items, trash] = await Promise.all([listMedia(pool, filter), listTrashed(pool)]);

  return (
    <>
      <h1>Thư viện ảnh và PDF</h1>
      <p className="a-lede">Ảnh và PDF dùng trên web. File đang được dùng thì không xóa được.</p>
      {deleted === '1' ? (
        <p className="a-notice" role="status">
          Đã xóa file. File nằm trong thùng rác 30 ngày và khôi phục được từ trang của nó.
        </p>
      ) : null}

      <section aria-labelledby="media-upload-title" className="a-card-row">
        <h2 id="media-upload-title">Tải file lên</h2>
        <MediaUploader prefix={envPrefix()} configured={isBlobConfigured()} />
      </section>

      <form className="a-filter" role="search" action="/admin/media" aria-label="Tìm file">
        <div className="a-field">
          <label htmlFor="media-search-q">Tìm theo tên hoặc mô tả</label>
          <input id="media-search-q" name="q" type="search" defaultValue={q} maxLength={100} />
        </div>
        <div className="a-field">
          <label htmlFor="media-search-kind">Loại</label>
          <select id="media-search-kind" name="kind" defaultValue={filter.kind ?? ''}>
            <option value="">Tất cả</option>
            <option value="image">Ảnh</option>
            <option value="pdf">PDF</option>
          </select>
        </div>
        <button className="a-btn" type="submit">
          Lọc
        </button>
      </form>

      {items.length === 0 ? <p className="a-lede">Không có file nào.</p> : null}
      <ul className="a-media-grid" aria-label="Các file">
        {items.map((m) => (
          <li key={m.id} className="a-media-card">
            <Link href={`/admin/media/${m.id}`} aria-label={`${fileName(m)}${m.alt ? `: ${m.alt}` : ''}`}>
              <Thumb file={m} width={160} className="a-media-thumb" />
            </Link>
            <div className="a-media-meta">
              <span className="a-media-name">{fileName(m)}</span>
              <span className="a-muted">
                {m.width && m.height ? `${m.width}×${m.height} · ` : ''}
                {formatFileSize(m.bytes)}
              </span>
              {m.uses > 0 ? <span className="a-tag">Đang dùng ({m.uses})</span> : <span className="a-tag a-tag--warn">Chưa dùng</span>}
              {m.contentType !== 'application/pdf' && !m.isDecorative && !m.alt ? <span className="a-tag a-tag--warn">Thiếu mô tả</span> : null}
            </div>
          </li>
        ))}
      </ul>

      {trash.length > 0 ? (
        <section aria-labelledby="media-trash-title">
          <h2 id="media-trash-title">Thùng rác</h2>
          <p className="a-muted">File đã xóa trong 30 ngày qua; sau đó file bị dọn hẳn khỏi kho.</p>
          <ul className="a-list">
            {trash.map((m) => (
              <li key={m.id} className="a-list-item">
                <Link href={`/admin/media/${m.id}`}>{fileName(m)}</Link>{' '}
                <span className="a-muted">Xóa lúc {formatDateTimeVi(m.deletedAt!)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
