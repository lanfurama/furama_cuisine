'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/* Marks the current page; the item list comes from the server, already filtered by role. */
export function NavLinks({ items }: { items: { href: string; label: string }[] }) {
  const pathname = usePathname();
  return (
    <ul>
      {items.map((item) => {
        const current = item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href);
        return (
          <li key={item.href}>
            <Link href={item.href} aria-current={current ? 'page' : undefined}>
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
