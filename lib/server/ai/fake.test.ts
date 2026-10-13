import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { generateText, Output, streamText } from 'ai';
import { z } from 'zod';
import { fakeModel, resetFake, setFakeFlags } from './fake';

beforeAll(() => {
  vi.stubGlobal('fetch', async (url: RequestInfo | URL) => {
    throw new Error(`unexpected network call to ${String(url)}`);
  });
});
afterAll(() => vi.unstubAllGlobals());
afterEach(() => {
  resetFake();
  delete process.env.AI_FAKE_FAIL;
  delete process.env.AI_FAKE_DROP_TOKEN;
});

const schema = z.object({ items: z.array(z.object({ id: z.string(), text: z.string() })) });
const translate = (target = 'Vietnamese', items = [{ id: 'a', text: 'Hello ⟦G1⟧' }]) =>
  generateText({
    model: fakeModel(),
    instructions: `TASK: translate\nTranslate each item's text from English to ${target}.`,
    prompt: JSON.stringify({ items }),
    output: Output.object({ schema }),
    maxRetries: 0,
  });

describe('fake model', () => {
  it('translates by prefixing the locale and keeps tokens', async () => {
    const r = await translate();
    expect(r.output.items).toEqual([{ id: 'a', text: '«vi» Hello ⟦G1⟧' }]);
    expect(r.totalUsage).toMatchObject({ inputTokens: 100, outputTokens: 50 });
    expect((await translate('Simplified Chinese')).output.items[0].text).toMatch(/^«zh-hans» /);
    expect((await translate('Brazilian Portuguese')).output.items[0].text).toMatch(/^«pt-br» /);
  });
  it('answers seo, alt and check', async () => {
    const run = (task: string) => generateText({ model: fakeModel(), instructions: `TASK: ${task}`, prompt: 'x', maxRetries: 0 });
    expect(JSON.parse((await run('seo')).text)).toEqual({ title: 'Fake title', description: 'Fake description' });
    expect((await run('alt')).text).toBe('A fake description of the image.');
  });
  it('streams the assist answer in three parts', async () => {
    const r = streamText({ model: fakeModel(), instructions: 'TASK: assist\nACTION: shorten', prompt: 'Long text here', maxRetries: 0 });
    const parts: string[] = [];
    for await (const d of r.textStream) parts.push(d);
    expect(parts).toHaveLength(3);
    expect(parts.join('')).toBe('«shorten» Long text here');
  });

  it('AI_FAKE_FAIL=<feature>:<status> fails only that feature, with that status', async () => {
    process.env.AI_FAKE_FAIL = 'translate:429';
    await expect(translate()).rejects.toMatchObject({ statusCode: 429 });
    await expect(generateText({ model: fakeModel(), instructions: 'TASK: alt', prompt: 'x', maxRetries: 0 })).resolves.toBeDefined();
  });
  it('AI_FAKE_DROP_TOKEN=1 drops ⟦G1⟧', async () => {
    process.env.AI_FAKE_DROP_TOKEN = '1';
    expect((await translate()).output.items[0].text).toBe('«vi» Hello ');
  });
  it('setFakeFlags overrides the environment until resetFake', async () => {
    setFakeFlags({ fail: 'translate:503' });
    await expect(translate()).rejects.toMatchObject({ statusCode: 503 });
    setFakeFlags({ fail: null });
    await expect(translate()).resolves.toBeDefined();
    setFakeFlags({ dropToken: true });
    expect((await translate()).output.items[0].text).toBe('«vi» Hello ');
    resetFake();
    expect((await translate()).output.items[0].text).toBe('«vi» Hello ⟦G1⟧');
  });
});
