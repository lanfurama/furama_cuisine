import type { Metadata } from 'next';
import { lang } from 'next/root-params';
import { WithEmail } from '@/components/legal/WithEmail';
import { ViewMarker } from '@/components/site/ViewMarker';
import { languageAlternates, ownPageMetadata, pageTitle } from '@/lib/content/seo';
import { formatMessage } from '@/lib/i18n/format';
import { toBcp47 } from '@/lib/i18n/locales';
import { PRIVACY_SECTIONS } from '@/lib/legal';
import { getPolicyVersion, getPrivacyStrings } from '@/lib/server/content/legal';
import { getEnabledLocales, requireEnabledLocale } from '@/lib/server/content/locales';
import { getShareImage } from '@/lib/server/content/seo';
import { getSiteSettings } from '@/lib/server/content/site';
import { getStrings } from '@/lib/server/content/strings';

/*
 * The guest privacy policy (spec §11, Law 91/2025/QH15), linked from the
 * reserve drawer's consent box and the footer. Text from legal.* (registry
 * now, content_strings from phase 7); {email} is the shared inbox
 * (site_settings.email, tagged content:contact), the address the footer
 * shows. Prerendered and cached like every guest page. The page checks the
 * language itself before it reads (requireEnabledLocale): the layout's check
 * runs in parallel, and Intl throws on a segment such as "favicon.ico".
 */

export async function generateMetadata(): Promise<Metadata> {
  // The language first, as the page does (L8-8): no read for a language that is off, or for a segment like favicon.ico.
  const locale = await requireEnabledLocale(await lang());
  const [t, seo, share, enabled] = await Promise.all([
    getPrivacyStrings(locale),
    getStrings(locale, ['seo.page_title']),
    getShareImage(locale),
    getEnabledLocales(),
  ]);
  // A page's openGraph replaces the layout's whole object (generate-metadata.md, "Merging"), so a shared link
  // previews the policy instead of the home page; its picture is the SEO screen's (lib/content/seo.ts).
  const own = ownPageMetadata(pageTitle(seo, t['legal.title'], locale), t['legal.intro'], share);
  // Draft Mode's preview of a language that is off (C6): never indexed, and in no one's hreflang.
  return enabled.some((l) => l.code === locale)
    ? { ...own, alternates: languageAlternates(locale, '/privacy', enabled) }
    : { ...own, robots: { index: false, follow: false }, alternates: null };
}

export default async function PrivacyPage() {
  const locale = await requireEnabledLocale(await lang());
  const [t, settings, policy] = await Promise.all([getPrivacyStrings(locale), getSiteSettings(), getPolicyVersion(locale)]);
  // A calendar date: format it in UTC so the server's zone cannot move it. English reads day first, as the
  // booking form does ("Thu, 1 Oct"); other languages take their own order (phase 8).
  const updated = new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : toBcp47(locale), {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${policy.effectiveOn}T00:00:00Z`));

  return (
    <ViewMarker view="other">
      <article className="shell legal">
        <h1>{t['legal.title']}</h1>
        <p className="legal-updated">{formatMessage(t['legal.updated'], { date: updated })}</p>
        <p>{t['legal.intro']}</p>
        {PRIVACY_SECTIONS.map(([heading, body]) => (
          <section key={heading}>
            <h2>{t[heading]}</h2>
            <p>
              <WithEmail template={t[body]} email={settings.email} />
            </p>
          </section>
        ))}
      </article>
    </ViewMarker>
  );
}
