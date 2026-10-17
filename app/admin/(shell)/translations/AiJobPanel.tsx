'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useState } from 'react';
import { actionErrorMessage } from '@/lib/admin/auth-errors';
import type { ActionCode } from '@/lib/server/action-result';
import type { JobStatus, JobView } from '@/lib/server/ai/jobs';
import { useAiFeatures } from '../_kit/useAiFeatures';
import { Icon } from '../_ui/Icon';

/*
 * Bulk translation on /admin/translations (spec §9.3, R9-16, R9-18, R9-24):
 * each language's newest job with its progress and buttons, and, for an
 * Admin with AI on, "Dịch tất cả phần còn thiếu bằng AI" for one language
 * (a language that is off can be translated before it is turned on).
 * While a job is queued or running the panel asks GET /api/admin/ai/jobs
 * every 5 seconds and redraws its rows; only when a job's status changes does
 * it refresh the page, whose coverage and queue are heavy to read. The
 * machine translations land in the review queue below; guests see none of
 * them until a person presses "Duyệt".
 */

export type JobLocale = { code: string; name: string; enabled: boolean; missing: number | null };

const POLL_MS = 5_000;

const STATUS: Record<JobStatus, string> = {
  queued: 'Đang chờ',
  running: 'Đang chạy',
  paused: 'Tạm dừng',
  done: 'Xong',
  cancelled: 'Đã hủy',
};

function statusLabel(job: JobView): string {
  // A run whose time ran out (R9-16): the next cron goes on, or "Chạy tiếp ngay".
  return job.status === 'queued' && job.progress.done > 0 ? 'Đang chờ lượt sau' : STATUS[job.status];
}

function errorText(code: string): string {
  if (code === 'locale_unlisted') return 'Ngôn ngữ này không còn trên web.';
  return actionErrorMessage(code as ActionCode);
}

const live = (jobs: readonly JobView[]) => jobs.some((j) => j.status === 'queued' || j.status === 'running');
const statuses = (jobs: readonly JobView[]) => jobs.map((j) => `${j.id}:${j.status}`).join(',');

