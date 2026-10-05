'use client';

import { useActionState, useState } from 'react';
import { LIMITS } from '@/lib/admin/content-rules';
import type { MediaOption } from '@/lib/admin/media-option';
import type { ActionResult } from '@/lib/server/action-result';
import type { SlideListItem } from '@/lib/server/content-admin/hero';
import { FormMessage, RuleAlert, fieldMessages } from '../../_ui/FormMessage';
import { LimitNote, moved, SortableList } from '../../_kit/SortableList';
import { Thumb } from '../../_kit/Thumb';
import { deleteSlideAction, reorderSlidesAction, toggleSlideAction } from './actions';
import { SlideForm } from './SlideForm';

type Shared = { images: readonly MediaOption[]; upload: { prefix: string; configured: boolean } };

/** A list write's outcome, with the rules it broke inside the alert when it was refused (the first slide's phone crop has no field here). */
function ListMessage({ state, success }: { state: ActionResult | null; success?: string }) {
  const rules = fieldMessages(state);
  return rules.length ? <RuleAlert lead="Không lưu được thay đổi này:" rules={rules} /> : <FormMessage state={state} success={success} />;
}

/*
 * The hero's slides in their guest order (spec §7.3 SortableList, §6.5 1–5).
 * Moving is local until "Lưu thứ tự" (one 'reorder' with the whole old order
 * in its audit row); show/hide and delete act at once with the slide's token;
 * "Sửa ảnh" opens the slide's own form. Code rule 9: the reorder's state
 * lives here and the order below remounts on a new list token.
 */
export function SlideList({ items, listToken, warnings, ...shared }: { items: SlideListItem[]; listToken: string; warnings: string[] } & Shared) {
  const [state, dispatch, pending] = useActionState<ActionResult | null, FormData>(reorderSlidesAction, null);
  return (
    <>
      <LimitNote shown={items.filter((i) => i.isPublished).length} max={LIMITS.heroSlides.max} warnings={warnings} />
      <SlideOrder key={listToken} items={items} listToken={listToken} state={state} dispatch={dispatch} pending={pending} {...shared} />
    </>
  );
}

function SlideOrder({
  items,
  listToken,
  state,
  dispatch,
  pending,
  ...shared
}: {
  items: SlideListItem[];
  listToken: string;
  state: ActionResult | null;
  dispatch: (formData: FormData) => void;
  pending: boolean;
} & Shared) {
  const [order, setOrder] = useState(() => items.map((i) => i.id));
  const byId = new Map(items.map((i) => [i.id, i]));
  const ordered = order.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  const changed = order.join(',') !== items.map((i) => i.id).join(',');
  return (
    <>
      {ordered.length === 0 ? (
        <p className="a-muted">Chưa có slide nào: trang chủ không có hero.</p>
      ) : (
        <SortableList
          label="Thứ tự slide"
          items={ordered}
          itemKey={(s) => s.id}
          itemLabel={(s) => s.name}
          onMove={(from, to) => setOrder(moved(order, from, to))}
          renderItem={(s) => <SlideRow slide={s} {...shared} />}
        />
      )}
      <form action={dispatch} className="a-inline-form" aria-label="Thứ tự slide">
        <input type="hidden" name="token" value={listToken} />
        <input type="hidden" name="order" value={JSON.stringify(order)} />
        <button type="submit" className="a-btn" disabled={!changed || pending}>
          {pending ? 'Đang lưu…' : 'Lưu thứ tự'}
        </button>
        {changed ? <span className="a-muted">Thứ tự mới chưa được lưu.</span> : null}
        <ListMessage state={state} success="Đã lưu thứ tự." />
      </form>
    </>
  );
}

function SlideRow({ slide: s, images, upload }: { slide: SlideListItem } & Shared) {
  const [toggleState, toggle, toggling] = useActionState<ActionResult | null, FormData>(toggleSlideAction, null);
  const [deleteState, remove, removing] = useActionState<ActionResult | null, FormData>(deleteSlideAction, null);
  const image = images.find((i) => i.id === s.imageId);
  return (
    <div>
      <div className="a-slide-row">
        {image ? <Thumb file={image} width={96} className="a-picker-thumb" /> : <span className="a-muted">—</span>}
        <div>
          <p>{s.name}</p>
          <p className="a-muted">
            <span className={s.isPublished ? 'a-tag' : 'a-tag a-tag--warn'}>{s.isPublished ? 'Đang hiện' : 'Đang ẩn'}</span>
            {s.imageMobileId ? ' · có ảnh cho điện thoại' : ''}
          </p>
        </div>
        <div className="a-actions">
          <form action={toggle} className="a-inline-form">
            <input type="hidden" name="id" value={s.id} />
            <input type="hidden" name="token" value={s.token} />
            <input type="hidden" name="publish" value={s.isPublished ? '0' : '1'} />
            <button type="submit" className="a-btn a-btn--ghost a-btn--small" disabled={toggling} aria-label={`${s.isPublished ? 'Ẩn' : 'Hiện'} “${s.name}”`}>
              {s.isPublished ? 'Ẩn' : 'Hiện'}
            </button>
          </form>
          <form action={remove} className="a-inline-form">
            <input type="hidden" name="id" value={s.id} />
            <input type="hidden" name="token" value={s.token} />
            <button
              type="submit"
              className="a-btn a-btn--danger a-btn--small"
              disabled={removing}
              aria-label={`Xóa “${s.name}”`}
              onClick={(e) => {
                if (!window.confirm(`Xóa slide “${s.name}”? Ảnh vẫn ở thư viện; slide khôi phục được từ "Đã xóa gần đây".`)) e.preventDefault();
              }}
            >
              Xóa
            </button>
          </form>
        </div>
      </div>
      <ListMessage state={toggleState} />
      <ListMessage state={deleteState} />
      <details>
        <summary>Sửa ảnh của “{s.name}”</summary>
        <SlideForm
          slide={{ id: s.id, imageId: s.imageId, imageMobileId: s.imageMobileId, isPublished: s.isPublished }}
          token={s.token}
          images={images}
          upload={upload}
          label={`Slide “${s.name}”`}
        />
      </details>
    </div>
  );
}
