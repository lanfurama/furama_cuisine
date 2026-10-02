import 'server-only';
import { createHash } from 'node:crypto';
import { createElement } from 'react';
import { INVITE_TTL_DAYS, RESET_TOKEN_SECONDS } from '@/lib/server/auth/lifetimes';
import { sendEmail as defaultSend } from './send';
import { PasswordResetEmail, passwordResetSubject } from './templates/password-reset';
import { StaffInvitationEmail, staffInvitationSubject, type StaffInvitationProps } from './templates/staff-invitation';
import { EmailSendError, type SendEmailInput, type SendEmailResult } from './types';

/*
 * The two staff emails of phase 3 (spec §7.1, §10.4): they go straight to
 * SMTP through sendEmail, not through the booking outbox. Links are built
 * from BETTER_AUTH_URL; the raw token appears only in the link, never in the
 * idempotency key (it becomes the Message-ID header, which every mail server
 * on the way stores) or a log line.
 */

type Send = (input: SendEmailInput) => Promise<SendEmailResult>;

const DEPLOYED = new Set(['production', 'preview']);

/**
 * The origin of every emailed link (invite, reset, and the booking link in
 * staff.new). It fails closed (R23): without BETTER_AUTH_URL a live or
 * redirected email, or any email on a Vercel deployment, would carry a
 * localhost link that works for nobody. Only log mode off Vercel (dev, tests)
 * keeps the localhost default.
 */
export function appOrigin(env: Record<string, string | undefined> = process.env): string {
  const url = env.BETTER_AUTH_URL?.trim();
  if (url) return url.replace(/\/$/, '');
  const mode = env.EMAIL_DELIVERY?.trim() || 'log';
  if (mode !== 'log' || DEPLOYED.has(env.VERCEL_ENV ?? '')) {
    throw new EmailSendError('missing_app_url', 'BETTER_AUTH_URL is required for emailed links outside log mode and on Vercel deployments');
  }
  return 'http://localhost:3000';
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