export function AiJobPanel({
  jobs: initial,
  locales,
  canRun,
  kindLabels,
}: {
  jobs: JobView[];
  locales: JobLocale[];
  /** Admin only (owner's default): create, resume and cancel. */
  canRun: boolean;
  kindLabels: Record<string, string>;
}) {
  const router = useRouter();
  const { translate } = useAiFeatures();
  const titleId = useId();
  const messageId = useId();
  const [locale, setLocale] = useState(locales[0]?.code ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  // The poll's answer, kept only while the page's own list is the one it was asked for.
  const [polled, setPolled] = useState<{ from: JobView[]; jobs: JobView[] } | null>(null);
  const jobs = polled && polled.from === initial ? polled.jobs : initial;
  const anyLive = live(jobs);

  useEffect(() => {
    if (!anyLive) return;
    let stopped = false;
    const timer = setInterval(async () => {
      try {
        const res = await fetch('/api/admin/ai/jobs', { cache: 'no-store' });
        if (!res.ok || stopped) return;
        const next = ((await res.json()) as { jobs: JobView[] }).jobs;
        setPolled({ from: initial, jobs: next });
        if (statuses(next) !== statuses(initial)) router.refresh();
      } catch {
        // A lost poll is retried at the next tick.
      }
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [anyLive, initial, router]);

  async function send(url: string, body: object, done: string) {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const data = (await res.json().catch(() => null)) as { message?: string } | null;
      setMessage(res.ok ? done : (data?.message ?? 'Không thực hiện được. Thử lại sau.'));
      router.refresh();
    } catch {
      setMessage('Không kết nối được. Thử lại sau.');
    } finally {
      setBusy(false);
    }
  }

  const name = (code: string) => {
    const l = locales.find((x) => x.code === code);
    return l ? `${l.name} (${code.toUpperCase()})` : code.toUpperCase();
  };
  const chosen = locales.find((l) => l.code === locale);
  const unit = (u: string) => {
    const [kind, id] = u.split('#');
    return `${kindLabels[kind] ?? kind} · ${id}`;
  };

  return (
    <section aria-labelledby={titleId} className="a-card-row">
      <h2 id={titleId}>Dịch hàng loạt bằng AI</h2>
      <p className="a-muted">
        Máy dịch mọi chỗ còn trống của một ngôn ngữ (trừ chính sách bảo mật và câu đồng ý). Bản máy dịch vào hàng chờ duyệt bên dưới; khách chỉ thấy sau khi
        có người bấm Duyệt.
      </p>
      {!translate ? (
        <p className="a-muted">AI đang tắt.</p>
      ) : !canRun ? (
        <p className="a-muted">Chỉ Admin chạy được dịch hàng loạt.</p>
      ) : locales.length === 0 ? (
        <p className="a-muted">Web chỉ có ngôn ngữ mặc định.</p>
      ) : (
        <form
          method="post"
          className="a-filters"
          onSubmit={(e) => {
            e.preventDefault();
            void send('/api/admin/ai/jobs', { locale }, `Đã bắt đầu dịch ${name(locale)}.`);
          }}
        >
          <label>
            Ngôn ngữ
            <select name="locale" value={locale} onChange={(e) => setLocale(e.target.value)}>
              {locales.map((l) => (
                <option key={l.code} value={l.code}>
                  {`${l.name} (${l.code.toUpperCase()})${l.enabled ? '' : ' (đang tắt)'}`}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="a-btn" disabled={busy} aria-describedby={message ? messageId : undefined}>
            <Icon name="sparkles" size={16} />
            Dịch tất cả phần còn thiếu bằng AI
          </button>
          {chosen?.missing !== null && chosen?.missing !== undefined ? <span className="a-muted">Còn thiếu {chosen.missing} mục.</span> : null}
        </form>
      )}
      <p aria-live="polite" id={messageId} className="a-field-error">
        {message}
      </p>

      {jobs.length === 0 ? (
        <p className="a-muted">Chưa có lần dịch hàng loạt nào.</p>
      ) : (
        <ul className="a-progress-list" aria-label="Các lần dịch hàng loạt">
          {jobs.map((job) => {
            const { done, failed, remaining, skipped } = job.progress;
            const total = done + (remaining ?? 0);
            return (
              <li key={job.id} className="a-progress-row" data-testid="ai-job">
                <div>
                  <strong>{name(job.locale)}</strong>
                  <span className={job.status === 'paused' || job.error ? 'a-tag a-tag--warn' : 'a-tag'}>{statusLabel(job)}</span>
                </div>
                {total > 0 ? <progress value={done} max={total} aria-label={`Tiến độ dịch ${name(job.locale)}`} /> : null}
                <div>
                  <span>{`Đã dịch ${done}, còn ${remaining ?? '…'}, lỗi ${failed}`}</span>
                  {job.createdBy ? <span className="a-muted">Tạo bởi {job.createdBy}</span> : null}
                </div>
                {job.error ? <p className="a-warn">{errorText(job.error)}</p> : null}
                {skipped.length ? (
                  <details>
                    <summary>{`Bỏ qua ${skipped.length} mục máy dịch sai 3 lần: hãy dịch tay`}</summary>
                    <ul>
                      {skipped.map((u) => (
                        <li key={u}>{unit(u)}</li>
                      ))}
                    </ul>
                  </details>
                ) : null}
                {canRun && (job.status === 'queued' || job.status === 'running' || job.status === 'paused') ? (
                  <div className="a-actions">
                    {translate && job.status === 'paused' ? (
                      <button type="button" className="a-btn a-btn--small" disabled={busy} onClick={() => void send(`/api/admin/ai/jobs/${job.id}`, { action: 'resume' }, 'Đã tiếp tục.')}>
                        Tiếp tục
                      </button>
                    ) : null}
                    {translate && job.status === 'queued' ? (
                      <button type="button" className="a-btn a-btn--small" disabled={busy} onClick={() => void send(`/api/admin/ai/jobs/${job.id}`, { action: 'resume' }, 'Đã chạy tiếp.')}>
                        Chạy tiếp ngay
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="a-btn a-btn--ghost a-btn--small"
                      disabled={busy}
                      aria-label={`Hủy dịch ${name(job.locale)}`}
                      onClick={() => void send(`/api/admin/ai/jobs/${job.id}`, { action: 'cancel' }, 'Đã hủy.')}
                    >
                      Hủy
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
