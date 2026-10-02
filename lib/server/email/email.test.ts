import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { INVITE_TTL } from '@/lib/server/auth/staff';
import { INVITE_TTL_DAYS, RESET_TOKEN_SECONDS } from '@/lib/server/auth/lifetimes';
import { appOrigin, invitationUrl, passwordResetUrl, sendPasswordReset, sendStaffInvitation } from './auth-emails';
import { consoleLogSink, createEmailSender, messageIdFor, renderEmail, sendEmail, senderDomain } from './send';
import { PasswordResetEmail } from './templates/password-reset';
import { StaffInvitationEmail } from './templates/staff-invitation';
import { EmailSendError, describeEmailError, emailErrorCode, redactEmails, type DeliveredEmail, type MailTransport } from './types';

const URL_INVITE = 'https://admin.example.vn/admin/accept-invite?token=abc_DEF-123';
const sha16 = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);

/** A transport that records what it was handed; no network. */
function fakeTransport(result: { messageId: string; response: string } | Error = { messageId: '<m@x>', response: '250 2.0.0 Ok: queued as AB12' }) {
  const sendMail = vi.fn<MailTransport['sendMail']>(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  const close = vi.fn();
  return { sendMail, close, transport: { sendMail, close } satisfies MailTransport };
}

const SMTP_ENV = { SMTP_HOST: 'smtp.furama.test', SMTP_PORT: '587', SMTP_USER: 'u', SMTP_PASSWORD: 'p w' };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('templates', () => {
  it('invitation html + text carry the link, role, inviter and 7-day expiry in Vietnamese', async () => {
    const el = createElement(StaffInvitationEmail, { acceptUrl: URL_INVITE, role: 'editor', inviterName: 'Nguyễn Văn An', expiresInDays: 7 });
    const { html, text } = await renderEmail(el);
    for (const out of [html, text]) {
      expect(out).toContain(URL_INVITE);
      expect(out).toContain('Biên tập viên');
      expect(out).toContain('Nguyễn Văn An');
      expect(out).toContain('7 ngày');
    }
    expect(html).toContain('lang="vi"');
    expect(text).toContain('Chấp nhận lời mời');
    expect(text).not.toContain('<');
  });

  it('reset html + text carry the link and keep the heading as written', async () => {
    const el = createElement(PasswordResetEmail, { resetUrl: 'https://x.vn/admin/reset-password?token=t1', userName: 'Lan', expiresInMinutes: 60 });
    const { html, text } = await renderEmail(el);
    for (const out of [html, text]) {
      expect(out).toContain('https://x.vn/admin/reset-password?token=t1');
      expect(out).toContain('Đặt lại mật khẩu');
      expect(out).toContain('60 phút');
    }
    expect(text).toContain('Xin chào Lan');
  });

  it('builds app links from BETTER_AUTH_URL and url-encodes tokens', () => {
    expect(invitationUrl('a b', 'http://h:3200')).toBe('http://h:3200/admin/accept-invite?token=a%20b');
    expect(passwordResetUrl('tok', 'http://h:3200')).toBe('http://h:3200/admin/reset-password?token=tok');
  });

  it('states the lifetimes the server enforces, not numbers of its own', async () => {
    const logged: DeliveredEmail[] = [];
    const send = createEmailSender({ env: {}, logSink: (e) => void logged.push(e) });
    await sendStaffInvitation({ to: 'n@f.vn', token: 'tok', invitationId: 'i1', role: 'editor', inviterName: 'An' }, send);
    await sendPasswordReset({ user: { email: 'u@f.vn', name: 'Lan' }, token: 'tok123' }, send);
    expect(logged[0].text).toContain(`Liên kết có hiệu lực trong ${INVITE_TTL_DAYS} ngày`);
    expect(logged[1].text).toContain(`Liên kết có hiệu lực trong ${RESET_TOKEN_SECONDS / 60} phút`);
    // staff_invitation.expires_at is now() + INVITE_TTL; Better Auth's resetPasswordTokenExpiresIn is RESET_TOKEN_SECONDS.
    expect(INVITE_TTL).toBe(`${INVITE_TTL_DAYS} days`);
  });
});

describe('appOrigin: where emailed links point (R23)', () => {
  it('is BETTER_AUTH_URL without its trailing slash', () => {
    expect(appOrigin({ BETTER_AUTH_URL: 'https://cuisine.furamavietnam.com/' })).toBe('https://cuisine.furamavietnam.com');
  });

  it('falls back to localhost only in log mode off Vercel (dev, tests)', () => {
    expect(appOrigin({})).toBe('http://localhost:3000');
    expect(appOrigin({ EMAIL_DELIVERY: 'log', VERCEL_ENV: 'development' })).toBe('http://localhost:3000');
  });

  it('fails closed when an email could reach someone, or on a Vercel deployment', () => {
    for (const env of [{ EMAIL_DELIVERY: 'live' }, { EMAIL_DELIVERY: 'redirect' }, { VERCEL_ENV: 'production' }, { VERCEL_ENV: 'preview', EMAIL_DELIVERY: 'log' }]) {
      const err = (() => {
        try {
          return appOrigin(env);
        } catch (e) {
          return e;
        }
      })();
      expect(err).toBeInstanceOf(EmailSendError);
      expect(err).toMatchObject({ code: 'missing_app_url' });
    }
  });
});

describe('delivery modes', () => {
  const content = { html: '<p>hi</p>', text: 'hi' };

  it('defaults to log when EMAIL_DELIVERY is unset and never opens an SMTP connection', async () => {
    const sink: DeliveredEmail[] = [];
    const createTransport = vi.fn();
    const send = createEmailSender({ env: {}, createTransport, logSink: (e) => void sink.push(e) });
    const r = await send({ to: 'a@b.vn', subject: 'S', ...content, idempotencyKey: 'k' });
    expect(r).toEqual({ mode: 'log' });
    expect(createTransport).not.toHaveBeenCalled();
    expect(sink).toHaveLength(1);
    expect(sink[0]).toMatchObject({ to: 'a@b.vn', originalTo: 'a@b.vn', subject: 'S', text: 'hi', idempotencyKey: 'k' });
  });

  it('renders the invitation for the sink, keyed by the invitation and a hash of the token', async () => {
    const sink: DeliveredEmail[] = [];
    const send = createEmailSender({ env: {}, logSink: (e) => void sink.push(e) });
    await sendStaffInvitation({ to: 'n@f.vn', token: 'tok', invitationId: 'i1', role: 'admin', inviterName: 'An' }, send);
    expect(sink[0].text).toContain('/admin/accept-invite?token=tok');
    expect(sink[0].html).toContain('Quản trị viên');
    expect(sink[0].idempotencyKey).toBe(`invite:i1:${sha16('tok')}`);
    expect(sink[0].idempotencyKey).not.toContain('tok:');
  });

  it('log mode on a Production or Preview deployment fails with not_delivered after logging only the redacted line', async () => {
    for (const vercelEnv of ['production', 'preview']) {
      // The default sender: process.env and the real console sink, as on Vercel with EMAIL_DELIVERY unset.
      const dir = mkdtempSync(join(tmpdir(), 'email-log-'));
      vi.stubEnv('VERCEL_ENV', vercelEnv);
      vi.stubEnv('EMAIL_DELIVERY', '');
      vi.stubEnv('EMAIL_LOG_FILE', join(dir, 'emails.ndjson'));
      const info = vi.spyOn(console, 'info').mockImplementation(() => {});
      const err = await sendEmail({ to: 'lan@furama.test', subject: 'S', html: '<p>x</p>', text: 'token=SECRET', idempotencyKey: 'invite:1:abcd' }).catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(EmailSendError);
      expect(err).toMatchObject({ code: 'not_delivered' });
      expect(describeEmailError(err)).toMatch(new RegExp(`^not_delivered: EMAIL_DELIVERY is log \\(or unset\\) on a Vercel ${vercelEnv} deployment`));
      expect(describeEmailError(err)).not.toContain('SECRET');
      expect(info.mock.calls).toEqual([['[email:log] to=*@furama.test key=invite:1:abcd']]);
      expect(() => readFileSync(join(dir, 'emails.ndjson'))).toThrow(/ENOENT/);
      info.mockRestore();
    }
  });

  it('log mode reads VERCEL_ENV from its env: an injected sink still receives the email first', async () => {
    const sink: DeliveredEmail[] = [];
    const send = createEmailSender({ env: { EMAIL_DELIVERY: 'log', VERCEL_ENV: 'preview' }, logSink: (e) => void sink.push(e) });
    await expect(send({ to: 'a@b.vn', subject: 'S', ...content })).rejects.toMatchObject({ code: 'not_delivered' });
    expect(sink).toHaveLength(1);
    // `vercel dev` (VERCEL_ENV=development) still counts as delivered: the full text is in the terminal.
    const dev = createEmailSender({ env: { VERCEL_ENV: 'development' }, logSink: () => {} });
    await expect(dev({ to: 'a@b.vn', subject: 'S', ...content })).resolves.toEqual({ mode: 'log' });
  });

  it('rejects unknown modes instead of falling through to live', async () => {
    const send = createEmailSender({ env: { EMAIL_DELIVERY: 'Live x' }, logSink: () => {} });
    await expect(send({ to: 'a@b.vn', subject: 'S', ...content })).rejects.toMatchObject({ code: 'invalid_delivery_mode' });
  });

  it('redirect rewrites "to", keeps the original in the subject, drops the Reply-To, and sends over SMTP with a Message-ID from the key', async () => {
    const { sendMail, close, transport } = fakeTransport();
    const createTransport = vi.fn(() => transport);
    const send = createEmailSender({
      env: { EMAIL_DELIVERY: 'redirect', EMAIL_REDIRECT_TO: 'qa@furama.test', EMAIL_FROM: 'Furama <no-reply@mail.furama.test>', ...SMTP_ENV },
      createTransport,
    });
    // As staff.new carries it (R11): the guest's address, which a reply from the redirect inbox must not reach.
    const r = await send({ to: 'real@guest.vn', subject: 'Hello', ...content, idempotencyKey: 'invite:7:ab12', replyTo: 'guest@example.com' });
    expect(r).toEqual({ mode: 'redirect', id: '250 2.0.0 Ok: queued as AB12', messageId: '<m@x>' });
    expect(sendMail).toHaveBeenCalledWith({
      from: 'Furama <no-reply@mail.furama.test>',
      to: 'qa@furama.test',
      subject: '[real@guest.vn] Hello',
      html: '<p>hi</p>',
      text: 'hi',
      messageId: '<invite-7-ab12@mail.furama.test>',
    });
    expect(sendMail.mock.calls[0][0]).not.toHaveProperty('replyTo');
    // One message, one connection: the transport is released after the send.
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('live on a Preview deployment is refused and opens no SMTP connection', async () => {
    // A Preview runs on a fork of production's guests and staff; `vercel dev` is a developer's machine.
    for (const VERCEL_ENV of ['preview', 'development']) {
      const createTransport = vi.fn(() => fakeTransport().transport);
      const send = createEmailSender({ env: { EMAIL_DELIVERY: 'live', EMAIL_FROM: 'no-reply@mail.furama.test', VERCEL_ENV, ...SMTP_ENV }, createTransport });
      const err = await send({ to: 'real@guest.vn', subject: 'S', ...content }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(EmailSendError);
      expect(describeEmailError(err)).toBe(`invalid_delivery_mode: EMAIL_DELIVERY=live is for Production only (VERCEL_ENV is ${VERCEL_ENV}); use redirect here`);
      expect(createTransport).not.toHaveBeenCalled();
    }
    // Production sends live; a Preview sends through redirect.
    const createTransport = vi.fn(() => fakeTransport().transport);
    const env = { EMAIL_FROM: 'no-reply@mail.furama.test', EMAIL_REDIRECT_TO: 'qa@furama.test', ...SMTP_ENV };
    await expect(createEmailSender({ env: { ...env, EMAIL_DELIVERY: 'live', VERCEL_ENV: 'production' }, createTransport })({ to: 'real@guest.vn', subject: 'S', ...content })).resolves.toMatchObject({ mode: 'live' });
    await expect(createEmailSender({ env: { ...env, EMAIL_DELIVERY: 'redirect', VERCEL_ENV: 'preview' }, createTransport })({ to: 'real@guest.vn', subject: 'S', ...content })).resolves.toMatchObject({ mode: 'redirect' });
    expect(createTransport).toHaveBeenCalledTimes(2);
  });

  it('hands Reply-To to the transport and to the log, only when there is one', async () => {
    const { sendMail, transport } = fakeTransport();
    const env = { EMAIL_DELIVERY: 'live', EMAIL_FROM: 'no-reply@mail.furama.test', ...SMTP_ENV };
    await createEmailSender({ env, createTransport: () => transport })({ to: 'g@guest.vn', subject: 'S', ...content, replyTo: 'fb@furama.test' });
    expect(sendMail.mock.calls[0][0]).toMatchObject({ to: 'g@guest.vn', replyTo: 'fb@furama.test' });
    await createEmailSender({ env, createTransport: () => transport })({ to: 'g@guest.vn', subject: 'S', ...content });
    expect(sendMail.mock.calls[1][0]).not.toHaveProperty('replyTo');
    const logged: DeliveredEmail[] = [];
    await createEmailSender({ env: {}, logSink: (e) => void logged.push(e) })({ to: 'g@guest.vn', subject: 'S', ...content, replyTo: 'fb@furama.test' });
    expect(logged[0].replyTo).toBe('fb@furama.test');
  });

  it('redirect without EMAIL_REDIRECT_TO throws', async () => {
    const send = createEmailSender({ env: { EMAIL_DELIVERY: 'redirect', EMAIL_FROM: 'a@b.vn', ...SMTP_ENV }, createTransport: () => fakeTransport().transport });
    await expect(send({ to: 'a@b.vn', subject: 'S', ...content })).rejects.toMatchObject({ code: 'missing_redirect_to' });
  });

  it('live builds the SMTP options from the env: STARTTLS required on 587, TLS from the first byte on 465, short timeouts', async () => {
    const createTransport = vi.fn((_options: unknown) => fakeTransport().transport);
    const live = (env: Record<string, string>) =>
      createEmailSender({ env: { EMAIL_DELIVERY: 'live', EMAIL_FROM: 'no-reply@mail.furama.test', ...env }, createTransport })({
        to: 'real@guest.vn',
        subject: 'Hello',
        ...content,
      });
    await live(SMTP_ENV);
    expect(createTransport.mock.calls[0][0]).toEqual({
      host: 'smtp.furama.test',
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: 'u', pass: 'p w' },
      dnsTimeout: 5_000,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
      tls: { minVersion: 'TLSv1.2' },
    });
    await live({ SMTP_HOST: 'smtp.furama.test', SMTP_PORT: '465' });
    expect(createTransport.mock.calls[1][0]).toMatchObject({ port: 465, secure: true, requireTLS: false, auth: undefined });
    await live({ SMTP_HOST: 'smtp.furama.test', SMTP_PORT: '2525', SMTP_SECURE: 'true' });
    expect(createTransport.mock.calls[2][0]).toMatchObject({ port: 2525, secure: true });
  });

  it('live without SMTP settings throws a clear error at send time, not at import', async () => {
    // Importing the module (above) with no SMTP env already succeeded; the default sender fails only when used.
    vi.stubEnv('EMAIL_DELIVERY', 'live');
    vi.stubEnv('EMAIL_FROM', 'no-reply@mail.furama.test');
    vi.stubEnv('SMTP_HOST', '');
    const err = await sendEmail({ to: 'a@b.vn', subject: 'S', ...content }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EmailSendError);
    expect(err).toMatchObject({ code: 'missing_smtp_config', message: 'SMTP_HOST is required when EMAIL_DELIVERY is live or redirect' });
    const bad = (env: Record<string, string>) =>
      createEmailSender({ env: { EMAIL_DELIVERY: 'live', EMAIL_FROM: 'a@b.vn', SMTP_HOST: 'h', ...env }, createTransport: () => fakeTransport().transport })({
        to: 'a@b.vn',
        subject: 'S',
        ...content,
      });
    await expect(bad({ SMTP_PORT: '58x' })).rejects.toMatchObject({ code: 'missing_smtp_config' });
    await expect(bad({ SMTP_SECURE: 'yes' })).rejects.toMatchObject({ code: 'missing_smtp_config' });
    await expect(bad({ SMTP_USER: 'u' })).rejects.toMatchObject({ code: 'missing_smtp_config', message: 'SMTP_USER and SMTP_PASSWORD must be set together' });
  });

  it('live without EMAIL_FROM (or without an address in it) throws', async () => {
    const send = (from?: string) =>
      createEmailSender({ env: { EMAIL_DELIVERY: 'live', ...SMTP_ENV, ...(from ? { EMAIL_FROM: from } : {}) }, createTransport: () => fakeTransport().transport })({
        to: 'a@b.vn',
        subject: 'S',
        ...content,
      });
    await expect(send()).rejects.toMatchObject({ code: 'missing_from' });
    await expect(send('Furama Cuisine')).rejects.toMatchObject({ code: 'missing_from' });
  });

  it('a refused recipient (5xx at RCPT TO) is rejected for good; anything else is a provider_error, without the address', async () => {
    const env = { EMAIL_DELIVERY: 'live', EMAIL_FROM: 'a@b.vn', ...SMTP_ENV };
    const failing = (error: Error) => createEmailSender({ env, createTransport: () => fakeTransport(error).transport });
    const rcpt = Object.assign(new Error('Can\'t send mail - all recipients were rejected: 550 5.1.1 <real@guest.vn>: unknown'), {
      code: 'EENVELOPE',
      command: 'RCPT TO',
      responseCode: 550,
    });
    const err = await failing(rcpt)({ to: 'real@guest.vn', subject: 'S', ...content }).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'rejected' });
    expect(describeEmailError(err)).toBe("rejected: SMTP EENVELOPE at RCPT TO: Can't send mail - all recipients were rejected: 550 5.1.1 <<redacted>>: unknown");
    const busy = Object.assign(new Error('451 Try again later'), { code: 'EENVELOPE', command: 'RCPT TO', responseCode: 451 });
    await expect(failing(busy)({ to: 'a@b.vn', subject: 'S', ...content })).rejects.toMatchObject({ code: 'provider_error' });
    const auth = Object.assign(new Error('Invalid login: 535 Authentication failed'), { code: 'EAUTH', command: 'AUTH PLAIN', responseCode: 535 });
    await expect(failing(auth)({ to: 'a@b.vn', subject: 'S', ...content })).rejects.toMatchObject({ code: 'provider_error' });
    await expect(failing(new Error('ECONNRESET'))({ to: 'a@b.vn', subject: 'S', ...content })).rejects.toMatchObject({ code: 'provider_error' });
  });

  it('a stored SMTP error names neither the SMTP host nor its address (Editors read it in the email log)', async () => {
    const env = { EMAIL_DELIVERY: 'live', EMAIL_FROM: 'a@b.vn', ...SMTP_ENV };
    const stored = (error: Error) =>
      createEmailSender({ env, createTransport: () => fakeTransport(error).transport })({ to: 'a@b.vn', subject: 'S', ...content }).catch((e: unknown) =>
        describeEmailError(e),
      );
    const dns = Object.assign(new Error('getaddrinfo ENOTFOUND smtp.furama.test'), { code: 'EDNS', command: 'CONN', hostname: 'smtp.furama.test' });
    expect(await stored(dns)).toBe('provider_error: SMTP EDNS at CONN: getaddrinfo ENOTFOUND <smtp-host>');
    const refused = Object.assign(new Error('connect ECONNREFUSED 10.1.2.3:587'), { code: 'ESOCKET', command: 'CONN', address: '10.1.2.3', port: 587 });
    expect(await stored(refused)).toBe('provider_error: SMTP ESOCKET at CONN: connect ECONNREFUSED <smtp-host>:587');
    const v6 = Object.assign(new Error('connect ETIMEDOUT 2001:db8::25:465'), { code: 'ESOCKET', command: 'CONN', address: '2001:db8::25', port: 465 });
    expect(await stored(v6)).toBe('provider_error: SMTP ESOCKET at CONN: connect ETIMEDOUT <smtp-host>:465');
    // An IPv4 address only in the text goes too.
    expect(await stored(Object.assign(new Error('Connection closed by 192.0.2.7'), { code: 'ECONNECTION' }))).toBe(
      'provider_error: SMTP ECONNECTION: Connection closed by <smtp-host>',
    );
  });

  it('gives up on a send that does not finish within the cap', async () => {
    const hanging: MailTransport = { sendMail: () => new Promise(() => {}), close: () => {} };
    const send = createEmailSender({ env: { EMAIL_DELIVERY: 'live', EMAIL_FROM: 'a@b.vn', ...SMTP_ENV }, createTransport: () => hanging, sendTimeoutMs: 50 });
    await expect(send({ to: 'a@b.vn', subject: 'S', ...content })).rejects.toMatchObject({
      code: 'provider_error',
      message: 'SMTP ETIMEDOUT: no answer within 50 ms',
    });
  });

  it('derives the Message-ID domain from EMAIL_FROM and keeps only safe characters of the key', () => {
    expect(senderDomain('Furama Cuisine <no-reply@Mail.FuramaVietnam.com>')).toBe('mail.furamavietnam.com');
    expect(senderDomain('no-reply@mail.furama.test')).toBe('mail.furama.test');
    expect(senderDomain('Furama')).toBeNull();
    expect(senderDomain(undefined)).toBeNull();
    expect(messageIdFor('outbox:12', 'mail.furama.test')).toBe('<outbox-12@mail.furama.test>');
    expect(messageIdFor('reset:ab/cd ef', 'd.vn')).toBe('<reset-ab-cd-ef@d.vn>');
  });

  it('password reset ignores Better Auth’s url and links to /admin/reset-password', async () => {
    const sink: DeliveredEmail[] = [];
    const send = createEmailSender({ env: {}, logSink: (e) => void sink.push(e) });
    await sendPasswordReset({ user: { email: 'u@f.vn', name: 'Lan' }, token: 'tok123' }, send);
    expect(sink[0].text).toContain('/admin/reset-password?token=tok123');
    expect(sink[0].idempotencyKey).toBe(`reset:${sha16('tok123')}`);
  });
});

describe('the log sink', () => {
  const email: DeliveredEmail = {
    mode: 'log',
    to: 'lan@furama.test',
    originalTo: 'lan@furama.test',
    subject: 'S',
    html: '<p>x</p>',
    text: 'Open http://h/admin/accept-invite?token=SECRET',
    idempotencyKey: 'invite:1:abcd',
  };

  it('off Vercel and under `vercel dev`, prints the full message and appends it to EMAIL_LOG_FILE', async () => {
    for (const vercelEnv of ['', 'development']) {
      const file = join(mkdtempSync(join(tmpdir(), 'email-log-')), 'emails.ndjson');
      vi.stubEnv('VERCEL_ENV', vercelEnv);
      vi.stubEnv('EMAIL_LOG_FILE', file);
      const info = vi.spyOn(console, 'info').mockImplementation(() => {});
      await consoleLogSink(email);
      expect(info.mock.calls[0][0]).toContain('token=SECRET');
      expect(JSON.parse(readFileSync(file, 'utf8').trim())).toMatchObject({ to: 'lan@furama.test', text: email.text });
      info.mockRestore();
    }
  });

  it('on a Production or Preview deployment, logs neither the address nor the link, and writes no file', async () => {
    for (const vercelEnv of ['production', 'preview']) {
      const dir = mkdtempSync(join(tmpdir(), 'email-log-'));
      vi.stubEnv('VERCEL_ENV', vercelEnv);
      vi.stubEnv('EMAIL_LOG_FILE', join(dir, 'emails.ndjson'));
      const info = vi.spyOn(console, 'info').mockImplementation(() => {});
      await consoleLogSink(email);
      expect(info.mock.calls).toEqual([['[email:log] to=*@furama.test key=invite:1:abcd']]);
      expect(() => readFileSync(join(dir, 'emails.ndjson'))).toThrow(/ENOENT/);
      info.mockRestore();
    }
  });
});

describe('describeEmailError', () => {
  it('keeps the code and message of an EmailSendError, short and token-free, for staff_invitation.email_error', () => {
    expect(describeEmailError(new EmailSendError('provider_error', 'SMTP EAUTH at AUTH PLAIN: Invalid login: 535 Authentication failed'))).toBe(
      'provider_error: SMTP EAUTH at AUTH PLAIN: Invalid login: 535 Authentication failed',
    );
    expect(redactEmails('550 5.1.1 <An.Nguyen+x@guest.vn>: no such user; cc lan@furama.test')).toBe('550 5.1.1 <<redacted>>: no such user; cc <redacted>');
    expect(describeEmailError(new Error('socket hang up'))).toBe('unknown: socket hang up');
    expect(describeEmailError('x'.repeat(400))).toHaveLength(300);
  });

  it('emailErrorCode reads the code back from a stored email_error', () => {
    expect(emailErrorCode(describeEmailError(new EmailSendError('not_delivered', 'EMAIL_DELIVERY is log: x')))).toBe('not_delivered');
    expect(emailErrorCode('unknown: socket hang up')).toBe('unknown');
    expect(emailErrorCode(null)).toBeNull();
  });
});
