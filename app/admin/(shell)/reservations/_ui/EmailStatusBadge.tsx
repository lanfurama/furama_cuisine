import { EMAIL_STATUS_LABELS, type EmailStatus } from '@/lib/email/events';

/* An email's status as a coloured label (admin.css .a-status--email-<status>); "Đang gửi" while a sender holds it. */
export function EmailStatusBadge({ status }: { status: EmailStatus }) {
  return <span className={`a-status a-status--email-${status}`}>{EMAIL_STATUS_LABELS[status]}</span>;
}
