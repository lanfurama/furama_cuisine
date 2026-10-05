'use client';

import { useId } from 'react';
import { SECTION_PARTS } from '@/lib/admin/content-rules';
import { submitKeepingValues } from '@/lib/admin/form';
import type { MediaOption } from '@/lib/admin/media-option';
import type { Saved } from '@/lib/admin/save-state';
import type { ActionResult } from '@/lib/server/action-result';
import type { SectionView } from '@/lib/server/content-admin/sections';
import { FieldError } from '../../_ui/FormMessage';
import { ImagePicker } from '../../_kit/ImagePicker';
import { SaveBar } from '../../_kit/SaveBar';
import { useSaveState } from '../../_kit/useSaveState';
import { saveSectionAction } from './actions';

/*
 * One home section's form (spec §7.2 content/sections): its switch, and its
 * picture and link where it has them (SECTION_PARTS). The hero screen draws
 * the film's with the same component (C5). Code rule 9: the save state lives
 * here, the fields below remount on the token useSaveState accepted, and draw
 * the section it accepted with it (the pictures to choose from stay live).
 */
export function SectionForm({
  section,
  images,
  upload,
  formLabel,
  lastSaved,
}: {
  section: SectionView;
  images: readonly MediaOption[];
  upload: { prefix: string; configured: boolean };
  /** The form's accessible name; the section's label by default. */
  formLabel?: string;
  lastSaved: { by: string | null; at: string };
}) {
  const save = useSaveState<Saved, SectionView>(saveSectionAction, section.token, section);
  return (
    <form
      method="post"
      className="a-grid-form a-editor"
      onSubmit={submitKeepingValues(save.dispatch)}
      onInput={save.markDirty}
      noValidate
      aria-label={formLabel ?? section.label}
    >
      <Fields key={save.fieldsKey} section={save.view} images={images} upload={upload} state={save.state} />
      <SaveBar state={save.state} pending={save.pending} dirty={save.dirty} stale={save.stale} onReload={save.reload} lastSaved={lastSaved} viewHref="/en" />
    </form>
  );
}

function Fields({
  section: s,
  images,
  upload,
  state,
}: {
  section: SectionView;
  images: readonly MediaOption[];
  upload: { prefix: string; configured: boolean };
  state: ActionResult<unknown> | null;
}) {
  const uid = useId();
  const parts = SECTION_PARTS[s.key] ?? {};
  const error = (name: string) => (state && !state.ok ? state.fieldErrors?.[name]?.[0] : undefined);
  return (
    <>
      <input type="hidden" name="key" value={s.key} />
      <input type="hidden" name="token" value={s.token} />
      {s.key === 'restaurants' ? (
        <p className="a-muted a-field--wide">
          <input type="hidden" name="isVisible" value="on" />
          Luôn hiện: thẻ nhà hàng, ô tìm và thanh tab đều dẫn tới section này (spec §6.5).
        </p>
      ) : (
        <div className="a-field a-field--wide">
          <label className="a-check">
            <input type="checkbox" name="isVisible" defaultChecked={s.visible} aria-describedby={`${uid}-visible-error`} />
            Hiện trên trang chủ
          </label>
          <FieldError state={state} name="isVisible" id={`${uid}-visible-error`} />
        </div>
      )}
      {parts.image ? (
        <div className="a-field--wide">
          <ImagePicker name="imageId" label={parts.image} options={images} value={s.imageId} upload={upload} error={error('imageId')} />
        </div>
      ) : null}
      {parts.link ? (
        <div className="a-field a-field--wide">
          <label htmlFor={`${uid}-link`}>{parts.link}</label>
          <input
            id={`${uid}-link`}
            name="link"
            type="url"
            inputMode="url"
            maxLength={2000}
            defaultValue={s.link ?? ''}
            aria-describedby={`${uid}-link-hint ${uid}-link-error`}
            aria-invalid={error('link') ? true : undefined}
          />
          <p className="a-muted" id={`${uid}-link-hint`}>
            {s.key === 'film' ? 'Để trống thì hộp phim hiện ảnh poster và dòng “THE FILM · COMING SOON”.' : 'https://…'}
          </p>
          <FieldError state={state} name="link" id={`${uid}-link-error`} />
        </div>
      ) : null}
    </>
  );
}
