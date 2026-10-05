import Image, { getImageProps, type ImageProps } from 'next/image';
import type { Media } from '@/lib/content/types';

type Props = Omit<ImageProps, 'src' | 'alt' | 'placeholder' | 'blurDataURL'> & {
  media: Media;
  /** alt="" whatever the media row says: the text beside or over the image already names it (decorative by role). */
  decorative?: boolean;
};

/**
 * A content image (spec §6.3 item 7): next/image with the media row's URL and
 * its alt in the page's language (already "" for a decorative file). Sizing
 * props (width/height or fill, sizes) stay the caller's: they belong to the
 * layout, not to the file. An upload carries a blur placeholder
 * (media.blur_data_url, measured by registerMedia); the static files have
 * none, so their markup is what it was in phase 6.
 *
 * A Blob URL is optimised like a local one: next.config.ts lists the store's
 * host in images.remotePatterns. Everything goes through /_next/image, so
 * neither the guest nor the admin CSP needs the Blob host for img-src.
 */
export function CmsImage({ media, decorative = false, ...rest }: Props) {
  const blur = media.blur ? ({ placeholder: 'blur', blurDataURL: media.blur } as const) : {};
  return <Image src={media.url} alt={decorative ? '' : media.alt} {...blur} {...rest} />;
}

/**
 * The hero's art-directed <picture> (spec §6.5: slide 1 has its own phone
 * crop), which next/image cannot draw: the optimised srcSets of both files
 * (node_modules/next/dist/docs/01-app/03-api-reference/02-components/image.md,
 * "Art Direction"). getImageProps cannot take a placeholder.
 */
export function cmsPictureProps(
  desktop: Media,
  mobile: Media | null,
  options: { sizes: string; priority?: boolean; decorative?: boolean },
) {
  const common = { sizes: options.sizes, ...(options.priority ? { loading: 'eager' as const, fetchPriority: 'high' as const } : { loading: 'lazy' as const }) };
  const { props: img } = getImageProps({ ...common, src: desktop.url, alt: options.decorative ? '' : desktop.alt, width: desktop.width, height: desktop.height });
  const mobileSrcSet = mobile ? getImageProps({ ...common, src: mobile.url, alt: '', width: mobile.width, height: mobile.height }).props.srcSet : undefined;
  return { img, mobileSrcSet };
}
