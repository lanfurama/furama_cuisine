import 'server-only';
import type { ReactElement } from 'react';
import { plainTextSelectors, render } from 'react-email';
import { Resend } from 'resend';
import {
  EmailSendError,
  type DeliveredEmail,
  type EmailDeliveryMode,
  type EmailLogSink,
  type ResendLike,
  type SendEmailInput,
  type SendEmailResult,
} from './types';

export type EmailDeps = {
  /** Read at send time, never at import time, so `next build` needs no email env. */
  env: Record<string, string | undefined>;
  createResend: (apiKey: string) => ResendLike;
  logSink: EmailLogSink;
};

/** Vercel deployments: their logs live on Vercel, and a Preview may run on a copy of production's staff. */
const DEPLOYED = new Set(['production', 'preview']);

/**
 * Default log sink. Invite and reset links are bearer tokens, so on a Vercel deployment
 * (VERCEL_ENV production or preview, e.g. a Preview missing EMAIL_DELIVERY) the log line carries
 * only the recipient domain and the idempotency key. Off Vercel (dev, CI, `next start` in E2E)
 * and under `vercel dev` (VERCEL_ENV=development, which `vercel env pull` also writes into
 * .env.local) it prints the full text so a developer can click the link, and EMAIL_LOG_FILE
 * appends the full message as NDJSON, which is how Playwright reads the invite link out of a
 * separate server process.
 */
export const consoleLogSink: EmailLogSink = async (email) => {
  if (DEPLOYED.has(process.env.VERCEL_ENV ?? '')) {
    const domain = email.to.split('@')[1] ?? 'unknown';
    console.info(`[email:log] to=*@${domain} key=${email.idempotencyKey ?? '-'}`);
    return;
  }
  console.info(`[email:log] to=${email.to}\nsubject: ${email.subject}\n${email.text}`);
  const file = process.env.EMAIL_LOG_FILE;
  if (file) {
    const { appendFile } = await import('node:fs/promises');
    await appendFile(file, `${JSON.stringify(email)}\n`);
  }
};

const defaultDeps = (): EmailDeps => ({
  env: process.env,
  createResend: (apiKey) => new Resend(apiKey) as unknown as ResendLike,
  logSink: consoleLogSink,
});

function resolveMode(raw: string | undefined): EmailDeliveryMode {
  const value = raw?.trim();
  if (!value) return 'log';
  if (value === 'live' || value === 'redirect' || value === 'log') return value;
  // Fail closed: a typo must never fall through to real delivery.
  throw new EmailSendError(
    'invalid_delivery_mode',
    `EMAIL_DELIVERY must be live, redirect or log (got "${value}")`,
  );
}

export async function renderEmail(element: ReactElement): Promise<{ html: string; text: string }> {
  const [html, text] = await Promise.all([
    render(element),
    // html-to-text upper-cases headings by default; keep Vietnamese headings as written.
    render(element, {
      plainText: true,
      htmlToTextOptions: { selectors: [{ selector: 'h1', options: { uppercase: false } }, ...plainTextSelectors] },
    }),
  ]);
  return { html, text };
}

async function renderContent(input: SendEmailInput): Promise<{ html: string; text: string }> {
  return input.react ? renderEmail(input.react) : { html: input.html, text: input.text };
}

export function createEmailSender(overrides: Partial<EmailDeps> = {}) {
  return async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
    const deps = { ...defaultDeps(), ...overrides };
    const mode = resolveMode(deps.env.EMAIL_DELIVERY);
    const { html, text } = await renderContent(input);

    let to = input.to;
    let subject = input.subject;
    if (mode === 'redirect') {
      const target = deps.env.EMAIL_REDIRECT_TO?.trim();
      if (!target) {
        throw new EmailSendError('missing_redirect_to', 'EMAIL_REDIRECT_TO is required when EMAIL_DELIVERY=redirect');
      }
      to = target;
      subject = `[${input.to}] ${input.subject}`;
    }

    const delivered: DeliveredEmail = {
      mode,
      to,
      originalTo: input.to,
      subject,
      html,
      text,
      idempotencyKey: input.idempotencyKey,
    };

    if (mode === 'log') {
      await deps.logSink(delivered);
      return { mode };
    }

    const apiKey = deps.env.RESEND_API_KEY?.trim();
    if (!apiKey) {
      throw new EmailSendError('missing_api_key', `RESEND_API_KEY is required when EMAIL_DELIVERY=${mode}`);
    }
    const from = deps.env.EMAIL_FROM?.trim();
    if (!from) {
      throw new EmailSendError('missing_from', `EMAIL_FROM is required when EMAIL_DELIVERY=${mode}`);
    }

    let result;
    try {
      result = await deps.createResend(apiKey).emails.send(
        { from, to, subject, html, text },
        input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : undefined,
      );
    } catch (cause) {
      throw new EmailSendError('provider_error', `Resend request failed: ${String((cause as Error)?.message ?? cause)}`, { cause });
    }
    if (result.error || !result.data) {
      throw new EmailSendError('provider_error', `Resend rejected the email: ${result.error?.message ?? 'no id returned'}`);
    }
    return { mode, id: result.data.id };
  };
}

export const sendEmail = createEmailSender();
