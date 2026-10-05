/** A library file as ImagePicker offers it (lib/server/content-admin/media-options.ts reads them). */
export type MediaOption = {
  id: string;
  url: string;
  pathname: string;
  /** The EN alt; null when none was written. */
  alt: string | null;
  width: number | null;
  height: number | null;
  isDecorative: boolean;
  kind: 'image' | 'pdf';
};
