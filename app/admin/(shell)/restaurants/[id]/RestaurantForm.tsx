'use client';

import { useId, useState } from 'react';
import { LENGTHS, LIMITS, limitWarnings } from '@/lib/admin/content-rules';
import { submitKeepingValues } from '@/lib/admin/form';
import type { MediaOption } from '@/lib/admin/media-option';
import type { ActionResult } from '@/lib/server/action-result';
import type { RestaurantEditor } from '@/lib/server/content-admin/restaurants';
import { ImagePicker } from '../../_kit/ImagePicker';
import { SaveBar } from '../../_kit/SaveBar';
import { LimitNote, moved, SortableList } from '../../_kit/SortableList';
import { TextField } from '../../_kit/TextField';
import { TranslatableField } from '../../_kit/TranslatableField';
import { useSaveState } from '../../_kit/useSaveState';
import { saveRestaurantAction } from './actions';

type Values = RestaurantEditor['values'];
type Highlight = Values['highlights'][number] & { key: string };

type Props = {
  id: string;
  token: string;
  values: Values;
  destinations: { id: string; name: string }[];
  cuisines: { id: string; label: string }[];
  images: MediaOption[];
  pdfs: MediaOption[];
  upload: { prefix: string; configured: boolean };
  lastSaved: { by: string | null; at: string };
  viewHref: string;
};

/*
 * A restaurant's content (spec §7.2): the row, its EN texts, cuisines and
 * highlights, saved together as one version. Same holder/fields split as
 * every editor (code rule 9, useSaveState): the fields, the cuisine order
 * and the highlight list (client state, posted as JSON) remount on a new
 * token and survive a refused save.
 */
export function RestaurantForm(props: Props) {
  const save = useSaveState<null>(saveRestaurantAction, props.token);
  return (
    <form method="post" className="a-grid-form a-editor" onSubmit={submitKeepingValues(save.dispatch)} onInput={save.markDirty} noValidate aria-label="Nội dung nhà hàng">
      <Fields key={props.token} {...props} state={save.state} markDirty={save.markDirty} />
      <SaveBar state={save.state} pending={save.pending} dirty={save.dirty} lastSaved={props.lastSaved} viewHref={props.viewHref} label="Lưu nhà hàng" />
    </form>
  );
}

