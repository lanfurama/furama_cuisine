'use client';

import { useEffect, useId, useRef, useState } from 'react';

/*
 * "Dịch từ EN" (R9-8): sends the English text the form shows now (saved or not)
 * and hands the translation to onResult, which fills the box. Nothing is saved
 * here. A refusal shows the server's Vietnamese message under the button.
 */
/** Put a value in an uncontrolled box the way typing does: React's onChange and the form's onInput (the SaveBar's unsaved flag) both fire. */
export function fillLikeTyping(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

export function AiTranslateButton({ english, locale, itemKey, onResult }: { english: string; locale: string; itemKey?: string; onResult: (text: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const statusId = useId();
  const inFlight = useRef(false);
  const controller = useRef<AbortController | null>(null);
  // Leaving the form drops the request (the route forwards the abort to Vertex).
  useEffect(() => () => controller.current?.abort(), []);

  async function run() {
    if (inFlight.current) return;
    inFlight.current = true;
    const ctl = new AbortController();
    controller.current = ctl;
    setBusy(true);
    setMessage('');
    try {
      const res = await fetch('/api/admin/ai/translate', {
        method: 'POST',
        signal: ctl.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ locale, items: [{ id: 'x', text: english, ...(itemKey ? { key: itemKey } : {}) }] }),
      });
      const data = (await res.json().catch(() => null)) as { message?: string; results?: { ok: boolean; text?: string; code?: string }[] } | null;
      if (!res.ok) {
        setMessage(data?.message ?? 'Không dịch được. Thử lại sau.');
      } else {
        const r = data?.results?.[0];
        if (r?.ok && typeof r.text === 'string') onResult(r.text);
        else if (r?.code === 'too_long') setMessage('Bản dịch dài quá giới hạn của ô này; không điền.');
        else setMessage('AI làm mất tên riêng hoặc biến; không dùng được bản dịch này.');
      }
    } catch {
      if (!ctl.signal.aborted) setMessage('Không kết nối được. Thử lại sau.');
    } finally {
      inFlight.current = false;
      if (!ctl.signal.aborted) setBusy(false);
    }
  }

  // A polite live region, always mounted so a screen reader announces what lands in it. Not role=status: a form's save notice is the one role=status (specs find it by that).
  return (
    <span className="a-ai-translate">
      <button type="button" className="a-btn a-btn--ghost a-btn--small" onClick={run} disabled={busy} aria-describedby={message ? statusId : undefined}>
        {busy ? 'Đang dịch…' : 'Dịch từ EN'}
      </button>
      <span aria-live="polite" id={statusId} className="a-field-error">
        {message}
      </span>
    </span>
  );
}
