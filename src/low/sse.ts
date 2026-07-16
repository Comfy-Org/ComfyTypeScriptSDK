/**
 * Server-Sent-Events decoding over a `fetch` response body.
 *
 * Deliberately built on `eventsource-parser` over the raw fetch stream, not
 * the `EventSource` global: the global can't send headers (no
 * `Authorization`/`Accept`) and can't be aborted per-request, both of which
 * this transport needs. Mirrors the wire-format contract of `comfy_low.sse`
 * in the Python SDK (a `RawEvent` per frame, `event` defaults to `message`),
 * but the parsing itself is delegated to `eventsource-parser` rather than
 * hand-rolled, since JS has no sans-IO decoder to share between a sync and
 * an async transport the way Python's dual sync/async layers did.
 */

import { EventSourceParserStream } from "eventsource-parser/stream";

export interface RawEvent {
  event: string;
  data: Record<string, unknown>;
}

function parseData(raw: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { raw };
  }
  if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  return { value: parsed };
}

/**
 * Decode a fetch response body into a stream of {@link RawEvent}s.
 *
 * No cursor/replay support by design — the contract carries no `id`/
 * `Last-Event-ID`; a blank `data:` frame (no payload) is dropped, matching
 * the Python decoder.
 */
export async function* iterateSse(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<RawEvent, void, void> {
  const stream = body
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new EventSourceParserStream());

  for await (const message of stream) {
    if (message.data === "") {
      continue;
    }
    yield { event: message.event || "message", data: parseData(message.data) };
  }
}
