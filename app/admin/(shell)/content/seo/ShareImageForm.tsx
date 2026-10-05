'use client';

import { submitKeepingValues } from '@/lib/admin/form';
import type { MediaOption } from '@/lib/admin/media-option';
import type { Saved } from '@/lib/admin/save-state';
import { ImagePicker } from '../../_kit/ImagePicker';
import { SaveBar } from '../../_kit/SaveBar';
import { useSaveState } from '../../_kit/useSaveState';
import { saveShareImageAction } from './actions';

/*
 * The picture a shared link shows (spec §5.2 site_settings.og_image_id): the
 * home page's, and that of every page without its own (a restaurant page's
 * own is on its screen; L7-13). Code rule 9: the save state lives here and
 * the picker remounts on the token useSaveState accepted.
 */
export function ShareImageForm({
  token,
  imageId,
  images,
  upload,
  lastSaved,
}: {
  token: string;
  imageId: string | null;
  images: readonly MediaOption[];
  upload: { prefix: string; configured: boolean };
  lastSaved: { by: string | null; at: string } | null;
}) {
  const save = useSaveState<Saved, string | null>(saveShareImageAction, token, imageId);
  const error = save.state && !save.state.ok ? save.state.fieldErrors?.ogImageId?.[0] : undefined;
  return (
    <form method="post" className="a-grid-form" onSubmit={submitKeepingValues(save.dispatch)} onInput={save.markDirty} noValidate aria-label="Ảnh chia sẻ">
      <div className="a-field a-field--wide" key={save.fieldsKey}>
        <input type="hidden" name="token" value={save.token} />
        <ImagePicker
          name="ogImageId"
          label="Ảnh khi chia sẻ link"
          options={images}
          value={save.view}
          upload={upload}
          error={error}
          hint="Facebook, Zalo và các ứng dụng nhắn tin hiện ảnh này khi khách chia sẻ link trang chủ, trang chính sách, hay trang nhà hàng chưa có ảnh riêng. Nên dùng ảnh ngang, khoảng 1200 × 630 px."
        />
      </div>
      <SaveBar state={save.state} pending={save.pending} dirty={save.dirty} stale={save.stale} onReload={save.reload} lastSaved={lastSaved} viewHref="/en" />
    </form>
  );
}
