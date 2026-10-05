'use client';

import { submitKeepingValues } from '@/lib/admin/form';
import type { MediaOption } from '@/lib/admin/media-option';
import type { ActionResult } from '@/lib/server/action-result';
import type { CuisineInput } from '@/lib/server/content-admin/cuisines';
import { ImagePicker } from '../../_kit/ImagePicker';
import { SaveBar } from '../../_kit/SaveBar';
import { TextField } from '../../_kit/TextField';
import { TranslatableField } from '../../_kit/TranslatableField';
import { useSaveState } from '../../_kit/useSaveState';
import { createCuisineAction, saveCuisineAction } from './actions';

type Props = {
  /** null: "Thêm ẩm thực" (the id is then typed in the form). */
  id: string | null;
  /** The cuisine's token, or (adding one) the list's. */
  token: string;
  values: CuisineInput;
  images: readonly MediaOption[];
  upload: { prefix: string; configured: boolean };
  /** The form's accessible name. */
  label: string;
};

/*
 * One cuisine (spec §7.2 content/cuisines): its label, its round picture on
 * the rail, its switch. Code rule 9: the save state lives here and the
 * fields below remount on the token useSaveState accepted. A new cuisine
 * posts no token, so another write to the list while it is being filled is no
 * conflict, and it shows no stale notice.
 */
export function CuisineForm(props: Props) {
  const action = (props.id ? saveCuisineAction : createCuisineAction) as (prev: ActionResult<unknown> | null, formData: FormData) => Promise<ActionResult<unknown>>;
  const save = useSaveState<unknown, CuisineInput>(action, props.token, props.values);
  return (
    <form method="post" className="a-grid-form" onSubmit={submitKeepingValues(save.dispatch)} onInput={save.markDirty} noValidate aria-label={props.label}>
      <Fields key={save.fieldsKey} {...props} token={save.token} values={save.view} state={save.state} />
      <SaveBar
        state={save.state}
        pending={save.pending}
        dirty={save.dirty}
        stale={props.id ? save.stale : false}
        onReload={save.reload}
        viewHref={props.id ? '/en#cuisines' : null}
        label={props.id ? 'Lưu ẩm thực' : 'Thêm ẩm thực'}
        success={props.id ? undefined : 'Đã thêm ẩm thực.'}
      />
    </form>
  );
}

function Fields({ id, token, values: v, images, upload, state }: Props & { state: ActionResult<unknown> | null }) {
  const error = (name: string) => (state && !state.ok ? state.fieldErrors?.[name]?.[0] : undefined);
  return (
    <>
      {id ? (
        <>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="token" value={token} />
        </>
      ) : (
        <TextField
          name="id"
          label="Mã (bộ lọc)"
          defaultValue={v.id}
          max={40}
          required
          hint="Chữ thường không dấu, số và gạch nối, ví dụ korean. Không đổi được sau khi thêm."
          error={error('id')}
        />
      )}
      <TranslatableField name="label" label="Tên ẩm thực" values={v.label} max={40} required error={error('label')} />
      <div className="a-field--wide">
        <ImagePicker name="imageId" label="Ảnh tròn trên thanh ẩm thực" options={images} value={v.imageId || null} required upload={upload} error={error('imageId')} />
      </div>
      <label className="a-check a-field--wide">
        <input type="checkbox" name="isPublished" defaultChecked={v.isPublished} />
        Hiện ẩm thực trên web (thanh ẩm thực, bộ lọc, thẻ nhà hàng)
      </label>
    </>
  );
}
