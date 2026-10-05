import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPool } from '@/db/client';
import { formatDateTimeVi, formatFileSize } from '@/lib/admin/format';
import { listHistory } from '@/lib/server/content-admin/history';
import { requirePagePermission } from '@/lib/server/dal/session';
import { getMedia, mediaUsage } from '@/lib/server/media/library';
import { HistoryPanel } from '../../_kit/HistoryPanel';
import { Thumb } from '../../_kit/Thumb';
import { restoreMediaAction } from '../actions';
import { DeleteMediaForm, MediaDetailsForm } from './MediaForms';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'File trong thư viện' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The History tab's names for a file's fields (spec §7.5). */
const LABELS = {
  alt: 'Mô tả (alt)',
  is_decorative: 'Ảnh trang trí',
  deleted_at: 'Thùng rác',
  url: 'File',
  pathname: 'Tên file',
  storage: 'Nơi lưu',
  blur_data_url: 'Ảnh mờ khi đang tải',
  bytes: 'Dung lượng',
  width: 'Chiều rộng',
  height: 'Chiều cao',
};

/*
 * One file of the library (spec §7.2 /admin/media; R12: its EN alt text and
 * decorative flag are edited here, once for every use; other languages are
 * phase 8): where it is shown, delete (refused while it is shown anywhere,
 * AC3), and its History. A file in the trash keeps this page, its History
 * and "Khôi phục mục đã xóa" (R14); one the sweep purged is a 404.
 */
export default async function MediaFilePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePagePermission({ content: ['read'] });
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const pool = getPool();
  const [item, uses, history] = await Promise.all([getMedia(pool, id), mediaUsage(pool, id), listHistory(pool, 'media', id)]);
  if (!item) notFound();
  const name = item.pathname.split('/').pop() ?? item.pathname;
  const isPdf = item.contentType === 'application/pdf';

  return (
    <>
      <p className="a-crumbs">
        <Link href="/admin/media">← Thư viện</Link>
      </p>
      <h1>{name}</h1>
      {item.deletedAt ? (
        <p className="a-alert" role="status">
          File này đã bị xóa lúc {formatDateTimeVi(item.deletedAt)}. Sau 30 ngày trong thùng rác, file bị dọn hẳn và không khôi phục được nữa. Khôi
          phục từ Lịch sử bên dưới.
        </p>
      ) : null}
      <div className="a-media-detail">
        {isPdf ? (
          <a className="a-btn a-btn--ghost" href={item.url} target="_blank" rel="noreferrer">
            Mở PDF
          </a>
        ) : (
          <Thumb file={item} width={480} alt={item.alt} className="a-media-preview" />
        )}
        <dl className="a-facts">
          <dt>Loại</dt>
          <dd>{item.contentType}</dd>
          {item.width && item.height ? (
            <>
              <dt>Kích thước</dt>
              <dd>
                {item.width}×{item.height} px
              </dd>
            </>
          ) : null}
          <dt>Dung lượng</dt>
          <dd>{formatFileSize(item.bytes)}</dd>
          <dt>Nơi lưu</dt>
          <dd>{item.storage === 'blob' ? 'Vercel Blob' : 'Trong mã nguồn (/assets)'}</dd>
          <dt>Cập nhật</dt>
          <dd>{formatDateTimeVi(item.updatedAt)}</dd>
        </dl>
      </div>

      {!item.deletedAt && !isPdf ? (
        <MediaDetailsForm
          id={item.id}
          token={item.token}
          alt={item.alt}
          decorative={item.isDecorative}
          lastSaved={history[0] ? { by: history[0].actor, at: formatDateTimeVi(history[0].at) } : null}
        />
      ) : null}

      <section aria-labelledby="media-uses-title">
        <h2 id="media-uses-title">Đang được dùng ở</h2>
        {uses.length === 0 ? (
          <p className="a-muted">Chưa dùng ở đâu.</p>
        ) : (
          <ul className="a-list">
            {uses.map((u) => (
              <li key={`${u.href}|${u.label}`} className="a-list-item">
                <Link href={u.href}>{u.label}</Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {!item.deletedAt ? <DeleteMediaForm id={item.id} token={item.token} inUse={uses.length > 0} name={name} /> : null}

      <HistoryPanel headingId={`media-${id}-history`} entries={history} currentToken={item.token} recordId={id} labels={LABELS} restore={restoreMediaAction} />
    </>
  );
}
