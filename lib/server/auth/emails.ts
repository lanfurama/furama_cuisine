import 'server-only';
import { createHash } from 'node:crypto';
import { createElement } from 'react';
import { INVITE_TTL_DAYS, RESET_TOKEN_SECONDS } from './lifetimes';
import { appOrigin } from '@/lib/server/email/origin';
import { sendEmail as defaultSend } from '@/lib/server/email/send';
import { PasswordResetEmail, passwordResetSubject } from '@/lib/server/email/templates/password-reset';
import { StaffInvitationEmail, staffInvitationSubject, type StaffInvitationProps } from '@/lib/server/email/templates/staff-invitation';
import type { SendEmailInput, SendEmailResult } from '@/lib/server/email/types';

/*
 * The two staff emails of phase 3 (spec §7.1, §10.4): they go straight to
 * SMTP through sendEmail, not through the booking outbox. Links are built
 * from BETTER_AUTH_URL; the raw token appears only in the link, never in the
 * idempotency key (it becomes the Message-ID header, which every mail server
 * on the way stores) or a log line.
 */

type Send = (input: SendEmailInput) => Promise<SendEmailResult>;

export function invitationUrl(token: string, origin = appOrigin()): string {
  return `${origin}/admin/accept-invite?token=${encodeURIComponent(token)}`;
}

export function passwordResetUrl(token: string, origin = appOrigin()): string {
  return `${origin}/admin/reset-password?token=${encodeURIComponent(token)}`;
}

const tokenKey = (token: string) => createHash('sha256').update(token).digest('hex').slice(0, 16);

export type StaffInvitationEmailArgs = {
  to: string;
  token: string;
  invitationId: string;
  role: StaffInvitationProps['role'];
  inviterName: string;
};

/**
 * Keyed by the invitation and its token: "Gửi lại" mints a new token, so it is
 * a new Message-ID, while a retry of the same send repeats the same one.
 */
export function sendStaffInvitation(args: StaffInvitationEmailArgs, send: Send = defaultSend): Promise<SendEmailResult> {
  return send({
    to: args.to,
    subject: staffInvitationSubject,
    react: createElement(StaffInvitationEmail, {
      acceptUrl: invitationUrl(args.token),
      role: args.role,
      inviterName: args.inviterName,
      expiresInDays: INVITE_TTL_DAYS,
    }),
    idempotencyKey: `invite:${args.invitationId}:${tokenKey(args.token)}`,
  });
}

/**
 * Better Auth's `url` points at ITS callback (/api/auth/reset-password/:token),
 * which redirects to a callbackURL. We build /admin/reset-password ourselves
 * from the token, so the admin screen owns the flow.
 */
export function sendPasswordReset(
  data: { user: { email: string; name?: string | null }; token: string },
  send: Send = defaultSend,
): Promise<SendEmailResult> {
  return send({
    to: data.user.email,
    subject: passwordResetSubject,
    react: createElement(PasswordResetEmail, {
      resetUrl: passwordResetUrl(data.token),
      userName: data.user.name ?? undefined,
      expiresInMinutes: RESET_TOKEN_SECONDS / 60,
    }),
    idempotencyKey: `reset:${tokenKey(data.token)}`,
  });
}
