'use client';

import { useActionState, useId, useState } from 'react';
import { submitKeepingValues } from '@/lib/admin/form';
import { newPeriod, periodNames, type PeriodDraft } from '@/lib/admin/periods';
import { SLOT_INTERVALS } from '@/lib/booking/rules';
import type { Meal } from '@/lib/data';
import type { ActionResult } from '@/lib/server/action-result';
import { useLeaveGuard } from '../../../_kit/useLeaveGuard';
import { FieldError, FormMessage } from '../../../_ui/FormMessage';
import { savePeriods } from './actions';

export type PeriodRow = PeriodDraft;

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
 *
 * A refused save shows each message in its row, beside its field, which is
 * marked aria-invalid (the action names them periods.<row>.<field>); a
 * message about the whole list (two periods sharing a time) shows above it.
 * Each field's name carries its row ("Giờ cuối của ca Dinner", "… ca Dinner 2"
 * when two rows share a meal), and the weekday boxes sit in a group named for
 * their row (phase-4 ledger T11). The covers field may be cleared while
 * typing: it stays empty, never 0, and the save says what is missing. While
 * the list differs from the one saved, leaving the page (the "Xem" of the
 * slot preview below is a full page load) asks first (ADM-3).
 */
export function PeriodsEditor({ restaurantId, token, meals, periods }: { restaurantId: string; token: string; meals: Meal[]; periods: PeriodRow[] }) {
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
  useLeaveGuard(JSON.stringify(rows) !== stored);
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(savePeriods, null);
  const uid = useId();
  const update = (i: number, patch: Partial<PeriodRow>) => setRows((list) => list.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  const names = periodNames(rows);
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  /** The row's field message, its id, and aria-invalid: one place, so the three agree. */
  const field = (i: number, name: keyof PeriodRow) => {
    const message = errors[`periods.${i}.${name}`]?.[0];
    const id = `${uid}-${i}-${name}-error`;
    return {
      describedBy: message ? id : undefined,
      invalid: message ? true : undefined,
      error: message ? (
        <p className="a-field-error" id={id}>
          {message}
        </p>
      ) : null,
    };
  };

  return (
    // Not action={action}: React resets a form once its action settles, and a reset puts each controlled
    // select and checkbox back to its server-rendered (or first) option while `rows`, and so the posted
    // JSON, keep the edited values. method="post": a submit before hydration must not GET the list into the URL.
    <form method="post" onSubmit={submitKeepingValues(action)} aria-label="Ca phục vụ">
      <input type="hidden" name="restaurant" value={restaurantId} />
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="periods" value={JSON.stringify(rows)} />
      <FormMessage state={state} success="Đã lưu ca phục vụ." />
      <FieldError state={state} name="periods" id={`${uid}-periods-error`} />
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
          {rows.map((row, i) => {
            const meal = field(i, 'meal');
            const days = field(i, 'weekdays');
            const first = field(i, 'firstSeating');
            const last = field(i, 'lastSeating');
            const interval = field(i, 'intervalMin');
            const covers = field(i, 'coversPerSlot');
            return (
              <tr key={row.id ?? `new-${i}`}>
                <td>
                  <select
                    aria-label={`Bữa của ca ${i + 1}`}
                    value={row.meal}
                    onChange={(e) => update(i, { meal: e.currentTarget.value })}
                    aria-describedby={meal.describedBy}
                    aria-invalid={meal.invalid}
                  >
                    {meals.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                  {meal.error}
                </td>
                <td>
                  <div role="group" aria-label={`Ngày trong tuần của ca ${names[i]}`} aria-describedby={days.describedBy}>
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
                  </div>
                  {days.error}
                </td>
                <td>
                  <input
                    aria-label={`Giờ đầu của ca ${names[i]}`}
                    type="time"
                    step={300}
                    value={row.firstSeating}
                    onChange={(e) => update(i, { firstSeating: e.currentTarget.value })}
                    aria-describedby={first.describedBy}
                    aria-invalid={first.invalid}
                  />
                  {first.error}
                </td>
                <td>
                  <input
                    aria-label={`Giờ cuối của ca ${names[i]}`}
                    type="time"
                    step={300}
                    value={row.lastSeating}
                    onChange={(e) => update(i, { lastSeating: e.currentTarget.value })}
                    aria-describedby={last.describedBy}
                    aria-invalid={last.invalid}
                  />
                  {last.error}
                </td>
                <td>
                  <select
                    aria-label={`Khoảng cách của ca ${names[i]}`}
                    value={row.intervalMin}
                    onChange={(e) => update(i, { intervalMin: Number(e.currentTarget.value) })}
                    aria-describedby={interval.describedBy}
                    aria-invalid={interval.invalid}
                  >
                    {SLOT_INTERVALS.map((n) => (
                      <option key={n} value={n}>{`${n} phút`}</option>
                    ))}
                  </select>
                  {interval.error}
                </td>
                <td>
                  <input
                    aria-label={`Sức chứa của ca ${names[i]}`}
                    type="number"
                    min={0}
                    max={1000}
                    value={row.coversPerSlot}
                    // Cleared stays cleared: '' until a number is typed (valueAsNumber is NaN for an empty field).
                    onChange={(e) => update(i, { coversPerSlot: e.currentTarget.value === '' ? '' : e.currentTarget.valueAsNumber })}
                    aria-describedby={covers.describedBy}
                    aria-invalid={covers.invalid}
                  />
                  {covers.error}
                </td>
                <td>
                  <input aria-label={`Bật ca ${names[i]}`} type="checkbox" checked={row.active} onChange={(e) => update(i, { active: e.currentTarget.checked })} />
                </td>
                <td>
                  <button
                    className="a-btn a-btn--ghost a-btn--small"
                    type="button"
                    aria-label={`Xóa ca ${names[i]}`}
                    onClick={() => setRows((list) => list.filter((_, j) => j !== i))}
                  >
                    Xóa
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="a-actions">
        <button className="a-btn a-btn--ghost" type="button" onClick={() => setRows((list) => [...list, newPeriod(list, meals)])}>
          Thêm ca
        </button>
        <button className="a-btn" type="submit" disabled={pending}>
          {pending ? 'Đang lưu…' : 'Lưu ca phục vụ'}
        </button>
      </div>
    </form>
  );
}
