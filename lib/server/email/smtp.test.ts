import { afterEach, describe, expect, it } from 'vitest';
import { startSilentServer, startSmtpSink, type SmtpSink } from '@/test/helpers/smtp-sink';
import { sendStaffInvitation } from './auth-emails';
import { createEmailSender, openMailer, type EmailDeps } from './send';
import { describeEmailError } from './types';

/*
 * The real nodemailer transport against a local in-process SMTP server
 * (test/helpers/smtp-sink.ts): what goes over the wire, TLS, login, refusals
 * and slow or silent servers. No database, no real mail server.
 */

const content = { html: '<p>hi</p>', text: 'hi' };
let sinks: { close(): Promise<void> }[] = [];
const track = <T extends { close(): Promise<void> }>(s: T) => (sinks.push(s), s);
afterEach(async () => {
  await Promise.all(sinks.map((s) => s.close()));
  sinks = [];
});

const senderFor = (sink: SmtpSink, deps: Partial<EmailDeps> = {}, env: Record<string, string> = {}) =>
  createEmailSender({ env: sink.env(env), transportOverrides: sink.clientOverrides, ...deps });

describe('SMTP on the wire (local sink)', () => {
  it('587 style: upgrades with STARTTLS, logs in, and carries the Message-ID made from the key', async () => {
    const sink = track(await startSmtpSink({ login: { user: 'mailer', pass: 's3cret pass' } }));
    const sent = await sendStaffInvitation(
      { to: 'new.staff@furama.test', token: 'tok', invitationId: '41', role: 'editor', inviterName: 'Lan' },
      senderFor(sink),
    );
    expect(sent).toMatchObject({ mode: 'live', id: '250 Ok: queued as SINK0' });
    expect(sink.received).toHaveLength(1);
    const mail = sink.received[0];
    expect(mail).toMatchObject({ from: 'no-reply@mail.furama.test', to: ['new.staff@furama.test'], secure: true, user: 'mailer' });
    expect(mail.messageId).toMatch(/^<invite-41-[0-9a-f]{16}@mail\.furama\.test>$/);
    expect(sent.messageId).toBe(mail.messageId);
    expect(mail.raw).toMatch(/^From: Furama Cuisine <no-reply@mail\.furama\.test>$/m);
    // The token is only in the body's link, never in a header.
    expect(mail.raw.split(/\r?\n\r?\n/)[0]).not.toContain('tok');
  });

  it('carries a Vietnamese subject, html and text as alternatives, and the Reply-To it was given', async () => {
    const sink = track(await startSmtpSink());
    await senderFor(sink)({
      to: 'khach@guest.vn',
      subject: 'Đặt bàn của bạn đã được xác nhận (FC-7K3QH9XA)',
      html: '<p>Xin chào Nguyễn Thị Ánh</p>',
      text: 'Xin chào Nguyễn Thị Ánh',
      replyTo: 'fb@furama.test',
      idempotencyKey: 'outbox:42',
    });
    const mail = sink.received[0];
    expect(mail.subject).toBe('Đặt bàn của bạn đã được xác nhận (FC-7K3QH9XA)');
    expect(mail.replyTo).toBe('fb@furama.test');
    expect(mail.messageId).toBe('<outbox-42@mail.furama.test>');
    expect(mail.raw).toMatch(/^Content-Type: multipart\/alternative;/m);
    expect(mail.raw).toMatch(/^Content-Type: text\/plain; charset=utf-8$/m);
    expect(mail.raw).toMatch(/^Content-Type: text\/html; charset=utf-8$/m);
  });

  it('465 style: TLS from the first byte', async () => {
    const sink = track(await startSmtpSink({ secure: true }));
    await senderFor(sink)({ to: 'a@furama.test', subject: 'S', ...content, idempotencyKey: 'outbox:9' });
    expect(sink.received[0]).toMatchObject({ secure: true, messageId: '<outbox-9@mail.furama.test>' });
  });

  it('redirect: the team inbox gets it, the real address only in the subject, and no Reply-To', async () => {
    const sink = track(await startSmtpSink());
    await senderFor(sink, {}, { EMAIL_DELIVERY: 'redirect', EMAIL_REDIRECT_TO: 'qa@furama.test' })({
      to: 'gm@furama.test',
      subject: 'Booking',
      ...content,
      replyTo: 'guest@example.com',
    });
    expect(sink.received[0].to).toEqual(['qa@furama.test']);
    expect(sink.received[0].subject).toBe('[gm@furama.test] Booking');
    // staff.new replies to the guest (R11); from the redirect inbox, a reply must not reach a guest of the forked data.
    expect(sink.received[0].replyTo).toBeNull();
  });

  it('refuses to go on in clear when the server offers no STARTTLS: nothing is sent, no password crosses', async () => {
    const sink = track(await startSmtpSink({ noStartTls: true, login: { user: 'mailer', pass: 'pw' } }));
    const err = await senderFor(sink)({ to: 'a@furama.test', subject: 'S', ...content }).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'provider_error' });
    expect(describeEmailError(err)).toMatch(/^provider_error: SMTP ETLS/);
    expect(sink.attempts).toBe(0);
  });

  it('a wrong password is a provider_error (retried: someone may fix the env)', async () => {
    const sink = track(await startSmtpSink({ login: { user: 'mailer', pass: 'right' } }));
    const err = await senderFor(sink, {}, { SMTP_PASSWORD: 'wrong' })({ to: 'a@furama.test', subject: 'S', ...content }).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'provider_error' });
    expect(describeEmailError(err)).toMatch(/^provider_error: SMTP EAUTH at AUTH PLAIN: Invalid login: 535/);
    expect(describeEmailError(err)).not.toContain('wrong');
  });

  it('a recipient refused with 550 is rejected for good; 451 is a provider_error; the address never reaches the error', async () => {
    const sink = track(await startSmtpSink({ refuseRecipient: (a) => (a.startsWith('gone') ? 550 : a.startsWith('busy') ? 451 : null) }));
    const gone = await senderFor(sink)({ to: 'gone@guest.vn', subject: 'S', ...content }).catch((e: unknown) => e);
    expect(gone).toMatchObject({ code: 'rejected' });
    expect(describeEmailError(gone)).not.toContain('gone@guest.vn');
    const busy = await senderFor(sink)({ to: 'busy@guest.vn', subject: 'S', ...content }).catch((e: unknown) => e);
    expect(busy).toMatchObject({ code: 'provider_error' });
    expect(sink.received).toEqual([]);
  });

  it('a server that never greets: the greeting timeout ends the send, not the function limit', async () => {
    const silent = track(await startSilentServer());
    const send = createEmailSender({
      env: { EMAIL_DELIVERY: 'live', EMAIL_FROM: 'no-reply@mail.furama.test', SMTP_HOST: '127.0.0.1', SMTP_PORT: String(silent.port) },
      transportOverrides: { greetingTimeout: 300 },
    });
    const started = Date.now();
    const err = await send({ to: 'a@furama.test', subject: 'S', ...content }).catch((e: unknown) => e);
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(describeEmailError(err)).toMatch(/^provider_error: SMTP ETIMEDOUT at CONN: Greeting never received/);
  });

  it('a server slow to answer DATA: the send gives up at its cap, yet the server may still deliver (why delivery is at least once)', async () => {
    const sink = track(await startSmtpSink({ holdDataMs: 800 }));
    const err = await senderFor(sink, { sendTimeoutMs: 200 })({ to: 'a@furama.test', subject: 'S', ...content, idempotencyKey: 'outbox:5' }).catch(
      (e: unknown) => e,
    );
    expect(describeEmailError(err)).toBe('provider_error: SMTP ETIMEDOUT: no answer within 200 ms');
    // The client stopped waiting, but the message had already crossed: the server accepts it afterwards.
    await new Promise((r) => setTimeout(r, 1_000));
    expect(sink.received.map((m) => m.messageId)).toEqual(['<outbox-5@mail.furama.test>']);
  });

  it('one mailer sends a batch, each message on its own connection, and closes once', async () => {
    const sink = track(await startSmtpSink());
    const mailer = openMailer({ env: sink.env(), transportOverrides: sink.clientOverrides });
    try {
      for (const id of [1, 2, 3]) await mailer.send({ to: `s${id}@furama.test`, subject: `S${id}`, ...content, idempotencyKey: `outbox:${id}` });
    } finally {
      mailer.close();
    }
    expect(sink.received.map((m) => m.messageId)).toEqual(['<outbox-1@mail.furama.test>', '<outbox-2@mail.furama.test>', '<outbox-3@mail.furama.test>']);
  });
});
