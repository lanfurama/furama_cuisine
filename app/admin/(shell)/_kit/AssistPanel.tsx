'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { checkLength } from '@/lib/admin/content-rules';
import { readTextStream } from '@/lib/admin/text-stream';
import { toBcp47 } from '@/lib/i18n/locales';

/*
 * "Trợ lý viết" (spec §9.3, R9-10, R9-23): under a multi-line field, a button
 * opens a panel with three actions on the text the box shows now (saved or
 * not), in the language of its tab. The answer streams into the panel with
 * fetch and a reader (no AI package in the browser); "Dùng bản này" hands it
 * to onUse, which fills the box like typing. Nothing is saved here: staff
 * press Lưu as always. Closing the panel (Đóng, Esc), "Dừng", another action
 * or leaving the page aborts the request, and the route stops the model call.
 * A refusal or a cut stream says so in Vietnamese and leaves the box as it was.
 */
type Action = 'rewrite' | 'shorten' | 'brand';
const ACTIONS: readonly { action: Action; label: string }[] = [
  { action: 'rewrite', label: 'Viết lại' },
  { action: 'shorten', label: 'Rút gọn' },
  { action: 'brand', label: 'Theo giọng thương hiệu' },
];

type Phase = 'idle' | 'streaming' | 'done' | 'stopped' | 'failed';

export function AssistPanel({ text, locale, label, max, onUse }: { text: string; locale: string; label: string; max: number; onUse: (text: string) => void }) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState('');
  const [message, setMessage] = useState('');
  const controller = useRef<AbortController | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const firstAction = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);

  const stop = () => {
    controller.current?.abort();
    controller.current = null;
  };

  const close = useCallback((focusTrigger = true) => {
    controller.current?.abort();
    controller.current = null;
    setOpen(false);
    setPhase('idle');
    setResult('');
    setMessage('');
    if (focusTrigger) trigger.current?.focus();
  }, []);

  // Leaving the form drops the request (the route forwards the abort to Vertex).
  useEffect(() => () => controller.current?.abort(), []);
  // Opened: focus the first action; Esc inside the panel closes it and gives focus back to the button.
  useEffect(() => {
    const el = panel.current;
    if (!open || !el) return;
    firstAction.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, [open, close]);

  async function run(action: Action) {
    stop();
    const ctl = new AbortController();
    controller.current = ctl;
    setPhase('streaming');
    setResult('');
    setMessage('Đang viết…');
    try {
      const res = await fetch('/api/admin/ai/assist', {
        method: 'POST',
        signal: ctl.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, text, locale, maxLength: max }),
      });
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => null)) as { message?: string } | null;
        if (ctl.signal.aborted) return;
        setPhase('failed');
        setMessage(data?.message ?? 'Trợ lý không trả lời được. Thử lại sau.');
        return;
      }
      const all = await readTextStream(res.body, (t) => {
        if (!ctl.signal.aborted) setResult(t);
      });
      if (ctl.signal.aborted) return;
      const answer = all.trim();
      setResult(answer);
      setPhase('done');
      setMessage(`Xong: ${[...answer].length}/${max} ký tự. “Dùng bản này” điền vào ô; bấm Lưu để lưu.`);
    } catch {
      if (ctl.signal.aborted) return;
      setPhase('failed');
      setMessage('Bị gián đoạn: ô vẫn giữ chữ cũ. Thử lại sau.');
    } finally {
      if (controller.current === ctl) controller.current = null;
    }
  }

  const streaming = phase === 'streaming';
  const length = checkLength(result, max);
  const panelId = `${uid}-assist`;

  return (
    <div className="a-assist">
      <button
        ref={trigger}
        type="button"
        className="a-btn a-btn--ghost a-btn--small"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => (open ? close() : setOpen(true))}
      >
        Trợ lý viết
      </button>
      {open ? (
        <section ref={panel} id={panelId} className="a-assist-panel" aria-label={`Trợ lý viết: ${label}`}>
          <div className="a-assist-actions" role="group" aria-label="Thao tác">
            {ACTIONS.map((a, i) => (
              // Never disabled (focus would drop to the page): another action replaces the one streaming.
              <button key={a.action} ref={i === 0 ? firstAction : undefined} type="button" className="a-btn a-btn--ghost a-btn--small" onClick={() => run(a.action)}>
                {a.label}
              </button>
            ))}
          </div>
          <p className="a-assist-result" lang={toBcp47(locale)} aria-busy={streaming}>
            {result || <span className="a-sub">Chọn một thao tác; gợi ý hiện ở đây.</span>}
          </p>
          {result ? (
            <p className={`a-counter a-counter--${length.level}`}>
              {length.count}/{max} ký tự{length.level === 'error' ? ` · Vượt quá ${max} ký tự: sửa bớt trước khi lưu.` : ''}
            </p>
          ) : null}
          {/* A polite live region, always mounted while the panel is open. Not role=status: a form's save notice is the one role=status. */}
          <p aria-live="polite" className={phase === 'failed' ? 'a-field-error' : 'a-sub'}>
            {message}
          </p>
          <div className="a-assist-actions">
            {/* aria-disabled, not disabled: the button keeps focus when the stream ends under it. */}
            <button
              type="button"
              className="a-btn a-btn--ghost a-btn--small"
              aria-disabled={!streaming}
              onClick={() => {
                if (!streaming) return;
                stop();
                setPhase('stopped');
                setMessage('Đã dừng. Ô vẫn giữ chữ cũ.');
              }}
            >
              Dừng
            </button>
            <button
              type="button"
              className="a-btn a-btn--small"
              disabled={phase !== 'done' || !result}
              onClick={() => {
                onUse(result);
                close(false);
              }}
            >
              Dùng bản này
            </button>
            <button type="button" className="a-btn a-btn--ghost a-btn--small" onClick={() => close()}>
              Đóng
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
