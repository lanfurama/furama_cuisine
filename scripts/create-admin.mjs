#!/usr/bin/env node
/**
 * Creates the first Admin (spec §7.1), once.
 *
 *   BOOTSTRAP_ADMIN_EMAIL=owner@example.com BOOTSTRAP_ADMIN_NAME="Owner" \
 *   DATABASE_URL=… BETTER_AUTH_SECRET=… BETTER_AUTH_URL=… node scripts/create-admin.mjs
 *
 * The password comes from BOOTSTRAP_ADMIN_PASSWORD or a hidden prompt. The
 * script goes through auth.api.createUser, so the invitation gate in
 * databaseHooks decides: it admits BOOTSTRAP_ADMIN_EMAIL only while no Admin
 * exists, which makes a second run fail instead of creating another Admin.
 * It loads the shared config (lib/server/auth/config.ts) with jiti; nothing
 * here reads .env files: pass the environment explicitly (README, "First
 * Admin"). BOOTSTRAP_ADMIN_EMAIL belongs in that one shell, never in Vercel.
 * It prints the target host and database before asking for the password, so
 * the operator sees where it will write before typing anything.
 */
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';
import pg from 'pg';

const root = fileURLToPath(new URL('..', import.meta.url));

function fail(message) {
  console.error(`create-admin: ${message}`);
  process.exit(1);
}

const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
const name = process.env.BOOTSTRAP_ADMIN_NAME?.trim() || 'Admin';
const connectionString = process.env.DATABASE_URL;
if (!email) fail('BOOTSTRAP_ADMIN_EMAIL is not set.');
if (!connectionString) fail('DATABASE_URL is not set.');
if (!process.env.BETTER_AUTH_SECRET) fail('BETTER_AUTH_SECRET is not set.');

// Same TLS rule as db/client.ts: full verification except for local databases.
const url = new URL(connectionString);
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) url.searchParams.set('sslmode', 'verify-full');
// Host, port and database only: never the user or password in the URL.
const target = `${url.hostname}${url.port ? `:${url.port}` : ''}${url.pathname}`;
console.log(`Target database: ${target}`);

async function promptHidden(question) {
  // Echo the question, not the keystrokes: readline writes into a stream that drops everything.
  process.stdout.write(question);
  const muted = new Writable({ write: (_chunk, _encoding, done) => done() });
  const rl = createInterface({ input: process.stdin, output: muted, terminal: true });
  const answer = await new Promise((resolve) => {
    rl.question('', resolve);
    // stdin closed before a newline (Ctrl-D, an empty pipe): answer '' so the length check
    // below explains the failure. Unresolved, node would exit 13 with no message.
    // After a real answer this second resolve does nothing.
    rl.on('close', () => resolve(''));
  });
  rl.close();
  process.stdout.write('\n');
  return answer;
}

/** A single-quoted SQL literal, for the statement printed below (no secrets in it). */
const sqlLiteral = (value) => `'${String(value).replaceAll("'", "''")}'`;

const password = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? (await promptHidden(`Password for ${email}: `));
// auth.api.createUser only checks the maximum length; the minimum is ours (config.ts: 12).
if (password.length < 12 || password.length > 128) fail('The password must be 12–128 characters.');

const jiti = createJiti(import.meta.url, { alias: { '@/': root } });
const { createAuth, INVITATION_REQUIRED } = await jiti.import('../lib/server/auth/config.ts');

console.log(`Creating Admin ${email} on ${target}`);
const pool = new pg.Pool({ connectionString: url.toString(), max: 2 });
const auth = createAuth({
  pool,
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
  bootstrapAdminEmail: email,
  sendResetPassword: async () => {},
});

let user;
try {
  // Verified like an accepted invitee: the operator vouches for the address.
  ({ user } = await auth.api.createUser({ body: { email, password, name, role: 'admin', data: { emailVerified: true } } }));
} catch (err) {
  const code = err?.body?.code;
  if (code === INVITATION_REQUIRED) fail('refused: an Admin already exists, or the email is not BOOTSTRAP_ADMIN_EMAIL.');
  if (code === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL') fail(`refused: ${email} already has an account.`);
  fail(err instanceof Error ? err.message : String(err));
}

const after = JSON.stringify({ email: user.email, role: 'admin' });
try {
  await pool.query(
    `INSERT INTO audit_log (actor_id, actor_email, action, entity_type, entity_id, after)
     VALUES ($1, $2, 'staff.bootstrap', 'staff_user', $1, $3)`,
    [user.id, user.email, after],
  );
} catch (err) {
  // The Admin exists now and a rerun is refused (an Admin exists), so say exactly what is
  // missing and how to add it, instead of a bare driver error.
  fail(
    [
      `the Admin ${user.email} (${user.id}) was created on ${target}, but its staff.bootstrap audit row was not written:`,
      `  ${err instanceof Error ? err.message : String(err)}`,
      'Do not run this script again (it would be refused). Insert the row by hand:',
      `  INSERT INTO audit_log (actor_id, actor_email, action, entity_type, entity_id, after) VALUES (${sqlLiteral(user.id)}, ${sqlLiteral(user.email)}, 'staff.bootstrap', 'staff_user', ${sqlLiteral(user.id)}, ${sqlLiteral(after)});`,
    ].join('\n'),
  );
}
await pool.end();
console.log(`Admin created: ${user.email} (${user.id})`);
