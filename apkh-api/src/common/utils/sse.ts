import type { Response } from 'express';
import { errorMessage } from './http-error';

/** Parses a server-sent event stream into the JSON payloads of its `data:` lines. */
export async function* readSseJson<T>(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<T> {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const bytes of body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(bytes, { stream: true });
    let end: number;
    while ((end = buffer.indexOf('\n\n')) !== -1) {
      const message = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const data = message
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (data) yield JSON.parse(data) as T;
    }
  }
}

/**
 * Sends events to the browser as server-sent events. The first event is
 * awaited before any header is written, so a failure before the answer starts
 * (bad request, over the plan's limit) still becomes a normal HTTP error.
 * Later failures are sent as an `error` event. `abort` fires if the browser
 * goes away, so the upstream model call can stop.
 */
export async function sendSse(
  res: Response,
  events: AsyncIterator<unknown>,
  abort: AbortController,
): Promise<void> {
  const first = await events.next();

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  res.on('close', () => abort.abort());

  const write = (event: unknown) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  try {
    if (!first.done) write(first.value);
    if (!first.done) {
      for (;;) {
        const next = await events.next();
        if (next.done || abort.signal.aborted) break;
        write(next.value);
      }
    }
  } catch (error) {
    if (!abort.signal.aborted) {
      write({ type: 'error', message: errorMessage(error) });
    }
  } finally {
    res.end();
  }
}
