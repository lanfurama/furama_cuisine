import 'server-only';
import type { ReactElement } from 'react';
import { plainTextSelectors, render } from 'react-email';
import type { SMTPTransportOptions } from 'nodemailer/lib/smtp-transport';
import { createSmtpTransport, smtpConfigFromEnv, smtpTransportOptions } from './smtp';
import {
  EmailSendError,
  redactEmails,
  type DeliveredEmail,
  type EmailDeliveryMode,
  type EmailLogSink,
  type MailTransport,
  type SendEmailInput,
  type SendEmailResult,
} from './types';

/*
 * The one place that sends email (spec §10.4's EMAIL_DELIVERY gate, for the
 * staff emails and the booking outbox alike):
 *   log      (default) print it, and append it to EMAIL_LOG_FILE off Vercel;
 *   redirect send it over SMTP to EMAIL_REDIRECT_TO, the real address in the subject, no Reply-To;
 *   live     send it over SMTP to the real address: Production only (refused on a Preview and under `vercel dev`).
 * test/guards keep nodemailer imports inside lib/server/email/.
 */

export type EmailDeps = {
  /** Read at send time, never at import time, so `next build` needs no email env. */
  env: Record<string, string | undefined>;
  createTransport: (options: SMTPTransportOptions) => MailTransport;
  logSink: EmailLogSink;
  /** A cap on one whole send (connect, TLS, login, DATA), above the per-step SMTP timeouts. */
  sendTimeoutMs: number;
  /** Tests only: a local sink's self-signed certificate, shorter timeouts. Never read from the environment. */
  transportOverrides?: Partial<SMTPTransportOptions>;
};

export const SEND_TIMEOUT_MS = 30_000;

/** Vercel deployments: their logs live on Vercel, and a Preview may run on a copy of production's staff. */
const DEPLOYED = new Set(['production', 'preview']);

/**
 * Default log sink. Invite and reset links are bearer tokens, so on a Vercel deployment
 * (VERCEL_ENV production or preview, e.g. a Preview missing EMAIL_DELIVERY) the log line carries
 * only the recipient domain and the idempotency key (and the sender then fails the send with
 * not_delivered, since nobody can act on it). Off Vercel (dev, CI, `next start` in E2E)
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
  createTransport: createSmtpTransport,
  logSink: consoleLogSink,
  sendTimeoutMs: SEND_TIMEOUT_MS,
});

/**
 * Where live is refused (spec §10.4: live only in Production). A Preview runs on a branch forked
 * from production, with its real guests, staff and recipients; `vercel dev` (VERCEL_ENV=development)
 * is a developer's machine. Both use redirect.
 */
const LIVE_REFUSED = new Set(['preview', 'development']);

/**
 * The delivery mode, checked at send time. Fails closed: a typo never falls through to real
 * delivery, and live where it is refused throws instead of emailing the people of forked data, so
 * an outbox row retries and then fails, and "Gửi email thử" says why. mode.ts shows staff this
 * same verdict.
 */
export function resolveMode(raw: string | undefined, vercelEnv: string | undefined): EmailDeliveryMode {
  const value = raw?.trim();
  if (!value) return 'log';
  if (value !== 'live' && value !== 'redirect' && value !== 'log') {
    throw new EmailSendError('invalid_delivery_mode', `EMAIL_DELIVERY must be live, redirect or log (got "${value}")`);
  }
  if (value === 'live' && LIVE_REFUSED.has(vercelEnv ?? '')) {
    throw new EmailSendError('invalid_delivery_mode', `EMAIL_DELIVERY=live is for Production only (VERCEL_ENV is ${vercelEnv}); use redirect here`);
  }
  return value;
}

/** The domain of EMAIL_FROM ("Furama Cuisine <no-reply@mail.furamavietnam.com>" → mail.furamavietnam.com). */
export function senderDomain(from: string | undefined): string | null {
  const match = from?.trim().match(/@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)>?$/);
  return match ? match[1].toLowerCase() : null;
}

/** A Message-ID made from an idempotency key: `invite:12:ab34` → `<invite-12-ab34@domain>`. */
export function messageIdFor(key: string, domain: string): string {
  return `<${key.replace(/[^A-Za-z0-9.-]+/g, '-')}@${domain}>`;
}

export async function renderEmail(element: ReactElement): Promise<{ html: string; text: string }> {
  const [html, text] = await Promise.all([
    render(element),
    render(element, {
      plainText: true,
      htmlToTextOptions: {
        selectors: [
          // html-to-text upper-cases headings by default; keep Vietnamese headings as written.
          { selector: 'h1', options: { uppercase: false } },
          ...plainTextSelectors,
          // A phone number is its own link text: "call us on +84 236 651 9999", not "… tel:+842366519999".
          { selector: 'a[href^="tel:"]', format: 'anchor', options: { ignoreHref: true } },
        ],
      },
    }),
  ]);
  return { html, text };
}

async function renderContent(input: SendEmailInput): Promise<{ html: string; text: string }> {
  return input.react ? renderEmail(input.react) : { html: input.html, text: input.text };
}

/** Rejects after `ms`, so one stuck server cannot hold a drain until the function's own limit. */
function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(`no answer within ${ms} ms`), { code: 'ETIMEDOUT' })), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

