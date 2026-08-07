import { logger } from "../utils/logger";
import type { AgoPageDataSource } from "./types";

/** Gap between two settle checks, in ms. */
const SETTLE_POLL_MS = 50;
/** Consecutive non-loading checks required before the snapshot is read. */
const SETTLE_STABLE_TICKS = 2;
/** Default ceiling on how long we wait for the page to stop reloading. */
export const DEFAULT_SETTLE_TIMEOUT_MS = 10_000;
/** Upper bound on the preview a non-list snapshot keeps when it overflows. */
const PREVIEW_CHARS = 2_000;

const encoder = new TextEncoder();

/** Serialized size of a JSON string, the unit every budget here is measured in. */
export function byteLength(json: string): number {
  return encoder.encode(json).length;
}

function safeStringify(value: unknown): string | undefined {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

/** Resolves to `timedOut` if `promise` has not settled within `ms`. */
const timedOut = Symbol("ago.pageData.timeout");
function withDeadline<T>(
  promise: Promise<T>,
  ms: number
): Promise<T | typeof timedOut> {
  if (ms <= 0) return Promise.resolve(timedOut);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(timedOut), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/**
 * Read the page snapshot once the work the control change triggered has
 * finished.
 *
 * `set()` returns before the framework has committed and before the refetch it
 * triggered has even left, so reading `get()` straight after hands the agent
 * the rows from its *previous* search. Two ways out, in order of preference:
 *
 * - `get()` returns a promise: awaiting it *is* the completion signal. Nothing
 *   is polled and nothing is assumed about timing. Bounded by `timeoutMs`.
 * - `isLoading` is declared: we poll it and treat two consecutive `false`
 *   readings as settled. A heuristic, and the reason the first form is better:
 *   a flag raised later than ~100 ms after the change is missed entirely.
 *
 * The short commit window runs in both cases, because `get`/`isLoading` are
 * read from the latest render and React has usually not committed yet when
 * `set()` returns. `source()` is re-read on every tick for the same reason:
 * the callbacks must come from the newest render, not from the closure
 * captured at registration.
 */
export async function readWhenSettled(
  source: () => AgoPageDataSource,
  timeoutMs: number
): Promise<unknown> {
  const deadline = Date.now() + timeoutMs;
  let stableTicks = 0;

  // Let the framework commit, and — when the page can only offer a flag —
  // wait for it to go quiet.
  while (Date.now() < deadline && stableTicks < SETTLE_STABLE_TICKS) {
    stableTicks = source().isLoading?.() ? 0 : stableTicks + 1;
    await new Promise((resolve) => setTimeout(resolve, SETTLE_POLL_MS));
  }

  const snapshot = source().get();
  if (!isThenable(snapshot)) return snapshot;

  // The page handed us its own await. Honour it, but never let a promise that
  // never settles hold the turn open past the caller's timeout.
  const settled = await withDeadline(
    Promise.resolve(snapshot),
    deadline - Date.now()
  );
  if (settled !== timedOut) return settled;

  logger.warn(
    "Page data did not resolve within the settle timeout; returning what the " +
      "page has now. Raise settleTimeoutMs if the work legitimately takes longer."
  );
  const fallback = source().get();
  if (!isThenable(fallback)) return fallback;
  // We are not going to wait for this one either, but dropping a promise that
  // later rejects surfaces as an unhandled rejection in the host page.
  Promise.resolve(fallback).catch(() => {});
  return undefined;
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as PromiseLike<unknown>).then === "function"
  );
}

/**
 * The array property of a plain object that holds the rows: the longest one.
 *
 * The common shape is `{ totalResults, users: [...] }`, but a snapshot that
 * carries a second list (`{ rows, columns }`) is just as ordinary, and giving
 * up there would drop the whole thing to a severed JSON string. The longest
 * array is the one worth trimming.
 */
function listKeyOf(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  let best: string | undefined;
  for (const key of Object.keys(record)) {
    const candidate = record[key];
    if (!Array.isArray(candidate)) continue;
    if (best === undefined || candidate.length > (record[best] as unknown[]).length) {
      best = key;
    }
  }
  return best;
}

/** How many leading items of `items` fit in `budget` bytes, as a JSON array. */
function countItemsThatFit(items: unknown[], budget: number): number {
  let used = 2; // "[]"
  let count = 0;
  for (const item of items) {
    const json = safeStringify(item) ?? "null";
    const cost = byteLength(json) + (count > 0 ? 1 : 0); // + comma
    if (used + cost > budget) break;
    used += cost;
    count++;
  }
  return count;
}

/**
 * Longest prefix of `text` that costs at most `maxBytes` bytes *once embedded
 * in JSON*. A preview of raw JSON is mostly quotes, and each one doubles under
 * escaping, so measuring the bare string would undercount by up to 2x.
 */
