import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { invitationUrl, passwordResetUrl, sendPasswordReset, sendStaffInvitation } from './auth-emails';
import { consoleLogSink, createEmailSender, renderEmail, sendEmail } from './send';
import { PasswordResetEmail } from './templates/password-reset';
import { StaffInvitationEmail } from './templates/staff-invitation';
import { EmailSendError, describeEmailError, type DeliveredEmail, type ResendLike } from './types';

const URL_INVITE = 'https://admin.example.vn/admin/accept-invite?token=abc_DEF-123';
const sha16 = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);

function fakeResend(result?: Awaited<ReturnType<ResendLike['emails']['send']>>) {
  const send = vi.fn<ResendLike['emails']['send']>(async () => result ?? { data: { id: 'em_1' }, error: null });
  return { send, client: { emails: { send } } satisfies ResendLike };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('templates', () => {
  it('invitation html + text carry the link, role, inviter and 7-day expiry in Vietnamese', async () => {
    const el = createElement(StaffInvitationEmail, { acceptUrl: URL_INVITE, role: 'editor', inviterName: 'Nguyễn Văn An' });
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
    const el = createElement(PasswordResetEmail, { resetUrl: 'https://x.vn/admin/reset-password?token=t1', userName: 'Lan' });
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
});

describe('delivery modes', () => {
  const content = { html: '<p>hi</p>', text: 'hi' };

  it('defaults to log when EMAIL_DELIVERY is unset and never touches Resend', async () => {
    const sink: DeliveredEmail[] = [];
    const createResend = vi.fn();
    const send = createEmailSender({ env: {}, createResend, logSink: (e) => void sink.push(e) });
    const r = await send({ to: 'a@b.vn', subject: 'S', ...content, idempotencyKey: 'k' });
    expect(r).toEqual({ mode: 'log' });
    expect(createResend).not.toHaveBeenCalled();
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

  it('rejects unknown modes instead of falling through to live', async () => {
    const send = createEmailSender({ env: { EMAIL_DELIVERY: 'Live x' }, logSink: () => {} });
    await expect(send({ to: 'a@b.vn', subject: 'S', ...content })).rejects.toMatchObject({ code: 'invalid_delivery_mode' });
  });

  it('redirect rewrites "to", keeps the original in the subject, and sends through Resend', async () => {
    const { send: resendSend, client } = fakeResend();
    const send = createEmailSender({
      env: { EMAIL_DELIVERY: 'redirect', EMAIL_REDIRECT_TO: 'qa@furama.test', RESEND_API_KEY: 're_x', EMAIL_FROM: 'Furama <no-reply@mail.furama.test>' },
      createResend: () => client,
    });
    const r = await send({ to: 'real@guest.vn', subject: 'Hello', ...content, idempotencyKey: 'k1' });
    expect(r).toEqual({ mode: 'redirect', id: 'em_1' });
    expect(resendSend).toHaveBeenCalledWith(
      { from: 'Furama <no-reply@mail.furama.test>', to: 'qa@furama.test', subject: '[real@guest.vn] Hello', html: '<p>hi</p>', text: 'hi' },
      { idempotencyKey: 'k1' },
    );
  });

  it('redirect without EMAIL_REDIRECT_TO throws', async () => {
    const send = createEmailSender({
      env: { EMAIL_DELIVERY: 'redirect', RESEND_API_KEY: 're_x', EMAIL_FROM: 'a@b' },
      createResend: () => fakeResend().client,
    });
    await expect(send({ to: 'a@b.vn', subject: 'S', ...content })).rejects.toMatchObject({ code: 'missing_redirect_to' });
  });

  it('live calls the Resend client with the real recipient', async () => {
    const { send: resendSend, client } = fakeResend();
    const createResend = vi.fn(() => client);
    const send = createEmailSender({ env: { EMAIL_DELIVERY: 'live', RESEND_API_KEY: 're_key', EMAIL_FROM: 'no-reply@mail.furama.test' }, createResend });
    const r = await send({ to: 'real@guest.vn', subject: 'Hello', ...content });
    expect(r).toEqual({ mode: 'live', id: 'em_1' });
    expect(createResend).toHaveBeenCalledWith('re_key');
    expect(resendSend).toHaveBeenCalledWith(
      { from: 'no-reply@mail.furama.test', to: 'real@guest.vn', subject: 'Hello', html: '<p>hi</p>', text: 'hi' },
      undefined,
    );
  });

  it('live without RESEND_API_KEY throws a clear error at send time, not at import', async () => {
    // Importing the module (above) with no key already succeeded; the default sender fails only when used.
    vi.stubEnv('EMAIL_DELIVERY', 'live');
    vi.stubEnv('RESEND_API_KEY', '');
    const err = await sendEmail({ to: 'a@b.vn', subject: 'S', ...content }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EmailSendError);
    expect(err).toMatchObject({ code: 'missing_api_key', message: 'RESEND_API_KEY is required when EMAIL_DELIVERY=live' });
  });

  it('live without EMAIL_FROM throws', async () => {
    const send = createEmailSender({ env: { EMAIL_DELIVERY: 'live', RESEND_API_KEY: 're_x' }, createResend: () => fakeResend().client });
    await expect(send({ to: 'a@b.vn', subject: 'S', ...content })).rejects.toMatchObject({ code: 'missing_from' });
  });

  it('turns Resend {error} results and thrown errors into EmailSendError(provider_error)', async () => {
    const env = { EMAIL_DELIVERY: 'live', RESEND_API_KEY: 're_x', EMAIL_FROM: 'a@b' };
    const rejected = createEmailSender({ env, createResend: () => fakeResend({ data: null, error: { message: 'domain not verified' } }).client });
    await expect(rejected({ to: 'a@b.vn', subject: 'S', ...content })).rejects.toThrow(/domain not verified/);
    const boom = createEmailSender({
      env,
      createResend: () => ({
        emails: {
          send: async () => {
            throw new Error('ECONNRESET');
          },
        },
      }),
    });
    await expect(boom({ to: 'a@b.vn', subject: 'S', ...content })).rejects.toMatchObject({ code: 'provider_error' });
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
    expect(describeEmailError(new EmailSendError('provider_error', 'Resend rejected the email: rate limited'))).toBe(
      'provider_error: Resend rejected the email: rate limited',
    );
    expect(describeEmailError(new Error('socket hang up'))).toBe('unknown: socket hang up');
    expect(describeEmailError('x'.repeat(400))).toHaveLength(300);
  });
});
