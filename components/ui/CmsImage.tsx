import Image, { type ImageProps } from 'next/image';
import type { Media } from '@/lib/content/types';

type Props = Omit<ImageProps, 'src' | 'alt'> & {
  media: Media;
  /** alt="" whatever the media row says: the text beside or over the image already names it (decorative by role). */
  decorative?: boolean;
};

/**
 * A content image (spec §6.3 item 7): next/image with the media row's URL and
 * its alt in the page's language (already "" for a decorative file). Sizing
 * props (width/height or fill, sizes) stay the caller's: they belong to the
 * layout, not to the file.
 *
 * Only the images that were next/image before phase 6 use it (R3). The plain
 * <img> ones (hero slides, chef, heritage, the restaurant portrait, the film
 * poster) keep <img> with the media URL: the optimizer would re-encode those
 * files and change pixels the visual baselines pin at ratio 0. Phase 7 moves
 * them when it moves the files to Blob and re-takes the baselines.
 */
export function CmsImage({ media, decorative = false, ...rest }: Props) {
  return <Image src={media.url} alt={decorative ? '' : media.alt} {...rest} />;
}
