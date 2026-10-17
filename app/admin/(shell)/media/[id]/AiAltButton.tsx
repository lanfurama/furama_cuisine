'use client';

import { useEffect, useId, useRef, useState } from 'react';

/*
 * "Viết alt bằng AI" (spec §9.3, R9-12, R9-21): asks /api/admin/ai/alt to
 * describe this picture and hands the sentence to onResult, which fills the
 * EN alt box like typing. Nothing is saved here: the form's Lưu writes it
 * as reviewed. Same shape as "Dịch từ EN" (_kit/AiTranslateButton.tsx): one
 * request at a time, dropped when the page goes, a refusal read out in an
 * always-mounted polite live region.
 */
export function AiAltButton({ mediaId, onResult }: { mediaId: string; onResult: (text: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const statusId = useId();
  const inFlight = useRef(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  async function run() {
    if (inFlight.current) return;
    inFlight.current = true;
    const ctl = new AbortController();
    controller.current = ctl;
    setBusy(true);
    setMessage('');
    try {
      const res = await fetch('/api/admin/ai/alt', {
        method: 'POST',
        signal: ctl.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mediaId }),
      });
      const data = (await res.json().catch(() => null)) as { message?: string; alt?: string } | null;
      if (res.ok && typeof data?.alt === 'string') onResult(data.alt);
      else setMessage(data?.message ?? 'Không viết được mô tả. Thử lại sau.');
    } catch {
      if (!ctl.signal.aborted) setMessage('Không kết nối được. Thử lại sau.');
    } finally {
      inFlight.current = false;
      if (!ctl.signal.aborted) setBusy(false);
    }
  }

  return (
    <span className="a-ai-translate">
      <button type="button" className="a-btn a-btn--ghost a-btn--small" onClick={run} disabled={busy} aria-describedby={message ? statusId : undefined}>
        {busy ? 'Đang viết…' : 'Viết alt bằng AI'}
      </button>
      <span aria-live="polite" id={statusId} className="a-field-error">
        {message}
      </span>
    </span>
  );
}
