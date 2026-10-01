import type { ReactElement } from 'react';

export type EmailDeliveryMode = 'live' | 'redirect' | 'log';

/** Content is either a React Email element (rendered to html + text here) or ready-made html + text. */
export type EmailContent =
  | { react: ReactElement; html?: undefined; text?: undefined }
  | { react?: undefined; html: string; text: string };

export type SendEmailInput = EmailContent & {
  to: string;
  subject: string;
  /** Sent as Resend's Idempotency-Key (live and redirect only; Resend keeps keys for 24 hours). */
  idempotencyKey?: string;
};

/** What a sink / the provider actually received, after redirect and rendering. */
export type DeliveredEmail = {
  mode: EmailDeliveryMode;
  to: string;
  /** Original recipient; differs from `to` only in redirect mode. */
  originalTo: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey?: string;
};

export type SendEmailResult = { mode: EmailDeliveryMode; id?: string };

export type EmailErrorCode =
  | 'invalid_delivery_mode'
  | 'missing_api_key'
  | 'missing_from'
  | 'missing_redirect_to'
  /** Log mode on a Vercel Production or Preview deployment: logged without its link, so it reached no one. */
  | 'not_delivered'
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

/** The slice of the Resend SDK we use; tests inject a fake. */
export type ResendLike = {
  emails: {
    send(
      payload: { from: string; to: string; subject: string; html: string; text: string },
      options?: { idempotencyKey?: string },
    ): Promise<{ data: { id: string } | null; error: { name?: string; message: string } | null }>;
  };
};

/** What goes in staff_invitation.email_error: "<code>: <message>", at most 300 characters, safe to show an Admin. */
export function describeEmailError(error: unknown): string {
  const text =
    error instanceof EmailSendError
      ? `${error.code}: ${error.message}`
      : `unknown: ${error instanceof Error ? error.message : String(error)}`;
  return text.slice(0, 300);
}

/** The code at the front of a stored email_error (an EmailErrorCode or "unknown"), or null when there is none. */
export function emailErrorCode(stored: string | null): string | null {
  return stored === null ? null : stored.split(':')[0];
}
