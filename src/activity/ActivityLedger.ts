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

export const DEFAULT_MAX_ACTIVITY_ENTRIES = 30;

/** Capped, in-memory log of recent user and agent actions (oldest dropped first). */
export class ActivityLedger {
  private entries: ActivityEntry[] = [];
  private readonly maxEntries: number;

  constructor(maxEntries: number = DEFAULT_MAX_ACTIVITY_ENTRIES) {
    this.maxEntries = Math.max(1, Math.floor(maxEntries));
  }

  add(input: ActivityInput): ActivityEntry {
    const entry: ActivityEntry = {
      ts: input.ts ?? Date.now(),
      actor: input.actor ?? "user",
      name: input.name,
      summary: input.summary,
      ...(input.data !== undefined ? { data: input.data } : {}),
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
