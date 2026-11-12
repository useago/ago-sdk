/** Incremental UTF-8 decoder: bytes in, text out, chunk boundaries handled. */
export interface StreamDecoder {
  decode(chunk: Uint8Array): string;
  flush(): string;
}

/**
 * Decode a byte stream chunk by chunk. Uses `TextDecoder` when the runtime has
 * one, and otherwise a small built-in decoder (some React Native engines ship
 * without it). Either way a multi-byte character split across two chunks is
 * held back until its remaining bytes arrive.
 */
export function createStreamDecoder(): StreamDecoder {
  if (typeof TextDecoder !== "undefined") {
    const decoder = new TextDecoder();
    return {
      decode: (chunk) => decoder.decode(chunk, { stream: true }),
      flush: () => decoder.decode(),
    };
  }
  return createFallbackDecoder();
}

/** Exported for tests; prefer {@link createStreamDecoder}. */
export function createFallbackDecoder(): StreamDecoder {
  // Bytes of a character whose tail has not arrived yet.
  let pending: number[] = [];

  return {
    flush() {
      const result = pending.length ? "\ufffd" : "";
      pending = [];
      return result;
    },
    decode(chunk) {
      const bytes = pending.length > 0 ? [...pending, ...chunk] : chunk;
      pending = [];
      let out = "";
      let i = 0;

      while (i < bytes.length) {
        const b = bytes[i];
        const size =
          b < 0x80 ? 1 : b >= 0xf0 ? 4 : b >= 0xe0 ? 3 : b >= 0xc0 ? 2 : 0;

        // Stray continuation byte: emit the replacement char, like TextDecoder.
        if (size === 0) {
          out += "\ufffd";
          i += 1;
          continue;
        }
        if (i + size > bytes.length) {
          pending = Array.from(bytes.slice(i));
          break;
        }

        let code =
          size === 1 ? b : b & (size === 2 ? 0x1f : size === 3 ? 0x0f : 0x07);
        for (let k = 1; k < size; k++)
          code = (code << 6) | (bytes[i + k] & 0x3f);
        out += String.fromCodePoint(code);
        i += size;
      }

      return out;
    },
  };
}
