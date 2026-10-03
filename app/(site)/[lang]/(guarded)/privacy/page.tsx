import type { Metadata } from 'next';
import { lang } from 'next/root-params';
import { ViewMarker } from '@/components/site/ViewMarker';
import { formatMessage } from '@/lib/i18n/format';
import { DEFAULT_LOCALE, toBcp47 } from '@/lib/i18n/locales';
import { PRIVACY_POLICY_VERSION, PRIVACY_SECTIONS } from '@/lib/legal';
import { getPrivacyStrings } from '@/lib/server/content/legal';
import { getSiteSettings } from '@/lib/server/content/site';

/*
 * The guest privacy policy (spec §11, Law 91/2025/QH15), linked from the
 * reserve drawer's consent box and the footer. Text from legal.* (registry
 * now, content_strings from phase 7); {email} is the shared inbox
 * (site_settings.email, tagged content:contact), the address the footer
 * shows. Prerendered and cached like every guest page: the (guarded) layout
 * has already checked the language.
 */

async function strings() {
  return getPrivacyStrings((await lang()) ?? DEFAULT_LOCALE);
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await strings();
  const title = `${t['legal.title']} — Furama Cuisine`;
  // A page's openGraph replaces the layout's whole object (generate-metadata.md, "Merging"), so a
  // shared link previews the policy instead of the home page; type is the layout's, carried over.
  return {
    title,
    description: t['legal.intro'],
    openGraph: { title, description: t['legal.intro'], type: 'website' },
  };
}

/** A body whose {email} becomes a mailto link. */
function WithEmail({ template, email }: { template: string; email: string }) {
  const parts = template.split('{email}');
  if (parts.length < 2) return <>{template}</>;
  return (
    <>
      {parts[0]}
      <a href={`mailto:${email}`}>{email}</a>
      {parts.slice(1).join(email)}
    </>
  );
}

export default async function PrivacyPage() {
  const locale = (await lang()) ?? DEFAULT_LOCALE;
  const [t, settings] = await Promise.all([getPrivacyStrings(locale), getSiteSettings()]);
  // A calendar date: format it in UTC so the server's zone cannot move it. English reads day first, as the
  // booking form does ("Thu, 1 Oct"); other languages take their own order (phase 8).
  const updated = new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : toBcp47(locale), {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${PRIVACY_POLICY_VERSION}T00:00:00Z`));

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
