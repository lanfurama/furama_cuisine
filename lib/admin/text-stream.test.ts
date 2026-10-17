import { describe, expect, it } from 'vitest';
import { readTextStream } from './text-stream';

const bytes = (...chunks: Uint8Array[]) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      for (const chunk of chunks) c.enqueue(chunk);
      c.close();
    },
  });

describe('readTextStream', () => {
  it('hands over the text so far after every chunk, and returns the whole text', async () => {
    const seen: string[] = [];
    const enc = new TextEncoder();
    const text = await readTextStream(bytes(enc.encode('«shorten» '), enc.encode('Tàya '), enc.encode('House')), (t) => seen.push(t));
    expect(text).toBe('«shorten» Tàya House');
    expect(seen).toEqual(['«shorten» ', '«shorten» Tàya ', '«shorten» Tàya House']);
  });

  it('decodes a character split across two chunks', async () => {
    const all = new TextEncoder().encode('Tàya');
    // "à" is two bytes: cut between them.
    const seen: string[] = [];
    const text = await readTextStream(bytes(all.slice(0, 2), all.slice(2)), (t) => seen.push(t));
    expect(text).toBe('Tàya');
    expect(seen.every((t) => !t.includes('�'))).toBe(true);
  });

  it('rejects when the stream is cut (the caller keeps the form as it was)', async () => {
    const cut = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('Hel'));
        c.error(new TypeError('network error'));
      },
    });
    const seen: string[] = [];
    await expect(readTextStream(cut, (t) => seen.push(t))).rejects.toThrow('network error');
  });
});
