'use client';

/* window.print() needs a click handler: an inline onclick="" would break the admin CSP (no 'unsafe-inline'). */
export function PrintButton() {
  return (
    <button className="a-btn" type="button" onClick={() => window.print()}>
      In bảng
    </button>
  );
}
