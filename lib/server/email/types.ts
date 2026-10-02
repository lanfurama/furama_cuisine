import type { ReactElement } from 'react';

export type EmailDeliveryMode = 'live' | 'redirect' | 'log';

/** Content is either a React Email element (rendered to html + text here) or ready-made html + text. */
export type EmailContent =
  | { react: ReactElement; html?: undefined; text?: undefined }
  | { react?: undefined; html: string; text: string };

export type SendEmailInput = EmailContent & {
  to: string;
  subject: string;
  /**
   * What makes a repeat of this send recognisable. SMTP has no idempotency key, so it becomes
   * the Message-ID header (`<invite-12-ab34@sending-domain>`) unless `messageId` is given.
   */
  idempotencyKey?: string;
  /** A ready Message-ID, `<…@…>`; the outbox passes the one it fixed at the first attempt. */
  messageId?: string;
  /** Where a reply goes: the guest for staff.new, the shared inbox for guest emails (R11). */
  replyTo?: string;
};

/** What a sink / the SMTP server actually received, after redirect and rendering. */
export type DeliveredEmail = {
  mode: EmailDeliveryMode;
  to: string;
  /** Original recipient; differs from `to` only in redirect mode. */
  originalTo: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey?: string;
  messageId?: string;
  replyTo?: string;
};

/** `id`: the SMTP server's reply to the message ("250 2.0.0 Ok: queued as …"); none in log mode. */
export type SendEmailResult = { mode: EmailDeliveryMode; id?: string; messageId?: string };

export type EmailErrorCode =
  | 'invalid_delivery_mode'
  /** EMAIL_DELIVERY is live or redirect but SMTP_HOST, SMTP_PORT or the SMTP_USER/SMTP_PASSWORD pair is missing or wrong. */
  | 'missing_smtp_config'
  | 'missing_from'
  | 'missing_redirect_to'
  /** BETTER_AUTH_URL is unset where an emailed link could reach someone (live, redirect, or a Vercel deployment). */
  | 'missing_app_url'
  /** Log mode on a Vercel Production or Preview deployment: logged without its link, so it reached no one. */
  | 'not_delivered'
  /** The SMTP server refused the recipient for good (5xx at RCPT TO): retrying cannot help. */
  | 'rejected'
  /** Anything else on the way to the SMTP server: network, TLS, auth, 4xx, a timeout. Retried. */
  | 'provider_error';

/** Thrown by sendEmail. The invite flow stores describeEmailError(err) in staff_invitation.email_error. */
export class EmailSendError extends Error {
  readonly code: EmailErrorCode;
  constructor(code: EmailErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'EmailSendError';
    this.code = code;
  }
}

export type EmailLogSink = (email: DeliveredEmail) => void | Promise<void>;

/** The message we hand the transport (nodemailer's SendMailOptions, narrowed to what we use). */
export type TransportMessage = {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  messageId?: string;
  replyTo?: string;
};

/** The slice of a nodemailer transporter we use; tests inject a fake or the real one aimed at a local sink. */
export type MailTransport = {
  sendMail(message: TransportMessage): Promise<{ messageId: string; response: string }>;
  close(): void;
};

/** Addresses in an SMTP reply ("550 5.1.1 <guest@x.vn>: unknown") never reach a stored error or a log line. */
export function redactEmails(text: string): string {
  return text.replace(/[^\s<>()"',;:]+@[^\s<>()"',;:]+/g, '<redacted>');
}

/** What goes in staff_invitation.email_error and email_outbox.last_error: "<code>: <message>", at most 300 characters, no addresses. */
export function describeEmailError(error: unknown): string {
  const text =
    error instanceof EmailSendError
      ? `${error.code}: ${error.message}`
      : `unknown: ${error instanceof Error ? error.message : String(error)}`;
  return redactEmails(text).slice(0, 300);
}

/** The code at the front of a stored email_error (an EmailErrorCode or "unknown"), or null when there is none. */
export function emailErrorCode(stored: string | null): string | null {
  return stored === null ? null : stored.split(':')[0];
}
