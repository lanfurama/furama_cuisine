/* Sign-in, accept-invite and reset-password: one centred card, no navigation. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <main className="a-auth">{children}</main>;
}