function Fields({ id, token, values: v, destinations, cuisines, images, pdfs, upload, state, markDirty }: Props & { state: ActionResult<unknown> | null; markDirty: () => void }) {
  const uid = useId();
  const error = (name: string) => (state && !state.ok ? state.fieldErrors?.[name]?.[0] : undefined);
  const errors = (name: string) => (state && !state.ok ? (state.fieldErrors?.[name] ?? []) : []);
  const [chosen, setChosen] = useState(v.cuisines);
  const [highlights, setHighlights] = useState<Highlight[]>(() => v.highlights.map((h) => ({ ...h, key: `h${h.id}` })));
  const [added, setAdded] = useState(0);
  const labelOf = new Map(cuisines.map((c) => [c.id, c.label]));
  const shown = highlights.filter((h) => h.isPublished).length;
  // Client-state edits do not fire the form's input event when they are clicks on buttons.
  const change = <T,>(set: (next: T) => void) => (next: T) => {
    set(next);
    markDirty();
  };
  const setH = change(setHighlights);
  const patch = (key: string, p: Partial<Highlight>) => setH(highlights.map((h) => (h.key === key ? { ...h, ...p } : h)));
  const posted = highlights.map(({ key: _key, ...h }) => h);

  return (
    <>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="token" value={token} />

      <h2 className="a-field--wide">Thông tin chung</h2>
      <TextField
        name="name"
        label="Tên nhà hàng"
        defaultValue={v.name}
        max={LENGTHS.restaurantName.max}
        warnAt={LENGTHS.restaurantName.warn}
        warnMessage="Tên dài có thể xuống dòng ở trang chi tiết."
        hint="Tên giữ nguyên ở mọi ngôn ngữ."
        required
        error={error('name')}
      />
      <TextField name="slug" label="Đường dẫn (slug)" defaultValue={v.slug} max={60} hint="Dùng trong địa chỉ trang: /en/restaurants/…" error={error('slug')} />
      <div className="a-field">
        <label htmlFor={`${uid}-dest`}>Điểm đến</label>
        <select id={`${uid}-dest`} name="destinationId" defaultValue={v.destinationId}>
          {destinations.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>
      <label className="a-check a-field--wide">
        <input type="checkbox" name="isPublished" defaultChecked={v.isPublished} />
        Hiện nhà hàng trên web (tắt thì ẩn thẻ, trang và ưu đãi của nhà hàng)
      </label>
      <label className="a-check a-field--wide">
        <input type="checkbox" name="hasDetailPage" defaultChecked={v.hasDetailPage} />
        Có trang chi tiết (cần ảnh chân dung và câu chuyện tiếng Anh)
      </label>
      <TranslatableField name="typeLabel" label="Loại nhà hàng" values={v.typeLabel} max={60} hint="Bắt buộc khi nhà hàng hiện trên web." error={error('typeLabel')} />

      <h2 className="a-field--wide">Ảnh</h2>
      <div className="a-field--wide">
        <ImagePicker name="cardImageId" label="Ảnh thẻ" options={images} value={v.cardImageId} upload={upload} hint="Bắt buộc khi nhà hàng hiện trên web." error={error('cardImageId')} />
      </div>
      <div className="a-field--wide">
        <ImagePicker name="detailImageId" label="Ảnh chân dung (trang chi tiết)" options={images} value={v.detailImageId} upload={upload} error={error('detailImageId')} />
      </div>
      <div className="a-field--wide">
        <ImagePicker name="ogImageId" label="Ảnh chia sẻ (SEO)" options={images} value={v.ogImageId} upload={upload} error={error('ogImageId')} />
      </div>

      <h2 className="a-field--wide">Liên hệ</h2>
      <TextField name="phoneDisplay" label="Số điện thoại" type="tel" defaultValue={v.phoneDisplay} max={30} hint="Để trống: dùng số của điểm đến." error={error('phoneDisplay')} />
      <TextField name="mapUrl" label="Link bản đồ" type="url" defaultValue={v.mapUrl} max={2000} hint="https://… Để trống: dùng bản đồ của điểm đến." error={error('mapUrl')} />

      <h2 className="a-field--wide">Trang chi tiết</h2>
      <TranslatableField name="detailKicker" label="Dòng trên tên" values={v.detailKicker} max={100} error={error('detailKicker')} />
      <TranslatableField name="storyLabel" label="Nhãn câu chuyện" values={v.storyLabel} max={40} hint="Để trống: “Brand Story”." error={error('storyLabel')} />
      <TranslatableField name="story" label="Câu chuyện" values={v.story} max={1500} rows={6} error={error('story')} />
      <TranslatableField name="highlightsTitle" label="Tiêu đề phần nổi bật" values={v.highlightsTitle} max={60} hint="Để trống: “At {tên nhà hàng}”." error={error('highlightsTitle')} />
      <div className="a-field--wide">
        <ImagePicker
          name="menuPdfMediaId.en"
          label="Thực đơn PDF (tải lên)"
          kind="pdf"
          options={pdfs}
          value={v.menuPdfMediaId.en ?? null}
          upload={upload}
          hint="Một file PDF hoặc một link, không cả hai. Không có cả hai: nút MENU cuộn tới phần nổi bật."
          error={error('menuPdfMediaId')}
        />
      </div>
      <TranslatableField name="menuPdfUrl" label="Link thực đơn PDF" values={v.menuPdfUrl} max={2000} hint="https://…" error={error('menuPdfUrl')} />

      <h2 className="a-field--wide">SEO</h2>
      <TranslatableField name="seoTitle" label="Tiêu đề SEO" values={v.seoTitle} max={120} error={error('seoTitle')} />
      <TranslatableField name="seoDescription" label="Mô tả SEO" values={v.seoDescription} max={320} rows={3} error={error('seoDescription')} />

      <h2 className="a-field--wide">Ẩm thực</h2>
      <div className="a-field--wide">
        <input type="hidden" name="cuisines" value={JSON.stringify(chosen)} />
        <SortableList
          label="Ẩm thực của nhà hàng"
          items={chosen}
          itemKey={(c) => c}
          itemLabel={(c) => labelOf.get(c) ?? c}
          onMove={(from, to) => change(setChosen)(moved(chosen, from, to))}
          renderItem={(c) => (
            <div className="a-offer-row">
              <span>{labelOf.get(c) ?? c}</span>
              <button type="button" className="a-btn a-btn--ghost a-btn--small" aria-label={`Bỏ ẩm thực “${labelOf.get(c) ?? c}”`} onClick={() => change(setChosen)(chosen.filter((x) => x !== c))}>
                Bỏ
              </button>
            </div>
          )}
        />
        <label htmlFor={`${uid}-add-cuisine`}>Thêm ẩm thực</label>
        <select
          id={`${uid}-add-cuisine`}
          value=""
          onChange={(e) => {
            const next = e.currentTarget.value;
            if (next) change(setChosen)([...chosen, next]);
          }}
        >
          <option value="">Chọn…</option>
          {cuisines
            .filter((c) => !chosen.includes(c.id))
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
        </select>
        {errors('cuisines').map((m) => (
          <p key={m} className="a-field-error">
            {m}
          </p>
        ))}
      </div>

      <h2 className="a-field--wide">Điểm nổi bật</h2>
      <div className="a-field--wide">
        <input type="hidden" name="highlights" value={JSON.stringify(posted)} />
        <LimitNote shown={shown} max={LIMITS.highlights.max} warnings={v.hasDetailPage ? limitWarnings('highlights', shown) : []} />
        <SortableList
          label="Điểm nổi bật"
          items={highlights}
          itemKey={(h) => h.key}
          itemLabel={(h) => h.title.en || 'Điểm nổi bật mới'}
          onMove={(from, to) => setH(moved(highlights, from, to))}
          renderItem={(h) => (
            <div className="a-highlight">
              <ImagePicker label="Ảnh" options={images} value={h.imageId || null} required upload={upload} onChange={(imageId) => patch(h.key, { imageId: imageId ?? '' })} />
              <TranslatableField label="Tiêu đề" values={h.title} max={80} required onChange={(locale, value) => patch(h.key, { title: { ...h.title, [locale]: value } })} />
              <TranslatableField label="Mô tả" values={h.detail} max={200} onChange={(locale, value) => patch(h.key, { detail: { ...h.detail, [locale]: value } })} />
              <div className="a-actions">
                <label className="a-check">
                  <input
                    type="checkbox"
                    checked={h.isPublished}
                    aria-label={`Hiện “${h.title.en || 'điểm nổi bật mới'}”`}
                    onChange={(e) => patch(h.key, { isPublished: e.currentTarget.checked })}
                  />
                  Hiện
                </label>
                <button
                  type="button"
                  className="a-btn a-btn--danger a-btn--small"
                  aria-label={`Xóa “${h.title.en || 'điểm nổi bật mới'}”`}
                  onClick={() => setH(highlights.filter((x) => x.key !== h.key))}
                >
                  Xóa điểm nổi bật
                </button>
              </div>
            </div>
          )}
        />
        <button
          type="button"
          className="a-btn a-btn--ghost"
          disabled={highlights.length >= 10}
          onClick={() => {
            setAdded(added + 1);
            setH([...highlights, { key: `new${added}`, id: null, imageId: '', isPublished: shown < LIMITS.highlights.max, title: { en: '' }, detail: { en: '' } }]);
          }}
        >
          Thêm điểm nổi bật
        </button>
        {errors('highlights').map((m) => (
          <p key={m} className="a-field-error">
            {m}
          </p>
        ))}
      </div>
    </>
  );
}
