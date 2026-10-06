import { getPool } from '@/db/client';
import type { AdminScreen } from '@/lib/i18n/registry';
import { pickerLocales, screenLocale } from '@/lib/server/content-admin/form-locales';
import { loadScreenHistory, loadScreenStrings } from '@/lib/server/content/strings-admin';
import { LocalePicker } from '../../_kit/LocalePicker';
import { StringsHistory } from './StringsHistory';
import { StringsForm, type StringFieldView, type StringGroup } from './StringsForm';

export type ScreenSearchParams = Promise<Record<string, string | string[] | undefined>>;

/*
 * The registry keys of one screen in one language (phase 8: the page's
 * ?lang=, the default language without one or for a code the table lacks),
 * and their History in that language (spec §7.5). A server component: the
 * page has checked the session and content:read before rendering it (admin
 * pages guard). The page's other forms keep their own language tabs.
 */
export async function StringsPanel({
  screen,
  title,
  groups,
  searchParams,
  children,
}: {
  screen: AdminScreen;
  title: string;
  groups?: readonly StringGroup[];
  /** The page's searchParams: ?lang= picks the language. */
  searchParams?: ScreenSearchParams;
  children?: React.ReactNode;
}) {
  const pool = getPool();
  const params = (await searchParams) ?? {};
  const locales = await pickerLocales(pool);
  const locale = screenLocale(locales, params.lang);
  const language = locales.find((l) => l.code === locale);
  const [fields, history] = await Promise.all([loadScreenStrings(pool, screen, locale), loadScreenHistory(pool, screen, locale)]);
  const view: StringFieldView[] = fields.map((f) => ({
    key: f.key,
    value: f.value,
    token: f.token,
    overridden: f.overridden,
    en: f.def.en,
    english: f.english,
    state: f.state,
    label: f.def.label,
    maxLength: f.def.maxLength,
    vars: [...(f.def.vars ?? [])],
    context: f.def.context,
  }));
  const anchor = `strings-${screen}`;
  return (
    <div id={anchor} className="a-strings-panel">
      <LocalePicker locales={locales} current={locale} params={params} hash={anchor} />
      <StringsForm
        // A language is its own form: switching remounts it, never mixing one language's typing into another's save.
        key={locale}
        screen={screen}
        title={title}
        fields={view}
        groups={groups}
        locale={locale}
        localeName={language?.name ?? locale}
        isDefault={language?.isDefault ?? true}
      >
        {children}
      </StringsForm>
      <StringsHistory screen={screen} entries={history} fields={fields} locale={locale} />
    </div>
  );
}
