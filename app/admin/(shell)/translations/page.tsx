import type { Metadata } from 'next';
import { getPool } from '@/db/client';
import { roleCan } from '@/lib/server/auth/permissions';
import { CONTENT_KINDS, QUEUE_PAGE, coverage, reviewQueue } from '@/lib/server/content-admin/translations';
import { requirePagePermission } from '@/lib/server/dal/session';
import { ReviewQueue } from './ReviewQueue';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Bản dịch' };

type Params = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

/*
 * Spec §7 /admin/translations and §8 step 2: per kind of content and per
 * language, how many translations are reviewed, machine-made, out of date
 * ("EN đã đổi") or missing; and the queue of those that need a person,
 * filtered by language and kind (each cell links to its slice), 50 a page.
 * Machine translation of what is missing comes with phase 9 (R8-13).
 */
export default async function TranslationsPage({ searchParams }: { searchParams: Params }) {
  const staff = await requirePagePermission({ content: ['read'] });
  const pool = getPool();
  const params = await searchParams;
  const locale = one(params.locale);
  const kind = CONTENT_KINDS.find((k) => k.key === one(params.kind))?.key;
  const page = Math.max(1, Number(one(params.page)) || 1);
  const [cover, queue] = await Promise.all([coverage(pool), reviewQueue(pool, { locale, kind, page })]);
  const filtered = (l: string | undefined, k: string | undefined, p = 1) => {
    const q = new URLSearchParams();
    if (l) q.set('locale', l);
    if (k) q.set('kind', k);
    if (p > 1) q.set('page', String(p));
    return `/admin/translations${q.size ? `?${q}` : ''}#queue`;
  };
  const pages = Math.max(1, Math.ceil(queue.total / QUEUE_PAGE));

  return (
    <>
      <h1>Bản dịch</h1>
      <p className="a-lede">
        Mỗi ngôn ngữ đã dịch được bao nhiêu, và các bản dịch cần người xem lại: bản máy dịch, và bản mà chữ tiếng Anh đã đổi sau khi dịch (EN đã
        đổi). Dịch và sửa ở tab ngôn ngữ của từng màn.
      </p>
      <p>
        <button type="button" className="a-btn" disabled aria-describedby="ai-later">
          Dịch tất cả phần còn thiếu bằng AI
        </button>{' '}
        <span className="a-muted" id="ai-later">
          Có từ đợt 9 (AI).
        </span>
      </p>

      <section aria-labelledby="coverage-title">
        <h2 id="coverage-title">Độ phủ</h2>
        {cover.locales.length === 0 ? (
          <p className="a-muted">Chỉ có ngôn ngữ mặc định. Thêm ngôn ngữ ở màn Ngôn ngữ.</p>
        ) : (
          <table className="a-table">
            <thead>
              <tr>
                <th scope="col">Nội dung</th>
                {cover.locales.map((l) => (
                  <th key={l.code} scope="col">
                    {l.name} ({l.code})
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cover.kinds.map((k) => (
                <tr key={k.key}>
                  <th scope="row">{k.label}</th>
                  {cover.locales.map((l) => {
                    const c = k.cells[l.code];
                    return (
                      <td key={l.code}>
                        {c.total === 0 ? (
                          <span className="a-muted">—</span>
                        ) : (
                          <a href={filtered(l.code, k.key)}>
                            {c.reviewed}/{c.total}
                            {c.machine ? ` · ${c.machine} máy dịch` : ''}
                            {c.stale ? ` · ${c.stale} EN đã đổi` : ''}
                          </a>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section aria-labelledby="queue-title" id="queue">
        <h2 id="queue-title">Hàng chờ duyệt ({queue.total})</h2>
        <form method="get" action="/admin/translations#queue" className="a-filters">
          <label>
            Ngôn ngữ{' '}
            <select name="locale" defaultValue={locale ?? ''}>
              <option value="">Tất cả</option>
              {[{ code: 'en', name: 'English' }, ...cover.locales].map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>{' '}
          <label>
            Loại{' '}
            <select name="kind" defaultValue={kind ?? ''}>
              <option value="">Tất cả</option>
              {CONTENT_KINDS.map((k) => (
                <option key={k.key} value={k.key}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>{' '}
          <button type="submit" className="a-btn a-btn--ghost">
            Lọc
          </button>
        </form>
        <ReviewQueue items={queue.items} canReview={roleCan(staff.role, { content: ['update'] })} />
        {pages > 1 ? (
          <nav aria-label="Trang của hàng chờ" className="a-actions">
            {page > 1 ? <a href={filtered(locale, kind, page - 1)}>← Trang trước</a> : null}
            <span>
              Trang {page}/{pages}
            </span>
            {page < pages ? <a href={filtered(locale, kind, page + 1)}>Trang sau →</a> : null}
          </nav>
        ) : null}
      </section>
    </>
  );
}
