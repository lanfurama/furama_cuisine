/*
 * The admin's icons: inline SVG drawn on a 24px grid with currentColor
 * strokes, so they take the text colour of whatever holds them and need no
 * style="" (the admin CSP has no 'unsafe-inline') and no icon package. Always
 * decorative: the button or link around one carries the words, so each is
 * aria-hidden and never focusable.
 */
const PATHS = {
  dashboard: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M8 3v4M16 3v4M3.5 10h17" />
    </>
  ),
  'calendar-check': (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M8 3v4M16 3v4M3.5 10h17M9 15l2 2 4-4" />
    </>
  ),
  'calendar-off': (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M8 3v4M16 3v4M3.5 10h17M10 13.5l4 4M14 13.5l-4 4" />
    </>
  ),
  utensils: <path d="M7 3v18M4.5 3v5a2.5 2.5 0 0 0 5 0V3M18 21V3c-2.2 1.2-3.5 3.8-3.5 7.5V14H18" />,
  content: (
    <>
      <path d="M14 3H6.5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8.5z" />
      <path d="M14 3v5.5h5.5M8.5 13h7M8.5 17h4.5" />
    </>
  ),
  image: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <circle cx="9" cy="10" r="1.75" />
      <path d="M20.5 15.5 15.5 10.5 6 20" />
    </>
  ),
  languages: <path d="M3.5 5.5h9M8 3.5v2M10.5 5.5c-.9 3.8-3.5 7-6.5 8.5M5.5 9c1.4 2.3 3.3 4.1 5.5 5.2M12.5 21l4-9.5 4 9.5M14 17.5h5" />,
  sliders: (
    <>
      <path d="M4 6.5h9M17 6.5h3M4 12h3M11 12h9M4 17.5h11M19 17.5h1" />
      <circle cx="15" cy="6.5" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="17" cy="17.5" r="2" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3.8 6.8 8.2 6 8.2-6" />
    </>
  ),
  sparkles: <path d="M11 3.5l1.7 4.6 4.6 1.7-4.6 1.7L11 16.1l-1.7-4.6-4.6-1.7 4.6-1.7zM18 14.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />,
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.8-3.4 3.4-5.5 6.5-5.5s5.7 2.1 6.5 5.5M15.5 4.6a3.5 3.5 0 0 1 0 6.8M17.8 14.8c1.9.8 3.1 2.6 3.6 5.2" />
    </>
  ),
  history: <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1M3.5 4v4h4M12 7.5V12l3 2" />,
  menu: <path d="M4 6.5h16M4 12h16M4 17.5h16" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  logout: <path d="M14.5 4H18a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3.5M10 16.5 14.5 12 10 7.5M14.5 12H4" />,
  plus: <path d="M12 5v14M5 12h14" />,
  external: <path d="M14 4h6v6M20 4l-8.5 8.5M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />,
  'arrow-right': <path d="M5 12h14M13 6l6 6-6 6" />,
  'chevron-right': <path d="m9.5 6 6 6-6 6" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  alert: <path d="M12 4 2.8 19.5h18.4zM12 10v4.5M12 17.2v.3" />,
  check: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8.3 12.3 2.6 2.6 4.8-5" />
    </>
  ),
  inbox: <path d="M3.5 13.5 6.2 5h11.6l2.7 8.5M3.5 13.5V18a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-4.5M3.5 13.5h5l1.5 2.5h4l1.5-2.5h5" />,
  printer: <path d="M7 9V3.5h10V9M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M7 14h10v6.5H7z" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.3 2.4 3.5 5.2 3.5 8.5s-1.2 6.1-3.5 8.5c-2.3-2.4-3.5-5.2-3.5-8.5s1.2-6.1 3.5-8.5z" />
    </>
  ),
  layers: <path d="m12 3.5 8.5 4.5-8.5 4.5L3.5 8zM3.5 12.5l8.5 4.5 8.5-4.5M3.5 16.5l8.5 4.5 8.5-4.5" />,
  film: (
    <>
      <rect x="3.5" y="4" width="17" height="16" rx="2" />
      <path d="M7.5 4v16M16.5 4v16M3.5 9h4M3.5 15h4M16.5 9h4M16.5 15h4" />
    </>
  ),
  bowl: <path d="M3 11.5h18c0 4.7-4 8.5-9 8.5s-9-3.8-9-8.5zM8 8c0-1.5 1-2 1-3.5M12 8c0-1.5 1-2 1-3.5M16 8c0-1.5 1-2 1-3.5" />,
  pin: (
    <>
      <path d="M12 21s-6.5-5.8-6.5-11a6.5 6.5 0 0 1 13 0c0 5.2-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2.3" />
    </>
  ),
  tag: (
    <>
      <path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1.5 1.5 0 0 1 0 2.1l-6.6 6.6a1.5 1.5 0 0 1-2.1 0z" />
      <circle cx="8" cy="8" r="1.3" />
    </>
  ),
  star: <path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.9L12 17l-5.2 2.7 1-5.9-4.3-4.1 5.9-.9z" />,
  book: <path d="M5 19.5V5.5a2 2 0 0 1 2-2h12.5v14H7a2 2 0 0 0-2 2zm0 0a2 2 0 0 0 2 2h12.5" />,
  landmark: <path d="M3.5 20.5h17M4.5 9.5h15M12 3.5l8 4.5H4zM6.5 9.5v8M10 9.5v8M14 9.5v8M17.5 9.5v8" />,
  list: <path d="M8.5 6.5h12M8.5 12h12M8.5 17.5h12M4 6.5h.01M4 12h.01M4 17.5h.01" />,
  phone: <path d="M5.5 3.5h3l1.6 4.4-2 1.4a11 11 0 0 0 6.6 6.6l1.4-2 4.4 1.6v3a1.5 1.5 0 0 1-1.6 1.5A16.5 16.5 0 0 1 4 5.1a1.5 1.5 0 0 1 1.5-1.6z" />,
  type: <path d="M4.5 7V4.5h15V7M12 4.5v15M9 19.5h6" />,
  shield: <path d="M12 3.5 19.5 6v5.5c0 4.3-3.1 8-7.5 9-4.4-1-7.5-4.7-7.5-9V6z" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </>
  ),
  trend: <path d="M3.5 17 9 11.5l4 4 7.5-7.5M15 8h5.5v5.5" />,
  store: (
    <path d="M4 9.5V20h16V9.5M3 9.5 5 4h14l2 5.5M3 9.5c0 1.4 1.1 2.5 2.5 2.5S8 10.9 8 9.5c0 1.4 1.1 2.5 2.5 2.5h3c1.4 0 2.5-1.1 2.5-2.5 0 1.4 1.1 2.5 2.5 2.5S21 10.9 21 9.5M10 20v-5h4v5" />
  ),
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={className ? `a-icon ${className}` : 'a-icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
