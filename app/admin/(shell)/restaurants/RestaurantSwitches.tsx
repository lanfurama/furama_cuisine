'use client';

import { useActionState } from 'react';
import type { ActionResult } from '@/lib/server/action-result';
import { FormMessage, RuleAlert, fieldMessages } from '../_ui/FormMessage';
import { archiveRestaurantAction, showRestaurantAction } from './actions';

/** A refused switch says why, inside its alert: the rule it broke has no field on this list (a card picture, a type, the page's own). */
function SwitchMessage({ state }: { state: ActionResult | null }) {
  const rules = fieldMessages(state);
  return rules.length ? <RuleAlert lead="Không đổi được:" rules={rules} /> : <FormMessage state={state} />;
}

/*
 * One restaurant's two switches on the list (spec §7.2): shown on the web or
 * hidden, archived or back. Each acts at once with the restaurant's token;
 * neither ever deletes it (F10).
 */
export function RestaurantSwitches({ id, name, token, shown, archived }: { id: string; name: string; token: string; shown: boolean; archived: boolean }) {
  const [showState, show, showing] = useActionState<ActionResult | null, FormData>(showRestaurantAction, null);
  const [archiveState, archive, archiving] = useActionState<ActionResult | null, FormData>(archiveRestaurantAction, null);
  return (
    <div className="a-actions">
      <form action={show} className="a-inline-form">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="value" value={shown ? '0' : '1'} />
        <button
          type="submit"
          className="a-btn a-btn--ghost a-btn--small"
          disabled={showing}
          aria-label={`${shown ? 'Ẩn' : 'Hiện'} “${name}”`}
          onClick={(e) => {
            // Asks first, like "Lưu trữ" (7A review A11): hiding takes the restaurant off the web too.
            if (shown && !window.confirm(`Ẩn “${name}”? Nhà hàng rời web (thẻ, trang, ưu đãi, đặt bàn online); đặt bàn đã có giữ nguyên. Hiện lại được bất cứ lúc nào.`)) {
              e.preventDefault();
            }
          }}
        >
          {shown ? 'Ẩn' : 'Hiện'}
        </button>
      </form>
      <form action={archive} className="a-inline-form">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="value" value={archived ? '0' : '1'} />
        <button
          type="submit"
          className="a-btn a-btn--ghost a-btn--small"
          disabled={archiving}
          aria-label={`${archived ? 'Bỏ lưu trữ' : 'Lưu trữ'} “${name}”`}
          onClick={(e) => {
            if (!archived && !window.confirm(`Lưu trữ “${name}”? Nhà hàng rời web (thẻ, trang, ưu đãi, đặt bàn online); đặt bàn đã có giữ nguyên. Bỏ lưu trữ được bất cứ lúc nào.`)) {
              e.preventDefault();
            }
          }}
        >
          {archived ? 'Bỏ lưu trữ' : 'Lưu trữ'}
        </button>
      </form>
      <SwitchMessage state={showState} />
      <SwitchMessage state={archiveState} />
    </div>
  );
}
