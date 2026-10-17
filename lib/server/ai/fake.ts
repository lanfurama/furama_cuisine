import 'server-only';
import { APICallError, simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';

type LanguageModelV4Prompt = Parameters<MockLanguageModelV4['doGenerate']>[0]['prompt'];

/*
 * The stand-in model for dev, CI and E2E (AI_PROVIDER=fake, R9-1): answers are
 * predictable and never leave the process. The call kind is the first line of
 * the instructions ("TASK: translate|assist|seo|alt|check"; the modules that
 * make the calls put it there). A translate call also carries "TARGET: <locale code>".
 *
 *   AI_FAKE_FAIL=<feature>:<status>      that feature's calls throw an APICallError with the status
 *   AI_FAKE_FAIL=<feature>:<status>@<n>  only the nth call of that feature does (a bulk job that
 *                                        stops part-way); the count restarts on resetFake or a new flag
 *   AI_FAKE_DROP_TOKEN=1              the fake translation drops the ⟦G1⟧ token
 *
 * Both are read at call time, so a test route can flip them in the running
 * server through setFakeFlags/resetFake (an override beats the environment).
 */
export type FakeFlags = { fail?: string | null; dropToken?: boolean };
/*
 * Kept on globalThis: Next may bundle this module once per route, and the test
 * route that flips a flag must reach the instance the AI routes use.
 */
const g = globalThis as typeof globalThis & { aiFakeState?: { flags: FakeFlags; calls?: Record<string, number> } };
const state = (g.aiFakeState ??= { flags: {} });

export function setFakeFlags(flags: FakeFlags): void {
  state.flags = { ...state.flags, ...flags };
  if ('fail' in flags) state.calls = {};
}
export function resetFake(): void {
  state.flags = {};
  state.calls = {};
}

const USAGE = {
  inputTokens: { total: 100, noCache: 100, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 50, text: 50, reasoning: undefined },
};
const STOP = { unified: 'stop', raw: undefined } as const;

type Kind = 'translate' | 'assist' | 'seo' | 'alt' | 'check' | 'unknown';

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((p) => (p && (p as { type?: string }).type === 'text' ? String((p as { text: string }).text) : '')).join('');
}

function read(prompt: LanguageModelV4Prompt): { instructions: string; user: string; kind: Kind } {
  const instructions = prompt.filter((m) => m.role === 'system').map((m) => textOf(m.content)).join('\n');
  const user = prompt.filter((m) => m.role === 'user').map((m) => textOf(m.content)).join('\n');
  const m = /^\s*TASK:\s*(translate|assist|seo|alt|check)\b/.exec(instructions);
  return { instructions, user, kind: (m?.[1] as Kind | undefined) ?? 'unknown' };
}

function maybeFail(kind: Kind): void {
  const calls = (state.calls ??= {});
  calls[kind] = (calls[kind] ?? 0) + 1;
  const spec = state.flags.fail !== undefined ? state.flags.fail : process.env.AI_FAKE_FAIL;
  if (!spec) return;
  const [feature, rest = ''] = spec.split(':');
  if (feature !== kind && feature !== '*') return;
  const [status, nth] = rest.split('@');
  if (nth !== undefined && Number(nth) !== calls[kind]) return;
  const n = Number(status);
  const statusCode = Number.isInteger(n) && n >= 100 && n <= 599 ? n : 500;
  throw new APICallError({ message: `fake ${statusCode}`, url: 'fake://vertex', requestBodyValues: {}, statusCode, isRetryable: false });
}

const dropToken = () => (state.flags.dropToken !== undefined ? state.flags.dropToken : process.env.AI_FAKE_DROP_TOKEN === '1');

function reply(prompt: LanguageModelV4Prompt): string {
  const { instructions, user, kind } = read(prompt);
  if (kind === 'translate') {
    const locale = /^\s*TARGET:\s*(\S+)\s*$/m.exec(instructions)?.[1];
    if (!locale) throw new Error('fake model: a translate call needs a "TARGET: <locale code>" line in its instructions');
    const drop = dropToken();
    const doc = JSON.parse(user.slice(user.indexOf('{'))) as { items: { id: string; text: string }[] };
    return JSON.stringify({ items: doc.items.map((i) => ({ id: i.id, text: `«${locale}» ${drop ? i.text.replace('⟦G1⟧', '') : i.text}` })) });
  }
  if (kind === 'seo') return JSON.stringify({ title: 'Fake title', description: 'Fake description' });
  if (kind === 'alt') return 'A fake description of the image.';
  if (kind === 'assist') return `«${/^\s*ACTION:\s*(\w+)/m.exec(instructions)?.[1] ?? 'assist'}» ${user}`;
  if (kind === 'check' && user.includes('{"ok"')) return '{"ok":true}';
  return 'OK';
}

/** A fresh fake per call site; `modelId` only labels it. */
export function fakeModel(modelId = 'fake'): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    provider: 'fake',
    modelId,
    doGenerate: async ({ prompt }) => {
      maybeFail(read(prompt).kind);
      return { content: [{ type: 'text', text: reply(prompt) }], finishReason: STOP, usage: USAGE, warnings: [] };
    },
    doStream: async ({ prompt }) => {
      maybeFail(read(prompt).kind);
      const text = reply(prompt);
      const size = Math.max(1, Math.ceil(text.length / 3));
      const parts = [text.slice(0, size), text.slice(size, 2 * size), text.slice(2 * size)];
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: 'text-start' as const, id: 't' },
            ...parts.map((delta) => ({ type: 'text-delta' as const, id: 't', delta })),
            { type: 'text-end' as const, id: 't' },
            { type: 'finish' as const, finishReason: STOP, usage: USAGE },
          ],
        }),
      };
    },
  });
}
