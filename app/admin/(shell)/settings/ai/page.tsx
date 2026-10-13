import type { Metadata } from 'next';
import { getPool } from '@/db/client';
import { formatDateTimeVi } from '@/lib/admin/format';
import { actionErrorMessage } from '@/lib/admin/auth-errors';
import { envStatus, resolveAiMode, type AiMode } from '@/lib/server/ai/mode';
import { monthSpendUsd } from '@/lib/server/ai/guard';
import { listGlossary } from '@/lib/server/ai/glossary';
import { loadAiSettings } from '@/lib/server/ai/settings';
import { listLocales } from '@/lib/server/booking/queries';
import { requirePagePermission } from '@/lib/server/dal/session';
import { AiSettingsForm } from './AiSettingsForm';
import { ConnectionCheck } from './ConnectionCheck';
import { GlossaryTable } from './GlossaryTable';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Cấu hình AI' };

const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;

function modeLabel(mode: AiMode | { mode: 'error' }): string {
  if (mode.mode === 'vertex') return 'Vertex';
  if (mode.mode === 'fake') return 'Giả (dev)';
  return 'Chưa cấu hình';
}

/*
 * Spec §9.2 /admin/settings/ai (Admin only, §7.1): how the AI is reached
 * (names and present/missing only, never a value; GCP_PROJECT_ID is an id, not
 * a secret, so it is shown), this month's spend, the four features, the
 * limits and budget, and the glossary.
 */
export default async function AiSettingsPage() {
  // Before any query: an Editor gets the 403 view.
  await requirePagePermission({ settings: ['read'] });
  const pool = getPool();
  const [{ settings, token }, spend, recent, glossary, locales] = await Promise.all([
    loadAiSettings(pool),
    monthSpendUsd(pool),
    pool.query<{ at: Date; name: string | null; feature: string; model: string; input_tokens: number; output_tokens: number; cost: string; status: string; error_code: string | null }>(
      `SELECT u.at, s.name, u.feature, u.model, u.input_tokens, u.output_tokens, u.cost_usd::text AS cost, u.status, u.error_code
         FROM ai_usage u LEFT JOIN staff_user s ON s.id = u.actor_id ORDER BY u.at DESC, u.id DESC LIMIT 20`,
    ),
    listGlossary(pool),
    listLocales(pool),
  ]);
  let mode: AiMode | { mode: 'error' };
  try {
    mode = resolveAiMode();
  } catch {
    // A refused configuration (the express-mode key, fake on Production): shown as not configured, with the reason in the logs of the check.
    mode = { mode: 'error' };
  }
  const percent = settings.budgetUsd > 0 ? Math.min(100, Math.round((spend.spent / settings.budgetUsd) * 100)) : 100;
  const projectId = process.env.GCP_PROJECT_ID?.trim();

  return (
    <>
      <h1>Cấu hình AI</h1>
      <p className="a-lede">Kết nối Vertex AI, chi phí, tính năng và thuật ngữ. Chỉ Admin sửa được.</p>

      <section aria-labelledby="ai-connect-title">
        <h2 id="ai-connect-title">Kết nối</h2>
        <p data-testid="ai-mode">
          Chế độ: <strong>{modeLabel(mode)}</strong>
        </p>
        {mode.mode === 'error' ? <p className="a-warn">Cấu hình môi trường không hợp lệ (khóa express-mode, hoặc chế độ giả trên Production). Xem nhật ký triển khai.</p> : null}
        <div className="a-table-scroll">
          <table className="a-table" aria-label="Biến môi trường">
            <thead>
              <tr>
                <th scope="col">Biến</th>
                <th scope="col">Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {envStatus().map((e) => (
                <tr key={e.name}>
                  <th scope="row">{e.name}</th>
                  <td>{e.name === 'GCP_PROJECT_ID' && e.present ? projectId : e.present ? 'Có' : 'Không'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ConnectionCheck />
      </section>

      <section aria-labelledby="ai-spend-title">
        <h2 id="ai-spend-title">Chi phí tháng này</h2>
        <p data-testid="ai-spend">{`Đã dùng ${usd(spend.spent)} / ${usd(settings.budgetUsd)} (${percent}%)`}</p>
        <progress value={percent} max={100} aria-label="Ngân sách AI đã dùng" />
        <div className="a-table-scroll">
          <table className="a-table" aria-label="Chi phí theo tính năng">
            <thead>
              <tr>
                <th scope="col">Tính năng</th>
                <th scope="col">Chi phí</th>
              </tr>
            </thead>
            <tbody>
              {Object.keys(spend.byFeature).length === 0 ? (
                <tr>
                  <td colSpan={2}>Chưa có lời gọi nào trong tháng này.</td>
                </tr>
              ) : (
                Object.entries(spend.byFeature).map(([feature, cost]) => (
                  <tr key={feature}>
                    <th scope="row">{feature}</th>
                    <td>{usd(cost)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <h3>20 lời gọi gần nhất</h3>
        <div className="a-table-scroll">
          <table className="a-table" aria-label="Lời gọi AI gần nhất">
            <thead>
              <tr>
                <th scope="col">Lúc</th>
                <th scope="col">Người</th>
                <th scope="col">Tính năng</th>
                <th scope="col">Model</th>
                <th scope="col">Token</th>
                <th scope="col">USD</th>
                <th scope="col">Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {recent.rows.length === 0 ? (
                <tr>
                  <td colSpan={7}>Chưa có lời gọi nào.</td>
                </tr>
              ) : null}
              {recent.rows.map((r, i) => (
                <tr key={i}>
                  <td>{formatDateTimeVi(r.at)}</td>
                  <td>{r.name ?? 'Tự động'}</td>
                  <td>{r.feature}</td>
                  <td>{r.model}</td>
                  <td>{`${r.input_tokens} / ${r.output_tokens}`}</td>
                  <td>{usd(Number(r.cost))}</td>
                  <td>{r.status === 'error' ? (r.error_code ? actionErrorMessage(r.error_code as never) : 'Lỗi') : r.status === 'pending' ? 'Đang chạy' : 'Xong'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-label="Tính năng và giới hạn">
        <AiSettingsForm token={token} settings={settings} />
      </section>

      <section aria-labelledby="ai-glossary-title">
        <h2 id="ai-glossary-title">Thuật ngữ</h2>
        <p className="a-muted">Tên riêng và cụm từ AI phải giữ nguyên hoặc dịch theo cách riêng. Tên nhà hàng được thêm tự động.</p>
        <GlossaryTable entries={glossary} locales={locales.map((l) => ({ code: l.code, name: l.name }))} />
      </section>
    </>
  );
}
