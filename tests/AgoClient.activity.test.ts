import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AgoClient } from "../src/client/AgoClient";
import type { ActivityEntry } from "../src/activity/ActivityLedger";

describe("AgoClient activity ledger", () => {
  let client: AgoClient;

  beforeEach(() => {
    client = new AgoClient({ baseUrl: "https://example.test" });
  });

  afterEach(() => {
    client.destroy();
  });

  it("records a user action and reads it back", () => {
    client.recordActivity({ name: "order.shipped", summary: "User shipped #1" });
    const recent = client.getRecentActivity();
    expect(recent).toHaveLength(1);
    expect(recent[0]).toMatchObject({ actor: "user", name: "order.shipped" });
  });

  it("emits activity:recorded", () => {
    const seen: ActivityEntry[] = [];
    client.on("activity:recorded", (e) => seen.push(e));
    client.recordActivity({ name: "a", summary: "a" });
    expect(seen).toHaveLength(1);
    expect(seen[0].name).toBe("a");
  });

  it("exposes the recent window as an activity:recent context entry", () => {
    client.recordActivity({ name: "a", summary: "did a" });
    const snap = client.getContextSnapshot();
    const entry = snap?.entries["activity:recent"];
    expect(entry).toBeDefined();
    const data = entry?.data as { events: ActivityEntry[] };
    expect(data.events.map((e) => e.name)).toEqual(["a"]);
  });

  it("omits the activity:recent entry when the ledger is empty", () => {
    const snap = client.getContextSnapshot();
    expect(snap?.entries?.["activity:recent"]).toBeUndefined();
  });

  it("keeps entries and re-registers context across a destroy/revive cycle", () => {
    client.recordActivity({ name: "a", summary: "a" });
    client.destroy();
    client.reviveAfterDestroy();
    expect(client.getRecentActivity().map((e) => e.name)).toEqual(["a"]);
    expect(client.getContextSnapshot()?.entries["activity:recent"]).toBeDefined();
  });

  it("clearActivity empties the ledger", () => {
    client.recordActivity({ name: "a", summary: "a" });
    client.clearActivity();
    expect(client.getRecentActivity()).toEqual([]);
  });

  it("honors maxActivityEntries from config", () => {
    const capped = new AgoClient({
      baseUrl: "https://example.test",
      maxActivityEntries: 2,
    });
    capped.recordActivity({ name: "a", summary: "a" });
    capped.recordActivity({ name: "b", summary: "b" });
    capped.recordActivity({ name: "c", summary: "c" });
    expect(capped.getRecentActivity().map((e) => e.name)).toEqual(["b", "c"]);
    capped.destroy();
  });

  it("clamps oversized data recorded through the client", () => {
    client.recordActivity({
      name: "agent.page_state",
      summary: "set prompt",
      data: { prompt: "z".repeat(5000) },
    });
    const stored = client.getRecentActivity()[0].data as { prompt: string };
    expect(stored.prompt.length).toBeLessThan(5000);
    expect(stored.prompt).toContain("[truncated");
  });
});