function sliceToBytes(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  const cost = (s: string) => byteLength(JSON.stringify(s)) - 2; // minus quotes
  let out = text.slice(0, maxBytes); // chars ≤ bytes, so this is a safe start
  let bytes = cost(out);
  // Shrink proportionally until it fits (converges in a couple of passes).
  while (bytes > maxBytes && out.length > 0) {
    out = out.slice(
      0,
      Math.max(0, Math.floor((out.length * maxBytes) / bytes) - 1)
    );
    bytes = cost(out);
  }
  return out;
}

function hintFor(fnName: string): string {
  return (
    `The page data returned by "${fnName}" was too large to send in full. ` +
    "Only the first items are included: ask for fewer rows or narrow the " +
    "filters to see the rest."
  );
}

/** A prefix of the raw JSON, for a snapshot with no list to trim. */
function previewOf(
  fnName: string,
  json: string,
  bytes: number,
  budget: number
): unknown {
  const shell = {
    truncated: true,
    originalBytes: bytes,
    maxBytes: budget,
    preview: "",
    hint: hintFor(fnName),
  };
  // Size the preview against what is left of the budget, not a fixed length,
  // so the preview itself can never be what blows the ceiling.
  const overhead = byteLength(safeStringify(shell) ?? "{}");
  return {
    ...shell,
    preview: sliceToBytes(json, Math.min(PREVIEW_CHARS, budget - overhead)),
  };
}

/**
 * Keep the leading items of `items` that fit, with the rest replaced by counts.
 * Returns undefined when the surrounding object alone already exceeds `budget`,
 * so the caller can fall back to a preview instead of shipping something that
 * claims to be truncated while still being over the limit.
 */
function truncateList(
  fnName: string,
  data: unknown,
  listKey: string | undefined,
  items: unknown[],
  budget: number
): unknown | undefined {
  // The container keeps every sibling key untouched. `truncation` is nested
  // rather than spread flat so it cannot silently overwrite a real field of
  // the snapshot: `{ totalResults: 12000, rows }` must not come back claiming
  // 200 total results because the metadata happened to share a name.
  const container: Record<string, unknown> =
    listKey === undefined ? {} : { ...(data as Record<string, unknown>) };
  const key = listKey ?? "items";
  const worstCase = {
    ...container,
    [key]: [] as unknown[],
    truncation: {
      truncated: true,
      returnedItems: items.length,
      totalItems: items.length,
      hint: hintFor(fnName),
    },
  };
  const overhead = byteLength(safeStringify(worstCase) ?? "{}") - 2; // minus "[]"
  if (overhead >= budget) return undefined;

  const kept = items.slice(0, countItemsThatFit(items, budget - overhead));
  return {
    ...container,
    [key]: kept,
    truncation: {
      truncated: true,
      returnedItems: kept.length,
      totalItems: items.length,
      hint: hintFor(fnName),
    },
  };
}

/**
 * Shrink a page snapshot to `budget` bytes, dropping whole items rather than
 * cutting the JSON in half.
 *
 * A truncation that keeps entire rows is still usable by the model; a JSON
 * string severed in the middle of an object is not. Note this only ever touches
 * the snapshot: `success` and `applied` are trimmed off by the caller first and
 * always reach the agent intact, so a filter that worked is never reported as
 * an unusable blob.
 */
export function truncatePageData(
  fnName: string,
  data: unknown,
  budget: number
): unknown {
  const json = safeStringify(data);
  // Non-serializable snapshots already fail at submit time; keep that failure
  // mode rather than masking it here.
  if (json === undefined) return data;

  const bytes = byteLength(json);
  if (bytes <= budget) return data;

  logger.warn(
    `Page data for "${fnName}" is ${bytes} bytes, over the ${budget}-byte ` +
      "limit; it was truncated to the first items that fit. Return fewer " +
      "fields per item, paginate, or raise maxResultBytes on the data source."
  );

  const listKey = listKeyOf(data);
  const items = Array.isArray(data)
    ? data
    : listKey !== undefined
      ? ((data as Record<string, unknown>)[listKey] as unknown[])
      : undefined;

  if (items) {
    const trimmed = truncateList(fnName, data, listKey, items, budget);
    // Trimming the list is not always enough: a snapshot whose *siblings*
    // overflow on their own (a 60 KB facet blob next to the rows) still needs
    // the preview path, or the oversized result reaches the registry guard and
    // takes `success`/`applied` down with it.
    const trimmedBytes = byteLength(safeStringify(trimmed) ?? "");
    if (trimmed !== undefined && trimmedBytes <= budget) return trimmed;
  }

  return previewOf(fnName, json, bytes, budget);
}
