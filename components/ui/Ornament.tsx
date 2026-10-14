import type { Ref } from 'react';

/*
 * The site's ornaments, drawn inline so they take the text colour
 * (stroke="currentColor") and cost no request. All decorative: aria-hidden,
 * no text. Where each motif comes from is in styles/ornament.css.
 */

/** The four-petalled flower of the Mỹ Sơn E1 frieze, centred on (120, 12.5). */
function Rosette() {
  return (
    <>
      <path d="M117 9.5A3.6 3.6 0 1 1 123 9.5A3.6 3.6 0 1 1 123 15.5A3.6 3.6 0 1 1 117 15.5A3.6 3.6 0 1 1 117 9.5Z" />
      <circle cx="120" cy="12.5" r="1.6" />
    </>
  );
}

/** The divider's right half (sepals, scroll, lozenge, hairline, end ring); the left half is its mirror. */
function DividerHalf() {
  return (
    <>
      <path d="M123.7 8.8L125.3 7.2M123.7 16.2L125.3 17.8" />
      <path d="M128.8 12.5H139M131 12.5C133.5 12.5 135.2 10.6 134.4 8.9C133.7 7.5 131.6 7.8 131.8 9.4M131 12.5C133.5 12.5 135.2 14.4 134.4 16.1C133.7 17.5 131.6 17.2 131.8 15.6" />
      <path d="M146 6Q147.6 10.9 153 12.5Q147.6 14.1 146 19Q144.4 14.1 139 12.5Q144.4 10.9 146 6ZM146 9.6L148.9 12.5L146 15.4L143.1 12.5Z" />
      <path d="M153 12.5H230" />
      <circle cx="232.5" cy="12.5" r="1.5" />
    </>
  );
}

/**
 * The divider under a centred section title: the Mỹ Sơn E1 frieze's lozenges
 * and four-petalled flower, between two hairlines. `ref` and `reveal` let a
 * section fade it in with its title (useReveal).
 */
export function FriezeDivider({ className, ref, reveal }: { className?: string; ref?: Ref<HTMLSpanElement>; reveal?: 'fade' }) {
  return (
    <span ref={ref} data-reveal={reveal} className={className ? `orn-divider ${className}` : 'orn-divider'} aria-hidden="true">
      <svg viewBox="0 0 240 25" width="240" height="25" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
        <Rosette />
        <DividerHalf />
        <g transform="matrix(-1 0 0 1 240 0)">
          <DividerHalf />
        </g>
      </svg>
    </span>
  );
}

/** The flower alone, as a small mark (an offer card's corner). */
export function RosetteMark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      aria-hidden="true"
      viewBox="111 3.5 18 18"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="0.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Rosette />
    </svg>
  );
}