type SmtpFailure = { message?: string; code?: string; command?: string; responseCode?: number; address?: unknown; hostname?: unknown };

const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;

/**
 * Where the SMTP server is stays out of a stored error, like the addresses: Editors read
 * last_error in the email log. The configured host and the address or host name a connection
 * error carries (IPv6 included) become <smtp-host>, then any IPv4 address left in the text. Only
 * names with a dot or a colon are replaced, so a bare host such as "mail" never eats a word.
 */
function scrubHost(text: string, names: unknown[]): string {
  let out = text;
  for (const name of names) {
    if (typeof name === 'string' && /[.:]/.test(name)) out = out.split(name).join('<smtp-host>');
  }
  return out.replace(IPV4, '<smtp-host>');
}

/** A refused recipient (5xx at RCPT TO) is final; anything else (network, TLS, login, 4xx, timeout) may pass later. */
function smtpError(cause: unknown, host: string): EmailSendError {
  const e = (cause ?? {}) as SmtpFailure;
  const where = [e.code, e.command].filter(Boolean).join(' at ');
  const message = scrubHost(redactEmails(`SMTP ${where ? `${where}: ` : ''}${e.message ?? String(cause)}`), [host, e.address, e.hostname]);
  const permanent = typeof e.responseCode === 'number' && e.responseCode >= 500 && e.responseCode < 600 && /^RCPT/i.test(e.command ?? '');
  return new EmailSendError(permanent ? 'rejected' : 'provider_error', message, { cause });
}

export type Mailer = {
  send(input: SendEmailInput): Promise<SendEmailResult>;
  /** Releases the transport; the drain calls it once, after its last message. */
  close(): void;
};

/**
 * One sender for a batch: the drain opens it once, sends each claimed row,
 * then closes it. The SMTP settings are read and checked at the first live or
 * redirect send, so log mode never needs them.
 */
export function openMailer(overrides: Partial<EmailDeps> = {}): Mailer {
  const deps = { ...defaultDeps(), ...overrides };
  let transport: MailTransport | null = null;
  /** The configured SMTP host, kept out of stored errors (scrubHost). */
  let host = '';

  return {
    async send(input) {
      const mode = resolveMode(deps.env.EMAIL_DELIVERY, deps.env.VERCEL_ENV);
      const { html, text } = await renderContent(input);

      let to = input.to;
      let subject = input.subject;
      let replyTo = input.replyTo;
      if (mode === 'redirect') {
        const target = deps.env.EMAIL_REDIRECT_TO?.trim();
        if (!target) throw new EmailSendError('missing_redirect_to', 'EMAIL_REDIRECT_TO is required when EMAIL_DELIVERY=redirect');
        to = target;
        subject = `[${input.to}] ${input.subject}`;
        // A redirected email comes from forked data (a Preview, a dev database). Answering it from the
        // redirect inbox must reach neither the real guest (staff.new replies to the guest, R11) nor
        // production's shared inbox, so it carries no Reply-To.
        replyTo = undefined;
      }

      const from = deps.env.EMAIL_FROM?.trim();
      const domain = senderDomain(from);
      const messageId = input.messageId ?? (input.idempotencyKey && domain ? messageIdFor(input.idempotencyKey, domain) : undefined);
      const delivered: DeliveredEmail = {
        mode,
        to,
        originalTo: input.to,
        subject,
        html,
        text,
        idempotencyKey: input.idempotencyKey,
        messageId,
        ...(replyTo ? { replyTo } : {}),
      };

      if (mode === 'log') {
        await deps.logSink(delivered);
        // On a Production or Preview deployment the sink keeps only the recipient's domain and the
        // key, so the link is gone and nobody received anything. Report that as a failure: the
        // invitation then records email_error and the outbox retries, instead of "sent" for an
        // email nobody can recover.
        const vercelEnv = deps.env.VERCEL_ENV ?? '';
        if (DEPLOYED.has(vercelEnv)) {
          throw new EmailSendError(
            'not_delivered',
            `EMAIL_DELIVERY is log (or unset) on a Vercel ${vercelEnv} deployment: the email was only logged, without its link, and reached no one. Set EMAIL_DELIVERY to live or redirect.`,
          );
        }
        return { mode, messageId };
      }

      if (!from || !domain) {
        throw new EmailSendError('missing_from', `EMAIL_FROM with a sender address is required when EMAIL_DELIVERY=${mode}`);
      }
      if (!transport) {
        const config = smtpConfigFromEnv(deps.env);
        host = config.host;
        transport = deps.createTransport({ ...smtpTransportOptions(config), ...deps.transportOverrides });
      }

      let info;
      try {
        info = await withDeadline(
          transport.sendMail({ from, to, subject, html, text, messageId, ...(replyTo ? { replyTo } : {}) }),
          deps.sendTimeoutMs,
        );
      } catch (cause) {
        throw smtpError(cause, host);
      }
      return { mode, id: redactEmails(info.response).slice(0, 300), messageId: info.messageId };
    },
    close() {
      transport?.close();
      transport = null;
    },
  };
}

/** A sender for one message at a time (staff invitation and password reset). */
export function createEmailSender(overrides: Partial<EmailDeps> = {}) {
  return async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
    const mailer = openMailer(overrides);
    try {
      return await mailer.send(input);
    } finally {
      mailer.close();
    }
  };
}

export const sendEmail = createEmailSender();
