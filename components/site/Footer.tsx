'use client';

import Link from 'next/link';
import { privacyHref } from '@/lib/legal';
import { useSite } from '@/components/site/SiteProvider';
import { homeHref } from '@/lib/i18n/href';
import { useReveal } from '@/lib/motion';

/** A platform's name as the footer prints it: a brand, so code holds it, untranslated (social_links.platform). */
const SOCIAL_LABELS: Record<string, string> = {
  facebook: 'FACEBOOK',
  instagram: 'INSTAGRAM',
  youtube: 'YOUTUBE',
  tiktok: 'TIKTOK',
  zalo: 'ZALO',
  x: 'X',
  tripadvisor: 'TRIPADVISOR',
  wechat: 'WECHAT',
  kakao: 'KAKAOTALK',
  line: 'LINE',
};

export function Footer() {
  const { goHomeTop, locale, site, strings } = useSite();
  const reveal = useReveal<HTMLDivElement>('fade');
  // The destinations staff mark for the footer, each as "name · address · phone" (destinations.show_in_footer).
  const venues = site.destinations.filter((d) => d.showInFooter);
  const email = site.settings.email;

  return (
    <footer className="footer">
      <div ref={reveal} data-reveal="fade" className="footer-top shell">
        <a
          href={homeHref(locale)}
          className="footer-wordmark"
          onClick={(e) => {
            e.preventDefault();
            goHomeTop();
          }}
        >
          FURAMA CUISINE
        </a>
        <div className="footer-tagline">PEOPLE | CULTURE | GREAT FOOD</div>
        <div className="footer-socials">
          {site.socials.map((s) => (
            <a key={s.platform + s.href} href={s.href} target="_blank" rel="noopener" className="footer-social">
              {SOCIAL_LABELS[s.platform] ?? s.platform.toUpperCase()}
            </a>
          ))}
        </div>
        <div className="footer-member">A MEMBER OF FURAMA</div>
      </div>

      <div className="shell footer-bottom-wrap">
        <div className="footer-bottom">
          {venues.map((d) => {
            const line = [d.name, d.address].filter(Boolean).join(' · ');
            return (
              <span key={d.id}>
                {d.phone ? `${line} · ` : line}
                {d.phone && (
                  <a href={`tel:${d.phone.tel}`} className="footer-strong">
                    {d.phone.display}
                  </a>
                )}
              </span>
            );
          })}
          <a href={`mailto:${email}`} className="footer-strong">
            {email}
          </a>
          {/* e2e/visual-added.css hides this link, so the pre-phase-5 baselines still compare pixel for pixel. */}
          <Link href={privacyHref(locale)} className="footer-strong footer-legal">
            {strings['legal.link']}
          </Link>
        </div>
      </div>

      {/* Clears the fixed mobile tab bar. */}
      <div className="footer-bottom-space" aria-hidden="true" />
    </footer>
  );
}
