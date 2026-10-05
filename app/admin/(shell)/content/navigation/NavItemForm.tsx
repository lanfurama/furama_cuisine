'use client';

import { useId } from 'react';
import { LENGTHS, NAV_LABEL_WARNING } from '@/lib/admin/content-rules';
import { submitKeepingValues } from '@/lib/admin/form';
import type { ActionResult } from '@/lib/server/action-result';
import type { NavInput } from '@/lib/server/content-admin/nav';
import { SaveBar } from '../../_kit/SaveBar';
import { TranslatableField } from '../../_kit/TranslatableField';
import { useSaveState } from '../../_kit/useSaveState';
import { createNavItemAction, saveNavItemAction } from './actions';

type Props = {
  /** null: "Thêm mục menu". */
  id: string | null;
  /** The item's token, or (adding one) the list's. */
  token: string;
  values: NavInput;
  /** The sections it may point at: those no other item points at, with their admin names. */
  targets: readonly { key: string; label: string }[];
  /** The form's accessible name. */
  label: string;
};

/*
 * One menu item (spec §7.2 content/navigation, §6.5): its label (warns past
 * 14 characters, refused past 18), the section it scrolls to, its switch.
 * Code rule 9: the save state lives here and the fields below remount on the
 * token useSaveState accepted. A new item posts no token.
 */
export function NavItemForm(props: Props) {
  const action = (props.id ? saveNavItemAction : createNavItemAction) as (prev: ActionResult<unknown> | null, formData: FormData) => Promise<ActionResult<unknown>>;
  const save = useSaveState<unknown, NavInput>(action, props.token, props.values);
  return (
    <form method="post" className="a-grid-form" onSubmit={submitKeepingValues(save.dispatch)} onInput={save.markDirty} noValidate aria-label={props.label}>
      <Fields key={save.token} {...props} token={save.token} values={save.view} state={save.state} />
      <SaveBar
        state={save.state}
        pending={save.pending}
        dirty={save.dirty}
        stale={props.id ? save.stale : false}
        onReload={save.reload}
        viewHref={props.id ? '/en' : null}
        label={props.id ? 'Lưu mục menu' : 'Thêm mục menu'}
        success={props.id ? undefined : 'Đã thêm mục menu.'}
      />
    </form>
  );
}

function Fields({ id, token, values: v, targets, state }: Props & { state: ActionResult<unknown> | null }) {
  const uid = useId();
  const error = (name: string) => (state && !state.ok ? state.fieldErrors?.[name]?.[0] : undefined);
  const targetError = error('targetSection');
  return (
    <>
      {id ? (
        <>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="token" value={token} />
        </>
      ) : null}
      <TranslatableField
        name="label"
        label="Nhãn"
        values={v.label}
        max={LENGTHS.navLabel.max}
        warnAt={LENGTHS.navLabel.warn}
        warnMessage={NAV_LABEL_WARNING}
        required
        hint="Thanh menu trên máy tính viết hoa nhãn này; menu điện thoại giữ nguyên."
        error={error('label')}
      />
      <div className="a-field">
        <label htmlFor={`${uid}-target`}>Trỏ tới section</label>
        <select
          id={`${uid}-target`}
          name="targetSection"
          defaultValue={v.targetSection}
          aria-invalid={targetError ? true : undefined}
          aria-describedby={targetError ? `${uid}-target-error` : undefined}
        >
          {targets.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
            </option>
          ))}
        </select>
        {targetError ? (
          <p className="a-field-error" id={`${uid}-target-error`}>
            {targetError}
          </p>
        ) : null}
      </div>
      <label className="a-check a-field--wide">
        <input type="checkbox" name="isPublished" defaultChecked={v.isPublished} />
        Hiện trong menu (tối đa 6 mục; mục tự ẩn khi section của nó bị tắt)
      </label>
    </>
  );
}
