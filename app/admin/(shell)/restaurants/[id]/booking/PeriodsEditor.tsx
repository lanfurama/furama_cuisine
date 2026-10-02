'use client';

import { useActionState, useState } from 'react';
import { submitKeepingValues } from '@/lib/admin/form';
import { SLOT_INTERVALS } from '@/lib/booking/rules';
import type { ActionResult } from '@/lib/server/action-result';
import { FieldError, FormMessage } from '../../../_ui/FormMessage';
import { savePeriods } from './actions';

export type PeriodRow = {
  id: string | null;
  meal: string;
  weekdays: number[];
  firstSeating: string;
  lastSeating: string;
  intervalMin: number;
  coversPerSlot: number;
  active: boolean;
};

const WEEKDAYS: [number, string][] = [
  [1, 'T2'],
  [2, 'T3'],
  [3, 'T4'],
  [4, 'T5'],
  [5, 'T6'],
  [6, 'T7'],
  [7, 'CN'],
];

/*
 * The list is client state; the form posts it as one JSON field, which the
 * action parses with zod (PeriodsForm). A save replaces the restaurant's
 * periods in one transaction, guarded by the page's token.
 */
export function PeriodsEditor({ restaurantId, token, meals, periods }: { restaurantId: string; token: string; meals: string[]; periods: PeriodRow[] }) {
  const [rows, setRows] = useState<PeriodRow[]>(periods);
  // Resync on this editor's own data, not on the token: every save on the page (the rules form's too)
  // moves the shared token (R16), and resetting on it threw away unsaved edits here whenever the rules
  // were saved. When the stored periods do change (a save here, new ids included, or someone else's),
  // take them during render, not in an effect, and keep the action's "Đã lưu" state (a key would
  // remount and lose it). The hidden token input still reads the current token.
  const stored = JSON.stringify(periods);
  const [shownPeriods, setShownPeriods] = useState(stored);
  if (stored !== shownPeriods) {
    setShownPeriods(stored);
    setRows(periods);
  }
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(savePeriods, null);
  const update = (i: number, patch: Partial<PeriodRow>) => setRows((list) => list.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  // zod reports a period's field as periods.<i>.<field>; show those beside the list.
  const rowErrors = Object.entries(state && !state.ok ? (state.fieldErrors ?? {}) : {}).filter(([key]) => key !== 'periods');

  return (
    // Not action={action}: React resets a form once its action settles, and a reset puts each controlled
    // select and checkbox back to its server-rendered (or first) option while `rows`, and so the posted
    // JSON, keep the edited values. method="post": a submit before hydration must not GET the list into the URL.
    <form method="post" onSubmit={submitKeepingValues(action)} aria-label="Ca phục vụ">
      <input type="hidden" name="restaurant" value={restaurantId} />
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="periods" value={JSON.stringify(rows)} />
      <FormMessage state={state} success="Đã lưu ca phục vụ." />
      <FieldError state={state} name="periods" id="booking-periods-error" />
      {rowErrors.length ? (
        <p className="a-field-error" role="alert">
          {rowErrors.map(([, m]) => m?.[0]).join(' ')}
        </p>
      ) : null}
      <table className="a-table a-table--compact a-periods">
        <thead>
          <tr>
            <th scope="col">Bữa</th>
            <th scope="col">Ngày trong tuần</th>
            <th scope="col">Giờ đầu</th>
            <th scope="col">Giờ cuối</th>
            <th scope="col">Cách nhau</th>
            <th scope="col">Khách mỗi khung giờ</th>
            <th scope="col">Bật</th>
            <th scope="col">Thao tác</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.id ?? `new-${i}`}>
              <td>
                <select aria-label={`Bữa của ca ${i + 1}`} value={row.meal} onChange={(e) => update(i, { meal: e.currentTarget.value })}>
                  {meals.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                {WEEKDAYS.map(([d, label]) => (
                  <label className="a-check a-check--day" key={d}>
                    <input
                      type="checkbox"
                      checked={row.weekdays.includes(d)}
                      onChange={(e) =>
                        update(i, { weekdays: e.currentTarget.checked ? [...row.weekdays, d].sort((a, b) => a - b) : row.weekdays.filter((x) => x !== d) })
                      }
                    />
                    {label}
                  </label>
                ))}
              </td>
              <td>
                <input
                  aria-label={`Giờ đầu của ca ${row.meal}`}
                  type="time"
                  step={300}
                  value={row.firstSeating}
                  onChange={(e) => update(i, { firstSeating: e.currentTarget.value })}
                />
              </td>
              <td>
                <input
                  aria-label={`Giờ cuối của ca ${row.meal}`}
                  type="time"
                  step={300}
                  value={row.lastSeating}
                  onChange={(e) => update(i, { lastSeating: e.currentTarget.value })}
                />
              </td>
              <td>
                <select aria-label={`Khoảng cách của ca ${row.meal}`} value={row.intervalMin} onChange={(e) => update(i, { intervalMin: Number(e.currentTarget.value) })}>
                  {SLOT_INTERVALS.map((n) => (
                    <option key={n} value={n}>{`${n} phút`}</option>
                  ))}
                </select>
              </td>
              <td>
                <input
                  aria-label={`Sức chứa của ca ${row.meal}`}
                  type="number"
                  min={0}
                  max={1000}
                  value={row.coversPerSlot}
                  onChange={(e) => update(i, { coversPerSlot: e.currentTarget.valueAsNumber || 0 })}
                />
              </td>
              <td>
                <input aria-label={`Bật ca ${row.meal}`} type="checkbox" checked={row.active} onChange={(e) => update(i, { active: e.currentTarget.checked })} />
              </td>
              <td>
                <button className="a-btn a-btn--ghost a-btn--small" type="button" onClick={() => setRows((list) => list.filter((_, j) => j !== i))}>
                  Xóa
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="a-actions">
        <button
          className="a-btn a-btn--ghost"
          type="button"
          onClick={() =>
            setRows((list) => [
              ...list,
              { id: null, meal: meals[0], weekdays: [1, 2, 3, 4, 5, 6, 7], firstSeating: '18:00', lastSeating: '21:00', intervalMin: 30, coversPerSlot: 20, active: true },
            ])
          }
        >
          Thêm ca
        </button>
        <button className="a-btn" type="submit" disabled={pending}>
          {pending ? 'Đang lưu…' : 'Lưu ca phục vụ'}
        </button>
      </div>
    </form>
  );
}
