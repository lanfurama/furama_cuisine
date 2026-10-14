'use client';

import { useActionState, useId } from 'react';
import { FEATURE_LABELS } from '@/lib/admin/ai-schemas';
import { actionErrorMessage } from '@/lib/admin/auth-errors';
import { submitKeepingValues } from '@/lib/admin/form';
import type { ActionResult } from '@/lib/server/action-result';
import type { CheckRow, CheckStepName } from '@/lib/server/ai/check';
import { FormMessage } from '../../_ui/FormMessage';
import { checkConnectionAction } from './actions';

const STEP_LABELS: Record<CheckStepName, string> = {
  env: 'Biến môi trường',
  token: 'Lấy token',
  text: 'Văn bản',
  structured: 'Dữ liệu có cấu trúc',
  image: 'Mô tả ảnh',
};

/*
 * "Kiểm tra kết nối": one section per (model, region) pair, a line per step
 * with ✓ or ✗ (the word is there too, for a screen reader), the latency, the
 * tokens, and the Vietnamese sentence of the error code.
 */
export function ConnectionCheck() {
  const [state, action, pending] = useActionState<ActionResult<{ rows: CheckRow[] }> | null, FormData>(checkConnectionAction, null);
  const uid = useId();
  return (
    <>
      <form method="post" className="a-actions" onSubmit={submitKeepingValues(action)} aria-label="Kiểm tra kết nối">
        <label className="a-check" htmlFor={`${uid}-image`}>
          <input id={`${uid}-image`} type="checkbox" name="withImage" />
          Thử cả mô tả ảnh
        </label>
        <button className="a-btn" type="submit" disabled={pending}>
          {pending ? 'Đang kiểm tra…' : 'Kiểm tra kết nối'}
        </button>
      </form>
      <FormMessage state={state && !state.ok ? state : null} />
      {state?.ok && state.data.rows.length === 0 ? <p className="a-muted">Mọi tính năng đang tắt, không có gì để kiểm tra.</p> : null}
      {state?.ok
        ? state.data.rows.map((row) => (
            <section className="a-card-row" key={`${row.model}|${row.region}`} aria-label={`${row.model} · ${row.region}`}>
              <h3>{`${row.model} · ${row.region}`}</h3>
              <p className="a-muted">{`Dùng cho: ${row.features.map((f) => FEATURE_LABELS[f]).join(', ')}`}</p>
              {row.timedOut ? <p className="a-warn">Hết 20 giây trước khi kiểm xong cặp này. Bấm kiểm tra lại.</p> : null}
              <ul className="a-list" aria-label="Các bước">
                {row.steps.map((s) => (
                  <li className="a-list-item" key={s.step} data-ok={s.ok}>
                    <span aria-hidden="true">{s.ok ? '✓' : '✗'}</span>
                    <span className="a-visually-hidden">{s.ok ? 'Đạt: ' : 'Lỗi: '}</span>
                    {` ${STEP_LABELS[s.step]} · ${s.ms} ms`}
                    {s.tokens !== undefined ? ` · ${s.tokens} token` : ''}
                    {s.code ? ` · ${actionErrorMessage(s.code)}` : ''}
                  </li>
                ))}
              </ul>
            </section>
          ))
        : null}
    </>
  );
}
