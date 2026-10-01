import 'server-only';
import { createHash } from 'node:crypto';
import { createElement } from 'react';
import { sendEmail as defaultSend } from './send';
import { PasswordResetEmail, passwordResetSubject } from './templates/password-reset';
import { StaffInvitationEmail, staffInvitationSubject, type StaffInvitationProps } from './templates/staff-invitation';
import type { SendEmailInput, SendEmailResult } from './types';

/*
 * The two staff emails of phase 3 (spec §7.1, §10.4): they go straight to
 * Resend through sendEmail, not through the booking outbox. Links are built
 * from BETTER_AUTH_URL; the raw token appears only in the link, never in the
 * idempotency key (Resend stores keys) or a log line.
 */

type Send = (input: SendEmailInput) => Promise<SendEmailResult>;

export function appOrigin(env: Record<string, string | undefined> = process.env): string {
  return (env.BETTER_AUTH_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

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
 * a new Resend idempotency key, while a retry of the same send stays deduplicated.
 */
export function sendStaffInvitation(args: StaffInvitationEmailArgs, send: Send = defaultSend): Promise<SendEmailResult> {
  return send({
    to: args.to,
    subject: staffInvitationSubject,
    react: createElement(StaffInvitationEmail, {
      acceptUrl: invitationUrl(args.token),
      role: args.role,
      inviterName: args.inviterName,
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
    }),
    idempotencyKey: `reset:${tokenKey(data.token)}`,
  });
}
