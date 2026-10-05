'use client';

import { submitKeepingValues } from '@/lib/admin/form';
import type { ActionResult } from '@/lib/server/action-result';
import type { ExperienceInput } from '@/lib/server/content-admin/experiences';
import { SaveBar } from '../../_kit/SaveBar';
import { TextField } from '../../_kit/TextField';
import { TranslatableField } from '../../_kit/TranslatableField';
import { useSaveState } from '../../_kit/useSaveState';
import { createExperienceAction, saveExperienceAction } from './actions';

type Props = {
  /** null: "Thêm mục". */
  id: string | null;
  /** The row's token, or (adding one) the list's. */
  token: string;
  values: ExperienceInput;
  /** The form's accessible name. */
  label: string;
};

/*
 * One Experiences row (spec §7.2 content/experiences): its title, its blurb,
 * its link and its switch. Code rule 9: the save state lives here and the
 * fields below remount on the token useSaveState accepted. A new row posts
 * no token: another write to the list while it is being filled is no
 * conflict, and it shows no stale notice.
 */
export function ExperienceForm(props: Props) {
  const action = (props.id ? saveExperienceAction : createExperienceAction) as (prev: ActionResult<unknown> | null, formData: FormData) => Promise<ActionResult<unknown>>;
  const save = useSaveState<unknown, ExperienceInput>(action, props.token, props.values);
  return (
    <form method="post" className="a-grid-form" onSubmit={submitKeepingValues(save.dispatch)} onInput={save.markDirty} noValidate aria-label={props.label}>
      <Fields key={save.token} {...props} token={save.token} values={save.view} state={save.state} />
      <SaveBar
        state={save.state}
        pending={save.pending}
        dirty={save.dirty}
        stale={props.id ? save.stale : false}
        onReload={save.reload}
        viewHref={props.id ? '/en#experiences' : null}
        label={props.id ? 'Lưu mục' : 'Thêm mục'}
        success={props.id ? undefined : 'Đã thêm mục.'}
      />
    </form>
  );
}

function Fields({ id, token, values: v, state }: Props & { state: ActionResult<unknown> | null }) {
  const error = (name: string) => (state && !state.ok ? state.fieldErrors?.[name]?.[0] : undefined);
  return (
    <>
      {id ? (
        <>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="token" value={token} />
        </>
      ) : null}
      <TranslatableField name="title" label="Tiêu đề" values={v.title} max={80} required error={error('title')} />
      <TranslatableField name="blurb" label="Mô tả" values={v.blurb} max={200} rows={2} hint="Một dòng dưới tiêu đề." error={error('blurb')} />
      <TextField
        name="link"
        label="Link"
        type="url"
        defaultValue={v.link}
        max={2000}
        wide
        hint="https://… Mở ở thẻ mới. Để trống: mục trỏ về chính section Experiences."
        error={error('link')}
      />
      <label className="a-check a-field--wide">
        <input type="checkbox" name="isPublished" defaultChecked={v.isPublished} />
        Hiện trên trang chủ (tối đa 5 mục)
      </label>
    </>
  );
}
