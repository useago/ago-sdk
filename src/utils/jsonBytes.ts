const encoder = new TextEncoder();

/** UTF-8 byte length of an already serialized JSON string. */
export function byteLength(json: string): number {
  return encoder.encode(json).length;
}

/** Serialized byte cost of a string's contents once embedded in JSON. */
export function jsonStringBytes(text: string): number {
  return byteLength(JSON.stringify(text)) - 2; // minus the surrounding quotes
}

/**
 * Longest practical prefix of `text` that costs at most `maxBytes` bytes once
 * embedded in JSON. Measuring the bare string would miss escaping: quotes and
 * backslashes cost two bytes in the serialized result.
 */
export function sliceJsonStringToBytes(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  let out = "";
  let used = 0;
  for (const character of text) {
    const cost = jsonStringBytes(character);
    if (used + cost > maxBytes) break;
    out += character;
    used += cost;
  }
  return out;
}
