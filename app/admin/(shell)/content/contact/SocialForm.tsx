'use client';

import { useId } from 'react';
import { submitKeepingValues } from '@/lib/admin/form';
import type { ActionResult } from '@/lib/server/action-result';
import type { SocialInput } from '@/lib/server/content-admin/socials';
import { SaveBar } from '../../_kit/SaveBar';
import { TextField } from '../../_kit/TextField';
import { useSaveState } from '../../_kit/useSaveState';
import { createSocialLinkAction, saveSocialLinkAction } from './actions';

type Props = {
  /** null: "Thêm link". */
  id: string | null;
  /** The link's token, or (adding one) the list's. */
  token: string;
  values: SocialInput;
  /** Every platform migration 008 allows, with its admin name. */
  platforms: readonly { key: string; label: string }[];
  /** The form's accessible name. */
  label: string;
};

/*
 * One footer social link (spec §7.2 content/contact): its platform, its
 * address and its switch. The footer prints the platform's label from the
 * strings below the list (social.<platform>). Code rule 9: the save state
 * lives here and the fields below remount on the token useSaveState
 * accepted. A new link posts no token.
 */
export function SocialForm(props: Props) {
  const action = (props.id ? saveSocialLinkAction : createSocialLinkAction) as (prev: ActionResult<unknown> | null, formData: FormData) => Promise<ActionResult<unknown>>;
  const save = useSaveState<unknown, SocialInput>(action, props.token, props.values);
  return (
    <form method="post" className="a-grid-form" onSubmit={submitKeepingValues(save.dispatch)} onInput={save.markDirty} noValidate aria-label={props.label}>
      <Fields key={save.fieldsKey} {...props} token={save.token} values={save.view} state={save.state} />
      <SaveBar
        state={save.state}
        pending={save.pending}
        dirty={save.dirty}
        stale={props.id ? save.stale : false}
        onReload={save.reload}
        viewHref={props.id ? '/en' : null}
        label={props.id ? 'Lưu link' : 'Thêm link'}
        success={props.id ? undefined : 'Đã thêm link.'}
      />
    </form>
  );
}

function Fields({ id, token, values: v, platforms, state }: Props & { state: ActionResult<unknown> | null }) {
  const uid = useId();
  const error = (name: string) => (state && !state.ok ? state.fieldErrors?.[name]?.[0] : undefined);
  const platformError = error('platform');
  return (
    <>
      {id ? (
        <>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="token" value={token} />
        </>
      ) : null}
      <div className="a-field">
        <label htmlFor={`${uid}-platform`}>Mạng xã hội</label>
        <select
          id={`${uid}-platform`}
          name="platform"
          defaultValue={v.platform}
          aria-invalid={platformError ? true : undefined}
          aria-describedby={platformError ? `${uid}-platform-error` : undefined}
        >
          {platforms.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
        {platformError ? (
          <p className="a-field-error" id={`${uid}-platform-error`}>
            {platformError}
          </p>
        ) : null}
      </div>
      <TextField name="href" label="Đường dẫn" type="url" defaultValue={v.href} max={2000} wide required hint="https://… Mở ở thẻ mới." error={error('href')} />
      <label className="a-check a-field--wide">
        <input type="checkbox" name="isPublished" defaultChecked={v.isPublished} />
        Hiện ở chân trang (tối đa 6 link)
      </label>
    </>
  );
}
