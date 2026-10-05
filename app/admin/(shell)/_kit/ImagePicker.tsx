'use client';

import Link from 'next/link';
import { useId, useState } from 'react';
import type { MediaOption } from '@/lib/admin/media-option';
import { MediaUploader } from './MediaUploader';
import { Thumb } from './Thumb';

/*
 * Picks a file from the media library, or uploads one (spec §7.3 ImagePicker,
 * R12). The choices are native radio buttons in a fieldset, so the keyboard
 * and screen readers get a group for free; the list and the uploader sit in a
 * <details> so a form with several pickers stays short. An upload lands in the
 * library (MediaUploader refreshes the page, so the new file is a choice) and
 * is picked at once.
 *
 * Alt text and the decorative flag belong to the file, shared by every use,
 * so they are shown here and edited on the file's own screen (R12), linked in
 * a new tab so this form keeps what was typed. A file a row still uses after
 * it left the library stays selected (posted from a hidden input) and says
 * so: the save then refuses it (code rule 2).
 */
export function ImagePicker({
  name,
  label,
  options,
  value,
  required,
  error,
  hint,
  kind = 'image',
  upload,
  onChange,
}: {
  /** The posted field; omit when `onChange` keeps the value (a list posting JSON). */
  name?: string;
  label: string;
  options: readonly MediaOption[];
  value: string | null;
  required?: boolean;
  error?: string;
  hint?: string;
  kind?: 'image' | 'pdf';
  /** The library's upload target (envPrefix(), isBlobConfigured()); omitted, the picker only picks. */
  upload?: { prefix: string; configured: boolean };
  onChange?: (id: string | null) => void;
}) {
  const uid = useId();
  const [own, setOwn] = useState(value);
  const selected = onChange ? value : own;
  const pick = (id: string | null) => (onChange ? onChange(id) : setOwn(id));
  const current = options.find((o) => o.id === selected) ?? null;
  const gone = selected !== null && selected !== '' && !current;
  const group = name ?? `${uid}-pick`;
  const errorId = `${uid}-error`;
  const hintId = `${uid}-hint`;
  const noun = kind === 'pdf' ? 'file PDF' : 'ảnh';
  const describedBy = [hint && hintId, error && errorId].filter(Boolean).join(' ') || undefined;

  return (
    <fieldset className="a-picker" aria-describedby={describedBy} aria-invalid={error ? true : undefined}>
      <legend>
        {label}
        {required ? <span className="a-muted"> · bắt buộc</span> : null}
      </legend>
      {hint ? (
        <p className="a-muted" id={hintId}>
          {hint}
        </p>
      ) : null}
      <div className="a-picker-current">
        {current ? (
          <>
            <Thumb file={current} width={72} className="a-picker-thumb" />
            <div>
              <p>{fileName(current.pathname)}</p>
              {kind === 'image' ? (
                <p className="a-muted">{current.isDecorative ? 'Ảnh trang trí (alt trống)' : `Alt (EN): ${current.alt ?? '— chưa có'}`}</p>
              ) : null}
              <p>
                <Link href={`/admin/media/${current.id}`} target="_blank" rel="noopener">
                  {kind === 'image' ? 'Sửa alt và cờ trang trí của ảnh này' : 'Xem file này trong thư viện'}
                </Link>
              </p>
            </div>
          </>
        ) : gone ? (
          <p className="a-warn">{kind === 'pdf' ? 'File' : 'Ảnh'} đang dùng đã bị gỡ khỏi thư viện. Hãy chọn {noun} khác.</p>
        ) : (
          <p className="a-muted">Chưa chọn {noun}.</p>
        )}
      </div>
      {gone && name ? <input type="hidden" name={name} value={selected ?? ''} /> : null}
      <details className="a-picker-list">
        <summary>
          Chọn {noun} khác ({options.length} {noun} trong thư viện)
        </summary>
        <div className="a-picker-grid">
          {!required ? (
            <label className="a-picker-option">
              <input type="radio" name={group} value="" checked={!selected} onChange={() => pick(null)} />
              <span>Không dùng {noun}</span>
            </label>
          ) : null}
          {options.map((o) => (
            <label key={o.id} className="a-picker-option">
              <input type="radio" name={group} value={o.id} checked={selected === o.id} onChange={() => pick(o.id)} />
              <Thumb file={o} width={72} className="a-picker-thumb" />
              <span>{fileName(o.pathname)}</span>
            </label>
          ))}
        </div>
        {upload ? <MediaUploader prefix={upload.prefix} configured={upload.configured} kind={kind} onUploaded={pick} /> : null}
      </details>
      {error ? (
        <p className="a-field-error" id={errorId}>
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

const fileName = (pathname: string) => pathname.split('/').pop() ?? pathname;
