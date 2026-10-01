import type { Metadata } from 'next';
import { getPool } from '@/db/client';
import { findOpenInvitation } from '@/lib/server/auth/staff';
import { AcceptForm } from './AcceptForm';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Nhận lời mời' };

/*
 * Public (the proxy lets it through without a session). The database is read
 * only after `await searchParams`, a request-time API, so the build never runs it.
 */
export default async function AcceptInvitePage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = await searchParams;
  const invitation = typeof token === 'string' ? await findOpenInvitation(getPool(), token) : null;

  return (
    <section className="a-card" aria-labelledby="accept-title">
      <h1 id="accept-title">Nhận lời mời</h1>
      {invitation && typeof token === 'string' ? (
        <AcceptForm token={token} email={invitation.email} />
      ) : (
        <p className="a-alert" role="alert">
          Lời mời không hợp lệ, đã hết hạn hoặc đã bị thu hồi. Hãy nhờ Admin gửi lại lời mời.
        </p>
      )}
    </section>
  );
}
