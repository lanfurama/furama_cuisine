'use client';

import Link, { useLinkStatus } from 'next/link';
import { usePathname } from 'next/navigation';
import type { NavLinkGroup } from '@/lib/admin/nav';
import { Icon, type IconName } from './_ui/Icon';

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

/*
 * Marks the current page; the groups come from the server (navGroupsFor), already filtered by role. Each heading
 * names its list, so a screen reader's list of lists reads "Vận hành", "Web khách", "Hệ thống".
 */
export function NavLinks({ groups }: { groups: NavLinkGroup[] }) {
  const pathname = usePathname();
  return (
    <>
      {groups.map((group) => (
        <div className="a-nav-group" key={group.id}>
          <p className="a-nav-heading" id={`nav-group-${group.id}`}>
            {group.label}
          </p>
          <ul aria-labelledby={`nav-group-${group.id}`}>
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
