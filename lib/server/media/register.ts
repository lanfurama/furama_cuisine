import 'server-only';
import type { Pool } from 'pg';
import { MAX_UPLOAD_BYTES, parseUploadPathname } from '@/lib/media/rules';
import type { AuditActor } from '@/lib/server/audit';
import { deleteBlobs, downloadBlob, envPrefix, headBlob } from './blob';
import { registerMediaRow } from './library';
import { measureMedia, type MeasureFailure } from './measure';

/*
 * registerMedia's work (spec §11 step 2), apart from the Server Action's
 * permission check and cache expiry: trust nothing the browser says beyond the
 * pathname. The store says the file exists, how big it is and where it is
 * served (head); the bytes say what it is and how large it draws (measure).
 * A file that fails is deleted from the store at once (it can never get a
 * row); one whose deletion fails is left to the media-sweep cron (spec §12).
 */

export type RegisterResult =
  | { ok: true; data: { id: string; created: boolean } }
  | { ok: false; code: 'invalid'; fieldErrors: { file: string[] } };

const MESSAGES: Record<MeasureFailure | 'pathname' | 'missing', string> = {
  pathname: 'Đường dẫn file không hợp lệ cho môi trường này.',
  missing: 'Không tìm thấy file vừa tải lên. Hãy tải lại.',
  type_mismatch: 'Nội dung file không đúng định dạng (chỉ nhận JPEG, PNG, WebP, AVIF hoặc PDF).',
  unreadable: 'Không đọc được ảnh (file hỏng hoặc chưa tải xong).',
  too_large: 'File quá lớn (tối đa 15 MB, mỗi cạnh tối đa 20 000 px).',
};

const invalid = (key: keyof typeof MESSAGES): RegisterResult => ({ ok: false, code: 'invalid', fieldErrors: { file: [MESSAGES[key]] } });

export async function registerUploadedMedia(
  pool: Pool,
  actor: AuditActor,
  input: { pathname: string; alt?: string | null; decorative?: boolean },
): Promise<RegisterResult> {
  const type = parseUploadPathname(envPrefix(), input.pathname);
  if (!type) return invalid('pathname');
  const stored = await headBlob(input.pathname);
  if (!stored) return invalid('missing');
  const discard = async () => deleteBlobs([stored.url]).catch(() => undefined);
  if (stored.size > MAX_UPLOAD_BYTES) {
    await discard();
    return invalid('too_large');
  }
  const measured = await measureMedia(await downloadBlob(stored.url), type);
  if ('error' in measured) {
    await discard();
    return invalid(measured.error);
  }
  return registerMediaRow(pool, actor, { pathname: stored.pathname, url: stored.url, measured, alt: input.alt, decorative: input.decorative });
}
