import type { ContextEntry } from "./ClientContextRegistry";

export interface PageStateChange {
  field: string;
  from: unknown;
  to: unknown;
}

export interface PageStateBaseline {
  page: string | undefined;
  state: Record<string, unknown>;
}

const PAGE_STATE_PREFIX = "page-state:";

/** Merge all `page-state:*` entries into one flat object. */
export function mergePageState(
  entries: Record<string, ContextEntry>
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(entries)) {
    if (key.startsWith(PAGE_STATE_PREFIX) && entry.data) {
      Object.assign(merged, entry.data);
    }
  }
  return merged;
}

/** Identify the current page so a navigation can be told apart from an edit. */
export function readPageId(
  entries: Record<string, ContextEntry>
): string | undefined {
  const current = entries["current-page"]?.data as
    | { url?: string; page?: string }
    | undefined;
  if (current?.page) return current.page;
  if (current?.url) return current.url;
  const browser = entries["browser-page"]?.data as { url?: string } | undefined;
  return browser?.url;
}

function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Changed fields, considering only keys present in both states. */
export function diffPageState(
  prev: Record<string, unknown>,
  current: Record<string, unknown>
): PageStateChange[] {
  const changes: PageStateChange[] = [];
  for (const key of Object.keys(current)) {
    if (!(key in prev)) continue;
    if (!equal(prev[key], current[key])) {
      changes.push({ field: key, from: prev[key], to: current[key] });
    }
  }
  return changes;
}

/**
 * Compute the page-state delta since the last send and the new baseline. No
 * changes are reported across a page navigation (different page id), only edits
 * on the same page.
 */
export function computePageStateDelta(
  prev: PageStateBaseline | null,
  entries: Record<string, ContextEntry>
): { changes: PageStateChange[]; baseline: PageStateBaseline } {
  const state = mergePageState(entries);
  const page = readPageId(entries);
  const changes =
    prev && prev.page === page ? diffPageState(prev.state, state) : [];
  return { changes, baseline: { page, state } };
}
