import { createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import { SMTPServer, type SMTPServerOptions } from 'smtp-server';

/*
 * A local, in-process SMTP server for tests: never a real one. It listens on
 * 127.0.0.1 on a port the OS picks, speaks STARTTLS (587-style) or TLS from
 * the first byte (465-style) with smtp-server's built-in localhost
 * certificate, can require a login, refuse a recipient, fail or stall a
 * message, and records what it accepted, raw, as the wire carried it.
 */

export type ReceivedMail = {
  from: string;
  to: string[];
  raw: string;
  /** The Message-ID header as sent. */
  messageId: string | null;
  subject: string | null;
  replyTo: string | null;
  /** Whether the session was encrypted when the message arrived. */
  secure: boolean;
  user: string | null;
};

export type SinkOptions = {
  /** TLS from the first byte (port 465 style); otherwise plain + STARTTLS. */
  secure?: boolean;
  /** Do not offer STARTTLS (to prove requireTLS refuses to go on in clear). */
  noStartTls?: boolean;
  /** Require this login. */
  login?: { user: string; pass: string };
  /** Answer RCPT TO for this address with this SMTP code (e.g. 550, 451). */
  refuseRecipient?: (address: string) => number | null;
  /** Fail the message after DATA with this code; called per message, so it can fail only some. */
  failData?: (index: number) => number | null;
  /** Hold the reply to DATA this long (a slow server). */
  holdDataMs?: number;
};

export type SmtpSink = {
  port: number;
  /** Messages the sink accepted (250 after DATA). */
  received: ReceivedMail[];
  /** Every message whose DATA arrived, accepted or refused. */
  seen: ReceivedMail[];
  /** seen.length */
  attempts: number;
  /** Transport options for the client side: this sink's self-signed certificate, short timeouts. */
  clientOverrides: { tls: { rejectUnauthorized: false; minVersion: 'TLSv1.2' } };
  /** The env a test hands the mailer to send here. */
  env(extra?: Record<string, string>): Record<string, string>;
  close(): Promise<void>;
};

/** RFC 2047 encoded words (=?UTF-8?Q?…?= / =?UTF-8?B?…?=), as nodemailer writes a non-ASCII subject. */
function decodeWords(value: string): string {
  return value
    .replace(/\?=\s+=\?/g, '?==?')
    .replace(/=\?UTF-8\?([QB])\?([^?]*)\?=/gi, (_, enc: string, text: string) =>
      enc.toUpperCase() === 'B'
        ? Buffer.from(text, 'base64').toString('utf8')
        : Buffer.from(text.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (_m, h: string) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8'),
    );
}

const header = (raw: string, name: string): string | null => {
  const head = raw.split(/\r?\n\r?\n/)[0];
  const match = head.match(new RegExp(`^${name}:[ \\t]*(.*(?:\\r?\\n[ \\t].*)*)`, 'im'));
  return match ? decodeWords(match[1].replace(/\r?\n[ \t]+/g, ' ').trim()) : null;
};

const smtpError = (code: number, message: string) => Object.assign(new Error(message), { responseCode: code });

export async function startSmtpSink(options: SinkOptions = {}): Promise<SmtpSink> {
  const received: ReceivedMail[] = [];
  const seen: ReceivedMail[] = [];
  const config: SMTPServerOptions = {
    secure: options.secure ?? false,
    logger: false,
    disabledCommands: options.noStartTls ? ['STARTTLS'] : [],
    authOptional: !options.login,
    // Only after STARTTLS (or on 465): the client must never log in in clear.
    allowInsecureAuth: false,
    onAuth(auth, _session, callback) {
      if (options.login && auth.username === options.login.user && auth.password === options.login.pass) {
        return callback(null, { user: auth.username });
      }
      return callback(smtpError(535, 'Authentication failed'));
    },
    onRcptTo(address, _session, callback) {
      const code = options.refuseRecipient?.(address.address) ?? null;
      if (code) return callback(smtpError(code, code >= 500 ? `${address.address}: Recipient address rejected` : 'Try again later'));
      return callback();
    },
    onData(stream, session, callback) {
      const index = seen.length;
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        const mail: ReceivedMail = {
          from: session.envelope.mailFrom ? session.envelope.mailFrom.address : '',
          to: session.envelope.rcptTo.map((r) => r.address),
          raw,
          messageId: header(raw, 'Message-ID'),
          subject: header(raw, 'Subject'),
          replyTo: header(raw, 'Reply-To'),
          secure: session.secure,
          user: typeof session.user === 'string' ? session.user : null,
        };
        seen.push(mail);
        const finish = () => {
          const code = options.failData?.(index) ?? null;
          if (code) return callback(smtpError(code, code >= 500 ? 'Message rejected' : 'Temporary failure, try again'));
          received.push(mail);
          return callback(null, `Ok: queued as SINK${index}`);
        };
        if (options.holdDataMs) setTimeout(finish, options.holdDataMs);
        else finish();
      });
    },
  };
  const server = new SMTPServer(config);
  await new Promise<void>((resolve, reject) => {
    server.server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const port = (server.server.address() as AddressInfo).port;

  return {
    port,
    received,
    seen,
    get attempts() {
      return seen.length;
    },
    clientOverrides: { tls: { rejectUnauthorized: false, minVersion: 'TLSv1.2' } },
    env: (extra = {}) => ({
      EMAIL_DELIVERY: 'live',
      EMAIL_FROM: 'Furama Cuisine <no-reply@mail.furama.test>',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(port),
      SMTP_SECURE: options.secure ? 'true' : 'false',
      ...(options.login ? { SMTP_USER: options.login.user, SMTP_PASSWORD: options.login.pass } : {}),
      ...extra,
    }),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** A TCP server that accepts connections and never says a word: no SMTP greeting, ever. */
export async function startSilentServer(): Promise<{ port: number; close(): Promise<void> }> {
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  return {
    port: (server.address() as AddressInfo).port,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}
