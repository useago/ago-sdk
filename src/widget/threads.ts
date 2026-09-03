/**
 * Thread-list helpers shared by the history screen and the auto-resume logic.
 * Pure functions over `Conversation[]`; no DOM, no client.
 */

import type { Conversation } from "../client/types";

/**
 * How long a thread stays "current" after its last message. The bubble widget
 * reopens the most recent thread on load only inside this window, mirroring the
 * reference widget's two-hour rule.
 */
export const RESUME_TTL_MS = 2 * 60 * 60 * 1000;

function timeOf(thread: Conversation): number {
  const t =
    thread.lastMessageDate instanceof Date
      ? thread.lastMessageDate.getTime()
      : new Date(thread.lastMessageDate).getTime();
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
}

/** Newest first. Returns a new array; the input is untouched. */
export function sortThreadsByDate(threads: Conversation[]): Conversation[] {
  return [...threads].sort((a, b) => timeOf(b) - timeOf(a));
}

/**
 * The thread to reopen on load: the most recent one, if its last message is
 * younger than `ttlMs`. Null when the list is empty, the newest thread is stale,
 * or its date is unusable.
 */
export function pickResumableThread(
  threads: Conversation[],
  now: number = Date.now(),
  ttlMs: number = RESUME_TTL_MS,
): Conversation | null {
  const newest = sortThreadsByDate(threads)[0];
  if (!newest) return null;
  const t = timeOf(newest);
  if (!Number.isFinite(t)) return null;
  return now - t < ttlMs ? newest : null;
}
