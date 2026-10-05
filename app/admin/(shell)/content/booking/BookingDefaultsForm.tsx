'use client';

import { useId } from 'react';
import { submitKeepingValues } from '@/lib/admin/form';
import type { ActionResult } from '@/lib/server/action-result';
import { FieldError } from '../../_ui/FormMessage';
import { SaveBar } from '../../_kit/SaveBar';
import { useSaveState } from '../../_kit/useSaveState';
import { saveBookingDefaultsAction } from './actions';

export type BookingDefaults = { restaurant: string | null; occasion: string | null };

type Props = {
  token: string;
  values: BookingDefaults;
  /** Every restaurant not archived, with whether it books online now. */
  restaurants: readonly { id: string; name: string; bookable: boolean }[];
  /** The meals with their admin names (site_settings.default_occasion's CHECK). */
  occasions: readonly { key: string; label: string }[];
  lastSaved: { by: string | null; at: string } | null;
};

/*
 * The defaults the booking bar and the finder start on (spec §5.2
 * site_settings.default_restaurant_id, default_occasion). Code rule 9: the
 * save state lives here and the fields remount on the token useSaveState
 * accepted.
 */
export function BookingDefaultsForm(props: Props) {
  const save = useSaveState<null, BookingDefaults>(saveBookingDefaultsAction as (prev: ActionResult<null> | null, formData: FormData) => Promise<ActionResult<null>>, props.token, props.values);
  return (
    <form method="post" className="a-grid-form" onSubmit={submitKeepingValues(save.dispatch)} onInput={save.markDirty} noValidate aria-label="Mặc định khi khách mở trang">
      <Fields key={save.token} {...props} token={save.token} values={save.view} state={save.state} />
      <SaveBar state={save.state} pending={save.pending} dirty={save.dirty} stale={save.stale} onReload={save.reload} lastSaved={props.lastSaved} viewHref="/en#reserve" />
    </form>
  );
}

function Fields({ token, values: v, restaurants, occasions, state }: Props & { state: ActionResult<unknown> | null }) {
  const uid = useId();
  const error = (name: string) => (state && !state.ok ? state.fieldErrors?.[name]?.[0] : undefined);
  return (
    <>
      <input type="hidden" name="token" value={token} />
      <div className="a-field">
        <label htmlFor={`${uid}-restaurant`}>Nhà hàng chọn sẵn</label>
        <select
          id={`${uid}-restaurant`}
          name="defaultRestaurantId"
          defaultValue={v.restaurant ?? ''}
          aria-invalid={error('defaultRestaurantId') ? true : undefined}
          aria-describedby={`${uid}-restaurant-hint ${uid}-restaurant-error`}
        >
          <option value="">Nhà hàng đầu tiên nhận đặt online</option>
          {restaurants.map((r) => (
            <option key={r.id} value={r.id}>
              {r.bookable ? r.name : `${r.name} (đang không nhận đặt online)`}
            </option>
          ))}
        </select>
        <p className="a-muted" id={`${uid}-restaurant-hint`}>
          Thanh đặt bàn và form đặt bàn bắt đầu ở nhà hàng này; nếu nó không nhận đặt online, ở nhà hàng đầu tiên nhận đặt.
        </p>
        <FieldError state={state} name="defaultRestaurantId" id={`${uid}-restaurant-error`} />
      </div>
      <div className="a-field">
        <label htmlFor={`${uid}-occasion`}>Dịp chọn sẵn ở ô tìm</label>
        <select
          id={`${uid}-occasion`}
          name="defaultOccasion"
          defaultValue={v.occasion ?? ''}
          aria-invalid={error('defaultOccasion') ? true : undefined}
          aria-describedby={`${uid}-occasion-error`}
        >
          <option value="">Mọi dịp</option>
          {occasions.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
        <FieldError state={state} name="defaultOccasion" id={`${uid}-occasion-error`} />
      </div>
    </>
  );
}
