import { getPool } from '@/db/client';
import { isEmailEvent } from '@/lib/email/events';
import { DEFAULT_LOCALE, LOCALE_CODE_RE } from '@/lib/i18n/locales';
import { isStringKey } from '@/lib/i18n/registry';
import { requirePermission } from '@/lib/server/dal/session';
import { emailKeys, type EmailKey } from '@/lib/server/email/booking/render';
import { renderSampleEmail, TEST_SUBJECT_PREFIX } from '@/lib/server/email/booking/sample';
import { appOrigin } from '@/lib/server/email/auth-emails';
import { validateValue } from '@/lib/server/content/strings-admin';

/*
 * "Xem trước với dữ liệu mẫu" of /admin/content/emails (spec §7.2): the sample
 * booking's email (lib/server/email/booking/sample.ts, no guest data), with
 * the text the editor has typed but not saved, in the language the screen
 * edits (phase-7A ledger A4: a Vietnamese preview shows the Vietnamese being
 * typed). The form posts here
 * into an <iframe> (a formAction button), so nothing is written.
 *
 * A route handler, not a Server Action, because the email's HTML is inline
 * styled: the admin page's CSP has no 'unsafe-inline' and an srcdoc frame
 * would inherit it. This response carries its own policy instead: styles
 * only, no script, framed only by the admin itself.
 */

const PREVIEW_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
  'X-Frame-Options': 'SAMEORIGIN',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'same-origin',
};

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function page(body: string, status = 200): Response {
  return new Response(body, { status, headers: PREVIEW_HEADERS });
}

export async function POST(request: Request): Promise<Response> {
  try {
    await requirePermission({ content: ['read'] });
  } catch {
    return new Response('Forbidden', { status: 403 });
  }
  // Spec §7.1: an admin route handler checks Origin (a form post from another site carries its own).
  if (request.headers.get('origin') !== new URL(request.url).origin) return new Response('Forbidden', { status: 403 });

  const form = await request.formData();
  const event = form.get('preview_event');
  // The language the screen edits (its hidden locale field); renderSampleEmail falls back for a code the table lacks.
  const asked = form.get('locale');
  const locale = typeof asked === 'string' && LOCALE_CODE_RE.test(asked) ? asked : DEFAULT_LOCALE;
  if (!isEmailEvent(event)) return page('<p>Chọn loại email.</p>', 400);

  const overrides: Partial<Record<EmailKey, string>> = {};
  const problems: string[] = [];
  for (const key of emailKeys(event)) {
    const raw = form.get(`v:${key}`);
    if (typeof raw !== 'string' || !isStringKey(key)) continue;
    const value = raw.replace(/\r\n?/g, '\n').trim();
    const errors = validateValue(key, value, locale);
    if (errors.length) problems.push(`${key}: ${errors.join(' ')}`);
    // An empty translation is no text: the email reads its fallback, as a saved one would.
    else if (value !== '') overrides[key] = value;
  }
  if (problems.length) {
    return page(`<p>Chưa xem trước được, vì:</p><ul>${problems.map((p) => `<li>${escape(p)}</li>`).join('')}</ul>`, 422);
  }

  const email = await renderSampleEmail(getPool(), event, locale, { adminOrigin: appOrigin(), overrides });
  const subject = email.subject.slice(TEST_SUBJECT_PREFIX.length);
  const banner = `<div style="font:13px/1.4 sans-serif;padding:8px 12px;background:#f4f1ea;border-bottom:1px solid #ddd">Tiêu đề: <strong>${escape(subject)}</strong> · ${escape(email.locale)}</div>`;
  return page(email.html.replace(/<body[^>]*>/, (m) => `${m}${banner}`));
}
