import 'server-only';
import type { Pool, PoolClient } from 'pg';
import type { EmailEvent } from '@/lib/email/events';
import type { BookingEmailData } from './load';

/*
 * The email of one outbox row, ready for the mailer. Deliberately minimal
 * until the registry templates arrive (phase 5, Task 5): the event and the
 * reference as the subject, plain facts as the body, nothing personal.
 */

export type RenderedEmail = { subject: string; html: string; text: string; replyTo?: string };

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export async function renderOutboxEmail(
  _db: Pool | PoolClient,
  row: { event: EmailEvent; locale: string },
  data: BookingEmailData,
): Promise<RenderedEmail> {
  const subject = `${row.event} ${data.reference}`;
  const text = `${subject}: ${data.restaurantName}, ${data.date} ${data.time}, ${data.guests}`;
  return { subject, text, html: `<p>${escapeHtml(text)}</p>` };
}
