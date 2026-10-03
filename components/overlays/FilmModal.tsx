'use client';

import { useSite } from '@/components/site/SiteProvider';
import { useOpenAnimation } from '@/lib/motion';

export function FilmModal() {
  const { site, overlay, close } = useSite();
  // The poster is the film section's picture, decorative here whatever its alt (the dialog is named); the
  // video itself (sections.link_url, YouTube or Vimeo) is phase 7's embed. Switched off, the hero hides WATCH THE FILM.
  const poster = site.sections.film.image;
  const open = overlay === 'film' && site.sections.film.visible;

  useOpenAnimation(open, (animate) => {
    animate(
      '[data-anim="film"]',
      [{ opacity: 0, transform: 'scale(.97)' }, { opacity: 1, transform: 'none' }],
      600,
    );
  });

  if (!open) return null;

  return (
    <div className="film-root" role="dialog" aria-modal="true" aria-label="Furama Cuisine film">
      <button type="button" className="film-backdrop" aria-label="Close film" onClick={close} />
      <button type="button" className="film-close" aria-label="Close film" onClick={close}>
        ×
      </button>

      <div data-anim="film" className="film-frame">
        {poster && <img src={poster.url} alt="" className="fill" />}
        <div className="film-overlay">
          <span className="film-play">
            <span className="film-play-tri" />
          </span>
          <div className="film-title">One Furama Cuisine</div>
          <div className="film-sub">THE FILM · COMING SOON</div>
        </div>
      </div>
    </div>
  );
}
