import type { Metadata } from 'next';
import Link from 'next/link';
import { EMAIL_EVENTS, EMAIL_EVENT_LABELS } from '@/lib/email/events';
import { requirePagePermission } from '@/lib/server/dal/session';
import { StringsPanel } from '../_ui/StringsPanel';

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
 * Phase 7 edits English (R7); the Vietnamese staff email keeps its registry
 * text until phase 8 opens the language tabs. email.* is read uncached by the
 * sender, so a save expires no tag (R6) and the next email uses it.
 */
export default async function EmailsPage() {
  await requirePagePermission({ content: ['read'] });
  return (
    <>
      <p className="a-crumbs">
        <Link href="/admin/content">← Nội dung</Link>
      </p>
      <h1>Nội dung email</h1>
      <p className="a-lede">Tiêu đề và nội dung email đặt bàn (tiếng Anh). Bấm “Xem trước” để xem email với một đặt bàn mẫu trước khi lưu.</p>
      <StringsPanel screen="emails" title="Nội dung email" groups={GROUPS}>
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
          <div className="a-field">
            <label htmlFor="email-preview-locale">Ngôn ngữ</label>
            <select id="email-preview-locale" name="preview_locale" defaultValue="en">
              <option value="en">Tiếng Anh (chữ đang sửa)</option>
              <option value="vi">Tiếng Việt (chữ đã lưu)</option>
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
