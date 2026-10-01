'use client';

import { CONTACT, SOCIALS } from '@/lib/data';
import { useSite } from '@/components/site/SiteProvider';
import { homeHref } from '@/lib/i18n/href';
import { useReveal } from '@/lib/motion';

export function Footer() {
  const { goHomeTop, locale } = useSite();
  const reveal = useReveal<HTMLDivElement>('fade');

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
          {SOCIALS.map((s) => (
            <a key={s.label} href={s.href} target="_blank" rel="noopener" className="footer-social">
              {s.label}
            </a>
          ))}
        </div>
        <div className="footer-member">A MEMBER OF FURAMA</div>
      </div>

      <div className="shell footer-bottom-wrap">
        <div className="footer-bottom">
          <span>
            Furama Resort Danang · 103–105 Võ Nguyên Giáp, Ngũ Hành Sơn, Đà Nẵng ·{' '}
            <a href={`tel:${CONTACT.resortPhone}`} className="footer-strong">
              {CONTACT.resortPhoneLabel}
            </a>
          </span>
          <span>
            Furama Dining House · 73 Trần Bạch Đằng, An Thượng ·{' '}
            <a href={`tel:${CONTACT.diningHousePhone}`} className="footer-strong">
              {CONTACT.diningHousePhoneLabel}
            </a>
          </span>
          <a href={`mailto:${CONTACT.email}`} className="footer-strong">
            {CONTACT.email}
          </a>
        </div>
      </div>

      {/* Clears the fixed mobile tab bar. */}
      <div className="footer-bottom-space" aria-hidden="true" />
    </footer>
  );
}
