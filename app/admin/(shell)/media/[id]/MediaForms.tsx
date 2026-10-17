'use client';

import Link from 'next/link';
import { useActionState, useId, useRef, useState } from 'react';
import { submitKeepingValues } from '@/lib/admin/form';
import type { Saved } from '@/lib/admin/save-state';
import type { TranslationState } from '@/lib/i18n/source-hash';
import type { ActionResult } from '@/lib/server/action-result';
import { AiTranslateButton, fillLikeTyping } from '../../_kit/AiTranslateButton';
import { SaveBar } from '../../_kit/SaveBar';
import { useAiFeatures } from '../../_kit/useAiFeatures';
import { useSaveState } from '../../_kit/useSaveState';
import { FieldError, FormMessage, invalidField } from '../../_ui/FormMessage';
import { deleteMediaAction, saveMediaDetailsAction } from '../actions';
import { AiAltButton } from './AiAltButton';

/** Another language's alt field: its code, its tab label, and the state of its translation. */
export type AltLanguage = { code: string; label: string; state: TranslationState };

const STATE_LABELS: Record<TranslationState, string> = { missing: 'Chưa dịch', machine: 'Máy dịch', reviewed: 'Đã duyệt', stale: 'EN đã đổi' };

/*
 * EN alt text (≤ 250, spec §5.2 media_i18n), each other language's (phase 8,
 * `altIn.<code>`: empty is "use English") and the decorative flag (alt="""
 * wherever the file is shown), on the editors' save state and SaveBar (7A
 * review UX-10): the fields remount on the token useSaveState accepted, a
 * newer version while typing is a "Tải lại" notice, unsaved edits guard the
 * page, and the bar says who saved last.
 *
 * Phase 9 D11 (R9-21): the EN alt's own state ("Máy dịch" while an AI's alt
 * waits for a person; saving the form reviews it), "Viết alt bằng AI" for a
 * picture in Blob that is not decorative (a static file says to move it
 * first), and "Dịch từ EN" in each other language (R9-8, from the English
 * the form shows now). The AI buttons only fill boxes; Lưu saves.
 */
export function MediaDetailsForm({
  id,
  token,
  alt,
  decorative,
  translations = {},
  languages = [],
  altState = null,
  inBlob = false,
  lastSaved,
}: {
  id: string;
  token: string;
  alt: string;
  decorative: boolean;
  translations?: Record<string, string>;
  languages?: readonly AltLanguage[];
  /** The EN alt row's state: machine (an AI wrote it) or reviewed; null without alt. */
  altState?: 'machine' | 'reviewed' | null;
  /** The file is in Vercel Blob (the AI reads only those, R9-21). */
  inBlob?: boolean;
  lastSaved: { by: string | null; at: string } | null;
}) {
  const save = useSaveState<Saved, Values>(saveMediaDetailsAction, token, { alt, decorative, translations });
  return (
    <form method="post" className="a-grid-form" onSubmit={submitKeepingValues(save.dispatch)} onInput={save.markDirty} noValidate aria-label="Mô tả ảnh">
      <DetailsFields
        key={save.fieldsKey}
        id={id}
        token={save.token}
        values={save.view}
        languages={languages}
        altState={altState}
        inBlob={inBlob}
        state={save.state}
      />
      <SaveBar state={save.state} pending={save.pending} dirty={save.dirty} stale={save.stale} onReload={save.reload} lastSaved={lastSaved} label="Lưu mô tả" />
    </form>
  );
}

type Values = { alt: string; decorative: boolean; translations: Record<string, string> };

