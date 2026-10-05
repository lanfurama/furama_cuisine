import { getPool } from '@/db/client';
import type { AdminScreen } from '@/lib/i18n/registry';
import { loadScreenStrings } from '@/lib/server/content/strings-admin';
import { StringsForm, type StringFieldView } from './StringsForm';

/*
 * The registry keys of one screen, in English (spec §7.3: TranslatableField
 * shows only EN until phase 8). A server component: the page has checked the
 * session and content:read before rendering it (admin pages guard).
 */
export async function StringsPanel({ screen, title, children }: { screen: AdminScreen; title: string; children?: React.ReactNode }) {
  const fields = await loadScreenStrings(getPool(), screen);
  const view: StringFieldView[] = fields.map((f) => ({
    key: f.key,
    value: f.value,
    token: f.token,
    overridden: f.overridden,
    en: f.def.en,
    label: f.def.label ?? f.key,
    maxLength: f.def.maxLength,
    vars: [...(f.def.vars ?? [])],
    context: f.def.context,
  }));
  return (
    <StringsForm screen={screen} title={title} fields={view}>
      {children}
    </StringsForm>
  );
}
