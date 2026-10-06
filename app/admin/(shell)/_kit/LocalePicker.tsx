/*
 * Which language a strings screen edits (phase 8, spec §7.3): a row of plain
 * links to ?lang=<code>, the page's other parameters kept. Plain <a>, not
 * next/link: a full load, so a form with unsaved typing asks first through
 * its beforeunload guard (useLeaveGuard), which a soft navigation would skip.
 * The hash brings the reader back to the panel the picker sits in.
 */

export type PickerLocale = { code: string; name: string; isEnabled: boolean };

export function localeSearch(params: Record<string, string | string[] | undefined>, code: string): string {
  const out = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (name === 'lang' || value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) out.append(name, v);
  }
  out.set('lang', code);
  return `?${out.toString()}`;
}

export function LocalePicker({
  locales,
  current,
  params,
  hash,
}: {
  locales: readonly PickerLocale[];
  current: string;
  params: Record<string, string | string[] | undefined>;
  hash: string;
}) {
  if (locales.length < 2) return null;
  return (
    <nav className="a-locale-picker" aria-label="Ngôn ngữ đang sửa">
      {locales.map((l) => (
        <a key={l.code} href={`${localeSearch(params, l.code)}#${hash}`} aria-current={l.code === current ? 'true' : undefined} className="a-tag">
          {l.name}
          {l.isEnabled ? '' : ' (đang tắt)'}
        </a>
      ))}
    </nav>
  );
}
