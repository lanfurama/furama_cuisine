'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Icon } from './_ui/Icon';

/*
 * The signed-in frame's moving part. On a wide screen the sidebar simply
 * sits beside the page. Below 960px (admin.css) it becomes a drawer behind
 * the header's "Menu" button: open, it covers the page (made inert, so Tab
 * and a screen reader stay in the menu, whose own "Đóng menu" button closes
 * it), Escape or a tap outside closes it too and gives focus back to "Menu",
 * and moving to another page closes it and puts focus on that page's <main>
 * (a link to the page already shown closes it the same way). The skip link
 * comes first, ahead of the sidebar's links, and is left out while the
 * drawer is open (the page it jumps to is inert then).
 * The state lives here, in the client; the server parts (the sidebar's links,
 * the header's account block, the page) come in as props.
 */
export function AdminFrame({ sidebar, header, children }: { sidebar: React.ReactNode; header: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLElement>(null);
  const main = useRef<HTMLElement>(null);
  const pathname = usePathname();
  // A move to another page closes the drawer: taken during render (no effect), like the forms' own resets.
  const [shownPath, setShownPath] = useState(pathname);
  if (shownPath !== pathname) {
    setShownPath(pathname);
    setOpen(false);
  }

  // Where focus goes once the page is no longer inert, after the render that closed the drawer: back to "Menu"
  // (Escape, "Đóng menu", a tap outside) or onto the page (a link followed). Unset (widened past the drawer) leaves it.
  const after = useRef<'menu' | 'page' | null>(null);
  // The page the drawer was opened on: closed on another one, a link was followed.
  const openedOn = useRef<string | null>(null);
  const close = () => {
    after.current = 'menu';
    setOpen(false);
  };

  useEffect(() => {
    if (!open) {
      const to = after.current ?? (openedOn.current !== null && openedOn.current !== pathname ? 'page' : null);
      if (to === 'menu') toggle.current?.focus();
      if (to === 'page') main.current?.focus({ preventScroll: true });
      after.current = null;
      openedOn.current = null;
      return;
    }
    openedOn.current = pathname;
    // Into the menu, on the current page's link when there is one.
    const target = drawer.current?.querySelector<HTMLElement>('a[aria-current="page"]') ?? drawer.current?.querySelector<HTMLElement>('a');
    target?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      after.current = 'menu';
      setOpen(false);
    };
    // A link to the page already shown (the brand on the overview, the current item, another tab of it) changes
    // no path, so the render above would leave the drawer open: the click closes it. Enter on a link clicks too;
    // a modified click opens a tab and leaves it open.
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(link instanceof HTMLAnchorElement) || link.target === '_blank' || new URL(link.href).pathname !== pathname) return;
      after.current = 'page';
      setOpen(false);
    };
    // Widened past the drawer's breakpoint while open: the sidebar is a column again, nothing to close. The same
    // query as admin.css, negated, so a fractional width (a zoomed window) never falls between two queries.
    const narrow = window.matchMedia('(max-width: 960px)');
    const onResize = () => {
      if (!narrow.matches) setOpen(false);
    };
    const aside = drawer.current;
    document.addEventListener('keydown', onKey);
    aside?.addEventListener('click', onClick);
    narrow.addEventListener('change', onResize);
    // A widening between the click and this effect fired no change event.
    onResize();
    return () => {
      document.removeEventListener('keydown', onKey);
      aside?.removeEventListener('click', onClick);
      narrow.removeEventListener('change', onResize);
    };
  }, [open, pathname]);

  return (
    <div className="a-shell" data-nav={open ? 'open' : 'closed'}>
      {open ? null : (
        <a className="a-skip" href="#admin-main">
          Bỏ qua đến nội dung chính
        </a>
      )}
      <aside className="a-sidebar" id="admin-sidebar" ref={drawer}>
        <button className="a-drawer-close" type="button" onClick={close}>
          <Icon name="close" size={20} />
          <span className="a-visually-hidden">Đóng menu</span>
        </button>
        {sidebar}
      </aside>
      {/* Pointer only: the keyboard closes the drawer with Escape. */}
      <div className="a-scrim" aria-hidden="true" onClick={close} />
      <div className="a-main-col" inert={open || undefined}>
        <header className="a-header">
          <button ref={toggle} className="a-menu-btn" type="button" aria-expanded={open} aria-controls="admin-sidebar" onClick={() => setOpen(true)}>
            <Icon name="menu" size={20} />
            <span className="a-visually-hidden">Menu</span>
          </button>
          {header}
        </header>
        <main className="a-main" id="admin-main" tabIndex={-1} ref={main}>
          {children}
        </main>
      </div>
    </div>
  );
}
