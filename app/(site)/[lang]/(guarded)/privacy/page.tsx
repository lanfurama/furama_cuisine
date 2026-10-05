import type { Metadata } from 'next';
import { lang } from 'next/root-params';
import { WithEmail } from '@/components/legal/WithEmail';
import { ViewMarker } from '@/components/site/ViewMarker';
import { ownPageMetadata, pageTitle } from '@/lib/content/seo';
import { formatMessage } from '@/lib/i18n/format';
import { DEFAULT_LOCALE, toBcp47 } from '@/lib/i18n/locales';
import { PRIVACY_SECTIONS } from '@/lib/legal';
import { getPolicyVersion, getPrivacyStrings } from '@/lib/server/content/legal';
import { requireEnabledLocale } from '@/lib/server/content/locales';
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
  const locale = (await lang()) ?? DEFAULT_LOCALE;
  const [t, seo, share] = await Promise.all([getPrivacyStrings(locale), getStrings(locale, ['seo.page_title']), getShareImage(locale)]);
  // A page's openGraph replaces the layout's whole object (generate-metadata.md, "Merging"), so a shared link
  // previews the policy instead of the home page; its picture is the SEO screen's (lib/content/seo.ts).
  return ownPageMetadata(pageTitle(seo, t['legal.title'], locale), t['legal.intro'], share);
}

export default async function PrivacyPage() {
  const locale = await requireEnabledLocale(await lang());
  const [t, settings, policy] = await Promise.all([getPrivacyStrings(locale), getSiteSettings(), getPolicyVersion()]);
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
