/*
 * The film (spec §5.2 sections.link_url: YouTube or Vimeo only; §11 frame-src
 * www.youtube-nocookie.com and player.vimeo.com). An editor pastes whatever
 * link the site gave them; the database keeps that link (008's
 * sections_film_video CHECK accepts the watch/share/player forms), and the
 * guest page derives the embed from it here, so a link that does not name a
 * video plays nothing instead of framing an arbitrary page.
 */

export type FilmVideo = { provider: 'youtube' | 'vimeo'; id: string; embedUrl: string };

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^[0-9]{6,12}$/;
const VIMEO_HASH = /^[0-9a-f]{6,20}$/;

/** The video a link names, with its privacy-friendly embed URL, or null. */
export function parseFilmUrl(raw: string | null | undefined): FilmVideo | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);

  if (host === 'youtu.be' || host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com') {
    let id: string | null = null;
    if (host === 'youtu.be') id = parts[0] ?? null;
    else if (parts[0] === 'watch') id = url.searchParams.get('v');
    else if (parts[0] === 'embed' || parts[0] === 'shorts' || parts[0] === 'live') id = parts[1] ?? null;
    if (!id || !YOUTUBE_ID.test(id)) return null;
    return { provider: 'youtube', id, embedUrl: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0` };
  }

  if (host === 'vimeo.com' || host === 'www.vimeo.com' || host === 'player.vimeo.com') {
    // vimeo.com/123456789, vimeo.com/123456789/abcdef (unlisted), player.vimeo.com/video/123456789?h=abcdef
    const rest = host === 'player.vimeo.com' ? (parts[0] === 'video' ? parts.slice(1) : []) : parts;
    const id = rest[0];
    if (!id || !VIMEO_ID.test(id)) return null;
    const hash = rest[1] ?? url.searchParams.get('h');
    const h = hash && VIMEO_HASH.test(hash) ? `&h=${hash}` : '';
    return { provider: 'vimeo', id, embedUrl: `https://player.vimeo.com/video/${id}?autoplay=1&dnt=1${h}` };
  }

  return null;
}
