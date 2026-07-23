export interface ActivityEntry {
  ts: number;
  actor: "user" | "agent";
  name: string;
  summary: string;
  data?: Record<string, unknown>;
}

export interface ActivityInput {
  actor?: "user" | "agent";
  name: string;
  summary: string;
  data?: Record<string, unknown>;
  ts?: number;
}

export const DEFAULT_MAX_ACTIVITY_ENTRIES = 10;

/** Per-value caps for an entry's `data` (bounds what one event adds to every message). */
export const MAX_ACTIVITY_STRING_LEN = 1000;
export const MAX_ACTIVITY_ARRAY_ITEMS = 50;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

// Rebuilds the value (so the result is decoupled from the caller's object) while
// truncating long strings and capping arrays. `seen` guards against cycles.
function clampValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "string") {
    if (value.length <= MAX_ACTIVITY_STRING_LEN) return value;
    const dropped = value.length - MAX_ACTIVITY_STRING_LEN;
    return value.slice(0, MAX_ACTIVITY_STRING_LEN) + `…[truncated ${dropped} chars]`;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return "…[circular]";
    seen.add(value);
    const out: unknown[] = value
      .slice(0, MAX_ACTIVITY_ARRAY_ITEMS)
      .map((v) => clampValue(v, seen));
    if (value.length > MAX_ACTIVITY_ARRAY_ITEMS) {
      out.push(`…[+${value.length - MAX_ACTIVITY_ARRAY_ITEMS} more]`);
    }
    seen.delete(value);
    return out;
  }
  if (isPlainObject(value)) {
    if (seen.has(value)) return "…[circular]";
    seen.add(value);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = clampValue(v, seen);
    seen.delete(value);
    return out;
  }
  return value;
}

/** Deep-clamp an entry's `data`: truncate long strings, cap arrays, guard cycles. */
export function clampActivityData(
  data: Record<string, unknown>
): Record<string, unknown> {
  return clampValue(data, new WeakSet<object>()) as Record<string, unknown>;
}

/** Capped, in-memory log of recent user and agent actions (oldest dropped first). */
export class ActivityLedger {
  private entries: ActivityEntry[] = [];
  private readonly maxEntries: number;

  constructor(maxEntries: number = DEFAULT_MAX_ACTIVITY_ENTRIES) {
    const n = Math.floor(maxEntries);
    this.maxEntries = Number.isFinite(n)
      ? Math.max(1, n)
      : DEFAULT_MAX_ACTIVITY_ENTRIES;
  }

  add(input: ActivityInput): ActivityEntry {
    const entry: ActivityEntry = {
      ts: input.ts ?? Date.now(),
      actor: input.actor ?? "user",
      name: input.name,
      summary: input.summary,
      ...(input.data !== undefined
        ? { data: clampActivityData(input.data) }
        : {}),
    };
    this.entries.push(entry);
    const overflow = this.entries.length - this.maxEntries;
    if (overflow > 0) {
      this.entries.splice(0, overflow);
    }
    return entry;
  }

  getRecent(): ActivityEntry[] {
    return [...this.entries];
  }

  get size(): number {
    return this.entries.length;
  }

  clear(): void {
    this.entries = [];
  }
}
