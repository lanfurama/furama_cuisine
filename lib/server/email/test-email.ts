import 'server-only';
import type { Pool } from 'pg';
import type { EmailEvent } from '@/lib/email/events';
import { appOrigin } from './auth-emails';
import { renderSampleEmail } from './booking/sample';
import { sendEmail as defaultSend } from './send';
import { describeEmailError, emailErrorCode, type EmailDeliveryMode, type SendEmailInput, type SendEmailResult } from './types';

/*
 * "Gửi email thử" (spec §10.4, R9): the sample booking's email, sent now
 * through the same gate and SMTP transport as the outbox, and awaited, so the
 * Admin learns at once whether this environment can send (SMTP reach, login,
 * DNS alignment, rendering). It does not go through email_outbox: a test has
 * no booking, must not be retried for a day, and must not count as a failed
 * booking email on the overview. Nothing is stored; the log line carries only
 * the error code.
 */

export type TestEmailResult =
  | { ok: true; data: { mode: EmailDeliveryMode; to: string } }
  | { ok: false; code: 'email_failed'; params: { error: string } };

export async function sendTestEmail(
  pool: Pool,
  input: { to: string; event: EmailEvent; locale: string },
  options: { adminOrigin?: string; send?: (input: SendEmailInput) => Promise<SendEmailResult>; env?: Record<string, string | undefined> } = {},
): Promise<TestEmailResult> {
  try {
    // Inside the try: a missing BETTER_AUTH_URL (R23) is reported like any other setup error.
    const adminOrigin = options.adminOrigin ?? appOrigin();
    const email = await renderSampleEmail(pool, input.event, input.locale, { adminOrigin });
    const result = await (options.send ?? defaultSend)({
      to: input.to,
      subject: email.subject,
      html: email.html,
      text: email.text,
      replyTo: email.replyTo,
      // A fresh Message-ID per click: two tests are two emails.
      idempotencyKey: `test:${Date.now().toString(36)}`,
    });
    // Redirect mode delivers to EMAIL_REDIRECT_TO; say so instead of claiming the typed address got it.
    const env = options.env ?? process.env;
    const to = result.mode === 'redirect' ? (env.EMAIL_REDIRECT_TO?.trim() ?? input.to) : input.to;
    return { ok: true, data: { mode: result.mode, to } };
  } catch (err) {
    const error = describeEmailError(err);
    console.error('[email] test send failed', { code: emailErrorCode(error) });
    return { ok: false, code: 'email_failed', params: { error } };
  }
}
