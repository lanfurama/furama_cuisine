import { describe, expect, it } from 'vitest';
import { changedFields, restoreChoices, type HistoryRow, type Snap } from './history';

const snap = (row: Record<string, unknown>, i18n: Record<string, unknown>[] = [], extra: Record<string, unknown> = {}) => ({ v: 1, row, i18n, ...extra });
const LABELS = { title: 'Tiêu đề', price_amount: 'Giá', is_published: 'Hiện/ẩn', 'list:highlights': 'Điểm nổi bật' };

describe('history: what changed (spec §7.5)', () => {
  it('names changed row and EN fields in the label order, ignoring bookkeeping', () => {
    const before = snap({ id: 1, price_amount: 1, is_published: true, updated_at: 'a' }, [{ locale: 'en', title: 'A', updated_at: 'a', offer_id: 1 }]);
    const after = snap({ id: 1, price_amount: 2, is_published: true, updated_at: 'b' }, [{ locale: 'en', title: 'B', updated_at: 'b', offer_id: 1 }]);
    expect(changedFields(before, after, LABELS)).toEqual(['Tiêu đề', 'Giá']);
  });

  it('suffixes another language, and names an aggregate’s child list', () => {
    const before = snap({ id: 1 }, [{ locale: 'vi', title: 'A' }], { highlights: [1] });
    const after = snap({ id: 1 }, [{ locale: 'vi', title: 'B' }], { highlights: [1, 2] });
    expect(changedFields(before, after, LABELS)).toEqual(['Tiêu đề (vi)', 'Điểm nổi bật']);
  });

  it('a create or a delete lists nothing (one side is empty)', () => {
    expect(changedFields(null, snap({ id: 1 }), LABELS)).toEqual([]);
  });
});

describe('history: which versions a row offers back', () => {
  const token = (s: Snap) => (s ? JSON.stringify(s.row) : 'deleted');
  const v = (n: number) => snap({ id: 1, n });

  it('never the current version; every row offers the version it made and the one before it', () => {
    const rows: HistoryRow[] = [
      { id: '3', action: 'update', before: v(2), after: v(3) },
      { id: '2', action: 'update', before: v(1), after: v(2) },
    ];
    expect(restoreChoices(rows, token(v(3)), token)).toEqual([
      [{ side: 'before', label: 'Khôi phục bản trước lần này' }],
      [
        { side: 'after', label: 'Khôi phục phiên bản này' },
        { side: 'before', label: 'Khôi phục bản trước lần này' },
      ],
    ]);
  });

  it('after a restore of an older version, the row that restored it offers nothing current', () => {
    const rows: HistoryRow[] = [
      { id: '3', action: 'restore', before: v(2), after: v(1) },
      { id: '2', action: 'update', before: v(1), after: v(2) },
    ];
    expect(restoreChoices(rows, token(v(1)), token)).toEqual([
      [{ side: 'before', label: 'Khôi phục bản trước lần này' }],
      [{ side: 'after', label: 'Khôi phục phiên bản này' }],
    ]);
  });

  it('a deleted record: every version, and the delete row brings back what was deleted', () => {
    const rows: HistoryRow[] = [
      { id: '4', action: 'delete', before: v(2), after: null },
      { id: '3', action: 'update', before: v(1), after: v(2) },
    ];
    expect(restoreChoices(rows, 'deleted', token)).toEqual([
      [{ side: 'before', label: 'Khôi phục mục đã xóa' }],
      [
        { side: 'after', label: 'Khôi phục phiên bản này' },
        { side: 'before', label: 'Khôi phục bản trước lần này' },
      ],
    ]);
  });

  it('a file’s move to Vercel Blob offers nothing back: a restore never writes a file’s url', () => {
    const moved = { ...v(2), meta: { moved_by: 'script:move-assets-to-blob' } };
    const rows: HistoryRow[] = [
      { id: '3', action: 'update', before: v(1), after: moved },
      { id: '2', action: 'update', before: v(0), after: v(1) },
    ];
    expect(restoreChoices(rows, token(v(2)), token)).toEqual([
      [],
      [
        { side: 'after', label: 'Khôi phục phiên bản này' },
        { side: 'before', label: 'Khôi phục bản trước lần này' },
      ],
    ]);
  });

  it('a record created in the admin has no version before its first row', () => {
    expect(restoreChoices([{ id: '1', action: 'create', before: null, after: v(1) }], token(v(1)), token)).toEqual([[]]);
  });
});
