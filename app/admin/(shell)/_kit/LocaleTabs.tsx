'use client';

import { createContext, useContext } from 'react';
import type { TranslationState } from '@/lib/i18n/source-hash';
import type { LocaleTab } from './TranslatableField';

/*
 * The languages of one form and its record's state in each (phase 8,
 * lib/server/content-admin/form-locales.ts): a page wraps each form in
 * <LocaleTabs>, and every TranslatableField inside shows those tabs and
 * badges, so the forms themselves did not change. A field with its own
 * `locales` or `status` keeps them (a restaurant's highlights have their own).
 */
type Tabs = { locales: readonly LocaleTab[]; states?: Record<string, TranslationState> };

const LocaleTabsContext = createContext<Tabs | null>(null);

export function LocaleTabs({ locales, states, children }: Tabs & { children: React.ReactNode }) {
  return <LocaleTabsContext.Provider value={{ locales, states }}>{children}</LocaleTabsContext.Provider>;
}

export function useLocaleTabs(): Tabs | null {
  return useContext(LocaleTabsContext);
}
