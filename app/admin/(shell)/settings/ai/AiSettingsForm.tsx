'use client';

import { useId, useState } from 'react';
import { MODEL_CATALOGUE, MODEL_REGIONS, type ModelId } from '@/lib/admin/ai-models';
import { AI_FEATURES, REASONING, type AiFeature, type AiSettings } from '@/lib/admin/ai-schemas';
import { submitKeepingValues } from '@/lib/admin/form';
import type { Saved } from '@/lib/admin/save-state';
import type { ActionResult } from '@/lib/server/action-result';
import { SaveBar } from '../../_kit/SaveBar';
import { useSaveState } from '../../_kit/useSaveState';
import { FieldError, invalidField } from '../../_ui/FormMessage';
import { saveAiSettingsAction } from './actions';

const FEATURE_LABELS: Record<AiFeature, string> = {
  translate: 'Dịch',
  assist: 'Trợ lý viết',
  seo: 'SEO',
  alt: 'Mô tả ảnh (alt)',
};
const REASONING_LABELS: Record<(typeof REASONING)[number], string> = { minimal: 'Tối thiểu', low: 'Thấp', medium: 'Vừa', high: 'Cao' };

/*
 * The AI configuration form (spec §9.2): the four features, the brand voice,
 * the limits and the budget, saved together with one conflict token. Plain
 * named fields (features.seo.model …) so it posts without JavaScript; the
 * action keys each refusal by that name. Code rule 9: the save state lives
 * here and the fields remount on the token useSaveState accepted.
 */
export function AiSettingsForm({ token, settings, lastSaved }: { token: string; settings: AiSettings; lastSaved?: { by: string | null; at: string } | null }) {
  const save = useSaveState<Saved, AiSettings>(saveAiSettingsAction, token, settings);
  return (
    <form method="post" className="a-grid-form" onSubmit={submitKeepingValues(save.dispatch)} onInput={save.markDirty} noValidate aria-label="Cấu hình AI">
      <Fields key={save.fieldsKey} token={save.token} settings={save.view} state={save.state} />
      <SaveBar state={save.state} pending={save.pending} dirty={save.dirty} stale={save.stale} onReload={save.reload} lastSaved={lastSaved} success="Đã lưu cấu hình AI." />
    </form>
  );
}

function Fields({ token, settings: s, state }: { token: string; settings: AiSettings; state: ActionResult<unknown> | null }) {
  const uid = useId();
  const box = (name: string) => ({ id: `${uid}-${name}`, name, 'aria-describedby': `${uid}-${name}-error`, 'aria-invalid': invalidField(state, name) });
  return (
    <>
      <input type="hidden" name="token" value={token} />
      <h2 className="a-field--wide">Tính năng</h2>
      {AI_FEATURES.map((f) => (
        <FeatureFields key={f} feature={f} cfg={s.features[f]} uid={uid} state={state} />
      ))}
      <h2 className="a-field--wide">Chung</h2>
      <div className="a-field a-field--wide">
        <label htmlFor={`${uid}-brandVoice`}>Giọng thương hiệu (dùng cho “theo giọng thương hiệu” và dịch)</label>
        <textarea {...box('brandVoice')} rows={4} defaultValue={s.brandVoice} />
        <FieldError state={state} name="brandVoice" id={`${uid}-brandVoice-error`} />
      </div>
      <div className="a-field">
        <label htmlFor={`${uid}-limits.perMinute`}>Giới hạn mỗi người mỗi phút</label>
        <input {...box('limits.perMinute')} id={`${uid}-limits.perMinute`} type="number" defaultValue={s.limits.perMinute} />
        <FieldError state={state} name="limits.perMinute" id={`${uid}-limits.perMinute-error`} />
      </div>
      <div className="a-field">
        <label htmlFor={`${uid}-limits.perDay`}>Giới hạn mỗi người mỗi ngày</label>
        <input {...box('limits.perDay')} id={`${uid}-limits.perDay`} type="number" defaultValue={s.limits.perDay} />
        <FieldError state={state} name="limits.perDay" id={`${uid}-limits.perDay-error`} />
      </div>
      <div className="a-field">
        <label htmlFor={`${uid}-budgetUsd`}>Ngân sách mỗi tháng (USD)</label>
        {/* type="text": a typed "abc" must reach the server and come back as the schema's own sentence. */}
        <input {...box('budgetUsd')} type="text" inputMode="decimal" defaultValue={String(s.budgetUsd)} />
        <FieldError state={state} name="budgetUsd" id={`${uid}-budgetUsd-error`} />
      </div>
    </>
  );
}

function FeatureFields({ feature: f, cfg, uid, state }: { feature: AiFeature; cfg: AiSettings['features'][AiFeature]; uid: string; state: ActionResult<unknown> | null }) {
  const [model, setModel] = useState<ModelId>(cfg.model);
  const regions = MODEL_REGIONS[model];
  const [region, setRegion] = useState(cfg.region);
  // A model that does not serve the chosen region moves it to the first one it does.
  const shownRegion = (regions as readonly string[]).includes(region) ? region : regions[0];
  const n = (name: string) => `features.${f}.${name}`;
  const box = (name: string) => ({ id: `${uid}-${n(name)}`, name: n(name), 'aria-describedby': `${uid}-${n(name)}-error`, 'aria-invalid': invalidField(state, n(name)) });
  const err = (name: string) => <FieldError state={state} name={n(name)} id={`${uid}-${n(name)}-error`} />;
  return (
    <fieldset className="a-field--wide a-grid-form">
      <legend>{FEATURE_LABELS[f]}</legend>
      <label className="a-check a-field--wide">
        <input type="checkbox" name={n('enabled')} defaultChecked={cfg.enabled} />
        {`Bật “${FEATURE_LABELS[f]}”`}
      </label>
      <div className="a-field">
        <label htmlFor={`${uid}-${n('model')}`}>Model</label>
        <select {...box('model')} value={model} onChange={(e) => setModel(e.target.value as ModelId)}>
          {MODEL_CATALOGUE.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        {err('model')}
      </div>
      <div className="a-field">
        <label htmlFor={`${uid}-${n('region')}`}>Region</label>
        <select {...box('region')} value={shownRegion} onChange={(e) => setRegion(e.target.value as typeof region)}>
          {regions.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        {err('region')}
      </div>
      <div className="a-field">
        <label htmlFor={`${uid}-${n('reasoning')}`}>Mức suy luận</label>
        <select {...box('reasoning')} defaultValue={cfg.reasoning}>
          {REASONING.map((r) => (
            <option key={r} value={r}>
              {REASONING_LABELS[r]}
            </option>
          ))}
        </select>
        {err('reasoning')}
      </div>
      <div className="a-field">
        <label htmlFor={`${uid}-${n('maxOutputTokens')}`}>Token đầu ra tối đa</label>
        <input {...box('maxOutputTokens')} type="number" defaultValue={cfg.maxOutputTokens} />
        {err('maxOutputTokens')}
      </div>
      <div className="a-field a-field--wide">
        <label htmlFor={`${uid}-${n('systemPrompt')}`}>System prompt (thêm vào chỉ dẫn có sẵn)</label>
        <textarea {...box('systemPrompt')} rows={3} defaultValue={cfg.systemPrompt} />
        {err('systemPrompt')}
      </div>
    </fieldset>
  );
}