function DetailsFields({
  id,
  token,
  values,
  languages,
  altState,
  inBlob,
  state,
}: {
  id: string;
  token: string;
  values: Values;
  languages: readonly AltLanguage[];
  altState: 'machine' | 'reviewed' | null;
  inBlob: boolean;
  state: ActionResult<unknown> | null;
}) {
  const uid = useId();
  const ai = useAiFeatures();
  const altBox = useRef<HTMLTextAreaElement>(null);
  const boxes = useRef<Record<string, HTMLTextAreaElement | null>>({});
  // What the form shows now, saved or not: "Dịch từ EN" sends it, and a decorative tick hides the AI alt button.
  const [english, setEnglish] = useState(values.alt);
  const [decorative, setDecorative] = useState(values.decorative);
  return (
    <div className="a-field a-field--wide">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="token" value={token} />
      <label htmlFor={`${uid}-alt`}>Mô tả ảnh (tiếng Anh, cho trình đọc màn hình)</label>
      <textarea
        ref={altBox}
        id={`${uid}-alt`}
        name="alt"
        rows={2}
        maxLength={250}
        defaultValue={values.alt}
        onInput={(e) => setEnglish(e.currentTarget.value)}
        aria-invalid={invalidField(state, 'alt')}
        aria-describedby={`${uid}-alt-error ${uid}-alt-hint${altState ? ` ${uid}-alt-state` : ''}`}
      />
      {altState ? (
        <p className="a-muted" id={`${uid}-alt-state`}>
          <span className={altState === 'machine' ? 'a-tag a-tag--warn' : 'a-tag'}>{STATE_LABELS[altState]}</span>
          {altState === 'machine' ? ' AI viết sau khi tải lên, chưa ai duyệt. Lưu mô tả (hoặc “Duyệt” ở trang Bản dịch) là duyệt.' : null}
        </p>
      ) : null}
      {ai.alt && inBlob && !decorative ? <AiAltButton mediaId={id} onResult={(t) => altBox.current && fillLikeTyping(altBox.current, t)} /> : null}
      {ai.alt && !inBlob ? <p className="a-muted">Ảnh tĩnh: chuyển lên Blob trước để AI viết mô tả.</p> : null}
      <p className="a-muted" id={`${uid}-alt-hint`}>
        Tối đa 250 ký tự. Một mô tả cho mọi chỗ dùng ảnh này.
      </p>
      <FieldError state={state} name="alt" id={`${uid}-alt-error`} />
      {languages.map((l) => (
        <div key={l.code} className="a-field">
          <label htmlFor={`${uid}-alt-${l.code}`}>
            Mô tả ảnh ({l.label}) <span className={l.state === 'reviewed' ? 'a-tag' : 'a-tag a-tag--warn'}>{STATE_LABELS[l.state]}</span>
          </label>
          <textarea
            ref={(el) => {
              boxes.current[l.code] = el;
            }}
            id={`${uid}-alt-${l.code}`}
            name={`altIn.${l.code}`}
            rows={2}
            maxLength={250}
            defaultValue={values.translations[l.code] ?? ''}
          />
          {ai.translate && english.trim() ? (
            <AiTranslateButton english={english} locale={l.code} onResult={(t) => boxes.current[l.code] && fillLikeTyping(boxes.current[l.code]!, t)} />
          ) : null}
          <p className="a-muted">Để trống: khách ở ngôn ngữ này nghe mô tả tiếng Anh.</p>
        </div>
      ))}
      <label className="a-check">
        <input type="checkbox" name="decorative" defaultChecked={values.decorative} onChange={(e) => setDecorative(e.currentTarget.checked)} /> Ảnh trang trí (không cần mô tả; trình đọc màn hình bỏ qua)
      </label>
    </div>
  );
}

/*
 * "Xóa file", after a confirm: refused with the list of places while the
 * file is used (AC3; the server checks again under a lock, this page's list
 * may be stale). A delete moves the file to the trash and goes back to the
 * library.
 */
export function DeleteMediaForm({ id, token, inUse, name }: { id: string; token: string; inUse: boolean; name: string }) {
  // A successful delete redirects to the library (actions.ts), so only a refusal comes back here.
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(deleteMediaAction, null);
  const submit = submitKeepingValues(action);
  return (
    // Asks first, like every other delete (UX-10): it goes to the trash, and History brings it back.
    <form
      method="post"
      className="a-inline-form"
      onSubmit={(event) => {
        if (!window.confirm(`Xóa file “${name}”? File vào thùng rác 30 ngày; khôi phục được từ Lịch sử của nó.`)) {
          event.preventDefault();
          return;
        }
        submit(event);
      }}
      aria-label="Xóa file"
    >
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="token" value={token} />
      <FormMessage state={state} />
      {state && !state.ok && state.code === 'in_use' && state.uses ? (
        <ul className="a-list" aria-label="Nơi đang dùng file">
          {state.uses.map((u) => (
            <li key={`${u.href}|${u.label}`} className="a-list-item">
              <Link href={u.href}>{u.label}</Link>
            </li>
          ))}
        </ul>
      ) : null}
      {inUse ? <p className="a-muted">File đang được dùng: thay ảnh ở các chỗ trên trước khi xóa.</p> : null}
      <button className="a-btn a-btn--danger" type="submit" disabled={pending}>
        {pending ? 'Đang xóa…' : 'Xóa file'}
      </button>
    </form>
  );
}
