'use client';

import { useSite } from '@/components/site/SiteProvider';
import { CmsImage } from '@/components/ui/CmsImage';
import { homeSections } from '@/lib/content/home-sections';
import { parseFilmUrl } from '@/lib/media/film';
import { useOpenAnimation } from '@/lib/motion';

export function FilmModal() {
  const { site, overlay, close, strings } = useSite();
  // The poster is the film section's picture, decorative here whatever its alt (the dialog is named). The
  // video is sections.link_url, a YouTube or Vimeo link (spec §5.2), played from the provider's privacy-
  // friendly player (lib/media/film.ts); a link that names no video plays nothing, and the dialog keeps its
  // "coming soon" poster. Switched off, the hero hides WATCH THE FILM. The words are the hero screen's (film.*).
  const poster = site.sections.film.image;
  const video = parseFilmUrl(site.sections.film.link);
  const open = overlay === 'film' && homeSections(site.sections).has('film');

  useOpenAnimation(open, (animate) => {
    animate(
      '[data-anim="film"]',
      [{ opacity: 0, transform: 'scale(.97)' }, { opacity: 1, transform: 'none' }],
      600,
    );
  });

  if (!open) return null;

  return (
    <div className="film-root" role="dialog" aria-modal="true" aria-label={strings['film.aria']}>
      <button type="button" className="film-backdrop" aria-label={strings['film.close_aria']} onClick={close} />
      <button type="button" className="film-close" aria-label={strings['film.close_aria']} onClick={close}>
        ×
      </button>

      <div data-anim="film" className="film-frame">
        {poster && <CmsImage media={poster} decorative width={poster.width} height={poster.height} sizes="(max-width: 1100px) 100vw, 1100px" className="fill" />}
        {video ? (
          <iframe
            className="fill film-video"
            src={video.embedUrl}
            title={strings['film.player_title']}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            // The players need their own scripts and origin; popups let "Watch on YouTube/Vimeo" open a tab.
            // A cross-origin player: allow-same-origin keeps it on its own origin (YouTube's and Vimeo's players
            // fail without it), never on ours, so the rule's same-origin escape does not apply.
            // oxlint-disable-next-line react/iframe-missing-sandbox
            sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        ) : (
          <div className="film-overlay">
            <span className="film-play">
              <span className="film-play-tri" />
            </span>
            <div className="film-title">{strings['film.title']}</div>
            <div className="film-sub">{strings['film.coming_soon']}</div>
          </div>
        )}
      </div>
    </div>
  );
}
