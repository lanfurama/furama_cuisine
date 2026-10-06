import type { Metadata } from 'next';
import Link from 'next/link';
import { EMAIL_EVENTS, EMAIL_EVENT_LABELS } from '@/lib/email/events';
import { requirePagePermission } from '@/lib/server/dal/session';
import { StringsPanel, type ScreenSearchParams } from '../_ui/StringsPanel';

/** One group per email, then the words every email shares (email.common.*). */
const GROUPS = [
  ...EMAIL_EVENTS.map((e) => ({ title: EMAIL_EVENT_LABELS[e], prefix: `email.${e}.` })),
  { title: 'Dùng chung cho mọi email', prefix: 'email.common.' },
];

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Nội dung email' };

/*
 * Spec §7.2 /admin/content/emails: the email.* keys, and "xem trước với dữ
 * liệu mẫu". The preview button posts this same form (unsaved text included)
 * to /api/admin/emails/preview into the frame below; Save posts to the action.
 * One language at a time (?lang=, phase 8): every email, the staff one too
 * (R7), and the preview shows the language being edited with its unsaved
 * text (phase-7A ledger A4). email.* is read uncached by the sender, so a save
 * expires no tag (R6) and the next email uses it.
 */
export default async function EmailsPage({ searchParams }: { searchParams: ScreenSearchParams }) {
  await requirePagePermission({ content: ['read'] });
  return (
    <>
      <p className="a-crumbs">
        <Link href="/admin/content">← Nội dung</Link>
      </p>
      <h1>Nội dung email</h1>
      <p className="a-lede">
        Tiêu đề và nội dung email đặt bàn, từng ngôn ngữ một. Bấm “Xem trước” để xem email với một đặt bàn mẫu, bằng chữ đang sửa, trước khi lưu.
      </p>
      <StringsPanel searchParams={searchParams} screen="emails" title="Nội dung email" groups={GROUPS}>
        <fieldset className="a-email-preview-box">
          <legend>Xem trước</legend>
          <div className="a-field">
            <label htmlFor="email-preview-event">Loại email</label>
            <select id="email-preview-event" name="preview_event" defaultValue="guest.confirmed">
              {EMAIL_EVENTS.map((e) => (
                <option key={e} value={e}>
                  {EMAIL_EVENT_LABELS[e]}
                </option>
              ))}
            </select>
          </div>
          <button className="a-btn a-btn--ghost" type="submit" formAction="/api/admin/emails/preview" formMethod="post" formTarget="email-preview">
            Xem trước
          </button>
          <iframe name="email-preview" title="Xem trước email" className="a-email-preview" sandbox="" />
        </fieldset>
      </StringsPanel>
    </>
  );
}
