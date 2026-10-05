'use client';

import { submitKeepingValues } from '@/lib/admin/form';
import type { MediaOption } from '@/lib/admin/media-option';
import type { ActionResult } from '@/lib/server/action-result';
import { ImagePicker } from '../../_kit/ImagePicker';
import { SaveBar } from '../../_kit/SaveBar';
import { useSaveState } from '../../_kit/useSaveState';
import { createSlideAction, saveSlideAction } from './actions';

export type SlideValues = { id: string | null; imageId: string | null; imageMobileId: string | null; isPublished: boolean };

/*
 * A hero slide's pictures (spec §6.5): the picture every width shows, and the
 * phone crop the first slide shown needs (the server refuses a write that
 * leaves the first shown slide without one). A new slide is added at the end;
 * its form is keyed on the list's token, so it empties once the slide exists.
 * Code rule 9: the save state lives here, the fields below remount on the
 * token useSaveState accepted. A new slide posts no token, so another write
 * to the list while it is being filled is no conflict: it shows no notice.
 */
export function SlideForm({
  slide,
  token,
  images,
  upload,
  label,
}: {
  slide: SlideValues;
  /** The slide's token, or (adding one) the list's. */
  token: string;
  images: readonly MediaOption[];
  upload: { prefix: string; configured: boolean };
  /** The form's accessible name. */
  label: string;
}) {
  // One form, two actions: a slide that exists saves, a new one is created (its result names the id).
  const action = (slide.id ? saveSlideAction : createSlideAction) as (prev: ActionResult<unknown> | null, formData: FormData) => Promise<ActionResult<unknown>>;
  const save = useSaveState<unknown, SlideValues>(action, token, slide);
  return (
    <form method="post" className="a-grid-form" onSubmit={submitKeepingValues(save.dispatch)} onInput={save.markDirty} noValidate aria-label={label}>
      <Fields key={save.fieldsKey} slide={save.view} token={save.token} images={images} upload={upload} state={save.state} />
      <SaveBar
        state={save.state}
        pending={save.pending}
        dirty={save.dirty}
        stale={slide.id ? save.stale : false}
        onReload={save.reload}
        label={slide.id ? 'Lưu slide' : 'Thêm slide'}
        success={slide.id ? undefined : 'Đã thêm slide.'}
      />
    </form>
  );
}

function Fields({
  slide,
  token,
  images,
  upload,
  state,
}: {
  slide: SlideValues;
  token: string;
  images: readonly MediaOption[];
  upload: { prefix: string; configured: boolean };
  state: ActionResult<unknown> | null;
}) {
  const error = (name: string) => (state && !state.ok ? state.fieldErrors?.[name]?.[0] : undefined);
  return (
    <>
      {slide.id ? (
        <>
          <input type="hidden" name="id" value={slide.id} />
          <input type="hidden" name="token" value={token} />
        </>
      ) : null}
      <div className="a-field--wide">
        <ImagePicker name="imageId" label="Ảnh của slide" options={images} value={slide.imageId} required upload={upload} error={error('imageId')} />
      </div>
      <div className="a-field--wide">
        <ImagePicker
          name="imageMobileId"
          label="Ảnh cắt cho điện thoại"
          options={images}
          value={slide.imageMobileId}
          upload={upload}
          hint="Điện thoại chỉ hiện slide đầu tiên, bằng ảnh này: slide đầu tiên đang hiện bắt buộc có."
          error={error('imageMobileId')}
        />
      </div>
      <label className="a-check a-field--wide">
        <input type="checkbox" name="isPublished" defaultChecked={slide.isPublished} />
        Hiện slide trên trang chủ
      </label>
    </>
  );
}
