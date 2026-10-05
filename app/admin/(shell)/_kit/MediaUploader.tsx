'use client';

import { uploadPresigned } from '@vercel/blob/client';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react';
import { actionErrorMessage } from '@/lib/admin/auth-errors';
import { MAX_UPLOAD_BYTES, MEDIA_CONTENT_TYPES, isImageType, isMediaContentType, uploadPathname } from '@/lib/media/rules';
import { registerMediaAction } from '../media/actions';

type Row = { name: string; state: 'uploading' | 'registering' | 'done' | 'failed'; message?: string };

/*
 * The two-step upload of spec §11, one file at a time: the browser asks
 * /api/admin/media/upload for a presigned URL and PUTs the file straight to
 * Vercel Blob (uploadPresigned), then registerMediaAction makes the row. The
 * checks here only spare a round trip; the token route, the Blob API and
 * registerMedia each enforce them again. A file whose second step fails stays
 * in the store without a row, and the media-sweep cron removes it a day later
 * (spec §12, R13). The library page uses it; ImagePicker embeds it (R12).
 *
 * No onUploadProgress: with it, @vercel/blob sends the file as a streamed
 * request body in browsers that support one (fetch + ReadableStream, duplex
 * 'half'; node_modules/@vercel/blob/dist/chunk-YYMLUMXS.js blobRequest), and
 * Chromium streams uploads only over HTTP/2 or QUIC, so behind a proxy that
 * speaks HTTP/1.1 every upload would fail. Without it the SDK sends the File
 * as an ordinary body.
 */
/** What one uploader takes: anything the library holds, or (inside an ImagePicker) its kind only. */
const KINDS = {
  any: { types: MEDIA_CONTENT_TYPES, label: 'Chọn ảnh hoặc PDF (tối đa 15 MB mỗi file)', refused: 'Chỉ nhận JPEG, PNG, WebP, AVIF hoặc PDF.' },
  image: { types: MEDIA_CONTENT_TYPES.filter(isImageType), label: 'Tải ảnh mới lên (tối đa 15 MB)', refused: 'Chỉ nhận ảnh JPEG, PNG, WebP hoặc AVIF.' },
  pdf: { types: MEDIA_CONTENT_TYPES.filter((t) => !isImageType(t)), label: 'Tải PDF mới lên (tối đa 15 MB)', refused: 'Chỉ nhận file PDF.' },
} as const;

export function MediaUploader({
  prefix,
  configured,
  onUploaded,
  kind = 'any',
}: {
  prefix: string;
  configured: boolean;
  onUploaded?: (id: string) => void;
  kind?: keyof typeof KINDS;
}) {
  const accepts = KINDS[kind];
  const router = useRouter();
  const uid = useId();
  // The newest onUploaded: an upload takes seconds, and the picker that embeds this re-renders meanwhile
  // (staff keep typing), so calling the callback captured when the file was chosen would apply a stale view.
  const uploaded = useRef(onUploaded);
  useEffect(() => {
    uploaded.current = onUploaded;
  });
  const [rows, setRows] = useState<Row[]>([]);
  const busy = rows.some((r) => r.state === 'uploading' || r.state === 'registering');
  const update = (i: number, patch: Partial<Row>) => setRows((all) => all.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function onChange(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.currentTarget.files ?? [])];
    event.currentTarget.value = '';
    const start = rows.length;
    setRows((all) => [...all, ...files.map((f) => ({ name: f.name, state: 'uploading' as const }))]);
    try {
      for (const [k, file] of files.entries()) {
        const i = start + k;
        if (!isMediaContentType(file.type) || !(accepts.types as readonly string[]).includes(file.type)) {
          update(i, { state: 'failed', message: accepts.refused });
          continue;
        }
        if (file.size > MAX_UPLOAD_BYTES) {
          update(i, { state: 'failed', message: 'File quá lớn (tối đa 15 MB).' });
          continue;
        }
        const pathname = uploadPathname(prefix, crypto.randomUUID(), file.name, file.type);
        try {
          await uploadPresigned(pathname, file, { access: 'public', handleUploadUrl: '/api/admin/media/upload', contentType: file.type });
        } catch {
          update(i, { state: 'failed', message: 'Không tải được file lên kho. Hãy thử lại.' });
          continue;
        }
        update(i, { state: 'registering' });
        let result: Awaited<ReturnType<typeof registerMediaAction>>;
        try {
          result = await registerMediaAction({ pathname });
        } catch {
          // The action never answered (a dropped connection, a deploy): the row fails, the next file still goes, and the input frees up.
          update(i, { state: 'failed', message: 'Không xử lý được file. Hãy thử lại.' });
          continue;
        }
        if (result.ok) {
          update(i, { state: 'done' });
          uploaded.current?.(result.data.id);
        } else {
          update(i, { state: 'failed', message: result.fieldErrors?.file?.[0] ?? actionErrorMessage(result.code, result.params) });
        }
      }
    } finally {
      router.refresh();
    }
  }

  if (!configured) {
    return (
      <p className="a-alert" role="alert">
        {actionErrorMessage('blob_not_configured')}
      </p>
    );
  }

  return (
    <div className="a-uploader">
      <div className="a-field">
        <label htmlFor={`${uid}-input`}>{accepts.label}</label>
        <input
          id={`${uid}-input`}
          type="file"
          multiple={kind === 'any'}
          accept={accepts.types.join(',')}
          onChange={onChange}
          disabled={busy}
          aria-describedby={`${uid}-status`}
        />
      </div>
      <ul id={`${uid}-status`} className="a-list" aria-label="Tiến trình tải lên" aria-live="polite">
        {rows.map((r, i) => (
          <li key={`${i}-${r.name}`} className="a-list-item">
            <span>{r.name}</span>{' '}
            {r.state === 'uploading' && <span className="a-muted">Đang tải lên…</span>}
            {r.state === 'registering' && <span className="a-muted">Đang xử lý…</span>}
            {r.state === 'done' && <span className="a-tag">Đã thêm vào thư viện</span>}
            {r.state === 'failed' && <span className="a-error-text">{r.message}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
