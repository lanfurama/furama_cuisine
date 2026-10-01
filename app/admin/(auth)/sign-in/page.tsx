import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { safeAdminNext } from '@/lib/admin/paths';
import { getStaffSession } from '@/lib/server/dal/session';
import { SignInForm } from './SignInForm';

// Request-time like the whole admin (app/admin/layout.tsx); also opts navigations between admin pages out of dev instant validation (instant-navigation.md:568).
export const instant = false;

export const metadata: Metadata = { title: 'Đăng nhập' };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const { next } = await searchParams;
  const target = typeof next === 'string' ? next : undefined;
  if (await getStaffSession()) redirect(safeAdminNext(target));

  return (
    <section className="a-card" aria-labelledby="sign-in-title">
      <h1 id="sign-in-title">Đăng nhập</h1>
      <p className="a-lede">Trang quản trị Furama Cuisine</p>
      <SignInForm next={target} />
      <p className="a-card-foot">
        <Link href="/admin/reset-password">Quên mật khẩu?</Link>
      </p>
    </section>
  );
}
