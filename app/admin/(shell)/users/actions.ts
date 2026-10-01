'use server';

import { refresh } from 'next/cache';
import { getPool } from '@/db/client';
import { z } from '@/lib/admin/zod';
import { actionError, type ActionResult } from '@/lib/server/action-result';
import { staffDeps } from '@/lib/server/auth/auth';
import { STAFF_ROLES } from '@/lib/server/auth/permissions';
import * as staff from '@/lib/server/auth/staff';
import { auditActor, requirePermission } from '@/lib/server/dal/session';

/*
 * The staff screen's actions, each in the order of spec §7.4:
 * requirePermission → zod → one transaction with its audit row (inside
 * lib/server/auth/staff.ts) → refresh() → an ActionResult. Staff writes touch
 * no cached tag, so refresh() re-renders the page instead of updateTag.
 * Every permission here is one the Editor lacks (test/guards checks it).
 */

const InvitationId = z.string().regex(/^\d{1,18}$/);
const UserId = z.string().min(1).max(64);

const InviteInput = z.object({
  email: z.email({ error: 'Nhập email công việc, ví dụ ten@furamavietnam.com.' }).max(254),
  role: z.enum(STAFF_ROLES, { error: 'Chọn vai trò.' }),
});

export async function inviteStaff(
  _prev: ActionResult<{ emailSent: boolean }> | null,
  formData: FormData,
): Promise<ActionResult<{ emailSent: boolean }>> {
  try {
    const actor = await requirePermission({ user: ['create'] });
    const input = InviteInput.parse({ email: formData.get('email'), role: formData.get('role') });
    const result = await staff.createInvitation(staffDeps(), auditActor(actor), input);
    if (!result.ok) return result;
    refresh();
    return { ok: true, data: { emailSent: result.emailSent } };
  } catch (err) {
    return actionError(err);
  }
}

export async function resendInvite(id: string): Promise<ActionResult<{ emailSent: boolean }>> {
  try {
    const actor = await requirePermission({ user: ['create'] });
    const result = await staff.resendInvitation(staffDeps(), auditActor(actor), InvitationId.parse(id));
    if (!result.ok) return result;
    refresh();
    return { ok: true, data: { emailSent: result.emailSent } };
  } catch (err) {
    return actionError(err);
  }
}

export async function revokeInvite(id: string): Promise<ActionResult> {
  try {
    const actor = await requirePermission({ user: ['create'] });
    const result = await staff.revokeInvitation(staffDeps(), auditActor(actor), InvitationId.parse(id));
    if (!result.ok) return result;
    refresh();
    return { ok: true, data: null };
  } catch (err) {
    return actionError(err);
  }
}

export async function changeStaffRole(userId: string, role: string): Promise<ActionResult<{ changed: boolean }>> {
  try {
    const actor = await requirePermission({ user: ['set-role'] });
    const input = z.object({ userId: UserId, role: z.enum(STAFF_ROLES) }).parse({ userId, role });
    const result = await staff.setStaffRole(getPool(), auditActor(actor), input);
    if (!result.ok) return result;
    refresh();
    return { ok: true, data: { changed: result.changed } };
  } catch (err) {
    return actionError(err);
  }
}

export async function banStaffMember(userId: string): Promise<ActionResult> {
  try {
    const actor = await requirePermission({ user: ['ban'] });
    const result = await staff.banStaff(getPool(), auditActor(actor), UserId.parse(userId));
    if (!result.ok) return result;
    refresh();
    return { ok: true, data: null };
  } catch (err) {
    return actionError(err);
  }
}

export async function unbanStaffMember(userId: string): Promise<ActionResult> {
  try {
    const actor = await requirePermission({ user: ['ban'] });
    const result = await staff.unbanStaff(getPool(), auditActor(actor), UserId.parse(userId));
    if (!result.ok) return result;
    refresh();
    return { ok: true, data: null };
  } catch (err) {
    return actionError(err);
  }
}

export async function removeStaffMember(userId: string): Promise<ActionResult> {
  try {
    const actor = await requirePermission({ user: ['delete'] });
    const result = await staff.removeStaff(getPool(), auditActor(actor), UserId.parse(userId));
    if (!result.ok) return result;
    refresh();
    return { ok: true, data: null };
  } catch (err) {
    return actionError(err);
  }
}
