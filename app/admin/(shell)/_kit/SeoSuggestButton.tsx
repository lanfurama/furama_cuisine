'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { DEFAULT_LOCALE } from '@/lib/i18n/locales';
import { fillLikeTyping } from './AiTranslateButton';
import type { LocaleTab } from './TranslatableField';
import { useAiFeatures } from './useAiFeatures';

export type SeoTarget = { kind: 'home' } | { kind: 'restaurant'; id: string };

/*
 * "Gợi ý bằng AI" for SEO (spec §9.3, R9-22). The server reads the page and
 * answers a title (≤ 60) and a description (≤ 155); the button puts them in
 * its form's two boxes the way typing does (the SaveBar sees a change) and
 * saves nothing: staff read them and press Lưu. The boxes are found through
 * the button's own form (form.elements), never by a document query: <Activity>
 * keeps the page left behind in the document.
 *
 * `fields`: the boxes' names. With `locales` (a restaurant: one box per
 * language, `<name>.<code>`) the button has its own language choice, English
 * first, and says which tab it filled. Without them (the SEO strings screen)
 * the language is the form's own `locale` field.
 */
export function SeoSuggestButton({
  target,
  fields,
  locales,
  hint,
}: {
  target: SeoTarget;
  fields: { title: string; description: string };
  locales?: readonly LocaleTab[];
  hint: string;
}) {
  const ai = useAiFeatures();
  const uid = useId();
  const button = useRef<HTMLButtonElement>(null);
  const controller = useRef<AbortController | null>(null);
  const [code, setCode] = useState(locales?.[0]?.code ?? DEFAULT_LOCALE);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  /*
   * Leaving the page drops the request (the route forwards the abort to Vertex).
   * <Activity> keeps a page left behind and runs this cleanup without
   * unmounting it, so the cleanup also frees the button: coming back, it is
   * usable again, not "Đang gợi ý…" for ever.
   */
  useEffect(
    () => () => {
      controller.current?.abort();
      controller.current = null;
      setBusy(false);
    },
    [],
  );
  if (!ai.seo) return null;

  async function run() {
    const form = button.current?.form;
    // aria-disabled keeps the button focusable while it works: the guard is here.
    if (!form || controller.current) return;
    const locale = locales ? code : ((form.elements.namedItem('locale') as HTMLInputElement | null)?.value ?? DEFAULT_LOCALE);
    const suffix = locales ? `.${locale}` : '';
    const ctl = new AbortController();
    controller.current = ctl;
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch('/api/admin/ai/seo', {
        method: 'POST',
        signal: ctl.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ target, locale }),
      });
      const data = (await res.json().catch(() => null)) as { message?: string; title?: string; description?: string } | null;
      if (!res.ok || typeof data?.title !== 'string' || typeof data.description !== 'string') {
        setNotice({ text: data?.message ?? 'Không gợi ý được. Thử lại sau.', error: true });
        return;
      }
      const title = form.elements.namedItem(`${fields.title}${suffix}`);
      const description = form.elements.namedItem(`${fields.description}${suffix}`);
      if (!isBox(title) || !isBox(description)) {
        setNotice({ text: 'Không tìm thấy ô để điền.', error: true });
        return;
      }
      fillLikeTyping(title, data.title);
      fillLikeTyping(description, data.description);
      setNotice({ text: `${locales ? `Đã điền tab ${locale.toUpperCase()}` : 'Đã điền tiêu đề và mô tả'}. Xem lại rồi bấm Lưu.`, error: false });
    } catch {
      if (!ctl.signal.aborted) setNotice({ text: 'Không kết nối được. Thử lại sau.', error: true });
    } finally {
      // Only this request's own end frees the button (a cleanup may have freed it already, for a newer one).
      if (controller.current === ctl) {
        controller.current = null;
        setBusy(false);
      }
    }
  }

  // A polite live region, always mounted, as AiTranslateButton's: the form's save notice is its one role=status.
  return (
    <div className="a-field--wide a-ai-seo">
      {locales && locales.length > 1 ? (
        <span className="a-ai-seo-locale">
          <label htmlFor={`${uid}-locale`}>Ngôn ngữ gợi ý SEO</label>
          <select id={`${uid}-locale`} value={code} onChange={(e) => setCode(e.currentTarget.value)} disabled={busy}>
            {locales.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </span>
      ) : null}
      <button ref={button} type="button" className="a-btn a-btn--ghost a-btn--small" onClick={run} aria-disabled={busy || undefined} aria-describedby={`${uid}-hint`}>
        {busy ? 'Đang gợi ý…' : 'Gợi ý bằng AI'}
      </button>
      <p className="a-muted" id={`${uid}-hint`}>
        {hint}
      </p>
      <p aria-live="polite" className={notice?.error ? 'a-field-error' : 'a-muted'}>
        {notice?.text}
      </p>
    </div>
  );
}

const isBox = (el: unknown): el is HTMLInputElement | HTMLTextAreaElement => el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
