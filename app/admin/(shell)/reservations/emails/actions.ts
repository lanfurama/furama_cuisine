'use server';

import { getPool } from '@/db/client';
import { RequeueForm } from '@/lib/admin/notification-schemas';
import { actionError, type ActionResult } from '@/lib/server/action-result';
import { auditActor, requirePermission } from '@/lib/server/dal/session';
import { drainAfterCommit } from '@/lib/server/email/after-commit';
import { outboxEnv } from '@/lib/server/email/env';
import { requeueEmail } from '@/lib/server/email/outbox-log';

/*
 * "Gửi lại" (spec §7.2 /admin/reservations/emails, §10.4 "Kích hoạt bộ gửi"):
 * Editor and Admin, reservations:update, like every other booking action. The
 * row is requeued in one transaction with its audit_log row (R2); the send
 * itself runs after the response (drainAfterCommit: after() is allowed in
 * Server Functions,
 * node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md:8),
 * this row first (R20). A send cut short with the function is retried by the
 * cron once its lease ends.
 */
export async function resendEmail(_prev: ActionResult<{ id: string }> | null, formData: FormData): Promise<ActionResult<{ id: string }>> {
  try {
    const staff = await requirePermission({ reservations: ['update'] });
    const { id } = RequeueForm.parse({ id: formData.get('id') });
    const result = await requeueEmail(getPool(), auditActor(staff), { id, env: outboxEnv() });
    if (!result.ok) return result.code === 'not_allowed' ? { ok: false, code: 'not_resendable' } : result;
    drainAfterCommit([id]);
    // No refresh(): the row keeps its notice ("on its way"); a redraw now would still show it queued,
    // and on the "Lỗi" tab would drop the row, notice and all, before the send has even run.
    return { ok: true, data: { id } };
  } catch (err) {
    return actionError(err);
  }
}
