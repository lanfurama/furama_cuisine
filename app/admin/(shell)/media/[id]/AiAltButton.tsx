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
  // One live region for both outcomes: a refusal (error style) or the fill (muted), read out either way.
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
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
    setMessage(null);
    try {
      const res = await fetch('/api/admin/ai/alt', {
        method: 'POST',
        signal: ctl.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mediaId }),
      });
      const data = (await res.json().catch(() => null)) as { message?: string; alt?: string } | null;
      if (res.ok && typeof data?.alt === 'string') {
        onResult(data.alt);
        setMessage({ text: 'Đã điền mô tả. Kiểm tra rồi bấm Lưu mô tả.', ok: true });
      } else setMessage({ text: data?.message ?? 'Không viết được mô tả. Thử lại sau.', ok: false });
    } catch {
      if (!ctl.signal.aborted) setMessage({ text: 'Không kết nối được. Thử lại sau.', ok: false });
    } finally {
      inFlight.current = false;
      // Still this call's controller, aborted or not: navigating away hides the page in <Activity> (its effect
      // cleanup aborts the request) and keeps its state, so busy must end here or the button stays stuck on return
      // (node_modules/next/dist/docs/01-app/02-guides/migrating-to-cache-components.md, "UI state preservation").
      if (controller.current === ctl) {
        controller.current = null;
        setBusy(false);
      }
    }
  }

  return (
    <span className="a-ai-translate">
      <button type="button" className="a-btn a-btn--ghost a-btn--small" onClick={run} aria-disabled={busy || undefined} aria-describedby={message ? statusId : undefined}>
        {busy ? 'Đang viết…' : 'Viết alt bằng AI'}
      </button>
      <span aria-live="polite" id={statusId} className={message?.ok ? 'a-muted' : 'a-field-error'}>
        {message?.text}
      </span>
    </span>
  );
}
