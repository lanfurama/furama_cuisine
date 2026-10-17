/**
 * Reads a streamed text/plain body (the writing assistant, R9-23) without any
 * AI package in the browser: after each chunk `onText` gets the text so far.
 * Resolves with the whole text; rejects when the stream is cut (a network
 * error, or the server ending it after a failure), so the caller can keep the
 * form as it was.
 */
export async function readTextStream(body: ReadableStream<Uint8Array>, onText: (text: string) => void): Promise<string> {
  const reader = body.getReader();
  // stream: true keeps a character split across two chunks whole.
  const decoder = new TextDecoder();
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const piece = decoder.decode(value, { stream: true });
    if (!piece) continue;
    text += piece;
    onText(text);
  }
  const rest = decoder.decode();
  if (rest) {
    text += rest;
    onText(text);
  }
  return text;
}
