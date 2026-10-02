import 'server-only';
import { createTransport } from 'nodemailer';
import type { SMTPTransportOptions } from 'nodemailer/lib/smtp-transport';
import { EmailSendError, type MailTransport } from './types';

/*
 * The SMTP connection (user decision: no Resend; a traditional SMTP account).
 * Settings come from the environment when a message is sent, never at import
 * or build time:
 *
 *   SMTP_HOST      the provider's submission host
 *   SMTP_PORT      587 (STARTTLS, the default) or 465 (TLS from the first byte)
 *   SMTP_SECURE    "true" for implicit TLS, "false" for STARTTLS; unset: true only on port 465
 *   SMTP_USER      login, together with SMTP_PASSWORD (both or neither)
 *   SMTP_PASSWORD
 *
 * Port 25 is not an option: Vercel functions are generally blocked from it.
 */

export type SmtpConfig = {
  host: string;
  port: number;
  /** true: TLS from the first byte (465). false: plain connect, then a mandatory STARTTLS upgrade (587). */
  secure: boolean;
  auth?: { user: string; pass: string };
};

const missing = (message: string) => new EmailSendError('missing_smtp_config', message);

export function smtpConfigFromEnv(env: Record<string, string | undefined>): SmtpConfig {
  const host = env.SMTP_HOST?.trim();
  if (!host) throw missing('SMTP_HOST is required when EMAIL_DELIVERY is live or redirect');

  const rawPort = env.SMTP_PORT?.trim() || '587';
  const port = Number(rawPort);
  if (!/^\d{1,5}$/.test(rawPort) || port < 1 || port > 65535) throw missing(`SMTP_PORT must be a port number (got "${rawPort}")`);

  const rawSecure = env.SMTP_SECURE?.trim().toLowerCase();
  if (rawSecure && rawSecure !== 'true' && rawSecure !== 'false') throw missing(`SMTP_SECURE must be true or false (got "${rawSecure}")`);
  const secure = rawSecure ? rawSecure === 'true' : port === 465;

  const user = env.SMTP_USER?.trim();
  // A password is taken as typed: spaces may be part of it.
  const pass = env.SMTP_PASSWORD;
  if (Boolean(user) !== Boolean(pass)) throw missing('SMTP_USER and SMTP_PASSWORD must be set together');

  return { host, port, secure, ...(user && pass ? { auth: { user, pass } } : {}) };
}

/**
 * Sized for a serverless function, where nodemailer's defaults (2 minutes to
 * connect, 10 minutes of socket inactivity) would outlive the invocation.
 * Each limit applies to one step; send.ts also caps a whole send.
 */
export const SMTP_TIMEOUTS = {
  dnsTimeout: 5_000,
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 20_000,
} as const;

export function smtpTransportOptions(config: SmtpConfig): SMTPTransportOptions {
  return {
    host: config.host,
    port: config.port,
    secure: config.secure,
    // Without TLS on 587 the password and the guest's details would cross the network in clear: refuse instead.
    requireTLS: !config.secure,
    auth: config.auth,
    ...SMTP_TIMEOUTS,
    tls: { minVersion: 'TLSv1.2' },
  };
}

/**
 * Not pooled: each message opens its own connection and closes it when the
 * server has answered. Booking email is a few messages per drain, and a
 * Fluid Compute instance that is suspended between invocations then never
 * holds a half-dead SMTP socket.
 */
export function createSmtpTransport(options: SMTPTransportOptions): MailTransport {
  const transporter = createTransport(options);
  return {
    sendMail: async (message) => {
      const info = await transporter.sendMail(message);
      return { messageId: info.messageId, response: info.response };
    },
    close: () => transporter.close(),
  };
}
