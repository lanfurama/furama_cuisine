import Link from 'next/link';

const LINKS = [
  { href: '/admin/reservations', label: 'Hộp thư' },
  { href: '/admin/reservations/new', label: 'Tạo đặt bàn' },
  { href: '/admin/reservations/day', label: 'Theo ngày' },
  { href: '/admin/reservations/closures', label: 'Ngày đóng cửa' },
] as const;

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
