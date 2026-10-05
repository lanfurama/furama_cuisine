import type { Metadata } from 'next';
import Link from 'next/link';
import { getPool } from '@/db/client';
import { auditActionLabel, auditEntityLabel } from '@/lib/admin/audit-labels';
import { formatDateTimeVi } from '@/lib/admin/format';
import { entityLabels, isAuditCursor, listAuditFeed } from '@/lib/server/audit-feed';
import { requirePagePermission } from '@/lib/server/dal/session';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Nhật ký' };

type Search = { truoc?: string | string[]; sau?: string | string[] };

export default async function AuditPage({ searchParams }: { searchParams: Promise<Search> }) {
  // Before any query: an Editor gets the 403 view and no rows.
  await requirePagePermission({ audit: ['read'] });
  const { truoc, sau } = await searchParams;
  const pool = getPool();
  // ?truoc=<cursor>: older than that row; ?sau=<cursor>: newer. Anything else (a phase-3 ?trang= link
  // included) reads as the newest page.
  const { rows, older, newer } = await listAuditFeed(pool, {
    before: isAuditCursor(truoc) ? truoc : null,
    after: isAuditCursor(sau) ? sau : null,
  });
  const labels = await entityLabels(pool, rows);

  return (
    <>
      <h1>Nhật ký</h1>
      <p className="a-lede">Ai đã làm gì, và lúc nào, kể cả thao tác trên đặt bàn. Mới nhất ở trên.</p>
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
            {rows.map((r) => {
              const ref = r.entity_id ? labels.get(`${r.entity_type}:${r.entity_id}`) : undefined;
              const entity = `${auditEntityLabel(r.entity_type)} · ${ref?.label ?? r.entity_id ?? '—'}`;
              return (
                <tr key={`${r.source}:${r.id}`}>
                  <td>{formatDateTimeVi(r.at)}</td>
                  <td>{r.actor_label ?? 'Hệ thống'}</td>
                  <td>{auditActionLabel(r.action)}</td>
                  <td>
                    {ref?.href ? <Link href={ref.href}>{entity}</Link> : entity}
                  </td>
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
              );
            })}
          </tbody>
        </table>
      )}
      {newer || older ? (
        <nav className="a-pager" aria-label="Phân trang">
          {newer ? <Link href={`/admin/audit?sau=${newer}`}>← Mới hơn</Link> : null}
          {newer ? <Link href="/admin/audit">Mới nhất</Link> : null}
          {older ? <Link href={`/admin/audit?truoc=${older}`}>Cũ hơn →</Link> : null}
        </nav>
      ) : null}
    </>
  );
}
