import Link from 'next/link';

const LINKS = [{ href: '/admin/reservations', label: 'Hộp thư' }] as const;

/* The reservations section's own links (spec §7.2), above each of its pages; hidden when printing. */
export function SectionNav({ current }: { current: (typeof LINKS)[number]['href'] }) {
  return (
    <nav className="a-subnav a-noprint" aria-label="Đặt bàn">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} aria-current={l.href === current ? 'page' : undefined}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
