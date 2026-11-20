import { AgoStreamError } from "../client/errors";
import { createStreamDecoder } from "./utf8";

/**
 * Read a `text/event-stream` body and hand each parsed `data:` JSON payload to
 * `onData`. Comment lines (`: ping`) are skipped. Resolves when the server
 * closes the stream; rejects when the read fails or `signal` aborts.
 */
export async function readSSEData(
  response: Response,
  onData: (data: unknown) => void,
): Promise<void> {
  let buffer = "";
  const flush = (final: boolean): void => {
    const parts = buffer.split("\n\n");
    buffer = final ? "" : (parts.pop() ?? "");
    for (const part of parts) {
      for (const line of part.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const json = line.slice(5).trim();
        if (!json) continue;
        let data: unknown;
        try {
          data = JSON.parse(json);
        } catch {
          continue;
        }
        onData(data);
      }
    }
  };
  // React Native's built-in fetch has no streaming body: the frames arrive in
  // one piece when the server closes the stream (like SSEHandler does).
  if (!response.body) {
    if (typeof response.text !== "function") {
      throw new AgoStreamError("The live stream has no body.", "stream_no_body");
    }
    buffer = (await response.text()).replace(/\r\n/g, "\n");
    flush(true);
    return;
  }
  const reader = response.body.getReader();
  const decoder = createStreamDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value).replace(/\r\n/g, "\n");
      flush(false);
    }
    flush(true);
  } finally {
    reader.releaseLock();
  }
}
