import { getImageProps } from 'next/image';

/** What a thumbnail needs of a library file: its URL and its pixel size (none for a PDF). */
export type ThumbFile = { url: string; width: number | null; height: number | null };

/*
 * Every thumbnail and preview of the admin (code rule 6; R18). getImageProps
 * (node_modules/next/dist/docs/01-app/03-api-reference/02-components/image.md:1009-1014)
 * gives next/image's optimiser URLs without <Image>'s inline
 * style="color:transparent", which the admin CSP (style-src with a nonce, no
 * 'unsafe-inline') blocks. The picture is fetched from /_next/image whether the
 * file is in public/assets or in the Blob store, so the admin's img-src stays
 * 'self' (R17). A PDF has no picture: a label instead. The alt is "" unless the
 * caller names one: the link or the heading beside a thumbnail names the file.
 */
export function Thumb({ file, width, alt = '', className = 'a-thumb' }: { file: ThumbFile; width: number; alt?: string; className?: string }) {
  if (!file.width || !file.height) {
    return (
      <span className={`${className} a-thumb--pdf`} aria-hidden="true">
        PDF
      </span>
    );
  }
  const height = Math.max(1, Math.round((width * file.height) / file.width));
  const {
    props: { style: _style, ...img },
  } = getImageProps({ src: file.url, alt, width, height });
  // oxlint-disable-next-line nextjs/no-img-element -- next/image's inline style breaks the admin CSP (R18); same optimiser URLs
  return <img {...img} alt={alt} className={className} />;
}
