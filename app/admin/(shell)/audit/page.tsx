import type { Metadata } from 'next';
import Link from 'next/link';
import { getPool } from '@/db/client';
import { auditActionLabel, auditEntityLabel } from '@/lib/admin/audit-labels';
import { formatDateTimeVi } from '@/lib/admin/format';
import { listAuditFeed, staffEmails } from '@/lib/server/audit-feed';
import { requirePagePermission } from '@/lib/server/dal/session';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Nhật ký' };

/** ?trang=2 → 2; anything else → 1. */
function pageNumber(value: string | string[] | undefined): number {
  const n = typeof value === 'string' && /^\d{1,4}$/.test(value) ? Number(value) : 1;
  return n >= 1 ? n : 1;
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ trang?: string | string[] }> }) {
  // Before any query: an Editor gets the 403 view and no rows.
  await requirePagePermission({ audit: ['read'] });
  const page = pageNumber((await searchParams).trang);
  const pool = getPool();
  const { rows, hasNext } = await listAuditFeed(pool, page);
  const emails = await staffEmails(
    pool,
    rows.filter((r) => r.entity_type === 'staff_user' && r.entity_id).map((r) => r.entity_id as string),
  );

  return (
    <>
      <h1>Nhật ký</h1>
      <p className="a-lede">Ai đã làm gì, và lúc nào. Mới nhất ở trên.</p>
      {rows.length === 0 ? (
        <p className="a-lede">Chưa có mục nào.</p>
      ) : (
        <table className="a-table">
          <thead>
            <tr>
              <th scope="col">Thời gian</th>
              <th scope="col">Người thực hiện</th>
              <th scope="col">Thao tác</th>
              <th scope="col">Đối tượng</th>
              <th scope="col">Chi tiết</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.source}:${r.id}`}>
                <td>{formatDateTimeVi(r.at)}</td>
                <td>{r.actor_label ?? 'Hệ thống'}</td>
                <td>{auditActionLabel(r.action)}</td>
                <td>{`${auditEntityLabel(r.entity_type)} · ${(r.entity_id && emails.get(r.entity_id)) ?? r.entity_id ?? '—'}`}</td>
                <td>
                  {r.before === null && r.after === null ? (
                    '—'
                  ) : (
                    <details>
                      <summary>Xem</summary>
                      <pre className="a-pre">{JSON.stringify({ trước: r.before, sau: r.after }, null, 2)}</pre>
                    </details>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <nav className="a-pager" aria-label="Phân trang">
        {page > 1 ? <Link href={page === 2 ? '/admin/audit' : `/admin/audit?trang=${page - 1}`}>← Mới hơn</Link> : null}
        {hasNext ? <Link href={`/admin/audit?trang=${page + 1}`}>Cũ hơn →</Link> : null}
      </nav>
    </>
  );
}
