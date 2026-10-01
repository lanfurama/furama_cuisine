import type { Metadata } from 'next';
import { RequestForm } from './RequestForm';
import { ResetForm } from './ResetForm';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Đặt lại mật khẩu' };

/* Public. Without ?token= it asks for the email; with one (the emailed link) it sets the new password. */
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = await searchParams;
  return (
    <section className="a-card" aria-labelledby="reset-title">
      <h1 id="reset-title">Đặt lại mật khẩu</h1>
      {typeof token === 'string' && token ? <ResetForm token={token} /> : <RequestForm />}
    </section>
  );
}
