'use client';

import { useId } from 'react';
import { HERO_AUTOPLAY_MS } from '@/lib/admin/content-rules';
import { submitKeepingValues } from '@/lib/admin/form';
import { FieldError } from '../../_ui/FormMessage';
import { SaveBar } from '../../_kit/SaveBar';
import { useSaveState } from '../../_kit/useSaveState';
import { saveAutoplayAction } from './actions';

/* How long each slide shows before the next on desktop (site_settings.hero_autoplay_ms), in seconds. */
export function AutoplayForm({ ms, token, lastSaved }: { ms: number; token: string; lastSaved: { by: string | null; at: string } | null }) {
  const save = useSaveState<null, number>(saveAutoplayAction, token, ms);
  const uid = useId();
  return (
    <form method="post" className="a-grid-form" onSubmit={submitKeepingValues(save.dispatch)} onInput={save.markDirty} noValidate aria-label="Tốc độ slide">
      <div className="a-field" key={save.token}>
        <input type="hidden" name="token" value={save.token} />
        <label htmlFor={`${uid}-seconds`}>Thời gian mỗi slide (giây)</label>
        <input
          id={`${uid}-seconds`}
          name="seconds"
          type="number"
          inputMode="numeric"
          min={HERO_AUTOPLAY_MS.min / 1000}
          max={HERO_AUTOPLAY_MS.max / 1000}
          step={1}
          defaultValue={Math.round(save.view / 1000)}
          aria-describedby={`${uid}-hint ${uid}-error`}
        />
        <p className="a-muted" id={`${uid}-hint`}>
          Từ {HERO_AUTOPLAY_MS.min / 1000} đến {HERO_AUTOPLAY_MS.max / 1000} giây. Slide chỉ tự chuyển trên máy tính, và dừng khi khách bật giảm chuyển động.
        </p>
        <FieldError state={save.state} name="seconds" id={`${uid}-error`} />
      </div>
      <SaveBar state={save.state} pending={save.pending} dirty={save.dirty} stale={save.stale} onReload={save.reload} lastSaved={lastSaved} viewHref="/en" />
    </form>
  );
}
