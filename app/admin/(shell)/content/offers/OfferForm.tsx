'use client';

import { useId } from 'react';
import { submitKeepingValues } from '@/lib/admin/form';
import type { ActionResult } from '@/lib/server/action-result';
import type { OfferInput } from '@/lib/server/content-admin/offers';
import { SaveBar } from '../../_kit/SaveBar';
import { TranslatableField } from '../../_kit/TranslatableField';
import { useSaveState } from '../../_kit/useSaveState';
import { createOfferAction, saveOfferAction } from './actions';

type Props = {
  /** null: "Thêm ưu đãi". */
  id: string | null;
  token: string;
  values: OfferInput;
  restaurants: { id: string; name: string }[];
  lastSaved: { by: string | null; at: string } | null;
};

/*
 * One offer (spec §7.2 content/offers). The holder keeps the action's state;
 * the fields remount on a new token (code rule 9, useSaveState), so a save,
 * a restore from History, or "Tải lại" after a conflict all redraw them from
 * the offer as it now is, and a refused save keeps what was typed.
 */
export function OfferForm(props: Props) {
  const save = useSaveState<unknown>(
    (prev, formData) => (props.id ? saveOfferAction(prev as ActionResult | null, formData) : createOfferAction(prev as ActionResult<{ id: string }> | null, formData)),
    props.token,
  );
  return (
    <form
      method="post"
      className="a-grid-form a-editor"
      onSubmit={submitKeepingValues(save.dispatch)}
      onInput={save.markDirty}
      noValidate
      aria-label={props.id ? 'Sửa ưu đãi' : 'Thêm ưu đãi'}
    >
      <OfferFields key={props.token} {...props} state={save.state} />
      <SaveBar
        state={save.state}
        pending={save.pending}
        dirty={save.dirty}
        lastSaved={props.lastSaved}
        viewHref={props.id ? '/en#offers' : null}
        label={props.id ? 'Lưu ưu đãi' : 'Thêm ưu đãi'}
      />
    </form>
  );
}

function OfferFields({ id, token, values: v, restaurants, state }: Props & { state: ActionResult<unknown> | null }) {
  const uid = useId();
  const fid = (name: string) => `${uid}-${name}`;
  const error = (name: string) => (state && !state.ok ? state.fieldErrors?.[name]?.[0] : undefined);
  const described = (name: string, hint?: boolean) => [hint && `${fid(name)}-hint`, error(name) && `${fid(name)}-error`].filter(Boolean).join(' ') || undefined;
  const fieldError = (name: string) =>
    error(name) ? (
      <p className="a-field-error" id={`${fid(name)}-error`}>
        {error(name)}
      </p>
    ) : null;

  return (
    <>
      {id ? <input type="hidden" name="id" value={id} /> : null}
      <input type="hidden" name="token" value={token} />
      <TranslatableField name="title" label="Tiêu đề" values={v.title} max={80} required error={error('title')} />
      <TranslatableField name="schedule" label="Lịch" values={v.schedule} max={120} hint="Ví dụ: Nightly 18:30–22:00. Hiện sau giá, cách bằng dấu ·" error={error('schedule')} />
      <div className="a-field">
        <label htmlFor={fid('restaurant')}>Nhà hàng</label>
        <select id={fid('restaurant')} name="restaurantId" defaultValue={v.restaurantId} aria-describedby={described('restaurantId')}>
          <option value="">Chọn nhà hàng</option>
          {restaurants.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        {fieldError('restaurantId')}
      </div>
      <TranslatableField
        name="venueOverride"
        label="Tên địa điểm hiển thị"
        values={v.venueOverride}
        max={80}
        hint="Để trống: dùng tên nhà hàng."
        error={error('venueOverride')}
      />
      <div className="a-field">
        <label htmlFor={fid('price')}>Giá</label>
        <input id={fid('price')} name="priceAmount" inputMode="decimal" defaultValue={v.priceAmount ?? ''} aria-describedby={described('priceAmount', true)} />
        <p className="a-muted" id={`${fid('priceAmount')}-hint`}>
          Để trống nếu không ghi giá.
        </p>
        {fieldError('priceAmount')}
      </div>
      <div className="a-field">
        <label htmlFor={fid('basis')}>Cách tính giá</label>
        <select id={fid('basis')} name="priceBasis" defaultValue={v.priceBasis ?? ''} aria-describedby={described('priceBasis')}>
          <option value="">Không ghi giá</option>
          <option value="plus_plus">++ (chưa gồm phí phục vụ và thuế)</option>
          <option value="net">net (đã gồm)</option>
        </select>
        {fieldError('priceBasis')}
      </div>
      <div className="a-field">
        <label htmlFor={fid('currency')}>Tiền tệ</label>
        <input id={fid('currency')} name="currency" defaultValue={v.currency} maxLength={3} aria-describedby={described('currency')} />
        {fieldError('currency')}
      </div>
      <div className="a-field">
        <label htmlFor={fid('from')}>Hiện từ ngày</label>
        <input id={fid('from')} name="validFrom" type="date" defaultValue={v.validFrom ?? ''} aria-describedby={described('validFrom', true)} />
        <p className="a-muted" id={`${fid('validFrom')}-hint`}>
          Theo ngày ở Đà Nẵng. Để trống: không giới hạn.
        </p>
        {fieldError('validFrom')}
      </div>
      <div className="a-field">
        <label htmlFor={fid('until')}>Hiện đến hết ngày</label>
        <input id={fid('until')} name="validUntil" type="date" defaultValue={v.validUntil ?? ''} aria-describedby={described('validUntil', true)} />
        <p className="a-muted" id={`${fid('validUntil')}-hint`}>
          Hôm sau ngày này, ưu đãi tự ẩn lúc 00:05.
        </p>
        {fieldError('validUntil')}
      </div>
      <label className="a-check a-field--wide">
        <input type="checkbox" name="isPublished" defaultChecked={v.isPublished} />
        Hiện trên trang chủ (tối đa 6 ưu đãi được hiện)
      </label>
    </>
  );
}
