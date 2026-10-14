'use client';

import Link, { useLinkStatus } from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, type IconName } from '../_ui/Icon';

export type NavLinkGroup = { label: string; items: { href: string; label: string }[] };

const ICONS: Record<string, IconName> = {
  '/admin': 'dashboard',
  '/admin/reservations': 'calendar',
  '/admin/restaurants': 'utensils',
  '/admin/content': 'content',
  '/admin/media': 'image',
  '/admin/translations': 'languages',
  '/admin/settings/booking': 'sliders',
  '/admin/settings/notifications': 'mail',
  '/admin/settings/ai': 'sparkles',
  '/admin/users': 'users',
  '/admin/audit': 'history',
};

/*
 * Every admin page renders at request time, so a click waits for the server:
 * the clicked item shows a small spinner until the new page arrives (fixed
 * size, always rendered, faded in after a short delay so a quick page never
 * flickers). aria-hidden: the link's name stays its label.
 */
function Pending() {
  const { pending } = useLinkStatus();
  return <span className={pending ? 'a-nav-pending is-pending' : 'a-nav-pending'} aria-hidden="true" />;
}

/* Marks the current page; the groups come from the server, already filtered by role (empty ones dropped). */
export function NavLinks({ groups }: { groups: NavLinkGroup[] }) {
  const pathname = usePathname();
  return (
    <>
      {groups.map((group) => (
        <div className="a-nav-group" key={group.label}>
          <p className="a-nav-heading">{group.label}</p>
          <ul>
            {group.items.map((item) => {
              const current = item.href === '/admin' ? pathname === '/admin' : pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <li key={item.href}>
                  <Link href={item.href} aria-current={current ? 'page' : undefined}>
                    <Icon name={ICONS[item.href] ?? 'chevron-right'} />
                    <span className="a-nav-label">{item.label}</span>
                    <Pending />
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </>
  );
}
