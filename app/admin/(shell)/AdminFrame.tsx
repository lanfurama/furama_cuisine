'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../_ui/Icon';

/*
 * The signed-in frame's moving part. On a wide screen the sidebar simply
 * sits beside the page. Below 960px (admin.css) it becomes a drawer behind
 * the header's "Menu" button: open, it covers the page (made inert, so Tab
 * and a screen reader stay in the menu, whose own "Đóng menu" button closes
 * it), Escape or a tap outside closes it too and gives focus back to "Menu",
 * and moving to another page closes it.
 * The state lives here, in the client; the server parts (the sidebar's links,
 * the header's account block, the page) come in as props.
 */
export function AdminFrame({ sidebar, header, children }: { sidebar: React.ReactNode; header: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLElement>(null);
  const pathname = usePathname();
  // A move to another page closes the drawer: taken during render (no effect), like the forms' own resets.
  const [shownPath, setShownPath] = useState(pathname);
  if (shownPath !== pathname) {
    setShownPath(pathname);
    setOpen(false);
  }

  // Focus goes back to "Menu" once the page is no longer inert, after the render that closed the drawer.
  const refocus = useRef(false);
  const close = () => {
    refocus.current = true;
    setOpen(false);
  };

  useEffect(() => {
    if (!open) {
      if (refocus.current) toggle.current?.focus();
      refocus.current = false;
      return;
    }
    // Into the menu, on the current page's link when there is one.
    const target = drawer.current?.querySelector<HTMLElement>('a[aria-current="page"]') ?? drawer.current?.querySelector<HTMLElement>('a');
    target?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      refocus.current = true;
      setOpen(false);
    };
    // Widened past the drawer's breakpoint while open: the sidebar is a column again, nothing to close.
    const wide = window.matchMedia('(min-width: 961px)');
    const onWide = () => {
      if (wide.matches) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    wide.addEventListener('change', onWide);
    return () => {
      document.removeEventListener('keydown', onKey);
      wide.removeEventListener('change', onWide);
    };
  }, [open]);

  return (
    <div className="a-shell" data-nav={open ? 'open' : 'closed'}>
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
        <main className="a-main">{children}</main>
      </div>
    </div>
  );
}
