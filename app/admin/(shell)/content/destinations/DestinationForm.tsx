'use client';

import { useId } from 'react';
import { submitKeepingValues } from '@/lib/admin/form';
import type { MediaOption } from '@/lib/admin/media-option';
import type { ActionResult } from '@/lib/server/action-result';
import type { DestinationInput } from '@/lib/server/content-admin/destinations';
import { ImagePicker } from '../../_kit/ImagePicker';
import { SaveBar } from '../../_kit/SaveBar';
import { TextField } from '../../_kit/TextField';
import { TranslatableField } from '../../_kit/TranslatableField';
import { useSaveState } from '../../_kit/useSaveState';
import { createDestinationAction, saveDestinationAction } from './actions';

type Props = {
  /** null: "Thêm điểm đến" (the id is then typed in the form). */
  id: string | null;
  /** The destination's token, or (adding one) the list's. */
  token: string;
  values: DestinationInput;
  images: readonly MediaOption[];
  upload: { prefix: string; configured: boolean };
  /** Said under the switch: what hiding this destination takes off the site (its restaurants shown now). */
  hideNote: string | null;
  /** The form's accessible name. */
  label: string;
};

/*
 * One destination (spec §7.2 content/destinations): its home card (picture,
 * two title lines, two blurb lines), the name the finder, the footer and
 * "More at …" print, its contact lines and its switch. Code rule 9: the save
 * state lives here and the fields below remount on the token useSaveState
 * accepted, so a refused save keeps what was typed. A new destination posts
 * no token: another write to the list while it is being filled is no
 * conflict, and it shows no stale notice.
 */
export function DestinationForm(props: Props) {
  const action = (props.id ? saveDestinationAction : createDestinationAction) as (prev: ActionResult<unknown> | null, formData: FormData) => Promise<ActionResult<unknown>>;
  const save = useSaveState<unknown, DestinationInput>(action, props.token, props.values);
  return (
    <form method="post" className="a-grid-form" onSubmit={submitKeepingValues(save.dispatch)} onInput={save.markDirty} noValidate aria-label={props.label}>
      <Fields key={save.token} {...props} token={save.token} values={save.view} state={save.state} />
      <SaveBar
        state={save.state}
        pending={save.pending}
        dirty={save.dirty}
        stale={props.id ? save.stale : false}
        onReload={save.reload}
        viewHref={props.id ? '/en#destinations' : null}
        label={props.id ? 'Lưu điểm đến' : 'Thêm điểm đến'}
        success={props.id ? undefined : 'Đã thêm điểm đến.'}
      />
    </form>
  );
}

function Fields({ id, token, values: v, images, upload, hideNote, state }: Props & { state: ActionResult<unknown> | null }) {
  const uid = useId();
  const error = (name: string) => (state && !state.ok ? state.fieldErrors?.[name]?.[0] : undefined);
  const kindError = error('kind');
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
          label="Mã (đường dẫn)"
          defaultValue={v.id}
          max={40}
          required
          hint="Chữ thường không dấu, số và gạch nối, ví dụ hoi-an. Không đổi được sau khi thêm."
          error={error('id')}
        />
      )}
      <div className="a-field">
        <label htmlFor={`${uid}-kind`}>Loại thẻ</label>
        <select
          id={`${uid}-kind`}
          name="kind"
          defaultValue={v.kind}
          aria-invalid={kindError ? true : undefined}
          aria-describedby={kindError ? `${uid}-kind-error` : undefined}
        >
          <option value="venue">Địa điểm (có nhà hàng, có trong bộ lọc)</option>
          <option value="teaser">Teaser (thẻ “sắp có”, không phải địa điểm)</option>
        </select>
        {kindError ? (
          <p className="a-field-error" id={`${uid}-kind-error`}>
            {kindError}
          </p>
        ) : null}
      </div>
      <TranslatableField
        name="name"
        label="Tên địa điểm"
        values={v.name}
        max={80}
        hint="Bộ lọc, chân trang và “More at …” in tên này. Bắt buộc với địa điểm."
        error={error('name')}
      />
      <TranslatableField name="cardTitle1" label="Tiêu đề thẻ, dòng 1" values={v.cardTitle1} max={40} hint="Để trống: dùng tên địa điểm." error={error('cardTitle1')} />
      <TranslatableField name="cardTitle2" label="Tiêu đề thẻ, dòng 2" values={v.cardTitle2} max={40} error={error('cardTitle2')} />
      <TranslatableField name="cardBlurb1" label="Mô tả thẻ, dòng 1" values={v.cardBlurb1} max={60} error={error('cardBlurb1')} />
      <TranslatableField name="cardBlurb2" label="Mô tả thẻ, dòng 2" values={v.cardBlurb2} max={60} error={error('cardBlurb2')} />
      <div className="a-field--wide">
        <ImagePicker name="cardImageId" label="Ảnh thẻ" options={images} value={v.cardImageId} upload={upload} error={error('cardImageId')} />
      </div>
      <TranslatableField name="address" label="Địa chỉ" values={v.address} max={200} hint="Dòng địa chỉ ở chân trang." error={error('address')} />
      <TextField
        name="phoneDisplay"
        label="Số điện thoại"
        type="tel"
        defaultValue={v.phoneDisplay}
        max={30}
        hint="In như gõ; nhà hàng không có số riêng thì dùng số này."
        error={error('phoneDisplay')}
      />
      <TextField name="mapUrl" label="Link bản đồ" type="url" defaultValue={v.mapUrl} max={2000} hint="https://…" error={error('mapUrl')} />
      <TextField name="email" label="Email" type="email" defaultValue={v.email} max={254} error={error('email')} />
      <label className="a-check a-field--wide">
        <input type="checkbox" name="showInFooter" defaultChecked={v.showInFooter} />
        Hiện địa chỉ và số điện thoại ở chân trang
      </label>
      <div className="a-field--wide">
        <label className="a-check">
          <input
            type="checkbox"
            name="isPublished"
            defaultChecked={v.isPublished}
            aria-invalid={error('isPublished') ? true : undefined}
            aria-describedby={[hideNote && `${uid}-hide`, error('isPublished') && `${uid}-shown-error`].filter(Boolean).join(' ') || undefined}
          />
          Hiện điểm đến trên web (tối đa 5 thẻ, 1 teaser)
        </label>
        {hideNote ? (
          <p className="a-muted" id={`${uid}-hide`}>
            {hideNote}
          </p>
        ) : null}
        {error('isPublished') ? (
          <p className="a-field-error" id={`${uid}-shown-error`}>
            {error('isPublished')}
          </p>
        ) : null}
      </div>
    </>
  );
}
