import { byteLength } from "../utils/jsonBytes";

/** Ceiling of the `state` sent with a remote-assist context update. */
export const MAX_STATE_BYTES = 20_000;

/**
 * The page URL for the support agent. A hash that looks like parameters
 * (`#access_token=...`) is dropped, since sign-in flows put secrets there; a
 * hash route (`#/orders/42`) is kept.
 */
export function pageUrl(location: Pick<Location, "href" | "hash">): string {
  const { href, hash } = location;
  if (!hash || !hash.includes("=")) return href;
  return href.slice(0, href.length - hash.length);
}

/**
 * Keep `state` under {@link MAX_STATE_BYTES}: an object keeps its first keys
 * that fit and gains `_truncated: true`; anything else that does not fit is
 * replaced by a marker.
 */
export function capState(state: unknown, maxBytes = MAX_STATE_BYTES): unknown {
  if (state === undefined) return null;
  let json: string | undefined;
  try {
    json = JSON.stringify(state);
  } catch {
    return { _unserializable: true };
  }
  if (json === undefined) return null;
  if (byteLength(json) <= maxBytes) return state;
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    return { _truncated: true, originalBytes: byteLength(json) };
  }
  const kept: Record<string, unknown> = { _truncated: true };
  for (const [key, value] of Object.entries(state as Record<string, unknown>)) {
    const candidate = { ...kept, [key]: value };
    if (byteLength(JSON.stringify(candidate)) > maxBytes) continue;
    kept[key] = value;
  }
  return kept;
}
