'use client';

import { useId } from 'react';
import { submitKeepingValues } from '@/lib/admin/form';
import type { MediaOption } from '@/lib/admin/media-option';
import type { ActionResult } from '@/lib/server/action-result';
import type { StoryInput } from '@/lib/server/content-admin/stories';
import { ImagePicker } from '../../_kit/ImagePicker';
import { SaveBar } from '../../_kit/SaveBar';
import { TextField } from '../../_kit/TextField';
import { TranslatableField } from '../../_kit/TranslatableField';
import { useSaveState } from '../../_kit/useSaveState';
import { createStoryAction, saveStoryAction } from './actions';

type Props = {
  /** null: "Thêm câu chuyện". */
  id: string | null;
  /** The card's token, or (adding one) the list's. */
  token: string;
  values: StoryInput;
  images: readonly MediaOption[];
  upload: { prefix: string; configured: boolean };
  /** The form's accessible name. */
  label: string;
};

/*
 * One Stories card (spec §7.2 content/stories): its picture, the article it
 * links to, its date, its category and title, its switch. The kicker the
 * guest sees is "Category · date" from the parts that are filled (L7-7).
 * Code rule 9: the save state lives here and the fields below remount on the
 * token useSaveState accepted. A new card posts no token.
 */
export function StoryForm(props: Props) {
  const action = (props.id ? saveStoryAction : createStoryAction) as (prev: ActionResult<unknown> | null, formData: FormData) => Promise<ActionResult<unknown>>;
  const save = useSaveState<unknown, StoryInput>(action, props.token, props.values);
  return (
    <form method="post" className="a-grid-form" onSubmit={submitKeepingValues(save.dispatch)} onInput={save.markDirty} noValidate aria-label={props.label}>
      <Fields key={save.token} {...props} token={save.token} values={save.view} state={save.state} />
      <SaveBar
        state={save.state}
        pending={save.pending}
        dirty={save.dirty}
        stale={props.id ? save.stale : false}
        onReload={save.reload}
        viewHref={props.id ? '/en#stories' : null}
        label={props.id ? 'Lưu câu chuyện' : 'Thêm câu chuyện'}
        success={props.id ? undefined : 'Đã thêm câu chuyện.'}
      />
    </form>
  );
}

function Fields({ id, token, values: v, images, upload, state }: Props & { state: ActionResult<unknown> | null }) {
  const uid = useId();
  const error = (name: string) => (state && !state.ok ? state.fieldErrors?.[name]?.[0] : undefined);
  const dateError = error('publishedOn');
  return (
    <>
      {id ? (
        <>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="token" value={token} />
        </>
      ) : null}
      <TranslatableField name="title" label="Tiêu đề" values={v.title} max={160} required error={error('title')} />
      <TranslatableField name="category" label="Chuyên mục" values={v.category} max={60} hint="Dòng nhỏ trên tiêu đề, trước ngày." error={error('category')} />
      <div className="a-field">
        <label htmlFor={`${uid}-date`}>Ngày đăng</label>
        <input
          id={`${uid}-date`}
          name="publishedOn"
          type="date"
          defaultValue={v.publishedOn ?? ''}
          aria-invalid={dateError ? true : undefined}
          aria-describedby={[`${uid}-date-hint`, dateError && `${uid}-date-error`].filter(Boolean).join(' ')}
        />
        <p className="a-muted" id={`${uid}-date-hint`}>
          Để trống: thẻ chỉ ghi chuyên mục.
        </p>
        {dateError ? (
          <p className="a-field-error" id={`${uid}-date-error`}>
            {dateError}
          </p>
        ) : null}
      </div>
      <TextField name="href" label="Link bài viết" type="url" defaultValue={v.href || null} max={2000} required wide hint="https://… Mở ở thẻ mới." error={error('href')} />
      <TranslatableField
        name="localHref"
        label="Link bài viết riêng của ngôn ngữ này"
        values={v.localHref}
        max={2000}
        hint="Để trống: dùng link bài viết ở trên."
        error={error('localHref')}
      />
      <div className="a-field--wide">
        <ImagePicker name="imageId" label="Ảnh thẻ" options={images} value={v.imageId || null} required upload={upload} error={error('imageId')} />
      </div>
      <label className="a-check a-field--wide">
        <input type="checkbox" name="isPublished" defaultChecked={v.isPublished} />
        Hiện trên trang chủ (tối đa 4 thẻ)
      </label>
    </>
  );
}
