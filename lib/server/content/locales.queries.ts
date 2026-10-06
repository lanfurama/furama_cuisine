import 'server-only';
import { query } from '@/db/client';

export type SiteLocale = {
  code: string;
  bcp47: string;
  nativeName: string;
  shortLabel: string;
  script: string;
  isDefault: boolean;
  serveMachine: boolean;
};

type Row = {
  code: string;
  bcp47: string;
  native_name: string;
  short_label: string;
  script: string;
  is_default: boolean;
  serve_machine: boolean;
};

/** Enabled languages in display order. Uncached; lib/server/content/locales.ts wraps it. */
export async function loadEnabledLocales(): Promise<SiteLocale[]> {
  const rows = await query<Row>(
    `SELECT code, bcp47, native_name, short_label, script, is_default, serve_machine
       FROM locales
      WHERE is_enabled
      ORDER BY sort_order, code`,
  );
  return rows.map((r) => ({
    code: r.code,
    bcp47: r.bcp47,
    nativeName: r.native_name,
    shortLabel: r.short_label,
    script: r.script,
    isDefault: r.is_default,
    serveMachine: r.serve_machine,
  }));
}

/** Every language in the table, enabled or not: what Draft Mode may preview (C6). Uncached; locales.ts wraps it. */
export async function loadAllLocaleCodes(): Promise<string[]> {
  const rows = await query<{ code: string }>(`SELECT code FROM locales ORDER BY sort_order, code`);
  return rows.map((r) => r.code);
}
